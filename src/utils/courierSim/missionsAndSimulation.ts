import { type Building, formatBuildingAddress } from '../../types/building';
import type { ActiveVehicleSelection } from '../../types/orders';
import type { Point, RoadGraph } from '../../types/roadGraph';
import type { BaseDepotSpec } from '../cityMap';
import { BASE_GAME_MINUTES_PER_REAL_SECOND } from '../gameClock';
import {
  ALL_PARKING_NAV_NETWORKS,
  type ParkingNavNetwork,
  type VanBuildingStopPlan,
  resolveVanStopForBuilding,
} from '../parkingNavigation';
import { createIdleCourier } from './fleetAndTaskSelection';
import {
  buildEmergencyReturnPathToBase,
  buildLegBetweenBuildings,
  buildOutboundLegFromBaseToBuilding,
  buildReturnLegFromBuildingToLoadingZone,
  buildVanLegBetweenStops,
  buildVanLoadingZoneToSpotWaypoints,
  buildVanOutboundLegFromBaseToStop,
  buildVanReturnLegFromStopToLoadingZone,
  buildVanSpotToLoadingZoneWaypoints,
  computePolylineLength,
  stitchWaypoints,
} from './routingAndPathfinding';
import {
  BASE_TRANSFER_PAUSE_SECONDS,
  CORNER_LOOKAHEAD_DISTANCE,
  COURIER_ACCELERATION,
  COURIER_DECELERATION,
  DELIVERY_PAUSE_SECONDS,
  MAX_REAL_FRAME_DT,
  MIN_APPROACH_SPEED,
  MIN_CORNER_SPEED_FACTOR,
  WHEEL_RADIANS_PER_PIXEL,
  type CourierCargoItem,
  type CourierMissionKind,
  type CourierMissionStop,
  type CourierSimEvent,
  type CourierStartPoint,
  type CourierState,
  type CourierStepResult,
  type DeliveryStopInput,
  getCourierCapacityForVehicle,
  getCourierSpeedForVehicle,
} from './typesAndConstants';

