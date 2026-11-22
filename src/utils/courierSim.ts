import type { Point } from '../types/roadGraph';
import { BASE_GAME_MINUTES_PER_REAL_SECOND } from './gameClock';

export type CourierPhase = 'idle' | 'outbound' | 'delivering' | 'returning';

export interface CourierState {
  phase: CourierPhase;
  /** True while the courier is out on a delivery (outbound, delivering, or returning) */
  active: boolean;
  /** True during the delivery handoff stop at the destination */
  arrived: boolean;
  /**
   * True when the human rider is mounted on the bicycle (outbound & returning).
   * False during 'delivering' (rider enters the building, leaving only the empty parked bicycle)
   * and during 'idle' (empty bicycle parked on BAZA rack).
   */
  riderMounted: boolean;
  /** Currently followed polyline (outbound or directed right-hand return) */
  path: Point[];
  /** Full outbound polyline from BAZA bike rack via right-hand lanes to deliveryStopPoint */
  outboundPath: Point[];
  /** Full directed return polyline from deliveryStopPoint via right-hand lanes & CCW roundabouts back to BAZA rack */
  returnPath: Point[];
  /** Optional human-readable label for the target building/address */
  targetLabel?: string;
  segmentIndex: number;
  distanceInSegment: number;
  x: number;
  y: number;
  angle: number;
  totalDistance: number;
  traveledDistance: number;
  speed: number;
  /** Remaining pause duration (seconds) while courier is inside the building delivering parcel */
  deliveryPauseRemaining: number;
  /** Configured pause duration (seconds) at destination (1.5–2.0s) */
  deliveryPauseDuration: number;
  /** Accumulated wheel rotation angle (radians) for subtle spoke & riding animation */
  wheelPhase: number;
}

export const DEFAULT_COURIER_SPEED = 180; // world pixels per second (crisp bicycle pace)
export const DELIVERY_PAUSE_SECONDS = 1.8; // 1.5–2.0s empty-bike stop while courier delivers inside building
const WHEEL_RADIANS_PER_PIXEL = 0.25;

export function computePolylineLength(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return sum;
}

/**
 * Joins multiple waypoint arrays (e.g., off-road rack lead-out + right-hand road path + off-road delivery pull-in)
 * into a clean polyline without duplicate near-identical boundary points.
 */
export function stitchWaypoints(...segments: Array<Point[] | undefined>): Point[] {
  const combined: Point[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    for (const pt of seg) {
      const prev = combined[combined.length - 1];
      if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.5) {
        combined.push({ x: pt.x, y: pt.y });
      }
    }
  }
  return combined;
}

/**
 * Prepends concrete-yard lead-out waypoints from the BAZA bike rack onto a road path,
 * deduplicating any near-identical boundary points.
 */
export function prependRackExitToPath(rackWaypoints: Point[], roadPath: Point[]): Point[] {
  return stitchWaypoints(rackWaypoints, roadPath);
}

export function createIdleCourier(): CourierState {
  return {
    phase: 'idle',
    active: false,
    arrived: false,
    riderMounted: false,
    path: [],
    outboundPath: [],
    returnPath: [],
    segmentIndex: 0,
    distanceInSegment: 0,
    x: 0,
    y: 0,
    angle: 0,
    totalDistance: 0,
    traveledDistance: 0,
    speed: DEFAULT_COURIER_SPEED,
    deliveryPauseRemaining: 0,
    deliveryPauseDuration: DELIVERY_PAUSE_SECONDS,
    wheelPhase: 0,
  };
}

export function createCourierFromPath(
  outboundPoints: Point[],
  speed = DEFAULT_COURIER_SPEED,
  deliveryPauseDuration = DELIVERY_PAUSE_SECONDS,
  returnPoints?: Point[],
  targetLabel?: string
): CourierState {
  if (outboundPoints.length < 2) {
    return createIdleCourier();
  }

  const outboundPath = outboundPoints.map((p) => ({ x: p.x, y: p.y }));
  const resolvedReturn =
    returnPoints && returnPoints.length >= 2
      ? returnPoints.map((p) => ({ x: p.x, y: p.y }))
      : [...outboundPath].reverse();

  const dx = outboundPath[1].x - outboundPath[0].x;
  const dy = outboundPath[1].y - outboundPath[0].y;
  const angle = Math.atan2(dy, dx);

  return {
    phase: 'outbound',
    active: true,
    arrived: false,
    riderMounted: true,
    path: outboundPath,
    outboundPath,
    returnPath: resolvedReturn,
    targetLabel,
    segmentIndex: 0,
    distanceInSegment: 0,
    x: outboundPath[0].x,
    y: outboundPath[0].y,
    angle,
    totalDistance: computePolylineLength(outboundPath),
    traveledDistance: 0,
    speed,
    deliveryPauseRemaining: 0,
    deliveryPauseDuration: Math.max(0, deliveryPauseDuration),
    wheelPhase: 0,
  };
}

function beginReturnLeg(state: CourierState, wheelPhase: number): CourierState {
  const returnPath =
    state.returnPath.length >= 2 ? state.returnPath : [...state.outboundPath].reverse();
  if (returnPath.length < 2) {
    return createIdleCourier();
  }

  const dx = returnPath[1].x - returnPath[0].x;
  const dy = returnPath[1].y - returnPath[0].y;
  return {
    ...state,
    phase: 'returning',
    active: true,
    arrived: false,
    riderMounted: true,
    path: returnPath,
    segmentIndex: 0,
    distanceInSegment: 0,
    x: returnPath[0].x,
    y: returnPath[0].y,
    angle: Math.atan2(dy, dx),
    totalDistance: computePolylineLength(returnPath),
    traveledDistance: 0,
    deliveryPauseRemaining: 0,
    wheelPhase,
  };
}

