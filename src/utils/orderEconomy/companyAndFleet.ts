import type { Building } from '../../types/building';
import type {
  ActiveVehicleSelection,
  ActiveVehicleType,
  CompanyCourier,
  CompanyEmployee,
  CourierQualification,
  EmployeeLicenseUpgradeInfo,
  HirableEmployeeRole,
  MonthlyCostBreakdown,
  OrderEconomyState,
  OwnedVan,
  ParkingSpotUpgradeInfo,
  UpgradePurchaseResult,
  VanModelId,
  VehicleRepairRequestResult,
  VehicleRepairTask,
  WarehouseLoadForBikeResult,
  WarehouseLoadedBatch,
  WarehouseTier,
  WarehouseTierConfig,
  WarehouseUnloadResult,
  WarehouseUpgradeInfo,
} from '../../types/orders';
import { PROCEDURAL_BUILDINGS } from '../buildings';
import {
  INITIAL_BALANCE,
  INITIAL_GAME_MINUTES,
  MINUTES_PER_DAY,
  getCalendarDateFromElapsedDays,
} from '../gameClock';
import {
  BICYCLE_PURCHASE_COST,
  BIKE_COURIER_CAPACITY,
  BIKE_WEAR_PER_WORLD_PX,
  COURIER_INSURANCE_COST,
  DEFAULT_LEGACY_VAN_MODEL_ID,
  DEFAULT_VEHICLE_DURABILITY,
  EMPLOYEE_LICENSE_COSTS,
  HIRED_BIKE_COURIER_SALARY,
  HIRED_VAN_DRIVER_SALARY,
  INITIAL_BICYCLES,
  INITIAL_MAX_EMPLOYEES,
  INITIAL_OFFERS_COUNT,
  INITIAL_PARKING_SPOTS,
  INITIAL_VANS,
  INITIAL_WAREHOUSE_TIER,
  LOW_DURABILITY_SPEED_MULTIPLIER,
  LOW_DURABILITY_SPEED_THRESHOLD,
  MAX_BICYCLES,
  MAX_EMPLOYEES,
  MAX_PARKING_SPOTS,
  MAX_VANS,
  MAX_WAREHOUSE_TIER,
  NEW_VAN_WEAR_PER_WORLD_PX,
  PARKING_SPOT_COST,
  REPAIR_AVAILABLE_DURABILITY_THRESHOLD,
  USED_VAN_WEAR_PER_WORLD_PX,
  VAN_COURIER_CAPACITY,
  VAN_MODELS,
  WAREHOUSE_TIERS,
  clampVehicleDurability,
  createClockRandomSeed,
  createDefaultOwnedVans,
  createEmptyWeeklyPriorityOrder,
  createOwnedVan,
  getVanModelSpec,
  roundCurrency,
} from './constantsAndHelpers';
import { generateOffersBatch } from './offerGenerator';

/** Returns package capacity for the selected generic vehicle type (5 for bicycle, max 20 for van) */
export function getVehicleCourierCapacity(vehicleType: ActiveVehicleType): number {
  return vehicleType === 'van' ? VAN_COURIER_CAPACITY : BIKE_COURIER_CAPACITY;
}

/** Returns the normalized list of owned delivery vans (falls back cleanly for legacy saves). */
export function getOwnedVans(state: OrderEconomyState): OwnedVan[] {
  if (Array.isArray(state.vans) && state.vans.length > 0) {
    return state.vans;
  }
  const legacyCount = Math.max(0, state.vansCount ?? state.deliveryVansCount ?? INITIAL_VANS);
  if (legacyCount > 0) {
    return createDefaultOwnedVans(legacyCount, DEFAULT_LEGACY_VAN_MODEL_ID);
  }
  return [];
}

/** Finds an owned delivery van by its 1-based fleet index (`Bus #1..#8`). */
export function getOwnedVanByIndex(
  state: OrderEconomyState,
  index: number
): OwnedVan | undefined {
  const vans = getOwnedVans(state);
  return vans.find((v) => v.index === index) ?? vans[index - 1];
}

/**
 * Returns the exact package carrying capacity for a concrete vehicle selection
 * (`5` for any bicycle, or `10 / 12 / 14 / 15 / 17 / 20` matching the specific `Bus #N` model).
 */
export function getVehicleCourierCapacityForSelection(
  state: OrderEconomyState,
  selection: ActiveVehicleSelection | null | undefined
): number {
  if (!selection || selection.type === 'bike') {
    return BIKE_COURIER_CAPACITY;
  }
  const ownedVan = getOwnedVanByIndex(state, selection.index);
  if (!ownedVan) {
    return VAN_MODELS[DEFAULT_LEGACY_VAN_MODEL_ID].capacity;
  }
  return getVanModelSpec(ownedVan.modelId).capacity;
}

