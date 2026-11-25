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
  getCourierCapacityForSelection,
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
  getOwnedVanByIndex,
  getOwnedVans,
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
  setPanoramicOverview: () => void;
  armIntroFlyIn: () => void;
  beginArmedIntroFlyIn: () => void;
  armOutroFlyOut: () => void;
  beginArmedOutroFlyOut: () => void;
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
  /** Shows moderate panoramic city overview (used behind Start Screen) */
  overviewMode?: boolean;
  /** Incrementing session counter that forces full fleet reinitialization parked at Base */
  sessionEpoch?: number;
  onFpsChange?: (fps: number) => void;
  onMapReady?: () => void;
  onIntroFlyInComplete?: () => void;
  onOutroFlyOutComplete?: () => void;
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
const MAX_MOBILE_CANVAS_DPR = 1.5;
const MAX_DESKTOP_CANVAS_DPR = 2;
const DEFAULT_ACTIVE_VEHICLE: ActiveVehicleSelection = { type: 'bike', index: 1 };
const CAMERA_INTRO_DURATION_MS = 2500;
const CAMERA_INTRO_DURATION_SEC = CAMERA_INTRO_DURATION_MS / 1000;
const CAMERA_OUTRO_DURATION_MS = 1800;
const CAMERA_OUTRO_DURATION_SEC = CAMERA_OUTRO_DURATION_MS / 1000;
/** Optimal panoramic zoom multiplier (~0.75x keeps Start Screen sharp & 60 FPS on mobile) */
const OVERVIEW_ZOOM_RATIO = 0.75;
/** Scenic framing offset relative to Base focus for the Start Screen panorama */
const OVERVIEW_BASE_OFFSET_X = 200;
const OVERVIEW_BASE_OFFSET_Y = -145;

interface CameraIntroTransition {
  direction: 'in' | 'out';
  phase: 'armed' | 'running' | 'settled_out';
  started: boolean;
  elapsedSec: number;
  durationSec: number;
  fromX: number;
  fromY: number;
  fromEffectiveZoom: number;
}

interface AmbientTrafficCar {
  fromId: string;
  toId: string;
  progress: number;
  speed: number;
  bodyColor: string;
  roofColor: string;
  length: number;
  width: number;
  turnSeed: number;
}

const AMBIENT_CAR_PALETTE: ReadonlyArray<{ body: string; roof: string }> = [
  { body: '#e2e8f0', roof: '#f8fafc' },
  { body: '#64748b', roof: '#94a3b8' },
  { body: '#3b82f6', roof: '#60a5fa' },
  { body: '#f59e0b', roof: '#fbbf24' },
  { body: '#ef4444', roof: '#f87171' },
  { body: '#10b981', roof: '#34d399' },
  { body: '#475569', roof: '#64748b' },
  { body: '#f97316', roof: '#fb923c' },
];

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const inv = 1 - clamped;
  return 1 - inv * inv * inv;
}

function easeInOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function getBaseFocusPoint(baseNode: { x: number; y: number } | null): Point {
  return baseNode ? { x: baseNode.x + 10, y: baseNode.y - 70 } : { x: 820, y: 1460 };
}

function clampWorldCenterForEffectiveZoom(
  x: number,
  y: number,
  effectiveZoom: number,
  viewport: Size
): Point {
  const safeZoom = Math.max(0.05, effectiveZoom);
  const halfVisW = Math.max(1, viewport.width) / (2 * safeZoom);
  const halfVisH = Math.max(1, viewport.height) / (2 * safeZoom);

  const clampedX =
    halfVisW * 2 >= MAP_WIDTH
      ? MAP_WIDTH / 2
      : Math.max(halfVisW, Math.min(MAP_WIDTH - halfVisW, x));
  const clampedY =
    halfVisH * 2 >= MAP_HEIGHT
      ? MAP_HEIGHT / 2
      : Math.max(halfVisH, Math.min(MAP_HEIGHT - halfVisH, y));

  return { x: clampedX, y: clampedY };
}

/**
 * Computes an optimal, mobile-friendly panoramic camera slightly offset from Base
 * (~0.75x of normal gameplay zoom, floored so map boundaries never show empty void).
 */
