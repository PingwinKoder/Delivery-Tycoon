import type {
  Building,
  BuildingPalette,
  BuildingType,
  DeliveryStopPoint,
  RoadApproachPoint,
} from '../types/building';
import type { WarehouseTier } from '../types/orders';
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
  getBaseBuildingSpec,
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
  /** 0..7 deterministic city zone index */
  zoneIndex: number;
  quarterId: string;
  /** Full reserved plot footprint (QuickBox pad + adjacent single courier parking bay) */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** QuickBox locker kiosk footprint inside the plot */
  lockerRect: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Single courier parking bay adjacent to the locker (appears once status === 'active') */
  parkingBay: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Short asphalt driveway bridging the sidewalk from the bordering street into parkingBay */
  driveway: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Side of the plot facing the bordering street */
  streetSide: ParkingEdgeSide;
  /** Bordering street ID from ALL_STREETS */
  streetId: string;
  /** Snapped road approach point on the bordering street */
  roadApproachPoint?: RoadApproachPoint;
  /** Dedicated courier bay stop point inside parkingBay */
  deliveryStopPoint?: DeliveryStopPoint;
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

export interface ServiceFacilityDriveway {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Axis along which the asphalt driveway extends from yard to street */
  axis: StreetAxis;
  /** Yard side opened by this driveway */
  entrySide: ParkingEdgeSide;
  /** Street id the driveway connects onto (e.g. 'u_3' for ul. Lipowa, 'u_5' for ul. Słoneczna) */
  streetId: string;
}

