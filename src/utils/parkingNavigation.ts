import type { Point, RoadGraph } from '../types/roadGraph';
import {
  PROCEDURAL_PARKING_LOTS,
  type ParkingLot,
  type ParkingStallRect,
  computeParkingLayout,
} from './buildings';
import {
  ALL_STREETS,
  BASE_DEPOT,
  BUS_STATION,
  RESIDENTIAL_ACCESS_ROADS,
  type BaseDepotSpec,
  type BusStationSpec,
  buildProceduralRoadGraph,
  canvasToIso,
  isoToCanvas,
} from './cityMap';

export type ParkingNavNodeKind =
  | 'road_entry'
  | 'road_exit'
  | 'driveway_mouth'
  | 'aisle';

export interface ParkingRoadConnection {
  streetId: string;
  edge: [string, string];
  /** Normalized parameter along roadGraph edge [0..1] */
  t: number;
}

export interface ParkingNavNode {
  id: string;
  kind: ParkingNavNodeKind;
  u: number;
  v: number;
  x: number;
  y: number;
  /** Present on road_entry / road_exit nodes binding the lot to an existing roadGraph edge */
  roadConnection?: ParkingRoadConnection;
}

export interface ParkingNavEdge {
  from: string;
  to: string;
  oneWay: boolean;
  kind: 'driveway' | 'aisle';
}

export interface ParkingSpotNav {
  id: string;
  row: string;
  /** Exact stall rectangle in isometric (u, v) coordinates */
  rect: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Exact parked vehicle center inside the stall */
  parkPoint: { u: number; v: number; x: number; y: number };
  /** Exact perpendicular point on the adjacent driving aisle directly in front of this stall */
  aisleAccessPoint: { u: number; v: number; x: number; y: number };
  /** IDs of the aisle edge [from, to] that aisleAccessPoint lies on */
  aisleEdge: [string, string];
  /** Unit direction vector in iso (u, v) when pulling INTO the stall from the aisle */
  entryDirIso: { u: number; v: number };
  /** Unit direction vector in iso (u, v) when exiting the stall BACK into the aisle */
  exitDirIso: { u: number; v: number };
}

export interface ParkingNavNetwork {
  lotId: string;
  kind: 'market' | 'courtyard' | 'bus_station' | 'base_fleet';
  /** ID of the street-side entry node */
  entryRoadNodeId: string;
  /** ID of the street-side exit node (equals entryRoadNodeId for two-way lots, distinct for Bus Station) */
  exitRoadNodeId: string;
  /** True when entry and exit use separate one-way driveways (e.g. Dworzec Autobusowy) */
  hasSeparateExit: boolean;
  nodes: ParkingNavNode[];
  edges: ParkingNavEdge[];
  spots: ParkingSpotNav[];
}

export interface PlannedParkingRoute {
  lotId: string;
  spotId: string;
  direction: 'entry' | 'exit';
  /** Waypoints in isometric (u, v) space */
  isoPoints: Array<{ u: number; v: number }>;
  /** Waypoints in canvas pixel space */
  canvasPoints: Point[];
  /** Total geometric distance in iso units */
  totalIsoDistance: number;
}

