import type {
  ActiveOrder,
  CurrentMonthLedger,
  OrderEconomyState,
  OwnedScooter,
  OwnedVan,
  ReputationLevel,
  ReputationTierConfig,
  ScooterModelId,
  ScooterModelSpec,
  VanCondition,
  VanModelId,
  VanModelSpec,
  VanTier,
  WarehouseTier,
  WarehouseTierConfig,
} from '../../types/orders';
import {
  DAYS_PER_WEEK,
  DAYS_PER_YEAR,
  MINUTES_PER_DAY,
  POLISH_MONTHS,
  WORKDAY_START_MINUTES,
  getCalendarDateFromGameDay,
  getGameClockDisplay,
} from '../gameClock';

// ============================================================================
// Economy, Reputation & Order Constants
// ============================================================================

/** Monthly fixed cost: base upkeep & tax for Base Lv. 1 */
export const BASE_UPKEEP_AND_TAX_COST = 350;
/** Monthly fixed cost: bicycle insurance ($30 / mies. per owned bike, including the 1st owner bike) */
export const COURIER_INSURANCE_COST = 30;
/** Monthly fixed cost: used delivery van insurance ($130 / mies. per owned van) */
export const USED_VAN_INSURANCE_COST = 130;
/** Monthly fixed cost: delivery van driver & vehicle insurance ($180 / mies. per van driver) */
export const VAN_DRIVER_INSURANCE_COST = 180;

/** Monthly salaries per employee qualification profile */
export const OWNER_COURIER_SALARY = 0;
export const HIRED_BIKE_COURIER_SALARY = 1600;
export const HIRED_VAN_DRIVER_SALARY = 2300;

/** One-time Category B driving course cost and duration in gameplay days */
export const CAT_B_COURSE_COST = 350;
export const CAT_B_COURSE_DURATION_DAYS = 2;

/** QuickBox parcel locker network constants */
export const QUICKBOX_LICENSE_COST = 15000;
export const QUICKBOX_BUILD_COST = 1500;
export const QUICKBOX_MAX_SLOTS = 8;
/** QuickBox lockers finish construction and open at 10:00 (600 minutes into the day) */
export const QUICKBOX_READY_MINUTE_OF_DAY = 10 * 60;

/**
 * Computes the completion day and minute (10:00) for a QuickBox ordered on `orderedAtGameDay`,
 * requiring 1 full business day (Mon–Fri):
 * - Mon–Thu (0..3) -> next day (Tue–Fri) at 10:00 (+1 day)
 * - Fri (4) -> Monday at 10:00 (+3 days)
 * - Sat (5) -> Monday is construction workday -> ready Tuesday at 10:00 (+3 days)
 * - Sun (6) -> Monday is construction workday -> ready Tuesday at 10:00 (+2 days)
 */
export function calculateQuickBoxReadyTime(orderedAtGameDay: number): {
  readyAtGameDay: number;
  readyAtMinutes: number;
} {
  const safeDay = Math.max(1, Math.floor(orderedAtGameDay));
  const weekdayIndex = (safeDay - 1) % DAYS_PER_WEEK; // 0=Mon..4=Fri, 5=Sat, 6=Sun
  let daysToAdd = 1;
  if (weekdayIndex === 4) {
    daysToAdd = 3; // Fri -> Mon
  } else if (weekdayIndex === 5) {
    daysToAdd = 3; // Sat -> Tue (Mon is construction workday)
  } else if (weekdayIndex === 6) {
    daysToAdd = 2; // Sun -> Tue (Mon is construction workday)
  }
  const readyAtGameDay = safeDay + daysToAdd;
  const readyAtMinutes = (readyAtGameDay - 1) * MINUTES_PER_DAY + QUICKBOX_READY_MINUTE_OF_DAY;
  return { readyAtGameDay, readyAtMinutes };
}

/** Starter monthly fixed company costs at game start (Base Lv.1 $350 + 1st bike insurance $30 = $380/mies.) */
export const MONTHLY_FIXED_COSTS = BASE_UPKEEP_AND_TAX_COST + COURIER_INSURANCE_COST; // $380

// ============================================================================
// Bike & Van Fleet Limits, Courier Capacity, Base Warehouse & Upgrade Paths
// ============================================================================

/** Maximum packages a bicycle courier can carry in a single pickup or delivery run */
export const BIKE_COURIER_CAPACITY = 4;
/** Maximum packages a used delivery van (20-package class) can carry in a single run */
export const VAN_COURIER_CAPACITY = 20;