// ============================================================================
// Courier Roster & Vehicle Assignment Helpers
// ============================================================================

/**
 * Returns whether a courier is qualified to drive the given vehicle type.
 * - Bicycles: all couriers (Owner, Rower, Rower + Bus)
 * - Vans: only Właściciel (#1) and couriers with 'bike_and_van' qualification
 */
export function canCourierDriveVehicle(
  courier: Pick<CompanyCourier, 'isOwner' | 'qualification'>,
  vehicleType: ActiveVehicleType
): boolean {
  if (vehicleType === 'bike') return true;
  return courier.isOwner || courier.qualification === 'bike_and_van';
}

/**
 * Returns the monthly salary in USD for a courier slot based on qualification profile:
 * - Kurier #1 (Właściciel): $0/mies. (Rower + Bus from start)
 * - Vacant/locked slot: $0/mies.
 * - Hired courier (#2–#6) with 'bike_only' qualification: $1 600/mies.
 * - Hired courier (#2–#6) with 'bike_and_van' qualification: $2 300/mies.
 */
export function getCourierMonthlySalary(
  isOwner: boolean,
  hired: boolean,
  qualification: CourierQualification = 'bike_only'
): number {
  if (isOwner || !hired) return 0;
  return qualification === 'bike_and_van' ? HIRED_VAN_DRIVER_SALARY : HIRED_BIKE_COURIER_SALARY;
}

export function vehiclesEqual(
  a: ActiveVehicleSelection | null | undefined,
  b: ActiveVehicleSelection | null | undefined
): boolean {
  return Boolean(a && b && a.type === b.type && a.index === b.index);
}

/** Lists all concrete vehicles currently owned by the company (Rower #1–3, Bus #1–8). */
export function getOwnedFleetVehicles(state: OrderEconomyState): ActiveVehicleSelection[] {
  const bikesCount = Math.max(
    INITIAL_BICYCLES,
    state.bikesCount ?? state.bicyclesCount ?? INITIAL_BICYCLES
  );
  const vansCount = getOwnedVans(state).length;
  const list: ActiveVehicleSelection[] = [];
  for (let i = 1; i <= bikesCount; i++) {
    list.push({ type: 'bike', index: i });
  }
  for (let i = 1; i <= vansCount; i++) {
    list.push({ type: 'van', index: i });
  }
  return list;
}

/** Finds a hired courier (optionally excluding `excludeSlotIndex`) currently assigned to `vehicle`. */
export function findCourierAssignedToVehicle(
  couriers: readonly CompanyCourier[],
  vehicle: ActiveVehicleSelection,
  excludeSlotIndex?: number
): CompanyCourier | null {
  for (const c of couriers) {
    if (!c.hired) continue;
    if (excludeSlotIndex !== undefined && c.slotIndex === excludeSlotIndex) continue;
    if (vehiclesEqual(c.assignedVehicle, vehicle)) {
      return c;
    }
  }
  return null;
}

/** Counts currently employed couriers across all 6 company slots (includes Kurier #1 Właściciel). */
export function countHiredCouriers(state: OrderEconomyState): number {
  if (state.couriers && state.couriers.length > 0) {
    return state.couriers.filter((c) => c.hired).length;
  }
  return state.employees.length;
}

function syncEmployeesFromCouriers(couriers: readonly CompanyCourier[]): CompanyEmployee[] {
  const result: CompanyEmployee[] = [];
  for (const c of couriers) {
    if (!c.hired) continue;
    const hasVanLicense = c.qualification === 'bike_and_van';
    result.push({
      id: c.isOwner ? 'emp-owner' : c.id,
      name: c.name,
      role: c.isOwner ? 'owner_bike_courier' : hasVanLicense ? 'van_driver' : 'bike_courier',
      isOwner: c.isOwner,
      monthlySalary: c.monthlySalary,
      monthlyInsurance: 0,
      hiredAtGameDay: c.hiredAtGameDay ?? 1,
    });
  }
  return result;
}

function createInitialCouriers(
  startGameDay: number,
  ownerVehicle: ActiveVehicleSelection
): CompanyCourier[] {
  return Array.from({ length: MAX_EMPLOYEES }, (_, idx) => {
    const slotIndex = idx + 1;
    const isOwner = slotIndex === 1;
    return {
      slotIndex,
      id: `courier-${slotIndex}`,
      name: isOwner ? 'Właściciel' : `Kurier #${slotIndex}`,
      isOwner,
      unlocked: isOwner,
      hired: isOwner,
      qualification: isOwner ? 'bike_and_van' : 'bike_only',
      assignedVehicle: isOwner ? { ...ownerVehicle } : null,
      monthlySalary: 0,
      hiredAtGameDay: isOwner ? startGameDay : null,
    };
  });
}

