import { type Building, formatBuildingAddress } from '../types/building';
import type {
  ActiveOrder,
  ActiveVehicleSelection,
  ActiveVehicleType,
  OrderEconomyState,
  WeeklyScheduleTask,
} from '../types/orders';
import type { Point, RoadEdge, RoadGraph, RoadNode } from '../types/roadGraph';
import { type BaseDepotSpec, canvasToIso } from './cityMap';
import { BASE_GAME_MINUTES_PER_REAL_SECOND, getGameClockDisplay } from './gameClock';
import {
  BIKE_COURIER_CAPACITY,
  VAN_COURIER_CAPACITY,
  getFreeWarehouseCapacity,
  getRemainingPickupPackagesForOrderToday,
  getScheduledTasksForWeekday,
  getStoredPackagesForOrder,
  getVehicleCourierCapacity,
  hasEnoughWarehouseSpaceForPickup,
} from './orderEconomy';
import {
  ALL_PARKING_NAV_NETWORKS,
  type ParkingNavNetwork,
  type VanBuildingStopPlan,
  buildBaseParkingNavNetwork,
  planBaseVanDepartureFromSpot,
  planBaseVanReturnToSpot,
  resolveVanStopForBuilding,
} from './parkingNavigation';
import {
  findClosestRoadTarget,
  findShortestPath,
  findShortestPathFromEdgePoint,
  findShortestPathFromRoadPoint,
  findShortestPathToEdgePoint,
} from './pathfinding';
import { applyRightHandLaneOffsets } from './trafficLanes';

export type CourierPhase = 'idle' | 'outbound' | 'delivering' | 'returning';

export type CourierMissionKind = 'none' | 'manual' | 'pickup' | 'delivery' | 'park_rack';

export type CourierStartPoint = 'rack' | 'loading_zone';

export interface CourierCargoItem {
  orderId: string;
  count: number;
}

export type CourierStopKind = 'base_load' | 'pickup' | 'delivery' | 'base_unload' | 'park_rack';

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
  /** Right-hand road + pull-in polyline from the previous point (Base or previous stop) to this stop */
  legPath: Point[];
  /** Directed right-hand road + Base loading-zone return polyline from this stop */
  returnToBasePath: Point[];
}

export type CourierSimEvent =
  | { type: 'pickup_loaded'; orderId: string; plannedCount: number; buildingId: string }
  | { type: 'delivery_completed'; items: CourierCargoItem[]; buildingId: string }
  | { type: 'base_unloaded'; cargo: CourierCargoItem[] }
  | { type: 'arrived_at_loading_zone'; wasForcedReturn: boolean }
  | { type: 'parked_at_rack'; cargo: CourierCargoItem[]; wasForcedReturn: boolean };

export interface CourierStepResult {
  state: CourierState;
  events: CourierSimEvent[];
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
    };

export interface CourierState {
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
  /** Vehicle currently driven on this mission ('bike' | 'van') */
  vehicleType: ActiveVehicleType;
  /** 1-based fleet index of the active vehicle (e.g. Rower #1, Bus #1..#8) */
  vehicleIndex: number;
  /** Package carrying capacity of the active vehicle (5 for bike, 20 for used van) */
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

/** Original base bicycle speed before the 30% pacing reduction */
const ORIGINAL_BIKE_COURIER_SPEED = 180;
/** Base bicycle courier cruising speed reduced by 30% (180 * 0.7 = 126 world px/s) */
export const DEFAULT_COURIER_SPEED = Math.round(ORIGINAL_BIKE_COURIER_SPEED * 0.7);
/** Used delivery van speed multiplier (~1.65x bicycle speed) */
export const VAN_SPEED_MULTIPLIER = 1.65;
/** Delivery van cruising speed on city roads (~208 world px/s) */
export const VAN_COURIER_SPEED = Math.round(DEFAULT_COURIER_SPEED * VAN_SPEED_MULTIPLIER);
export const DELIVERY_PAUSE_SECONDS = 1.8;
export const BASE_TRANSFER_PAUSE_SECONDS = 1.0;
const WHEEL_RADIANS_PER_PIXEL = 0.25;

export function getCourierSpeedForVehicle(vehicleType: ActiveVehicleType): number {
  return vehicleType === 'van' ? VAN_COURIER_SPEED : DEFAULT_COURIER_SPEED;
}

export function getCourierCapacityForVehicle(vehicleType: ActiveVehicleType): number {
  return getVehicleCourierCapacity(vehicleType);
}

export function getCourierCargoCount(cargo: readonly CourierCargoItem[]): number {
  let total = 0;
  for (const item of cargo) {
    if (item.count > 0) total += item.count;
  }
  return total;
}

// Smooth vehicle kinematics (accelerating from stop, slowing into corners, braking into stops)
const COURIER_ACCELERATION = 145; // world px/s²
const COURIER_DECELERATION = 200; // world px/s²
const CORNER_LOOKAHEAD_DISTANCE = 44; // world px ahead to scan for turns
const MIN_CORNER_SPEED_FACTOR = 0.48; // 48% of cruise speed on tight 90°+ turns
const MIN_APPROACH_SPEED = 18; // world px/s floor so the vehicle completes arrival cleanly

export function computePolylineLength(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return sum;
}

/**
 * Joins multiple waypoint arrays into a clean polyline without duplicate near-identical boundary points.
 */
export function stitchWaypoints(...segments: Array<Point[] | undefined>): Point[] {
  const combined: Point[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    for (const pt of seg) {
      const prev = combined[combined.length - 1];
      if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.5) {
        combined.push({ x: pt.x, y: pt.y });
      }
    }
  }
  return combined;
}

/**
 * Prepends concrete-yard lead-out waypoints from the BAZA bike rack onto a road path,
 * deduplicating any near-identical boundary points.
 */
export function prependRackExitToPath(rackWaypoints: Point[], roadPath: Point[]): Point[] {
  return stitchWaypoints(rackWaypoints, roadPath);
}

/**
 * Scans today's `Plan tygodnia` tasks strictly from top to bottom (`#1`, `#2`, ...)
 * and picks the first ready task:
 * - `Odbiór` (`pickup`): order still has packages to pick up today AND Base warehouse has free space
 * - `Rozwózka` (`delivery`): packages for that order are already waiting in Base warehouse
 *
 * Falls back to any active order with stored warehouse packages if none are listed today.
 */
export function selectNextCourierTaskForDay(
  state: OrderEconomyState,
  currentMinutes: number,
  vehicleTypeOverride?: ActiveVehicleType
): SelectedCourierTask | null {
  const clock = getGameClockDisplay(currentMinutes);
  const todayTasks = getScheduledTasksForWeekday(state, clock.dayIndex, clock.gameDay);
  const activeById = new Map(state.activeOrders.map((o) => [o.id, o]));
  const freeWarehouseSpace = getFreeWarehouseCapacity(state);
  const activeType: ActiveVehicleType =
    vehicleTypeOverride ?? state.activeVehicle?.type ?? 'bike';
  const vehicleCapacity = getCourierCapacityForVehicle(activeType);

  for (const task of todayTasks) {
    const order = activeById.get(task.orderId);
    if (!order || order.status !== 'active') continue;

    if (task.taskType === 'pickup') {
      if (freeWarehouseSpace <= 0) continue;
      const remainingToPickup = getRemainingPickupPackagesForOrderToday(
        state,
        order,
        clock.dayIndex,
        clock.gameDay
      );
      if (remainingToPickup <= 0) continue;
      // Hold ODBIÓR if the Base warehouse (30 / 70 / 140 / 250 capacity) does not have
      // enough free slots for this order's remaining pickup packages; proceed to ROZWÓZKA instead.
      if (!hasEnoughWarehouseSpaceForPickup(state, remainingToPickup)) continue;
      const pickupCount = Math.min(vehicleCapacity, remainingToPickup, freeWarehouseSpace);
      if (pickupCount > 0) {
        return { kind: 'pickup', order, pickupCount, task };
      }
    } else if (task.taskType === 'delivery') {
      const storedCount = getStoredPackagesForOrder(state, order.id);
      if (storedCount > 0) {
        return { kind: 'delivery', order, availableCount: storedCount, task };
      }
    }
  }

  // Fallback: deliver any stored packages belonging to an active order even if not listed in today's tasks
  if (state.warehousePackages > 0) {
    for (const order of state.activeOrders) {
      if (order.status !== 'active') continue;
      const storedCount = getStoredPackagesForOrder(state, order.id);
      if (storedCount > 0) {
        return { kind: 'delivery', order, availableCount: storedCount };
      }
    }
  }

  return null;
}