/** Shared Base shelter capacity for all two-wheelers (bicycles + scooters combined) */
export const MAX_TWO_WHEELERS = 4;
/** Two-wheeler fleet configuration (includes owner's starter bike; shared cap MAX_TWO_WHEELERS = 4) */
export const INITIAL_BICYCLES = 1;
export const MAX_BICYCLES = MAX_TWO_WHEELERS;
export const MAX_ADDITIONAL_BICYCLES = MAX_TWO_WHEELERS - INITIAL_BICYCLES; // 3
export const BICYCLE_PURCHASE_COST = 450;
export const INITIAL_SCOOTERS = 0;
export const DEFAULT_LEGACY_SCOOTER_MODEL_ID: ScooterModelId = 'scooter_city';
/** Resale refund rate when selling any owned vehicle from Base fleet (30% of catalog purchase price) */
export const VEHICLE_RESALE_RATE = 0.3;

/** Delivery van fleet configuration (limit = unlocked parkingSpots, max 8) */
export const INITIAL_VANS = 0;
export const MAX_VANS = 8;
export const DEFAULT_LEGACY_VAN_MODEL_ID: VanModelId = 'used_standard';
export const USED_VAN_PURCHASE_COST = 7500;

/** Vehicle mechanical durability & wear tuning constants */
export const DEFAULT_VEHICLE_DURABILITY = 100;
export const MIN_VEHICLE_DURABILITY = 0;
export const MAX_VEHICLE_DURABILITY = 100;
/** Repair button becomes available once vehicle durability drops strictly below 80% */
export const REPAIR_AVAILABLE_DURABILITY_THRESHOLD = 80;
/** At or below 25% durability (<= 25%), vehicle cruising speed is reduced by 20% until repaired */
export const LOW_DURABILITY_SPEED_THRESHOLD = 25;
export const LOW_DURABILITY_SPEED_MULTIPLIER = 0.8;
/**
 * Durability wear (% lost per 1 world pixel driven while actively moving on route).
 * Calibrated for BASE_GAME_MINUTES_PER_REAL_SECOND = 1.25 (1 game hour = 48 sim seconds)
 * and 10 active driving hours/day to drop from 100% to 25% (-75%):
 * - Bike (~96 px/s avg -> ~4,600 px/h): ~0.25%/h -> 300h (30 days)
 * - City Scooter (152 px/s cruise -> ~6,200 px/h): ~0.167%/h -> 450h (~45 days)
 * - Cargo Scooter (168 px/s cruise -> ~6,850 px/h): ~0.136%/h -> 550h (~55 days)
 * - Used Van (~166 px/s avg -> ~8,000 px/h): ~0.10%/h -> 750h (~75 days / 2.5 months)
 * - New Van (~166 px/s avg -> ~8,000 px/h): ~0.05%/h -> 1,500h (~150 days / 5 months)
 */
export const BIKE_WEAR_PER_WORLD_PX = 0.00005;
export const SCOOTER_CITY_WEAR_PER_WORLD_PX = 0.000027;
export const SCOOTER_CARGO_WEAR_PER_WORLD_PX = 0.00002;
export const USED_VAN_WEAR_PER_WORLD_PX = 0.0000125;
export const NEW_VAN_WEAR_PER_WORLD_PX = 0.00000625;
/** Repair pricing multipliers: bike -50% (0.5x), city scooter 0.6x (~$65 at 50% wear), cargo scooter 0.65x (~$95 at 50% wear), vans 0.75x */
export const BIKE_REPAIR_COST_MULTIPLIER = 0.5;
export const SCOOTER_CITY_REPAIR_COST_MULTIPLIER = 0.6;
export const SCOOTER_CARGO_REPAIR_COST_MULTIPLIER = 0.65;
export const VAN_REPAIR_COST_MULTIPLIER = 0.75;
/** Mechanic garage service durations in in-game minutes */
export const BIKE_REPAIR_GAME_MINUTES = 30;
export const SCOOTER_CITY_REPAIR_GAME_MINUTES = 40;
export const SCOOTER_CARGO_REPAIR_GAME_MINUTES = 45;
export const VAN_REPAIR_GAME_MINUTES = 60;
/** Initial continuous company satisfaction percentage (0–100) */
export const INITIAL_COMPANY_SATISFACTION = 80;
/** Maximum number of closed monthly settlement records retained in history */
export const MAX_MONTHLY_SETTLEMENTS_HISTORY = 12;