// ============================================================================
// Initial State Factory
// ============================================================================

export function createInitialOrderEconomyState(
  buildings: readonly Building[] = PROCEDURAL_BUILDINGS,
  initialSeed = 133742,
  randomSeed?: number
): OrderEconomyState {
  const startDate = getCalendarDateFromElapsedDays(0);

  const starterWarehouse = getWarehouseTierConfig(INITIAL_WAREHOUSE_TIER);
  const starterVehicle: ActiveVehicleSelection = { type: 'bike', index: 1 };
  const initialCouriers = createInitialCouriers(startDate.gameDay, starterVehicle);
  const initialEmployees = syncEmployeesFromCouriers(initialCouriers);

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
    couriers: initialCouriers,
    employees: initialEmployees,
    bikesCount: INITIAL_BICYCLES,
    bicyclesCount: INITIAL_BICYCLES,
    bikeDurabilities: Array.from({ length: INITIAL_BICYCLES }, () => DEFAULT_VEHICLE_DURABILITY),
    vans: [],
    vansCount: INITIAL_VANS,
    deliveryVansCount: INITIAL_VANS,
    activeVehicle: starterVehicle,
    pendingVehicleRepairs: [],
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
    randomRngState: (randomSeed ?? createClockRandomSeed()) >>> 0,
    weeklyPriorityOrder: createEmptyWeeklyPriorityOrder(),
  };

  // Day 1 starts with 2 deterministic unread offers immediately available
  return generateOffersBatch(baseState, INITIAL_OFFERS_COUNT, INITIAL_GAME_MINUTES, buildings, false);
}

// ============================================================================
// Employee Salaries, Insurance, Monthly Cost Breakdown & Fleet Helpers
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
  const ownedVans = getOwnedVans(state);

  let salariesCost = 0;

  if (state.couriers && state.couriers.length > 0) {
    for (const courier of state.couriers) {
      salariesCost += getCourierMonthlySalary(
        courier.isOwner,
        courier.hired,
        courier.qualification
      );
    }
  } else {
    for (const emp of state.employees) {
      if (!emp.isOwner) {
        salariesCost += emp.monthlySalary;
      }
    }
  }

  let vanInsuranceRaw = 0;
  for (const van of ownedVans) {
    vanInsuranceRaw += getVanModelSpec(van.modelId).monthlyInsurance;
  }

  salariesCost = roundCurrency(salariesCost);
  const courierInsuranceCost = roundCurrency(additionalBikes * COURIER_INSURANCE_COST);
  const vanInsuranceCost = roundCurrency(vanInsuranceRaw);
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
  const normalizedBikeDurabilities = getNormalizedBikeDurabilities(state, currentBikes);
  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - BICYCLE_PURCHASE_COST),
      bikesCount: nextBikes,
      bicyclesCount: nextBikes,
      bikeDurabilities: [...normalizedBikeDurabilities, DEFAULT_VEHICLE_DURABILITY],
    },
    purchased: true,
    cost: BICYCLE_PURCHASE_COST,
  };
}

// ============================================================================
// Vehicle Durability, Dynamic Repair Cost & Service Queue Helpers
// ============================================================================

export function makeVehicleRepairTaskId(vehicle: ActiveVehicleSelection): string {
  return `repair:${vehicle.type}:${vehicle.index}`;
}

export function getNormalizedBikeDurabilities(
  state: OrderEconomyState,
  bikesCountOverride?: number
): number[] {
  const count = Math.max(
    INITIAL_BICYCLES,
    Math.min(MAX_BICYCLES, bikesCountOverride ?? state.bikesCount ?? state.bicyclesCount ?? INITIAL_BICYCLES)
  );
  const raw = Array.isArray(state.bikeDurabilities) ? state.bikeDurabilities : [];
  return Array.from({ length: count }, (_, idx) =>
    typeof raw[idx] === 'number' && Number.isFinite(raw[idx])
      ? clampVehicleDurability(raw[idx])
      : DEFAULT_VEHICLE_DURABILITY
  );
}

/** Returns current durability (0–100) for any owned bicycle or delivery van. */
export function getVehicleDurability(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection | null | undefined
): number {
  if (!vehicle) return DEFAULT_VEHICLE_DURABILITY;
  if (vehicle.type === 'bike') {
    const durabilities = getNormalizedBikeDurabilities(state);
    return durabilities[vehicle.index - 1] ?? DEFAULT_VEHICLE_DURABILITY;
  }
  const van = getOwnedVanByIndex(state, vehicle.index);
  if (!van) return DEFAULT_VEHICLE_DURABILITY;
  return typeof van.durability === 'number' && Number.isFinite(van.durability)
    ? clampVehicleDurability(van.durability)
    : DEFAULT_VEHICLE_DURABILITY;
}

