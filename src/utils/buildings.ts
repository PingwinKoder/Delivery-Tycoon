import type {
  Building,
  BuildingPalette,
  BuildingType,
  DeliveryStopPoint,
  RoadApproachPoint,
} from '../types/building';
import type { Point, RoadGraph } from '../types/roadGraph';
import {
  ALL_STREETS,
  BASE_DEPOT,
  BUS_STATION,
  CITY_QUARTERS,
  MAP_HEIGHT,
  MAP_WIDTH,
  RESIDENTIAL_ACCESS_ROADS,
  ROUNDABOUTS,
  U_STREETS,
  V_STREETS,
  type CityQuarter,
  type ResidentialAccessRoad,
  type StreetAxis,
  type StreetSpec,
  buildProceduralRoadGraph,
  canvasToIso,
  isPointInsideMap,
  isoToCanvas,
  rectOverlapsActiveStreet,
  rectOverlapsRoundabout,
  streetCoversValue,
} from './cityMap';
import { type HouseYardFence, generateHouseQuarter } from './houseQuarters';
import {
  type ParkingEdgeSide,
  type ParkingLot,
  type PendingParkingCandidate,
  computeStreetJunctionClearance,
  tryPushParking,
} from './parkingLayout';

export type { HouseYardFence } from './houseQuarters';
export type {
  ParkingCenterIslandLayout,
  ParkingDriveway,
  ParkingEdgeSide,
  ParkingLayout,
  ParkingLot,
  ParkingRowLayout,
  ParkingStallRect,
  ParkingStallSpan,
} from './parkingLayout';
export {
  PARKING_CENTER_ISLAND_END_AISLE,
  PARKING_CENTER_ISLAND_ROW_DEPTH,
  PARKING_OUTER_PAD_ALONG,
  PARKING_OUTER_PAD_DEPTH,
  PARKING_STALL_PITCH,
  computeParkingLayout,
  computeStreetJunctionClearance,
} from './parkingLayout';

export interface BuildingPrismPoints {
  bBack: Point;
  bLeft: Point;
  bRight: Point;
  bFront: Point;
  tBack: Point;
  tLeft: Point;
  tRight: Point;
  tFront: Point;
}

export interface DeliveryZoneDriveway {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Axis along which the dedicated delivery driveway extends from bay to street */
  axis: StreetAxis;
  streetId: string;
  /** Minimum clearance (iso units) from nearest roundabout approach zebra or intersection crosswalk */
  junctionClearance: number;
}

export interface DeliveryZone {
  id: string;
  buildingId: string;
  buildingType: 'sklep' | 'dworzec';
  /** Marked loading bay rectangle flush beside the building side wall (iso coordinates) */
  bay: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Dedicated short asphalt driveway directly from the bordering street (independent of parking) */
  driveway: DeliveryZoneDriveway;
  /** Street-edge mouth center where couriers turn off the street into the delivery driveway */
  mouth: { u: number; v: number; x: number; y: number };
  /** Exact courier/van stop point inside the marked delivery bay */
  stop: { u: number; v: number; x: number; y: number };
  /** Unit vector in iso (u, v) pointing from street driveway into the delivery bay */
  entryDir: { u: number; v: number };
}

export interface ParcelLockerSlot {
  id: string;
  quarterId: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Isometric center */
  u: number;
  v: number;
  /** Canvas pixel center */
  x: number;
  y: number;
  /** Long axis orientation of the future parcel locker */
  axis: 'u' | 'v';
  nearestStreetName: string;
  occupied: boolean;
}

type PaletteFootprintBase = Pick<BuildingPalette, 'footprintFill' | 'footprintStroke' | 'accent'>;
type PaletteVariantSpec = Pick<BuildingPalette, 'roof' | 'leftWall' | 'rightWall'> &
  Partial<PaletteFootprintBase>;

const BUILDING_FOOTPRINT_STYLES: Record<BuildingType, PaletteFootprintBase> = {
  baza: {
    footprintFill: 'rgba(249, 115, 22, 0.42)',
    footprintStroke: '#ea580c',
    accent: '#fb923c',
  },
  dworzec: {
    footprintFill: 'rgba(15, 118, 110, 0.46)',
    footprintStroke: '#0d9488',
    accent: '#2dd4bf',
  },
  sklep: {
    footprintFill: 'rgba(37, 99, 235, 0.34)',
    footprintStroke: '#1d4ed8',
    accent: '#93c5fd',
  },
  kiosk: {
    footprintFill: 'rgba(20, 184, 166, 0.40)',
    footprintStroke: '#0d9488',
    accent: '#5eead4',
  },
  blok_wysoki: {
    footprintFill: 'rgba(79, 70, 229, 0.30)',
    footprintStroke: '#4338ca',
    accent: '#818cf8',
  },
  blok_sredni: {
    footprintFill: 'rgba(13, 148, 136, 0.32)',
    footprintStroke: '#0f766e',
    accent: '#2dd4bf',
  },
  blok_maly: {
    footprintFill: 'rgba(217, 119, 6, 0.32)',
    footprintStroke: '#b45309',
    accent: '#f59e0b',
  },
  dom: {
    footprintFill: 'rgba(220, 38, 38, 0.28)',
    footprintStroke: '#b91c1c',
    accent: '#f87171',
  },
};

function buildPalettes(typ: BuildingType, variants: PaletteVariantSpec[]): BuildingPalette[] {
  const base = BUILDING_FOOTPRINT_STYLES[typ];
  return variants.map((v) => ({
    roof: v.roof,
    leftWall: v.leftWall,
    rightWall: v.rightWall,
    footprintFill: v.footprintFill ?? base.footprintFill,
    footprintStroke: v.footprintStroke ?? base.footprintStroke,
    accent: v.accent ?? base.accent,
  }));
}