interface IsoRect {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

interface PrecomputedRoadEdge {
  edge: [string, string];
  oneWay: boolean;
  au: number;
  av: number;
  bu: number;
  bv: number;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function makeNavNode(
  id: string,
  kind: ParkingNavNodeKind,
  u: number,
  v: number,
  roadConnection?: ParkingRoadConnection
): ParkingNavNode {
  const pt = isoToCanvas(u, v);
  return {
    id,
    kind,
    u: round1(u),
    v: round1(v),
    x: round1(pt.x),
    y: round1(pt.y),
    ...(roadConnection ? { roadConnection } : {}),
  };
}

/**
 * Exact Liang-Barsky intersection test checking whether segment (u0, v0)-(u1, v1)
 * strictly enters the interior of `rect` (shrunk by `margin` on every side).
 */
export function segmentIntersectsRectInterior(
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  rect: IsoRect,
  margin = 0.25
): boolean {
  const minU = rect.uMin + margin;
  const maxU = rect.uMax - margin;
  const minV = rect.vMin + margin;
  const maxV = rect.vMax - margin;
  if (minU >= maxU || minV >= maxV) return false;

  const du = u1 - u0;
  const dv = v1 - v0;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    clip(-du, u0 - minU) &&
    clip(du, maxU - u0) &&
    clip(-dv, v0 - minV) &&
    clip(dv, maxV - v0)
  ) {
    return t1 - t0 > 1e-5;
  }
  return false;
}

function precomputeRoadEdges(
  roadGraph: RoadGraph,
  includeBaseDriveway: boolean
): PrecomputedRoadEdge[] {
  const nodeById = new Map(roadGraph.nodes.map((n) => [n.id, n]));
  const result: PrecomputedRoadEdge[] = [];
  for (const edge of roadGraph.edges) {
    const aId = edge[0];
    const bId = edge[1];
    if (!includeBaseDriveway && (aId === 'base' || bId === 'base')) continue;
    const a = nodeById.get(aId);
    const b = nodeById.get(bId);
    if (!a || !b) continue;
    const aIso = canvasToIso(a.x, a.y);
    const bIso = canvasToIso(b.x, b.y);
    result.push({
      edge: [aId, bId],
      oneWay: Boolean(edge[2]?.oneWay),
      au: aIso.u,
      av: aIso.v,
      bu: bIso.u,
      bv: bIso.v,
    });
  }
  return result;
}

function projectToRoadGraphEdge(
  u: number,
  v: number,
  streetId: string,
  edges: PrecomputedRoadEdge[]
): { u: number; v: number; roadConnection: ParkingRoadConnection } {
  const street = ALL_STREETS.find((s) => s.id === streetId);
  const accessRoad = !street
    ? RESIDENTIAL_ACCESS_ROADS.find((ar) => ar.id === streetId)
    : undefined;

  const axis = street?.axis ?? accessRoad?.axis;
  const coord = street?.coord ?? accessRoad?.coord;

  const matchingStreetEdges =
    axis !== undefined && coord !== undefined
      ? edges.filter(
          (e) =>
            !e.oneWay &&
            (axis === 'u'
              ? Math.abs(e.au - coord) < 5 && Math.abs(e.bu - coord) < 5
              : Math.abs(e.av - coord) < 5 && Math.abs(e.bv - coord) < 5)
        )
      : [];

  const pool =
    matchingStreetEdges.length > 0
      ? matchingStreetEdges
      : edges.filter((e) => !e.oneWay);

  let best: { u: number; v: number; edge: [string, string]; t: number; dist: number } | null = null;
  for (const e of pool) {
    const du = e.bu - e.au;
    const dv = e.bv - e.av;
    const lenSq = du * du + dv * dv;
    if (lenSq < 1e-4) continue;
    const t = Math.max(0, Math.min(1, ((u - e.au) * du + (v - e.av) * dv) / lenSq));
    const pu = e.au + t * du;
    const pv = e.av + t * dv;
    const dist = Math.hypot(u - pu, v - pv);
    if (!best || dist < best.dist) {
      best = { u: pu, v: pv, edge: e.edge, t, dist };
    }
  }

  if (!best) {
    return {
      u,
      v,
      roadConnection: { streetId, edge: ['base', 'n_base_exit'], t: 0 },
    };
  }

  return {
    u: best.u,
    v: best.v,
    roadConnection: {
      streetId,
      edge: best.edge,
      t: Math.round(best.t * 10000) / 10000,
    },
  };
}

function toIsoFromAxis(
  stallAxis: 'u' | 'v',
  along: number,
  depth: number
): { u: number; v: number } {
  return stallAxis === 'u' ? { u: along, v: depth } : { u: depth, v: along };
}

function findContainingEdge(
  ptU: number,
  ptV: number,
  nodes: ParkingNavNode[],
  edges: ParkingNavEdge[]
): [string, string] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let bestEdge: [string, string] = [edges[0].from, edges[0].to];
  let bestDist = Infinity;

  for (const e of edges) {
    if (e.kind !== 'aisle') continue;
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const lenSq = du * du + dv * dv;
    if (lenSq < 1e-4) continue;
    const t = Math.max(0, Math.min(1, ((ptU - a.u) * du + (ptV - a.v) * dv) / lenSq));
    const pu = a.u + t * du;
    const pv = a.v + t * dv;
    const d = Math.hypot(ptU - pu, ptV - pv);
    if (d < bestDist) {
      bestDist = d;
      bestEdge = [e.from, e.to];
    }
  }
  return bestEdge;
}

/**
 * Builds an internal vehicle navigation graph for a procedural market or courtyard ParkingLot.
 * All aisle & driveway segments stay strictly inside open driving lanes and never cut across
 * any painted stall rectangle.
 */
