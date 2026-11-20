import type { Point } from '../types/roadGraph';
import {
  ACCESS_ASPHALT_WIDTH,
  AVENUE_ASPHALT_WIDTH,
  BASE_DEPOT,
  LOCAL_ASPHALT_WIDTH,
  RESIDENTIAL_ACCESS_ROADS,
  ROUNDABOUTS,
  type RoundaboutSpec,
  U_STREETS,
  V_STREETS,
  canvasToIso,
  isoToCanvas,
  streetCoversValue,
} from './cityMap';

export type RoadClass =
  | 'avenue'
  | 'local'
  | 'access'
  | 'driveway'
  | 'roundabout'
  | 'offroad';

/** Vehicle classes prepared for current bicycle & future cars, vans, and buses */
export type VehicleLaneClass = 'bicycle' | 'car' | 'van' | 'bus';

/**
 * 0 = rightmost / outer lane (near curb; default cruising lane)
 * 1 = inner / left lane (used for left turns on 2-lane avenues & roundabouts, and overtaking)
 */
export type LaneIndex = 0 | 1;

export interface RoadSegmentSpec {
  roadClass: RoadClass;
  lanesPerDirection: 1 | 2;
  asphaltWidth: number;
  roundaboutId?: string;
}

export interface LaneOffsetOptions {
  laneIndex: LaneIndex;
  vehicleClass: VehicleLaneClass;
  /**
   * Automatically move into left lane (laneIndex: 1) one intersection/roundabout before a left turn
   * on 2-lane avenues and smoothly return to right lane (laneIndex: 0) afterward. Defaults to true.
   */
  autoLaneSelection?: boolean;
}

interface IsoPoint {
  u: number;
  v: number;
}

/**
 * Computes the true world-space right-hand perpendicular unit vector in logical isometric (u, v) space
 * BEFORE isometric canvas projection.
 *
 * Coordinate verification for isoToCanvas(u, v) = (1600 + u + v, 1000 + 0.5*(u - v)):
 *  - Travel +v (NE, up-right)    -> right is +u (SE, down-right) => (+1,  0) = (+dv, -du)
 *  - Travel -v (SW, down-left)   -> right is -u (NW, up-left)    => (-1,  0) = (+dv, -du)
 *  - Travel +u (SE, down-right)  -> right is -v (SW, down-left)  => ( 0, -1) = (+dv, -du)
 *  - Travel -u (NW, up-left)     -> right is +v (NE, up-right)   => ( 0, +1) = (+dv, -du)
 *  - Travel CCW on roundabout    -> right is radially OUTWARD    => (+cos θ, +sin θ) = (+dv, -du)
 */
export function computeRightHandUnitIso(du: number, dv: number): { rightU: number; rightV: number } {
  const len = Math.hypot(du, dv);
  if (len < 1e-6) {
    return { rightU: 0, rightV: 0 };
  }
  return {
    rightU: dv / len || 0,
    rightV: -du / len || 0,
  };
}

/**
 * Classifies a road segment defined by two world canvas points into its underlying road class
 * and lane count per direction without modifying RoadGraph nodes.
 */
