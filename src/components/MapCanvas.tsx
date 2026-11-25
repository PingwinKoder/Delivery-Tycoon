import React, { useEffect, useMemo, useRef } from 'react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data/initialRoadGraph';
import { type Building, formatBuildingAddress } from '../types/building';
import type { Point, RoadGraph } from '../types/roadGraph';
import type { DepthSortedEntity } from '../utils/buildings';
import { BASE_DEPOT, type BaseDepotSpec, canvasToIso } from '../utils/cityMap';
import {
  type ProceduralTextures,
  STATIC_GROUND_BUFFER_SCALE,
  STATIC_GROUND_TILE_PIXEL_SIZE,
  type SceneSpriteAtlas,
  type StaticGroundBuffer,
  type ViewportGroundCache,
  buildSceneSpriteAtlas,
  buildStaticGroundBuffer,
  createBaseParkedVanEntities,
  createProceduralTextures,
  createViewportGroundCache,
  disposeSceneSpriteAtlas,
  disposeStaticGroundBuffer,
  disposeViewportGroundCache,
  renderBuildings3D,
  renderStreetNames,
  updateViewportGroundCache,
} from '../utils/cityRenderer';
import {
  drawBaseLoadingZone,
  drawBikeRackWithOptionalBike,
  drawCourierDestinationPin,
  drawCourierRoute,
  drawIsometricBicycle,
  drawIsometricDeliveryVan,
} from '../utils/courierRenderer';
import {
  type ArrowInputVector,
  type CameraState,
  type CameraVelocity,
  DEFAULT_ZOOM,
  type Size,
  clampCamera,
  createInitialCamera,
  getEffectiveZoom,
  panCameraByScreenDelta,
  stepCameraPhysics,
  zoomCameraAtScreenPoint,
  zoomCameraByWheel,
} from '../utils/camera';
import {
  COURIER_SLOT_INDICES,
  type CourierFleetStatusSnapshot,
  type CourierStartPoint,
  DELIVERY_PAUSE_SECONDS,
  type DeliveryStopInput,
  type FleetCourierSlotState,
  MAX_REAL_FRAME_DT,
  type MultiCourierFleetState,
  buildCourierAtBaseBySlot,
  buildTaskAssignmentsByTaskId,
  collectInFlightCargoForFleet,
  computeScaledSimDt,
  createCourierFromPath,
  createDeliveryMissionCourier,
  createDirectDeliveryMissionFromBuilding,
  createIdleCourier,
  createInitialCourierFleet,
  createParkAtRackCourier,
  createPickupMissionCourier,
  getActiveOutVehiclesForFleet,
  getClaimedTaskIdsForFleet,
  getCourierCapacityForVehicle,
  getCourierCargoCount,
  getCourierSpeedForVehicle,
  getReservedWarehouseSpaceForFleet,
  interruptCourierForEndOfWorkday,
  isVehicleCurrentlyInRoute,
  selectNextCourierTaskForDay,
  selectNextTaskAfterFinalPickup,
  stepCourierMissionWithSimDt,
  stitchWaypoints,
} from '../utils/courierSim';
import type {
  ActiveVehicleSelection,
  CompanyCourier,
  OrderEconomyState,
  WarehouseLoadedBatch,
} from '../types/orders';
import { type GameSpeed, getGameClockDisplay } from '../utils/gameClock';
import {
  getRemainingPickupPackagesForOrderToday,
  isNightHoursForTime,
  pickRandomRecipientBuildingForPackage,
} from '../utils/orderEconomy';
import { getBaseParkedVanSlots } from '../utils/parkingLayout';
import {
  findShortestPathFromEdgePoint,
  findShortestPathToEdgePoint,
} from '../utils/pathfinding';
import {
  ALL_PARKING_NAV_NETWORKS,
  buildBaseParkingNavNetwork,
  resolveVanStopForBuilding,
} from '../utils/parkingNavigation';
import { applyRightHandLaneOffsets } from '../utils/trafficLanes';

export interface MapCanvasController {
  centerOnBase: () => void;
  dispatchCourierToBuilding: (building: Building) => boolean;
  recallCourierToBase: () => WarehouseLoadedBatch[];
  getInFlightCargo: () => WarehouseLoadedBatch[];
  resetCouriersToBase: (couriers?: readonly CompanyCourier[]) => void;
}

interface MapCanvasProps {
  graph: RoadGraph;
  buildings: Building[];
  baseDepot?: BaseDepotSpec;
  bikesCount?: number;
  vansCount?: number;
  activeVehicle?: ActiveVehicleSelection;
  showGrid: boolean;
  footprintOnly: boolean;
  showStreetNames: boolean;
  gameSpeed: GameSpeed;
  gameMinutesRef?: React.RefObject<number>;
  economyStateRef?: React.RefObject<OrderEconomyState>;
  interactionBlocked?: boolean;
  /** Incrementing session counter that forces full fleet reinitialization parked at Base */
  sessionEpoch?: number;
  onFpsChange?: (fps: number) => void;
  onCourierAtBaseChange?: (atBase: boolean) => void;
  onCourierStatusChange?: (status: CourierFleetStatusSnapshot) => void;
  onLoadFromWarehouse?: (
    orderId?: string,
    priorityOrderIds?: readonly string[],
    capacityOverride?: number
  ) => WarehouseLoadedBatch[];
  onPickupPackagesLoaded?: (
    orderId: string,
    requestedCount: number,
    currentGameDay: number,
    capacityOverride?: number
  ) => number;
  onDeliverPackages?: (
    items: readonly WarehouseLoadedBatch[],
    currentGameMinutes: number
  ) => void;
  onReturnCargoToWarehouse?: (cargo: readonly WarehouseLoadedBatch[]) => void;
  controllerRef: React.MutableRefObject<MapCanvasController | null>;
}

const MAP_SIZE: Size = { width: MAP_WIDTH, height: MAP_HEIGHT };
const FPS_SAMPLE_WINDOW_MS = 500;
const FRAME_INTERVAL_MS = 1000 / 60.5;
const MAX_CANVAS_DPR = 1.5;
const DEFAULT_ACTIVE_VEHICLE: ActiveVehicleSelection = { type: 'bike', index: 1 };

