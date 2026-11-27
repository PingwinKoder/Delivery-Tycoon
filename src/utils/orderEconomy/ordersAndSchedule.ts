import type { Building } from '../../types/building';
import type {
  ActiveLongTermOrder,
  ActiveOrder,
  ActiveShortTermOrder,
  MonthlySettlementRecord,
  OrderDeliveryStop,
  OrderEconomyState,
  OrderOffer,
  WeeklyOrderSettlementResult,
  WeeklyScheduleTask,
  WeeklyTaskSortMode,
  WeeklyTaskType,
} from '../../types/orders';
import { PROCEDURAL_BUILDINGS } from '../buildings';
import {
  DAYS_PER_WEEK,
  type GameCalendarDate,
  MINUTES_PER_DAY,
  POLISH_MONTHS,
  addCalendarMonthsToGameDay,
  getCalendarDateFromElapsedDays,
  getCalendarDateFromGameDay,
  getGameClockDisplay,
} from '../gameClock';
import {
  calculateMonthlyCompanyCosts,
  completeDueCourierTrainings,
  getFreeWarehouseCapacity,
  getPendingVehicleRepairs,
  getRepairCourierReadiness,
  getStoredPackagesForOrder,
  getVehicleDurability,
  hasEnoughWarehouseSpaceForPickup,
} from './companyAndFleet';
import {
  BASE_FUEL_PRICE_PER_LITER,
  BIKE_COURIER_CAPACITY,
  CONTRACT_TERMINATION_THRESHOLD,
  EARLY_OFFERS_DAY_LIMIT,
  FUEL_PRICE_CHANGE_MAX_DAYS,
  FUEL_PRICE_CHANGE_MIN_DAYS,
  INITIAL_COMPANY_SATISFACTION,
  INITIAL_NEXT_FUEL_PRICE_CHANGE_GAME_DAY,
  INITIAL_ORDER_SATISFACTION,
  LATE_OFFERS_BATCH_MAX,
  LATE_OFFERS_BATCH_MIN,
  LATE_OFFERS_INTERVAL_DAYS,
  LATE_PICKUP_SATISFACTION_PENALTY,
  LONG_TERM_DELIVERY_WINDOW_DAYS,
  MAX_MONTHLY_SETTLEMENTS_HISTORY,
  SUNDAY_SETTLEMENT_MINUTE_OF_DAY,
  SUNDAY_WEEKDAY_INDEX,
  UNDELIVERED_PACKAGE_PENALTY_MULTIPLIER,
  UNDELIVERED_WEEK_SATISFACTION_PENALTY,
  WEEKLY_ON_TIME_SATISFACTION_BONUS,
  applyCompanySatisfactionDelta,
  calculateReputationLevel,
  clampFuelPrice,
  clampSatisfaction,
  createEmptyCurrentMonthLedger,
  getSeasonalTargetFuelPrice,
  isNightHoursForTime,
  nextRng,
  recordMonthlySatisfactionSample,
  rngInt,
  roundCurrency,
} from './constantsAndHelpers';
import {
  buildDeliveryStops,
  generateOffersBatch,
  getBuildingPools,
} from './offerGenerator';

/**
 * Returns the canonical merged weekly schedule task ID for an order (one row per order per day).
 */
export function makeWeeklyTaskId(orderId: string, _taskType?: WeeklyTaskType): string {
  return orderId;
}

/**
 * Computes the final 1-based game day to finish delivering packages picked up on `pickupGameDay`
 * under a long-term contract: up to 3 in-game days (`pickupGameDay + 2`), capped at the same
 * week's Sunday (`23:59` weekly settlement) and the contract's final active day.
 */
export function getLongTermDeliveryDeadlineGameDay(
  pickupGameDay: number,
  endGameDay?: number
): number {
  const safePickupDay = Math.max(1, Math.floor(pickupGameDay));
  const pickupDate = getCalendarDateFromGameDay(safePickupDay);
  const sundayGameDay = safePickupDay + (SUNDAY_WEEKDAY_INDEX - pickupDate.dayIndex);
  const threeDayDeadline = safePickupDay + (LONG_TERM_DELIVERY_WINDOW_DAYS - 1);
  let deadline = Math.min(threeDayDeadline, sundayGameDay);
  if (typeof endGameDay === 'number' && Number.isFinite(endGameDay)) {
    deadline = Math.min(deadline, Math.max(safePickupDay, Math.floor(endGameDay) - 1));
  }
  return deadline;
}

function getLongTermPickupDayQuota(order: ActiveLongTermOrder, weekdayIndex: number): number {
  const idxInPickups = order.pickupWeekdays.indexOf(weekdayIndex);
  if (idxInPickups === -1) return 0;
  const basePerDay = Math.floor(order.packagesPerWeek / order.pickupDaysPerWeek);
  const remainder = order.packagesPerWeek % order.pickupDaysPerWeek;
  return basePerDay + (idxInPickups < remainder ? 1 : 0);
}

/**
 * Returns the package count scheduled for the nearest upcoming pickup date (including next week
 * if no pickup days remain in the current Mon–Sun week) for an active long-term contract.
 */
export function getUpcomingLongTermPickupQuota(
  order: ActiveLongTermOrder,
  currentGameDay: number
): number {
  if (order.status !== 'active' || order.pickupWeekdays.length === 0) return 0;
  const safeDay = Math.max(1, Math.floor(currentGameDay));
  const currentDate = getCalendarDateFromGameDay(safeDay);

  for (let offset = 0; offset < DAYS_PER_WEEK; offset++) {
    const candidateDay = safeDay + offset;
    if (candidateDay < order.acceptedAtGameDay) continue;
    if (candidateDay >= order.endGameDay) break;
    const candidateWeekday = (currentDate.dayIndex + offset) % DAYS_PER_WEEK;
    if (order.pickupWeekdays.includes(candidateWeekday)) {
      return getLongTermPickupDayQuota(order, candidateWeekday);
    }
  }

  return 0;
}

/**
 * Deterministically computes the total number of packages scheduled across the entire
 * active duration `[acceptedAtGameDay, endGameDay)` of a long-term contract.
 */
export function getLongTermContractTotalPackages(order: ActiveLongTermOrder): number {
  const startDay = Math.max(1, Math.floor(order.acceptedAtGameDay));
  const endDay = Math.max(startDay, Math.floor(order.endGameDay));
  let total = 0;
  if (order.pickupWeekdays.length > 0 && order.pickupDaysPerWeek > 0) {
    for (let day = startDay; day < endDay; day++) {
      const weekday = getCalendarDateFromGameDay(day).dayIndex;
      total += getLongTermPickupDayQuota(order, weekday);
    }
  }
  return Math.max(total, order.pickedUpPackagesTotal ?? 0, order.deliveredPackagesTotal);
}

function extractOrderIdFromTaskKey(taskKey: string): string {
  const sepIdx = taskKey.lastIndexOf(':');
  if (sepIdx === -1) return taskKey;
  const suffix = taskKey.slice(sepIdx + 1);
  if (suffix === 'pickup' || suffix === 'delivery') {
    return taskKey.slice(0, sepIdx);
  }
  return taskKey;
}

const MAX_ARCHIVED_ORDERS = 40;

function removeOrderIdsFromWeeklyPriority(
  priorityMap: Record<number, string[]>,
  idsToRemove: ReadonlySet<string>
): Record<number, string[]> {
  if (idsToRemove.size === 0) return priorityMap;
  const next: Record<number, string[]> = {};
  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    next[wd] = (priorityMap[wd] ?? []).filter(
      (entryId) => !idsToRemove.has(entryId) && !idsToRemove.has(extractOrderIdFromTaskKey(entryId))
    );
  }
  return next;
}

function pruneInactiveOrderIdsFromWeeklyPriority(
  priorityMap: Record<number, string[]>,
  activeOrders: readonly ActiveOrder[]
): Record<number, string[]> {
  const activeIds = new Set<string>();
  for (let i = 0; i < activeOrders.length; i++) {
    if (activeOrders[i].status === 'active') {
      activeIds.add(activeOrders[i].id);
    }
  }
  let changed = false;
  const next: Record<number, string[]> = {};
  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    const list = priorityMap[wd] ?? [];
    const filtered = list.filter(
      (entryId) =>
        entryId.startsWith('repair:') ||
        activeIds.has(entryId) ||
        activeIds.has(extractOrderIdFromTaskKey(entryId))
    );
    if (filtered.length !== list.length) {
      changed = true;
    }
    next[wd] = filtered;
  }
  return changed ? next : priorityMap;
}

function removeOrderIdsFromWarehouseInventory(
  warehouseInventory: Record<string, number>,
  warehousePackages: number,
  idsToRemove: ReadonlySet<string>
): { warehouseInventory: Record<string, number>; warehousePackages: number } {
  if (idsToRemove.size === 0) {
    return { warehouseInventory, warehousePackages };
  }

  let removedTotal = 0;
  let changed = false;
  const nextInventory: Record<string, number> = {};

  for (const [id, count] of Object.entries(warehouseInventory)) {
    if (idsToRemove.has(id)) {
      removedTotal += Math.max(0, count);
      changed = true;
    } else if (count > 0) {
      nextInventory[id] = count;
    }
  }

  if (!changed) {
    return { warehouseInventory, warehousePackages };
  }

  return {
    warehouseInventory: nextInventory,
    warehousePackages: Math.max(0, warehousePackages - removedTotal),
  };
}

/**
 * Counts only newly generated, not-yet-seen pending offers (expired offers are already pruned).
 */
