import type { Building } from '../types/building';
import type { RoadGraph } from '../types/roadGraph';
import {
  PARCEL_LOCKER_SLOTS,
  PROCEDURAL_DELIVERY_ZONES,
  PROCEDURAL_HOUSE_YARDS,
  PROCEDURAL_PARKING_LOTS,
  SPRITE_ATLAS_GUTTER,
  SPRITE_ATLAS_MAX_SIZE,
  type BuildingPrismPoints,
  type BuildingSpriteBounds,
  type DeliveryZone,
  type DepthSortedEntity,
  type FencePost3D,
  type FenceSegment3D,
  type HouseYardFence,
  type ParcelLockerSlot,
  type ParkingLot,
  type PrecomputedBuilding3D,
  type SpriteAtlasRectInput,
  type StaticScene3DItem,
  computeCenteredBuildingSpriteBounds,
  computeParkingLayout,
  getBuildingPalette,
  getBuildingPrismPoints,
  getBuildingSpriteArchetypeKey,
  getStaticScene3DOrder,
  mergeEntitiesIntoBackToFrontOrder,
  packSpritesIntoAtlasSheets,
} from './buildings';
import {
  type FenceSpriteAnchorBounds,
  computeCenteredFenceSpriteBounds,
  getFenceSegmentArchetypeKey,
} from './houseQuarters';
import type { ParkingNavNetwork } from './parkingNavigation';
import {
  ALL_STREETS,
  BASE_DEPOT,
  BUS_STATION,
  CITY_QUARTERS,
  CONCRETE_PLOTS,
  ISO_ORIGIN_X,
  ISO_ORIGIN_Y,
  MAP_HEIGHT,
  MAP_WIDTH,
  RESIDENTIAL_ACCESS_ROADS,
  ROUNDABOUTS,
  U_STREETS,
  V_STREETS,
  type BaseDepotSpec,
  type BaseParkingSpec,
  type BusStationSpec,
  type ConcretePlot,
  type IntersectionInfo,
  type ResidentialAccessRoad,
  type RoundaboutSpec,
  type StreetSpec,
  getAllIntersections,
  getRoundaboutAt,
  isPointInsideMap,
  isoToCanvas,
  rectOverlapsActiveStreet,
  rectOverlapsRoundabout,
  streetCoversValue,
} from './cityMap';
import {
  PARKING_GROUND_STYLE,
  type ParkingContourSegment,
  computeBaseParkingLayout,
  computeBaseParkingPerimeterSegments,
  computeParkingLotPerimeterSegments,
  computeRectPerimeterWithGaps,
  groupContiguousStallRuns,
} from './parkingLayout';

export interface ProceduralTextures {
  grassPattern: CanvasPattern | null;
  asphaltPattern: CanvasPattern | null;
  concretePattern: CanvasPattern | null;
}

const INTERSECTIONS: IntersectionInfo[] = getAllIntersections();

