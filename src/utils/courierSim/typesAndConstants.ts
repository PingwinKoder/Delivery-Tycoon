import type { Building } from '../../types/building';
import type {
  ActiveOrder,
  ActiveVehicleSelection,
  ActiveVehicleType,
  OrderEconomyState,
  ScooterModelId,
  VehicleRepairTask,
  WeeklyScheduleTask,
} from '../../types/orders';
import type { Point } from '../../types/roadGraph';
import { BASE_GAME_MINUTES_PER_REAL_SECOND } from '../gameClock';
import {
  BIKE_REPAIR_GAME_MINUTES,
  DEFAULT_LEGACY_SCOOTER_MODEL_ID,
  REFUEL_SERVICE_GAME_MINUTES,
  SCOOTER_CARGO_REPAIR_GAME_MINUTES,
  SCOOTER_CITY_REPAIR_GAME_MINUTES,
  SCOOTER_MODELS,
  VAN_REPAIR_GAME_MINUTES,
  getOwnedScooterByIndex,
  getVehicleCourierCapacity,
  getVehicleCourierCapacityForSelection,
} from '../orderEconomy';

export type CourierPhase = 'idle' | 'outbound' | 'delivering' | 'returning';

export type CourierMissionKind =
  | 'none'
  | 'manual'
  | 'pickup'
  | 'delivery'
  | 'park_rack'
  | 'repair'
  | 'refuel';

export type CourierStartPoint = 'rack' | 'loading_zone';

export interface CourierCargoItem {
  orderId: string;
  count: number;
}

export type CourierStopKind =
  | 'base_load'
  | 'pickup'
  | 'delivery'
  | 'base_unload'
  | 'park_rack'
  | 'repair_service'
  | 'refuel_service';

export interface CourierMissionStop {
  kind: CourierStopKind;
  buildingId: string;
  label: string;
  stopPoint: Point;
  /** Optional override for pause duration at this stop (seconds) */
  pauseDuration?: number;
  /** For pickup stops: order to pick up from and planned package count */
  orderId?: string;
  plannedPickupCount?: number;
  /** For delivery stops: packages handed off at this building */
  deliveryItems?: CourierCargoItem[];
  /** For repair_service stops: concrete vehicle being serviced */
  repairVehicle?: ActiveVehicleSelection;
  /** For refuel_service stops: concrete vehicle being refueled at a gas station */
  refuelVehicle?: ActiveVehicleSelection;
  /** Right-hand road + pull-in polyline from the previous point (Base or previous stop) to this stop */
  legPath: Point[];
  /** Directed right-hand road + Base loading-zone return polyline from this stop */
  returnToBasePath: Point[];
}

export type CourierSimEvent =
  | { type: 'pickup_loaded'; orderId: string; plannedCount: number; buildingId: string }
  | { type: 'delivery_completed'; items: CourierCargoItem[]; buildingId: string }
  | { type: 'repair_completed'; vehicle: ActiveVehicleSelection; buildingId: string }
  | { type: 'refuel_completed'; vehicle: ActiveVehicleSelection; buildingId: string }
  | { type: 'base_unloaded'; cargo: CourierCargoItem[] }
  | { type: 'arrived_at_loading_zone'; wasForcedReturn: boolean }
  | { type: 'parked_at_rack'; cargo: CourierCargoItem[]; wasForcedReturn: boolean };

export interface CourierStepResult {
  state: CourierState;
  events: CourierSimEvent[];
  /** World pixels actively driven during this simulation step (0 while stopped/loading/delivering) */
  distanceMoved: number;
}

export type SelectedCourierTask =
  | {
      kind: 'pickup';
      order: ActiveOrder;
      pickupCount: number;
      task: WeeklyScheduleTask;
    }
  | {
      kind: 'delivery';
      order: ActiveOrder;
      availableCount: number;
      task?: WeeklyScheduleTask;
    }
  | {
      kind: 'repair';
      repairTask: VehicleRepairTask;
      task: WeeklyScheduleTask;
    };

export type PostFinalPickupDecision =
  | {
      /** Scenario A: next task is ROZWÓZKA of the same order -> deliver carried packages directly from sender */
      scenario: 'direct_delivery_same_order';
      order: ActiveOrder;
      task?: WeeklyScheduleTask;
    }
  | {
      /** Scenario B (next ODBIÓR of another order) or Scenario C (next ROZWÓZKA of another order) -> return to Base & unload first */
      scenario: 'return_to_base_for_next_task';
      nextTask: SelectedCourierTask;
    }
  | {
      scenario: 'return_to_base_idle';
    };