export function createIdleCourier(
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 }
): CourierState {
  const vehicleType = vehicle.type;
  const vehicleIndex = Math.max(1, Math.floor(vehicle.index || 1));
  return {
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

export function createCourierFromPath(
  outboundPoints: Point[],
  speed?: number,
  deliveryPauseDuration = DELIVERY_PAUSE_SECONDS,
  returnPoints?: Point[],
  targetLabel?: string,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 }
): CourierState {
  if (outboundPoints.length < 2) {
    return createIdleCourier(vehicle);
  }

  const resolvedSpeed = speed ?? getCourierSpeedForVehicle(vehicle.type);
  const outboundPath = outboundPoints.map((p) => ({ x: p.x, y: p.y }));
  const resolvedReturn =
    returnPoints && returnPoints.length >= 2
      ? returnPoints.map((p) => ({ x: p.x, y: p.y }))
      : [...outboundPath].reverse();

  const dx = outboundPath[1].x - outboundPath[0].x;
  const dy = outboundPath[1].y - outboundPath[0].y;
  const angle = Math.atan2(dy, dx);

  return {
    phase: 'outbound',
    active: true,
    arrived: false,
    riderMounted: true,
    path: outboundPath,
    outboundPath,
    returnPath: resolvedReturn,
    targetLabel,
    segmentIndex: 0,
    distanceInSegment: 0,
    x: outboundPath[0].x,
    y: outboundPath[0].y,
    angle,
    totalDistance: computePolylineLength(outboundPath),
    traveledDistance: 0,
    speed: resolvedSpeed,
    currentSpeed: 0,
    deliveryPauseRemaining: 0,
    deliveryPauseDuration: Math.max(0, deliveryPauseDuration),
    wheelPhase: 0,
    missionKind: 'manual',
    vehicleType: vehicle.type,
    vehicleIndex: Math.max(1, Math.floor(vehicle.index || 1)),
    cargoCapacity: getCourierCapacityForVehicle(vehicle.type),
    stops: [],
    currentStopIndex: 0,
    cargo: [],
    isForcedReturn: false,
  };
}

// ============================================================================
// Multi-Stop Road Routing & Base Loading-Zone / Bike-Rack Mission Builders
// ============================================================================

function findMatchingEdge(graph: RoadGraph, aId: string, bId: string): RoadEdge | undefined {
  return graph.edges.find(
    (e) => (e[0] === aId && e[1] === bId) || (e[0] === bId && e[1] === aId)
  );
}

function projectParameterOnSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return 0;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
}

function isPointInsideBaseYard(pt: Point, baseDepot: BaseDepotSpec): boolean {
  const iso = canvasToIso(pt.x, pt.y);
  return (
    iso.u >= baseDepot.yardUMin - 18 &&
    iso.u <= baseDepot.yardUMax + 18 &&
    iso.v >= baseDepot.yardVMin - 18 &&
    iso.v <= baseDepot.yardVMax + 18
  );
}

/**
 * Computes a directed shortest road centerline path between two building roadApproachPoints
 * (handling both distinct edges and two stops sharing the exact same road edge).
 */
export function findShortestPathBetweenEdgePoints(
  graph: RoadGraph,
  fromEdge: [string, string],
  fromPoint: Point,
  toEdge: [string, string],
  toPoint: Point
): Point[] | null {
  if (Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y) < 1.5) {
    return [
      { x: fromPoint.x, y: fromPoint.y },
      { x: toPoint.x, y: toPoint.y },
    ];
  }

  const nodeById = new Map<string, RoadNode>(graph.nodes.map((n) => [n.id, n]));
  const matchedFrom = findMatchingEdge(graph, fromEdge[0], fromEdge[1]);
  const matchedTo = findMatchingEdge(graph, toEdge[0], toEdge[1]);

  const fromId = '__leg_from__';
  const toId = '__leg_to__';

  if (matchedFrom && matchedTo) {
    const nextNodes: RoadNode[] = [
      ...graph.nodes,
      { id: fromId, x: fromPoint.x, y: fromPoint.y, kind: 'endpoint' },
      { id: toId, x: toPoint.x, y: toPoint.y, kind: 'endpoint' },
    ];

    if (matchedFrom === matchedTo) {
      const aNode = nodeById.get(matchedFrom[0]);
      const bNode = nodeById.get(matchedFrom[1]);
      if (aNode && bNode) {
        const tFrom = projectParameterOnSegment(fromPoint, aNode, bNode);
        const tTo = projectParameterOnSegment(toPoint, aNode, bNode);
        const firstId = tFrom <= tTo ? fromId : toId;
        const secondId = tFrom <= tTo ? toId : fromId;
        const oneWay = matchedFrom[2]?.oneWay;
        const splitEdges: RoadEdge[] = oneWay
          ? [
              [matchedFrom[0], firstId, { oneWay: true }],
              [firstId, secondId, { oneWay: true }],
              [secondId, matchedFrom[1], { oneWay: true }],
            ]
          : [
              [matchedFrom[0], firstId],
              [firstId, secondId],
              [secondId, matchedFrom[1]],
            ];
        const tempGraph: RoadGraph = {
          nodes: nextNodes,
          edges: [...graph.edges.filter((e) => e !== matchedFrom), ...splitEdges],
        };
        const res = findShortestPath(tempGraph, fromId, toId);
        if (res && res.points.length >= 2) {
          return res.points;
        }
      }
    } else {
      const remainingEdges = graph.edges.filter(
        (e) => e !== matchedFrom && e !== matchedTo
      );
      const splitFrom: RoadEdge[] = matchedFrom[2]?.oneWay
        ? [
            [matchedFrom[0], fromId, { oneWay: true }],
            [fromId, matchedFrom[1], { oneWay: true }],
          ]
        : [
            [matchedFrom[0], fromId],
            [fromId, matchedFrom[1]],
          ];
      const splitTo: RoadEdge[] = matchedTo[2]?.oneWay
        ? [
            [matchedTo[0], toId, { oneWay: true }],
            [toId, matchedTo[1], { oneWay: true }],
          ]
        : [
            [matchedTo[0], toId],
            [toId, matchedTo[1]],
          ];
      const tempGraph: RoadGraph = {
        nodes: nextNodes,
        edges: [...remainingEdges, ...splitFrom, ...splitTo],
      };
      const res = findShortestPath(tempGraph, fromId, toId);
      if (res && res.points.length >= 2) {
        return res.points;
      }
    }
  }

  const snapA = findClosestRoadTarget(graph, fromPoint, 140);
  const snapB = findClosestRoadTarget(graph, toPoint, 140);
  const startNodeId = snapA?.nodeId ?? snapA?.edge?.[0];
  const endNodeId = snapB?.nodeId ?? snapB?.edge?.[0];
  if (startNodeId && endNodeId) {
    const res = findShortestPath(graph, startNodeId, endNodeId);
    if (res && res.points.length >= 1) {
      return stitchWaypoints([fromPoint], res.points, [toPoint]);
    }
  }

  return null;
}

function getBaseParkingNetwork(
  parkingNavNetworks: readonly ParkingNavNetwork[],
  baseDepot: BaseDepotSpec,
  graph?: RoadGraph
): ParkingNavNetwork | undefined {
  const existing = parkingNavNetworks.find((n) => n.kind === 'base_fleet');
  if (existing && existing.spots.length === baseDepot.parking.spots.length) {
    return existing;
  }
  if (graph && baseDepot.parking.spots.length > 0) {
    return buildBaseParkingNavNetwork(baseDepot, graph);
  }
  return existing;
}

function buildVanOutboundLegFromBaseToStop(
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  stopPlan: VanBuildingStopPlan,
  startFrom: CourierStartPoint,
  vehicleIndex: number,
  parkingNavNetworks: readonly ParkingNavNetwork[]
): Point[] | null {
  if (startFrom === 'rack') {
    const baseNet = getBaseParkingNetwork(parkingNavNetworks, baseDepot, graph);
    const spotExit = planBaseVanDepartureFromSpot(baseNet, vehicleIndex);
    const roadNode = baseNet?.nodes.find((n) => n.id === baseNet.entryRoadNodeId);
    const hasExitNode = graph.nodes.some((n) => n.id === 'n_base_exit');

    if (spotExit && spotExit.canvasPoints.length >= 2 && roadNode && hasExitNode) {
      const outboundFromExit = findShortestPathToEdgePoint(
        graph,
        'n_base_exit',
        stopPlan.entryEdge,
        stopPlan.entryRoadPoint
      );
      if (outboundFromExit && outboundFromExit.points.length >= 2) {
        const roadCenterline = stitchWaypoints(
          [{ x: roadNode.x, y: roadNode.y }],
          outboundFromExit.points
        );
        const roadLanePts = applyRightHandLaneOffsets(roadCenterline, {
          laneIndex: 0,
          vehicleClass: 'van',
        });
        const lotInternal = spotExit.canvasPoints.slice(0, -1);
        const full = stitchWaypoints(lotInternal, roadLanePts, stopPlan.entryOffRoadPoints);
        if (full.length >= 2) {
          return full;
        }
      }
    }
  }

  const outboundRes = findShortestPathToEdgePoint(
    graph,
    'base',
    stopPlan.entryEdge,
    stopPlan.entryRoadPoint
  );
  if (!outboundRes || outboundRes.points.length < 2) return null;

  const outboundLanePts = applyRightHandLaneOffsets(outboundRes.points, {
    laneIndex: 0,
    vehicleClass: 'van',
  });
  const baseExit =
    startFrom === 'loading_zone'
      ? baseDepot.loadingZone.exitWaypoints
      : baseDepot.loadingZone.exitWaypoints;

  return stitchWaypoints(baseExit, outboundLanePts, stopPlan.entryOffRoadPoints);
}