const PALETTES: Record<BuildingType, BuildingPalette[]> = {
  baza: buildPalettes('baza', [
    { roof: '#ea580c', leftWall: '#788496', rightWall: '#525d6d' },
  ]),
  dworzec: buildPalettes('dworzec', [
    { roof: '#0f766e', leftWall: '#115e59', rightWall: '#134e4a' },
  ]),
  sklep: buildPalettes('sklep', [
    { roof: '#6b8cae', leftWall: '#52708f', rightWall: '#3b536c' },
    { roof: '#5f84a6', leftWall: '#476887', rightWall: '#334d66' },
  ]),
  kiosk: buildPalettes('kiosk', [
    { roof: '#6cd9c6', leftWall: '#4bbca8', rightWall: '#338f80' },
    {
      roof: '#7fd0f2',
      leftWall: '#58aed4',
      rightWall: '#3b82a3',
      footprintFill: 'rgba(14, 165, 233, 0.40)',
      footprintStroke: '#0284c7',
      accent: '#7dd3fc',
    },
  ]),
  blok_wysoki: buildPalettes('blok_wysoki', [
    { roof: '#cfd6dd', leftWall: '#a6b1bc', rightWall: '#788694' },
    {
      roof: '#c1cbd4',
      leftWall: '#94a2b0',
      rightWall: '#687786',
      footprintFill: 'rgba(99, 102, 241, 0.30)',
      footprintStroke: '#3730a3',
    },
    {
      roof: '#d7d5cf',
      leftWall: '#b3b0a8',
      rightWall: '#85827b',
      footprintFill: 'rgba(79, 70, 229, 0.26)',
      footprintStroke: '#4f46e5',
    },
    {
      roof: '#c8d1cc',
      leftWall: '#9da9a3',
      rightWall: '#727f78',
      footprintFill: 'rgba(67, 56, 202, 0.30)',
    },
    {
      roof: '#d6cdd0',
      leftWall: '#b0a3a8',
      rightWall: '#82757a',
      footprintFill: 'rgba(79, 70, 229, 0.32)',
      footprintStroke: '#312e81',
    },
  ]),
  blok_sredni: buildPalettes('blok_sredni', [
    { roof: '#dbd2c3', leftWall: '#bbb09e', rightWall: '#8f8473' },
    {
      roof: '#c8d1c8',
      leftWall: '#a0aca1',
      rightWall: '#768278',
      footprintFill: 'rgba(20, 184, 166, 0.30)',
      footprintStroke: '#115e59',
    },
    {
      roof: '#d8c8ba',
      leftWall: '#b6a392',
      rightWall: '#8a7868',
      footprintFill: 'rgba(13, 148, 136, 0.28)',
      footprintStroke: '#0d9488',
    },
    {
      roof: '#ced4d8',
      leftWall: '#a6afb5',
      rightWall: '#7b858c',
      footprintFill: 'rgba(15, 118, 110, 0.32)',
      footprintStroke: '#134e4a',
    },
    {
      roof: '#e0d6be',
      leftWall: '#c2b598',
      rightWall: '#96896e',
      footprintFill: 'rgba(13, 148, 136, 0.34)',
    },
  ]),
  blok_maly: buildPalettes('blok_maly', [
    { roof: '#e4d5bc', leftWall: '#c8b698', rightWall: '#9d8c70' },
    {
      roof: '#dfcab7',
      leftWall: '#bfa58f',
      rightWall: '#947c67',
      footprintFill: 'rgba(245, 158, 11, 0.30)',
      footprintStroke: '#92400e',
    },
    {
      roof: '#d7d6c5',
      leftWall: '#b5b49f',
      rightWall: '#8a8976',
      footprintFill: 'rgba(217, 119, 6, 0.28)',
    },
    {
      roof: '#e2cfca',
      leftWall: '#c3aba4',
      rightWall: '#978079',
      footprintFill: 'rgba(180, 83, 9, 0.30)',
      footprintStroke: '#78350f',
    },
    {
      roof: '#d2d7d2',
      leftWall: '#aeb6ae',
      rightWall: '#838b83',
      footprintFill: 'rgba(217, 119, 6, 0.34)',
    },
  ]),
  dom: buildPalettes('dom', [
    { roof: '#c97b5d', leftWall: '#e5d5c1', rightWall: '#bfa991' },
    { roof: '#b5674e', leftWall: '#e0d3c5', rightWall: '#b6a595' },
    { roof: '#cf9e6e', leftWall: '#e8dcc9', rightWall: '#c2b29b' },
    { roof: '#8f695a', leftWall: '#e4ded5', rightWall: '#bdb6ac' },
  ]),
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function makeIsoCanvasPoint(
  u: number,
  v: number
): { u: number; v: number; x: number; y: number } {
  const pt = isoToCanvas(u, v);
  return {
    u: round1(u),
    v: round1(v),
    x: round1(pt.x),
    y: round1(pt.y),
  };
}

export function getBuildingPalette(typ: BuildingType, variant = 0): BuildingPalette {
  const list = PALETTES[typ];
  return list[Math.abs(variant) % list.length];
}

/**
 * Pronounced vertical architectural scale (~22-23 px per floor):
 *  - kiosk (1p small pavilion): 18 px
 *  - baza (1p garage): 24 px
 *  - sklep (1p wide flat market): 26 px
 *  - dworzec (2p bus station terminal hall): 46 px
 *  - dom (1-2p): 22 px / 40 px
 *  - blok_maly (3p): 68 px
 *  - blok_sredni (5p): 114 px
 *  - blok_wysoki (7p): 162 px
 */
export function getBuildingHeight(typ: BuildingType, pietra: number): number {
  switch (typ) {
    case 'kiosk':
      return 18;
    case 'baza':
      return 24;
    case 'sklep':
      return 26;
    case 'dworzec':
      return 46;
    case 'dom':
      return pietra <= 1 ? 22 : 40;
    case 'blok_maly':
      return 68;
    case 'blok_sredni':
      return 114;
    case 'blok_wysoki':
      return 162;
  }
}

export function getBuildingPrismPoints(
  b: Pick<Building, 'uMin' | 'uMax' | 'vMin' | 'vMax' | 'height'>
): BuildingPrismPoints {
  const bBack = isoToCanvas(b.uMin, b.vMax);
  const bLeft = isoToCanvas(b.uMin, b.vMin);
  const bRight = isoToCanvas(b.uMax, b.vMax);
  const bFront = isoToCanvas(b.uMax, b.vMin);

  return {
    bBack,
    bLeft,
    bRight,
    bFront,
    tBack: { x: bBack.x, y: bBack.y - b.height },
    tLeft: { x: bLeft.x, y: bLeft.y - b.height },
    tRight: { x: bRight.x, y: bRight.y - b.height },
    tFront: { x: bFront.x, y: bFront.y - b.height },
  };
}

function isBuildingVisibleInMap(
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  height: number
): boolean {
  const pts = getBuildingPrismPoints({ uMin, uMax, vMin, vMax, height });
  const margin = 10;
  const checkPoints = [pts.bBack, pts.bLeft, pts.bRight, pts.bFront, pts.tBack];
  return checkPoints.every((pt) => isPointInsideMap(pt, margin));
}

function distToNearestRoundabout(u: number, v: number): number {
  let best = Infinity;
  for (const rb of ROUNDABOUTS) {
    const d = Math.hypot(u - rb.u, v - rb.v);
    if (d < best) best = d;
  }
  return best;
}

function distToNearestAvenue(u: number, v: number): number {
  let best = Infinity;
  for (const s of ALL_STREETS) {
    if (s.kind !== 'avenue') continue;
    const ortho = s.axis === 'u' ? v : u;
    if (!streetCoversValue(s, ortho, 30)) continue;
    const d = Math.abs((s.axis === 'u' ? u : v) - s.coord);
    if (d < best) best = d;
  }
  return best;
}

interface AddressableRoad {
  id: string;
  name: string;
  axis: StreetAxis;
  coord: number;
  asphaltWidth: number;
  sidewalkWidth: number;
  isAvenue: boolean;
  isAccessRoad: boolean;
  covers: (ortho: number, pad: number) => boolean;
}

const ALL_ADDRESSABLE_ROADS: AddressableRoad[] = [
  ...ALL_STREETS.map((s) => ({
    id: s.id,
    name: s.name,
    axis: s.axis,
    coord: s.coord,
    asphaltWidth: s.asphaltWidth,
    sidewalkWidth: s.sidewalkWidth,
    isAvenue: s.kind === 'avenue',
    isAccessRoad: false,
    covers: (ortho: number, pad: number) => streetCoversValue(s, ortho, pad),
  })),
  ...RESIDENTIAL_ACCESS_ROADS.map((ar) => {
    const minCoord = Math.min(ar.startCoord, ar.endCoord);
    const maxCoord = Math.max(ar.startCoord, ar.endCoord);
    return {
      id: ar.id,
      name: ar.name,
      axis: ar.axis,
      coord: ar.coord,
      asphaltWidth: ar.asphaltWidth,
      sidewalkWidth: ar.sidewalkWidth,
      isAvenue: false,
      isAccessRoad: true,
      covers: (ortho: number, pad: number) => ortho >= minCoord - pad && ortho <= maxCoord + pad,
    };
  }),
];

/**
 * Finds the nearest active street (including residential access roads) bordering a footprint.
 */
export function findNearestStreetForBuilding(
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number
): Pick<StreetSpec, 'id' | 'name' | 'axis' | 'coord'> {
  const cu = (uMin + uMax) / 2;
  const cv = (vMin + vMax) / 2;

  let best: AddressableRoad = ALL_ADDRESSABLE_ROADS[0];
  let bestScore = Infinity;

  for (const road of ALL_ADDRESSABLE_ROADS) {
    const ortho = road.axis === 'u' ? cv : cu;
    if (!road.covers(ortho, 50)) continue;

    const edgeDist =
      road.axis === 'u'
        ? Math.min(Math.abs(uMin - road.coord), Math.abs(uMax - road.coord))
        : Math.min(Math.abs(vMin - road.coord), Math.abs(vMax - road.coord));

    const kindBias = road.isAvenue ? -4 : 0;
    const score = edgeDist + kindBias;

    if (score < bestScore) {
      bestScore = score;
      best = road;
    }
  }

  return { id: best.id, name: best.name, axis: best.axis, coord: best.coord };
}

interface RawBuildingCandidate {
  id: string;
  typ: BuildingType;
  pietra: number;
  mieszkania: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  height: number;
  colorVariant: number;
  forcedStreetId?: string;
  dostepnyDlaDostaw?: boolean;
  stanowiskaAutobusowe?: number;
}

function isApartmentBlock(typ: BuildingType): boolean {
  return typ === 'blok_maly' || typ === 'blok_sredni' || typ === 'blok_wysoki';
}

function rectsOverlap(
  a: { uMin: number; uMax: number; vMin: number; vMax: number },
  b: { uMin: number; uMax: number; vMin: number; vMax: number },
  pad = 2
): boolean {
  return (
    a.uMin < b.uMax + pad &&
    a.uMax + pad > b.uMin &&
    a.vMin < b.vMax + pad &&
    a.vMax + pad > b.vMin
  );
}

function rectOverlapsBaseYard(
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  pad = 6
): boolean {
  return rectsOverlap(
    { uMin, uMax, vMin, vMax },
    {
      uMin: BASE_DEPOT.yardUMin,
      uMax: BASE_DEPOT.yardUMax,
      vMin: BASE_DEPOT.yardVMin,
      vMax: BASE_DEPOT.yardVMax,
    },
    pad
  );
}

/**
 * Exact sweep-line topological Painter's Algorithm sort for non-overlapping (including
 * wall-to-wall touching) axis-aligned boxes in 2:1 isometric projection
 * (camera views from +u, -v toward -u, +v).
 */
export function sortIsoBoxesBackToFront<
  T extends { id: string; uMin: number; uMax: number; vMin: number; vMax: number },
>(items: T[]): T[] {
  const n = items.length;
  if (n <= 1) return [...items];

  const eps = 1e-3;
  const depthKey = (b: T) => b.uMin + b.uMax - (b.vMin + b.vMax);

  // Sweep-line pre-sort by screen-X start (uMin + vMin) so only X-overlapping pairs are checked
  const xSorted = items
    .map((item) => ({
      item,
      xMin: item.uMin + item.vMin,
      xMax: item.uMax + item.vMax,
      depth: depthKey(item),
    }))
    .sort((a, b) => a.xMin - b.xMin);

  const adj: number[][] = Array.from({ length: n }, () => []);
  const inDegree = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const a = xSorted[i];
    for (let j = i + 1; j < n; j++) {
      const b = xSorted[j];
      if (b.xMin >= a.xMax - eps) break;
      if (isBoxBehind(a.item, b.item, eps)) {
        adj[i].push(j);
        inDegree[j]++;
      } else if (isBoxBehind(b.item, a.item, eps)) {
        adj[j].push(i);
        inDegree[i]++;
      }
    }
  }

  const ready: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) ready.push(i);
  }
  ready.sort((ia, ib) => xSorted[ia].depth - xSorted[ib].depth);

  const insertReady = (idx: number) => {
    const d = xSorted[idx].depth;
    let lo = 0;
    let hi = ready.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (xSorted[ready[mid]].depth <= d) lo = mid + 1;
      else hi = mid;
    }
    ready.splice(lo, 0, idx);
  };

  const ordered: T[] = [];
  while (ready.length > 0) {
    const cur = ready.shift()!;
    ordered.push(xSorted[cur].item);
    for (const nxt of adj[cur]) {
      inDegree[nxt]--;
      if (inDegree[nxt] === 0) {
        insertReady(nxt);
      }
    }
  }

  if (ordered.length < n) {
    const included = new Set(ordered.map((b) => b.id));
    const remaining = items
      .filter((b) => !included.has(b.id))
      .sort((a, b) => depthKey(a) - depthKey(b));
    ordered.push(...remaining);
  }

  return ordered;
}

/**
 * Exact topological Painter's Algorithm sort for non-overlapping (including wall-to-wall
 * touching) axis-aligned boxes in 2:1 isometric projection (camera views from +u, -v toward -u, +v).
 */
export function sortBuildingsBackToFront(buildings: Building[]): Building[] {
  return sortIsoBoxesBackToFront(buildings);
}

export interface FenceSegment3D {
  id: string;
  axis: 'u' | 'v';
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  height: number;
  prism: BuildingPrismPoints;
  sx: number;
  sy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Precomputed vertical picket/board division lines on the front-facing long wall */
  pickets: Array<{ x: number; yBottom: number; yTop: number }>;
}