export function createEmptyCurrentMonthLedger(
  initialSatisfaction: number = INITIAL_COMPANY_SATISFACTION
): CurrentMonthLedger {
  const safeSat = Math.max(0, Math.min(100, Number.isFinite(initialSatisfaction) ? initialSatisfaction : INITIAL_COMPANY_SATISFACTION));
  return {
    shortTermRevenue: 0,
    longTermAccruedRevenue: 0,
    fuelExpenses: 0,
    repairExpenses: 0,
    penaltyExpenses: 0,
    completedOrdersCount: 0,
    failedOrdersCount: 0,
    satisfactionSamplesSum: safeSat,
    satisfactionSamplesCount: 1,
  };
}

/**
 * Applies a satisfaction delta to the continuous `companySatisfaction` (0–100).
 * Above 90%, positive gains experience diminishing returns (`delta * 0.45`) so maintaining
 * 95–100% requires consistently strong performance.
 */
export function applyCompanySatisfactionDelta(
  currentSatisfaction: number,
  rawDelta: number
): number {
  const base = Number.isFinite(currentSatisfaction)
    ? Math.max(0, Math.min(100, currentSatisfaction))
    : INITIAL_COMPANY_SATISFACTION;
  if (!Number.isFinite(rawDelta) || rawDelta === 0) return Math.round(base * 10) / 10;
  const effectiveDelta = rawDelta > 0 && base >= 90 ? rawDelta * 0.45 : rawDelta;
  const next = Math.max(0, Math.min(100, base + effectiveDelta));
  return Math.round(next * 10) / 10;
}

export function recordMonthlySatisfactionSample(
  ledger: CurrentMonthLedger | undefined,
  satisfaction: number
): CurrentMonthLedger {
  const base = ledger ?? createEmptyCurrentMonthLedger(satisfaction);
  const safeSat = Math.max(0, Math.min(100, Number.isFinite(satisfaction) ? satisfaction : INITIAL_COMPANY_SATISFACTION));
  return {
    ...base,
    satisfactionSamplesSum: Math.round((base.satisfactionSamplesSum + safeSat) * 10) / 10,
    satisfactionSamplesCount: base.satisfactionSamplesCount + 1,
  };
}

/**
 * Computes monthly satisfaction from a ledger if samples exist, falling back to `fallbackSatisfaction`.
 */
export function getMonthlySatisfactionFromLedger(
  ledger: CurrentMonthLedger | undefined,
  fallbackSatisfaction: number
): number {
  if (ledger && ledger.satisfactionSamplesCount > 0) {
    return Math.round((ledger.satisfactionSamplesSum / ledger.satisfactionSamplesCount) * 10) / 10;
  }
  const safeFallback = Number.isFinite(fallbackSatisfaction)
    ? Math.max(0, Math.min(100, fallbackSatisfaction))
    : INITIAL_COMPANY_SATISFACTION;
  return Math.round(safeFallback * 10) / 10;
}

/**
 * Returns the company's current monthly client satisfaction (0–100):
 * - Average of samples recorded in the current calendar month (`currentMonthLedger`) if any exist;
 * - Otherwise the last settled month's average satisfaction (`monthlySettlements[0]?.averageSatisfaction`),
 *   or `companySatisfaction` (default 80%) so a brand-new month never drops artificially to 0%.
 */
export function getMonthlySatisfaction(
  state: Pick<OrderEconomyState, 'currentMonthLedger' | 'monthlySettlements' | 'companySatisfaction'>
): number {
  const ledger = state.currentMonthLedger;
  if (ledger && ledger.satisfactionSamplesCount > 0) {
    return Math.round((ledger.satisfactionSamplesSum / ledger.satisfactionSamplesCount) * 10) / 10;
  }
  const lastSettledAvg = state.monthlySettlements?.[0]?.averageSatisfaction;
  if (typeof lastSettledAvg === 'number' && Number.isFinite(lastSettledAvg)) {
    return Math.round(Math.max(0, Math.min(100, lastSettledAvg)) * 10) / 10;
  }
  const liveSat = state.companySatisfaction;
  if (typeof liveSat === 'number' && Number.isFinite(liveSat)) {
    return Math.round(Math.max(0, Math.min(100, liveSat)) * 10) / 10;
  }
  return INITIAL_COMPANY_SATISFACTION;
}

/** Number of in-game days (including pickup day) to deliver picked-up packages for long-term contracts (capped at Sunday 23:59) */
export const LONG_TERM_DELIVERY_WINDOW_DAYS = 3;

