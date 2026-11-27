import type {
  ActiveOrder,
  ActiveVehicleSelection,
  ActiveVehicleType,
  CompanyCourier,
  OrderEconomyState,
  WeeklyScheduleTask,
} from '../../types/orders';
import { getGameClockDisplay } from '../gameClock';
import {
  getEffectiveWarehouseCapacity,
  getFreeWarehouseCapacity,
  getPendingRepairForVehicle,
  getRemainingPickupPackagesForOrderToday,
  getScheduledTasksForWeekday,
  getStoredPackagesForOrder,
  getVehicleCourierCapacityForSelection,
  hasEnoughWarehouseSpaceForPickup,
  vehiclesEqual,
} from '../orderEconomy';
import {
  COURIER_SLOT_INDICES,
  DELIVERY_PAUSE_SECONDS,
  type CourierCargoItem,
  type CourierState,
  type CourierTaskSelectionOptions,
  type MultiCourierFleetState,
  type PostFinalPickupDecision,
  type SelectedCourierTask,
  getCourierCapacityForVehicle,
  getCourierCargoCount,
  getCourierSpeedForVehicle,
} from './typesAndConstants';

export const MAX_COURIERS_PER_ORDER = 2;

export interface ExtendedCourierTaskSelectionOptions extends CourierTaskSelectionOptions {
  /** Number of other active couriers currently assigned to each task/order ID */
  claimedTaskCounts?: ReadonlyMap<string, number>;
  /** Packages currently en route to be picked up (not yet loaded/recorded) by other couriers per orderId */
  inFlightPickupCountsByOrder?: ReadonlyMap<string, number>;
}

function getClaimedCountForKeys(
  keys: readonly string[],
  claimedTaskCounts?: ReadonlyMap<string, number>,
  claimedTaskIds?: ReadonlySet<string>
): number {
  if (claimedTaskCounts) {
    let maxCount = 0;
    for (let i = 0; i < keys.length; i++) {
      const count = claimedTaskCounts.get(keys[i]) ?? 0;
      if (count > maxCount) maxCount = count;
    }
    return maxCount;
  }
  if (claimedTaskIds) {
    for (let i = 0; i < keys.length; i++) {
      if (claimedTaskIds.has(keys[i])) return 1;
    }
  }
  return 0;
}

function evaluateOrderTaskCandidate(
  state: OrderEconomyState,
  order: ActiveOrder,
  clockDayIndex: number,
  clockGameDay: number,
  vehicleCapacity: number,
  warehouseCapacity: number,
  freeWarehouseSpace: number,
  inFlightPickupCountsByOrder?: ReadonlyMap<string, number>,
  task?: WeeklyScheduleTask
): SelectedCourierTask | null {
  const remainingToPickup = getRemainingPickupPackagesForOrderToday(
    state,
    order,
    clockDayIndex,
    clockGameDay
  );
  const inFlightPickup = Math.max(0, inFlightPickupCountsByOrder?.get(order.id) ?? 0);
  const effectiveRemainingToPickup = Math.max(0, remainingToPickup - inFlightPickup);
  const storedCount = getStoredPackagesForOrder(state, order.id);

  if (effectiveRemainingToPickup > 0) {
    const requiredSpace = Math.min(vehicleCapacity, effectiveRemainingToPickup, warehouseCapacity);
    const canFitPickup =
      freeWarehouseSpace > 0 &&
      freeWarehouseSpace >= requiredSpace &&
      hasEnoughWarehouseSpaceForPickup(state, effectiveRemainingToPickup, vehicleCapacity);

    if (canFitPickup) {
      const pickupCount = Math.min(
        vehicleCapacity,
        effectiveRemainingToPickup,
        freeWarehouseSpace
      );
      if (pickupCount > 0 && task) {
        return { kind: 'pickup', order, pickupCount, task };
      }
    }

    // Warehouse full for the next pickup batch: if this order already has packages in Base,
    // perform one delivery trip to free space; otherwise skip.
    if (storedCount > 0) {
      return { kind: 'delivery', order, availableCount: storedCount, task };
    }
    return null;
  }

  if (storedCount > 0) {
    return { kind: 'delivery', order, availableCount: storedCount, task };
  }

  return null;
}