/** Returns the cruising speed multiplier for a vehicle (0.8 below 25% durability, otherwise 1.0). */
export function getVehicleDurabilitySpeedMultiplier(durability: number): number {
  return durability < LOW_DURABILITY_SPEED_THRESHOLD ? LOW_DURABILITY_SPEED_MULTIPLIER : 1;
}

/** Returns wear rate (% durability lost per world pixel driven) for the concrete vehicle. */
export function getVehicleWearPerWorldPx(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection
): number {
  if (vehicle.type === 'bike') {
    return BIKE_WEAR_PER_WORLD_PX;
  }
  const van = getOwnedVanByIndex(state, vehicle.index);
  const condition = van?.condition ?? 'used';
  return condition === 'new' ? NEW_VAN_WEAR_PER_WORLD_PX : USED_VAN_WEAR_PER_WORLD_PX;
}

/**
 * Dynamic repair cost scaling with wear (100 - durability) and vehicle class/model:
 * - Bicycle (50% wear): ~$57 ($45–$65 range)
 * - Vans (50% wear): ~$270–$450 depending on Used/New & Lite/Standard/Pro tier
 */
export function calculateVehicleRepairCost(
  vehicleType: ActiveVehicleType,
  durability: number,
  vanModelId?: VanModelId
): number {
  const clamped = clampVehicleDurability(durability);
  const wear = Math.max(0, 100 - clamped);
  if (wear <= 0.01) return 0;

  if (vehicleType === 'bike') {
    return Math.round(12 + wear * 0.9);
  }

  const modelId: VanModelId = vanModelId ?? DEFAULT_LEGACY_VAN_MODEL_ID;
  const vanRates: Record<VanModelId, { base: number; perWearPct: number }> = {
    used_lite: { base: 45, perWearPct: 4.5 },
    used_standard: { base: 55, perWearPct: 5.3 },
    used_pro: { base: 65, perWearPct: 6.3 },
    new_lite: { base: 60, perWearPct: 5.4 },
    new_standard: { base: 70, perWearPct: 6.4 },
    new_pro: { base: 80, perWearPct: 7.4 },
  };
  const rate = vanRates[modelId] ?? vanRates[DEFAULT_LEGACY_VAN_MODEL_ID];
  return Math.round(rate.base + wear * rate.perWearPct);
}

/** Lists all currently queued/pending vehicle repair tasks. */
export function getPendingVehicleRepairs(state: OrderEconomyState): VehicleRepairTask[] {
  return Array.isArray(state.pendingVehicleRepairs) ? state.pendingVehicleRepairs : [];
}

/** Finds a pending repair task for the given vehicle, if any. */
export function getPendingRepairForVehicle(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection | null | undefined
): VehicleRepairTask | null {
  if (!vehicle) return null;
  const repairs = getPendingVehicleRepairs(state);
  return repairs.find((r) => vehiclesEqual(r.vehicle, vehicle)) ?? null;
}

/** Returns true if the given vehicle is queued for or undergoing mechanic repair. */
export function isVehicleRepairPending(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection | null | undefined
): boolean {
  return getPendingRepairForVehicle(state, vehicle) !== null;
}

/**
 * Checks whether a qualified hired courier is currently assigned to drive `vehicle`
 * to the Mechanic Garage.
 */
export function getRepairCourierReadiness(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection
): { ready: boolean; courier: CompanyCourier | null; reason?: 'no_courier' | 'no_van_license' } {
  const assigned = findCourierAssignedToVehicle(state.couriers ?? [], vehicle);
  if (!assigned) {
    return { ready: false, courier: null, reason: 'no_courier' };
  }
  if (!canCourierDriveVehicle(assigned, vehicle.type)) {
    return { ready: false, courier: assigned, reason: 'no_van_license' };
  }
  return { ready: true, courier: assigned };
}

/**
 * Orders a mechanic repair for `vehicle` if durability < 80%, not already pending, and cash covers cost.
 * Deducts repair cost immediately and adds a repair task to today's Plan tygodnia.
 */
