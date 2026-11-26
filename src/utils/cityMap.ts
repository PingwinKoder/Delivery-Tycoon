import type { WarehouseTier } from '../types/orders';
import type { Point, RoadEdge, RoadGraph, RoadNode } from '../types/roadGraph';

export const MAP_WIDTH = 3200;
export const MAP_HEIGHT = 2000;

export const ISO_ORIGIN_X = MAP_WIDTH / 2; // 1600
export const ISO_ORIGIN_Y = MAP_HEIGHT / 2; // 1000

export type StreetKind = 'avenue' | 'local';
export type StreetAxis = 'u' | 'v';

export interface StreetSpec {
  id: string;
  name: string;
  axis: StreetAxis;
  /** Fixed coordinate along the perpendicular axis (u for SW-NE streets, v for NW-SE streets) */
  coord: number;
  kind: StreetKind;
  /** Asphalt width in logical isometric (u,v) units */
  asphaltWidth: number;
  /** Sidewalk width on each side in logical (u,v) units */
  sidewalkWidth: number;
  /** Active spans [min, max] along the orthogonal coordinate */
  spans: Array<[number, number]>;
}

export interface RoundaboutSpec {
  id: string;
  label: string;
  u: number;
  v: number;
  outerSidewalkRadius: number;
  outerAsphaltRadius: number;
  ringRadius: number;
  innerCurbRadius: number;
  islandRadius: number;
  ringSegments: number;
}

export type QuarterKind = 'base' | 'park' | 'bus_station' | 'market' | 'blocks' | 'houses';

export interface CityQuarter {
  id: string;
  ui: number;
  vi: number;
  kind: QuarterKind;
  /** Flush inner bounds up to street sidewalks in (u, v) space */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  isOuterBand?: boolean;
}

export interface ConcretePlot {
  id: string;
  quarterId: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  isBaseYard?: boolean;
  variant: 'commercial' | 'industrial' | 'civic';
}

export interface IntersectionInfo {
  id: string;
  u: number;
  v: number;
  uStreet: StreetSpec;
  vStreet: StreetSpec;
  hasNegU: boolean;
  hasPosU: boolean;
  hasNegV: boolean;
  hasPosV: boolean;
  isRoundabout: boolean;
}

export interface BaseBuildingSpec {
  tier: WarehouseTier;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  height: number;
}

export interface BaseParkingSpot {
  id: string;
  index: number;
  /** 0 = south row (spots 1–4, along vMax), 1 = north row (spots 5–8, along vMin) */
  row: 0 | 1;
  /** 0..3 column index within the row */
  column: number;
  /** Exact stall rectangle in isometric (u, v) units */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Exact isometric stall center */
  u: number;
  v: number;
  /** Exact canvas pixel center for parking player vehicles */
  x: number;
  y: number;
  /** Axis along which parked vehicle faces */
  headingAxis: 'u' | 'v';
  occupied: boolean;
}

export interface BaseParkingSpec {
  id: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  stallAxis: 'u' | 'v';
  /** Which side holds the primary row ('max' for 1–4 spots; 2nd row appears opposite at 'min' for 5–8 spots) */
  stallSide: 'min' | 'max';
  /** Centerline v coordinate of the open driving aisle serving both rows */
  aisleV: number;
  /** Maximum supported car parking spots at Base (8) */
  maxSpots: number;
  /** Spots per row (up to 4 per row across 2 equal rows) */
  spotsPerRow: number;
  /** Active rows currently built (0 for 0 spots, 1 for 1–4 spots, 2 for 5–8 spots) */
  rowCount: 0 | 1 | 2;
  /** Internal asphalt road segments directly connecting this parking lot to the BAZA courier driveway */
  connectorSegments: Array<{ uMin: number; uMax: number; vMin: number; vMax: number }>;
  /** Individual fleet vehicle parking spots with exact coordinates (length = unlocked parkingSpots) */
  spots: BaseParkingSpot[];
}

export interface BaseBikeRackSpec {
  id: string;
  /** Exterior wall bounds of the bike rack along the BAZA garage SW wall (yard/exit side, clear of car parking) */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Isometric u coordinates of the metallic U-hoops */
  hoopsU: number[];
  /** Exact isometric spot where the idle empty bicycle parks */
  parkedU: number;
  parkedV: number;
  /** Exact canvas pixel coordinates for the idle empty bicycle */
  parkedX: number;
  parkedY: number;
  /** Canvas heading angle facing cleanly into the rack hoop against the garage wall */
  parkedAngle: number;
  /** Concrete-yard lead-out waypoints from the bike rack to the BAZA depot exit node */
  exitWaypoints: Point[];
}

export interface BaseLoadingZoneSpec {
  id: string;
  /** Isometric bounds of the package loading/unloading zone directly opposite the Base driveway entrance */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Exact isometric stop point in front of the Base entrance */
  stopU: number;
  stopV: number;
  /** Exact canvas pixel coordinates where the courier halts to load/unload packages */
  stopX: number;
  stopY: number;
  /** Canvas heading angle facing the Base building front door (+u direction) */
  stopAngle: number;
  /** Straight concrete-yard exit waypoints from the loading zone out to the BAZA driveway node */
  exitWaypoints: Point[];
  /** Concrete-yard waypoints from the bike rack around the NW garage corner to the loading zone */
  fromBikeRackWaypoints: Point[];
  /** Concrete-yard waypoints from the loading zone back to the bike rack */
  toBikeRackWaypoints: Point[];
}

export interface BaseDepotSpec {
  u: number;
  v: number;
  exitU: number;
  exitV: number;
  drivewayAsphaltWidth: number;
  drivewaySidewalkWidth: number;
  yardUMin: number;
  yardUMax: number;
  yardVMin: number;
  yardVMax: number;
  warehouseTier: WarehouseTier;
  buildingBounds: BaseBuildingSpec;
  parking: BaseParkingSpec;
  bikeRack: BaseBikeRackSpec;
  loadingZone: BaseLoadingZoneSpec;
}

export interface BusBaySpot {
  id: string;
  index: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Exact isometric stall center */
  u: number;
  v: number;
  /** Exact canvas pixel center */
  x: number;
  y: number;
  occupied: boolean;
}

export interface BusDrivewaySpec {
  id: 'bus_entry' | 'bus_exit';
  role: 'entry' | 'exit';
  streetId: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Width along street axis (iso units) */
  width: number;
}

export interface BusStationSpec {
  id: string;
  quarterId: string;
  streetId: string;
  streetName: string;
  /** Full flush concrete quarter bounds */
  quarterBounds: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Expanded 2-story terminal building footprint occupying the former platform area */
  terminalFootprint: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Asphalt bus parking & maneuvering yard */
  asphaltYard: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** Separate wide bus entry driveway from al. Dworcowa */
  entryDriveway: BusDrivewaySpec;
  /** Separate wide bus exit driveway onto al. Dworcowa */
  exitDriveway: BusDrivewaySpec;
  /** Oversized bus parking stalls positioned between entry & exit lanes */
  busBays: BusBaySpot[];
}

export interface ResidentialAccessRoad {
  id: string;
  quarterId: string;
  name: string;
  /** 'u' = fixed u running along v between two V_STREETS; 'v' = fixed v running along u between two U_STREETS */
  axis: StreetAxis;
  coord: number;
  startCoord: number;
  endCoord: number;
  startStreetId: string;
  endStreetId: string;
  asphaltWidth: number;
  sidewalkWidth: number;
}

export const AVENUE_ASPHALT_WIDTH = 52;
export const AVENUE_SIDEWALK_WIDTH = 10;
export const LOCAL_ASPHALT_WIDTH = 32;
export const LOCAL_SIDEWALK_WIDTH = 8;
export const ACCESS_ASPHALT_WIDTH = 22;
export const ACCESS_SIDEWALK_WIDTH = 5;