export interface FencePost3D {
  id: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  height: number;
  isGatePost: boolean;
  prism: BuildingPrismPoints;
  sx: number;
  sy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PrecomputedBuilding3D {
  building: Building;
  prism: BuildingPrismPoints;
  sx: number;
  sy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type StaticScene3DItem =
  | {
      kind: 'building';
      id: string;
      item: PrecomputedBuilding3D;
      uMin: number;
      uMax: number;
      vMin: number;
      vMax: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }
  | {
      kind: 'fenceSegment';
      id: string;
      segment: FenceSegment3D;
      uMin: number;
      uMax: number;
      vMin: number;
      vMax: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }
  | {
      kind: 'fencePost';
      id: string;
      post: FencePost3D;
      uMin: number;
      uMax: number;
      vMin: number;
      vMax: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    };

const FENCE_PANEL_HEIGHT = 7.5;
const FENCE_PANEL_HALF_THICK = 0.7;
const CORNER_POST_HEIGHT = 9.0;
const CORNER_POST_HALF = 1.1;
const GATE_POST_HEIGHT = 9.5;
const GATE_POST_HALF = 1.2;
const FENCE_PICKET_PITCH = 4.5;

/**
 * Converts all single-family house yard perimeters into deduplicated, non-overlapping 3D
 * wooden picket fence panel segments and thicker/taller corner & gate posts, keeping every
 * street-facing gate interval [gateMin, gateMax] completely open.
 */
export function buildHouseFence3DGeometry(houseYards: HouseYardFence[]): {
  segments: FenceSegment3D[];
  posts: FencePost3D[];
} {
  type RawPost = {
    u: number;
    v: number;
    isGatePost: boolean;
    half: number;
    height: number;
  };
  type LineGroup = {
    axis: 'u' | 'v';
    fixedCoord: number;
    intervals: Array<{ start: number; end: number }>;
  };

  const uniquePosts: RawPost[] = [];
  const registerPost = (u: number, v: number, isGatePost: boolean) => {
    const half = isGatePost ? GATE_POST_HALF : CORNER_POST_HALF;
    const height = isGatePost ? GATE_POST_HEIGHT : CORNER_POST_HEIGHT;
    for (const p of uniquePosts) {
      if (
        Math.abs(p.u - u) < p.half + half + 0.05 &&
        Math.abs(p.v - v) < p.half + half + 0.05
      ) {
        if (isGatePost && !p.isGatePost) {
          p.isGatePost = true;
          p.half = GATE_POST_HALF;
          p.height = GATE_POST_HEIGHT;
        }
        return;
      }
    }
    uniquePosts.push({ u, v, isGatePost, half, height });
  };

  const lineGroups = new Map<string, LineGroup>();
  const addLineInterval = (
    axis: 'u' | 'v',
    fixedCoord: number,
    start: number,
    end: number
  ) => {
    if (end - start < 0.5) return;
    const key = `${axis}:${Math.round(fixedCoord * 10)}`;
    let group = lineGroups.get(key);
    if (!group) {
      group = { axis, fixedCoord, intervals: [] };
      lineGroups.set(key, group);
    }
    group.intervals.push({ start, end });
  };

  for (const yard of houseYards) {
    const { uMin, uMax, vMin, vMax, streetSide, gateMin, gateMax } = yard;

    // 4 yard corner posts
    registerPost(uMin, vMin, false);
    registerPost(uMax, vMin, false);
    registerPost(uMax, vMax, false);
    registerPost(uMin, vMax, false);

    // 2 sturdier gate posts framing the open entrance [gateMin, gateMax] on streetSide
    if (streetSide === 'uMin' || streetSide === 'uMax') {
      const u = streetSide === 'uMin' ? uMin : uMax;
      registerPost(u, gateMin, true);
      registerPost(u, gateMax, true);
    } else {
      const v = streetSide === 'vMin' ? vMin : vMax;
      registerPost(gateMin, v, true);
      registerPost(gateMax, v, true);
    }

    // uMin & uMax edges (running along v)
    if (streetSide === 'uMin') {
      addLineInterval('v', uMin, vMin, gateMin);
      addLineInterval('v', uMin, gateMax, vMax);
    } else {
      addLineInterval('v', uMin, vMin, vMax);
    }

    if (streetSide === 'uMax') {
      addLineInterval('v', uMax, vMin, gateMin);
      addLineInterval('v', uMax, gateMax, vMax);
    } else {
      addLineInterval('v', uMax, vMin, vMax);
    }

    // vMin & vMax edges (running along u)
    if (streetSide === 'vMin') {
      addLineInterval('u', vMin, uMin, gateMin);
      addLineInterval('u', vMin, gateMax, uMax);
    } else {
      addLineInterval('u', vMin, uMin, uMax);
    }

    if (streetSide === 'vMax') {
      addLineInterval('u', vMax, uMin, gateMin);
      addLineInterval('u', vMax, gateMax, uMax);
    } else {
      addLineInterval('u', vMax, uMin, uMax);
    }
  }

  const segments: FenceSegment3D[] = [];
  let segSeq = 0;

  for (const group of lineGroups.values()) {
    const { axis, fixedCoord, intervals } = group;
    const rawSplits: number[] = [];
    for (const iv of intervals) {
      rawSplits.push(iv.start, iv.end);
    }

    // Also split at any corner/T-junction/gate post intersecting this line so panels never overlap posts
    const touchingPosts: Array<{ along: number; half: number }> = [];
    for (const p of uniquePosts) {
      const perpDist = Math.abs((axis === 'u' ? p.v : p.u) - fixedCoord);
      if (perpDist <= p.half + FENCE_PANEL_HALF_THICK + 0.05) {
        const along = axis === 'u' ? p.u : p.v;
        touchingPosts.push({ along, half: p.half });
        rawSplits.push(along);
      }
    }

    rawSplits.sort((a, b) => a - b);
    const splits: number[] = [];
    for (const val of rawSplits) {
      if (splits.length === 0 || val - splits[splits.length - 1] > 0.05) {
        splits.push(val);
      }
    }

    const findPostTrim = (alongCoord: number): number => {
      let trim = 0;
      for (const tp of touchingPosts) {
        if (Math.abs(tp.along - alongCoord) <= tp.half + 0.15) {
          trim = Math.max(trim, tp.half);
        }
      }
      return trim;
    };

    for (let i = 0; i < splits.length - 1; i++) {
      const a = splits[i];
      const b = splits[i + 1];
      const mid = (a + b) * 0.5;
      const covered = intervals.some((iv) => mid >= iv.start + 0.02 && mid <= iv.end - 0.02);
      if (!covered) continue;

      const startTrim = findPostTrim(a);
      const endTrim = findPostTrim(b);
      const trimmedStart = a + startTrim;
      const trimmedEnd = b - endTrim;
      const segLen = trimmedEnd - trimmedStart;
      if (segLen < 0.4) continue;

      const uMin = axis === 'u' ? trimmedStart : fixedCoord - FENCE_PANEL_HALF_THICK;
      const uMax = axis === 'u' ? trimmedEnd : fixedCoord + FENCE_PANEL_HALF_THICK;
      const vMin = axis === 'u' ? fixedCoord - FENCE_PANEL_HALF_THICK : trimmedStart;
      const vMax = axis === 'u' ? fixedCoord + FENCE_PANEL_HALF_THICK : trimmedEnd;

      const prism = getBuildingPrismPoints({
        uMin,
        uMax,
        vMin,
        vMax,
        height: FENCE_PANEL_HEIGHT,
      });

      const sx = FENCE_PANEL_HEIGHT * 0.24;
      const sy = FENCE_PANEL_HEIGHT * 0.04;

      const pickets: Array<{ x: number; yBottom: number; yTop: number }> = [];
      const picketCount = Math.max(1, Math.round(segLen / FENCE_PICKET_PITCH));
      if (picketCount >= 2) {
        const step = segLen / picketCount;
        for (let k = 1; k < picketCount; k++) {
          const alongPos = trimmedStart + k * step;
          const pt =
            axis === 'u' ? isoToCanvas(alongPos, vMin) : isoToCanvas(uMax, alongPos);
          pickets.push({
            x: pt.x,
            yBottom: pt.y,
            yTop: pt.y - FENCE_PANEL_HEIGHT,
          });
        }
      }

      segments.push({
        id: `fence_seg_${segSeq++}`,
        axis,
        uMin,
        uMax,
        vMin,
        vMax,
        height: FENCE_PANEL_HEIGHT,
        prism,
        sx,
        sy,
        minX: prism.bLeft.x - 2,
        maxX: prism.bRight.x + sx + 2,
        minY: prism.tBack.y - 2,
        maxY: prism.bFront.y + 2,
        pickets,
      });
    }
  }

  const posts: FencePost3D[] = uniquePosts.map((p, idx) => {
    const uMin = p.u - p.half;
    const uMax = p.u + p.half;
    const vMin = p.v - p.half;
    const vMax = p.v + p.half;
    const prism = getBuildingPrismPoints({
      uMin,
      uMax,
      vMin,
      vMax,
      height: p.height,
    });
    const sx = p.height * 0.24;
    const sy = p.height * 0.04;
    return {
      id: `fence_post_${idx}`,
      uMin,
      uMax,
      vMin,
      vMax,
      height: p.height,
      isGatePost: p.isGatePost,
      prism,
      sx,
      sy,
      minX: prism.bLeft.x - 2,
      maxX: prism.bRight.x + sx + 2,
      minY: prism.tBack.y - 2,
      maxY: prism.bFront.y + 2,
    };
  });

  return { segments, posts };
}

/**
 * Builds and topologically sorts the complete static 3D scene (buildings + 3D wooden yard
 * fence segments + corner/gate posts) once so per-frame rendering only sorts dynamic entities.
 */
export function buildStaticScene3DOrder(
  buildings: Building[],
  houseYards: HouseYardFence[]
): StaticScene3DItem[] {
  const items: StaticScene3DItem[] = [];

  for (const b of buildings) {
    const prism = getBuildingPrismPoints(b);
    const sx = Math.min(36, b.height * 0.23);
    const sy = Math.min(6, b.height * 0.035);
    const minX = prism.bLeft.x;
    const maxX = prism.bRight.x + sx;
    const minY = prism.tBack.y;
    const maxY = prism.bFront.y;
    items.push({
      kind: 'building',
      id: b.id,
      item: { building: b, prism, sx, sy, minX, maxX, minY, maxY },
      uMin: b.uMin,
      uMax: b.uMax,
      vMin: b.vMin,
      vMax: b.vMax,
      minX,
      maxX,
      minY,
      maxY,
    });
  }

  const { segments, posts } = buildHouseFence3DGeometry(houseYards);

  for (const segment of segments) {
    items.push({
      kind: 'fenceSegment',
      id: segment.id,
      segment,
      uMin: segment.uMin,
      uMax: segment.uMax,
      vMin: segment.vMin,
      vMax: segment.vMax,
      minX: segment.minX,
      maxX: segment.maxX,
      minY: segment.minY,
      maxY: segment.maxY,
    });
  }

  for (const post of posts) {
    items.push({
      kind: 'fencePost',
      id: post.id,
      post,
      uMin: post.uMin,
      uMax: post.uMax,
      vMin: post.vMin,
      vMax: post.vMax,
      minX: post.minX,
      maxX: post.maxX,
      minY: post.minY,
      maxY: post.maxY,
    });
  }

  return sortIsoBoxesBackToFront(items);
}

export interface DepthSortedEntity {
  id: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export type DepthSceneItem<TBuilding extends { uMin: number; uMax: number; vMin: number; vMax: number }> =
  | { kind: 'building'; item: TBuilding }
  | { kind: 'entity'; entity: DepthSortedEntity };

function isBoxBehind(
  a: { uMin: number; uMax: number; vMin: number; vMax: number },
  b: { uMin: number; uMax: number; vMin: number; vMax: number },
  eps = 1e-3
): boolean {
  const aXMin = a.uMin + a.vMin;
  const aXMax = a.uMax + a.vMax;
  const bXMin = b.uMin + b.vMin;
  const bXMax = b.uMax + b.vMax;
  if (aXMax <= bXMin + eps || bXMax <= aXMin + eps) return false;
  const aBehindB = a.uMax <= b.uMin + eps || a.vMin >= b.vMax - eps;
  const bBehindA = b.uMax <= a.uMin + eps || b.vMin >= a.vMax - eps;
  return aBehindB && !bBehindA;
}

/**
 * Interleaves dynamic isometric entities (e.g. BAZA bike rack, courier on bicycle) into an already
 * topologically sorted back-to-front building list, preserving 100% of building-to-building and
 * entity-to-building occlusion relationships so tall buildings naturally hide a courier passing behind them.
 */
export function mergeEntitiesIntoBackToFrontOrder<
  TBuilding extends { uMin: number; uMax: number; vMin: number; vMax: number },
>(
  buildingsBackToFront: TBuilding[],
  entities: DepthSortedEntity[]
): Array<DepthSceneItem<TBuilding>> {
  let list: Array<DepthSceneItem<TBuilding>> = buildingsBackToFront.map((item) => ({
    kind: 'building',
    item,
  }));

  if (entities.length === 0) return list;

  // Sort entities back-to-front by isometric depth before inserting sequentially
  const sortedEntities = [...entities].sort(
    (a, b) => a.uMin + a.uMax - (a.vMin + a.vMax) - (b.uMin + b.uMax - (b.vMin + b.vMax))
  );

  const getBox = (entry: DepthSceneItem<TBuilding>) =>
    entry.kind === 'building' ? entry.item : entry.entity;

  for (const entity of sortedEntities) {
    const before: Array<DepthSceneItem<TBuilding>> = [];
    const after: Array<DepthSceneItem<TBuilding>> = [];

    for (const entry of list) {
      const box = getBox(entry);
      let mustFollowEntity = isBoxBehind(entity, box);
      if (!mustFollowEntity && after.length > 0) {
        for (const prevAfter of after) {
          if (isBoxBehind(getBox(prevAfter), box)) {
            mustFollowEntity = true;
            break;
          }
        }
      }
      if (mustFollowEntity) {
        after.push(entry);
      } else {
        before.push(entry);
      }
    }

    list = [...before, { kind: 'entity', entity }, ...after];
  }

  return list;
}

function blockSpecs(typ: 'blok_maly' | 'blok_sredni' | 'blok_wysoki'): {
  pietra: number;
  mieszkania: number;
} {
  switch (typ) {
    case 'blok_wysoki':
      return { pietra: 7, mieszkania: 14 };
    case 'blok_sredni':
      return { pietra: 5, mieszkania: 10 };
    case 'blok_maly':
      return { pietra: 3, mieszkania: 6 };
  }
}

function splitContiguousSpan(
  start: number,
  end: number,
  minLen: number,
  maxLen: number
): Array<[number, number]> {
  const total = end - start;
  if (total < minLen) return [];
  const ideal = (minLen + maxLen) / 2;
  let count = Math.max(1, Math.round(total / ideal));
  while (count > 1 && total / count < minLen) {
    count--;
  }
  while (total / count > maxLen) {
    count++;
  }
  const segLen = total / count;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const a = start + i * segLen;
    const b = i === count - 1 ? end : start + (i + 1) * segLen;
    out.push([a, b]);
  }
  return out;
}

type CornerKey = 'nw' | 'ne' | 'sw' | 'se';

function findRoundaboutCorner(q: CityQuarter): CornerKey | null {
  const corners: Array<{ key: CornerKey; u: number; v: number }> = [
    { key: 'nw', u: q.uMin, v: q.vMin },
    { key: 'ne', u: q.uMin, v: q.vMax },
    { key: 'sw', u: q.uMax, v: q.vMin },
    { key: 'se', u: q.uMax, v: q.vMax },
  ];
  let bestKey: CornerKey | null = null;
  let bestDist = Infinity;
  for (const c of corners) {
    const d = distToNearestRoundabout(c.u, c.v);
    if (d < 150 && d < bestDist) {
      bestDist = d;
      bestKey = c.key;
    }
  }
  return bestKey;
}

/**
 * Selects up to `targetCount` spatially well-spread candidates using greedy farthest-point sampling
 * so kiosks and parcel locker slots distribute evenly across all city districts.
 */
function selectSpatiallySpread<T extends { u: number; v: number; quarterId: string }>(
  candidates: T[],
  targetCount: number,
  maxPerQuarter = 1
): T[] {
  if (candidates.length === 0 || targetCount <= 0) return [];
  const chosen: T[] = [];
  const usedQuarterCount = new Map<string, number>();

  // Deterministic anchor: start with the candidate closest to city center-west (near BAZA/R1)
  let firstIdx = 0;
  let bestStartScore = Infinity;
  candidates.forEach((c, i) => {
    const d = Math.hypot(c.u - 100, c.v + 400);
    if (d < bestStartScore) {
      bestStartScore = d;
      firstIdx = i;
    }
  });

  const first = candidates[firstIdx];
  chosen.push(first);
  usedQuarterCount.set(first.quarterId, 1);

  while (chosen.length < targetCount) {
    let bestCand: T | null = null;
    let bestMinDist = -1;

    for (const cand of candidates) {
      const qCount = usedQuarterCount.get(cand.quarterId) ?? 0;
      if (qCount >= maxPerQuarter) continue;

      let minDist = Infinity;
      for (const prev of chosen) {
        const d = Math.hypot(cand.u - prev.u, cand.v - prev.v);
        if (d < minDist) minDist = d;
      }

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestCand = cand;
      }
    }

    if (!bestCand || bestMinDist < 45) break;
    chosen.push(bestCand);
    usedQuarterCount.set(bestCand.quarterId, (usedQuarterCount.get(bestCand.quarterId) ?? 0) + 1);
  }

  return chosen;
}

export interface ProceduralCityStructures {
  buildings: Building[];
  parkingLots: ParkingLot[];
  deliveryZones: DeliveryZone[];
  parcelLockerSlots: ParcelLockerSlot[];
  houseYards: HouseYardFence[];
}

/**
 * Generates the dense urban city from CITY_QUARTERS:
 *  - 'base': BAZA garage hall (parking lot + internal asphalt road owned by BASE_DEPOT.parking)
 *  - 'park': exactly 2 reserved green parks (0 buildings, 0 parking)
 *  - 'market': wide low market hall + spacious isometric parking lot with street driveway
 *  - 'blocks': wall-to-wall connected (0 px gap) L/U apartment frontages + courtyard parking lots
 *              with straight street driveways + ~20 kiosks + 8 reserved parcel locker slots
 *  - 'houses': dense single-family house estates on pure green grass, split cleanly by narrow
 *              2-lane residential access roads so every interior house has direct street access
 */
export function buildProceduralCityStructures(): ProceduralCityStructures {
  const raw: RawBuildingCandidate[] = [];
  const parkingLots: ParkingLot[] = [];
  const houseYards: HouseYardFence[] = [];
  const pendingParking: PendingParkingCandidate[] = [];
  let bSeq = 0;
  let pSeq = 0;

  const uSorted = [...U_STREETS].sort((a, b) => a.coord - b.coord);
  const vSorted = [...V_STREETS].sort((a, b) => a.coord - b.coord);
  const accessRoadByQuarter = new Map<string, ResidentialAccessRoad>(
    RESIDENTIAL_ACCESS_ROADS.map((ar) => [ar.quarterId, ar])
  );

  const tryPush = (
    candidate: Omit<RawBuildingCandidate, 'id' | 'height'> & {
      id?: string;
      allowBaseYard?: boolean;
    }
  ): RawBuildingCandidate | null => {
    const height = getBuildingHeight(candidate.typ, candidate.pietra);
    if (candidate.uMax - candidate.uMin < 18 || candidate.vMax - candidate.vMin < 18) return null;
    if (!isBuildingVisibleInMap(candidate.uMin, candidate.uMax, candidate.vMin, candidate.vMax, height)) {
      return null;
    }
    if (rectOverlapsActiveStreet(candidate.uMin, candidate.uMax, candidate.vMin, candidate.vMax)) {
      return null;
    }
    if (rectOverlapsRoundabout(candidate.uMin, candidate.uMax, candidate.vMin, candidate.vMax, 10)) {
      return null;
    }
    if (!candidate.allowBaseYard && rectOverlapsBaseYard(candidate.uMin, candidate.uMax, candidate.vMin, candidate.vMax, 6)) {
      return null;
    }

    const candIsBlock = isApartmentBlock(candidate.typ);
    for (const existing of raw) {
      const pad = candIsBlock && isApartmentBlock(existing.typ) ? -0.5 : 6;
      if (rectsOverlap(existing, candidate, pad)) {
        return null;
      }
    }

    const placed: RawBuildingCandidate = {
      id: candidate.id ?? `b_${++bSeq}`,
      typ: candidate.typ,
      pietra: candidate.pietra,
      mieszkania: candidate.mieszkania,
      uMin: candidate.uMin,
      uMax: candidate.uMax,
      vMin: candidate.vMin,
      vMax: candidate.vMax,
      height,
      colorVariant: candidate.colorVariant,
      forcedStreetId: candidate.forcedStreetId,
      dostepnyDlaDostaw: candidate.dostepnyDlaDostaw,
      stanowiskaAutobusowe: candidate.stanowiskaAutobusowe,
    };
    raw.push(placed);
    return placed;
  };

  const tryPushBlock = (
    preferred: 'blok_wysoki' | 'blok_sredni' | 'blok_maly',
    uMin: number,
    uMax: number,
    vMin: number,
    vMax: number,
    colorVariant: number
  ): RawBuildingCandidate | null => {
    const order: Array<'blok_wysoki' | 'blok_sredni' | 'blok_maly'> =
      preferred === 'blok_wysoki'
        ? ['blok_wysoki', 'blok_sredni', 'blok_maly']
        : preferred === 'blok_sredni'
          ? ['blok_sredni', 'blok_maly']
          : ['blok_maly'];

    for (const typ of order) {
      const { pietra, mieszkania } = blockSpecs(typ);
      const placed = tryPush({ typ, pietra, mieszkania, uMin, uMax, vMin, vMax, colorVariant });
      if (placed) return placed;
    }
    return null;
  };

  const pickFrontageBlockType = (
    u: number,
    v: number,
    stepIdx: number,
    quarterSeed: number,
    prevType: BuildingType | null
  ): 'blok_wysoki' | 'blok_sredni' | 'blok_maly' => {
    const distRb = distToNearestRoundabout(u, v);
    const distAve = distToNearestAvenue(u, v);
    const distCenter = Math.hypot(u, v);

    let pattern: Array<'blok_wysoki' | 'blok_sredni' | 'blok_maly'>;
    if (distRb < 420) {
      pattern = ['blok_wysoki', 'blok_sredni', 'blok_wysoki', 'blok_maly', 'blok_sredni'];
    } else if (distAve < 155 && distCenter < 1150) {
      pattern = ['blok_sredni', 'blok_wysoki', 'blok_maly', 'blok_sredni', 'blok_wysoki'];
    } else if (distAve < 250 || distCenter < 1080) {
      pattern = ['blok_maly', 'blok_sredni', 'blok_wysoki', 'blok_sredni', 'blok_maly'];
    } else {
      pattern = ['blok_maly', 'blok_sredni', 'blok_maly', 'blok_sredni'];
    }

    let chosen = pattern[(quarterSeed + stepIdx) % pattern.length];
    if (chosen === prevType && (quarterSeed + stepIdx) % 3 !== 0) {
      chosen =
        chosen === 'blok_wysoki'
          ? 'blok_sredni'
          : chosen === 'blok_sredni'
            ? distAve < 180
              ? 'blok_wysoki'
              : 'blok_maly'
            : 'blok_sredni';
    }
    return chosen;
  };

  const queueParking = (
    quarter: CityQuarter,
    uMin: number,
    uMax: number,
    vMin: number,
    vMax: number,
    kind: ParkingLot['kind'],
    preferredAxis?: 'u' | 'v'
  ) => {
    pendingParking.push({ quarter, uMin, uMax, vMin, vMax, kind, preferredAxis });
  };

  // 1. BAZA depot garage hall on flush concrete yard (its fleet parking lot + internal asphalt road
  //    live directly on BASE_DEPOT.parking)
  tryPush({
    id: 'b_base_garage',
    typ: 'baza',
    pietra: 1,
    mieszkania: 0,
    uMin: 208,
    uMax: 282,
    vMin: -992,
    vMax: -880,
    colorVariant: 0,
    forcedStreetId: 'u_4', // al. Główna
    allowBaseYard: true,
    dostepnyDlaDostaw: false,
  });

  // 1b. Central Bus Station (Dworzec Autobusowy) on q_3_4 directly along al. Dworcowa
  //     Expanded terminal footprint absorbing the former platform reserve strip
  tryPush({
    id: 'b_bus_station',
    typ: 'dworzec',
    pietra: 2,
    mieszkania: 0,
    uMin: BUS_STATION.terminalFootprint.uMin,
    uMax: BUS_STATION.terminalFootprint.uMax,
    vMin: BUS_STATION.terminalFootprint.vMin,
    vMax: BUS_STATION.terminalFootprint.vMax,
    colorVariant: 0,
    forcedStreetId: BUS_STATION.streetId, // al. Dworcowa
    dostepnyDlaDostaw: true,
    stanowiskaAutobusowe: BUS_STATION.busBays.length,
  });

  // 2. Populate every quarter according to its urban zoning kind
  CITY_QUARTERS.forEach((q, qIdx) => {
    if (q.kind === 'base' || q.kind === 'park' || q.kind === 'bus_station') return;

    const rbCorner = findRoundaboutCorner(q);

    // -------------------------------------------------------------------------
    // 2A. MARKET QUARTER: Wide flat market hall + dedicated side delivery bay +
    //     large isometric customer parking lot
    // -------------------------------------------------------------------------
    if (q.kind === 'market') {
      const inset = 10;
      const bu0 = q.uMin + inset;
      const bu1 = q.uMax - inset;
      const bv0 = q.vMin + inset;
      const bv1 = q.vMax - inset;
      const uW = bu1 - bu0;
      const vW = bv1 - bv0;

      const splitAlongU = uW >= vW;
      const marketOnHigh =
        rbCorner === 'nw' || rbCorner === 'ne' || (!rbCorner && qIdx % 2 === 0);
      const deliveryReserve = 36;

      let placedMarket: RawBuildingCandidate | null = null;
      if (splitAlongU) {
        const hallDepth = Math.min(136, Math.max(106, uW * 0.46));
        const mU0 = marketOnHigh ? bu1 - hallDepth : bu0;
        const mU1 = marketOnHigh ? bu1 : bu0 + hallDepth;
        let mV0 = bv0 + 6;
        let mV1 = bv1 - 6;
        if (rbCorner === 'nw' && !marketOnHigh) mV0 += 42;
        if (rbCorner === 'ne' && !marketOnHigh) mV1 -= 42;
        if (rbCorner === 'sw' && marketOnHigh) mV0 += 42;
        if (rbCorner === 'se' && marketOnHigh) mV1 -= 42;

        // Reserve a clean side strip for the market's dedicated delivery zone & independent driveway
        // Prefer camera-facing -v (SW) side unless a roundabout sits near vMin
        const reserveOnVMax = rbCorner === 'nw' || rbCorner === 'sw';
        if (reserveOnVMax) {
          mV1 -= deliveryReserve;
        } else {
          mV0 += deliveryReserve;
        }

        placedMarket =
          tryPush({
            typ: 'sklep',
            pietra: 1,
            mieszkania: 0,
            uMin: mU0,
            uMax: mU1,
            vMin: mV0,
            vMax: mV1,
            colorVariant: qIdx % 2,
          }) ??
          tryPush({
            typ: 'sklep',
            pietra: 1,
            mieszkania: 0,
            uMin: mU0,
            uMax: mU1,
            vMin: mV0 + 14,
            vMax: mV1 - 14,
            colorVariant: qIdx % 2,
          });

        if (placedMarket) {
          const pU0 = marketOnHigh ? bu0 + 4 : placedMarket.uMax + 14;
          const pU1 = marketOnHigh ? placedMarket.uMin - 14 : bu1 - 4;
          queueParking(q, pU0, pU1, bv0 + 4, bv1 - 4, 'market', 'v');
        }
      } else {
        const hallDepth = Math.min(136, Math.max(106, vW * 0.46));
        const mV0 = marketOnHigh ? bv1 - hallDepth : bv0;
        const mV1 = marketOnHigh ? bv1 : bv0 + hallDepth;
        let mU0 = bu0 + 6;
        let mU1 = bu1 - 6;
        if (rbCorner === 'nw' && !marketOnHigh) mU0 += 42;
        if (rbCorner === 'sw' && !marketOnHigh) mU1 -= 42;
        if (rbCorner === 'ne' && marketOnHigh) mU0 += 42;
        if (rbCorner === 'se' && marketOnHigh) mU1 -= 42;

        // Reserve a clean side strip for the market's dedicated delivery zone & independent driveway
        // Prefer camera-facing +u (SE) side unless a roundabout sits near uMax (sw or se corner)
        const reserveOnUMin = rbCorner === 'sw' || rbCorner === 'se';
        if (reserveOnUMin) {
          mU0 += deliveryReserve;
        } else {
          mU1 -= deliveryReserve;
        }

        placedMarket =
          tryPush({
            typ: 'sklep',
            pietra: 1,
            mieszkania: 0,
            uMin: mU0,
            uMax: mU1,
            vMin: mV0,
            vMax: mV1,
            colorVariant: qIdx % 2,
          }) ??
          tryPush({
            typ: 'sklep',
            pietra: 1,
            mieszkania: 0,
            uMin: mU0 + 14,
            uMax: mU1 - 14,
            vMin: mV0,
            vMax: mV1,
            colorVariant: qIdx % 2,
          });

        if (placedMarket) {
          const pV0 = marketOnHigh ? bv0 + 4 : placedMarket.vMax + 14;
          const pV1 = marketOnHigh ? placedMarket.vMin - 14 : bv1 - 4;
          queueParking(q, bu0 + 4, bu1 - 4, pV0, pV1, 'market', 'u');
        }
      }

      if (!placedMarket) {
        const mU0 = bu0 + 18;
        const mU1 = bu0 + Math.min(132, uW * 0.52);
        const mV0 = bv0 + 18 + deliveryReserve;
        const mV1 = bv1 - 18;
        placedMarket = tryPush({
          typ: 'sklep',
          pietra: 1,
          mieszkania: 0,
          uMin: mU0,
          uMax: mU1,
          vMin: mV0,
          vMax: mV1,
          colorVariant: qIdx % 2,
        });
        if (placedMarket) {
          queueParking(q, placedMarket.uMax + 14, bu1 - 4, bv0 + 4, bv1 - 4, 'market', 'v');
        }
      }
      return;
    }

    // -------------------------------------------------------------------------
    // 2B. APARTMENT BLOCKS QUARTER: Wall-to-wall connected (0 px gap) L & U
    //     street frontages + isometric courtyard parking lots with street driveways
    // -------------------------------------------------------------------------
    if (q.kind === 'blocks') {
      const inset = 6;
      const bu0 = q.uMin + inset;
      const bu1 = q.uMax - inset;
      const bv0 = q.vMin + inset;
      const bv1 = q.vMax - inset;
      const uW = bu1 - bu0;
      const vW = bv1 - bv0;
      if (uW < 54 || vW < 54) return;

      const depth = 46;
      const seed = q.ui * 13 + q.vi * 7 + qIdx;
      let stepCounter = 0;
      let prevVariant = seed % 5;
      let prevType: BuildingType | null = null;

      const placeContiguousStrip = (
        axis: 'u' | 'v',
        fixedMin: number,
        fixedMax: number,
        spanStart: number,
        spanEnd: number
      ) => {
        const segs = splitContiguousSpan(spanStart, spanEnd, 46, 70);
        for (const [s0, s1] of segs) {
          const u0 = axis === 'v' ? fixedMin : s0;
          const u1 = axis === 'v' ? fixedMax : s1;
          const v0 = axis === 'v' ? s0 : fixedMin;
          const v1 = axis === 'v' ? s1 : fixedMax;

          const cu = (u0 + u1) / 2;
          const cv = (v0 + v1) / 2;
          const typ = pickFrontageBlockType(cu, cv, stepCounter, seed, prevType);
          const variant = (prevVariant + 1 + ((seed + stepCounter) % 3)) % 5;

          const placed = tryPushBlock(typ, u0, u1, v0, v1, variant);
          if (placed) {
            prevVariant = variant;
            prevType = placed.typ;
          }
          stepCounter++;
        }
      };

      type LayoutMode =
        | 'U_open_se'
        | 'U_open_nw'
        | 'U_open_sw'
        | 'U_open_ne'
        | 'L_nw_sw'
        | 'L_nw_ne'
        | 'L_se_sw'
        | 'L_se_ne';

      let mode: LayoutMode;
      if (rbCorner === 'se') {
        mode = 'L_nw_sw';
      } else if (rbCorner === 'sw') {
        mode = 'L_nw_ne';
      } else if (rbCorner === 'ne') {
        mode = 'L_se_sw';
      } else if (rbCorner === 'nw') {
        mode = 'L_se_ne';
      } else if (uW >= 185 && vW >= 185) {
        const modes: LayoutMode[] = [
          'U_open_se',
          'L_nw_ne',
          'U_open_sw',
          'L_se_sw',
          'U_open_ne',
          'U_open_nw',
          'L_nw_sw',
          'L_se_ne',
        ];
        mode = modes[Math.abs(seed) % modes.length];
      } else {
        mode = seed % 2 === 0 ? 'L_nw_sw' : 'L_se_ne';
      }

      let courtU0 = bu0;
      let courtU1 = bu1;
      let courtV0 = bv0;
      let courtV1 = bv1;
      let parkingAxis: 'u' | 'v' = 'u';

      if (mode === 'U_open_se') {
        placeContiguousStrip('v', bu0, bu0 + depth, bv0, bv1);
        placeContiguousStrip('u', bv0, bv0 + depth, bu0 + depth, bu1);
        placeContiguousStrip('u', bv1 - depth, bv1, bu0 + depth, bu1);
        courtU0 = bu0 + depth + 12;
        courtU1 = bu1 - 8;
        courtV0 = bv0 + depth + 12;
        courtV1 = bv1 - depth - 12;
        parkingAxis = 'u';
      } else if (mode === 'U_open_nw') {
        placeContiguousStrip('v', bu1 - depth, bu1, bv0, bv1);
        placeContiguousStrip('u', bv0, bv0 + depth, bu0, bu1 - depth);
        placeContiguousStrip('u', bv1 - depth, bv1, bu0, bu1 - depth);
        courtU0 = bu0 + 8;
        courtU1 = bu1 - depth - 12;
        courtV0 = bv0 + depth + 12;
        courtV1 = bv1 - depth - 12;
        parkingAxis = 'u';
      } else if (mode === 'U_open_sw') {
        placeContiguousStrip('u', bv1 - depth, bv1, bu0, bu1);
        placeContiguousStrip('v', bu0, bu0 + depth, bv0, bv1 - depth);
        placeContiguousStrip('v', bu1 - depth, bu1, bv0, bv1 - depth);
        courtU0 = bu0 + depth + 12;
        courtU1 = bu1 - depth - 12;
        courtV0 = bv0 + 8;
        courtV1 = bv1 - depth - 12;
        parkingAxis = 'v';
      } else if (mode === 'U_open_ne') {
        placeContiguousStrip('u', bv0, bv0 + depth, bu0, bu1);
        placeContiguousStrip('v', bu0, bu0 + depth, bv0 + depth, bv1);
        placeContiguousStrip('v', bu1 - depth, bu1, bv0 + depth, bv1);
        courtU0 = bu0 + depth + 12;
        courtU1 = bu1 - depth - 12;
        courtV0 = bv0 + depth + 12;
        courtV1 = bv1 - 8;
        parkingAxis = 'v';
      } else if (mode === 'L_nw_sw') {
        placeContiguousStrip('v', bu0, bu0 + depth, bv0, bv1);
        placeContiguousStrip('u', bv0, bv0 + depth, bu0 + depth, bu1);
        courtU0 = bu0 + depth + 14;
        courtU1 = bu1 - 10;
        courtV0 = bv0 + depth + 14;
        courtV1 = bv1 - 10;
        parkingAxis = 'u';
      } else if (mode === 'L_nw_ne') {
        placeContiguousStrip('v', bu0, bu0 + depth, bv0, bv1);
        placeContiguousStrip('u', bv1 - depth, bv1, bu0 + depth, bu1);
        courtU0 = bu0 + depth + 14;
        courtU1 = bu1 - 10;
        courtV0 = bv0 + 10;
        courtV1 = bv1 - depth - 14;
        parkingAxis = 'u';
      } else if (mode === 'L_se_sw') {
        placeContiguousStrip('v', bu1 - depth, bu1, bv0, bv1);
        placeContiguousStrip('u', bv0, bv0 + depth, bu0, bu1 - depth);
        courtU0 = bu0 + 10;
        courtU1 = bu1 - depth - 14;
        courtV0 = bv0 + depth + 14;
        courtV1 = bv1 - 10;
        parkingAxis = 'v';
      } else {
        placeContiguousStrip('v', bu1 - depth, bu1, bv0, bv1);
        placeContiguousStrip('u', bv1 - depth, bv1, bu0, bu1 - depth);
        courtU0 = bu0 + 10;
        courtU1 = bu1 - depth - 14;
        courtV0 = bv0 + 10;
        courtV1 = bv1 - depth - 14;
        parkingAxis = 'v';
      }

      if (courtU1 - courtU0 >= 44 && courtV1 - courtV0 >= 44) {
        const pU0 = courtU0 + 4;
        const pU1 = Math.min(courtU1 - 4, pU0 + 138);
        const pV0 = courtV0 + 4;
        const pV1 = Math.min(courtV1 - 4, pV0 + 138);
        queueParking(q, pU0, pU1, pV0, pV1, 'courtyard', parkingAxis);
      }

      return;
    }

    // -------------------------------------------------------------------------
    // 2C. SINGLE-FAMILY HOUSE QUARTER: delegated to houseQuarters.ts
    // -------------------------------------------------------------------------
    if (q.kind === 'houses') {
      const quarterYards = generateHouseQuarter({
        quarter: q,
        quarterIndex: qIdx,
        accessRoad: accessRoadByQuarter.get(q.id),
        tryPush,
        isIsoPointOnRoadAsphalt,
      });
      houseYards.push(...quarterYards);
    }
  });

  // 2D. Finalize all parking lots & compute their unobstructed straight street driveways
  const nextParkingId = () => `park_${++pSeq}`;
  for (const cand of pendingParking) {
    tryPushParking({
      ...cand,
      buildings: raw,
      parkingLots,
      nextParkingId,
      uSorted,
      vSorted,
    });
  }

  // ---------------------------------------------------------------------------
  // 2D.5 DEDICATED DELIVERY ZONES WITH INDEPENDENT STREET DRIVEWAYS
  //      For EVERY Market (sklep) and the Central Bus Station (dworzec)
  // ---------------------------------------------------------------------------
  const deliveryZones: DeliveryZone[] = [];

  // (a) Bus Station (b_bus_station) dedicated side delivery zone along +u (facing al. Główna)
  {
    const station = raw.find((b) => b.id === 'b_bus_station');
    const alGlowna = U_STREETS.find((s) => s.id === 'u_4');
    if (station && alGlowna) {
      const bay = {
        uMin: station.uMax + 2, // -82
        uMax: station.uMax + 32, // -52
        vMin: 252,
        vMax: 294,
      };
      const dwVMin = 264;
      const dwVMax = 282;
      const dwUMax = alGlowna.coord - alGlowna.asphaltWidth / 2 + 2; // -24
      const driveway: DeliveryZoneDriveway = {
        uMin: bay.uMax - 2,
        uMax: dwUMax,
        vMin: dwVMin,
        vMax: dwVMax,
        axis: 'u',
        streetId: alGlowna.id,
        junctionClearance:
          Math.round(computeStreetJunctionClearance(alGlowna, dwVMin, dwVMax) * 10) / 10,
      };
      const mouthU = alGlowna.coord - alGlowna.asphaltWidth / 2 - alGlowna.sidewalkWidth * 0.5;
      const mouthV = (dwVMin + dwVMax) * 0.5;
      const stopU = (bay.uMin + bay.uMax) * 0.5;
      const stopV = (bay.vMin + bay.vMax) * 0.5;

      deliveryZones.push({
        id: 'dz_bus_station',
        buildingId: station.id,
        buildingType: 'dworzec',
        bay,
        driveway,
        mouth: makeIsoCanvasPoint(mouthU, mouthV),
        stop: makeIsoCanvasPoint(stopU, stopV),
        entryDir: { u: -1, v: 0 },
      });
    }
  }

  // (b) Every Market (sklep): dedicated side loading bay + independent asphalt street driveway
  {
    const markets = raw.filter((b) => b.typ === 'sklep');
    const bayDepth = 26;
    const bayLen = 40;
    const dwHalf = 9;

    for (const m of markets) {
      const mCenterU = (m.uMin + m.uMax) * 0.5;
      const mCenterV = (m.vMin + m.vMax) * 0.5;
      const q = CITY_QUARTERS.find(
        (cand) =>
          mCenterU >= cand.uMin &&
          mCenterU <= cand.uMax &&
          mCenterV >= cand.vMin &&
          mCenterV <= cand.vMax
      );
      if (!q || q.ui < 0 || q.ui >= uSorted.length - 1 || q.vi < 0 || q.vi >= vSorted.length - 1) {
        continue;
      }

      const uA = uSorted[q.ui];
      const uB = uSorted[q.ui + 1];
      const vA = vSorted[q.vi];
      const vB = vSorted[q.vi + 1];
      const qLot = parkingLots.find((p) => p.quarterId === q.id) ?? null;

      type DzCandidate = { zone: DeliveryZone; score: number };
      const candidates: DzCandidate[] = [];

      const testSide = (
        side: ParkingEdgeSide,
        street: StreetSpec,
        bay: { uMin: number; uMax: number; vMin: number; vMax: number },
        drivewayBox: { uMin: number; uMax: number; vMin: number; vMax: number },
        mouthIso: { u: number; v: number },
        entryDir: { u: number; v: number }
      ) => {
        const axis: StreetAxis = side === 'uMin' || side === 'uMax' ? 'u' : 'v';
        const dwLen = axis === 'u' ? drivewayBox.uMax - drivewayBox.uMin : drivewayBox.vMax - drivewayBox.vMin;
        if (dwLen < 4 || dwLen > 95) return;

        const orthoMin = axis === 'u' ? drivewayBox.vMin : drivewayBox.uMin;
        const orthoMax = axis === 'u' ? drivewayBox.vMax : drivewayBox.uMax;
        const orthoCenter = (orthoMin + orthoMax) * 0.5;
        if (!streetCoversValue(street, orthoCenter, -6)) return;
        if (rectOverlapsRoundabout(bay.uMin, bay.uMax, bay.vMin, bay.vMax, 8)) return;
        if (rectOverlapsRoundabout(drivewayBox.uMin, drivewayBox.uMax, drivewayBox.vMin, drivewayBox.vMax, 8)) {
          return;
        }
        if (rectOverlapsActiveStreet(bay.uMin, bay.uMax, bay.vMin, bay.vMax)) return;

        const clearance = computeStreetJunctionClearance(street, orthoMin, orthoMax);
        if (clearance < 4) return;

        // Strictly no overlap with buildings, customer parking lots, parking driveways, or other delivery zones
        if (raw.some((b) => rectsOverlap(b, bay, 1.5))) return;
        if (raw.some((b) => rectsOverlap(b, drivewayBox, 2))) return;
        if (parkingLots.some((p) => rectsOverlap(p, bay, 4) || rectsOverlap(p.accessDriveway, bay, 4))) {
          return;
        }
        if (
          parkingLots.some(
            (p) => rectsOverlap(p, drivewayBox, 4) || rectsOverlap(p.accessDriveway, drivewayBox, 10)
          )
        ) {
          return;
        }
        if (
          deliveryZones.some(
            (dz) => rectsOverlap(dz.bay, bay, 4) || rectsOverlap(dz.driveway, drivewayBox, 4)
          )
        ) {
          return;
        }

        const isCameraFacing = side === 'vMin' || side === 'uMax';
        const sameStreetAsParking = qLot !== null && qLot.accessDriveway.streetId === street.id;

        let score = dwLen;
        if (isCameraFacing) score -= 28;
        if (sameStreetAsParking) score += 26;
        if (clearance < 16) {
          score += (16 - clearance) * 10;
        } else {
          score -= Math.min(24, (clearance - 16) * 0.35);
        }

        const stopU = (bay.uMin + bay.uMax) * 0.5;
        const stopV = (bay.vMin + bay.vMax) * 0.5;

        candidates.push({
          score,
          zone: {
            id: `dz_${m.id}`,
            buildingId: m.id,
            buildingType: 'sklep',
            bay: {
              uMin: round1(bay.uMin),
              uMax: round1(bay.uMax),
              vMin: round1(bay.vMin),
              vMax: round1(bay.vMax),
            },
            driveway: {
              uMin: round1(drivewayBox.uMin),
              uMax: round1(drivewayBox.uMax),
              vMin: round1(drivewayBox.vMin),
              vMax: round1(drivewayBox.vMax),
              axis,
              streetId: street.id,
              junctionClearance: round1(clearance),
            },
            mouth: makeIsoCanvasPoint(mouthIso.u, mouthIso.v),
            stop: makeIsoCanvasPoint(stopU, stopV),
            entryDir,
          },
        });
      };

      const sampleAlong = (lo: number, hi: number): number[] => {
        const minC = lo + bayLen * 0.5;
        const maxC = hi - bayLen * 0.5;
        if (minC > maxC) return [(lo + hi) * 0.5];
        const pts: number[] = [(minC + maxC) * 0.5];
        for (let c = minC; c <= maxC; c += 12) pts.push(c);
        pts.push(maxC);
        return pts;
      };

      const vSamples = sampleAlong(m.vMin, m.vMax);
      const uSamples = sampleAlong(m.uMin, m.uMax);

      // Side 1: -u toward uA
      if (m.uMin - q.uMin >= bayDepth + 4) {
        const bayUMax = m.uMin - 2;
        const bayUMin = bayUMax - bayDepth;
        const streetEdge = uA.coord + uA.asphaltWidth / 2 - 2;
        const mouthU = uA.coord + uA.asphaltWidth / 2 + uA.sidewalkWidth * 0.5;
        for (const vc of vSamples) {
          testSide(
            'uMin',
            uA,
            { uMin: bayUMin, uMax: bayUMax, vMin: vc - bayLen / 2, vMax: vc + bayLen / 2 },
            { uMin: streetEdge, uMax: bayUMin + 2, vMin: vc - dwHalf, vMax: vc + dwHalf },
            { u: mouthU, v: vc },
            { u: 1, v: 0 }
          );
        }
      }
      // Side 2: +u toward uB (camera-facing)
      if (q.uMax - m.uMax >= bayDepth + 4) {
        const bayUMin = m.uMax + 2;
        const bayUMax = bayUMin + bayDepth;
        const streetEdge = uB.coord - uB.asphaltWidth / 2 + 2;
        const mouthU = uB.coord - uB.asphaltWidth / 2 - uB.sidewalkWidth * 0.5;
        for (const vc of vSamples) {
          testSide(
            'uMax',
            uB,
            { uMin: bayUMin, uMax: bayUMax, vMin: vc - bayLen / 2, vMax: vc + bayLen / 2 },
            { uMin: bayUMax - 2, uMax: streetEdge, vMin: vc - dwHalf, vMax: vc + dwHalf },
            { u: mouthU, v: vc },
            { u: -1, v: 0 }
          );
        }
      }
      // Side 3: -v toward vA (camera-facing)
      if (m.vMin - q.vMin >= bayDepth + 4) {
        const bayVMax = m.vMin - 2;
        const bayVMin = bayVMax - bayDepth;
        const streetEdge = vA.coord + vA.asphaltWidth / 2 - 2;
        const mouthV = vA.coord + vA.asphaltWidth / 2 + vA.sidewalkWidth * 0.5;
        for (const uc of uSamples) {
          testSide(
            'vMin',
            vA,
            { uMin: uc - bayLen / 2, uMax: uc + bayLen / 2, vMin: bayVMin, vMax: bayVMax },
            { uMin: uc - dwHalf, uMax: uc + dwHalf, vMin: streetEdge, vMax: bayVMin + 2 },
            { u: uc, v: mouthV },
            { u: 0, v: 1 }
          );
        }
      }
      // Side 4: +v toward vB
      if (q.vMax - m.vMax >= bayDepth + 4) {
        const bayVMin = m.vMax + 2;
        const bayVMax = bayVMin + bayDepth;
        const streetEdge = vB.coord - vB.asphaltWidth / 2 + 2;
        const mouthV = vB.coord - vB.asphaltWidth / 2 - vB.sidewalkWidth * 0.5;
        for (const uc of uSamples) {
          testSide(
            'vMax',
            vB,
            { uMin: uc - bayLen / 2, uMax: uc + bayLen / 2, vMin: bayVMin, vMax: bayVMax },
            { uMin: uc - dwHalf, uMax: uc + dwHalf, vMin: bayVMax - 2, vMax: streetEdge },
            { u: uc, v: mouthV },
            { u: 0, v: -1 }
          );
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.score - b.score);
        deliveryZones.push(candidates[0].zone);
      }
    }
  }

  // Helper checking if a candidate box overlaps any finalized parking lot, its access driveway,
  // or any dedicated delivery zone / delivery driveway
  const overlapsAnyParking = (
    box: { uMin: number; uMax: number; vMin: number; vMax: number },
    pad = 6
  ): boolean => {
    for (const lot of parkingLots) {
      if (rectsOverlap(lot, box, pad)) return true;
      if (rectsOverlap(lot.accessDriveway, box, pad)) return true;
    }
    for (const dz of deliveryZones) {
      if (rectsOverlap(dz.bay, box, pad)) return true;
      if (rectsOverlap(dz.driveway, box, pad)) return true;
    }
    return false;
  };

  // ---------------------------------------------------------------------------
  // 2E. PAWILONY USŁUGOWE / KIOSKI (~20 evenly spaced small 1-story pavilions
  //     on free concrete plaza corners, beside blocks & parking lots)
  // ---------------------------------------------------------------------------
  interface PlazaSpotCandidate {
    quarterId: string;
    uMin: number;
    uMax: number;
    vMin: number;
    vMax: number;
    u: number;
    v: number;
    axis: 'u' | 'v';
  }

  const scanConcretePlazaSpots = (
    lenLong: number,
    lenShort: number,
    bldgPad: number,
    parkPad: number
  ): PlazaSpotCandidate[] => {
    const spots: PlazaSpotCandidate[] = [];

    for (const q of CITY_QUARTERS) {
      if (q.kind !== 'blocks' && q.kind !== 'market') continue;
      const edgePad = 8;
      const bu0 = q.uMin + edgePad;
      const bu1 = q.uMax - edgePad;
      const bv0 = q.vMin + edgePad;
      const bv1 = q.vMax - edgePad;
      if (bu1 - bu0 < lenLong || bv1 - bv0 < lenLong) continue;

      // Sample perimeter edges and inner plaza spots on a clean architectural grid
      const uAnchors = [
        bu0,
        bu0 + 58,
        (bu0 + bu1) / 2 - lenLong / 2,
        bu1 - 58 - lenShort,
        bu1 - lenShort,
        bu1 - lenLong,
      ];
      const vAnchors = [
        bv0,
        bv0 + 58,
        (bv0 + bv1) / 2 - lenLong / 2,
        bv1 - 58 - lenShort,
        bv1 - lenShort,
        bv1 - lenLong,
      ];

      const trySpot = (u0: number, u1: number, v0: number, v1: number, axis: 'u' | 'v') => {
        if (u0 < bu0 - 0.5 || u1 > bu1 + 0.5 || v0 < bv0 - 0.5 || v1 > bv1 + 0.5) return;
        if (!isBuildingVisibleInMap(u0, u1, v0, v1, 20)) return;
        if (rectOverlapsActiveStreet(u0, u1, v0, v1)) return;
        if (rectOverlapsRoundabout(u0, u1, v0, v1, 12)) return;
        if (rectOverlapsBaseYard(u0, u1, v0, v1, 8)) return;
        const box = { uMin: u0, uMax: u1, vMin: v0, vMax: v1 };
        if (raw.some((b) => rectsOverlap(b, box, bldgPad))) return;
        if (overlapsAnyParking(box, parkPad)) return;

        // Avoid near-duplicate candidate positions inside the same quarter
        const cu = (u0 + u1) / 2;
        const cv = (v0 + v1) / 2;
        if (
          spots.some(
            (s) => s.quarterId === q.id && Math.hypot(s.u - cu, s.v - cv) < 28
          )
        ) {
          return;
        }
        spots.push({
          quarterId: q.id,
          uMin: u0,
          uMax: u1,
          vMin: v0,
          vMax: v1,
          u: cu,
          v: cv,
          axis,
        });
      };

      for (const u0 of uAnchors) {
        for (const v0 of vAnchors) {
          trySpot(u0, u0 + lenLong, v0, v0 + lenShort, 'u');
          trySpot(u0, u0 + lenShort, v0, v0 + lenLong, 'v');
        }
      }
    }

    return spots;
  };

  const kioskCandidates = scanConcretePlazaSpots(26, 20, 8, 7);
  const chosenKiosks = selectSpatiallySpread(kioskCandidates, 20, 2);

  chosenKiosks.forEach((spot, idx) => {
    tryPush({
      id: `b_kiosk_${idx + 1}`,
      typ: 'kiosk',
      pietra: 1,
      mieszkania: 0,
      uMin: spot.uMin,
      uMax: spot.uMax,
      vMin: spot.vMin,
      vMax: spot.vMax,
      colorVariant: idx % 2,
    });
  });

  // ---------------------------------------------------------------------------
  // 2F. 8 ZAREZERWOWANYCH MIEJSC POD PRZYSZŁE PACZKOMATY (parcelLockerSlots)
  //     Small subtle cobblestone paver pads spread evenly across the city
  // ---------------------------------------------------------------------------
  const lockerCandidates = scanConcretePlazaSpots(22, 12, 6, 6);
  const chosenLockerSpots = selectSpatiallySpread(lockerCandidates, 8, 1);

  const parcelLockerSlots: ParcelLockerSlot[] = chosenLockerSpots.map((spot, idx) => {
    const nearest = findNearestStreetForBuilding(spot.uMin, spot.uMax, spot.vMin, spot.vMax);
    return {
      id: `locker_slot_${idx + 1}`,
      quarterId: spot.quarterId,
      uMin: round1(spot.uMin),
      uMax: round1(spot.uMax),
      vMin: round1(spot.vMin),
      vMax: round1(spot.vMax),
      ...makeIsoCanvasPoint(spot.u, spot.v),
      axis: spot.axis,
      nearestStreetName: nearest.name,
      occupied: false,
    };
  });

  // 3. Assign realistic Polish street addresses to ALL buildings (including kiosks & houses on access roads)
  const roadById = new Map(ALL_ADDRESSABLE_ROADS.map((r) => [r.id, r]));
  const grouped = new Map<
    string,
    Array<{ raw: RawBuildingCandidate; road: Pick<StreetSpec, 'id' | 'name' | 'axis' | 'coord'> }>
  >();

  for (const item of raw) {
    const forced = item.forcedStreetId ? roadById.get(item.forcedStreetId) : undefined;
    const road = forced
      ? { id: forced.id, name: forced.name, axis: forced.axis, coord: forced.coord }
      : findNearestStreetForBuilding(item.uMin, item.uMax, item.vMin, item.vMax);

    if (!grouped.has(road.id)) {
      grouped.set(road.id, []);
    }
    grouped.get(road.id)!.push({ raw: item, road });
  }

  const addressed: Building[] = [];

  for (const [, entries] of grouped) {
    const road = entries[0].road;
    const negSide: RawBuildingCandidate[] = [];
    const posSide: RawBuildingCandidate[] = [];

    for (const { raw: b } of entries) {
      const perpCenter = road.axis === 'u' ? (b.uMin + b.uMax) / 2 : (b.vMin + b.vMax) / 2;
      if (perpCenter < road.coord) {
        negSide.push(b);
      } else {
        posSide.push(b);
      }
    }

    const alongCoord = (b: RawBuildingCandidate) =>
      road.axis === 'u' ? (b.vMin + b.vMax) / 2 : (b.uMin + b.uMax) / 2;
    const perpDist = (b: RawBuildingCandidate) =>
      road.axis === 'u'
        ? Math.abs((b.uMin + b.uMax) / 2 - road.coord)
        : Math.abs((b.vMin + b.vMax) / 2 - road.coord);

    const compareAlong = (a: RawBuildingCandidate, b: RawBuildingCandidate) => {
      const da = alongCoord(a) - alongCoord(b);
      if (Math.abs(da) > 1e-3) return da;
      return perpDist(a) - perpDist(b);
    };

    negSide.sort(compareAlong);
    posSide.sort(compareAlong);

    const buildAddressedBuilding = (b: RawBuildingCandidate, numerBudynku: number): Building => ({
      id: b.id,
      typ: b.typ,
      nazwaUlicy: road.name,
      numerBudynku,
      pietra: b.pietra,
      mieszkania: b.mieszkania,
      uMin: b.uMin,
      uMax: b.uMax,
      vMin: b.vMin,
      vMax: b.vMax,
      height: b.height,
      colorVariant: b.colorVariant,
      dostepnyDlaDostaw: b.dostepnyDlaDostaw ?? b.typ !== 'baza',
      ...(b.stanowiskaAutobusowe !== undefined
        ? { stanowiskaAutobusowe: b.stanowiskaAutobusowe }
        : {}),
    });

    negSide.forEach((b, i) => addressed.push(buildAddressedBuilding(b, i * 2 + 1)));
    posSide.forEach((b, i) => addressed.push(buildAddressedBuilding(b, (i + 1) * 2)));
  }

  // 4. Compute exact roadApproachPoint (on roadGraph edge, zero extra nodes) and off-road
  //    deliveryStopPoint (dedicated delivery zone for markets & bus station, yard gate for
  //    single-family houses, or sidewalk/parking directly in front of entrance for other buildings).
  const baseRoadGraph = buildProceduralRoadGraph();
  attachDeliveryPointsToBuildings(addressed, parkingLots, deliveryZones, houseYards, baseRoadGraph);

  return {
    buildings: sortBuildingsBackToFront(addressed),
    parkingLots,
    deliveryZones,
    parcelLockerSlots,
    houseYards,
  };
}

interface PrecomputedRoadEdge {
  edge: [string, string];
  oneWay: boolean;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  au: number;
  av: number;
  bu: number;
  bv: number;
}

function isIsoPointWithinRoadCorridor(
  u: number,
  v: number,
  getHalfWidth: (road: AddressableRoad) => number,
  streetAlongPad: number,
  accessAlongPad: number,
  inclusive: boolean
): boolean {
  for (const road of ALL_ADDRESSABLE_ROADS) {
    const perp = road.axis === 'u' ? u : v;
    const ortho = road.axis === 'u' ? v : u;
    const dist = Math.abs(perp - road.coord);
    const limit = getHalfWidth(road);
    if (!(inclusive ? dist <= limit : dist < limit)) continue;
    const alongPad = road.isAccessRoad ? accessAlongPad : streetAlongPad;
    if (road.covers(ortho, alongPad)) {
      return true;
    }
  }
  return false;
}

export function isIsoPointOnRoadAsphalt(u: number, v: number, margin = 2.0): boolean {
  if (isIsoPointWithinRoadCorridor(u, v, (r) => r.asphaltWidth / 2 + margin, 4, 4, false)) {
    return true;
  }
  for (const rb of ROUNDABOUTS) {
    if (Math.hypot(u - rb.u, v - rb.v) < rb.outerAsphaltRadius + margin) {
      return true;
    }
  }
  // BAZA driveway asphalt
  if (
    Math.abs(v - BASE_DEPOT.exitV) < BASE_DEPOT.drivewayAsphaltWidth / 2 + margin &&
    u >= Math.min(BASE_DEPOT.exitU, BASE_DEPOT.u) - 4 &&
    u <= Math.max(BASE_DEPOT.exitU, BASE_DEPOT.u) + 4
  ) {
    return true;
  }
  return false;
}

function isIsoPointNearStreetSidewalk(u: number, v: number): boolean {
  return isIsoPointWithinRoadCorridor(
    u,
    v,
    (r) => r.asphaltWidth / 2 + r.sidewalkWidth + 14,
    6,
    4,
    true
  );
}

function isIsoPointInBuilding(
  u: number,
  v: number,
  buildings: Building[],
  pad = 2.0,
  ignoreId?: string
): boolean {
  for (const b of buildings) {
    if (ignoreId && b.id === ignoreId) continue;
    if (u >= b.uMin - pad && u <= b.uMax + pad && v >= b.vMin - pad && v <= b.vMax + pad) {
      return true;
    }
  }
  return false;
}

function projectIsoPointOntoEdges(
  u: number,
  v: number,
  edges: PrecomputedRoadEdge[]
): { approach: RoadApproachPoint; distIso: number } | null {
  let best: { approach: RoadApproachPoint; distIso: number } | null = null;
  for (const e of edges) {
    const du = e.bu - e.au;
    const dv = e.bv - e.av;
    const lenSq = du * du + dv * dv;
    if (lenSq < 1e-4) continue;
    const t = Math.max(0, Math.min(1, ((u - e.au) * du + (v - e.av) * dv) / lenSq));
    const pu = e.au + t * du;
    const pv = e.av + t * dv;
    const d = Math.hypot(u - pu, v - pv);
    if (!best || d < best.distIso) {
      const px = e.ax + t * (e.bx - e.ax);
      const py = e.ay + t * (e.by - e.ay);
      best = {
        distIso: d,
        approach: {
          x: Math.round(px * 10) / 10,
          y: Math.round(py * 10) / 10,
          u: Math.round(pu * 10) / 10,
          v: Math.round(pv * 10) / 10,
          edge: e.edge,
          t: Math.round(t * 10000) / 10000,
        },
      };
    }
  }
  return best;
}

function segmentBlockedByOtherBuilding(
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  buildings: Building[],
  selfId: string
): boolean {
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const su = u0 + (u1 - u0) * f;
    const sv = v0 + (v1 - v0) * f;
    if (isIsoPointInBuilding(su, sv, buildings, 1.0, selfId)) {
      return true;
    }
  }
  return false;
}