export function classifyRoadSegment(aCanvas: Point, bCanvas: Point): RoadSegmentSpec {
  const a = canvasToIso(aCanvas.x, aCanvas.y);
  const b = canvasToIso(bCanvas.x, bCanvas.y);
  const midU = (a.u + b.u) * 0.5;
  const midV = (a.v + b.v) * 0.5;
  const du = Math.abs(b.u - a.u);
  const dv = Math.abs(b.v - a.v);

  // 1. Roundabout ring segment (both endpoints sit on the same roundabout's ringRadius)
  for (const rb of ROUNDABOUTS) {
    const rA = Math.hypot(a.u - rb.u, a.v - rb.v);
    const rB = Math.hypot(b.u - rb.u, b.v - rb.v);
    if (
      Math.abs(rA - rb.ringRadius) <= 10 &&
      Math.abs(rB - rb.ringRadius) <= 10 &&
      Math.hypot(b.u - a.u, b.v - a.v) <= rb.ringRadius * 1.15
    ) {
      return {
        roadClass: 'roundabout',
        lanesPerDirection: 2,
        asphaltWidth: rb.outerAsphaltRadius - rb.innerCurbRadius,
        roundaboutId: rb.id,
      };
    }
  }

  // 2. BAZA exit driveway connecting base (155, -935) <-> al. Główna (0, -935)
  if (
    Math.abs(midV - BASE_DEPOT.exitV) <= 8 &&
    dv <= 8 &&
    midU >= Math.min(BASE_DEPOT.exitU, BASE_DEPOT.u) - 8 &&
    midU <= Math.max(BASE_DEPOT.exitU, BASE_DEPOT.u) + 8
  ) {
    return {
      roadClass: 'driveway',
      lanesPerDirection: 1,
      asphaltWidth: BASE_DEPOT.drivewayAsphaltWidth,
    };
  }

  // 3. Main & local U-streets (fixed u, running along v)
  if (du <= 8) {
    for (const us of U_STREETS) {
      if (Math.abs(midU - us.coord) <= 7 && streetCoversValue(us, midV)) {
        return {
          roadClass: us.kind === 'avenue' ? 'avenue' : 'local',
          lanesPerDirection: us.kind === 'avenue' ? 2 : 1,
          asphaltWidth: us.asphaltWidth,
        };
      }
    }
    for (const ar of RESIDENTIAL_ACCESS_ROADS) {
      if (
        ar.axis === 'u' &&
        Math.abs(midU - ar.coord) <= 7 &&
        midV >= Math.min(ar.startCoord, ar.endCoord) - 8 &&
        midV <= Math.max(ar.startCoord, ar.endCoord) + 8
      ) {
        return {
          roadClass: 'access',
          lanesPerDirection: 1,
          asphaltWidth: ACCESS_ASPHALT_WIDTH,
        };
      }
    }
  }

  // 4. Main & local V-streets (fixed v, running along u)
  if (dv <= 8) {
    for (const vs of V_STREETS) {
      if (Math.abs(midV - vs.coord) <= 7 && streetCoversValue(vs, midU)) {
        return {
          roadClass: vs.kind === 'avenue' ? 'avenue' : 'local',
          lanesPerDirection: vs.kind === 'avenue' ? 2 : 1,
          asphaltWidth: vs.asphaltWidth,
        };
      }
    }
    for (const ar of RESIDENTIAL_ACCESS_ROADS) {
      if (
        ar.axis === 'v' &&
        Math.abs(midV - ar.coord) <= 7 &&
        midU >= Math.min(ar.startCoord, ar.endCoord) - 8 &&
        midU <= Math.max(ar.startCoord, ar.endCoord) + 8
      ) {
        return {
          roadClass: 'access',
          lanesPerDirection: 1,
          asphaltWidth: ACCESS_ASPHALT_WIDTH,
        };
      }
    }
  }

  // Fallback for custom user-edited edges in Edit Mode
  return {
    roadClass: 'local',
    lanesPerDirection: 1,
    asphaltWidth: LOCAL_ASPHALT_WIDTH,
  };
}

/**
 * Returns the signed lateral offset (in logical isometric world units) along the right-hand normal
 * for a given road class, requested laneIndex (0 = outer/right, 1 = inner/left), and vehicle class.
 *
 * - On 2-lane avenues and roundabouts, lane 0 keeps right (bicycles close to curb), while lane 1
 *   uses the inner/left lane (for left turns, U-turns, or overtaking).
 * - On 1-lane roads (local, access, driveway), both lane indices resolve to the single right lane.
 */
export function getLaneLateralOffsetIso(
  roadClass: RoadClass,
  options: LaneOffsetOptions
): number {
  const { vehicleClass, laneIndex } = options;

  switch (roadClass) {
    case 'offroad':
      return 0;

    case 'avenue': {
      // Asphalt half-width = 26 (double yellow at ±2, dashed lane line at ±13.5, shoulder at ±23.4)
      if (laneIndex === 1) {
        return 8.0; // Cleanly centered in left lane between centerline (+2) and dashed divider (+13.5)
      }
      return vehicleClass === 'bicycle' ? 20.5 : 19.2;
    }

    case 'roundabout': {
      // RoadGraph nodes sit on ringRadius = 61 (between innerCurb 38 and outerAsphalt 84)
      // Positive right-hand normal points radially OUTWARD (outer lane 0: 61..84, inner lane 1: 38..61)
      if (laneIndex === 1) {
        return vehicleClass === 'bicycle' ? -10.5 : -11.5; // r ≈ 50.5 / 49.5 on inner ring
      }
      return vehicleClass === 'bicycle' ? 14.5 : 11.5; // r ≈ 75.5 / 72.5 on outer ring
    }

    case 'local': {
      // Asphalt half-width = 16 (dashed centerline at 0, shoulder at ±13.4)
      return vehicleClass === 'bicycle' ? 10.6 : 8.0;
    }

    case 'access': {
      // Asphalt half-width = 11
      return vehicleClass === 'bicycle' ? 6.8 : 5.4;
    }

    case 'driveway': {
      // BAZA asphalt driveway half-width = 13
      return vehicleClass === 'bicycle' ? 7.2 : 5.6;
    }
  }
}