const GROUND_PALETTE = {
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

interface MeadowPatch {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
  color: string;
  alpha: number;
}

interface GrassTuft {
  x: number;
  y: number;
  scale: number;
  blades: 2 | 3;
  lean: number;
}

/** Deterministic PRNG for organic noise textures and grass detail placement */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoisePatternCanvas(
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
function createGrassPatternCanvas(size: number, seed: number): HTMLCanvasElement {
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

function isIsoPointOnConcretePlot(u: number, v: number, margin = 4): boolean {
  for (let i = 0; i < CONCRETE_PLOTS.length; i++) {
    const p = CONCRETE_PLOTS[i];
    if (
      u >= p.uMin - margin &&
      u <= p.uMax + margin &&
      v >= p.vMin - margin &&
      v <= p.vMax + margin
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministically generates soft large-scale tonal meadow patches across the map
 * to enrich the base grass pattern without introducing hard edges or repetition.
 */
function buildMeadowPatches(): MeadowPatch[] {
  const rand = mulberry32(418273);
  const patches: MeadowPatch[] = [];
  const count = 95;

  for (let i = 0; i < count; i++) {
    const x = rand() * MAP_WIDTH;
    const y = rand() * MAP_HEIGHT;
    const rx = 55 + rand() * 95;
    const ry = rx * (0.44 + rand() * 0.18);
    const rotation = (rand() - 0.5) * 0.5;
    const isLight = rand() > 0.48;
    patches.push({
      x,
      y,
      rx,
      ry,
      rotation,
      color: isLight ? GROUND_PALETTE.grassPatchLight : GROUND_PALETTE.grassPatchDark,
      alpha: 0.24 + rand() * 0.14,
    });
  }
  return patches;
}

/**
 * Deterministically scatters small stylized 2–3-blade grass tufts (#3d611e) on
 * residential yards, park lawns, and open green map edges (strictly avoiding
 * concrete quarters, roadways, sidewalks, and roundabouts).
 */
function buildGrassTufts(): GrassTuft[] {
  const rand = mulberry32(773921);
  const tufts: GrassTuft[] = [];

  const tryAddTuftAtIso = (u: number, v: number) => {
    const pt = isoToCanvas(u, v);
    if (!isPointInsideMap(pt, 10)) return;
    if (isIsoPointOnConcretePlot(u, v, 6)) return;
    if (rectOverlapsActiveStreet(u - 5, u + 5, v - 5, v + 5)) return;
    if (rectOverlapsRoundabout(u - 5, u + 5, v - 5, v + 5, 6)) return;

    tufts.push({
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      scale: 0.82 + rand() * 0.42,
      blades: rand() < 0.42 ? 2 : 3,
      lean: (rand() - 0.5) * 1.4,
    });
  };

  // 1. Lively clusters across all residential house quarters & open green parks
  for (const q of CITY_QUARTERS) {
    if (q.kind !== 'houses' && q.kind !== 'park') continue;
    const step = q.kind === 'park' ? 28 : 34;
    for (let u = q.uMin + 10; u <= q.uMax - 10; u += step) {
      for (let v = q.vMin + 10; v <= q.vMax - 10; v += step) {
        if (rand() > (q.kind === 'park' ? 0.68 : 0.56)) continue;
        const ju = u + (rand() - 0.5) * (step * 0.72);
        const jv = v + (rand() - 0.5) * (step * 0.72);
        tryAddTuftAtIso(ju, jv);
      }
    }
  }

  // 2. Sparse tufts across outer grassy map corners outside defined quarters
  const stepX = 76;
  const stepY = 58;
  for (let y = 18; y < MAP_HEIGHT - 18; y += stepY) {
    for (let x = 18; x < MAP_WIDTH - 18; x += stepX) {
      if (rand() > 0.36) continue;
      const px = x + (rand() - 0.5) * 44;
      const py = y + (rand() - 0.5) * 34;
      const dx = px - ISO_ORIGIN_X;
      const dy = py - ISO_ORIGIN_Y;
      const u = dx * 0.5 + dy;
      const v = dx * 0.5 - dy;
      // Avoid duplicating tufts inside quarters already populated above
      const inPopulatedQuarter = CITY_QUARTERS.some(
        (q) =>
          (q.kind === 'houses' || q.kind === 'park') &&
          u >= q.uMin &&
          u <= q.uMax &&
          v >= q.vMin &&
          v <= q.vMax
      );
      if (inPopulatedQuarter) continue;
      tryAddTuftAtIso(u, v);
    }
  }

  return tufts;
}

const MEADOW_PATCHES: MeadowPatch[] = buildMeadowPatches();
const GRASS_TUFTS: GrassTuft[] = buildGrassTufts();

function drawGrassTuft(ctx: CanvasRenderingContext2D, tuft: GrassTuft) {
  const { x, y, scale, blades, lean } = tuft;
  const h = 4.5 * scale;
  const spread = 3.2 * scale;

  // Soft ground base accent
  ctx.fillStyle = 'rgba(42, 68, 20, 0.24)';
  ctx.beginPath();
  ctx.ellipse(x, y + 0.6 * scale, 2.8 * scale, 1.0 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = GROUND_PALETTE.grassTuft;
  ctx.lineWidth = 1.25 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();

  // Left curving blade
  ctx.moveTo(x - 0.5 * scale, y);
  ctx.quadraticCurveTo(
    x - spread * 0.75 + lean * 0.4,
    y - h * 0.58,
    x - spread + lean * 0.6,
    y - h * 0.88
  );

  // Right curving blade
  ctx.moveTo(x + 0.5 * scale, y);
  ctx.quadraticCurveTo(
    x + spread * 0.72 + lean * 0.4,
    y - h * 0.55,
    x + spread * 0.96 + lean * 0.6,
    y - h * 0.84
  );

  // Optional central taller blade for 3-blade tufts
  if (blades === 3) {
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + lean * 0.35,
      y - h * 0.65,
      x + lean * 0.9,
      y - h * 1.12
    );
  }

  ctx.stroke();
}

function strokeContourSegments(
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
function drawHazardStripeRect(
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
function drawHazardFrameBorder(
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

function drawConcretePlot(
  ctx: CanvasRenderingContext2D,
  plot: ConcretePlot,
  concreteFill: CanvasPattern | string,
  baseDepot: BaseDepotSpec
) {
  const w = plot.uMax - plot.uMin;
  const h = plot.vMax - plot.vMin;

  // Flush warm architectural concrete slab spanning all the way to the sidewalk edge
  ctx.fillStyle = concreteFill;
  ctx.fillRect(plot.uMin, plot.vMin, w, h);

  // Crisp architectural expansion joint grid across the paved quarter
  ctx.save();
  ctx.strokeStyle = GROUND_PALETTE.concreteJoint;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  const step = 48;
  for (let u = plot.uMin + step; u < plot.uMax - 8; u += step) {
    ctx.moveTo(u, plot.vMin);
    ctx.lineTo(u, plot.vMax);
  }
  for (let v = plot.vMin + step; v < plot.vMax - 8; v += step) {
    ctx.moveTo(plot.uMin, v);
    ctx.lineTo(plot.uMax, v);
  }
  ctx.stroke();

  // Subtle light pavement highlight seam just inside the boundary
  ctx.strokeStyle = 'rgba(255, 252, 245, 0.5)';
  ctx.lineWidth = 1.1;
  ctx.strokeRect(plot.uMin + 1.8, plot.vMin + 1.8, w - 3.6, h - 3.6);

  // Sharp dark ink contour framing the concrete plot / BAZA yard
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = plot.isBaseYard ? 2.0 : 1.65;
  ctx.strokeRect(plot.uMin + 0.5, plot.vMin + 0.5, w - 1, h - 1);

  // Special logistics yard markings on the BAZA plot
  if (plot.isBaseYard) {
    const apronU = baseDepot.u - 42;
    const apronV = baseDepot.v - 38;
    const apronW = 86;
    const apronH = 76;

    // Darker industrial concrete apron under BAZA loading zone
    ctx.fillStyle = 'rgba(38, 43, 51, 0.14)';
    ctx.fillRect(apronU, apronV, apronW, apronH);

    // Bold yellow-and-graphite hazard warning frame around the BAZA loading/unloading apron
    drawHazardFrameBorder(ctx, apronU, apronV, apronW, apronH, 3.6, 7.2);

    // Crisp white loading bay dividers
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.82)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let offset = -22; offset <= 22; offset += 22) {
      ctx.moveTo(baseDepot.u + 22, baseDepot.v + offset);
      ctx.lineTo(baseDepot.u + 40, baseDepot.v + offset);
    }
    ctx.stroke();

    // Dedicated yellow-and-graphite hazard warning threshold strip directly along Base loadingZone dock edge
    const lz = baseDepot.loadingZone;
    const lzH = lz.vMax - lz.vMin;
    drawHazardStripeRect(ctx, lz.uMax - 3.6, lz.vMin, 3.6, lzH, 5.5, 2.6);
    ctx.strokeStyle = GROUND_PALETTE.inkOutline;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(lz.uMin, lz.vMin, lz.uMax - lz.uMin, lzH);
  }

  ctx.restore();
}

/**
 * Draws a sharp stylized isometric parking lot (warm curb, dark ink contour with open
 * driveway mouth, deep slate-graphite asphalt, and crisp white stall lines) in (u, v) space.
 */
function drawParkingLot(
  ctx: CanvasRenderingContext2D,
  lot: ParkingLot,
  asphaltFill: CanvasPattern | string
) {
  const uW = lot.uMax - lot.uMin;
  const vW = lot.vMax - lot.vMin;
  if (uW < 30 || vW < 30) return;

  ctx.save();

  // 1. Warm curb frame around parking tarmac
  ctx.fillStyle = PARKING_GROUND_STYLE.curbFill;
  ctx.fillRect(lot.uMin - 2.2, lot.vMin - 2.2, uW + 4.4, vW + 4.4);

  // 2. Subtle curb-drop shadow rim inside parking perimeter
  ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
  ctx.fillRect(lot.uMin, lot.vMin, uW, vW);

  // 3. Deep slate-graphite parking asphalt surface
  ctx.fillStyle = asphaltFill;
  ctx.fillRect(lot.uMin + 1.4, lot.vMin + 1.4, uW - 2.8, vW - 2.8);

  // 4. Sharp dark ink contours along both inner asphalt edge and outer curb edge (open at driveway mouth)
  const innerSegments = computeParkingLotPerimeterSegments(lot, 0);
  const outerSegments = computeParkingLotPerimeterSegments(lot, 2.2);
  strokeContourSegments(ctx, innerSegments, PARKING_GROUND_STYLE.inkDark, 1.55);
  strokeContourSegments(ctx, outerSegments, PARKING_GROUND_STYLE.inkOutline, 1.85);

  // 5. Crisp pure white isometric parking stall markings computed from shared layout
  const layout = computeParkingLayout(lot);

  ctx.strokeStyle = PARKING_GROUND_STYLE.stallLine;
  ctx.lineWidth = 1.55;
  ctx.lineCap = 'square';
  ctx.beginPath();

  const drawStallRow = (
    backCoord: number,
    openCoord: number,
    stalls: Array<{ start: number; end: number }>
  ) => {
    const runs = groupContiguousStallRuns(stalls);
    for (const run of runs) {
      if (layout.stallAxis === 'u') {
        ctx.moveTo(run.start, backCoord);
        ctx.lineTo(run.end, backCoord);
        for (let i = run.startIndex; i <= run.endIndex; i++) {
          const s = stalls[i];
          ctx.moveTo(s.start, backCoord);
          ctx.lineTo(s.start, openCoord);
        }
        ctx.moveTo(run.end, backCoord);
        ctx.lineTo(run.end, openCoord);
      } else {
        ctx.moveTo(backCoord, run.start);
        ctx.lineTo(backCoord, run.end);
        for (let i = run.startIndex; i <= run.endIndex; i++) {
          const s = stalls[i];
          ctx.moveTo(backCoord, s.start);
          ctx.lineTo(openCoord, s.start);
        }
        ctx.moveTo(backCoord, run.end);
        ctx.lineTo(openCoord, run.end);
      }
    }
  };

  for (const row of layout.outerRows) {
    drawStallRow(row.backCoord, row.openCoord, row.stalls);
  }

  ctx.stroke();

  // 6. Central back-to-back double-row island on larger parking lots
  if (layout.centerIsland) {
    const ci = layout.centerIsland;

    ctx.fillStyle = PARKING_GROUND_STYLE.islandFill;
    ctx.strokeStyle = PARKING_GROUND_STYLE.inkOutline;
    ctx.lineWidth = 1.25;
    if (layout.stallAxis === 'u') {
      ctx.fillRect(ci.alongMin, ci.spineCoord - 1.8, ci.alongMax - ci.alongMin, 3.6);
      ctx.strokeRect(ci.alongMin, ci.spineCoord - 1.8, ci.alongMax - ci.alongMin, 3.6);
    } else {
      ctx.fillRect(ci.spineCoord - 1.8, ci.alongMin, 3.6, ci.alongMax - ci.alongMin);
      ctx.strokeRect(ci.spineCoord - 1.8, ci.alongMin, 3.6, ci.alongMax - ci.alongMin);
    }

    ctx.strokeStyle = PARKING_GROUND_STYLE.stallLine;
    ctx.lineWidth = 1.55;
    ctx.beginPath();
    drawStallRow(ci.spineCoord - 1.8, ci.rowAMin, ci.stalls);
    drawStallRow(ci.spineCoord + 1.8, ci.rowBMax, ci.stalls);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws the BAZA dedicated fleet parking lot directly from baseDepot.parking
 * with sharp dark ink contours, crisp white stalls, and yellow-graphite wheel-stop bars.
 */
function drawBaseParking(
  ctx: CanvasRenderingContext2D,
  parking: BaseParkingSpec,
  asphaltFill: CanvasPattern | string
) {
  if (parking.spots.length === 0 || parking.uMax <= parking.uMin || parking.vMax <= parking.vMin) {
    return;
  }

  const uW = parking.uMax - parking.uMin;
  const vW = parking.vMax - parking.vMin;
  const layout = computeBaseParkingLayout(parking);

  ctx.save();

  // 1. Warm curb border
  ctx.fillStyle = PARKING_GROUND_STYLE.curbFill;
  ctx.fillRect(parking.uMin - 2.2, parking.vMin - 2.2, uW + 4.4, vW + 4.4);

  // 2. Curb-step inner shadow + deep slate-graphite parking tarmac
  ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
  ctx.fillRect(parking.uMin, parking.vMin, uW, vW);

  ctx.fillStyle = asphaltFill;
  ctx.fillRect(parking.uMin + 1.4, parking.vMin + 1.4, uW - 2.8, vW - 2.8);

  // 3. Sharp dark ink contours around parking lot (cleanly open at internal connector mouth)
  const innerSegments = computeBaseParkingPerimeterSegments(parking, 0);
  const outerSegments = computeBaseParkingPerimeterSegments(parking, 2.2);
  strokeContourSegments(ctx, innerSegments, PARKING_GROUND_STYLE.inkDark, 1.55);
  strokeContourSegments(ctx, outerSegments, PARKING_GROUND_STYLE.inkOutline, 1.9);

  // 4. Crisp white stall lines for each active row (Row 0: spots 1–4; Row 1: spots 5–8)
  ctx.strokeStyle = PARKING_GROUND_STYLE.stallLine;
  ctx.lineWidth = 1.65;
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (const row of layout.rows) {
    if (row.spots.length === 0) continue;
    const rowStartU = row.spots[0].uMin;
    const rowEndU = row.spots[row.spots.length - 1].uMax;

    // Back curb line spanning the unlocked spots in this row
    ctx.moveTo(rowStartU, row.backCoord);
    ctx.lineTo(rowEndU, row.backCoord);

    // Individual stall divider lines
    for (const spot of row.spots) {
      ctx.moveTo(spot.uMin, row.openCoord);
      ctx.lineTo(spot.uMin, row.backCoord);
    }
    ctx.moveTo(rowEndU, row.openCoord);
    ctx.lineTo(rowEndU, row.backCoord);
  }
  ctx.stroke();

  // 5. Crisp yellow-and-graphite safety stop strips along the back edge of each active fleet row
  for (const row of layout.rows) {
    if (row.spots.length === 0) continue;
    const rowStartU = row.spots[0].uMin;
    const rowEndU = row.spots[row.spots.length - 1].uMax;
    const stripH = 2.8;
    const stripV = row.row === 0 ? row.backCoord - stripH - 1.2 : row.backCoord + 1.2;
    drawHazardStripeRect(ctx, rowStartU + 1.5, stripV, rowEndU - rowStartU - 3, stripH, 5.5, 2.6);
    ctx.strokeStyle = PARKING_GROUND_STYLE.inkOutline;
    ctx.lineWidth = 0.95;
    ctx.strokeRect(rowStartU + 1.5, stripV, rowEndU - rowStartU - 3, stripH);
  }

  ctx.restore();
}

/**
 * Draws the Central Bus Station ground infrastructure in isometric (u, v) coordinates
 * with sharp ink contours, deep slate asphalt, white bus bays, and crisp yellow-graphite stops.
 */
function drawBusStationSurface(
  ctx: CanvasRenderingContext2D,
  station: BusStationSpec,
  asphaltFill: CanvasPattern | string
) {
  ctx.save();

  // 1. Asphalt bus parking & maneuvering yard
  const yard = station.asphaltYard;
  const yW = yard.uMax - yard.uMin;
  const yH = yard.vMax - yard.vMin;

  // Warm curb frame around the asphalt bus yard
  ctx.fillStyle = PARKING_GROUND_STYLE.curbFill;
  ctx.fillRect(yard.uMin - 2.4, yard.vMin - 2.4, yW + 4.8, yH + 4.8);

  // Subtle curb-step drop shadow + deep slate-graphite asphalt tarmac
  ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
  ctx.fillRect(yard.uMin, yard.vMin, yW, yH);

  ctx.fillStyle = asphaltFill;
  ctx.fillRect(yard.uMin + 1.5, yard.vMin + 1.5, yW - 3.0, yH - 3.0);

  // Sharp dark ink contours around yard perimeter (open at separate Entry & Exit driveway mouths)
  const drivewayGaps = [
    {
      side: 'vMin' as const,
      min: station.entryDriveway.uMin,
      max: station.entryDriveway.uMax,
    },
    {
      side: 'vMin' as const,
      min: station.exitDriveway.uMin,
      max: station.exitDriveway.uMax,
    },
  ];
  const innerYardContour = computeRectPerimeterWithGaps(
    yard.uMin,
    yard.uMax,
    yard.vMin,
    yard.vMax,
    drivewayGaps
  );
  const outerYardContour = computeRectPerimeterWithGaps(
    yard.uMin - 2.4,
    yard.uMax + 2.4,
    yard.vMin - 2.4,
    yard.vMax + 2.4,
    drivewayGaps
  );
  strokeContourSegments(ctx, innerYardContour, PARKING_GROUND_STYLE.inkDark, 1.6);
  strokeContourSegments(ctx, outerYardContour, PARKING_GROUND_STYLE.inkOutline, 1.9);

  // 2. 6 oversized bus parking bays (23 x 48) clearly nested between Entry & Exit lanes
  if (station.busBays.length > 0) {
    const first = station.busBays[0];
    const last = station.busBays[station.busBays.length - 1];

    // Subtle darkened tarmac pad under the 6 bus bays
    ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
    ctx.fillRect(first.uMin, first.vMin, last.uMax - first.uMin, first.vMax - first.vMin);

    // Crisp pure white stall dividers (open toward +v maneuvering aisle)
    ctx.strokeStyle = PARKING_GROUND_STYLE.stallLine;
    ctx.lineWidth = 1.85;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(first.uMin, first.vMin);
    ctx.lineTo(last.uMax, first.vMin);
    for (const bay of station.busBays) {
      ctx.moveTo(bay.uMin, bay.vMin);
      ctx.lineTo(bay.uMin, bay.vMax);
    }
    ctx.moveTo(last.uMax, last.vMin);
    ctx.lineTo(last.uMax, last.vMax);
    ctx.stroke();

    // Crisp yellow-and-graphite wheel-stop hazard strips inside each bus bay
    for (const bay of station.busBays) {
      drawHazardStripeRect(
        ctx,
        bay.uMin + 2.6,
        bay.vMin + 3.0,
        bay.uMax - bay.uMin - 5.2,
        3.2,
        5.5,
        2.5
      );
      ctx.strokeStyle = PARKING_GROUND_STYLE.inkOutline;
      ctx.lineWidth = 0.9;
      ctx.strokeRect(bay.uMin + 2.6, bay.vMin + 3.0, bay.uMax - bay.uMin - 5.2, 3.2);
    }
  }

  // 3. Bus circulation lane divider separating bay maneuvering aisle & platform pull-through lane
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.78)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(yard.uMin + 24, 156);
  ctx.lineTo(yard.uMax - 24, 156);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4. Crisp painted road directional arrows for Entry (+v into yard) & Exit (-v onto al. Dworcowa)
  const drawDirectionalArrow = (cx: number, cy: number, dirV: 1 | -1, color: string) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - dirV * 11);
    ctx.lineTo(cx, cy + dirV * 8);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy + dirV * 13);
    ctx.lineTo(cx - 6.5, cy + dirV * 4);
    ctx.lineTo(cx + 6.5, cy + dirV * 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const entryCenterU = (station.entryDriveway.uMin + station.entryDriveway.uMax) / 2;
  const exitCenterU = (station.exitDriveway.uMin + station.exitDriveway.uMax) / 2;
  drawDirectionalArrow(entryCenterU, 82, 1, GROUND_PALETTE.markingWhite);
  drawDirectionalArrow(exitCenterU, 82, -1, GROUND_PALETTE.markingYellow);

  // Horizontal circulation flow arrow along the platform pull-through lane (+u toward Exit)
  ctx.save();
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  const flowU = (yard.uMin + yard.uMax) / 2;
  const flowV = 180;
  ctx.beginPath();
  ctx.moveTo(flowU - 14, flowV);
  ctx.lineTo(flowU + 8, flowV);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(flowU + 15, flowV);
  ctx.lineTo(flowU + 5, flowV - 6);
  ctx.lineTo(flowU + 5, flowV + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/**
 * Draws a dedicated side loading/delivery zone (Strefa Dostaw) with sharp ink contour,
 * deep graphite tarmac, bold yellow-and-graphite warning stripes, and stylized parcel icon.
 */
function drawDeliveryZone(ctx: CanvasRenderingContext2D, zone: DeliveryZone) {
  const { bay, driveway, entryDir } = zone;
  const w = bay.uMax - bay.uMin;
  const h = bay.vMax - bay.vMin;
  if (w < 12 || h < 12) return;

  ctx.save();

  // 1. Warm curb edging around the loading bay
  ctx.fillStyle = PARKING_GROUND_STYLE.curbFill;
  ctx.fillRect(bay.uMin - 2.0, bay.vMin - 2.0, w + 4.0, h + 4.0);

  // 2. Dark graphite loading-bay tarmac
  ctx.fillStyle = PARKING_GROUND_STYLE.asphaltInnerShade;
  ctx.fillRect(bay.uMin, bay.vMin, w, h);

  // 3. Sharp yellow-and-graphite diagonal hazard stripes framing the loading zone
  drawHazardFrameBorder(ctx, bay.uMin + 1.0, bay.vMin + 1.0, w - 2.0, h - 2.0, 3.4, 6.4);

  // Subtle diagonal safety hatching inside the central bay pad
  ctx.save();
  ctx.beginPath();
  ctx.rect(bay.uMin + 4.6, bay.vMin + 4.6, Math.max(0, w - 9.2), Math.max(0, h - 9.2));
  ctx.clip();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.34)';
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  const span = w + h;
  for (let d = -h; d <= span; d += 7) {
    ctx.moveTo(bay.uMin + d, bay.vMin);
    ctx.lineTo(bay.uMin + d - h, bay.vMax);
  }
  ctx.stroke();
  ctx.restore();

  // 4. Sharp dark ink outer contour (open where driveway enters the loading bay)
  const entrySide =
    entryDir.u > 0.5
      ? ('uMin' as const)
      : entryDir.u < -0.5
        ? ('uMax' as const)
        : entryDir.v > 0.5
          ? ('vMin' as const)
          : ('vMax' as const);
  const gap =
    entrySide === 'uMin' || entrySide === 'uMax'
      ? { side: entrySide, min: driveway.vMin, max: driveway.vMax }
      : { side: entrySide, min: driveway.uMin, max: driveway.uMax };

  const outerContour = computeRectPerimeterWithGaps(
    bay.uMin - 2.0,
    bay.uMax + 2.0,
    bay.vMin - 2.0,
    bay.vMax + 2.0,
    [gap]
  );
  strokeContourSegments(ctx, outerContour, PARKING_GROUND_STYLE.inkOutline, 1.8);

  // 5. Central graphite badge with crisp stylized parcel/delivery symbol + entry direction chevron
  const cu = (bay.uMin + bay.uMax) * 0.5;
  const cv = (bay.vMin + bay.vMax) * 0.5;

  ctx.fillStyle = PARKING_GROUND_STYLE.hazardGraphite;
  ctx.fillRect(cu - 6.8, cv - 6.8, 13.6, 13.6);
  ctx.strokeStyle = GROUND_PALETTE.hazardYellow;
  ctx.lineWidth = 1.45;
  ctx.strokeRect(cu - 6.8, cv - 6.8, 13.6, 13.6);

  // Stylized parcel box (crisp cross-taped carton icon)
  ctx.fillStyle = '#fde047';
  ctx.fillRect(cu - 4.0, cv - 4.0, 8.0, 8.0);
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(cu - 4.0, cv - 4.0, 8.0, 8.0);
  ctx.beginPath();
  ctx.moveTo(cu - 4.0, cv);
  ctx.lineTo(cu + 4.0, cv);
  ctx.moveTo(cu, cv - 4.0);
  ctx.lineTo(cu, cv + 4.0);
  ctx.stroke();

  // Sharp yellow directional chevron near the driveway entry side pointing into the bay
  const chevU = cu - entryDir.u * Math.min(w * 0.32, 11);
  const chevV = cv - entryDir.v * Math.min(h * 0.32, 11);
  const perpU = -entryDir.v;
  const perpV = entryDir.u;
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(chevU - entryDir.u * 2.5 + perpU * 4.2, chevV - entryDir.v * 2.5 + perpV * 4.2);
  ctx.lineTo(chevU + entryDir.u * 2.5, chevV + entryDir.v * 2.5);
  ctx.lineTo(chevU - entryDir.u * 2.5 - perpU * 4.2, chevV - entryDir.v * 2.5 - perpV * 4.2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws a crisp cobblestone paver pad reserving space for a future parcel locker
 * with a clean dark ink contour matching the stylized ground treatment.
 */
function drawParcelLockerSlot(ctx: CanvasRenderingContext2D, slot: ParcelLockerSlot) {
  const uW = slot.uMax - slot.uMin;
  const vW = slot.vMax - slot.vMin;

  ctx.save();

  // Outer stone edging + sharp ink contour
  ctx.fillStyle = '#8b939c';
  ctx.fillRect(slot.uMin - 1.3, slot.vMin - 1.3, uW + 2.6, vW + 2.6);

  // Darker textured cobblestone/paver slab contrasting cleanly with warm concrete
  ctx.fillStyle = '#9aa2ab';
  ctx.fillRect(slot.uMin, slot.vMin, uW, vW);

  // Fine cobblestone paver joint pattern
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.32)';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  const pitch = 4.5;
  for (let u = slot.uMin + pitch; u < slot.uMax - 1; u += pitch) {
    ctx.moveTo(u, slot.vMin);
    ctx.lineTo(u, slot.vMax);
  }
  for (let v = slot.vMin + pitch; v < slot.vMax - 1; v += pitch) {
    ctx.moveTo(slot.uMin, v);
    ctx.lineTo(slot.uMax, v);
  }
  ctx.stroke();

  // Sharp ink outer border
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(slot.uMin - 1.0, slot.vMin - 1.0, uW + 2.0, vW + 2.0);

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.35;
  const tick = 3.2;
  ctx.beginPath();
  // 4 subtle corner brackets indicating reserved build pad
  ctx.moveTo(slot.uMin + 1.5, slot.vMin + 1.5 + tick);
  ctx.lineTo(slot.uMin + 1.5, slot.vMin + 1.5);
  ctx.lineTo(slot.uMin + 1.5 + tick, slot.vMin + 1.5);

  ctx.moveTo(slot.uMax - 1.5 - tick, slot.vMin + 1.5);
  ctx.lineTo(slot.uMax - 1.5, slot.vMin + 1.5);
  ctx.lineTo(slot.uMax - 1.5, slot.vMin + 1.5 + tick);

  ctx.moveTo(slot.uMax - 1.5, slot.vMax - 1.5 - tick);
  ctx.lineTo(slot.uMax - 1.5, slot.vMax - 1.5);
  ctx.lineTo(slot.uMax - 1.5 - tick, slot.vMax - 1.5);

  ctx.moveTo(slot.uMin + 1.5 + tick, slot.vMax - 1.5);
  ctx.lineTo(slot.uMin + 1.5, slot.vMax - 1.5);
  ctx.lineTo(slot.uMin + 1.5, slot.vMax - 1.5 - tick);
  ctx.stroke();

  ctx.restore();
}

function drawAccessRoadStrip(
  ctx: CanvasRenderingContext2D,
  road: ResidentialAccessRoad,
  halfWidth: number
) {
  if (road.axis === 'u') {
    ctx.fillRect(
      road.coord - halfWidth,
      road.startCoord,
      halfWidth * 2,
      road.endCoord - road.startCoord
    );
  } else {
    ctx.fillRect(
      road.startCoord,
      road.coord - halfWidth,
      road.endCoord - road.startCoord,
      halfWidth * 2
    );
  }
}

function drawAccessRoadSidewalkJoints(
  ctx: CanvasRenderingContext2D,
  road: ResidentialAccessRoad
) {
  const startStreet = ALL_STREETS.find((s) => s.id === road.startStreetId);
  const endStreet = ALL_STREETS.find((s) => s.id === road.endStreetId);
  const trimStart = startStreet ? startStreet.asphaltWidth / 2 + startStreet.sidewalkWidth + 3 : 24;
  const trimEnd = endStreet ? endStreet.asphaltWidth / 2 + endStreet.sidewalkWidth + 3 : 24;
  const a = road.startCoord + trimStart;
  const b = road.endCoord - trimEnd;
  if (b - a < 16) return;

  const outerHalf = road.asphaltWidth / 2 + road.sidewalkWidth;
  const innerHalf = road.asphaltWidth / 2 + 2.2;
  const pitch = 11;

  ctx.save();
  ctx.strokeStyle = GROUND_PALETTE.sidewalkJoint;
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  for (let t = Math.ceil(a / pitch) * pitch; t <= b; t += pitch) {
    if (road.axis === 'u') {
      ctx.moveTo(road.coord - outerHalf, t);
      ctx.lineTo(road.coord - innerHalf, t);
      ctx.moveTo(road.coord + innerHalf, t);
      ctx.lineTo(road.coord + outerHalf, t);
    } else {
      ctx.moveTo(t, road.coord - outerHalf);
      ctx.lineTo(t, road.coord - innerHalf);
      ctx.moveTo(t, road.coord + innerHalf);
      ctx.lineTo(t, road.coord + outerHalf);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawAccessRoadMarkings(ctx: CanvasRenderingContext2D, road: ResidentialAccessRoad) {
  const startStreet = ALL_STREETS.find((s) => s.id === road.startStreetId);
  const endStreet = ALL_STREETS.find((s) => s.id === road.endStreetId);
  const trimStart = startStreet ? startStreet.asphaltWidth / 2 + startStreet.sidewalkWidth + 8 : 28;
  const trimEnd = endStreet ? endStreet.asphaltWidth / 2 + endStreet.sidewalkWidth + 8 : 28;
  const a = road.startCoord + trimStart;
  const b = road.endCoord - trimEnd;
  if (b - a < 24) return;

  ctx.save();
  // Crisp white dashed 2-lane centerline for narrow residential street
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.86)';
  ctx.lineWidth = 1.3;
  ctx.setLineDash([8, 9]);
  ctx.beginPath();
  if (road.axis === 'u') {
    ctx.moveTo(road.coord, a);
    ctx.lineTo(road.coord, b);
  } else {
    ctx.moveTo(a, road.coord);
    ctx.lineTo(b, road.coord);
  }
  ctx.stroke();

  // Crisp white yield/stop bars at both T-junction exits
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(248, 250, 252, 0.86)';
  const halfBar = road.asphaltWidth / 2 - 2.8;
  if (road.axis === 'u') {
    ctx.fillRect(road.coord - halfBar, a - 4, halfBar * 2, 1.9);
    ctx.fillRect(road.coord - halfBar, b + 2.2, halfBar * 2, 1.9);
  } else {
    ctx.fillRect(a - 4, road.coord - halfBar, 1.9, halfBar * 2);
    ctx.fillRect(b + 2.2, road.coord - halfBar, 1.9, halfBar * 2);
  }

  ctx.restore();
}

function drawStreetStrip(
  ctx: CanvasRenderingContext2D,
  street: StreetSpec,
  halfWidth: number
) {
  for (const [sMin, sMax] of street.spans) {
    if (street.axis === 'u') {
      // Fixed u, spans along v
      ctx.fillRect(street.coord - halfWidth, sMin, halfWidth * 2, sMax - sMin);
    } else {
      // Fixed v, spans along u
      ctx.fillRect(sMin, street.coord - halfWidth, sMax - sMin, halfWidth * 2);
    }
  }
}

/**
 * Computes clear open intervals along a street's sidewalks between cross-street sidewalks
 * and roundabouts so paving slab division lines stop cleanly before corner aprons.
 */
function getClearSidewalkIntervals(
  street: StreetSpec,
  spanMin: number,
  spanMax: number
): Array<[number, number]> {
  const blocked: Array<[number, number]> = [];
  const crossStreets = street.axis === 'u' ? V_STREETS : U_STREETS;

  for (const cross of crossStreets) {
    if (cross.coord < spanMin - 120 || cross.coord > spanMax + 120) continue;
    if (!streetCoversValue(cross, street.coord)) continue;

    const u = street.axis === 'u' ? street.coord : cross.coord;
    const v = street.axis === 'u' ? cross.coord : street.coord;
    const rb = getRoundaboutAt(u, v);

    if (rb) {
      const clearDist = rb.outerSidewalkRadius + 2;
      blocked.push([cross.coord - clearDist, cross.coord + clearDist]);
    } else {
      const clearDist = cross.asphaltWidth / 2 + cross.sidewalkWidth + 2;
      blocked.push([cross.coord - clearDist, cross.coord + clearDist]);
    }
  }

  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    if (ar.startStreetId === street.id || ar.endStreetId === street.id) {
      const arHalf = ar.asphaltWidth / 2 + ar.sidewalkWidth + 2;
      blocked.push([ar.coord - arHalf, ar.coord + arHalf]);
    }
  }

  if (street.axis === 'u' && Math.abs(street.coord - BASE_DEPOT.exitU) < 1) {
    const dHalf = BASE_DEPOT.drivewayAsphaltWidth / 2 + BASE_DEPOT.drivewaySidewalkWidth + 2;
    blocked.push([BASE_DEPOT.exitV - dHalf, BASE_DEPOT.exitV + dHalf]);
  }

  blocked.sort((a, b) => a[0] - b[0]);

  const intervals: Array<[number, number]> = [];
  let cursor = spanMin;
  for (const [bMin, bMax] of blocked) {
    if (bMin > cursor + 8) {
      intervals.push([cursor, Math.min(bMin, spanMax)]);
    }
    cursor = Math.max(cursor, bMax);
  }
  if (spanMax > cursor + 8) {
    intervals.push([cursor, spanMax]);
  }
  return intervals;
}

/**
 * Draws crisp paving-slab joints across both warm cream-sand sidewalks of a street,
 * plus subtle longitudinal curb-stone backing lines.
 */
function drawStreetSidewalkJoints(ctx: CanvasRenderingContext2D, street: StreetSpec) {
  const outerHalf = street.asphaltWidth / 2 + street.sidewalkWidth;
  const curbLineHalf = street.asphaltWidth / 2 + 3.0;
  const pitch = street.kind === 'avenue' ? 14 : 12;

  ctx.save();
  ctx.strokeStyle = GROUND_PALETTE.sidewalkJoint;
  ctx.lineWidth = 0.9;
  ctx.beginPath();

  for (const [sMin, sMax] of street.spans) {
    const intervals = getClearSidewalkIntervals(street, sMin, sMax);
    for (const [a, b] of intervals) {
      // Longitudinal inner curbstone joint separating curb blocks from sidewalk slabs
      if (street.axis === 'u') {
        ctx.moveTo(street.coord - curbLineHalf, a);
        ctx.lineTo(street.coord - curbLineHalf, b);
        ctx.moveTo(street.coord + curbLineHalf, a);
        ctx.lineTo(street.coord + curbLineHalf, b);
      } else {
        ctx.moveTo(a, street.coord - curbLineHalf);
        ctx.lineTo(b, street.coord - curbLineHalf);
        ctx.moveTo(a, street.coord + curbLineHalf);
        ctx.lineTo(b, street.coord + curbLineHalf);
      }

      // Perpendicular sidewalk paving slab division joints
      const firstTick = Math.ceil(a / pitch) * pitch;
      for (let t = firstTick; t <= b; t += pitch) {
        if (street.axis === 'u') {
          ctx.moveTo(street.coord - outerHalf, t);
          ctx.lineTo(street.coord - curbLineHalf, t);
          ctx.moveTo(street.coord + curbLineHalf, t);
          ctx.lineTo(street.coord + outerHalf, t);
        } else {
          ctx.moveTo(t, street.coord - outerHalf);
          ctx.lineTo(t, street.coord - curbLineHalf);
          ctx.moveTo(t, street.coord + curbLineHalf);
          ctx.lineTo(t, street.coord + outerHalf);
        }
      }
    }
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Draws neat radial sidewalk paving-slab joints around a roundabout's outer sidewalk ring,
 * skipping the 4 straight avenue approach mouths.
 */
function drawRoundaboutSidewalkJoints(ctx: CanvasRenderingContext2D, rb: RoundaboutSpec) {
  const innerR = rb.outerAsphaltRadius + 2.8;
  const outerR = rb.outerSidewalkRadius;
  const stepAngle = Math.PI / 18; // every 10 deg
  const approachHalfAngle = Math.asin(Math.min(0.95, 34 / innerR));

  ctx.save();
  ctx.strokeStyle = GROUND_PALETTE.sidewalkJoint;
  ctx.lineWidth = 0.9;
  ctx.beginPath();

  for (let k = 0; k < 36; k++) {
    const theta = k * stepAngle;
    // Skip angles overlapping the 4 cardinal avenue entries (0, pi/2, pi, 3pi/2)
    const modQuarter = theta % (Math.PI / 2);
    const distToCardinal = Math.min(modQuarter, Math.PI / 2 - modQuarter);
    if (distToCardinal < approachHalfAngle) continue;

    const c = Math.cos(theta);
    const s = Math.sin(theta);
    ctx.moveTo(rb.u + c * innerR, rb.v + s * innerR);
    ctx.lineTo(rb.u + c * outerR, rb.v + s * outerR);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Computes clear open intervals along a street between intersections & roundabouts
 * so lane markings stop cleanly before crosswalks and circular rings.
 */
function getClearMarkingIntervals(
  street: StreetSpec,
  spanMin: number,
  spanMax: number
): Array<[number, number]> {
  const blocked: Array<[number, number]> = [];
  const crossStreets = street.axis === 'u' ? V_STREETS : U_STREETS;

  for (const cross of crossStreets) {
    if (cross.coord < spanMin - 120 || cross.coord > spanMax + 120) continue;
    if (!streetCoversValue(cross, street.coord)) continue;

    const u = street.axis === 'u' ? street.coord : cross.coord;
    const v = street.axis === 'u' ? cross.coord : street.coord;
    const rb = getRoundaboutAt(u, v);

    if (rb) {
      // Clear out to outside of roundabout approach crosswalk
      const clearDist = rb.outerSidewalkRadius + 30;
      blocked.push([cross.coord - clearDist, cross.coord + clearDist]);
    } else {
      // Clear out past cross-street sidewalk + zebra crosswalk
      const clearDist = cross.asphaltWidth / 2 + cross.sidewalkWidth + 24;
      blocked.push([cross.coord - clearDist, cross.coord + clearDist]);
    }
  }

  // Also leave a tiny neat gap where BAZA driveway joins Central Main Avenue
  if (street.axis === 'u' && Math.abs(street.coord - BASE_DEPOT.exitU) < 1) {
    const dHalf = BASE_DEPOT.drivewayAsphaltWidth / 2 + 4;
    blocked.push([BASE_DEPOT.exitV - dHalf, BASE_DEPOT.exitV + dHalf]);
  }

  // Leave clean T-junction marking gaps where residential access roads join bordering streets
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    if (ar.startStreetId === street.id || ar.endStreetId === street.id) {
      const arHalf = ar.asphaltWidth / 2 + ar.sidewalkWidth + 6;
      blocked.push([ar.coord - arHalf, ar.coord + arHalf]);
    }
  }

  blocked.sort((a, b) => a[0] - b[0]);

  const intervals: Array<[number, number]> = [];
  let cursor = spanMin;
  for (const [bMin, bMax] of blocked) {
    if (bMin > cursor + 8) {
      intervals.push([cursor, Math.min(bMin, spanMax)]);
    }
    cursor = Math.max(cursor, bMax);
  }
  if (spanMax > cursor + 8) {
    intervals.push([cursor, spanMax]);
  }
  return intervals;
}

function drawStormDrainGrate(
  ctx: CanvasRenderingContext2D,
  centerU: number,
  centerV: number,
  axis: 'u' | 'v'
) {
  const len = 6.2;
  const thick = 3.2;
  const w = axis === 'u' ? thick : len;
  const h = axis === 'u' ? len : thick;
  const x0 = centerU - w * 0.5;
  const y0 = centerV - h * 0.5;

  // Recessed iron drain pit + sharp dark ink border
  ctx.fillStyle = '#202630';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.05;
  ctx.strokeRect(x0, y0, w, h);

  // Crisp metallic grate bars
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  if (axis === 'u') {
    for (let dy = 1.4; dy < h - 0.8; dy += 1.55) {
      ctx.moveTo(x0 + 0.5, y0 + dy);
      ctx.lineTo(x0 + w - 0.5, y0 + dy);
    }
  } else {
    for (let dx = 1.4; dx < w - 0.8; dx += 1.55) {
      ctx.moveTo(x0 + dx, y0 + 0.5);
      ctx.lineTo(x0 + dx, y0 + h - 0.5);
    }
  }
  ctx.stroke();
}

function drawManholeCover(ctx: CanvasRenderingContext2D, u: number, v: number) {
  const r = 3.1;

  // Outer cast-iron ring with sharp ink contour
  ctx.fillStyle = '#525b68';
  ctx.beginPath();
  ctx.arc(u, v, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Inner concentric cast-iron detail ring & cross-ribs
  ctx.strokeStyle = '#2a303a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(u, v, r * 0.62, 0, Math.PI * 2);
  ctx.moveTo(u - r * 0.45, v);
  ctx.lineTo(u + r * 0.45, v);
  ctx.moveTo(u, v - r * 0.45);
  ctx.lineTo(u, v + r * 0.45);
  ctx.stroke();
}

/**
 * Draws crisp deterministic roadside storm drain grates along curbs and sparse
 * cast-iron manhole covers on clear street intervals (never overlapping crosswalks).
 */
function drawStreetCurbDetails(ctx: CanvasRenderingContext2D, street: StreetSpec) {
  const halfAsphalt = street.asphaltWidth / 2;
  const drainOffset = halfAsphalt - 3.3;
  const manholeOffset = street.kind === 'avenue' ? halfAsphalt * 0.28 : halfAsphalt * 0.34;
  const drainSpacing = 148;

  ctx.save();
  for (const [sMin, sMax] of street.spans) {
    const intervals = getClearMarkingIntervals(street, sMin, sMax);
    for (const [a, b] of intervals) {
      const spanLen = b - a;
      if (spanLen < 42) continue;

      const startPos = a + 20;
      const endPos = b - 20;

      // Curbside storm drains on both edges of the street
      for (let pos = startPos; pos <= endPos; pos += drainSpacing) {
        if (street.axis === 'u') {
          drawStormDrainGrate(ctx, street.coord - drainOffset, pos, 'u');
          drawStormDrainGrate(ctx, street.coord + drainOffset, pos, 'u');
        } else {
          drawStormDrainGrate(ctx, pos, street.coord - drainOffset, 'v');
          drawStormDrainGrate(ctx, pos, street.coord + drainOffset, 'v');
        }
      }

      // Sparse cast-iron manhole cover near midpoint of longer street segments
      if (spanLen >= 110) {
        const mid = (a + b) * 0.5;
        const sideSign = ((Math.round(street.coord + mid) & 1) === 0 ? 1 : -1);
        if (street.axis === 'u') {
          drawManholeCover(ctx, street.coord + sideSign * manholeOffset, mid);
        } else {
          drawManholeCover(ctx, mid, street.coord + sideSign * manholeOffset);
        }
      }
    }
  }
  ctx.restore();
}

function drawStreetMarkings(ctx: CanvasRenderingContext2D, street: StreetSpec) {
  const halfAsphalt = street.asphaltWidth / 2;

  for (const [sMin, sMax] of street.spans) {
    const intervals = getClearMarkingIntervals(street, sMin, sMax);
    if (intervals.length === 0) continue;

    // 1. Subtle crisp white shoulder edge lines
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.36)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    const shoulder = halfAsphalt - 2.9;
    for (const [a, b] of intervals) {
      if (street.axis === 'u') {
        ctx.moveTo(street.coord - shoulder, a);
        ctx.lineTo(street.coord - shoulder, b);
        ctx.moveTo(street.coord + shoulder, a);
        ctx.lineTo(street.coord + shoulder, b);
      } else {
        ctx.moveTo(a, street.coord - shoulder);
        ctx.lineTo(b, street.coord - shoulder);
        ctx.moveTo(a, street.coord + shoulder);
        ctx.lineTo(b, street.coord + shoulder);
      }
    }
    ctx.stroke();

    if (street.kind === 'avenue') {
      // 2. Vivid double yellow solid centerlines on main avenues
      ctx.strokeStyle = GROUND_PALETTE.markingYellow;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      const yellowOffset = 2.15;
      for (const [a, b] of intervals) {
        if (street.axis === 'u') {
          ctx.moveTo(street.coord - yellowOffset, a);
          ctx.lineTo(street.coord - yellowOffset, b);
          ctx.moveTo(street.coord + yellowOffset, a);
          ctx.lineTo(street.coord + yellowOffset, b);
        } else {
          ctx.moveTo(a, street.coord - yellowOffset);
          ctx.lineTo(b, street.coord - yellowOffset);
          ctx.moveTo(a, street.coord + yellowOffset);
          ctx.lineTo(b, street.coord + yellowOffset);
        }
      }
      ctx.stroke();

      // 3. Sharp white dashed lane dividers on each half of the 4-lane avenue
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 12]);
      ctx.beginPath();
      const laneOffset = halfAsphalt * 0.52;
      for (const [a, b] of intervals) {
        if (street.axis === 'u') {
          ctx.moveTo(street.coord - laneOffset, a);
          ctx.lineTo(street.coord - laneOffset, b);
          ctx.moveTo(street.coord + laneOffset, a);
          ctx.lineTo(street.coord + laneOffset, b);
        } else {
          ctx.moveTo(a, street.coord - laneOffset);
          ctx.lineTo(b, street.coord - laneOffset);
          ctx.moveTo(a, street.coord + laneOffset);
          ctx.lineTo(b, street.coord + laneOffset);
        }
      }
      ctx.stroke();
    } else {
      // Local streets: crisp bright white dashed centerline
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
      ctx.lineWidth = 1.55;
      ctx.setLineDash([10, 11]);
      ctx.beginPath();
      for (const [a, b] of intervals) {
        if (street.axis === 'u') {
          ctx.moveTo(street.coord, a);
          ctx.lineTo(street.coord, b);
        } else {
          ctx.moveTo(a, street.coord);
          ctx.lineTo(b, street.coord);
        }
      }
      ctx.stroke();
    }

    ctx.restore();
  }
}

function drawZebraCrosswalk(
  ctx: CanvasRenderingContext2D,
  centerU: number,
  centerV: number,
  axis: 'u' | 'v',
  asphaltWidth: number,
  depth = 14
) {
  const half = asphaltWidth / 2 - 3.5;
  const stripeWidth = 3.2;
  const stripeGap = 3.2;
  const step = stripeWidth + stripeGap;

  ctx.save();
  ctx.fillStyle = 'rgba(248, 250, 252, 0.96)';
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.48)';
  ctx.lineWidth = 0.65;

  if (axis === 'u') {
    // Crossing a u-street (road runs along v), stripes run along v, arrayed across u
    for (let offset = -half + stripeWidth / 2; offset <= half - stripeWidth / 2 + 0.1; offset += step) {
      const rx = centerU + offset - stripeWidth / 2;
      const ry = centerV - depth / 2;
      ctx.fillRect(rx, ry, stripeWidth, depth);
      ctx.strokeRect(rx, ry, stripeWidth, depth);
    }
  } else {
    // Crossing a v-street (road runs along u), stripes run along u, arrayed across v
    for (let offset = -half + stripeWidth / 2; offset <= half - stripeWidth / 2 + 0.1; offset += step) {
      const rx = centerU - depth / 2;
      const ry = centerV + offset - stripeWidth / 2;
      ctx.fillRect(rx, ry, depth, stripeWidth);
      ctx.strokeRect(rx, ry, depth, stripeWidth);
    }
  }
  ctx.restore();
}

function drawStopLine(
  ctx: CanvasRenderingContext2D,
  centerU: number,
  centerV: number,
  axis: 'u' | 'v',
  asphaltWidth: number
) {
  const half = asphaltWidth / 2 - 2.6;
  ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
  if (axis === 'u') {
    ctx.fillRect(centerU - half, centerV - 1.15, half * 2, 2.3);
  } else {
    ctx.fillRect(centerU - 1.15, centerV - half, 2.3, half * 2);
  }
}

function drawIntersectionCrosswalks(ctx: CanvasRenderingContext2D, ix: IntersectionInfo) {
  if (ix.isRoundabout) return;

  const uClear = ix.vStreet.asphaltWidth / 2 + ix.vStreet.sidewalkWidth + 9;
  const vClear = ix.uStreet.asphaltWidth / 2 + ix.uStreet.sidewalkWidth + 9;

  // Arms along the u-street (moving along v)
  if (ix.hasNegV) {
    drawZebraCrosswalk(ctx, ix.u, ix.v - uClear, 'u', ix.uStreet.asphaltWidth);
    drawStopLine(ctx, ix.u, ix.v - uClear - 11, 'u', ix.uStreet.asphaltWidth);
  }
  if (ix.hasPosV) {
    drawZebraCrosswalk(ctx, ix.u, ix.v + uClear, 'u', ix.uStreet.asphaltWidth);
    drawStopLine(ctx, ix.u, ix.v + uClear + 11, 'u', ix.uStreet.asphaltWidth);
  }

  // Arms along the v-street (moving along u)
  if (ix.hasNegU) {
    drawZebraCrosswalk(ctx, ix.u - vClear, ix.v, 'v', ix.vStreet.asphaltWidth);
    drawStopLine(ctx, ix.u - vClear - 11, ix.v, 'v', ix.vStreet.asphaltWidth);
  }
  if (ix.hasPosU) {
    drawZebraCrosswalk(ctx, ix.u + vClear, ix.v, 'v', ix.vStreet.asphaltWidth);
    drawStopLine(ctx, ix.u + vClear + 11, ix.v, 'v', ix.vStreet.asphaltWidth);
  }
}

function drawRoundaboutDetails(
  ctx: CanvasRenderingContext2D,
  rb: RoundaboutSpec,
  grassFill: CanvasPattern | string
) {
  ctx.save();

  // 1. Crisp outer asphalt shoulder ring
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.36)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.outerAsphaltRadius - 2.8, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Sharp white dashed circular lane divider right on the roundabout driving centerline (ringRadius)
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
  ctx.lineWidth = 1.85;
  ctx.setLineDash([10, 9]);
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 3. Yield dashed lines & vivid double yellow centerline stubs where the 4 straight roads enter
  ctx.strokeStyle = GROUND_PALETTE.markingYellow;
  ctx.lineWidth = 1.9;
  const stubStart = rb.outerAsphaltRadius + 4;
  const stubEnd = rb.outerSidewalkRadius + 5;
  ctx.beginPath();
  for (const off of [-2.15, 2.15]) {
    ctx.moveTo(rb.u - stubEnd, rb.v + off);
    ctx.lineTo(rb.u - stubStart, rb.v + off);
    ctx.moveTo(rb.u + stubStart, rb.v + off);
    ctx.lineTo(rb.u + stubEnd, rb.v + off);
    ctx.moveTo(rb.u + off, rb.v - stubEnd);
    ctx.lineTo(rb.u + off, rb.v - stubStart);
    ctx.moveTo(rb.u + off, rb.v + stubStart);
    ctx.lineTo(rb.u + off, rb.v + stubEnd);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
  ctx.lineWidth = 2.3;
  ctx.setLineDash([5, 4]);
  const approachHalf = 22;
  const yieldDist = rb.outerAsphaltRadius + 2;
  ctx.beginPath();
  // -u (NW) & +u (SE)
  ctx.moveTo(rb.u - yieldDist, rb.v - approachHalf);
  ctx.lineTo(rb.u - yieldDist, rb.v + approachHalf);
  ctx.moveTo(rb.u + yieldDist, rb.v - approachHalf);
  ctx.lineTo(rb.u + yieldDist, rb.v + approachHalf);
  // -v (SW) & +v (NE)
  ctx.moveTo(rb.u - approachHalf, rb.v - yieldDist);
  ctx.lineTo(rb.u + approachHalf, rb.v - yieldDist);
  ctx.moveTo(rb.u - approachHalf, rb.v + yieldDist);
  ctx.lineTo(rb.u + approachHalf, rb.v + yieldDist);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4. Crisp white zebra crosswalks on all 4 straight symmetrical approaches
  const zebraDist = rb.outerSidewalkRadius + 14;
  drawZebraCrosswalk(ctx, rb.u - zebraDist, rb.v, 'v', 52);
  drawZebraCrosswalk(ctx, rb.u + zebraDist, rb.v, 'v', 52);
  drawZebraCrosswalk(ctx, rb.u, rb.v - zebraDist, 'u', 52);
  drawZebraCrosswalk(ctx, rb.u, rb.v + zebraDist, 'u', 52);

  // 5. Subtle curb-step drop shadow ring on asphalt right around the raised central island
  ctx.strokeStyle = GROUND_PALETTE.asphaltCurbShadow;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.innerCurbRadius + 1.4, 0, Math.PI * 2);
  ctx.stroke();

  // 6. Raised central warm cream-sand concrete island curb with sharp dark ink outlines
  ctx.fillStyle = GROUND_PALETTE.sidewalkFill;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.innerCurbRadius, 0, Math.PI * 2);
  ctx.fill();

  // Subtle curb stone radial joints around central island ring
  ctx.strokeStyle = GROUND_PALETTE.sidewalkJoint;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let k = 0; k < 16; k++) {
    const theta = (k * Math.PI * 2) / 16;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    ctx.moveTo(rb.u + c * rb.islandRadius, rb.v + s * rb.islandRadius);
    ctx.lineTo(rb.u + c * rb.innerCurbRadius, rb.v + s * rb.innerCurbRadius);
  }
  ctx.stroke();

  // Light stone highlight bevel inside curb ring
  ctx.strokeStyle = GROUND_PALETTE.sidewalkHighlight;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.innerCurbRadius - 1.8, 0, Math.PI * 2);
  ctx.stroke();

  // Sharp outer dark ink contour around central island curb
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.innerCurbRadius, 0, Math.PI * 2);
  ctx.stroke();

  // 7. Vibrant lush green textured central grass island + dark ink inner curb edge
  ctx.fillStyle = grassFill;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.islandRadius, 0, Math.PI * 2);
  ctx.fill();

  // Subtle manicured inner turf tonal ring
  ctx.strokeStyle = 'rgba(61, 97, 30, 0.34)';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.islandRadius - 5, 0, Math.PI * 2);
  ctx.stroke();

  // Sharp dark ink contour between island curb and central grass
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.65;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.islandRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws a few crisp deterministic grass tufts in world space inside each roundabout's
 * central green island so islands share the exact stylized meadow finish.
 */
function drawRoundaboutGrassTufts(
  ctx: CanvasRenderingContext2D,
  tileBounds?: WorldViewBounds
) {
  const tuftOffsets: Array<{ du: number; dv: number; scale: number; blades: 2 | 3; lean: number }> = [
    { du: -10, dv: -8, scale: 0.9, blades: 3, lean: -0.3 },
    { du: 11, dv: -6, scale: 0.85, blades: 2, lean: 0.4 },
    { du: -4, dv: 12, scale: 0.95, blades: 3, lean: 0.1 },
    { du: 9, dv: 9, scale: 0.8, blades: 2, lean: -0.2 },
    { du: 0, dv: -1, scale: 1.0, blades: 3, lean: 0.25 },
  ];

  for (const rb of ROUNDABOUTS) {
    const centerPt = isoToCanvas(rb.u, rb.v);
    if (
      tileBounds &&
      (centerPt.x + 70 < tileBounds.minX ||
        centerPt.x - 70 > tileBounds.maxX ||
        centerPt.y + 40 < tileBounds.minY ||
        centerPt.y - 40 > tileBounds.maxY)
    ) {
      continue;
    }
    for (const off of tuftOffsets) {
      const pt = isoToCanvas(rb.u + off.du, rb.v + off.dv);
      drawGrassTuft(ctx, {
        x: pt.x,
        y: pt.y,
        scale: off.scale,
        blades: off.blades,
        lean: off.lean,
      });
    }
  }
}

/**
 * Draws the warm stone paving walkway threshold across the open 12u gate gap
 * connecting the street sidewalk into each single-family house yard, with crisp ink outline.
 */
function drawHouseYardWalkway(ctx: CanvasRenderingContext2D, yard: HouseYardFence) {
  const { uMin, uMax, vMin, vMax, streetSide, gateMin, gateMax } = yard;

  const pathPad = 1.6;
  const g0 = gateMin + pathPad;
  const g1 = gateMax - pathPad;
  const pathReachIn = 8.5;
  const pathReachOut = 2.4;

  let x = 0;
  let y = 0;
  let w = 0;
  let h = 0;
  let horizontal = true;

  if (streetSide === 'uMin') {
    x = uMin - pathReachOut;
    y = g0;
    w = pathReachIn + pathReachOut;
    h = g1 - g0;
    horizontal = true;
  } else if (streetSide === 'uMax') {
    x = uMax - pathReachIn;
    y = g0;
    w = pathReachIn + pathReachOut;
    h = g1 - g0;
    horizontal = true;
  } else if (streetSide === 'vMin') {
    x = g0;
    y = vMin - pathReachOut;
    w = g1 - g0;
    h = pathReachIn + pathReachOut;
    horizontal = false;
  } else {
    x = g0;
    y = vMax - pathReachIn;
    w = g1 - g0;
    h = pathReachIn + pathReachOut;
    horizontal = false;
  }

  ctx.save();
  ctx.fillStyle = GROUND_PALETTE.sidewalkFill;
  ctx.fillRect(x, y, w, h);

  // Subtle paving stone division line across the garden walkway
  ctx.strokeStyle = GROUND_PALETTE.sidewalkJoint;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  if (horizontal) {
    const mid = x + w * 0.5;
    ctx.moveTo(mid, y);
    ctx.lineTo(mid, y + h);
  } else {
    const mid = y + h * 0.5;
    ctx.moveTo(x, mid);
    ctx.lineTo(x + w, mid);
  }
  ctx.stroke();

  // Sharp dark ink contour matching sidewalks & wooden yard fences
  ctx.strokeStyle = GROUND_PALETTE.inkOutline;
  ctx.lineWidth = 1.25;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/**
 * Renders the entire procedural 2:1 orthographic isometric city map directly onto the canvas.
 * Must be called while the canvas transform is already in world/canvas pixel space (0..3200, 0..2000).
 * Accepts an optional `tileWorldBounds` for conservative per-tile culling during tiled baking.
 */
export function renderProceduralCity(
  ctx: CanvasRenderingContext2D,
  textures: ProceduralTextures,
  baseDepot: BaseDepotSpec = BASE_DEPOT,
  tileWorldBounds?: WorldViewBounds
) {
  const grassFill: CanvasPattern | string = textures.grassPattern ?? GROUND_PALETTE.grassBase;
  const asphaltFill: CanvasPattern | string = textures.asphaltPattern ?? GROUND_PALETTE.asphaltBase;
  const concreteFill: CanvasPattern | string = textures.concretePattern ?? GROUND_PALETTE.concreteBase;

  ctx.save();

  // Clip strictly to the 3200x2000 rectangular map bounds
  ctx.beginPath();
  ctx.rect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  ctx.clip();

  // 1. Vibrant textured green terrain filling the entire 3200x2000 map
  ctx.fillStyle = grassFill;
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  // 1b. Soft large-scale meadow tonal patches (#639635 / #7cb347) for natural organic lawns
  for (let i = 0; i < MEADOW_PATCHES.length; i++) {
    const p = MEADOW_PATCHES[i];
    if (
      tileWorldBounds &&
      (p.x + p.rx < tileWorldBounds.minX - 4 ||
        p.x - p.rx > tileWorldBounds.maxX + 4 ||
        p.y + p.rx < tileWorldBounds.minY - 4 ||
        p.y - p.rx > tileWorldBounds.maxY + 4)
    ) {
      continue;
    }
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry, p.rotation, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 1c. Deterministic stylized grass tufts (#3d611e) in world space (upright crisp blades)
  for (let i = 0; i < GRASS_TUFTS.length; i++) {
    const tuft = GRASS_TUFTS[i];
    if (
      tileWorldBounds &&
      (tuft.x < tileWorldBounds.minX - 12 ||
        tuft.x > tileWorldBounds.maxX + 12 ||
        tuft.y < tileWorldBounds.minY - 12 ||
        tuft.y > tileWorldBounds.maxY + 12)
    ) {
      continue;
    }
    drawGrassTuft(ctx, tuft);
  }

  // Apply pure 2:1 orthographic isometric transform:
  //   x = ISO_ORIGIN_X + 1.0 * u + 1.0 * v
  //   y = ISO_ORIGIN_Y + 0.5 * u - 0.5 * v
  ctx.save();
  ctx.transform(1, 0.5, 1, -0.5, ISO_ORIGIN_X, ISO_ORIGIN_Y);

  // 2. Flush warm concrete quarters (blocks, markets & BAZA right up to sidewalk edges)
  for (const plot of CONCRETE_PLOTS) {
    drawConcretePlot(ctx, plot, concreteFill, baseDepot);
  }

  // 2b. Isometric parking lots (markets & block courtyards) + BAZA fleet parking + Bus Station yard + Delivery zones
  for (const lot of PROCEDURAL_PARKING_LOTS) {
    drawParkingLot(ctx, lot, asphaltFill);
  }
  drawBaseParking(ctx, baseDepot.parking, asphaltFill);
  drawBusStationSurface(ctx, BUS_STATION, asphaltFill);
  for (const dz of PROCEDURAL_DELIVERY_ZONES) {
    drawDeliveryZone(ctx, dz);
  }

  // 2c. 8 reserved parcel locker paver pads on free concrete plazas
  for (const slot of PARCEL_LOCKER_SLOTS) {
    drawParcelLockerSlot(ctx, slot);
  }

  // 3. Sharp dark ink outer sidewalk contour (#1e293b) around all streets, access roads, roundabouts & BAZA driveway
  ctx.fillStyle = GROUND_PALETTE.inkOutline;
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + street.sidewalkWidth + 1.85);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + street.sidewalkWidth + 1.85);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2 + ar.sidewalkWidth + 1.6);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerSidewalkRadius + 1.85, 0, Math.PI * 2);
    ctx.fill();
  }
  // BAZA straight driveway outer sidewalk ink border (stops cleanly at yard perimeter)
  {
    const dwHalf = BASE_DEPOT.drivewayAsphaltWidth / 2 + BASE_DEPOT.drivewaySidewalkWidth + 1.75;
    const dwEndU = BASE_DEPOT.yardUMin + 4;
    ctx.fillRect(
      BASE_DEPOT.exitU,
      BASE_DEPOT.v - dwHalf,
      dwEndU - BASE_DEPOT.exitU,
      dwHalf * 2
    );
  }

  // 4. Warm cream-sand sidewalk surface layer (#dfd9ce)
  ctx.fillStyle = GROUND_PALETTE.sidewalkFill;
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + street.sidewalkWidth);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + street.sidewalkWidth);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2 + ar.sidewalkWidth);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerSidewalkRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  {
    const dwHalf = BASE_DEPOT.drivewayAsphaltWidth / 2 + BASE_DEPOT.drivewaySidewalkWidth;
    const dwEndU = BASE_DEPOT.yardUMin + 4;
    ctx.fillRect(
      BASE_DEPOT.exitU,
      BASE_DEPOT.v - dwHalf,
      dwEndU - BASE_DEPOT.exitU,
      dwHalf * 2
    );
  }

  // 4b. Crisp sidewalk paving-slab divisions on streets, access roads & roundabout rings
  for (const street of U_STREETS) {
    drawStreetSidewalkJoints(ctx, street);
  }
  for (const street of V_STREETS) {
    drawStreetSidewalkJoints(ctx, street);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadSidewalkJoints(ctx, ar);
  }
  for (const rb of ROUNDABOUTS) {
    drawRoundaboutSidewalkJoints(ctx, rb);
  }

  // 4c. Warm stone gate walkways at every single-family house yard entrance
  for (const yard of PROCEDURAL_HOUSE_YARDS) {
    drawHouseYardWalkway(ctx, yard);
  }

  // 5a. Light stone curb-cap highlight strip immediately behind the ink curb line
  ctx.fillStyle = GROUND_PALETTE.sidewalkHighlight;
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + 2.9);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + 2.9);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2 + 2.4);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerAsphaltRadius + 2.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5b. Sharp dark ink curb contour (#1e293b) separating sidewalk from roadway
  ctx.fillStyle = GROUND_PALETTE.inkOutline;
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + 1.75);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + 1.75);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2 + 1.5);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerAsphaltRadius + 1.75, 0, Math.PI * 2);
    ctx.fill();
  }
  {
    const dwHalf = BASE_DEPOT.drivewayAsphaltWidth / 2 + 1.75;
    const dwEndU = BASE_DEPOT.u - 10;
    ctx.fillRect(
      BASE_DEPOT.exitU,
      BASE_DEPOT.v - dwHalf,
      dwEndU - BASE_DEPOT.exitU,
      dwHalf * 2
    );
  }
  // Lateral-only ink curb edges along every parking lot driveway (leaving both lot and street mouths open)
  for (const lot of PROCEDURAL_PARKING_LOTS) {
    const d = lot.accessDriveway;
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin, d.vMin - 1.75, d.uMax - d.uMin, d.vMax - d.vMin + 3.5);
    } else {
      ctx.fillRect(d.uMin - 1.75, d.vMin, d.uMax - d.uMin + 3.5, d.vMax - d.vMin);
    }
  }
  // Lateral-only ink curb edges on BAZA internal parking connector (stopping cleanly at baseDepot.parking mouth)
  for (const seg of baseDepot.parking.connectorSegments) {
    const uMaxTrim = Math.min(seg.uMax, baseDepot.parking.uMin - 1.5);
    const vMinTrim = Math.max(seg.vMin, baseDepot.v);
    if (uMaxTrim > seg.uMin) {
      ctx.fillRect(seg.uMin - 1.75, vMinTrim - 1.75, uMaxTrim - seg.uMin + 3.5, seg.vMax - vMinTrim + 3.5);
    }
  }
  // Lateral-only ink curb edges for Bus Station separate wide Entry & Exit driveways onto al. Dworcowa
  for (const bdw of [BUS_STATION.entryDriveway, BUS_STATION.exitDriveway]) {
    ctx.fillRect(bdw.uMin - 1.85, bdw.vMin, bdw.uMax - bdw.uMin + 3.7, bdw.vMax - bdw.vMin);
  }
  // Lateral-only ink curb edges for dedicated Delivery Zone driveways (markets & Bus Station)
  for (const dz of PROCEDURAL_DELIVERY_ZONES) {
    const d = dz.driveway;
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin, d.vMin - 1.75, d.uMax - d.uMin, d.vMax - d.vMin + 3.5);
    } else {
      ctx.fillRect(d.uMin - 1.75, d.vMin, d.uMax - d.uMin + 3.5, d.vMax - d.vMin);
    }
  }

  // 6a. Subtle sunken curb-step drop shadow band along outer asphalt gutters (#2c323c)
  ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerAsphaltRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6b. Deep slate-graphite textured asphalt roadway layer (#424852)
  ctx.fillStyle = asphaltFill;
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 - 1.6);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 - 1.6);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2 - 1.3);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerAsphaltRadius - 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Parking lot asphalt driveways cutting cleanly across sidewalks directly into street asphalt & opening lot rim
  for (const lot of PROCEDURAL_PARKING_LOTS) {
    const d = lot.accessDriveway;
    ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin - 2.5, d.vMin, d.uMax - d.uMin + 5, d.vMax - d.vMin);
      ctx.fillStyle = asphaltFill;
      ctx.fillRect(d.uMin - 2.5, d.vMin + 1.3, d.uMax - d.uMin + 5, d.vMax - d.vMin - 2.6);
    } else {
      ctx.fillRect(d.uMin, d.vMin - 2.5, d.uMax - d.uMin, d.vMax - d.vMin + 5);
      ctx.fillStyle = asphaltFill;
      ctx.fillRect(d.uMin + 1.3, d.vMin - 2.5, d.uMax - d.uMin - 2.6, d.vMax - d.vMin + 5);
    }
  }
  // Bus Station separate wide Entry & Exit asphalt driveways cutting across al. Dworcowa sidewalk into bus yard
  for (const bdw of [BUS_STATION.entryDriveway, BUS_STATION.exitDriveway]) {
    ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
    ctx.fillRect(bdw.uMin, bdw.vMin - 2.5, bdw.uMax - bdw.uMin, bdw.vMax - bdw.vMin + 6);
    ctx.fillStyle = asphaltFill;
    ctx.fillRect(bdw.uMin + 1.4, bdw.vMin - 2.5, bdw.uMax - bdw.uMin - 2.8, bdw.vMax - bdw.vMin + 6);
  }
  // Dedicated Delivery Zone asphalt driveways cutting directly from adjacent street into each loading bay
  for (const dz of PROCEDURAL_DELIVERY_ZONES) {
    const d = dz.driveway;
    ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin - 2.5, d.vMin, d.uMax - d.uMin + 5, d.vMax - d.vMin);
      ctx.fillStyle = PARKING_GROUND_STYLE.asphaltInnerShade;
      ctx.fillRect(d.uMin - 2.5, d.vMin + 1.2, d.uMax - d.uMin + 5, d.vMax - d.vMin - 2.4);
    } else {
      ctx.fillRect(d.uMin, d.vMin - 2.5, d.uMax - d.uMin, d.vMax - d.vMin + 5);
      ctx.fillStyle = PARKING_GROUND_STYLE.asphaltInnerShade;
      ctx.fillRect(d.uMin + 1.2, d.vMin - 2.5, d.uMax - d.uMin - 2.4, d.vMax - d.vMin + 5);
    }
    // Crisp yellow dashed centerline guide marking dedicated loading-zone access
    ctx.save();
    ctx.strokeStyle = GROUND_PALETTE.markingYellow;
    ctx.lineWidth = 1.45;
    ctx.setLineDash([4.5, 4.5]);
    ctx.beginPath();
    if (d.axis === 'u') {
      const midV = (d.vMin + d.vMax) * 0.5;
      ctx.moveTo(d.uMin + 2, midV);
      ctx.lineTo(d.uMax - 2, midV);
    } else {
      const midU = (d.uMin + d.uMax) * 0.5;
      ctx.moveTo(midU, d.vMin + 2);
      ctx.lineTo(midU, d.vMax - 2);
    }
    ctx.stroke();
    ctx.restore();
  }
  // BAZA internal asphalt road directly connecting BAZA courier driveway into baseDepot.parking (open entrance)
  for (const seg of baseDepot.parking.connectorSegments) {
    const extU = seg.uMax >= baseDepot.parking.uMin - 1 ? 3 : 0;
    ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
    ctx.fillRect(seg.uMin, seg.vMin, seg.uMax - seg.uMin + extU, seg.vMax - seg.vMin);
    ctx.fillStyle = asphaltFill;
    ctx.fillRect(
      seg.uMin + 1.2,
      seg.vMin + 1.2,
      seg.uMax - seg.uMin + extU - 2.0,
      seg.vMax - seg.vMin - 2.4
    );
  }
  // BAZA straight asphalt driveway connecting yard cleanly onto Central Main Avenue
  {
    const dwHalf = baseDepot.drivewayAsphaltWidth / 2;
    const dwEndU = baseDepot.u - 10;
    ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
    ctx.fillRect(
      baseDepot.exitU,
      baseDepot.v - dwHalf,
      dwEndU - baseDepot.exitU,
      dwHalf * 2
    );
    ctx.fillStyle = asphaltFill;
    ctx.fillRect(
      baseDepot.exitU,
      baseDepot.v - dwHalf + 1.4,
      dwEndU - baseDepot.exitU,
      (dwHalf - 1.4) * 2
    );
  }

  // 7a. Curbside street details (storm drain grates & cast-iron manhole covers)
  for (const street of U_STREETS) {
    drawStreetCurbDetails(ctx, street);
  }
  for (const street of V_STREETS) {
    drawStreetCurbDetails(ctx, street);
  }

  // 7b. Street lane markings (avenues, local streets, and narrow 2-lane residential access roads)
  for (const street of U_STREETS) {
    drawStreetMarkings(ctx, street);
  }
  for (const street of V_STREETS) {
    drawStreetMarkings(ctx, street);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadMarkings(ctx, ar);
  }

  // BAZA driveway & internal fleet parking connector dashed yellow guide lines
  ctx.save();
  ctx.strokeStyle = GROUND_PALETTE.markingYellow;
  ctx.lineWidth = 1.65;
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(baseDepot.exitU + 28, baseDepot.v);
  ctx.lineTo(baseDepot.u - 16, baseDepot.v);
  // Branch line leading neatly from BAZA courier driveway into the fleet parking lot aisle
  if (baseDepot.parking.spots.length > 0) {
    ctx.moveTo(82, baseDepot.v);
    ctx.lineTo(82, baseDepot.parking.aisleV);
    ctx.lineTo(baseDepot.parking.uMin + 4, baseDepot.parking.aisleV);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = GROUND_PALETTE.markingWhite;
  ctx.fillRect(baseDepot.exitU + 28, baseDepot.v - 10, 2.2, 20);
  ctx.restore();

  // 8. Crisp white zebra crosswalks & stop lines at every regular intersection
  for (const ix of INTERSECTIONS) {
    drawIntersectionCrosswalks(ctx, ix);
  }

  // 9. Roundabout circular dashed markings, yield bars, approach zebras & central green islands
  for (const rb of ROUNDABOUTS) {
    drawRoundaboutDetails(ctx, rb, grassFill);
  }

  ctx.restore(); // Exit isometric (u, v) transform back to world (x, y) space

  // 9b. Crisp upright grass tufts inside roundabout central green islands
  drawRoundaboutGrassTufts(ctx, tileWorldBounds);

  ctx.restore();
}