function attachDeliveryPointsToBuildings(
  buildings: Building[],
  parkingLots: ParkingLot[],
  deliveryZones: DeliveryZone[],
  houseYards: HouseYardFence[],
  roadGraph: RoadGraph
) {
  const nodeById = new Map(roadGraph.nodes.map((n) => [n.id, n]));
  const streetById = new Map(ALL_STREETS.map((s) => [s.id, s]));
  const addressableRoadById = new Map(ALL_ADDRESSABLE_ROADS.map((r) => [r.id, r]));
  const deliveryZoneByBuildingId = new Map(deliveryZones.map((dz) => [dz.buildingId, dz]));
  const houseYardByBuildingId = new Map(houseYards.map((y) => [y.buildingId, y]));
  const straightEdges: PrecomputedRoadEdge[] = [];
  const allPublicEdges: PrecomputedRoadEdge[] = [];

  for (const edge of roadGraph.edges) {
    const aId = edge[0];
    const bId = edge[1];
    // Exclude private BAZA driveway from public building approaches
    if (aId === 'base' || bId === 'base') continue;
    const a = nodeById.get(aId);
    const b = nodeById.get(bId);
    if (!a || !b) continue;
    const aIso = canvasToIso(a.x, a.y);
    const bIso = canvasToIso(b.x, b.y);
    const item: PrecomputedRoadEdge = {
      edge: [aId, bId],
      oneWay: Boolean(edge[2]?.oneWay),
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      au: aIso.u,
      av: aIso.v,
      bu: bIso.u,
      bv: bIso.v,
    };
    allPublicEdges.push(item);
    if (!item.oneWay) {
      straightEdges.push(item);
    }
  }

  const candidateEdges = straightEdges.length > 0 ? straightEdges : allPublicEdges;

  const isInsideParkingLot = (u: number, v: number): ParkingLot | null => {
    for (const lot of parkingLots) {
      if (u >= lot.uMin - 2 && u <= lot.uMax + 2 && v >= lot.vMin - 2 && v <= lot.vMax + 2) {
        return lot;
      }
    }
    return null;
  };

  for (const b of buildings) {
    if (b.typ === 'baza' || b.dostepnyDlaDostaw === false) {
      continue;
    }

    // 1. Dedicated side delivery zone with independent street driveway (all markets & Bus Station):
    //    Couriers enter directly off the bordering street onto the delivery driveway into the bay
    //    (never cutting through customer or bus parking lots).
    const dz = deliveryZoneByBuildingId.get(b.id);
    if (dz) {
      const targetStreet = streetById.get(dz.driveway.streetId);
      const streetEdges = targetStreet
        ? candidateEdges.filter((e) =>
            targetStreet.axis === 'u'
              ? Math.abs(e.au - targetStreet.coord) < 5 && Math.abs(e.bu - targetStreet.coord) < 5
              : Math.abs(e.av - targetStreet.coord) < 5 && Math.abs(e.bv - targetStreet.coord) < 5
          )
        : [];
      const proj = projectIsoPointOntoEdges(
        dz.mouth.u,
        dz.mouth.v,
        streetEdges.length > 0 ? streetEdges : candidateEdges
      );
      if (proj) {
        b.roadApproachPoint = proj.approach;
        b.deliveryStopPoint = {
          x: dz.stop.x,
          y: dz.stop.y,
          u: dz.stop.u,
          v: dz.stop.v,
          surface: 'delivery_zone',
          approachWaypoints: [{ x: dz.mouth.x, y: dz.mouth.y }],
        };
        continue;
      }
    }

    // 1b. Single-family house fence gate (furtka): courier stops directly outside the yard gate
    //     on the bordering street sidewalk and leaves the empty bicycle there during parcel handoff.
    const yard = houseYardByBuildingId.get(b.id);
    if (yard) {
      const targetRoad = addressableRoadById.get(yard.streetId);
      const roadEdges = targetRoad
        ? candidateEdges.filter((e) =>
            targetRoad.axis === 'u'
              ? Math.abs(e.au - targetRoad.coord) < 5 && Math.abs(e.bu - targetRoad.coord) < 5
              : Math.abs(e.av - targetRoad.coord) < 5 && Math.abs(e.bv - targetRoad.coord) < 5
          )
        : [];
      const proj = projectIsoPointOntoEdges(
        yard.deliveryStop.u,
        yard.deliveryStop.v,
        roadEdges.length > 0 ? roadEdges : candidateEdges
      );
      if (proj) {
        b.roadApproachPoint = proj.approach;
        b.deliveryStopPoint = {
          x: yard.deliveryStop.x,
          y: yard.deliveryStop.y,
          u: yard.deliveryStop.u,
          v: yard.deliveryStop.v,
          surface: 'gate',
        };
        continue;
      }
    }

    // 2. General off-road entrance stop search across all 4 building faces
    const midU = (b.uMin + b.uMax) * 0.5;
    const midV = (b.vMin + b.vMax) * 0.5;
    const uSpan = b.uMax - b.uMin;
    const vSpan = b.vMax - b.vMin;
    const offsets = [6.0, 4.5, 8.5, 11.5];
    const alongFracs = [0.5, 0.25, 0.75];

    let bestCandidate: {
      score: number;
      stop: DeliveryStopPoint;
      approach: RoadApproachPoint;
    } | null = null;

    const evaluateStop = (su: number, sv: number, isCenter: boolean) => {
      const stopCanvas = isoToCanvas(su, sv);
      if (!isPointInsideMap(stopCanvas, 12)) return;
      if (isIsoPointInBuilding(su, sv, buildings, 2.0)) return;
      if (isIsoPointOnRoadAsphalt(su, sv, 2.0)) return;

      const proj = projectIsoPointOntoEdges(su, sv, candidateEdges);
      if (!proj) return;

      const blocked = segmentBlockedByOtherBuilding(
        su,
        sv,
        proj.approach.u,
        proj.approach.v,
        buildings,
        b.id
      );

      const inLot = isInsideParkingLot(su, sv);
      const surface: DeliveryStopPoint['surface'] = inLot
        ? 'parking'
        : isIsoPointNearStreetSidewalk(su, sv)
          ? 'sidewalk'
          : 'plaza';

      let approachWaypoints: Array<{ x: number; y: number }> | undefined;
      let finalApproach = proj.approach;
      let score = proj.distIso + (blocked ? 450 : 0) + (isCenter ? 0 : 5);

      // If this stop sits on/beside a parking lot and direct street line is blocked, enter via parking driveway
      if (inLot && blocked) {
        const dw = inLot.accessDriveway;
        const dwMidU = (dw.uMin + dw.uMax) * 0.5;
        const dwMidV = (dw.vMin + dw.vMax) * 0.5;
        const dwProj = projectIsoPointOntoEdges(dwMidU, dwMidV, candidateEdges);
        if (dwProj) {
          const mouthCanvas = isoToCanvas(dwMidU, dwMidV);
          finalApproach = dwProj.approach;
          approachWaypoints = [
            {
              x: Math.round(mouthCanvas.x * 10) / 10,
              y: Math.round(mouthCanvas.y * 10) / 10,
            },
          ];
          score = Math.hypot(su - dwMidU, sv - dwMidV) + dwProj.distIso + 12;
        }
      }

      if (!bestCandidate || score < bestCandidate.score) {
        const stopPt = makeIsoCanvasPoint(su, sv);
        bestCandidate = {
          score,
          approach: finalApproach,
          stop: {
            x: stopPt.x,
            y: stopPt.y,
            u: stopPt.u,
            v: stopPt.v,
            surface,
            ...(approachWaypoints ? { approachWaypoints } : {}),
          },
        };
      }
    };

    for (const off of offsets) {
      for (const f of alongFracs) {
        const isCenter = f === 0.5;
        const uSample = b.uMin + uSpan * f;
        const vSample = b.vMin + vSpan * f;
        evaluateStop(b.uMin - off, vSample, isCenter);
        evaluateStop(b.uMax + off, vSample, isCenter);
        evaluateStop(uSample, b.vMin - off, isCenter);
        evaluateStop(uSample, b.vMax + off, isCenter);
      }
    }

    if (bestCandidate) {
      const chosen = bestCandidate as {
        score: number;
        stop: DeliveryStopPoint;
        approach: RoadApproachPoint;
      };
      b.roadApproachPoint = chosen.approach;
      b.deliveryStopPoint = chosen.stop;
    } else {
      // Fallback guaranteed point if building is unusually tight
      const proj = projectIsoPointOntoEdges(midU, midV, allPublicEdges);
      if (proj) {
        const fallbackPt = makeIsoCanvasPoint(midU, midV);
        b.roadApproachPoint = proj.approach;
        b.deliveryStopPoint = {
          x: fallbackPt.x,
          y: fallbackPt.y,
          u: fallbackPt.u,
          v: fallbackPt.v,
          surface: 'plaza',
        };
      }
    }
  }
}

