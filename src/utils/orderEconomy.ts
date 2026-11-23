import type { Building } from '../types/building';
import { formatBuildingAddress } from '../types/building';
import type {
  ActiveLongTermOrder,
  ActiveOrder,
  ActiveShortTermOrder,
  ActiveVehicleSelection,
  ActiveVehicleType,
  CompanyEmployee,
  EmployeeLicenseUpgradeInfo,
  HirableEmployeeRole,
  LongTermDurationMonths,
  LongTermOrderOffer,
  MonthlyCostBreakdown,
  MonthlySettlementRecord,
  OrderDeliveryStop,
  OrderEconomyState,
  OrderLocation,
  OrderOffer,
  ParkingSpotUpgradeInfo,
  ReputationLevel,
  ReputationTierConfig,
  ShortTermOrderOffer,
  UpgradePurchaseResult,
  WarehouseLoadForBikeResult,
  WarehouseLoadedBatch,
  WarehouseTier,
  WarehouseTierConfig,
  WarehouseUnloadResult,
  WarehouseUpgradeInfo,
  WeeklyOrderSettlementResult,
  WeeklyScheduleTask,
  WeeklyTaskType,
} from '../types/orders';
import { PROCEDURAL_BUILDINGS } from './buildings';
import {
  DAYS_PER_WEEK,
  type GameCalendarDate,
  INITIAL_BALANCE,
  INITIAL_GAME_MINUTES,
  MINUTES_PER_DAY,
  POLISH_MONTHS,
  WORKDAY_START_MINUTES,
  addCalendarMonthsToGameDay,
  getCalendarDateFromElapsedDays,
  getCalendarDateFromGameDay,
  getGameClockDisplay,
} from './gameClock';

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

/** Monthly salaries per employee role */
export const OWNER_COURIER_SALARY = 0;
export const HIRED_BIKE_COURIER_SALARY = 1650;
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

/** Returns package capacity for the selected vehicle type (5 for bicycle, 20 for used van) */
export function getVehicleCourierCapacity(vehicleType: ActiveVehicleType): number {
  return vehicleType === 'van' ? VAN_COURIER_CAPACITY : BIKE_COURIER_CAPACITY;
}

/** Bicycle fleet configuration (includes owner's starter bike; up to 2 extra bikes at $450 each) */
export const INITIAL_BICYCLES = 1;
export const MAX_BICYCLES = 3;
export const MAX_ADDITIONAL_BICYCLES = MAX_BICYCLES - INITIAL_BICYCLES; // 2
export const BICYCLE_PURCHASE_COST = 450;

/** Used delivery van (20-package class) fleet configuration (limit = unlocked parkingSpots, max 8) */
export const INITIAL_VANS = 0;
export const MAX_VANS = 8;
export const USED_VAN_PURCHASE_COST = 8500;

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
export const OFFER_EXPIRY_DAYS = 4;

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

const SHOP_CLIENT_NAMES = [
  'Market Świeży Koszyk',
  'Delikatesy Centrum',
  'Sklep Spożywczy Gama',
  'Hurtownia EkoSmak',
  'Supermarket Blisko',
  'Sklep Elektroniczny Volt',
  'Dom i Ogród Kwadrat',
  'Sklep Wielobranżowy Plus',
  'Apteka i Drogeria Zdrowie',
  'Księgarnia Papiernicza A4',
] as const;

const STATION_CLIENT_NAMES = [
  'Punkt Przesyłek — Dworzec Autobusowy',
  'Terminal Kurierski PKS',
  'Biuro Nadawcze Dworzec',
] as const;

const KIOSK_CLIENT_NAMES = [
  'Pawilon Usługowy Kropka',
  'Kwiaciarnia i Upominki',
  'Piekarnia Rzemieślnicza',
  'Punkt Ksero i Druk',
  'Kiosk Prasowy i Paczki',
  'Pracownia Optyczna Fokus',
] as const;

const TWO_DAY_WEEKDAY_PAIRS: readonly (readonly [number, number])[] = [
  [0, 3], // Poniedziałek, Czwartek
  [1, 4], // Wtorek, Piątek
  [0, 4], // Poniedziałek, Piątek
  [1, 3], // Wtorek, Czwartek
  [2, 4], // Środa, Piątek
] as const;

// ============================================================================
// Pure Utility Helpers
// ============================================================================

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampSatisfaction(value: number): number {
  return Math.max(MIN_ORDER_SATISFACTION, Math.min(MAX_ORDER_SATISFACTION, Math.round(value)));
}

/** Pure Mulberry32 step returning next deterministic uint32 state and float in [0, 1) */
function nextRng(state: number): { value: number; nextState: number } {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState };
}

function rngInt(state: number, min: number, max: number): { value: number; nextState: number } {
  const step = nextRng(state);
  const span = Math.max(1, max - min + 1);
  return {
    value: min + Math.floor(step.value * span),
    nextState: step.nextState,
  };
}

function rngPick<T>(state: number, items: readonly T[]): { value: T; nextState: number } {
  const step = rngInt(state, 0, items.length - 1);
  return {
    value: items[step.value],
    nextState: step.nextState,
  };
}

