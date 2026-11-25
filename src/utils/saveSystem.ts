import type {
  ActiveOrder,
  ActiveVehicleSelection,
  CompanyCourier,
  OrderEconomyState,
  OrderOffer,
  OwnedVan,
  ReputationLevel,
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
  DEFAULT_LEGACY_VAN_MODEL_ID,
  createDefaultOwnedVans,
  createOwnedVan,
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
  /** Annual average client satisfaction % */
  annualSatisfactionAvg: number;
  /** Current company reputation level (1–4) */
  reputationLevel: ReputationLevel;
  /** Base warehouse expansion tier (1–4) */
  warehouseLevel: WarehouseTier;
  /** Unlocked Base van parking spots (0–8) */
  parkingSpots: number;
  /** Number of owned bicycles (1–3) */
  bikesCount: number;
  /** Owned delivery vans with individual model IDs (optional in legacy saves) */
  vans?: OwnedVan[];
  /** Number of owned delivery vans (0–8) */
  vansCount: number;
  /** Active vehicle assigned to the owner courier (#1) */
  activeVehicle: ActiveVehicleSelection;
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
    const type = value.type === 'van' ? 'van' : 'bike';
    const rawIdx = Number(value.index);
    const index = Number.isFinite(rawIdx) && rawIdx >= 1 ? Math.floor(rawIdx) : 1;
    return { type, index };
  }
  return { type: 'bike', index: 1 };
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
      normalized.push(createOwnedVan(normalized.length + 1, modelId));
    }
    return normalized;
  }

  const safeFallbackCount = Math.max(0, Math.min(limit, Math.floor(fallbackCount)));
  return createDefaultOwnedVans(safeFallbackCount, DEFAULT_LEGACY_VAN_MODEL_ID);
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
  const safeSatisfaction = Number.isFinite(cloned.annualSatisfactionAvg)
    ? Math.max(0, Math.min(100, cloned.annualSatisfactionAvg))
    : 0;
  const safeReputation = clampReputationLevel(cloned.reputationLevel);
  const safeWarehouseLevel = clampWarehouseTier(cloned.warehouseLevel);
  const safeParkingSpots = Math.max(0, Math.min(8, Math.floor(Number(cloned.parkingSpots) || 0)));
  const safeBikesCount = Math.max(1, Math.min(3, Math.floor(Number(cloned.bikesCount) || 1)));
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
  const safeActiveVehicle = normalizeActiveVehicle(cloned.activeVehicle);
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
      annualSatisfactionAvg: safeSatisfaction,
      reputationLevel: safeReputation,
      warehouseLevel: safeWarehouseLevel,
      warehouseTier: safeWarehouseLevel,
      parkingSpots: safeParkingSpots,
      bikesCount: safeBikesCount,
      bicyclesCount: safeBikesCount,
      vans: safeVans.map((v) => ({ ...v })),
      vansCount: safeVansCount,
      deliveryVansCount: safeVansCount,
      activeVehicle: safeActiveVehicle,
      couriers: cleanCompanyCouriers,
      pendingOffers: safeOfferedOrders,
      activeOrders: safeActiveOrders,
      warehousePackages: safeWarehousePackages,
      warehouseInventory: mergedInventory.warehouseInventory,
      weeklyPriorityOrder: normalizeWeeklyPriorityOrderMap(
        normalizedEconomyState.weeklyPriorityOrder
      ),
    };
  }

  return {
    ...cloned,
    gameMinutes: safeMinutes,
    gameDay: safeGameDay,
    cash: safeCash,
    completedOrdersCount: safeCompleted,
    annualSatisfactionAvg: safeSatisfaction,
    reputationLevel: safeReputation,
    warehouseLevel: safeWarehouseLevel,
    parkingSpots: safeParkingSpots,
    bikesCount: safeBikesCount,
    vans: safeVans,
    vansCount: safeVansCount,
    activeVehicle: safeActiveVehicle,
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

  const savedVans: OwnedVan[] =
    Array.isArray(economyState.vans) && economyState.vans.length > 0
      ? economyState.vans.map((v) => ({ ...v }))
      : createDefaultOwnedVans(
          economyState.vansCount ?? economyState.deliveryVansCount ?? 0,
          DEFAULT_LEGACY_VAN_MODEL_ID
        );

  return {
    gameMinutes: safeMinutes,
    gameDay,
    cash: economyState.balance,
    completedOrdersCount: economyState.completedOrdersCount,
    annualSatisfactionAvg: economyState.annualSatisfactionAvg,
    reputationLevel: economyState.reputationLevel,
    warehouseLevel: economyState.warehouseLevel ?? economyState.warehouseTier,
    parkingSpots: economyState.parkingSpots,
    bikesCount: economyState.bikesCount ?? economyState.bicyclesCount,
    vans: savedVans,
    vansCount: savedVans.length,
    activeVehicle: { ...economyState.activeVehicle },
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
    economyState: deepCloneJson({
      ...economyState,
      vans: savedVans,
      vansCount: savedVans.length,
      deliveryVansCount: savedVans.length,
    }),
  };
}

/**
 * Reads all 3 save slots from `localStorage` with safe JSON error recovery.
 */
export function getAllSaveSlots(): Record<SaveSlotId, SaveSlotEntry | null> {
  const result = createEmptySaveSlots();
  const storage = getSafeLocalStorage();
  if (!storage) return result;

  try {
    const rawJson = storage.getItem(SAVE_STORAGE_KEY);
    if (!rawJson) return result;

    const parsed: unknown = JSON.parse(rawJson);
    if (!isPlainObject(parsed)) return result;

    for (const slotId of SAVE_SLOT_IDS) {
      const candidate = parsed[String(slotId)] ?? parsed[slotId];
      if (isValidSaveSlotEntry(candidate, slotId)) {
        result[slotId] = candidate;
      }
    }
  } catch {
    return createEmptySaveSlots();
  }

  return result;
}

/**
 * Persists a game progress snapshot to the specified save slot (`1 | 2 | 3`).
 */
export function saveGameToSlot(slotId: SaveSlotId, state: SavedGameState): void {
  const slots = getAllSaveSlots();
  const entry: SaveSlotEntry = {
    slotId,
    updatedAt: new Date().toISOString(),
    state: deepCloneJson(state),
  };
  slots[slotId] = entry;
  writeSaveSlotsMap(slots);
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
  const slots = getAllSaveSlots();
  slots[slotId] = null;
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
