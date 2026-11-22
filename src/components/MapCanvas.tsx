import React, { useEffect, useMemo, useRef } from 'react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data/initialRoadGraph';
import { type Building, formatBuildingAddress } from '../types/building';
import type { Point, RoadGraph } from '../types/roadGraph';
import type { DepthSortedEntity } from '../utils/buildings';
import { BASE_DEPOT, type BaseDepotSpec, canvasToIso } from '../utils/cityMap';
import {
  type BuildingSpriteCache,
  type FenceSpriteCache,
  type ProceduralTextures,
  type StaticGroundBuffer,
  buildBuildingSpriteCache,
  buildFenceSpriteCache,
  buildStaticGroundBuffer,
  createProceduralTextures,
  drawStaticGroundBuffer,
  renderBuildings3D,
  renderStreetNames,
} from '../utils/cityRenderer';
import {
  drawBaseLoadingZone,
  drawBikeRackWithOptionalBike,
  drawCourierDestinationPin,
  drawCourierRoute,
  drawIsometricBicycle,
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
  type CourierStartPoint,
  type CourierState,
  DEFAULT_COURIER_SPEED,
  DELIVERY_PAUSE_SECONDS,
  type DeliveryStopInput,
  MAX_REAL_FRAME_DT,
  computeScaledSimDt,
  createCourierFromPath,
  createDeliveryMissionCourier,
  createIdleCourier,
  createParkAtRackCourier,
  createPickupMissionCourier,
  interruptCourierForEndOfWorkday,
  selectNextCourierTaskForDay,
  stepCourierMissionWithSimDt,
  stitchWaypoints,
} from '../utils/courierSim';
import type { OrderEconomyState, WarehouseLoadedBatch } from '../types/orders';
import { type GameSpeed, getGameClockDisplay } from '../utils/gameClock';
import {
  isNightHoursForTime,
  pickRandomRecipientBuildingForPackage,
} from '../utils/orderEconomy';
import {
  findShortestPathFromEdgePoint,
  findShortestPathToEdgePoint,
} from '../utils/pathfinding';
import {
  ALL_PARKING_NAV_NETWORKS,
  buildBaseParkingNavNetwork,
} from '../utils/parkingNavigation';
import { applyRightHandLaneOffsets } from '../utils/trafficLanes';

export interface MapCanvasController {
  centerOnBase: () => void;
  dispatchCourierToBuilding: (building: Building) => boolean;
  recallCourierToBase: () => WarehouseLoadedBatch[];
}

interface MapCanvasProps {
  graph: RoadGraph;
  buildings: Building[];
  baseDepot?: BaseDepotSpec;
  showGrid: boolean;
  footprintOnly: boolean;
  showStreetNames: boolean;
  gameSpeed: GameSpeed;
  gameMinutesRef?: React.RefObject<number>;
  economyStateRef?: React.RefObject<OrderEconomyState>;
  interactionBlocked?: boolean;
  onFpsChange?: (fps: number) => void;
  onCourierAtBaseChange?: (atBase: boolean) => void;
  onLoadFromWarehouse?: (
    orderId?: string,
    priorityOrderIds?: readonly string[]
  ) => WarehouseLoadedBatch[];
  onPickupPackagesLoaded?: (
    orderId: string,
    requestedCount: number,
    currentGameDay: number
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
  showGrid,
  footprintOnly,
  showStreetNames,
  gameSpeed,
  gameMinutesRef,
  economyStateRef,
  interactionBlocked = false,
  onFpsChange,
  onCourierAtBaseChange,
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
  const buildingSpriteCacheRef = useRef<BuildingSpriteCache | null>(null);
  const fenceSpriteCacheRef = useRef<FenceSpriteCache | null>(null);
  const internalGameMinutesRef = useRef<number>(0);

  const viewportRef = useRef<Size>({ width: 1440, height: 900 });
  const cameraRef = useRef<CameraState>({ x: 820, y: 1460, zoom: DEFAULT_ZOOM });
  const targetCameraRef = useRef<CameraState>({ x: 820, y: 1460, zoom: DEFAULT_ZOOM });
  const cameraVelocityRef = useRef<CameraVelocity>({ vx: 0, vy: 0 });
  const initializedCameraRef = useRef<boolean>(false);
  const pressedArrowKeysRef = useRef<Set<ArrowKey>>(new Set());

  const courierRef = useRef<CourierState>(createIdleCourier());
  const courierAtBaseReportedRef = useRef<boolean>(true);
  const activeRouteRef = useRef<Point[]>([]);
  const targetMarkerRef = useRef<Point | null>(null);

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
    onLoadFromWarehouse,
    onPickupPackagesLoaded,
    onDeliverPackages,
    onReturnCargoToWarehouse,
  };