/**
 * Intersects two 2D lines in isometric (u, v) space:
 *   L1: p1 + t * d1
 *   L2: p2 + s * d2
 * Returns null if nearly parallel.
 */
function intersectLinesIso(
  p1: IsoPoint,
  d1: IsoPoint,
  p2: IsoPoint,
  d2: IsoPoint
): { point: IsoPoint; t: number; s: number } | null {
  const denom = d1.u * d2.v - d1.v * d2.u;
  if (Math.abs(denom) < 0.18) {
    return null;
  }
  const du = p2.u - p1.u;
  const dv = p2.v - p1.v;
  const t = (du * d2.v - dv * d2.u) / denom;
  const s = (du * d1.v - dv * d1.u) / denom;
  return {
    point: { u: p1.u + t * d1.u, v: p1.v + t * d1.v },
    t,
    s,
  };
}

function evalQuadBezier(p0: IsoPoint, p1: IsoPoint, p2: IsoPoint, t: number): IsoPoint {
  const mt = 1 - t;
  return {
    u: mt * mt * p0.u + 2 * mt * t * p1.u + t * t * p2.u,
    v: mt * mt * p0.v + 2 * mt * t * p1.v + t * t * p2.v,
  };
}

interface RawSegment {
  a: IsoPoint;
  b: IsoPoint;
  dir: IsoPoint;
  right: IsoPoint;
  len: number;
  spec: RoadSegmentSpec;
  rb: RoundaboutSpec | null;
}

interface StraightRouteItem {
  kind: 'straight';
  segIdx: number;
  startLane: LaneIndex;
  endLane: LaneIndex;
  startOffset: number;
  endOffset: number;
  /** Distance from seg.a along seg.dir where this straight item starts (may be slightly negative on left turns) */
  tStart: number;
  /** Distance from seg.a along seg.dir where this straight item ends (may exceed seg.len on left turns) */
  tEnd: number;
  /** Optional exact start point override (e.g. miter or roundabout exit) */
  startPoint?: IsoPoint;
  /** Optional exact end point override (e.g. miter or roundabout entry) */
  endPoint?: IsoPoint;
}

interface RoundaboutRouteItem {
  kind: 'roundabout';
  rb: RoundaboutSpec;
  startSeg: number;
  endSeg: number;
  entryTheta: number;
  totalSweep: number;
  lane: LaneIndex;
  radius: number;
  entryCurve: IsoPoint[];
  exitCurve: IsoPoint[];
  arcStartAngle: number;
  arcEndAngle: number;
}

type RouteItem = StraightRouteItem | RoundaboutRouteItem;

/**
 * Emits a smooth cubic S-curve lane change along a straight segment between [sStart, sEnd]
 * when startOffset !== endOffset.
 */
