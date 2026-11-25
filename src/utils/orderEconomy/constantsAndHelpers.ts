import type {
  ActiveOrder,
  OrderEconomyState,
  OwnedVan,
  ReputationLevel,
  ReputationTierConfig,
  VanCondition,
  VanModelId,
  VanModelSpec,
  VanTier,
  WarehouseTier,
  WarehouseTierConfig,
} from '../../types/orders';
import {
  DAYS_PER_WEEK,
  MINUTES_PER_DAY,
  WORKDAY_START_MINUTES,
  getCalendarDateFromGameDay,
  getGameClockDisplay,
} from '../gameClock';

// ============================================================================
// Economy, Reputation & Order Constants
// ============================================================================

/** Monthly fixed cost: base upkeep & tax for Base Lv. 1 (includes starter bicycle) */
export const BASE_UPKEEP_AND_TAX_COST = 350;
/** Monthly fixed cost: bicycle insurance ($50 / mies. per additional bike beyond the 1st starter bike) */
export const COURIER_INSURANCE_COST = 50;
/** Monthly fixed cost: used delivery van insurance ($130 / mies. per owned van) */
export const USED_VAN_INSURANCE_COST = 130;
/** Monthly fixed cost: delivery van driver & vehicle insurance ($180 / mies. per van driver) */
export const VAN_DRIVER_INSURANCE_COST = 180;

/** Monthly salaries per employee qualification profile */
export const OWNER_COURIER_SALARY = 0;
export const HIRED_BIKE_COURIER_SALARY = 1600;
export const HIRED_VAN_DRIVER_SALARY = 2300;

/** Starter monthly fixed company costs at game start (Base Lv.1 + starter bicycle = $350/mies.) */
export const MONTHLY_FIXED_COSTS = BASE_UPKEEP_AND_TAX_COST; // $350

// ============================================================================
// Bike & Van Fleet Limits, Courier Capacity, Base Warehouse & Upgrade Paths
// ============================================================================

/** Maximum packages a bicycle courier can carry in a single pickup or delivery run */
export const BIKE_COURIER_CAPACITY = 5;
/** Maximum packages a used delivery van (20-package class) can carry in a single run */
export const VAN_COURIER_CAPACITY = 20;

/** Bicycle fleet configuration (includes owner's starter bike; up to 2 extra bikes at $450 each) */
export const INITIAL_BICYCLES = 1;
export const MAX_BICYCLES = 3;
export const MAX_ADDITIONAL_BICYCLES = MAX_BICYCLES - INITIAL_BICYCLES; // 2
export const BICYCLE_PURCHASE_COST = 450;

/** Delivery van fleet configuration (limit = unlocked parkingSpots, max 8) */
export const INITIAL_VANS = 0;
export const MAX_VANS = 8;
export const DEFAULT_LEGACY_VAN_MODEL_ID: VanModelId = 'used_standard';
export const USED_VAN_PURCHASE_COST = 7500;

/** Full catalog of 6 delivery van models (3 Used + 3 New tiers) */
export const VAN_MODELS: Readonly<Record<VanModelId, VanModelSpec>> = {
  used_lite: {
    id: 'used_lite',
    condition: 'used',
    tier: 'lite',
    name: 'Bus Używany — Lite',
    capacity: 10,
    purchasePrice: 5500,
    monthlyInsurance: 110,
    fuelConsumptionRate: 1.35,
  },
  used_standard: {
    id: 'used_standard',
    condition: 'used',
    tier: 'standard',
    name: 'Bus Używany — Standard',
    capacity: 12,
    purchasePrice: 7500,
    monthlyInsurance: 130,
    fuelConsumptionRate: 1.45,
  },
  used_pro: {
    id: 'used_pro',
    condition: 'used',
    tier: 'pro',
    name: 'Bus Używany — Pro',
    capacity: 15,
    purchasePrice: 9800,
    monthlyInsurance: 155,
    fuelConsumptionRate: 1.55,
  },
  new_lite: {
    id: 'new_lite',
    condition: 'new',
    tier: 'lite',
    name: 'Bus Nowy — Lite',
    capacity: 14,
    purchasePrice: 12500,
    monthlyInsurance: 90,
    fuelConsumptionRate: 0.9,
  },
  new_standard: {
    id: 'new_standard',
    condition: 'new',
    tier: 'standard',
    name: 'Bus Nowy — Standard',
    capacity: 17,
    purchasePrice: 16000,
    monthlyInsurance: 105,
    fuelConsumptionRate: 1.0,
  },
  new_pro: {
    id: 'new_pro',
    condition: 'new',
    tier: 'pro',
    name: 'Bus Nowy — Pro',
    capacity: 20,
    purchasePrice: 20500,
    monthlyInsurance: 120,
    fuelConsumptionRate: 1.1,
  },
} as const;