/** Fuel market & consumption constants */
export const BASE_FUEL_PRICE_PER_LITER = 1.6;
export const MIN_FUEL_PRICE_PER_LITER = 1.15;
export const MAX_FUEL_PRICE_PER_LITER = 2.15;
export const FUEL_PRICE_CHANGE_MIN_DAYS = 3;
export const FUEL_PRICE_CHANGE_MAX_DAYS = 5;
export const INITIAL_NEXT_FUEL_PRICE_CHANGE_GAME_DAY = 4;
/**
 * Base fuel burn rate in liters per 1 world pixel driven (multiplied by vehicle's `fuelConsumptionRate`).
 * Calibrated so Used Van Pro (65 L tank, rate 1.55) at ~8,000 px/h * 10 h/day (~80,000 px/day)
 * burns a full 65 L tank in ~17.5 in-game days (~2.5 weeks): 65 / (1.55 * 1,400,000) ≈ 0.00003 L/px.
 */
export const BASE_FUEL_BURN_LITERS_PER_WORLD_PX = 0.00003;
/** Cruising speed multiplier when a motorized vehicle's fuel tank reaches 0 L (reserve limp mode) */
export const EMPTY_FUEL_SPEED_MULTIPLIER = 0.5;
/** Manual "Refuel" button becomes active below 85% tank level */
export const REFUEL_AVAILABLE_THRESHOLD_RATIO = 0.85;
/** Low-fuel warning & automatic gas-station detour threshold (15%) */
export const AUTO_REFUEL_THRESHOLD_RATIO = 0.15;
/** Gas station pump stop duration in in-game minutes (15 min -> 12s at 1x) */
export const REFUEL_SERVICE_GAME_MINUTES = 15;

export function clampFuelPrice(price: number): number {
  if (!Number.isFinite(price)) return BASE_FUEL_PRICE_PER_LITER;
  return Math.max(MIN_FUEL_PRICE_PER_LITER, Math.min(MAX_FUEL_PRICE_PER_LITER, price));
}

export function clampFuelLiters(liters: number, capacityLiters: number): number {
  const safeCap = Math.max(0, Number.isFinite(capacityLiters) ? capacityLiters : 0);
  if (!Number.isFinite(liters)) return safeCap;
  return Math.max(0, Math.min(safeCap, liters));
}

/**
 * Computes the seasonal target fuel price ($/L) for a given 1-based gameplay day:
 * - Mid-July (~day 196): 80% of base ($1.28/L)
 * - Spring & Autumn: 100% of base ($1.60/L)
 * - Mid-January (Jan 15, day-of-year 14): 120% peak ($1.92/L), immediately turning downward afterward.
 */
export function getSeasonalTargetFuelPrice(gameDay: number): number {
  const date = getCalendarDateFromGameDay(Math.max(1, Math.floor(gameDay)));
  let dayOfYear = date.dayOfMonth - 1;
  for (let m = 0; m < date.monthIndex; m++) {
    dayOfYear += POLISH_MONTHS[m]?.days ?? 30;
  }
  const winterPeakDayOfYear = 14; // 15 Styczeń (0-indexed)
  const angle = (2 * Math.PI * (dayOfYear - winterPeakDayOfYear)) / DAYS_PER_YEAR;
  const seasonalMultiplier = 1 + 0.2 * Math.cos(angle);
  return clampFuelPrice(Math.round(BASE_FUEL_PRICE_PER_LITER * seasonalMultiplier * 100) / 100);
}

/** Preserves full floating-point precision so slow fractional wear never rounds away on short runs. */
export function clampVehicleDurability(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VEHICLE_DURABILITY;
  return Math.max(MIN_VEHICLE_DURABILITY, Math.min(MAX_VEHICLE_DURABILITY, value));
}

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
    fuelTankCapacityLiters: 55,
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
    fuelTankCapacityLiters: 60,
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
    fuelTankCapacityLiters: 65,
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
    fuelTankCapacityLiters: 65,
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
    fuelTankCapacityLiters: 72,
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
    fuelTankCapacityLiters: 80,
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

export function createOwnedVan(
  index: number,
  modelId: VanModelId = DEFAULT_LEGACY_VAN_MODEL_ID,
  durability: number = DEFAULT_VEHICLE_DURABILITY,
  fuelLiters?: number
): OwnedVan {
  const spec = getVanModelSpec(modelId);
  const safeIndex = Math.max(1, Math.floor(index));
  return {
    id: `van-${safeIndex}`,
    index: safeIndex,
    modelId: spec.id,
    condition: spec.condition,
    tier: spec.tier,
    durability: clampVehicleDurability(durability),
    fuelLiters:
      typeof fuelLiters === 'number' && Number.isFinite(fuelLiters)
        ? clampFuelLiters(fuelLiters, spec.fuelTankCapacityLiters)
        : spec.fuelTankCapacityLiters,
  };
}