/**
 * Pure 2:1 orthographic isometric projection:
 *  - +u moves (+1, +0.5) => top-left to bottom-right (NW -> SE)
 *  - +v moves (+1, -0.5) => bottom-left to top-right (SW -> NE)
 */
export function isoToCanvas(u: number, v: number): Point {
  return {
    x: ISO_ORIGIN_X + u + v,
    y: ISO_ORIGIN_Y + (u - v) * 0.5,
  };
}

export function canvasToIso(x: number, y: number): { u: number; v: number } {
  const dx = x - ISO_ORIGIN_X;
  const dy = y - ISO_ORIGIN_Y;
  return {
    u: dx * 0.5 + dy,
    v: dx * 0.5 - dy,
  };
}

export function isPointInsideMap(
  pt: Point,
  margin = 0
): boolean {
  return (
    pt.x >= margin &&
    pt.x <= MAP_WIDTH - margin &&
    pt.y >= margin &&
    pt.y <= MAP_HEIGHT - margin
  );
}

/**
 * Clips a line along constant u (varying v) to the visible map rectangle [margin..W-margin, margin..H-margin].
 */
export function clipUStreetToMap(u: number, margin = 16): [number, number] | null {
  // x = ISO_ORIGIN_X + u + v => v in [margin - ISO_ORIGIN_X - u, MAP_WIDTH - margin - ISO_ORIGIN_X - u]
  // y = ISO_ORIGIN_Y + 0.5*(u - v) => v = u - 2*(y - ISO_ORIGIN_Y)
  const vMinX = margin - ISO_ORIGIN_X - u;
  const vMaxX = MAP_WIDTH - margin - ISO_ORIGIN_X - u;
  const vMinY = u - 2 * (MAP_HEIGHT - margin - ISO_ORIGIN_Y);
  const vMaxY = u - 2 * (margin - ISO_ORIGIN_Y);
  const vMin = Math.max(vMinX, vMinY);
  const vMax = Math.min(vMaxX, vMaxY);
  if (vMax - vMin < 20) return null;
  return [vMin, vMax];
}

/**
 * Clips a line along constant v (varying u) to the visible map rectangle [margin..W-margin, margin..H-margin].
 */
export function clipVStreetToMap(v: number, margin = 16): [number, number] | null {
  // x = ISO_ORIGIN_X + u + v => u in [margin - ISO_ORIGIN_X - v, MAP_WIDTH - margin - ISO_ORIGIN_X - v]
  // y = ISO_ORIGIN_Y + 0.5*(u - v) => u = v + 2*(y - ISO_ORIGIN_Y)
  const uMinX = margin - ISO_ORIGIN_X - v;
  const uMaxX = MAP_WIDTH - margin - ISO_ORIGIN_X - v;
  const uMinY = v + 2 * (margin - ISO_ORIGIN_Y);
  const uMaxY = v + 2 * (MAP_HEIGHT - margin - ISO_ORIGIN_Y);
  const uMin = Math.max(uMinX, uMinY);
  const uMax = Math.min(uMaxX, uMaxY);
  if (uMax - uMin < 20) return null;
  return [uMin, uMax];
}

function makeStreet(
  id: string,
  name: string,
  axis: StreetAxis,
  coord: number,
  kind: StreetKind,
  spans: Array<[number, number]> = [[-2000, 2000]]
): StreetSpec {
  return {
    id,
    name,
    axis,
    coord,
    kind,
    asphaltWidth: kind === 'avenue' ? AVENUE_ASPHALT_WIDTH : LOCAL_ASPHALT_WIDTH,
    sidewalkWidth: kind === 'avenue' ? AVENUE_SIDEWALK_WIDTH : LOCAL_SIDEWALK_WIDTH,
    spans,
  };
}

/**
 * Logical street grid in isometric (u, v) coordinates.
 *  - uStreets (constant u): run straight SW <-> NE
 *  - vStreets (constant v): run straight NW <-> SE
 *  Selective partial local streets create varied commercial superblocks and green parks.
 */
export const U_STREETS: StreetSpec[] = [
  makeStreet('u_0', 'ul. Brzozowa', 'u', -1420, 'local', [[-600, 1200]]),
  makeStreet('u_1', 'ul. Kwiatowa', 'u', -1080, 'local', [[-1200, 1600]]),
  makeStreet('u_2', 'al. Północna', 'u', -720, 'avenue'), // Northern Main Avenue
  makeStreet('u_3', 'ul. Lipowa', 'u', -360, 'local', [[-1800, -740], [-740, 0], [380, 1800]]),
  makeStreet('u_4', 'al. Główna', 'u', 0, 'avenue'), // Central Main Avenue (passes R1 & R2)
  makeStreet('u_5', 'ul. Słoneczna', 'u', 340, 'local', [[-1800, 0], [0, 740], [1100, 1800]]),
  makeStreet('u_6', 'al. Południowa', 'u', 660, 'avenue'), // Southern Main Avenue (passes R3)
  makeStreet('u_7', 'ul. Ogrodowa', 'u', 1000, 'local', [[-1800, 1200]]),
  makeStreet('u_8', 'ul. Leśna', 'u', 1340, 'local', [[-1600, 800]]),
];

export const V_STREETS: StreetSpec[] = [
  makeStreet('v_0', 'ul. Polna', 'v', -1440, 'local', [[-600, 1600]]),
  makeStreet('v_1', 'ul. Spacerowa', 'v', -1080, 'local', [[-1200, 1800]]),
  makeStreet('v_2', 'al. Zachodnia', 'v', -740, 'avenue'), // Western Main Avenue (passes R1)
  makeStreet('v_3', 'ul. Parkowa', 'v', -380, 'local', [[-1600, 0], [340, 1800]]),
  makeStreet('v_4', 'al. Dworcowa', 'v', 0, 'avenue'), // Central Cross Avenue (passes R3)
  makeStreet('v_5', 'ul. Kolejowa', 'v', 380, 'local', [[-1800, -720], [-720, 660], [660, 1600]]),
  makeStreet('v_6', 'al. Przemysłowa', 'v', 740, 'avenue'), // Eastern Main Avenue (passes R2)
  makeStreet('v_7', 'ul. Rzemieślnicza', 'v', 1100, 'local', [[-1800, 1200]]),
  makeStreet('v_8', 'ul. Kasztanowa', 'v', 1460, 'local', [[-1600, 700]]),
];

export const ALL_STREETS: StreetSpec[] = [...U_STREETS, ...V_STREETS];

/**
 * 3 Major Isometric Roundabouts at main avenue intersections.
 * All 4 incoming avenues align dead-center along constant u and constant v.
 */
export const ROUNDABOUTS: RoundaboutSpec[] = [
  {
    id: 'r1',
    label: 'Rondo Zachodnie',
    u: 0,
    v: -740, // canvas (860, 1370) — lower-left near BAZA
    outerSidewalkRadius: 94,
    outerAsphaltRadius: 84,
    ringRadius: 61,
    innerCurbRadius: 38,
    islandRadius: 32,
    ringSegments: 16,
  },
  {
    id: 'r2',
    label: 'Rondo Wschodnie',
    u: 0,
    v: 740, // canvas (2340, 630) — upper-right
    outerSidewalkRadius: 94,
    outerAsphaltRadius: 84,
    ringRadius: 61,
    innerCurbRadius: 38,
    islandRadius: 32,
    ringSegments: 16,
  },
  {
    id: 'r3',
    label: 'Rondo Południowe',
    u: 660,
    v: 0, // canvas (2260, 1330) — lower-right
    outerSidewalkRadius: 94,
    outerAsphaltRadius: 84,
    ringRadius: 61,
    innerCurbRadius: 38,
    islandRadius: 32,
    ringSegments: 16,
  },
];