function buildVanReturnLegFromStopToLoadingZone(
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  stopPlan: VanBuildingStopPlan
): Point[] | null {
  const returnRes = findShortestPathFromEdgePoint(
    graph,
    stopPlan.exitEdge,
    stopPlan.exitRoadPoint,
    'base'
  );
  if (!returnRes || returnRes.points.length < 2) return null;

  const returnLanePts = applyRightHandLaneOffsets(returnRes.points, {
    laneIndex: 0,
    vehicleClass: 'van',
  });
  const loadingZoneReturn = [...baseDepot.loadingZone.exitWaypoints].reverse();

  return stitchWaypoints(stopPlan.exitOffRoadPoints, returnLanePts, loadingZoneReturn);
}

function buildVanLegBetweenStops(
  graph: RoadGraph,
  fromPlan: VanBuildingStopPlan,
  toPlan: VanBuildingStopPlan
): Point[] | null {
  const roadPts = findShortestPathBetweenEdgePoints(
    graph,
    fromPlan.exitEdge,
    fromPlan.exitRoadPoint,
    toPlan.entryEdge,
    toPlan.entryRoadPoint
  );
  if (!roadPts || roadPts.length < 2) return null;

  const lanePts = applyRightHandLaneOffsets(roadPts, {
    laneIndex: 0,
    vehicleClass: 'van',
  });
  const leg = stitchWaypoints(fromPlan.exitOffRoadPoints, lanePts, toPlan.entryOffRoadPoints);
  if (leg.length >= 2) {
    return leg;
  }

  // Defensive micro-step when two adjacent addresses resolve to the exact same curbside point
  const anchor = lanePts[0] ?? fromPlan.stopPoint;
  return [anchor, { x: anchor.x + 0.8, y: anchor.y + 0.4 }];
}

function buildVanSpotToLoadingZoneWaypoints(
  baseDepot: BaseDepotSpec,
  parkingNavNetworks: readonly ParkingNavNetwork[],
  vehicleIndex: number,
  graph?: RoadGraph
): Point[] {
  const baseNet = getBaseParkingNetwork(parkingNavNetworks, baseDepot, graph);
  const spotExit = planBaseVanDepartureFromSpot(baseNet, vehicleIndex);
  const lzPt: Point = { x: baseDepot.loadingZone.stopX, y: baseDepot.loadingZone.stopY };
  if (spotExit && spotExit.canvasPoints.length >= 2) {
    return stitchWaypoints(spotExit.canvasPoints, [lzPt]);
  }
  return baseDepot.loadingZone.fromBikeRackWaypoints;
}

function buildVanLoadingZoneToSpotWaypoints(
  baseDepot: BaseDepotSpec,
  parkingNavNetworks: readonly ParkingNavNetwork[],
  vehicleIndex: number,
  fromPoint?: Point,
  graph?: RoadGraph
): Point[] {
  const baseNet = getBaseParkingNetwork(parkingNavNetworks, baseDepot, graph);
  const spotEntry = planBaseVanReturnToSpot(baseNet, vehicleIndex);
  const startPt: Point = fromPoint ?? {
    x: baseDepot.loadingZone.stopX,
    y: baseDepot.loadingZone.stopY,
  };
  if (spotEntry && spotEntry.canvasPoints.length >= 2) {
    return stitchWaypoints([startPt], spotEntry.canvasPoints);
  }
  return fromPoint
    ? stitchWaypoints([fromPoint], baseDepot.loadingZone.toBikeRackWaypoints)
    : baseDepot.loadingZone.toBikeRackWaypoints.map((p) => ({ x: p.x, y: p.y }));
}

function buildReturnLegFromBuildingToLoadingZone(
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  building: Building
): Point[] | null {
  if (!building.roadApproachPoint || !building.deliveryStopPoint) return null;
  const approach = building.roadApproachPoint;
  const stop = building.deliveryStopPoint;
  const returnRes = findShortestPathFromEdgePoint(
    graph,
    approach.edge,
    { x: approach.x, y: approach.y },
    'base'
  );
  if (!returnRes || returnRes.points.length < 2) return null;

  const returnLanePts = applyRightHandLaneOffsets(returnRes.points, {
    laneIndex: 0,
    vehicleClass: 'bicycle',
  });
  const stopPoint: Point = { x: stop.x, y: stop.y };
  const returnExtras = [...(stop.approachWaypoints ?? [])].reverse();
  const loadingZoneReturn = [...baseDepot.loadingZone.exitWaypoints].reverse();

  return stitchWaypoints([stopPoint], returnExtras, returnLanePts, loadingZoneReturn);
}

function buildOutboundLegFromBaseToBuilding(
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  building: Building,
  startFrom: CourierStartPoint
): Point[] | null {
  if (!building.roadApproachPoint || !building.deliveryStopPoint) return null;
  const approach = building.roadApproachPoint;
  const stop = building.deliveryStopPoint;
  const outboundRes = findShortestPathToEdgePoint(
    graph,
    'base',
    approach.edge,
    { x: approach.x, y: approach.y }
  );
  if (!outboundRes || outboundRes.points.length < 2) return null;

  const outboundLanePts = applyRightHandLaneOffsets(outboundRes.points, {
    laneIndex: 0,
    vehicleClass: 'bicycle',
  });
  const stopPoint: Point = { x: stop.x, y: stop.y };
  const approachExtras = stop.approachWaypoints ?? [];
  const baseExit =
    startFrom === 'loading_zone'
      ? baseDepot.loadingZone.exitWaypoints
      : baseDepot.bikeRack.exitWaypoints;

  return stitchWaypoints(baseExit, outboundLanePts, approachExtras, [stopPoint]);
}

function buildLegBetweenBuildings(
  graph: RoadGraph,
  fromBuilding: Building,
  toBuilding: Building
): Point[] | null {
  if (
    !fromBuilding.roadApproachPoint ||
    !fromBuilding.deliveryStopPoint ||
    !toBuilding.roadApproachPoint ||
    !toBuilding.deliveryStopPoint
  ) {
    return null;
  }

  const fromApproach = fromBuilding.roadApproachPoint;
  const fromStop = fromBuilding.deliveryStopPoint;
  const toApproach = toBuilding.roadApproachPoint;
  const toStop = toBuilding.deliveryStopPoint;

  const roadPts = findShortestPathBetweenEdgePoints(
    graph,
    fromApproach.edge,
    { x: fromApproach.x, y: fromApproach.y },
    toApproach.edge,
    { x: toApproach.x, y: toApproach.y }
  );
  if (!roadPts || roadPts.length < 2) return null;

  const lanePts = applyRightHandLaneOffsets(roadPts, {
    laneIndex: 0,
    vehicleClass: 'bicycle',
  });
  const fromStopPt: Point = { x: fromStop.x, y: fromStop.y };
  const toStopPt: Point = { x: toStop.x, y: toStop.y };
  const departExtras = [...(fromStop.approachWaypoints ?? [])].reverse();
  const arriveExtras = toStop.approachWaypoints ?? [];

  const leg = stitchWaypoints([fromStopPt], departExtras, lanePts, arriveExtras, [toStopPt]);
  return leg.length >= 2 ? leg : [fromStopPt, toStopPt];
}

/**
 * Builds a directed right-hand road return path from the courier's live position
 * back to either the Base loading zone (if carrying cargo) or the Base bike rack / van stall (if empty).
 */