export function buildParkingLotNavNetwork(
  lot: ParkingLot,
  roadGraph: RoadGraph
): ParkingNavNetwork {
  const layout = computeParkingLayout(lot);
  const roadEdges = precomputeRoadEdges(roadGraph, false);
  const stallAxis = layout.stallAxis;
  const alongMin = stallAxis === 'u' ? lot.uMin : lot.vMin;
  const alongMax = stallAxis === 'u' ? lot.uMax : lot.vMax;
  const depthMin = stallAxis === 'u' ? lot.vMin : lot.uMin;
  const depthMax = stallAxis === 'u' ? lot.vMax : lot.uMax;

  const minSide = stallAxis === 'u' ? 'vMin' : 'uMin';
  const maxSide = stallAxis === 'u' ? 'vMax' : 'uMax';
  const alongMinSide = stallAxis === 'u' ? 'uMin' : 'vMin';
  const alongMaxSide = stallAxis === 'u' ? 'uMax' : 'vMax';

  const row1 = layout.outerRows.find((r) => r.side === minSide);
  const row2 = layout.outerRows.find((r) => r.side === maxSide);
  const r1Open = row1 ? row1.openCoord : depthMin + 24;
  const r2Open = row2 ? row2.openCoord : depthMax - 4;

  const dw = lot.accessDriveway;
  const dwAlongMin = stallAxis === 'u' ? dw.uMin : dw.vMin;
  const dwAlongMax = stallAxis === 'u' ? dw.uMax : dw.vMax;
  const dwDepthMin = stallAxis === 'u' ? dw.vMin : dw.uMin;
  const dwDepthMax = stallAxis === 'u' ? dw.vMax : dw.uMax;
  const dwCenterAlong = (dwAlongMin + dwAlongMax) / 2;
  const dwCenterDepth = (dwDepthMin + dwDepthMax) / 2;

  // Lot perimeter mouth coordinate on dw.entrySide
  let mouthAlong = dwCenterAlong;
  let mouthDepth = dwCenterDepth;
  if (dw.entrySide === alongMinSide) mouthAlong = alongMin;
  else if (dw.entrySide === alongMaxSide) mouthAlong = alongMax;
  else if (dw.entrySide === minSide) mouthDepth = depthMin;
  else if (dw.entrySide === maxSide) mouthDepth = depthMax;

  const mouthIso = toIsoFromAxis(stallAxis, mouthAlong, mouthDepth);
  const roadProj = projectToRoadGraphEdge(mouthIso.u, mouthIso.v, dw.streetId, roadEdges);

  const nodes: ParkingNavNode[] = [];
  const edges: ParkingNavEdge[] = [];
  const addNode = (node: ParkingNavNode) => {
    nodes.push(node);
    return node;
  };
  const addEdge = (
    from: string,
    to: string,
    kind: 'driveway' | 'aisle',
    oneWay = false
  ) => {
    if (from === to) return;
    if (edges.some((e) => (e.from === from && e.to === to) || (!oneWay && !e.oneWay && e.from === to && e.to === from))) {
      return;
    }
    edges.push({ from, to, oneWay, kind });
  };

  const entryRoadNode = addNode(
    makeNavNode(`${lot.id}_road`, 'road_entry', roadProj.u, roadProj.v, roadProj.roadConnection)
  );
  const mouthNode = addNode(
    makeNavNode(`${lot.id}_mouth`, 'driveway_mouth', mouthIso.u, mouthIso.v)
  );
  addEdge(entryRoadNode.id, mouthNode.id, 'driveway', false);

  // Compute stall along-span across all stalls so aisles reach every outermost stall center
  let minStallAlong = alongMax;
  let maxStallAlong = alongMin;
  for (const s of layout.allStalls) {
    const c = stallAxis === 'u' ? (s.uMin + s.uMax) / 2 : (s.vMin + s.vMax) / 2;
    if (c < minStallAlong) minStallAlong = c;
    if (c > maxStallAlong) maxStallAlong = c;
  }
  if (minStallAlong > maxStallAlong) {
    minStallAlong = alongMin + 12;
    maxStallAlong = alongMax - 12;
  }

  // Helper to build a sorted chain of collinear aisle nodes along a fixed depth
  const buildChainAlongDepth = (
    prefix: string,
    depth: number,
    points: Array<{ key: string; along: number }>
  ): Map<string, string> => {
    const sorted = [...points].sort((a, b) => a.along - b.along);
    const merged: Array<{ keys: string[]; along: number; nodeId: string }> = [];
    for (const pt of sorted) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(pt.along - prev.along) < 1.2) {
        prev.keys.push(pt.key);
      } else {
        const iso = toIsoFromAxis(stallAxis, pt.along, depth);
        const id = `${lot.id}_${prefix}_${merged.length}`;
        addNode(makeNavNode(id, 'aisle', iso.u, iso.v));
        merged.push({ keys: [pt.key], along: pt.along, nodeId: id });
      }
    }
    for (let i = 0; i < merged.length - 1; i++) {
      addEdge(merged[i].nodeId, merged[i + 1].nodeId, 'aisle', false);
    }
    const keyMap = new Map<string, string>();
    for (const m of merged) {
      for (const k of m.keys) keyMap.set(k, m.nodeId);
    }
    return keyMap;
  };

  let aisle1Depth = (r1Open + r2Open) / 2;
  let aisle2Depth = aisle1Depth;

  if (!layout.centerIsland) {
    // Single-aisle lot (single-row or double-row without center island)
    const aisleDepth = (r1Open + r2Open) / 2;
    aisle1Depth = aisleDepth;
    aisle2Depth = aisleDepth;

    const spinePoints: Array<{ key: string; along: number }> = [
      { key: 'min', along: minStallAlong },
      { key: 'max', along: maxStallAlong },
    ];

    if (dw.entersAisleDirectly) {
      const joinAlong =
        dw.entrySide === alongMinSide
          ? Math.min(minStallAlong, alongMin + 8)
          : Math.max(maxStallAlong, alongMax - 8);
      spinePoints.push({ key: 'dw_join', along: joinAlong });
    } else {
      spinePoints.push({ key: 'dw_join', along: dwCenterAlong });
    }

    const chainMap = buildChainAlongDepth('aisle', aisleDepth, spinePoints);
    const joinNodeId = chainMap.get('dw_join')!;
    addEdge(mouthNode.id, joinNodeId, 'driveway', false);
  } else {
    // Perimeter-loop lot around a central back-to-back double-row island
    const ci = layout.centerIsland;
    aisle1Depth = (r1Open + ci.rowAMin) / 2;
    aisle2Depth = (ci.rowBMax + r2Open) / 2;
    const endAAlong = (alongMin + ci.alongMin) / 2;
    const endBAlong = (ci.alongMax + alongMax) / 2;

    const aisle1Pts: Array<{ key: string; along: number }> = [
      { key: 'endA', along: endAAlong },
      { key: 'endB', along: endBAlong },
    ];
    const aisle2Pts: Array<{ key: string; along: number }> = [
      { key: 'endA', along: endAAlong },
      { key: 'endB', along: endBAlong },
    ];

    if (minStallAlong < endAAlong - 0.8) {
      aisle1Pts.push({ key: 'stubMin', along: minStallAlong });
      aisle2Pts.push({ key: 'stubMin', along: minStallAlong });
    }
    if (maxStallAlong > endBAlong + 0.8) {
      aisle1Pts.push({ key: 'stubMax', along: maxStallAlong });
      aisle2Pts.push({ key: 'stubMax', along: maxStallAlong });
    }

    if (!dw.entersAisleDirectly) {
      if (dw.entrySide === minSide) {
        aisle1Pts.push({ key: 'dw_join', along: dwCenterAlong });
      } else {
        aisle2Pts.push({ key: 'dw_join', along: dwCenterAlong });
      }
    }

    const map1 = buildChainAlongDepth('aisle1', aisle1Depth, aisle1Pts);
    const map2 = buildChainAlongDepth('aisle2', aisle2Depth, aisle2Pts);

    const endA1 = map1.get('endA')!;
    const endA2 = map2.get('endA')!;
    const endB1 = map1.get('endB')!;
    const endB2 = map2.get('endB')!;

    if (!dw.entersAisleDirectly) {
      // Connect both turning end-aisles directly
      addEdge(endA1, endA2, 'aisle', false);
      addEdge(endB1, endB2, 'aisle', false);
      const joinNodeId =
        dw.entrySide === minSide ? map1.get('dw_join')! : map2.get('dw_join')!;
      addEdge(mouthNode.id, joinNodeId, 'driveway', false);
    } else {
      // Driveway enters directly into turning end-aisle A or B
      const enteringA = dw.entrySide === alongMinSide;
      const targetEndAlong = enteringA ? endAAlong : endBAlong;
      const topNode = enteringA ? endA1 : endB1;
      const botNode = enteringA ? endA2 : endB2;
      const otherTop = enteringA ? endB1 : endA1;
      const otherBot = enteringA ? endB2 : endA2;

      addEdge(otherTop, otherBot, 'aisle', false);

      if (dwCenterDepth > aisle1Depth + 1.5 && dwCenterDepth < aisle2Depth - 1.5) {
        // Split the target turning end-aisle at dwCenterDepth
        const splitIso = toIsoFromAxis(stallAxis, targetEndAlong, dwCenterDepth);
        const splitNode = addNode(
          makeNavNode(`${lot.id}_end_split`, 'aisle', splitIso.u, splitIso.v)
        );
        addEdge(topNode, splitNode.id, 'aisle', false);
        addEdge(splitNode.id, botNode, 'aisle', false);
        addEdge(mouthNode.id, splitNode.id, 'driveway', false);
      } else {
        addEdge(topNode, botNode, 'aisle', false);
        const nearestCorner =
          Math.abs(dwCenterDepth - aisle1Depth) <= Math.abs(dwCenterDepth - aisle2Depth)
            ? topNode
            : botNode;
        addEdge(mouthNode.id, nearestCorner, 'driveway', false);
      }
    }
  }

  // Build exact ParkingSpotNav entry/exit descriptors for every stall on this lot
  const spots: ParkingSpotNav[] = layout.allStalls.map((stall: ParkingStallRect, idx: number) => {
    const centerU = (stall.uMin + stall.uMax) / 2;
    const centerV = (stall.vMin + stall.vMax) / 2;
    const centerAlong = stallAxis === 'u' ? centerU : centerV;

    // Determine which driving aisle serves this stall row and entry direction
    let servingDepth = aisle1Depth;
    let entryDirDepth = -1; // moving from aisle toward stall back
    if (stall.row === minSide) {
      servingDepth = aisle1Depth;
      entryDirDepth = -1;
    } else if (stall.row === 'islandA') {
      servingDepth = aisle1Depth;
      entryDirDepth = 1;
    } else if (stall.row === 'islandB') {
      servingDepth = aisle2Depth;
      entryDirDepth = -1;
    } else {
      // maxSide
      servingDepth = aisle2Depth;
      entryDirDepth = 1;
    }

    const accessIso = toIsoFromAxis(stallAxis, centerAlong, servingDepth);
    const accessCanvas = isoToCanvas(accessIso.u, accessIso.v);
    const parkCanvas = isoToCanvas(centerU, centerV);
    const aisleEdge = findContainingEdge(accessIso.u, accessIso.v, nodes, edges);

    const entryDirIso =
      stallAxis === 'u'
        ? { u: 0, v: entryDirDepth }
        : { u: entryDirDepth, v: 0 };

    return {
      id: `${lot.id}_spot_${idx + 1}`,
      row: stall.row,
      rect: {
        uMin: round1(stall.uMin),
        uMax: round1(stall.uMax),
        vMin: round1(stall.vMin),
        vMax: round1(stall.vMax),
      },
      parkPoint: {
        u: round1(centerU),
        v: round1(centerV),
        x: round1(parkCanvas.x),
        y: round1(parkCanvas.y),
      },
      aisleAccessPoint: {
        u: round1(accessIso.u),
        v: round1(accessIso.v),
        x: round1(accessCanvas.x),
        y: round1(accessCanvas.y),
      },
      aisleEdge,
      entryDirIso,
      exitDirIso: {
        u: entryDirIso.u === 0 ? 0 : -entryDirIso.u,
        v: entryDirIso.v === 0 ? 0 : -entryDirIso.v,
      },
    };
  });

  return {
    lotId: lot.id,
    kind: lot.kind,
    entryRoadNodeId: entryRoadNode.id,
    exitRoadNodeId: entryRoadNode.id,
    hasSeparateExit: false,
    nodes,
    edges,
    spots,
  };
}