/**
 * Scans today's merged `Plan tygodnia` tasks strictly from top to bottom (`#1`, `#2`, ...)
 * using a two-pass strategy:
 * - Pass 1: Strictly prefer completely free orders (0 active couriers assigned).
 * - Pass 2: Only when Pass 1 finds no eligible free order, allow joining an order currently
 *   handled by exactly 1 courier (max 2 couriers per order) and only if unreserved packages
 *   remain to pick up at the sender or free packages await delivery in the Base warehouse.
 */
export function selectNextCourierTaskForDay(
  state: OrderEconomyState,
  currentMinutes: number,
  vehicleTypeOverride?: ActiveVehicleType,
  options?: ExtendedCourierTaskSelectionOptions
): SelectedCourierTask | null {
  const clock = getGameClockDisplay(currentMinutes);
  const todayTasks = getScheduledTasksForWeekday(state, clock.dayIndex, clock.gameDay);
  const activeById = new Map(state.activeOrders.map((o) => [o.id, o]));
  const warehouseCapacity = getEffectiveWarehouseCapacity(state);
  const reservedSpace = Math.max(0, options?.reservedWarehouseSpace ?? 0);
  const freeWarehouseSpace = Math.max(0, getFreeWarehouseCapacity(state) - reservedSpace);
  const claimedTaskIds = options?.claimedTaskIds;
  const claimedTaskCounts = options?.claimedTaskCounts;
  const inFlightPickupCountsByOrder = options?.inFlightPickupCountsByOrder;
  const activeType: ActiveVehicleType =
    vehicleTypeOverride ?? state.activeVehicle?.type ?? 'bike';
  const vehicleCapacity =
    typeof options?.vehicleCapacity === 'number' &&
      Number.isFinite(options.vehicleCapacity) &&
      options.vehicleCapacity > 0
      ? Math.floor(options.vehicleCapacity)
      : vehicleTypeOverride === undefined
        ? getVehicleCourierCapacityForSelection(state, state.activeVehicle)
        : getCourierCapacityForVehicle(activeType);

  const concreteVehicle: ActiveVehicleSelection | undefined = options?.vehicle;
  const pendingRepairForThisVehicle = concreteVehicle
    ? getPendingRepairForVehicle(state, concreteVehicle)
    : null;

  // A vehicle queued for mechanic service cannot be used for ordinary parcel pickups/deliveries;
  // dispatch its repair trip as soon as its repair task is unclaimed (max 1 courier per repair).
  if (pendingRepairForThisVehicle) {
    if (
      getClaimedCountForKeys(
        [pendingRepairForThisVehicle.id],
        claimedTaskCounts,
        claimedTaskIds
      ) >= 1
    ) {
      return null;
    }
    const matchingTask = todayTasks.find(
      (t) => t.taskType === 'repair' && t.taskId === pendingRepairForThisVehicle.id
    );
    if (matchingTask) {
      return {
        kind: 'repair',
        repairTask: pendingRepairForThisVehicle,
        task: matchingTask,
      };
    }
    return null;
  }

  const findTaskForPass = (targetClaimedCount: 0 | 1): SelectedCourierTask | null => {
    for (const task of todayTasks) {
      // Healthy vehicles skip repair tasks belonging to other vehicles
      if (task.taskType === 'repair') continue;
      if (
        getClaimedCountForKeys(
          [task.taskId, task.orderId],
          claimedTaskCounts,
          claimedTaskIds
        ) !== targetClaimedCount
      ) {
        continue;
      }

      const order = activeById.get(task.orderId);
      if (!order || order.status !== 'active') continue;

      const candidate = evaluateOrderTaskCandidate(
        state,
        order,
        clock.dayIndex,
        clock.gameDay,
        vehicleCapacity,
        warehouseCapacity,
        freeWarehouseSpace,
        inFlightPickupCountsByOrder,
        task
      );
      if (candidate) {
        return candidate;
      }
    }

    // Fallback: deliver any stored packages belonging to an eligible active order
    if (state.warehousePackages > 0) {
      for (const order of state.activeOrders) {
        if (order.status !== 'active') continue;
        if (
          getClaimedCountForKeys([order.id], claimedTaskCounts, claimedTaskIds) !==
          targetClaimedCount
        ) {
          continue;
        }
        const storedCount = getStoredPackagesForOrder(state, order.id);
        if (storedCount > 0) {
          return { kind: 'delivery', order, availableCount: storedCount };
        }
      }
    }

    return null;
  };

  // Pass 1: completely unassigned orders (0 couriers).
  // Pass 2: join an order with 1 courier (max 2) only if Pass 1 found no free order.
  return findTaskForPass(0) ?? findTaskForPass(1);
}