function rngRate(
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

function computeAnnualSatisfactionAvg(sum: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round((sum / count) * 10) / 10;
}

function recordOrderSatisfactionSample(
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
// Real Map Building Pools & Location Builders
// ============================================================================

function toOrderLocation(building: Building): OrderLocation {
  const stop = building.deliveryStopPoint ?? {
    x: 0,
    y: 0,
    u: (building.uMin + building.uMax) * 0.5,
    v: (building.vMin + building.vMax) * 0.5,
    surface: 'plaza' as const,
  };

  return {
    buildingId: building.id,
    buildingType: building.typ,
    address: formatBuildingAddress(building),
    streetName: building.nazwaUlicy,
    buildingNumber: building.numerBudynku,
    deliveryStopPoint: stop,
    ...(building.roadApproachPoint ? { roadApproachPoint: building.roadApproachPoint } : {}),
  };
}

function getBuildingPools(buildings: readonly Building[]): {
  pickupBuildings: Building[];
  deliveryBuildings: Building[];
} {
  const validDeliverable = buildings.filter(
    (b) => b.typ !== 'baza' && b.dostepnyDlaDostaw !== false && b.deliveryStopPoint !== undefined
  );

  const commercialPickups = validDeliverable.filter(
    (b) => b.typ === 'sklep' || b.typ === 'dworzec' || b.typ === 'kiosk'
  );
  const residentialDeliveries = validDeliverable.filter(
    (b) =>
      b.typ === 'dom' ||
      b.typ === 'blok_maly' ||
      b.typ === 'blok_sredni' ||
      b.typ === 'blok_wysoki'
  );

  return {
    pickupBuildings: commercialPickups.length > 0 ? commercialPickups : validDeliverable,
    deliveryBuildings:
      residentialDeliveries.length > 0 ? residentialDeliveries : validDeliverable,
  };
}

function pickClientNameForBuilding(
  rngState: number,
  building: Building
): { clientName: string; nextState: number } {
  if (building.typ === 'dworzec') {
    const picked = rngPick(rngState, STATION_CLIENT_NAMES);
    return { clientName: picked.value, nextState: picked.nextState };
  }
  if (building.typ === 'kiosk') {
    const picked = rngPick(rngState, KIOSK_CLIENT_NAMES);
    return { clientName: picked.value, nextState: picked.nextState };
  }
  const picked = rngPick(rngState, SHOP_CLIENT_NAMES);
  return { clientName: picked.value, nextState: picked.nextState };
}

function buildDeliveryStops(
  rngState: number,
  orderId: string,
  totalPackages: number,
  pickupBuildingId: string,
  deliveryPool: readonly Building[]
): { stops: OrderDeliveryStop[]; nextState: number } {
  let state = rngState;
  const eligible = deliveryPool.filter((b) => b.id !== pickupBuildingId);
  const pool = eligible.length > 0 ? eligible : deliveryPool;

  if (pool.length === 0 || totalPackages <= 0) {
    return { stops: [], nextState: state };
  }

  // Distribute totalPackages across distinct destination buildings (1–3 packages per address)
  const targetStopCount = Math.min(
    pool.length,
    Math.max(1, Math.min(totalPackages, Math.ceil(totalPackages / 2)))
  );

  const chosen: Building[] = [];
  const usedIds = new Set<string>();
  let guard = 0;

  while (chosen.length < targetStopCount && guard < targetStopCount * 8) {
    guard++;
    const pick = rngPick(state, pool);
    state = pick.nextState;
    if (!usedIds.has(pick.value.id)) {
      usedIds.add(pick.value.id);
      chosen.push(pick.value);
    }
  }

  // Assign at least 1 package to each stop, then distribute remaining packages
  const counts = chosen.map(() => 1);
  let remaining = totalPackages - chosen.length;
  while (remaining > 0) {
    const idxStep = rngInt(state, 0, chosen.length - 1);
    state = idxStep.nextState;
    counts[idxStep.value] += 1;
    remaining -= 1;
  }

  const stops: OrderDeliveryStop[] = chosen.map((building, index) => ({
    id: `${orderId}-stop-${index + 1}`,
    location: toOrderLocation(building),
    packageCount: counts[index],
    deliveredCount: 0,
  }));

  return { stops, nextState: state };
}

// ============================================================================
// Offer Generator
// ============================================================================

const ORDER_NUMBER_MIN = 101;
const ORDER_NUMBER_MAX = 999;
const ORDER_NUMBER_SPAN = ORDER_NUMBER_MAX - ORDER_NUMBER_MIN + 1; // 899

/**
 * Draws a random 3-digit integer in [101, 999] that is not currently used by any
 * active order or pending offer.
 */
export function generateUniqueOrderNumber(usedNumbers: ReadonlySet<number>): number {
  for (let attempt = 0; attempt < 250; attempt++) {
    const candidate = Math.floor(Math.random() * ORDER_NUMBER_SPAN) + ORDER_NUMBER_MIN;
    if (!usedNumbers.has(candidate)) {
      return candidate;
    }
  }
  // Linear fallback scan in case nearly all 899 numbers are occupied simultaneously
  const startOffset = Math.floor(Math.random() * ORDER_NUMBER_SPAN);
  for (let i = 0; i < ORDER_NUMBER_SPAN; i++) {
    const candidate = ORDER_NUMBER_MIN + ((startOffset + i) % ORDER_NUMBER_SPAN);
    if (!usedNumbers.has(candidate)) {
      return candidate;
    }
  }
  return Math.floor(Math.random() * ORDER_NUMBER_SPAN) + ORDER_NUMBER_MIN;
}

export function generateSingleOffer(
  reputationLevel: ReputationLevel,
  currentMinutes: number,
  buildings: readonly Building[],
  orderSeq: number,
  rngState: number,
  usedOrderNumbers?: ReadonlySet<number>
): { offer: OrderOffer; nextState: number } {
  let state = rngState;
  const tier = getReputationTierConfig(reputationLevel);
  const { pickupBuildings, deliveryBuildings } = getBuildingPools(buildings);

  const pickupPick = rngPick(state, pickupBuildings);
  state = pickupPick.nextState;
  const pickupBuilding = pickupPick.value;
  const pickupLocation = toOrderLocation(pickupBuilding);

  const clientPick = pickClientNameForBuilding(state, pickupBuilding);
  state = clientPick.nextState;

  const ratePick = rngRate(state, tier.ratePerPackageMin, tier.ratePerPackageMax);
  state = ratePick.nextState;
  const ratePerPackage = ratePick.value;

  const createdDate = getCalendarDateFromElapsedDays(Math.floor(currentMinutes / MINUTES_PER_DAY));
  const createdAtGameDay = createdDate.gameDay;
  const expiresAtGameDay = createdAtGameDay + OFFER_EXPIRY_DAYS;
  const expiresAtMinutes = (expiresAtGameDay - 1) * MINUTES_PER_DAY;
  const id = `ord-${orderSeq}`;
  const orderNumber = generateUniqueOrderNumber(usedOrderNumbers ?? new Set<number>());

  // Decide short-term vs long-term based on reputation tier unlocks
  const canGenerateLongTerm = tier.allowedLongTermMonths.length > 0;
  let isLongTerm = false;
  if (canGenerateLongTerm) {
    const roll = nextRng(state);
    state = roll.nextState;
    isLongTerm = roll.value < 0.45;
  }

  if (isLongTerm) {
    const monthsPick = rngPick(state, tier.allowedLongTermMonths);
    state = monthsPick.nextState;
    const durationMonths: LongTermDurationMonths = monthsPick.value;

    // Level 2: 10–16 pkgs/week, 1 pickup day/week; Levels 3–4: 20–36 pkgs/week, 2 pickup days/week
    const isHighVolumeTier = reputationLevel >= 3;
    const pkgStep = rngInt(state, isHighVolumeTier ? 20 : 10, isHighVolumeTier ? 36 : 16);
    state = pkgStep.nextState;
    const packagesPerWeek = pkgStep.value;
    const pickupDaysPerWeek: 1 | 2 = isHighVolumeTier ? 2 : 1;

    let pickupWeekdays: readonly number[];
    if (pickupDaysPerWeek === 1) {
      const dayStep = rngInt(state, 0, 4); // Poniedziałek–Piątek
      state = dayStep.nextState;
      pickupWeekdays = [dayStep.value];
    } else {
      const pairStep = rngPick(state, TWO_DAY_WEEKDAY_PAIRS);
      state = pairStep.nextState;
      pickupWeekdays = pairStep.value;
    }

    // 3m = 13 weeks, 6m = 26 weeks, 12m = 52 weeks (aligned with 365-day calendar)
    const estimatedTotalWeeks = Math.round((durationMonths * 52) / 12);
    const totalContractValue = roundCurrency(
      packagesPerWeek * estimatedTotalWeeks * ratePerPackage
    );
    const estimatedMonthlyPayout = roundCurrency(totalContractValue / durationMonths);

    const sampleStops = buildDeliveryStops(
      state,
      id,
      packagesPerWeek,
      pickupBuilding.id,
      deliveryBuildings
    );
    state = sampleStops.nextState;

    const offer: LongTermOrderOffer = {
      id,
      orderNumber,
      kind: 'long_term',
      clientName: clientPick.clientName,
      title: `Kontrakt ${durationMonths} mies. — ${clientPick.clientName}`,
      description: `Stała obsługa przesyłek z ${pickupLocation.address} (${packagesPerWeek} paczek/tydz., rozliczenie 1. dnia miesiąca).`,
      reputationTierAtCreation: reputationLevel,
      pickupLocation,
      ratePerPackage,
      createdAtGameDay,
      createdAtMinutes: currentMinutes,
      expiresAtGameDay,
      expiresAtMinutes,
      isSeen: false,
      durationMonths,
      packagesPerWeek,
      pickupDaysPerWeek,
      pickupWeekdays,
      estimatedMonthlyPayout,
      totalContractValue,
      sampleDeliveryStops: sampleStops.stops,
    };

    return { offer, nextState: state };
  }

  // Short-term offer:
  // - 1–3 days -> 5–8 packages
  // - 7–14 days -> 12–22 packages (capped at 7 days on Level 1)
  const bandRoll = nextRng(state);
  state = bandRoll.nextState;
  const isMediumBand = bandRoll.value >= 0.5;

  let durationDays: number;
  let totalPackages: number;

  if (isMediumBand) {
    const mediumDurations = tier.maxShortTermDays >= 14 ? [7, 10, 14] : [7];
    const durPick = rngPick(state, mediumDurations);
    state = durPick.nextState;
    durationDays = durPick.value;

    const pkgPick = rngInt(state, 12, 22);
    state = pkgPick.nextState;
    totalPackages = pkgPick.value;
  } else {
    const durPick = rngInt(state, 1, 3);
    state = durPick.nextState;
    durationDays = durPick.value;

    const pkgPick = rngInt(state, 5, 8);
    state = pkgPick.nextState;
    totalPackages = pkgPick.value;
  }

  const totalExpectedPayout = roundCurrency(totalPackages * ratePerPackage);
  const stopsResult = buildDeliveryStops(
    state,
    id,
    totalPackages,
    pickupBuilding.id,
    deliveryBuildings
  );
  state = stopsResult.nextState;

  const dayLabel = durationDays === 1 ? '1 dzień' : `${durationDays} dni`;
  const offer: ShortTermOrderOffer = {
    id,
    orderNumber,
    kind: 'short_term',
    clientName: clientPick.clientName,
    title: `Zlecenie (${dayLabel}) — ${clientPick.clientName}`,
    description: `Odbiór ${totalPackages} paczek z ${pickupLocation.address} i dostawa do odbiorców na terenie miasta.`,
    reputationTierAtCreation: reputationLevel,
    pickupLocation,
    ratePerPackage,
    createdAtGameDay,
    createdAtMinutes: currentMinutes,
    expiresAtGameDay,
    expiresAtMinutes,
    isSeen: false,
    durationDays,
    totalPackages,
    totalExpectedPayout,
    deliveryStops: stopsResult.stops,
  };

  return { offer, nextState: state };
}

function generateOffersBatch(
  state: OrderEconomyState,
  desiredCount: number,
  currentMinutes: number,
  buildings: readonly Building[]
): OrderEconomyState {
  const freeSlots = Math.max(0, MAX_PENDING_OFFERS - state.pendingOffers.length);
  const toGenerate = Math.min(desiredCount, freeSlots);
  if (toGenerate <= 0) {
    return state;
  }

  const newOffers: OrderOffer[] = [];
  const usedOrderNumbers = new Set<number>();
  for (const active of state.activeOrders) {
    usedOrderNumbers.add(active.orderNumber);
  }
  for (const pending of state.pendingOffers) {
    usedOrderNumbers.add(pending.orderNumber);
  }

  let rngState = state.rngState;
  let nextOrderSeq = state.nextOrderSeq;

  for (let i = 0; i < toGenerate; i++) {
    const generated = generateSingleOffer(
      state.reputationLevel,
      currentMinutes,
      buildings,
      nextOrderSeq,
      rngState,
      usedOrderNumbers
    );
    usedOrderNumbers.add(generated.offer.orderNumber);
    newOffers.push(generated.offer);
    rngState = generated.nextState;
    nextOrderSeq += 1;
  }

  return {
    ...state,
    pendingOffers: [...state.pendingOffers, ...newOffers],
    nextOrderSeq,
    rngState,
  };
}

// ============================================================================
// Initial State Factory
// ============================================================================

export function createInitialOrderEconomyState(
  buildings: readonly Building[] = PROCEDURAL_BUILDINGS,
  initialSeed = 133742
): OrderEconomyState {
  const startDate = getCalendarDateFromElapsedDays(0);

  const starterWarehouse = getWarehouseTierConfig(INITIAL_WAREHOUSE_TIER);
  const ownerCourier: CompanyEmployee = {
    id: 'emp-owner',
    name: 'Właściciel',
    role: 'owner_bike_courier',
    isOwner: true,
    monthlySalary: OWNER_COURIER_SALARY,
    monthlyInsurance: 0,
    hiredAtGameDay: startDate.gameDay,
  };

  const baseState: OrderEconomyState = {
    balance: INITIAL_BALANCE,
    completedOrdersCount: 0,
    annualSatisfactionSum: 0,
    annualSatisfactionCount: 0,
    annualSatisfactionAvg: 0,
    annualStatsYear: startDate.year,
    reputationLevel: 1,
    warehouseLevel: starterWarehouse.tier,
    warehouseTier: starterWarehouse.tier,
    warehouseCapacity: starterWarehouse.capacity,
    warehousePackages: 0,
    warehouseInventory: {},
    parkingSpots: INITIAL_PARKING_SPOTS,
    maxEmployees: INITIAL_MAX_EMPLOYEES,
    employees: [ownerCourier],
    bikesCount: INITIAL_BICYCLES,
    bicyclesCount: INITIAL_BICYCLES,
    vansCount: INITIAL_VANS,
    deliveryVansCount: INITIAL_VANS,
    activeVehicle: { type: 'bike', index: 1 },
    pendingOffers: [],
    activeOrders: [],
    archivedOrders: [],
    pendingMonthlyLongTermPayout: 0,
    monthlySettlements: [],
    recentWeeklySettlements: [],
    lastOfferGenerationGameDay: startDate.gameDay, // Day 1
    lastProcessedMinutes: INITIAL_GAME_MINUTES,
    lastSettledMonthKey: startDate.monthKey, // "1-06" so 1 Czerwiec is not billed; 1 Lipiec is first
    nextOrderSeq: 1,
    rngState: initialSeed >>> 0,
    weeklyPriorityOrder: createEmptyWeeklyPriorityOrder(),
  };

  // Day 1 starts with 2 unread offers immediately available
  return generateOffersBatch(baseState, INITIAL_OFFERS_COUNT, INITIAL_GAME_MINUTES, buildings);
}

// ============================================================================
// Employee Salaries, Insurance, Monthly Cost Breakdown & Bicycle Fleet Helpers
// ============================================================================

/**
 * Computes the complete monthly operating cost breakdown for the 1st-of-month settlement,
 * OrdersModal forecast, and CompanyModal summary:
 * - Base upkeep & tax by warehouse level: $350 (Poz. 1) / $440 (Poz. 2) / $540 (Poz. 3) / $680 (Poz. 4)
 *   (Base Poz. 1 includes the starter bicycle; owner salary is $0/mies.)
 * - Additional courier bicycles (2nd & 3rd bike): +$50/mies. insurance each
 * - Owned used delivery vans (20-package class): +$130/mies. insurance each
 * - Hired employees (future stages): monthly salaries
 */
export function calculateMonthlyCompanyCosts(state: OrderEconomyState): MonthlyCostBreakdown {
  const warehouseConfig = getWarehouseTierConfig(state.warehouseLevel ?? state.warehouseTier);
  const baseUpkeepAndTaxCost = warehouseConfig.monthlyUpkeepCost;
  const bikesCount = state.bikesCount ?? state.bicyclesCount ?? INITIAL_BICYCLES;
  const additionalBikes = Math.max(0, bikesCount - 1);
  const vansCount = Math.max(0, state.vansCount ?? state.deliveryVansCount ?? INITIAL_VANS);

  let salariesCost = 0;

  for (const emp of state.employees) {
    if (!emp.isOwner) {
      salariesCost += emp.monthlySalary;
    }
  }

  salariesCost = roundCurrency(salariesCost);
  const courierInsuranceCost = roundCurrency(additionalBikes * COURIER_INSURANCE_COST);
  const vanInsuranceCost = roundCurrency(vansCount * USED_VAN_INSURANCE_COST);
  const insuranceCost = roundCurrency(courierInsuranceCost + vanInsuranceCost);
  const totalFixedCosts = roundCurrency(baseUpkeepAndTaxCost + salariesCost + insuranceCost);

  return {
    baseUpkeepAndTaxCost,
    salariesCost,
    courierInsuranceCost,
    vanInsuranceCost,
    insuranceCost,
    totalFixedCosts,
  };
}

/**
 * Purchases an additional bicycle ($450 each) up to MAX_BICYCLES = 3 (including owner's starter bike).
 */
export function purchaseBicycle(state: OrderEconomyState): UpgradePurchaseResult {
  const currentBikes = state.bikesCount ?? state.bicyclesCount;
  if (currentBikes >= MAX_BICYCLES) {
    return { state, purchased: false, cost: 0, reason: 'max_reached' };
  }
  if (state.balance < BICYCLE_PURCHASE_COST) {
    return { state, purchased: false, cost: BICYCLE_PURCHASE_COST, reason: 'insufficient_funds' };
  }

  const nextBikes = currentBikes + 1;
  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - BICYCLE_PURCHASE_COST),
      bikesCount: nextBikes,
      bicyclesCount: nextBikes,
    },
    purchased: true,
    cost: BICYCLE_PURCHASE_COST,
  };
}