/**
 * Builds the one-way internal circulation graph for Dworzec Autobusowy (BUS_STATION),
 * strictly honoring separate Entry (bus_entry) and Exit (bus_exit) driveways on al. Dworcowa
 * and keeping all circulation lanes completely clear of all 6 oversized bus bays.
 */
export function buildBusStationNavNetwork(
  station: BusStationSpec,
  roadGraph: RoadGraph
): ParkingNavNetwork {
  const roadEdges = precomputeRoadEdges(roadGraph, false);
  const entryU = (station.entryDriveway.uMin + station.entryDriveway.uMax) / 2;
  const exitU = (station.exitDriveway.uMin + station.exitDriveway.uMax) / 2;
  const yardMinV = station.asphaltYard.vMin;
  const bayAisleV = 130; // dead-center between busBays vMax=104 and circulation divider v=156
  const terminalLaneV = 180; // dead-center between divider v=156 and yard vMax=204

  const entryRoadProj = projectToRoadGraphEdge(entryU, yardMinV, station.streetId, roadEdges);
  const exitRoadProj = projectToRoadGraphEdge(exitU, yardMinV, station.streetId, roadEdges);

  const nodes: ParkingNavNode[] = [
    makeNavNode(
      'bus_entry_road',
      'road_entry',
      entryRoadProj.u,
      entryRoadProj.v,
      entryRoadProj.roadConnection
    ),
    makeNavNode('bus_entry_mouth', 'driveway_mouth', entryU, yardMinV),
    makeNavNode('bus_aisle_sw', 'aisle', entryU, bayAisleV),
    makeNavNode('bus_aisle_se', 'aisle', exitU, bayAisleV),
    makeNavNode('bus_aisle_nw', 'aisle', entryU, terminalLaneV),
    makeNavNode('bus_aisle_ne', 'aisle', exitU, terminalLaneV),
    makeNavNode('bus_exit_mouth', 'driveway_mouth', exitU, yardMinV),
    makeNavNode(
      'bus_exit_road',
      'road_exit',
      exitRoadProj.u,
      exitRoadProj.v,
      exitRoadProj.roadConnection
    ),
  ];

  // Strictly one-way circulation from bus_entry -> bay/terminal lanes -> bus_exit
  const edges: ParkingNavEdge[] = [
    { from: 'bus_entry_road', to: 'bus_entry_mouth', oneWay: true, kind: 'driveway' },
    { from: 'bus_entry_mouth', to: 'bus_aisle_sw', oneWay: true, kind: 'aisle' },
    { from: 'bus_aisle_sw', to: 'bus_aisle_se', oneWay: true, kind: 'aisle' },
    { from: 'bus_aisle_sw', to: 'bus_aisle_nw', oneWay: true, kind: 'aisle' },
    { from: 'bus_aisle_nw', to: 'bus_aisle_ne', oneWay: true, kind: 'aisle' },
    { from: 'bus_aisle_ne', to: 'bus_aisle_se', oneWay: true, kind: 'aisle' },
    { from: 'bus_aisle_se', to: 'bus_exit_mouth', oneWay: true, kind: 'aisle' },
    { from: 'bus_exit_mouth', to: 'bus_exit_road', oneWay: true, kind: 'driveway' },
  ];

  const spots: ParkingSpotNav[] = station.busBays.map((bay) => {
    const accessCanvas = isoToCanvas(bay.u, bayAisleV);
    return {
      id: bay.id,
      row: 'bus_bays',
      rect: {
        uMin: bay.uMin,
        uMax: bay.uMax,
        vMin: bay.vMin,
        vMax: bay.vMax,
      },
      parkPoint: {
        u: bay.u,
        v: bay.v,
        x: bay.x,
        y: bay.y,
      },
      aisleAccessPoint: {
        u: bay.u,
        v: bayAisleV,
        x: round1(accessCanvas.x),
        y: round1(accessCanvas.y),
      },
      aisleEdge: ['bus_aisle_sw', 'bus_aisle_se'],
      entryDirIso: { u: 0, v: -1 },
      exitDirIso: { u: 0, v: 1 },
    };
  });

  return {
    lotId: station.id,
    kind: 'bus_station',
    entryRoadNodeId: 'bus_entry_road',
    exitRoadNodeId: 'bus_exit_road',
    hasSeparateExit: true,
    nodes,
    edges,
    spots,
  };
}