export const VAN_MODEL_IDS_BY_CONDITION: Readonly<Record<VanCondition, readonly VanModelId[]>> = {
  used: ['used_lite', 'used_standard', 'used_pro'],
  new: ['new_lite', 'new_standard', 'new_pro'],
} as const;

export const VAN_TIERS_ORDER: readonly VanTier[] = ['lite', 'standard', 'pro'] as const;

export function isValidVanModelId(value: unknown): value is VanModelId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VAN_MODELS, value);
}

export function getVanModelSpec(modelId: VanModelId): VanModelSpec {
  return VAN_MODELS[modelId] ?? VAN_MODELS[DEFAULT_LEGACY_VAN_MODEL_ID];
}

export function createOwnedVan(index: number, modelId: VanModelId = DEFAULT_LEGACY_VAN_MODEL_ID): OwnedVan {
  const spec = getVanModelSpec(modelId);
  const safeIndex = Math.max(1, Math.floor(index));
  return {
    id: `van-${safeIndex}`,
    index: safeIndex,
    modelId: spec.id,
    condition: spec.condition,
    tier: spec.tier,
  };
}

export function createDefaultOwnedVans(
  count: number,
  modelId: VanModelId = DEFAULT_LEGACY_VAN_MODEL_ID
): OwnedVan[] {
  const safeCount = Math.max(0, Math.min(MAX_VANS, Math.floor(count)));
  return Array.from({ length: safeCount }, (_, idx) => createOwnedVan(idx + 1, modelId));
}

/** Path 1: Base warehouse expansion levels (1–4) — scales Base capacity, monthly upkeep & depot building size */
export const WAREHOUSE_TIERS: readonly WarehouseTierConfig[] = [
  {
    tier: 1,
    name: 'Mały garaż (Poz. 1)',
    capacity: 30,
    upgradeCost: 0,
    monthlyUpkeepCost: 350,
  },
  {
    tier: 2,
    name: 'Rozbudowany magazyn (Poz. 2)',
    capacity: 70,
    upgradeCost: 3000,
    monthlyUpkeepCost: 440,
  },
  {
    tier: 3,
    name: 'Centrum przeładunkowe (Poz. 3)',
    capacity: 140,
    upgradeCost: 7000,
    monthlyUpkeepCost: 540,
  },
  {
    tier: 4,
    name: 'Duża baza logistyczna (Poz. 4)',
    capacity: 250,
    upgradeCost: 13500,
    monthlyUpkeepCost: 680,
  },
] as const;

export const INITIAL_WAREHOUSE_TIER: WarehouseTier = 1;
export const MAX_WAREHOUSE_TIER: WarehouseTier = 4;

/** Path 2: Individual van/car parking spots directly at Base (starts at 0, spots 1–8 bought sequentially) */
export const INITIAL_PARKING_SPOTS = 0;
export const MAX_PARKING_SPOTS = 8;
export const PARKING_SPOT_COST = 3500;

/** Path 3: Individual employee licenses/slots (starts at 1 free, slots 2–6 bought sequentially) */
export const INITIAL_MAX_EMPLOYEES = 1;
export const MAX_EMPLOYEES = 6;
export const EMPLOYEE_LICENSE_COSTS: Readonly<Record<number, number>> = {
  2: 1800,
  3: 3200,
  4: 5000,
  5: 7500,
  6: 10500,
};

/** Offer inflow schedule constants */
export const INITIAL_OFFERS_COUNT = 2;
export const EARLY_OFFERS_DAY_LIMIT = 14;
export const EARLY_OFFERS_INTERVAL_DAYS = 3;
export const EARLY_OFFERS_BATCH_SIZE = 2;
export const LATE_OFFERS_INTERVAL_DAYS = 2;
export const LATE_OFFERS_BATCH_MIN = 2;
export const LATE_OFFERS_BATCH_MAX = 4;
export const MAX_PENDING_OFFERS = 7;
export const SHORT_TERM_OFFER_EXPIRY_DAYS = 2;
export const LONG_TERM_OFFER_EXPIRY_DAYS = 3;
export const OFFER_EXPIRY_DAYS = SHORT_TERM_OFFER_EXPIRY_DAYS;