/**
 * Purchases a used delivery van (20-package class, $8 500 each) if a free Base parking spot
 * (parkingSpots) is available and balance covers the purchase price.
 */
export function purchaseUsedVan(state: OrderEconomyState): UpgradePurchaseResult {
  const currentVans = Math.max(0, state.vansCount ?? state.deliveryVansCount ?? INITIAL_VANS);
  if (currentVans >= MAX_VANS) {
    return { state, purchased: false, cost: 0, reason: 'max_reached' };
  }
  if (currentVans >= state.parkingSpots) {
    return { state, purchased: false, cost: USED_VAN_PURCHASE_COST, reason: 'no_parking_spot' };
  }
  if (state.balance < USED_VAN_PURCHASE_COST) {
    return { state, purchased: false, cost: USED_VAN_PURCHASE_COST, reason: 'insufficient_funds' };
  }

  const nextVans = currentVans + 1;
  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - USED_VAN_PURCHASE_COST),
      vansCount: nextVans,
      deliveryVansCount: nextVans,
    },
    purchased: true,
    cost: USED_VAN_PURCHASE_COST,
  };
}

/**
 * Updates the owner courier's active vehicle selection among owned bicycles and vans.
 * Caller enforces that the owner courier is currently at Base.
 */
export function setOwnerActiveVehicle(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection
): OrderEconomyState {
  const bikesCount = Math.max(INITIAL_BICYCLES, state.bikesCount ?? state.bicyclesCount ?? INITIAL_BICYCLES);
  const vansCount = Math.max(0, state.vansCount ?? state.deliveryVansCount ?? INITIAL_VANS);

  if (!Number.isInteger(vehicle.index) || vehicle.index < 1) {
    return state;
  }
  if (vehicle.type === 'bike' && vehicle.index > bikesCount) {
    return state;
  }
  if (vehicle.type === 'van' && vehicle.index > vansCount) {
    return state;
  }

  if (
    state.activeVehicle &&
    state.activeVehicle.type === vehicle.type &&
    state.activeVehicle.index === vehicle.index
  ) {
    return state;
  }

  return {
    ...state,
    activeVehicle: { type: vehicle.type, index: vehicle.index },
  };
}

