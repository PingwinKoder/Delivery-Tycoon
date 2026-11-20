import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampCamera,
  createInitialCamera,
  getEffectiveZoom,
  getResponsiveBaseScale,
  panCameraByScreenDelta,
  screenToWorld,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from './camera';

import { MAP_HEIGHT, MAP_WIDTH } from './cityMap';

const MAP_SIZE = { width: MAP_WIDTH, height: MAP_HEIGHT };
const DESKTOP = { width: 1440, height: 900 };
const TABLET_LANDSCAPE = { width: 1024, height: 768 };
const TABLET_PORTRAIT = { width: 768, height: 1024 };
const MOBILE_PORTRAIT = { width: 390, height: 844 };
const MOBILE_LANDSCAPE = { width: 844, height: 390 };

test('initial camera starts at 1.4x zoom centered near lower-left within map bounds', () => {
  const cam = createInitialCamera(DESKTOP, MAP_SIZE, { x: 830, y: 1475 });
  assert.equal(cam.zoom, DEFAULT_ZOOM);
  assert.equal(DEFAULT_ZOOM, 1.4);
  const topLeft = screenToWorld(0, 0, cam, DESKTOP);
  const bottomRight = screenToWorld(DESKTOP.width, DESKTOP.height, cam, DESKTOP);
  assert.ok(topLeft.x >= 0 && topLeft.y >= 0);
  assert.ok(bottomRight.x <= MAP_SIZE.width && bottomRight.y <= MAP_SIZE.height);
});

test('responsive base scale preserves 1.0 on desktop and adjusts base FOV on tablet & phone without exposing map void', () => {
  assert.equal(getResponsiveBaseScale(DESKTOP, MAP_SIZE), 1.0);

  for (const vp of [TABLET_LANDSCAPE, TABLET_PORTRAIT, MOBILE_PORTRAIT, MOBILE_LANDSCAPE]) {
    const baseScale = getResponsiveBaseScale(vp, MAP_SIZE);
    assert.ok(baseScale < 1.0, `expected baseScale < 1.0 on ${vp.width}x${vp.height}, got ${baseScale}`);

    const camMin = clampCamera({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: MIN_ZOOM }, vp, MAP_SIZE);
    const tl = screenToWorld(0, 0, camMin, vp, MAP_SIZE);
    const br = screenToWorld(vp.width, vp.height, camMin, vp, MAP_SIZE);
    const visW = br.x - tl.x;
    const visH = br.y - tl.y;

    // Never exposes void outside map bounds at MIN_ZOOM (1.4x)
    assert.ok(tl.x >= -1e-6 && tl.y >= -1e-6, `top-left void exposed on ${vp.width}x${vp.height}`);
    assert.ok(br.x <= MAP_SIZE.width + 1e-6 && br.y <= MAP_SIZE.height + 1e-6, `bottom-right void exposed on ${vp.width}x${vp.height}`);

    // Shows a desktop-comparable slice of the city at 1.4x zoom
    assert.ok(visW >= 900, `expected wide world FOV >= 900 on ${vp.width}x${vp.height}, got ${visW}`);
    assert.ok(visH >= 640, `expected tall world FOV >= 640 on ${vp.width}x${vp.height}, got ${visH}`);
  }
});

test('camera clamping prevents panning outside map edges on desktop, tablet, and mobile', () => {
  for (const vp of [DESKTOP, TABLET_PORTRAIT, MOBILE_PORTRAIT, MOBILE_LANDSCAPE]) {
    const camTopLeft = clampCamera({ x: -500, y: -500, zoom: MIN_ZOOM }, vp, MAP_SIZE);
    const tl = screenToWorld(0, 0, camTopLeft, vp, MAP_SIZE);
    assert.ok(tl.x >= -1e-6 && tl.y >= -1e-6, `top-left clamp failed on ${vp.width}x${vp.height}`);

    const camBotRight = clampCamera({ x: 5000, y: 5000, zoom: MIN_ZOOM }, vp, MAP_SIZE);
    const br = screenToWorld(vp.width, vp.height, camBotRight, vp, MAP_SIZE);
    assert.ok(br.x <= MAP_SIZE.width + 1e-6 && br.y <= MAP_SIZE.height + 1e-6, `bottom-right clamp failed on ${vp.width}x${vp.height}`);
  }
});

test('zoom stays clamped between 1.4x and 2.0x across viewports', () => {
  assert.equal(MIN_ZOOM, 1.4);
  assert.equal(MAX_ZOOM, 2.0);

  for (const vp of [DESKTOP, MOBILE_PORTRAIT]) {
    const camMin = clampCamera({ x: 1000, y: 800, zoom: 0.8 }, vp, MAP_SIZE);
    assert.equal(camMin.zoom, MIN_ZOOM);

    const camMax = clampCamera({ x: 1000, y: 800, zoom: 2.5 }, vp, MAP_SIZE);
    assert.equal(camMax.zoom, MAX_ZOOM);
  }
});

test('zoomCameraAtScreenPoint keeps world point under cursor fixed when not clamped (desktop and mobile)', () => {
  for (const vp of [DESKTOP, MOBILE_PORTRAIT]) {
    const start = { x: 1600, y: 1000, zoom: 1.5 };
    const cursor = { x: vp.width * 0.55, y: vp.height * 0.45 };
    const before = screenToWorld(cursor.x, cursor.y, start, vp, MAP_SIZE);
    const afterCam = zoomCameraAtScreenPoint(start, 1.9, cursor.x, cursor.y, vp, MAP_SIZE);
    const after = screenToWorld(cursor.x, cursor.y, afterCam, vp, MAP_SIZE);
    assert.ok(Math.abs(before.x - after.x) < 1e-6);
    assert.ok(Math.abs(before.y - after.y) < 1e-6);
  }
});

test('screenToWorld and worldToScreen are exact inverses on desktop and mobile', () => {
  const cam = { x: 900, y: 700, zoom: 1.85 };
  const pt = { x: 1120, y: 615 };
  for (const vp of [DESKTOP, MOBILE_PORTRAIT]) {
    const scr = worldToScreen(pt.x, pt.y, cam, vp, MAP_SIZE);
    const back = screenToWorld(scr.x, scr.y, cam, vp, MAP_SIZE);
    assert.ok(Math.abs(pt.x - back.x) < 1e-6);
    assert.ok(Math.abs(pt.y - back.y) < 1e-6);
  }
});

test('panCameraByScreenDelta moves camera opposite to drag delta using effectiveZoom', () => {
  const cam = { x: 1300, y: 800, zoom: 1.6 };
  const nextDesktop = panCameraByScreenDelta(cam, 80, -40, DESKTOP, MAP_SIZE);
  assert.equal(nextDesktop.x, 1250);
  assert.equal(nextDesktop.y, 825);

  const mobileEff = getEffectiveZoom(cam.zoom, MOBILE_PORTRAIT, MAP_SIZE);
  const nextMobile = panCameraByScreenDelta(cam, 80, -40, MOBILE_PORTRAIT, MAP_SIZE);
  assert.ok(Math.abs(nextMobile.x - (1300 - 80 / mobileEff)) < 1e-6);
  assert.ok(Math.abs(nextMobile.y - (800 + 40 / mobileEff)) < 1e-6);
});