/** Individual active contract satisfaction rules */
export const INITIAL_ORDER_SATISFACTION = 80;
export const MIN_ORDER_SATISFACTION = 0;
export const MAX_ORDER_SATISFACTION = 100;
export const WEEKLY_ON_TIME_SATISFACTION_BONUS = 4;
export const LATE_PICKUP_SATISFACTION_PENALTY = 12;
export const UNDELIVERED_WEEK_SATISFACTION_PENALTY = 18;
export const UNDELIVERED_PACKAGE_PENALTY_MULTIPLIER = 2;
export const CONTRACT_TERMINATION_THRESHOLD = 20;

/** Sunday 23:59 minute-of-day trigger for weekly contract satisfaction evaluation */
export const SUNDAY_WEEKDAY_INDEX = 6;
export const SUNDAY_SETTLEMENT_MINUTE_OF_DAY = 23 * 60 + 59; // 1439

export const REPUTATION_TIERS: readonly ReputationTierConfig[] = [
  {
    level: 1,
    name: 'Początkujący',
    minCompletedOrders: 0,
    maxCompletedOrders: 14,
    minAnnualSatisfaction: null,
    ratePerPackageMin: 5.5,
    ratePerPackageMax: 8.0,
    maxShortTermDays: 7,
    allowedLongTermMonths: [],
  },
  {
    level: 2,
    name: 'Lokalny kurier',
    minCompletedOrders: 15,
    maxCompletedOrders: 39,
    minAnnualSatisfaction: 72,
    ratePerPackageMin: 7.0,
    ratePerPackageMax: 10.5,
    maxShortTermDays: 14,
    allowedLongTermMonths: [3],
  },
  {
    level: 3,
    name: 'Solidny partner',
    minCompletedOrders: 40,
    maxCompletedOrders: 84,
    minAnnualSatisfaction: 82,
    ratePerPackageMin: 9.0,
    ratePerPackageMax: 13.5,
    maxShortTermDays: 14,
    allowedLongTermMonths: [3, 6],
  },
  {
    level: 4,
    name: 'Lider dzielnicy',
    minCompletedOrders: 85,
    maxCompletedOrders: null,
    minAnnualSatisfaction: 90,
    ratePerPackageMin: 11.5,
    ratePerPackageMax: 17.0,
    maxShortTermDays: 14,
    allowedLongTermMonths: [3, 6, 12],
  },
] as const;

// ============================================================================
// Pure Utility & Deterministic RNG Helpers
// ============================================================================

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampSatisfaction(value: number): number {
  return Math.max(MIN_ORDER_SATISFACTION, Math.min(MAX_ORDER_SATISFACTION, Math.round(value)));
}

/** Pure Mulberry32 step returning next deterministic uint32 state and float in [0, 1) */
export function nextRng(state: number): { value: number; nextState: number } {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState };
}