const CITY_STRUCTURES = buildProceduralCityStructures();

export const PROCEDURAL_BUILDINGS: Building[] = CITY_STRUCTURES.buildings;
export const PROCEDURAL_PARKING_LOTS: ParkingLot[] = CITY_STRUCTURES.parkingLots;
export const PROCEDURAL_DELIVERY_ZONES: DeliveryZone[] = CITY_STRUCTURES.deliveryZones;
export const PARCEL_LOCKER_SLOTS: ParcelLockerSlot[] = CITY_STRUCTURES.parcelLockerSlots;
export const parcelLockerSlots: ParcelLockerSlot[] = PARCEL_LOCKER_SLOTS;
export const PROCEDURAL_HOUSE_YARDS: HouseYardFence[] = CITY_STRUCTURES.houseYards;

/**
 * Precomputed, topologically sorted back-to-front static 3D scene order (all buildings +
 * 3D wooden yard fence segments & corner/gate posts). Cached once at startup so per-frame
 * rendering only interleaves dynamic entities (e.g. moving courier) for smooth mobile FPS.
 */
export const STATIC_SCENE_3D_ORDER: StaticScene3DItem[] = buildStaticScene3DOrder(
  PROCEDURAL_BUILDINGS,
  PROCEDURAL_HOUSE_YARDS
);

