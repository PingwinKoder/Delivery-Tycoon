import React, { useEffect, useRef } from 'react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data/initialRoadGraph';
import { type Building, formatBuildingAddress } from '../types/building';
import type { EditorTool, Point, RoadGraph } from '../types/roadGraph';
import { type DepthSortedEntity, hitTestBuilding } from '../utils/buildings';
import { BASE_DEPOT, canvasToIso } from '../utils/cityMap';
import {
  type ProceduralTextures,
  createProceduralTextures,
  renderBuildingFootprints,
  renderBuildings3D,
  renderProceduralCity,
  renderStreetNames,
} from '../utils/cityRenderer';
import {
  drawBikeRackWithOptionalBike,
  drawIsometricBicycle,
} from '../utils/courierRenderer';
import {
  type CameraState,
  DEFAULT_ZOOM,
  type Size,
  clampCamera,
  createInitialCamera,
  getEffectiveZoom,
  panCameraByScreenDelta,
  screenToWorld,
  zoomCameraAtScreenPoint,
} from '../utils/camera';
import {
  type CourierState,
  DEFAULT_COURIER_SPEED,
  DELIVERY_PAUSE_SECONDS,
  createCourierFromPath,
  createIdleCourier,
  stepCourier,
  stitchWaypoints,
} from '../utils/courierSim';
import { hitTestNode } from '../utils/graphEditor';
import {
  findShortestPathFromEdgePoint,
  findShortestPathFromRoadPoint,
  findShortestPathToEdgePoint,
  findShortestPathToRoadPoint,
} from '../utils/pathfinding';
import { ALL_PARKING_NAV_NETWORKS } from '../utils/parkingNavigation';
import { applyRightHandLaneOffsets } from '../utils/trafficLanes';

export interface MapCanvasController {
  zoomByDelta: (delta: number) => void;
  setZoom: (zoom: number) => void;
  centerOnBase: () => void;
  dispatchCourierToBuilding: (building: Building) => void;
}