export function countUnreadOffers(state: OrderEconomyState): number {
  let count = 0;
  for (let i = 0; i < state.pendingOffers.length; i++) {
    if (!state.pendingOffers[i].isSeen) {
      count += 1;
    }
  }
  return count;
}

/**
 * Marks all currently visible pending offers as seen (clears the unread notification badge).
 */
export function markAllPendingOffersSeen(state: OrderEconomyState): OrderEconomyState {
  if (countUnreadOffers(state) === 0) return state;
  return {
    ...state,
    pendingOffers: state.pendingOffers.map((offer) =>
      offer.isSeen ? offer : { ...offer, isSeen: true }
    ),
  };
}

// ============================================================================
// Order Signing, Delivery & Penalty Actions
// ============================================================================

function computeInitialExpectedWeeklyPackages(
  offer: OrderOffer,
  acceptedDate: GameCalendarDate,
  endGameDay: number
): number {
  const daysUntilSunday = SUNDAY_WEEKDAY_INDEX - acceptedDate.dayIndex;
  const upcomingSundayGameDay = acceptedDate.gameDay + daysUntilSunday;

  if (offer.kind === 'long_term') {
    const remainingPickupDaysThisWeek = offer.pickupWeekdays.filter(
      (wd) => wd >= acceptedDate.dayIndex
    ).length;
    if (remainingPickupDaysThisWeek <= 0) {
      return 0;
    }
    return Math.round(
      offer.packagesPerWeek * (remainingPickupDaysThisWeek / offer.pickupDaysPerWeek)
    );
  }

  // Short-term order: if due on or before upcoming Sunday, all packages are expected this week
  if (endGameDay <= upcomingSundayGameDay) {
    return offer.totalPackages;
  }

  const totalRemainingDays = Math.max(1, endGameDay - acceptedDate.gameDay + 1);
  const daysThisWeek = Math.max(1, daysUntilSunday + 1);
  return Math.min(
    offer.totalPackages,
    Math.max(1, Math.ceil((offer.totalPackages * daysThisWeek) / totalRemainingDays))
  );
}

/**
 * Signs a pending offer and moves it to `activeOrders` (no upper cap on active orders).
 * Individual contract satisfaction always starts at 80%.
 */
export function acceptOrderOffer(
  state: OrderEconomyState,
  offerId: string,
  currentMinutes: number = state.lastProcessedMinutes
): OrderEconomyState {
  const offerIndex = state.pendingOffers.findIndex((o) => o.id === offerId);
  if (offerIndex === -1) return state;

  const offer = state.pendingOffers[offerIndex];
  const acceptedDate = getCalendarDateFromElapsedDays(
    Math.floor(currentMinutes / MINUTES_PER_DAY)
  );
  const acceptedAtGameDay = acceptedDate.gameDay;

  const endGameDay =
    offer.kind === 'short_term'
      ? acceptedAtGameDay + offer.durationDays
      : addCalendarMonthsToGameDay(acceptedAtGameDay, offer.durationMonths);
  const endMinutes = (endGameDay - 1) * MINUTES_PER_DAY;

  const expectedPackagesThisWeek = computeInitialExpectedWeeklyPackages(
    offer,
    acceptedDate,
    endGameDay
  );

  const commonBase = {
    status: 'active' as const,
    acceptedAtGameDay,
    acceptedAtMinutes: currentMinutes,
    endGameDay,
    endMinutes,
    satisfaction: INITIAL_ORDER_SATISFACTION,
    pickedUpPackagesTotal: 0,
    deliveredPackagesTotal: 0,
    totalEarnedPayout: 0,
    totalPenaltiesPaid: 0,
    weekly: {
      weekStartGameDay: acceptedAtGameDay,
      expectedPackagesThisWeek,
      pickedUpPackagesThisWeek: 0,
      deliveredPackagesThisWeek: 0,
      latePickupsThisWeek: 0,
      lastSettledSundayGameDay: null,
    },
  };

  let activeOrder: ActiveOrder;
  if (offer.kind === 'short_term') {
    const shortActive: ActiveShortTermOrder = {
      ...offer,
      ...commonBase,
      deliveryStops: offer.deliveryStops.map((s) => ({ ...s })),
      lumpSumPaid: false,
    };
    activeOrder = shortActive;
  } else {
    const longActive: ActiveLongTermOrder = {
      ...offer,
      ...commonBase,
      accruedMonthlyPayout: 0,
      currentWeekDeliveryStops: offer.sampleDeliveryStops.map((s) => ({ ...s })),
    };
    activeOrder = longActive;
  }

  const nextPending = [
    ...state.pendingOffers.slice(0, offerIndex),
    ...state.pendingOffers.slice(offerIndex + 1),
  ];

  // Register accepted order as a single merged task in per-weekday priority queues
  const mergedTaskId = makeWeeklyTaskId(activeOrder.id);
  const nextPriorityOrder: Record<number, string[]> = {};
  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    const existing = state.weeklyPriorityOrder[wd] ?? [];
    const appliesToDay =
      activeOrder.kind === 'long_term' ? activeOrder.pickupWeekdays.includes(wd) : true;
    if (!appliesToDay) {
      nextPriorityOrder[wd] = existing;
      continue;
    }
    const updated = [...existing];
    if (!updated.includes(mergedTaskId)) {
      updated.push(mergedTaskId);
    }
    nextPriorityOrder[wd] = updated;
  }

  return {
    ...state,
    pendingOffers: nextPending,
    activeOrders: [...state.activeOrders, activeOrder],
    weeklyPriorityOrder: nextPriorityOrder,
  };
}

/**
 * Declines and removes a pending offer from the offers list.
 */
export function rejectOrderOffer(state: OrderEconomyState, offerId: string): OrderEconomyState {
  const nextPending = state.pendingOffers.filter((o) => o.id !== offerId);
  if (nextPending.length === state.pendingOffers.length) return state;
  return {
    ...state,
    pendingOffers: nextPending,
  };
}

/**
 * Records a late pickup incident on an active order (evaluated at Sunday 23:59 for -12% satisfaction).
 */
export function recordLatePickup(state: OrderEconomyState, orderId: string): OrderEconomyState {
  let changed = false;
  const activeOrders = state.activeOrders.map((order) => {
    if (order.id !== orderId || order.status !== 'active') return order;
    changed = true;
    return {
      ...order,
      weekly: {
        ...order.weekly,
        latePickupsThisWeek: order.weekly.latePickupsThisWeek + 1,
      },
    };
  });

  return changed ? { ...state, activeOrders } : state;
}

/**
 * Records packages picked up from the sender during the current week (and optional gameDay)
 * for an active order.
 */
export function recordPackagePickup(
  state: OrderEconomyState,
  orderId: string,
  pickedUpCount = 1,
  currentGameDay?: number
): OrderEconomyState {
  if (pickedUpCount <= 0) return state;
  let changed = false;
  const activeOrders = state.activeOrders.map((order) => {
    if (order.id !== orderId || order.status !== 'active') return order;
    changed = true;
    const nextDailyPickupFields =
      currentGameDay !== undefined
        ? {
          lastPickupGameDay: currentGameDay,
          pickedUpOnLastPickupDay:
            (order.weekly.lastPickupGameDay === currentGameDay
              ? (order.weekly.pickedUpOnLastPickupDay ?? 0)
              : 0) + pickedUpCount,
        }
        : {};
    return {
      ...order,
      pickedUpPackagesTotal: (order.pickedUpPackagesTotal ?? 0) + pickedUpCount,
      weekly: {
        ...order.weekly,
        pickedUpPackagesThisWeek: order.weekly.pickedUpPackagesThisWeek + pickedUpCount,
        ...nextDailyPickupFields,
      },
    };
  });
  return changed ? { ...state, activeOrders } : state;
}

/**
 * Records delivered packages for an active order.
 * - Short-term orders: pays out `totalExpectedPayout` immediately upon delivering the final package.
 * - Long-term contracts: accrues `deliveredCount * ratePerPackage` to be paid on the 1st of next month.
 */