const BASE_DEPOT_ANCHOR_U = 155;
const BASE_DEPOT_ANCHOR_V = -935;
const BASE_PARKING_MAX_SPOTS_LIMIT = 8;
const BASE_PARKING_SPOTS_PER_ROW_LIMIT = 4;

/**
 * Base depot building footprint and 3D height for each warehouse expansion tier (1–4).
 * - Tier 1 (start): 56 x 88 = 4928 u² (~59.5% of former 74 x 112 hall) and lower 16 px height,
 *   looking like a compact starter company garage.
 * - Tiers 2–4: scale up progressively inside the concrete Base yard while staying strictly clear
 *   of the loading apron (u <= 203), yard boundaries, bike rack, and up-to-8-spot car parking lot.
 */
const BASE_BUILDING_SPECS: Readonly<Record<WarehouseTier, BaseBuildingSpec>> = {
  1: { tier: 1, uMin: 212, uMax: 268, vMin: -982, vMax: -894, height: 16 },
  2: { tier: 2, uMin: 210, uMax: 274, vMin: -992, vMax: -892, height: 20 },
  3: { tier: 3, uMin: 208, uMax: 282, vMin: -1000, vMax: -888, height: 24 },
  4: { tier: 4, uMin: 206, uMax: 294, vMin: -1012, vMax: -886, height: 30 },
};

export function getBaseBuildingSpec(warehouseTier: WarehouseTier = 1): BaseBuildingSpec {
  return BASE_BUILDING_SPECS[warehouseTier] ?? BASE_BUILDING_SPECS[1];
}

/**
 * Generates the sequential Base van/car parking lot for 0..8 unlocked spots.
 * - 0 spots: no parking tarmac or connector is built yet on the Base yard.
 * - Spots 1–4: south row along vMax (-817..-792), facing the open driving aisle (v = -830).
 * - Spots 5–8: north row opposite across the aisle (-868..-843), staying strictly inside
 *   the concrete yard (v = -1056..-776) and clear of all roads, sidewalks, and Base building tiers.
 */
export function buildBaseParkingSpec(parkingSpots = 0): BaseParkingSpec {
  const count = Math.max(0, Math.min(BASE_PARKING_MAX_SPOTS_LIMIT, Math.floor(parkingSpots)));
  const spotsPerRow = BASE_PARKING_SPOTS_PER_ROW_LIMIT;
  const uMin = 124;
  const aisleV = -830;

  if (count === 0) {
    return {
      id: 'base_parking',
      uMin,
      uMax: uMin,
      vMin: aisleV,
      vMax: aisleV,
      stallAxis: 'u',
      stallSide: 'max',
      aisleV,
      maxSpots: BASE_PARKING_MAX_SPOTS_LIMIT,
      spotsPerRow,
      rowCount: 0,
      connectorSegments: [],
      spots: [],
    };
  }

  const rowCount: 1 | 2 = count > spotsPerRow ? 2 : 1;
  const cols = Math.min(spotsPerRow, count);

  const padAlong = 6;
  const padDepth = 4;
  const stallWidth = 24;
  const stallDepth = 25;
  const aisleHalfWidth = 13; // 26u wide central driving aisle (-843..-817)

  const row0OpenV = aisleV + aisleHalfWidth; // -817
  const row0BackV = row0OpenV + stallDepth; // -792
  const row1OpenV = aisleV - aisleHalfWidth; // -843
  const row1BackV = row1OpenV - stallDepth; // -868

  const vMax = row0BackV + padDepth; // -788 (12u clear of yardVMax = -776)
  const vMin = rowCount === 2 ? row1BackV - padDepth : aisleV - aisleHalfWidth - 2; // -872 or -845
  const uMax = uMin + padAlong * 2 + cols * stallWidth; // 160 (1 spot) .. 232 (4–8 spots), clear of yardUMax = 316

  const startU = uMin + padAlong;
  const spots: BaseParkingSpot[] = [];

  for (let i = 0; i < count; i++) {
    const row: 0 | 1 = i < spotsPerRow ? 0 : 1;
    const column = i % spotsPerRow;
    const spotUMin = startU + column * stallWidth;
    const spotUMax = spotUMin + stallWidth;
    const spotVMin = row === 0 ? row0OpenV : row1BackV;
    const spotVMax = row === 0 ? row0BackV : row1OpenV;
    const centerU = (spotUMin + spotUMax) * 0.5;
    const centerV = (spotVMin + spotVMax) * 0.5;
    const pt = isoToCanvas(centerU, centerV);

    spots.push({
      id: `base_spot_${i + 1}`,
      index: i + 1,
      row,
      column,
      uMin: Math.round(spotUMin * 10) / 10,
      uMax: Math.round(spotUMax * 10) / 10,
      vMin: Math.round(spotVMin * 10) / 10,
      vMax: Math.round(spotVMax * 10) / 10,
      u: Math.round(centerU * 10) / 10,
      v: Math.round(centerV * 10) / 10,
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      headingAxis: 'v',
      occupied: false,
    });
  }

  // L-shaped internal asphalt connector linking the BAZA courier driveway (v = -935)
  // straight into the open driving aisle (centerline v = -830) of the BAZA fleet parking lot
  const connectorSegments = [
    { uMin: 72, uMax: 92, vMin: BASE_DEPOT_ANCHOR_V, vMax: aisleV + 11 },
    { uMin: 72, uMax: uMin + 2, vMin: aisleV - 11, vMax: aisleV + 11 },
  ];

  return {
    id: 'base_parking',
    uMin,
    uMax,
    vMin,
    vMax,
    stallAxis: 'u',
    stallSide: 'max',
    aisleV,
    maxSpots: BASE_PARKING_MAX_SPOTS_LIMIT,
    spotsPerRow,
    rowCount,
    connectorSegments,
    spots,
  };
}

/**
 * Generates the exterior covered 4-bay two-wheeler shelter flush against the SW entrance wall
 * of the Base building for the current warehouse tier. Remains completely independent of car parking spots.
 */
export function buildBaseBikeRackSpec(warehouseTier: WarehouseTier = 1): BaseBikeRackSpec {
  const b = getBaseBuildingSpec(warehouseTier);
  const rackWidth = 34;
  const uMin = b.uMin + 3;
  const uMax = uMin + rackWidth;
  const vMax = b.vMin - 1;
  const vMin = vMax - 11.5;
  const hoopsU = [uMin + 5.5, uMin + 13.0, uMin + 20.5, uMin + 28.0];
  const parkedU = hoopsU[1];
  const parkedV = vMax - 5.2;
  const parkedPt = isoToCanvas(parkedU, parkedV);

  // Facing +v (+1, -0.5) so the front wheel tucks neatly into the wheel-stop against the garage wall
  const parkedAngle = Math.atan2(-0.5, 1);

  // Clean concrete-yard lead-out around the NW entrance corner of b_base_garage toward BASE_DEPOT (155, -935)
  const exitWaypoints: Point[] = [
    parkedPt,
    isoToCanvas(b.uMin - 18, parkedV),
    isoToCanvas(b.uMin - 24, BASE_DEPOT_ANCHOR_V),
  ];

  return {
    id: 'base_bike_rack',
    uMin,
    uMax,
    vMin,
    vMax,
    hoopsU,
    parkedU,
    parkedV,
    parkedX: Math.round(parkedPt.x * 10) / 10,
    parkedY: Math.round(parkedPt.y * 10) / 10,
    parkedAngle,
    exitWaypoints,
  };
}

/**
 * Generates the dedicated package loading/unloading zone on the Base concrete yard
 * directly opposite the street driveway entrance (along v = BASE_DEPOT_ANCHOR_V),
 * right in front of the Base building's front wall and separate from the bike rack.
 */