export const STATIC_GROUND_BUFFER_SCALE = 1.25;
export const STATIC_GROUND_TILE_PIXEL_SIZE = 1024;
const STATIC_GROUND_TILE_OVERLAP_WORLD = 1; // Overlap world unit to prevent sub-pixel seams between tiles
const STATIC_GRID_INV_SCALE = 1 / Math.sqrt(1.65);

export interface StaticGroundTile {
  col: number;
  row: number;
  canvas: HTMLCanvasElement;
  worldX: number;
  worldY: number;
  worldWidth: number;
  worldHeight: number;
}

export interface StaticGroundBuffer {
  key: string;
  tiles: StaticGroundTile[];
  cols: number;
  rows: number;
  tileWorldStep: number;
  tilePixelSize: number;
  scale: number;
  worldWidth: number;
  worldHeight: number;
}

export interface StaticGroundBufferOptions {
  textures: ProceduralTextures;
  baseDepot: BaseDepotSpec;
  buildings: Building[];
  graph: RoadGraph;
  parkingNavNetworks: ParkingNavNetwork[];
  showGrid: boolean;
  footprintOnly: boolean;
  scale?: number;
  tilePixelSize?: number;
}

/**
 * Renders static road graph edges, one-way roundabout arrows, internal parking navigation
 * aisles, and non-base road nodes onto the static ground buffer when grid mode is enabled.
 */