export function recordPackageDelivery(
  state: OrderEconomyState,
  orderId: string,
  deliveredCount = 1,
  currentMinutes: number = state.lastProcessedMinutes,
  stopId?: string
): OrderEconomyState {
  if (deliveredCount <= 0) return state;

  const idx = state.activeOrders.findIndex((o) => o.id === orderId && o.status === 'active');
  if (idx === -1) return state;

  const order = state.activeOrders[idx];
  const currentDate = getCalendarDateFromElapsedDays(Math.floor(currentMinutes / MINUTES_PER_DAY));

  const updateStops = (stops: readonly OrderDeliveryStop[], count: number): OrderDeliveryStop[] => {
    let remainingToMark = count;
    return stops.map((stop) => {
      if (remainingToMark <= 0) return stop;
      if (stopId && stop.id !== stopId) return stop;
      const room = Math.max(0, stop.packageCount - stop.deliveredCount);
      if (room <= 0) return stop;
      const delta = Math.min(room, remainingToMark);
      remainingToMark -= delta;
      return { ...stop, deliveredCount: stop.deliveredCount + delta };
    });
  };

  if (order.kind === 'short_term') {
    const remainingPackages = Math.max(0, order.totalPackages - order.deliveredPackagesTotal);
    const applied = Math.min(deliveredCount, remainingPackages);
    if (applied <= 0) return state;

    const newDeliveredTotal = order.deliveredPackagesTotal + applied;
    const newDeliveredThisWeek = order.weekly.deliveredPackagesThisWeek + applied;
    const newPickedUpThisWeek = Math.max(order.weekly.pickedUpPackagesThisWeek, newDeliveredThisWeek);
    const isFinished = newDeliveredTotal >= order.totalPackages;
    const updatedStops = updateStops(order.deliveryStops, applied);

    if (isFinished) {
      const completedOrder: ActiveShortTermOrder = {
        ...order,
        status: 'completed',
        deliveryStops: updatedStops,
        pickedUpPackagesTotal: Math.max(order.pickedUpPackagesTotal ?? 0, newDeliveredTotal),
        deliveredPackagesTotal: newDeliveredTotal,
        lumpSumPaid: true,
        totalEarnedPayout: roundCurrency(order.totalEarnedPayout + order.totalExpectedPayout),
        weekly: {
          ...order.weekly,
          pickedUpPackagesThisWeek: newPickedUpThisWeek,
          deliveredPackagesThisWeek: newDeliveredThisWeek,
        },
        concludedAtGameDay: currentDate.gameDay,
        concludedAtMinutes: currentMinutes,
      };

      const nextActive = [
        ...state.activeOrders.slice(0, idx),
        ...state.activeOrders.slice(idx + 1),
      ];
      const nextCompletedCount = state.completedOrdersCount + 1;
      const daysRemaining = order.endGameDay - currentDate.gameDay;
      const satisfactionGain = daysRemaining >= 1 ? 2.0 : 1.0;
      const baseCompanySat =
        typeof state.companySatisfaction === 'number' && Number.isFinite(state.companySatisfaction)
          ? state.companySatisfaction
          : INITIAL_COMPANY_SATISFACTION;
      const nextCompanySatisfaction = applyCompanySatisfactionDelta(
        baseCompanySat,
        satisfactionGain
      );
      const nextReputationLevel = calculateReputationLevel(
        nextCompletedCount,
        nextCompanySatisfaction
      );
      const baseLedger =
        state.currentMonthLedger ?? createEmptyCurrentMonthLedger(baseCompanySat);
      const nextLedger = recordMonthlySatisfactionSample(
        {
          ...baseLedger,
          shortTermRevenue: roundCurrency(baseLedger.shortTermRevenue + order.totalExpectedPayout),
          completedOrdersCount: baseLedger.completedOrdersCount + 1,
        },
        nextCompanySatisfaction
      );

      return {
        ...state,
        balance: roundCurrency(state.balance + order.totalExpectedPayout),
        completedOrdersCount: nextCompletedCount,
        companySatisfaction: nextCompanySatisfaction,
        annualSatisfactionAvg: nextCompanySatisfaction,
        currentMonthLedger: nextLedger,
        reputationLevel: nextReputationLevel,
        activeOrders: nextActive,
        archivedOrders: [completedOrder, ...state.archivedOrders].slice(0, MAX_ARCHIVED_ORDERS),
        weeklyPriorityOrder: pruneInactiveOrderIdsFromWeeklyPriority(
          removeOrderIdsFromWeeklyPriority(state.weeklyPriorityOrder, new Set([completedOrder.id])),
          nextActive
        ),
      };
    }

    const updatedOrder: ActiveShortTermOrder = {
      ...order,
      deliveryStops: updatedStops,
      pickedUpPackagesTotal: Math.max(order.pickedUpPackagesTotal ?? 0, newDeliveredTotal),
      deliveredPackagesTotal: newDeliveredTotal,
      weekly: {
        ...order.weekly,
        pickedUpPackagesThisWeek: newPickedUpThisWeek,
        deliveredPackagesThisWeek: newDeliveredThisWeek,
      },
    };

    const nextActive = [...state.activeOrders];
    nextActive[idx] = updatedOrder;
    return {
      ...state,
      activeOrders: nextActive,
    };
  }

  // Long-term contract: accrue package earnings for the next 1st-of-month settlement
  const earnedNow = roundCurrency(deliveredCount * order.ratePerPackage);
  const newDeliveredThisWeek = order.weekly.deliveredPackagesThisWeek + deliveredCount;
  const newPickedUpThisWeek = Math.max(order.weekly.pickedUpPackagesThisWeek, newDeliveredThisWeek);
  const nextLongDeliveredTotal = order.deliveredPackagesTotal + deliveredCount;
  const updatedLongOrder: ActiveLongTermOrder = {
    ...order,
    currentWeekDeliveryStops: updateStops(order.currentWeekDeliveryStops, deliveredCount),
    pickedUpPackagesTotal: Math.max(order.pickedUpPackagesTotal ?? 0, nextLongDeliveredTotal),
    deliveredPackagesTotal: nextLongDeliveredTotal,
    accruedMonthlyPayout: roundCurrency(order.accruedMonthlyPayout + earnedNow),
    totalEarnedPayout: roundCurrency(order.totalEarnedPayout + earnedNow),
    weekly: {
      ...order.weekly,
      pickedUpPackagesThisWeek: newPickedUpThisWeek,
      deliveredPackagesThisWeek: newDeliveredThisWeek,
    },
  };

  const nextActive = [...state.activeOrders];
  nextActive[idx] = updatedLongOrder;

  const nextPendingLongTermPayout = roundCurrency(state.pendingMonthlyLongTermPayout + earnedNow);
  const batchCompleted =
    newDeliveredThisWeek >= newPickedUpThisWeek ||
    nextLongDeliveredTotal >= (updatedLongOrder.pickedUpPackagesTotal ?? 0);

  if (!batchCompleted) {
    return {
      ...state,
      pendingMonthlyLongTermPayout: nextPendingLongTermPayout,
      activeOrders: nextActive,
    };
  }

  const baseLedger =
    state.currentMonthLedger ??
    createEmptyCurrentMonthLedger(state.companySatisfaction ?? INITIAL_COMPANY_SATISFACTION);

  return {
    ...state,
    pendingMonthlyLongTermPayout: nextPendingLongTermPayout,
    currentMonthLedger: {
      ...baseLedger,
      longTermAccruedRevenue: nextPendingLongTermPayout,
    },
    activeOrders: nextActive,
  };
}

// ============================================================================
// Weekly (Sunday 23:59), Daily, Monthly (1st of Month) & Annual (1 Styczeń)
// ============================================================================

/**
 * Evaluates all active contracts on Sunday at 23:59:
 * - No late pickups & no undelivered packages: +4% (max 100%)
 * - Late pickup(s): -12% per late pickup
 * - Undelivered packages: -18% satisfaction + financial penalty of 2x rate per undelivered package
 * - Drops below 20%: contract is terminated and its final score counts toward company annualSatisfactionAvg
 */