export function buildEmergencyReturnPathToBase(
  graph: RoadGraph,
  currentPos: Point,
  baseDepot: BaseDepotSpec,
  destination: 'loading_zone' | 'rack' = 'rack',
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS
): Point[] {
  const isVan = vehicle.type === 'van';

  if (isVan) {
    const baseNet = getBaseParkingNetwork(parkingNavNetworks, baseDepot, graph);
    const spotEntry =
      destination === 'rack' ? planBaseVanReturnToSpot(baseNet, vehicle.index) : null;
    const loadingZoneTarget = [...baseDepot.loadingZone.exitWaypoints].reverse();
    const fallbackTarget: Point =
      destination === 'loading_zone'
        ? { x: baseDepot.loadingZone.stopX, y: baseDepot.loadingZone.stopY }
        : spotEntry?.canvasPoints[spotEntry.canvasPoints.length - 1] ?? {
            x: baseDepot.loadingZone.stopX,
            y: baseDepot.loadingZone.stopY,
          };

    if (isPointInsideBaseYard(currentPos, baseDepot)) {
      if (destination === 'rack' && spotEntry && spotEntry.canvasPoints.length >= 2) {
        return stitchWaypoints([currentPos], spotEntry.canvasPoints);
      }
      return stitchWaypoints([currentPos], [fallbackTarget]);
    }

    if (destination === 'rack' && spotEntry && spotEntry.canvasPoints.length >= 2) {
      const roadNode = baseNet?.nodes.find((n) => n.id === baseNet.entryRoadNodeId);
      const hasExitNode = graph.nodes.some((n) => n.id === 'n_base_exit');
      if (roadNode && hasExitNode) {
        const toExit = findShortestPathFromRoadPoint(graph, currentPos, 'n_base_exit', 220);
        if (toExit && toExit.points.length >= 2) {
          const roadCenterline = stitchWaypoints(toExit.points, [{ x: roadNode.x, y: roadNode.y }]);
          const lanePts = applyRightHandLaneOffsets(roadCenterline, {
            laneIndex: 0,
            vehicleClass: 'van',
          });
          const full = stitchWaypoints([currentPos], lanePts, spotEntry.canvasPoints.slice(1));
          if (full.length >= 2) {
            return full;
          }
        }
      }
    }

    const roadRes = findShortestPathFromRoadPoint(graph, currentPos, 'base', 220);
    if (roadRes && roadRes.points.length >= 2) {
      const lanePts = applyRightHandLaneOffsets(roadRes.points, {
        laneIndex: 0,
        vehicleClass: 'van',
      });
      const tail =
        destination === 'rack' && spotEntry && spotEntry.canvasPoints.length >= 2
          ? spotEntry.canvasPoints
          : loadingZoneTarget;
      const full = stitchWaypoints([currentPos], lanePts, tail);
      if (full.length >= 2) {
        return full;
      }
    }

    return stitchWaypoints([currentPos], [fallbackTarget]);
  }

  const yardTargetWaypoints =
    destination === 'loading_zone'
      ? [...baseDepot.loadingZone.exitWaypoints].reverse()
      : [...baseDepot.bikeRack.exitWaypoints].reverse();
  const targetPoint =
    destination === 'loading_zone'
      ? { x: baseDepot.loadingZone.stopX, y: baseDepot.loadingZone.stopY }
      : { x: baseDepot.bikeRack.parkedX, y: baseDepot.bikeRack.parkedY };

  // If already on the Base concrete yard, glide cleanly across the yard without detouring onto streets
  if (isPointInsideBaseYard(currentPos, baseDepot)) {
    if (destination === 'rack') {
      const distToLoading = Math.hypot(
        currentPos.x - baseDepot.loadingZone.stopX,
        currentPos.y - baseDepot.loadingZone.stopY
      );
      if (distToLoading < 28) {
        return stitchWaypoints([currentPos], baseDepot.loadingZone.toBikeRackWaypoints);
      }
      return stitchWaypoints([currentPos], [targetPoint]);
    }
    return stitchWaypoints([currentPos], [targetPoint]);
  }

  const roadRes = findShortestPathFromRoadPoint(graph, currentPos, 'base', 220);

  if (roadRes && roadRes.points.length >= 2) {
    const lanePts = applyRightHandLaneOffsets(roadRes.points, {
      laneIndex: 0,
      vehicleClass: 'bicycle',
    });
    const full = stitchWaypoints([currentPos], lanePts, yardTargetWaypoints);
    if (full.length >= 2) {
      return full;
    }
  }

  return stitchWaypoints([currentPos], yardTargetWaypoints.length >= 2 ? yardTargetWaypoints : [targetPoint]);
}

function createMissionCourierFromStops(
  missionKind: Exclude<CourierMissionKind, 'none' | 'manual' | 'park_rack'>,
  stops: CourierMissionStop[],
  initialCargo: CourierCargoItem[],
  speed?: number,
  deliveryPauseDuration = DELIVERY_PAUSE_SECONDS,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 }
): CourierState {
  if (stops.length === 0 || stops[0].legPath.length < 2) {
    return createIdleCourier(vehicle);
  }

  const resolvedSpeed = speed ?? getCourierSpeedForVehicle(vehicle.type);
  const firstStop = stops[0];
  const firstPath = firstStop.legPath.map((p) => ({ x: p.x, y: p.y }));
  const finalReturnPath = stops[stops.length - 1].returnToBasePath.map((p) => ({
    x: p.x,
    y: p.y,
  }));

  const dx = firstPath[1].x - firstPath[0].x;
  const dy = firstPath[1].y - firstPath[0].y;

  return {
    phase: 'outbound',
    active: true,
    arrived: false,
    riderMounted: true,
    path: firstPath,
    outboundPath: firstPath,
    returnPath: finalReturnPath,
    targetLabel: firstStop.label,
    segmentIndex: 0,
    distanceInSegment: 0,
    x: firstPath[0].x,
    y: firstPath[0].y,
    angle: Math.atan2(dy, dx),
    totalDistance: computePolylineLength(firstPath),
    traveledDistance: 0,
    speed: resolvedSpeed,
    currentSpeed: 0,
    deliveryPauseRemaining: 0,
    deliveryPauseDuration: Math.max(0, deliveryPauseDuration),
    wheelPhase: 0,
    missionKind,
    vehicleType: vehicle.type,
    vehicleIndex: Math.max(1, Math.floor(vehicle.index || 1)),
    cargoCapacity: getCourierCapacityForVehicle(vehicle.type),
    stops,
    currentStopIndex: 0,
    cargo: initialCargo.map((item) => ({ ...item })),
    isForcedReturn: false,
  };
}

/**
 * Creates a Stage-1 Pickup Mission:
 * Base (bike rack / Base parking spot P1–P8 / loading zone) -> sender building (`pickup`) -> Base loading zone (`base_unload`).
 */
export function createPickupMissionCourier(
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  senderBuilding: Building,
  orderId: string,
  plannedPickupCount: number,
  startFrom: CourierStartPoint = 'rack',
  speed?: number,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS
): CourierState {
  if (plannedPickupCount <= 0) {
    return createIdleCourier(vehicle);
  }

  const resolvedSpeed = speed ?? getCourierSpeedForVehicle(vehicle.type);
  const lz = baseDepot.loadingZone;

  if (vehicle.type === 'van') {
    const stopPlan = resolveVanStopForBuilding(senderBuilding, parkingNavNetworks);
    if (!stopPlan) {
      return createIdleCourier(vehicle);
    }

    const outboundPath = buildVanOutboundLegFromBaseToStop(
      graph,
      baseDepot,
      stopPlan,
      startFrom,
      vehicle.index,
      parkingNavNetworks
    );
    const returnToLoadingZone = buildVanReturnLegFromStopToLoadingZone(
      graph,
      baseDepot,
      stopPlan
    );
    if (
      !outboundPath ||
      outboundPath.length < 2 ||
      !returnToLoadingZone ||
      returnToLoadingZone.length < 2
    ) {
      return createIdleCourier(vehicle);
    }

    const actualStopPoint = outboundPath[outboundPath.length - 1];
    const parkReturnWaypoints = buildVanLoadingZoneToSpotWaypoints(
      baseDepot,
      parkingNavNetworks,
      vehicle.index,
      undefined,
      graph
    );

    const pickupStop: CourierMissionStop = {
      kind: 'pickup',
      buildingId: senderBuilding.id,
      label: formatBuildingAddress(senderBuilding),
      stopPoint: { x: actualStopPoint.x, y: actualStopPoint.y },
      pauseDuration: DELIVERY_PAUSE_SECONDS,
      orderId,
      plannedPickupCount,
      legPath: outboundPath,
      returnToBasePath: returnToLoadingZone,
    };

    const baseUnloadStop: CourierMissionStop = {
      kind: 'base_unload',
      buildingId: 'base',
      label: 'BAZA (rozładunek)',
      stopPoint: { x: lz.stopX, y: lz.stopY },
      pauseDuration: BASE_TRANSFER_PAUSE_SECONDS,
      legPath: returnToLoadingZone,
      returnToBasePath: parkReturnWaypoints,
    };

    return createMissionCourierFromStops(
      'pickup',
      [pickupStop, baseUnloadStop],
      [],
      resolvedSpeed,
      DELIVERY_PAUSE_SECONDS,
      vehicle
    );
  }

  if (!senderBuilding.deliveryStopPoint) {
    return createIdleCourier(vehicle);
  }

  const outboundPath = buildOutboundLegFromBaseToBuilding(
    graph,
    baseDepot,
    senderBuilding,
    startFrom
  );
  const returnToLoadingZone = buildReturnLegFromBuildingToLoadingZone(
    graph,
    baseDepot,
    senderBuilding
  );
  if (
    !outboundPath ||
    outboundPath.length < 2 ||
    !returnToLoadingZone ||
    returnToLoadingZone.length < 2
  ) {
    return createIdleCourier(vehicle);
  }

  const pickupStop: CourierMissionStop = {
    kind: 'pickup',
    buildingId: senderBuilding.id,
    label: formatBuildingAddress(senderBuilding),
    stopPoint: {
      x: senderBuilding.deliveryStopPoint.x,
      y: senderBuilding.deliveryStopPoint.y,
    },
    pauseDuration: DELIVERY_PAUSE_SECONDS,
    orderId,
    plannedPickupCount,
    legPath: outboundPath,
    returnToBasePath: returnToLoadingZone,
  };

  const baseUnloadStop: CourierMissionStop = {
    kind: 'base_unload',
    buildingId: 'base',
    label: 'BAZA (rozładunek)',
    stopPoint: { x: lz.stopX, y: lz.stopY },
    pauseDuration: BASE_TRANSFER_PAUSE_SECONDS,
    legPath: returnToLoadingZone,
    returnToBasePath: lz.toBikeRackWaypoints,
  };

  return createMissionCourierFromStops(
    'pickup',
    [pickupStop, baseUnloadStop],
    [],
    resolvedSpeed,
    DELIVERY_PAUSE_SECONDS,
    vehicle
  );
}

