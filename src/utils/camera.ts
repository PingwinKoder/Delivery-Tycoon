import type { Point } from '../types/roadGraph';
import { MAP_HEIGHT, MAP_WIDTH } from './cityMap';

export const MIN_ZOOM = 1.4;
export const MAX_ZOOM = 2.0;
export const DEFAULT_ZOOM = 1.4;

/** Reference desktop viewport dimensions at which base scale equals 1.0 */
export const REFERENCE_VIEWPORT_WIDTH = 1400;
export const REFERENCE_VIEWPORT_HEIGHT = 900;

const DEFAULT_MAP_SIZE: Size = { width: MAP_WIDTH, height: MAP_HEIGHT };

export interface CameraState {
  /** World X coordinate at the center of the viewport */
  x: number;
  /** World Y coordinate at the center of the viewport */
  y: number;
  /** User-facing zoom multiplier strictly within [MIN_ZOOM, MAX_ZOOM] (1.4x–2.0x) */
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Computes a responsive base scale factor relative to the reference desktop viewport (~1400x900)
 * so phones and tablets show a comparable slice of the city at MIN_ZOOM (1.4x), while guaranteeing
 * that at MIN_ZOOM the viewport never exposes empty void outside the map edges.
 */
export function getResponsiveBaseScale(
  viewport: Size,
  mapSize: Size = DEFAULT_MAP_SIZE
): number {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);

  const desiredScale = Math.min(
    1,
    vw / REFERENCE_VIEWPORT_WIDTH,
    vh / REFERENCE_VIEWPORT_HEIGHT
  );

  const minFillScale =
    Math.max(
      vw / Math.max(1, mapSize.width),
      vh / Math.max(1, mapSize.height)
    ) / MIN_ZOOM;

  return Math.max(desiredScale, minFillScale);
}

/**
 * Returns the actual canvas world-to-screen scale (user zoom × responsive base scale).
 */
export function getEffectiveZoom(
  userZoom: number,
  viewport: Size,
  mapSize: Size = DEFAULT_MAP_SIZE
): number {
  return clampZoom(userZoom) * getResponsiveBaseScale(viewport, mapSize);
}

export function clampCamera(
  camera: CameraState,
  viewport: Size,
  mapSize: Size
): CameraState {
  const zoom = clampZoom(camera.zoom);
  const effectiveZoom = getEffectiveZoom(zoom, viewport, mapSize);
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const halfVisW = vw / (2 * effectiveZoom);
  const halfVisH = vh / (2 * effectiveZoom);

  let x = camera.x;
  let y = camera.y;

  if (halfVisW * 2 >= mapSize.width) {
    x = mapSize.width / 2;
  } else {
    x = Math.max(halfVisW, Math.min(mapSize.width - halfVisW, x));
  }

  if (halfVisH * 2 >= mapSize.height) {
    y = mapSize.height / 2;
  } else {
    y = Math.max(halfVisH, Math.min(mapSize.height - halfVisH, y));
  }

  return { x, y, zoom };
}

export function createInitialCamera(
  viewport: Size,
  mapSize: Size,
  focusPoint: Point = { x: 520, y: 1220 }
): CameraState {
  return clampCamera(
    {
      x: focusPoint.x,
      y: focusPoint.y,
      zoom: DEFAULT_ZOOM,
    },
    viewport,
    mapSize
  );
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: CameraState,
  viewport: Size,
  mapSize: Size = DEFAULT_MAP_SIZE
): Point {
  const effectiveZoom = getEffectiveZoom(camera.zoom, viewport, mapSize);
  const worldX = camera.x + (screenX - viewport.width / 2) / effectiveZoom;
  const worldY = camera.y + (screenY - viewport.height / 2) / effectiveZoom;
  return { x: worldX, y: worldY };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: CameraState,
  viewport: Size,
  mapSize: Size = DEFAULT_MAP_SIZE
): Point {
  const effectiveZoom = getEffectiveZoom(camera.zoom, viewport, mapSize);
  const screenX = viewport.width / 2 + (worldX - camera.x) * effectiveZoom;
  const screenY = viewport.height / 2 + (worldY - camera.y) * effectiveZoom;
  return { x: screenX, y: screenY };
}

export function panCameraByScreenDelta(
  camera: CameraState,
  deltaScreenX: number,
  deltaScreenY: number,
  viewport: Size,
  mapSize: Size
): CameraState {
  const effectiveZoom = getEffectiveZoom(camera.zoom, viewport, mapSize);
  return clampCamera(
    {
      x: camera.x - deltaScreenX / effectiveZoom,
      y: camera.y - deltaScreenY / effectiveZoom,
      zoom: camera.zoom,
    },
    viewport,
    mapSize
  );
}

export const WHEEL_ZOOM_DEADZONE = 2.5;
export const WHEEL_ZOOM_SENSITIVITY = 0.0031;
export const MAX_WHEEL_ZOOM_LOG_STEP = 0.13;