/**
 * Hires an additional employee (bike courier or van driver) if an unlocked employee license slot is free.
 */
export function hireEmployee(
  state: OrderEconomyState,
  role: HirableEmployeeRole,
  name?: string,
  currentGameDay?: number
): { state: OrderEconomyState; hired: boolean; employee?: CompanyEmployee } {
  if (state.employees.length >= state.maxEmployees) {
    return { state, hired: false };
  }

  const isVanDriver = role === 'van_driver';
  const monthlySalary = isVanDriver ? HIRED_VAN_DRIVER_SALARY : HIRED_BIKE_COURIER_SALARY;
  const monthlyInsurance = isVanDriver ? VAN_DRIVER_INSURANCE_COST : COURIER_INSURANCE_COST;
  const staffIndex = state.employees.length + 1;
  const hiredAtGameDay =
    currentGameDay ?? Math.floor(state.lastProcessedMinutes / MINUTES_PER_DAY) + 1;

  const employee: CompanyEmployee = {
    id: `emp-${staffIndex}-${hiredAtGameDay}`,
    name: name ?? (isVanDriver ? `Kierowca #${staffIndex - 1}` : `Kurier #${staffIndex - 1}`),
    role,
    isOwner: false,
    monthlySalary,
    monthlyInsurance,
    hiredAtGameDay,
  };

  return {
    state: {
      ...state,
      employees: [...state.employees, employee],
    },
    hired: true,
    employee,
  };
}