/**
 * Builds the internal fleet parking navigation graph for BAZA (depot.parking),
 * branching cleanly from the BAZA exit driveway along the L-shaped internal asphalt connector
 * into the open fleet aisle serving all unlocked fleet parking spots (1–8 across 1–2 rows).
 */
export function buildBaseParkingNavNetwork(
  depot: BaseDepotSpec,
  roadGraph: RoadGraph
): ParkingNavNetwork {
  const p = depot.parking;
  if (p.spots.length === 0) {
    return {
      lotId: p.id,
      kind: 'base_fleet',
      entryRoadNodeId: 'base_parking_road',
      exitRoadNodeId: 'base_parking_road',
      hasSeparateExit: false,
      nodes: [],
      edges: [],
      spots: [],
    };
  }
  const roadEdges = precomputeRoadEdges(roadGraph, true);
  const baseDrivewayEdges = roadEdges.filter(
    (e) =>
      (e.edge[0] === 'base' && e.edge[1] === 'n_base_exit') ||
      (e.edge[0] === 'n_base_exit' && e.edge[1] === 'base')
  );

  const branchU = 82;
  const aisleV = p.aisleV;
  const proj = projectToRoadGraphEdge(
    branchU,
    depot.v,
    'base_driveway',
    baseDrivewayEdges.length > 0 ? baseDrivewayEdges : roadEdges
  );

  let minSpotU = p.uMin + 12;
  let maxSpotU = p.uMax - 12;
  if (p.spots.length > 0) {
    minSpotU = p.spots.reduce((acc, s) => Math.min(acc, s.u), Infinity);
    maxSpotU = p.spots.reduce((acc, s) => Math.max(acc, s.u), -Infinity);
  }

  const nodes: ParkingNavNode[] = [
    makeNavNode('base_parking_road', 'road_entry', proj.u, proj.v, proj.roadConnection),
    makeNavNode('base_parking_corner', 'driveway_mouth', branchU, aisleV),
    makeNavNode('base_parking_aisle_w', 'aisle', Math.min(p.uMin, minSpotU), aisleV),
    makeNavNode('base_parking_aisle_e', 'aisle', Math.max(p.uMax - 5, maxSpotU), aisleV),
  ];

  const edges: ParkingNavEdge[] = [
    { from: 'base_parking_road', to: 'base_parking_corner', oneWay: false, kind: 'driveway' },
    { from: 'base_parking_corner', to: 'base_parking_aisle_w', oneWay: false, kind: 'driveway' },
    { from: 'base_parking_aisle_w', to: 'base_parking_aisle_e', oneWay: false, kind: 'aisle' },
  ];

  const spots: ParkingSpotNav[] = p.spots.map((spot) => {
    const accessCanvas = isoToCanvas(spot.u, aisleV);
    const entryDirV = spot.row === 0 ? 1 : -1;
    return {
      id: spot.id,
      row: spot.row === 0 ? 'fleet_row_south' : 'fleet_row_north',
      rect: {
        uMin: spot.uMin,
        uMax: spot.uMax,
        vMin: spot.vMin,
        vMax: spot.vMax,
      },
      parkPoint: {
        u: spot.u,
        v: spot.v,
        x: spot.x,
        y: spot.y,
      },
      aisleAccessPoint: {
        u: spot.u,
        v: aisleV,
        x: round1(accessCanvas.x),
        y: round1(accessCanvas.y),
      },
      aisleEdge: ['base_parking_aisle_w', 'base_parking_aisle_e'],
      entryDirIso: { u: 0, v: entryDirV },
      exitDirIso: { u: 0, v: -entryDirV },
    };
  });

  return {
    lotId: p.id,
    kind: 'base_fleet',
    entryRoadNodeId: 'base_parking_road',
    exitRoadNodeId: 'base_parking_road',
    hasSeparateExit: false,
    nodes,
    edges,
    spots,
  };
}