function createMissionCourierFromStops(
  missionKind: Exclude<CourierMissionKind, 'none' | 'manual' | 'park_rack'>,
  stops: CourierMissionStop[],
  initialCargo: CourierCargoItem[],
  speed?: number,
  deliveryPauseDuration = DELIVERY_PAUSE_SECONDS,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  courierId = 1,
  assignedTaskId: string | null = null
): CourierState {
  if (stops.length === 0 || stops[0].legPath.length < 2) {
    return createIdleCourier(vehicle, courierId);
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
    courierId: Math.max(1, Math.floor(courierId || 1)),
    inRoute: true,
    assignedTaskId,
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
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS,
  courierId = 1,
  assignedTaskId: string | null = orderId
): CourierState {
  if (plannedPickupCount <= 0) {
    return createIdleCourier(vehicle, courierId);
  }

  const resolvedSpeed = speed ?? getCourierSpeedForVehicle(vehicle.type);
  const lz = baseDepot.loadingZone;

  if (vehicle.type === 'van') {
    const stopPlan = resolveVanStopForBuilding(senderBuilding, parkingNavNetworks);
    if (!stopPlan) {
      return createIdleCourier(vehicle, courierId);
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
      return createIdleCourier(vehicle, courierId);
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
      vehicle,
      courierId,
      assignedTaskId
    );
  }

  if (!senderBuilding.deliveryStopPoint) {
    return createIdleCourier(vehicle, courierId);
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
    return createIdleCourier(vehicle, courierId);
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
    vehicle,
    courierId,
    assignedTaskId
  );
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
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS,
  courierId = 1,
  assignedTaskId: string | null = initialCargo[0]?.orderId ?? null
): CourierState {
  if (stopsInput.length === 0 || initialCargo.length === 0) {
    return createIdleCourier(vehicle, courierId);
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
    return createIdleCourier(vehicle, courierId);
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
      courierId: Math.max(1, Math.floor(courierId || 1)),
      inRoute: true,
      assignedTaskId,
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
    vehicle,
    courierId,
    assignedTaskId
  );
}

/**
 * Creates a direct Multi-Stop Delivery Mission starting immediately from a sender building
 * (Scenario A after final pickup: no return to Base, no `base_load` stop):
 * sender building -> recipient 1 -> recipient 2 -> ... -> recipient N -> Base loading zone.
 */
export function createDirectDeliveryMissionFromBuilding(
  graph: RoadGraph,
  baseDepot: BaseDepotSpec,
  senderBuilding: Building,
  stopsInput: readonly DeliveryStopInput[],
  initialCargo: readonly CourierCargoItem[],
  speed?: number,
  vehicle: ActiveVehicleSelection = { type: 'bike', index: 1 },
  parkingNavNetworks: readonly ParkingNavNetwork[] = ALL_PARKING_NAV_NETWORKS,
  courierId = 1,
  assignedTaskId: string | null = initialCargo[0]?.orderId ?? null
): CourierState {
  if (stopsInput.length === 0 || initialCargo.length === 0) {
    return createIdleCourier(vehicle, courierId);
  }

  const resolvedSpeed = speed ?? getCourierSpeedForVehicle(vehicle.type);
  const deliveryStops: CourierMissionStop[] = [];

  if (vehicle.type === 'van') {
    const senderPlan = resolveVanStopForBuilding(senderBuilding, parkingNavNetworks);
    if (!senderPlan) {
      return createIdleCourier(vehicle, courierId);
    }

    const orderedInputs = orderStopsNearestNeighbor(stopsInput, senderPlan.stopPoint);
    const usedSpotIds = new Set<string>();
    let prevPlan: VanBuildingStopPlan = senderPlan;

    for (const entry of orderedInputs) {
      const b = entry.building;
      const stopPlan = resolveVanStopForBuilding(b, parkingNavNetworks, usedSpotIds);
      if (!stopPlan) continue;

      const legPath = buildVanLegBetweenStops(graph, prevPlan, stopPlan);
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
    if (!senderBuilding.deliveryStopPoint || !senderBuilding.roadApproachPoint) {
      return createIdleCourier(vehicle, courierId);
    }

    const startPt: Point = {
      x: senderBuilding.deliveryStopPoint.x,
      y: senderBuilding.deliveryStopPoint.y,
    };
    const orderedInputs = orderStopsNearestNeighbor(stopsInput, startPt);
    let prevBuilding: Building = senderBuilding;

    for (const entry of orderedInputs) {
      const b = entry.building;
      if (!b.deliveryStopPoint || !b.roadApproachPoint) continue;

      const legPath = buildLegBetweenBuildings(graph, prevBuilding, b);
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
    return createIdleCourier(vehicle, courierId);
  }

  return createMissionCourierFromStops(
    'delivery',
    deliveryStops,
    initialCargo.map((it) => ({ ...it })),
    resolvedSpeed,
    DELIVERY_PAUSE_SECONDS,
    vehicle,
    courierId,
    assignedTaskId
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
  graph?: RoadGraph,
  courierId = 1
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
    return createIdleCourier(vehicle, courierId);
  }

  const dx = parkWaypoints[1].x - parkWaypoints[0].x;
  const dy = parkWaypoints[1].y - parkWaypoints[0].y;

  return {
    courierId: Math.max(1, Math.floor(courierId || 1)),
    inRoute: true,
    assignedTaskId: null,
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
    return state.isForcedReturn && state.assignedTaskId === null
      ? state
      : { ...state, isForcedReturn: true, assignedTaskId: null };
  }

  const currentStop = state.stops[state.currentStopIndex];
  const hasCargo = state.cargo.some((item) => item.count > 0);
  const lz = baseDepot.loadingZone;

  // Already heading to or unloading at the Base loading zone -> just mark forced return
  if (currentStop?.kind === 'base_unload') {
    return state.isForcedReturn && state.assignedTaskId === null
      ? state
      : { ...state, isForcedReturn: true, assignedTaskId: null };
  }

  // Already on a clean empty return leg back to Base -> let it finish and then park at rack
  if (state.phase === 'returning' && !hasCargo) {
    return state.isForcedReturn && state.assignedTaskId === null
      ? state
      : { ...state, isForcedReturn: true, assignedTaskId: null };
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
      assignedTaskId: null,
      inRoute: true,
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
        assignedTaskId: null,
        inRoute: true,
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
      assignedTaskId: null,
      inRoute: true,
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
      assignedTaskId: null,
      inRoute: true,
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
    assignedTaskId: null,
    inRoute: true,
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
    return createIdleCourier(
      { type: state.vehicleType, index: state.vehicleIndex },
      state.courierId
    );
  }

  const dx = nextPath[1].x - nextPath[0].x;
  const dy = nextPath[1].y - nextPath[0].y;
  return {
    ...state,
    ...overrides,
    inRoute: true,
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
        return createIdleCourier(
          { type: state.vehicleType, index: state.vehicleIndex },
          state.courierId
        );
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
        return createIdleCourier(
          { type: state.vehicleType, index: state.vehicleIndex },
          state.courierId
        );
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
          return beginLegOnPath(
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
        }

        return beginReturnLeg(state, state.wheelPhase);
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
    return createIdleCourier(
      { type: state.vehicleType, index: state.vehicleIndex },
      state.courierId
    );
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
      return createIdleCourier(
        { type: state.vehicleType, index: state.vehicleIndex },
        state.courierId
      );
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
    return createIdleCourier(
      { type: state.vehicleType, index: state.vehicleIndex },
      state.courierId
    );
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