/**
 * Dismisses a hired employee by ID. The starter owner-courier cannot be dismissed.
 */
export function dismissEmployee(state: OrderEconomyState, employeeId: string): OrderEconomyState {
  const target = state.employees.find((emp) => emp.id === employeeId);
  if (!target || target.isOwner) return state;
  return {
    ...state,
    employees: state.employees.filter((emp) => emp.id !== employeeId),
  };
}

// ============================================================================
// Base Warehouse Logistics & 3 Independent Upgrade Path Helpers
// ============================================================================

export function getWarehouseTierConfig(tier: WarehouseTier): WarehouseTierConfig {
  return WAREHOUSE_TIERS[tier - 1] ?? WAREHOUSE_TIERS[0];
}

export function getEffectiveWarehouseCapacity(state: OrderEconomyState): number {
  return getWarehouseTierConfig(state.warehouseLevel ?? state.warehouseTier).capacity;
}

export function getFreeWarehouseCapacity(state: OrderEconomyState): number {
  return Math.max(0, getEffectiveWarehouseCapacity(state) - state.warehousePackages);
}

/**
 * Checks whether the Base warehouse currently has enough free slots to accommodate
 * the remaining packages to pick up for an order. If not, the courier holds off on
 * starting this ODBIÓR until ROZWÓZKA tasks free up space.
 * (If an order exceeds the entire warehouse capacity at a low tier, requires at least
 * a full courier load so deliveries cannot permanently deadlock.)
 */
export function hasEnoughWarehouseSpaceForPickup(
  state: OrderEconomyState,
  remainingOrderPackagesToPickup: number
): boolean {
  if (remainingOrderPackagesToPickup <= 0) return false;
  const capacity = getEffectiveWarehouseCapacity(state);
  const freeSpace = Math.max(0, capacity - state.warehousePackages);
  const requiredSpace =
    remainingOrderPackagesToPickup <= capacity
      ? remainingOrderPackagesToPickup
      : Math.min(BIKE_COURIER_CAPACITY, remainingOrderPackagesToPickup);
  return freeSpace >= requiredSpace;
}

export function getStoredPackagesForOrder(state: OrderEconomyState, orderId: string): number {
  return Math.max(0, state.warehouseInventory[orderId] ?? 0);
}