  const reportCourierAtBase = (atBase: boolean) => {
    if (courierAtBaseReportedRef.current !== atBase) {
      courierAtBaseReportedRef.current = atBase;
      propsRef.current.onCourierAtBaseChange?.(atBase);
    }
  };

  // Clear held arrow keys immediately whenever a modal blocks map interaction
  useEffect(() => {
    if (interactionBlocked) {
      pressedArrowKeysRef.current.clear();
    }
  }, [interactionBlocked]);

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
        const { graph: curGraph } = propsRef.current;
        if (!building.roadApproachPoint || !building.deliveryStopPoint) {
          return false;
        }

        const approach = building.roadApproachPoint;
        const stop = building.deliveryStopPoint;
        const address = formatBuildingAddress(building);

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
        const rackExit = propsRef.current.baseDepot.bikeRack.exitWaypoints;
        const rackReturn = [...rackExit].reverse();

        const fullOutbound = stitchWaypoints(rackExit, outboundLanePts, approachExtras, [stopPoint]);
        const fullReturn = stitchWaypoints([stopPoint], returnExtras, returnLanePts, rackReturn);

        activeRouteRef.current = stitchWaypoints(outboundLanePts, approachExtras, [stopPoint]);
        targetMarkerRef.current = stopPoint;
        courierRef.current = createCourierFromPath(
          fullOutbound,
          DEFAULT_COURIER_SPEED,
          DELIVERY_PAUSE_SECONDS,
          fullReturn,
          address
        );
        reportCourierAtBase(false);