function getPanoramicCamera(
  viewport: Size,
  baseNode: { x: number; y: number } | null
): { x: number; y: number; effectiveZoom: number } {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const gameplayEffectiveZoom = getEffectiveZoom(DEFAULT_ZOOM, viewport, MAP_SIZE);
  const minCoverZoom = Math.max(vw / MAP_WIDTH, vh / MAP_HEIGHT) * 1.04;
  const overviewZoom = Math.max(minCoverZoom, gameplayEffectiveZoom * OVERVIEW_ZOOM_RATIO);

  const baseFocus = getBaseFocusPoint(baseNode);
  const clamped = clampWorldCenterForEffectiveZoom(
    baseFocus.x + OVERVIEW_BASE_OFFSET_X,
    baseFocus.y + OVERVIEW_BASE_OFFSET_Y,
    overviewZoom,
    viewport
  );

  return {
    x: clamped.x,
    y: clamped.y,
    effectiveZoom: overviewZoom,
  };
}

function createAmbientTrafficPool(graph: RoadGraph, count = 10): {
  nodeMap: Map<string, Point>;
  adjacency: Map<string, string[]>;
  cars: AmbientTrafficCar[];
} {
  const nodeMap = new Map<string, Point>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, { x: node.x, y: node.y });
  }

  const adjacency = new Map<string, string[]>();
  const validSegments: Array<{ from: string; to: string }> = [];

  for (const edge of graph.edges) {
    const [fromId, toId] = edge;
    if (fromId === 'base' || toId === 'base') continue;
    const fromPt = nodeMap.get(fromId);
    const toPt = nodeMap.get(toId);
    if (!fromPt || !toPt) continue;
    if (Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y) < 35) continue;

    const listA = adjacency.get(fromId) ?? [];
    if (!listA.includes(toId)) listA.push(toId);
    adjacency.set(fromId, listA);

    const listB = adjacency.get(toId) ?? [];
    if (!listB.includes(fromId)) listB.push(fromId);
    adjacency.set(toId, listB);

    validSegments.push({ from: fromId, to: toId });
    validSegments.push({ from: toId, to: fromId });
  }

  const cars: AmbientTrafficCar[] = [];
  if (validSegments.length === 0) {
    return { nodeMap, adjacency, cars };
  }

  const stride = Math.max(1, Math.floor(validSegments.length / count));
  for (let i = 0; i < count; i++) {
    const seg = validSegments[(i * stride + i * 3) % validSegments.length];
    const palette = AMBIENT_CAR_PALETTE[i % AMBIENT_CAR_PALETTE.length];
    cars.push({
      fromId: seg.from,
      toId: seg.to,
      progress: ((i * 0.37) % 0.85) + 0.05,
      speed: 52 + ((i * 19) % 38),
      bodyColor: palette.body,
      roofColor: palette.roof,
      length: 10.5 + (i % 3) * 1.1,
      width: 5.4 + (i % 2) * 0.7,
      turnSeed: i + 1,
    });
  }

  return { nodeMap, adjacency, cars };
}

function stepAmbientTraffic(
  cars: AmbientTrafficCar[],
  nodeMap: Map<string, Point>,
  adjacency: Map<string, string[]>,
  dt: number
): void {
  if (dt <= 0 || cars.length === 0) return;

  for (const car of cars) {
    const fromPt = nodeMap.get(car.fromId);
    const toPt = nodeMap.get(car.toId);
    if (!fromPt || !toPt) continue;
    const segLen = Math.max(1, Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y));
    car.progress += (car.speed * dt) / segLen;

    if (car.progress >= 1) {
      const neighbors = adjacency.get(car.toId);
      if (neighbors && neighbors.length > 0) {
        const nonReverse = neighbors.filter((id) => id !== car.fromId);
        const candidates = nonReverse.length > 0 ? nonReverse : neighbors;
        car.turnSeed = (car.turnSeed * 7 + 3) % 97;
        const nextTo = candidates[car.turnSeed % candidates.length];
        car.fromId = car.toId;
        car.toId = nextTo;
        car.progress = car.progress - Math.floor(car.progress);
      } else {
        const prevFrom = car.fromId;
        car.fromId = car.toId;
        car.toId = prevFrom;
        car.progress = 0;
      }
    }
  }
}

