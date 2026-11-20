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