export function requestVehicleRepair(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection,
  currentGameDay?: number
): VehicleRepairRequestResult {
  const bikesCount = Math.max(
    INITIAL_BICYCLES,
    state.bikesCount ?? state.bicyclesCount ?? INITIAL_BICYCLES
  );
  const ownedVans = getOwnedVans(state);

  let vanModelId: VanModelId | undefined;
  if (vehicle.type === 'bike') {
    if (!Number.isInteger(vehicle.index) || vehicle.index < 1 || vehicle.index > bikesCount) {
      return { state, queued: false, cost: 0, reason: 'not_found' };
    }
  } else {
    const ownedVan = getOwnedVanByIndex(state, vehicle.index);
    if (!ownedVan || vehicle.index < 1 || vehicle.index > ownedVans.length) {
      return { state, queued: false, cost: 0, reason: 'not_found' };
    }
    vanModelId = ownedVan.modelId;
  }

  if (isVehicleRepairPending(state, vehicle)) {
    return { state, queued: false, cost: 0, reason: 'already_pending' };
  }

  const durability = getVehicleDurability(state, vehicle);
  if (durability >= REPAIR_AVAILABLE_DURABILITY_THRESHOLD) {
    return { state, queued: false, cost: 0, reason: 'above_threshold' };
  }

  const cost = calculateVehicleRepairCost(vehicle.type, durability, vanModelId);
  if (state.balance < cost) {
    return { state, queued: false, cost, reason: 'insufficient_funds' };
  }

  const gameDay =
    currentGameDay ?? Math.floor(state.lastProcessedMinutes / MINUTES_PER_DAY) + 1;
  const newTask: VehicleRepairTask = {
    id: makeVehicleRepairTaskId(vehicle),
    vehicle: { type: vehicle.type, index: vehicle.index },
    requestedAtGameDay: gameDay,
    costPaid: cost,
  };

  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - cost),
      pendingVehicleRepairs: [...getPendingVehicleRepairs(state), newTask],
    },
    queued: true,
    cost,
  };
}

/**
 * Applies batched distance-driven wear deltas to one or more vehicles cleanly in a single immutable update.
 */
export function applyVehicleWearBatch(
  state: OrderEconomyState,
  wearEntries: ReadonlyArray<{ vehicle: ActiveVehicleSelection; distancePx: number }>
): OrderEconomyState {
  if (wearEntries.length === 0) return state;

  let nextBikeDurabilities: number[] | null = null;
  let nextVans: OwnedVan[] | null = null;
  let changed = false;

  for (const entry of wearEntries) {
    if (!Number.isFinite(entry.distancePx) || entry.distancePx <= 0) continue;
    const rate = getVehicleWearPerWorldPx(state, entry.vehicle);
    const wearDelta = entry.distancePx * rate;
    if (wearDelta <= 0) continue;

    if (entry.vehicle.type === 'bike') {
      const idx = entry.vehicle.index - 1;
      const baseBikes: number[] = nextBikeDurabilities ?? getNormalizedBikeDurabilities(state);
      if (idx < 0 || idx >= baseBikes.length) continue;
      const prevDur = baseBikes[idx];
      const nextDur = clampVehicleDurability(prevDur - wearDelta);
      if (nextDur !== prevDur) {
        const updatedBikes: number[] = nextBikeDurabilities ?? [...baseBikes];
        updatedBikes[idx] = nextDur;
        nextBikeDurabilities = updatedBikes;
        changed = true;
      }
    } else {
      const baseVans: OwnedVan[] = nextVans ?? getOwnedVans(state);
      const targetIdx = baseVans.findIndex((v) => v.index === entry.vehicle.index);
      if (targetIdx === -1) continue;
      const prevDur =
        typeof baseVans[targetIdx].durability === 'number'
          ? baseVans[targetIdx].durability
          : DEFAULT_VEHICLE_DURABILITY;
      const nextDur = clampVehicleDurability(prevDur - wearDelta);
      if (nextDur !== prevDur) {
        const updatedVans: OwnedVan[] = nextVans ?? baseVans.map((v) => ({ ...v }));
        updatedVans[targetIdx] = { ...updatedVans[targetIdx], durability: nextDur };
        nextVans = updatedVans;
        changed = true;
      }
    }
  }

  if (!changed) return state;

  return {
    ...state,
    ...(nextBikeDurabilities ? { bikeDurabilities: nextBikeDurabilities } : {}),
    ...(nextVans ? { vans: nextVans } : {}),
  };
}

/**
 * Completes a mechanic repair for `vehicle`: restores durability to 100%, removes the task
 * from `pendingVehicleRepairs`, and cleans its task ID from `weeklyPriorityOrder`.
 */
