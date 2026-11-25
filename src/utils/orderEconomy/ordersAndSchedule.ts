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
  getFreeWarehouseCapacity,
  getPendingVehicleRepairs,
  getRepairCourierReadiness,
  getStoredPackagesForOrder,
  getVehicleDurability,
  hasEnoughWarehouseSpaceForPickup,
} from './companyAndFleet';
import {
  BIKE_COURIER_CAPACITY,
  CONTRACT_TERMINATION_THRESHOLD,
  EARLY_OFFERS_BATCH_SIZE,
  EARLY_OFFERS_DAY_LIMIT,
  EARLY_OFFERS_INTERVAL_DAYS,
  INITIAL_ORDER_SATISFACTION,
  LATE_OFFERS_BATCH_MAX,
  LATE_OFFERS_BATCH_MIN,
  LATE_OFFERS_INTERVAL_DAYS,
  LATE_PICKUP_SATISFACTION_PENALTY,
  SUNDAY_SETTLEMENT_MINUTE_OF_DAY,
  SUNDAY_WEEKDAY_INDEX,
  UNDELIVERED_PACKAGE_PENALTY_MULTIPLIER,
  UNDELIVERED_WEEK_SATISFACTION_PENALTY,
  WEEKLY_ON_TIME_SATISFACTION_BONUS,
  calculateReputationLevel,
  clampSatisfaction,
  computeAnnualSatisfactionAvg,
  recordOrderSatisfactionSample,
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

function extractOrderIdFromTaskKey(taskKey: string): string {
  const sepIdx = taskKey.lastIndexOf(':');
  if (sepIdx === -1) return taskKey;
  const suffix = taskKey.slice(sepIdx + 1);
  if (suffix === 'pickup' || suffix === 'delivery') {
    return taskKey.slice(0, sepIdx);
  }
  return taskKey;
}

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
      const satisfactionStats = recordOrderSatisfactionSample(state, completedOrder.satisfaction);
      const nextReputationLevel = calculateReputationLevel(
        nextCompletedCount,
        satisfactionStats.annualSatisfactionAvg
      );

      return {
        ...state,
        balance: roundCurrency(state.balance + order.totalExpectedPayout),
        completedOrdersCount: nextCompletedCount,
        ...satisfactionStats,
        reputationLevel: nextReputationLevel,
        activeOrders: nextActive,
        archivedOrders: [completedOrder, ...state.archivedOrders],
        weeklyPriorityOrder: removeOrderIdsFromWeeklyPriority(
          state.weeklyPriorityOrder,
          new Set([completedOrder.id])
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

  return {
    ...state,
    pendingMonthlyLongTermPayout: roundCurrency(state.pendingMonthlyLongTermPayout + earnedNow),
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
  let annualSatisfactionSum = state.annualSatisfactionSum;
  let annualSatisfactionCount = state.annualSatisfactionCount;
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
    } else {
      if (latePickups > 0) {
        delta -= latePickups * LATE_PICKUP_SATISFACTION_PENALTY;
      }
      if (undeliveredPackages > 0) {
        delta -= UNDELIVERED_WEEK_SATISFACTION_PENALTY;
        penaltyAmount = roundCurrency(
          undeliveredPackages * order.ratePerPackage * UNDELIVERED_PACKAGE_PENALTY_MULTIPLIER
        );
        nextBalance = roundCurrency(nextBalance - penaltyAmount);
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
      annualSatisfactionSum += newSatisfaction;
      annualSatisfactionCount += 1;
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

  const annualSatisfactionAvg = computeAnnualSatisfactionAvg(
    annualSatisfactionSum,
    annualSatisfactionCount
  );
  const reputationLevel = calculateReputationLevel(
    state.completedOrdersCount,
    annualSatisfactionAvg
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
    annualSatisfactionSum,
    annualSatisfactionCount,
    annualSatisfactionAvg,
    reputationLevel,
    warehouseInventory: cleanedWarehouse.warehouseInventory,
    warehousePackages: cleanedWarehouse.warehousePackages,
    activeOrders: remainingActive,
    archivedOrders: [...newlyArchived, ...state.archivedOrders],
    recentWeeklySettlements: [...settlementResults, ...state.recentWeeklySettlements].slice(0, 20),
    weeklyPriorityOrder: removeOrderIdsFromWeeklyPriority(state.weeklyPriorityOrder, archivedIds),
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
  const netChange = roundCurrency(longTermContractPayout - monthlyCosts.totalFixedCosts);
  const balanceAfter = roundCurrency(state.balance + netChange);

  const record: MonthlySettlementRecord = {
    id: `settlement-${settlementDate.monthKey}`,
    year: settlementDate.year,
    monthIndex: settlementDate.monthIndex,
    monthName: settlementDate.monthName,
    settledPeriodLabel: `${prevMonthName} Rok ${prevMonthYear}`,
    baseUpkeepAndTaxCost: monthlyCosts.baseUpkeepAndTaxCost,
    salariesCost: monthlyCosts.salariesCost,
    courierInsuranceCost: monthlyCosts.courierInsuranceCost,
    vanInsuranceCost: monthlyCosts.vanInsuranceCost,
    insuranceCost: monthlyCosts.insuranceCost,
    totalFixedCosts: monthlyCosts.totalFixedCosts,
    longTermContractPayout,
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
    activeOrders: resetActiveOrders,
    monthlySettlements: [record, ...state.monthlySettlements],
    lastSettledMonthKey: settlementDate.monthKey,
  };
}

function concludeDueOrdersOnNewDay(
  state: OrderEconomyState,
  date: GameCalendarDate,
  dayStartMinutes: number
): OrderEconomyState {
  if (state.activeOrders.length === 0) return state;

  let balance = state.balance;
  let completedOrdersCount = state.completedOrdersCount;
  let annualSatisfactionSum = state.annualSatisfactionSum;
  let annualSatisfactionCount = state.annualSatisfactionCount;

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
      annualSatisfactionSum += order.satisfaction;
      annualSatisfactionCount += 1;
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
      annualSatisfactionSum += finalSatisfaction;
      annualSatisfactionCount += 1;

      newlyArchived.push({
        ...order,
        status: finalSatisfaction < CONTRACT_TERMINATION_THRESHOLD ? 'terminated' : 'expired',
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

  const annualSatisfactionAvg = computeAnnualSatisfactionAvg(
    annualSatisfactionSum,
    annualSatisfactionCount
  );
  const reputationLevel = calculateReputationLevel(completedOrdersCount, annualSatisfactionAvg);

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
    annualSatisfactionSum,
    annualSatisfactionCount,
    annualSatisfactionAvg,
    reputationLevel,
    warehouseInventory: cleanedWarehouse.warehouseInventory,
    warehousePackages: cleanedWarehouse.warehousePackages,
    activeOrders: stillActive,
    archivedOrders: [...newlyArchived, ...state.archivedOrders],
    weeklyPriorityOrder: removeOrderIdsFromWeeklyPriority(state.weeklyPriorityOrder, archivedIds),
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
  //    - Days 1–14: deterministic fixed-seed generator, 2 new offers every 3 days
  //    - Day 15+: system-clock-seeded random generator, 2–4 new offers every 2 days (max 7 pending offers)
  const isEarlyPeriod = date.gameDay <= EARLY_OFFERS_DAY_LIMIT;
  const useRandomRng = !isEarlyPeriod;
  const intervalDays = isEarlyPeriod ? EARLY_OFFERS_INTERVAL_DAYS : LATE_OFFERS_INTERVAL_DAYS;

  if (date.gameDay - nextState.lastOfferGenerationGameDay >= intervalDays) {
    let desiredCount = EARLY_OFFERS_BATCH_SIZE;

    if (useRandomRng) {
      const countStep = rngInt(
        nextState.randomRngState,
        LATE_OFFERS_BATCH_MIN,
        LATE_OFFERS_BATCH_MAX
      );
      desiredCount = countStep.value;
      nextState = { ...nextState, randomRngState: countStep.nextState };
    }

    nextState = generateOffersBatch(
      nextState,
      desiredCount,
      dayStartMinutes,
      buildings,
      useRandomRng
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

      // 1. Conclude any orders whose endGameDay was reached
      current = concludeDueOrdersOnNewDay(current, date, dayStartMinutes);

      // 2. Every 1 Styczeń (new year): reset annual satisfaction stats to 0%
      if (date.monthIndex === 0 && date.dayOfMonth === 1 && date.year > current.annualStatsYear) {
        const nextReputationLevel = calculateReputationLevel(current.completedOrdersCount, 0);
        current = {
          ...current,
          annualSatisfactionSum: 0,
          annualSatisfactionCount: 0,
          annualSatisfactionAvg: 0,
          annualStatsYear: date.year,
          reputationLevel: nextReputationLevel,
        };
      }

      // 3. Every 1st of a new month (starting 1 Lipiec, Rok 1): deduct dynamic fixed costs + pay long-term contracts
      if (date.dayOfMonth === 1) {
        current = processMonthlySettlement(current, date);
      }

      // 4. Expire old offers (2 days short-term / 3 days long-term) and generate new offers on schedule
      current = processDailyOfferLifecycle(current, date, dayStartMinutes, buildings);
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
 * for a given weekday (0 = Pon .. 6 = Nd) within the current calendar week,
 * respecting the player's saved `weeklyPriorityOrder`.
 */
export function getScheduledTasksForWeekday(
  state: OrderEconomyState,
  weekdayIndex: number,
  currentGameDay: number
): WeeklyScheduleTask[] {
  const currentDate = getCalendarDateFromGameDay(currentGameDay);
  const weekMondayGameDay = currentGameDay - currentDate.dayIndex;
  const targetGameDay = weekMondayGameDay + weekdayIndex;
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

      if (order.pickupWeekdays.includes(weekdayIndex)) {
        const idxInPickups = order.pickupWeekdays.indexOf(weekdayIndex);
        const basePerDay = Math.floor(order.packagesPerWeek / order.pickupDaysPerWeek);
        const remainder = order.packagesPerWeek % order.pickupDaysPerWeek;
        const dayQuota = basePerDay + (idxInPickups < remainder ? 1 : 0);

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
            });
          }
        } else if (dayQuota > 0) {
          if (targetGameDay > currentGameDay) {
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
              });
            }
          }
        }
      } else if (isToday && undeliveredInPossession > 0) {
        // Carryover packages from an earlier pickup still awaiting delivery today
        const totalPackages = Math.max(
          order.weekly.expectedPackagesThisWeek,
          undeliveredInPossession
        );
        const pickedUpCount = Math.min(
          totalPackages,
          Math.max(undeliveredInPossession, order.weekly.pickedUpPackagesThisWeek)
        );
        const deliveredCount = Math.max(0, pickedUpCount - undeliveredInPossession);
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
        });
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