export function settleWeeklySatisfaction(
  state: OrderEconomyState,
  sundayGameDay: number,
  sundayMinutes: number,
  buildings: readonly Building[] = PROCEDURAL_BUILDINGS
): OrderEconomyState {
  if (state.activeOrders.length === 0) return state;

  let nextBalance = state.balance;
  let companySatisfaction =
    typeof state.companySatisfaction === 'number' && Number.isFinite(state.companySatisfaction)
      ? state.companySatisfaction
      : INITIAL_COMPANY_SATISFACTION;
  let nextLedger =
    state.currentMonthLedger ?? createEmptyCurrentMonthLedger(companySatisfaction);
  let satisfactionTouched = false;
  const useRandomRng = sundayGameDay >= EARLY_OFFERS_DAY_LIMIT;
  let rngState = useRandomRng ? state.randomRngState : state.rngState;

  const { deliveryBuildings } = getBuildingPools(buildings);
  const remainingActive: ActiveOrder[] = [];
  const newlyArchived: ActiveOrder[] = [];
  const settlementResults: WeeklyOrderSettlementResult[] = [];

  for (const order of state.activeOrders) {
    if (order.status !== 'active' || order.weekly.lastSettledSundayGameDay === sundayGameDay) {
      remainingActive.push(order);
      continue;
    }

    const latePickups = order.weekly.latePickupsThisWeek;
    const undeliveredPackages = Math.max(
      0,
      order.weekly.expectedPackagesThisWeek - order.weekly.deliveredPackagesThisWeek
    );

    let delta = 0;
    let penaltyAmount = 0;

    if (latePickups === 0 && undeliveredPackages === 0) {
      delta = WEEKLY_ON_TIME_SATISFACTION_BONUS;
      if (order.kind === 'long_term' && order.weekly.deliveredPackagesThisWeek > 0) {
        const companyGain = 1.5 + Math.min(1.0, order.weekly.deliveredPackagesThisWeek / 40);
        companySatisfaction = applyCompanySatisfactionDelta(companySatisfaction, companyGain);
        satisfactionTouched = true;
      }
    } else {
      if (latePickups > 0) {
        delta -= latePickups * LATE_PICKUP_SATISFACTION_PENALTY;
        companySatisfaction = applyCompanySatisfactionDelta(companySatisfaction, -5 * latePickups);
        satisfactionTouched = true;
      }
      if (undeliveredPackages > 0) {
        delta -= UNDELIVERED_WEEK_SATISFACTION_PENALTY;
        const undeliveredRatio =
          undeliveredPackages / Math.max(1, order.weekly.expectedPackagesThisWeek);
        const companyPenalty = -(8 + Math.min(4, Math.round(undeliveredRatio * 4)));
        companySatisfaction = applyCompanySatisfactionDelta(companySatisfaction, companyPenalty);
        satisfactionTouched = true;
        penaltyAmount = roundCurrency(
          undeliveredPackages * order.ratePerPackage * UNDELIVERED_PACKAGE_PENALTY_MULTIPLIER
        );
        nextBalance = roundCurrency(nextBalance - penaltyAmount);
        nextLedger = {
          ...nextLedger,
          penaltyExpenses: roundCurrency(nextLedger.penaltyExpenses + penaltyAmount),
        };
      }
    }

    const previousSatisfaction = order.satisfaction;
    const newSatisfaction = clampSatisfaction(previousSatisfaction + delta);
    const terminated = newSatisfaction < CONTRACT_TERMINATION_THRESHOLD;

    settlementResults.push({
      orderId: order.id,
      clientName: order.clientName,
      sundayGameDay,
      previousSatisfaction,
      newSatisfaction,
      satisfactionDelta: newSatisfaction - previousSatisfaction,
      latePickups,
      undeliveredPackages,
      penaltyAmount,
      terminated,
    });

    if (terminated) {
      companySatisfaction = applyCompanySatisfactionDelta(companySatisfaction, -10);
      satisfactionTouched = true;
      newlyArchived.push({
        ...order,
        status: 'terminated',
        satisfaction: newSatisfaction,
        totalPenaltiesPaid: roundCurrency(order.totalPenaltiesPaid + penaltyAmount),
        concludedAtGameDay: sundayGameDay,
        concludedAtMinutes: sundayMinutes,
        terminationReason: 'Zadowolenie klienta spadło poniżej 20%',
        weekly: {
          ...order.weekly,
          lastSettledSundayGameDay: sundayGameDay,
        },
      });
      continue;
    }

    // Prepare tracking for the upcoming week starting Monday (sundayGameDay + 1)
    const nextWeekStartGameDay = sundayGameDay + 1;
    const nextSundayGameDay = nextWeekStartGameDay + (DAYS_PER_WEEK - 1);

    if (order.kind === 'long_term') {
      const nextStopsRes = buildDeliveryStops(
        rngState,
        `${order.id}-w${nextWeekStartGameDay}`,
        order.packagesPerWeek,
        order.pickupLocation.buildingId,
        deliveryBuildings
      );
      rngState = nextStopsRes.nextState;

      remainingActive.push({
        ...order,
        satisfaction: newSatisfaction,
        totalPenaltiesPaid: roundCurrency(order.totalPenaltiesPaid + penaltyAmount),
        currentWeekDeliveryStops: nextStopsRes.stops,
        weekly: {
          weekStartGameDay: nextWeekStartGameDay,
          expectedPackagesThisWeek: order.packagesPerWeek,
          pickedUpPackagesThisWeek: 0,
          deliveredPackagesThisWeek: 0,
          latePickupsThisWeek: 0,
          lastSettledSundayGameDay: sundayGameDay,
        },
      });
    } else {
      const remainingPackages = Math.max(0, order.totalPackages - order.deliveredPackagesTotal);
      const nextExpected =
        order.endGameDay <= nextSundayGameDay
          ? remainingPackages
          : Math.min(
            remainingPackages,
            Math.max(
              1,
              Math.ceil(
                (remainingPackages * DAYS_PER_WEEK) /
                Math.max(1, order.endGameDay - nextWeekStartGameDay + 1)
              )
            )
          );

      remainingActive.push({
        ...order,
        satisfaction: newSatisfaction,
        totalPenaltiesPaid: roundCurrency(order.totalPenaltiesPaid + penaltyAmount),
        weekly: {
          weekStartGameDay: nextWeekStartGameDay,
          expectedPackagesThisWeek: nextExpected,
          pickedUpPackagesThisWeek: 0,
          deliveredPackagesThisWeek: 0,
          latePickupsThisWeek: 0,
          lastSettledSundayGameDay: sundayGameDay,
        },
      });
    }
  }

  if (satisfactionTouched) {
    nextLedger = recordMonthlySatisfactionSample(nextLedger, companySatisfaction);
  }
  const reputationLevel = calculateReputationLevel(
    state.completedOrdersCount,
    companySatisfaction
  );
  const archivedIds = new Set(newlyArchived.map((o) => o.id));
  const cleanedWarehouse = removeOrderIdsFromWarehouseInventory(
    state.warehouseInventory,
    state.warehousePackages,
    archivedIds
  );

  return {
    ...state,
    balance: nextBalance,
    companySatisfaction,
    annualSatisfactionAvg: companySatisfaction,
    currentMonthLedger: nextLedger,
    reputationLevel,
    warehouseInventory: cleanedWarehouse.warehouseInventory,
    warehousePackages: cleanedWarehouse.warehousePackages,
    activeOrders: remainingActive,
    archivedOrders: [...newlyArchived, ...state.archivedOrders].slice(0, MAX_ARCHIVED_ORDERS),
    recentWeeklySettlements: [...settlementResults, ...state.recentWeeklySettlements].slice(0, 20),
    weeklyPriorityOrder: pruneInactiveOrderIdsFromWeeklyPriority(
      removeOrderIdsFromWeeklyPriority(state.weeklyPriorityOrder, archivedIds),
      remainingActive
    ),
    ...(useRandomRng ? { randomRngState: rngState } : { rngState }),
  };
}

/**
 * Executes the automatic 1st-of-month financial settlement (starting 1 Lipiec, Rok 1):
 * - Deducts Base upkeep for current warehouse level ($350/$440/$540/$680) + additional bike insurance
 *   (+$90/mies. for 2nd & 3rd bike) + any hired staff salaries/insurance
 * - Pays out accumulated long-term contract earnings from the previous month
 */
export function processMonthlySettlement(
  state: OrderEconomyState,
  settlementDate: GameCalendarDate
): OrderEconomyState {
  if (settlementDate.dayOfMonth !== 1 || settlementDate.monthKey === state.lastSettledMonthKey) {
    return state;
  }

  const prevMonthIndex = (settlementDate.monthIndex + 11) % 12;
  const prevMonthYear =
    settlementDate.monthIndex === 0 ? settlementDate.year - 1 : settlementDate.year;
  const prevMonthName = POLISH_MONTHS[prevMonthIndex].name;

  const monthlyCosts = calculateMonthlyCompanyCosts(state);
  const longTermContractPayout = roundCurrency(state.pendingMonthlyLongTermPayout);
  const settlementCashDelta = roundCurrency(longTermContractPayout - monthlyCosts.totalFixedCosts);
  const balanceAfter = roundCurrency(state.balance + settlementCashDelta);

  const companySat =
    typeof state.companySatisfaction === 'number' && Number.isFinite(state.companySatisfaction)
      ? state.companySatisfaction
      : INITIAL_COMPANY_SATISFACTION;
  const ledger = state.currentMonthLedger ?? createEmptyCurrentMonthLedger(companySat);
  const shortTermRevenue = roundCurrency(ledger.shortTermRevenue);
  const fuelExpenses = roundCurrency(ledger.fuelExpenses);
  const repairExpenses = roundCurrency(ledger.repairExpenses);
  const penaltyExpenses = roundCurrency(ledger.penaltyExpenses);
  const trainingExpenses = roundCurrency(ledger.trainingExpenses ?? 0);
  const totalRevenue = roundCurrency(shortTermRevenue + longTermContractPayout);
  const totalExpenses = roundCurrency(
    monthlyCosts.totalFixedCosts + fuelExpenses + repairExpenses + penaltyExpenses + trainingExpenses
  );
  const netChange = roundCurrency(totalRevenue - totalExpenses);
  const averageSatisfaction =
    ledger.satisfactionSamplesCount > 0
      ? Math.round((ledger.satisfactionSamplesSum / ledger.satisfactionSamplesCount) * 10) / 10
      : companySat;

  const record: MonthlySettlementRecord = {
    id: `settlement-${settlementDate.monthKey}`,
    year: settlementDate.year,
    monthIndex: settlementDate.monthIndex,
    monthName: settlementDate.monthName,
    settledPeriodLabel: `${prevMonthName} Rok ${prevMonthYear}`,
    baseUpkeepAndTaxCost: monthlyCosts.baseUpkeepAndTaxCost,
    salariesCost: monthlyCosts.salariesCost,
    courierInsuranceCost: monthlyCosts.courierInsuranceCost,
    scooterInsuranceCost: monthlyCosts.scooterInsuranceCost,
    vanInsuranceCost: monthlyCosts.vanInsuranceCost,
    insuranceCost: monthlyCosts.insuranceCost,
    totalFixedCosts: monthlyCosts.totalFixedCosts,
    longTermContractPayout,
    shortTermRevenue,
    fuelExpenses,
    repairExpenses,
    penaltyExpenses,
    totalRevenue,
    totalExpenses,
    completedOrdersCount: ledger.completedOrdersCount,
    averageSatisfaction,
    netChange,
    balanceAfter,
  };

  const resetActiveOrders = state.activeOrders.map((order) =>
    order.kind === 'long_term' ? { ...order, accruedMonthlyPayout: 0 } : order
  );

  return {
    ...state,
    balance: balanceAfter,
    pendingMonthlyLongTermPayout: 0,
    currentMonthLedger: createEmptyCurrentMonthLedger(companySat),
    activeOrders: resetActiveOrders,
    monthlySettlements: [record, ...state.monthlySettlements].slice(
      0,
      MAX_MONTHLY_SETTLEMENTS_HISTORY
    ),
    lastSettledMonthKey: settlementDate.monthKey,
  };
}

/**
 * Evaluates end-of-day long-term contract pickup & 3-day delivery-window deadlines
 * when rolling over into `date` (00:00).
 * - Missed/incomplete scheduled pickup on `prevGameDay` counts as a late pickup (`latePickupsThisWeek`).
 * - Picked-up batch still undelivered after its 3-day delivery deadline (`deliveryDeadlineGameDay`)
 *   before Sunday 23:59 records one overdue incident (`latePickupsThisWeek`) per batch.
 */
