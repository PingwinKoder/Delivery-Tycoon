import type {
  ActiveVehicleSelection,
  ActiveVehicleType,
  CompanyCourier,
  OrderEconomyState,
} from '../../types/orders';
import { getGameClockDisplay } from '../gameClock';
import {
  getEffectiveWarehouseCapacity,
  getFreeWarehouseCapacity,
  getRemainingPickupPackagesForOrderToday,
  getScheduledTasksForWeekday,
  getStoredPackagesForOrder,
  hasEnoughWarehouseSpaceForPickup,
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

/**
 * Scans today's merged `Plan tygodnia` tasks strictly from top to bottom (`#1`, `#2`, ...)
 * and picks the first ready stage for an unclaimed order:
 * - If the merged task still has unpicked packages (`remainingToPickup > 0`) AND Base warehouse
 *   has free space for the next pickup batch -> dispatch `pickup` stage.
 * - If the warehouse is full (cannot fit the next pickup batch) -> skip unfinished pickup and
 *   dispatch a single `delivery` trip for the highest-priority merged task that already has
 *   packages waiting in the Base warehouse, freeing space before re-scanning from `#1`.
 * - If all packages of the merged task are already picked up (`remainingToPickup === 0`) and
 *   packages are stored in Base warehouse -> dispatch `delivery` stage.
 *
 * Falls back to any unclaimed active order with stored warehouse packages if none are listed today.
 */
export function selectNextCourierTaskForDay(
  state: OrderEconomyState,
  currentMinutes: number,
  vehicleTypeOverride?: ActiveVehicleType,
  options?: CourierTaskSelectionOptions
): SelectedCourierTask | null {
  const clock = getGameClockDisplay(currentMinutes);
  const todayTasks = getScheduledTasksForWeekday(state, clock.dayIndex, clock.gameDay);
  const activeById = new Map(state.activeOrders.map((o) => [o.id, o]));
  const warehouseCapacity = getEffectiveWarehouseCapacity(state);
  const reservedSpace = Math.max(0, options?.reservedWarehouseSpace ?? 0);
  const freeWarehouseSpace = Math.max(0, getFreeWarehouseCapacity(state) - reservedSpace);
  const claimedTaskIds = options?.claimedTaskIds;
  const activeType: ActiveVehicleType =
    vehicleTypeOverride ?? state.activeVehicle?.type ?? 'bike';
  const vehicleCapacity = getCourierCapacityForVehicle(activeType);

  for (const task of todayTasks) {
    if (claimedTaskIds?.has(task.taskId) || claimedTaskIds?.has(task.orderId)) continue;
    const order = activeById.get(task.orderId);
    if (!order || order.status !== 'active') continue;

    const remainingToPickup = getRemainingPickupPackagesForOrderToday(
      state,
      order,
      clock.dayIndex,
      clock.gameDay
    );
    const storedCount = getStoredPackagesForOrder(state, order.id);

    if (remainingToPickup > 0) {
      const requiredSpace = Math.min(vehicleCapacity, remainingToPickup, warehouseCapacity);
      const canFitPickup =
        freeWarehouseSpace > 0 &&
        freeWarehouseSpace >= requiredSpace &&
        hasEnoughWarehouseSpaceForPickup(state, remainingToPickup, vehicleCapacity);

      if (canFitPickup) {
        const pickupCount = Math.min(vehicleCapacity, remainingToPickup, freeWarehouseSpace);
        if (pickupCount > 0) {
          return { kind: 'pickup', order, pickupCount, task };
        }
      }

      // Warehouse full for the next pickup batch: if this order already has packages in Base,
      // perform one delivery trip to free space; otherwise continue scanning lower-priority orders.
      if (storedCount > 0) {
        return { kind: 'delivery', order, availableCount: storedCount, task };
      }
      continue;
    }

    if (storedCount > 0) {
      return { kind: 'delivery', order, availableCount: storedCount, task };
    }
  }

  // Fallback: deliver any stored packages belonging to an unclaimed active order
  if (state.warehousePackages > 0) {
    for (const order of state.activeOrders) {
      if (order.status !== 'active') continue;
      if (claimedTaskIds?.has(order.id)) continue;
      const storedCount = getStoredPackagesForOrder(state, order.id);
      if (storedCount > 0) {
        return { kind: 'delivery', order, availableCount: storedCount };
      }
    }
  }

  return null;
}

/**
 * Evaluates the courier's next highest-priority ready task immediately after picking up
 * the FINAL remaining package of `completedPickupOrderId` at the sender's address:
 * - Scenario A: the same merged order task still has highest priority for this courier
 *   (and is not claimed by another courier) -> deliver carried packages directly from sender
 * - Scenario B: a higher-priority merged order task is ready for pickup -> return to Base, unload, then pick up
 * - Scenario C: a higher-priority merged order task is ready for delivery -> return to Base, unload, load new order, deliver
 */
export function selectNextTaskAfterFinalPickup(
  state: OrderEconomyState,
  currentMinutes: number,
  completedPickupOrderId: string,
  carriedCount: number,
  vehicleTypeOverride?: ActiveVehicleType,
  options?: CourierTaskSelectionOptions
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
  const activeType: ActiveVehicleType =
    vehicleTypeOverride ?? state.activeVehicle?.type ?? 'bike';
  const vehicleCapacity = getCourierCapacityForVehicle(activeType);

  for (const task of todayTasks) {
    if (claimedTaskIds?.has(task.taskId) || claimedTaskIds?.has(task.orderId)) continue;
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
    const remainingToPickup = getRemainingPickupPackagesForOrderToday(
      state,
      order,
      clock.dayIndex,
      clock.gameDay
    );
    const storedCount = getStoredPackagesForOrder(state, order.id);

    if (remainingToPickup > 0) {
      const nextBatchSize = Math.min(vehicleCapacity, remainingToPickup, warehouseCapacity);
      if (freeSpaceAfterUnload >= nextBatchSize) {
        const pickupCount = Math.min(vehicleCapacity, remainingToPickup, freeSpaceAfterUnload);
        if (pickupCount > 0) {
          return {
            scenario: 'return_to_base_for_next_task',
            nextTask: { kind: 'pickup', order, pickupCount, task },
          };
        }
      }
      if (storedCount > 0) {
        return {
          scenario: 'return_to_base_for_next_task',
          nextTask: { kind: 'delivery', order, availableCount: storedCount, task },
        };
      }
      continue;
    }

    if (storedCount > 0) {
      return {
        scenario: 'return_to_base_for_next_task',
        nextTask: { kind: 'delivery', order, availableCount: storedCount, task },
      };
    }
  }

  const completedOrder = activeById.get(completedPickupOrderId);
  if (
    completedOrder &&
    completedOrder.status === 'active' &&
    !claimedTaskIds?.has(completedPickupOrderId)
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
  courierId = 1
): CourierState {
  const vehicleType = vehicle.type;
  const vehicleIndex = Math.max(1, Math.floor(vehicle.index || 1));
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
    cargoCapacity: getCourierCapacityForVehicle(vehicleType),
    stops: [],
    currentStopIndex: 0,
    cargo: [],
    isForcedReturn: false,
  };
}

export function createInitialCourierFleet(
  couriers?: readonly CompanyCourier[]
): MultiCourierFleetState {
  const fleet: MultiCourierFleetState = {};
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const rosterEntry = couriers?.find((c) => c.slotIndex === slotIndex);
    const vehicle = rosterEntry?.assignedVehicle ?? { type: 'bike' as const, index: 1 };
    fleet[slotIndex] = {
      slotIndex,
      inRoute: false,
      assignedTaskId: null,
      courier: createIdleCourier(vehicle, slotIndex),
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
): { bikeIndices: Set<number>; vanIndices: Set<number> } {
  const bikeIndices = new Set<number>();
  const vanIndices = new Set<number>();
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const entry = fleet[slotIndex];
    if (!entry || !entry.inRoute || entry.courier.phase === 'idle') continue;
    if (entry.courier.vehicleType === 'van') {
      vanIndices.add(entry.courier.vehicleIndex);
    } else {
      bikeIndices.add(entry.courier.vehicleIndex);
    }
  }
  return { bikeIndices, vanIndices };
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
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const slotIndex of COURIER_SLOT_INDICES) {
    const entry = fleet[slotIndex];
    if (entry && entry.inRoute && entry.assignedTaskId) {
      result[entry.assignedTaskId] = slotIndex;
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