export function completeVehicleRepair(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection
): OrderEconomyState {
  const repairTaskId = makeVehicleRepairTaskId(vehicle);
  const nextPendingRepairs = getPendingVehicleRepairs(state).filter(
    (r) => !vehiclesEqual(r.vehicle, vehicle) && r.id !== repairTaskId
  );

  let nextBikeDurabilities = getNormalizedBikeDurabilities(state);
  let nextVans = getOwnedVans(state);

  if (vehicle.type === 'bike') {
    const idx = vehicle.index - 1;
    if (idx >= 0 && idx < nextBikeDurabilities.length) {
      nextBikeDurabilities = [...nextBikeDurabilities];
      nextBikeDurabilities[idx] = DEFAULT_VEHICLE_DURABILITY;
    }
  } else {
    nextVans = nextVans.map((v) =>
      v.index === vehicle.index ? { ...v, durability: DEFAULT_VEHICLE_DURABILITY } : v
    );
  }

  const nextWeeklyPriority: Record<number, string[]> = {};
  for (let wd = 0; wd < 7; wd++) {
    nextWeeklyPriority[wd] = (state.weeklyPriorityOrder[wd] ?? []).filter(
      (id) => id !== repairTaskId
    );
  }

  return {
    ...state,
    bikeDurabilities: nextBikeDurabilities,
    vans: nextVans,
    pendingVehicleRepairs: nextPendingRepairs,
    weeklyPriorityOrder: nextWeeklyPriority,
  };
}

/**
 * Purchases a delivery van of the chosen `modelId` (Used/New × Lite/Standard/Pro)
 * if a free Base parking spot (`parkingSpots`) is available and balance covers the purchase price.
 */
export function purchaseVan(
  state: OrderEconomyState,
  modelId: VanModelId = DEFAULT_LEGACY_VAN_MODEL_ID
): UpgradePurchaseResult {
  const spec = getVanModelSpec(modelId);
  const existingVans = getOwnedVans(state);
  const currentVans = existingVans.length;
  if (currentVans >= MAX_VANS) {
    return { state, purchased: false, cost: 0, reason: 'max_reached' };
  }
  if (currentVans >= state.parkingSpots) {
    return { state, purchased: false, cost: spec.purchasePrice, reason: 'no_parking_spot' };
  }
  if (state.balance < spec.purchasePrice) {
    return { state, purchased: false, cost: spec.purchasePrice, reason: 'insufficient_funds' };
  }

  const nextIndex = currentVans + 1;
  const nextVans: OwnedVan[] = [...existingVans, createOwnedVan(nextIndex, spec.id)];
  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - spec.purchasePrice),
      vans: nextVans,
      vansCount: nextVans.length,
      deliveryVansCount: nextVans.length,
    },
    purchased: true,
    cost: spec.purchasePrice,
  };
}

/**
 * Backwards-compatible alias for purchasing a Used Standard delivery van.
 */
export function purchaseUsedVan(state: OrderEconomyState): UpgradePurchaseResult {
  return purchaseVan(state, DEFAULT_LEGACY_VAN_MODEL_ID);
}

/**
 * Assigns a specific vehicle from the owned fleet (or `null` = "Brak pojazdu" for slots #2–#6)
 * to the courier in `slotIndex`. Enforces strict uniqueness (one vehicle per courier) and
 * keeps Kurier #1 (Właściciel) synchronized with `state.activeVehicle`.
 * Caller enforces that the target courier is currently at Base.
 */
export function assignCourierVehicle(
  state: OrderEconomyState,
  slotIndex: number,
  vehicle: ActiveVehicleSelection | null
): OrderEconomyState {
  const target = state.couriers.find((c) => c.slotIndex === slotIndex);
  if (!target || !target.unlocked || !target.hired) {
    return state;
  }

  // Kurier #1 (Właściciel) always stays bound to a concrete owned vehicle so map simulation stays active
  if (target.isOwner && vehicle === null) {
    return state;
  }

  const bikesCount = Math.max(
    INITIAL_BICYCLES,
    state.bikesCount ?? state.bicyclesCount ?? INITIAL_BICYCLES
  );
  const vansCount = Math.max(0, state.vansCount ?? state.deliveryVansCount ?? INITIAL_VANS);

  if (vehicle !== null) {
    if (!Number.isInteger(vehicle.index) || vehicle.index < 1) {
      return state;
    }
    if (vehicle.type === 'bike' && vehicle.index > bikesCount) {
      return state;
    }
    if (vehicle.type === 'van' && vehicle.index > vansCount) {
      return state;
    }
    if (!canCourierDriveVehicle(target, vehicle.type)) {
      return state;
    }
    if (findCourierAssignedToVehicle(state.couriers, vehicle, slotIndex) !== null) {
      return state;
    }
  }

  if (
    (target.assignedVehicle === null && vehicle === null) ||
    vehiclesEqual(target.assignedVehicle, vehicle)
  ) {
    return state;
  }

  const nextAssigned = vehicle ? { type: vehicle.type, index: vehicle.index } : null;
  const nextCouriers = state.couriers.map((c) =>
    c.slotIndex === slotIndex
      ? {
          ...c,
          assignedVehicle: nextAssigned,
          monthlySalary: getCourierMonthlySalary(c.isOwner, c.hired, c.qualification),
        }
      : c
  );

  return {
    ...state,
    couriers: nextCouriers,
    employees: syncEmployeesFromCouriers(nextCouriers),
    ...(target.isOwner && nextAssigned ? { activeVehicle: nextAssigned } : {}),
  };
}