function runInternalDijkstra(
  nodes: Map<string, { u: number; v: number }>,
  adj: Map<string, Array<{ to: string; dist: number }>>,
  startId: string,
  goalId: string
): string[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const unvisited = new Set<string>(nodes.keys());

  for (const id of unvisited) dist.set(id, Infinity);
  dist.set(startId, 0);

  while (unvisited.size > 0) {
    let uId: string | null = null;
    let best = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id)!;
      if (d < best) {
        best = d;
        uId = id;
      }
    }
    if (!uId || best === Infinity) break;
    if (uId === goalId) break;
    unvisited.delete(uId);

    const neighbors = adj.get(uId) ?? [];
    for (const nb of neighbors) {
      if (!unvisited.has(nb.to)) continue;
      const alt = best + nb.dist;
      if (alt < (dist.get(nb.to) ?? Infinity)) {
        dist.set(nb.to, alt);
        prev.set(nb.to, uId);
      }
    }
  }

  if ((dist.get(goalId) ?? Infinity) === Infinity) return null;

  const path: string[] = [];
  let cur: string | undefined = goalId;
  while (cur) {
    path.unshift(cur);
    if (cur === startId) break;
    cur = prev.get(cur);
  }
  return path[0] === startId ? path : null;
}

function buildAugmentedGraphForSpot(
  network: ParkingNavNetwork,
  spot: ParkingSpotNav
): {
  nodes: Map<string, { u: number; v: number }>;
  adj: Map<string, Array<{ to: string; dist: number }>>;
  accessId: string;
} {
  const nodes = new Map<string, { u: number; v: number }>();
  const adj = new Map<string, Array<{ to: string; dist: number }>>();

  for (const n of network.nodes) {
    nodes.set(n.id, { u: n.u, v: n.v });
    adj.set(n.id, []);
  }

  const accessId = '__spot_access__';
  nodes.set(accessId, { u: spot.aisleAccessPoint.u, v: spot.aisleAccessPoint.v });
  adj.set(accessId, []);

  const link = (a: string, b: string) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb) return;
    const d = Math.hypot(nb.u - na.u, nb.v - na.v);
    adj.get(a)!.push({ to: b, dist: d });
  };

  const [targetA, targetB] = spot.aisleEdge;
  let spliced = false;

  for (const e of network.edges) {
    const isTargetFwd = e.from === targetA && e.to === targetB;
    const isTargetRev = !e.oneWay && e.from === targetB && e.to === targetA;
    if (isTargetFwd || isTargetRev) {
      spliced = true;
      link(e.from, accessId);
      link(accessId, e.to);
      if (!e.oneWay) {
        link(e.to, accessId);
        link(accessId, e.from);
      }
    } else {
      link(e.from, e.to);
      if (!e.oneWay) {
        link(e.to, e.from);
      }
    }
  }

  if (!spliced) {
    link(targetA, accessId);
    link(accessId, targetB);
  }

  return { nodes, adj, accessId };
}