function emitStraightWithOptionalLaneChange(
  seg: RawSegment,
  item: StraightRouteItem,
  pushIso: (p: IsoPoint) => void
) {
  const ptAt = (along: number, latOffset: number): IsoPoint => ({
    u: seg.a.u + along * seg.dir.u + latOffset * seg.right.u,
    v: seg.a.v + along * seg.dir.v + latOffset * seg.right.v,
  });

  const pStart = item.startPoint ?? ptAt(item.tStart, item.startOffset);
  const pEnd = item.endPoint ?? ptAt(item.tEnd, item.endOffset);
  pushIso(pStart);

  if (Math.abs(item.startOffset - item.endOffset) < 0.5) {
    pushIso(pEnd);
    return;
  }

  // Clamp lane change strictly inside the physical road segment between the two junctions
  // so the vehicle clears the previous intersection before weaving and finishes weaving
  // before entering the next intersection/roundabout.
  const safeLo = Math.max(0, item.tStart);
  const safeHi = Math.min(seg.len, item.tEnd);
  const usableLen = safeHi - safeLo;

  if (usableLen < 18) {
    // Ultra-short segment: gentle direct transition without backtracking
    pushIso(pEnd);
    return;
  }

  const movingToLeft = item.endLane === 1 && item.startLane === 0;

  let changeStart: number;
  let changeEnd: number;

  if (movingToLeft) {
    // Prepare for upcoming left turn: stay briefly clear of previous junction, then smoothly merge
    // into lane 1 well before the upcoming crosswalk/roundabout.
    const marginStart = Math.min(24, usableLen * 0.16);
    const marginEnd = Math.min(38, usableLen * 0.24);
    const avail = Math.max(14, usableLen - marginStart - marginEnd);
    const changeLen = Math.min(90, avail);
    changeEnd = safeHi - marginEnd;
    changeStart = Math.max(safeLo + marginStart, changeEnd - changeLen);
  } else {
    // Returning to right lane (lane 0) after completing a left turn or exiting inner roundabout lane:
    // clear the intersection/roundabout mouth, then smoothly return right early in the segment.
    const marginStart = Math.min(24, usableLen * 0.16);
    const marginEnd = Math.min(20, usableLen * 0.16);
    const avail = Math.max(14, usableLen - marginStart - marginEnd);
    const changeLen = Math.min(90, avail);
    changeStart = safeLo + marginStart;
    changeEnd = Math.min(safeHi - marginEnd, changeStart + changeLen);
  }

  if (changeEnd <= changeStart + 4) {
    pushIso(pEnd);
    return;
  }

  // Straight lead-in before lane change begins
  if (changeStart > item.tStart + 1.5) {
    pushIso(ptAt(changeStart, item.startOffset));
  }

  // Smooth cubic Hermite S-curve (zero slope at both ends => tangent to both lanes)
  const steps = 6;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const smooth = 3 * t * t - 2 * t * t * t;
    const along = changeStart + (changeEnd - changeStart) * t;
    const lat = item.startOffset + (item.endOffset - item.startOffset) * smooth;
    pushIso(ptAt(along, lat));
  }

  // Straight hold after lane change completes
  pushIso(pEnd);
}

/**
 * Transforms a centerline road polyline (from Dijkstra on roadGraph) into a smooth, continuous
 * right-hand-traffic polyline in canvas coordinates.
 *
 * Features:
 * - Offsets every segment in world (u, v) space BEFORE isometric projection using its road class
 *   and vehicle class.
 * - Look-ahead lane selection (1 intersection/roundabout ahead) on 2-lane avenues:
 *   smoothly shifts from lane 0 (right) to lane 1 (left) before left turns (including 270°/360°
 *   roundabout maneuvers), executes the turn from lane 1, and smoothly returns to lane 0 afterward
 *   when continuing straight or right.
 * - Direct tangent quadratic-Bezier entry/exit fillets connecting street lanes seamlessly onto the
 *   outer (lane 0) or inner (lane 1) circular roundabout lane with zero inward dip toward the
 *   centerline entry/exit node.
 * - Exact miter corners at straight street intersections with zero sideways jumping.
 */