export function buildBaseLoadingZoneSpec(
  warehouseTier: WarehouseTier = 1,
  bikeRack: BaseBikeRackSpec = buildBaseBikeRackSpec(warehouseTier)
): BaseLoadingZoneSpec {
  const b = getBaseBuildingSpec(warehouseTier);
  const uMax = b.uMin - 2;
  const uMin = uMax - 18;
  const vMin = BASE_DEPOT_ANCHOR_V - 18;
  const vMax = BASE_DEPOT_ANCHOR_V + 18;

  const stopU = uMax - 7;
  const stopV = BASE_DEPOT_ANCHOR_V;
  const stopPt = isoToCanvas(stopU, stopV);
  const drivewayPt = isoToCanvas(BASE_DEPOT_ANCHOR_U, BASE_DEPOT_ANCHOR_V);

  // Facing +u (+1, +0.5) toward the Base front entrance
  const stopAngle = Math.atan2(0.5, 1);

  const exitWaypoints: Point[] = [stopPt, drivewayPt];

  const cornerU = b.uMin - 18;
  const fromBikeRackWaypoints: Point[] = [
    { x: bikeRack.parkedX, y: bikeRack.parkedY },
    isoToCanvas(cornerU, bikeRack.parkedV),
    isoToCanvas(cornerU, stopV),
    stopPt,
  ];
  const toBikeRackWaypoints: Point[] = [...fromBikeRackWaypoints].reverse();

  return {
    id: 'base_loading_zone',
    uMin,
    uMax,
    vMin,
    vMax,
    stopU,
    stopV,
    stopX: Math.round(stopPt.x * 10) / 10,
    stopY: Math.round(stopPt.y * 10) / 10,
    stopAngle,
    exitWaypoints,
    fromBikeRackWaypoints,
    toBikeRackWaypoints,
  };
}

/**
 * Builds the full Base depot geometry spec for a given warehouse tier (1–4)
 * and unlocked car/van parking spot count (0–8).
 */
export function buildBaseDepotSpec(
  warehouseTier: WarehouseTier = 1,
  parkingSpots = 0
): BaseDepotSpec {
  const bikeRack = buildBaseBikeRackSpec(warehouseTier);
  const loadingZone = buildBaseLoadingZoneSpec(warehouseTier, bikeRack);
  return {
    u: BASE_DEPOT_ANCHOR_U,
    v: BASE_DEPOT_ANCHOR_V, // canvas (820, 1545) — lower-left concrete yard
    exitU: 0,
    exitV: BASE_DEPOT_ANCHOR_V, // canvas (665, 1467.5) — straight NW entry onto Central Main Avenue
    drivewayAsphaltWidth: 26,
    drivewaySidewalkWidth: 6,
    yardUMin: 36, // flush to al. Główna sidewalk (0 + 26 + 10)
    yardUMax: 316, // flush to ul. Słoneczna sidewalk (340 - 16 - 8)
    yardVMin: -1056, // flush to ul. Spacerowa sidewalk (-1080 + 16 + 8)
    yardVMax: -776, // flush to al. Zachodnia sidewalk (-740 - 26 - 10)
    warehouseTier,
    buildingBounds: getBaseBuildingSpec(warehouseTier),
    parking: buildBaseParkingSpec(parkingSpots),
    bikeRack,
    loadingZone,
  };
}

/**
 * Starting logistics depot (BAZA) at Warehouse Tier 1 (compact starter garage, flush bike rack)
 * and 0 initial fleet parking spots on the lower-left concrete quarter.
 */
export const BASE_DEPOT: BaseDepotSpec = buildBaseDepotSpec(1, 0);

function buildBusStationSpec(): BusStationSpec {
  // Quarter q_3_4 directly along al. Dworcowa (v = 0, sidewalk edge v = 36)
  // between ul. Lipowa (u = -360) and al. Główna (u = 0, sidewalk edge u = -36)
  const quarterBounds = { uMin: -360, uMax: -36, vMin: 36, vMax: 356 };
  // Expanded terminal footprint absorbing the former platform reserve (v=204..264 -> v=210..336)
  // while leaving a crisp 6u pedestrian curb next to asphaltYard (vMax=204) and a dedicated
  // side delivery bay + independent driveway onto al. Główna along u = -84..-36.
  const terminalFootprint = { uMin: -322, uMax: -84, vMin: 210, vMax: 336 };
  const asphaltYard = { uMin: -332, uMax: -62, vMin: 50, vMax: 204 };

  // Separate wide bus entry (NW side) & exit (SE side) onto al. Dworcowa (asphalt edge v = 26)
  // NW crosswalk at ul. Lipowa ends at u = -312 -> entry uMin = -296 leaves +16u clear past zebra
  // SE crosswalk at al. Główna ends at u = -60 -> exit uMax = -86 leaves +26u clear past zebra
  const entryDriveway: BusDrivewaySpec = {
    id: 'bus_entry',
    role: 'entry',
    streetId: 'v_4',
    uMin: -296,
    uMax: -268,
    vMin: 24,
    vMax: 54,
    width: 28,
  };

  const exitDriveway: BusDrivewaySpec = {
    id: 'bus_exit',
    role: 'exit',
    streetId: 'v_4',
    uMin: -114,
    uMax: -86,
    vMin: 24,
    vMax: 54,
    width: 28,
  };

  // 6 oversized bus parking bays (23 wide x 48 long — much larger than 15x19 car stalls)
  // nestled cleanly between the Entry and Exit lanes so buses never drive across painted stalls
  const bayCount = 6;
  const bayStartU = -260;
  const bayEndU = -122;
  const bayWidth = (bayEndU - bayStartU) / bayCount; // 23 iso units wide
  const bayVMin = 56;
  const bayVMax = 104; // 48 iso units long

  const busBays: BusBaySpot[] = [];
  for (let i = 0; i < bayCount; i++) {
    const uMin = bayStartU + i * bayWidth;
    const uMax = uMin + bayWidth;
    const u = (uMin + uMax) / 2;
    const v = (bayVMin + bayVMax) / 2;
    const pt = isoToCanvas(u, v);
    busBays.push({
      id: `bus_bay_${i + 1}`,
      index: i + 1,
      uMin: Math.round(uMin * 10) / 10,
      uMax: Math.round(uMax * 10) / 10,
      vMin: bayVMin,
      vMax: bayVMax,
      u: Math.round(u * 10) / 10,
      v: Math.round(v * 10) / 10,
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      occupied: false,
    });
  }

  return {
    id: 'bus_station_main',
    quarterId: 'q_3_4',
    streetId: 'v_4',
    streetName: 'al. Dworcowa',
    quarterBounds,
    terminalFootprint,
    asphaltYard,
    entryDriveway,
    exitDriveway,
    busBays,
  };
}

/**
 * Central Bus Station (Dworzec Autobusowy) located directly along al. Dworcowa
 * on quarter q_3_4, with expanded terminal hall, 6 oversized bus bays, and separate entry/exit driveways.
 */
export const BUS_STATION: BusStationSpec = buildBusStationSpec();

export function streetCoversValue(street: StreetSpec, orthoCoord: number, eps = 1e-3): boolean {
  return street.spans.some(([min, max]) => orthoCoord >= min - eps && orthoCoord <= max + eps);
}

export function streetContinuesPast(
  street: StreetSpec,
  orthoCoord: number,
  direction: -1 | 1,
  delta = 25
): boolean {
  return streetCoversValue(street, orthoCoord + direction * delta, 0);
}

export function getRoundaboutAt(u: number, v: number): RoundaboutSpec | undefined {
  return ROUNDABOUTS.find((r) => Math.abs(r.u - u) < 1 && Math.abs(r.v - v) < 1);
}

