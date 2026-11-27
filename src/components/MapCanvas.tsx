import React, { useEffect, useMemo, useRef } from 'react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data/initialRoadGraph';
import { type Building, formatBuildingAddress } from '../types/building';
import type { Point, RoadGraph } from '../types/roadGraph';
import {
  type DepthSortedEntity,
  PARCEL_LOCKER_SLOTS,
  type ParcelLockerSlot,
  createQuickBoxTargetBuilding,
  getQuickBoxSlotById,
  getQuickBoxZoneForBuilding,
} from '../utils/buildings';
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
  GAS_STATION_PRICE_PYLONS,
  type ParkedScooterRenderEntry,
  drawBaseLoadingZone,
  drawBikeRackWithOptionalBike,
  drawCourierDestinationPin,
  drawCourierRoute,
  drawGasStationPricePylon,
  drawIsometricBicycle,
  drawIsometricDeliveryVan,
  drawIsometricScooter,
  drawQuickBoxActiveLocker,
  drawQuickBoxConstructionSite,
  drawQuickBoxCourierBay,
  drawQuickBoxPlacementBubble,
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
  screenToWorld,
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
  createRefuelMissionCourier,
  createRepairMissionCourier,
  getActiveOutVehiclesForFleet,
  getClaimedTaskCountsForFleet,
  getCourierCapacityForSelection,
  getCourierCargoCount,
  getCourierSpeedForSelection,
  getCourierSpeedForVehicle,
  getInFlightPickupCountsByOrderForFleet,
  getReservedWarehouseSpaceForFleet,
  interruptCourierForEndOfWorkday,
  isVehicleCurrentlyInRoute,
  selectNearestGasStationBuilding,
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
  AUTO_REFUEL_THRESHOLD_RATIO,
  BASE_FUEL_PRICE_PER_LITER,
  calculateVehicleRefuelCost,
  getOwnedScooterByIndex,
  getOwnedScooters,
  getOwnedVanByIndex,
  getOwnedVans,
  getRemainingPickupPackagesForOrderToday,
  getVehicleDurability,
  getVehicleDurabilitySpeedMultiplier,
  getVehicleFuelSpeedMultiplier,
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
import type { MaxFpsLimit, SupportedLanguage } from '../utils/settingsSystem';

export interface MapCanvasController {
  centerOnBase: () => void;
  setPanoramicOverview: () => void;
  armIntroFlyIn: () => void;
  beginArmedIntroFlyIn: () => void;
  armOutroFlyOut: () => void;
  beginArmedOutroFlyOut: () => void;
  dispatchCourierToBuilding: (building: Building) => boolean;
  requestVehicleRefuel: (vehicle: ActiveVehicleSelection) => boolean;
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
  /** Upper FPS cap configured in Graphics settings ('unlimited' disables throttling) */
  maxFps?: MaxFpsLimit;
  /** Active UI language for map street labels and gas station pylons */
  language?: SupportedLanguage;
  /** True when player is choosing a QuickBox construction plot directly on the map */
  quickBoxPlacementMode?: boolean;
  onSelectQuickBoxSlot?: (slotId: string) => void;
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
  onApplyVehicleWearBatch?: (
    entries: ReadonlyArray<{ vehicle: ActiveVehicleSelection; distancePx: number }>
  ) => void;
  onCompleteVehicleRepair?: (vehicle: ActiveVehicleSelection) => void;
  onCompleteVehicleRefuel?: (vehicle: ActiveVehicleSelection) => void;
  controllerRef: React.MutableRefObject<MapCanvasController | null>;
}