export function applyRightHandLaneOffsets(
  centerlinePoints: Point[],
  options: LaneOffsetOptions = { laneIndex: 0, vehicleClass: 'bicycle' }
): Point[] {
  if (centerlinePoints.length < 2) {
    return centerlinePoints.map((p) => ({ x: p.x, y: p.y }));
  }

  // Deduplicate near-identical consecutive centerline points
  const cleanCanvas: Point[] = [centerlinePoints[0]];
  for (let i = 1; i < centerlinePoints.length; i++) {
    const prev = cleanCanvas[cleanCanvas.length - 1];
    const cur = centerlinePoints[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.5) {
      cleanCanvas.push(cur);
    }
  }
  if (cleanCanvas.length < 2) {
    return cleanCanvas.map((p) => ({ x: p.x, y: p.y }));
  }

  const autoLane = options.autoLaneSelection !== false;
  const defaultLane: LaneIndex = options.laneIndex;
  const rbById = new Map(ROUNDABOUTS.map((r) => [r.id, r]));

  const isoPts: IsoPoint[] = cleanCanvas.map((p) => canvasToIso(p.x, p.y));
  const segCount = isoPts.length - 1;

  // 1. Classify every centerline segment
  const segments: RawSegment[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = isoPts[i];
    const b = isoPts[i + 1];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len = Math.hypot(du, dv) || 1;
    const dir = { u: du / len, v: dv / len };
    const rightVec = computeRightHandUnitIso(du, dv);
    const right: IsoPoint = { u: rightVec.rightU, v: rightVec.rightV };
    const spec = classifyRoadSegment(cleanCanvas[i], cleanCanvas[i + 1]);
    const rb = spec.roundaboutId ? rbById.get(spec.roundaboutId) ?? null : null;

    segments.push({ a, b, dir, right, len, spec, rb });
  }

  // 2. Group contiguous roundabout chords on the same roundabout into single RoundaboutRouteItems
  const items: RouteItem[] = [];
  let segCursor = 0;
  while (segCursor < segCount) {
    const seg = segments[segCursor];
    if (seg.spec.roadClass === 'roundabout' && seg.rb) {
      const rb = seg.rb;
      const startSeg = segCursor;
      let totalSweep = 0;
      const entryTheta = Math.atan2(seg.a.v - rb.v, seg.a.u - rb.u);

      while (
        segCursor < segCount &&
        segments[segCursor].spec.roadClass === 'roundabout' &&
        segments[segCursor].rb?.id === rb.id
      ) {
        const rs = segments[segCursor];
        const thA = Math.atan2(rs.a.v - rb.v, rs.a.u - rb.u);
        const thB = Math.atan2(rs.b.v - rb.v, rs.b.u - rb.u);
        let dTheta = (thB - thA) % (Math.PI * 2);
        if (dTheta < 0) dTheta += Math.PI * 2;
        totalSweep += dTheta;
        segCursor++;
      }

      const endSeg = segCursor - 1;
      // Left turn (~270° CCW) or U-turn (~360° CCW) uses inner roundabout lane (laneIndex: 1)
      const rbLane: LaneIndex = autoLane ? (totalSweep > Math.PI * 1.15 ? 1 : 0) : defaultLane;
      const rbOffset = getLaneLateralOffsetIso('roundabout', {
        laneIndex: rbLane,
        vehicleClass: options.vehicleClass,
      });

      items.push({
        kind: 'roundabout',
        rb,
        startSeg,
        endSeg,
        entryTheta,
        totalSweep,
        lane: rbLane,
        radius: rb.ringRadius + rbOffset,
        entryCurve: [],
        exitCurve: [],
        arcStartAngle: entryTheta,
        arcEndAngle: entryTheta + totalSweep,
      });
    } else {
      items.push({
        kind: 'straight',
        segIdx: segCursor,
        startLane: defaultLane,
        endLane: defaultLane,
        startOffset: 0,
        endOffset: 0,
        tStart: 0,
        tEnd: seg.len,
      });
      segCursor++;
    }
  }

  // 3. Look-ahead lane selection (1 intersection / roundabout ahead)
  // Pass A (right-to-left): decide endLane for each straight segment
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== 'straight') continue;
    const seg = segments[item.segIdx];

    if (seg.spec.lanesPerDirection < 2) {
      item.endLane = 0;
      continue;
    }

    if (!autoLane) {
      item.endLane = defaultLane;
      continue;
    }

    const next = items[i + 1];
    if (!next) {
      item.endLane = defaultLane;
      continue;
    }

    if (next.kind === 'roundabout') {
      item.endLane = next.lane;
      continue;
    }

    const nextSeg = segments[next.segIdx];
    const cross = seg.dir.u * nextSeg.dir.v - seg.dir.v * nextSeg.dir.u;
    const dot = seg.dir.u * nextSeg.dir.u + seg.dir.v * nextSeg.dir.v;

    if (cross > 0.35) {
      // Upcoming LEFT turn at the very next intersection -> prepare in left lane (lane 1)
      item.endLane = 1;
    } else if (dot > 0.96) {
      // Going straight through the next node: stay in right lane unless the next stub is tiny (< 55)
      // (e.g. a mid-edge split directly preceding a left turn)
      item.endLane = nextSeg.len < 55 ? next.endLane : defaultLane;
    } else if (dot < -0.5) {
      // 180° turnaround
      item.endLane = 1;
    } else {
      // Right turn -> stay in right lane (lane 0)
      item.endLane = 0;
    }
  }

  // Pass B (left-to-right): decide startLane for each straight segment & resolve offsets
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'straight') continue;
    const seg = segments[item.segIdx];

    if (seg.spec.lanesPerDirection < 2) {
      item.startLane = 0;
      item.endLane = 0;
    } else if (!autoLane) {
      item.startLane = defaultLane;
      item.endLane = defaultLane;
    } else if (i === 0) {
      item.startLane = defaultLane;
    } else {
      const prev = items[i - 1];
      if (prev.kind === 'roundabout') {
        // Exit from inner roundabout lane lands smoothly in left lane, then transitions right if needed
        item.startLane = prev.lane;
      } else {
        const prevSeg = segments[prev.segIdx];
        const cross = prevSeg.dir.u * seg.dir.v - prevSeg.dir.v * seg.dir.u;
        const dot = prevSeg.dir.u * seg.dir.u + prevSeg.dir.v * seg.dir.v;

        if (cross > 0.35) {
          // Just completed a LEFT turn onto a 2-lane avenue -> enter left lane (lane 1),
          // then smoothly return to right lane (lane 0) if continuing straight/right
          item.startLane = 1;
        } else if (dot > 0.96) {
          // Straight continuation from previous segment
          item.startLane = prev.endLane;
        } else {
          // Right turn onto a 2-lane avenue -> enter right lane (lane 0)
          item.startLane = 0;
        }
      }
    }

    item.startOffset = getLaneLateralOffsetIso(seg.spec.roadClass, {
      laneIndex: item.startLane,
      vehicleClass: options.vehicleClass,
    });
    item.endOffset = getLaneLateralOffsetIso(seg.spec.roadClass, {
      laneIndex: item.endLane,
      vehicleClass: options.vehicleClass,
    });
  }

  // 4. Compute exact tangent entry/exit Bezier fillets for every Roundabout item
  //    (eliminates the inward jog toward the centerline node on both entry and exit!)
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'roundabout') continue;

    const rb = item.rb;
    const R = item.radius;
    const prev = i > 0 ? items[i - 1] : null;
    const next = i < items.length - 1 ? items[i + 1] : null;

    // 4a. Smooth entry fillet from incoming straight road lane directly onto circle R
    if (prev && prev.kind === 'straight') {
      const sIn = segments[prev.segIdx];
      const dIn = prev.endOffset;
      const radialEntry: IsoPoint = {
        u: Math.cos(item.entryTheta),
        v: Math.sin(item.entryTheta),
      };
      // Verify that sIn approaches radially toward the roundabout center
      const align = -(sIn.dir.u * radialEntry.u + sIn.dir.v * radialEntry.v);
      if (align > 0.85 && dIn > 0 && dIn < R * 0.95) {
        const ccwTan: IsoPoint = {
          u: -Math.sin(item.entryTheta),
          v: Math.cos(item.entryTheta),
        };
        const minDelta = Math.asin(Math.min(0.92, dIn / R));
        const desiredDelta = Math.max(minDelta + 0.22, item.lane === 1 ? 0.58 : 0.48);
        const maxDelta = Math.max(minDelta + 0.06, item.totalSweep * 0.45);
        const deltaIn = Math.min(desiredDelta, maxDelta);

        const sinD = Math.sin(deltaIn);
        const cosD = Math.cos(deltaIn);
        const sTang = Math.max(2, (R * sinD - dIn) / Math.max(0.25, cosD));
        const rP1 = R * cosD + sTang * sinD;

        const maxRadIn = rb.ringRadius + sIn.len * 0.85;
        const s0 = Math.min(sTang, Math.max(2, maxRadIn - rP1));
        const rP0 = rP1 + s0;

        const toIso = (rad: number, ccw: number): IsoPoint => ({
          u: rb.u + rad * radialEntry.u + ccw * ccwTan.u,
          v: rb.v + rad * radialEntry.v + ccw * ccwTan.v,
        });

        const p0 = toIso(rP0, dIn);
        const p1 = toIso(rP1, dIn);
        const p2 = toIso(R * cosD, R * sinD);

        prev.tEnd = Math.max(0, sIn.len - (rP0 - rb.ringRadius));
        prev.endPoint = p0;

        const filletSteps = 5;
        item.entryCurve = [];
        for (let k = 0; k <= filletSteps; k++) {
          item.entryCurve.push(evalQuadBezier(p0, p1, p2, k / filletSteps));
        }
        item.arcStartAngle = item.entryTheta + deltaIn;
      }
    }

    // 4b. Smooth exit fillet from circle R directly onto outgoing straight road lane
    if (next && next.kind === 'straight') {
      const sOut = segments[next.segIdx];
      const dOut = next.startOffset;
      const exitSeg = segments[item.endSeg];
      const exitTheta = Math.atan2(exitSeg.b.v - rb.v, exitSeg.b.u - rb.u);
      const radialExit: IsoPoint = {
        u: Math.cos(exitTheta),
        v: Math.sin(exitTheta),
      };
      const align = sOut.dir.u * radialExit.u + sOut.dir.v * radialExit.v;
      if (align > 0.85 && dOut > 0 && dOut < R * 0.95) {
        const rightOut: IsoPoint = {
          u: Math.sin(exitTheta),
          v: -Math.cos(exitTheta),
        };
        const minDelta = Math.asin(Math.min(0.92, dOut / R));
        const desiredDelta = Math.max(minDelta + 0.22, item.lane === 1 ? 0.58 : 0.48);
        const maxDelta = Math.max(minDelta + 0.06, item.totalSweep * 0.45);
        const deltaOut = Math.min(desiredDelta, maxDelta);

        const sinD = Math.sin(deltaOut);
        const cosD = Math.cos(deltaOut);
        const sTang = Math.max(2, (R * sinD - dOut) / Math.max(0.25, cosD));
        const rQ1 = R * cosD + sTang * sinD;

        const maxRadOut = rb.ringRadius + sOut.len * 0.85;
        const s2 = Math.min(sTang, Math.max(2, maxRadOut - rQ1));
        const rQ2 = rQ1 + s2;

        const toIsoOut = (rad: number, right: number): IsoPoint => ({
          u: rb.u + rad * radialExit.u + right * rightOut.u,
          v: rb.v + rad * radialExit.v + right * rightOut.v,
        });

        const q0 = toIsoOut(R * cosD, R * sinD);
        const q1 = toIsoOut(rQ1, dOut);
        const q2 = toIsoOut(rQ2, dOut);

        next.tStart = Math.min(sOut.len, Math.max(0, rQ2 - rb.ringRadius));
        next.startPoint = q2;

        const filletSteps = 5;
        item.exitCurve = [];
        for (let k = 0; k <= filletSteps; k++) {
          item.exitCurve.push(evalQuadBezier(q0, q1, q2, k / filletSteps));
        }
        item.arcEndAngle = item.entryTheta + item.totalSweep - deltaOut;
      }
    }
  }

  // 5. Compute exact miter intersections & tapers between adjacent StraightRouteItems
  for (let i = 0; i < items.length - 1; i++) {
    const aItem = items[i];
    const bItem = items[i + 1];
    if (aItem.kind !== 'straight' || bItem.kind !== 'straight') continue;

    const s1 = segments[aItem.segIdx];
    const s2 = segments[bItem.segIdx];
    const dot = s1.dir.u * s2.dir.u + s1.dir.v * s2.dir.v;

    const offB1: IsoPoint = {
      u: s1.b.u + s1.right.u * aItem.endOffset,
      v: s1.b.v + s1.right.v * aItem.endOffset,
    };
    const offA2: IsoPoint = {
      u: s2.a.u + s2.right.u * bItem.startOffset,
      v: s2.a.v + s2.right.v * bItem.startOffset,
    };

    if (dot > 0.96) {
      // Collinear straight-through
      if (Math.abs(aItem.endOffset - bItem.startOffset) < 0.8) {
        const mid: IsoPoint = {
          u: (offB1.u + offA2.u) * 0.5,
          v: (offB1.v + offA2.v) * 0.5,
        };
        aItem.tEnd = s1.len;
        aItem.endPoint = mid;
        bItem.tStart = 0;
        bItem.startPoint = mid;
      } else {
        // Road-width transition (e.g. avenue <-> local): smooth forward taper
        const taperBack = Math.min(10, s1.len * 0.3);
        const taperFwd = Math.min(10, s2.len * 0.3);
        aItem.tEnd = Math.max(aItem.tStart, s1.len - taperBack);
        aItem.endPoint = {
          u: offB1.u - s1.dir.u * taperBack,
          v: offB1.v - s1.dir.v * taperBack,
        };
        bItem.tStart = Math.min(bItem.tEnd, taperFwd);
        bItem.startPoint = {
          u: offA2.u + s2.dir.u * taperFwd,
          v: offA2.v + s2.dir.v * taperFwd,
        };
      }
      continue;
    }

    if (dot < -0.92) {
      // 180-degree dead-end turnaround
      aItem.tEnd = s1.len;
      aItem.endPoint = offB1;
      bItem.tStart = 0;
      bItem.startPoint = offA2;
      continue;
    }

    // Angled / 90-degree intersection turn -> exact miter intersection
    const hit = intersectLinesIso(offB1, s1.dir, offA2, s2.dir);
    if (hit) {
      const distFromVertex = Math.hypot(hit.point.u - s1.b.u, hit.point.v - s1.b.v);
      const maxMiter = Math.max(aItem.endOffset, bItem.startOffset, AVENUE_ASPHALT_WIDTH * 0.5) * 1.55;
      const tEnd1 = s1.len + hit.t;
      const tStart2 = hit.s;

      if (
        distFromVertex <= maxMiter &&
        tEnd1 >= aItem.tStart - 1 &&
        hit.t <= maxMiter &&
        hit.s >= -maxMiter &&
        tStart2 <= bItem.tEnd + 1
      ) {
        aItem.tEnd = tEnd1;
        aItem.endPoint = hit.point;
        bItem.tStart = tStart2;
        bItem.startPoint = hit.point;
        continue;
      }
    }

    // Fallback midpoint join
    const fallbackMid: IsoPoint = {
      u: (offB1.u + offA2.u) * 0.5,
      v: (offB1.v + offA2.v) * 0.5,
    };
    aItem.endPoint = fallbackMid;
    bItem.startPoint = fallbackMid;
  }

  // 6. Emit final smooth polyline in isometric (u, v) space
  const outIso: IsoPoint[] = [];
  const pushIso = (p: IsoPoint) => {
    const prev = outIso[outIso.length - 1];
    if (!prev || Math.hypot(p.u - prev.u, p.v - prev.v) > 0.35) {
      outIso.push(p);
    }
  };

  for (const item of items) {
    if (item.kind === 'straight') {
      const seg = segments[item.segIdx];
      emitStraightWithOptionalLaneChange(seg, item, pushIso);
    } else {
      // Roundabout entry Bezier fillet
      for (const pt of item.entryCurve) {
        pushIso(pt);
      }

      // Smooth circular arc along chosen roundabout lane radius (outer lane 0 or inner lane 1)
      const rb = item.rb;
      const R = item.radius;
      const arcSpan = item.arcEndAngle - item.arcStartAngle;
      if (arcSpan > 0.02) {
        const arcSteps = Math.max(2, Math.ceil(arcSpan / (Math.PI / 18))); // ~10° increments
        for (let k = 0; k <= arcSteps; k++) {
          const theta = item.arcStartAngle + (arcSpan * k) / arcSteps;
          pushIso({
            u: rb.u + R * Math.cos(theta),
            v: rb.v + R * Math.sin(theta),
          });
        }
      } else if (item.entryCurve.length === 0 && item.exitCurve.length === 0) {
        const theta = item.entryTheta + item.totalSweep * 0.5;
        pushIso({
          u: rb.u + R * Math.cos(theta),
          v: rb.v + R * Math.sin(theta),
        });
      }

      // Roundabout exit Bezier fillet
      for (const pt of item.exitCurve) {
        pushIso(pt);
      }
    }
  }

  return outIso.map((p) => {
    const c = isoToCanvas(p.u, p.v);
    return {
      x: Math.round(c.x * 100) / 100,
      y: Math.round(c.y * 100) / 100,
    };
  });
}