export interface DeliveryStopInput {
  building: Building;
  items: CourierCargoItem[];
}

/**
 * Orders delivery stops by greedy nearest-neighbor starting from Base so the courier
 * rides a natural multi-stop city route instead of zig-zagging across the map.
 */
function orderStopsNearestNeighbor(
  stopsInput: readonly DeliveryStopInput[],
  startPoint: Point
): DeliveryStopInput[] {
  const remaining = [...stopsInput];
  const ordered: DeliveryStopInput[] = [];
  let cursor = startPoint;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const sp = remaining[i].building.deliveryStopPoint ?? remaining[i].building.roadApproachPoint;
      const d = sp ? Math.hypot(sp.x - cursor.x, sp.y - cursor.y) : Infinity;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    ordered.push(picked);
    const nextAnchor = picked.building.deliveryStopPoint ?? picked.building.roadApproachPoint;
    if (nextAnchor) {
      cursor = {
        x: nextAnchor.x,
        y: nextAnchor.y,
      };
    }
  }

  return ordered;
}

/**
 * Creates a Stage-2 Multi-Stop Delivery Mission:
 * - First moves to (or pauses directly at) the Base loading zone (`base_load`) to load parcels from warehouse
 * - Rides/drives Base loading zone -> recipient 1 -> recipient 2 -> ... -> recipient N -> Base loading zone
 */
export function createDeliveryMissionCourier(
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  stopsInput: readonly DeliveryStopInput[],
  initialCargo: readonly CourierCargoItem[],
  startFrom: CourierStartPoint = 'rack',
  speed?: number,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS
): CourierState {
  if (stopsInput.length === 0 || initialCargo.length === 0) {
    return createIdleCourier(vehicle);
  }

  const resolvedSpeed = speed ?? getCourierSpeedForVehicle(vehicle.type);
  const lz = baseDepot.loadingZone;
  const lzPoint: Point = { x: lz.stopX, y: lz.stopY };
  const orderedInputs = orderStopsNearestNeighbor(stopsInput, lzPoint);

  const deliveryStops: CourierMissionStop[] = [];

  if (vehicle.type === 'van') {
    const usedSpotIds = new Set<string>();
    let prevPlan: VanBuildingStopPlan | null = null;

    for (const entry of orderedInputs) {
      const b = entry.building;
      const stopPlan = resolveVanStopForBuilding(b, parkingNavNetworks, usedSpotIds);
      if (!stopPlan) continue;

      const legPath = prevPlan
        ? buildVanLegBetweenStops(graph, prevPlan, stopPlan)
        : buildVanOutboundLegFromBaseToStop(
            graph,
            baseDepot,
            stopPlan,
            'loading_zone',
            vehicle.index,
            parkingNavNetworks
          );
      const returnToLoadingZone = buildVanReturnLegFromStopToLoadingZone(
        graph,
        baseDepot,
        stopPlan
      );

      if (
        !legPath ||
        legPath.length < 2 ||
        !returnToLoadingZone ||
        returnToLoadingZone.length < 2
      ) {
        continue;
      }

      if (stopPlan.parkingSpotId) {
        usedSpotIds.add(stopPlan.parkingSpotId);
      }

      const actualStopPoint = legPath[legPath.length - 1];
      deliveryStops.push({
        kind: 'delivery',
        buildingId: b.id,
        label: formatBuildingAddress(b),
        stopPoint: { x: actualStopPoint.x, y: actualStopPoint.y },
        pauseDuration: DELIVERY_PAUSE_SECONDS,
        deliveryItems: entry.items.map((it) => ({ ...it })),
        legPath,
        returnToBasePath: returnToLoadingZone,
      });
      prevPlan = stopPlan;
    }
  } else {
    let prevBuilding: Building | null = null;

    for (const entry of orderedInputs) {
      const b = entry.building;
      if (!b.deliveryStopPoint || !b.roadApproachPoint) continue;

      const legPath = prevBuilding
        ? buildLegBetweenBuildings(graph, prevBuilding, b)
        : buildOutboundLegFromBaseToBuilding(graph, baseDepot, b, 'loading_zone');
      const returnToLoadingZone = buildReturnLegFromBuildingToLoadingZone(graph, baseDepot, b);

      if (
        !legPath ||
        legPath.length < 2 ||
        !returnToLoadingZone ||
        returnToLoadingZone.length < 2
      ) {
        continue;
      }

      deliveryStops.push({
        kind: 'delivery',
        buildingId: b.id,
        label: formatBuildingAddress(b),
        stopPoint: { x: b.deliveryStopPoint.x, y: b.deliveryStopPoint.y },
        pauseDuration: DELIVERY_PAUSE_SECONDS,
        deliveryItems: entry.items.map((it) => ({ ...it })),
        legPath,
        returnToBasePath: returnToLoadingZone,
      });
      prevBuilding = b;
    }
  }

  if (deliveryStops.length === 0) {
    return createIdleCourier(vehicle);
  }

  const baseLoadLegPath =
    vehicle.type === 'van'
      ? buildVanSpotToLoadingZoneWaypoints(baseDepot, parkingNavNetworks, vehicle.index, graph)
      : lz.fromBikeRackWaypoints;
  const baseLoadReturnPath =
    vehicle.type === 'van'
      ? buildVanLoadingZoneToSpotWaypoints(
          baseDepot,
          parkingNavNetworks,
          vehicle.index,
          undefined,
          graph
        )
      : lz.toBikeRackWaypoints;

  const baseLoadStop: CourierMissionStop = {
    kind: 'base_load',
    buildingId: 'base',
    label: 'BAZA (załadunek)',
    stopPoint: lzPoint,
    pauseDuration: BASE_TRANSFER_PAUSE_SECONDS,
    legPath: baseLoadLegPath,
    returnToBasePath: baseLoadReturnPath,
  };

  const allStops: CourierMissionStop[] = [baseLoadStop, ...deliveryStops];
  const finalReturnPath = deliveryStops[deliveryStops.length - 1].returnToBasePath;

  if (startFrom === 'loading_zone') {
    // Already parked at the Base loading bay -> load parcels immediately before departing
    return {
      phase: 'delivering',
      active: true,
      arrived: true,
      riderMounted: false,
      path: deliveryStops[0].legPath.map((p) => ({ x: p.x, y: p.y })),
      outboundPath: deliveryStops[0].legPath.map((p) => ({ x: p.x, y: p.y })),
      returnPath: finalReturnPath.map((p) => ({ x: p.x, y: p.y })),
      targetLabel: baseLoadStop.label,
      segmentIndex: 0,
      distanceInSegment: 0,
      x: lz.stopX,
      y: lz.stopY,
      angle: lz.stopAngle,
      totalDistance: 0,
      traveledDistance: 0,
      speed: resolvedSpeed,
      currentSpeed: 0,
      deliveryPauseRemaining: BASE_TRANSFER_PAUSE_SECONDS,
      deliveryPauseDuration: DELIVERY_PAUSE_SECONDS,
      wheelPhase: 0,
      missionKind: 'delivery',
      vehicleType: vehicle.type,
      vehicleIndex: Math.max(1, Math.floor(vehicle.index || 1)),
      cargoCapacity: getCourierCapacityForVehicle(vehicle.type),
      stops: allStops,
      currentStopIndex: 0,
      cargo: initialCargo.map((it) => ({ ...it })),
      isForcedReturn: false,
    };
  }

  return createMissionCourierFromStops(
    'delivery',
    allStops,
    initialCargo.map((it) => ({ ...it })),
    resolvedSpeed,
    DELIVERY_PAUSE_SECONDS,
    vehicle
  );
}