function finalizePlannedRoute(
  lotId: string,
  spotId: string,
  direction: 'entry' | 'exit',
  rawIsoPts: Array<{ u: number; v: number }>
): PlannedParkingRoute {
  const isoPoints: Array<{ u: number; v: number }> = [];
  for (const pt of rawIsoPts) {
    const prev = isoPoints[isoPoints.length - 1];
    if (!prev || Math.hypot(pt.u - prev.u, pt.v - prev.v) > 0.2) {
      isoPoints.push({ u: round1(pt.u), v: round1(pt.v) });
    }
  }
  let totalIsoDistance = 0;
  for (let i = 1; i < isoPoints.length; i++) {
    totalIsoDistance += Math.hypot(
      isoPoints[i].u - isoPoints[i - 1].u,
      isoPoints[i].v - isoPoints[i - 1].v
    );
  }
  const canvasPoints = isoPoints.map((p) => {
    const c = isoToCanvas(p.u, p.v);
    return { x: round1(c.x), y: round1(c.y) };
  });
  return {
    lotId,
    spotId,
    direction,
    isoPoints,
    canvasPoints,
    totalIsoDistance: round1(totalIsoDistance),
  };
}

/**
 * Plans an exact collision-free entry trajectory from the street entry node
 * through the parking lot's driving aisles straight into the target parking spot.
 */