export function createDefaultOwnedVans(
  count: number,
  modelId: VanModelId = DEFAULT_LEGACY_VAN_MODEL_ID
): OwnedVan[] {
  const safeCount = Math.max(0, Math.min(MAX_VANS, Math.floor(count)));
  return Array.from({ length: safeCount }, (_, idx) =>
    createOwnedVan(idx + 1, modelId, DEFAULT_VEHICLE_DURABILITY)
  );
}

/** Catalog of 2 courier scooter models sharing the 4-bay Base shelter */
export const SCOOTER_MODELS: Readonly<Record<ScooterModelId, ScooterModelSpec>> = {
  scooter_city: {
    id: 'scooter_city',
    name: 'Skuter Miejski',
    capacity: 5,
    speedPxPerSec: 152,
    purchasePrice: 1200,
    monthlyInsurance: 70,
    repairGameMinutes: SCOOTER_CITY_REPAIR_GAME_MINUTES,
    fuelTankCapacityLiters: 8,
    fuelConsumptionRate: 0.45,
  },
  scooter_cargo: {
    id: 'scooter_cargo',
    name: 'Skuter Cargo',
    capacity: 6,
    speedPxPerSec: 168,
    purchasePrice: 2000,
    monthlyInsurance: 85,
    repairGameMinutes: SCOOTER_CARGO_REPAIR_GAME_MINUTES,
    fuelTankCapacityLiters: 11,
    fuelConsumptionRate: 0.55,
  },
} as const;

export const SCOOTER_MODEL_IDS_ORDER: readonly ScooterModelId[] = [
  'scooter_city',
  'scooter_cargo',
] as const;

export function isValidScooterModelId(value: unknown): value is ScooterModelId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCOOTER_MODELS, value);
}

export function getScooterModelSpec(modelId: ScooterModelId): ScooterModelSpec {
  return SCOOTER_MODELS[modelId] ?? SCOOTER_MODELS[DEFAULT_LEGACY_SCOOTER_MODEL_ID];
}

export function createOwnedScooter(
  index: number,
  modelId: ScooterModelId = DEFAULT_LEGACY_SCOOTER_MODEL_ID,
  durability: number = DEFAULT_VEHICLE_DURABILITY,
  fuelLiters?: number
): OwnedScooter {
  const spec = getScooterModelSpec(modelId);
  const safeIndex = Math.max(1, Math.floor(index));
  return {
    id: `scooter-${safeIndex}`,
    index: safeIndex,
    modelId: spec.id,
    durability: clampVehicleDurability(durability),
    fuelLiters:
      typeof fuelLiters === 'number' && Number.isFinite(fuelLiters)
        ? clampFuelLiters(fuelLiters, spec.fuelTankCapacityLiters)
        : spec.fuelTankCapacityLiters,
  };
}

export function getScooterResaleValue(modelId: ScooterModelId): number {
  return Math.round(getScooterModelSpec(modelId).purchasePrice * VEHICLE_RESALE_RATE);
}

export function getVanResaleValue(modelId: VanModelId): number {
  return Math.round(getVanModelSpec(modelId).purchasePrice * VEHICLE_RESALE_RATE);
}

export function getBicycleResaleValue(): number {
  return Math.round(BICYCLE_PURCHASE_COST * VEHICLE_RESALE_RATE);
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
/** Late-game 2x/week long-term contract unlock threshold & roll probability (~33%) */
export const TWO_DAY_LONG_TERM_MIN_COMPLETED_ORDERS = 25;
export const TWO_DAY_LONG_TERM_OFFER_CHANCE = 0.33;

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
  const hasPendingRepairs =
    Array.isArray(state.pendingVehicleRepairs) && state.pendingVehicleRepairs.length > 0;
  if (state.activeOrders.length === 0 && !hasPendingRepairs) return null;

  const currentElapsedDay = Math.floor(Math.max(0, currentMinutes) / MINUTES_PER_DAY);
  const currentGameDay = currentElapsedDay + 1;

  // Pending vehicle repairs carry over to tomorrow 08:00 until completed
  if (hasPendingRepairs) {
    return (currentElapsedDay + 1) * MINUTES_PER_DAY + WORKDAY_START_MINUTES;
  }

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