/**
 * Evaluates the courier's next highest-priority ready task immediately after picking up
 * the FINAL remaining package of `completedPickupOrderId` at the sender's address:
 * - Scenario A: the same merged order task still has highest priority for this courier
 *   (and has fewer than 2 other couriers) -> deliver carried packages directly from sender
 * - Scenario B: a higher-priority merged order task is ready for pickup -> return to Base, unload, then pick up
 * - Scenario C: a higher-priority merged order task is ready for delivery -> return to Base, unload, load new order, deliver
 */
export function selectNextTaskAfterFinalPickup(
  state: OrderEconomyState,
  currentMinutes: number,
  completedPickupOrderId: string,
  carriedCount: number,
  vehicleTypeOverride?: ActiveVehicleType,
  options?: ExtendedCourierTaskSelectionOptions
): PostFinalPickupDecision {
  if (carriedCount <= 0) {
    return { scenario: 'return_to_base_idle' };
  }

  const clock = getGameClockDisplay(currentMinutes);
  const todayTasks = getScheduledTasksForWeekday(state, clock.dayIndex, clock.gameDay);
  const activeById = new Map(state.activeOrders.map((o) => [o.id, o]));
  const warehouseCapacity = getEffectiveWarehouseCapacity(state);
  const reservedSpace = Math.max(0, options?.reservedWarehouseSpace ?? 0);
  const freeSpaceAfterUnload = Math.max(
    0,
    getFreeWarehouseCapacity(state) - reservedSpace - carriedCount
  );
  const claimedTaskIds = options?.claimedTaskIds;
  const claimedTaskCounts = options?.claimedTaskCounts;
  const inFlightPickupCountsByOrder = options?.inFlightPickupCountsByOrder;
  const activeType: ActiveVehicleType =
    vehicleTypeOverride ?? state.activeVehicle?.type ?? 'bike';
  const vehicleCapacity =
    typeof options?.vehicleCapacity === 'number' &&
      Number.isFinite(options.vehicleCapacity) &&
      options.vehicleCapacity > 0
      ? Math.floor(options.vehicleCapacity)
      : vehicleTypeOverride === undefined
        ? getVehicleCourierCapacityForSelection(state, state.activeVehicle)
        : getCourierCapacityForVehicle(activeType);

  const concreteVehicle = options?.vehicle;
  const pendingRepairForThisVehicle = concreteVehicle
    ? getPendingRepairForVehicle(state, concreteVehicle)
    : null;
  if (pendingRepairForThisVehicle) {
    // Vehicle was queued for repair while out on a pickup: return to Base to unload parcels first, then head to Mechanic
    const matchingTask = todayTasks.find(
      (t) =>
        t.taskType === 'repair' &&
        t.taskId === pendingRepairForThisVehicle.id &&
        vehiclesEqual(t.repairVehicle, concreteVehicle)
    );
    if (matchingTask) {
      return {
        scenario: 'return_to_base_for_next_task',
        nextTask: {
          kind: 'repair',
          repairTask: pendingRepairForThisVehicle,
          task: matchingTask,
        },
      };
    }
    return { scenario: 'return_to_base_idle' };
  }

  const findNextDecisionForPass = (
    targetClaimedCount: 0 | 1
  ): PostFinalPickupDecision | null => {
    for (const task of todayTasks) {
      if (task.taskType === 'repair') continue;
      if (
        getClaimedCountForKeys(
          [task.taskId, task.orderId],
          claimedTaskCounts,
          claimedTaskIds
        ) !== targetClaimedCount
      ) {
        continue;
      }
      const order = activeById.get(task.orderId);
      if (!order || order.status !== 'active') continue;

      // Scenario A: same merged order is still highest priority for this courier -> deliver directly
      if (order.id === completedPickupOrderId) {
        return {
          scenario: 'direct_delivery_same_order',
          order,
          task,
        };
      }

      // Another order sits higher in Plan tygodnia: check whether it is ready for pickup (Scenario B)
      // or delivery (Scenario C) after unloading our carried packages at Base
      const nextTask = evaluateOrderTaskCandidate(
        state,
        order,
        clock.dayIndex,
        clock.gameDay,
        vehicleCapacity,
        warehouseCapacity,
        freeSpaceAfterUnload,
        inFlightPickupCountsByOrder,
        task
      );
      if (nextTask) {
        return {
          scenario: 'return_to_base_for_next_task',
          nextTask,
        };
      }
    }

    return null;
  };

  const passDecision = findNextDecisionForPass(0) ?? findNextDecisionForPass(1);
  if (passDecision) {
    return passDecision;
  }

  const completedOrder = activeById.get(completedPickupOrderId);
  if (
    completedOrder &&
    completedOrder.status === 'active' &&
    getClaimedCountForKeys([completedPickupOrderId], claimedTaskCounts, claimedTaskIds) <
    MAX_COURIERS_PER_ORDER
  ) {
    return {
      scenario: 'direct_delivery_same_order',
      order: completedOrder,
    };
  }

  return { scenario: 'return_to_base_idle' };
}