/**
 * Unloads packages picked up from a sender into the Base warehouse,
 * respecting the currently available free warehouse capacity.
 */
export function unloadPackagesToWarehouse(
  state: OrderEconomyState,
  orderId: string,
  packageCount: number
): WarehouseUnloadResult {
  const requested = Math.max(0, Math.floor(packageCount));
  if (requested === 0) {
    return { state, unloadedCount: 0, overflowCount: 0 };
  }

  const freeSpace = getFreeWarehouseCapacity(state);
  const unloadedCount = Math.min(requested, freeSpace);
  const overflowCount = requested - unloadedCount;

  if (unloadedCount <= 0) {
    return { state, unloadedCount: 0, overflowCount };
  }

  const prevOrderCount = state.warehouseInventory[orderId] ?? 0;
  const nextInventory: Record<string, number> = {
    ...state.warehouseInventory,
    [orderId]: prevOrderCount + unloadedCount,
  };

  return {
    state: {
      ...state,
      warehousePackages: state.warehousePackages + unloadedCount,
      warehouseInventory: nextInventory,
    },
    unloadedCount,
    overflowCount,
  };
}

/**
 * Safely returns packages carried by a courier back into the Base warehouse
 * (used both after pickup runs, on end-of-workday return, and when skipping time).
 */
export function returnPackagesToWarehouse(
  state: OrderEconomyState,
  batches: readonly WarehouseLoadedBatch[]
): OrderEconomyState {
  if (batches.length === 0) return state;

  let current = state;
  const activeIds = new Set(current.activeOrders.map((o) => o.id));

  for (const batch of batches) {
    if (batch.count <= 0) continue;
    if (!activeIds.has(batch.orderId)) continue;
    const unloaded = unloadPackagesToWarehouse(current, batch.orderId, batch.count);
    current = unloaded.state;
  }

  return current;
}

/**
 * Loads up to `maxCapacity` (5 for bicycle, up to 20 for delivery van) packages from the Base warehouse
 * for a delivery run. When `orderId` is omitted, packages are drawn from stored orders
 * respecting `priorityOrderIds` (today's Plan tygodnia order), then active orders, then any remaining keys.
 */
export function loadPackagesFromWarehouseForBike(
  state: OrderEconomyState,
  orderId?: string,
  maxCapacity: number = BIKE_COURIER_CAPACITY,
  priorityOrderIds?: readonly string[]
): WarehouseLoadForBikeResult {
  const effectiveCap = Math.max(0, Math.min(Math.floor(maxCapacity), VAN_COURIER_CAPACITY));
  if (effectiveCap === 0 || state.warehousePackages <= 0) {
    return { state, loadedPackages: [], totalLoaded: 0 };
  }

  const nextInventory: Record<string, number> = { ...state.warehouseInventory };
  const loadedPackages: WarehouseLoadedBatch[] = [];
  let remainingSpace = effectiveCap;
  let totalLoaded = 0;

  const candidateOrderIds: string[] = [];
  const seen = new Set<string>();
  const enqueue = (id: string) => {
    if (seen.has(id)) return;
    if ((nextInventory[id] ?? 0) <= 0) return;
    seen.add(id);
    candidateOrderIds.push(id);
  };

  if (orderId) {
    enqueue(orderId);
  } else {
    if (priorityOrderIds) {
      for (const id of priorityOrderIds) {
        enqueue(id);
      }
    }
    for (const active of state.activeOrders) {
      enqueue(active.id);
    }
    for (const invOrderId of Object.keys(nextInventory)) {
      enqueue(invOrderId);
    }
  }

  for (const id of candidateOrderIds) {
    if (remainingSpace <= 0) break;
    const available = Math.max(0, nextInventory[id] ?? 0);
    if (available <= 0) continue;

    const take = Math.min(available, remainingSpace);
    const leftover = available - take;
    if (leftover > 0) {
      nextInventory[id] = leftover;
    } else {
      delete nextInventory[id];
    }

    loadedPackages.push({ orderId: id, count: take });
    remainingSpace -= take;
    totalLoaded += take;
  }

  if (totalLoaded <= 0) {
    return { state, loadedPackages: [], totalLoaded: 0 };
  }

  return {
    state: {
      ...state,
      warehousePackages: Math.max(0, state.warehousePackages - totalLoaded),
      warehouseInventory: nextInventory,
    },
    loadedPackages,
    totalLoaded,
  };
}

/**
 * Returns info about the next Base warehouse expansion tier (1 -> 2 -> 3 -> 4), or null if maxed.
 */
export function getNextWarehouseUpgrade(state: OrderEconomyState): WarehouseUpgradeInfo | null {
  const currentTier = state.warehouseLevel ?? state.warehouseTier;
  if (currentTier >= MAX_WAREHOUSE_TIER) return null;
  const nextTier = (currentTier + 1) as WarehouseTier;
  const currentConfig = getWarehouseTierConfig(currentTier);
  const nextConfig = getWarehouseTierConfig(nextTier);
  return {
    currentTier,
    nextTier,
    currentCapacity: currentConfig.capacity,
    nextCapacity: nextConfig.capacity,
    currentMonthlyUpkeepCost: currentConfig.monthlyUpkeepCost,
    nextMonthlyUpkeepCost: nextConfig.monthlyUpkeepCost,
    cost: nextConfig.upgradeCost,
  };
}

/**
 * Purchases the next Base warehouse expansion tier (deducting USD from balance and updating capacity).
 */
export function purchaseWarehouseUpgrade(state: OrderEconomyState): UpgradePurchaseResult {
  const next = getNextWarehouseUpgrade(state);
  if (!next) {
    return { state, purchased: false, cost: 0, reason: 'max_reached' };
  }
  if (state.balance < next.cost) {
    return { state, purchased: false, cost: next.cost, reason: 'insufficient_funds' };
  }

  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - next.cost),
      warehouseLevel: next.nextTier,
      warehouseTier: next.nextTier,
      warehouseCapacity: next.nextCapacity,
    },
    purchased: true,
    cost: next.cost,
  };
}