/**
 * Creates a short Base-yard parking ride from the loading zone (or live Base yard position)
 * back to the exterior bike rack (for bicycles) or assigned Base stall `P1–P8` (for vans)
 * when all tasks for the day are finished or night begins.
 */
export function createParkAtRackCourier(
  baseDepot: BaseDepotSpec,
  fromPoint?: Point,
  wasForcedReturn = false,
  speed?: number,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS,
  graph?: RoadGraph
): CourierState {
  const resolvedSpeed = speed ?? getCourierSpeedForVehicle(vehicle.type);
  const parkWaypoints =
    vehicle.type === 'van'
      ? buildVanLoadingZoneToSpotWaypoints(
          baseDepot,
          parkingNavNetworks,
          vehicle.index,
          fromPoint,
          graph
        )
      : fromPoint
        ? stitchWaypoints([fromPoint], baseDepot.loadingZone.toBikeRackWaypoints)
        : baseDepot.loadingZone.toBikeRackWaypoints.map((p) => ({ x: p.x, y: p.y }));

  if (parkWaypoints.length < 2) {
    return createIdleCourier(vehicle);
  }

  const dx = parkWaypoints[1].x - parkWaypoints[0].x;
  const dy = parkWaypoints[1].y - parkWaypoints[0].y;

  return {
    phase: 'returning',
    active: true,
    arrived: false,
    riderMounted: true,
    path: parkWaypoints,
    outboundPath: parkWaypoints,
    returnPath: parkWaypoints,
    targetLabel:
      vehicle.type === 'van' ? `BAZA (parking P${vehicle.index})` : 'BAZA (stojak)',
    segmentIndex: 0,
    distanceInSegment: 0,
    x: parkWaypoints[0].x,
    y: parkWaypoints[0].y,
    angle: Math.atan2(dy, dx),
    totalDistance: computePolylineLength(parkWaypoints),
    traveledDistance: 0,
    speed: resolvedSpeed,
    currentSpeed: 0,
    deliveryPauseRemaining: 0,
    deliveryPauseDuration: 0,
    wheelPhase: 0,
    missionKind: 'park_rack',
    vehicleType: vehicle.type,
    vehicleIndex: Math.max(1, Math.floor(vehicle.index || 1)),
    cargoCapacity: getCourierCapacityForVehicle(vehicle.type),
    stops: [],
    currentStopIndex: 0,
    cargo: [],
    isForcedReturn: wasForcedReturn,
  };
}

/**
 * Immediately interrupts an active courier when seasonal workday hours end:
 * - If carrying packages: routes to the Base loading zone first to safely unload cargo
 *   into the warehouse, after which the vehicle parks at the bike rack or Base stall P1–P8.
 * - If carrying no packages: routes directly back to the Base bike rack or Base stall P1–P8.
 */
export function interruptCourierForEndOfWorkday(
  state: CourierState,
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS
): CourierState {
  if (!state.active || state.phase === 'idle') {
    return state;
  }

  if (state.missionKind === 'park_rack') {
    return state.isForcedReturn ? state : { ...state, isForcedReturn: true };
  }

  const currentStop = state.stops[state.currentStopIndex];
  const hasCargo = state.cargo.some((item) => item.count > 0);
  const lz = baseDepot.loadingZone;

  // Already heading to or unloading at the Base loading zone -> just mark forced return
  if (currentStop?.kind === 'base_unload') {
    return state.isForcedReturn ? state : { ...state, isForcedReturn: true };
  }

  // Already on a clean empty return leg back to Base -> let it finish and then park at rack
  if (state.phase === 'returning' && !hasCargo) {
    return state.isForcedReturn ? state : { ...state, isForcedReturn: true };
  }

  const activeVehicle: ActiveVehicleSelection = {
    type: state.vehicleType,
    index: state.vehicleIndex,
  };
  const parkReturnWaypoints =
    state.vehicleType === 'van'
      ? buildVanLoadingZoneToSpotWaypoints(
          baseDepot,
          parkingNavNetworks,
          state.vehicleIndex,
          undefined,
          graph
        )
      : lz.toBikeRackWaypoints;

  // If paused at the loading zone mid-loading when workday ends, immediately unload back to warehouse
  if (hasCargo && state.phase === 'delivering' && currentStop?.kind === 'base_load') {
    const unloadHereStop: CourierMissionStop = {
      kind: 'base_unload',
      buildingId: 'base',
      label: 'BAZA (rozładunek)',
      stopPoint: { x: lz.stopX, y: lz.stopY },
      pauseDuration: 0.6,
      legPath: parkReturnWaypoints,
      returnToBasePath: parkReturnWaypoints,
    };
    return {
      ...state,
      phase: 'delivering',
      active: true,
      arrived: true,
      riderMounted: false,
      currentSpeed: 0,
      deliveryPauseRemaining: 0.6,
      stops: [unloadHereStop],
      currentStopIndex: 0,
      targetLabel: unloadHereStop.label,
      isForcedReturn: true,
    };
  }

  if (hasCargo) {
    // Route back to Base loading zone so carried packages are safely unloaded into warehouse
    let returnToLoadingPath: Point[];
    if (
      state.phase === 'delivering' &&
      currentStop &&
      (currentStop.kind === 'pickup' || currentStop.kind === 'delivery') &&
      currentStop.returnToBasePath.length >= 2
    ) {
      returnToLoadingPath = currentStop.returnToBasePath.map((p) => ({ x: p.x, y: p.y }));
    } else {
      returnToLoadingPath = buildEmergencyReturnPathToBase(
        graph,
        { x: state.x, y: state.y },
        baseDepot,
        'loading_zone',
        activeVehicle,
        parkingNavNetworks
      );
    }

    const baseUnloadStop: CourierMissionStop = {
      kind: 'base_unload',
      buildingId: 'base',
      label: 'BAZA (rozładunek)',
      stopPoint: { x: lz.stopX, y: lz.stopY },
      pauseDuration: 0.8,
      legPath: returnToLoadingPath,
      returnToBasePath: parkReturnWaypoints,
    };

    if (returnToLoadingPath.length < 2) {
      return {
        ...state,
        phase: 'delivering',
        active: true,
        arrived: true,
        riderMounted: false,
        currentSpeed: 0,
        deliveryPauseRemaining: 0.6,
        stops: [baseUnloadStop],
        currentStopIndex: 0,
        targetLabel: baseUnloadStop.label,
        isForcedReturn: true,
      };
    }

    const dx = returnToLoadingPath[1].x - returnToLoadingPath[0].x;
    const dy = returnToLoadingPath[1].y - returnToLoadingPath[0].y;
    const nextAngle = Math.atan2(dy, dx);
    const headingAlignment = Math.cos(nextAngle - state.angle);
    const initialReturnSpeed =
      state.phase === 'delivering'
        ? 0
        : Math.max(0, state.currentSpeed * Math.max(0, headingAlignment));

    return {
      ...state,
      phase: 'returning',
      active: true,
      arrived: false,
      riderMounted: true,
      path: returnToLoadingPath,
      returnPath: returnToLoadingPath,
      targetLabel: baseUnloadStop.label,
      segmentIndex: 0,
      distanceInSegment: 0,
      x: returnToLoadingPath[0].x,
      y: returnToLoadingPath[0].y,
      angle: nextAngle,
      totalDistance: computePolylineLength(returnToLoadingPath),
      traveledDistance: 0,
      currentSpeed: initialReturnSpeed,
      deliveryPauseRemaining: 0,
      stops: [baseUnloadStop],
      currentStopIndex: 0,
      isForcedReturn: true,
    };
  }

  // Carrying no packages -> return straight to the Base bike rack or assigned Base van stall P1–P8
  const returnToRackPath = buildEmergencyReturnPathToBase(
    graph,
    { x: state.x, y: state.y },
    baseDepot,
    'rack',
    activeVehicle,
    parkingNavNetworks
  );

  if (returnToRackPath.length < 2) {
    return {
      ...state,
      missionKind: 'park_rack',
      phase: 'returning',
      riderMounted: true,
      arrived: false,
      deliveryPauseRemaining: 0,
      isForcedReturn: true,
      stops: [],
      currentStopIndex: 0,
    };
  }

  const dx = returnToRackPath[1].x - returnToRackPath[0].x;
  const dy = returnToRackPath[1].y - returnToRackPath[0].y;
  const nextAngle = Math.atan2(dy, dx);
  const headingAlignment = Math.cos(nextAngle - state.angle);
  const initialReturnSpeed =
    state.phase === 'delivering'
      ? 0
      : Math.max(0, state.currentSpeed * Math.max(0, headingAlignment));

  return {
    ...state,
    missionKind: 'park_rack',
    phase: 'returning',
    active: true,
    arrived: false,
    riderMounted: true,
    path: returnToRackPath,
    returnPath: returnToRackPath,
    targetLabel:
      state.vehicleType === 'van' ? `BAZA (parking P${state.vehicleIndex})` : 'BAZA (stojak)',
    segmentIndex: 0,
    distanceInSegment: 0,
    x: returnToRackPath[0].x,
    y: returnToRackPath[0].y,
    angle: nextAngle,
    totalDistance: computePolylineLength(returnToRackPath),
    traveledDistance: 0,
    currentSpeed: initialReturnSpeed,
    deliveryPauseRemaining: 0,
    stops: [],
    currentStopIndex: 0,
    isForcedReturn: true,
  };
}