function evaluateDailyLongTermDeadlines(
  state: OrderEconomyState,
  date: GameCalendarDate
): OrderEconomyState {
  const prevGameDay = date.gameDay - 1;
  if (prevGameDay < 1 || state.activeOrders.length === 0) return state;

  const prevWeekdayIndex = (prevGameDay - 1) % DAYS_PER_WEEK;
  let changed = false;

  const nextActiveOrders = state.activeOrders.map((order) => {
    if (order.status !== 'active' || order.kind !== 'long_term') return order;

    let lateIncidentsToAdd = 0;
    let nextPenalizedBatchDay = order.weekly.penalizedDeliveryBatchGameDay;

    // 1. Scheduled pickup day rolled over with unpicked packages
    if (
      order.pickupWeekdays.includes(prevWeekdayIndex) &&
      prevGameDay >= order.acceptedAtGameDay &&
      prevGameDay < order.endGameDay
    ) {
      const acceptedAfterClosingSameDay =
        order.acceptedAtGameDay === prevGameDay && isNightHoursForTime(order.acceptedAtMinutes);
      if (!acceptedAfterClosingSameDay) {
        const dayQuota = getLongTermPickupDayQuota(order, prevWeekdayIndex);
        const pickedUpOnPrevDay =
          order.weekly.lastPickupGameDay === prevGameDay
            ? (order.weekly.pickedUpOnLastPickupDay ?? 0)
            : 0;
        const remainingWeeklyUnpicked = Math.max(
          0,
          order.weekly.expectedPackagesThisWeek - order.weekly.pickedUpPackagesThisWeek
        );
        if (dayQuota - pickedUpOnPrevDay > 0 && remainingWeeklyUnpicked > 0) {
          lateIncidentsToAdd += 1;
        }
      }
    }

    // 2. 3-day post-pickup delivery window elapsed (prior to Sunday 23:59 settlement) with undelivered packages
    if (prevWeekdayIndex !== SUNDAY_WEEKDAY_INDEX) {
      const storedInWarehouse = getStoredPackagesForOrder(state, order.id);
      const undeliveredInPossession = Math.max(
        storedInWarehouse,
        Math.max(0, (order.pickedUpPackagesTotal ?? 0) - order.deliveredPackagesTotal)
      );
      const lastPickupDay = order.weekly.lastPickupGameDay;
      if (
        undeliveredInPossession > 0 &&
        lastPickupDay !== undefined &&
        nextPenalizedBatchDay !== lastPickupDay
      ) {
        const deliveryDeadline = getLongTermDeliveryDeadlineGameDay(
          lastPickupDay,
          order.endGameDay
        );
        if (prevGameDay >= deliveryDeadline) {
          lateIncidentsToAdd += 1;
          nextPenalizedBatchDay = lastPickupDay;
        }
      }
    }

    if (lateIncidentsToAdd === 0) return order;
    changed = true;
    return {
      ...order,
      weekly: {
        ...order.weekly,
        latePickupsThisWeek: order.weekly.latePickupsThisWeek + lateIncidentsToAdd,
        ...(nextPenalizedBatchDay !== undefined
          ? { penalizedDeliveryBatchGameDay: nextPenalizedBatchDay }
          : {}),
      },
    };
  });

  return changed ? { ...state, activeOrders: nextActiveOrders } : state;
}

function concludeDueOrdersOnNewDay(
  state: OrderEconomyState,
  date: GameCalendarDate,
  dayStartMinutes: number
): OrderEconomyState {
  if (state.activeOrders.length === 0) return state;

  let balance = state.balance;
  let completedOrdersCount = state.completedOrdersCount;
  let companySatisfaction =
    typeof state.companySatisfaction === 'number' && Number.isFinite(state.companySatisfaction)
      ? state.companySatisfaction
      : INITIAL_COMPANY_SATISFACTION;
  let nextLedger =
    state.currentMonthLedger ?? createEmptyCurrentMonthLedger(companySatisfaction);

  const stillActive: ActiveOrder[] = [];
  const newlyArchived: ActiveOrder[] = [];

  for (const order of state.activeOrders) {
    if (order.status !== 'active' || date.gameDay < order.endGameDay) {
      stillActive.push(order);
      continue;
    }

    if (order.kind === 'long_term') {
      // Long-term contract reached its end date without termination -> completed!
      completedOrdersCount += 1;
      companySatisfaction = applyCompanySatisfactionDelta(companySatisfaction, 2.0);
      nextLedger = {
        ...nextLedger,
        completedOrdersCount: nextLedger.completedOrdersCount + 1,
      };
      newlyArchived.push({
        ...order,
        status: 'completed',
        concludedAtGameDay: date.gameDay,
        concludedAtMinutes: dayStartMinutes,
      });
    } else {
      // Short-term order passed its deadline without finishing all packages
      const remainingPackages = Math.max(0, order.totalPackages - order.deliveredPackagesTotal);
      const penalty = roundCurrency(
        remainingPackages * order.ratePerPackage * UNDELIVERED_PACKAGE_PENALTY_MULTIPLIER
      );
      balance = roundCurrency(balance - penalty);
      const finalSatisfaction = clampSatisfaction(
        order.satisfaction - (remainingPackages > 0 ? UNDELIVERED_WEEK_SATISFACTION_PENALTY : 0)
      );
      const isTerminated = finalSatisfaction < CONTRACT_TERMINATION_THRESHOLD;
      companySatisfaction = applyCompanySatisfactionDelta(
        companySatisfaction,
        isTerminated ? -10 : -7
      );
      nextLedger = {
        ...nextLedger,
        penaltyExpenses: roundCurrency(nextLedger.penaltyExpenses + penalty),
      };

      newlyArchived.push({
        ...order,
        status: isTerminated ? 'terminated' : 'expired',
        satisfaction: finalSatisfaction,
        totalPenaltiesPaid: roundCurrency(order.totalPenaltiesPaid + penalty),
        concludedAtGameDay: date.gameDay,
        concludedAtMinutes: dayStartMinutes,
        terminationReason:
          remainingPackages > 0
            ? `Nie dostarczono ${remainingPackages} paczek w terminie`
            : undefined,
      });
    }
  }

  if (newlyArchived.length === 0) return state;

  nextLedger = recordMonthlySatisfactionSample(nextLedger, companySatisfaction);
  const reputationLevel = calculateReputationLevel(completedOrdersCount, companySatisfaction);

  const archivedIds = new Set(newlyArchived.map((o) => o.id));
  const cleanedWarehouse = removeOrderIdsFromWarehouseInventory(
    state.warehouseInventory,
    state.warehousePackages,
    archivedIds
  );

  return {
    ...state,
    balance,
    completedOrdersCount,
    companySatisfaction,
    annualSatisfactionAvg: companySatisfaction,
    currentMonthLedger: nextLedger,
    reputationLevel,
    warehouseInventory: cleanedWarehouse.warehouseInventory,
    warehousePackages: cleanedWarehouse.warehousePackages,
    activeOrders: stillActive,
    archivedOrders: [...newlyArchived, ...state.archivedOrders].slice(0, MAX_ARCHIVED_ORDERS),
    weeklyPriorityOrder: pruneInactiveOrderIdsFromWeeklyPriority(
      removeOrderIdsFromWeeklyPriority(state.weeklyPriorityOrder, archivedIds),
      stillActive
    ),
  };
}

function processDailyOfferLifecycle(
  state: OrderEconomyState,
  date: GameCalendarDate,
  dayStartMinutes: number,
  buildings: readonly Building[]
): OrderEconomyState {
  // 1. Expire unused offers after 2 days (short-term) / 3 days (long-term)
  const validOffers = state.pendingOffers.filter((offer) => offer.expiresAtGameDay > date.gameDay);
  let nextState: OrderEconomyState =
    validOffers.length !== state.pendingOffers.length
      ? { ...state, pendingOffers: validOffers }
      : state;

  // 2. Hybrid offer inflow schedule:
  //    - Days 1–14: repeating 3-day cycle -> Day 1 (1,4,7,10,13): 1 offer, Day 2 (2,5,8,11,14): 1 offer, Day 3 (3,6,9,12): 0 offers
  //    - Day 15+: system-clock-seeded random generator, 2–4 new offers every 2 days (max 7 pending offers)
  const isEarlyPeriod = date.gameDay <= EARLY_OFFERS_DAY_LIMIT;

  if (isEarlyPeriod) {
    const cycleDayIndex = (date.gameDay - 1) % 3;
    if (cycleDayIndex !== 2 && date.gameDay > nextState.lastOfferGenerationGameDay) {
      nextState = generateOffersBatch(
        nextState,
        1,
        dayStartMinutes,
        buildings,
        false
      );
      nextState = {
        ...nextState,
        lastOfferGenerationGameDay: date.gameDay,
      };
    }
    return nextState;
  }

  if (date.gameDay - nextState.lastOfferGenerationGameDay >= LATE_OFFERS_INTERVAL_DAYS) {
    const countStep = rngInt(
      nextState.randomRngState,
      LATE_OFFERS_BATCH_MIN,
      LATE_OFFERS_BATCH_MAX
    );
    const desiredCount = countStep.value;
    nextState = { ...nextState, randomRngState: countStep.nextState };

    nextState = generateOffersBatch(
      nextState,
      desiredCount,
      dayStartMinutes,
      buildings,
      true
    );
    nextState = {
      ...nextState,
      lastOfferGenerationGameDay: date.gameDay,
    };
  }

  return nextState;
}

