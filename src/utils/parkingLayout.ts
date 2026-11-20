import {
  RESIDENTIAL_ACCESS_ROADS,
  ROUNDABOUTS,
  U_STREETS,
  V_STREETS,
  type CityQuarter,
  type StreetAxis,
  type StreetSpec,
  isPointInsideMap,
  isoToCanvas,
  rectOverlapsActiveStreet,
  rectOverlapsRoundabout,
  streetCoversValue,
} from './cityMap';

export type ParkingEdgeSide = 'uMin' | 'uMax' | 'vMin' | 'vMax';

export interface IsoBox {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export interface ParkingDriveway {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Axis along which the driveway extends from the parking lot to the street */
  axis: StreetAxis;
  /** Edge of the parking lot that the driveway enters */
  entrySide: ParkingEdgeSide;
  streetId: string;
  /** True when the driveway enters directly into an open driving aisle (no outer stall row on entrySide) */
  entersAisleDirectly: boolean;
  /** Minimum clearance (iso units) from nearest roundabout approach zebra or intersection crosswalk */
  junctionClearance: number;
}

export interface ParkingLot {
  id: string;
  quarterId: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Axis along which parking stalls are arrayed side-by-side */
  stallAxis: 'u' | 'v';
  /** True for double-sided outer parking rows */
  doubleRow: boolean;
  /** True for larger lots with a central back-to-back double-row stall island surrounded by driving aisles */
  hasCenterIsland: boolean;
  kind: 'market' | 'courtyard';
  /** Short straight asphalt driveway connecting the parking lot directly across the sidewalk to the adjacent street */
  accessDriveway: ParkingDriveway;
}

export interface ParkingStallSpan {
  start: number;
  end: number;
}

export interface ParkingRowLayout {
  side: ParkingEdgeSide | 'islandA' | 'islandB';
  /** Fixed coordinate along the depth axis where the back curb/line of the stall sits */
  backCoord: number;
  /** Fixed coordinate along the depth axis where the open driving-aisle edge of the stall sits */
  openCoord: number;
  stalls: ParkingStallSpan[];
}

export interface ParkingStallRect {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  row: ParkingRowLayout['side'];
}

export interface ParkingCenterIslandLayout {
  /** Coordinate along the depth axis of the central spine separating the two back-to-back rows */
  spineCoord: number;
  /** Outer coordinate of island row A (toward lot min) */
  rowAMin: number;
  /** Outer coordinate of island row B (toward lot max) */
  rowBMax: number;
  /** Span along stallAxis */
  alongMin: number;
  /** Span along stallAxis */
  alongMax: number;
  /** Width of each parallel driving aisle between outer rows and the center island */
  sideAisleWidth: number;
  /** Width of each turning end-aisle between the center island ends and the lot borders */
  endAisleWidth: number;
  stalls: ParkingStallSpan[];
}

export interface ParkingLayout {
  stallAxis: 'u' | 'v';
  outerRowDepth: number;
  outerRows: ParkingRowLayout[];
  centerIsland: ParkingCenterIslandLayout | null;
  allStalls: ParkingStallRect[];
}

export interface PendingParkingCandidate {
  quarter: CityQuarter;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  kind: ParkingLot['kind'];
  preferredAxis?: 'u' | 'v';
}

export interface FindParkingAccessDrivewayParams {
  quarter: CityQuarter;
  lotBox: IsoBox;
  stallAxis: 'u' | 'v';
  doubleRow: boolean;
  hasCenterIsland: boolean;
  buildings: readonly IsoBox[];
  parkingLots: readonly IsoBox[];
  uSorted?: readonly StreetSpec[];
  vSorted?: readonly StreetSpec[];
}

export interface TryPushParkingParams extends PendingParkingCandidate {
  buildings: readonly IsoBox[];
  parkingLots: ParkingLot[];
  nextParkingId: () => string;
  uSorted?: readonly StreetSpec[];
  vSorted?: readonly StreetSpec[];
}

export const PARKING_OUTER_PAD_DEPTH = 4;
export const PARKING_OUTER_PAD_ALONG = 5;
export const PARKING_STALL_PITCH = 15;
export const PARKING_CENTER_ISLAND_ROW_DEPTH = 18;
export const PARKING_CENTER_ISLAND_END_AISLE = 26;

let cachedUSorted: StreetSpec[] | null = null;
let cachedVSorted: StreetSpec[] | null = null;

function getDefaultUSorted(): readonly StreetSpec[] {
  if (!cachedUSorted) {
    cachedUSorted = [...U_STREETS].sort((a, b) => a.coord - b.coord);
  }
  return cachedUSorted;
}

function getDefaultVSorted(): readonly StreetSpec[] {
  if (!cachedVSorted) {
    cachedVSorted = [...V_STREETS].sort((a, b) => a.coord - b.coord);
  }
  return cachedVSorted;
}

function rectsOverlap(a: IsoBox, b: IsoBox, pad = 2): boolean {
  return (
    a.uMin < b.uMax + pad &&
    a.uMax + pad > b.uMin &&
    a.vMin < b.vMax + pad &&
    a.vMax + pad > b.vMin
  );
}

function isRectVisibleInMap(
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  margin = 12
): boolean {
  const corners = [
    isoToCanvas(uMin, vMin),
    isoToCanvas(uMax, vMin),
    isoToCanvas(uMax, vMax),
    isoToCanvas(uMin, vMax),
  ];
  return corners.every((pt) => isPointInsideMap(pt, margin));
}

/**
 * Computes exact isometric stall rows, center back-to-back island, and driveway entrance cutouts
 * for a ParkingLot so renderer and navigation share a single source of truth.
 */
export function computeParkingLayout(lot: ParkingLot): ParkingLayout {
  const alongMin = lot.stallAxis === 'u' ? lot.uMin : lot.vMin;
  const alongMax = lot.stallAxis === 'u' ? lot.uMax : lot.vMax;
  const depthMin = lot.stallAxis === 'u' ? lot.vMin : lot.uMin;
  const depthMax = lot.stallAxis === 'u' ? lot.vMax : lot.uMax;
  const depthSpan = depthMax - depthMin;

  const startAlong = alongMin + PARKING_OUTER_PAD_ALONG;
  const endAlong = alongMax - PARKING_OUTER_PAD_ALONG;
  const count = Math.max(2, Math.floor((endAlong - startAlong) / PARKING_STALL_PITCH));

  const outerRowDepth = lot.hasCenterIsland
    ? 19
    : lot.doubleRow
      ? Math.min(23, (depthSpan - PARKING_OUTER_PAD_DEPTH * 2) * 0.32)
      : Math.min(24, (depthSpan - PARKING_OUTER_PAD_DEPTH * 2) * 0.52);

  // Driveway mouth cutout interval along stallAxis (only applies to the side the driveway actually enters)
  const dw = lot.accessDriveway;
  const dwAlongMin = (lot.stallAxis === 'u' ? dw.uMin : dw.vMin) - 5;
  const dwAlongMax = (lot.stallAxis === 'u' ? dw.uMax : dw.vMax) + 5;

  const buildStalls = (
    s0: number,
    s1: number,
    n: number,
    cutoutMin?: number,
    cutoutMax?: number
  ): ParkingStallSpan[] => {
    const st = (s1 - s0) / n;
    const out: ParkingStallSpan[] = [];
    for (let i = 0; i < n; i++) {
      const a = s0 + i * st;
      const b = s0 + (i + 1) * st;
      if (cutoutMin !== undefined && cutoutMax !== undefined) {
        if (b > cutoutMin && a < cutoutMax) {
          continue; // Omit stalls directly across the driveway entrance mouth (2–3 stalls cleared)
        }
      }
      out.push({ start: a, end: b });
    }
    return out;
  };

  const minSide: ParkingEdgeSide = lot.stallAxis === 'u' ? 'vMin' : 'uMin';
  const maxSide: ParkingEdgeSide = lot.stallAxis === 'u' ? 'vMax' : 'uMax';

  const outerRows: ParkingRowLayout[] = [];

  // Row 1 along depthMin
  const r1Back = depthMin + PARKING_OUTER_PAD_DEPTH;
  const r1Open = r1Back + outerRowDepth;
  const cutR1 = dw.entrySide === minSide && !dw.entersAisleDirectly;
  outerRows.push({
    side: minSide,
    backCoord: r1Back,
    openCoord: r1Open,
    stalls: buildStalls(
      startAlong,
      endAlong,
      count,
      cutR1 ? dwAlongMin : undefined,
      cutR1 ? dwAlongMax : undefined
    ),
  });

  // Row 2 along depthMax
  let r2Open = depthMax - PARKING_OUTER_PAD_DEPTH;
  if (lot.doubleRow) {
    const r2Back = depthMax - PARKING_OUTER_PAD_DEPTH;
    r2Open = r2Back - outerRowDepth;
    const cutR2 = dw.entrySide === maxSide && !dw.entersAisleDirectly;
    outerRows.push({
      side: maxSide,
      backCoord: r2Back,
      openCoord: r2Open,
      stalls: buildStalls(
        startAlong,
        endAlong,
        count,
        cutR2 ? dwAlongMin : undefined,
        cutR2 ? dwAlongMax : undefined
      ),
    });
  }

  // Optional Center Island (two back-to-back rows surrounded on all 4 sides by driving aisles)
  let centerIsland: ParkingCenterIslandLayout | null = null;
  if (lot.hasCenterIsland && lot.doubleRow) {
    const innerSpan = r2Open - r1Open;
    const islandDepth = PARKING_CENTER_ISLAND_ROW_DEPTH * 2;
    const sideAisleWidth = (innerSpan - islandDepth) / 2;
    const iAlongMin = alongMin + PARKING_CENTER_ISLAND_END_AISLE;
    const iAlongMax = alongMax - PARKING_CENTER_ISLAND_END_AISLE;
    const iAlongLen = iAlongMax - iAlongMin;

    if (sideAisleWidth >= 22 && iAlongLen >= 42) {
      const spineCoord = (r1Open + r2Open) / 2;
      const iCount = Math.max(3, Math.floor(iAlongLen / PARKING_STALL_PITCH));
      const iStalls = buildStalls(iAlongMin, iAlongMax, iCount);
      centerIsland = {
        spineCoord,
        rowAMin: spineCoord - PARKING_CENTER_ISLAND_ROW_DEPTH,
        rowBMax: spineCoord + PARKING_CENTER_ISLAND_ROW_DEPTH,
        alongMin: iAlongMin,
        alongMax: iAlongMax,
        sideAisleWidth,
        endAisleWidth: PARKING_CENTER_ISLAND_END_AISLE,
        stalls: iStalls,
      };
    }
  }

  // Flatten all stall rectangles in (u, v) space
  const allStalls: ParkingStallRect[] = [];
  const pushRowRects = (
    rowSide: ParkingRowLayout['side'],
    d0: number,
    d1: number,
    stalls: ParkingStallSpan[]
  ) => {
    const dMin = Math.min(d0, d1);
    const dMax = Math.max(d0, d1);
    for (const s of stalls) {
      if (lot.stallAxis === 'u') {
        allStalls.push({ uMin: s.start, uMax: s.end, vMin: dMin, vMax: dMax, row: rowSide });
      } else {
        allStalls.push({ uMin: dMin, uMax: dMax, vMin: s.start, vMax: s.end, row: rowSide });
      }
    }
  };

  for (const row of outerRows) {
    pushRowRects(row.side, row.backCoord, row.openCoord, row.stalls);
  }
  if (centerIsland) {
    pushRowRects('islandA', centerIsland.rowAMin, centerIsland.spineCoord, centerIsland.stalls);
    pushRowRects('islandB', centerIsland.spineCoord, centerIsland.rowBMax, centerIsland.stalls);
  }

  return {
    stallAxis: lot.stallAxis,
    outerRowDepth,
    outerRows,
    centerIsland,
    allStalls,
  };
}

/**
 * Computes minimum clearance (iso units) between a driveway's street-edge band [orthoMin, orthoMax]
 * and the outer edge of every roundabout approach zebra or regular intersection zebra along `street`.
 * Negative values mean the driveway intrudes into a crosswalk or roundabout approach zone.
 */
export function computeStreetJunctionClearance(
  street: StreetSpec,
  orthoMin: number,
  orthoMax: number
): number {
  let minClearance = Infinity;
  const crossStreets = street.axis === 'u' ? V_STREETS : U_STREETS;

  for (const cross of crossStreets) {
    if (!streetCoversValue(cross, street.coord)) continue;
    const u = street.axis === 'u' ? street.coord : cross.coord;
    const v = street.axis === 'u' ? cross.coord : street.coord;

    const rb = ROUNDABOUTS.find((r) => Math.abs(r.u - u) < 2 && Math.abs(r.v - v) < 2);
    // Match cityRenderer.ts crosswalk boundaries exactly:
    //  - roundabout approach zebra ends at rb.outerSidewalkRadius + 30
    //  - regular intersection zebra ends at cross.asphaltWidth / 2 + cross.sidewalkWidth + 24
    const blockedHalf = rb
      ? rb.outerSidewalkRadius + 30
      : cross.asphaltWidth / 2 + cross.sidewalkWidth + 24;

    const bMin = cross.coord - blockedHalf;
    const bMax = cross.coord + blockedHalf;

    let dist: number;
    if (orthoMax <= bMin) {
      dist = bMin - orthoMax;
    } else if (orthoMin >= bMax) {
      dist = orthoMin - bMax;
    } else {
      // Overlap with crosswalk / roundabout approach zone -> negative clearance
      dist = -Math.min(orthoMax - bMin, bMax - orthoMin);
    }

    if (dist < minClearance) {
      minClearance = dist;
    }
  }

  // Also keep clear of residential access road T-junctions on the same street
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    if (ar.startStreetId !== street.id && ar.endStreetId !== street.id) continue;
    const arHalf = ar.asphaltWidth / 2 + ar.sidewalkWidth + 10;
    const bMin = ar.coord - arHalf;
    const bMax = ar.coord + arHalf;
    const dist =
      orthoMax <= bMin
        ? bMin - orthoMax
        : orthoMin >= bMax
          ? orthoMin - bMax
          : -Math.min(orthoMax - bMin, bMax - orthoMin);
    if (dist < minClearance) {
      minClearance = dist;
    }
  }