// ============================================================================
// Kinematics & Frame-Rate-Independent Mission Stepping
// ============================================================================

function subtractDeliveredCargo(
  cargo: readonly CourierCargoItem[],
  delivered: readonly CourierCargoItem[]
): CourierCargoItem[] {
  if (delivered.length === 0) return cargo.map((c) => ({ ...c }));

  const deliveredMap = new Map<string, number>();
  for (const item of delivered) {
    deliveredMap.set(item.orderId, (deliveredMap.get(item.orderId) ?? 0) + item.count);
  }

  const remaining: CourierCargoItem[] = [];
  for (const item of cargo) {
    const deduct = deliveredMap.get(item.orderId) ?? 0;
    if (deduct <= 0) {
      remaining.push({ ...item });
      continue;
    }
    const left = item.count - deduct;
    if (left > 0) {
      remaining.push({ orderId: item.orderId, count: left });
      deliveredMap.set(item.orderId, 0);
    } else {
      deliveredMap.set(item.orderId, deduct - item.count);
    }
  }
  return remaining;
}

function beginLegOnPath(
  state: CourierState,
  phase: 'outbound' | 'returning',
  nextPath: Point[],
  wheelPhase: number,
  overrides: Partial<CourierState> = {}
): CourierState {
  if (nextPath.length < 2) {
    return createIdleCourier({ type: state.vehicleType, index: state.vehicleIndex });
  }

  const dx = nextPath[1].x - nextPath[0].x;
  const dy = nextPath[1].y - nextPath[0].y;
  return {
    ...state,
    ...overrides,
    phase,
    active: true,
    arrived: false,
    riderMounted: true,
    path: nextPath,
    segmentIndex: 0,
    distanceInSegment: 0,
    x: nextPath[0].x,
    y: nextPath[0].y,
    angle: Math.atan2(dy, dx),
    totalDistance: computePolylineLength(nextPath),
    traveledDistance: 0,
    currentSpeed: 0,
    deliveryPauseRemaining: 0,
    wheelPhase,
  };
}

function beginReturnLeg(state: CourierState, wheelPhase: number): CourierState {
  const currentStop = state.stops[state.currentStopIndex];
  const returnPath =
    currentStop && currentStop.returnToBasePath.length >= 2
      ? currentStop.returnToBasePath
      : state.returnPath.length >= 2
        ? state.returnPath
        : [...state.outboundPath].reverse();

  return beginLegOnPath(state, 'returning', returnPath, wheelPhase, {
    returnPath,
    targetLabel: 'BAZA',
  });
}

function computeDesiredCourierSpeed(
  state: CourierState,
  segIdx: number,
  distInSeg: number
): number {
  const maxSpeed = Math.max(MIN_APPROACH_SPEED, state.speed);
  const remainingToEnd = Math.max(0, state.totalDistance - state.traveledDistance);
  const stopBrakingSpeed = Math.max(
    MIN_APPROACH_SPEED,
    Math.sqrt(2 * COURIER_DECELERATION * remainingToEnd)
  );

  let desiredSpeed = Math.min(maxSpeed, stopBrakingSpeed);

  const path = state.path;
  if (segIdx >= path.length - 2) {
    return desiredSpeed;
  }

  let distAhead = 0;
  for (let i = segIdx; i < path.length - 2; i++) {
    const a = path[i];
    const b = path[i + 1];
    const c = path[i + 2];

    const seg1Dx = b.x - a.x;
    const seg1Dy = b.y - a.y;
    const seg1Len = Math.hypot(seg1Dx, seg1Dy);
    const seg2Dx = c.x - b.x;
    const seg2Dy = c.y - b.y;
    const seg2Len = Math.hypot(seg2Dx, seg2Dy);

    const distToVertex = i === segIdx ? Math.max(0, seg1Len - distInSeg) : seg1Len;
    distAhead += distToVertex;
    if (distAhead > CORNER_LOOKAHEAD_DISTANCE) {
      break;
    }

    if (seg1Len > 1.5 && seg2Len > 1.5) {
      const dot = (seg1Dx * seg2Dx + seg1Dy * seg2Dy) / (seg1Len * seg2Len);
      if (dot < 0.94) {
        const turnSeverity = Math.max(0, Math.min(1, (0.94 - dot) / 1.15));
        const cornerTargetSpeed =
          maxSpeed * (1 - (1 - MIN_CORNER_SPEED_FACTOR) * turnSeverity);
        const cornerApproachCap = Math.sqrt(
          cornerTargetSpeed * cornerTargetSpeed + 2 * COURIER_DECELERATION * Math.max(0, distAhead)
        );
        if (cornerApproachCap < desiredSpeed) {
          desiredSpeed = cornerApproachCap;
        }
      }
    }
  }

  return Math.max(MIN_APPROACH_SPEED, desiredSpeed);
}

export const MAX_REAL_FRAME_DT = 0.05;

export function computeScaledSimDt(rawRealDt: number, speedMultiplier = 1): number {
  if (!Number.isFinite(rawRealDt) || !Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    return 0;
  }
  const clampedRealDt = Math.min(Math.max(0, rawRealDt), MAX_REAL_FRAME_DT);
  return clampedRealDt * speedMultiplier;
}

export function simDtToGameMinutes(simDt: number): number {
  if (!Number.isFinite(simDt) || simDt <= 0) return 0;
  return simDt * BASE_GAME_MINUTES_PER_REAL_SECOND;
}