export const MAX_REAL_FRAME_DT = 0.05;

/**
 * Computes scaled simulation delta time (seconds) from real frame delta and game speed
 * multiplier (0 = paused, 1 = 1x, 2 = 2x, 4 = 4x). Clamps raw real delta first so faster
 * speeds (2x/4x) scale proportionally without being capped, staying in exact lockstep with
 * the world clock (2 / 4 / 8 game minutes per real second). Shared by couriers and future vehicles.
 */
export function computeScaledSimDt(rawRealDt: number, speedMultiplier = 1): number {
  if (!Number.isFinite(rawRealDt) || !Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    return 0;
  }
  const clampedRealDt = Math.min(Math.max(0, rawRealDt), MAX_REAL_FRAME_DT);
  return clampedRealDt * speedMultiplier;
}

/**
 * Converts a scaled simulation delta (from computeScaledSimDt) into elapsed in-game minutes
 * using the global clock rate (1x = 2 min/s, 2x = 4 min/s, 4x = 8 min/s).
 */
export function simDtToGameMinutes(simDt: number): number {
  if (!Number.isFinite(simDt) || simDt <= 0) return 0;
  return simDt * BASE_GAME_MINUTES_PER_REAL_SECOND;
}

function stepCourierBySimDt(state: CourierState, dt: number): CourierState {
  if (!state.active || state.phase === 'idle' || dt <= 0) {
    return state;
  }

  // Stop at destination: rider has dismounted (empty bike parked on sidewalk/parking for 1.8s)
  if (state.phase === 'delivering') {
    const remaining = state.deliveryPauseRemaining - dt;
    if (remaining > 0) {
      return {
        ...state,
        riderMounted: false,
        deliveryPauseRemaining: remaining,
      };
    }

    const returnState = beginReturnLeg(state, state.wheelPhase);
    const leftoverDt = -remaining;
    return leftoverDt > 1e-6 ? stepCourierBySimDt(returnState, leftoverDt) : returnState;
  }

  if (state.path.length < 2) {
    return createIdleCourier();
  }

  let remainingStep = state.speed * dt;
  const prevTraveled = state.traveledDistance;
  let segIdx = state.segmentIndex;
  let distInSeg = state.distanceInSegment;
  let traveled = state.traveledDistance;

  while (remainingStep > 0 && segIdx < state.path.length - 1) {
    const a = state.path[segIdx];
    const b = state.path[segIdx + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);

    if (segLen < 1e-4) {
      segIdx++;
      distInSeg = 0;
      continue;
    }

    const leftInSeg = segLen - distInSeg;
    if (remainingStep < leftInSeg) {
      distInSeg += remainingStep;
      traveled += remainingStep;
      remainingStep = 0;
    } else {
      traveled += leftInSeg;
      remainingStep -= leftInSeg;
      segIdx++;
      distInSeg = 0;
    }
  }

  const movedDist = Math.max(0, traveled - prevTraveled);
  const nextWheelPhase = state.wheelPhase + movedDist * WHEEL_RADIANS_PER_PIXEL;

  // Reached end of current leg
  if (segIdx >= state.path.length - 1) {
    const last = state.path[state.path.length - 1];
    const prev = state.path[state.path.length - 2];

    if (state.phase === 'outbound') {
      // Arrived at deliveryStopPoint -> rider dismounts (empty parked bike for 1.8s)
      if (state.deliveryPauseDuration <= 0) {
        return beginReturnLeg(state, nextWheelPhase);
      }

      return {
        ...state,
        phase: 'delivering',
        active: true,
        arrived: true,
        riderMounted: false,
        segmentIndex: state.path.length - 2,
        distanceInSegment: Math.hypot(last.x - prev.x, last.y - prev.y),
        x: last.x,
        y: last.y,
        angle: Math.atan2(last.y - prev.y, last.x - prev.x),
        traveledDistance: state.totalDistance,
        deliveryPauseRemaining: state.deliveryPauseDuration,
        wheelPhase: nextWheelPhase,
      };
    }

    // Completed return leg -> back at BAZA bike rack (idle, empty bike parks on rack)
    return createIdleCourier();
  }

  const a = state.path[segIdx];
  const b = state.path[segIdx + 1];
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  const t = segLen > 1e-6 ? distInSeg / segLen : 0;

  return {
    ...state,
    riderMounted: true,
    segmentIndex: segIdx,
    distanceInSegment: distInSeg,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    // Crisp immediate heading alignment to the active road segment
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    traveledDistance: Math.min(state.totalDistance, traveled),
    wheelPhase: nextWheelPhase,
  };
}

/**
 * Advances a courier using an already-scaled simulation delta time (seconds).
 * Designed so couriers and future fleet vehicles share the exact same scaled simDt per frame.
 */
export function stepCourierWithSimDt(state: CourierState, simDt: number): CourierState {
  if (!Number.isFinite(simDt) || simDt <= 0) {
    return state;
  }
  return stepCourierBySimDt(state, simDt);
}

/**
 * Advances a courier from real frame delta time and game speed multiplier (0, 1, 2, 4).
 */
export function stepCourier(
  state: CourierState,
  rawDt: number,
  speedMultiplier = 1
): CourierState {
  const simDt = computeScaledSimDt(rawDt, speedMultiplier);
  return stepCourierWithSimDt(state, simDt);
}
