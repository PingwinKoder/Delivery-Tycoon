import type {
  ActiveOrder,
  ActiveVehicleSelection,
  CompanyCourier,
  CurrentMonthLedger,
  OrderEconomyState,
  OrderOffer,
  OwnedScooter,
  OwnedVan,
  ReputationLevel,
  VehicleRepairTask,
  WarehouseLoadedBatch,
  WarehouseTier,
  WeeklyScheduleTask,
} from '../types/orders';
import {
  DAYS_PER_WEEK,
  INITIAL_GAME_MINUTES,
  MINUTES_PER_DAY,
} from './gameClock';
import {
  DEFAULT_LEGACY_SCOOTER_MODEL_ID,
  DEFAULT_LEGACY_VAN_MODEL_ID,
  DEFAULT_VEHICLE_DURABILITY,
  INITIAL_COMPANY_SATISFACTION,
  MAX_MONTHLY_SETTLEMENTS_HISTORY,
  MAX_TWO_WHEELERS,
  clampFuelLiters,
  clampFuelPrice,
  clampVehicleDurability,
  createDefaultOwnedVans,
  createEmptyCurrentMonthLedger,
  createOwnedScooter,
  createOwnedVan,
  getScooterModelSpec,
  getSeasonalTargetFuelPrice,
  getVanModelSpec,
  isValidScooterModelId,
  isValidVanModelId,
} from './orderEconomy/constantsAndHelpers';

export type SaveSlotId = 1 | 2 | 3;

export const SAVE_SLOT_IDS: readonly SaveSlotId[] = [1, 2, 3] as const;

export const SAVE_STORAGE_KEY = 'delivery_tycoon_saves_v1';

/**
 * Persisted courier slot snapshot extending `CompanyCourier` with runtime `inRoute` flag
 * (normalized to `false` on load so no vehicle starts stranded mid-intersection).
 */
export interface SavedCourierState extends CompanyCourier {
  inRoute: boolean;
}

/**
 * Full persistent snapshot of a player's company progress stored inside a save slot.
 */
export interface SavedGameState {
  /** Total elapsed in-game minutes (0 = Day 1, 00:00; 480 = Day 1, 08:00) */
  gameMinutes: number;
  /** 1-based gameplay day counter */
  gameDay: number;
  /** Current company cash balance in USD */
  cash: number;
  /** Total completed orders across the career */
  completedOrdersCount: number;
  /** Annual average client satisfaction % (synced with companySatisfaction) */
  annualSatisfactionAvg: number;
  /** Smooth continuous company satisfaction % (0–100, optional in legacy saves -> fallback 80) */
  companySatisfaction?: number;
  /** Live financial ledger for the current calendar month (optional in legacy saves) */
  currentMonthLedger?: CurrentMonthLedger;
  /** Current company reputation level (1–4) */
  reputationLevel: ReputationLevel;
  /** Base warehouse expansion tier (1–4) */
  warehouseLevel: WarehouseTier;
  /** Unlocked Base van parking spots (0–8) */
  parkingSpots: number;
  /** Number of owned bicycles (0–4 within shared two-wheeler shelter limit) */
  bikesCount: number;
  /** Mechanical durability (0–100%) per owned bicycle (optional in legacy saves -> defaults to 100) */
  bikeDurabilities?: number[];
  /** Owned delivery scooters sharing the 4-slot two-wheeler shelter (optional in legacy saves -> []) */
  scooters?: OwnedScooter[];
  /** Number of owned scooters (0–4, optional in legacy saves -> 0) */
  scootersCount?: number;
  /** Owned delivery vans with individual model IDs & durability (optional in legacy saves) */
  vans?: OwnedVan[];
  /** Number of owned delivery vans (0–8) */
  vansCount: number;
  /** Active vehicle assigned to the owner courier (#1) */
  activeVehicle: ActiveVehicleSelection;
  /** Pending mechanic repair tasks (optional in legacy saves -> defaults to []) */
  pendingVehicleRepairs?: VehicleRepairTask[];
  /** Complete 6-slot company courier roster with licenses, qualifications, vehicles & inRoute status */
  couriers: SavedCourierState[];
  /** Pending order offers waiting for player decision */
  offeredOrders: OrderOffer[];
  /** Currently active contracts & short-term orders */
  activeOrders: ActiveOrder[];
  /** Weekly schedule tasks grouped by weekday index (0 = Poniedziałek .. 6 = Niedziela) */
  weeklyPlan: Record<number, WeeklyScheduleTask[]>;
  /** Total packages currently stored in the Base warehouse */
  warehousePackages: number;
  /** Per-order package counts stored in the Base warehouse */
  warehouseInventory: Record<string, number>;
  /** Optional packages that were aboard vehicles in transit at save time (safely returned to Base on load) */
  inTransitCargo?: WarehouseLoadedBatch[];
  /** Current fuel market price in USD/L (optional in legacy saves -> derived from season) */
  currentFuelPricePerLiter?: number;
  /** Previous fuel market price in USD/L (optional in legacy saves) */
  previousFuelPricePerLiter?: number;
  /** 1-based gameplay day of the next fuel price update (optional in legacy saves) */
  nextFuelPriceChangeGameDay?: number;
  /** Full underlying economy state snapshot for exact lossless restoration */
  economyState?: OrderEconomyState;
}

export interface SaveSlotEntry {
  slotId: SaveSlotId;
  /** ISO-8601 real-world timestamp when this slot was last saved */
  updatedAt: string;
  state: SavedGameState;
}

type SaveSlotsMap = Record<SaveSlotId, SaveSlotEntry | null>;