function stepCourierBySimDtInternal(
  state: CourierState,
  dt: number,
  events: CourierSimEvent[]
): CourierState {
  if (!state.active || state.phase === 'idle' || dt <= 0) {
    return state;
  }

  // Paused at a stop (customer building handoff or Base loading/unloading bay)
  if (state.phase === 'delivering') {
    const remaining = state.deliveryPauseRemaining - dt;
    if (remaining > 0) {
      return {
        ...state,
        riderMounted: false,
        currentSpeed: 0,
        deliveryPauseRemaining: remaining,
      };
    }

    const leftoverDt = -remaining;
    const currentStop = state.stops[state.currentStopIndex];

    if (currentStop) {
      if (currentStop.kind === 'base_load') {
        const nextStopIndex = state.currentStopIndex + 1;
        if (nextStopIndex < state.stops.length && !state.isForcedReturn) {
          const nextStop = state.stops[nextStopIndex];
          const nextLegState = beginLegOnPath(
            state,
            'outbound',
            nextStop.legPath,
            state.wheelPhase,
            {
              currentStopIndex: nextStopIndex,
              targetLabel: nextStop.label,
            }
          );
          return leftoverDt > 1e-6
            ? stepCourierBySimDtInternal(nextLegState, leftoverDt, events)
            : nextLegState;
        }
        if (state.cargo.length > 0) {
          events.push({
            type: 'base_unloaded',
            cargo: state.cargo.map((c) => ({ ...c })),
          });
        }
        events.push({
          type: 'arrived_at_loading_zone',
          wasForcedReturn: state.isForcedReturn,
        });
        return createIdleCourier({ type: state.vehicleType, index: state.vehicleIndex });
      }

      if (currentStop.kind === 'base_unload') {
        if (state.cargo.length > 0) {
          events.push({
            type: 'base_unloaded',
            cargo: state.cargo.map((c) => ({ ...c })),
          });
        }
        events.push({
          type: 'arrived_at_loading_zone',
          wasForcedReturn: state.isForcedReturn,
        });
        return createIdleCourier({ type: state.vehicleType, index: state.vehicleIndex });
      }

      if (currentStop.kind === 'pickup') {
        if (currentStop.orderId && (currentStop.plannedPickupCount ?? 0) > 0) {
          events.push({
            type: 'pickup_loaded',
            orderId: currentStop.orderId,
            plannedCount: currentStop.plannedPickupCount ?? 0,
            buildingId: currentStop.buildingId,
          });
        }

        const nextStopIndex = state.currentStopIndex + 1;
        const nextStop = state.stops[nextStopIndex];
        if (nextStop && nextStop.kind === 'base_unload' && nextStop.legPath.length >= 2) {
          const unloadReturnState = beginLegOnPath(
            state,
            'returning',
            nextStop.legPath,
            state.wheelPhase,
            {
              currentStopIndex: nextStopIndex,
              returnPath: nextStop.legPath,
              targetLabel: nextStop.label,
            }
          );
          return leftoverDt > 1e-6
            ? stepCourierBySimDtInternal(unloadReturnState, leftoverDt, events)
            : unloadReturnState;
        }

        const returnState = beginReturnLeg(state, state.wheelPhase);
        return leftoverDt > 1e-6
          ? stepCourierBySimDtInternal(returnState, leftoverDt, events)
          : returnState;
      }

      if (currentStop.kind === 'delivery') {
        const deliveredItems = currentStop.deliveryItems ?? [];
        if (deliveredItems.length > 0) {
          events.push({
            type: 'delivery_completed',
            items: deliveredItems.map((it) => ({ ...it })),
            buildingId: currentStop.buildingId,
          });
        }
        const remainingCargo = subtractDeliveredCargo(state.cargo, deliveredItems);
        const nextStopIndex = state.currentStopIndex + 1;

        if (nextStopIndex < state.stops.length && !state.isForcedReturn) {
          const nextStop = state.stops[nextStopIndex];
          const nextLegState = beginLegOnPath(
            state,
            'outbound',
            nextStop.legPath,
            state.wheelPhase,
            {
              currentStopIndex: nextStopIndex,
              targetLabel: nextStop.label,
              cargo: remainingCargo,
            }
          );
          return leftoverDt > 1e-6
            ? stepCourierBySimDtInternal(nextLegState, leftoverDt, events)
            : nextLegState;
        }

        const returnState = beginReturnLeg(
          {
            ...state,
            cargo: remainingCargo,
          },
          state.wheelPhase
        );
        return leftoverDt > 1e-6
          ? stepCourierBySimDtInternal(returnState, leftoverDt, events)
          : returnState;
      }
    }

    const returnState = beginReturnLeg(state, state.wheelPhase);
    return leftoverDt > 1e-6
      ? stepCourierBySimDtInternal(returnState, leftoverDt, events)
      : returnState;
  }

  if (state.path.length < 2) {
    if (state.phase === 'returning') {
      if (state.missionKind === 'park_rack' || state.missionKind === 'manual') {
        events.push({
          type: 'parked_at_rack',
          cargo: state.cargo.map((c) => ({ ...c })),
          wasForcedReturn: state.isForcedReturn,
        });
      } else {
        if (state.cargo.length > 0) {
          events.push({
            type: 'base_unloaded',
            cargo: state.cargo.map((c) => ({ ...c })),
          });
        }
        events.push({
          type: 'arrived_at_loading_zone',
          wasForcedReturn: state.isForcedReturn,
        });
      }
    }
    return createIdleCourier({ type: state.vehicleType, index: state.vehicleIndex });
  }

  // Smooth acceleration, corner slowdown & stop braking (scales naturally with 1x/2x/4x simDt)
  const desiredSpeed = computeDesiredCourierSpeed(
    state,
    state.segmentIndex,
    state.distanceInSegment
  );
  const prevSpeed = Math.max(0, state.currentSpeed);
  const nextSpeed =
    desiredSpeed >= prevSpeed
      ? Math.min(desiredSpeed, prevSpeed + COURIER_ACCELERATION * dt)
      : Math.max(desiredSpeed, prevSpeed - COURIER_DECELERATION * dt);
  const effectiveSpeed = Math.max(MIN_APPROACH_SPEED * 0.5, (prevSpeed + nextSpeed) * 0.5);

  let remainingStep = effectiveSpeed * dt;
  const prevTraveled = state.traveledDistance;
  let segIdx = state.segmentIndex;
  let distInSeg = state.distanceInSegment;
  let traveled = state.traveledDistance;

  while (remainingStep > 0 && segIdx < state.path.length - 1) {
    const a = state.path[segIdx];
    const b = state.path[segIdx + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);

    if (segLen < 1e-4) {
      segIdx++;
      distInSeg = 0;
      continue;
    }

    const leftInSeg = segLen - distInSeg;
    if (remainingStep < leftInSeg) {
      distInSeg += remainingStep;
      traveled += remainingStep;
      remainingStep = 0;
    } else {
      traveled += leftInSeg;
      remainingStep -= leftInSeg;
      segIdx++;
      distInSeg = 0;
    }
  }

  const movedDist = Math.max(0, traveled - prevTraveled);
  const nextWheelPhase = state.wheelPhase + movedDist * WHEEL_RADIANS_PER_PIXEL;

  // Reached end of current leg
  if (segIdx >= state.path.length - 1) {
    const last = state.path[state.path.length - 1];
    const prev = state.path[state.path.length - 2];
    const arrivalAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const currentStop = state.stops[state.currentStopIndex];

    if (state.phase === 'outbound') {
      const pauseDuration = currentStop?.pauseDuration ?? state.deliveryPauseDuration;
      if (pauseDuration <= 0) {
        const pausedZero: CourierState = {
          ...state,
          phase: 'delivering',
          active: true,
          arrived: true,
          riderMounted: false,
          currentSpeed: 0,
          x: last.x,
          y: last.y,
          angle: arrivalAngle,
          traveledDistance: state.totalDistance,
          deliveryPauseRemaining: 0,
          wheelPhase: nextWheelPhase,
        };
        return stepCourierBySimDtInternal(pausedZero, 1e-5, events);
      }

      return {
        ...state,
        phase: 'delivering',
        active: true,
        arrived: true,
        riderMounted: false,
        segmentIndex: state.path.length - 2,
        distanceInSegment: Math.hypot(last.x - prev.x, last.y - prev.y),
        x: last.x,
        y: last.y,
        angle: arrivalAngle,
        traveledDistance: state.totalDistance,
        currentSpeed: 0,
        deliveryPauseRemaining: pauseDuration,
        wheelPhase: nextWheelPhase,
      };
    }

    // Completed return leg:
    // 1. If returning to Base loading zone to unload packages -> pause briefly at loading bay
    if (currentStop?.kind === 'base_unload') {
      const pauseDuration = currentStop.pauseDuration ?? BASE_TRANSFER_PAUSE_SECONDS;
      if (pauseDuration <= 0) {
        const pausedZero: CourierState = {
          ...state,
          phase: 'delivering',
          active: true,
          arrived: true,
          riderMounted: false,
          currentSpeed: 0,
          x: last.x,
          y: last.y,
          angle: arrivalAngle,
          traveledDistance: state.totalDistance,
          deliveryPauseRemaining: 0,
          wheelPhase: nextWheelPhase,
        };
        return stepCourierBySimDtInternal(pausedZero, 1e-5, events);
      }

      return {
        ...state,
        phase: 'delivering',
        active: true,
        arrived: true,
        riderMounted: false,
        segmentIndex: state.path.length - 2,
        distanceInSegment: Math.hypot(last.x - prev.x, last.y - prev.y),
        x: last.x,
        y: last.y,
        angle: arrivalAngle,
        traveledDistance: state.totalDistance,
        currentSpeed: 0,
        deliveryPauseRemaining: pauseDuration,
        wheelPhase: nextWheelPhase,
      };
    }

    // 2. If parking at the Base bike rack or Base van stall (or finishing a manual path) -> park idle
    if (state.missionKind === 'park_rack' || state.missionKind === 'manual') {
      events.push({
        type: 'parked_at_rack',
        cargo: state.cargo.map((c) => ({ ...c })),
        wasForcedReturn: state.isForcedReturn,
      });
      return createIdleCourier({ type: state.vehicleType, index: state.vehicleIndex });
    }

    // 3. Completed return leg from delivery mission to Base loading zone
    if (state.cargo.length > 0) {
      events.push({
        type: 'base_unloaded',
        cargo: state.cargo.map((c) => ({ ...c })),
      });
    }
    events.push({
      type: 'arrived_at_loading_zone',
      wasForcedReturn: state.isForcedReturn,
    });
    return createIdleCourier({ type: state.vehicleType, index: state.vehicleIndex });
  }

  const a = state.path[segIdx];
  const b = state.path[segIdx + 1];
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  const t = segLen > 1e-6 ? distInSeg / segLen : 0;

  return {
    ...state,
    riderMounted: true,
    segmentIndex: segIdx,
    distanceInSegment: distInSeg,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    traveledDistance: Math.min(state.totalDistance, traveled),
    currentSpeed: nextSpeed,
    wheelPhase: nextWheelPhase,
  };
}

export function stepCourierMissionWithSimDt(
  state: CourierState,
  simDt: number
): CourierStepResult {
  if (!Number.isFinite(simDt) || simDt <= 0) {
    return { state, events: [] };
  }
  const events: CourierSimEvent[] = [];
  const nextState = stepCourierBySimDtInternal(state, simDt, events);
  return { state: nextState, events };
}

export function stepCourierWithSimDt(state: CourierState, simDt: number): CourierState {
  return stepCourierMissionWithSimDt(state, simDt).state;
}

export function stepCourier(
  state: CourierState,
  rawDt: number,
  speedMultiplier = 1
): CourierState {
  const simDt = computeScaledSimDt(rawDt, speedMultiplier);
  return stepCourierWithSimDt(state, simDt);
}