export function createIdleCourier(
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  courierId = 1,
  cargoCapacityOverride?: number
): CourierState {
  const vehicleType = vehicle.type;
  const vehicleIndex = Math.max(1, Math.floor(vehicle.index || 1));
  const resolvedCapacity =
    typeof cargoCapacityOverride === 'number' &&
      Number.isFinite(cargoCapacityOverride) &&
      cargoCapacityOverride > 0
      ? Math.floor(cargoCapacityOverride)
      : getCourierCapacityForVehicle(vehicleType);
  return {
    courierId: Math.max(1, Math.floor(courierId || 1)),
    inRoute: false,
    assignedTaskId: null,
    phase: 'idle',
    active: false,
    arrived: false,
    riderMounted: false,
    path: [],
    outboundPath: [],
    returnPath: [],
    segmentIndex: 0,
    distanceInSegment: 0,
    x: 0,
    y: 0,
    angle: 0,
    totalDistance: 0,
    traveledDistance: 0,
    speed: getCourierSpeedForVehicle(vehicleType),
    currentSpeed: 0,
    deliveryPauseRemaining: 0,
    deliveryPauseDuration: DELIVERY_PAUSE_SECONDS,
    wheelPhase: 0,
    missionKind: 'none',
    vehicleType,
    vehicleIndex,
    cargoCapacity: resolvedCapacity,
    stops: [],
    currentStopIndex: 0,
    cargo: [],
    isForcedReturn: false,
  };
}

export function createInitialCourierFleet(
  couriers?: readonly CompanyCourier[],
  economyState?: OrderEconomyState
): MultiCourierFleetState {
  const fleet: MultiCourierFleetState = {};
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const rosterEntry = couriers?.find((c) => c.slotIndex === slotIndex);
    const vehicle = rosterEntry?.assignedVehicle ?? { type: 'bike' as const, index: 1 };
    const capacity = economyState
      ? getVehicleCourierCapacityForSelection(economyState, vehicle)
      : undefined;
    fleet[slotIndex] = {
      slotIndex,
      inRoute: false,
      assignedTaskId: null,
      courier: createIdleCourier(vehicle, slotIndex, capacity),
      activeRoute: [],
      targetMarker: null,
    };
  }
  return fleet;
}

export function getClaimedTaskIdsForFleet(
  fleet: Readonly<MultiCourierFleetState>,
  excludeSlotIndex?: number
): Set<string> {
  const claimed = new Set<string>();
  for (const slotIndex of COURIER_SLOT_INDICES) {
    if (slotIndex === excludeSlotIndex) continue;
    const entry = fleet[slotIndex];
    if (entry && entry.inRoute && entry.assignedTaskId) {
      claimed.add(entry.assignedTaskId);
    }
  }
  return claimed;
}

/**
 * Counts how many other active couriers are currently assigned to each task/order ID.
 */
