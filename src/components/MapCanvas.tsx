import React, { useEffect, useMemo, useRef } from 'react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data/initialRoadGraph';
import { type Building, formatBuildingAddress } from '../types/building';
import type { Point, RoadGraph } from '../types/roadGraph';
import type { DepthSortedEntity } from '../utils/buildings';
import { BASE_DEPOT, type BaseDepotSpec, canvasToIso } from '../utils/cityMap';
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
  zoomCameraAtScreenPoint,
  zoomCameraByWheel,
} from '../utils/camera';
import {
  type CourierState,
  DEFAULT_COURIER_SPEED,
  DELIVERY_PAUSE_SECONDS,
  computeScaledSimDt,
  createCourierFromPath,
  createIdleCourier,
  stepCourierWithSimDt,
  stitchWaypoints,
} from '../utils/courierSim';
import type { GameSpeed } from '../utils/gameClock';
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
}

interface MapCanvasProps {
  graph: RoadGraph;
  buildings: Building[];
  baseDepot?: BaseDepotSpec;
  showGrid: boolean;
  footprintOnly: boolean;
  showStreetNames: boolean;
  gameSpeed: GameSpeed;
  interactionBlocked?: boolean;
  controllerRef: React.MutableRefObject<MapCanvasController | null>;
}

const MAP_SIZE: Size = { width: MAP_WIDTH, height: MAP_HEIGHT };

export const MapCanvas: React.FC<MapCanvasProps> = ({
  graph,
  buildings,
  baseDepot = BASE_DEPOT,
  showGrid,
  footprintOnly,
  showStreetNames,
  gameSpeed,
  interactionBlocked = false,
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
    buildings,
    baseDepot,
    parkingNavNetworks,
    showGrid,
    footprintOnly,
    showStreetNames,
    gameSpeed,
    interactionBlocked,
  });
  propsRef.current = {
    graph,
    buildings,
    baseDepot,
    parkingNavNetworks,
    showGrid,
    footprintOnly,
    showStreetNames,
    gameSpeed,
    interactionBlocked,
  };

  // Trigger a redraw/resume simulation whenever React props or gameSpeed change
  useEffect(() => {
    scheduleRenderRef.current();
  }, [graph, buildings, baseDepot, showGrid, footprintOnly, showStreetNames, gameSpeed]);

  // Expose camera & courier dispatch controls for upcoming order mechanics
  useEffect(() => {
    controllerRef.current = {
      centerOnBase: () => {
        const baseNode = propsRef.current.graph.nodes.find((n) => n.id === 'base');
        const focus = baseNode
          ? { x: baseNode.x + 10, y: baseNode.y - 70 }
          : { x: 820, y: 1460 };
        cameraRef.current = createInitialCamera(viewportRef.current, MAP_SIZE, focus);
        scheduleRenderRef.current();
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

        scheduleRenderRef.current();
        return true;
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
      } else {
        cameraRef.current = clampCamera(
          cameraRef.current,
          viewportRef.current,
          MAP_SIZE
        );
      }
      scheduleRenderRef.current();
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
      cameraRef.current = panCameraByScreenDelta(
        cameraRef.current,
        dx,
        dy,
        viewportRef.current,
        MAP_SIZE
      );
      pointerLastScreen = pos;
      scheduleRenderRef.current();
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
      const prev = cameraRef.current;
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
        cameraRef.current = next;
        scheduleRenderRef.current();
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
      const touches = syncTouches(e.touches);

      if (touches.length === 1 && isPanning) {
        const t = touches[0];
        const dx = t.x - pointerLastScreen.x;
        const dy = t.y - pointerLastScreen.y;
        cameraRef.current = panCameraByScreenDelta(
          cameraRef.current,
          dx,
          dy,
          viewportRef.current,
          MAP_SIZE
        );
        pointerLastScreen = { x: t.x, y: t.y };
        scheduleRenderRef.current();
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
          scheduleRenderRef.current();
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

      // Shared speed-scaled simulation step for couriers and future fleet vehicles (0 = paused)
      const simDt = computeScaledSimDt(rawDt, propsRef.current.gameSpeed);

      if (simDt > 0 && courierRef.current.active) {
        const prevPhase = courierRef.current.phase;
        const nextCourier = stepCourierWithSimDt(courierRef.current, simDt);
        courierRef.current = nextCourier;

        if (prevPhase === 'delivering' && nextCourier.phase === 'returning') {
          activeRouteRef.current = nextCourier.returnPath;
        } else if (prevPhase === 'returning' && nextCourier.phase === 'idle') {
          activeRouteRef.current = [];
          targetMarkerRef.current = null;
        }
      }

      const { width: vw, height: vh } = viewportRef.current;
      const dpr = canvas.width / Math.max(1, vw);
      const cam = cameraRef.current;
      const effectiveZoom = getEffectiveZoom(cam.zoom, viewportRef.current, MAP_SIZE);
      const {
        graph: curGraph,
        buildings: curBuildings,
        baseDepot: curBaseDepot,
        parkingNavNetworks: curParkingNavNetworks,
        showGrid: gridVisible,
        footprintOnly: isFootprintOnly,
        showStreetNames: streetNamesVisible,
      } = propsRef.current;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Render static procedural city into camera-keyed offscreen cache for 60 FPS blitting
      const cacheKey = `${canvas.width}x${canvas.height}:${cam.x.toFixed(2)},${cam.y.toFixed(2)},${effectiveZoom.toFixed(4)}:b${curBaseDepot.warehouseTier}p${curBaseDepot.parking.spots.length}`;
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
            renderProceduralCity(bgCtx, texturesRef.current, curBaseDepot);
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

          ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
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
          ctx.fillStyle = '#2dd4bf';
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
          for (const net of curParkingNavNetworks) {
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
          for (const net of curParkingNavNetworks) {
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
        if (route.length >= 2) {
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

          const isRoundabout = node.kind === 'roundabout';
          const radius = 4.5 * invScale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          if (isRoundabout) {
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
        }

        // Draw destination pin while outbound or delivering
        const activeCourier = courierRef.current;
        if (
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

      if (isFootprintOnly) {
        // 2D Footprints Mode: flat colored footprints under a 100% unobstructed road network
        renderBuildingFootprints(
          ctx,
          curBuildings,
          null,
          null,
          effectiveZoom,
          viewBounds
        );
        drawRoadGraphAndCourier(true);
        // Keep bike rack and active bicycle courier cleanly visible in 2D mode
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
        // Normal 3D Mode: road graph/route on asphalt, then Z-sorted 3D buildings interleaved with
        // the BAZA bike rack and active courier bicycle so tall blocks naturally occlude the rider
        drawRoadGraphAndCourier(false);
        renderBuildings3D(
          ctx,
          curBuildings,
          null,
          null,
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

      if (courierRef.current.active && propsRef.current.gameSpeed > 0) {
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
        className="block w-full h-full touch-none cursor-grab active:cursor-grabbing"
      />
    </div>
  );
};