export function planParkingEntryRoute(
  network: ParkingNavNetwork,
  spotId: string
): PlannedParkingRoute | null {
  const spot = network.spots.find((s) => s.id === spotId);
  if (!spot) return null;

  const { nodes, adj, accessId } = buildAugmentedGraphForSpot(network, spot);
  const pathIds = runInternalDijkstra(nodes, adj, network.entryRoadNodeId, accessId);
  if (!pathIds) return null;

  const isoPts = pathIds.map((id) => nodes.get(id)!);
  isoPts.push({ u: spot.parkPoint.u, v: spot.parkPoint.v });
  return finalizePlannedRoute(network.lotId, spot.id, 'entry', isoPts);
}

/**
 * Plans an exact collision-free exit trajectory backing/pulling out of the target spot
 * into its serving aisle and continuing out to the parking lot's street exit node.
 */
export function planParkingExitRoute(
  network: ParkingNavNetwork,
  spotId: string
): PlannedParkingRoute | null {
  const spot = network.spots.find((s) => s.id === spotId);
  if (!spot) return null;

  const { nodes, adj, accessId } = buildAugmentedGraphForSpot(network, spot);
  const pathIds = runInternalDijkstra(nodes, adj, accessId, network.exitRoadNodeId);
  if (!pathIds) return null;

  const isoPts: Array<{ u: number; v: number }> = [
    { u: spot.parkPoint.u, v: spot.parkPoint.v },
    ...pathIds.map((id) => nodes.get(id)!),
  ];
  return finalizePlannedRoute(network.lotId, spot.id, 'exit', isoPts);
}

export function buildAllParkingNavNetworks(
  roadGraph: RoadGraph = buildProceduralRoadGraph()
): ParkingNavNetwork[] {
  return [
    ...PROCEDURAL_PARKING_LOTS.map((lot) => buildParkingLotNavNetwork(lot, roadGraph)),
    buildBusStationNavNetwork(BUS_STATION, roadGraph),
    buildBaseParkingNavNetwork(BASE_DEPOT, roadGraph),
  ];
}

export const ALL_PARKING_NAV_NETWORKS: ParkingNavNetwork[] = buildAllParkingNavNetworks();
export const PARKING_NAV_BY_LOT_ID: ReadonlyMap<string, ParkingNavNetwork> = new Map(
  ALL_PARKING_NAV_NETWORKS.map((net) => [net.lotId, net])
);