export function getClaimedTaskCountsForFleet(
  fleet: Readonly<MultiCourierFleetState>,
  excludeSlotIndex?: number
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slotIndex of COURIER_SLOT_INDICES) {
    if (slotIndex === excludeSlotIndex) continue;
    const entry = fleet[slotIndex];
    if (entry && entry.inRoute && entry.assignedTaskId) {
      counts.set(entry.assignedTaskId, (counts.get(entry.assignedTaskId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Counts packages per orderId that are already assigned to other couriers en route to pick up
 * (before `pickup_loaded` has fired and decremented `remainingToPickup` in economy state).
 */
export function getInFlightPickupCountsByOrderForFleet(
  fleet: Readonly<MultiCourierFleetState>,
  excludeSlotIndex?: number
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slotIndex of COURIER_SLOT_INDICES) {
    if (slotIndex === excludeSlotIndex) continue;
    const entry = fleet[slotIndex];
    if (!entry || !entry.inRoute || !entry.courier.active) continue;
    const c = entry.courier;
    if (c.missionKind !== 'pickup') continue;
    // Once packages are loaded into cargo, recordPackagePickup has already updated economy state
    if (getCourierCargoCount(c.cargo) > 0) continue;
    for (let i = 0; i < c.stops.length; i++) {
      const stop = c.stops[i];
      if (stop.kind === 'pickup' && stop.orderId && (stop.plannedPickupCount ?? 0) > 0) {
        counts.set(stop.orderId, (counts.get(stop.orderId) ?? 0) + (stop.plannedPickupCount ?? 0));
      }
    }
  }
  return counts;
}

export function getReservedWarehouseSpaceForFleet(
  fleet: Readonly<MultiCourierFleetState>,
  excludeSlotIndex?: number
): number {
  let reserved = 0;
  for (const slotIndex of COURIER_SLOT_INDICES) {
    if (slotIndex === excludeSlotIndex) continue;
    const entry = fleet[slotIndex];
    if (!entry || !entry.inRoute || !entry.courier.active) continue;
    const c = entry.courier;
    if (c.missionKind !== 'pickup') continue;
    const carried = getCourierCargoCount(c.cargo);
    if (carried > 0) {
      reserved += carried;
    } else {
      const pickupStop = c.stops.find((s) => s.kind === 'pickup');
      if (pickupStop && (pickupStop.plannedPickupCount ?? 0) > 0) {
        reserved += pickupStop.plannedPickupCount ?? 0;
      }
    }
  }
  return reserved;
}

export function getActiveOutVehiclesForFleet(
  fleet: Readonly<MultiCourierFleetState>
): { bikeIndices: Set<number>; scooterIndices: Set<number>; vanIndices: Set<number> } {
  const bikeIndices = new Set<number>();
  const scooterIndices = new Set<number>();
  const vanIndices = new Set<number>();
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const entry = fleet[slotIndex];
    if (!entry || !entry.inRoute || entry.courier.phase === 'idle') continue;
    if (entry.courier.vehicleType === 'van') {
      vanIndices.add(entry.courier.vehicleIndex);
    } else if (entry.courier.vehicleType === 'scooter') {
      scooterIndices.add(entry.courier.vehicleIndex);
    } else {
      bikeIndices.add(entry.courier.vehicleIndex);
    }
  }
  return { bikeIndices, scooterIndices, vanIndices };
}

export function isVehicleCurrentlyInRoute(
  fleet: Readonly<MultiCourierFleetState>,
  vehicle: ActiveVehicleSelection,
  excludeSlotIndex?: number
): boolean {
  for (const slotIndex of COURIER_SLOT_INDICES) {
    if (slotIndex === excludeSlotIndex) continue;
    const entry = fleet[slotIndex];
    if (!entry || !entry.inRoute || entry.courier.phase === 'idle') continue;
    if (
      entry.courier.vehicleType === vehicle.type &&
      entry.courier.vehicleIndex === vehicle.index
    ) {
      return true;
    }
  }
  return false;
}

export function buildCourierAtBaseBySlot(
  fleet: Readonly<MultiCourierFleetState>
): Record<number, boolean> {
  const result: Record<number, boolean> = {};
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const entry = fleet[slotIndex];
    result[slotIndex] = !(entry?.inRoute ?? false);
  }
  return result;
}

export function buildTaskAssignmentsByTaskId(
  fleet: Readonly<MultiCourierFleetState>
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const entry = fleet[slotIndex];
    if (entry && entry.inRoute && entry.assignedTaskId) {
      const existing = result[entry.assignedTaskId];
      if (existing) {
        if (!existing.includes(slotIndex)) {
          existing.push(slotIndex);
        }
      } else {
        result[entry.assignedTaskId] = [slotIndex];
      }
    }
  }
  return result;
}

export function collectInFlightCargoForFleet(
  fleet: Readonly<MultiCourierFleetState>
): CourierCargoItem[] {
  const byOrder = new Map<string, number>();
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const entry = fleet[slotIndex];
    if (!entry) continue;
    for (const item of entry.courier.cargo) {
      if (item.count > 0) {
        byOrder.set(item.orderId, (byOrder.get(item.orderId) ?? 0) + item.count);
      }
    }
  }
  return Array.from(byOrder.entries()).map(([orderId, count]) => ({
    orderId,
    count,
  }));
}