export function normalizeWheelDeltaY(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16; // DOM_DELTA_LINE
  if (deltaMode === 2) return deltaY * 100; // DOM_DELTA_PAGE
  return deltaY;
}

export function zoomCameraAtScreenPoint(
  camera: CameraState,
  targetZoom: number,
  screenX: number,
  screenY: number,
  viewport: Size,
  mapSize: Size
): CameraState {
  const nextZoom = clampZoom(targetZoom);
  const nextEffectiveZoom = getEffectiveZoom(nextZoom, viewport, mapSize);
  const worldUnderCursor = screenToWorld(screenX, screenY, camera, viewport, mapSize);

  const nextX =
    worldUnderCursor.x - (screenX - viewport.width / 2) / nextEffectiveZoom;
  const nextY =
    worldUnderCursor.y - (screenY - viewport.height / 2) / nextEffectiveZoom;

  return clampCamera(
    {
      x: nextX,
      y: nextY,
      zoom: nextZoom,
    },
    viewport,
    mapSize
  );
}

/**
 * Applies smooth, deltaY-proportional zoom around a screen point for both laptop
 * touchpad pinch/scroll gestures and physical mouse wheels:
 * - Ignores tiny jitter impulses below WHEEL_ZOOM_DEADZONE (prevents bounce-back on finger lift)
 * - Caps the maximum log-scale step per event to avoid sudden zoom jumps
 */
export function zoomCameraByWheel(
  camera: CameraState,
  deltaY: number,
  deltaMode: number,
  screenX: number,
  screenY: number,
  viewport: Size,
  mapSize: Size
): CameraState {
  if (!Number.isFinite(deltaY)) return camera;
  const normalizedDeltaY = normalizeWheelDeltaY(deltaY, deltaMode);
  if (Math.abs(normalizedDeltaY) < WHEEL_ZOOM_DEADZONE) {
    return camera;
  }

  const rawLogStep = -normalizedDeltaY * WHEEL_ZOOM_SENSITIVITY;
  const clampedLogStep = Math.max(
    -MAX_WHEEL_ZOOM_LOG_STEP,
    Math.min(MAX_WHEEL_ZOOM_LOG_STEP, rawLogStep)
  );
  const targetZoom = camera.zoom * Math.exp(clampedLogStep);

  return zoomCameraAtScreenPoint(
    camera,
    targetZoom,
    screenX,
    screenY,
    viewport,
    mapSize
  );
}

export const CAMERA_MAX_DT = 0.05;
export const CAMERA_POS_LAMBDA = 18;
export const CAMERA_ZOOM_LAMBDA = 16;
export const CAMERA_POS_SNAP_EPSILON = 0.05;
export const CAMERA_ZOOM_SNAP_EPSILON = 0.0005;

export const ARROW_PAN_MAX_SCREEN_SPEED = 580; // screen px/s
export const ARROW_PAN_ACCEL_LAMBDA = 13;
export const ARROW_PAN_DECEL_LAMBDA = 11;
export const ARROW_VELOCITY_SNAP_EPSILON = 0.5; // screen px/s

export interface CameraVelocity {
  /** Horizontal pan velocity in screen pixels per second */
  vx: number;
  /** Vertical pan velocity in screen pixels per second */
  vy: number;
}

export interface ArrowInputVector {
  x: number;
  y: number;
}

export interface CameraStepResult {
  camera: CameraState;
  target: CameraState;
  velocity: CameraVelocity;
  animating: boolean;
}

export function clampCameraDt(rawDt: number): number {
  if (!Number.isFinite(rawDt) || rawDt <= 0) return 0;
  return Math.min(rawDt, CAMERA_MAX_DT);
}

export function expSmoothingFactor(lambda: number, dt: number): number {
  const safeDt = clampCameraDt(dt);
  if (safeDt <= 0) return 0;
  return 1 - Math.exp(-lambda * safeDt);
}

/**
 * Advances camera position, zoom, and keyboard-pan velocity using frame-rate-independent
 * exponential smoothing (`1 - Math.exp(-lambda * dt)`, clamped to `dt <= 0.05s`):
 * - Arrow keys drive a smooth velocity vector with exponential acceleration & deceleration
 *   integrated directly into the camera (avoiding target-chasing jitter).
 * - Mouse/touch pan, wheel zoom, and programmatic recenter smoothly converge toward `target`.
 * - Hard-snaps to exact target values once remaining delta drops below 0.05 px (position)
 *   or 0.0005 (zoom) to eliminate sub-pixel shimmer on thin lines.
 */