export function renderStaticRoadGrid(
  ctx: CanvasRenderingContext2D,
  graph: RoadGraph,
  parkingNavNetworks: ParkingNavNetwork[],
  invScale = STATIC_GRID_INV_SCALE,
  tileBounds?: WorldViewBounds
) {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const pad = 24;
  const segOutside = (ax: number, ay: number, bx: number, by: number): boolean => {
    if (!tileBounds) return false;
    return (
      Math.max(ax, bx) < tileBounds.minX - pad ||
      Math.min(ax, bx) > tileBounds.maxX + pad ||
      Math.max(ay, by) < tileBounds.minY - pad ||
      Math.min(ay, by) > tileBounds.maxY + pad
    );
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Dark road edge casing
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.lineWidth = 6 * invScale;
  ctx.beginPath();
  for (const [aId, bId] of graph.edges) {
    const a = nodeMap.get(aId);
    const b = nodeMap.get(bId);
    if (!a || !b || segOutside(a.x, a.y, b.x, b.y)) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // Yellow road graph centerline
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
  ctx.lineWidth = 2.6 * invScale;
  ctx.beginPath();
  for (const [aId, bId] of graph.edges) {
    const a = nodeMap.get(aId);
    const b = nodeMap.get(bId);
    if (!a || !b || segOutside(a.x, a.y, b.x, b.y)) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // Subtle directional arrowheads on one-way roundabout edges (CCW)
  ctx.fillStyle = '#2dd4bf';
  for (const edge of graph.edges) {
    if (!edge[2]?.oneWay) continue;
    const a = nodeMap.get(edge[0]);
    const b = nodeMap.get(edge[1]);
    if (!a || !b || segOutside(a.x, a.y, b.x, b.y)) continue;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const sz = 4.2 * invScale;
    ctx.beginPath();
    ctx.moveTo(mx + Math.cos(ang) * sz, my + Math.sin(ang) * sz);
    ctx.lineTo(
      mx + Math.cos(ang + 2.45) * sz * 0.85,
      my + Math.sin(ang + 2.45) * sz * 0.85
    );
    ctx.lineTo(
      mx + Math.cos(ang - 2.45) * sz * 0.85,
      my + Math.sin(ang - 2.45) * sz * 0.85
    );
    ctx.closePath();
    ctx.fill();
  }

  // Subtle internal parking navigation aisles across ALL parking lots
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.62)';
  ctx.lineWidth = 1.9 * invScale;
  ctx.setLineDash([5 * invScale, 4 * invScale]);
  ctx.beginPath();
  for (const net of parkingNavNetworks) {
    const pNodeMap = new Map(net.nodes.map((n) => [n.id, n]));
    for (const edge of net.edges) {
      const a = pNodeMap.get(edge.from);
      const b = pNodeMap.get(edge.to);
      if (!a || !b || segOutside(a.x, a.y, b.x, b.y)) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Directional arrows on one-way internal parking lanes
  ctx.fillStyle = '#38bdf8';
  for (const net of parkingNavNetworks) {
    const pNodeMap = new Map(net.nodes.map((n) => [n.id, n]));
    for (const edge of net.edges) {
      if (!edge.oneWay) continue;
      const a = pNodeMap.get(edge.from);
      const b = pNodeMap.get(edge.to);
      if (!a || !b || segOutside(a.x, a.y, b.x, b.y)) continue;
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const sz = 3.8 * invScale;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(ang) * sz, my + Math.sin(ang) * sz);
      ctx.lineTo(
        mx + Math.cos(ang + 2.45) * sz * 0.85,
        my + Math.sin(ang + 2.45) * sz * 0.85
      );
      ctx.lineTo(
        mx + Math.cos(ang - 2.45) * sz * 0.85,
        my + Math.sin(ang - 2.45) * sz * 0.85
      );
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // Non-base road graph nodes (base marker is rendered dynamically on top)
  const radius = 4.5 * invScale;
  ctx.lineWidth = 1.8 * invScale;
  ctx.strokeStyle = '#0f172a';
  for (const node of graph.nodes) {
    if (node.id === 'base' || node.kind === 'base') continue;
    if (
      tileBounds &&
      (node.x < tileBounds.minX - pad ||
        node.x > tileBounds.maxX + pad ||
        node.y < tileBounds.minY - pad ||
        node.y > tileBounds.maxY + pad)
    ) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    if (node.kind === 'roundabout') {
      ctx.fillStyle = '#2dd4bf';
    } else if (node.kind === 'endpoint') {
      ctx.fillStyle = '#cbd5e1';
    } else {
      ctx.fillStyle = '#fbbf24';
    }
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Explicitly releases tile canvas backing stores (useful on unmount to free mobile GPU memory).
 */
export function disposeStaticGroundBuffer(buffer: StaticGroundBuffer | null) {
  if (!buffer) return;
  for (let i = 0; i < buffer.tiles.length; i++) {
    const c = buffer.tiles[i].canvas;
    c.width = 0;
    c.height = 0;
  }
}

/**
 * Renders the static ground layer (terrain, grass tufts, concrete plots, parking, sidewalks,
 * streets, markings, roundabouts, paver pads, optional 2D building footprints, and optional
 * road grid) once into a grid of 1.25x HTMLCanvasElement tiles (<= 1024x1024 px each)
 * to keep VRAM low while preserving crisp dark ink outlines and street markings.
 * Rebuilt only when a static layer setting changes — never during camera pan or zoom.
 */
export function buildStaticGroundBuffer(
  options: StaticGroundBufferOptions,
  key: string,
  existingBuffer?: StaticGroundBuffer | null
): StaticGroundBuffer {
  const scale = options.scale ?? STATIC_GROUND_BUFFER_SCALE;
  const tilePixelSize = options.tilePixelSize ?? STATIC_GROUND_TILE_PIXEL_SIZE;
  const overlapWorld = STATIC_GROUND_TILE_OVERLAP_WORLD;
  const tileWorldStep = Math.max(64, Math.floor(tilePixelSize / scale) - overlapWorld);

  const cols = Math.ceil(MAP_WIDTH / tileWorldStep);
  const rows = Math.ceil(MAP_HEIGHT / tileWorldStep);

  const canReuseTiles =
    existingBuffer != null &&
    existingBuffer.cols === cols &&
    existingBuffer.rows === rows &&
    existingBuffer.scale === scale &&
    existingBuffer.tilePixelSize === tilePixelSize &&
    existingBuffer.tiles.length === cols * rows;

  if (existingBuffer && !canReuseTiles) {
    disposeStaticGroundBuffer(existingBuffer);
  }

  const tiles: StaticGroundTile[] = new Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    const worldY = row * tileWorldStep;
    const worldEndY = Math.min(
      MAP_HEIGHT,
      worldY + tileWorldStep + (row < rows - 1 ? overlapWorld : 0)
    );
    const worldHeight = worldEndY - worldY;
    const pixelHeight = Math.max(1, Math.round(worldHeight * scale));

    for (let col = 0; col < cols; col++) {
      const worldX = col * tileWorldStep;
      const worldEndX = Math.min(
        MAP_WIDTH,
        worldX + tileWorldStep + (col < cols - 1 ? overlapWorld : 0)
      );
      const worldWidth = worldEndX - worldX;
      const pixelWidth = Math.max(1, Math.round(worldWidth * scale));

      const idx = row * cols + col;
      const canvas = canReuseTiles
        ? existingBuffer!.tiles[idx].canvas
        : document.createElement('canvas');

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      const tCtx = canvas.getContext('2d');
      if (tCtx) {
        tCtx.save();
        tCtx.setTransform(1, 0, 0, 1, 0, 0);
        tCtx.clearRect(0, 0, pixelWidth, pixelHeight);
        tCtx.setTransform(scale, 0, 0, scale, -worldX * scale, -worldY * scale);
        tCtx.imageSmoothingEnabled = true;

        const tileBounds: WorldViewBounds = {
          minX: worldX,
          maxX: worldEndX,
          minY: worldY,
          maxY: worldEndY,
        };

        renderProceduralCity(tCtx, options.textures, options.baseDepot, tileBounds);

        if (options.footprintOnly) {
          renderBuildingFootprints(tCtx, options.buildings, null, null, 1.65, {
            minX: worldX - 16,
            maxX: worldEndX + 16,
            minY: worldY - 16,
            maxY: worldEndY + 16,
          });
        }

        if (options.showGrid) {
          renderStaticRoadGrid(
            tCtx,
            options.graph,
            options.parkingNavNetworks,
            STATIC_GRID_INV_SCALE,
            tileBounds
          );
        }

        tCtx.restore();
      }

      tiles[idx] = {
        col,
        row,
        canvas,
        worldX,
        worldY,
        worldWidth,
        worldHeight,
      };
    }
  }

  return {
    key,
    tiles,
    cols,
    rows,
    tileWorldStep,
    tilePixelSize,
    scale,
    worldWidth: MAP_WIDTH,
    worldHeight: MAP_HEIGHT,
  };
}

export interface ClampedDrawImageRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Strictly clamps the requested source rectangle `(sx, sy, sw, sh)` to the exact pixel
 * bounds `[0..bufferWidth] x [0..bufferHeight]` and proportionally adjusts the destination
 * rectangle `(dx, dy, dw, dh)` in local world coordinates so `ctx.drawImage` never reads
 * outside an offscreen tile buffer (preventing GPU acceleration fallbacks near tile/map edges).
 */
export function clampGroundDrawRect(
  viewBounds: WorldViewBounds,
  bufferWidth: number,
  bufferHeight: number,
  worldWidth: number,
  worldHeight: number
): ClampedDrawImageRect | null {
  if (bufferWidth <= 0 || bufferHeight <= 0 || worldWidth <= 0 || worldHeight <= 0) {
    return null;
  }

  const rawDx = viewBounds.minX;
  const rawDy = viewBounds.minY;
  const rawDw = viewBounds.maxX - viewBounds.minX;
  const rawDh = viewBounds.maxY - viewBounds.minY;
  if (rawDw <= 0 || rawDh <= 0) return null;

  const scaleX = bufferWidth / worldWidth;
  const scaleY = bufferHeight / worldHeight;

  const reqSx = rawDx * scaleX;
  const reqSy = rawDy * scaleY;
  const reqSw = rawDw * scaleX;
  const reqSh = rawDh * scaleY;

  const sx = Math.max(0, Math.min(bufferWidth, Math.floor(reqSx)));
  const sy = Math.max(0, Math.min(bufferHeight, Math.floor(reqSy)));
  const sxEnd = Math.max(sx, Math.min(bufferWidth, Math.ceil(reqSx + reqSw)));
  const syEnd = Math.max(sy, Math.min(bufferHeight, Math.ceil(reqSy + reqSh)));

  const sw = Math.min(bufferWidth - sx, sxEnd - sx);
  const sh = Math.min(bufferHeight - sy, syEnd - sy);
  if (sw <= 0 || sh <= 0) return null;

  // Exact world-coordinate destination rect corresponding to the clamped source pixels
  const dx = sx / scaleX;
  const dy = sy / scaleY;
  const dw = sw / scaleX;
  const dh = sh / scaleY;
  if (dw <= 0 || dh <= 0) return null;

  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

/**
 * Blits only the camera-visible tiles of the 1.25x pre-rendered static ground buffer onto
 * the world-transformed target canvas, with guaranteed in-bounds source pixel clamping.
 */
export function drawStaticGroundBuffer(
  ctx: CanvasRenderingContext2D,
  buffer: StaticGroundBuffer,
  viewBounds: WorldViewBounds
) {
  const clampedMinX = Math.max(0, viewBounds.minX);
  const clampedMaxX = Math.min(buffer.worldWidth, viewBounds.maxX);
  const clampedMinY = Math.max(0, viewBounds.minY);
  const clampedMaxY = Math.min(buffer.worldHeight, viewBounds.maxY);

  if (clampedMaxX <= clampedMinX || clampedMaxY <= clampedMinY) {
    return;
  }

  const colStart = Math.max(0, Math.floor(clampedMinX / buffer.tileWorldStep));
  const colEnd = Math.min(
    buffer.cols - 1,
    Math.floor((clampedMaxX - 1e-6) / buffer.tileWorldStep)
  );
  const rowStart = Math.max(0, Math.floor(clampedMinY / buffer.tileWorldStep));
  const rowEnd = Math.min(
    buffer.rows - 1,
    Math.floor((clampedMaxY - 1e-6) / buffer.tileWorldStep)
  );

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const tile = buffer.tiles[row * buffer.cols + col];
      if (!tile) continue;

      const localBounds: WorldViewBounds = {
        minX: clampedMinX - tile.worldX,
        maxX: clampedMaxX - tile.worldX,
        minY: clampedMinY - tile.worldY,
        maxY: clampedMaxY - tile.worldY,
      };

      const rect = clampGroundDrawRect(
        localBounds,
        tile.canvas.width,
        tile.canvas.height,
        tile.worldWidth,
        tile.worldHeight
      );
      if (!rect) continue;

      ctx.drawImage(
        tile.canvas,
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        tile.worldX + rect.dx,
        tile.worldY + rect.dy,
        rect.dw,
        rect.dh
      );
    }
  }
}

const VIEWPORT_CAMERA_POS_EPSILON = 1e-4;
const VIEWPORT_CAMERA_ZOOM_EPSILON = 1e-5;

export interface ViewportGroundCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  groundKey: string;
  canvasWidth: number;
  canvasHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  hasRendered: boolean;
}

export interface ViewportGroundUpdateParams {
  canvasWidth: number;
  canvasHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  effectiveZoom: number;
  backgroundColor?: string;
}

/**
 * Allocates a single viewport-sized HTMLCanvasElement cache for the static ground layer.
 */
export function createViewportGroundCache(): ViewportGroundCache {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return {
    canvas,
    ctx,
    groundKey: '',
    canvasWidth: 0,
    canvasHeight: 0,
    logicalWidth: 0,
    logicalHeight: 0,
    cameraX: Number.NaN,
    cameraY: Number.NaN,
    cameraZoom: Number.NaN,
    hasRendered: false,
  };
}

/**
 * Explicitly releases the viewport ground cache backing store.
 */
export function disposeViewportGroundCache(cache: ViewportGroundCache | null) {
  if (!cache) return;
  cache.canvas.width = 0;
  cache.canvas.height = 0;
  cache.canvasWidth = 0;
  cache.canvasHeight = 0;
  cache.hasRendered = false;
  cache.groundKey = '';
}

/**
 * Re-renders visible static ground tiles into the viewport-sized HTMLCanvasElement buffer
 * ONLY when camera position/zoom, viewport/canvas size, or static ground state changes.
 * Returns `true` if the cache was redrawn, or `false` when it can be blitted directly.
 */
export function updateViewportGroundCache(
  cache: ViewportGroundCache,
  groundBuffer: StaticGroundBuffer,
  params: ViewportGroundUpdateParams
): boolean {
  const {
    canvasWidth,
    canvasHeight,
    logicalWidth,
    logicalHeight,
    cameraX,
    cameraY,
    cameraZoom,
    effectiveZoom,
    backgroundColor = '#161b22',
  } = params;

  const isValid =
    cache.hasRendered &&
    cache.groundKey === groundBuffer.key &&
    cache.canvasWidth === canvasWidth &&
    cache.canvasHeight === canvasHeight &&
    cache.logicalWidth === logicalWidth &&
    cache.logicalHeight === logicalHeight &&
    Math.abs(cache.cameraX - cameraX) <= VIEWPORT_CAMERA_POS_EPSILON &&
    Math.abs(cache.cameraY - cameraY) <= VIEWPORT_CAMERA_POS_EPSILON &&
    Math.abs(cache.cameraZoom - cameraZoom) <= VIEWPORT_CAMERA_ZOOM_EPSILON;

  if (isValid) {
    return false;
  }

  const targetW = Math.max(1, canvasWidth);
  const targetH = Math.max(1, canvasHeight);
  if (cache.canvas.width !== targetW || cache.canvas.height !== targetH) {
    cache.canvas.width = targetW;
    cache.canvas.height = targetH;
  }

  const vgCtx = cache.ctx ?? cache.canvas.getContext('2d');
  if (!vgCtx) return false;
  cache.ctx = vgCtx;

  const dprX = targetW / Math.max(1, logicalWidth);
  const dprY = targetH / Math.max(1, logicalHeight);

  vgCtx.save();
  vgCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
  vgCtx.imageSmoothingEnabled = true;
  vgCtx.imageSmoothingQuality = 'high';

  vgCtx.fillStyle = backgroundColor;
  vgCtx.fillRect(0, 0, logicalWidth, logicalHeight);

  vgCtx.translate(logicalWidth / 2, logicalHeight / 2);
  vgCtx.scale(effectiveZoom, effectiveZoom);
  vgCtx.translate(-cameraX, -cameraY);

  const halfGroundW = logicalWidth / (2 * effectiveZoom) + 4;
  const halfGroundH = logicalHeight / (2 * effectiveZoom) + 4;
  drawStaticGroundBuffer(vgCtx, groundBuffer, {
    minX: cameraX - halfGroundW,
    maxX: cameraX + halfGroundW,
    minY: cameraY - halfGroundH,
    maxY: cameraY + halfGroundH,
  });

  vgCtx.restore();

  cache.groundKey = groundBuffer.key;
  cache.canvasWidth = targetW;
  cache.canvasHeight = targetH;
  cache.logicalWidth = logicalWidth;
  cache.logicalHeight = logicalHeight;
  cache.cameraX = cameraX;
  cache.cameraY = cameraY;
  cache.cameraZoom = cameraZoom;
  cache.hasRendered = true;
  return true;
}

interface StreetLabelPlacement {
  name: string;
  kind: StreetSpec['kind'];
  x: number;
  y: number;
  angle: number;
}

const ISO_ANGLE_U = Math.atan2(-0.5, 1); // SW -> NE (-26.565 deg)
const ISO_ANGLE_V = Math.atan2(0.5, 1); // NW -> SE (+26.565 deg)

function buildStreetLabelPlacements(): StreetLabelPlacement[] {
  const placements: StreetLabelPlacement[] = [];

  for (const street of ALL_STREETS) {
    const candidates: Array<{ x: number; y: number; len: number; mid: number }> = [];

    for (const [sMin, sMax] of street.spans) {
      const intervals = getClearMarkingIntervals(street, sMin, sMax);
      for (const [a, b] of intervals) {
        const len = b - a;
        if (len < 110) continue;
        const mid = (a + b) / 2;
        const u = street.axis === 'u' ? street.coord : mid;
        const v = street.axis === 'u' ? mid : street.coord;
        const pt = isoToCanvas(u, v);
        if (!isPointInsideMap(pt, 70)) continue;
        candidates.push({ x: pt.x, y: pt.y, len, mid });
      }
    }

    if (candidates.length === 0) continue;

    // Pick well-spaced placements along each street (min ~460 px apart so map stays uncluttered)
    const chosen: typeof candidates = [];
    for (const c of candidates) {
      if (chosen.every((prev) => Math.hypot(prev.x - c.x, prev.y - c.y) >= 440)) {
        chosen.push(c);
      }
    }
    if (chosen.length === 0) {
      chosen.push(candidates[Math.floor(candidates.length / 2)]);
    }

    const angle = street.axis === 'u' ? ISO_ANGLE_U : ISO_ANGLE_V;
    for (const c of chosen) {
      placements.push({
        name: street.name,
        kind: street.kind,
        x: c.x,
        y: c.y,
        angle,
      });
    }
  }

  return placements;
}

const STREET_LABEL_PLACEMENTS: StreetLabelPlacement[] = buildStreetLabelPlacements();

export interface WorldViewBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Draws clean, flat 2D isometric building footprints with semi-transparent color-coded fills
 * and crisp outlines (used when "Podstawy budynków" mode is active).
 */
export function renderBuildingFootprints(
  ctx: CanvasRenderingContext2D,
  buildings: Building[],
  selectedId: string | null,
  hoveredId: string | null,
  zoom: number,
  viewBounds?: WorldViewBounds
) {
  const invScale = 1 / Math.sqrt(zoom);

  ctx.save();
  for (const b of buildings) {
    const p = getBuildingPrismPoints(b);
    if (
      viewBounds &&
      (p.bRight.x < viewBounds.minX ||
        p.bLeft.x > viewBounds.maxX ||
        p.bFront.y < viewBounds.minY ||
        p.bBack.y > viewBounds.maxY)
    ) {
      continue;
    }

    const palette = getBuildingPalette(b.typ, b.colorVariant);
    const isSelected = b.id === selectedId;
    const isHovered = b.id === hoveredId;

    ctx.beginPath();
    ctx.moveTo(p.bBack.x, p.bBack.y);
    ctx.lineTo(p.bRight.x, p.bRight.y);
    ctx.lineTo(p.bFront.x, p.bFront.y);
    ctx.lineTo(p.bLeft.x, p.bLeft.y);
    ctx.closePath();

    ctx.fillStyle = isSelected
      ? 'rgba(251, 191, 36, 0.45)'
      : isHovered
        ? 'rgba(255, 255, 255, 0.28)'
        : palette.footprintFill;
    ctx.fill();

    ctx.lineWidth = (isSelected ? 3.2 : isHovered ? 2.4 : 1.9) * invScale;
    ctx.strokeStyle = isSelected
      ? '#fbbf24'
      : isHovered
        ? '#f8fafc'
        : palette.footprintStroke;
    ctx.stroke();

    // Subtle dark hairline seam so wall-to-wall connected blocks clearly show individual borders
    if (!isSelected && !isHovered) {
      ctx.lineWidth = 0.85 * invScale;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.52)';
      ctx.stroke();
    }

    if (isSelected) {
      ctx.lineWidth = 1.4 * invScale;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }
  ctx.restore();
}

const FENCE_COLOR_U = '#b88958';
const FENCE_COLOR_V = '#9e7143';
const FENCE_COLOR_TOP = '#cfa372';
const FENCE_OUTLINE = '#3d2817';
const FENCE_PICKET_SEAM = 'rgba(61, 40, 23, 0.56)';
const FENCE_RIDGE_SEAM = 'rgba(61, 40, 23, 0.48)';

function drawFenceSegment3D(
  ctx: CanvasRenderingContext2D,
  seg: FenceSegment3D,
  invScale: number
) {
  const { prism: p, pickets } = seg;

  // 1. Wall along u axis (SW-facing, warm light brown wood)
  ctx.fillStyle = FENCE_COLOR_U;
  ctx.beginPath();
  ctx.moveTo(p.bLeft.x, p.bLeft.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // 2. Wall along v axis (SE-facing, slightly darker shaded wood)
  ctx.fillStyle = FENCE_COLOR_V;
  ctx.beginPath();
  ctx.moveTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.bRight.x, p.bRight.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.closePath();
  ctx.fill();

  // 3. Lighter top edge rail
  ctx.fillStyle = FENCE_COLOR_TOP;
  ctx.beginPath();
  ctx.moveTo(p.tBack.x, p.tBack.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // 4. Delicate vertical picket/board divisions along the fence length
  if (pickets.length > 0) {
    ctx.strokeStyle = FENCE_PICKET_SEAM;
    ctx.lineWidth = 0.8 * invScale;
    ctx.beginPath();
    for (let i = 0; i < pickets.length; i++) {
      const pk = pickets[i];
      ctx.moveTo(pk.x, pk.yBottom);
      ctx.lineTo(pk.x, pk.yTop);
    }
    ctx.stroke();
  }

  // 5. Crisp inner ridge separating top rail from vertical plank wall
  ctx.strokeStyle = FENCE_RIDGE_SEAM;
  ctx.lineWidth = 0.7 * invScale;
  ctx.beginPath();
  ctx.moveTo(p.tLeft.x, p.tLeft.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.stroke();

  // 6. Stylized dark wood outer contour (~1.1px)
  ctx.strokeStyle = FENCE_OUTLINE;
  ctx.lineWidth = 1.1 * invScale;
  ctx.beginPath();
  ctx.moveTo(p.tBack.x, p.tBack.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.bRight.x, p.bRight.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.bLeft.x, p.bLeft.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.stroke();
}

function drawFencePost3D(
  ctx: CanvasRenderingContext2D,
  post: FencePost3D,
  invScale: number
) {
  const { prism: p } = post;

  // 1. Left face (along u)
  ctx.fillStyle = FENCE_COLOR_U;
  ctx.beginPath();
  ctx.moveTo(p.bLeft.x, p.bLeft.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // 2. Right face (along v)
  ctx.fillStyle = FENCE_COLOR_V;
  ctx.beginPath();
  ctx.moveTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.bRight.x, p.bRight.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.closePath();
  ctx.fill();

  // 3. Brighter wooden cap
  ctx.fillStyle = FENCE_COLOR_TOP;
  ctx.beginPath();
  ctx.moveTo(p.tBack.x, p.tBack.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // 4. Subtle front top ridge & vertical corner crease
  ctx.strokeStyle = FENCE_RIDGE_SEAM;
  ctx.lineWidth = 0.75 * invScale;
  ctx.beginPath();
  ctx.moveTo(p.tLeft.x, p.tLeft.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.moveTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.stroke();

  // 5. Crisp dark wood outer contour
  ctx.strokeStyle = FENCE_OUTLINE;
  ctx.lineWidth = 1.15 * invScale;
  ctx.beginPath();
  ctx.moveTo(p.tBack.x, p.tBack.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.bRight.x, p.bRight.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.bLeft.x, p.bLeft.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.stroke();
}

export const BUILDING_SPRITE_SCALE = 1.25;
const BUILDING_SPRITE_PAD = 3;
const BUILDING_SPRITE_INV_SCALE = 1 / Math.sqrt(1.65);

export interface BuildingSprite {
  id: string;
  /** Shared Texture Atlas sheet canvas (<= 2048x2048 px) */
  sheet: HTMLCanvasElement;
  sheetIndex: number;
  /** Source crop rectangle in atlas pixel coordinates */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** World X offset from building footprint center (anchorX) to top-left corner of sprite */
  offsetX: number;
  /** World Y offset from building footprint center (anchorY) to top-left corner of sprite */
  offsetY: number;
  /** World-space sprite width corresponding exactly to sw / scale */
  worldWidth: number;
  /** World-space sprite height corresponding exactly to sh / scale */
  worldHeight: number;
  /** Rasterization supersampling scale */
  scale: number;
}

export interface BuildingSpriteCache {
  key: string;
  sheets: HTMLCanvasElement[];
  sprites: Map<string, BuildingSprite>;
}

export const FENCE_SPRITE_SCALE = 1.25;
const FENCE_SPRITE_PAD = 2;
const FENCE_SPRITE_INV_SCALE = 1 / Math.sqrt(1.65);

export interface FenceSprite {
  id: string;
  /** Shared Texture Atlas sheet canvas (<= 2048x2048 px) */
  sheet: HTMLCanvasElement;
  sheetIndex: number;
  /** Source crop rectangle in atlas pixel coordinates */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** World-space anchor X of the fence element (footprint center) */
  anchorX: number;
  /** World-space anchor Y of the fence element (footprint center) */
  anchorY: number;
  /** World X offset from anchorX to top-left corner of sprite */
  offsetX: number;
  /** World Y offset from anchorY to top-left corner of sprite */
  offsetY: number;
  /** World-space sprite width corresponding exactly to sw / scale */
  worldWidth: number;
  /** World-space sprite height corresponding exactly to sh / scale */
  worldHeight: number;
  scale: number;
}

export interface FenceSpriteCache {
  sheets: HTMLCanvasElement[];
  segments: Map<string, FenceSprite>;
  cornerPost: FenceSprite | null;
  gatePost: FenceSprite | null;
}

/**
 * Unified Texture Atlas storing all pre-rendered 3D buildings and yard fences
 * packed row-by-row into 1–2 shared HTMLCanvasElement sheets (<= 2048x2048 px each).
 */
export interface SceneSpriteAtlas {
  key: string;
  sheets: HTMLCanvasElement[];
  buildings: BuildingSpriteCache;
  fences: FenceSpriteCache;
}

function disposeAtlasSheets(sheets: readonly HTMLCanvasElement[]) {
  for (let i = 0; i < sheets.length; i++) {
    sheets[i].width = 0;
    sheets[i].height = 0;
  }
}

export function disposeBuildingSpriteCache(cache: BuildingSpriteCache | null) {
  if (!cache) return;
  disposeAtlasSheets(cache.sheets);
  cache.sheets.length = 0;
  cache.sprites.clear();
}

export function disposeFenceSpriteCache(cache: FenceSpriteCache | null) {
  if (!cache) return;
  disposeAtlasSheets(cache.sheets);
  cache.sheets.length = 0;
  cache.segments.clear();
  cache.cornerPost = null;
  cache.gatePost = null;
}

export function disposeSceneSpriteAtlas(atlas: SceneSpriteAtlas | null) {
  if (!atlas) return;
  disposeAtlasSheets(atlas.sheets);
  atlas.sheets.length = 0;
  atlas.buildings.sheets.length = 0;
  atlas.buildings.sprites.clear();
  atlas.fences.sheets.length = 0;
  atlas.fences.segments.clear();
  atlas.fences.cornerPost = null;
  atlas.fences.gatePost = null;
}

/**
 * Vector rasterizer for a single 3D isometric building volume (walls, roof, architectural edges).
 * Used once per unique building archetype during atlas baking (and as fallback without an atlas).
 */
function drawBuilding3DVector(
  ctx: CanvasRenderingContext2D,
  b: Building,
  p: BuildingPrismPoints,
  invScale: number
) {
  const palette = getBuildingPalette(b.typ, b.colorVariant);

  // 1. Left wall (SW-facing, mid-lit)
  ctx.fillStyle = palette.leftWall;
  ctx.beginPath();
  ctx.moveTo(p.bLeft.x, p.bLeft.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // 2. Right wall (SE-facing, darker shadow side for crisp 3D volume)
  ctx.fillStyle = palette.rightWall;
  ctx.beginPath();
  ctx.moveTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.bRight.x, p.bRight.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.closePath();
  ctx.fill();

  // 3. Roof top face (brightest surface)
  ctx.fillStyle = palette.roof;
  ctx.beginPath();
  ctx.moveTo(p.tBack.x, p.tBack.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // Subtle roof edge highlight + crisp architectural ridge crease
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.lineWidth = 1.15 * invScale;
  ctx.beginPath();
  ctx.moveTo(p.tLeft.x, p.tLeft.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.stroke();

  // Vertical corner seam between left and right walls
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
  ctx.lineWidth = 1.05 * invScale;
  ctx.beginPath();
  ctx.moveTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.stroke();

  // Clean outer silhouette hairline so wall-to-wall touching blocks separate crisply
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.44)';
  ctx.lineWidth = 1.1 * invScale;
  ctx.beginPath();
  ctx.moveTo(p.tBack.x, p.tBack.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.bRight.x, p.bRight.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.bLeft.x, p.bLeft.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.stroke();
}

type AtlasBakeJob =
  | {
      kind: 'building';
      slotId: string;
      item: PrecomputedBuilding3D;
      bounds: BuildingSpriteBounds;
      scale: number;
    }
  | {
      kind: 'fenceSegment';
      slotId: string;
      segment: FenceSegment3D;
      bounds: FenceSpriteAnchorBounds;
      scale: number;
    }
  | {
      kind: 'fencePost';
      slotId: string;
      post: FencePost3D;
      bounds: FenceSpriteAnchorBounds;
      scale: number;
    };

function bakeAtlasJobs(
  jobs: readonly AtlasBakeJob[],
  maxSheetSize = SPRITE_ATLAS_MAX_SIZE,
  gutter = SPRITE_ATLAS_GUTTER
): {
  sheets: HTMLCanvasElement[];
  slots: Map<string, { sheet: HTMLCanvasElement; sheetIndex: number; sx: number; sy: number; sw: number; sh: number }>;
} {
  if (jobs.length === 0) {
    return { sheets: [], slots: new Map() };
  }

  const inputs: SpriteAtlasRectInput[] = new Array(jobs.length);
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    inputs[i] = {
      id: job.slotId,
      pixelWidth: Math.max(1, Math.ceil(job.bounds.worldWidth * job.scale)),
      pixelHeight: Math.max(1, Math.ceil(job.bounds.worldHeight * job.scale)),
    };
  }

  const packed = packSpritesIntoAtlasSheets(inputs, maxSheetSize, gutter);
  const sheets: HTMLCanvasElement[] = new Array(packed.sheets.length);
  const sheetContexts: Array<CanvasRenderingContext2D | null> = new Array(packed.sheets.length);

  for (let i = 0; i < packed.sheets.length; i++) {
    const spec = packed.sheets[i];
    const sheet = document.createElement('canvas');
    sheet.width = spec.width;
    sheet.height = spec.height;
    sheets[i] = sheet;
    sheetContexts[i] = sheet.getContext('2d');
  }

  const slots = new Map<
    string,
    { sheet: HTMLCanvasElement; sheetIndex: number; sx: number; sy: number; sw: number; sh: number }
  >();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const placement = packed.slots.get(job.slotId);
    if (!placement) continue;

    const sheet = sheets[placement.sheetIndex];
    const sCtx = sheetContexts[placement.sheetIndex];
    if (sCtx) {
      sCtx.save();
      sCtx.beginPath();
      sCtx.rect(placement.sx, placement.sy, placement.sw, placement.sh);
      sCtx.clip();
      sCtx.setTransform(
        job.scale,
        0,
        0,
        job.scale,
        placement.sx - job.bounds.minX * job.scale,
        placement.sy - job.bounds.minY * job.scale
      );
      sCtx.lineJoin = 'round';

      if (job.kind === 'building') {
        drawBuilding3DVector(sCtx, job.item.building, job.item.prism, BUILDING_SPRITE_INV_SCALE);
      } else if (job.kind === 'fenceSegment') {
        drawFenceSegment3D(sCtx, job.segment, FENCE_SPRITE_INV_SCALE);
      } else {
        drawFencePost3D(sCtx, job.post, FENCE_SPRITE_INV_SCALE);
      }

      sCtx.restore();
    }

    slots.set(job.slotId, {
      sheet,
      sheetIndex: placement.sheetIndex,
      sx: placement.sx,
      sy: placement.sy,
      sw: placement.sw,
      sh: placement.sh,
    });
  }

  return { sheets, slots };
}

/**
 * Packs all 3D buildings and residential yard fences together into 1–2 shared
 * row-packed HTMLCanvasElement Texture Atlas sheets (<= 2048x2048 px each).
 * Eliminates hundreds of separate canvas allocations while preserving exact Z-sorting.
 */
export function buildSceneSpriteAtlas(
  buildings: Building[],
  key: string,
  scale = BUILDING_SPRITE_SCALE,
  previousAtlas?: SceneSpriteAtlas | null
): SceneSpriteAtlas {
  if (previousAtlas) {
    disposeSceneSpriteAtlas(previousAtlas);
  }

  const staticScene = getStaticScene3DOrder(buildings);
  const jobs: AtlasBakeJob[] = [];

  const buildingArchetypeToSlot = new Map<
    string,
    { slotId: string; bounds: BuildingSpriteBounds }
  >();
  const buildingInstances: Array<{ id: string; archetypeKey: string }> = [];

  const fenceArchetypeToSlot = new Map<
    string,
    { slotId: string; bounds: FenceSpriteAnchorBounds }
  >();
  const fenceInstances: Array<{
    id: string;
    archetypeKey: string;
    anchorX: number;
    anchorY: number;
  }> = [];

  let cornerPostBounds: FenceSpriteAnchorBounds | null = null;
  let gatePostBounds: FenceSpriteAnchorBounds | null = null;

  for (let i = 0; i < staticScene.length; i++) {
    const entry = staticScene[i];
    if (entry.kind === 'building') {
      const archetypeKey = getBuildingSpriteArchetypeKey(entry.item.building);
      if (!buildingArchetypeToSlot.has(archetypeKey)) {
        const slotId = `b:${buildingArchetypeToSlot.size}`;
        const bounds = computeCenteredBuildingSpriteBounds(
          entry.item.prism,
          entry.item.anchorX,
          entry.item.anchorY,
          BUILDING_SPRITE_PAD
        );
        buildingArchetypeToSlot.set(archetypeKey, { slotId, bounds });
        jobs.push({ kind: 'building', slotId, item: entry.item, bounds, scale });
      }
      buildingInstances.push({ id: entry.id, archetypeKey });
    } else if (entry.kind === 'fenceSegment') {
      const seg = entry.segment;
      const anchorX = (seg.prism.bLeft.x + seg.prism.bRight.x) * 0.5;
      const anchorY = (seg.prism.bBack.y + seg.prism.bFront.y) * 0.5;
      const archetypeKey = getFenceSegmentArchetypeKey(seg.prism, seg.pickets);
      if (!fenceArchetypeToSlot.has(archetypeKey)) {
        const slotId = `f:${fenceArchetypeToSlot.size}`;
        const bounds = computeCenteredFenceSpriteBounds(seg.prism, FENCE_SPRITE_PAD);
        fenceArchetypeToSlot.set(archetypeKey, { slotId, bounds });
        jobs.push({ kind: 'fenceSegment', slotId, segment: seg, bounds, scale });
      }
      fenceInstances.push({ id: entry.id, archetypeKey, anchorX, anchorY });
    } else if (entry.kind === 'fencePost') {
      if (entry.post.isGatePost) {
        if (!gatePostBounds) {
          gatePostBounds = computeCenteredFenceSpriteBounds(entry.post.prism, FENCE_SPRITE_PAD);
          jobs.push({
            kind: 'fencePost',
            slotId: 'p:gate',
            post: entry.post,
            bounds: gatePostBounds,
            scale,
          });
        }
      } else if (!cornerPostBounds) {
        cornerPostBounds = computeCenteredFenceSpriteBounds(entry.post.prism, FENCE_SPRITE_PAD);
        jobs.push({
          kind: 'fencePost',
          slotId: 'p:corner',
          post: entry.post,
          bounds: cornerPostBounds,
          scale,
        });
      }
    }
  }

  const { sheets, slots } = bakeAtlasJobs(jobs);

  const buildingSprites = new Map<string, BuildingSprite>();
  for (let i = 0; i < buildingInstances.length; i++) {
    const inst = buildingInstances[i];
    const meta = buildingArchetypeToSlot.get(inst.archetypeKey);
    if (!meta) continue;
    const slot = slots.get(meta.slotId);
    if (!slot) continue;
    buildingSprites.set(inst.id, {
      id: inst.id,
      sheet: slot.sheet,
      sheetIndex: slot.sheetIndex,
      sx: slot.sx,
      sy: slot.sy,
      sw: slot.sw,
      sh: slot.sh,
      offsetX: meta.bounds.offsetX,
      offsetY: meta.bounds.offsetY,
      worldWidth: slot.sw / scale,
      worldHeight: slot.sh / scale,
      scale,
    });
  }

  const fenceSegments = new Map<string, FenceSprite>();
  for (let i = 0; i < fenceInstances.length; i++) {
    const inst = fenceInstances[i];
    const meta = fenceArchetypeToSlot.get(inst.archetypeKey);
    if (!meta) continue;
    const slot = slots.get(meta.slotId);
    if (!slot) continue;
    fenceSegments.set(inst.id, {
      id: inst.id,
      sheet: slot.sheet,
      sheetIndex: slot.sheetIndex,
      sx: slot.sx,
      sy: slot.sy,
      sw: slot.sw,
      sh: slot.sh,
      anchorX: inst.anchorX,
      anchorY: inst.anchorY,
      offsetX: meta.bounds.offsetX,
      offsetY: meta.bounds.offsetY,
      worldWidth: slot.sw / scale,
      worldHeight: slot.sh / scale,
      scale,
    });
  }

  const cornerSlot = slots.get('p:corner');
  const cornerPost: FenceSprite | null =
    cornerSlot && cornerPostBounds
      ? {
          id: 'fence_corner_post',
          sheet: cornerSlot.sheet,
          sheetIndex: cornerSlot.sheetIndex,
          sx: cornerSlot.sx,
          sy: cornerSlot.sy,
          sw: cornerSlot.sw,
          sh: cornerSlot.sh,
          anchorX: cornerPostBounds.anchorX,
          anchorY: cornerPostBounds.anchorY,
          offsetX: cornerPostBounds.offsetX,
          offsetY: cornerPostBounds.offsetY,
          worldWidth: cornerSlot.sw / scale,
          worldHeight: cornerSlot.sh / scale,
          scale,
        }
      : null;

  const gateSlot = slots.get('p:gate');
  const gatePost: FenceSprite | null =
    gateSlot && gatePostBounds
      ? {
          id: 'fence_gate_post',
          sheet: gateSlot.sheet,
          sheetIndex: gateSlot.sheetIndex,
          sx: gateSlot.sx,
          sy: gateSlot.sy,
          sw: gateSlot.sw,
          sh: gateSlot.sh,
          anchorX: gatePostBounds.anchorX,
          anchorY: gatePostBounds.anchorY,
          offsetX: gatePostBounds.offsetX,
          offsetY: gatePostBounds.offsetY,
          worldWidth: gateSlot.sw / scale,
          worldHeight: gateSlot.sh / scale,
          scale,
        }
      : null;

  return {
    key,
    sheets,
    buildings: {
      key,
      sheets,
      sprites: buildingSprites,
    },
    fences: {
      sheets,
      segments: fenceSegments,
      cornerPost,
      gatePost,
    },
  };
}

/**
 * Packs all 3D building sprites into shared <= 2048x2048 Texture Atlas sheets.
 * Rebuilt only when `warehouseTier` or `footprintOnly` changes.
 */
export function buildBuildingSpriteCache(
  buildings: Building[],
  key: string,
  scale = BUILDING_SPRITE_SCALE
): BuildingSpriteCache {
  const staticScene = getStaticScene3DOrder(buildings);
  const jobs: AtlasBakeJob[] = [];
  const archetypeToSlot = new Map<string, { slotId: string; bounds: BuildingSpriteBounds }>();
  const instances: Array<{ id: string; archetypeKey: string }> = [];

  for (let i = 0; i < staticScene.length; i++) {
    const entry = staticScene[i];
    if (entry.kind !== 'building') continue;
    const archetypeKey = getBuildingSpriteArchetypeKey(entry.item.building);
    if (!archetypeToSlot.has(archetypeKey)) {
      const slotId = `b:${archetypeToSlot.size}`;
      const bounds = computeCenteredBuildingSpriteBounds(
        entry.item.prism,
        entry.item.anchorX,
        entry.item.anchorY,
        BUILDING_SPRITE_PAD
      );
      archetypeToSlot.set(archetypeKey, { slotId, bounds });
      jobs.push({ kind: 'building', slotId, item: entry.item, bounds, scale });
    }
    instances.push({ id: entry.id, archetypeKey });
  }

  const { sheets, slots } = bakeAtlasJobs(jobs);
  const sprites = new Map<string, BuildingSprite>();
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    const meta = archetypeToSlot.get(inst.archetypeKey);
    if (!meta) continue;
    const slot = slots.get(meta.slotId);
    if (!slot) continue;
    sprites.set(inst.id, {
      id: inst.id,
      sheet: slot.sheet,
      sheetIndex: slot.sheetIndex,
      sx: slot.sx,
      sy: slot.sy,
      sw: slot.sw,
      sh: slot.sh,
      offsetX: meta.bounds.offsetX,
      offsetY: meta.bounds.offsetY,
      worldWidth: slot.sw / scale,
      worldHeight: slot.sh / scale,
      scale,
    });
  }

  return { key, sheets, sprites };
}

/**
 * Packs all residential yard fence segments and post archetypes into shared <= 2048x2048
 * Texture Atlas sheets for fast single-drawImage blitting.
 */
export function buildFenceSpriteCache(
  buildings: Building[],
  scale = FENCE_SPRITE_SCALE
): FenceSpriteCache {
  const staticScene = getStaticScene3DOrder(buildings);
  const jobs: AtlasBakeJob[] = [];
  const archetypeToSlot = new Map<string, { slotId: string; bounds: FenceSpriteAnchorBounds }>();
  const instances: Array<{
    id: string;
    archetypeKey: string;
    anchorX: number;
    anchorY: number;
  }> = [];

  let cornerPostBounds: FenceSpriteAnchorBounds | null = null;
  let gatePostBounds: FenceSpriteAnchorBounds | null = null;

  for (let i = 0; i < staticScene.length; i++) {
    const entry = staticScene[i];
    if (entry.kind === 'fenceSegment') {
      const seg = entry.segment;
      const anchorX = (seg.prism.bLeft.x + seg.prism.bRight.x) * 0.5;
      const anchorY = (seg.prism.bBack.y + seg.prism.bFront.y) * 0.5;
      const archetypeKey = getFenceSegmentArchetypeKey(seg.prism, seg.pickets);
      if (!archetypeToSlot.has(archetypeKey)) {
        const slotId = `f:${archetypeToSlot.size}`;
        const bounds = computeCenteredFenceSpriteBounds(seg.prism, FENCE_SPRITE_PAD);
        archetypeToSlot.set(archetypeKey, { slotId, bounds });
        jobs.push({ kind: 'fenceSegment', slotId, segment: seg, bounds, scale });
      }
      instances.push({ id: entry.id, archetypeKey, anchorX, anchorY });
    } else if (entry.kind === 'fencePost') {
      if (entry.post.isGatePost) {
        if (!gatePostBounds) {
          gatePostBounds = computeCenteredFenceSpriteBounds(entry.post.prism, FENCE_SPRITE_PAD);
          jobs.push({
            kind: 'fencePost',
            slotId: 'p:gate',
            post: entry.post,
            bounds: gatePostBounds,
            scale,
          });
        }
      } else if (!cornerPostBounds) {
        cornerPostBounds = computeCenteredFenceSpriteBounds(entry.post.prism, FENCE_SPRITE_PAD);
        jobs.push({
          kind: 'fencePost',
          slotId: 'p:corner',
          post: entry.post,
          bounds: cornerPostBounds,
          scale,
        });
      }
    }
  }

  const { sheets, slots } = bakeAtlasJobs(jobs);
  const segments = new Map<string, FenceSprite>();
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    const meta = archetypeToSlot.get(inst.archetypeKey);
    if (!meta) continue;
    const slot = slots.get(meta.slotId);
    if (!slot) continue;
    segments.set(inst.id, {
      id: inst.id,
      sheet: slot.sheet,
      sheetIndex: slot.sheetIndex,
      sx: slot.sx,
      sy: slot.sy,
      sw: slot.sw,
      sh: slot.sh,
      anchorX: inst.anchorX,
      anchorY: inst.anchorY,
      offsetX: meta.bounds.offsetX,
      offsetY: meta.bounds.offsetY,
      worldWidth: slot.sw / scale,
      worldHeight: slot.sh / scale,
      scale,
    });
  }

  const cornerSlot = slots.get('p:corner');
  const cornerPost: FenceSprite | null =
    cornerSlot && cornerPostBounds
      ? {
          id: 'fence_corner_post',
          sheet: cornerSlot.sheet,
          sheetIndex: cornerSlot.sheetIndex,
          sx: cornerSlot.sx,
          sy: cornerSlot.sy,
          sw: cornerSlot.sw,
          sh: cornerSlot.sh,
          anchorX: cornerPostBounds.anchorX,
          anchorY: cornerPostBounds.anchorY,
          offsetX: cornerPostBounds.offsetX,
          offsetY: cornerPostBounds.offsetY,
          worldWidth: cornerSlot.sw / scale,
          worldHeight: cornerSlot.sh / scale,
          scale,
        }
      : null;

  const gateSlot = slots.get('p:gate');
  const gatePost: FenceSprite | null =
    gateSlot && gatePostBounds
      ? {
          id: 'fence_gate_post',
          sheet: gateSlot.sheet,
          sheetIndex: gateSlot.sheetIndex,
          sx: gateSlot.sx,
          sy: gateSlot.sy,
          sw: gateSlot.sw,
          sh: gateSlot.sh,
          anchorX: gatePostBounds.anchorX,
          anchorY: gatePostBounds.anchorY,
          offsetX: gatePostBounds.offsetX,
          offsetY: gatePostBounds.offsetY,
          worldWidth: gateSlot.sw / scale,
          worldHeight: gateSlot.sh / scale,
          scale,
        }
      : null;

  return { sheets, segments, cornerPost, gatePost };
}

/**
 * Draws all buildings and 3D wooden yard fences in exact Painter's Algorithm back-to-front
 * order using the pre-sorted static scene cache and per-building / per-fence cached sprites,
 * dynamically interleaving only moving/interactive entities (bike rack, courier) per frame.
 */
export function renderBuildings3D(
  ctx: CanvasRenderingContext2D,
  buildings: Building[],
  selectedId: string | null,
  hoveredId: string | null,
  zoom: number,
  viewBounds?: WorldViewBounds,
  entities: DepthSortedEntity[] = [],
  spriteCache?: BuildingSpriteCache | null,
  fenceSpriteCache?: FenceSpriteCache | null
) {
  const invScale = 1 / Math.sqrt(zoom);
  const staticScene = getStaticScene3DOrder(buildings);

  const visible: StaticScene3DItem[] = [];
  for (let i = 0; i < staticScene.length; i++) {
    const entry = staticScene[i];
    if (
      viewBounds &&
      (entry.maxX < viewBounds.minX ||
        entry.minX > viewBounds.maxX ||
        entry.maxY < viewBounds.minY ||
        entry.minY > viewBounds.maxY)
    ) {
      continue;
    }
    visible.push(entry);
  }

  ctx.save();
  ctx.lineJoin = 'round';

  // Pass 1: Soft grounded cast shadows (strictly below all buildings, fences & vehicles)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.19)';
  ctx.beginPath();
  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i];
    const p =
      entry.kind === 'building'
        ? entry.item.prism
        : entry.kind === 'fenceSegment'
          ? entry.segment.prism
          : entry.post.prism;
    const sx =
      entry.kind === 'building'
        ? entry.item.sx
        : entry.kind === 'fenceSegment'
          ? entry.segment.sx
          : entry.post.sx;
    const sy =
      entry.kind === 'building'
        ? entry.item.sy
        : entry.kind === 'fenceSegment'
          ? entry.segment.sy
          : entry.post.sy;

    ctx.moveTo(p.bBack.x, p.bBack.y);
    ctx.lineTo(p.bBack.x + sx, p.bBack.y - sy);
    ctx.lineTo(p.bRight.x + sx, p.bRight.y - sy);
    ctx.lineTo(p.bFront.x + sx * 0.72, p.bFront.y - sy);
    ctx.lineTo(p.bFront.x, p.bFront.y);
    ctx.closePath();
  }
  ctx.fill();

  // Pass 2: Interleave ONLY dynamic entities (bike rack, courier) into the already-sorted
  // visible static list (buildings + 3D wooden yard fence panels & posts)
  const orderedScene = mergeEntitiesIntoBackToFrontOrder(visible, entities);
  const spriteMap = spriteCache?.sprites;
  const fenceSegmentMap = fenceSpriteCache?.segments;

  for (let i = 0; i < orderedScene.length; i++) {
    const sceneEntry = orderedScene[i];
    if (sceneEntry.kind === 'entity') {
      sceneEntry.entity.draw(ctx);
      continue;
    }

    const staticEntry = sceneEntry.item;
    if (staticEntry.kind === 'fenceSegment') {
      const segSprite = fenceSegmentMap?.get(staticEntry.id);
      if (segSprite) {
        const drawX = segSprite.anchorX + segSprite.offsetX;
        const drawY = segSprite.anchorY + segSprite.offsetY;
        if (
          !viewBounds ||
          (drawX + segSprite.worldWidth >= viewBounds.minX &&
            drawX <= viewBounds.maxX &&
            drawY + segSprite.worldHeight >= viewBounds.minY &&
            drawY <= viewBounds.maxY)
        ) {
          ctx.drawImage(
            segSprite.sheet,
            segSprite.sx,
            segSprite.sy,
            segSprite.sw,
            segSprite.sh,
            drawX,
            drawY,
            segSprite.worldWidth,
            segSprite.worldHeight
          );
        }
      } else {
        drawFenceSegment3D(ctx, staticEntry.segment, invScale);
      }
      continue;
    }
    if (staticEntry.kind === 'fencePost') {
      const post = staticEntry.post;
      const postSprite = fenceSpriteCache
        ? post.isGatePost
          ? fenceSpriteCache.gatePost
          : fenceSpriteCache.cornerPost
        : null;
      if (postSprite) {
        const postAnchorX = (post.prism.bLeft.x + post.prism.bRight.x) * 0.5;
        const postAnchorY = (post.prism.bBack.y + post.prism.bFront.y) * 0.5;
        const drawX = postAnchorX + postSprite.offsetX;
        const drawY = postAnchorY + postSprite.offsetY;
        if (
          !viewBounds ||
          (drawX + postSprite.worldWidth >= viewBounds.minX &&
            drawX <= viewBounds.maxX &&
            drawY + postSprite.worldHeight >= viewBounds.minY &&
            drawY <= viewBounds.maxY)
        ) {
          ctx.drawImage(
            postSprite.sheet,
            postSprite.sx,
            postSprite.sy,
            postSprite.sw,
            postSprite.sh,
            drawX,
            drawY,
            postSprite.worldWidth,
            postSprite.worldHeight
          );
        }
      } else {
        drawFencePost3D(ctx, post, invScale);
      }
      continue;
    }

    const { building: b, prism: p, anchorX, anchorY } = staticEntry.item;
    const sprite = spriteMap?.get(b.id);

    if (sprite) {
      const drawX = anchorX + sprite.offsetX;
      const drawY = anchorY + sprite.offsetY;
      if (
        !viewBounds ||
        (drawX + sprite.worldWidth >= viewBounds.minX &&
          drawX <= viewBounds.maxX &&
          drawY + sprite.worldHeight >= viewBounds.minY &&
          drawY <= viewBounds.maxY)
      ) {
        ctx.drawImage(
          sprite.sheet,
          sprite.sx,
          sprite.sy,
          sprite.sw,
          sprite.sh,
          drawX,
          drawY,
          sprite.worldWidth,
          sprite.worldHeight
        );
      }
    } else {
      drawBuilding3DVector(ctx, b, p, invScale);
    }

    const isSelected = b.id === selectedId;
    const isHovered = b.id === hoveredId;

    // Subtle roof tint & crisp outline when selected or hovered
    if (isSelected || isHovered) {
      ctx.fillStyle = isSelected
        ? 'rgba(251, 191, 36, 0.24)'
        : 'rgba(255, 255, 255, 0.14)';
      ctx.beginPath();
      ctx.moveTo(p.tBack.x, p.tBack.y);
      ctx.lineTo(p.tRight.x, p.tRight.y);
      ctx.lineTo(p.tFront.x, p.tFront.y);
      ctx.lineTo(p.tLeft.x, p.tLeft.y);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(p.tBack.x, p.tBack.y);
      ctx.lineTo(p.tRight.x, p.tRight.y);
      ctx.lineTo(p.bRight.x, p.bRight.y);
      ctx.lineTo(p.bFront.x, p.bFront.y);
      ctx.lineTo(p.bLeft.x, p.bLeft.y);
      ctx.lineTo(p.tLeft.x, p.tLeft.y);
      ctx.closePath();
      ctx.lineWidth = (isSelected ? 3.2 : 2.0) * invScale;
      ctx.strokeStyle = isSelected ? '#fbbf24' : 'rgba(248, 250, 252, 0.85)';
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draws discrete Polish street names rotated cleanly along the 2:1 isometric road axes
 * with subtle semi-transparent backing for crisp legibility.
 */
export function renderStreetNames(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  viewBounds?: WorldViewBounds
) {
  const invScale = 1 / Math.sqrt(zoom);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const label of STREET_LABEL_PLACEMENTS) {
    if (
      viewBounds &&
      (label.x < viewBounds.minX - 60 ||
        label.x > viewBounds.maxX + 60 ||
        label.y < viewBounds.minY - 30 ||
        label.y > viewBounds.maxY + 30)
    ) {
      continue;
    }
    const isAvenue = label.kind === 'avenue';
    const fontSize = Math.round((isAvenue ? 11.5 : 10) * invScale * 10) / 10;

    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(label.angle);

    ctx.font = `${isAvenue ? 700 : 600} ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
    const metrics = ctx.measureText(label.name);
    const padX = 6 * invScale;
    const padY = 2.6 * invScale;
    const boxW = metrics.width + padX * 2;
    const boxH = fontSize + padY * 2;
    const radius = 3.5 * invScale;

    ctx.fillStyle = isAvenue
      ? 'rgba(15, 23, 42, 0.78)'
      : 'rgba(15, 23, 42, 0.66)';
    ctx.beginPath();
    ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, radius);
    ctx.fill();

    ctx.strokeStyle = isAvenue
      ? 'rgba(250, 204, 21, 0.45)'
      : 'rgba(226, 232, 240, 0.25)';
    ctx.lineWidth = 1 * invScale;
    ctx.stroke();

    ctx.fillStyle = isAvenue ? '#fef9c3' : '#f1f5f9';
    ctx.fillText(label.name, 0, 0.5 * invScale);

    ctx.restore();
  }

  ctx.restore();
}