export function getAllIntersections(): IntersectionInfo[] {
  const result: IntersectionInfo[] = [];
  for (const us of U_STREETS) {
    for (const vs of V_STREETS) {
      if (!streetCoversValue(us, vs.coord) || !streetCoversValue(vs, us.coord)) {
        continue;
      }
      const pt = isoToCanvas(us.coord, vs.coord);
      if (!isPointInsideMap(pt, -120)) continue;

      const rb = getRoundaboutAt(us.coord, vs.coord);
      result.push({
        id: `ix_${us.id}_${vs.id}`,
        u: us.coord,
        v: vs.coord,
        uStreet: us,
        vStreet: vs,
        hasNegU: streetContinuesPast(vs, us.coord, -1),
        hasPosU: streetContinuesPast(vs, us.coord, 1),
        hasNegV: streetContinuesPast(us, vs.coord, -1),
        hasPosV: streetContinuesPast(us, vs.coord, 1),
        isRoundabout: Boolean(rb),
      });
    }
  }
  return result;
}

export function rectOverlapsRoundabout(
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  extraMargin = 16
): boolean {
  for (const rb of ROUNDABOUTS) {
    const r = rb.outerSidewalkRadius + extraMargin;
    const closestU = Math.max(uMin, Math.min(rb.u, uMax));
    const closestV = Math.max(vMin, Math.min(rb.v, vMax));
    const dist = Math.hypot(closestU - rb.u, closestV - rb.v);
    if (dist < r) return true;
  }
  return false;
}