/**
 * Updates the owner courier's (Kurier #1) active vehicle selection among free owned bicycles and vans.
 * Synchronizes both `activeVehicle` and `couriers[0].assignedVehicle`.
 */
export function setOwnerActiveVehicle(
  state: OrderEconomyState,
  vehicle: ActiveVehicleSelection
): OrderEconomyState {
  return assignCourierVehicle(state, 1, vehicle);
}

/**
 * Hires a new courier in an unlocked, vacant license slot (#2–#6) with $0 recruitment fee.
 * Accepts chosen qualification profile:
 * - `'bike_only'`: $1 600/mies., may only drive bicycles
 * - `'bike_and_van'`: $2 300/mies., may drive bicycles and delivery vans
 */
export function hireCourierInSlot(
  state: OrderEconomyState,
  slotIndex: number,
  qualification: CourierQualification = 'bike_only',
  currentGameDay?: number
): { state: OrderEconomyState; hired: boolean; courier?: CompanyCourier } {
  const slot = state.couriers.find((c) => c.slotIndex === slotIndex);
  if (!slot || slot.isOwner || !slot.unlocked || slot.hired) {
    return { state, hired: false };
  }

  const bikesCount = Math.max(
    INITIAL_BICYCLES,
    state.bikesCount ?? state.bicyclesCount ?? INITIAL_BICYCLES
  );
  const vansCount = Math.max(0, state.vansCount ?? state.deliveryVansCount ?? INITIAL_VANS);
  let defaultVehicle: ActiveVehicleSelection | null = null;

  if (qualification === 'bike_and_van') {
    for (let i = 1; i <= vansCount; i++) {
      const candidate: ActiveVehicleSelection = { type: 'van', index: i };
      if (findCourierAssignedToVehicle(state.couriers, candidate) === null) {
        defaultVehicle = candidate;
        break;
      }
    }
  }

  if (defaultVehicle === null) {
    for (let i = 1; i <= bikesCount; i++) {
      const candidate: ActiveVehicleSelection = { type: 'bike', index: i };
      if (findCourierAssignedToVehicle(state.couriers, candidate) === null) {
        defaultVehicle = candidate;
        break;
      }
    }
  }

  const hiredAtGameDay =
    currentGameDay ?? Math.floor(state.lastProcessedMinutes / MINUTES_PER_DAY) + 1;
  const monthlySalary = getCourierMonthlySalary(false, true, qualification);

  let updatedCourier: CompanyCourier | undefined;
  const nextCouriers = state.couriers.map((c) => {
    if (c.slotIndex !== slotIndex) return c;
    updatedCourier = {
      ...c,
      hired: true,
      qualification,
      assignedVehicle: defaultVehicle,
      monthlySalary,
      hiredAtGameDay,
    };
    return updatedCourier;
  });

  return {
    state: {
      ...state,
      couriers: nextCouriers,
      employees: syncEmployeesFromCouriers(nextCouriers),
    },
    hired: true,
    courier: updatedCourier,
  };
}

/**
 * Promotes a hired bike-only courier (#2–#6) to 'bike_and_van' qualification (Rower + Bus),
 * unlocking van assignments and updating their monthly salary from $1 600 to $2 300/mies.
 */
export function promoteCourierInSlot(
  state: OrderEconomyState,
  slotIndex: number
): { state: OrderEconomyState; promoted: boolean; courier?: CompanyCourier } {
  const slot = state.couriers.find((c) => c.slotIndex === slotIndex);
  if (!slot || slot.isOwner || !slot.unlocked || !slot.hired || slot.qualification === 'bike_and_van') {
    return { state, promoted: false };
  }

  const nextSalary = getCourierMonthlySalary(false, true, 'bike_and_van');
  let updatedCourier: CompanyCourier | undefined;
  const nextCouriers = state.couriers.map((c) => {
    if (c.slotIndex !== slotIndex) return c;
    updatedCourier = {
      ...c,
      qualification: 'bike_and_van',
      monthlySalary: nextSalary,
    };
    return updatedCourier;
  });

  return {
    state: {
      ...state,
      couriers: nextCouriers,
      employees: syncEmployeesFromCouriers(nextCouriers),
    },
    promoted: true,
    courier: updatedCourier,
  };
}