/** Generates a non-zero 32-bit seed from the system clock (Date.now()) for Day 15+ random offer generation */
export function createClockRandomSeed(): number {
  const now = Date.now();
  let h = (now ^ Math.floor(now / 0x100000000) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h === 0 ? 0x6d2b79f5 : h;
}

export function rngInt(
  state: number,
  min: number,
  max: number
): { value: number; nextState: number } {
  const step = nextRng(state);
  const span = Math.max(1, max - min + 1);
  return {
    value: min + Math.floor(step.value * span),
    nextState: step.nextState,
  };
}

export function rngPick<T>(
  state: number,
  items: readonly T[]
): { value: T; nextState: number } {
  const step = rngInt(state, 0, items.length - 1);
  return {
    value: items[step.value],
    nextState: step.nextState,
  };
}

export function rngRate(
  state: number,
  minRate: number,
  maxRate: number
): { value: number; nextState: number } {
  // Generate realistic rates in $0.25 increments within [minRate, maxRate]
  const minSteps = Math.round(minRate * 4);
  const maxSteps = Math.round(maxRate * 4);
  const step = rngInt(state, minSteps, maxSteps);
  return {
    value: roundCurrency(step.value / 4),
    nextState: step.nextState,
  };
}

export function createEmptyWeeklyPriorityOrder(): Record<number, string[]> {
  return {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };
}

// ============================================================================
// Reputation Progression Helpers
// ============================================================================

export function getReputationTierConfig(level: ReputationLevel): ReputationTierConfig {
  return REPUTATION_TIERS[level - 1];
}

/**
 * Evaluates company reputation tier (1–4) from total completed orders
 * and current-year average company satisfaction.
 */
export function calculateReputationLevel(
  completedOrdersCount: number,
  annualSatisfactionAvg: number
): ReputationLevel {
  for (let i = REPUTATION_TIERS.length - 1; i >= 0; i--) {
    const tier = REPUTATION_TIERS[i];
    const meetsOrders = completedOrdersCount >= tier.minCompletedOrders;
    const meetsSatisfaction =
      tier.minAnnualSatisfaction === null || annualSatisfactionAvg >= tier.minAnnualSatisfaction;
    if (meetsOrders && meetsSatisfaction) {
      return tier.level;
    }
  }
  return 1;
}

export function computeAnnualSatisfactionAvg(sum: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round((sum / count) * 10) / 10;
}

export function recordOrderSatisfactionSample(
  state: OrderEconomyState,
  finalSatisfaction: number
): Pick<
  OrderEconomyState,
  'annualSatisfactionSum' | 'annualSatisfactionCount' | 'annualSatisfactionAvg'
> {
  const annualSatisfactionSum = state.annualSatisfactionSum + clampSatisfaction(finalSatisfaction);
  const annualSatisfactionCount = state.annualSatisfactionCount + 1;
  const annualSatisfactionAvg = computeAnnualSatisfactionAvg(
    annualSatisfactionSum,
    annualSatisfactionCount
  );
  return {
    annualSatisfactionSum,
    annualSatisfactionCount,
    annualSatisfactionAvg,
  };
}

// ============================================================================
// Currency, Season & Workday Calendar Helpers
// ============================================================================

/**
 * Formats USD amount with 2 decimal places and non-breaking space thousands separators (e.g. "$5.50", "$1 080.00").
 */
export function formatCurrencyUsd(amount: number, includeDecimals = true): string {
  const isNegative = amount < 0;
  const abs = Math.abs(amount);
  const fixed = includeDecimals ? abs.toFixed(2) : String(Math.round(abs));
  const [intPart, decPart] = fixed.split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${isNegative ? '-' : ''}$${groupedInt}${decPart !== undefined ? `.${decPart}` : ''}`;
}

export type GameSeason = 'Wiosna' | 'Lato' | 'Jesień' | 'Zima';

export interface SeasonalWorkdayHours {
  season: GameSeason;
  /** Workday start in minutes from midnight (always 08:00 = 480) */
  startMinutes: number;
  /** Workday end in minutes from midnight (Lato 20:00, Wiosna/Jesień 19:30, Zima 19:00) */
  endMinutes: number;
  startText: string;
  endText: string;
}

/**
 * Returns courier workday hours for a 0-based calendar month index (0 = Styczeń .. 11 = Grudzień):
 * - Lato (Czerwiec, Lipiec, Sierpień): 08:00 – 20:00
 * - Jesień (Wrzesień, Październik, Listopad): 08:00 – 19:30
 * - Zima (Grudzień, Styczeń, Luty): 08:00 – 19:00
 * - Wiosna (Marzec, Kwiecień, Maj): 08:00 – 19:30
 */
export function getSeasonalWorkdayHours(monthIndex: number): SeasonalWorkdayHours {
  const normalized = ((Math.floor(monthIndex) % 12) + 12) % 12;

  // Lato: Czerwiec (5), Lipiec (6), Sierpień (7)
  if (normalized === 5 || normalized === 6 || normalized === 7) {
    return {
      season: 'Lato',
      startMinutes: WORKDAY_START_MINUTES,
      endMinutes: 20 * 60,
      startText: '08:00',
      endText: '20:00',
    };
  }

  // Jesień: Wrzesień (8), Październik (9), Listopad (10)
  if (normalized === 8 || normalized === 9 || normalized === 10) {
    return {
      season: 'Jesień',
      startMinutes: WORKDAY_START_MINUTES,
      endMinutes: 19 * 60 + 30,
      startText: '08:00',
      endText: '19:30',
    };
  }

  // Zima: Grudzień (11), Styczeń (0), Luty (1)
  if (normalized === 11 || normalized === 0 || normalized === 1) {
    return {
      season: 'Zima',
      startMinutes: WORKDAY_START_MINUTES,
      endMinutes: 19 * 60,
      startText: '08:00',
      endText: '19:00',
    };
  }

  // Wiosna: Marzec (2), Kwiecień (3), Maj (4)
  return {
    season: 'Wiosna',
    startMinutes: WORKDAY_START_MINUTES,
    endMinutes: 19 * 60 + 30,
    startText: '08:00',
    endText: '19:30',
  };
}

/**
 * Checks whether the given total elapsed game minutes fall outside seasonal workday hours
 * (i.e. at/after seasonal closing time through 07:59 the following morning).
 */
export function isNightHoursForTime(totalMinutes: number): boolean {
  const clock = getGameClockDisplay(totalMinutes);
  const minuteInDay = clock.hours * 60 + clock.minutes;
  const workday = getSeasonalWorkdayHours(clock.monthIndex);
  return minuteInDay >= workday.endMinutes || minuteInDay < workday.startMinutes;
}

/**
 * Returns the exact timestamp (in total game minutes) for 08:00 of the next calendar day.
 */
export function getNextDayMorningMinutes(currentMinutes: number): number {
  const currentElapsedDay = Math.floor(Math.max(0, currentMinutes) / MINUTES_PER_DAY);
  return (currentElapsedDay + 1) * MINUTES_PER_DAY + WORKDAY_START_MINUTES;
}

/**
 * Checks whether an active order has a scheduled pickup or delivery task on a given 1-based game day.
 */
function hasOrderScheduledOnGameDay(order: ActiveOrder, targetGameDay: number): boolean {
  if (order.status !== 'active') return false;
  const weekdayIndex = (targetGameDay - 1) % DAYS_PER_WEEK;

  if (order.kind === 'long_term') {
    return (
      order.pickupWeekdays.includes(weekdayIndex) &&
      targetGameDay >= order.acceptedAtGameDay &&
      targetGameDay < order.endGameDay
    );
  }

  const lastActiveDay = Math.max(order.acceptedAtGameDay, order.endGameDay - 1);
  return (
    order.deliveredPackagesTotal < order.totalPackages &&
    targetGameDay >= order.acceptedAtGameDay &&
    targetGameDay <= lastActiveDay
  );
}

/**
 * Finds the earliest future calendar day (at 08:00) strictly after the current day
 * on which at least one active order is scheduled in the weekly plan.
 * Returns null if there are no upcoming scheduled active orders.
 */
export function findNextScheduledOrderDayMinutes(
  state: OrderEconomyState,
  currentMinutes: number
): number | null {
  if (state.activeOrders.length === 0) return null;

  const currentElapsedDay = Math.floor(Math.max(0, currentMinutes) / MINUTES_PER_DAY);
  const currentGameDay = currentElapsedDay + 1;

  // If active orders already have packages waiting in Base warehouse, tomorrow 08:00 has immediate delivery work
  const hasWaitingWarehouseWork =
    state.warehousePackages > 0 &&
    state.activeOrders.some(
      (o) => o.status === 'active' && (state.warehouseInventory[o.id] ?? 0) > 0
    );
  if (hasWaitingWarehouseWork) {
    return (currentElapsedDay + 1) * MINUTES_PER_DAY + WORKDAY_START_MINUTES;
  }

  // Search up to 365 days ahead (covers all 12-month contracts & weekly schedules)
  const maxEndGameDay = state.activeOrders.reduce(
    (maxDay, order) => Math.max(maxDay, order.endGameDay),
    currentGameDay
  );
  const searchLimitDay = Math.min(maxEndGameDay, currentGameDay + 365);

  for (
    let candidateGameDay = currentGameDay + 1;
    candidateGameDay <= searchLimitDay;
    candidateGameDay++
  ) {
    for (let i = 0; i < state.activeOrders.length; i++) {
      if (hasOrderScheduledOnGameDay(state.activeOrders[i], candidateGameDay)) {
        return (candidateGameDay - 1) * MINUTES_PER_DAY + WORKDAY_START_MINUTES;
      }
    }
  }

  return null;
}

/**
 * Convenience helper to look up the calendar date for a given 1-based game day (e.g. offer expiry).
 */
export function formatOrderGameDay(gameDay: number): string {
  const date = getCalendarDateFromGameDay(gameDay);
  return `${date.dayOfMonth} ${date.monthName} | Rok ${date.year}`;
}