        return true;
      },
      recallCourierToBase: () => {
        const recoveredCargo = courierRef.current.cargo
          .filter((item) => item.count > 0)
          .map((item) => ({ ...item }));
        courierRef.current = createIdleCourier();
        activeRouteRef.current = [];
        targetMarkerRef.current = null;
        reportCourierAtBase(true);
        return recoveredCargo;
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

    // Pre-build static ground buffer & individual 3D building sprites once on mount
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
          },
          groundKey,
          groundBufferRef.current
        );
      }

      const spriteKey = `w${curBaseDepot.warehouseTier}:f${isFootprintOnly ? 1 : 0}`;
      if (buildingSpriteCacheRef.current?.key !== spriteKey) {
        buildingSpriteCacheRef.current = isFootprintOnly
          ? { key: spriteKey, sprites: new Map() }
          : buildBuildingSpriteCache(curBuildings, spriteKey);
      }

      if (!fenceSpriteCacheRef.current) {
        fenceSpriteCacheRef.current = buildFenceSpriteCache(curBuildings);
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

    const tryDispatchCourier = (
      currentGameMinutes: number,
      startFrom: CourierStartPoint
    ): boolean => {
      const {
        graph: curGraph,
        buildings: curBuildings,
        baseDepot: curBaseDepot,
        economyStateRef: ecoRef,
        onLoadFromWarehouse: loadFromWarehouse,
        onReturnCargoToWarehouse: returnCargoToWarehouse,
      } = propsRef.current;

      const ecoState = ecoRef?.current;
      if (!ecoState) return false;

      // Strictly scan today's Plan tygodnia from top (#1, #2, ...) and pick the first ready Odbiór or Rozwózka
      const selectedTask = selectNextCourierTaskForDay(ecoState, currentGameMinutes);
      if (!selectedTask) return false;

      if (selectedTask.kind === 'delivery') {
        if (!loadFromWarehouse) return false;
        const loadedBatches = loadFromWarehouse(selectedTask.order.id);
        if (loadedBatches.length === 0) return false;

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

        for (const batch of loadedBatches) {
          const senderBuildingId = senderLookup.get(batch.orderId) ?? null;
          for (let p = 0; p < batch.count; p++) {
            const recipient = pickRandomRecipientBuildingForPackage(
              curBuildings,
              senderBuildingId
            );
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

        const groupedStops = Array.from(stopByBuildingId.values());
        const mission = createDeliveryMissionCourier(
          curGraph,
          curBaseDepot,
          groupedStops,
          loadedBatches,
          startFrom,
          DEFAULT_COURIER_SPEED
        );

        if (mission.active) {
          courierRef.current = mission;
          activeRouteRef.current = mission.phase === 'delivering' ? [] : mission.path;
          targetMarkerRef.current = null;
          reportCourierAtBase(false);
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
        DEFAULT_COURIER_SPEED
      );
      if (pickupMission.active) {
        courierRef.current = pickupMission;
        activeRouteRef.current = pickupMission.path;
        targetMarkerRef.current = pickupMission.stops[0]?.stopPoint ?? null;
        reportCourierAtBase(false);
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

      // End of seasonal workday: immediately abort further pickups/deliveries and route back to Base
      if (isNightNow && courierRef.current.active && !courierRef.current.isForcedReturn) {
        const interrupted = interruptCourierForEndOfWorkday(
          courierRef.current,
          propsRef.current.graph,
          propsRef.current.baseDepot
        );
        courierRef.current = interrupted;
        activeRouteRef.current = interrupted.path;
        targetMarkerRef.current = null;
      }

      if (simDt > 0 && courierRef.current.active) {
        const stepRes = stepCourierMissionWithSimDt(courierRef.current, simDt);
        courierRef.current = stepRes.state;

        for (const ev of stepRes.events) {
          if (ev.type === 'pickup_loaded') {
            const clock = getGameClockDisplay(currentGameMinutes);
            const actualLoaded =
              propsRef.current.onPickupPackagesLoaded?.(
                ev.orderId,
                ev.plannedCount,
                clock.gameDay
              ) ?? 0;
            if (actualLoaded > 0) {
              if (courierRef.current.active) {
                courierRef.current = {
                  ...courierRef.current,
                  cargo: [{ orderId: ev.orderId, count: actualLoaded }],
                };
              } else {
                propsRef.current.onReturnCargoToWarehouse?.([
                  { orderId: ev.orderId, count: actualLoaded },
                ]);
              }
            }
          } else if (ev.type === 'delivery_completed') {
            propsRef.current.onDeliverPackages?.(ev.items, currentGameMinutes);
          } else if (ev.type === 'base_unloaded') {
            if (ev.cargo.length > 0) {
              propsRef.current.onReturnCargoToWarehouse?.(ev.cargo);
            }
          } else if (ev.type === 'arrived_at_loading_zone') {
            // If workday is still open and another task is ready, chain immediately from the loading bay
            const chained =
              !isNightNow && !ev.wasForcedReturn
                ? tryDispatchCourier(currentGameMinutes, 'loading_zone')
                : false;

            if (!chained) {
              // All tasks done or workday ended -> park bicycle at the exterior bike rack
              const parkMission = createParkAtRackCourier(
                propsRef.current.baseDepot,
                undefined,
                ev.wasForcedReturn || isNightNow,
                DEFAULT_COURIER_SPEED
              );
              if (parkMission.active) {
                courierRef.current = parkMission;
                activeRouteRef.current = [];
                targetMarkerRef.current = null;
              } else {
                activeRouteRef.current = [];
                targetMarkerRef.current = null;
                reportCourierAtBase(true);
              }
            }
          } else if (ev.type === 'parked_at_rack') {
            if (ev.cargo.length > 0) {
              propsRef.current.onReturnCargoToWarehouse?.(ev.cargo);
            }
            activeRouteRef.current = [];
            targetMarkerRef.current = null;
            reportCourierAtBase(true);
          }
        }

        if (courierRef.current.active) {
          if (courierRef.current.missionKind === 'park_rack') {
            activeRouteRef.current = [];
            targetMarkerRef.current = null;
          } else if (
            courierRef.current.phase === 'outbound' ||
            courierRef.current.phase === 'delivering'
          ) {
            const curStop = courierRef.current.stops[courierRef.current.currentStopIndex];
            if (curStop && (curStop.kind === 'base_load' || curStop.kind === 'base_unload')) {
              activeRouteRef.current =
                courierRef.current.phase === 'delivering' ? [] : courierRef.current.path;
              targetMarkerRef.current = null;
            } else {
              activeRouteRef.current = courierRef.current.path;
              targetMarkerRef.current = curStop?.stopPoint ?? null;
            }
          } else if (courierRef.current.phase === 'returning') {
            activeRouteRef.current = courierRef.current.path;
            targetMarkerRef.current = null;
          }
        }
      }

      // During seasonal workday hours, automatically dispatch idle courier parked at Base bike rack
      if (simDt > 0 && !isNightNow && !courierRef.current.active) {
        tryDispatchCourier(currentGameMinutes, 'rack');
      }

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

      ctx.fillStyle = '#161b22';
      ctx.fillRect(0, 0, vw, vh);

      // Apply camera transform once for ground blit & dynamic overlays
      ctx.translate(vw / 2, vh / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(-cam.x, -cam.y);

      const halfGroundW = vw / (2 * effectiveZoom) + 4;
      const halfGroundH = vh / (2 * effectiveZoom) + 4;
      const groundViewBounds = {
        minX: cam.x - halfGroundW,
        maxX: cam.x + halfGroundW,
        minY: cam.y - halfGroundH,
        maxY: cam.y + halfGroundH,
      };

      // 1. Single cropped drawImage of pre-rendered static ground (terrain, roads, markings, parking, optional 2D footprints & road grid)
      if (groundBufferRef.current) {
        drawStaticGroundBuffer(ctx, groundBufferRef.current, groundViewBounds);
      }

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
        drawCourierRoute(ctx, activeRouteRef.current, invScale);

        const activeCourier = courierRef.current;
        if (
          targetMarkerRef.current &&
          (activeCourier.phase === 'outbound' || activeCourier.phase === 'delivering')
        ) {
          drawCourierDestinationPin(ctx, targetMarkerRef.current, invScale);
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

      const courier = courierRef.current;
      const showParkedBikeAtRack = courier.phase === 'idle';
      const rack = curBaseDepot.bikeRack;

      if (isFootprintOnly) {
        // 2D Footprints Mode: footprints & optional road grid are already baked into the static ground buffer
        drawBaseLoadingZone(ctx, curBaseDepot.loadingZone);
        drawDynamicRouteAndPin();
        if (curBaseNode) {
          drawBaseMarker(curBaseNode);
        }
        drawBikeRackWithOptionalBike(ctx, rack, showParkedBikeAtRack);
        if (courier.phase !== 'idle') {
          drawIsometricBicycle(ctx, {
            x: courier.x,
            y: courier.y,
            angle: courier.angle,
            withRider: courier.riderMounted,
            wheelPhase: courier.wheelPhase,
            isDelivering: courier.phase === 'delivering',
          });
        }
        if (streetNamesVisible) {
          renderStreetNames(ctx, effectiveZoom, viewBounds);
        }
      } else {
        // Normal 3D Mode: Base loading zone & active route on ground, then Z-sorted 3D building sprites interleaved with
        // fences, BAZA bike rack, and active courier bicycle so tall blocks naturally occlude the rider
        const bikeRackEntity: DepthSortedEntity = {
          id: rack.id,
          uMin: rack.uMin,
          uMax: rack.uMax,
          vMin: rack.vMin,
          vMax: rack.vMax,
          draw: (drawCtx) => drawBikeRackWithOptionalBike(drawCtx, rack, showParkedBikeAtRack),
        };

        const depthEntities: DepthSortedEntity[] = [bikeRackEntity];
        if (courier.phase !== 'idle') {
          const isoPos = canvasToIso(courier.x, courier.y);
          const halfFoot = 3.2;
          depthEntities.push({
            id: 'courier_bike',
            uMin: isoPos.u - halfFoot,
            uMax: isoPos.u + halfFoot,
            vMin: isoPos.v - halfFoot,
            vMax: isoPos.v + halfFoot,
            draw: (drawCtx) =>
              drawIsometricBicycle(drawCtx, {
                x: courier.x,
                y: courier.y,
                angle: courier.angle,
                withRider: courier.riderMounted,
                wheelPhase: courier.wheelPhase,
                isDelivering: courier.phase === 'delivering',
              }),
          });
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
          buildingSpriteCacheRef.current,
          fenceSpriteCacheRef.current
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