/**
 * Fires a hired courier in slot #2–#6, freeing their assigned vehicle and keeping the
 * purchased license permanently unlocked for future hiring.
 * Caller enforces that the courier is currently at Base.
 */
export function fireCourierInSlot(
  state: OrderEconomyState,
  slotIndex: number
): { state: OrderEconomyState; fired: boolean } {
  const slot = state.couriers.find((c) => c.slotIndex === slotIndex);
  if (!slot || slot.isOwner || !slot.hired) {
    return { state, fired: false };
  }

  const nextCouriers = state.couriers.map((c) =>
    c.slotIndex === slotIndex
      ? {
          ...c,
          hired: false,
          qualification: 'bike_only' as const,
          assignedVehicle: null,
          monthlySalary: 0,
          hiredAtGameDay: null,
        }
      : c
  );

  return {
    state: {
      ...state,
      couriers: nextCouriers,
      employees: syncEmployeesFromCouriers(nextCouriers),
    },
    fired: true,
  };
}

/**
 * Legacy helper: hires an additional employee in the next unlocked vacant slot.
 */
export function hireEmployee(
  state: OrderEconomyState,
  role: HirableEmployeeRole,
  name?: string,
  currentGameDay?: number
): { state: OrderEconomyState; hired: boolean; employee?: CompanyEmployee } {
  const vacantSlot = state.couriers.find((c) => c.unlocked && !c.hired && !c.isOwner);
  if (!vacantSlot) {
    return { state, hired: false };
  }

  const qualification: CourierQualification = role === 'van_driver' ? 'bike_and_van' : 'bike_only';
  const res = hireCourierInSlot(state, vacantSlot.slotIndex, qualification, currentGameDay);
  if (!res.hired || !res.courier) {
    return { state, hired: false };
  }

  let nextState = res.state;
  if (name) {
    const renamedCouriers = nextState.couriers.map((c) =>
      c.slotIndex === vacantSlot.slotIndex ? { ...c, name } : c
    );
    nextState = {
      ...nextState,
      couriers: renamedCouriers,
      employees: syncEmployeesFromCouriers(renamedCouriers),
    };
  }

  const employee = nextState.employees.find((e) => e.id === vacantSlot.id);
  return {
    state: nextState,
    hired: true,
    employee: employee ?? {
      id: vacantSlot.id,
      name: name ?? vacantSlot.name,
      role,
      isOwner: false,
      monthlySalary: res.courier.monthlySalary,
      monthlyInsurance: 0,
      hiredAtGameDay: res.courier.hiredAtGameDay ?? 1,
    },
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
 * Checks whether the Base warehouse currently has enough free slots to fit the next
 * single-trip pickup batch (`min(vehicleCapacity, remainingOrderPackagesToPickup)`).
 * When the warehouse cannot accommodate the next batch, the courier temporarily leaves
 * the remaining ODBIÓR on the list and performs a single ROZWÓZKA run to free space.
 */
export function hasEnoughWarehouseSpaceForPickup(
  state: OrderEconomyState,
  remainingOrderPackagesToPickup: number,
  vehicleCapacity: number = BIKE_COURIER_CAPACITY
): boolean {
  if (remainingOrderPackagesToPickup <= 0) return false;
  const capacity = getEffectiveWarehouseCapacity(state);
  const freeSpace = Math.max(0, capacity - state.warehousePackages);
  const nextBatchSize = Math.min(
    Math.max(1, Math.floor(vehicleCapacity)),
    remainingOrderPackagesToPickup,
    capacity
  );
  return freeSpace >= nextBatchSize;
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
 * Purchases the next individual employee license slot (1 -> 2 -> ... -> 6),
 * unlocking the corresponding courier position for hiring.
 */
export function purchaseEmployeeLicense(state: OrderEconomyState): UpgradePurchaseResult {
  const next = getNextEmployeeLicenseUpgrade(state);
  if (!next) {
    return { state, purchased: false, cost: 0, reason: 'max_reached' };
  }
  if (state.balance < next.cost) {
    return { state, purchased: false, cost: next.cost, reason: 'insufficient_funds' };
  }

  const nextCouriers = state.couriers.map((c) =>
    c.slotIndex === next.nextEmployeeSlot ? { ...c, unlocked: true } : c
  );

  return {
    state: {
      ...state,
      balance: roundCurrency(state.balance - next.cost),
      maxEmployees: next.nextEmployeeSlot,
      couriers: nextCouriers,
    },
    purchased: true,
    cost: next.cost,
  };
}