export function rectOverlapsActiveStreet(
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number
): boolean {
  for (const us of U_STREETS) {
    const half = us.asphaltWidth / 2 + us.sidewalkWidth + 4;
    if (us.coord + half > uMin && us.coord - half < uMax) {
      if (us.spans.some(([sMin, sMax]) => sMax > vMin && sMin < vMax)) {
        return true;
      }
    }
  }
  for (const vs of V_STREETS) {
    const half = vs.asphaltWidth / 2 + vs.sidewalkWidth + 4;
    if (vs.coord + half > vMin && vs.coord - half < vMax) {
      if (vs.spans.some(([sMin, sMax]) => sMax > uMin && sMin < uMax)) {
        return true;
      }
    }
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    const half = ar.asphaltWidth / 2 + ar.sidewalkWidth + 3;
    if (ar.axis === 'u') {
      if (
        ar.coord + half > uMin &&
        ar.coord - half < uMax &&
        ar.endCoord > vMin &&
        ar.startCoord < vMax
      ) {
        return true;
      }
    } else {
      if (
        ar.coord + half > vMin &&
        ar.coord - half < vMax &&
        ar.endCoord > uMin &&
        ar.startCoord < uMax
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Classifies every city quarter (both interior grid cells and outer edge bands) into:
 *  - 'base': BAZA logistics depot (flush concrete)
 *  - 'park': exactly 2 medium green park quarters reserved for future parks (pure grass)
 *  - 'market': 5 well-spaced commercial quarters near avenues/roundabouts (flush concrete)
 *  - 'blocks': dense urban perimeter-block quarters (flush concrete all the way to sidewalks)
 *  - 'houses': green residential single-family house quarters (pure grass, zero concrete slabs)
 */
export function buildCityQuarters(): CityQuarter[] {
  const quarters: CityQuarter[] = [];
  const uSorted = [...U_STREETS].sort((a, b) => a.coord - b.coord);
  const vSorted = [...V_STREETS].sort((a, b) => a.coord - b.coord);

  // Reserve green park q_2_2 untouched; convert q_3_4 (directly along al. Dworcowa) to Bus Station
  const reservedParks = new Set(['2_2']);
  const busStationQuarters = new Set(['3_4']);

  // Dedicated green residential house quarters (outskirts + calm side-street pockets)
  const residentialHouseBlocks = new Set([
    '5_3', // south-central residential quarter (ul. Słoneczna / ul. Parkowa)
    '2_5', // north-east residential quarter
    '6_5', // south-east residential quarter
    '1_3', // northern residential quarter
    '1_4', // north residential quarter
    '6_2', // south-west residential quarter below al. Południowa
    '6_1', // lower-left residential quarter along ul. Spacerowa / ul. Ogrodowa
    '5_0', // lower-left residential quarter along ul. Polna / ul. Słoneczna
    '4_0', // west-lower residential quarter along ul. Polna / al. Główna
    '3_0', // west residential quarter
    '7_1', // far south-west residential quarter
    '7_2', // south residential quarter
    '7_3', // south residential quarter
    '0_3', // far north residential quarter
    '0_4', // far north residential quarter
    '2_7', // far east residential quarter
    '3_7', // east residential quarter
    '4_7', // east residential quarter
    '5_7', // south-east residential quarter
  ]);

  const rawCells: Array<{
    id: string;
    ui: number;
    vi: number;
    uMin: number;
    uMax: number;
    vMin: number;
    vMax: number;
    isBase: boolean;
    isPark: boolean;
    isBusStation: boolean;
    isHouses: boolean;
    touchesRoundabout: boolean;
    distAvenue: number;
    distRoundabout: number;
  }> = [];

  for (let ui = 0; ui < uSorted.length - 1; ui++) {
    const uA = uSorted[ui];
    const uB = uSorted[ui + 1];
    const midU = (uA.coord + uB.coord) / 2;

    for (let vi = 0; vi < vSorted.length - 1; vi++) {
      const vA = vSorted[vi];
      const vB = vSorted[vi + 1];
      const midV = (vA.coord + vB.coord) / 2;

      // Flush strictly to sidewalk outer edge when the bordering street is active along this edge;
      // otherwise extend to the shared centerline so superblocks with skipped local streets have 0 px grass seam.
      const uMin = streetCoversValue(uA, midV)
        ? uA.coord + uA.asphaltWidth / 2 + uA.sidewalkWidth
        : uA.coord;
      const uMax = streetCoversValue(uB, midV)
        ? uB.coord - uB.asphaltWidth / 2 - uB.sidewalkWidth
        : uB.coord;
      const vMin = streetCoversValue(vA, midU)
        ? vA.coord + vA.asphaltWidth / 2 + vA.sidewalkWidth
        : vA.coord;
      const vMax = streetCoversValue(vB, midU)
        ? vB.coord - vB.asphaltWidth / 2 - vB.sidewalkWidth
        : vB.coord;

      if (uMax - uMin < 70 || vMax - vMin < 70) continue;

      const corners = [
        isoToCanvas(uMin, vMin),
        isoToCanvas(uMax, vMin),
        isoToCanvas(uMax, vMax),
        isoToCanvas(uMin, vMax),
      ];
      if (!corners.some((c) => isPointInsideMap(c, -60))) continue;

      const key = `${ui}_${vi}`;
      const isBase =
        uA.coord === 0 && uB.coord === 340 && vA.coord === -1080 && vB.coord === -740;
      const isPark = !isBase && reservedParks.has(key);
      const isBusStation = !isBase && !isPark && busStationQuarters.has(key);

      const cu = (uMin + uMax) / 2;
      const cv = (vMin + vMax) / 2;
      let distRb = Infinity;
      for (const rb of ROUNDABOUTS) {
        distRb = Math.min(distRb, Math.hypot(cu - rb.u, cv - rb.v));
      }
      let distAve = Infinity;
      for (const s of ALL_STREETS) {
        if (s.kind !== 'avenue') continue;
        const d = Math.abs((s.axis === 'u' ? cu : cv) - s.coord);
        distAve = Math.min(distAve, d);
      }

      const isOuterGrid =
        ui === 0 || ui === uSorted.length - 2 || vi === 0 || vi === vSorted.length - 2;
      const isHouses =
        !isBase &&
        !isPark &&
        !isBusStation &&
        (residentialHouseBlocks.has(key) || (isOuterGrid && distAve > 220));

      rawCells.push({
        id: isBase ? 'q_base' : `q_${ui}_${vi}`,
        ui,
        vi,
        uMin,
        uMax,
        vMin,
        vMax,
        isBase,
        isPark,
        isBusStation,
        isHouses,
        touchesRoundabout: rectOverlapsRoundabout(uMin, uMax, vMin, vMax, 6),
        distAvenue: distAve,
        distRoundabout: distRb,
      });
    }
  }

  // Pick 5 prime well-spaced concrete quarters near avenues/roundabouts for Markets
  const marketEligible = rawCells
    .filter((c) => {
      if (c.isBase || c.isPark || c.isBusStation || c.isHouses) return false;
      const centerPt = isoToCanvas((c.uMin + c.uMax) / 2, (c.vMin + c.vMax) / 2);
      if (!isPointInsideMap(centerPt, 140)) return false;
      return c.distAvenue < 220 && c.uMax - c.uMin >= 220 && c.vMax - c.vMin >= 220;
    })
    .sort((a, b) => a.distRoundabout - b.distRoundabout);

  const marketIds = new Set<string>();
  const marketCenters: Array<{ u: number; v: number }> = [];
  for (const c of marketEligible) {
    if (marketIds.size >= 5) break;
    const cu = (c.uMin + c.uMax) / 2;
    const cv = (c.vMin + c.vMax) / 2;
    if (marketCenters.some((m) => Math.hypot(m.u - cu, m.v - cv) < 720)) continue;
    marketIds.add(c.id);
    marketCenters.push({ u: cu, v: cv });
  }

  for (const c of rawCells) {
    const kind: QuarterKind = c.isBase
      ? 'base'
      : c.isPark
        ? 'park'
        : c.isBusStation
          ? 'bus_station'
          : c.isHouses
            ? 'houses'
            : marketIds.has(c.id)
              ? 'market'
              : 'blocks';

    quarters.push({
      id: c.id,
      ui: c.ui,
      vi: c.vi,
      kind,
      uMin: c.uMin,
      uMax: c.uMax,
      vMin: c.vMin,
      vMax: c.vMax,
    });
  }

  // Add outer map-edge residential bands beyond the outermost street ring so corners
  // (especially the lower-left corner below ul. Polna & al. Główna) are naturally built up
  const outerBands: Array<{
    id: string;
    kind: 'houses' | 'blocks';
    uMin: number;
    uMax: number;
    vMin: number;
    vMax: number;
  }> = [
    // Far-left / lower-left corner beyond ul. Polna (v < -1440)
    { id: 'q_out_sw1', kind: 'houses', uMin: -336, uMax: -36, vMin: -1760, vMax: -1464 },
    { id: 'q_out_sw2', kind: 'houses', uMin: 36, uMax: 316, vMin: -1760, vMax: -1464 },
    { id: 'q_out_sw3', kind: 'houses', uMin: 364, uMax: 624, vMin: -1760, vMax: -1464 },
    { id: 'q_out_sw4', kind: 'houses', uMin: -684, uMax: -384, vMin: -1760, vMax: -1464 },
    // Lower edge beyond ul. Leśna (u > 1340)
    { id: 'q_out_se1', kind: 'houses', uMin: 1364, uMax: 1620, vMin: -704, vMax: -404 },
    { id: 'q_out_se2', kind: 'houses', uMin: 1364, uMax: 1620, vMin: -356, vMax: -36 },
    { id: 'q_out_se3', kind: 'houses', uMin: 1364, uMax: 1620, vMin: 36, vMax: 356 },
    // Far-right edge beyond ul. Kasztanowa (v > 1460)
    { id: 'q_out_ne1', kind: 'houses', uMin: -684, uMax: -384, vMin: 1484, vMax: 1760 },
    { id: 'q_out_ne2', kind: 'houses', uMin: -336, uMax: -36, vMin: 1484, vMax: 1760 },
    { id: 'q_out_ne3', kind: 'houses', uMin: 36, uMax: 316, vMin: 1484, vMax: 1760 },
    // Far-top edge beyond ul. Brzozowa (u < -1420)
    { id: 'q_out_nw1', kind: 'houses', uMin: -1700, uMax: -1444, vMin: -356, vMax: -36 },
    { id: 'q_out_nw2', kind: 'houses', uMin: -1700, uMax: -1444, vMin: 36, vMax: 356 },
    { id: 'q_out_nw3', kind: 'houses', uMin: -1700, uMax: -1444, vMin: 404, vMax: 704 },
  ];

  outerBands.forEach((ob, i) => {
    quarters.push({
      id: ob.id,
      ui: -10 - i,
      vi: -10 - i,
      kind: ob.kind,
      uMin: ob.uMin,
      uMax: ob.uMax,
      vMin: ob.vMin,
      vMax: ob.vMax,
      isOuterBand: true,
    });
  });

  return quarters;
}

export const CITY_QUARTERS: CityQuarter[] = buildCityQuarters();

const ACCESS_ROAD_NAMES: string[] = [
  'ul. Cicha',
  'ul. Jaśminowa',
  'ul. Wiosenna',
  'ul. Akacjowa',
  'ul. Sosnowa',
  'ul. Klonowa',
  'ul. Wrzosowa',
  'ul. Wiśniowa',
  'ul. Kalinowa',
  'ul. Świerkowa',
  'ul. Cisowa',
  'ul. Grabowa',
  'ul. Topolowa',
  'ul. Jaworowa',
  'ul. Modrzewiowa',
  'ul. Morelowa',
  'ul. Jabłoniowa',
  'ul. Jesionowa',
  'ul. Olchowa',
  'ul. Dębowa',
  'ul. Malinowa',
  'ul. Poziomkowa',
  'ul. Fiołkowa',
  'ul. Chabrowa',
];

/**
 * Generates narrow 2-lane residential access roads bisecting large interior single-family
 * house quarters so every interior house sits directly on a street connected to the road graph.
 */
export function buildResidentialAccessRoads(quarters: CityQuarter[]): ResidentialAccessRoad[] {
  const roads: ResidentialAccessRoad[] = [];
  const uSorted = [...U_STREETS].sort((a, b) => a.coord - b.coord);
  const vSorted = [...V_STREETS].sort((a, b) => a.coord - b.coord);
  let nameIdx = 0;

  const isEndpointClearOfRoundabouts = (u: number, v: number): boolean =>
    ROUNDABOUTS.every((rb) => Math.hypot(u - rb.u, v - rb.v) >= rb.outerSidewalkRadius + 24);

  for (const q of quarters) {
    if (q.kind !== 'houses' || q.isOuterBand) continue;
    if (q.ui < 0 || q.ui >= uSorted.length - 1 || q.vi < 0 || q.vi >= vSorted.length - 1) continue;

    const uW = q.uMax - q.uMin;
    const vW = q.vMax - q.vMin;
    if (uW < 210 || vW < 210) continue;

    const uA = uSorted[q.ui];
    const uB = uSorted[q.ui + 1];
    const vA = vSorted[q.vi];
    const vB = vSorted[q.vi + 1];
    const midU = Math.round((q.uMin + q.uMax) / 2);
    const midV = Math.round((q.vMin + q.vMax) / 2);

    const canAlongV =
      streetCoversValue(vA, midU) &&
      streetCoversValue(vB, midU) &&
      isPointInsideMap(isoToCanvas(midU, vA.coord), 24) &&
      isPointInsideMap(isoToCanvas(midU, vB.coord), 24) &&
      isEndpointClearOfRoundabouts(midU, vA.coord) &&
      isEndpointClearOfRoundabouts(midU, vB.coord);

    const canAlongU =
      streetCoversValue(uA, midV) &&
      streetCoversValue(uB, midV) &&
      isPointInsideMap(isoToCanvas(uA.coord, midV), 24) &&
      isPointInsideMap(isoToCanvas(uB.coord, midV), 24) &&
      isEndpointClearOfRoundabouts(uA.coord, midV) &&
      isEndpointClearOfRoundabouts(uB.coord, midV);

    if (!canAlongV && !canAlongU) continue;

    const preferAlongV = vW >= uW ? canAlongV : !canAlongU;
    const axis: StreetAxis = preferAlongV ? 'u' : 'v';

    roads.push({
      id: `acc_${q.id}`,
      quarterId: q.id,
      name: ACCESS_ROAD_NAMES[nameIdx++ % ACCESS_ROAD_NAMES.length],
      axis,
      coord: axis === 'u' ? midU : midV,
      startCoord: axis === 'u' ? vA.coord : uA.coord,
      endCoord: axis === 'u' ? vB.coord : uB.coord,
      startStreetId: axis === 'u' ? vA.id : uA.id,
      endStreetId: axis === 'u' ? vB.id : uB.id,
      asphaltWidth: ACCESS_ASPHALT_WIDTH,
      sidewalkWidth: ACCESS_SIDEWALK_WIDTH,
    });
  }

  return roads;
}

export const RESIDENTIAL_ACCESS_ROADS: ResidentialAccessRoad[] =
  buildResidentialAccessRoads(CITY_QUARTERS);

/**
 * Generates flush concrete slabs covering the ENTIRE surface of every 'base', 'market',
 * and 'blocks' quarter right up to the sidewalk edges (0 px grass strip).
 * 'houses' and 'park' quarters stay pure lush green grass with zero concrete slabs.
 */
export function buildConcretePlots(): ConcretePlot[] {
  const plots: ConcretePlot[] = [];
  const variants: Array<ConcretePlot['variant']> = ['commercial', 'industrial', 'civic'];

  CITY_QUARTERS.forEach((q, idx) => {
    if (q.kind === 'houses' || q.kind === 'park') return;

    plots.push({
      id: q.kind === 'base' ? 'plot_base' : `plot_${q.id}`,
      quarterId: q.id,
      uMin: q.uMin,
      uMax: q.uMax,
      vMin: q.vMin,
      vMax: q.vMax,
      isBaseYard: q.kind === 'base',
      variant: q.kind === 'base' ? 'industrial' : variants[idx % variants.length],
    });
  });

  return plots;
}

export const CONCRETE_PLOTS: ConcretePlot[] = buildConcretePlots();

/**
 * Generates the synchronized RoadGraph directly from the mathematical isometric
 * streets, intersections, 3 roundabouts (16-node smooth elliptical rings), and BAZA depot.
 */
export function buildProceduralRoadGraph(): RoadGraph {
  const nodesMap = new Map<string, RoadNode>();
  const edgeSet = new Set<string>();
  const edges: RoadEdge[] = [];

  const addGraphNode = (node: RoadNode) => {
    if (!nodesMap.has(node.id)) {
      nodesMap.set(node.id, node);
    }
  };

  const addGraphEdge = (a: string, b: string, oneWay = false) => {
    if (a === b) return;
    if (!nodesMap.has(a) || !nodesMap.has(b)) return;
    const key = oneWay ? `${a}->${b}` : a < b ? `${a}__${b}` : `${b}__${a}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(oneWay ? [a, b, { oneWay: true }] : [a, b]);
    }
  };

  // 1. Create roundabout ring nodes (16 nodes per roundabout on exact ringRadius)
  // Angle convention in (u, v) space (strictly COUNTER-CLOCKWISE as k increases 0 -> 1 -> ... -> 15 -> 0):
  //   k = 0  (0 deg)   -> (ru + R, rv)   => SE (+u) road entry (4 o'clock)
  //   k = 4  (90 deg)  -> (ru, rv + R)   => NE (+v) road entry (2 o'clock)
  //   k = 8  (180 deg) -> (ru - R, rv)   => NW (-u) road entry (10 o'clock)
  //   k = 12 (270 deg) -> (ru, rv - R)   => SW (-v) road entry (8 o'clock)
  for (const rb of ROUNDABOUTS) {
    const segs = rb.ringSegments;
    for (let k = 0; k < segs; k++) {
      const theta = (k * Math.PI * 2) / segs;
      const u = rb.u + rb.ringRadius * Math.cos(theta);
      const v = rb.v + rb.ringRadius * Math.sin(theta);
      const pt = isoToCanvas(u, v);
      addGraphNode({
        id: `${rb.id}_${k}`,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        kind: 'roundabout',
      });
    }
    // Strictly one-way counter-clockwise roundabout ring edges
    for (let k = 0; k < segs; k++) {
      addGraphEdge(`${rb.id}_${k}`, `${rb.id}_${(k + 1) % segs}`, true);
    }
  }

  // 2. Create intersection nodes (for non-roundabout crossings strictly inside map)
  const margin = 14;
  for (const us of U_STREETS) {
    for (const vs of V_STREETS) {
      if (!streetCoversValue(us, vs.coord) || !streetCoversValue(vs, us.coord)) continue;
      if (getRoundaboutAt(us.coord, vs.coord)) continue;
      const pt = isoToCanvas(us.coord, vs.coord);
      if (!isPointInsideMap(pt, margin)) continue;
      addGraphNode({
        id: `n_${us.id}_${vs.id}`,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        kind: 'intersection',
      });
    }
  }

  // 3. Create BAZA node and its straight exit node on Central Main Avenue (u = 0, v = -935)
  const basePt = isoToCanvas(BASE_DEPOT.u, BASE_DEPOT.v);
  const exitPt = isoToCanvas(BASE_DEPOT.exitU, BASE_DEPOT.exitV);
  addGraphNode({
    id: 'base',
    x: Math.round(basePt.x),
    y: Math.round(basePt.y),
    kind: 'base',
    label: 'Baza',
  });
  addGraphNode({
    id: 'n_base_exit',
    x: Math.round(exitPt.x),
    y: Math.round(exitPt.y),
    kind: 'intersection',
  });
  addGraphEdge('base', 'n_base_exit');

  // 3b. Create T-junction nodes & connecting edges for residential access roads inside large house quarters
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    const startU = ar.axis === 'u' ? ar.coord : ar.startCoord;
    const startV = ar.axis === 'u' ? ar.startCoord : ar.coord;
    const endU = ar.axis === 'u' ? ar.coord : ar.endCoord;
    const endV = ar.axis === 'u' ? ar.endCoord : ar.coord;
    const pA = isoToCanvas(startU, startV);
    const pB = isoToCanvas(endU, endV);
    const idA = `n_${ar.id}_a`;
    const idB = `n_${ar.id}_b`;
    addGraphNode({
      id: idA,
      x: Math.round(pA.x),
      y: Math.round(pA.y),
      kind: 'intersection',
    });
    addGraphNode({
      id: idB,
      x: Math.round(pB.x),
      y: Math.round(pB.y),
      kind: 'intersection',
    });
    addGraphEdge(idA, idB);
  }

  // 4. Connect along each U_STREET (fixed u, increasing v)
  for (const us of U_STREETS) {
    const clip = clipUStreetToMap(us.coord, margin);
    if (!clip) continue;

    for (const [spanMin, spanMax] of us.spans) {
      const segMin = Math.max(spanMin, clip[0]);
      const segMax = Math.min(spanMax, clip[1]);
      if (segMax - segMin < 20) continue;

      type AxisStop = {
        v: number;
        inId: string; // node ID approached from smaller v
        outId: string; // node ID leaving toward larger v
      };
      const stops: AxisStop[] = [];

      // Check border start endpoint if it isn't close to an intersection/roundabout
      const allVCoords: number[] = [];
      for (const vs of V_STREETS) {
        if (vs.coord >= segMin - 1 && vs.coord <= segMax + 1 && streetCoversValue(vs, us.coord)) {
          allVCoords.push(vs.coord);
        }
      }

      if (allVCoords.every((vc) => Math.abs(vc - segMin) > 42)) {
        const pt = isoToCanvas(us.coord, segMin);
        if (isPointInsideMap(pt, margin - 2)) {
          const eid = `ep_${us.id}_vmin_${Math.round(segMin)}`;
          addGraphNode({
            id: eid,
            x: Math.round(pt.x),
            y: Math.round(pt.y),
            kind: 'endpoint',
          });
          stops.push({ v: segMin, inId: eid, outId: eid });
        }
      }

      if (allVCoords.every((vc) => Math.abs(vc - segMax) > 42)) {
        const pt = isoToCanvas(us.coord, segMax);
        if (isPointInsideMap(pt, margin - 2)) {
          const eid = `ep_${us.id}_vmax_${Math.round(segMax)}`;
          addGraphNode({
            id: eid,
            x: Math.round(pt.x),
            y: Math.round(pt.y),
            kind: 'endpoint',
          });
          stops.push({ v: segMax, inId: eid, outId: eid });
        }
      }

      // Add BAZA exit stop on its avenue (u = 0)
      if (
        Math.abs(us.coord - BASE_DEPOT.exitU) < 1 &&
        BASE_DEPOT.exitV >= segMin &&
        BASE_DEPOT.exitV <= segMax
      ) {
        stops.push({ v: BASE_DEPOT.exitV, inId: 'n_base_exit', outId: 'n_base_exit' });
      }

      // Add intersections & roundabouts along this U_STREET
      for (const vs of V_STREETS) {
        if (vs.coord < segMin - 1 || vs.coord > segMax + 1) continue;
        if (!streetCoversValue(vs, us.coord)) continue;

        const rb = getRoundaboutAt(us.coord, vs.coord);
        if (rb) {
          // Approaching from smaller v (-v, SW) hits k=12; leaving toward larger v (+v, NE) leaves k=4
          const kNegV = (rb.ringSegments * 3) / 4; // 12
          const kPosV = rb.ringSegments / 4; // 4
          stops.push({
            v: vs.coord,
            inId: `${rb.id}_${kNegV}`,
            outId: `${rb.id}_${kPosV}`,
          });
        } else {
          const nid = `n_${us.id}_${vs.id}`;
          if (nodesMap.has(nid)) {
            stops.push({ v: vs.coord, inId: nid, outId: nid });
          }
        }
      }

      // Add residential access road T-junction stops on this U_STREET
      for (const ar of RESIDENTIAL_ACCESS_ROADS) {
        if (ar.axis !== 'v') continue;
        if (ar.coord < segMin - 1 || ar.coord > segMax + 1) continue;
        if (ar.startStreetId === us.id) {
          const idA = `n_${ar.id}_a`;
          stops.push({ v: ar.coord, inId: idA, outId: idA });
        }
        if (ar.endStreetId === us.id) {
          const idB = `n_${ar.id}_b`;
          stops.push({ v: ar.coord, inId: idB, outId: idB });
        }
      }

      stops.sort((a, b) => a.v - b.v);
      for (let i = 0; i < stops.length - 1; i++) {
        addGraphEdge(stops[i].outId, stops[i + 1].inId);
      }
    }
  }

  // 5. Connect along each V_STREET (fixed v, increasing u)
  for (const vs of V_STREETS) {
    const clip = clipVStreetToMap(vs.coord, margin);
    if (!clip) continue;

    for (const [spanMin, spanMax] of vs.spans) {
      const segMin = Math.max(spanMin, clip[0]);
      const segMax = Math.min(spanMax, clip[1]);
      if (segMax - segMin < 20) continue;

      type AxisStop = {
        u: number;
        inId: string; // node ID approached from smaller u (-u, NW)
        outId: string; // node ID leaving toward larger u (+u, SE)
      };
      const stops: AxisStop[] = [];

      const allUCoords: number[] = [];
      for (const us of U_STREETS) {
        if (us.coord >= segMin - 1 && us.coord <= segMax + 1 && streetCoversValue(us, vs.coord)) {
          allUCoords.push(us.coord);
        }
      }

      if (allUCoords.every((uc) => Math.abs(uc - segMin) > 42)) {
        const pt = isoToCanvas(segMin, vs.coord);
        if (isPointInsideMap(pt, margin - 2)) {
          const eid = `ep_${vs.id}_umin_${Math.round(segMin)}`;
          addGraphNode({
            id: eid,
            x: Math.round(pt.x),
            y: Math.round(pt.y),
            kind: 'endpoint',
          });
          stops.push({ u: segMin, inId: eid, outId: eid });
        }
      }

      if (allUCoords.every((uc) => Math.abs(uc - segMax) > 42)) {
        const pt = isoToCanvas(segMax, vs.coord);
        if (isPointInsideMap(pt, margin - 2)) {
          const eid = `ep_${vs.id}_umax_${Math.round(segMax)}`;
          addGraphNode({
            id: eid,
            x: Math.round(pt.x),
            y: Math.round(pt.y),
            kind: 'endpoint',
          });
          stops.push({ u: segMax, inId: eid, outId: eid });
        }
      }

      for (const us of U_STREETS) {
        if (us.coord < segMin - 1 || us.coord > segMax + 1) continue;
        if (!streetCoversValue(us, vs.coord)) continue;

        const rb = getRoundaboutAt(us.coord, vs.coord);
        if (rb) {
          // Approaching from smaller u (-u, NW) hits k=8; leaving toward larger u (+u, SE) leaves k=0
          const kNegU = rb.ringSegments / 2; // 8
          const kPosU = 0; // 0
          stops.push({
            u: us.coord,
            inId: `${rb.id}_${kNegU}`,
            outId: `${rb.id}_${kPosU}`,
          });
        } else {
          const nid = `n_${us.id}_${vs.id}`;
          if (nodesMap.has(nid)) {
            stops.push({ u: us.coord, inId: nid, outId: nid });
          }
        }
      }

      // Add residential access road T-junction stops on this V_STREET
      for (const ar of RESIDENTIAL_ACCESS_ROADS) {
        if (ar.axis !== 'u') continue;
        if (ar.coord < segMin - 1 || ar.coord > segMax + 1) continue;
        if (ar.startStreetId === vs.id) {
          const idA = `n_${ar.id}_a`;
          stops.push({ u: ar.coord, inId: idA, outId: idA });
        }
        if (ar.endStreetId === vs.id) {
          const idB = `n_${ar.id}_b`;
          stops.push({ u: ar.coord, inId: idB, outId: idB });
        }
      }

      stops.sort((a, b) => a.u - b.u);
      for (let i = 0; i < stops.length - 1; i++) {
        addGraphEdge(stops[i].outId, stops[i + 1].inId);
      }
    }
  }

  // 6. Keep only nodes reachable from 'base' following directed edges (guarantees 100% connected graph)
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const a = edge[0];
    const b = edge[1];
    const meta = edge[2];
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    if (!meta?.oneWay) {
      adj.get(b)!.push(a);
    }
  }
  const reachable = new Set<string>(['base']);
  const queue = ['base'];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (!reachable.has(nxt)) {
        reachable.add(nxt);
        queue.push(nxt);
      }
    }
  }

  const finalNodes = Array.from(nodesMap.values()).filter((n) => reachable.has(n.id));
  const finalEdges = edges.filter(([a, b]) => reachable.has(a) && reachable.has(b));

  return {
    nodes: finalNodes,
    edges: finalEdges,
  };
}