/**
 * Returns info about the next sequential Base car parking spot (2..8 at $3 500 each), or null if maxed.
 */
export function getNextParkingSpotUpgrade(state: OrderEconomyState): ParkingSpotUpgradeInfo | null {
  if (state.parkingSpots >= MAX_PARKING_SPOTS) return null;
  return {
    currentSpots: state.parkingSpots,
    nextSpotNumber: state.parkingSpots + 1,
    maxSpots: MAX_PARKING_SPOTS,
    cost: PARKING_SPOT_COST,
  };
}

/**
 * Purchases the next individual Base car parking spot (1 -> 2 -> ... -> 8).
 */
export function purchaseParkingSpot(state: OrderEconomyState): UpgradePurchaseResult {
  const next = getNextParkingSpotUpgrade(state);
  if (!next) {
    return { state, purchased: false, cost: 0, reason: 'max_reached' };
  }
  if (state.balance < next.cost) {
    return { state, purchased: false, cost: next.cost, reason: 'insufficient_funds' };
  }

  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - next.cost),
      parkingSpots: next.nextSpotNumber,
    },
    purchased: true,
    cost: next.cost,
  };
}

/**
 * Looks up the USD cost for unlocking a specific employee license slot (2..6).
 */
export function getEmployeeLicenseCost(targetEmployeeSlot: number): number | null {
  const cost = EMPLOYEE_LICENSE_COSTS[targetEmployeeSlot];
  return typeof cost === 'number' ? cost : null;
}

/**
 * Returns info about the next sequential employee license slot (2..6), or null if maxed.
 */
export function getNextEmployeeLicenseUpgrade(
  state: OrderEconomyState
): EmployeeLicenseUpgradeInfo | null {
  if (state.maxEmployees >= MAX_EMPLOYEES) return null;
  const nextEmployeeSlot = state.maxEmployees + 1;
  const cost = getEmployeeLicenseCost(nextEmployeeSlot);
  if (cost === null) return null;
  return {
    currentMaxEmployees: state.maxEmployees,
    nextEmployeeSlot,
    maxEmployees: MAX_EMPLOYEES,
    cost,
  };
}

/**
 * Purchases the next individual employee license slot (1 -> 2 -> ... -> 6).
 */
export function purchaseEmployeeLicense(state: OrderEconomyState): UpgradePurchaseResult {
  const next = getNextEmployeeLicenseUpgrade(state);
  if (!next) {
    return { state, purchased: false, cost: 0, reason: 'max_reached' };
  }
  if (state.balance < next.cost) {
    return { state, purchased: false, cost: next.cost, reason: 'insufficient_funds' };
  }

  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - next.cost),
      maxEmployees: next.nextEmployeeSlot,
    },
    purchased: true,
    cost: next.cost,
  };
}