export interface CourierTaskSelectionOptions {
  /** Merged task IDs (`orderId` or `repair:type:index`) already claimed by other active couriers */
  claimedTaskIds?: ReadonlySet<string>;
  /** Packages currently reserved in-flight by other couriers' active pickup runs (not yet unloaded into Base) */
  reservedWarehouseSpace?: number;
  /** Exact carrying capacity for the concrete vehicle being dispatched (e.g. 5 for bike, 10/12/14/15/17/20 for van) */
  vehicleCapacity?: number;
  /** Concrete vehicle selection being dispatched (used to match repair tasks and block normal parcels while pending repair) */
  vehicle?: ActiveVehicleSelection;
}

export interface CourierState {
  /** 1-based courier slot index (1 = Właściciel, 2..6 = Kurier #2..#6) */
  courierId: number;
  /** True whenever this courier is out on a route or moving on the Base yard */
  inRoute: boolean;
  /** Currently claimed merged WeeklyScheduleTask taskId (orderId, e.g. "ord-1"), or null */
  assignedTaskId: string | null;
  phase: CourierPhase;
  /** True while the courier is out on a mission or moving on the Base yard */
  active: boolean;
  /** True during the handoff/loading stop at a building or Base loading bay */
  arrived: boolean;
  /**
   * True when the human rider is mounted on the bicycle (outbound & returning).
   * False during 'delivering' (rider handles packages inside building/warehouse, empty bike parked)
   * and during 'idle' (empty bicycle parked on BAZA bike rack).
   */
  riderMounted: boolean;
  /** Currently followed polyline */
  path: Point[];
  /** Initial outbound polyline */
  outboundPath: Point[];
  /** Directed return polyline back to Base loading zone or bike rack */
  returnPath: Point[];
  /** Optional human-readable label for the current target */
  targetLabel?: string;
  segmentIndex: number;
  distanceInSegment: number;
  x: number;
  y: number;
  angle: number;
  totalDistance: number;
  traveledDistance: number;
  /** Target cruising speed in world pixels per second */
  speed: number;
  /** Current instantaneous speed (px/s) with smooth acceleration, corner slowdown & stop braking */
  currentSpeed: number;
  /** Remaining pause duration (seconds) while courier loads/unloads or delivers */
  deliveryPauseRemaining: number;
  /** Configured pause duration (seconds) at customer buildings (1.8s) */
  deliveryPauseDuration: number;
  /** Accumulated wheel rotation angle (radians) for subtle spoke & riding animation */
  wheelPhase: number;
  /** Active mission kind */
  missionKind: CourierMissionKind;
  /** Vehicle currently driven on this mission ('bike' | 'scooter' | 'van') */
  vehicleType: ActiveVehicleType;
  /** 1-based fleet index of the active vehicle (e.g. Rower #1, Skuter #1, Bus #1..#8) */
  vehicleIndex: number;
  /** Optional scooter model ID when vehicleType === 'scooter' */
  scooterModelId?: ScooterModelId;
  /** Package carrying capacity of the active vehicle (5 bike, 7/8 scooter, 10–20 van) */
  cargoCapacity: number;
  /** Ordered stops for the current mission */
  stops: CourierMissionStop[];
  /** Index of the currently targeted stop within `stops` */
  currentStopIndex: number;
  /** Packages currently carried on the vehicle (picked-up or undelivered) */
  cargo: CourierCargoItem[];
  /** True when the courier was recalled to Base due to end of seasonal workday */
  isForcedReturn: boolean;
}

export const COURIER_SLOT_INDICES = [1, 2, 3, 4, 5, 6] as const;

export interface FleetCourierSlotState {
  slotIndex: number;
  inRoute: boolean;
  assignedTaskId: string | null;
  courier: CourierState;
  activeRoute: Point[];
  targetMarker: Point | null;
}

export type MultiCourierFleetState = Record<number, FleetCourierSlotState>;

export interface CourierFleetStatusSnapshot {
  atBaseBySlot: Record<number, boolean>;
  allAtBase: boolean;
  taskAssignmentsByTaskId: Record<string, number>;
  refuelingVehicleKeys?: string[];
}

export interface DeliveryStopInput {
  building: Building;
  items: CourierCargoItem[];
}