/**
 * Fast O(1) check whether advancing from `prevMinutes` to `nextMinutes`
 * crosses any economic trigger (a day boundary 00:00 or Sunday 23:59).
 */
export function hasEconomyBoundaryBetween(prevMinutes: number, nextMinutes: number): boolean {
  const prev = Math.floor(prevMinutes);
  const next = Math.floor(nextMinutes);
  if (next <= prev) return false;

  const prevElapsedDay = Math.floor(prev / MINUTES_PER_DAY);
  const nextElapsedDay = Math.floor(next / MINUTES_PER_DAY);
  if (nextElapsedDay > prevElapsedDay) return true;

  // Same day: check if we crossed Sunday 23:59
  if (prevElapsedDay % DAYS_PER_WEEK === SUNDAY_WEEKDAY_INDEX) {
    const sundayTrigger = prevElapsedDay * MINUTES_PER_DAY + SUNDAY_SETTLEMENT_MINUTE_OF_DAY;
    if (prev < sundayTrigger && next >= sundayTrigger) {
      return true;
    }
  }

  return false;
}

/**
 * Advances the entire economy simulation chronologically from `state.lastProcessedMinutes`
 * to `nextMinutes`, handling:
 * 1. Sunday 23:59 weekly satisfaction & penalty settlements
 * 2. Order deadlines & long-term contract completions
 * 3. Annual 1 Styczeń reset of `annualSatisfactionAvg` to 0%
 * 4. Automatic 1st-of-month settlement (-$440 fixed costs + long-term contract payouts)
 * 5. Offer expiration (4 days) and new offer generation (max 7 pending)
 */
export function advanceOrderEconomy(
  state: OrderEconomyState,
  nextMinutes: number,
  buildings: readonly Building[] = PROCEDURAL_BUILDINGS
): OrderEconomyState {
  const prevMinutes = Math.floor(state.lastProcessedMinutes);
  const targetMinutes = Math.floor(nextMinutes);

  if (!hasEconomyBoundaryBetween(prevMinutes, targetMinutes)) {
    return state;
  }

  const startElapsedDay = Math.floor(prevMinutes / MINUTES_PER_DAY);
  const endElapsedDay = Math.floor(targetMinutes / MINUTES_PER_DAY);

  let current = state;

  for (let elapsedDay = startElapsedDay; elapsedDay <= endElapsedDay; elapsedDay++) {
    // A. Process 00:00 daily rollover when entering any day strictly after startElapsedDay
    if (elapsedDay > startElapsedDay) {
      const dayStartMinutes = elapsedDay * MINUTES_PER_DAY;
      const date = getCalendarDateFromElapsedDays(elapsedDay);

      // 0. Evaluate missed scheduled pickups & elapsed 3-day delivery windows for long-term contracts
      current = evaluateDailyLongTermDeadlines(current, date);

      // 1. Conclude any orders whose endGameDay was reached & complete due Cat. B driving courses
      current = concludeDueOrdersOnNewDay(current, date, dayStartMinutes);
      current = completeDueCourierTrainings(current, date.gameDay);

      // 2. Every 1 Styczeń (new year): advance calendar stats year without resetting continuous companySatisfaction
      if (date.monthIndex === 0 && date.dayOfMonth === 1 && date.year > current.annualStatsYear) {
        current = {
          ...current,
          annualStatsYear: date.year,
        };
      }

      // 3. Every 1st of a new month (starting 1 Lipiec, Rok 1): deduct dynamic fixed costs + pay long-term contracts
      if (date.dayOfMonth === 1) {
        current = processMonthlySettlement(current, date);
      }

      // 4. Expire old offers (2 days short-term / 3 days long-term) and generate new offers on schedule
      current = processDailyOfferLifecycle(current, date, dayStartMinutes, buildings);

      // 5. Dynamic fuel market price update every 3–5 days with seasonal target pull & ±6–9% market wave
      const nextFuelDay =
        typeof current.nextFuelPriceChangeGameDay === 'number' &&
        Number.isFinite(current.nextFuelPriceChangeGameDay)
          ? current.nextFuelPriceChangeGameDay
          : INITIAL_NEXT_FUEL_PRICE_CHANGE_GAME_DAY;
      if (date.gameDay >= nextFuelDay) {
        const currentPrice =
          typeof current.currentFuelPricePerLiter === 'number' &&
          Number.isFinite(current.currentFuelPricePerLiter)
            ? current.currentFuelPricePerLiter
            : BASE_FUEL_PRICE_PER_LITER;
        const targetPrice = getSeasonalTargetFuelPrice(date.gameDay);
        const pulledPrice = currentPrice + (targetPrice - currentPrice) * 0.35;

        const signStep = nextRng(current.randomRngState);
        const magStep = nextRng(signStep.nextState);
        const intervalStep = rngInt(
          magStep.nextState,
          FUEL_PRICE_CHANGE_MIN_DAYS,
          FUEL_PRICE_CHANGE_MAX_DAYS
        );
        const waveSign = signStep.value < 0.5 ? -1 : 1;
        const waveMagnitude = 0.06 + magStep.value * 0.03; // 6%..9%
        const nextPrice = clampFuelPrice(roundCurrency(pulledPrice * (1 + waveSign * waveMagnitude)));

        current = {
          ...current,
          previousFuelPricePerLiter: currentPrice,
          currentFuelPricePerLiter: nextPrice,
          nextFuelPriceChangeGameDay: date.gameDay + intervalStep.value,
          randomRngState: intervalStep.nextState,
        };
      }
    }

    // B. Process Sunday 23:59 weekly satisfaction settlement if crossed on this day
    if (elapsedDay % DAYS_PER_WEEK === SUNDAY_WEEKDAY_INDEX) {
      const sundayTriggerMinutes = elapsedDay * MINUTES_PER_DAY + SUNDAY_SETTLEMENT_MINUTE_OF_DAY;
      if (prevMinutes < sundayTriggerMinutes && targetMinutes >= sundayTriggerMinutes) {
        const sundayDate = getCalendarDateFromElapsedDays(elapsedDay);
        current = settleWeeklySatisfaction(
          current,
          sundayDate.gameDay,
          sundayTriggerMinutes,
          buildings
        );
      }
    }
  }

  return {
    ...current,
    lastProcessedMinutes: targetMinutes,
  };
}

/**
 * Computes the ordered list of merged scheduled order tasks (1 tile per order per weekday)
 * for a given weekday (0 = Pon .. 6 = Nd) in the rolling 7-day window starting from `currentGameDay`
 * (`Dziś` .. `Dziś + 6`), or for an explicit `targetGameDayOverride`,
 * respecting the player's saved `weeklyPriorityOrder`.
 */
