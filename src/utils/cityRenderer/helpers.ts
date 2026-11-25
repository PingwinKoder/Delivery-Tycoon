import type { ParkingContourSegment } from '../parkingLayout';
import type { ProceduralTextures } from './types';

export const GROUND_PALETTE = {
  inkOutline: '#1e293b',
  inkDark: '#262b33',
  grassBase: '#6ea33d',
  grassPatchDark: '#639635',
  grassPatchLight: '#7cb347',
  grassTuft: '#3d611e',
  sidewalkFill: '#dfd9ce',
  sidewalkHighlight: '#efeae0',
  sidewalkJoint: 'rgba(38, 43, 51, 0.25)',
  concreteBase: '#d6d1c6',
  concreteJoint: 'rgba(38, 43, 51, 0.21)',
  asphaltBase: '#424852',
  asphaltCurbShadow: '#2c323c',
  markingWhite: '#f8fafc',
  markingYellow: '#facc15',
  hazardYellow: '#facc15',
  hazardGraphite: '#262b33',
} as const;

export const STATIC_GROUND_BUFFER_SCALE = 1.25;
export const STATIC_GROUND_TILE_PIXEL_SIZE = 1024;
export const STATIC_GROUND_TILE_OVERLAP_WORLD = 1; // Overlap world unit to prevent sub-pixel seams between tiles
export const STATIC_GRID_INV_SCALE = 1 / Math.sqrt(1.65);

export const VIEWPORT_CAMERA_POS_EPSILON = 1e-4;
export const VIEWPORT_CAMERA_ZOOM_EPSILON = 1e-5;

export const FENCE_COLOR_U = '#b88958';
export const FENCE_COLOR_V = '#9e7143';
export const FENCE_COLOR_TOP = '#cfa372';
export const FENCE_OUTLINE = '#3d2817';
export const FENCE_PICKET_SEAM = 'rgba(61, 40, 23, 0.56)';
export const FENCE_RIDGE_SEAM = 'rgba(61, 40, 23, 0.48)';

export const BUILDING_SPRITE_SCALE = 1.25;
export const BUILDING_SPRITE_PAD = 3;
export const BUILDING_SPRITE_INV_SCALE = 1 / Math.sqrt(1.65);

export const FENCE_SPRITE_SCALE = 1.25;
export const FENCE_SPRITE_PAD = 2;
export const FENCE_SPRITE_INV_SCALE = 1 / Math.sqrt(1.65);

/** Deterministic PRNG for organic noise textures and grass detail placement */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoisePatternCanvas(
  size: number,
  baseRgb: [number, number, number],
  grainAmp: number,
  patchAmp: number,
  seed: number,
  speckleChance = 0.08
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return c;

  const rand = mulberry32(seed);
  const img = g.createImageData(size, size);
  const d = img.data;

  // Low-frequency tileable value grid for soft organic mottling
  const gridN = 8;
  const grid: number[] = [];
  for (let i = 0; i < gridN * gridN; i++) {
    grid.push((rand() - 0.5) * 2);
  }

  const sampleSmooth = (px: number, py: number) => {
    const gx = (px / size) * gridN;
    const gy = (py / size) * gridN;
    const x0 = Math.floor(gx) % gridN;
    const y0 = Math.floor(gy) % gridN;
    const x1 = (x0 + 1) % gridN;
    const y1 = (y0 + 1) % gridN;
    const tx = gx - Math.floor(gx);
    const ty = gy - Math.floor(gy);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const v00 = grid[y0 * gridN + x0];
    const v10 = grid[y0 * gridN + x1];
    const v01 = grid[y1 * gridN + x0];
    const v11 = grid[y1 * gridN + x1];
    const top = v00 + (v10 - v00) * sx;
    const bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sy;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const patch = sampleSmooth(x, y) * patchAmp;
      const fine = (rand() - 0.5) * 2 * grainAmp;
      const speck = rand() < speckleChance ? (rand() - 0.5) * grainAmp * 2.1 : 0;
      const delta = patch + fine + speck;

      const idx = (y * size + x) * 4;
      d[idx] = Math.max(0, Math.min(255, Math.round(baseRgb[0] + delta * 0.94)));
      d[idx + 1] = Math.max(0, Math.min(255, Math.round(baseRgb[1] + delta)));
      d[idx + 2] = Math.max(0, Math.min(255, Math.round(baseRgb[2] + delta * 0.88)));
      d[idx + 3] = 255;
    }
  }

  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Generates a warm, lively stylized grass pattern (#6ea33d) with soft painterly
 * tonal patches shifting cleanly between #639635 and #7cb347.
 */
export function createGrassPatternCanvas(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return c;

  const rand = mulberry32(seed);
  const img = g.createImageData(size, size);
  const d = img.data;

  const baseRgb: [number, number, number] = [110, 163, 61]; // #6ea33d
  const darkRgb: [number, number, number] = [99, 150, 53]; // #639635
  const lightRgb: [number, number, number] = [124, 179, 71]; // #7cb347

  const gridN = 6;
  const grid: number[] = [];
  for (let i = 0; i < gridN * gridN; i++) {
    grid.push((rand() - 0.5) * 2);
  }

  const sampleSmooth = (px: number, py: number) => {
    const gx = (px / size) * gridN;
    const gy = (py / size) * gridN;
    const x0 = Math.floor(gx) % gridN;
    const y0 = Math.floor(gy) % gridN;
    const x1 = (x0 + 1) % gridN;
    const y1 = (y0 + 1) % gridN;
    const tx = gx - Math.floor(gx);
    const ty = gy - Math.floor(gy);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const v00 = grid[y0 * gridN + x0];
    const v10 = grid[y0 * gridN + x1];
    const v01 = grid[y1 * gridN + x0];
    const v11 = grid[y1 * gridN + x1];
    const top = v00 + (v10 - v00) * sx;
    const bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sy;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = sampleSmooth(x, y); // -1..1
      const t = Math.max(-1, Math.min(1, m * 1.15));
      const target = t >= 0 ? lightRgb : darkRgb;
      const w = Math.abs(t);
      const fine = (rand() - 0.5) * 3.6;

      const idx = (y * size + x) * 4;
      d[idx] = Math.max(0, Math.min(255, Math.round(baseRgb[0] + (target[0] - baseRgb[0]) * w + fine * 0.85)));
      d[idx + 1] = Math.max(0, Math.min(255, Math.round(baseRgb[1] + (target[1] - baseRgb[1]) * w + fine)));
      d[idx + 2] = Math.max(0, Math.min(255, Math.round(baseRgb[2] + (target[2] - baseRgb[2]) * w + fine * 0.7)));
      d[idx + 3] = 255;
    }
  }

  g.putImageData(img, 0, 0);
  return c;
}