type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function isArrowKey(key: string): key is ArrowKey {
  return (
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight'
  );
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export const MapCanvas: React.FC<MapCanvasProps> = React.memo(({
  graph,
  buildings,
  baseDepot = BASE_DEPOT,
  bikesCount = 1,
  vansCount = 0,
  activeVehicle = DEFAULT_ACTIVE_VEHICLE,
  showGrid,
  footprintOnly,
  showStreetNames,
  gameSpeed,
  gameMinutesRef,
  economyStateRef,
  interactionBlocked = false,
  sessionEpoch = 0,
  onFpsChange,
  onCourierAtBaseChange,
  onCourierStatusChange,
  onLoadFromWarehouse,
  onPickupPackagesLoaded,
  onDeliverPackages,
  onReturnCargoToWarehouse,
  controllerRef,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texturesRef = useRef<ProceduralTextures | null>(null);
  const groundBufferRef = useRef<StaticGroundBuffer | null>(null);
  const viewportGroundCacheRef = useRef<ViewportGroundCache | null>(null);
  const sceneSpriteAtlasRef = useRef<SceneSpriteAtlas | null>(null);
  const internalGameMinutesRef = useRef<number>(0);

  const viewportRef = useRef<Size>({ width: 1440, height: 900 });
  const cameraRef = useRef<CameraState>({ x: 820, y: 1460, zoom: DEFAULT_ZOOM });
  const targetCameraRef = useRef<CameraState>({ x: 820, y: 1460, zoom: DEFAULT_ZOOM });
  const cameraVelocityRef = useRef<CameraVelocity>({ vx: 0, vy: 0 });
  const initializedCameraRef = useRef<boolean>(false);
  const pressedArrowKeysRef = useRef<Set<ArrowKey>>(new Set());

  const couriersFleetRef = useRef<MultiCourierFleetState>(
    createInitialCourierFleet(economyStateRef?.current?.couriers)
  );
  const courierAtBaseReportedRef = useRef<boolean>(true);
  const reportedAtBaseBySlotRef = useRef<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
  });
  const reportedTaskAssignmentsRef = useRef<Record<string, number>>({});
  const lastSessionEpochRef = useRef<number>(sessionEpoch);

  const baseNode = useMemo(
    () => graph.nodes.find((n) => n.id === 'base' || n.kind === 'base') ?? null,
    [graph]
  );

  const parkingNavNetworks = useMemo(() => {
    if (baseDepot === BASE_DEPOT) return ALL_PARKING_NAV_NETWORKS;
    const dynamicBaseNav = buildBaseParkingNavNetwork(baseDepot, graph);
    return ALL_PARKING_NAV_NETWORKS.map((net) =>
      net.kind === 'base_fleet' ? dynamicBaseNav : net
    );
  }, [baseDepot, graph]);

  // Sync latest React props into refs for rAF & event handlers
  const propsRef = useRef({
    graph,
    baseNode,
    buildings,
    baseDepot,
    bikesCount,
    vansCount,
    activeVehicle,
    parkingNavNetworks,
    showGrid,
    footprintOnly,
    showStreetNames,
    gameSpeed,
    gameMinutesRef: gameMinutesRef ?? internalGameMinutesRef,
    economyStateRef,
    interactionBlocked,
    onFpsChange,
    onCourierAtBaseChange,
    onCourierStatusChange,
    onLoadFromWarehouse,
    onPickupPackagesLoaded,
    onDeliverPackages,
    onReturnCargoToWarehouse,
  });
  propsRef.current = {
    graph,
    baseNode,
    buildings,
    baseDepot,
    bikesCount,
    vansCount,
    activeVehicle,
    parkingNavNetworks,
    showGrid,
    footprintOnly,
    showStreetNames,
    gameSpeed,
    gameMinutesRef: gameMinutesRef ?? internalGameMinutesRef,
    economyStateRef,
    interactionBlocked,
    onFpsChange,
    onCourierAtBaseChange,
    onCourierStatusChange,
    onLoadFromWarehouse,
    onPickupPackagesLoaded,
    onDeliverPackages,
    onReturnCargoToWarehouse,
  };

  const syncFleetStatus = () => {
    const fleet = couriersFleetRef.current;
    const nextAtBaseBySlot = buildCourierAtBaseBySlot(fleet);
    const nextAllAtBase = COURIER_SLOT_INDICES.every((slot) => nextAtBaseBySlot[slot]);
    const nextTaskAssignments = buildTaskAssignmentsByTaskId(fleet);

    const prevAtBase = reportedAtBaseBySlotRef.current;
    let atBaseChanged = false;
    for (const slot of COURIER_SLOT_INDICES) {
      if (prevAtBase[slot] !== nextAtBaseBySlot[slot]) {
        atBaseChanged = true;
        break;
      }
    }

    const prevTasks = reportedTaskAssignmentsRef.current;
    const prevTaskKeys = Object.keys(prevTasks);
    const nextTaskKeys = Object.keys(nextTaskAssignments);
    let tasksChanged = prevTaskKeys.length !== nextTaskKeys.length;
    if (!tasksChanged) {
      for (const key of nextTaskKeys) {
        if (prevTasks[key] !== nextTaskAssignments[key]) {
          tasksChanged = true;
          break;
        }
      }
    }

    if (atBaseChanged || tasksChanged) {
      reportedAtBaseBySlotRef.current = nextAtBaseBySlot;
      reportedTaskAssignmentsRef.current = nextTaskAssignments;
      propsRef.current.onCourierStatusChange?.({
        atBaseBySlot: nextAtBaseBySlot,
        allAtBase: nextAllAtBase,
        taskAssignmentsByTaskId: nextTaskAssignments,
      });
    }

    if (courierAtBaseReportedRef.current !== nextAllAtBase) {
      courierAtBaseReportedRef.current = nextAllAtBase;
      propsRef.current.onCourierAtBaseChange?.(nextAllAtBase);
    }
  };

  // Clear held arrow keys immediately whenever a modal blocks map interaction
  useEffect(() => {
    if (interactionBlocked) {
      pressedArrowKeysRef.current.clear();
    }
  }, [interactionBlocked]);

  // Force full multi-courier fleet reinitialization parked at Base when starting a new game or loading a save
  useEffect(() => {
    if (sessionEpoch === lastSessionEpochRef.current) return;
    lastSessionEpochRef.current = sessionEpoch;
    const roster = propsRef.current.economyStateRef?.current?.couriers;
    couriersFleetRef.current = createInitialCourierFleet(roster);
    syncFleetStatus();
  }, [sessionEpoch]);

  // Expose camera & courier dispatch controls for upcoming order mechanics
  useEffect(() => {
    controllerRef.current = {
      centerOnBase: () => {
        const curBaseNode = propsRef.current.baseNode;
        const focus = curBaseNode
          ? { x: curBaseNode.x + 10, y: curBaseNode.y - 70 }
          : { x: 820, y: 1460 };
        cameraVelocityRef.current = { vx: 0, vy: 0 };
        targetCameraRef.current = createInitialCamera(viewportRef.current, MAP_SIZE, focus);
      },
      dispatchCourierToBuilding: (building: Building) => {
        const {
          graph: curGraph,
          baseDepot: curBaseDepot,
          activeVehicle: curVehicle,
          parkingNavNetworks: curParkingNav,
        } = propsRef.current;
        const address = formatBuildingAddress(building);

        if (curVehicle.type === 'van') {
          const stopPlan = resolveVanStopForBuilding(building, curParkingNav);
          if (!stopPlan) return false;
          const outboundRes = findShortestPathToEdgePoint(
            curGraph,
            'base',
            stopPlan.entryEdge,
            stopPlan.entryRoadPoint
          );
          if (!outboundRes) return false;
          const returnRes = findShortestPathFromEdgePoint(
            curGraph,
            stopPlan.exitEdge,
            stopPlan.exitRoadPoint,
            'base'
          );
          const outboundLanePts = applyRightHandLaneOffsets(outboundRes.points, {
            laneIndex: 0,
            vehicleClass: 'van',
          });
          const returnCenterPts = returnRes ? returnRes.points : [...outboundRes.points].reverse();
          const returnLanePts = applyRightHandLaneOffsets(returnCenterPts, {
            laneIndex: 0,
            vehicleClass: 'van',
          });
          const fullOutbound = stitchWaypoints(
            curBaseDepot.loadingZone.exitWaypoints,
            outboundLanePts,
            stopPlan.entryOffRoadPoints
          );
          const fullReturn = stitchWaypoints(
            stopPlan.exitOffRoadPoints,
            returnLanePts,
            [...curBaseDepot.loadingZone.exitWaypoints].reverse()
          );
          const stopPt = fullOutbound[fullOutbound.length - 1] ?? stopPlan.stopPoint;
          const manualCourier = createCourierFromPath(
            fullOutbound,
            getCourierSpeedForVehicle('van'),
            DELIVERY_PAUSE_SECONDS,
            fullReturn,
            address,
            curVehicle,
            1
          );
          couriersFleetRef.current[1] = {
            slotIndex: 1,
            inRoute: manualCourier.active,
            assignedTaskId: null,
            courier: manualCourier,
            activeRoute: stitchWaypoints(outboundLanePts, stopPlan.entryOffRoadPoints),
            targetMarker: stopPt,
          };
          syncFleetStatus();
          return true;
        }

        if (!building.roadApproachPoint || !building.deliveryStopPoint) {
          return false;
        }

        const approach = building.roadApproachPoint;
        const stop = building.deliveryStopPoint;

        const outboundRes = findShortestPathToEdgePoint(
          curGraph,
          'base',
          approach.edge,
          { x: approach.x, y: approach.y }
        );
        if (!outboundRes) {
          return false;
        }

        const returnRes = findShortestPathFromEdgePoint(
          curGraph,
          approach.edge,
          { x: approach.x, y: approach.y },
          'base'
        );

        const outboundLanePts = applyRightHandLaneOffsets(outboundRes.points, {
          laneIndex: 0,
          vehicleClass: 'bicycle',
        });
        const returnCenterPts = returnRes ? returnRes.points : [...outboundRes.points].reverse();
        const returnLanePts = applyRightHandLaneOffsets(returnCenterPts, {
          laneIndex: 0,
          vehicleClass: 'bicycle',
        });

        const stopPoint: Point = { x: stop.x, y: stop.y };
        const approachExtras = stop.approachWaypoints ?? [];
        const returnExtras = [...approachExtras].reverse();
        const rackExit = curBaseDepot.bikeRack.exitWaypoints;
        const rackReturn = [...rackExit].reverse();

        const fullOutbound = stitchWaypoints(rackExit, outboundLanePts, approachExtras, [stopPoint]);
        const fullReturn = stitchWaypoints([stopPoint], returnExtras, returnLanePts, rackReturn);

        const manualCourier = createCourierFromPath(
          fullOutbound,
          getCourierSpeedForVehicle('bike'),
          DELIVERY_PAUSE_SECONDS,
          fullReturn,
          address,
          curVehicle,
          1
        );
        couriersFleetRef.current[1] = {
          slotIndex: 1,
          inRoute: manualCourier.active,
          assignedTaskId: null,
          courier: manualCourier,
          activeRoute: stitchWaypoints(outboundLanePts, approachExtras, [stopPoint]),
          targetMarker: stopPoint,
        };
        syncFleetStatus();

        return true;
      },
      recallCourierToBase: () => {
        const recoveredCargo = collectInFlightCargoForFleet(couriersFleetRef.current);
        const roster = propsRef.current.economyStateRef?.current?.couriers;

        for (const slotIndex of COURIER_SLOT_INDICES) {
          const assignedVehicle =
            roster?.find((c) => c.slotIndex === slotIndex)?.assignedVehicle ??
            (slotIndex === 1 ? propsRef.current.activeVehicle : { type: 'bike' as const, index: 1 });
          couriersFleetRef.current[slotIndex] = {
            slotIndex,
            inRoute: false,
            assignedTaskId: null,
            courier: createIdleCourier(assignedVehicle, slotIndex),
            activeRoute: [],
            targetMarker: null,
          };
        }

        syncFleetStatus();
        return recoveredCargo;
      },
      getInFlightCargo: () => collectInFlightCargoForFleet(couriersFleetRef.current),
      resetCouriersToBase: (couriers?: readonly CompanyCourier[]) => {
        const roster = couriers ?? propsRef.current.economyStateRef?.current?.couriers;
        couriersFleetRef.current = createInitialCourierFleet(roster);
        syncFleetStatus();
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef]);

  // Main ResizeObserver, input listeners, static caches, and continuous rAF render loop
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!texturesRef.current) {
      texturesRef.current = createProceduralTextures(ctx);
    }

    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewportRef.current = { width, height };

      if (!initializedCameraRef.current) {
        const curBaseNode = propsRef.current.baseNode;
        const focus = curBaseNode
          ? { x: curBaseNode.x + 10, y: curBaseNode.y - 70 }
          : { x: 820, y: 1460 };
        const initialCam = createInitialCamera(
          viewportRef.current,
          MAP_SIZE,
          focus
        );
        cameraRef.current = initialCam;
        targetCameraRef.current = initialCam;
        initializedCameraRef.current = true;
      } else {
        cameraRef.current = clampCamera(
          cameraRef.current,
          viewportRef.current,
          MAP_SIZE
        );
        targetCameraRef.current = clampCamera(
          targetCameraRef.current,
          viewportRef.current,
          MAP_SIZE
        );
      }
    };

    // Pre-build 1.25x tiled static ground buffer & shared 2048x2048 building/fence Texture Atlas
    // (rebuilt strictly when road grid, footprint mode, warehouse tier, or parking spots change)
    const ensureStaticCaches = () => {
      const {
        graph: curGraph,
        buildings: curBuildings,
        baseDepot: curBaseDepot,
        parkingNavNetworks: curParkingNavNetworks,
        showGrid: gridVisible,
        footprintOnly: isFootprintOnly,
      } = propsRef.current;

      const groundKey = `g${gridVisible ? 1 : 0}:f${isFootprintOnly ? 1 : 0}:w${curBaseDepot.warehouseTier}:p${curBaseDepot.parking.spots.length}`;
      if (texturesRef.current && groundBufferRef.current?.key !== groundKey) {
        groundBufferRef.current = buildStaticGroundBuffer(
          {
            textures: texturesRef.current,
            baseDepot: curBaseDepot,
            buildings: curBuildings,
            graph: curGraph,
            parkingNavNetworks: curParkingNavNetworks,
            showGrid: gridVisible,
            footprintOnly: isFootprintOnly,
            scale: STATIC_GROUND_BUFFER_SCALE,
            tilePixelSize: STATIC_GROUND_TILE_PIXEL_SIZE,
          },
          groundKey,
          groundBufferRef.current
        );
      }

      const spriteKey = `w${curBaseDepot.warehouseTier}:f${isFootprintOnly ? 1 : 0}`;
      if (sceneSpriteAtlasRef.current?.key !== spriteKey) {
        if (isFootprintOnly) {
          disposeSceneSpriteAtlas(sceneSpriteAtlasRef.current);
          sceneSpriteAtlasRef.current = {
            key: spriteKey,
            sheets: [],
            buildings: { key: spriteKey, sheets: [], sprites: new Map() },
            fences: { sheets: [], segments: new Map(), cornerPost: null, gatePost: null },
          };
        } else {
          sceneSpriteAtlasRef.current = buildSceneSpriteAtlas(
            curBuildings,
            spriteKey,
            undefined,
            sceneSpriteAtlasRef.current
          );
        }
      }
    };

    // Interaction state (pan & pinch-to-zoom)
    let isPanning = false;
    let pointerLastScreen = { x: 0, y: 0 };

    // Touch pinch state
    let pinchLastDist = 0;
    let pinchLastMid = { x: 0, y: 0 };

    const getLocalPos = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      if (propsRef.current.interactionBlocked) return;
      if (e.button !== 0) return;
      cameraVelocityRef.current = { vx: 0, vy: 0 };
      pointerLastScreen = getLocalPos(e.clientX, e.clientY);
      isPanning = true;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (propsRef.current.interactionBlocked) {
        isPanning = false;
        return;
      }
      if (!isPanning) return;
      const pos = getLocalPos(e.clientX, e.clientY);
      const dx = pos.x - pointerLastScreen.x;
      const dy = pos.y - pointerLastScreen.y;
      cameraVelocityRef.current = { vx: 0, vy: 0 };
      targetCameraRef.current = panCameraByScreenDelta(
        targetCameraRef.current,
        dx,
        dy,
        viewportRef.current,
        MAP_SIZE
      );
      pointerLastScreen = pos;
    };

    const onMouseUp = () => {
      isPanning = false;
    };

    const onMouseLeave = () => {
      isPanning = false;
    };

    const onWheel = (e: WheelEvent) => {
      if (propsRef.current.interactionBlocked) return;
      e.preventDefault();
      const pos = getLocalPos(e.clientX, e.clientY);
      const prev = targetCameraRef.current;
      const next = zoomCameraByWheel(
        prev,
        e.deltaY,
        e.deltaMode,
        pos.x,
        pos.y,
        viewportRef.current,
        MAP_SIZE
      );
      if (next !== prev) {
        targetCameraRef.current = next;
      }
    };

    // Touch events (1-finger pan, 2-finger pinch-to-zoom)
    const syncTouches = (touchList: TouchList) => {
      const res: Array<{ id: number; x: number; y: number }> = [];
      for (let i = 0; i < touchList.length; i++) {
        const t = touchList[i];
        const pos = getLocalPos(t.clientX, t.clientY);
        res.push({ id: t.identifier, x: pos.x, y: pos.y });
      }
      return res;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (propsRef.current.interactionBlocked) {
        isPanning = false;
        return;
      }
      e.preventDefault();
      cameraVelocityRef.current = { vx: 0, vy: 0 };
      const touches = syncTouches(e.touches);

      if (touches.length === 1) {
        pointerLastScreen = { x: touches[0].x, y: touches[0].y };
        isPanning = true;
      } else if (touches.length >= 2) {
        isPanning = false;
        const [t0, t1] = touches;
        pinchLastDist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        pinchLastMid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (propsRef.current.interactionBlocked) {
        isPanning = false;
        return;
      }
      e.preventDefault();
      cameraVelocityRef.current = { vx: 0, vy: 0 };
      const touches = syncTouches(e.touches);

      if (touches.length === 1 && isPanning) {
        const t = touches[0];
        const dx = t.x - pointerLastScreen.x;
        const dy = t.y - pointerLastScreen.y;
        targetCameraRef.current = panCameraByScreenDelta(
          targetCameraRef.current,
          dx,
          dy,
          viewportRef.current,
          MAP_SIZE
        );
        pointerLastScreen = { x: t.x, y: t.y };
      } else if (touches.length >= 2) {
        const [t0, t1] = touches;
        const dist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        const mid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };

        if (pinchLastDist > 10 && dist > 10) {
          const panDx = mid.x - pinchLastMid.x;
          const panDy = mid.y - pinchLastMid.y;
          let next = panCameraByScreenDelta(
            targetCameraRef.current,
            panDx,
            panDy,
            viewportRef.current,
            MAP_SIZE
          );
          const scale = dist / pinchLastDist;
          next = zoomCameraAtScreenPoint(
            next,
            next.zoom * scale,
            mid.x,
            mid.y,
            viewportRef.current,
            MAP_SIZE
          );
          targetCameraRef.current = next;
        }
        pinchLastDist = dist;
        pinchLastMid = mid;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const remaining = syncTouches(e.touches);
      if (remaining.length === 0) {
        isPanning = false;
      } else if (remaining.length === 1) {
        pointerLastScreen = { x: remaining[0].x, y: remaining[0].y };
        isPanning = true;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (propsRef.current.interactionBlocked) return;
      if (isEditableEventTarget(e.target)) return;
      if (!isArrowKey(e.key)) return;
      e.preventDefault();
      pressedArrowKeysRef.current.add(e.key);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isArrowKey(e.key)) return;
      pressedArrowKeysRef.current.delete(e.key);
    };

    const onWindowBlur = () => {
      isPanning = false;
      pressedArrowKeysRef.current.clear();
      cameraVelocityRef.current = { vx: 0, vy: 0 };
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    let rafId: number | null = null;
    let hasRenderedFirstFrame = false;
    let lastFrameTick = performance.now();
    let lastRenderTime = lastFrameTick;
    let fpsFrames = 0;
    let fpsWindowStart = lastFrameTick;
    let lastReportedFps = -1;

    const buildDeliveryStopsForBatches = (
      batches: readonly WarehouseLoadedBatch[],
      curBuildings: readonly Building[],
      ecoState: OrderEconomyState
    ): DeliveryStopInput[] => {
      const stopByBuildingId = new Map<string, DeliveryStopInput>();
      const senderLookup = new Map<string, string>();
      for (const order of ecoState.activeOrders) {
        senderLookup.set(order.id, order.pickupLocation.buildingId);
      }
      for (const order of ecoState.archivedOrders) {
        if (!senderLookup.has(order.id)) {
          senderLookup.set(order.id, order.pickupLocation.buildingId);
        }
      }

      for (const batch of batches) {
        const senderBuildingId = senderLookup.get(batch.orderId) ?? null;
        for (let p = 0; p < batch.count; p++) {
          const recipient = pickRandomRecipientBuildingForPackage(curBuildings, senderBuildingId);
          if (!recipient) continue;
          let entry = stopByBuildingId.get(recipient.id);
          if (!entry) {
            entry = { building: recipient, items: [] };
            stopByBuildingId.set(recipient.id, entry);
          }
          const existingItem = entry.items.find((it) => it.orderId === batch.orderId);
          if (existingItem) {
            existingItem.count += 1;
          } else {
            entry.items.push({ orderId: batch.orderId, count: 1 });
          }
        }
      }

      return Array.from(stopByBuildingId.values());
    };

    const tryDispatchCourierForSlot = (
      slotIndex: number,
      currentGameMinutes: number,
      startFrom: CourierStartPoint,
      dispatchVehicle: ActiveVehicleSelection
    ): boolean => {
      const {
        graph: curGraph,
        buildings: curBuildings,
        baseDepot: curBaseDepot,
        parkingNavNetworks: curParkingNav,
        economyStateRef: ecoRef,
        onLoadFromWarehouse: loadFromWarehouse,
        onReturnCargoToWarehouse: returnCargoToWarehouse,
      } = propsRef.current;

      const ecoState = ecoRef?.current;
      if (!ecoState) return false;

      // Defensive guard: never dispatch two couriers in the exact same physical vehicle
      if (isVehicleCurrentlyInRoute(couriersFleetRef.current, dispatchVehicle, slotIndex)) {
        return false;
      }

      const vehicleSpeed = getCourierSpeedForVehicle(dispatchVehicle.type);
      const vehicleCapacity = getCourierCapacityForVehicle(dispatchVehicle.type);
      const claimedTaskIds = getClaimedTaskIdsForFleet(couriersFleetRef.current, slotIndex);
      const reservedWarehouseSpace = getReservedWarehouseSpaceForFleet(
        couriersFleetRef.current,
        slotIndex
      );

      // Strictly scan today's Plan tygodnia from top (#1, #2, ...), skipping tasks already claimed
      // by other active couriers and respecting free warehouse capacity & available stock
      const selectedTask = selectNextCourierTaskForDay(
        ecoState,
        currentGameMinutes,
        dispatchVehicle.type,
        {
          claimedTaskIds,
          reservedWarehouseSpace,
        }
      );
      if (!selectedTask) return false;

      const assignedTaskId = selectedTask.task?.taskId ?? selectedTask.order.id;

      if (selectedTask.kind === 'delivery') {
        if (!loadFromWarehouse) return false;
        const loadedBatches = loadFromWarehouse(
          selectedTask.order.id,
          undefined,
          vehicleCapacity
        );
        if (loadedBatches.length === 0) return false;

        const groupedStops = buildDeliveryStopsForBatches(loadedBatches, curBuildings, ecoState);
        const mission = createDeliveryMissionCourier(
          curGraph,
          curBaseDepot,
          groupedStops,
          loadedBatches,
          startFrom,
          vehicleSpeed,
          dispatchVehicle,
          curParkingNav,
          slotIndex,
          assignedTaskId
        );

        if (mission.active) {
          couriersFleetRef.current[slotIndex] = {
            slotIndex,
            inRoute: true,
            assignedTaskId,
            courier: mission,
            activeRoute: mission.phase === 'delivering' ? [] : mission.path,
            targetMarker: null,
          };
          return true;
        }

        // Defensive fallback: if routing failed, safely restore loaded packages to warehouse
        returnCargoToWarehouse?.(loadedBatches);
        return false;
      }

      // Selected task is Odbiór (pickup from sender -> unload at Base loading zone)
      const senderBuilding = curBuildings.find(
        (b) => b.id === selectedTask.order.pickupLocation.buildingId
      );
      if (!senderBuilding) return false;

      const pickupMission = createPickupMissionCourier(
        curGraph,
        curBaseDepot,
        senderBuilding,
        selectedTask.order.id,
        selectedTask.pickupCount,
        startFrom,
        vehicleSpeed,
        dispatchVehicle,
        curParkingNav,
        slotIndex,
        assignedTaskId
      );
      if (pickupMission.active) {
        couriersFleetRef.current[slotIndex] = {
          slotIndex,
          inRoute: true,
          assignedTaskId,
          courier: pickupMission,
          activeRoute: pickupMission.path,
          targetMarker: pickupMission.stops[0]?.stopPoint ?? null,
        };
        return true;
      }

      return false;
    };

    const drawScene = (now: number) => {
      // Lock update & rendering cadence to steady 60 FPS (using 1000 / 60.5 ms threshold
      // so 60 Hz panels never drop to 30 FPS while 90–144 Hz panels hold rock-steady 60 FPS)
      const sinceTickMs = now - lastFrameTick;
      if (hasRenderedFirstFrame && sinceTickMs < FRAME_INTERVAL_MS) {
        rafId = requestAnimationFrame(drawScene);
        return;
      }

      // Compute true elapsed delta time between rendered frames (clamped to <= 0.05s)
      const rawDt = hasRenderedFirstFrame
        ? Math.min(Math.max(0, (now - lastRenderTime) / 1000), MAX_REAL_FRAME_DT)
        : 0;
      lastRenderTime = now;
      if (!hasRenderedFirstFrame || sinceTickMs > 250) {
        lastFrameTick = now;
      } else {
        lastFrameTick = now - Math.min(sinceTickMs - FRAME_INTERVAL_MS, FRAME_INTERVAL_MS);
      }
      hasRenderedFirstFrame = true;

      // Measure real rendered FPS averaged over ~0.5s intervals
      fpsFrames += 1;
      const fpsElapsed = now - fpsWindowStart;
      if (fpsElapsed >= FPS_SAMPLE_WINDOW_MS) {
        if (fpsElapsed > 2000) {
          fpsFrames = 0;
          fpsWindowStart = now;
        } else {
          const measuredFps = Math.round((fpsFrames * 1000) / fpsElapsed);
          fpsFrames = 0;
          fpsWindowStart = now;
          if (measuredFps !== lastReportedFps) {
            lastReportedFps = measuredFps;
            propsRef.current.onFpsChange?.(measuredFps);
          }
        }
      }

      // Compute arrow-key directional input vector (blocked while modals are open)
      const activeArrowKeys = pressedArrowKeysRef.current;
      const arrowInput: ArrowInputVector = { x: 0, y: 0 };
      if (!propsRef.current.interactionBlocked && activeArrowKeys.size > 0) {
        if (activeArrowKeys.has('ArrowLeft')) arrowInput.x -= 1;
        if (activeArrowKeys.has('ArrowRight')) arrowInput.x += 1;
        if (activeArrowKeys.has('ArrowUp')) arrowInput.y -= 1;
        if (activeArrowKeys.has('ArrowDown')) arrowInput.y += 1;
      }

      // Frame-rate-independent exponential camera physics + smooth arrow-key velocity + hard snap
      const camStep = stepCameraPhysics(
        cameraRef.current,
        targetCameraRef.current,
        cameraVelocityRef.current,
        arrowInput,
        rawDt,
        viewportRef.current,
        MAP_SIZE
      );
      cameraRef.current = camStep.camera;
      targetCameraRef.current = camStep.target;
      cameraVelocityRef.current = camStep.velocity;

      // Shared speed-scaled simulation step for couriers and future fleet vehicles (0 = paused)
      const simDt = computeScaledSimDt(rawDt, propsRef.current.gameSpeed);
      const currentGameMinutes = propsRef.current.gameMinutesRef.current ?? 0;
      const isNightNow = isNightHoursForTime(currentGameMinutes);

      const fleet = couriersFleetRef.current;

      // End of seasonal workday: immediately abort further pickups/deliveries for ALL active couriers and route back to Base
      if (isNightNow) {
        for (const slotIndex of COURIER_SLOT_INDICES) {
          const entry = fleet[slotIndex];
          if (entry && entry.courier.active && !entry.courier.isForcedReturn) {
            const interrupted = interruptCourierForEndOfWorkday(
              entry.courier,
              propsRef.current.graph,
              propsRef.current.baseDepot,
              propsRef.current.parkingNavNetworks
            );
            entry.courier = interrupted;
            entry.inRoute = interrupted.active;
            entry.assignedTaskId = interrupted.assignedTaskId;
            entry.activeRoute = interrupted.path;
            entry.targetMarker = null;
          }
        }
      }

      // Step every active courier (#1–#6) independently at 60 FPS
      if (simDt > 0) {
        for (const slotIndex of COURIER_SLOT_INDICES) {
          const entry = fleet[slotIndex];
          if (!entry || !entry.courier.active) continue;

          const activeMissionVehicle: ActiveVehicleSelection = {
            type: entry.courier.vehicleType,
            index: entry.courier.vehicleIndex,
          };
          const activeMissionCapacity = entry.courier.cargoCapacity;
          const stepRes = stepCourierMissionWithSimDt(entry.courier, simDt);
          entry.courier = stepRes.state;
          entry.inRoute = stepRes.state.active;

          for (const ev of stepRes.events) {
            if (ev.type === 'pickup_loaded') {
              const clock = getGameClockDisplay(currentGameMinutes);
              const actualLoaded =
                propsRef.current.onPickupPackagesLoaded?.(
                  ev.orderId,
                  ev.plannedCount,
                  clock.gameDay,
                  activeMissionCapacity
                ) ?? 0;

              if (actualLoaded > 0) {
                const carriedBatches: WarehouseLoadedBatch[] = [
                  { orderId: ev.orderId, count: actualLoaded },
                ];
                let switchedToDirectDelivery = false;

                // If this was the LAST package of the order's ODBIÓR today, release the ODBIÓR claim
                // immediately and evaluate the next highest-priority FREE task (Scenarios A / B / C):
                const latestEco = propsRef.current.economyStateRef?.current;
                const pickedOrder = latestEco?.activeOrders.find(
                  (o) => o.id === ev.orderId && o.status === 'active'
                );
                const remainingAfterPickup =
                  latestEco && pickedOrder
                    ? getRemainingPickupPackagesForOrderToday(
                        latestEco,
                        pickedOrder,
                        clock.dayIndex,
                        clock.gameDay
                      )
                    : 1;

                if (remainingAfterPickup === 0) {
                  entry.assignedTaskId = null;
                  entry.courier = {
                    ...entry.courier,
                    assignedTaskId: null,
                  };
                }

                if (
                  latestEco &&
                  remainingAfterPickup === 0 &&
                  !isNightNow &&
                  !entry.courier.isForcedReturn
                ) {
                  const postPickupDecision = selectNextTaskAfterFinalPickup(
                    latestEco,
                    currentGameMinutes,
                    ev.orderId,
                    actualLoaded,
                    activeMissionVehicle.type,
                    {
                      claimedTaskIds: getClaimedTaskIdsForFleet(fleet, slotIndex),
                      reservedWarehouseSpace: getReservedWarehouseSpaceForFleet(fleet, slotIndex),
                    }
                  );

                  // Scenario A: next FREE task is ROZWÓZKA of the same order -> deliver directly from sender
                  if (postPickupDecision.scenario === 'direct_delivery_same_order') {
                    const senderBuilding = propsRef.current.buildings.find(
                      (b) => b.id === ev.buildingId
                    );
                    if (senderBuilding) {
                      const directStops = buildDeliveryStopsForBatches(
                        carriedBatches,
                        propsRef.current.buildings,
                        latestEco
                      );
                      const directTaskId =
                        postPickupDecision.task?.taskId ?? ev.orderId;
                      const directMission = createDirectDeliveryMissionFromBuilding(
                        propsRef.current.graph,
                        propsRef.current.baseDepot,
                        senderBuilding,
                        directStops,
                        carriedBatches,
                        getCourierSpeedForVehicle(activeMissionVehicle.type),
                        activeMissionVehicle,
                        propsRef.current.parkingNavNetworks,
                        slotIndex,
                        directTaskId
                      );
                      if (directMission.active) {
                        entry.courier = {
                          ...directMission,
                          wheelPhase: entry.courier.wheelPhase,
                        };
                        entry.inRoute = true;
                        entry.assignedTaskId = directTaskId;
                        switchedToDirectDelivery = true;
                      }
                    }
                  }
                }

                // Scenarios B & C (or non-final pickup / fallback): return to Base loading zone,
                // unload carried packages into warehouse, then dispatch the next free task from Base
                if (!switchedToDirectDelivery) {
                  if (entry.courier.active) {
                    entry.courier = {
                      ...entry.courier,
                      cargo: carriedBatches,
                    };
                  } else {
                    propsRef.current.onReturnCargoToWarehouse?.(carriedBatches);
                  }
                }
              } else {
                entry.assignedTaskId = null;
                entry.courier = {
                  ...entry.courier,
                  assignedTaskId: null,
                };
              }
            } else if (ev.type === 'delivery_completed') {
              propsRef.current.onDeliverPackages?.(ev.items, currentGameMinutes);
            } else if (ev.type === 'base_unloaded') {
              if (ev.cargo.length > 0) {
                propsRef.current.onReturnCargoToWarehouse?.(ev.cargo);
              }
            } else if (ev.type === 'arrived_at_loading_zone') {
              // Release current task claim before scanning Plan tygodnia from the top
              entry.assignedTaskId = null;
              entry.courier = {
                ...entry.courier,
                assignedTaskId: null,
              };

              // If workday is still open and another free task is ready, chain immediately from the loading bay
              // keeping the exact same vehicle currently parked in the loading bay
              const chained =
                !isNightNow && !ev.wasForcedReturn
                  ? tryDispatchCourierForSlot(
                      slotIndex,
                      currentGameMinutes,
                      'loading_zone',
                      activeMissionVehicle
                    )
                  : false;

              if (!chained) {
                // All free tasks done or workday ended -> park vehicle at Base bike rack or assigned stall P1–P8
                const parkMission = createParkAtRackCourier(
                  propsRef.current.baseDepot,
                  undefined,
                  ev.wasForcedReturn || isNightNow,
                  getCourierSpeedForVehicle(activeMissionVehicle.type),
                  activeMissionVehicle,
                  propsRef.current.parkingNavNetworks,
                  propsRef.current.graph,
                  slotIndex
                );
                if (parkMission.active) {
                  entry.courier = parkMission;
                  entry.inRoute = true;
                  entry.assignedTaskId = null;
                  entry.activeRoute = [];
                  entry.targetMarker = null;
                } else {
                  entry.courier = createIdleCourier(activeMissionVehicle, slotIndex);
                  entry.inRoute = false;
                  entry.assignedTaskId = null;
                  entry.activeRoute = [];
                  entry.targetMarker = null;
                }
              }
            } else if (ev.type === 'parked_at_rack') {
              if (ev.cargo.length > 0) {
                propsRef.current.onReturnCargoToWarehouse?.(ev.cargo);
              }
              entry.courier = createIdleCourier(activeMissionVehicle, slotIndex);
              entry.inRoute = false;
              entry.assignedTaskId = null;
              entry.activeRoute = [];
              entry.targetMarker = null;
            }
          }

          const latestEntry = fleet[slotIndex];
          if (latestEntry.courier.active) {
            latestEntry.inRoute = true;
            if (latestEntry.courier.missionKind === 'park_rack') {
              latestEntry.activeRoute = [];
              latestEntry.targetMarker = null;
            } else if (
              latestEntry.courier.phase === 'outbound' ||
              latestEntry.courier.phase === 'delivering'
            ) {
              const curStop =
                latestEntry.courier.stops[latestEntry.courier.currentStopIndex];
              if (curStop && (curStop.kind === 'base_load' || curStop.kind === 'base_unload')) {
                latestEntry.activeRoute =
                  latestEntry.courier.phase === 'delivering' ? [] : latestEntry.courier.path;
                latestEntry.targetMarker = null;
              } else {
                latestEntry.activeRoute = latestEntry.courier.path;
                latestEntry.targetMarker = curStop?.stopPoint ?? null;
              }
            } else if (latestEntry.courier.phase === 'returning') {
              latestEntry.activeRoute = latestEntry.courier.path;
              latestEntry.targetMarker = null;
            }
          } else {
            latestEntry.inRoute = false;
            latestEntry.assignedTaskId = null;
            latestEntry.activeRoute = [];
            latestEntry.targetMarker = null;
          }
        }
      }

      // During seasonal workday hours, automatically dispatch ALL idle hired couriers (#1–#6)
      // who have an assigned vehicle in „Pracownicy”
      if (simDt > 0 && !isNightNow) {
        const ecoState = propsRef.current.economyStateRef?.current;
        const roster = ecoState?.couriers;
        if (roster && roster.length > 0) {
          for (const rosterCourier of roster) {
            if (
              !rosterCourier.unlocked ||
              !rosterCourier.hired ||
              !rosterCourier.assignedVehicle
            ) {
              continue;
            }
            const slotEntry = fleet[rosterCourier.slotIndex];
            if (!slotEntry || slotEntry.inRoute || slotEntry.courier.active) {
              continue;
            }
            tryDispatchCourierForSlot(
              rosterCourier.slotIndex,
              currentGameMinutes,
              'rack',
              rosterCourier.assignedVehicle
            );
          }
        } else {
          const ownerSlot = fleet[1];
          if (ownerSlot && !ownerSlot.inRoute && !ownerSlot.courier.active) {
            const ownerVehicle = ecoState?.activeVehicle ?? propsRef.current.activeVehicle;
            tryDispatchCourierForSlot(1, currentGameMinutes, 'rack', ownerVehicle);
          }
        }
      }

      // Notify React only when any courier's inRoute status or claimed task actually changed
      syncFleetStatus();

      // Ensure static ground buffer & individual building sprites are built (rebuilt only on static state changes)
      ensureStaticCaches();

      const { width: vw, height: vh } = viewportRef.current;
      const dprX = canvas.width / Math.max(1, vw);
      const dprY = canvas.height / Math.max(1, vh);
      const cam = cameraRef.current;
      const effectiveZoom = getEffectiveZoom(cam.zoom, viewportRef.current, MAP_SIZE);
      const {
        baseNode: curBaseNode,
        buildings: curBuildings,
        baseDepot: curBaseDepot,
        footprintOnly: isFootprintOnly,
        showStreetNames: streetNamesVisible,
      } = propsRef.current;

      ctx.save();
      ctx.setTransform(dprX, 0, 0, dprY, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // 1. Update Viewport Ground Cache ONLY on camera/viewport/static-ground change,
      //    then blit the entire static ground in a single drawImage call (1:1 physical pixels, no double-scaling)
      if (groundBufferRef.current) {
        if (!viewportGroundCacheRef.current) {
          viewportGroundCacheRef.current = createViewportGroundCache();
        }
        updateViewportGroundCache(viewportGroundCacheRef.current, groundBufferRef.current, {
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          logicalWidth: vw,
          logicalHeight: vh,
          cameraX: cam.x,
          cameraY: cam.y,
          cameraZoom: cam.zoom,
          effectiveZoom,
        });
        ctx.drawImage(viewportGroundCacheRef.current.canvas, 0, 0, vw, vh);
      } else {
        ctx.fillStyle = '#161b22';
        ctx.fillRect(0, 0, vw, vh);
      }

      // Apply camera transform once for dynamic overlays (route, courier, Z-sorted 3D atlas sprites, labels)
      ctx.translate(vw / 2, vh / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(-cam.x, -cam.y);

      const invScale = 1 / Math.sqrt(effectiveZoom);

      const drawBaseMarker = (node: { x: number; y: number }) => {
        const half = 10 * invScale;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(
          node.x - half - 2 * invScale,
          node.y - half - 2 * invScale,
          (half + 2 * invScale) * 2,
          (half + 2 * invScale) * 2
        );
        ctx.fillStyle = '#f97316';
        ctx.fillRect(node.x - half, node.y - half, half * 2, half * 2);
        ctx.strokeStyle = '#fff7ed';
        ctx.lineWidth = 2 * invScale;
        ctx.strokeRect(node.x - half, node.y - half, half * 2, half * 2);

        ctx.font = `700 ${Math.round(12 * invScale)}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3.5 * invScale;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeText('BAZA', node.x, node.y - half - 4 * invScale);
        ctx.fillStyle = '#fff7ed';
        ctx.fillText('BAZA', node.x, node.y - half - 4 * invScale);
      };

      const drawDynamicRouteAndPin = () => {
        for (const slotIndex of COURIER_SLOT_INDICES) {
          const entry = fleet[slotIndex];
          if (!entry || !entry.inRoute || entry.courier.phase === 'idle') continue;
          drawCourierRoute(ctx, entry.activeRoute, invScale);
          if (
            entry.targetMarker &&
            (entry.courier.phase === 'outbound' || entry.courier.phase === 'delivering')
          ) {
            drawCourierDestinationPin(ctx, entry.targetMarker, invScale);
          }
        }
      };

      const halfViewW = vw / (2 * effectiveZoom) + 60;
      const halfViewH = vh / (2 * effectiveZoom) + 60;
      const viewBounds = {
        minX: cam.x - halfViewW,
        maxX: cam.x + halfViewW,
        minY: cam.y - halfViewH,
        maxY: cam.y + halfViewH,
      };

      const curBikesCount = propsRef.current.bikesCount;
      const curVansCount = propsRef.current.vansCount;
      const { bikeIndices: activeOutBikeIndices, vanIndices: activeOutVanIndices } =
        getActiveOutVehiclesForFleet(fleet);

      const parkedBikeIndices: number[] = [];
      const clampedBikes = Math.max(0, Math.min(3, Math.floor(curBikesCount)));
      for (let i = 1; i <= clampedBikes; i++) {
        if (!activeOutBikeIndices.has(i)) {
          parkedBikeIndices.push(i);
        }
      }

      const rack = curBaseDepot.bikeRack;

      const drawFleetCourier = (
        drawCtx: CanvasRenderingContext2D,
        entry: FleetCourierSlotState
      ) => {
        const c = entry.courier;
        const cargoCount = getCourierCargoCount(c.cargo);
        if (c.vehicleType === 'van') {
          drawIsometricDeliveryVan(drawCtx, {
            x: c.x,
            y: c.y,
            angle: c.angle,
            wheelPhase: c.wheelPhase,
            isDelivering: c.phase === 'delivering',
            courierSlotIndex: entry.slotIndex,
            cargoCount,
            cargoCapacity: c.cargoCapacity,
            invScale,
          });
        } else {
          drawIsometricBicycle(drawCtx, {
            x: c.x,
            y: c.y,
            angle: c.angle,
            withRider: c.riderMounted,
            wheelPhase: c.wheelPhase,
            isDelivering: c.phase === 'delivering',
            courierSlotIndex: entry.slotIndex,
            cargoCount,
            cargoCapacity: c.cargoCapacity,
            invScale,
          });
        }
      };

      if (isFootprintOnly) {
        // 2D Footprints Mode: footprints & optional road grid are already baked into the static ground buffer
        drawBaseLoadingZone(ctx, curBaseDepot.loadingZone);
        drawDynamicRouteAndPin();
        if (curBaseNode) {
          drawBaseMarker(curBaseNode);
        }
        drawBikeRackWithOptionalBike(ctx, rack, parkedBikeIndices);
        const parkedVanSlots = getBaseParkedVanSlots(
          curBaseDepot.parking,
          curVansCount,
          null
        ).filter((slot) => !activeOutVanIndices.has(slot.vanIndex));
        for (const slot of parkedVanSlots) {
          drawIsometricDeliveryVan(ctx, {
            x: slot.spot.x,
            y: slot.spot.y,
            angle: slot.parkedAngle,
            wheelPhase: 0,
          });
        }
        for (const slotIndex of COURIER_SLOT_INDICES) {
          const entry = fleet[slotIndex];
          if (entry && entry.inRoute && entry.courier.phase !== 'idle') {
            drawFleetCourier(ctx, entry);
          }
        }
        if (streetNamesVisible) {
          renderStreetNames(ctx, effectiveZoom, viewBounds);
        }
      } else {
        // Normal 3D Mode: Base loading zone & active routes on ground, then Z-sorted 3D building sprites interleaved with
        // fences, BAZA bike rack, parked fleet vans on P1–P8, and ALL active courier vehicles so tall blocks naturally occlude them
        const bikeRackEntity: DepthSortedEntity = {
          id: rack.id,
          uMin: rack.uMin,
          uMax: rack.uMax,
          vMin: rack.vMin,
          vMax: rack.vMax,
          draw: (drawCtx) => drawBikeRackWithOptionalBike(drawCtx, rack, parkedBikeIndices),
        };

        const parkedVanEntities = createBaseParkedVanEntities(
          curBaseDepot,
          curVansCount,
          null
        ).filter((entity) => {
          const vanIdx = Number(entity.id.replace('base_parked_van_', ''));
          return !activeOutVanIndices.has(vanIdx);
        });
        const depthEntities: DepthSortedEntity[] = [bikeRackEntity, ...parkedVanEntities];

        for (const slotIndex of COURIER_SLOT_INDICES) {
          const entry = fleet[slotIndex];
          if (!entry || !entry.inRoute || entry.courier.phase === 'idle') continue;
          const c = entry.courier;
          const isoPos = canvasToIso(c.x, c.y);
          if (c.vehicleType === 'van') {
            const fx = Math.cos(c.angle);
            const fy = Math.sin(c.angle);
            const du = fx * 0.5 + fy;
            const dv = fx * 0.5 - fy;
            const dLen = Math.hypot(du, dv) || 1;
            const au = Math.abs(du / dLen);
            const av = Math.abs(dv / dLen);
            const halfU = 9.4 * au + 4.6 * av;
            const halfV = 9.4 * av + 4.6 * au;
            depthEntities.push({
              id: `courier_slot_${slotIndex}_van_${c.vehicleIndex}`,
              uMin: isoPos.u - halfU,
              uMax: isoPos.u + halfU,
              vMin: isoPos.v - halfV,
              vMax: isoPos.v + halfV,
              draw: (drawCtx) => drawFleetCourier(drawCtx, entry),
            });
          } else {
            const halfFoot = 3.2;
            depthEntities.push({
              id: `courier_slot_${slotIndex}_bike_${c.vehicleIndex}`,
              uMin: isoPos.u - halfFoot,
              uMax: isoPos.u + halfFoot,
              vMin: isoPos.v - halfFoot,
              vMax: isoPos.v + halfFoot,
              draw: (drawCtx) => drawFleetCourier(drawCtx, entry),
            });
          }
        }

        drawBaseLoadingZone(ctx, curBaseDepot.loadingZone);
        drawDynamicRouteAndPin();
        renderBuildings3D(
          ctx,
          curBuildings,
          null,
          null,
          effectiveZoom,
          viewBounds,
          depthEntities,
          sceneSpriteAtlasRef.current?.buildings ?? null,
          sceneSpriteAtlasRef.current?.fences ?? null
        );
        if (curBaseNode) {
          drawBaseMarker(curBaseNode);
        }
        if (streetNamesVisible) {
          renderStreetNames(ctx, effectiveZoom, viewBounds);
        }
      }

      ctx.restore();

      rafId = requestAnimationFrame(drawScene);
    };

    updateCanvasSize();
    ensureStaticCaches();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(container);
    rafId = requestAnimationFrame(drawScene);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      pressedArrowKeysRef.current.clear();
      disposeViewportGroundCache(viewportGroundCacheRef.current);
      viewportGroundCacheRef.current = null;
      disposeStaticGroundBuffer(groundBufferRef.current);
      groundBufferRef.current = null;
      disposeSceneSpriteAtlas(sceneSpriteAtlasRef.current);
      sceneSpriteAtlasRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full overflow-hidden bg-[#161b22]"
    >
      <canvas
        ref={canvasRef}
        data-testid="map-canvas"
        aria-label="Interaktywna mapa miasta Delivery Tycoon"
        className="block w-full h-full touch-none cursor-default"
      />
    </div>
  );
});

MapCanvas.displayName = 'MapCanvas';