  return minClearance;
}

/**
 * Computes a realistic, unobstructed straight asphalt driveway connecting a parking lot
 * directly across the sidewalk into an adjacent bordering street:
 *  - Keeps clear realistic distance from roundabouts and zebra crosswalks
 *  - When entering through an open aisle side (axis === stallAxis), aligns strictly with the
 *    driving aisle(s) so cars never cross painted stalls
 *  - When entering through a stall-lined side, places the entrance away from corners & junctions
 *    so 2–3 stalls are cleanly omitted at the entrance mouth (no driving over painted stalls)
 */
export function findParkingAccessDriveway({
  quarter: q,
  lotBox,
  stallAxis,
  doubleRow,
  hasCenterIsland,
  buildings,
  parkingLots,
  uSorted = getDefaultUSorted(),
  vSorted = getDefaultVSorted(),
}: FindParkingAccessDrivewayParams): ParkingDriveway | null {
  if (q.ui < 0 || q.ui >= uSorted.length - 1 || q.vi < 0 || q.vi >= vSorted.length - 1) {
    return null;
  }

  const uA = uSorted[q.ui];
  const uB = uSorted[q.ui + 1];
  const vA = vSorted[q.vi];
  const vB = vSorted[q.vi + 1];
  const dwHalf = 9; // 18 iso units wide crisp 2-way parking driveway

  type CandidateDriveway = ParkingDriveway & { length: number; score: number };
  const candidates: CandidateDriveway[] = [];

  const uW = lotBox.uMax - lotBox.uMin;
  const vW = lotBox.vMax - lotBox.vMin;
  const depthSpan = stallAxis === 'u' ? vW : uW;
  const outerDepth = hasCenterIsland
    ? 19
    : doubleRow
      ? Math.min(23, (depthSpan - PARKING_OUTER_PAD_DEPTH * 2) * 0.32)
      : Math.min(24, (depthSpan - PARKING_OUTER_PAD_DEPTH * 2) * 0.52);

  // Safe orthogonal coordinate intervals for aisle-side entries (never clipping outer stall rows)
  const buildSideOffsets = (
    sideMin: number,
    sideMax: number,
    isAisleSide: boolean
  ): number[] => {
    let lo: number;
    let hi: number;
    if (isAisleSide) {
      const minClear = PARKING_OUTER_PAD_DEPTH + outerDepth + dwHalf + 2;
      const maxClear = doubleRow ? PARKING_OUTER_PAD_DEPTH + outerDepth + dwHalf + 2 : dwHalf + 4;
      lo = sideMin + minClear;
      hi = sideMax - maxClear;
    } else {
      // Stall-lined side: keep slightly inset from outer corner stalls so the cutout throat looks crisp
      lo = sideMin + 16 + dwHalf;
      hi = sideMax - 16 - dwHalf;
      if (lo > hi) {
        lo = sideMin + dwHalf + 4;
        hi = sideMax - dwHalf - 4;
      }
    }

    if (lo > hi) return [];

    const pts: number[] = [];
    // If entering an aisle side of a center-island lot, include exact centerlines of the two parallel aisles
    if (isAisleSide && hasCenterIsland) {
      const r1Open = sideMin + PARKING_OUTER_PAD_DEPTH + outerDepth;
      const r2Open = sideMax - PARKING_OUTER_PAD_DEPTH - outerDepth;
      const spine = (r1Open + r2Open) / 2;
      const aisle1 = (r1Open + (spine - PARKING_CENTER_ISLAND_ROW_DEPTH)) / 2;
      const aisle2 = (spine + PARKING_CENTER_ISLAND_ROW_DEPTH + r2Open) / 2;
      if (aisle1 >= lo && aisle1 <= hi) pts.push(aisle1);
      if (aisle2 >= lo && aisle2 <= hi) pts.push(aisle2);
    }

    const mid = (lo + hi) / 2;
    pts.push(mid);
    const step = 10;
    for (let c = lo; c <= hi; c += step) {
      pts.push(c);
    }
    pts.push(hi);
    return pts;
  };

  const testCandidate = (
    axis: StreetAxis,
    entrySide: ParkingEdgeSide,
    street: StreetSpec,
    u0: number,
    u1: number,
    v0: number,
    v1: number
  ) => {
    const len = axis === 'u' ? u1 - u0 : v1 - v0;
    if (len < 6 || len > 120) return;

    const orthoMin = axis === 'u' ? v0 : u0;
    const orthoMax = axis === 'u' ? v1 : u1;
    const orthoCenter = (orthoMin + orthoMax) / 2;
    if (!streetCoversValue(street, orthoCenter, -6)) return;
    if (rectOverlapsRoundabout(u0, u1, v0, v1, 8)) return;

    const junctionClearance = computeStreetJunctionClearance(street, orthoMin, orthoMax);
    // Hard rule: never place a driveway inside a crosswalk or roundabout approach zebra
    if (junctionClearance < 4) return;

    const dBox = { uMin: u0, uMax: u1, vMin: v0, vMax: v1 };
    if (buildings.some((b) => rectsOverlap(b, dBox, 3))) return;
    if (parkingLots.some((p) => rectsOverlap(p, dBox, 2))) return;

    const entersAisleDirectly = axis === stallAxis;

    // Score: lower is better.
    // Strongly prefer realistic clearance past zebras/roundabouts (>= 18 iso units),
    // prefer direct aisle entry (zero stall cutouts needed), and prefer compact driveway length.
    let score = len;
    if (!entersAisleDirectly) score += 16;
    if (junctionClearance < 16) {
      score += (16 - junctionClearance) * 14;
    } else {
      // Reward extra breathing room away from roundabouts and crosswalks (capped so driveway stays tidy)
      score -= Math.min(40, (junctionClearance - 16) * 0.45);
    }

    // Bonus for aligning straight down one of the two parallel aisles on center-island lots
    if (entersAisleDirectly && hasCenterIsland) {
      const dMin = axis === 'u' ? lotBox.vMin : lotBox.uMin;
      const dMax = axis === 'u' ? lotBox.vMax : lotBox.uMax;
      const r1Open = dMin + PARKING_OUTER_PAD_DEPTH + outerDepth;
      const r2Open = dMax - PARKING_OUTER_PAD_DEPTH - outerDepth;
      const spine = (r1Open + r2Open) / 2;
      const aisle1 = (r1Open + (spine - PARKING_CENTER_ISLAND_ROW_DEPTH)) / 2;
      const aisle2 = (spine + PARKING_CENTER_ISLAND_ROW_DEPTH + r2Open) / 2;
      const aisleDist = Math.min(Math.abs(orthoCenter - aisle1), Math.abs(orthoCenter - aisle2));
      score += aisleDist * 0.4;
    }

    candidates.push({
      uMin: u0,
      uMax: u1,
      vMin: v0,
      vMax: v1,
      axis,
      entrySide,
      streetId: street.id,
      entersAisleDirectly,
      junctionClearance: Math.round(junctionClearance * 10) / 10,
      length: len,
      score,
    });
  };

  const uSideIsAisle = stallAxis === 'u';
  const vSideIsAisle = stallAxis === 'v';
  const vOffsets = buildSideOffsets(lotBox.vMin, lotBox.vMax, uSideIsAisle);
  const uOffsets = buildSideOffsets(lotBox.uMin, lotBox.uMax, vSideIsAisle);

  // Side 1: -u toward uA
  for (const v of vOffsets) {
    const targetU = uA.coord + uA.asphaltWidth / 2 - 2;
    if (lotBox.uMin > targetU) {
      testCandidate('u', 'uMin', uA, targetU, lotBox.uMin + 2, v - dwHalf, v + dwHalf);
    }
  }
  // Side 2: +u toward uB
  for (const v of vOffsets) {
    const targetU = uB.coord - uB.asphaltWidth / 2 + 2;
    if (targetU > lotBox.uMax) {
      testCandidate('u', 'uMax', uB, lotBox.uMax - 2, targetU, v - dwHalf, v + dwHalf);
    }
  }
  // Side 3: -v toward vA
  for (const u of uOffsets) {
    const targetV = vA.coord + vA.asphaltWidth / 2 - 2;
    if (lotBox.vMin > targetV) {
      testCandidate('v', 'vMin', vA, u - dwHalf, u + dwHalf, targetV, lotBox.vMin + 2);
    }
  }
  // Side 4: +v toward vB
  for (const u of uOffsets) {
    const targetV = vB.coord - vB.asphaltWidth / 2 + 2;
    if (targetV > lotBox.vMax) {
      testCandidate('v', 'vMax', vB, u - dwHalf, u + dwHalf, lotBox.vMax - 2, targetV);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  return {
    uMin: best.uMin,
    uMax: best.uMax,
    vMin: best.vMin,
    vMax: best.vMax,
    axis: best.axis,
    entrySide: best.entrySide,
    streetId: best.streetId,
    entersAisleDirectly: best.entersAisleDirectly,
    junctionClearance: best.junctionClearance,
  };
}

/**
 * Validates and finalizes a candidate parking lot (with automatic fallback trimming)
 * and appends the created ParkingLot (including its unobstructed street driveway) to `parkingLots`.
 */
export function tryPushParking({
  quarter,
  uMin,
  uMax,
  vMin,
  vMax,
  kind,
  preferredAxis,
  buildings,
  parkingLots,
  nextParkingId,
  uSorted = getDefaultUSorted(),
  vSorted = getDefaultVSorted(),
}: TryPushParkingParams): boolean {
  const validate = (ru0: number, ru1: number, rv0: number, rv1: number): boolean => {
    const uW = ru1 - ru0;
    const vW = rv1 - rv0;
    if (Math.min(uW, vW) < 42 || Math.max(uW, vW) < 60) return false;
    if (!isRectVisibleInMap(ru0, ru1, rv0, rv1, 14)) return false;
    if (rectOverlapsActiveStreet(ru0, ru1, rv0, rv1)) return false;
    if (rectOverlapsRoundabout(ru0, ru1, rv0, rv1, 8)) return false;
    const box = { uMin: ru0, uMax: ru1, vMin: rv0, vMax: rv1 };
    if (buildings.some((b) => rectsOverlap(b, box, 5))) return false;
    if (parkingLots.some((p) => rectsOverlap(p, box, 4))) return false;

    const stallAxis: 'u' | 'v' = preferredAxis ?? (uW >= vW ? 'u' : 'v');
    const depthSpan = stallAxis === 'u' ? vW : uW;
    const alongSpan = stallAxis === 'u' ? uW : vW;
    const doubleRow = depthSpan >= 86;
    const hasCenterIsland = doubleRow && depthSpan >= 126 && alongSpan >= 112;

    const accessDriveway = findParkingAccessDriveway({
      quarter,
      lotBox: box,
      stallAxis,
      doubleRow,
      hasCenterIsland,
      buildings,
      parkingLots,
      uSorted,
      vSorted,
    });
    if (!accessDriveway) return false;

    parkingLots.push({
      id: nextParkingId(),
      quarterId: quarter.id,
      uMin: ru0,
      uMax: ru1,
      vMin: rv0,
      vMax: rv1,
      stallAxis,
      doubleRow,
      hasCenterIsland,
      kind,
      accessDriveway,
    });
    return true;
  };

  if (validate(uMin, uMax, vMin, vMax)) return true;

  const uMid = (uMin + uMax) / 2;
  const vMid = (vMin + vMax) / 2;
  const fallbacks: Array<[number, number, number, number]> = [
    [uMin + 24, uMax, vMin, vMax],
    [uMin, uMax - 24, vMin, vMax],
    [uMin, uMax, vMin + 24, vMax],
    [uMin, uMax, vMin, vMax - 24],
    [uMin + 42, uMax, vMin + 22, vMax - 22],
    [uMin, uMax - 42, vMin + 22, vMax - 22],
    [uMin, uMid + 14, vMin, vMax],
    [uMid - 14, uMax, vMin, vMax],
    [uMin, uMax, vMin, vMid + 14],
    [uMin, uMax, vMid - 14, vMax],
  ];
  for (const [ru0, ru1, rv0, rv1] of fallbacks) {
    if (validate(ru0, ru1, rv0, rv1)) return true;
  }
  return false;
}