export function createProceduralTextures(ctx: CanvasRenderingContext2D): ProceduralTextures {
  const grassCanvas = createGrassPatternCanvas(256, 104729);
  const asphaltCanvas = createNoisePatternCanvas(128, [66, 72, 82], 3.6, 2.4, 224737, 0.08);
  const concreteCanvas = createNoisePatternCanvas(128, [214, 209, 198], 2.2, 2.8, 350377, 0.04);

  return {
    grassPattern: ctx.createPattern(grassCanvas, 'repeat'),
    asphaltPattern: ctx.createPattern(asphaltCanvas, 'repeat'),
    concretePattern: ctx.createPattern(concreteCanvas, 'repeat'),
  };
}

export function strokeContourSegments(
  ctx: CanvasRenderingContext2D,
  segments: readonly ParkingContourSegment[],
  color: string,
  lineWidth: number
) {
  if (segments.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    ctx.moveTo(s.u1, s.v1);
    ctx.lineTo(s.u2, s.v2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws crisp yellow-and-graphite (#facc15 / #262b33) diagonal warning hazard stripes
 * clipped neatly inside an isometric (u, v) rectangle.
 */
export function drawHazardStripeRect(
  ctx: CanvasRenderingContext2D,
  uMin: number,
  vMin: number,
  width: number,
  height: number,
  stripePitch = 6.5,
  stripeWidth = 3.0
) {
  if (width <= 0 || height <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(uMin, vMin, width, height);
  ctx.clip();

  // Deep graphite base
  ctx.fillStyle = GROUND_PALETTE.hazardGraphite;
  ctx.fillRect(uMin, vMin, width, height);

  // Sharp yellow diagonal warning bars
  ctx.strokeStyle = GROUND_PALETTE.hazardYellow;
  ctx.lineWidth = stripeWidth;
  ctx.beginPath();
  const span = width + height;
  for (let d = -height; d <= span; d += stripePitch) {
    ctx.moveTo(uMin + d, vMin - 2);
    ctx.lineTo(uMin + d - height - 4, vMin + height + 2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a crisp yellow-and-graphite hazard striped frame around a loading/unloading apron.
 */
export function drawHazardFrameBorder(
  ctx: CanvasRenderingContext2D,
  uMin: number,
  vMin: number,
  width: number,
  height: number,
  borderThickness = 3.6,
  stripePitch = 7.0
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(uMin, vMin, width, height);
  ctx.rect(
    uMin + borderThickness,
    vMin + borderThickness,
    Math.max(0, width - borderThickness * 2),
    Math.max(0, height - borderThickness * 2)
  );
  ctx.clip('evenodd');

  drawHazardStripeRect(ctx, uMin, vMin, width, height, stripePitch, stripePitch * 0.48);
  ctx.restore();

  // Sharp ink outlines along outer and inner edges of the hazard frame
  ctx.save();
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(uMin, vMin, width, height);
  ctx.lineWidth = 1.1;
  ctx.strokeRect(
    uMin + borderThickness,
    vMin + borderThickness,
    Math.max(0, width - borderThickness * 2),
    Math.max(0, height - borderThickness * 2)
  );
  ctx.restore();
}

export function disposeAtlasSheets(sheets: readonly HTMLCanvasElement[]) {
  for (let i = 0; i < sheets.length; i++) {
    sheets[i].width = 0;
    sheets[i].height = 0;
  }
}