/** Bicycle courier cruising speed reduced by 10% (from 126 to 113 world px/s) */
export const DEFAULT_COURIER_SPEED = 113;
/** City & Cargo scooter cruising speeds in world px/s */
export const SCOOTER_CITY_SPEED = SCOOTER_MODELS.scooter_city.speedPxPerSec; // 152
export const SCOOTER_CARGO_SPEED = SCOOTER_MODELS.scooter_cargo.speedPxPerSec; // 168
/** Delivery van cruising speed on city roads (~208 world px/s) */
export const VAN_COURIER_SPEED = 208;
export const VAN_SPEED_MULTIPLIER = VAN_COURIER_SPEED / DEFAULT_COURIER_SPEED;
export const DELIVERY_PAUSE_SECONDS = 1.8;
/** Mechanic garage stop durations in simulation seconds */
export const BIKE_REPAIR_SERVICE_PAUSE_SECONDS =
  BIKE_REPAIR_GAME_MINUTES / BASE_GAME_MINUTES_PER_REAL_SECOND;
export const SCOOTER_CITY_REPAIR_SERVICE_PAUSE_SECONDS =
  SCOOTER_CITY_REPAIR_GAME_MINUTES / BASE_GAME_MINUTES_PER_REAL_SECOND;
export const SCOOTER_CARGO_REPAIR_SERVICE_PAUSE_SECONDS =
  SCOOTER_CARGO_REPAIR_GAME_MINUTES / BASE_GAME_MINUTES_PER_REAL_SECOND;
export const VAN_REPAIR_SERVICE_PAUSE_SECONDS =
  VAN_REPAIR_GAME_MINUTES / BASE_GAME_MINUTES_PER_REAL_SECOND;
export const REPAIR_SERVICE_PAUSE_SECONDS = BIKE_REPAIR_SERVICE_PAUSE_SECONDS;
/** Gas station refueling stop duration in simulation seconds (15 game min -> 12s at 1x) */
export const REFUEL_SERVICE_PAUSE_SECONDS =
  REFUEL_SERVICE_GAME_MINUTES / BASE_GAME_MINUTES_PER_REAL_SECOND;
export const BASE_TRANSFER_PAUSE_SECONDS = 1.0;

export function getRepairServicePauseSeconds(
  vehicleType: ActiveVehicleType,
  scooterModelId?: ScooterModelId
): number {
  const repairGameMinutes =
    vehicleType === 'van'
      ? VAN_REPAIR_GAME_MINUTES
      : vehicleType === 'scooter'
        ? scooterModelId === 'scooter_cargo'
          ? SCOOTER_CARGO_REPAIR_GAME_MINUTES
          : SCOOTER_CITY_REPAIR_GAME_MINUTES
        : BIKE_REPAIR_GAME_MINUTES;
  return repairGameMinutes / BASE_GAME_MINUTES_PER_REAL_SECOND;
}
export const MAX_REAL_FRAME_DT = 0.05;
export const WHEEL_RADIANS_PER_PIXEL = 0.25;

// Smooth vehicle kinematics (accelerating from stop, slowing into corners, braking into stops)
export const COURIER_ACCELERATION = 145; // world px/s²
export const COURIER_DECELERATION = 200; // world px/s²
export const CORNER_LOOKAHEAD_DISTANCE = 44; // world px ahead to scan for turns
export const MIN_CORNER_SPEED_FACTOR = 0.48; // 48% of cruise speed on tight 90°+ turns
export const MIN_APPROACH_SPEED = 18; // world px/s floor so the vehicle completes arrival cleanly

export function getCourierSpeedForVehicle(
  vehicleType: ActiveVehicleType,
  scooterModelId?: ScooterModelId
): number {
  if (vehicleType === 'van') return VAN_COURIER_SPEED;
  if (vehicleType === 'scooter') {
    return scooterModelId === 'scooter_cargo' ? SCOOTER_CARGO_SPEED : SCOOTER_CITY_SPEED;
  }
  return DEFAULT_COURIER_SPEED;
}

export function getCourierSpeedForSelection(
  state: OrderEconomyState,
  selection: ActiveVehicleSelection | null | undefined
): number {
  if (!selection || selection.type === 'bike') {
    return DEFAULT_COURIER_SPEED;
  }
  if (selection.type === 'scooter') {
    const ownedScooter = getOwnedScooterByIndex(state, selection.index);
    const modelId = ownedScooter?.modelId ?? DEFAULT_LEGACY_SCOOTER_MODEL_ID;
    return getCourierSpeedForVehicle('scooter', modelId);
  }
  return VAN_COURIER_SPEED;
}

export function getCourierCapacityForVehicle(vehicleType: ActiveVehicleType): number {
  return getVehicleCourierCapacity(vehicleType);
}

export function getCourierCapacityForSelection(
  state: OrderEconomyState,
  selection: ActiveVehicleSelection | null | undefined
): number {
  return getVehicleCourierCapacityForSelection(state, selection);
}

export function getCourierCargoCount(cargo: readonly CourierCargoItem[]): number {
  let total = 0;
  for (const item of cargo) {
    if (item.count > 0) total += item.count;
  }
  return total;
}