export interface ServiceFacilitySpec {
  id: string;
  buildingId: string;
  kind: 'mechanik' | 'stacja_paliw';
  quarterId: string;
  /** Asphalt/cobblestone forecourt or service apron rectangle (iso coordinates) */
  yard: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Asphalt driveway connecting yard directly onto the adjacent street */
  driveway: ServiceFacilityDriveway;
  /** Street-edge mouth center where vehicles turn off the road onto the facility driveway */
  mouth: { u: number; v: number; x: number; y: number };
  /** Exact vehicle service/refueling stop point inside the facility yard */
  stop: { u: number; v: number; x: number; y: number };
  /** Optional intermediate point at yard entrance for smooth turn-in */
  yardEntry?: { u: number; v: number; x: number; y: number };
  /** Footprint of the 3D facility building (iso coordinates) */
  buildingRect: { uMin: number; uMax: number; vMin: number; vMax: number };
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
  mechanik: {
    footprintFill: 'rgba(234, 88, 12, 0.42)',
    footprintStroke: '#c2410c',
    accent: '#fb923c',
  },
  stacja_paliw: {
    footprintFill: 'rgba(5, 150, 105, 0.42)',
    footprintStroke: '#047857',
    accent: '#34d399',
  },
  quickbox: {
    footprintFill: 'rgba(245, 158, 11, 0.42)',
    footprintStroke: '#b45309',
    accent: '#fbbf24',
  },
  garaz: {
    footprintFill: 'rgba(100, 116, 139, 0.36)',
    footprintStroke: '#475569',
    accent: '#94a3b8',
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
  mechanik: buildPalettes('mechanik', [
    { roof: '#374151', leftWall: '#5c6674', rightWall: '#434c59' },
  ]),
  stacja_paliw: buildPalettes('stacja_paliw', [
    { roof: '#f1f5f9', leftWall: '#059669', rightWall: '#047857' },
    { roof: '#f1f5f9', leftWall: '#0d9488', rightWall: '#0f766e' },
  ]),
  quickbox: buildPalettes('quickbox', [
    { roof: '#f59e0b', leftWall: '#e2e8f0', rightWall: '#94a3b8' },
  ]),
  garaz: buildPalettes('garaz', [
    { roof: '#b87158', leftWall: '#e2d8ca', rightWall: '#bdb09e' },
    { roof: '#64748b', leftWall: '#dde2e8', rightWall: '#b5bec9' },
    { roof: '#9a7b5c', leftWall: '#e6dfd1', rightWall: '#c2b8a3' },
    { roof: '#7c6558', leftWall: '#e0dcd5', rightWall: '#b8b2a8' },
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
      return getBaseBuildingSpec(1).height;
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
    case 'mechanik':
      return 30;
    case 'stacja_paliw':
      return 28;
    case 'quickbox':
      return 20;
    case 'garaz':
      return 18;
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

export interface BuildingSpriteBounds {
  /** World-space top-left X of the padded sprite canvas */
  minX: number;
  /** World-space top-left Y of the padded sprite canvas */
  minY: number;
  /** World-space width of the sprite canvas */
  worldWidth: number;
  /** World-space height of the sprite canvas */
  worldHeight: number;
  /** Anchor offset X relative to building anchor (drawX = anchorX + offsetX) */
  offsetX: number;
  /** Anchor offset Y relative to building anchor (drawY = anchorY + offsetY) */
  offsetY: number;
}

export function getBuildingSpriteBounds(
  prism: BuildingPrismPoints,
  anchorX: number,
  anchorY: number,
  pad = 4
): BuildingSpriteBounds {
  const minX = Math.floor(prism.bLeft.x - pad);
  const maxX = Math.ceil(prism.bRight.x + pad);
  const minY = Math.floor(prism.tBack.y - pad);
  const maxY = Math.ceil(prism.bFront.y + pad);
  const worldWidth = Math.max(1, maxX - minX);
  const worldHeight = Math.max(1, maxY - minY);
  return {
    minX,
    minY,
    worldWidth,
    worldHeight,
    offsetX: minX - anchorX,
    offsetY: minY - anchorY,
  };
}

/**
 * Computes translation-invariant world-space bounds centered around `(anchorX, anchorY)`
 * so buildings sharing identical dimensions/palette reuse a single Texture Atlas slot
 * with zero sub-pixel drift.
 */
export function computeCenteredBuildingSpriteBounds(
  prism: BuildingPrismPoints,
  anchorX: number,
  anchorY: number,
  pad = 3
): BuildingSpriteBounds {
  const halfW = Math.max(
    1,
    Math.ceil(Math.max(anchorX - prism.bLeft.x, prism.bRight.x - anchorX) + pad)
  );
  const topH = Math.max(1, Math.ceil(anchorY - prism.tBack.y + pad));
  const botH = Math.max(1, Math.ceil(prism.bFront.y - anchorY + pad));
  return {
    minX: anchorX - halfW,
    minY: anchorY - topH,
    worldWidth: halfW * 2,
    worldHeight: topH + botH,
    offsetX: -halfW,
    offsetY: -topH,
  };
}

/**
 * Deterministic visual archetype key for a 3D building prism (invariant to world position).
 * Identical buildings share one packed Texture Atlas rect while keeping per-building Z-sorting.
 */
export function getBuildingSpriteArchetypeKey(
  b: Pick<Building, 'typ' | 'colorVariant' | 'uMin' | 'uMax' | 'vMin' | 'vMax' | 'height'>
): string {
  const du = Math.round((b.uMax - b.uMin) * 100);
  const dv = Math.round((b.vMax - b.vMin) * 100);
  const h = Math.round(b.height * 100);
  return `${b.typ}|${b.colorVariant}|${du}|${dv}|${h}`;
}

export const SPRITE_ATLAS_MAX_SIZE = 2048;
export const SPRITE_ATLAS_GUTTER = 2;

export interface SpriteAtlasRectInput {
  id: string;
  pixelWidth: number;
  pixelHeight: number;
}

export interface SpriteAtlasSlot {
  id: string;
  sheetIndex: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface SpriteAtlasSheetSpec {
  sheetIndex: number;
  width: number;
  height: number;
}

export interface SpriteAtlasPackResult {
  sheets: SpriteAtlasSheetSpec[];
  slots: Map<string, SpriteAtlasSlot>;
}

/**
 * Packs sprite rectangles row-by-row (shelf packing, sorted by descending height) into
 * compact Texture Atlas sheets capped at `maxSheetSize x maxSheetSize` px (default 2048x2048).
 */
export function packSpritesIntoAtlasSheets(
  items: readonly SpriteAtlasRectInput[],
  maxSheetSize = SPRITE_ATLAS_MAX_SIZE,
  gutter = SPRITE_ATLAS_GUTTER
): SpriteAtlasPackResult {
  const slots = new Map<string, SpriteAtlasSlot>();
  if (items.length === 0) {
    return { sheets: [], slots };
  }

  const sorted = [...items].sort((a, b) => {
    if (b.pixelHeight !== a.pixelHeight) return b.pixelHeight - a.pixelHeight;
    if (b.pixelWidth !== a.pixelWidth) return b.pixelWidth - a.pixelWidth;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const sheets: SpriteAtlasSheetSpec[] = [];
  let sheetIndex = 0;
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let usedWidth = 0;
  let usedHeight = 0;

  const commitCurrentSheet = () => {
    if (usedWidth > 0 && usedHeight > 0) {
      sheets.push({
        sheetIndex,
        width: Math.min(maxSheetSize, usedWidth),
        height: Math.min(maxSheetSize, usedHeight),
      });
    }
  };

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const sw = Math.max(1, Math.min(maxSheetSize, Math.ceil(item.pixelWidth)));
    const sh = Math.max(1, Math.min(maxSheetSize, Math.ceil(item.pixelHeight)));

    if (cursorX > 0 && cursorX + sw > maxSheetSize) {
      cursorX = 0;
      cursorY += rowHeight + gutter;
      rowHeight = 0;
    }

    if (cursorY > 0 && cursorY + sh > maxSheetSize) {
      commitCurrentSheet();
      sheetIndex += 1;
      cursorX = 0;
      cursorY = 0;
      rowHeight = 0;
      usedWidth = 0;
      usedHeight = 0;
    }

    slots.set(item.id, {
      id: item.id,
      sheetIndex,
      sx: cursorX,
      sy: cursorY,
      sw,
      sh,
    });

    usedWidth = Math.max(usedWidth, cursorX + sw);
    usedHeight = Math.max(usedHeight, cursorY + sh);
    cursorX += sw + gutter;
    rowHeight = Math.max(rowHeight, sh);
  }

  commitCurrentSheet();
  return { sheets, slots };
}

export interface PrecomputedBuilding3D {
  building: Building;
  prism: BuildingPrismPoints;
  /** World-space anchor X of the building footprint center */
  anchorX: number;
  /** World-space anchor Y of the building footprint center */
  anchorY: number;
  sx: number;
  sy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ParkLayoutSpec {
  quarterId: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  centerU: number;
  centerV: number;
  fenceInset: number;
  entranceHalfWidth: number;
  loopInset: number;
  loopPathWidth: number;
  crossPathWidth: number;
  plazaRadius: number;
  fountainRadius: number;
}

export interface GarageDrivewaySpec {
  id: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export type UrbanProp3D =
  | {
      propKind: 'fountain';
      id: string;
      u: number;
      v: number;
      radius: number;
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
      propKind: 'parkFenceSegment';
      id: string;
      u1: number;
      v1: number;
      u2: number;
      v2: number;
      axis: 'u' | 'v';
      height: number;
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
      propKind: 'parkFencePost';
      id: string;
      u: number;
      v: number;
      height: number;
      isGatePost: boolean;
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
      propKind: 'tree';
      id: string;
      u: number;
      v: number;
      species: 'deciduous' | 'conifer';
      crownRadius: number;
      height: number;
      variant: number;
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
      propKind: 'bench';
      id: string;
      u: number;
      v: number;
      axis: 'u' | 'v';
      facingSign: 1 | -1;
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
      propKind: 'lamp';
      id: string;
      u: number;
      v: number;
      height: number;
      uMin: number;
      uMax: number;
      vMin: number;
      vMax: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    };

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
    }
  | {
      kind: 'urbanProp';
      id: string;
      prop: UrbanProp3D;
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
  houseYards: HouseYardFence[],
  urbanProps: readonly UrbanProp3D[] = []
): StaticScene3DItem[] {
  const items: StaticScene3DItem[] = [];

  for (const b of buildings) {
    const prism = getBuildingPrismPoints(b);
    const anchor = isoToCanvas((b.uMin + b.uMax) * 0.5, (b.vMin + b.vMax) * 0.5);
    const sx = Math.min(36, b.height * 0.23);
    const sy = Math.min(6, b.height * 0.035);
    const minX = prism.bLeft.x;
    const maxX = prism.bRight.x + sx;
    const minY = prism.tBack.y;
    const maxY = prism.bFront.y;
    items.push({
      kind: 'building',
      id: b.id,
      item: {
        building: b,
        prism,
        anchorX: anchor.x,
        anchorY: anchor.y,
        sx,
        sy,
        minX,
        maxX,
        minY,
        maxY,
      },
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

  for (const prop of urbanProps) {
    items.push({
      kind: 'urbanProp',
      id: prop.id,
      prop,
      uMin: prop.uMin,
      uMax: prop.uMax,
      vMin: prop.vMin,
      vMax: prop.vMax,
      minX: prop.minX,
      maxX: prop.maxX,
      minY: prop.minY,
      maxY: prop.maxY,
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
  serviceFacilities: ServiceFacilitySpec[];
  parkLayout: ParkLayoutSpec | null;
  garageDriveways: GarageDrivewaySpec[];
  urbanProps: UrbanProp3D[];
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
      heightOverride?: number;
    }
  ): RawBuildingCandidate | null => {
    const height = candidate.heightOverride ?? getBuildingHeight(candidate.typ, candidate.pietra);
    const minDim = candidate.typ === 'garaz' ? 11 : 18;
    if (candidate.uMax - candidate.uMin < minDim || candidate.vMax - candidate.vMin < minDim) return null;
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
      const pad =
        candidate.typ === 'garaz'
          ? 1.5
          : candIsBlock && isApartmentBlock(existing.typ)
            ? -0.5
            : 6;
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

  // 1. BAZA depot garage hall on flush concrete yard — starts at Warehouse Tier 1
  //    (compact starter garage, ~60% footprint & lower height; scales with warehouseTier 1–4)
  const starterBaseSpec = getBaseBuildingSpec(1);
  tryPush({
    id: 'b_base_garage',
    typ: 'baza',
    pietra: 1,
    mieszkania: 0,
    uMin: starterBaseSpec.uMin,
    uMax: starterBaseSpec.uMax,
    vMin: starterBaseSpec.vMin,
    vMax: starterBaseSpec.vMax,
    heightOverride: starterBaseSpec.height,
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
  // 2G. REWORK INFRASTRUKTURY SERWISOWEJ (Krok 2A - Część 1):
  //     Usuń 6 wskazanych parkingów (po wygenerowaniu kiosków i paczkomatów, aby
  //     w 100% zachować istniejące kioski/pawilony) i wstaw w miejsce 3 z nich:
  //       1. Stacja Paliw #1 (q_1_5, ul. Kolejowa / al. Północna — zachowany b_kiosk_14)
  //       2. Stacja Paliw #2 (q_4_2, kwartał przy rondzie R1 u zbiegu ul. Słonecznej, al. Zachodniej i al. Głównej — zachowany b_kiosk_1)
  //       3. Garaż Mechanika (q_2_1, z bezpośrednim wjazdem od ul. Lipowej u_3)
  //     Pozostałe 3 peryferyjne / mniejsze parkingi (q_1_6 [0 bloków], q_0_5 [4 bloki],
  //     q_4_6 [mały 96x94]) zostają całkowicie zlikwidowane.
  // ---------------------------------------------------------------------------
  const REMOVED_PARKING_QUARTERS = new Set<string>([
    'q_1_5', // park_2  -> Stacja Paliw #1
    'q_4_2', // park_12 -> Stacja Paliw #2 (bliżej ronda R1, wjazd z al. Zachodniej)
    'q_2_1', // park_4  -> Garaż Mechanika (wjazd od ul. Lipowej)
    'q_1_6', // park_3  -> usunięty całkowicie (0 bloków, peryferyjny NE)
    'q_0_5', // park_1  -> usunięty całkowicie (4 bloki, peryferyjny N)
    'q_4_6', // park_16 -> usunięty całkowicie (mały 96x94, peryferyjny E)
  ]);

  const filteredParkingLots = parkingLots.filter(
    (lot) => !REMOVED_PARKING_QUARTERS.has(lot.quarterId)
  );
  parkingLots.length = 0;
  parkingLots.push(...filteredParkingLots);

  const serviceFacilities: ServiceFacilitySpec[] = [];

  // 1) Garaż Mechanika w kwartale q_2_1 (ul. Lipowa / al. Zachodnia / ul. Spacerowa)
  //    Wjazd asfaltowy poprowadzony WYŁĄCZNIE bezpośrednio na ul. Lipową (u_3, u = -360).
  const mechanicBuilding = tryPush({
    id: 'b_mechanic_garage',
    typ: 'mechanik',
    pietra: 1,
    mieszkania: 0,
    uMin: -582,
    uMax: -516,
    vMin: -966,
    vMax: -868,
    colorVariant: 0,
    forcedStreetId: 'u_3',
    dostepnyDlaDostaw: false,
  });
  if (mechanicBuilding) {
    serviceFacilities.push({
      id: 'sf_mechanic_garage',
      buildingId: mechanicBuilding.id,
      kind: 'mechanik',
      quarterId: 'q_2_1',
      yard: { uMin: -590, uMax: -452, vMin: -982, vMax: -852 },
      driveway: {
        uMin: -454,
        uMax: -374,
        vMin: -928,
        vMax: -906,
        axis: 'u',
        entrySide: 'uMax',
        streetId: 'u_3',
      },
      mouth: makeIsoCanvasPoint(-376, -917),
      yardEntry: makeIsoCanvasPoint(-456, -917),
      stop: makeIsoCanvasPoint(-492, -917),
      buildingRect: {
        uMin: mechanicBuilding.uMin,
        uMax: mechanicBuilding.uMax,
        vMin: mechanicBuilding.vMin,
        vMax: mechanicBuilding.vMax,
      },
    });
  }

  // 2) Stacja Paliw #1 w kwartale q_1_5 (skrzyżowanie ul. Kolejowej v = 380 i al. Północnej u = -720)
  //    Istniejący pawilon/kiosk (b_kiosk_14 przy u = -784..-764) pozostaje nienaruszony.
  const gasStation1 = tryPush({
    id: 'b_gas_station_1',
    typ: 'stacja_paliw',
    pietra: 1,
    mieszkania: 0,
    uMin: -966,
    uMax: -864,
    vMin: 454,
    vMax: 544,
    colorVariant: 0,
    forcedStreetId: 'v_5',
    dostepnyDlaDostaw: false,
  });
  if (gasStation1) {
    serviceFacilities.push({
      id: 'sf_gas_station_1',
      buildingId: gasStation1.id,
      kind: 'stacja_paliw',
      quarterId: 'q_1_5',
      yard: { uMin: -984, uMax: -846, vMin: 424, vMax: 562 },
      driveway: {
        uMin: -928,
        uMax: -902,
        vMin: 394,
        vMax: 426,
        axis: 'v',
        entrySide: 'vMin',
        streetId: 'v_5',
      },
      mouth: makeIsoCanvasPoint(-915, 396),
      yardEntry: makeIsoCanvasPoint(-915, 428),
      stop: makeIsoCanvasPoint(-915, 444),
      buildingRect: {
        uMin: gasStation1.uMin,
        uMax: gasStation1.uMax,
        vMin: gasStation1.vMin,
        vMax: gasStation1.vMax,
      },
    });
  }

  // 3) Stacja Paliw #2 w kwartale q_4_2 przy rondzie R1 (u zbiegu ul. Słonecznej u = 340,
  //    al. Zachodniej v = -740 i al. Głównej u = 0). Wjazd asfaltowy bezpośrednio z al. Zachodniej
  //    (v_2, v = -740), z bezpiecznym odstępem od przejść ronda R1, bloków, kiosku i paczkomatu.
  const gasStation2 = tryPush({
    id: 'b_gas_station_2',
    typ: 'stacja_paliw',
    pietra: 1,
    mieszkania: 0,
    uMin: 128,
    uMax: 230,
    vMin: -646,
    vMax: -556,
    colorVariant: 1,
    forcedStreetId: 'v_2',
    dostepnyDlaDostaw: false,
  });
  if (gasStation2) {
    serviceFacilities.push({
      id: 'sf_gas_station_2',
      buildingId: gasStation2.id,
      kind: 'stacja_paliw',
      quarterId: 'q_4_2',
      yard: { uMin: 112, uMax: 246, vMin: -676, vMax: -542 },
      driveway: {
        uMin: 172,
        uMax: 198,
        vMin: -716,
        vMax: -674,
        axis: 'v',
        entrySide: 'vMin',
        streetId: 'v_2',
      },
      mouth: makeIsoCanvasPoint(185, -714),
      yardEntry: makeIsoCanvasPoint(185, -672),
      stop: makeIsoCanvasPoint(185, -656),
      buildingRect: {
        uMin: gasStation2.uMin,
        uMax: gasStation2.uMax,
        vMin: gasStation2.vMin,
        vMax: gasStation2.vMax,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 2H. 8 WIDOCZNYCH, PRZYULICZNYCH DZIAŁEK POD AUTOMATY QUICKBOX (parcelLockerSlots)
  //     Each plot sits flush beside a main street with room for both the QuickBox locker
  //     and a single courier parking bay + driveway, guaranteed unoccluded by 3D buildings.
  // ---------------------------------------------------------------------------
  interface QuickBoxCandidate {
    quarterId: string;
    uMin: number;
    uMax: number;
    vMin: number;
    vMax: number;
    lockerRect: { uMin: number; uMax: number; vMin: number; vMax: number };
    parkingBay: { uMin: number; uMax: number; vMin: number; vMax: number };
    driveway: { uMin: number; uMax: number; vMin: number; vMax: number };
    streetSide: ParkingEdgeSide;
    streetId: string;
    streetName: string;
    axis: 'u' | 'v';
    u: number;
    v: number;
    frontFacingBonus: number;
  }

  // Build 6-vertex 2D isometric prism silhouettes of all placed 3D buildings for strict front-visibility checks
  const buildingSilhouettes = raw
    .filter((b) => b.height > 0)
    .map((b) => {
      const pts = [
        isoToCanvas(b.uMin, b.vMin),
        isoToCanvas(b.uMax, b.vMin),
        isoToCanvas(b.uMax, b.vMax),
        isoToCanvas(b.uMin, b.vMax),
      ];
      let top = pts[0];
      let bottom = pts[0];
      let left = pts[0];
      let right = pts[0];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].y < top.y) top = pts[i];
        if (pts[i].y > bottom.y) bottom = pts[i];
        if (pts[i].x < left.x) left = pts[i];
        if (pts[i].x > right.x) right = pts[i];
      }
      const h = b.height;
      const poly = [
        { x: top.x, y: top.y - h },
        { x: right.x, y: right.y - h },
        { x: right.x, y: right.y },
        { x: bottom.x, y: bottom.y },
        { x: left.x, y: left.y },
        { x: left.x, y: left.y - h },
      ];
      return {
        minX: left.x - 4,
        maxX: right.x + 4,
        minY: top.y - h - 4,
        maxY: bottom.y + 4,
        poly,
      };
    });

  const isCanvasPtInPoly = (x: number, y: number, poly: readonly { x: number; y: number }[]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  const isQuickBoxCandidateOccluded = (
    lockerRect: { uMin: number; uMax: number; vMin: number; vMax: number },
    parkingBay: { uMin: number; uMax: number; vMin: number; vMax: number }
  ): boolean => {
    const lCenter = isoToCanvas((lockerRect.uMin + lockerRect.uMax) / 2, (lockerRect.vMin + lockerRect.vMax) / 2);
    const bCenter = isoToCanvas((parkingBay.uMin + parkingBay.uMax) / 2, (parkingBay.vMin + parkingBay.vMax) / 2);
    const probePts = [
      lCenter,
      { x: lCenter.x, y: lCenter.y - 20 },
      isoToCanvas(lockerRect.uMin, lockerRect.vMin),
      isoToCanvas(lockerRect.uMax, lockerRect.vMin),
      isoToCanvas(lockerRect.uMax, lockerRect.vMax),
      isoToCanvas(lockerRect.uMin, lockerRect.vMax),
      bCenter,
    ];
    for (const pt of probePts) {
      for (let i = 0; i < buildingSilhouettes.length; i++) {
        const sil = buildingSilhouettes[i];
        if (pt.x < sil.minX || pt.x > sil.maxX || pt.y < sil.minY || pt.y > sil.maxY) continue;
        if (isCanvasPtInPoly(pt.x, pt.y, sil.poly)) return true;
      }
    }
    return false;
  };

  const overlapsAccessRoad = (
    box: { uMin: number; uMax: number; vMin: number; vMax: number },
    pad: number
  ): boolean => {
    for (const ar of RESIDENTIAL_ACCESS_ROADS) {
      const half = ar.asphaltWidth / 2 + ar.sidewalkWidth + pad;
      const arBox =
        ar.axis === 'u'
          ? {
              uMin: ar.coord - half,
              uMax: ar.coord + half,
              vMin: Math.min(ar.startCoord, ar.endCoord) - pad,
              vMax: Math.max(ar.startCoord, ar.endCoord) + pad,
            }
          : {
              uMin: Math.min(ar.startCoord, ar.endCoord) - pad,
              uMax: Math.max(ar.startCoord, ar.endCoord) + pad,
              vMin: ar.coord - half,
              vMax: ar.coord + half,
            };
      if (rectsOverlap(box, arBox, 0)) return true;
    }
    return false;
  };

  const scanRoadsideQuickBoxCandidates = (
    plotAlong: number,
    plotDepth: number,
    bldgPad: number,
    otherPad: number
  ): QuickBoxCandidate[] => {
    const out: QuickBoxCandidate[] = [];
    const streetCoversSpan = (s: StreetSpec, a: number, b: number) =>
      s.spans.some(([s0, s1]) => a >= s0 + 8 && b <= s1 - 8);

    const trySide = (
      q: (typeof CITY_QUARTERS)[number],
      streetSide: ParkingEdgeSide,
      street: StreetSpec
    ) => {
      const isUStreet = street.axis === 'u';
      const alongMin = (isUStreet ? q.vMin : q.uMin) + 34;
      const alongMax = (isUStreet ? q.vMax : q.uMax) - 34 - plotAlong;
      if (alongMax < alongMin) return;

      const streetAsphaltEdge =
        streetSide === 'uMin' || streetSide === 'vMin'
          ? street.coord + street.asphaltWidth / 2
          : street.coord - street.asphaltWidth / 2;

      for (let along = alongMin; along <= alongMax; along += 12) {
        if (!streetCoversSpan(street, along, along + plotAlong)) continue;

        let uMin: number;
        let uMax: number;
        let vMin: number;
        let vMax: number;
        let lockerRect: { uMin: number; uMax: number; vMin: number; vMax: number };
        let parkingBay: { uMin: number; uMax: number; vMin: number; vMax: number };
        let driveway: { uMin: number; uMax: number; vMin: number; vMax: number };

        const EDGE_INSET = 5;
        const lockerAlong = 18;
        const lockerDepth = 10;
        const bayAlong = plotAlong - lockerAlong - 4;
        const bayDepth = plotDepth - 4;
        const dwWidth = 14;

        if (streetSide === 'uMin') {
          uMin = q.uMin + EDGE_INSET;
          uMax = uMin + plotDepth;
          vMin = along;
          vMax = along + plotAlong;
          lockerRect = { uMin: uMin + 5, uMax: uMin + 5 + lockerDepth, vMin: vMin + 1, vMax: vMin + 1 + lockerAlong };
          parkingBay = { uMin: uMin + 1, uMax: uMin + 1 + bayDepth, vMin: vMax - bayAlong - 1, vMax: vMax - 1 };
          const dwCenterV = (parkingBay.vMin + parkingBay.vMax) / 2;
          driveway = { uMin: streetAsphaltEdge - 1, uMax: parkingBay.uMin + 1, vMin: dwCenterV - dwWidth / 2, vMax: dwCenterV + dwWidth / 2 };
        } else if (streetSide === 'uMax') {
          uMax = q.uMax - EDGE_INSET;
          uMin = uMax - plotDepth;
          vMin = along;
          vMax = along + plotAlong;
          lockerRect = { uMin: uMax - 5 - lockerDepth, uMax: uMax - 5, vMin: vMin + 1, vMax: vMin + 1 + lockerAlong };
          parkingBay = { uMin: uMax - 1 - bayDepth, uMax: uMax - 1, vMin: vMax - bayAlong - 1, vMax: vMax - 1 };
          const dwCenterV = (parkingBay.vMin + parkingBay.vMax) / 2;
          driveway = { uMin: parkingBay.uMax - 1, uMax: streetAsphaltEdge + 1, vMin: dwCenterV - dwWidth / 2, vMax: dwCenterV + dwWidth / 2 };
        } else if (streetSide === 'vMin') {
          vMin = q.vMin + EDGE_INSET;
          vMax = vMin + plotDepth;
          uMin = along;
          uMax = along + plotAlong;
          lockerRect = { uMin: uMin + 1, uMax: uMin + 1 + lockerAlong, vMin: vMin + 5, vMax: vMin + 5 + lockerDepth };
          parkingBay = { uMin: uMax - bayAlong - 1, uMax: uMax - 1, vMin: vMin + 1, vMax: vMin + 1 + bayDepth };
          const dwCenterU = (parkingBay.uMin + parkingBay.uMax) / 2;
          driveway = { uMin: dwCenterU - dwWidth / 2, uMax: dwCenterU + dwWidth / 2, vMin: streetAsphaltEdge - 1, vMax: parkingBay.vMin + 1 };
        } else {
          vMax = q.vMax - EDGE_INSET;
          vMin = vMax - plotDepth;
          uMin = along;
          uMax = along + plotAlong;
          lockerRect = { uMin: uMin + 1, uMax: uMin + 1 + lockerAlong, vMin: vMax - 5 - lockerDepth, vMax: vMax - 5 };
          parkingBay = { uMin: uMax - bayAlong - 1, uMax: uMax - 1, vMin: vMax - 1 - bayDepth, vMax: vMax - 1 };
          const dwCenterU = (parkingBay.uMin + parkingBay.uMax) / 2;
          driveway = { uMin: dwCenterU - dwWidth / 2, uMax: dwCenterU + dwWidth / 2, vMin: parkingBay.vMax - 1, vMax: streetAsphaltEdge + 1 };
        }

        if (!isBuildingVisibleInMap(uMin, uMax, vMin, vMax, 30)) continue;
        const cu = (uMin + uMax) / 2;
        const cv = (vMin + vMax) / 2;
        // Keep QuickBox plots inside the built-up inner city ring, away from outer exits
        if (cu < -1040 || cu > 960 || cv < -1040 || cv > 1060) continue;
        if (rectOverlapsActiveStreet(uMin, uMax, vMin, vMax)) continue;
        if (rectOverlapsRoundabout(uMin, uMax, vMin, vMax, 32)) continue;
        if (rectOverlapsBaseYard(uMin, uMax, vMin, vMax, 12)) continue;
        const box = { uMin, uMax, vMin, vMax };
        if (overlapsAccessRoad(box, 5)) continue;
        if (raw.some((b) => rectsOverlap(b, box, bldgPad))) continue;
        if (overlapsAnyParking(box, otherPad)) continue;
        if (deliveryZones.some((dz) => rectsOverlap(dz.bay, box, otherPad) || rectsOverlap(dz.driveway, box, otherPad))) continue;
        if (houseYards.some((hy) => rectsOverlap(hy, box, otherPad))) continue;
        if (serviceFacilities.some((sf) => rectsOverlap(sf.yard, box, otherPad + 2))) continue;
        if (isQuickBoxCandidateOccluded(lockerRect, parkingBay)) continue;

        if (out.some((prev) => prev.quarterId === q.id && Math.hypot(prev.u - cu, prev.v - cv) < 34)) {
          continue;
        }

        // Front-facing bonus: sides where the street opens in front of the plot in isometric view
        const plotCenterCanvas = isoToCanvas(cu, cv);
        const streetProbeCanvas = isoToCanvas(
          streetSide === 'uMin' ? street.coord : streetSide === 'uMax' ? street.coord : cu,
          streetSide === 'vMin' ? street.coord : streetSide === 'vMax' ? street.coord : cv
        );
        const frontFacingBonus = streetProbeCanvas.y > plotCenterCanvas.y ? 1 : 0;

        out.push({
          quarterId: q.id,
          uMin: round1(uMin),
          uMax: round1(uMax),
          vMin: round1(vMin),
          vMax: round1(vMax),
          lockerRect: {
            uMin: round1(lockerRect.uMin),
            uMax: round1(lockerRect.uMax),
            vMin: round1(lockerRect.vMin),
            vMax: round1(lockerRect.vMax),
          },
          parkingBay: {
            uMin: round1(parkingBay.uMin),
            uMax: round1(parkingBay.uMax),
            vMin: round1(parkingBay.vMin),
            vMax: round1(parkingBay.vMax),
          },
          driveway: {
            uMin: round1(driveway.uMin),
            uMax: round1(driveway.uMax),
            vMin: round1(driveway.vMin),
            vMax: round1(driveway.vMax),
          },
          streetSide,
          streetId: street.id,
          streetName: street.name,
          axis: isUStreet ? 'v' : 'u',
          u: round1(cu),
          v: round1(cv),
          frontFacingBonus,
        });
      }
    };

    for (const q of CITY_QUARTERS) {
      if (q.kind === 'park' || q.id === 'q_3_1' || q.id === 'q_3_4') continue;
      for (const s of U_STREETS) {
        const edgePos = s.coord + s.asphaltWidth / 2 + s.sidewalkWidth;
        const edgeNeg = s.coord - s.asphaltWidth / 2 - s.sidewalkWidth;
        if (Math.abs(q.uMin - edgePos) <= 12) trySide(q, 'uMin', s);
        if (Math.abs(q.uMax - edgeNeg) <= 12) trySide(q, 'uMax', s);
      }
      for (const s of V_STREETS) {
        const edgePos = s.coord + s.asphaltWidth / 2 + s.sidewalkWidth;
        const edgeNeg = s.coord - s.asphaltWidth / 2 - s.sidewalkWidth;
        if (Math.abs(q.vMin - edgePos) <= 12) trySide(q, 'vMin', s);
        if (Math.abs(q.vMax - edgeNeg) <= 12) trySide(q, 'vMax', s);
      }
    }

    return out;
  };

  let qbCandidates = scanRoadsideQuickBoxCandidates(42, 22, 4, 4);
  if (qbCandidates.length < 8) {
    const relaxed = scanRoadsideQuickBoxCandidates(38, 20, 2.5, 2.5);
    for (const c of relaxed) {
      if (!qbCandidates.some((p) => Math.hypot(p.u - c.u, p.v - c.v) < 40)) {
        qbCandidates.push(c);
      }
    }
  }
  if (qbCandidates.length < 8) {
    const compact = scanRoadsideQuickBoxCandidates(34, 18, 1.5, 1.5);
    for (const c of compact) {
      if (!qbCandidates.some((p) => Math.hypot(p.u - c.u, p.v - c.v) < 36)) {
        qbCandidates.push(c);
      }
    }
  }

  // Greedy inner-city spatial selection of 8 QuickBox plots across built-up districts
  const CITY_CENTER_U = -120;
  const CITY_CENTER_V = -80;
  const chosenQbSpots: QuickBoxCandidate[] = [];
  if (qbCandidates.length > 0) {
    // Prefer front-facing plots first when picking the seed
    const preferredPool = qbCandidates.filter((c) => c.frontFacingBonus > 0);
    const seedPool = preferredPool.length >= 8 ? preferredPool : qbCandidates;
    // Start with the front-facing candidate closest to downtown (u = -120, v = -80)
    const first = [...seedPool].sort(
      (a, b) =>
        Math.hypot(a.u - CITY_CENTER_U, a.v - CITY_CENTER_V) -
        Math.hypot(b.u - CITY_CENTER_U, b.v - CITY_CENTER_V)
    )[0];
    chosenQbSpots.push(first);

    while (chosenQbSpots.length < 8) {
      let bestCand: QuickBoxCandidate | null = null;
      let bestScore = -Infinity;
      for (const cand of qbCandidates) {
        if (chosenQbSpots.some((c) => c.quarterId === cand.quarterId)) continue;
        let minDist = Infinity;
        for (const picked of chosenQbSpots) {
          const d = Math.hypot(cand.u - picked.u, cand.v - picked.v);
          if (d < minDist) minDist = d;
        }
        if (minDist < 360) continue;
        const distFromCenter = Math.hypot(cand.u - CITY_CENTER_U, cand.v - CITY_CENTER_V);
        const score = minDist + cand.frontFacingBonus * 90 - distFromCenter * 0.35;
        if (score > bestScore) {
          bestScore = score;
          bestCand = cand;
        }
      }
      if (!bestCand) {
        // Fallback: relax spacing/quarter uniqueness if fewer than 8 distinct quarters met minDist >= 360
        for (const cand of qbCandidates) {
          if (chosenQbSpots.includes(cand)) continue;
          let minDist = Infinity;
          for (const picked of chosenQbSpots) {
            const d = Math.hypot(cand.u - picked.u, cand.v - picked.v);
            if (d < minDist) minDist = d;
          }
          if (minDist < 120) continue;
          const distFromCenter = Math.hypot(cand.u - CITY_CENTER_U, cand.v - CITY_CENTER_V);
          const score = minDist + cand.frontFacingBonus * 90 - distFromCenter * 0.35;
          if (score > bestScore) {
            bestScore = score;
            bestCand = cand;
          }
        }
      }
      if (!bestCand) break;
      chosenQbSpots.push(bestCand);
    }
  }

  // Deterministic geographic ordering (NW -> SE) for stable slot IDs & zone indices 0..7
  chosenQbSpots.sort((a, b) => a.u - b.u || a.v - b.v);

  const parcelLockerSlots: ParcelLockerSlot[] = chosenQbSpots.map((spot, idx) => ({
    id: `locker_slot_${idx + 1}`,
    zoneIndex: idx,
    quarterId: spot.quarterId,
    uMin: spot.uMin,
    uMax: spot.uMax,
    vMin: spot.vMin,
    vMax: spot.vMax,
    lockerRect: spot.lockerRect,
    parkingBay: spot.parkingBay,
    driveway: spot.driveway,
    streetSide: spot.streetSide,
    streetId: spot.streetId,
    ...makeIsoCanvasPoint(spot.u, spot.v),
    axis: spot.axis,
    nearestStreetName: spot.streetName,
    occupied: false,
  }));

  // ---------------------------------------------------------------------------
  // 2I. PRZYDOMOWE GARAŻE NA WEWNĘTRZNYCH OSIEDLACH DOMKÓW (typ: 'garaz', dostepnyDlaDostaw: false)
  //     Placed beside ~30% of single-family houses in inner house quarters where free space exists
  //     without blocking the yard entrance gate or overlapping any street, yard, or QuickBox plot.
  // ---------------------------------------------------------------------------
  const garageDriveways: GarageDrivewaySpec[] = [];
  const rawById = new Map(raw.map((b) => [b.id, b]));
  let garageSeq = 0;

  for (let yi = 0; yi < houseYards.length; yi++) {
    // Deterministic ~32% selection across houses
    if (yi % 3 !== 0 && yi % 11 !== 4) continue;
    const yard = houseYards[yi];
    const yMidU = (yard.uMin + yard.uMax) * 0.5;
    const yMidV = (yard.vMin + yard.vMax) * 0.5;
    // Inner built-up residential estates only (skip outer map exit fringes)
    if (yMidU < -1060 || yMidU > 980 || yMidV < -1060 || yMidV > 1080) continue;

    const house = rawById.get(yard.buildingId);
    if (!house || house.typ !== 'dom') continue;

    const alongU = yard.streetSide === 'vMin' || yard.streetSide === 'vMax';
    const gW = alongU ? 13 : 17;
    const gH = alongU ? 17 : 13;

    type GarageCandidate = {
      uMin: number;
      uMax: number;
      vMin: number;
      vMax: number;
      insideYard: boolean;
    };
    const candidates: GarageCandidate[] = [];

    // 1) Inside-yard candidates directly beside the house (2.5u from house wall, 1.5u from yard fence)
    if (yard.streetSide === 'vMin') {
      const vMin = Math.max(yard.vMin + 1.5, Math.min(house.vMin, yard.vMax - 1.5 - gH));
      const vMax = vMin + gH;
      candidates.push(
        { uMin: house.uMax + 2.5, uMax: house.uMax + 2.5 + gW, vMin, vMax, insideYard: true },
        { uMin: house.uMin - 2.5 - gW, uMax: house.uMin - 2.5, vMin, vMax, insideYard: true }
      );
    } else if (yard.streetSide === 'vMax') {
      const vMax = Math.min(yard.vMax - 1.5, Math.max(house.vMax, yard.vMin + 1.5 + gH));
      const vMin = vMax - gH;
      candidates.push(
        { uMin: house.uMax + 2.5, uMax: house.uMax + 2.5 + gW, vMin, vMax, insideYard: true },
        { uMin: house.uMin - 2.5 - gW, uMax: house.uMin - 2.5, vMin, vMax, insideYard: true }
      );
    } else if (yard.streetSide === 'uMin') {
      const uMin = Math.max(yard.uMin + 1.5, Math.min(house.uMin, yard.uMax - 1.5 - gW));
      const uMax = uMin + gW;
      candidates.push(
        { uMin, uMax, vMin: house.vMax + 2.5, vMax: house.vMax + 2.5 + gH, insideYard: true },
        { uMin, uMax, vMin: house.vMin - 2.5 - gH, vMax: house.vMin - 2.5, insideYard: true }
      );
    } else {
      const uMax = Math.min(yard.uMax - 1.5, Math.max(house.uMax, yard.uMin + 1.5 + gW));
      const uMin = uMax - gW;
      candidates.push(
        { uMin, uMax, vMin: house.vMax + 2.5, vMax: house.vMax + 2.5 + gH, insideYard: true },
        { uMin, uMax, vMin: house.vMin - 2.5 - gH, vMax: house.vMin - 2.5, insideYard: true }
      );
    }

    // 2) Flank candidates outside the yard fence along the same street frontage (left or right side)
    if (yard.streetSide === 'vMin') {
      candidates.push(
        { uMin: yard.uMax + 2, uMax: yard.uMax + 2 + gW, vMin: yard.vMin + 4, vMax: yard.vMin + 4 + gH, insideYard: false },
        { uMin: yard.uMin - 2 - gW, uMax: yard.uMin - 2, vMin: yard.vMin + 4, vMax: yard.vMin + 4 + gH, insideYard: false }
      );
    } else if (yard.streetSide === 'vMax') {
      candidates.push(
        { uMin: yard.uMax + 2, uMax: yard.uMax + 2 + gW, vMin: yard.vMax - 4 - gH, vMax: yard.vMax - 4, insideYard: false },
        { uMin: yard.uMin - 2 - gW, uMax: yard.uMin - 2, vMin: yard.vMax - 4 - gH, vMax: yard.vMax - 4, insideYard: false }
      );
    } else if (yard.streetSide === 'uMin') {
      candidates.push(
        { uMin: yard.uMin + 4, uMax: yard.uMin + 4 + gW, vMin: yard.vMax + 2, vMax: yard.vMax + 2 + gH, insideYard: false },
        { uMin: yard.uMin + 4, uMax: yard.uMin + 4 + gW, vMin: yard.vMin - 2 - gH, vMax: yard.vMin - 2, insideYard: false }
      );
    } else {
      candidates.push(
        { uMin: yard.uMax - 4 - gW, uMax: yard.uMax - 4, vMin: yard.vMax + 2, vMax: yard.vMax + 2 + gH, insideYard: false },
        { uMin: yard.uMax - 4 - gW, uMax: yard.uMax - 4, vMin: yard.vMin - 2 - gH, vMax: yard.vMin - 2, insideYard: false }
      );
    }

    for (const gc of candidates) {
      if (gc.insideYard) {
        if (
          gc.uMin < yard.uMin + 1.5 ||
          gc.uMax > yard.uMax - 1.5 ||
          gc.vMin < yard.vMin + 1.5 ||
          gc.vMax > yard.vMax - 1.5
        ) {
          continue;
        }
      }
      if (!isBuildingVisibleInMap(gc.uMin, gc.uMax, gc.vMin, gc.vMax, 24)) continue;
      if (rectOverlapsActiveStreet(gc.uMin, gc.uMax, gc.vMin, gc.vMax)) continue;
      if (rectOverlapsRoundabout(gc.uMin, gc.uMax, gc.vMin, gc.vMax, 18)) continue;
      if (rectOverlapsBaseYard(gc.uMin, gc.uMax, gc.vMin, gc.vMax, 10)) continue;
      if (overlapsAccessRoad(gc, 3.5)) continue;
      if (
        raw.some((b) =>
          rectsOverlap(b, gc, gc.insideYard && b.id === house.id ? 1.5 : 3.0)
        )
      ) {
        continue;
      }
      if (
        houseYards.some(
          (hy) => (!gc.insideYard || hy.buildingId !== yard.buildingId) && rectsOverlap(hy, gc, 1.2)
        )
      ) {
        continue;
      }
      if (overlapsAnyParking(gc, 4)) continue;
      if (parcelLockerSlots.some((s) => rectsOverlap(s, gc, 4))) continue;
      if (serviceFacilities.some((sf) => rectsOverlap(sf.yard, gc, 4))) continue;

      const gCenterU = (gc.uMin + gc.uMax) * 0.5;
      const gCenterV = (gc.vMin + gc.vMax) * 0.5;
      // Ensure garage never blocks the house gate entrance corridor
      if (Math.hypot(gCenterU - yard.gateCenter.u, gCenterV - yard.gateCenter.v) < 13) continue;

      const placedGarage = tryPush({
        id: `b_garaz_${++garageSeq}`,
        typ: 'garaz',
        pietra: 1,
        mieszkania: 0,
        uMin: round1(gc.uMin),
        uMax: round1(gc.uMax),
        vMin: round1(gc.vMin),
        vMax: round1(gc.vMax),
        colorVariant: house.colorVariant,
        dostepnyDlaDostaw: false,
        forcedStreetId: yard.streetId,
      });

      if (placedGarage) {
        // Short cobblestone driveway pad right in front of the garage door toward the street
        const dwDepth = 6.5;
        const dw: GarageDrivewaySpec =
          yard.streetSide === 'vMin'
            ? { id: `gdw_${garageSeq}`, uMin: gc.uMin + 1.5, uMax: gc.uMax - 1.5, vMin: gc.vMin - dwDepth, vMax: gc.vMin }
            : yard.streetSide === 'vMax'
              ? { id: `gdw_${garageSeq}`, uMin: gc.uMin + 1.5, uMax: gc.uMax - 1.5, vMin: gc.vMax, vMax: gc.vMax + dwDepth }
              : yard.streetSide === 'uMin'
                ? { id: `gdw_${garageSeq}`, uMin: gc.uMin - dwDepth, uMax: gc.uMin, vMin: gc.vMin + 1.5, vMax: gc.vMax - 1.5 }
                : { id: `gdw_${garageSeq}`, uMin: gc.uMax, uMax: gc.uMax + dwDepth, vMin: gc.vMin + 1.5, vMax: gc.vMax - 1.5 };
        garageDriveways.push(dw);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2J. PARK MIEJSKI (q_2_2) + ZIELEŃ I ŁAWKI NA WEWNĘTRZNYCH OSIEDLACH DOMKÓW
  //     Precomputed once at startup for 144 FPS static 3D depth sorting.
  // ---------------------------------------------------------------------------
  const urbanProps: UrbanProp3D[] = [];
  let parkLayout: ParkLayoutSpec | null = null;
  let propSeq = 0;

  const makeTreeProp = (
    u: number,
    v: number,
    species: 'deciduous' | 'conifer',
    crownRadius: number,
    height: number,
    variant: number
  ): UrbanProp3D => {
    const c = isoToCanvas(u, v);
    const padX = crownRadius * 1.45 + 6;
    const footR = Math.min(4.2, crownRadius * 0.42);
    return {
      propKind: 'tree',
      id: `prop_tree_${++propSeq}`,
      u: round1(u),
      v: round1(v),
      species,
      crownRadius: round1(crownRadius),
      height: round1(height),
      variant,
      uMin: round1(u - footR),
      uMax: round1(u + footR),
      vMin: round1(v - footR),
      vMax: round1(v + footR),
      minX: c.x - padX,
      maxX: c.x + padX + 10,
      minY: c.y - height - crownRadius * 0.7 - 4,
      maxY: c.y + crownRadius * 0.75 + 4,
    };
  };

  const makeBenchProp = (u: number, v: number, axis: 'u' | 'v', facingSign: 1 | -1): UrbanProp3D => {
    const halfU = axis === 'u' ? 3.8 : 1.7;
    const halfV = axis === 'u' ? 1.7 : 3.8;
    const c = isoToCanvas(u, v);
    return {
      propKind: 'bench',
      id: `prop_bench_${++propSeq}`,
      u: round1(u),
      v: round1(v),
      axis,
      facingSign,
      uMin: round1(u - halfU),
      uMax: round1(u + halfU),
      vMin: round1(v - halfV),
      vMax: round1(v + halfV),
      minX: c.x - 10,
      maxX: c.x + 10,
      minY: c.y - 10,
      maxY: c.y + 8,
    };
  };

  const makeLampProp = (u: number, v: number, height = 24): UrbanProp3D => {
    const c = isoToCanvas(u, v);
    return {
      propKind: 'lamp',
      id: `prop_lamp_${++propSeq}`,
      u: round1(u),
      v: round1(v),
      height,
      uMin: round1(u - 1.2),
      uMax: round1(u + 1.2),
      vMin: round1(v - 1.2),
      vMax: round1(v + 1.2),
      minX: c.x - 8,
      maxX: c.x + 12,
      minY: c.y - height - 8,
      maxY: c.y + 5,
    };
  };

  const parkQuarter = CITY_QUARTERS.find((q) => q.id === 'q_2_2');
  if (parkQuarter) {
    const centerU = round1((parkQuarter.uMin + parkQuarter.uMax) * 0.5);
    const centerV = round1((parkQuarter.vMin + parkQuarter.vMax) * 0.5);
    const fenceInset = 3.5;
    const entranceHalfWidth = 9.5; // 19u wide open entrances on all 4 sides
    const loopInset = 26;
    const loopPathWidth = 10;
    const crossPathWidth = 12;
    const plazaRadius = 34;
    const fountainRadius = 17;

    parkLayout = {
      quarterId: parkQuarter.id,
      uMin: parkQuarter.uMin,
      uMax: parkQuarter.uMax,
      vMin: parkQuarter.vMin,
      vMax: parkQuarter.vMax,
      centerU,
      centerV,
      fenceInset,
      entranceHalfWidth,
      loopInset,
      loopPathWidth,
      crossPathWidth,
      plazaRadius,
      fountainRadius,
    };

    // 1. Central ornamental 3D fountain
    const fCenter = isoToCanvas(centerU, centerV);
    urbanProps.push({
      propKind: 'fountain',
      id: 'park_central_fountain',
      u: centerU,
      v: centerV,
      radius: fountainRadius,
      uMin: round1(centerU - fountainRadius),
      uMax: round1(centerU + fountainRadius),
      vMin: round1(centerV - fountainRadius),
      vMax: round1(centerV + fountainRadius),
      minX: fCenter.x - fountainRadius * 2.1,
      maxX: fCenter.x + fountainRadius * 2.1,
      minY: fCenter.y - fountainRadius - 32,
      maxY: fCenter.y + fountainRadius + 8,
    });

    // 2. Tall black wrought-iron perimeter fence (height 15px) with 4 open entrances + heavier gate posts
    const fu0 = parkQuarter.uMin + fenceInset;
    const fu1 = parkQuarter.uMax - fenceInset;
    const fv0 = parkQuarter.vMin + fenceInset;
    const fv1 = parkQuarter.vMax - fenceInset;
    const fenceHeight = 15;
    const gatePostHeight = 17;

    const addParkFencePost = (u: number, v: number, isGatePost: boolean) => {
      const c = isoToCanvas(u, v);
      const h = isGatePost ? gatePostHeight : fenceHeight + 1;
      urbanProps.push({
        propKind: 'parkFencePost',
        id: `park_fpost_${++propSeq}`,
        u: round1(u),
        v: round1(v),
        height: h,
        isGatePost,
        uMin: round1(u - 0.9),
        uMax: round1(u + 0.9),
        vMin: round1(v - 0.9),
        vMax: round1(v + 0.9),
        minX: c.x - 5,
        maxX: c.x + 7,
        minY: c.y - h - 4,
        maxY: c.y + 4,
      });
    };

    const addParkFenceSpan = (
      axis: 'u' | 'v',
      fixedCoord: number,
      fromCoord: number,
      toCoord: number,
      startIsGate: boolean,
      endIsGate: boolean
    ) => {
      const spanLen = toCoord - fromCoord;
      if (spanLen < 4) return;
      const segCount = Math.max(1, Math.round(spanLen / 20));
      const step = spanLen / segCount;
      for (let i = 0; i <= segCount; i++) {
        const pos = fromCoord + i * step;
        const isGate = (i === 0 && startIsGate) || (i === segCount && endIsGate);
        if (axis === 'u') {
          addParkFencePost(pos, fixedCoord, isGate);
        } else {
          addParkFencePost(fixedCoord, pos, isGate);
        }
      }
      for (let i = 0; i < segCount; i++) {
        const a = fromCoord + i * step;
        const b = fromCoord + (i + 1) * step;
        const u1 = axis === 'u' ? a : fixedCoord;
        const v1 = axis === 'u' ? fixedCoord : a;
        const u2 = axis === 'u' ? b : fixedCoord;
        const v2 = axis === 'u' ? fixedCoord : b;
        const p1 = isoToCanvas(u1, v1);
        const p2 = isoToCanvas(u2, v2);
        urbanProps.push({
          propKind: 'parkFenceSegment',
          id: `park_fseg_${++propSeq}`,
          u1: round1(u1),
          v1: round1(v1),
          u2: round1(u2),
          v2: round1(v2),
          axis,
          height: fenceHeight,
          uMin: round1(Math.min(u1, u2) - 0.6),
          uMax: round1(Math.max(u1, u2) + 0.6),
          vMin: round1(Math.min(v1, v2) - 0.6),
          vMax: round1(Math.max(v1, v2) + 0.6),
          minX: Math.min(p1.x, p2.x) - 3,
          maxX: Math.max(p1.x, p2.x) + 6,
          minY: Math.min(p1.y, p2.y) - fenceHeight - 4,
          maxY: Math.max(p1.y, p2.y) + 4,
        });
      }
    };

    // 4 perimeter sides split at center entrance gaps
    addParkFenceSpan('u', fv0, fu0, centerU - entranceHalfWidth, false, true);
    addParkFenceSpan('u', fv0, centerU + entranceHalfWidth, fu1, true, false);
    addParkFenceSpan('u', fv1, fu0, centerU - entranceHalfWidth, false, true);
    addParkFenceSpan('u', fv1, centerU + entranceHalfWidth, fu1, true, false);
    addParkFenceSpan('v', fu0, fv0, centerV - entranceHalfWidth, false, true);
    addParkFenceSpan('v', fu0, centerV + entranceHalfWidth, fv1, true, false);
    addParkFenceSpan('v', fu1, fv0, centerV - entranceHalfWidth, false, true);
    addParkFenceSpan('v', fu1, centerV + entranceHalfWidth, fv1, true, false);

    // 3. Park street lamps at all 4 entrances, around the central plaza, and along main paths
    const lampOffsetFromGate = entranceHalfWidth + 4.5;
    // Entrance lamps
    urbanProps.push(
      makeLampProp(centerU - lampOffsetFromGate, fv0 + 4.5, 24),
      makeLampProp(centerU + lampOffsetFromGate, fv0 + 4.5, 24),
      makeLampProp(centerU - lampOffsetFromGate, fv1 - 4.5, 24),
      makeLampProp(centerU + lampOffsetFromGate, fv1 - 4.5, 24),
      makeLampProp(fu0 + 4.5, centerV - lampOffsetFromGate, 24),
      makeLampProp(fu0 + 4.5, centerV + lampOffsetFromGate, 24),
      makeLampProp(fu1 - 4.5, centerV - lampOffsetFromGate, 24),
      makeLampProp(fu1 - 4.5, centerV + lampOffsetFromGate, 24)
    );
    // Central plaza 4 diagonal lamps
    const plazaLampDist = plazaRadius - 4;
    urbanProps.push(
      makeLampProp(centerU - plazaLampDist * 0.72, centerV - plazaLampDist * 0.72, 25),
      makeLampProp(centerU + plazaLampDist * 0.72, centerV - plazaLampDist * 0.72, 25),
      makeLampProp(centerU - plazaLampDist * 0.72, centerV + plazaLampDist * 0.72, 25),
      makeLampProp(centerU + plazaLampDist * 0.72, centerV + plazaLampDist * 0.72, 25)
    );
    // Mid-avenue lamps along the 4 cross paths
    const midULeft = (fu0 + loopInset + centerU - plazaRadius) * 0.5;
    const midURight = (fu1 - loopInset + centerU + plazaRadius) * 0.5;
    const midVTop = (fv0 + loopInset + centerV - plazaRadius) * 0.5;
    const midVBot = (fv1 - loopInset + centerV + plazaRadius) * 0.5;
    urbanProps.push(
      makeLampProp(midULeft, centerV - crossPathWidth * 0.5 - 3.5, 23),
      makeLampProp(midURight, centerV + crossPathWidth * 0.5 + 3.5, 23),
      makeLampProp(centerU + crossPathWidth * 0.5 + 3.5, midVTop, 23),
      makeLampProp(centerU - crossPathWidth * 0.5 - 3.5, midVBot, 23)
    );

    // 4. Park benches facing the central fountain and along the cross avenues
    urbanProps.push(
      makeBenchProp(centerU, centerV - plazaRadius + 5.5, 'u', 1),
      makeBenchProp(centerU, centerV + plazaRadius - 5.5, 'u', -1),
      makeBenchProp(centerU - plazaRadius + 5.5, centerV, 'v', 1),
      makeBenchProp(centerU + plazaRadius - 5.5, centerV, 'v', -1),
      // Cross-avenue benches
      makeBenchProp(midULeft, centerV + crossPathWidth * 0.5 + 3.6, 'u', -1),
      makeBenchProp(midURight, centerV - crossPathWidth * 0.5 - 3.6, 'u', 1),
      makeBenchProp(centerU - crossPathWidth * 0.5 - 3.6, midVTop, 'v', 1),
      makeBenchProp(centerU + crossPathWidth * 0.5 + 3.6, midVBot, 'v', -1)
    );

    // 5. Lush trees across the 4 park lawn quadrants (strictly clear of paths, plaza, fence, lamps & benches)
    const loopU0 = parkQuarter.uMin + loopInset;
    const loopU1 = parkQuarter.uMax - loopInset;
    const loopV0 = parkQuarter.vMin + loopInset;
    const loopV1 = parkQuarter.vMax - loopInset;

    const isPointOnParkPathOrPlaza = (u: number, v: number, pad: number): boolean => {
      if (Math.hypot(u - centerU, v - centerV) < plazaRadius + pad) return true;
      if (Math.abs(u - centerU) < crossPathWidth * 0.5 + pad) return true;
      if (Math.abs(v - centerV) < crossPathWidth * 0.5 + pad) return true;
      // Perimeter walking loop
      const halfLoop = loopPathWidth * 0.5 + pad;
      const inOuterU = u >= loopU0 - halfLoop && u <= loopU1 + halfLoop;
      const inOuterV = v >= loopV0 - halfLoop && v <= loopV1 + halfLoop;
      if (inOuterU && (Math.abs(v - loopV0) < halfLoop || Math.abs(v - loopV1) < halfLoop)) return true;
      if (inOuterV && (Math.abs(u - loopU0) < halfLoop || Math.abs(u - loopU1) < halfLoop)) return true;
      return false;
    };

    const placedParkTrees: Array<{ u: number; v: number }> = [];
    let parkSeed = 202607;
    const nextParkRand = () => {
      parkSeed = (parkSeed * 1664525 + 1013904223) >>> 0;
      return parkSeed / 4294967296;
    };

    const treeMargin = fenceInset + 11;
    for (let u = parkQuarter.uMin + treeMargin; u <= parkQuarter.uMax - treeMargin; u += 24) {
      for (let v = parkQuarter.vMin + treeMargin; v <= parkQuarter.vMax - treeMargin; v += 24) {
        const ju = u + (nextParkRand() - 0.5) * 11;
        const jv = v + (nextParkRand() - 0.5) * 11;
        if (
          ju < parkQuarter.uMin + treeMargin ||
          ju > parkQuarter.uMax - treeMargin ||
          jv < parkQuarter.vMin + treeMargin ||
          jv > parkQuarter.vMax - treeMargin
        ) {
          continue;
        }
        if (isPointOnParkPathOrPlaza(ju, jv, 8.5)) continue;
        if (placedParkTrees.some((t) => Math.hypot(t.u - ju, t.v - jv) < 21)) continue;
        // Skip ~20% for airy natural park clearings
        if (nextParkRand() < 0.2) continue;

        const isConifer = nextParkRand() < 0.32;
        const crownRadius = isConifer ? 7.2 + nextParkRand() * 2.2 : 8.0 + nextParkRand() * 3.0;
        const height = isConifer ? 26 + nextParkRand() * 8 : 22 + nextParkRand() * 9;
        const variant = Math.floor(nextParkRand() * 4);
        placedParkTrees.push({ u: ju, v: jv });
        urbanProps.push(makeTreeProp(ju, jv, isConifer ? 'conifer' : 'deciduous', crownRadius, height, variant));
      }
    }
  }

  // 6. Trees & occasional pocket benches on open unfenced green patches inside INNER residential house quarters
  let resSeed = 918273;
  const nextResRand = () => {
    resSeed = (resSeed * 1664525 + 1013904223) >>> 0;
    return resSeed / 4294967296;
  };
  const placedResProps: Array<{ u: number; v: number }> = [];

  for (const q of CITY_QUARTERS) {
    if (q.kind !== 'houses') continue;
    const qMidU = (q.uMin + q.uMax) * 0.5;
    const qMidV = (q.vMin + q.vMax) * 0.5;
    // Skip outer map exit fringe quarters
    if (qMidU < -1060 || qMidU > 980 || qMidV < -1060 || qMidV > 1080) continue;

    let benchesInQuarter = 0;
    for (let u = q.uMin + 12; u <= q.uMax - 12; u += 26) {
      for (let v = q.vMin + 12; v <= q.vMax - 12; v += 26) {
        const ju = u + (nextResRand() - 0.5) * 10;
        const jv = v + (nextResRand() - 0.5) * 10;
        const probeBox = { uMin: ju - 7, uMax: ju + 7, vMin: jv - 7, vMax: jv + 7 };
        if (!isBuildingVisibleInMap(probeBox.uMin, probeBox.uMax, probeBox.vMin, probeBox.vMax, 24)) continue;
        if (rectOverlapsActiveStreet(probeBox.uMin, probeBox.uMax, probeBox.vMin, probeBox.vMax)) continue;
        if (rectOverlapsRoundabout(probeBox.uMin, probeBox.uMax, probeBox.vMin, probeBox.vMax, 16)) continue;
        if (overlapsAccessRoad(probeBox, 5.5)) continue;
        if (raw.some((b) => rectsOverlap(b, probeBox, 5.5))) continue;
        if (houseYards.some((hy) => rectsOverlap(hy, probeBox, 4.5))) continue;
        if (overlapsAnyParking(probeBox, 5)) continue;
        if (parcelLockerSlots.some((s) => rectsOverlap(s, probeBox, 5))) continue;
        if (garageDriveways.some((dw) => rectsOverlap(dw, probeBox, 3.5))) continue;
        if (placedResProps.some((p) => Math.hypot(p.u - ju, p.v - jv) < 24)) continue;

        const roll = nextResRand();
        if (roll < 0.28) continue;

        // Place an occasional pocket bench on roomy green clearings (max 2 per house quarter)
        if (benchesInQuarter < 2 && roll > 0.86) {
          const axis = nextResRand() < 0.5 ? 'u' : 'v';
          const facing: 1 | -1 = nextResRand() < 0.5 ? 1 : -1;
          placedResProps.push({ u: ju, v: jv });
          urbanProps.push(makeBenchProp(ju, jv, axis, facing));
          benchesInQuarter += 1;
          continue;
        }

        const isConifer = nextResRand() < 0.28;
        const crownRadius = isConifer ? 6.8 + nextResRand() * 2.0 : 7.5 + nextResRand() * 2.5;
        const height = isConifer ? 24 + nextResRand() * 6 : 21 + nextResRand() * 7;
        const variant = Math.floor(nextResRand() * 4);
        placedResProps.push({ u: ju, v: jv });
        urbanProps.push(makeTreeProp(ju, jv, isConifer ? 'conifer' : 'deciduous', crownRadius, height, variant));
      }
    }
  }

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
  attachDeliveryPointsToBuildings(
    addressed,
    parkingLots,
    deliveryZones,
    houseYards,
    serviceFacilities,
    parcelLockerSlots,
    baseRoadGraph
  );

  return {
    buildings: sortBuildingsBackToFront(addressed),
    parkingLots,
    deliveryZones,
    parcelLockerSlots,
    houseYards,
    serviceFacilities,
    parkLayout,
    garageDriveways,
    urbanProps,
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
  serviceFacilities: ServiceFacilitySpec[],
  parcelLockerSlots: ParcelLockerSlot[],
  roadGraph: RoadGraph
) {
  const nodeById = new Map(roadGraph.nodes.map((n) => [n.id, n]));
  const streetById = new Map(ALL_STREETS.map((s) => [s.id, s]));
  const addressableRoadById = new Map(ALL_ADDRESSABLE_ROADS.map((r) => [r.id, r]));
  const deliveryZoneByBuildingId = new Map(deliveryZones.map((dz) => [dz.buildingId, dz]));
  const houseYardByBuildingId = new Map(houseYards.map((y) => [y.buildingId, y]));
  const serviceFacilityByBuildingId = new Map(
    serviceFacilities.map((sf) => [sf.buildingId, sf])
  );
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
    // 0. Service facilities (Mechanic Garage & Gas Stations): excluded from normal parcel deliveries
    //    (dostepnyDlaDostaw === false), yet receive exact roadApproachPoint on their driveway street
    //    and off-road service/refueling stopPoint for future fleet maintenance & refueling routes.
    const sf = serviceFacilityByBuildingId.get(b.id);
    if (sf) {
      const targetStreet = streetById.get(sf.driveway.streetId);
      const streetEdges = targetStreet
        ? candidateEdges.filter((e) =>
            targetStreet.axis === 'u'
              ? Math.abs(e.au - targetStreet.coord) < 5 && Math.abs(e.bu - targetStreet.coord) < 5
              : Math.abs(e.av - targetStreet.coord) < 5 && Math.abs(e.bv - targetStreet.coord) < 5
          )
        : [];
      const proj = projectIsoPointOntoEdges(
        sf.mouth.u,
        sf.mouth.v,
        streetEdges.length > 0 ? streetEdges : candidateEdges
      );
      if (proj) {
        const approachWaypoints: Array<{ x: number; y: number }> = [
          { x: sf.mouth.x, y: sf.mouth.y },
        ];
        if (sf.yardEntry) {
          approachWaypoints.push({ x: sf.yardEntry.x, y: sf.yardEntry.y });
        }
        b.roadApproachPoint = proj.approach;
        b.deliveryStopPoint = {
          x: sf.stop.x,
          y: sf.stop.y,
          u: sf.stop.u,
          v: sf.stop.v,
          surface: 'delivery_zone',
          approachWaypoints,
        };
      }
      continue;
    }

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

  // 3. Attach exact roadApproachPoint and dedicated courier bay deliveryStopPoint to every QuickBox slot
  for (const slot of parcelLockerSlots) {
    const targetStreet = streetById.get(slot.streetId);
    const streetEdges = targetStreet
      ? candidateEdges.filter((e) =>
          targetStreet.axis === 'u'
            ? Math.abs(e.au - targetStreet.coord) < 5 && Math.abs(e.bu - targetStreet.coord) < 5
            : Math.abs(e.av - targetStreet.coord) < 5 && Math.abs(e.bv - targetStreet.coord) < 5
        )
      : [];
    const bayCenterU = (slot.parkingBay.uMin + slot.parkingBay.uMax) * 0.5;
    const bayCenterV = (slot.parkingBay.vMin + slot.parkingBay.vMax) * 0.5;
    const mouthU =
      slot.streetSide === 'uMin'
        ? slot.driveway.uMin
        : slot.streetSide === 'uMax'
          ? slot.driveway.uMax
          : bayCenterU;
    const mouthV =
      slot.streetSide === 'vMin'
        ? slot.driveway.vMin
        : slot.streetSide === 'vMax'
          ? slot.driveway.vMax
          : bayCenterV;
    const proj = projectIsoPointOntoEdges(
      mouthU,
      mouthV,
      streetEdges.length > 0 ? streetEdges : candidateEdges
    );
    const stopPt = makeIsoCanvasPoint(bayCenterU, bayCenterV);
    const mouthPt = makeIsoCanvasPoint(mouthU, mouthV);
    if (proj) {
      slot.roadApproachPoint = proj.approach;
      slot.deliveryStopPoint = {
        x: stopPt.x,
        y: stopPt.y,
        u: stopPt.u,
        v: stopPt.v,
        surface: 'delivery_zone',
        approachWaypoints: [{ x: mouthPt.x, y: mouthPt.y }],
      };
    }
  }
}

const CITY_STRUCTURES = buildProceduralCityStructures();

export const PROCEDURAL_BUILDINGS: Building[] = CITY_STRUCTURES.buildings;
export const PROCEDURAL_PARKING_LOTS: ParkingLot[] = CITY_STRUCTURES.parkingLots;
export const PROCEDURAL_DELIVERY_ZONES: DeliveryZone[] = CITY_STRUCTURES.deliveryZones;
export const PARCEL_LOCKER_SLOTS: ParcelLockerSlot[] = CITY_STRUCTURES.parcelLockerSlots;
export const parcelLockerSlots: ParcelLockerSlot[] = PARCEL_LOCKER_SLOTS;
export const QUICKBOX_SLOTS: ParcelLockerSlot[] = PARCEL_LOCKER_SLOTS;

/**
 * Partitions all residential buildings (`dom`, `blok_maly`, `blok_sredni`, `blok_wysoki`)
 * directly to their geographically nearest QuickBox locker (`0..7`) for 100% spatial district coherence.
 */
function buildBalancedQuickBoxZones(
  buildings: readonly Building[],
  slots: readonly ParcelLockerSlot[]
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  if (slots.length === 0) return map;

  for (const b of buildings) {
    if (
      b.typ !== 'dom' &&
      b.typ !== 'blok_maly' &&
      b.typ !== 'blok_sredni' &&
      b.typ !== 'blok_wysoki'
    ) {
      continue;
    }
    const bu = (b.uMin + b.uMax) * 0.5;
    const bv = (b.vMin + b.vMax) * 0.5;
    let nearestZone = slots[0].zoneIndex ?? 0;
    let minDist = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const d = Math.hypot(bu - s.u, bv - s.v);
      if (d < minDist) {
        minDist = d;
        nearestZone = s.zoneIndex ?? i;
      }
    }
    map.set(b.id, nearestZone);
  }

  return map;
}

export const QUICKBOX_ZONE_BY_BUILDING_ID: ReadonlyMap<string, number> = buildBalancedQuickBoxZones(
  PROCEDURAL_BUILDINGS,
  PARCEL_LOCKER_SLOTS
);

export function getQuickBoxZoneForBuilding(buildingId: string): number | null {
  const z = QUICKBOX_ZONE_BY_BUILDING_ID.get(buildingId);
  return z !== undefined ? z : null;
}

export function getQuickBoxSlotById(slotId: string): ParcelLockerSlot | undefined {
  return PARCEL_LOCKER_SLOTS.find((s) => s.id === slotId);
}

export function getQuickBoxSlotByZone(zoneIndex: number): ParcelLockerSlot | undefined {
  return PARCEL_LOCKER_SLOTS.find((s) => s.zoneIndex === zoneIndex);
}

/**
 * Builds a synthetic delivery target `Building` representing an active QuickBox locker
 * so bikes, scooters, and vans route directly into its dedicated courier parking bay.
 */
export function createQuickBoxTargetBuilding(slot: ParcelLockerSlot): Building {
  return {
    id: `quickbox_${slot.id}`,
    typ: 'quickbox',
    nazwaUlicy: slot.nearestStreetName,
    numerBudynku: slot.zoneIndex + 1,
    pietra: 1,
    mieszkania: 0,
    uMin: slot.lockerRect.uMin,
    uMax: slot.lockerRect.uMax,
    vMin: slot.lockerRect.vMin,
    vMax: slot.lockerRect.vMax,
    height: 20,
    colorVariant: 0,
    dostepnyDlaDostaw: true,
    roadApproachPoint: slot.roadApproachPoint,
    deliveryStopPoint: slot.deliveryStopPoint,
  };
}
export const PROCEDURAL_HOUSE_YARDS: HouseYardFence[] = CITY_STRUCTURES.houseYards;
export const PROCEDURAL_SERVICE_FACILITIES: ServiceFacilitySpec[] =
  CITY_STRUCTURES.serviceFacilities;
export const PROCEDURAL_PARK_LAYOUT: ParkLayoutSpec | null = CITY_STRUCTURES.parkLayout;
export const PROCEDURAL_GARAGE_DRIVEWAYS: GarageDrivewaySpec[] = CITY_STRUCTURES.garageDriveways;
export const PROCEDURAL_URBAN_PROPS: UrbanProp3D[] = CITY_STRUCTURES.urbanProps;

/**
 * Precomputed, topologically sorted back-to-front static 3D scene order (all buildings +
 * 3D wooden yard fence segments & corner/gate posts + park fountain/iron fence/trees/benches/lamps).
 * Cached once at startup so per-frame rendering only interleaves dynamic entities for 144 FPS.
 */
export const STATIC_SCENE_3D_ORDER: StaticScene3DItem[] = buildStaticScene3DOrder(
  PROCEDURAL_BUILDINGS,
  PROCEDURAL_HOUSE_YARDS,
  PROCEDURAL_URBAN_PROPS
);

const customSceneOrderCache = new WeakMap<Building[], StaticScene3DItem[]>();

export function getStaticScene3DOrder(buildings: Building[]): StaticScene3DItem[] {
  if (buildings === PROCEDURAL_BUILDINGS) {
    return STATIC_SCENE_3D_ORDER;
  }
  let cached = customSceneOrderCache.get(buildings);
  if (!cached) {
    cached = buildStaticScene3DOrder(buildings, PROCEDURAL_HOUSE_YARDS, PROCEDURAL_URBAN_PROPS);
    customSceneOrderCache.set(buildings, cached);
  }
  return cached;
}

export function buildProceduralBuildings(): Building[] {
  return PROCEDURAL_BUILDINGS;
}

/**
 * Returns a buildings list where the Base depot garage (`b_base_garage`) matches the
 * footprint and 3D height of the active `warehouseTier` (1–4).
 */
export function applyWarehouseTierToBuildings(
  buildings: Building[],
  warehouseTier: WarehouseTier
): Building[] {
  const spec = getBaseBuildingSpec(warehouseTier);
  const idx = buildings.findIndex((b) => b.id === 'b_base_garage');
  if (idx === -1) return buildings;

  const existing = buildings[idx];
  if (
    existing.uMin === spec.uMin &&
    existing.uMax === spec.uMax &&
    existing.vMin === spec.vMin &&
    existing.vMax === spec.vMax &&
    existing.height === spec.height
  ) {
    return buildings;
  }

  const next = [...buildings];
  next[idx] = {
    ...existing,
    uMin: spec.uMin,
    uMax: spec.uMax,
    vMin: spec.vMin,
    vMax: spec.vMax,
    height: spec.height,
  };
  return next;
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