function createEmptySaveSlots(): SaveSlotsMap {
  return {
    1: null,
    2: null,
    3: null,
  };
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clampWarehouseTier(value: unknown): WarehouseTier {
  const num = Number(value);
  if (num === 2 || num === 3 || num === 4) return num;
  return 1;
}

function clampReputationLevel(value: unknown): ReputationLevel {
  const num = Number(value);
  if (num === 2 || num === 3 || num === 4) return num;
  return 1;
}

function normalizeActiveVehicle(value: unknown): ActiveVehicleSelection {
  if (isPlainObject(value)) {
    const type =
      value.type === 'van' ? 'van' : value.type === 'scooter' ? 'scooter' : 'bike';
    const rawIdx = Number(value.index);
    const index = Number.isFinite(rawIdx) && rawIdx >= 1 ? Math.floor(rawIdx) : 1;
    return { type, index };
  }
  return { type: 'bike', index: 1 };
}

function normalizeOwnedScooters(rawScooters: unknown): OwnedScooter[] {
  if (!Array.isArray(rawScooters) || rawScooters.length === 0) {
    return [];
  }
  const normalized: OwnedScooter[] = [];
  for (let i = 0; i < rawScooters.length && normalized.length < MAX_TWO_WHEELERS; i++) {
    const entry = rawScooters[i];
    const modelId =
      isPlainObject(entry) && isValidScooterModelId(entry.modelId)
        ? entry.modelId
        : DEFAULT_LEGACY_SCOOTER_MODEL_ID;
    const durability =
      isPlainObject(entry) && typeof entry.durability === 'number' && Number.isFinite(entry.durability)
        ? clampVehicleDurability(entry.durability)
        : DEFAULT_VEHICLE_DURABILITY;
    const cap = getScooterModelSpec(modelId).fuelTankCapacityLiters;
    const fuelLiters =
      isPlainObject(entry) && typeof entry.fuelLiters === 'number' && Number.isFinite(entry.fuelLiters)
        ? clampFuelLiters(entry.fuelLiters, cap)
        : cap;
    normalized.push(createOwnedScooter(normalized.length + 1, modelId, durability, fuelLiters));
  }
  return normalized;
}

function normalizeOwnedVans(
  rawVans: unknown,
  fallbackCount: number,
  maxSpots: number
): OwnedVan[] {
  const limit = Math.max(0, Math.min(8, Math.floor(maxSpots)));
  if (Array.isArray(rawVans) && rawVans.length > 0) {
    const normalized: OwnedVan[] = [];
    for (let i = 0; i < rawVans.length && normalized.length < limit; i++) {
      const entry = rawVans[i];
      const modelId =
        isPlainObject(entry) && isValidVanModelId(entry.modelId)
          ? entry.modelId
          : DEFAULT_LEGACY_VAN_MODEL_ID;
      const durability =
        isPlainObject(entry) && typeof entry.durability === 'number' && Number.isFinite(entry.durability)
          ? clampVehicleDurability(entry.durability)
          : DEFAULT_VEHICLE_DURABILITY;
      const cap = getVanModelSpec(modelId).fuelTankCapacityLiters;
      const fuelLiters =
        isPlainObject(entry) && typeof entry.fuelLiters === 'number' && Number.isFinite(entry.fuelLiters)
          ? clampFuelLiters(entry.fuelLiters, cap)
          : cap;
      normalized.push(createOwnedVan(normalized.length + 1, modelId, durability, fuelLiters));
    }
    return normalized;
  }

  const safeFallbackCount = Math.max(0, Math.min(limit, Math.floor(fallbackCount)));
  return createDefaultOwnedVans(safeFallbackCount, DEFAULT_LEGACY_VAN_MODEL_ID);
}

function normalizeBikeDurabilities(rawDurabilities: unknown, bikesCount: number): number[] {
  const safeCount = Math.max(0, Math.min(MAX_TWO_WHEELERS, Math.floor(bikesCount)));
  const rawArr = Array.isArray(rawDurabilities) ? rawDurabilities : [];
  return Array.from({ length: safeCount }, (_, idx) => {
    const val = rawArr[idx];
    return typeof val === 'number' && Number.isFinite(val)
      ? clampVehicleDurability(val)
      : DEFAULT_VEHICLE_DURABILITY;
  });
}

function normalizePendingVehicleRepairs(
  rawRepairs: unknown,
  bikesCount: number,
  scootersCount: number,
  vansCount: number,
  fallbackGameDay: number
): VehicleRepairTask[] {
  if (!Array.isArray(rawRepairs)) return [];
  const seen = new Set<string>();
  const normalized: VehicleRepairTask[] = [];

  for (const item of rawRepairs) {
    if (!isPlainObject(item) || !isPlainObject(item.vehicle)) continue;
    const vehicle = normalizeActiveVehicle(item.vehicle);
    if (vehicle.type === 'bike' && (vehicle.index < 1 || vehicle.index > bikesCount)) continue;
    if (vehicle.type === 'scooter' && (vehicle.index < 1 || vehicle.index > scootersCount)) continue;
    if (vehicle.type === 'van' && (vehicle.index < 1 || vehicle.index > vansCount)) continue;

    const id = `repair:${vehicle.type}:${vehicle.index}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const requestedAtGameDay =
      typeof item.requestedAtGameDay === 'number' && Number.isFinite(item.requestedAtGameDay) && item.requestedAtGameDay >= 1
        ? Math.floor(item.requestedAtGameDay)
        : fallbackGameDay;
    const costPaid =
      typeof item.costPaid === 'number' && Number.isFinite(item.costPaid) && item.costPaid >= 0
        ? item.costPaid
        : 0;

    normalized.push({
      id,
      vehicle,
      requestedAtGameDay,
      costPaid,
    });
  }

  return normalized;
}

function stripLegacyTaskSuffix(taskKey: string): string {
  const sepIdx = taskKey.lastIndexOf(':');
  if (sepIdx === -1) return taskKey;
  const suffix = taskKey.slice(sepIdx + 1);
  if (suffix === 'pickup' || suffix === 'delivery') {
    return taskKey.slice(0, sepIdx);
  }
  return taskKey;
}

function normalizeWeeklyPriorityOrderMap(
  rawPriority: unknown
): Record<number, string[]> {
  const normalized: Record<number, string[]> = {};
  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    normalized[wd] = [];
  }
  if (!isPlainObject(rawPriority)) {
    return normalized;
  }

  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    const rawList = rawPriority[String(wd)] ?? rawPriority[wd];
    if (!Array.isArray(rawList)) continue;
    const seen = new Set<string>();
    const mergedIds: string[] = [];
    for (const item of rawList) {
      if (typeof item !== 'string' || item.length === 0) continue;
      const orderId = stripLegacyTaskSuffix(item);
      if (!seen.has(orderId)) {
        seen.add(orderId);
        mergedIds.push(orderId);
      }
    }
    normalized[wd] = mergedIds;
  }

  return normalized;
}

function normalizeAndMergeWeeklyPlan(
  rawPlan: unknown,
  activeOrders: readonly ActiveOrder[],
  warehouseInventory: Readonly<Record<string, number>>
): Record<number, WeeklyScheduleTask[]> {
  const normalized: Record<number, WeeklyScheduleTask[]> = {};
  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    normalized[wd] = [];
  }

  if (!isPlainObject(rawPlan)) {
    return normalized;
  }

  const activeById = new Map<string, ActiveOrder>();
  for (const order of activeOrders) {
    if (order && typeof order.id === 'string') {
      activeById.set(order.id, order);
    }
  }

  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    const dayList = rawPlan[String(wd)] ?? rawPlan[wd];
    if (!Array.isArray(dayList)) continue;

    const mergedByOrderId = new Map<
      string,
      {
        base: WeeklyScheduleTask;
        pickupRemaining?: number;
        deliveryRemaining?: number;
        hasUnifiedCounts: boolean;
      }
    >();
    const orderedOrderIds: string[] = [];

    for (const item of dayList) {
      if (!isPlainObject(item) || typeof item.taskId !== 'string') continue;
      const rawTask = item as unknown as Partial<WeeklyScheduleTask> & { taskId: string };
      // Repair tasks are derived dynamically from pendingVehicleRepairs on today's schedule
      if (rawTask.taskType === 'repair' || rawTask.taskId.startsWith('repair:')) continue;
      const orderId =
        typeof rawTask.orderId === 'string' && rawTask.orderId.length > 0
          ? rawTask.orderId
          : stripLegacyTaskSuffix(rawTask.taskId);

      const { assignedCourierId: _dropped, ...cleanFields } = rawTask;
      const rawCount = Math.max(0, Math.floor(Number(rawTask.packageCount) || 0));
      const hasUnifiedCounts =
        typeof rawTask.totalPackages === 'number' &&
        Number.isFinite(rawTask.totalPackages) &&
        typeof rawTask.pickedUpCount === 'number' &&
        Number.isFinite(rawTask.pickedUpCount) &&
        typeof rawTask.deliveredCount === 'number' &&
        Number.isFinite(rawTask.deliveredCount);

      let group = mergedByOrderId.get(orderId);
      if (!group) {
        orderedOrderIds.push(orderId);
        group = {
          base: {
            ...(cleanFields as WeeklyScheduleTask),
            taskId: orderId,
            taskType: 'order',
            orderId,
            weekdayIndex: wd,
            taskLabel: 'Realizacja',
            packageCount: rawCount,
            pickedUpCount: hasUnifiedCounts
              ? Math.max(0, Math.floor(rawTask.pickedUpCount!))
              : 0,
            deliveredCount: hasUnifiedCounts
              ? Math.max(0, Math.floor(rawTask.deliveredCount!))
              : 0,
            totalPackages: hasUnifiedCounts
              ? Math.max(0, Math.floor(rawTask.totalPackages!))
              : rawCount,
          },
          hasUnifiedCounts,
        };
        mergedByOrderId.set(orderId, group);
      } else if (hasUnifiedCounts && !group.hasUnifiedCounts) {
        group.base.totalPackages = Math.max(0, Math.floor(rawTask.totalPackages!));
        group.base.pickedUpCount = Math.max(0, Math.floor(rawTask.pickedUpCount!));
        group.base.deliveredCount = Math.max(0, Math.floor(rawTask.deliveredCount!));
        group.hasUnifiedCounts = true;
      }

      if (rawTask.taskType === 'pickup' || rawTask.taskId.endsWith(':pickup')) {
        group.pickupRemaining = Math.max(group.pickupRemaining ?? 0, rawCount);
      } else if (rawTask.taskType === 'delivery' || rawTask.taskId.endsWith(':delivery')) {
        group.deliveryRemaining = Math.max(group.deliveryRemaining ?? 0, rawCount);
      }
    }

    normalized[wd] = orderedOrderIds.map((orderId, idx) => {
      const group = mergedByOrderId.get(orderId)!;
      const base = group.base;

      let totalPackages = base.totalPackages;
      let pickedUpCount = base.pickedUpCount;
      let deliveredCount = base.deliveredCount;
      let packageCount = base.packageCount;

      if (!group.hasUnifiedCounts) {
        const order = activeById.get(orderId);
        if (order && order.kind === 'short_term') {
          totalPackages = Math.max(0, order.totalPackages);
          deliveredCount = Math.min(totalPackages, Math.max(0, order.deliveredPackagesTotal));
          const stored = Math.max(0, Math.floor(Number(warehouseInventory[orderId]) || 0));
          pickedUpCount = Math.min(
            totalPackages,
            Math.max(order.pickedUpPackagesTotal ?? 0, deliveredCount + stored)
          );
          packageCount = Math.max(0, totalPackages - deliveredCount);
        } else if (order && order.kind === 'long_term') {
          const idxInPickups = order.pickupWeekdays.indexOf(wd);
          const basePerDay = Math.floor(order.packagesPerWeek / order.pickupDaysPerWeek);
          const remainder = order.packagesPerWeek % order.pickupDaysPerWeek;
          const dayQuota =
            idxInPickups >= 0 ? basePerDay + (idxInPickups < remainder ? 1 : 0) : 0;
          const pickupRem = group.pickupRemaining ?? 0;
          const deliveryRem = group.deliveryRemaining ?? pickupRem;
          totalPackages = Math.max(dayQuota, pickupRem, deliveryRem, base.packageCount);
          pickedUpCount = Math.max(0, Math.min(totalPackages, totalPackages - pickupRem));
          deliveredCount = Math.max(0, Math.min(pickedUpCount, totalPackages - deliveryRem));
          packageCount = Math.max(0, totalPackages - deliveredCount);
        } else {
          const pickupRem = group.pickupRemaining;
          const deliveryRem = group.deliveryRemaining;
          totalPackages = Math.max(
            base.packageCount,
            pickupRem ?? 0,
            deliveryRem ?? 0
          );
          pickedUpCount =
            pickupRem !== undefined
              ? Math.max(0, Math.min(totalPackages, totalPackages - pickupRem))
              : totalPackages;
          deliveredCount =
            deliveryRem !== undefined
              ? Math.max(0, Math.min(pickedUpCount, totalPackages - deliveryRem))
              : 0;
          packageCount = Math.max(0, totalPackages - deliveredCount);
        }
      } else {
        totalPackages = Math.max(0, totalPackages);
        pickedUpCount = Math.max(0, Math.min(totalPackages, pickedUpCount));
        deliveredCount = Math.max(0, Math.min(pickedUpCount, deliveredCount));
        packageCount = Math.max(0, totalPackages - deliveredCount);
      }

      return {
        ...base,
        taskId: orderId,
        taskType: 'order',
        orderId,
        weekdayIndex: wd,
        taskLabel: 'Realizacja',
        packageCount,
        pickedUpCount,
        deliveredCount,
        totalPackages,
        priorityRank: idx + 1,
      };
    });
  }

  return normalized;
}

function normalizeCouriersForBaseStart(rawCouriers: unknown): SavedCourierState[] {
  if (!Array.isArray(rawCouriers)) return [];

  return rawCouriers
    .filter((c): c is SavedCourierState => isPlainObject(c) && typeof c.slotIndex === 'number')
    .map((courier) => ({
      ...courier,
      qualification: courier.qualification === 'bike_and_van' ? 'bike_and_van' : 'bike_only',
      assignedVehicle: courier.assignedVehicle
        ? normalizeActiveVehicle(courier.assignedVehicle)
        : null,
      trainingEndGameDay:
        typeof courier.trainingEndGameDay === 'number' &&
        Number.isFinite(courier.trainingEndGameDay)
          ? Math.floor(courier.trainingEndGameDay)
          : null,
      inRoute: false,
    }));
}

function mergeCargoIntoInventory(
  inventory: Readonly<Record<string, number>>,
  inTransitCargo: readonly WarehouseLoadedBatch[] | undefined
): { warehouseInventory: Record<string, number>; warehousePackages: number } {
  const merged: Record<string, number> = {};

  for (const [orderId, rawCount] of Object.entries(inventory)) {
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (count > 0) {
      merged[orderId] = count;
    }
  }

  if (Array.isArray(inTransitCargo)) {
    for (const batch of inTransitCargo) {
      if (!batch || typeof batch.orderId !== 'string') continue;
      const count = Math.max(0, Math.floor(Number(batch.count) || 0));
      if (count > 0) {
        merged[batch.orderId] = (merged[batch.orderId] ?? 0) + count;
      }
    }
  }

  let total = 0;
  for (const count of Object.values(merged)) {
    total += count;
  }

  return {
    warehouseInventory: merged,
    warehousePackages: total,
  };
}

/**
 * Normalizes a saved game state for safe restoration directly at Base:
 * - Clears all temporary `assignedCourierId` task claims from `weeklyPlan`
 * - Sets `inRoute: false` for every courier slot so no vehicle starts stranded mid-route
 * - Safely folds any `inTransitCargo` packages back into Base warehouse inventory
 */
export function normalizeSavedGameStateForLoad(rawState: SavedGameState): SavedGameState {
  const cloned = deepCloneJson(rawState);

  const safeMinutes =
    Number.isFinite(cloned.gameMinutes) && cloned.gameMinutes >= 0
      ? Math.floor(cloned.gameMinutes)
      : INITIAL_GAME_MINUTES;
  const derivedGameDay = Math.floor(safeMinutes / MINUTES_PER_DAY) + 1;
  const safeGameDay =
    Number.isFinite(cloned.gameDay) && cloned.gameDay >= 1
      ? Math.floor(cloned.gameDay)
      : derivedGameDay;

  const safeCash = Number.isFinite(cloned.cash) ? cloned.cash : 0;
  const safeCompleted =
    Number.isFinite(cloned.completedOrdersCount) && cloned.completedOrdersCount >= 0
      ? Math.floor(cloned.completedOrdersCount)
      : 0;
  const rawLegacySat = Number.isFinite(cloned.annualSatisfactionAvg)
    ? Math.max(0, Math.min(100, cloned.annualSatisfactionAvg))
    : 0;
  const rawCompanySat =
    typeof cloned.companySatisfaction === 'number' && Number.isFinite(cloned.companySatisfaction)
      ? Math.max(0, Math.min(100, cloned.companySatisfaction))
      : isPlainObject(cloned.economyState) &&
          typeof cloned.economyState.companySatisfaction === 'number' &&
          Number.isFinite(cloned.economyState.companySatisfaction)
        ? Math.max(0, Math.min(100, cloned.economyState.companySatisfaction))
        : rawLegacySat > 0
          ? rawLegacySat
          : INITIAL_COMPANY_SATISFACTION;
  const safeSatisfaction = Math.round(rawCompanySat * 10) / 10;
  const rawLedgerSource = isPlainObject(cloned.currentMonthLedger)
    ? cloned.currentMonthLedger
    : isPlainObject(cloned.economyState) && isPlainObject(cloned.economyState.currentMonthLedger)
      ? cloned.economyState.currentMonthLedger
      : null;
  const safeCurrentMonthLedger: CurrentMonthLedger = rawLedgerSource
    ? {
        shortTermRevenue: Math.max(0, Number(rawLedgerSource.shortTermRevenue) || 0),
        longTermAccruedRevenue: Math.max(0, Number(rawLedgerSource.longTermAccruedRevenue) || 0),
        fuelExpenses: Math.max(0, Number(rawLedgerSource.fuelExpenses) || 0),
        repairExpenses: Math.max(0, Number(rawLedgerSource.repairExpenses) || 0),
        penaltyExpenses: Math.max(0, Number(rawLedgerSource.penaltyExpenses) || 0),
        completedOrdersCount: Math.max(0, Math.floor(Number(rawLedgerSource.completedOrdersCount) || 0)),
        satisfactionSamplesSum:
          typeof rawLedgerSource.satisfactionSamplesSum === 'number' &&
          Number.isFinite(rawLedgerSource.satisfactionSamplesSum)
            ? rawLedgerSource.satisfactionSamplesSum
            : safeSatisfaction,
        satisfactionSamplesCount: Math.max(
          1,
          Math.floor(Number(rawLedgerSource.satisfactionSamplesCount) || 1)
        ),
      }
    : createEmptyCurrentMonthLedger(safeSatisfaction);
  const safeReputation = clampReputationLevel(cloned.reputationLevel);
  const safeWarehouseLevel = clampWarehouseTier(cloned.warehouseLevel);
  const safeParkingSpots = Math.max(0, Math.min(8, Math.floor(Number(cloned.parkingSpots) || 0)));
  const rawScootersSource =
    Array.isArray(cloned.scooters) && cloned.scooters.length > 0
      ? cloned.scooters
      : isPlainObject(cloned.economyState) && Array.isArray(cloned.economyState.scooters)
        ? cloned.economyState.scooters
        : undefined;
  const safeScooters = normalizeOwnedScooters(rawScootersSource);
  const safeScootersCount = safeScooters.length;
  const maxAllowedBikes = Math.max(0, MAX_TWO_WHEELERS - safeScootersCount);
  const parsedRawBikes =
    typeof cloned.bikesCount === 'number' && Number.isFinite(cloned.bikesCount)
      ? Math.floor(cloned.bikesCount)
      : isPlainObject(cloned.economyState) &&
          typeof cloned.economyState.bikesCount === 'number' &&
          Number.isFinite(cloned.economyState.bikesCount)
        ? Math.floor(cloned.economyState.bikesCount)
        : 1;
  const rawFallbackVansCount = Math.max(
    0,
    Math.min(
      safeParkingSpots,
      Math.floor(
        Number(
          cloned.vansCount ??
            (isPlainObject(cloned.economyState)
              ? cloned.economyState.vansCount ?? cloned.economyState.deliveryVansCount
              : 0)
        ) || 0
      )
    )
  );
  const rawVansSource =
    Array.isArray(cloned.vans) && cloned.vans.length > 0
      ? cloned.vans
      : isPlainObject(cloned.economyState) && Array.isArray(cloned.economyState.vans)
        ? cloned.economyState.vans
        : undefined;
  const safeVans = normalizeOwnedVans(rawVansSource, rawFallbackVansCount, safeParkingSpots);
  const safeVansCount = safeVans.length;
  let safeBikesCount = Math.max(0, Math.min(maxAllowedBikes, parsedRawBikes));
  if (safeBikesCount === 0 && safeScootersCount === 0 && safeVansCount === 0) {
    safeBikesCount = 1;
  }
  const rawBikeDurabilitiesSource = Array.isArray(cloned.bikeDurabilities)
    ? cloned.bikeDurabilities
    : isPlainObject(cloned.economyState) && Array.isArray(cloned.economyState.bikeDurabilities)
      ? cloned.economyState.bikeDurabilities
      : undefined;
  const safeBikeDurabilities = normalizeBikeDurabilities(rawBikeDurabilitiesSource, safeBikesCount);
  const rawRepairsSource = Array.isArray(cloned.pendingVehicleRepairs)
    ? cloned.pendingVehicleRepairs
    : isPlainObject(cloned.economyState) && Array.isArray(cloned.economyState.pendingVehicleRepairs)
      ? cloned.economyState.pendingVehicleRepairs
      : undefined;
  const safePendingRepairs = normalizePendingVehicleRepairs(
    rawRepairsSource,
    safeBikesCount,
    safeScootersCount,
    safeVansCount,
    safeGameDay
  );
  let safeActiveVehicle = normalizeActiveVehicle(cloned.activeVehicle);
  if (
    (safeActiveVehicle.type === 'bike' && safeActiveVehicle.index > safeBikesCount) ||
    (safeActiveVehicle.type === 'scooter' && safeActiveVehicle.index > safeScootersCount) ||
    (safeActiveVehicle.type === 'van' && safeActiveVehicle.index > safeVansCount)
  ) {
    safeActiveVehicle =
      safeBikesCount > 0
        ? { type: 'bike', index: 1 }
        : safeScootersCount > 0
          ? { type: 'scooter', index: 1 }
          : { type: 'van', index: 1 };
  }
  const safeCouriers = normalizeCouriersForBaseStart(cloned.couriers);

  const rawInventory = isPlainObject(cloned.warehouseInventory)
    ? (cloned.warehouseInventory as Record<string, number>)
    : {};
  const hasInventoryKeys = Object.keys(rawInventory).length > 0;
  const hasInTransit = Array.isArray(cloned.inTransitCargo) && cloned.inTransitCargo.length > 0;

  const mergedInventory = mergeCargoIntoInventory(rawInventory, cloned.inTransitCargo);
  const safeWarehousePackages =
    hasInventoryKeys || hasInTransit
      ? mergedInventory.warehousePackages
      : Math.max(0, Math.floor(Number(cloned.warehousePackages) || 0));

  const safeOfferedOrders = Array.isArray(cloned.offeredOrders) ? cloned.offeredOrders : [];
  const safeActiveOrders = Array.isArray(cloned.activeOrders) ? cloned.activeOrders : [];
  const safeWeeklyPlan = normalizeAndMergeWeeklyPlan(
    cloned.weeklyPlan,
    safeActiveOrders,
    mergedInventory.warehouseInventory
  );

  const seasonalFuelFallback = getSeasonalTargetFuelPrice(safeGameDay);
  const rawCurrentFuelPrice =
    typeof cloned.currentFuelPricePerLiter === 'number' &&
    Number.isFinite(cloned.currentFuelPricePerLiter)
      ? cloned.currentFuelPricePerLiter
      : isPlainObject(cloned.economyState) &&
          typeof cloned.economyState.currentFuelPricePerLiter === 'number' &&
          Number.isFinite(cloned.economyState.currentFuelPricePerLiter)
        ? cloned.economyState.currentFuelPricePerLiter
        : seasonalFuelFallback;
  const safeCurrentFuelPrice = clampFuelPrice(rawCurrentFuelPrice);
  const rawPreviousFuelPrice =
    typeof cloned.previousFuelPricePerLiter === 'number' &&
    Number.isFinite(cloned.previousFuelPricePerLiter)
      ? cloned.previousFuelPricePerLiter
      : isPlainObject(cloned.economyState) &&
          typeof cloned.economyState.previousFuelPricePerLiter === 'number' &&
          Number.isFinite(cloned.economyState.previousFuelPricePerLiter)
        ? cloned.economyState.previousFuelPricePerLiter
        : safeCurrentFuelPrice;
  const safePreviousFuelPrice = clampFuelPrice(rawPreviousFuelPrice);
  const rawNextFuelChangeDay =
    typeof cloned.nextFuelPriceChangeGameDay === 'number' &&
    Number.isFinite(cloned.nextFuelPriceChangeGameDay) &&
    cloned.nextFuelPriceChangeGameDay >= 1
      ? Math.floor(cloned.nextFuelPriceChangeGameDay)
      : isPlainObject(cloned.economyState) &&
          typeof cloned.economyState.nextFuelPriceChangeGameDay === 'number' &&
          Number.isFinite(cloned.economyState.nextFuelPriceChangeGameDay) &&
          cloned.economyState.nextFuelPriceChangeGameDay >= 1
        ? Math.floor(cloned.economyState.nextFuelPriceChangeGameDay)
        : safeGameDay + 4;

  let normalizedEconomyState: OrderEconomyState | undefined = cloned.economyState;
  if (normalizedEconomyState && isPlainObject(normalizedEconomyState)) {
    const cleanCompanyCouriers: CompanyCourier[] =
      safeCouriers.length > 0
        ? safeCouriers.map(({ inRoute: _inRoute, ...companyCourier }) => companyCourier)
        : normalizedEconomyState.couriers;

    normalizedEconomyState = {
      ...normalizedEconomyState,
      balance: safeCash,
      completedOrdersCount: safeCompleted,
      companySatisfaction: safeSatisfaction,
      annualSatisfactionAvg: safeSatisfaction,
      currentMonthLedger: { ...safeCurrentMonthLedger },
      monthlySettlements: Array.isArray(normalizedEconomyState.monthlySettlements)
        ? normalizedEconomyState.monthlySettlements.slice(0, MAX_MONTHLY_SETTLEMENTS_HISTORY)
        : [],
      reputationLevel: safeReputation,
      warehouseLevel: safeWarehouseLevel,
      warehouseTier: safeWarehouseLevel,
      parkingSpots: safeParkingSpots,
      bikesCount: safeBikesCount,
      bicyclesCount: safeBikesCount,
      bikeDurabilities: [...safeBikeDurabilities],
      scooters: safeScooters.map((s) => ({ ...s })),
      scootersCount: safeScootersCount,
      vans: safeVans.map((v) => ({ ...v })),
      vansCount: safeVansCount,
      deliveryVansCount: safeVansCount,
      activeVehicle: safeActiveVehicle,
      pendingVehicleRepairs: safePendingRepairs.map((r) => ({
        ...r,
        vehicle: { ...r.vehicle },
      })),
      couriers: cleanCompanyCouriers,
      pendingOffers: safeOfferedOrders,
      activeOrders: safeActiveOrders,
      warehousePackages: safeWarehousePackages,
      warehouseInventory: mergedInventory.warehouseInventory,
      weeklyPriorityOrder: normalizeWeeklyPriorityOrderMap(
        normalizedEconomyState.weeklyPriorityOrder
      ),
      currentFuelPricePerLiter: safeCurrentFuelPrice,
      previousFuelPricePerLiter: safePreviousFuelPrice,
      nextFuelPriceChangeGameDay: rawNextFuelChangeDay,
    };
  }

  return {
    ...cloned,
    gameMinutes: safeMinutes,
    gameDay: safeGameDay,
    cash: safeCash,
    completedOrdersCount: safeCompleted,
    annualSatisfactionAvg: safeSatisfaction,
    companySatisfaction: safeSatisfaction,
    currentMonthLedger: safeCurrentMonthLedger,
    reputationLevel: safeReputation,
    warehouseLevel: safeWarehouseLevel,
    parkingSpots: safeParkingSpots,
    bikesCount: safeBikesCount,
    bikeDurabilities: safeBikeDurabilities,
    scooters: safeScooters,
    scootersCount: safeScootersCount,
    currentFuelPricePerLiter: safeCurrentFuelPrice,
    previousFuelPricePerLiter: safePreviousFuelPrice,
    nextFuelPriceChangeGameDay: rawNextFuelChangeDay,
    vans: safeVans,
    vansCount: safeVansCount,
    activeVehicle: safeActiveVehicle,
    pendingVehicleRepairs: safePendingRepairs,
    couriers: safeCouriers,
    offeredOrders: safeOfferedOrders,
    activeOrders: safeActiveOrders,
    weeklyPlan: safeWeeklyPlan,
    warehousePackages: safeWarehousePackages,
    warehouseInventory: mergedInventory.warehouseInventory,
    inTransitCargo: [],
    economyState: normalizedEconomyState,
  };
}

function isValidSavedGameState(raw: unknown): raw is SavedGameState {
  if (!isPlainObject(raw)) return false;
  return (
    typeof raw.gameMinutes === 'number' &&
    Number.isFinite(raw.gameMinutes) &&
    typeof raw.cash === 'number' &&
    Number.isFinite(raw.cash) &&
    typeof raw.warehouseLevel === 'number' &&
    Array.isArray(raw.couriers)
  );
}

function isValidSaveSlotEntry(raw: unknown, expectedSlotId: SaveSlotId): raw is SaveSlotEntry {
  if (!isPlainObject(raw)) return false;
  return (
    raw.slotId === expectedSlotId &&
    typeof raw.updatedAt === 'string' &&
    raw.updatedAt.length > 0 &&
    isValidSavedGameState(raw.state)
  );
}

function writeSaveSlotsMap(slots: SaveSlotsMap): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // Gracefully ignore storage quota / privacy mode write errors
  }
}

/**
 * Helper to build a `SavedGameState` payload from live `OrderEconomyState` + clock & fleet info.
 */
export function createSavedGameState(
  economyState: OrderEconomyState,
  gameMinutes: number,
  options?: {
    inRouteBySlot?: Readonly<Record<number, boolean>>;
    weeklyPlan?: Record<number, WeeklyScheduleTask[]>;
    inTransitCargo?: readonly WarehouseLoadedBatch[];
  }
): SavedGameState {
  const safeMinutes = Math.max(0, Math.floor(gameMinutes));
  const gameDay = Math.floor(safeMinutes / MINUTES_PER_DAY) + 1;
  const inRouteBySlot = options?.inRouteBySlot;

  const savedCouriers: SavedCourierState[] = economyState.couriers.map((courier) => ({
    ...courier,
    assignedVehicle: courier.assignedVehicle ? { ...courier.assignedVehicle } : null,
    inRoute: inRouteBySlot ? Boolean(inRouteBySlot[courier.slotIndex]) : false,
  }));

  const weeklyPlan: Record<number, WeeklyScheduleTask[]> = {};
  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    const tasks = options?.weeklyPlan?.[wd] ?? [];
    weeklyPlan[wd] = tasks.map((task) => ({ ...task }));
  }

  const savedScooters: OwnedScooter[] = Array.isArray(economyState.scooters)
    ? economyState.scooters.slice(0, MAX_TWO_WHEELERS).map((s, idx) => {
        const cap = getScooterModelSpec(s.modelId).fuelTankCapacityLiters;
        return {
          ...s,
          index: idx + 1,
          id: `scooter-${idx + 1}`,
          durability:
            typeof s.durability === 'number' && Number.isFinite(s.durability)
              ? clampVehicleDurability(s.durability)
              : DEFAULT_VEHICLE_DURABILITY,
          fuelLiters:
            typeof s.fuelLiters === 'number' && Number.isFinite(s.fuelLiters)
              ? clampFuelLiters(s.fuelLiters, cap)
              : cap,
        };
      })
    : [];
  const rawBikes = economyState.bikesCount ?? economyState.bicyclesCount ?? 1;
  const safeBikesCount = Math.max(
    0,
    Math.min(MAX_TWO_WHEELERS - savedScooters.length, Math.floor(rawBikes))
  );
  const savedBikeDurabilities = normalizeBikeDurabilities(
    economyState.bikeDurabilities,
    safeBikesCount
  );
  const savedVans: OwnedVan[] =
    Array.isArray(economyState.vans) && economyState.vans.length > 0
      ? economyState.vans.map((v) => {
          const cap = getVanModelSpec(v.modelId).fuelTankCapacityLiters;
          return {
            ...v,
            durability:
              typeof v.durability === 'number' && Number.isFinite(v.durability)
                ? clampVehicleDurability(v.durability)
                : DEFAULT_VEHICLE_DURABILITY,
            fuelLiters:
              typeof v.fuelLiters === 'number' && Number.isFinite(v.fuelLiters)
                ? clampFuelLiters(v.fuelLiters, cap)
                : cap,
          };
        })
      : createDefaultOwnedVans(
          economyState.vansCount ?? economyState.deliveryVansCount ?? 0,
          DEFAULT_LEGACY_VAN_MODEL_ID
        );
  const savedPendingRepairs = normalizePendingVehicleRepairs(
    economyState.pendingVehicleRepairs,
    safeBikesCount,
    savedScooters.length,
    savedVans.length,
    gameDay
  );
  const savedFuelPrice = clampFuelPrice(
    typeof economyState.currentFuelPricePerLiter === 'number' &&
      Number.isFinite(economyState.currentFuelPricePerLiter)
      ? economyState.currentFuelPricePerLiter
      : getSeasonalTargetFuelPrice(gameDay)
  );
  const savedPrevFuelPrice = clampFuelPrice(
    typeof economyState.previousFuelPricePerLiter === 'number' &&
      Number.isFinite(economyState.previousFuelPricePerLiter)
      ? economyState.previousFuelPricePerLiter
      : savedFuelPrice
  );
  const savedNextFuelChangeDay =
    typeof economyState.nextFuelPriceChangeGameDay === 'number' &&
    Number.isFinite(economyState.nextFuelPriceChangeGameDay) &&
    economyState.nextFuelPriceChangeGameDay >= 1
      ? Math.floor(economyState.nextFuelPriceChangeGameDay)
      : gameDay + 4;

  const savedCompanySatisfaction =
    typeof economyState.companySatisfaction === 'number' &&
    Number.isFinite(economyState.companySatisfaction)
      ? Math.max(0, Math.min(100, economyState.companySatisfaction))
      : economyState.annualSatisfactionAvg > 0
        ? economyState.annualSatisfactionAvg
        : INITIAL_COMPANY_SATISFACTION;
  const savedLedger: CurrentMonthLedger = economyState.currentMonthLedger
    ? { ...economyState.currentMonthLedger }
    : createEmptyCurrentMonthLedger(savedCompanySatisfaction);

  return {
    gameMinutes: safeMinutes,
    gameDay,
    cash: economyState.balance,
    completedOrdersCount: economyState.completedOrdersCount,
    annualSatisfactionAvg: savedCompanySatisfaction,
    companySatisfaction: savedCompanySatisfaction,
    currentMonthLedger: savedLedger,
    reputationLevel: economyState.reputationLevel,
    warehouseLevel: economyState.warehouseLevel ?? economyState.warehouseTier,
    parkingSpots: economyState.parkingSpots,
    bikesCount: safeBikesCount,
    bikeDurabilities: savedBikeDurabilities,
    scooters: savedScooters,
    scootersCount: savedScooters.length,
    vans: savedVans,
    vansCount: savedVans.length,
    activeVehicle: { ...economyState.activeVehicle },
    pendingVehicleRepairs: savedPendingRepairs,
    couriers: savedCouriers,
    offeredOrders: deepCloneJson(economyState.pendingOffers),
    activeOrders: deepCloneJson(economyState.activeOrders),
    weeklyPlan,
    warehousePackages: economyState.warehousePackages,
    warehouseInventory: { ...economyState.warehouseInventory },
    inTransitCargo: options?.inTransitCargo
      ? options.inTransitCargo
          .filter((item) => item.count > 0)
          .map((item) => ({ orderId: item.orderId, count: item.count }))
      : [],
    currentFuelPricePerLiter: savedFuelPrice,
    previousFuelPricePerLiter: savedPrevFuelPrice,
    nextFuelPriceChangeGameDay: savedNextFuelChangeDay,
    economyState: deepCloneJson({
      ...economyState,
      bikesCount: safeBikesCount,
      bicyclesCount: safeBikesCount,
      bikeDurabilities: savedBikeDurabilities,
      scooters: savedScooters,
      scootersCount: savedScooters.length,
      vans: savedVans,
      vansCount: savedVans.length,
      deliveryVansCount: savedVans.length,
      pendingVehicleRepairs: savedPendingRepairs,
      currentFuelPricePerLiter: savedFuelPrice,
      previousFuelPricePerLiter: savedPrevFuelPrice,
      nextFuelPriceChangeGameDay: savedNextFuelChangeDay,
    }),
  };
}

let cachedSaveSlots: Record<SaveSlotId, SaveSlotEntry | null> | null = null;

/**
 * Reads all 3 save slots from `localStorage` (backed by an in-memory cache) with safe JSON error recovery.
 */
export function getAllSaveSlots(): Record<SaveSlotId, SaveSlotEntry | null> {
  if (cachedSaveSlots !== null) {
    return { ...cachedSaveSlots };
  }

  const result = createEmptySaveSlots();
  const storage = getSafeLocalStorage();
  if (!storage) {
    cachedSaveSlots = result;
    return { ...result };
  }

  try {
    const rawJson = storage.getItem(SAVE_STORAGE_KEY);
    if (!rawJson) {
      cachedSaveSlots = result;
      return { ...result };
    }

    const parsed: unknown = JSON.parse(rawJson);
    if (!isPlainObject(parsed)) {
      cachedSaveSlots = result;
      return { ...result };
    }

    for (const slotId of SAVE_SLOT_IDS) {
      const candidate = parsed[String(slotId)] ?? parsed[slotId];
      if (isValidSaveSlotEntry(candidate, slotId)) {
        result[slotId] = candidate;
      }
    }
  } catch {
    const empty = createEmptySaveSlots();
    cachedSaveSlots = empty;
    return { ...empty };
  }

  cachedSaveSlots = result;
  return { ...result };
}

/**
 * Persists a game progress snapshot to the specified save slot (`1 | 2 | 3`)
 * using the in-memory slot cache (avoids re-parsing localStorage and redundant deep-cloning).
 * Returns the updated slots map for immediate React state synchronization.
 */
export function saveGameToSlot(
  slotId: SaveSlotId,
  state: SavedGameState
): Record<SaveSlotId, SaveSlotEntry | null> {
  const slots = cachedSaveSlots !== null ? { ...cachedSaveSlots } : getAllSaveSlots();
  const entry: SaveSlotEntry = {
    slotId,
    updatedAt: new Date().toISOString(),
    state,
  };
  slots[slotId] = entry;
  cachedSaveSlots = slots;
  writeSaveSlotsMap(slots);
  return { ...slots };
}

/**
 * Loads a save slot and automatically normalizes it for a clean, safe start at Base
 * (clears temporary `assignedCourierId` in `weeklyPlan`, sets `inRoute: false` on all couriers,
 * and safely returns any in-transit cargo to Base warehouse inventory).
 */
export function loadGameFromSlot(slotId: SaveSlotId): SaveSlotEntry | null {
  const slots = getAllSaveSlots();
  const entry = slots[slotId];
  if (!entry) return null;

  return {
    slotId: entry.slotId,
    updatedAt: entry.updatedAt,
    state: normalizeSavedGameStateForLoad(entry.state),
  };
}

/**
 * Deletes the save stored in the specified slot (`1 | 2 | 3`).
 */
export function deleteSaveSlot(slotId: SaveSlotId): void {
  const slots = cachedSaveSlots !== null ? { ...cachedSaveSlots } : getAllSaveSlots();
  slots[slotId] = null;
  cachedSaveSlots = slots;
  writeSaveSlotsMap(slots);
}

/**
 * Finds the lowest-numbered empty save slot (`1`, `2`, or `3`), or `null` if all 3 slots are occupied.
 */
export function findFirstFreeSlot(): SaveSlotId | null {
  const slots = getAllSaveSlots();
  for (const slotId of SAVE_SLOT_IDS) {
    if (slots[slotId] === null) {
      return slotId;
    }
  }
  return null;
}