export function getScheduledTasksForWeekday(
  state: OrderEconomyState,
  weekdayIndex: number,
  currentGameDay: number,
  targetGameDayOverride?: number
): WeeklyScheduleTask[] {
  const currentDate = getCalendarDateFromGameDay(currentGameDay);
  const weekMondayGameDay = currentGameDay - currentDate.dayIndex;
  const dayOffset =
    (((weekdayIndex - currentDate.dayIndex) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const targetGameDay = targetGameDayOverride ?? currentGameDay + dayOffset;
  const isToday = targetGameDay === currentGameDay;

  const unsorted: Array<{
    taskId: string;
    taskType: WeeklyTaskType;
    order?: ActiveOrder;
    taskLabel: string;
    packageCount: number;
    pickedUpCount: number;
    deliveredCount: number;
    totalPackages: number;
    sortTimestamp: number;
    sortTieBreaker: number;
    repairVehicle?: WeeklyScheduleTask['repairVehicle'];
    repairDurability?: number;
    repairWaitingForCourier?: boolean;
    repairWaitingReason?: 'no_courier' | 'no_van_license';
    isExpiringOnDay?: boolean;
    isDeliveryWindowDeadline?: boolean;
  }> = [];

  for (const order of state.activeOrders) {
    if (order.status !== 'active') continue;
    const storedInWarehouse = getStoredPackagesForOrder(state, order.id);
    // Packages already picked up from sender and not yet delivered (in Base warehouse or on courier vehicle)
    const undeliveredInPossession = Math.max(
      storedInWarehouse,
      Math.max(0, (order.pickedUpPackagesTotal ?? 0) - order.deliveredPackagesTotal)
    );

    if (order.kind === 'long_term') {
      const withinContract =
        targetGameDay >= order.acceptedAtGameDay && targetGameDay < order.endGameDay;
      if (!withinContract) continue;

      const contractLastActiveDay = Math.max(order.acceptedAtGameDay, order.endGameDay - 1);
      const isContractOrWeekFinalDay =
        targetGameDay === contractLastActiveDay || weekdayIndex === SUNDAY_WEEKDAY_INDEX;

      // Resolve the 3-day delivery window deadline for any already picked-up packages awaiting delivery
      let deliveryDeadlineGameDay: number | null = null;
      if (undeliveredInPossession > 0) {
        let effectivePickupGameDay = order.weekly.lastPickupGameDay;
        if (
          effectivePickupGameDay === undefined ||
          effectivePickupGameDay > currentGameDay ||
          effectivePickupGameDay < weekMondayGameDay
        ) {
          const priorPickups = order.pickupWeekdays.filter((wd) => wd <= currentDate.dayIndex);
          effectivePickupGameDay =
            priorPickups.length > 0
              ? weekMondayGameDay + priorPickups[priorPickups.length - 1]
              : currentGameDay;
        }
        deliveryDeadlineGameDay = getLongTermDeliveryDeadlineGameDay(
          effectivePickupGameDay,
          order.endGameDay
        );
      }

      if (order.pickupWeekdays.includes(weekdayIndex)) {
        const dayQuota = getLongTermPickupDayQuota(order, weekdayIndex);

        if (isToday) {
          const remainingPickupToday = getRemainingPickupPackagesForOrderToday(
            state,
            order,
            weekdayIndex,
            currentGameDay
          );
          const remainingDeliveryToday = undeliveredInPossession + remainingPickupToday;
          if (remainingDeliveryToday > 0) {
            const pickedUpToday =
              order.weekly.lastPickupGameDay === currentGameDay
                ? (order.weekly.pickedUpOnLastPickupDay ?? 0)
                : 0;
            const totalPackages = Math.max(
              dayQuota,
              pickedUpToday + remainingPickupToday,
              remainingDeliveryToday
            );
            const pickedUpCount = Math.max(
              0,
              Math.min(totalPackages, totalPackages - remainingPickupToday)
            );
            const deliveredCount = Math.max(
              0,
              Math.min(pickedUpCount, totalPackages - remainingDeliveryToday)
            );
            const isBatchDeliveryDeadline =
              deliveryDeadlineGameDay !== null && targetGameDay >= deliveryDeadlineGameDay;
            unsorted.push({
              taskId: makeWeeklyTaskId(order.id),
              taskType: 'order',
              order,
              taskLabel: 'Realizacja',
              packageCount: remainingDeliveryToday,
              pickedUpCount,
              deliveredCount,
              totalPackages,
              sortTimestamp: order.acceptedAtMinutes,
              sortTieBreaker: order.orderNumber,
              isExpiringOnDay:
                (isContractOrWeekFinalDay || isBatchDeliveryDeadline) &&
                deliveredCount < totalPackages,
              isDeliveryWindowDeadline: isBatchDeliveryDeadline && deliveredCount < totalPackages,
            });
          }
        } else if (dayQuota > 0) {
          if (targetGameDay > currentGameDay) {
            const isBatchDeliveryDeadline =
              deliveryDeadlineGameDay !== null && targetGameDay === deliveryDeadlineGameDay;
            unsorted.push({
              taskId: makeWeeklyTaskId(order.id),
              taskType: 'order',
              order,
              taskLabel: 'Realizacja',
              packageCount: dayQuota,
              pickedUpCount: 0,
              deliveredCount: 0,
              totalPackages: dayQuota,
              sortTimestamp: order.acceptedAtMinutes,
              sortTieBreaker: order.orderNumber,
              isExpiringOnDay: isContractOrWeekFinalDay || isBatchDeliveryDeadline,
              isDeliveryWindowDeadline: isBatchDeliveryDeadline,
            });
          } else {
            const pickedUpCount = Math.min(dayQuota, order.weekly.pickedUpPackagesThisWeek);
            const deliveredCount = Math.min(pickedUpCount, order.weekly.deliveredPackagesThisWeek);
            if (deliveredCount < dayQuota) {
              unsorted.push({
                taskId: makeWeeklyTaskId(order.id),
                taskType: 'order',
                order,
                taskLabel: 'Realizacja',
                packageCount: Math.max(0, dayQuota - deliveredCount),
                pickedUpCount,
                deliveredCount,
                totalPackages: dayQuota,
                sortTimestamp: order.acceptedAtMinutes,
                sortTieBreaker: order.orderNumber,
                isExpiringOnDay: isContractOrWeekFinalDay,
              });
            }
          }
        }
      } else if (undeliveredInPossession > 0 && deliveryDeadlineGameDay !== null) {
        // Carryover warehouse delivery tile automatically spans subsequent days up to deliveryDeadlineGameDay
        // (and remains visible on `isToday` if overdue so couriers still clear stored packages)
        const withinDeliveryWindow =
          targetGameDay >= currentGameDay && targetGameDay <= deliveryDeadlineGameDay;
        const isOverdueToday = isToday && currentGameDay > deliveryDeadlineGameDay;
        if (withinDeliveryWindow || isOverdueToday) {
          const batchPicked = Math.max(
            undeliveredInPossession,
            order.pickupDaysPerWeek === 1
              ? order.weekly.pickedUpPackagesThisWeek
              : (order.weekly.pickedUpOnLastPickupDay ?? undeliveredInPossession)
          );
          const totalPackages = batchPicked;
          const pickedUpCount = batchPicked;
          const deliveredCount = Math.max(0, totalPackages - undeliveredInPossession);
          const isBatchDeliveryDeadline = targetGameDay >= deliveryDeadlineGameDay;
          unsorted.push({
            taskId: makeWeeklyTaskId(order.id),
            taskType: 'order',
            order,
            taskLabel: 'Realizacja',
            packageCount: undeliveredInPossession,
            pickedUpCount,
            deliveredCount,
            totalPackages,
            sortTimestamp: order.acceptedAtMinutes,
            sortTieBreaker: order.orderNumber,
            isExpiringOnDay: isBatchDeliveryDeadline || isContractOrWeekFinalDay,
            isDeliveryWindowDeadline: isBatchDeliveryDeadline,
          });
        }
      }
    } else {
      const lastActiveDay = Math.max(order.acceptedAtGameDay, order.endGameDay - 1);
      if (targetGameDay >= order.acceptedAtGameDay && targetGameDay <= lastActiveDay) {
        const totalPackages = Math.max(0, order.totalPackages);
        const deliveredCount = Math.min(totalPackages, Math.max(0, order.deliveredPackagesTotal));
        const remainingToDeliver = Math.max(0, totalPackages - deliveredCount);
        const pickedUpCount = Math.min(
          totalPackages,
          Math.max(order.pickedUpPackagesTotal ?? 0, deliveredCount + storedInWarehouse)
        );

        if (totalPackages > 0 && remainingToDeliver > 0) {
          unsorted.push({
            taskId: makeWeeklyTaskId(order.id),
            taskType: 'order',
            order,
            taskLabel: 'Realizacja',
            packageCount: remainingToDeliver,
            pickedUpCount,
            deliveredCount,
            totalPackages,
            sortTimestamp: order.acceptedAtMinutes,
            sortTieBreaker: order.orderNumber,
            isExpiringOnDay: targetGameDay === lastActiveDay,
          });
        }
      }
    }
  }

  // Vehicle repair tasks appear ONLY on the current day (isToday) and automatically carry over
  // to the next day until completed at the Mechanic Garage.
  if (isToday) {
    const pendingRepairs = getPendingVehicleRepairs(state);
    pendingRepairs.forEach((repair, repairIdx) => {
      const durability = Math.round(getVehicleDurability(state, repair.vehicle));
      const readiness = getRepairCourierReadiness(state, repair.vehicle);
      const vehicleName =
        repair.vehicle.type === 'van'
          ? `Bus #${repair.vehicle.index}`
          : `Rower #${repair.vehicle.index}`;

      unsorted.push({
        taskId: repair.id,
        taskType: 'repair',
        taskLabel: 'Serwis',
        packageCount: 0,
        pickedUpCount: 0,
        deliveredCount: 0,
        totalPackages: 0,
        sortTimestamp: repair.requestedAtGameDay * MINUTES_PER_DAY + repairIdx,
        sortTieBreaker: repairIdx,
        repairVehicle: { ...repair.vehicle },
        repairDurability: durability,
        repairWaitingForCourier: !readiness.ready,
        repairWaitingReason: readiness.reason,
      });
      void vehicleName;
    });
  }

  const savedOrder = state.weeklyPriorityOrder[weekdayIndex] ?? [];
  const rankLookup = new Map<string, number>();
  savedOrder.forEach((id, idx) => {
    const normalizedId = extractOrderIdFromTaskKey(id);
    if (!rankLookup.has(id)) {
      rankLookup.set(id, idx);
    }
    if (!rankLookup.has(normalizedId)) {
      rankLookup.set(normalizedId, idx);
    }
  });

  const getRank = (item: { taskId: string; order?: ActiveOrder }): number => {
    const exact = rankLookup.get(item.taskId);
    if (exact !== undefined) return exact;
    if (item.order) {
      const byOrder = rankLookup.get(item.order.id);
      if (byOrder !== undefined) return byOrder;
    }
    return Number.MAX_SAFE_INTEGER;
  };

  unsorted.sort((a, b) => {
    const rankA = getRank(a);
    const rankB = getRank(b);
    if (rankA !== rankB) return rankA - rankB;
    if (a.sortTimestamp !== b.sortTimestamp) {
      return a.sortTimestamp - b.sortTimestamp;
    }
    return a.sortTieBreaker - b.sortTieBreaker;
  });

  return unsorted.map((item, idx) => {
    if (item.taskType === 'repair' && item.repairVehicle) {
      const vehicleName =
        item.repairVehicle.type === 'van'
          ? `Bus #${item.repairVehicle.index}`
          : `Rower #${item.repairVehicle.index}`;
      return {
        taskId: item.taskId,
        taskType: 'repair',
        orderId: item.taskId,
        orderNumber: 0,
        weekdayIndex,
        kind: 'short_term',
        clientName: `Naprawa: ${vehicleName}`,
        pickupAddress: 'ul. Lipowa (Mechanik)',
        taskLabel: 'Serwis',
        packageCount: 0,
        pickedUpCount: 0,
        deliveredCount: 0,
        totalPackages: 0,
        satisfaction: 100,
        priorityRank: idx + 1,
        repairVehicle: item.repairVehicle,
        repairDurability: item.repairDurability,
        repairWaitingForCourier: item.repairWaitingForCourier,
        repairWaitingReason: item.repairWaitingReason,
      };
    }

    const order = item.order!;
    return {
      taskId: item.taskId,
      taskType: item.taskType,
      orderId: order.id,
      orderNumber: order.orderNumber,
      weekdayIndex,
      kind: order.kind,
      clientName: order.clientName,
      pickupAddress: order.pickupLocation.address,
      taskLabel: item.taskLabel,
      packageCount: item.packageCount,
      pickedUpCount: item.pickedUpCount,
      deliveredCount: item.deliveredCount,
      totalPackages: item.totalPackages,
      satisfaction: order.satisfaction,
      priorityRank: idx + 1,
      isExpiringOnDay: Boolean(item.isExpiringOnDay),
      isDeliveryWindowDeadline: Boolean(item.isDeliveryWindowDeadline),
    };
  });
}

/**
 * Moves a merged order task up or down in priority within a specific weekday (0 = Pon .. 6 = Nd)
 * and persists the updated sequence in `state.weeklyPriorityOrder` for courier dispatch.
 */
export function moveWeeklyTaskPriority(
  state: OrderEconomyState,
  weekdayIndex: number,
  taskId: string,
  direction: 'up' | 'down',
  currentGameDay: number
): OrderEconomyState {
  const visibleTasks = getScheduledTasksForWeekday(state, weekdayIndex, currentGameDay);
  const normalizedTarget = extractOrderIdFromTaskKey(taskId);
  const currentIdx = visibleTasks.findIndex(
    (t) => t.taskId === taskId || t.orderId === normalizedTarget
  );
  if (currentIdx === -1) return state;

  const swapIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
  if (swapIdx < 0 || swapIdx >= visibleTasks.length) return state;

  const reorderedVisibleIds = visibleTasks.map((t) => t.taskId);
  const tmp = reorderedVisibleIds[currentIdx];
  reorderedVisibleIds[currentIdx] = reorderedVisibleIds[swapIdx];
  reorderedVisibleIds[swapIdx] = tmp;

  const visibleSet = new Set(reorderedVisibleIds);
  const trailingHiddenIds: string[] = [];
  const seenHidden = new Set<string>();
  for (const rawId of state.weeklyPriorityOrder[weekdayIndex] ?? []) {
    const cleanId = extractOrderIdFromTaskKey(rawId);
    if (!visibleSet.has(cleanId) && !seenHidden.has(cleanId)) {
      seenHidden.add(cleanId);
      trailingHiddenIds.push(cleanId);
    }
  }

  return {
    ...state,
    weeklyPriorityOrder: {
      ...state.weeklyPriorityOrder,
      [weekdayIndex]: [...reorderedVisibleIds, ...trailingHiddenIds],
    },
  };
}

/**
 * Performs a one-shot sort of scheduled tasks for a given weekday (0 = Pon .. 6 = Nd)
 * and persists the resulting order into `state.weeklyPriorityOrder[weekdayIndex]`.
 * Vehicle repair tasks are kept pinned at the top of the list so they are never buried,
 * and the player can freely adjust individual rows afterwards with ▲ / ▼ buttons.
 */
export function sortWeeklyTasksPriority(
  state: OrderEconomyState,
  weekdayIndex: number,
  sortMode: WeeklyTaskSortMode,
  currentGameDay: number
): OrderEconomyState {
  const visibleTasks = getScheduledTasksForWeekday(state, weekdayIndex, currentGameDay);
  if (visibleTasks.length <= 1) return state;

  const repairTasks: WeeklyScheduleTask[] = [];
  const indexedOrderTasks: Array<{ task: WeeklyScheduleTask; index: number }> = [];

  visibleTasks.forEach((task, index) => {
    if (task.taskType === 'repair') {
      repairTasks.push(task);
    } else {
      indexedOrderTasks.push({ task, index });
    }
  });

  indexedOrderTasks.sort((a, b) => {
    switch (sortMode) {
      case 'short_term_first': {
        const ka = a.task.kind === 'short_term' ? 0 : 1;
        const kb = b.task.kind === 'short_term' ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return a.index - b.index;
      }
      case 'long_term_first': {
        const ka = a.task.kind === 'long_term' ? 0 : 1;
        const kb = b.task.kind === 'long_term' ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return a.index - b.index;
      }
      case 'packages_desc': {
        if (b.task.packageCount !== a.task.packageCount) {
          return b.task.packageCount - a.task.packageCount;
        }
        if (b.task.totalPackages !== a.task.totalPackages) {
          return b.task.totalPackages - a.task.totalPackages;
        }
        return a.index - b.index;
      }
      case 'packages_asc': {
        if (a.task.packageCount !== b.task.packageCount) {
          return a.task.packageCount - b.task.packageCount;
        }
        if (a.task.totalPackages !== b.task.totalPackages) {
          return a.task.totalPackages - b.task.totalPackages;
        }
        return a.index - b.index;
      }
    }
  });

  const reorderedVisibleIds = [
    ...repairTasks.map((t) => t.taskId),
    ...indexedOrderTasks.map((entry) => entry.task.taskId),
  ];

  const visibleSet = new Set(reorderedVisibleIds);
  const trailingHiddenIds: string[] = [];
  const seenHidden = new Set<string>();
  for (const rawId of state.weeklyPriorityOrder[weekdayIndex] ?? []) {
    const cleanId = extractOrderIdFromTaskKey(rawId);
    if (!visibleSet.has(cleanId) && !seenHidden.has(cleanId)) {
      seenHidden.add(cleanId);
      trailingHiddenIds.push(cleanId);
    }
  }

  return {
    ...state,
    weeklyPriorityOrder: {
      ...state.weeklyPriorityOrder,
      [weekdayIndex]: [...reorderedVisibleIds, ...trailingHiddenIds],
    },
  };
}

/**
 * Returns how many packages still remain to be picked up from the sender today for an active order.
 * - Short-term orders: remaining packages not yet delivered and not already stored in Base warehouse.
 * - Long-term contracts: remaining portion of today's scheduled pickup quota (capped by weekly quota).
 */
export function getRemainingPickupPackagesForOrderToday(
  state: OrderEconomyState,
  order: ActiveOrder,
  weekdayIndex: number,
  currentGameDay: number
): number {
  if (order.status !== 'active') return 0;

  if (order.kind === 'short_term') {
    const lastActiveDay = Math.max(order.acceptedAtGameDay, order.endGameDay - 1);
    if (currentGameDay < order.acceptedAtGameDay || currentGameDay > lastActiveDay) {
      return 0;
    }
    const storedInWarehouse = getStoredPackagesForOrder(state, order.id);
    const pickedUpTotal = Math.min(
      order.totalPackages,
      Math.max(
        order.pickedUpPackagesTotal ?? 0,
        order.deliveredPackagesTotal + storedInWarehouse
      )
    );
    return Math.max(0, order.totalPackages - pickedUpTotal);
  }

  if (
    !order.pickupWeekdays.includes(weekdayIndex) ||
    currentGameDay < order.acceptedAtGameDay ||
    currentGameDay >= order.endGameDay
  ) {
    return 0;
  }

  const idxInPickups = order.pickupWeekdays.indexOf(weekdayIndex);
  const basePerDay = Math.floor(order.packagesPerWeek / order.pickupDaysPerWeek);
  const remainder = order.packagesPerWeek % order.pickupDaysPerWeek;
  const todayQuota = basePerDay + (idxInPickups < remainder ? 1 : 0);

  const pickedUpToday =
    order.weekly.lastPickupGameDay === currentGameDay
      ? (order.weekly.pickedUpOnLastPickupDay ?? 0)
      : 0;
  const remainingToday = Math.max(0, todayQuota - pickedUpToday);
  const remainingWeekly = Math.max(
    0,
    order.weekly.expectedPackagesThisWeek - order.weekly.pickedUpPackagesThisWeek
  );

  return Math.min(remainingToday, remainingWeekly);
}

export interface CourierPickupSelection {
  order: ActiveOrder;
  pickupCount: number;
}

/**
 * Selects the highest-priority scheduled pickup task for the current day according to
 * the player's `Plan tygodnia` order (`▲` / `▼`), respecting `BIKE_COURIER_CAPACITY` (5)
 * and remaining Base warehouse free capacity.
 */
export function selectNextPickupTaskForCourier(
  state: OrderEconomyState,
  currentMinutes: number
): CourierPickupSelection | null {
  const freeWarehouseSpace = getFreeWarehouseCapacity(state);
  if (freeWarehouseSpace <= 0) return null;

  const clock = getGameClockDisplay(currentMinutes);
  const scheduledTasks = getScheduledTasksForWeekday(state, clock.dayIndex, clock.gameDay);
  if (scheduledTasks.length === 0) return null;

  const activeById = new Map(state.activeOrders.map((o) => [o.id, o]));

  for (const task of scheduledTasks) {
    if (task.taskType === 'delivery') continue;
    const order = activeById.get(task.orderId);
    if (!order || order.status !== 'active') continue;

    const remainingToPickup = getRemainingPickupPackagesForOrderToday(
      state,
      order,
      clock.dayIndex,
      clock.gameDay
    );
    if (remainingToPickup <= 0) continue;
    if (!hasEnoughWarehouseSpaceForPickup(state, remainingToPickup)) continue;

    const pickupCount = Math.min(BIKE_COURIER_CAPACITY, remainingToPickup, freeWarehouseSpace);
    if (pickupCount > 0) {
      return { order, pickupCount };
    }
  }

  return null;
}