const MAP_SIZE: Size = { width: MAP_WIDTH, height: MAP_HEIGHT };
const FPS_SAMPLE_WINDOW_MS = 500;
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
  maxFps = 60,
  language = 'pl',
  quickBoxPlacementMode = false,
  onSelectQuickBoxSlot,
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
  onApplyVehicleWearBatch,
  onCompleteVehicleRepair,
  onCompleteVehicleRefuel,
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
  const reportedTaskAssignmentsRef = useRef<Record<string, number[]>>({});
  const pendingWearByKeyRef = useRef<
    Map<string, { vehicle: ActiveVehicleSelection; distancePx: number }>
  >(new Map());
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
    maxFps,
    language,
    quickBoxPlacementMode,
    onSelectQuickBoxSlot,
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
    onApplyVehicleWearBatch,
    onCompleteVehicleRepair,
    onCompleteVehicleRefuel,
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
    maxFps,
    language,
    quickBoxPlacementMode,
    onSelectQuickBoxSlot,
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
    onApplyVehicleWearBatch,
    onCompleteVehicleRepair,
    onCompleteVehicleRefuel,
  };

  const pendingRefuelKeysRef = useRef<Set<string>>(new Set());
  const reportedRefuelKeysSigRef = useRef<string>('');

  const syncFleetStatus = () => {
    const fleet = couriersFleetRef.current;
    const nextAtBaseBySlot = buildCourierAtBaseBySlot(fleet);
    const nextAllAtBase = COURIER_SLOT_INDICES.every((slot) => nextAtBaseBySlot[slot]);
    const nextTaskAssignments = buildTaskAssignmentsByTaskId(fleet);

    const refuelingSet = new Set<string>(pendingRefuelKeysRef.current);
    for (const slot of COURIER_SLOT_INDICES) {
      const entry = fleet[slot];
      if (entry && entry.inRoute && entry.courier.missionKind === 'refuel') {
        refuelingSet.add(`${entry.courier.vehicleType}:${entry.courier.vehicleIndex}`);
      }
    }
    const nextRefuelingKeys = Array.from(refuelingSet).sort();
    const nextRefuelingSig = nextRefuelingKeys.join('|');
    const refuelChanged = reportedRefuelKeysSigRef.current !== nextRefuelingSig;

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
        const prevArr = prevTasks[key];
        const nextArr = nextTaskAssignments[key];
        if (
          !prevArr ||
          !nextArr ||
          prevArr.length !== nextArr.length ||
          prevArr.some((slotId, idx) => slotId !== nextArr[idx])
        ) {
          tasksChanged = true;
          break;
        }
      }
    }

    if (atBaseChanged || tasksChanged || refuelChanged) {
      reportedAtBaseBySlotRef.current = nextAtBaseBySlot;
      reportedTaskAssignmentsRef.current = nextTaskAssignments;
      reportedRefuelKeysSigRef.current = nextRefuelingSig;
      propsRef.current.onCourierStatusChange?.({
        atBaseBySlot: nextAtBaseBySlot,
        allAtBase: nextAllAtBase,
        taskAssignmentsByTaskId: nextTaskAssignments,
        refuelingVehicleKeys: nextRefuelingKeys,
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
    pendingWearByKeyRef.current.clear();
    pendingRefuelKeysRef.current.clear();
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
          const eco = propsRef.current.economyStateRef?.current;
          const manualVanSpeed =
            getCourierSpeedForVehicle('van') *
            (eco
              ? getVehicleDurabilitySpeedMultiplier(getVehicleDurability(eco, curVehicle)) *
                getVehicleFuelSpeedMultiplier(eco, curVehicle)
              : 1);
          const manualCourier = createCourierFromPath(
            fullOutbound,
            manualVanSpeed,
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

        const eco = propsRef.current.economyStateRef?.current;
        const manualBikeSpeed =
          (eco
            ? getCourierSpeedForSelection(eco, curVehicle)
            : getCourierSpeedForVehicle(curVehicle.type)) *
          (eco
            ? getVehicleDurabilitySpeedMultiplier(getVehicleDurability(eco, curVehicle)) *
              getVehicleFuelSpeedMultiplier(eco, curVehicle)
            : 1);
        const manualCourier = createCourierFromPath(
          fullOutbound,
          manualBikeSpeed,
          DELIVERY_PAUSE_SECONDS,
          fullReturn,
          address,
          curVehicle,
          1
        );
        if (curVehicle.type === 'scooter' && eco) {
          manualCourier.scooterModelId = getOwnedScooterByIndex(eco, curVehicle.index)?.modelId;
        }
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
        pendingWearByKeyRef.current.clear();
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
      requestVehicleRefuel: (vehicle: ActiveVehicleSelection) => {
        if (vehicle.type === 'bike') return false;
        const key = `${vehicle.type}:${vehicle.index}`;
        pendingRefuelKeysRef.current.add(key);
        syncFleetStatus();
        return true;
      },
      getInFlightCargo: () => collectInFlightCargoForFleet(couriersFleetRef.current),
      resetCouriersToBase: (couriers?: readonly CompanyCourier[]) => {
        pendingWearByKeyRef.current.clear();
        pendingRefuelKeysRef.current.clear();
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
        footprintOnly: isFootprintOnly,
      } = propsRef.current;

      const groundKey = `g0:f${isFootprintOnly ? 1 : 0}:w${curBaseDepot.warehouseTier}:p${curBaseDepot.parking.spots.length}`;
      if (texturesRef.current && groundBufferRef.current?.key !== groundKey) {
        groundBufferRef.current = buildStaticGroundBuffer(
          {
            textures: texturesRef.current,
            baseDepot: curBaseDepot,
            buildings: curBuildings,
            graph: curGraph,
            parkingNavNetworks: curParkingNavNetworks,
            showGrid: false,
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
            urbanProps: new Map(),
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
    let pointerDownScreen: Point | null = null;
    let pointerMovedDist = 0;
    let hoveredQuickBoxSlotId: string | null = null;

    // Touch pinch state
    let pinchLastDist = 0;
    let pinchLastMid = { x: 0, y: 0 };

    const hitTestQuickBoxBubble = (localX: number, localY: number): string | null => {
      if (
        !propsRef.current.quickBoxPlacementMode ||
        propsRef.current.interactionBlocked ||
        propsRef.current.overviewMode
      ) {
        return null;
      }
      const occupiedIds = new Set(
        (propsRef.current.economyStateRef?.current?.quickBoxes ?? []).map((qb) => qb.slotId)
      );
      const cam = cameraRef.current;
      const vp = viewportRef.current;
      const worldPt = screenToWorld(localX, localY, cam, vp, MAP_SIZE);
      const effZoom = getEffectiveZoom(cam.zoom, vp, MAP_SIZE);
      const invS = 1 / Math.sqrt(Math.max(0.2, effZoom));
      const s = Math.max(0.85, Math.min(2.2, invS * 1.15));
      const bubbleHitRadius = 21 * s;
      const plotHitRadius = 22 * s;

      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const slot of PARCEL_LOCKER_SLOTS) {
        if (occupiedIds.has(slot.id)) continue;
        const dBubble = Math.hypot(worldPt.x - slot.x, worldPt.y - (slot.y - 24 * s));
        const dPlot = Math.hypot(worldPt.x - slot.x, worldPt.y - slot.y);
        if (dBubble <= bubbleHitRadius && dBubble < bestDist) {
          bestDist = dBubble;
          bestId = slot.id;
        } else if (dPlot <= plotHitRadius && dPlot < bestDist) {
          bestDist = dPlot;
          bestId = slot.id;
        }
      }
      return bestId;
    };

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
      const pos = getLocalPos(e.clientX, e.clientY);
      pointerLastScreen = pos;
      pointerDownScreen = pos;
      pointerMovedDist = 0;
      isPanning = true;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (propsRef.current.interactionBlocked) {
        isPanning = false;
        hoveredQuickBoxSlotId = null;
        canvas.style.cursor = '';
        return;
      }
      const pos = getLocalPos(e.clientX, e.clientY);
      if (!isPanning) {
        if (propsRef.current.quickBoxPlacementMode) {
          hoveredQuickBoxSlotId = hitTestQuickBoxBubble(pos.x, pos.y);
          canvas.style.cursor = hoveredQuickBoxSlotId ? 'pointer' : '';
        } else if (hoveredQuickBoxSlotId !== null) {
          hoveredQuickBoxSlotId = null;
          canvas.style.cursor = '';
        }
        return;
      }
      const dx = pos.x - pointerLastScreen.x;
      const dy = pos.y - pointerLastScreen.y;
      pointerMovedDist += Math.hypot(dx, dy);
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

    const onMouseUp = (e: MouseEvent) => {
      if (
        isPanning &&
        pointerDownScreen &&
        pointerMovedDist < 10 &&
        propsRef.current.quickBoxPlacementMode &&
        !propsRef.current.interactionBlocked
      ) {
        const pos = getLocalPos(e.clientX, e.clientY);
        const hitSlotId = hitTestQuickBoxBubble(pos.x, pos.y);
        if (hitSlotId) {
          propsRef.current.onSelectQuickBoxSlot?.(hitSlotId);
        }
      }
      isPanning = false;
      pointerDownScreen = null;
    };

    const onMouseLeave = () => {
      isPanning = false;
      pointerDownScreen = null;
      hoveredQuickBoxSlotId = null;
      canvas.style.cursor = '';
    };

    const onWheel = (e: WheelEvent) => {
      if (propsRef.current.interactionBlocked || propsRef.current.overviewMode) return;
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
      if (propsRef.current.interactionBlocked || propsRef.current.overviewMode) {
        isPanning = false;
        return;
      }
      e.preventDefault();
      cameraVelocityRef.current = { vx: 0, vy: 0 };
      const touches = syncTouches(e.touches);

      if (touches.length === 1) {
        pointerLastScreen = { x: touches[0].x, y: touches[0].y };
        pointerDownScreen = { x: touches[0].x, y: touches[0].y };
        pointerMovedDist = 0;
        isPanning = true;
      } else if (touches.length >= 2) {
        isPanning = false;
        pointerDownScreen = null;
        const [t0, t1] = touches;
        pinchLastDist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        pinchLastMid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (propsRef.current.interactionBlocked || propsRef.current.overviewMode) {
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
        pointerMovedDist += Math.hypot(dx, dy);
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
        if (
          pointerDownScreen &&
          pointerMovedDist < 12 &&
          propsRef.current.quickBoxPlacementMode &&
          !propsRef.current.interactionBlocked
        ) {
          const hitSlotId = hitTestQuickBoxBubble(pointerDownScreen.x, pointerDownScreen.y);
          if (hitSlotId) {
            propsRef.current.onSelectQuickBoxSlot?.(hitSlotId);
          }
        }
        isPanning = false;
        pointerDownScreen = null;
      } else if (remaining.length === 1) {
        pointerLastScreen = { x: remaining[0].x, y: remaining[0].y };
        pointerDownScreen = null;
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
    let lastWearFlushMs = lastFrameTick;

    const flushPendingVehicleWear = (nowMs: number, force = false) => {
      const pendingMap = pendingWearByKeyRef.current;
      if (pendingMap.size === 0) return;
      if (!force && nowMs - lastWearFlushMs < 1800) return;
      const batch = Array.from(pendingMap.values());
      pendingMap.clear();
      lastWearFlushMs = nowMs;
      propsRef.current.onApplyVehicleWearBatch?.(batch);
    };

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

      // Active QuickBox parcel lockers capture 50% of residential deliveries inside their zone
      const activeQuickBoxByZone = new Map<number, ParcelLockerSlot>();
      for (const qb of ecoState.quickBoxes ?? []) {
        if (qb.status !== 'active') continue;
        const slot = getQuickBoxSlotById(qb.slotId);
        if (slot && slot.roadApproachPoint && slot.deliveryStopPoint) {
          activeQuickBoxByZone.set(slot.zoneIndex, slot);
        }
      }
      const zoneSeenPackages = new Map<number, number>();
      const quickBoxTargetCache = new Map<string, Building>();

      for (const batch of batches) {
        const senderBuildingId = senderLookup.get(batch.orderId) ?? null;
        for (let p = 0; p < batch.count; p++) {
          const recipient = pickRandomRecipientBuildingForPackage(curBuildings, senderBuildingId);
          if (!recipient) continue;

          let finalRecipient = recipient;
          if (activeQuickBoxByZone.size > 0) {
            const zoneIdx = getQuickBoxZoneForBuilding(recipient.id);
            if (zoneIdx !== null) {
              const activeSlot = activeQuickBoxByZone.get(zoneIdx);
              if (activeSlot) {
                const seen = (zoneSeenPackages.get(zoneIdx) ?? 0) + 1;
                zoneSeenPackages.set(zoneIdx, seen);
                if (seen % 2 === 1) {
                  let qbTarget = quickBoxTargetCache.get(activeSlot.id);
                  if (!qbTarget) {
                    qbTarget = createQuickBoxTargetBuilding(activeSlot);
                    quickBoxTargetCache.set(activeSlot.id, qbTarget);
                  }
                  finalRecipient = qbTarget;
                }
              }
            }
          }

          let entry = stopByBuildingId.get(finalRecipient.id);
          if (!entry) {
            entry = { building: finalRecipient, items: [] };
            stopByBuildingId.set(finalRecipient.id, entry);
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

    const tryDispatchRefuelForSlot = (
      slotIndex: number,
      startFrom: CourierStartPoint,
      dispatchVehicle: ActiveVehicleSelection,
      originPoint?: Point
    ): boolean => {
      if (dispatchVehicle.type === 'bike') return false;
      const {
        graph: curGraph,
        buildings: curBuildings,
        baseDepot: curBaseDepot,
        parkingNavNetworks: curParkingNav,
        economyStateRef: ecoRef,
      } = propsRef.current;

      const ecoState = ecoRef?.current;
      if (!ecoState) return false;
      if (isVehicleCurrentlyInRoute(couriersFleetRef.current, dispatchVehicle, slotIndex)) {
        return false;
      }

      const quote = calculateVehicleRefuelCost(ecoState, dispatchVehicle);
      if (quote.litersNeeded <= 0.001 || ecoState.balance < quote.cost) {
        return false;
      }

      const origin = originPoint ?? {
        x: curBaseDepot.loadingZone.stopX,
        y: curBaseDepot.loadingZone.stopY,
      };
      const gasStation = selectNearestGasStationBuilding(curBuildings, origin);
      if (!gasStation) return false;

      const durabilityMult = getVehicleDurabilitySpeedMultiplier(
        getVehicleDurability(ecoState, dispatchVehicle)
      );
      const fuelMult = getVehicleFuelSpeedMultiplier(ecoState, dispatchVehicle);
      const scooterModelId =
        dispatchVehicle.type === 'scooter'
          ? getOwnedScooterByIndex(ecoState, dispatchVehicle.index)?.modelId
          : undefined;
      const vehicleSpeed =
        getCourierSpeedForSelection(ecoState, dispatchVehicle) * durabilityMult * fuelMult;
      const vehicleCapacity = getCourierCapacityForSelection(ecoState, dispatchVehicle);

      const refuelMission = createRefuelMissionCourier(
        curGraph,
        curBaseDepot,
        gasStation,
        dispatchVehicle,
        startFrom,
        vehicleSpeed,
        curParkingNav,
        slotIndex,
        vehicleCapacity,
        scooterModelId
      );
      if (refuelMission.active) {
        pendingRefuelKeysRef.current.delete(`${dispatchVehicle.type}:${dispatchVehicle.index}`);
        couriersFleetRef.current[slotIndex] = {
          slotIndex,
          inRoute: true,
          assignedTaskId: null,
          courier: refuelMission,
          activeRoute: refuelMission.path,
          targetMarker: refuelMission.stops[0]?.stopPoint ?? null,
        };
        return true;
      }
      return false;
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

      const durabilityMult = getVehicleDurabilitySpeedMultiplier(
        getVehicleDurability(ecoState, dispatchVehicle)
      );
      const fuelMult = getVehicleFuelSpeedMultiplier(ecoState, dispatchVehicle);
      const scooterSpec =
        dispatchVehicle.type === 'scooter'
          ? getOwnedScooterByIndex(ecoState, dispatchVehicle.index)
          : undefined;
      const scooterModelId = scooterSpec?.modelId;
      const vehicleSpeed =
        getCourierSpeedForSelection(ecoState, dispatchVehicle) * durabilityMult * fuelMult;
      const vehicleCapacity = getCourierCapacityForSelection(ecoState, dispatchVehicle);
      const claimedTaskCounts = getClaimedTaskCountsForFleet(couriersFleetRef.current, slotIndex);
      const inFlightPickupCountsByOrder = getInFlightPickupCountsByOrderForFleet(
        couriersFleetRef.current,
        slotIndex
      );
      const reservedWarehouseSpace = getReservedWarehouseSpaceForFleet(
        couriersFleetRef.current,
        slotIndex
      );

      // Strictly scan today's Plan tygodnia from top (#1, #2, ...), allowing up to 2 couriers
      // per order when unreserved pickup or free warehouse packages remain
      const selectedTask = selectNextCourierTaskForDay(
        ecoState,
        currentGameMinutes,
        dispatchVehicle.type,
        {
          claimedTaskCounts,
          inFlightPickupCountsByOrder,
          reservedWarehouseSpace,
          vehicleCapacity,
          vehicle: dispatchVehicle,
        }
      );
      if (!selectedTask) return false;

      if (selectedTask.kind === 'repair') {
        const mechanicBuilding = curBuildings.find((b) => b.id === 'b_mechanic_garage');
        if (!mechanicBuilding) return false;
        const repairTaskId = selectedTask.task.taskId;
        const repairMission = createRepairMissionCourier(
          curGraph,
          curBaseDepot,
          mechanicBuilding,
          dispatchVehicle,
          repairTaskId,
          startFrom,
          vehicleSpeed,
          curParkingNav,
          slotIndex,
          vehicleCapacity,
          scooterModelId
        );
        if (repairMission.active) {
          if (scooterModelId) repairMission.scooterModelId = scooterModelId;
          couriersFleetRef.current[slotIndex] = {
            slotIndex,
            inRoute: true,
            assignedTaskId: repairTaskId,
            courier: repairMission,
            activeRoute: repairMission.path,
            targetMarker: repairMission.stops[0]?.stopPoint ?? null,
          };
          return true;
        }
        return false;
      }

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
          if (scooterModelId) mission.scooterModelId = scooterModelId;
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
        if (scooterModelId) pickupMission.scooterModelId = scooterModelId;
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

    const reusableArrowInput: ArrowInputVector = { x: 0, y: 0 };
    const reusableViewBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let cachedIdleDepot: BaseDepotSpec | null = null;
    let cachedIdleBikesCount = -1;
    let cachedIdleOwnedScooters: ReturnType<typeof getOwnedScooters> | undefined = undefined;
    let cachedIdleVansCount = -1;
    let cachedIdleOwnedVans: ReturnType<typeof getOwnedVans> | undefined = undefined;
    let cachedIdleParkedBikes: number[] = [];
    let cachedIdleParkedScooters: ParkedScooterRenderEntry[] = [];
    let cachedIdleDepthEntities: DepthSortedEntity[] = [];

    const drawScene = (now: number) => {
      const currentMaxFps = propsRef.current.maxFps;
      if (currentMaxFps !== 'unlimited') {
        const frameInterval = 1000 / currentMaxFps;
        if (hasRenderedFirstFrame && now - lastRenderTime < frameInterval - 1.2) {
          rafId = requestAnimationFrame(drawScene);
          return;
        }
        if (!hasRenderedFirstFrame || now - lastRenderTime > frameInterval * 2) {
          lastRenderTime = now;
        } else {
          lastRenderTime += frameInterval;
        }
      } else {
        lastRenderTime = now;
      }

      // Compute true elapsed delta time between rendered frames (clamped to <= 0.05s)
      const rawDt = hasRenderedFirstFrame
        ? Math.min(Math.max(0, (now - lastFrameTick) / 1000), MAX_REAL_FRAME_DT)
        : 0;
      lastFrameTick = now;
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
          const rawMeasuredFps = Math.round((fpsFrames * 1000) / fpsElapsed);
          const measuredFps =
            currentMaxFps === 'unlimited'
              ? rawMeasuredFps
              : Math.min(rawMeasuredFps, currentMaxFps);
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
      reusableArrowInput.x = 0;
      reusableArrowInput.y = 0;
      if (!propsRef.current.interactionBlocked && !isOverviewOrIntro && activeArrowKeys.size > 0) {
        if (activeArrowKeys.has('ArrowLeft')) reusableArrowInput.x -= 1;
        if (activeArrowKeys.has('ArrowRight')) reusableArrowInput.x += 1;
        if (activeArrowKeys.has('ArrowUp')) reusableArrowInput.y -= 1;
        if (activeArrowKeys.has('ArrowDown')) reusableArrowInput.y += 1;
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
          fogProgress = 1;
          if (propsRef.current.overviewMode) {
            cameraIntroRef.current = null;
          }
        } else if (activeIntro.phase === 'armed') {
          renderCamX = activeIntro.fromX;
          renderCamY = activeIntro.fromY;
          renderEffectiveZoom = activeIntro.fromEffectiveZoom;
          renderCacheZoomKey = activeIntro.fromEffectiveZoom;
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
            fogProgress = eased;

            if (rawT >= 1) {
              cameraVelocityRef.current = { vx: 0, vy: 0 };
              activeIntro.phase = 'settled_out';
              renderCamX = panCam.x;
              renderCamY = panCam.y;
              renderEffectiveZoom = panCam.effectiveZoom;
              renderCacheZoomKey = panCam.effectiveZoom;
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
        fogProgress = 1;
      } else {
        const camCur = cameraRef.current;
        const camTgt = targetCameraRef.current;
        const camVel = cameraVelocityRef.current;
        const isCameraStationary =
          reusableArrowInput.x === 0 &&
          reusableArrowInput.y === 0 &&
          camVel.vx === 0 &&
          camVel.vy === 0 &&
          camCur.x === camTgt.x &&
          camCur.y === camTgt.y &&
          camCur.zoom === camTgt.zoom;

        if (!isCameraStationary) {
          // Frame-rate-independent exponential camera physics + smooth arrow-key velocity + hard snap
          const camStep = stepCameraPhysics(
            camCur,
            camTgt,
            camVel,
            reusableArrowInput,
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

      // Mid-route vehicle change: if the player assigned a different vehicle in Company -> Employees,
      // recall the courier immediately back to Base with their cargo so they swap vehicles and resume delivery
      if (!isNightNow) {
        const ecoForSwap = propsRef.current.economyStateRef?.current;
        if (ecoForSwap) {
          for (const slotIndex of COURIER_SLOT_INDICES) {
            const entry = fleet[slotIndex];
            if (!entry || !entry.courier.active || entry.courier.isForcedReturn) continue;
            if (entry.courier.missionKind === 'repair' || entry.courier.missionKind === 'refuel') continue;
            const rosterMatch = ecoForSwap.couriers.find((c) => c.slotIndex === slotIndex);
            const desiredVeh = rosterMatch?.assignedVehicle ?? null;
            const vehicleChanged =
              !desiredVeh ||
              desiredVeh.type !== entry.courier.vehicleType ||
              desiredVeh.index !== entry.courier.vehicleIndex;
            if (vehicleChanged) {
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
      }

      // Step every active courier (#1–#6) independently at 60 FPS
      let shouldFlushWearNow = false;
      if (simDt > 0) {
        const ecoBeforeStep = propsRef.current.economyStateRef?.current;
        for (const slotIndex of COURIER_SLOT_INDICES) {
          const entry = fleet[slotIndex];
          if (!entry || !entry.courier.active) continue;

          // Keep in-flight courier vehicle index synced if an earlier sibling vehicle was sold
          const rosterMatch = ecoBeforeStep?.couriers?.find((c) => c.slotIndex === slotIndex);
          if (
            rosterMatch?.assignedVehicle &&
            rosterMatch.assignedVehicle.type === entry.courier.vehicleType &&
            rosterMatch.assignedVehicle.index !== entry.courier.vehicleIndex
          ) {
            entry.courier = {
              ...entry.courier,
              vehicleIndex: rosterMatch.assignedVehicle.index,
            };
          }

          const activeMissionVehicle: ActiveVehicleSelection = {
            type: entry.courier.vehicleType,
            index: entry.courier.vehicleIndex,
          };
          const activeMissionCapacity = entry.courier.cargoCapacity;

          // Keep speed responsive if durability drops below 25% mid-route (restored vehicles return at full speed)
          const isReturningFromRepair =
            entry.courier.missionKind === 'repair' && entry.courier.phase === 'returning';
          const expectedBaseSpeed = ecoBeforeStep
            ? getCourierSpeedForSelection(ecoBeforeStep, activeMissionVehicle)
            : getCourierSpeedForVehicle(activeMissionVehicle.type, entry.courier.scooterModelId);
          const fuelSpeedMult = ecoBeforeStep
            ? getVehicleFuelSpeedMultiplier(ecoBeforeStep, activeMissionVehicle)
            : 1;
          const expectedSpeed =
            isReturningFromRepair || !ecoBeforeStep
              ? expectedBaseSpeed * fuelSpeedMult
              : expectedBaseSpeed *
                getVehicleDurabilitySpeedMultiplier(
                  getVehicleDurability(ecoBeforeStep, activeMissionVehicle)
                ) *
                fuelSpeedMult;
          if (Math.abs(entry.courier.speed - expectedSpeed) > 0.01) {
            entry.courier = {
              ...entry.courier,
              speed: expectedSpeed,
            };
          }

          const stepRes = stepCourierMissionWithSimDt(entry.courier, simDt);
          entry.courier = stepRes.state;
          entry.inRoute = stepRes.state.active;

          if (stepRes.distanceMoved > 0 && !isReturningFromRepair) {
            const wearKey = `${activeMissionVehicle.type}:${activeMissionVehicle.index}`;
            const existingWear = pendingWearByKeyRef.current.get(wearKey);
            if (existingWear) {
              existingWear.distancePx += stepRes.distanceMoved;
            } else {
              pendingWearByKeyRef.current.set(wearKey, {
                vehicle: activeMissionVehicle,
                distancePx: stepRes.distanceMoved,
              });
            }
          }

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

                // Keep the courier strictly bound to this order's assignedTaskId until the courier
                // finishes delivering or unloads at Base (prevents abandoning or task hijacking).
                if (!entry.assignedTaskId) {
                  entry.assignedTaskId = ev.orderId;
                  entry.courier = {
                    ...entry.courier,
                    assignedTaskId: ev.orderId,
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
                      claimedTaskCounts: getClaimedTaskCountsForFleet(fleet, slotIndex),
                      inFlightPickupCountsByOrder: getInFlightPickupCountsByOrderForFleet(
                        fleet,
                        slotIndex
                      ),
                      reservedWarehouseSpace: getReservedWarehouseSpaceForFleet(fleet, slotIndex),
                      vehicleCapacity: activeMissionCapacity,
                      vehicle: activeMissionVehicle,
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
                      const directSpeed =
                        getCourierSpeedForSelection(latestEco, activeMissionVehicle) *
                        getVehicleDurabilitySpeedMultiplier(
                          getVehicleDurability(latestEco, activeMissionVehicle)
                        ) *
                        getVehicleFuelSpeedMultiplier(latestEco, activeMissionVehicle);
                      const directMission = createDirectDeliveryMissionFromBuilding(
                        propsRef.current.graph,
                        propsRef.current.baseDepot,
                        senderBuilding,
                        directStops,
                        carriedBatches,
                        directSpeed,
                        activeMissionVehicle,
                        propsRef.current.parkingNavNetworks,
                        slotIndex,
                        directTaskId,
                        activeMissionCapacity
                      );
                      if (directMission.active) {
                        entry.courier = {
                          ...directMission,
                          scooterModelId: entry.courier.scooterModelId,
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
            } else if (ev.type === 'repair_completed') {
              pendingWearByKeyRef.current.delete(`${ev.vehicle.type}:${ev.vehicle.index}`);
              propsRef.current.onCompleteVehicleRepair?.(ev.vehicle);
              entry.assignedTaskId = null;
              entry.courier = {
                ...entry.courier,
                assignedTaskId: null,
                speed: getCourierSpeedForVehicle(ev.vehicle.type, entry.courier.scooterModelId),
              };
            } else if (ev.type === 'refuel_completed') {
              pendingRefuelKeysRef.current.delete(`${ev.vehicle.type}:${ev.vehicle.index}`);
              propsRef.current.onCompleteVehicleRefuel?.(ev.vehicle);
              entry.assignedTaskId = null;
              entry.courier = {
                ...entry.courier,
                assignedTaskId: null,
                speed: getCourierSpeedForVehicle(ev.vehicle.type, entry.courier.scooterModelId),
              };
            } else if (ev.type === 'base_unloaded') {
              if (ev.cargo.length > 0) {
                propsRef.current.onReturnCargoToWarehouse?.(ev.cargo);
              }
            } else if (ev.type === 'arrived_at_loading_zone') {
              shouldFlushWearNow = true;
              // Release current task claim before scanning Plan tygodnia from the top
              entry.assignedTaskId = null;
              entry.courier = {
                ...entry.courier,
                assignedTaskId: null,
              };

              const vehKey = `${activeMissionVehicle.type}:${activeMissionVehicle.index}`;
              const latestEcoAtBay = propsRef.current.economyStateRef?.current;
              const rosterAtBay = latestEcoAtBay?.couriers.find((c) => c.slotIndex === slotIndex);
              const desiredVehAtBay = rosterAtBay?.assignedVehicle ?? null;
              const swappedVehicleAtBase =
                !desiredVehAtBay ||
                desiredVehAtBay.type !== activeMissionVehicle.type ||
                desiredVehAtBay.index !== activeMissionVehicle.index;
              const manualRefuelQueued = pendingRefuelKeysRef.current.has(vehKey);
              const autoLowFuelNeeded =
                activeMissionVehicle.type !== 'bike' &&
                latestEcoAtBay !== undefined &&
                calculateVehicleRefuelCost(latestEcoAtBay, activeMissionVehicle).fillRatio <
                  AUTO_REFUEL_THRESHOLD_RATIO;

              let chained = false;
              if (
                !swappedVehicleAtBase &&
                !isNightNow &&
                !ev.wasForcedReturn &&
                (manualRefuelQueued || autoLowFuelNeeded)
              ) {
                chained = tryDispatchRefuelForSlot(
                  slotIndex,
                  'loading_zone',
                  activeMissionVehicle,
                  { x: entry.courier.x, y: entry.courier.y }
                );
              }

              // If workday is still open and another free task is ready, chain immediately from the loading bay
              // keeping the exact same vehicle currently parked in the loading bay (unless swapping vehicles)
              if (!swappedVehicleAtBase && !chained && !isNightNow && !ev.wasForcedReturn) {
                chained = tryDispatchCourierForSlot(
                  slotIndex,
                  currentGameMinutes,
                  'loading_zone',
                  activeMissionVehicle
                );
              }

              if (swappedVehicleAtBase) {
                // Vehicle was swapped mid-route -> park old vehicle instantly at Base so the idle dispatch loop
                // immediately dispatches the courier in their newly assigned vehicle with the returned cargo!
                const nextVeh = desiredVehAtBay ?? propsRef.current.activeVehicle;
                const nextCap = latestEcoAtBay
                  ? getCourierCapacityForSelection(latestEcoAtBay, nextVeh)
                  : activeMissionCapacity;
                entry.courier = createIdleCourier(nextVeh, slotIndex, nextCap);
                entry.inRoute = false;
                entry.activeRoute = [];
                entry.targetMarker = null;
                chained = true;
              }

              if (!chained) {
                // All free tasks done or workday ended -> park vehicle at Base bike rack or assigned stall P1–P8
                const latestEcoForPark = propsRef.current.economyStateRef?.current;
                const parkSpeed =
                  (latestEcoForPark
                    ? getCourierSpeedForSelection(latestEcoForPark, activeMissionVehicle)
                    : getCourierSpeedForVehicle(
                        activeMissionVehicle.type,
                        entry.courier.scooterModelId
                      )) *
                  (latestEcoForPark
                    ? getVehicleDurabilitySpeedMultiplier(
                        getVehicleDurability(latestEcoForPark, activeMissionVehicle)
                      ) * getVehicleFuelSpeedMultiplier(latestEcoForPark, activeMissionVehicle)
                    : 1);
                const parkMission = createParkAtRackCourier(
                  propsRef.current.baseDepot,
                  undefined,
                  ev.wasForcedReturn || isNightNow,
                  parkSpeed,
                  activeMissionVehicle,
                  propsRef.current.parkingNavNetworks,
                  propsRef.current.graph,
                  slotIndex,
                  activeMissionCapacity
                );
                if (parkMission.active) {
                  parkMission.scooterModelId = entry.courier.scooterModelId;
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
              shouldFlushWearNow = true;
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
        flushPendingVehicleWear(now, shouldFlushWearNow);
      }

      // During seasonal workday hours, automatically dispatch ALL idle hired couriers (#1–#6)
      // who have an assigned vehicle in „Pracownicy”
      if (simDt > 0 && !isNightNow) {
        const ecoState = propsRef.current.economyStateRef?.current;
        const roster = ecoState?.couriers;
        if (roster && roster.length > 0) {
          const currentGameDay = getGameClockDisplay(currentGameMinutes).gameDay;
          for (const rosterCourier of roster) {
            if (
              !rosterCourier.unlocked ||
              !rosterCourier.hired ||
              !rosterCourier.assignedVehicle ||
              (typeof rosterCourier.trainingEndGameDay === 'number' &&
                currentGameDay < rosterCourier.trainingEndGameDay)
            ) {
              continue;
            }
            const slotEntry = fleet[rosterCourier.slotIndex];
            if (!slotEntry || slotEntry.inRoute || slotEntry.courier.active) {
              continue;
            }
            const assignedVeh = rosterCourier.assignedVehicle;
            if (assignedVeh.type !== 'bike') {
              const vehKey = `${assignedVeh.type}:${assignedVeh.index}`;
              const needsManualRefuel = pendingRefuelKeysRef.current.has(vehKey);
              const needsAutoRefuel =
                ecoState !== undefined &&
                calculateVehicleRefuelCost(ecoState, assignedVeh).fillRatio <
                  AUTO_REFUEL_THRESHOLD_RATIO;
              if (needsManualRefuel || needsAutoRefuel) {
                if (tryDispatchRefuelForSlot(rosterCourier.slotIndex, 'rack', assignedVeh)) {
                  continue;
                }
              }
            }
            tryDispatchCourierForSlot(
              rosterCourier.slotIndex,
              currentGameMinutes,
              'rack',
              assignedVeh
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
      ctx.imageSmoothingQuality = 'low';

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
      reusableViewBounds.minX = renderCamX - halfViewW;
      reusableViewBounds.maxX = renderCamX + halfViewW;
      reusableViewBounds.minY = renderCamY - halfViewH;
      reusableViewBounds.maxY = renderCamY + halfViewH;
      const viewBounds = reusableViewBounds;

      const curBikesCount = propsRef.current.bikesCount;
      const curVansCount = propsRef.current.vansCount;
      const rack = curBaseDepot.bikeRack;
      const currentEco = propsRef.current.economyStateRef?.current;
      const ownedScootersList = currentEco ? getOwnedScooters(currentEco) : undefined;
      const ownedVansList = currentEco ? getOwnedVans(currentEco) : undefined;

      let anyCourierInRoute = false;
      for (const slotIndex of COURIER_SLOT_INDICES) {
        const entry = fleet[slotIndex];
        if (entry && entry.inRoute && entry.courier.phase !== 'idle') {
          anyCourierInRoute = true;
          break;
        }
      }

      const clampedBikes = Math.max(0, Math.min(4, Math.floor(curBikesCount)));
      let parkedBikeIndices: number[];
      let parkedScooters: ParkedScooterRenderEntry[];
      let activeOutVanIndices: Set<number> | null = null;

      if (!anyCourierInRoute) {
        if (
          cachedIdleDepot !== curBaseDepot ||
          cachedIdleBikesCount !== clampedBikes ||
          cachedIdleOwnedScooters !== ownedScootersList ||
          cachedIdleVansCount !== curVansCount ||
          cachedIdleOwnedVans !== ownedVansList
        ) {
          cachedIdleDepot = curBaseDepot;
          cachedIdleBikesCount = clampedBikes;
          cachedIdleOwnedScooters = ownedScootersList;
          cachedIdleVansCount = curVansCount;
          cachedIdleOwnedVans = ownedVansList;
          const bikes: number[] = [];
          for (let i = 1; i <= clampedBikes; i++) {
            bikes.push(i);
          }
          const scooters: ParkedScooterRenderEntry[] = (ownedScootersList ?? []).map((s) => ({
            index: s.index,
            modelId: s.modelId,
          }));
          cachedIdleParkedBikes = bikes;
          cachedIdleParkedScooters = scooters;
          const idleBikeRackEntity: DepthSortedEntity = {
            id: rack.id,
            uMin: rack.uMin,
            uMax: rack.uMax,
            vMin: rack.vMin,
            vMax: rack.vMax,
            draw: (drawCtx) => drawBikeRackWithOptionalBike(drawCtx, rack, bikes, scooters),
          };
          const idleParkedVans = createBaseParkedVanEntities(
            curBaseDepot,
            curVansCount,
            null,
            ownedVansList
          );
          cachedIdleDepthEntities = [idleBikeRackEntity, ...idleParkedVans];
        }
        parkedBikeIndices = cachedIdleParkedBikes;
        parkedScooters = cachedIdleParkedScooters;
      } else {
        const activeOut = getActiveOutVehiclesForFleet(fleet);
        activeOutVanIndices = activeOut.vanIndices;
        parkedBikeIndices = [];
        for (let i = 1; i <= clampedBikes; i++) {
          if (!activeOut.bikeIndices.has(i)) {
            parkedBikeIndices.push(i);
          }
        }
        parkedScooters = (ownedScootersList ?? [])
          .filter((s) => !activeOut.scooterIndices.has(s.index))
          .map((s) => ({ index: s.index, modelId: s.modelId }));
      }

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
        } else if (c.vehicleType === 'scooter') {
          const ownedScooter = currentEco
            ? getOwnedScooterByIndex(currentEco, c.vehicleIndex)
            : undefined;
          drawIsometricScooter(drawCtx, {
            x: c.x,
            y: c.y,
            angle: c.angle,
            withRider: c.riderMounted,
            wheelPhase: c.wheelPhase,
            modelId: c.scooterModelId ?? ownedScooter?.modelId ?? 'scooter_city',
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

      const ownedQuickBoxes = currentEco?.quickBoxes ?? [];
      const ownedQuickBoxBySlotId = new Map(ownedQuickBoxes.map((qb) => [qb.slotId, qb]));
      const quickBoxDepthEntities: DepthSortedEntity[] = [];
      for (const qb of ownedQuickBoxes) {
        const slot = getQuickBoxSlotById(qb.slotId);
        if (!slot) continue;
        quickBoxDepthEntities.push({
          id: `quickbox_${slot.id}`,
          uMin: slot.lockerRect.uMin,
          uMax: slot.lockerRect.uMax,
          vMin: slot.lockerRect.vMin,
          vMax: slot.lockerRect.vMax,
          draw: (drawCtx) =>
            qb.status === 'active'
              ? drawQuickBoxActiveLocker(drawCtx, slot)
              : drawQuickBoxConstructionSite(drawCtx, slot),
        });
      }

      if (isFootprintOnly) {
        // 2D Footprints Mode: footprints & optional road grid are already baked into the static ground buffer
        drawBaseLoadingZone(ctx, curBaseDepot.loadingZone);
        for (const qb of ownedQuickBoxes) {
          if (qb.status !== 'active') continue;
          const slot = getQuickBoxSlotById(qb.slotId);
          if (slot) drawQuickBoxCourierBay(ctx, slot);
        }
        drawDynamicRouteAndPin();
        if (curBaseNode) {
          drawBaseMarker(curBaseNode);
        }
        for (const qbEntity of quickBoxDepthEntities) {
          qbEntity.draw(ctx);
        }
        drawBikeRackWithOptionalBike(ctx, rack, parkedBikeIndices, parkedScooters);
        const parkedVanSlots = getBaseParkedVanSlots(
          curBaseDepot.parking,
          curVansCount,
          null
        ).filter((slot) => !activeOutVanIndices || !activeOutVanIndices.has(slot.vanIndex));
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
          renderStreetNames(ctx, effectiveZoom, viewBounds, propsRef.current.language ?? 'pl');
        }
      } else {
        // Normal 3D Mode: Base loading zone & active routes on ground, then Z-sorted 3D building sprites interleaved with
        // fences, BAZA bike rack, parked fleet vans on P1–P8, and ALL active courier vehicles so tall blocks naturally occlude them
        let depthEntities: DepthSortedEntity[];
        if (!anyCourierInRoute) {
          depthEntities =
            quickBoxDepthEntities.length > 0
              ? [...cachedIdleDepthEntities, ...quickBoxDepthEntities]
              : cachedIdleDepthEntities;
        } else {
          const bikeRackEntity: DepthSortedEntity = {
            id: rack.id,
            uMin: rack.uMin,
            uMax: rack.uMax,
            vMin: rack.vMin,
            vMax: rack.vMax,
            draw: (drawCtx) =>
              drawBikeRackWithOptionalBike(drawCtx, rack, parkedBikeIndices, parkedScooters),
          };

          const parkedVanEntities = createBaseParkedVanEntities(
            curBaseDepot,
            curVansCount,
            null,
            ownedVansList
          ).filter((entity) => {
            const vanIdx = Number(entity.id.replace('base_parked_van_', ''));
            return !activeOutVanIndices || !activeOutVanIndices.has(vanIdx);
          });
          depthEntities = [bikeRackEntity, ...parkedVanEntities, ...quickBoxDepthEntities];

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
        }

        drawBaseLoadingZone(ctx, curBaseDepot.loadingZone);
        for (const qb of ownedQuickBoxes) {
          if (qb.status !== 'active') continue;
          const slot = getQuickBoxSlotById(qb.slotId);
          if (slot) drawQuickBoxCourierBay(ctx, slot);
        }
        if (streetNamesVisible && !propsRef.current.overviewMode) {
          renderStreetNames(ctx, effectiveZoom, viewBounds, propsRef.current.language ?? 'pl');
        }
        if (anyCourierInRoute) {
          drawDynamicRouteAndPin();
        }
        renderBuildings3D(
          ctx,
          curBuildings,
          null,
          null,
          effectiveZoom,
          viewBounds,
          depthEntities,
          sceneSpriteAtlasRef.current?.buildings ?? null,
          sceneSpriteAtlasRef.current?.fences ?? null,
          sceneSpriteAtlasRef.current?.urbanProps ?? null
        );
        if (curBaseNode) {
          drawBaseMarker(curBaseNode);
        }
      }

      // Dynamic roadside gas-station price pylons (always visible in both 3D and 2D footprint modes)
      const liveFuelPrice =
        currentEco?.currentFuelPricePerLiter ?? BASE_FUEL_PRICE_PER_LITER;
      const prevFuelPrice =
        currentEco?.previousFuelPricePerLiter ?? liveFuelPrice;
      const canvasLang = propsRef.current.language ?? 'pl';
      for (const pylon of GAS_STATION_PRICE_PYLONS) {
        drawGasStationPricePylon(ctx, pylon, liveFuelPrice, prevFuelPrice, invScale, canvasLang);
      }

      // Clickable '+' bubbles over every free QuickBox plot while in placement mode
      if (propsRef.current.quickBoxPlacementMode && !propsRef.current.overviewMode) {
        for (const slot of PARCEL_LOCKER_SLOTS) {
          if (ownedQuickBoxBySlotId.has(slot.id)) continue;
          drawQuickBoxPlacementBubble(ctx, slot, invScale, hoveredQuickBoxSlotId === slot.id);
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