interface MapCanvasProps {
  graph: RoadGraph;
  buildings: Building[];
  editMode: boolean;
  showGrid: boolean;
  footprintOnly: boolean;
  showStreetNames: boolean;
  selectedBuildingId: string | null;
  activeTool: EditorTool;
  connectSourceId: string | null;
  onZoomChange: (zoom: number) => void;
  onSelectBuilding: (building: Building | null) => void;
  onSelectConnectSource: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onAddNode: (x: number, y: number) => void;
  onToggleEdge: (aId: string, bId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onStatusMessage: (msg: string) => void;
  controllerRef: React.MutableRefObject<MapCanvasController | null>;
}

const DRAG_THRESHOLD_PX = 6;
const MAP_SIZE: Size = { width: MAP_WIDTH, height: MAP_HEIGHT };

export const MapCanvas: React.FC<MapCanvasProps> = ({
  graph,
  buildings,
  editMode,
  showGrid,
  footprintOnly,
  showStreetNames,
  selectedBuildingId,
  activeTool,
  connectSourceId,
  onZoomChange,
  onSelectBuilding,
  onSelectConnectSource,
  onMoveNode,
  onAddNode,
  onToggleEdge,
  onDeleteNode,
  onStatusMessage,
  controllerRef,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texturesRef = useRef<ProceduralTextures | null>(null);
  const bgCacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgCacheKeyRef = useRef<string>('');
  const scheduleRenderRef = useRef<() => void>(() => {});

  const viewportRef = useRef<Size>({ width: 1440, height: 900 });
  const cameraRef = useRef<CameraState>({ x: 820, y: 1460, zoom: DEFAULT_ZOOM });
  const initializedCameraRef = useRef<boolean>(false);

  const courierRef = useRef<CourierState>(createIdleCourier());
  const activeRouteRef = useRef<Point[]>([]);
  const targetMarkerRef = useRef<Point | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const hoveredBuildingIdRef = useRef<string | null>(null);
  const pointerWorldRef = useRef<Point | null>(null);

  // Sync latest React props into refs for rAF & event handlers
  const propsRef = useRef({
    graph,
    buildings,
    editMode,
    showGrid,
    footprintOnly,
    showStreetNames,
    selectedBuildingId,
    activeTool,
    connectSourceId,
    onZoomChange,
    onSelectBuilding,
    onSelectConnectSource,
    onMoveNode,
    onAddNode,
    onToggleEdge,
    onDeleteNode,
    onStatusMessage,
  });
  propsRef.current = {
    graph,
    buildings,
    editMode,
    showGrid,
    footprintOnly,
    showStreetNames,
    selectedBuildingId,
    activeTool,
    connectSourceId,
    onZoomChange,
    onSelectBuilding,
    onSelectConnectSource,
    onMoveNode,
    onAddNode,
    onToggleEdge,
    onDeleteNode,
    onStatusMessage,
  };

  // Trigger a redraw whenever React props change (graph, editMode, showGrid, buildings view, etc.)
  useEffect(() => {
    scheduleRenderRef.current();
  }, [
    graph,
    buildings,
    editMode,
    showGrid,
    footprintOnly,
    showStreetNames,
    selectedBuildingId,
    activeTool,
    connectSourceId,
  ]);

  // Expose camera & courier dispatch controls to parent UI (ZoomControls & BuildingInspector)
  useEffect(() => {
    controllerRef.current = {
      zoomByDelta: (delta: number) => {
        const vp = viewportRef.current;
        const targetZoom = Math.round((cameraRef.current.zoom + delta) * 100) / 100;
        const next = zoomCameraAtScreenPoint(
          cameraRef.current,
          targetZoom,
          vp.width / 2,
          vp.height / 2,
          vp,
          MAP_SIZE
        );
        cameraRef.current = next;
        propsRef.current.onZoomChange(next.zoom);
        scheduleRenderRef.current();
      },
      setZoom: (zoom: number) => {
        const vp = viewportRef.current;
        const next = zoomCameraAtScreenPoint(
          cameraRef.current,
          zoom,
          vp.width / 2,
          vp.height / 2,
          vp,
          MAP_SIZE
        );
        cameraRef.current = next;
        propsRef.current.onZoomChange(next.zoom);
        scheduleRenderRef.current();
      },
      centerOnBase: () => {
        const baseNode = propsRef.current.graph.nodes.find((n) => n.id === 'base');
        const focus = baseNode
          ? { x: baseNode.x + 10, y: baseNode.y - 70 }
          : { x: 820, y: 1460 };
        const next = createInitialCamera(viewportRef.current, MAP_SIZE, focus);
        cameraRef.current = next;
        propsRef.current.onZoomChange(next.zoom);
        scheduleRenderRef.current();
      },
      dispatchCourierToBuilding: (building: Building) => {
        const { graph: curGraph, onStatusMessage: notify } = propsRef.current;
        if (!building.roadApproachPoint || !building.deliveryStopPoint) {
          notify('Ten obiekt nie obsługuje dostaw kurierskich.');
          return;
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
          notify(`Brak przejezdnej trasy do ${address}.`);
          return;
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
        const rackExit = BASE_DEPOT.bikeRack.exitWaypoints;
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

        notify(
          `Kurier wyjechał prawym pasem pod ${address} · Dystans: ${Math.round(outboundRes.totalDistance)} px`
        );
        scheduleRenderRef.current();
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef]);

  // Main ResizeObserver, input listeners, and on-demand rAF render loop
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewportRef.current = { width, height };

      if (!initializedCameraRef.current) {
        const baseNode = propsRef.current.graph.nodes.find((n) => n.id === 'base');
        const focus = baseNode
          ? { x: baseNode.x + 10, y: baseNode.y - 70 }
          : { x: 820, y: 1460 };
        cameraRef.current = createInitialCamera(
          viewportRef.current,
          MAP_SIZE,
          focus
        );
        initializedCameraRef.current = true;
        propsRef.current.onZoomChange(cameraRef.current.zoom);
      } else {
        cameraRef.current = clampCamera(
          cameraRef.current,
          viewportRef.current,
          MAP_SIZE
        );
      }
      scheduleRenderRef.current();
    };

    // Interaction state
    let pointerMode: 'none' | 'pan' | 'drag-node' = 'none';
    let draggingNodeId: string | null = null;
    let pointerStartScreen = { x: 0, y: 0 };
    let pointerLastScreen = { x: 0, y: 0 };
    let hasMovedBeyondThreshold = false;

    // Touch pinch state
    let activeTouches: Array<{ id: number; x: number; y: number }> = [];
    let pinchLastDist = 0;
    let pinchLastMid = { x: 0, y: 0 };

    const getLocalPos = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const getHitRadiusWorld = () => {
      // Comfortable hit radius across zoom levels & responsive base scales (~20px screen space)
      const effectiveZoom = getEffectiveZoom(cameraRef.current.zoom, viewportRef.current, MAP_SIZE);
      return Math.max(12, 20 / effectiveZoom);
    };

    const handleCanvasClick = (screenX: number, screenY: number, shiftKey: boolean) => {
      const {
        graph: curGraph,
        editMode: isEdit,
        activeTool: tool,
        connectSourceId: sourceId,
        onSelectConnectSource: setSource,
        onAddNode: addNodeCb,
        onToggleEdge: toggleEdgeCb,
        onDeleteNode: deleteNodeCb,
        onStatusMessage: notify,
      } = propsRef.current;

      const worldPt = screenToWorld(screenX, screenY, cameraRef.current, viewportRef.current);

      if (isEdit) {
        if (shiftKey || tool === 'add') {
          addNodeCb(worldPt.x, worldPt.y);
          notify(`Dodano węzeł (${Math.round(worldPt.x)}, ${Math.round(worldPt.y)})`);
          scheduleRenderRef.current();
          return;
        }

        const hit = hitTestNode(curGraph, worldPt.x, worldPt.y, getHitRadiusWorld());
        if (tool === 'connect') {
          if (!hit) {
            if (sourceId) {
              setSource(null);
              notify('Anulowano wybór węzła');
            }
            return;
          }
          if (!sourceId) {
            setSource(hit.id);
            notify(`Wybrano ${hit.label ?? hit.id} — kliknij drugi węzeł, aby połączyć/rozłączyć`);
          } else if (sourceId === hit.id) {
            setSource(null);
          } else {
            toggleEdgeCb(sourceId, hit.id);
            setSource(null);
          }
          scheduleRenderRef.current();
          return;
        }

        if (tool === 'delete') {
          if (hit) {
            deleteNodeCb(hit.id);
          }
          scheduleRenderRef.current();
          return;
        }
        return;
      }

      // Traffic test & Building inspection mode (Edit Mode OFF)
      const hitBldg = hitTestBuilding(
        propsRef.current.buildings,
        worldPt,
        propsRef.current.footprintOnly
      );
      if (hitBldg) {
        propsRef.current.onSelectBuilding(hitBldg);
        scheduleRenderRef.current();
        return;
      }

      const effectiveZoom = getEffectiveZoom(cameraRef.current.zoom, viewportRef.current, MAP_SIZE);
      const snapRadius = Math.max(38, 48 / Math.sqrt(effectiveZoom));
      const pathResult = findShortestPathToRoadPoint(
        curGraph,
        'base',
        worldPt,
        snapRadius
      );

      if (!pathResult) {
        if (propsRef.current.selectedBuildingId !== null) {
          propsRef.current.onSelectBuilding(null);
        } else {
          notify('Kliknij budynek (inspektor) lub ulicę (wyślij kuriera z Bazy).');
        }
        return;
      }

      if (propsRef.current.selectedBuildingId !== null) {
        propsRef.current.onSelectBuilding(null);
      }

      const returnResult = findShortestPathFromRoadPoint(
        curGraph,
        pathResult.snappedPoint,
        'base',
        snapRadius
      );

      const outboundLanePts = applyRightHandLaneOffsets(pathResult.points, {
        laneIndex: 0,
        vehicleClass: 'bicycle',
      });
      const returnCenterPts = returnResult
        ? returnResult.points
        : [...pathResult.points].reverse();
      const returnLanePts = applyRightHandLaneOffsets(returnCenterPts, {
        laneIndex: 0,
        vehicleClass: 'bicycle',
      });

      const rackExit = BASE_DEPOT.bikeRack.exitWaypoints;
      const rackReturn = [...rackExit].reverse();
      const fullOutboundPath = stitchWaypoints(rackExit, outboundLanePts);
      const fullReturnPath = stitchWaypoints(returnLanePts, rackReturn);
      const laneEndPoint =
        outboundLanePts[outboundLanePts.length - 1] ?? pathResult.snappedPoint;

      activeRouteRef.current = outboundLanePts;
      targetMarkerRef.current = laneEndPoint;
      courierRef.current = createCourierFromPath(
        fullOutboundPath,
        DEFAULT_COURIER_SPEED,
        DELIVERY_PAUSE_SECONDS,
        fullReturnPath
      );
      notify(
        `Kurier wyjechał na rowerze prawym pasem · Dystans: ${Math.round(pathResult.totalDistance)} px`
      );
      scheduleRenderRef.current();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const pos = getLocalPos(e.clientX, e.clientY);
      pointerStartScreen = pos;
      pointerLastScreen = pos;
      hasMovedBeyondThreshold = false;

      const { editMode: isEdit, activeTool: tool, graph: curGraph } = propsRef.current;
      if (isEdit && tool === 'move' && !e.shiftKey) {
        const worldPt = screenToWorld(pos.x, pos.y, cameraRef.current, viewportRef.current);
        const hit = hitTestNode(curGraph, worldPt.x, worldPt.y, getHitRadiusWorld());
        if (hit) {
          pointerMode = 'drag-node';
          draggingNodeId = hit.id;
          return;
        }
      }

      pointerMode = 'pan';
      draggingNodeId = null;
    };

    const onMouseMove = (e: MouseEvent) => {
      const pos = getLocalPos(e.clientX, e.clientY);
      const worldPt = screenToWorld(pos.x, pos.y, cameraRef.current, viewportRef.current);
      pointerWorldRef.current = worldPt;

      if (pointerMode === 'none') {
        if (propsRef.current.editMode) {
          if (hoveredBuildingIdRef.current !== null) {
            hoveredBuildingIdRef.current = null;
            canvas.style.cursor = '';
          }
          const hit = hitTestNode(
            propsRef.current.graph,
            worldPt.x,
            worldPt.y,
            getHitRadiusWorld()
          );
          const nextHover = hit ? hit.id : null;
          if (nextHover !== hoveredNodeIdRef.current || propsRef.current.connectSourceId) {
            hoveredNodeIdRef.current = nextHover;
            scheduleRenderRef.current();
          }
        } else {
          if (hoveredNodeIdRef.current !== null) {
            hoveredNodeIdRef.current = null;
            scheduleRenderRef.current();
          }
          const hitBldg = hitTestBuilding(
            propsRef.current.buildings,
            worldPt,
            propsRef.current.footprintOnly
          );
          const nextBldgId = hitBldg ? hitBldg.id : null;
          if (nextBldgId !== hoveredBuildingIdRef.current) {
            hoveredBuildingIdRef.current = nextBldgId;
            canvas.style.cursor = nextBldgId ? 'pointer' : '';
            scheduleRenderRef.current();
          }
        }
        return;
      }

      const distMoved = Math.hypot(
        pos.x - pointerStartScreen.x,
        pos.y - pointerStartScreen.y
      );
      if (distMoved > DRAG_THRESHOLD_PX) {
        hasMovedBeyondThreshold = true;
      }

      if (pointerMode === 'drag-node' && draggingNodeId) {
        propsRef.current.onMoveNode(draggingNodeId, worldPt.x, worldPt.y);
        scheduleRenderRef.current();
      } else if (pointerMode === 'pan') {
        const dx = pos.x - pointerLastScreen.x;
        const dy = pos.y - pointerLastScreen.y;
        cameraRef.current = panCameraByScreenDelta(
          cameraRef.current,
          dx,
          dy,
          viewportRef.current,
          MAP_SIZE
        );
        scheduleRenderRef.current();
      }
      pointerLastScreen = pos;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (pointerMode === 'none') return;
      const pos = getLocalPos(e.clientX, e.clientY);
      const wasClick = !hasMovedBeyondThreshold;
      const prevMode = pointerMode;
      pointerMode = 'none';
      draggingNodeId = null;

      if (wasClick && prevMode === 'pan') {
        handleCanvasClick(pos.x, pos.y, e.shiftKey);
      }
    };

    const onMouseLeave = () => {
      pointerMode = 'none';
      draggingNodeId = null;
      let needsRedraw = false;
      if (hoveredNodeIdRef.current !== null) {
        hoveredNodeIdRef.current = null;
        needsRedraw = true;
      }
      if (hoveredBuildingIdRef.current !== null) {
        hoveredBuildingIdRef.current = null;
        canvas.style.cursor = '';
        needsRedraw = true;
      }
      if (needsRedraw) {
        scheduleRenderRef.current();
      }
      pointerWorldRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pos = getLocalPos(e.clientX, e.clientY);
      const zoomStep = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = zoomCameraAtScreenPoint(
        cameraRef.current,
        cameraRef.current.zoom * zoomStep,
        pos.x,
        pos.y,
        viewportRef.current,
        MAP_SIZE
      );
      cameraRef.current = next;
      propsRef.current.onZoomChange(next.zoom);
      scheduleRenderRef.current();
    };

    // Touch events (1-finger pan/tap/drag-node, 2-finger pinch-to-zoom)
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
      e.preventDefault();
      activeTouches = syncTouches(e.touches);

      if (activeTouches.length === 1) {
        const t = activeTouches[0];
        pointerStartScreen = { x: t.x, y: t.y };
        pointerLastScreen = { x: t.x, y: t.y };
        hasMovedBeyondThreshold = false;

        const { editMode: isEdit, activeTool: tool, graph: curGraph } = propsRef.current;
        if (isEdit && tool === 'move') {
          const worldPt = screenToWorld(t.x, t.y, cameraRef.current, viewportRef.current);
          const hit = hitTestNode(curGraph, worldPt.x, worldPt.y, getHitRadiusWorld() * 1.35);
          if (hit) {
            pointerMode = 'drag-node';
            draggingNodeId = hit.id;
            return;
          }
        }
        pointerMode = 'pan';
        draggingNodeId = null;
      } else if (activeTouches.length >= 2) {
        pointerMode = 'none';
        draggingNodeId = null;
        hasMovedBeyondThreshold = true;
        const [t0, t1] = activeTouches;
        pinchLastDist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        pinchLastMid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touches = syncTouches(e.touches);

      if (touches.length === 1 && (pointerMode === 'pan' || pointerMode === 'drag-node')) {
        const t = touches[0];
        const distMoved = Math.hypot(
          t.x - pointerStartScreen.x,
          t.y - pointerStartScreen.y
        );
        if (distMoved > DRAG_THRESHOLD_PX) {
          hasMovedBeyondThreshold = true;
        }
        if (pointerMode === 'drag-node' && draggingNodeId) {
          const worldPt = screenToWorld(t.x, t.y, cameraRef.current, viewportRef.current);
          propsRef.current.onMoveNode(draggingNodeId, worldPt.x, worldPt.y);
          scheduleRenderRef.current();
        } else if (pointerMode === 'pan') {
          const dx = t.x - pointerLastScreen.x;
          const dy = t.y - pointerLastScreen.y;
          cameraRef.current = panCameraByScreenDelta(
            cameraRef.current,
            dx,
            dy,
            viewportRef.current,
            MAP_SIZE
          );
          scheduleRenderRef.current();
        }
        pointerLastScreen = { x: t.x, y: t.y };
      } else if (touches.length >= 2) {
        const [t0, t1] = touches;
        const dist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        const mid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };

        if (pinchLastDist > 10 && dist > 10) {
          const panDx = mid.x - pinchLastMid.x;
          const panDy = mid.y - pinchLastMid.y;
          let next = panCameraByScreenDelta(
            cameraRef.current,
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
          cameraRef.current = next;
          propsRef.current.onZoomChange(next.zoom);
          scheduleRenderRef.current();
        }
        pinchLastDist = dist;
        pinchLastMid = mid;
      }
      activeTouches = touches;
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const remaining = syncTouches(e.touches);
      if (remaining.length === 0) {
        const wasTap = !hasMovedBeyondThreshold && pointerMode === 'pan';
        pointerMode = 'none';
        draggingNodeId = null;
        if (wasTap) {
          handleCanvasClick(pointerStartScreen.x, pointerStartScreen.y, false);
        }
      } else if (remaining.length === 1) {
        pointerLastScreen = { x: remaining[0].x, y: remaining[0].y };
        pointerMode = 'pan';
        draggingNodeId = null;
      }
      activeTouches = remaining;
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

    let rafId: number | null = null;
    let lastTime = performance.now();

    const drawScene = (now: number) => {
      rafId = null;
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;

      if (courierRef.current.active) {
        const prevPhase = courierRef.current.phase;
        const nextCourier = stepCourier(courierRef.current, rawDt);
        courierRef.current = nextCourier;

        if (prevPhase === 'outbound' && nextCourier.phase === 'delivering') {
          const where = nextCourier.targetLabel ? ` (${nextCourier.targetLabel})` : '';
          propsRef.current.onStatusMessage(
            `Kurier wszedł z przesyłką${where} — pusty rower zaparkowany przy wejściu...`
          );
        } else if (prevPhase === 'delivering' && nextCourier.phase === 'returning') {
          activeRouteRef.current = nextCourier.returnPath;
          propsRef.current.onStatusMessage('Kurier wsiadł na rower i wraca prawym pasem do Bazy');
        } else if (prevPhase === 'returning' && nextCourier.phase === 'idle') {
          activeRouteRef.current = [];
          targetMarkerRef.current = null;
          propsRef.current.onStatusMessage('Kurier wrócił do Bazy — rower zaparkowany na stojaku');
        }
      }

      const { width: vw, height: vh } = viewportRef.current;
      const dpr = canvas.width / Math.max(1, vw);
      const cam = cameraRef.current;
      const effectiveZoom = getEffectiveZoom(cam.zoom, viewportRef.current, MAP_SIZE);
      const {
        graph: curGraph,
        buildings: curBuildings,
        editMode: isEdit,
        showGrid: gridVisible,
        footprintOnly: isFootprintOnly,
        showStreetNames: streetNamesVisible,
        selectedBuildingId: selBuildingId,
        activeTool: tool,
        connectSourceId: sourceId,
      } = propsRef.current;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Render static procedural city into camera-keyed offscreen cache for 60 FPS blitting
      const cacheKey = `${canvas.width}x${canvas.height}:${cam.x.toFixed(2)},${cam.y.toFixed(2)},${effectiveZoom.toFixed(4)}`;
      if (texturesRef.current) {
        if (!bgCacheCanvasRef.current) {
          bgCacheCanvasRef.current = document.createElement('canvas');
        }
        const bgCanvas = bgCacheCanvasRef.current;
        if (bgCanvas.width !== canvas.width || bgCanvas.height !== canvas.height) {
          bgCanvas.width = canvas.width;
          bgCanvas.height = canvas.height;
          bgCacheKeyRef.current = '';
        }
        if (bgCacheKeyRef.current !== cacheKey) {
          const bgCtx = bgCanvas.getContext('2d');
          if (bgCtx) {
            bgCtx.save();
            bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            bgCtx.fillStyle = '#161b22';
            bgCtx.fillRect(0, 0, vw, vh);
            bgCtx.translate(vw / 2, vh / 2);
            bgCtx.scale(effectiveZoom, effectiveZoom);
            bgCtx.translate(-cam.x, -cam.y);
            renderProceduralCity(bgCtx, texturesRef.current);
            bgCtx.restore();
            bgCacheKeyRef.current = cacheKey;
          }
        }
        // Instant 1:1 unscaled blit of cached vector backdrop
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(bgCanvas, 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = '#161b22';
        ctx.fillRect(0, 0, vw, vh);
      }

      // Apply camera transform for dynamic overlays (buildings, road graph, route, courier, labels)
      ctx.translate(vw / 2, vh / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(-cam.x, -cam.y);

      const nodeMap = new Map(curGraph.nodes.map((n) => [n.id, n]));
      const invScale = 1 / Math.sqrt(effectiveZoom);

      const drawRoadGraphAndCourier = (includeBaseLabel: boolean) => {
        // Draw road graph edges when grid is visible
        if (gridVisible) {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.78)';
          ctx.lineWidth = 6 * invScale;
          ctx.beginPath();
          for (const [aId, bId] of curGraph.edges) {
            const a = nodeMap.get(aId);
            const b = nodeMap.get(bId);
            if (!a || !b) continue;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();

          ctx.strokeStyle = isEdit
            ? 'rgba(56, 189, 248, 0.85)'
            : 'rgba(250, 204, 21, 0.72)';
          ctx.lineWidth = 2.6 * invScale;
          ctx.beginPath();
          for (const [aId, bId] of curGraph.edges) {
            const a = nodeMap.get(aId);
            const b = nodeMap.get(bId);
            if (!a || !b) continue;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();

          // Subtle directional arrowheads on one-way roundabout edges (CCW)
          ctx.fillStyle = isEdit ? '#38bdf8' : '#2dd4bf';
          for (const edge of curGraph.edges) {
            if (!edge[2]?.oneWay) continue;
            const a = nodeMap.get(edge[0]);
            const b = nodeMap.get(edge[1]);
            if (!a || !b) continue;
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5;
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            const sz = 4.2 * invScale;
            ctx.beginPath();
            ctx.moveTo(mx + Math.cos(ang) * sz, my + Math.sin(ang) * sz);
            ctx.lineTo(
              mx + Math.cos(ang + 2.45) * sz * 0.85,
              my + Math.sin(ang + 2.45) * sz * 0.85
            );
            ctx.lineTo(
              mx + Math.cos(ang - 2.45) * sz * 0.85,
              my + Math.sin(ang - 2.45) * sz * 0.85
            );
            ctx.closePath();
            ctx.fill();
          }

          // Subtle internal parking navigation aisles across ALL parking lots (markets, courtyards, Bus Station, BAZA)
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.62)';
          ctx.lineWidth = 1.9 * invScale;
          ctx.setLineDash([5 * invScale, 4 * invScale]);
          ctx.beginPath();
          for (const net of ALL_PARKING_NAV_NETWORKS) {
            const pNodeMap = new Map(net.nodes.map((n) => [n.id, n]));
            for (const edge of net.edges) {
              const a = pNodeMap.get(edge.from);
              const b = pNodeMap.get(edge.to);
              if (!a || !b) continue;
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            }
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Directional arrows on one-way internal parking lanes (e.g. Dworzec Autobusowy separate entry/exit)
          ctx.fillStyle = '#38bdf8';
          for (const net of ALL_PARKING_NAV_NETWORKS) {
            const pNodeMap = new Map(net.nodes.map((n) => [n.id, n]));
            for (const edge of net.edges) {
              if (!edge.oneWay) continue;
              const a = pNodeMap.get(edge.from);
              const b = pNodeMap.get(edge.to);
              if (!a || !b) continue;
              const mx = (a.x + b.x) * 0.5;
              const my = (a.y + b.y) * 0.5;
              const ang = Math.atan2(b.y - a.y, b.x - a.x);
              const sz = 3.8 * invScale;
              ctx.beginPath();
              ctx.moveTo(mx + Math.cos(ang) * sz, my + Math.sin(ang) * sz);
              ctx.lineTo(
                mx + Math.cos(ang + 2.45) * sz * 0.85,
                my + Math.sin(ang + 2.45) * sz * 0.85
              );
              ctx.lineTo(
                mx + Math.cos(ang - 2.45) * sz * 0.85,
                my + Math.sin(ang - 2.45) * sz * 0.85
              );
              ctx.closePath();
              ctx.fill();
            }
          }
          ctx.restore();
        }

        // Draw active Dijkstra route if present
        const route = activeRouteRef.current;
        if (!isEdit && route.length >= 2) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.lineWidth = 9 * invScale;
          ctx.beginPath();
          ctx.moveTo(route[0].x, route[0].y);
          for (let i = 1; i < route.length; i++) {
            ctx.lineTo(route[i].x, route[i].y);
          }
          ctx.stroke();

          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 4.5 * invScale;
          ctx.beginPath();
          ctx.moveTo(route[0].x, route[0].y);
          for (let i = 1; i < route.length; i++) {
            ctx.lineTo(route[i].x, route[i].y);
          }
          ctx.stroke();
          ctx.restore();
        }

        // Connect mode preview dashed line
        if (isEdit && tool === 'connect' && sourceId && pointerWorldRef.current) {
          const src = nodeMap.get(sourceId);
          if (src) {
            ctx.save();
            ctx.setLineDash([8 / effectiveZoom, 6 / effectiveZoom]);
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 3 / effectiveZoom;
            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(pointerWorldRef.current.x, pointerWorldRef.current.y);
            ctx.stroke();
            ctx.restore();
          }
        }

        // Draw non-base nodes when grid is visible; optionally draw base node
        for (const node of curGraph.nodes) {
          const isBase = node.id === 'base' || node.kind === 'base';
          if (isBase) {
            if (includeBaseLabel) {
              drawBaseMarker(node);
            }
            continue;
          }
          if (!gridVisible) continue;

          const isHovered = hoveredNodeIdRef.current === node.id;
          const isConnectSource = sourceId === node.id;
          const isRoundabout = node.kind === 'roundabout';

          const radius = (isEdit ? 6.5 : 4.5) * invScale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          if (isConnectSource) {
            ctx.fillStyle = '#22d3ee';
          } else if (isHovered) {
            ctx.fillStyle = tool === 'delete' ? '#ef4444' : '#ffffff';
          } else if (isRoundabout) {
            ctx.fillStyle = '#2dd4bf';
          } else if (node.kind === 'endpoint') {
            ctx.fillStyle = '#cbd5e1';
          } else {
            ctx.fillStyle = '#fbbf24';
          }
          ctx.fill();
          ctx.lineWidth = 1.8 * invScale;
          ctx.strokeStyle = '#0f172a';
          ctx.stroke();

          if (isHovered || isConnectSource) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 4.5 * invScale, 0, Math.PI * 2);
            ctx.lineWidth = 2 * invScale;
            ctx.strokeStyle = isConnectSource
              ? '#22d3ee'
              : tool === 'delete'
                ? '#ef4444'
                : '#ffffff';
            ctx.stroke();
          }
        }

        // Draw destination pin in Test Mode while outbound or delivering
        const activeCourier = courierRef.current;
        if (
          !isEdit &&
          targetMarkerRef.current &&
          (activeCourier.phase === 'outbound' || activeCourier.phase === 'delivering')
        ) {
          const tm = targetMarkerRef.current;
          ctx.save();
          ctx.beginPath();
          ctx.arc(tm.x, tm.y, 7.5 * invScale, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(249, 115, 22, 0.25)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(tm.x, tm.y, 4 * invScale, 0, Math.PI * 2);
          ctx.fillStyle = '#f97316';
          ctx.fill();
          ctx.lineWidth = 1.8 * invScale;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.restore();
        }

        // Draw crisp deliveryStopPoint marker for the currently selected deliverable building
        if (!isEdit && selBuildingId) {
          const selBldg = curBuildings.find((b) => b.id === selBuildingId);
          if (selBldg?.deliveryStopPoint && selBldg?.roadApproachPoint) {
            const sp = selBldg.deliveryStopPoint;
            const ap = selBldg.roadApproachPoint;
            ctx.save();
            // Subtle dashed off-road link from street approach point to sidewalk/parking stop point
            ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
            ctx.lineWidth = 1.8 * invScale;
            ctx.setLineDash([4 * invScale, 3.5 * invScale]);
            ctx.beginPath();
            ctx.moveTo(ap.x, ap.y);
            if (sp.approachWaypoints) {
              for (const wp of sp.approachWaypoints) {
                ctx.lineTo(wp.x, wp.y);
              }
            }
            ctx.lineTo(sp.x, sp.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Grounded isometric target ring at deliveryStopPoint
            ctx.fillStyle = 'rgba(249, 115, 22, 0.22)';
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 1.8 * invScale;
            ctx.beginPath();
            ctx.ellipse(sp.x, sp.y, 7.5 * invScale, 4.2 * invScale, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Inner bright delivery dot
            ctx.fillStyle = '#fff7ed';
            ctx.strokeStyle = '#ea580c';
            ctx.lineWidth = 1.6 * invScale;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 3.1 * invScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
      };

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

      const activeSelectedId = isEdit ? null : selBuildingId;
      const activeHoveredId = isEdit ? null : hoveredBuildingIdRef.current;
      const halfViewW = vw / (2 * effectiveZoom) + 60;
      const halfViewH = vh / (2 * effectiveZoom) + 60;
      const viewBounds = {
        minX: cam.x - halfViewW,
        maxX: cam.x + halfViewW,
        minY: cam.y - halfViewH,
        maxY: cam.y + halfViewH,
      };

      const courier = courierRef.current;
      const showParkedBikeAtRack = isEdit || courier.phase === 'idle';
      const rack = BASE_DEPOT.bikeRack;

      // Build depth-sorted isometric entities (BAZA bike rack + active courier on bicycle)
      const bikeRackEntity: DepthSortedEntity = {
        id: rack.id,
        uMin: rack.uMin,
        uMax: rack.uMax,
        vMin: rack.vMin,
        vMax: rack.vMax,
        draw: (drawCtx) => drawBikeRackWithOptionalBike(drawCtx, rack, showParkedBikeAtRack),
      };

      const depthEntities: DepthSortedEntity[] = [bikeRackEntity];
      if (!isEdit && courier.phase !== 'idle') {
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

      if (isFootprintOnly) {
        // 2D Footprints Mode: flat colored footprints under a 100% unobstructed road network
        renderBuildingFootprints(
          ctx,
          curBuildings,
          activeSelectedId,
          activeHoveredId,
          effectiveZoom,
          viewBounds
        );
        drawRoadGraphAndCourier(true);
        // Keep bike rack and active bicycle courier cleanly visible in 2D mode
        drawBikeRackWithOptionalBike(ctx, rack, showParkedBikeAtRack);
        if (!isEdit && courier.phase !== 'idle') {
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
      } else if (isEdit) {
        // Edit Mode with 3D buildings: keep road calibration nodes on top so nothing is blocked
        renderBuildings3D(ctx, curBuildings, null, null, effectiveZoom, viewBounds, [bikeRackEntity]);
        if (streetNamesVisible) {
          renderStreetNames(ctx, effectiveZoom, viewBounds);
        }
        drawRoadGraphAndCourier(true);
      } else {
        // Normal 3D Mode: road graph/route on asphalt, then Z-sorted 3D buildings interleaved with
        // the BAZA bike rack and active courier bicycle so tall blocks naturally occlude the rider
        drawRoadGraphAndCourier(false);
        renderBuildings3D(
          ctx,
          curBuildings,
          activeSelectedId,
          activeHoveredId,
          effectiveZoom,
          viewBounds,
          depthEntities
        );
        const baseNode = nodeMap.get('base');
        if (baseNode) {
          drawBaseMarker(baseNode);
        }
        if (streetNamesVisible) {
          renderStreetNames(ctx, effectiveZoom, viewBounds);
        }
      }

      ctx.restore();

      if (courierRef.current.active) {
        rafId = requestAnimationFrame(drawScene);
      }
    };

    const scheduleRender = () => {
      if (rafId === null) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(drawScene);
      }
    };
    scheduleRenderRef.current = scheduleRender;

    updateCanvasSize();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(container);
    scheduleRender();

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
        className={`block w-full h-full touch-none ${
          editMode
            ? activeTool === 'add'
              ? 'cursor-crosshair'
              : activeTool === 'delete'
                ? 'cursor-not-allowed'
                : 'cursor-grab active:cursor-grabbing'
            : 'cursor-grab active:cursor-grabbing'
        }`}
      />
    </div>
  );
};
