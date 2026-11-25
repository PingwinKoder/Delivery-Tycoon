import type { Building } from '../../types/building';
import type { ActiveVehicleSelection } from '../../types/orders';
import type { Point, RoadEdge, RoadGraph, RoadNode } from '../../types/roadGraph';
import { type BaseDepotSpec, canvasToIso } from '../cityMap';
import {
  ALL_PARKING_NAV_NETWORKS,
  type ParkingNavNetwork,
  type VanBuildingStopPlan,
  buildBaseParkingNavNetwork,
  planBaseVanDepartureFromSpot,
  planBaseVanReturnToSpot,
} from '../parkingNavigation';
import {
  findClosestRoadTarget,
  findShortestPath,
  findShortestPathFromEdgePoint,
  findShortestPathFromRoadPoint,
  findShortestPathToEdgePoint,
} from '../pathfinding';
import { applyRightHandLaneOffsets } from '../trafficLanes';
import { createIdleCourier } from './fleetAndTaskSelection';
import {
  DELIVERY_PAUSE_SECONDS,
  type CourierStartPoint,
  type CourierState,
  getCourierCapacityForVehicle,
  getCourierSpeedForVehicle,
} from './typesAndConstants';

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

export function createCourierFromPath(
  outboundPoints: Point[],
  speed?: number,
  deliveryPauseDuration = DELIVERY_PAUSE_SECONDS,
  returnPoints?: Point[],
  targetLabel?: string,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  courierId = 1
): CourierState {
  if (outboundPoints.length < 2) {
    return createIdleCourier(vehicle, courierId);
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
    courierId: Math.max(1, Math.floor(courierId || 1)),
    inRoute: true,
    assignedTaskId: null,
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
// Multi-Stop Road Routing & Base Loading-Zone / Bike-Rack Path Builders
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

export function buildVanOutboundLegFromBaseToStop(
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

export function buildVanReturnLegFromStopToLoadingZone(
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

export function buildVanLegBetweenStops(
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

export function buildVanSpotToLoadingZoneWaypoints(
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

export function buildVanLoadingZoneToSpotWaypoints(
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

export function buildReturnLegFromBuildingToLoadingZone(
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

export function buildOutboundLegFromBaseToBuilding(
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

export function buildLegBetweenBuildings(
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