function createEmptyWeeklyPriorityOrder(): Record<number, string[]> {
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

/**
 * Builds a unique schedule task ID distinguishing independent `pickup` and `delivery` tasks
 * belonging to the same order.
 */
export function makeWeeklyTaskId(orderId: string, taskType: WeeklyTaskType): string {
  return `${orderId}:${taskType}`;
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

  // Register accepted order as two independent tasks (Odbiór + Rozwózka) in per-weekday priority queues
  const pickupTaskId = makeWeeklyTaskId(activeOrder.id, 'pickup');
  const deliveryTaskId = makeWeeklyTaskId(activeOrder.id, 'delivery');
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
    if (!updated.includes(pickupTaskId)) {
      updated.push(pickupTaskId);
    }
    if (!updated.includes(deliveryTaskId)) {
      updated.push(deliveryTaskId);
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
  const updatedLongOrder: ActiveLongTermOrder = {
    ...order,
    currentWeekDeliveryStops: updateStops(order.currentWeekDeliveryStops, deliveredCount),
    deliveredPackagesTotal: order.deliveredPackagesTotal + deliveredCount,
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
  let rngState = state.rngState;

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
    rngState,
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
  // 1. Expire unused offers after 4 days
  const validOffers = state.pendingOffers.filter((offer) => offer.expiresAtGameDay > date.gameDay);
  let nextState: OrderEconomyState =
    validOffers.length !== state.pendingOffers.length
      ? { ...state, pendingOffers: validOffers }
      : state;

  // 2. Check offer inflow cadence:
  //    - Days 1–14: 2 new offers every 3 days
  //    - Day 15+: 2–4 new offers every 2 days (max 7 pending offers at once)
  const isEarlyPeriod = date.gameDay <= EARLY_OFFERS_DAY_LIMIT;
  const intervalDays = isEarlyPeriod ? EARLY_OFFERS_INTERVAL_DAYS : LATE_OFFERS_INTERVAL_DAYS;

  if (date.gameDay - nextState.lastOfferGenerationGameDay >= intervalDays) {
    let desiredCount = EARLY_OFFERS_BATCH_SIZE;
    let rngState = nextState.rngState;

    if (!isEarlyPeriod) {
      const countStep = rngInt(rngState, LATE_OFFERS_BATCH_MIN, LATE_OFFERS_BATCH_MAX);
      desiredCount = countStep.value;
      rngState = countStep.nextState;
      nextState = { ...nextState, rngState };
    }

    nextState = generateOffersBatch(nextState, desiredCount, dayStartMinutes, buildings);
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

      // 4. Expire old offers (4 days) and generate new offers on schedule
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
 * Computes the ordered list of independent scheduled `Odbiór` (pickup) and `Rozwózka` (delivery)
 * tasks for a given weekday (0 = Pon .. 6 = Nd) within the current calendar week,
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
    order: ActiveOrder;
    taskLabel: string;
    packageCount: number;
  }> = [];

  for (const order of state.activeOrders) {
    if (order.status !== 'active') continue;
    const storedInWarehouse = getStoredPackagesForOrder(state, order.id);

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
          if (remainingPickupToday > 0) {
            unsorted.push({
              taskId: makeWeeklyTaskId(order.id, 'pickup'),
              taskType: 'pickup',
              order,
              taskLabel: 'Odbiór',
              packageCount: remainingPickupToday,
            });
          }
          const deliveryCountToday = storedInWarehouse + remainingPickupToday;
          if (deliveryCountToday > 0) {
            unsorted.push({
              taskId: makeWeeklyTaskId(order.id, 'delivery'),
              taskType: 'delivery',
              order,
              taskLabel: 'Rozwózka',
              packageCount: deliveryCountToday,
            });
          }
        } else if (dayQuota > 0) {
          unsorted.push({
            taskId: makeWeeklyTaskId(order.id, 'pickup'),
            taskType: 'pickup',
            order,
            taskLabel: 'Odbiór',
            packageCount: dayQuota,
          });
          unsorted.push({
            taskId: makeWeeklyTaskId(order.id, 'delivery'),
            taskType: 'delivery',
            order,
            taskLabel: 'Rozwózka',
            packageCount: dayQuota,
          });
        }
      } else if (isToday && storedInWarehouse > 0) {
        // Packages left over in Base warehouse from an earlier pickup day
        unsorted.push({
          taskId: makeWeeklyTaskId(order.id, 'delivery'),
          taskType: 'delivery',
          order,
          taskLabel: 'Rozwózka',
          packageCount: storedInWarehouse,
        });
      }
    } else {
      const lastActiveDay = Math.max(order.acceptedAtGameDay, order.endGameDay - 1);
      if (targetGameDay >= order.acceptedAtGameDay && targetGameDay <= lastActiveDay) {
        const remainingToDeliver = Math.max(0, order.totalPackages - order.deliveredPackagesTotal);
        const remainingToPickup = Math.max(0, remainingToDeliver - storedInWarehouse);

        if (remainingToPickup > 0) {
          unsorted.push({
            taskId: makeWeeklyTaskId(order.id, 'pickup'),
            taskType: 'pickup',
            order,
            taskLabel: 'Odbiór',
            packageCount: remainingToPickup,
          });
        }
        if (remainingToDeliver > 0) {
          unsorted.push({
            taskId: makeWeeklyTaskId(order.id, 'delivery'),
            taskType: 'delivery',
            order,
            taskLabel: 'Rozwózka',
            packageCount: remainingToDeliver,
          });
        }
      }
    }
  }

  const savedOrder = state.weeklyPriorityOrder[weekdayIndex] ?? [];
  const rankLookup = new Map<string, number>();
  savedOrder.forEach((id, idx) => rankLookup.set(id, idx));

  const getRank = (item: { taskId: string; order: ActiveOrder }): number => {
    const exact = rankLookup.get(item.taskId);
    if (exact !== undefined) return exact;
    const legacy = rankLookup.get(item.order.id);
    if (legacy !== undefined) return legacy;
    return Number.MAX_SAFE_INTEGER;
  };

  unsorted.sort((a, b) => {
    const rankA = getRank(a);
    const rankB = getRank(b);
    if (rankA !== rankB) return rankA - rankB;
    if (a.order.acceptedAtMinutes !== b.order.acceptedAtMinutes) {
      return a.order.acceptedAtMinutes - b.order.acceptedAtMinutes;
    }
    if (a.taskType !== b.taskType) {
      return a.taskType === 'pickup' ? -1 : 1;
    }
    return 0;
  });

  return unsorted.map((item, idx) => ({
    taskId: item.taskId,
    taskType: item.taskType,
    orderId: item.order.id,
    orderNumber: item.order.orderNumber,
    weekdayIndex,
    kind: item.order.kind,
    clientName: item.order.clientName,
    pickupAddress: item.order.pickupLocation.address,
    taskLabel: item.taskLabel,
    packageCount: item.packageCount,
    satisfaction: item.order.satisfaction,
    priorityRank: idx + 1,
  }));
}

/**
 * Moves an individual scheduled task (`Odbiór` or `Rozwózka`) up or down in priority
 * within a specific weekday (0 = Pon .. 6 = Nd) and persists the updated sequence in
 * `state.weeklyPriorityOrder` for courier dispatch.
 */
export function moveWeeklyTaskPriority(
  state: OrderEconomyState,
  weekdayIndex: number,
  taskId: string,
  direction: 'up' | 'down',
  currentGameDay: number
): OrderEconomyState {
  const visibleTasks = getScheduledTasksForWeekday(state, weekdayIndex, currentGameDay);
  const currentIdx = visibleTasks.findIndex((t) => t.taskId === taskId);
  if (currentIdx === -1) return state;

  const swapIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
  if (swapIdx < 0 || swapIdx >= visibleTasks.length) return state;

  const reorderedVisibleIds = visibleTasks.map((t) => t.taskId);
  const tmp = reorderedVisibleIds[currentIdx];
  reorderedVisibleIds[currentIdx] = reorderedVisibleIds[swapIdx];
  reorderedVisibleIds[swapIdx] = tmp;

  const visibleSet = new Set(reorderedVisibleIds);
  const trailingHiddenIds = (state.weeklyPriorityOrder[weekdayIndex] ?? []).filter(
    (id) => !visibleSet.has(id)
  );

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
    return Math.max(0, order.totalPackages - order.deliveredPackagesTotal - storedInWarehouse);
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
    if (task.taskType !== 'pickup') continue;
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

/**
 * Picks a random deliverable city building as a package recipient, strictly excluding
 * Base and the order's sender building.
 */
export function pickRandomRecipientBuildingForPackage(
  buildings: readonly Building[],
  senderBuildingId: string | null
): Building | null {
  const eligible = buildings.filter(
    (b) =>
      b.typ !== 'baza' &&
      b.dostepnyDlaDostaw !== false &&
      b.deliveryStopPoint !== undefined &&
      b.roadApproachPoint !== undefined &&
      b.id !== senderBuildingId
  );
  if (eligible.length === 0) return null;
  const idx = Math.floor(Math.random() * eligible.length);
  return eligible[idx] ?? eligible[0];
}

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

  for (let candidateGameDay = currentGameDay + 1; candidateGameDay <= searchLimitDay; candidateGameDay++) {
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