function drawAmbientTraffic(
  ctx: CanvasRenderingContext2D,
  cars: readonly AmbientTrafficCar[],
  nodeMap: Map<string, Point>,
  viewBounds: { minX: number; maxX: number; minY: number; maxY: number },
  alpha: number
): void {
  if (alpha <= 0.01 || cars.length === 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  for (const car of cars) {
    const fromPt = nodeMap.get(car.fromId);
    const toPt = nodeMap.get(car.toId);
    if (!fromPt || !toPt) continue;

    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const angle = Math.atan2(dy, dx);
    // Offset cleanly onto the right-hand lane
    const laneOffset = 4.4;
    const cx = fromPt.x + dx * car.progress - Math.sin(angle) * laneOffset;
    const cy = fromPt.y + dy * car.progress + Math.cos(angle) * laneOffset;

    if (
      cx < viewBounds.minX ||
      cx > viewBounds.maxX ||
      cy < viewBounds.minY ||
      cy > viewBounds.maxY
    ) {
      continue;
    }

    const halfL = car.length * 0.5;
    const halfW = car.width * 0.5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Subtle ground shadow
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.fillRect(-halfL + 0.8, -halfW + 1.1, car.length, car.width);

    // Car body
    ctx.fillStyle = car.bodyColor;
    ctx.fillRect(-halfL, -halfW, car.length, car.width);

    // Roof / cabin highlight
    ctx.fillStyle = car.roofColor;
    ctx.fillRect(-halfL * 0.45, -halfW * 0.72, car.length * 0.52, car.width * 0.72);

    // Tiny warm headlights at front
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(halfL - 1.1, -halfW + 0.6, 1.1, 1.3);
    ctx.fillRect(halfL - 1.1, halfW - 1.9, 1.1, 1.3);

    ctx.restore();
  }

  ctx.restore();
}

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
  overviewMode = false,
  sessionEpoch = 0,
  onFpsChange,
  onMapReady,
  onIntroFlyInComplete,
  onOutroFlyOutComplete,
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
  const cameraIntroRef = useRef<CameraIntroTransition | null>(null);
  const initializedCameraRef = useRef<boolean>(false);
  const pressedArrowKeysRef = useRef<Set<ArrowKey>>(new Set());

  const ambientTrafficRef = useRef<{
    nodeMap: Map<string, Point>;
    adjacency: Map<string, string[]>;
    cars: AmbientTrafficCar[];
  }>(createAmbientTrafficPool(graph, 10));

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
    overviewMode,
    onFpsChange,
    onMapReady,
    onIntroFlyInComplete,
    onOutroFlyOutComplete,
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
    overviewMode,
    onFpsChange,
    onMapReady,
    onIntroFlyInComplete,
    onOutroFlyOutComplete,
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
    const eco = propsRef.current.economyStateRef?.current;
    couriersFleetRef.current = createInitialCourierFleet(eco?.couriers, eco);
    syncFleetStatus();
  }, [sessionEpoch]);

  // Expose camera & courier dispatch controls for upcoming order mechanics
  useEffect(() => {
    controllerRef.current = {
      centerOnBase: () => {
        const focus = getBaseFocusPoint(propsRef.current.baseNode);
        cameraIntroRef.current = null;
        cameraVelocityRef.current = { vx: 0, vy: 0 };
        targetCameraRef.current = createInitialCamera(viewportRef.current, MAP_SIZE, focus);
      },
      setPanoramicOverview: () => {
        cameraIntroRef.current = null;
        cameraVelocityRef.current = { vx: 0, vy: 0 };
        pressedArrowKeysRef.current.clear();
      },
      armIntroFlyIn: () => {
        const viewport = viewportRef.current;
        const pan = getPanoramicCamera(viewport, propsRef.current.baseNode);
        const focus = getBaseFocusPoint(propsRef.current.baseNode);
        const baseCam = createInitialCamera(viewport, MAP_SIZE, focus);

        cameraVelocityRef.current = { vx: 0, vy: 0 };
        pressedArrowKeysRef.current.clear();
        cameraRef.current = baseCam;
        targetCameraRef.current = baseCam;
        // Hold camera at exact panoramic coordinates until state reset & localStorage save settle
        cameraIntroRef.current = {
          direction: 'in',
          phase: 'armed',
          started: false,
          elapsedSec: 0,
          durationSec: CAMERA_INTRO_DURATION_SEC,
          fromX: pan.x,
          fromY: pan.y,
          fromEffectiveZoom: pan.effectiveZoom,
        };
      },
      beginArmedIntroFlyIn: () => {
        const current = cameraIntroRef.current;
        if (current && current.direction === 'in') {
          current.phase = 'running';
          // Begin strictly at 0% on the first rendered rAF frame; accumulate clamped dt thereafter
          current.started = false;
          current.elapsedSec = 0;
          current.durationSec = CAMERA_INTRO_DURATION_SEC;
        } else {
          const viewport = viewportRef.current;
          const pan = getPanoramicCamera(viewport, propsRef.current.baseNode);
          cameraIntroRef.current = {
            direction: 'in',
            phase: 'running',
            started: false,
            elapsedSec: 0,
            durationSec: CAMERA_INTRO_DURATION_SEC,
            fromX: pan.x,
            fromY: pan.y,
            fromEffectiveZoom: pan.effectiveZoom,
          };
        }
      },
      armOutroFlyOut: () => {
        const viewport = viewportRef.current;
        const fromEffectiveZoom = getEffectiveZoom(cameraRef.current.zoom, viewport, MAP_SIZE);
        cameraVelocityRef.current = { vx: 0, vy: 0 };
        pressedArrowKeysRef.current.clear();
        // Hold exact current gameplay camera coordinates until mist mounts at opacity 0
        cameraIntroRef.current = {
          direction: 'out',
          phase: 'armed',
          started: false,
          elapsedSec: 0,
          durationSec: CAMERA_OUTRO_DURATION_SEC,
          fromX: cameraRef.current.x,
          fromY: cameraRef.current.y,
          fromEffectiveZoom,
        };
      },
      beginArmedOutroFlyOut: () => {
        const current = cameraIntroRef.current;
        if (current && current.direction === 'out') {
          current.phase = 'running';
          current.started = false;
          current.elapsedSec = 0;
          current.durationSec = CAMERA_OUTRO_DURATION_SEC;
        } else {
          const viewport = viewportRef.current;
          const fromEffectiveZoom = getEffectiveZoom(cameraRef.current.zoom, viewport, MAP_SIZE);
          cameraIntroRef.current = {
            direction: 'out',
            phase: 'running',
            started: false,
            elapsedSec: 0,
            durationSec: CAMERA_OUTRO_DURATION_SEC,
            fromX: cameraRef.current.x,
            fromY: cameraRef.current.y,
            fromEffectiveZoom,
          };
        }
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
        const eco = propsRef.current.economyStateRef?.current;
        const roster = eco?.couriers;

        for (const slotIndex of COURIER_SLOT_INDICES) {
          const assignedVehicle =
            roster?.find((c) => c.slotIndex === slotIndex)?.assignedVehicle ??
            (slotIndex === 1 ? propsRef.current.activeVehicle : { type: 'bike' as const, index: 1 });
          const vehicleCapacity = eco
            ? getCourierCapacityForSelection(eco, assignedVehicle)
            : undefined;
          couriersFleetRef.current[slotIndex] = {
            slotIndex,
            inRoute: false,
            assignedTaskId: null,
            courier: createIdleCourier(assignedVehicle, slotIndex, vehicleCapacity),
            activeRoute: [],
            targetMarker: null,
          };
        }

        syncFleetStatus();
        return recoveredCargo;
      },
      getInFlightCargo: () => collectInFlightCargoForFleet(couriersFleetRef.current),
      resetCouriersToBase: (couriers?: readonly CompanyCourier[]) => {
        const eco = propsRef.current.economyStateRef?.current;
        const roster = couriers ?? eco?.couriers;
        couriersFleetRef.current = createInitialCourierFleet(roster, eco);
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
      const isMobileOrTouch =
        window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 1024;
      const maxDpr = isMobileOrTouch ? MAX_MOBILE_CANVAS_DPR : MAX_DESKTOP_CANVAS_DPR;
      const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), maxDpr);

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
      const vehicleCapacity = getCourierCapacityForSelection(ecoState, dispatchVehicle);
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
          vehicleCapacity,
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
          assignedTaskId,
          vehicleCapacity
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
        assignedTaskId,
        vehicleCapacity
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

      const isOverviewOrIntro =
        propsRef.current.overviewMode || cameraIntroRef.current !== null;

      // Measure real rendered FPS averaged over ~0.5s intervals, but skip React UI updates
      // while the Start Screen or camera fly-in is active so zero unnecessary re-renders occur
      fpsFrames += 1;
      const fpsElapsed = now - fpsWindowStart;
      if (fpsElapsed >= FPS_SAMPLE_WINDOW_MS) {
        if (fpsElapsed > 2000 || isOverviewOrIntro) {
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

      // Compute arrow-key directional input vector (blocked while modals/overview/intro are active)
      const activeArrowKeys = pressedArrowKeysRef.current;
      const arrowInput: ArrowInputVector = { x: 0, y: 0 };
      if (!propsRef.current.interactionBlocked && !isOverviewOrIntro && activeArrowKeys.size > 0) {
        if (activeArrowKeys.has('ArrowLeft')) arrowInput.x -= 1;
        if (activeArrowKeys.has('ArrowRight')) arrowInput.x += 1;
        if (activeArrowKeys.has('ArrowUp')) arrowInput.y -= 1;
        if (activeArrowKeys.has('ArrowDown')) arrowInput.y += 1;
      }

      // Ensure static caches before starting the intro clock so any warehouse/parking rebuild
      // during load never eats into the 2.5s fly-in duration
      ensureStaticCaches();

      // Compute rendered camera transform & synchronized fog veil purely via refs (zero React setState during animation):
      // 1) Armed or running 2.5s easeOutCubic fly-in from panoramic overview to Base (fog 1 -> 0)
      // 2) Armed or running 1.8s easeInOutCubic fly-out back to panoramic overview (fog 0 -> 1)
      // 3) Moderate panoramic city overview behind Start Screen (fog 1)
      // 4) Standard interactive gameplay camera physics (fog 0)
      let renderCamX = cameraRef.current.x;
      let renderCamY = cameraRef.current.y;
      let renderEffectiveZoom = getEffectiveZoom(
        cameraRef.current.zoom,
        viewportRef.current,
        MAP_SIZE
      );
      let renderCacheZoomKey = cameraRef.current.zoom;
      let ambientTrafficAlpha = 0;
      let fogProgress = 0;
      let notifyIntroComplete = false;
      let notifyOutroComplete = false;

      const activeIntro = cameraIntroRef.current;
      if (activeIntro) {
        if (activeIntro.phase === 'settled_out') {
          const panCam = getPanoramicCamera(viewportRef.current, propsRef.current.baseNode);
          renderCamX = panCam.x;
          renderCamY = panCam.y;
          renderEffectiveZoom = panCam.effectiveZoom;
          renderCacheZoomKey = panCam.effectiveZoom;
          ambientTrafficAlpha = 1;
          fogProgress = 1;
          if (propsRef.current.overviewMode) {
            cameraIntroRef.current = null;
          }
        } else if (activeIntro.phase === 'armed') {
          renderCamX = activeIntro.fromX;
          renderCamY = activeIntro.fromY;
          renderEffectiveZoom = activeIntro.fromEffectiveZoom;
          renderCacheZoomKey = activeIntro.fromEffectiveZoom;
          ambientTrafficAlpha = activeIntro.direction === 'in' ? 1 : 0;
          fogProgress = activeIntro.direction === 'in' ? 1 : 0;
        } else {
          if (!activeIntro.started) {
            activeIntro.started = true;
            activeIntro.elapsedSec = 0;
          } else {
            const maxDtStep = activeIntro.direction === 'out' ? 0.033 : 0.05;
            activeIntro.elapsedSec += Math.min(rawDt, maxDtStep);
          }
          const rawT = Math.min(1, activeIntro.elapsedSec / activeIntro.durationSec);

          if (activeIntro.direction === 'in') {
            const eased = easeOutCubic(rawT);
            const baseFocus = getBaseFocusPoint(propsRef.current.baseNode);
            const baseCam = createInitialCamera(viewportRef.current, MAP_SIZE, baseFocus);
            const toEffectiveZoom = getEffectiveZoom(baseCam.zoom, viewportRef.current, MAP_SIZE);

            const safeFromZoom = Math.max(0.05, activeIntro.fromEffectiveZoom);
            renderEffectiveZoom = safeFromZoom * Math.pow(toEffectiveZoom / safeFromZoom, eased);
            const interpX = activeIntro.fromX + (baseCam.x - activeIntro.fromX) * eased;
            const interpY = activeIntro.fromY + (baseCam.y - activeIntro.fromY) * eased;
            const clampedCenter = clampWorldCenterForEffectiveZoom(
              interpX,
              interpY,
              renderEffectiveZoom,
              viewportRef.current
            );
            renderCamX = clampedCenter.x;
            renderCamY = clampedCenter.y;
            renderCacheZoomKey = renderEffectiveZoom;
            ambientTrafficAlpha = Math.max(0, 1 - eased * 1.4);
            fogProgress = 1 - eased;

            if (rawT >= 1) {
              cameraRef.current = baseCam;
              targetCameraRef.current = baseCam;
              cameraVelocityRef.current = { vx: 0, vy: 0 };
              cameraIntroRef.current = null;
              renderCamX = baseCam.x;
              renderCamY = baseCam.y;
              renderEffectiveZoom = toEffectiveZoom;
              renderCacheZoomKey = baseCam.zoom;
              ambientTrafficAlpha = 0;
              fogProgress = 0;
              notifyIntroComplete = true;
            }
          } else {
            const eased = easeInOutCubic(rawT);
            const panCam = getPanoramicCamera(viewportRef.current, propsRef.current.baseNode);
            const safeFromZoom = Math.max(0.05, activeIntro.fromEffectiveZoom);
            renderEffectiveZoom =
              safeFromZoom * Math.pow(panCam.effectiveZoom / safeFromZoom, eased);
            const interpX = activeIntro.fromX + (panCam.x - activeIntro.fromX) * eased;
            const interpY = activeIntro.fromY + (panCam.y - activeIntro.fromY) * eased;
            const clampedCenter = clampWorldCenterForEffectiveZoom(
              interpX,
              interpY,
              renderEffectiveZoom,
              viewportRef.current
            );
            renderCamX = clampedCenter.x;
            renderCamY = clampedCenter.y;
            renderCacheZoomKey = renderEffectiveZoom;
            ambientTrafficAlpha = Math.min(1, eased * 1.25);
            fogProgress = eased;

            if (rawT >= 1) {
              cameraVelocityRef.current = { vx: 0, vy: 0 };
              activeIntro.phase = 'settled_out';
              renderCamX = panCam.x;
              renderCamY = panCam.y;
              renderEffectiveZoom = panCam.effectiveZoom;
              renderCacheZoomKey = panCam.effectiveZoom;
              ambientTrafficAlpha = 1;
              fogProgress = 1;
              notifyOutroComplete = true;
            }
          }
        }
      } else if (propsRef.current.overviewMode) {
        const panCam = getPanoramicCamera(viewportRef.current, propsRef.current.baseNode);
        renderCamX = panCam.x;
        renderCamY = panCam.y;
        renderEffectiveZoom = panCam.effectiveZoom;
        renderCacheZoomKey = panCam.effectiveZoom;
        ambientTrafficAlpha = 1;
        fogProgress = 1;
      } else {
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
        renderCamX = camStep.camera.x;
        renderCamY = camStep.camera.y;
        renderEffectiveZoom = getEffectiveZoom(
          camStep.camera.zoom,
          viewportRef.current,
          MAP_SIZE
        );
        renderCacheZoomKey = camStep.camera.zoom;
      }

      // Advance lightweight background street traffic while Start Screen overview or fly-in is visible
      if (ambientTrafficAlpha > 0.01) {
        stepAmbientTraffic(
          ambientTrafficRef.current.cars,
          ambientTrafficRef.current.nodeMap,
          ambientTrafficRef.current.adjacency,
          rawDt
        );
      }

      // Shared speed-scaled simulation step for couriers and future fleet vehicles (0 = paused)
      const simDt = isOverviewOrIntro ? 0 : computeScaledSimDt(rawDt, propsRef.current.gameSpeed);
      const currentGameMinutes = propsRef.current.gameMinutesRef.current ?? 0;
      const isNightNow = isOverviewOrIntro ? false : isNightHoursForTime(currentGameMinutes);

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
                      vehicleCapacity: activeMissionCapacity,
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
                        directTaskId,
                        activeMissionCapacity
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
                  slotIndex,
                  activeMissionCapacity
                );
                if (parkMission.active) {
                  entry.courier = parkMission;
                  entry.inRoute = true;
                  entry.assignedTaskId = null;
                  entry.activeRoute = [];
                  entry.targetMarker = null;
                } else {
                  entry.courier = createIdleCourier(
                    activeMissionVehicle,
                    slotIndex,
                    activeMissionCapacity
                  );
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
              entry.courier = createIdleCourier(
                activeMissionVehicle,
                slotIndex,
                activeMissionCapacity
              );
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
      if (!isOverviewOrIntro) {
        syncFleetStatus();
      }

      // Ensure static ground buffer & individual building sprites are built (rebuilt only on static state changes)
      ensureStaticCaches();

      const { width: vw, height: vh } = viewportRef.current;
      const dprX = canvas.width / Math.max(1, vw);
      const dprY = canvas.height / Math.max(1, vh);
      const effectiveZoom = renderEffectiveZoom;
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
          cameraX: renderCamX,
          cameraY: renderCamY,
          cameraZoom: renderCacheZoomKey,
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
      ctx.translate(-renderCamX, -renderCamY);

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

        ctx.font = `700 ${Math.round(12 * invScale)}px "Inter", sans-serif`;
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
        minX: renderCamX - halfViewW,
        maxX: renderCamX + halfViewW,
        minY: renderCamY - halfViewH,
        maxY: renderCamY + halfViewH,
      };

      if (ambientTrafficAlpha > 0.01) {
        drawAmbientTraffic(
          ctx,
          ambientTrafficRef.current.cars,
          ambientTrafficRef.current.nodeMap,
          viewBounds,
          ambientTrafficAlpha
        );
      }

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

      const currentEco = propsRef.current.economyStateRef?.current;
      const ownedVansList = currentEco ? getOwnedVans(currentEco) : undefined;

      const drawFleetCourier = (
        drawCtx: CanvasRenderingContext2D,
        entry: FleetCourierSlotState
      ) => {
        const c = entry.courier;
        const cargoCount = getCourierCargoCount(c.cargo);
        if (c.vehicleType === 'van') {
          const ownedVan = currentEco ? getOwnedVanByIndex(currentEco, c.vehicleIndex) : undefined;
          drawIsometricDeliveryVan(drawCtx, {
            x: c.x,
            y: c.y,
            angle: c.angle,
            wheelPhase: c.wheelPhase,
            isDelivering: c.phase === 'delivering',
            condition: ownedVan?.condition ?? 'used',
            tier: ownedVan?.tier ?? 'standard',
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
          const ownedVan = currentEco ? getOwnedVanByIndex(currentEco, slot.vanIndex) : undefined;
          drawIsometricDeliveryVan(ctx, {
            x: slot.spot.x,
            y: slot.spot.y,
            angle: slot.parkedAngle,
            wheelPhase: 0,
            condition: ownedVan?.condition ?? 'used',
            tier: ownedVan?.tier ?? 'standard',
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
          null,
          ownedVansList
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
        if (streetNamesVisible && !propsRef.current.overviewMode) {
          renderStreetNames(ctx, effectiveZoom, viewBounds);
        }
      }

      ctx.restore();

      // Render atmospheric fog directly inside <canvas> so no full-screen DOM layer is allocated mid-animation
      if (fogProgress > 0.001) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(15, 23, 42, ${fogProgress * 0.82})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      if (notifyIntroComplete) {
        propsRef.current.onIntroFlyInComplete?.();
      }
      if (notifyOutroComplete) {
        propsRef.current.onOutroFlyOutComplete?.();
      }

      if (!hasNotifiedMapReady) {
        hasNotifiedMapReady = true;
        mapReadyRafId = requestAnimationFrame(() => {
          mapReadyRafId = null;
          propsRef.current.onMapReady?.();
        });
      }

      rafId = requestAnimationFrame(drawScene);
    };

    let hasNotifiedMapReady = false;
    let mapReadyRafId: number | null = null;

    updateCanvasSize();
    ensureStaticCaches();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(container);
    window.addEventListener('resize', updateCanvasSize);
    rafId = requestAnimationFrame(drawScene);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (mapReadyRafId !== null) {
        cancelAnimationFrame(mapReadyRafId);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
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