const customSceneOrderCache = new WeakMap<Building[], StaticScene3DItem[]>();

export function getStaticScene3DOrder(buildings: Building[]): StaticScene3DItem[] {
  if (buildings === PROCEDURAL_BUILDINGS) {
    return STATIC_SCENE_3D_ORDER;
  }
  let cached = customSceneOrderCache.get(buildings);
  if (!cached) {
    cached = buildStaticScene3DOrder(buildings, PROCEDURAL_HOUSE_YARDS);
    customSceneOrderCache.set(buildings, cached);
  }
  return cached;
}

export function buildProceduralBuildings(): Building[] {
  return PROCEDURAL_BUILDINGS;
}

function pointInConvexPolygon(pt: Point, poly: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = s;
    } else if (sign !== s) {
      return false;
    }
  }
  return true;
}

/**
 * Hit-tests a canvas world point against Z-sorted buildings (front-to-back).
 *  - In footprintOnly mode: checks exact isometric base rectangle [uMin..uMax] x [vMin..vMax].
 *  - In 3D mode: checks the 6-vertex outer silhouette hexagon of the extruded prism.
 */
export function hitTestBuilding(
  buildingsBackToFront: Building[],
  worldPt: Point,
  footprintOnly: boolean
): Building | null {
  if (footprintOnly) {
    const iso = canvasToIso(worldPt.x, worldPt.y);
    for (let i = buildingsBackToFront.length - 1; i >= 0; i--) {
      const b = buildingsBackToFront[i];
      if (iso.u >= b.uMin && iso.u <= b.uMax && iso.v >= b.vMin && iso.v <= b.vMax) {
        return b;
      }
    }
    return null;
  }

  for (let i = buildingsBackToFront.length - 1; i >= 0; i--) {
    const b = buildingsBackToFront[i];
    const p = getBuildingPrismPoints(b);
    if (
      worldPt.x < p.bLeft.x - 1 ||
      worldPt.x > p.bRight.x + 1 ||
      worldPt.y < p.tBack.y - 1 ||
      worldPt.y > p.bFront.y + 1
    ) {
      continue;
    }
    const silhouette: Point[] = [
      p.tBack,
      p.tRight,
      p.bRight,
      p.bFront,
      p.bLeft,
      p.tLeft,
    ];
    if (pointInConvexPolygon(worldPt, silhouette)) {
      return b;
    }
  }

  return null;
}

export { BASE_DEPOT, MAP_HEIGHT, MAP_WIDTH };