export function stepCameraPhysics(
  camera: CameraState,
  target: CameraState,
  velocity: CameraVelocity,
  arrowInput: ArrowInputVector,
  rawDt: number,
  viewport: Size,
  mapSize: Size
): CameraStepResult {
  const dt = clampCameraDt(rawDt);

  const inputLen = Math.hypot(arrowInput.x, arrowInput.y);
  const hasArrowInput = inputLen > 0;
  const desiredVx = hasArrowInput
    ? (arrowInput.x / inputLen) * ARROW_PAN_MAX_SCREEN_SPEED
    : 0;
  const desiredVy = hasArrowInput
    ? (arrowInput.y / inputLen) * ARROW_PAN_MAX_SCREEN_SPEED
    : 0;

  let nextVx = velocity.vx;
  let nextVy = velocity.vy;

  if (dt > 0) {
    const velLambda = hasArrowInput ? ARROW_PAN_ACCEL_LAMBDA : ARROW_PAN_DECEL_LAMBDA;
    const velAlpha = expSmoothingFactor(velLambda, dt);
    nextVx += (desiredVx - nextVx) * velAlpha;
    nextVy += (desiredVy - nextVy) * velAlpha;

    if (!hasArrowInput && Math.hypot(nextVx, nextVy) < ARROW_VELOCITY_SNAP_EPSILON) {
      nextVx = 0;
      nextVy = 0;
    }
  }

  let curCam = clampCamera(camera, viewport, mapSize);
  let nextTarget = clampCamera(target, viewport, mapSize);

  // Integrate arrow-key velocity directly into camera position (with wall clamping)
  if ((nextVx !== 0 || nextVy !== 0) && dt > 0) {
    const effectiveZoom = getEffectiveZoom(curCam.zoom, viewport, mapSize);
    const worldStepX = (nextVx * dt) / effectiveZoom;
    const worldStepY = (nextVy * dt) / effectiveZoom;

    if (
      !hasArrowInput &&
      Math.abs(worldStepX) < CAMERA_POS_SNAP_EPSILON &&
      Math.abs(worldStepY) < CAMERA_POS_SNAP_EPSILON
    ) {
      nextVx = 0;
      nextVy = 0;
    } else {
      const unclampedX = curCam.x + worldStepX;
      const unclampedY = curCam.y + worldStepY;
      const movedCam = clampCamera(
        { x: unclampedX, y: unclampedY, zoom: curCam.zoom },
        viewport,
        mapSize
      );

      // Stop velocity component pushing into a map boundary for crisp reversal
      if (Math.abs(movedCam.x - unclampedX) > 1e-4) {
        nextVx = 0;
      }
      if (Math.abs(movedCam.y - unclampedY) > 1e-4) {
        nextVy = 0;
      }

      const appliedDx = movedCam.x - curCam.x;
      const appliedDy = movedCam.y - curCam.y;
      curCam = movedCam;

      nextTarget = clampCamera(
        {
          x: hasArrowInput ? curCam.x : nextTarget.x + appliedDx,
          y: hasArrowInput ? curCam.y : nextTarget.y + appliedDy,
          zoom: nextTarget.zoom,
        },
        viewport,
        mapSize
      );
    }
  }

  // Exponential convergence toward target camera (position & zoom)
  let nextX = curCam.x;
  let nextY = curCam.y;
  let nextZoom = curCam.zoom;

  if (dt > 0) {
    const posAlpha = expSmoothingFactor(CAMERA_POS_LAMBDA, dt);
    const zoomAlpha = expSmoothingFactor(CAMERA_ZOOM_LAMBDA, dt);

    nextX = curCam.x + (nextTarget.x - curCam.x) * posAlpha;
    nextY = curCam.y + (nextTarget.y - curCam.y) * posAlpha;
    nextZoom = curCam.zoom + (nextTarget.zoom - curCam.zoom) * zoomAlpha;
  }

  // Hard snap once within threshold to eliminate micro-shimmer on thin lines
  if (Math.abs(nextTarget.x - nextX) < CAMERA_POS_SNAP_EPSILON) {
    nextX = nextTarget.x;
  }
  if (Math.abs(nextTarget.y - nextY) < CAMERA_POS_SNAP_EPSILON) {
    nextY = nextTarget.y;
  }
  if (Math.abs(nextTarget.zoom - nextZoom) < CAMERA_ZOOM_SNAP_EPSILON) {
    nextZoom = nextTarget.zoom;
  }

  let finalCam = clampCamera(
    { x: nextX, y: nextY, zoom: nextZoom },
    viewport,
    mapSize
  );

  if (Math.abs(nextTarget.x - finalCam.x) < CAMERA_POS_SNAP_EPSILON) {
    finalCam = { ...finalCam, x: nextTarget.x };
  }
  if (Math.abs(nextTarget.y - finalCam.y) < CAMERA_POS_SNAP_EPSILON) {
    finalCam = { ...finalCam, y: nextTarget.y };
  }
  if (Math.abs(nextTarget.zoom - finalCam.zoom) < CAMERA_ZOOM_SNAP_EPSILON) {
    finalCam = { ...finalCam, zoom: nextTarget.zoom };
  }

  const animating =
    hasArrowInput ||
    nextVx !== 0 ||
    nextVy !== 0 ||
    finalCam.x !== nextTarget.x ||
    finalCam.y !== nextTarget.y ||
    finalCam.zoom !== nextTarget.zoom;

  return {
    camera: finalCam,
    target: nextTarget,
    velocity: { vx: nextVx, vy: nextVy },
    animating,
  };
}

