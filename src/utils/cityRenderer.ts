import type { Building } from '../types/building';
import {
  PARCEL_LOCKER_SLOTS,
  PROCEDURAL_DELIVERY_ZONES,
  PROCEDURAL_HOUSE_YARDS,
  PROCEDURAL_PARKING_LOTS,
  type DeliveryZone,
  type DepthSortedEntity,
  type FencePost3D,
  type FenceSegment3D,
  type HouseYardFence,
  type ParcelLockerSlot,
  type ParkingLot,
  type StaticScene3DItem,
  computeParkingLayout,
  getBuildingPalette,
  getBuildingPrismPoints,
  getStaticScene3DOrder,
  mergeEntitiesIntoBackToFrontOrder,
} from './buildings';
import {
  ALL_STREETS,
  BASE_DEPOT,
  BUS_STATION,
  CONCRETE_PLOTS,
  ISO_ORIGIN_X,
  ISO_ORIGIN_Y,
  MAP_HEIGHT,
  MAP_WIDTH,
  RESIDENTIAL_ACCESS_ROADS,
  ROUNDABOUTS,
  U_STREETS,
  V_STREETS,
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
  streetCoversValue,
} from './cityMap';

export interface ProceduralTextures {
  grassPattern: CanvasPattern | null;
  asphaltPattern: CanvasPattern | null;
  concretePattern: CanvasPattern | null;
}

const INTERSECTIONS: IntersectionInfo[] = getAllIntersections();

/** Deterministic PRNG for organic noise textures */
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
      const speck = rand() < speckleChance ? (rand() - 0.5) * grainAmp * 2.2 : 0;
      const delta = patch + fine + speck;

      const idx = (y * size + x) * 4;
      d[idx] = Math.max(0, Math.min(255, Math.round(baseRgb[0] + delta * 0.92)));
      d[idx + 1] = Math.max(0, Math.min(255, Math.round(baseRgb[1] + delta)));
      d[idx + 2] = Math.max(0, Math.min(255, Math.round(baseRgb[2] + delta * 0.85)));
      d[idx + 3] = 255;
    }
  }

  g.putImageData(img, 0, 0);
  return c;
}

export function createProceduralTextures(ctx: CanvasRenderingContext2D): ProceduralTextures {
  const grassCanvas = createNoisePatternCanvas(192, [104, 130, 68], 6.5, 9.0, 104729, 0.14);
  const asphaltCanvas = createNoisePatternCanvas(128, [68, 72, 78], 5.0, 3.0, 224737, 0.12);
  const concreteCanvas = createNoisePatternCanvas(128, [196, 198, 194], 3.8, 4.5, 350377, 0.06);

  return {
    grassPattern: ctx.createPattern(grassCanvas, 'repeat'),
    asphaltPattern: ctx.createPattern(asphaltCanvas, 'repeat'),
    concretePattern: ctx.createPattern(concreteCanvas, 'repeat'),
  };
}

function drawConcretePlot(
  ctx: CanvasRenderingContext2D,
  plot: ConcretePlot,
  concreteFill: CanvasPattern | string
) {
  const w = plot.uMax - plot.uMin;
  const h = plot.vMax - plot.vMin;

  // Flush textured concrete slab spanning all the way to the sidewalk edge (0 px grass strip)
  ctx.fillStyle = concreteFill;
  ctx.fillRect(plot.uMin, plot.vMin, w, h);

  // Subtle architectural expansion joint grid across the paved quarter
  ctx.save();
  ctx.strokeStyle = 'rgba(130, 136, 130, 0.22)';
  ctx.lineWidth = 1;
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

  // Subtle light pavement seam just inside the street sidewalk boundary
  ctx.strokeStyle = 'rgba(236, 240, 236, 0.42)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(plot.uMin + 1.5, plot.vMin + 1.5, w - 3, h - 3);

  // Special logistics yard markings on the BAZA plot
  if (plot.isBaseYard) {
    // Subtle dark concrete apron around BAZA loading zone
    ctx.fillStyle = 'rgba(71, 85, 105, 0.14)';
    ctx.fillRect(BASE_DEPOT.u - 44, BASE_DEPOT.v - 42, 92, 84);

    // Loading bay stripes in crisp logistics amber/white
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
    ctx.lineWidth = 2;
    ctx.strokeRect(BASE_DEPOT.u - 44, BASE_DEPOT.v - 42, 92, 84);

    // Parking bay dividers
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let offset = -24; offset <= 24; offset += 24) {
      ctx.moveTo(BASE_DEPOT.u + 24, BASE_DEPOT.v + offset);
      ctx.lineTo(BASE_DEPOT.u + 44, BASE_DEPOT.v + offset);
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws a clean isometric parking lot (darker asphalt-gray surface + crisp white stall lines)
 * in (u, v) coordinates directly on top of flush concrete quarters (markets, block courtyards, BAZA).
 */
function drawParkingLot(ctx: CanvasRenderingContext2D, lot: ParkingLot) {
  const uW = lot.uMax - lot.uMin;
  const vW = lot.vMax - lot.vMin;
  if (uW < 30 || vW < 30) return;

  ctx.save();

  // 1. Subtle curb frame around parking tarmac
  ctx.fillStyle = '#8b929a';
  ctx.fillRect(lot.uMin - 1.5, lot.vMin - 1.5, uW + 3, vW + 3);

  // 2. Darker gray parking asphalt surface (clearly distinct from light concrete slab)
  ctx.fillStyle = '#5d656f';
  ctx.fillRect(lot.uMin, lot.vMin, uW, vW);

  // Subtle lighter tarmac inner sheen
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(lot.uMin + 1.5, lot.vMin + 1.5, uW - 3, vW - 3);

  // 3. Crisp white isometric parking stall markings computed from shared layout
  //    (automatically omits 2–3 stalls at perpendicular driveway entrances & adds center islands)
  const layout = computeParkingLayout(lot);

  ctx.strokeStyle = 'rgba(241, 245, 249, 0.86)';
  ctx.lineWidth = 1.45;
  ctx.beginPath();

  const drawStallRow = (
    backCoord: number,
    openCoord: number,
    stalls: Array<{ start: number; end: number }>
  ) => {
    if (stalls.length === 0) return;

    // Group contiguous stalls so back lines break cleanly across driveway entrance cutouts
    let runStart = 0;
    while (runStart < stalls.length) {
      let runEnd = runStart;
      while (
        runEnd + 1 < stalls.length &&
        Math.abs(stalls[runEnd + 1].start - stalls[runEnd].end) < 0.5
      ) {
        runEnd++;
      }

      const segA = stalls[runStart].start;
      const segB = stalls[runEnd].end;

      if (layout.stallAxis === 'u') {
        ctx.moveTo(segA, backCoord);
        ctx.lineTo(segB, backCoord);
        for (let i = runStart; i <= runEnd; i++) {
          const s = stalls[i];
          ctx.moveTo(s.start, backCoord);
          ctx.lineTo(s.start, openCoord);
        }
        ctx.moveTo(segB, backCoord);
        ctx.lineTo(segB, openCoord);
      } else {
        ctx.moveTo(backCoord, segA);
        ctx.lineTo(backCoord, segB);
        for (let i = runStart; i <= runEnd; i++) {
          const s = stalls[i];
          ctx.moveTo(backCoord, s.start);
          ctx.lineTo(openCoord, s.start);
        }
        ctx.moveTo(backCoord, segB);
        ctx.lineTo(openCoord, segB);
      }

      runStart = runEnd + 1;
    }
  };

  for (const row of layout.outerRows) {
    drawStallRow(row.backCoord, row.openCoord, row.stalls);
  }

  ctx.stroke();

  // 4. Central back-to-back double-row island on larger parking lots (with wide perimeter driving aisles)
  if (layout.centerIsland) {
    const ci = layout.centerIsland;

    // Subtle dark-slate center divider median strip along the back-to-back spine
    ctx.fillStyle = '#474f59';
    if (layout.stallAxis === 'u') {
      ctx.fillRect(ci.alongMin, ci.spineCoord - 1.5, ci.alongMax - ci.alongMin, 3);
    } else {
      ctx.fillRect(ci.spineCoord - 1.5, ci.alongMin, 3, ci.alongMax - ci.alongMin);
    }

    ctx.strokeStyle = 'rgba(241, 245, 249, 0.88)';
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    drawStallRow(ci.spineCoord - 1.2, ci.rowAMin, ci.stalls);
    drawStallRow(ci.spineCoord + 1.2, ci.rowBMax, ci.stalls);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws the BAZA dedicated fleet parking lot directly from BASE_DEPOT.parking
 * so visual stalls align 1-to-1 with BASE_DEPOT.parking.spots coordinates.
 */
function drawBaseParking(ctx: CanvasRenderingContext2D, parking: BaseParkingSpec) {
  const uW = parking.uMax - parking.uMin;
  const vW = parking.vMax - parking.vMin;

  ctx.save();

  // Subtle curb border
  ctx.fillStyle = '#8b929a';
  ctx.fillRect(parking.uMin - 1.5, parking.vMin - 1.5, uW + 3, vW + 3);

  // Parking tarmac matching internal asphalt connector
  ctx.fillStyle = '#525a64';
  ctx.fillRect(parking.uMin, parking.vMin, uW, vW);

  // Subtle inner perimeter rim
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(parking.uMin + 1.5, parking.vMin + 1.5, uW - 3, vW - 3);

  // Stalls along vMax (facing -v open driving aisle so vehicles turn directly in from internal road)
  const padAlong = 5;
  const padDepth = 4;
  const stallDepth = 25;
  const startU = parking.uMin + padAlong;
  const endU = parking.uMax - padAlong;
  const count = parking.spots.length;
  const step = (endU - startU) / count;
  const rEnd = parking.vMax - padDepth;
  const rStart = rEnd - stallDepth;

  ctx.strokeStyle = 'rgba(241, 245, 249, 0.88)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startU, rEnd);
  ctx.lineTo(endU, rEnd);
  for (let i = 0; i <= count; i++) {
    const u = startU + i * step;
    ctx.moveTo(u, rStart);
    ctx.lineTo(u, rEnd);
  }
  ctx.stroke();

  // Subtle amber fleet bay stop line along the back edge of BAZA parking spots
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(startU + 2, rEnd - 2);
  ctx.lineTo(endU - 2, rEnd - 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws the Central Bus Station ground infrastructure in isometric (u, v) coordinates:
 *  - Spacious asphalt bus maneuvering yard with 6 oversized bus parking bays (23 x 48)
 *  - Circulation lane divider and crisp entry/exit directional arrows aligned with the separate driveways
 * (The expanded 2-story terminal hall sits directly along v = 210..336 with a dedicated side delivery bay.)
 */
function drawBusStationSurface(ctx: CanvasRenderingContext2D, station: BusStationSpec) {
  ctx.save();

  // 1. Asphalt bus parking & maneuvering yard
  const yard = station.asphaltYard;
  const yW = yard.uMax - yard.uMin;
  const yH = yard.vMax - yard.vMin;

  // Outer curb edge around the asphalt bus yard
  ctx.fillStyle = '#8b929a';
  ctx.fillRect(yard.uMin - 1.8, yard.vMin - 1.8, yW + 3.6, yH + 3.6);

  // Dark bus-yard asphalt tarmac
  ctx.fillStyle = '#4e5660';
  ctx.fillRect(yard.uMin, yard.vMin, yW, yH);

  // Subtle inner rim highlight
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
  ctx.lineWidth = 1.1;
  ctx.strokeRect(yard.uMin + 1.8, yard.vMin + 1.8, yW - 3.6, yH - 3.6);

  // 3. 6 oversized bus parking bays (23 x 48) clearly nested between Entry & Exit lanes
  if (station.busBays.length > 0) {
    const first = station.busBays[0];
    const last = station.busBays[station.busBays.length - 1];

    // Subtle darkened tarmac pad under the 6 bus bays
    ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
    ctx.fillRect(first.uMin, first.vMin, last.uMax - first.uMin, first.vMax - first.vMin);

    // Crisp white stall dividers (open toward +v maneuvering aisle)
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
    ctx.lineWidth = 1.75;
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

    // Amber wheel-stop lines inside each bus bay near the street-side back edge
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (const bay of station.busBays) {
      ctx.moveTo(bay.uMin + 3, bay.vMin + 4.5);
      ctx.lineTo(bay.uMax - 3, bay.vMin + 4.5);
    }
    ctx.stroke();
  }

  // 4. Bus circulation lane divider separating bay maneuvering aisle (v=104..156) & platform pull-through lane (v=156..204)
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.62)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(yard.uMin + 24, 156);
  ctx.lineTo(yard.uMax - 24, 156);
  ctx.stroke();
  ctx.setLineDash([]);

  // 5. Crisp painted road directional arrows for Entry (+v into yard) & Exit (-v onto al. Dworcowa)
  const drawDirectionalArrow = (cx: number, cy: number, dirV: 1 | -1, color: string) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.4;
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
  // Entry lane arrow pointing inward (+v)
  drawDirectionalArrow(entryCenterU, 82, 1, 'rgba(241, 245, 249, 0.85)');
  // Exit lane arrow pointing outward (-v)
  drawDirectionalArrow(exitCenterU, 82, -1, 'rgba(250, 204, 21, 0.88)');

  // Subtle horizontal circulation flow arrow along the platform pull-through lane (+u toward Exit)
  ctx.save();
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.72)';
  ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
  ctx.lineWidth = 2.2;
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
 * Draws a dedicated side loading/delivery zone (Strefa Dostaw) right next to a market
 * or the Bus Station with dark tarmac, yellow diagonal safety hatching, crisp amber frame,
 * and a clear vector parcel-delivery icon.
 */
function drawDeliveryZone(ctx: CanvasRenderingContext2D, zone: DeliveryZone) {
  const { bay, entryDir } = zone;
  const w = bay.uMax - bay.uMin;
  const h = bay.vMax - bay.vMin;
  if (w < 12 || h < 12) return;

  ctx.save();

  // 1. Subtle curb edging around the loading bay
  ctx.fillStyle = '#8b929a';
  ctx.fillRect(bay.uMin - 1.4, bay.vMin - 1.4, w + 2.8, h + 2.8);

  // 2. Dark loading-bay tarmac distinct from concrete plaza
  ctx.fillStyle = '#4a525c';
  ctx.fillRect(bay.uMin, bay.vMin, w, h);

  // 3. Yellow diagonal safety hatching clipped neatly inside the loading bay
  ctx.save();
  ctx.beginPath();
  ctx.rect(bay.uMin + 2, bay.vMin + 2, w - 4, h - 4);
  ctx.clip();

  ctx.strokeStyle = 'rgba(250, 204, 21, 0.48)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const span = w + h;
  for (let d = -h; d <= span; d += 7) {
    ctx.moveTo(bay.uMin + d, bay.vMin);
    ctx.lineTo(bay.uMin + d - h, bay.vMax);
  }
  ctx.stroke();
  ctx.restore();

  // 4. Crisp amber-yellow outer box outline
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.85;
  ctx.strokeRect(bay.uMin + 1.2, bay.vMin + 1.2, w - 2.4, h - 2.4);

  // 5. Central dark badge with crisp stylized parcel/delivery symbol + entry direction chevron
  const cu = (bay.uMin + bay.uMax) * 0.5;
  const cv = (bay.vMin + bay.vMax) * 0.5;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.fillRect(cu - 6.8, cv - 6.8, 13.6, 13.6);
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 1.3;
  ctx.strokeRect(cu - 6.8, cv - 6.8, 13.6, 13.6);

  // Stylized parcel box (crisp cross-taped carton icon in bright amber/cream)
  ctx.fillStyle = '#fde047';
  ctx.fillRect(cu - 4.0, cv - 4.0, 8.0, 8.0);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(cu - 4.0, cv);
  ctx.lineTo(cu + 4.0, cv);
  ctx.moveTo(cu, cv - 4.0);
  ctx.lineTo(cu, cv + 4.0);
  ctx.stroke();

  // Subtle amber directional chevron near the driveway entry side pointing into the bay
  const chevU = cu - entryDir.u * Math.min(w * 0.32, 11);
  const chevV = cv - entryDir.v * Math.min(h * 0.32, 11);
  const perpU = -entryDir.v;
  const perpV = entryDir.u;
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 1.8;
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
 * Draws a subtle dark cobblestone paver pad reserving space for a future parcel locker
 * (pure ground surface treatment, zero 3D extrusion).
 */
function drawParcelLockerSlot(ctx: CanvasRenderingContext2D, slot: ParcelLockerSlot) {
  const uW = slot.uMax - slot.uMin;
  const vW = slot.vMax - slot.vMin;

  ctx.save();

  // Outer recessed dark stone edging
  ctx.fillStyle = '#6f7780';
  ctx.fillRect(slot.uMin - 1.2, slot.vMin - 1.2, uW + 2.4, vW + 2.4);

  // Darker textured cobblestone/paver slab contrasting cleanly with light gray concrete
  ctx.fillStyle = '#8b939c';
  ctx.fillRect(slot.uMin, slot.vMin, uW, vW);

  // Fine cobblestone paver joint pattern
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.34)';
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

  // Crisp subtle inner framing border + corner alignment ticks
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.56)';
  ctx.lineWidth = 1.1;
  ctx.strokeRect(slot.uMin + 0.5, slot.vMin + 0.5, uW - 1, vW - 1);

  ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
  ctx.lineWidth = 1.25;
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

function drawAccessRoadMarkings(ctx: CanvasRenderingContext2D, road: ResidentialAccessRoad) {
  const startStreet = ALL_STREETS.find((s) => s.id === road.startStreetId);
  const endStreet = ALL_STREETS.find((s) => s.id === road.endStreetId);
  const trimStart = startStreet ? startStreet.asphaltWidth / 2 + startStreet.sidewalkWidth + 8 : 28;
  const trimEnd = endStreet ? endStreet.asphaltWidth / 2 + endStreet.sidewalkWidth + 8 : 28;
  const a = road.startCoord + trimStart;
  const b = road.endCoord - trimEnd;
  if (b - a < 24) return;

  ctx.save();
  // Thin white dashed 2-lane centerline for narrow residential street
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.72)';
  ctx.lineWidth = 1.25;
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

  // Crisp subtle yield/stop bars at both T-junction exits
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
  const halfBar = road.asphaltWidth / 2 - 2.5;
  if (road.axis === 'u') {
    ctx.fillRect(road.coord - halfBar, a - 4, halfBar * 2, 1.8);
    ctx.fillRect(road.coord - halfBar, b + 2.2, halfBar * 2, 1.8);
  } else {
    ctx.fillRect(a - 4, road.coord - halfBar, 1.8, halfBar * 2);
    ctx.fillRect(b + 2.2, road.coord - halfBar, 1.8, halfBar * 2);
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

function drawStreetMarkings(ctx: CanvasRenderingContext2D, street: StreetSpec) {
  const halfAsphalt = street.asphaltWidth / 2;

  for (const [sMin, sMax] of street.spans) {
    const intervals = getClearMarkingIntervals(street, sMin, sMax);
    if (intervals.length === 0) continue;

    // 1. Subtle white shoulder edge lines
    ctx.save();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const shoulder = halfAsphalt - 2.6;
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
      // 2. Crisp double yellow solid centerlines on main avenues
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const yellowOffset = 2.0;
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

      // 3. White dashed lane dividers on each half of the 4-lane avenue
      ctx.strokeStyle = 'rgba(241, 245, 249, 0.72)';
      ctx.lineWidth = 1.4;
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
      // Local streets: crisp white dashed centerline
      ctx.strokeStyle = 'rgba(241, 245, 249, 0.78)';
      ctx.lineWidth = 1.5;
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

  ctx.fillStyle = 'rgba(241, 245, 249, 0.9)';

  if (axis === 'u') {
    // Crossing a u-street (road runs along v), stripes run along v, arrayed across u
    for (let offset = -half + stripeWidth / 2; offset <= half - stripeWidth / 2 + 0.1; offset += step) {
      ctx.fillRect(centerU + offset - stripeWidth / 2, centerV - depth / 2, stripeWidth, depth);
    }
  } else {
    // Crossing a v-street (road runs along u), stripes run along u, arrayed across v
    for (let offset = -half + stripeWidth / 2; offset <= half - stripeWidth / 2 + 0.1; offset += step) {
      ctx.fillRect(centerU - depth / 2, centerV + offset - stripeWidth / 2, depth, stripeWidth);
    }
  }
}

function drawStopLine(
  ctx: CanvasRenderingContext2D,
  centerU: number,
  centerV: number,
  axis: 'u' | 'v',
  asphaltWidth: number
) {
  const half = asphaltWidth / 2 - 2.5;
  ctx.fillStyle = 'rgba(241, 245, 249, 0.78)';
  if (axis === 'u') {
    ctx.fillRect(centerU - half, centerV - 1.1, half * 2, 2.2);
  } else {
    ctx.fillRect(centerU - 1.1, centerV - half, 2.2, half * 2);
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
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.36)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.outerAsphaltRadius - 2.5, 0, Math.PI * 2);
  ctx.stroke();

  // 2. Dashed circular lane divider right on the roundabout driving centerline (ringRadius)
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.85)';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([10, 9]);
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 3. Yield dashed lines & crisp short centerline stubs where the 4 straight roads enter the roundabout ring
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 1.8;
  const stubStart = rb.outerAsphaltRadius + 4;
  const stubEnd = rb.outerSidewalkRadius + 5;
  ctx.beginPath();
  for (const off of [-2.0, 2.0]) {
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

  ctx.strokeStyle = 'rgba(241, 245, 249, 0.84)';
  ctx.lineWidth = 2.2;
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

  // 4. Crisp zebra crosswalks on all 4 straight symmetrical approaches
  const zebraDist = rb.outerSidewalkRadius + 14;
  drawZebraCrosswalk(ctx, rb.u - zebraDist, rb.v, 'v', 52);
  drawZebraCrosswalk(ctx, rb.u + zebraDist, rb.v, 'v', 52);
  drawZebraCrosswalk(ctx, rb.u, rb.v - zebraDist, 'u', 52);
  drawZebraCrosswalk(ctx, rb.u, rb.v + zebraDist, 'u', 52);

  // 5. Raised central concrete island curb
  ctx.fillStyle = '#9ca19b';
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.innerCurbRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(235, 238, 234, 0.65)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.innerCurbRadius - 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(40, 44, 48, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.innerCurbRadius, 0, Math.PI * 2);
  ctx.stroke();

  // 6. Green textured central grass island
  ctx.fillStyle = grassFill;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.islandRadius, 0, Math.PI * 2);
  ctx.fill();

  // Subtle manicured inner turf ring for depth
  ctx.strokeStyle = 'rgba(65, 86, 40, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(rb.u, rb.v, rb.islandRadius - 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws the subtle paving-stone garden walkway threshold across the open 12u gate gap
 * connecting the street sidewalk into each single-family house yard.
 * The 3D wooden picket fences and posts themselves are Z-sorted and extruded in renderBuildings3D.
 */
function drawHouseYardWalkway(ctx: CanvasRenderingContext2D, yard: HouseYardFence) {
  const { uMin, uMax, vMin, vMax, streetSide, gateMin, gateMax } = yard;

  const pathPad = 1.6;
  const g0 = gateMin + pathPad;
  const g1 = gateMax - pathPad;
  const pathReachIn = 8.5;
  const pathReachOut = 2.4;

  ctx.save();
  ctx.fillStyle = '#c5c7c1';
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.32)';
  ctx.lineWidth = 0.7;
  if (streetSide === 'uMin') {
    ctx.fillRect(uMin - pathReachOut, g0, pathReachIn + pathReachOut, g1 - g0);
    ctx.strokeRect(uMin - pathReachOut, g0, pathReachIn + pathReachOut, g1 - g0);
  } else if (streetSide === 'uMax') {
    ctx.fillRect(uMax - pathReachIn, g0, pathReachIn + pathReachOut, g1 - g0);
    ctx.strokeRect(uMax - pathReachIn, g0, pathReachIn + pathReachOut, g1 - g0);
  } else if (streetSide === 'vMin') {
    ctx.fillRect(g0, vMin - pathReachOut, g1 - g0, pathReachIn + pathReachOut);
    ctx.strokeRect(g0, vMin - pathReachOut, g1 - g0, pathReachIn + pathReachOut);
  } else {
    ctx.fillRect(g0, vMax - pathReachIn, g1 - g0, pathReachIn + pathReachOut);
    ctx.strokeRect(g0, vMax - pathReachIn, g1 - g0, pathReachIn + pathReachOut);
  }
  ctx.restore();
}

/**
 * Renders the entire procedural 2:1 orthographic isometric city map directly onto the canvas.
 * Must be called while the canvas transform is already in world/canvas pixel space (0..3200, 0..2000).
 */
export function renderProceduralCity(
  ctx: CanvasRenderingContext2D,
  textures: ProceduralTextures
) {
  const grassFill: CanvasPattern | string = textures.grassPattern ?? '#688244';
  const asphaltFill: CanvasPattern | string = textures.asphaltPattern ?? '#44484e';
  const concreteFill: CanvasPattern | string = textures.concretePattern ?? '#c4c6c2';

  ctx.save();

  // Clip strictly to the 3200x2000 rectangular map bounds
  ctx.beginPath();
  ctx.rect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  ctx.clip();

  // 1. Textured green terrain filling the entire 3200x2000 map
  ctx.fillStyle = grassFill;
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  // Apply pure 2:1 orthographic isometric transform:
  //   x = ISO_ORIGIN_X + 1.0 * u + 1.0 * v
  //   y = ISO_ORIGIN_Y + 0.5 * u - 0.5 * v
  ctx.transform(1, 0.5, 1, -0.5, ISO_ORIGIN_X, ISO_ORIGIN_Y);

  // 2. Flush concrete quarters (blocks, markets & BAZA right up to sidewalk edges)
  for (const plot of CONCRETE_PLOTS) {
    drawConcretePlot(ctx, plot, concreteFill);
  }

  // 2b. Isometric parking lots (markets & block courtyards) + BAZA fleet parking + Bus Station yard + Delivery zones
  for (const lot of PROCEDURAL_PARKING_LOTS) {
    drawParkingLot(ctx, lot);
  }
  drawBaseParking(ctx, BASE_DEPOT.parking);
  drawBusStationSurface(ctx, BUS_STATION);
  for (const dz of PROCEDURAL_DELIVERY_ZONES) {
    drawDeliveryZone(ctx, dz);
  }

  // 2c. 8 reserved parcel locker paver pads on free concrete plazas
  for (const slot of PARCEL_LOCKER_SLOTS) {
    drawParcelLockerSlot(ctx, slot);
  }

  // 3. Sidewalk outer curb dark border layer (streets + residential access roads + roundabouts + driveway)
  ctx.fillStyle = '#8b908a';
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + street.sidewalkWidth + 1.6);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + street.sidewalkWidth + 1.6);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2 + ar.sidewalkWidth + 1.4);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerSidewalkRadius + 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // BAZA straight driveway outer curb (stops cleanly at yard perimeter)
  {
    const dwHalf = BASE_DEPOT.drivewayAsphaltWidth / 2 + BASE_DEPOT.drivewaySidewalkWidth + 1.4;
    const dwEndU = BASE_DEPOT.yardUMin + 4;
    ctx.fillRect(
      BASE_DEPOT.exitU,
      BASE_DEPOT.v - dwHalf,
      dwEndU - BASE_DEPOT.exitU,
      dwHalf * 2
    );
  }

  // 4. Light gray sidewalk surface layer
  ctx.fillStyle = '#b9bdb8';
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

  // 4b. Subtle stone gate walkways at every single-family house yard entrance
  for (const yard of PROCEDURAL_HOUSE_YARDS) {
    drawHouseYardWalkway(ctx, yard);
  }

  // 5. Crisp curb inner highlight rim right next to asphalt
  ctx.fillStyle = '#d3d6d2';
  for (const street of U_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + 1.8);
  }
  for (const street of V_STREETS) {
    drawStreetStrip(ctx, street, street.asphaltWidth / 2 + 1.8);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadStrip(ctx, ar, ar.asphaltWidth / 2 + 1.5);
  }
  for (const rb of ROUNDABOUTS) {
    ctx.beginPath();
    ctx.arc(rb.u, rb.v, rb.outerAsphaltRadius + 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  {
    const dwHalf = BASE_DEPOT.drivewayAsphaltWidth / 2 + 1.8;
    const dwEndU = BASE_DEPOT.u - 36;
    ctx.fillRect(
      BASE_DEPOT.exitU,
      BASE_DEPOT.v - dwHalf,
      dwEndU - BASE_DEPOT.exitU,
      dwHalf * 2
    );
  }
  // Lateral-only curb edges along every parking lot driveway (leaving both lot and street mouths open)
  for (const lot of PROCEDURAL_PARKING_LOTS) {
    const d = lot.accessDriveway;
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin, d.vMin - 1.5, d.uMax - d.uMin, d.vMax - d.vMin + 3);
    } else {
      ctx.fillRect(d.uMin - 1.5, d.vMin, d.uMax - d.uMin + 3, d.vMax - d.vMin);
    }
  }
  // Lateral-only curb edges on BAZA internal parking connector (stopping cleanly before BASE_DEPOT.parking mouth)
  for (const seg of BASE_DEPOT.parking.connectorSegments) {
    const uMaxTrim = Math.min(seg.uMax, BASE_DEPOT.parking.uMin - 1.5);
    const vMinTrim = Math.max(seg.vMin, BASE_DEPOT.v);
    if (uMaxTrim > seg.uMin) {
      ctx.fillRect(seg.uMin - 1.5, vMinTrim - 1.5, uMaxTrim - seg.uMin + 3, seg.vMax - vMinTrim + 3);
    }
  }
  // Lateral-only curb edges for Bus Station separate wide Entry & Exit driveways onto al. Dworcowa
  for (const bdw of [BUS_STATION.entryDriveway, BUS_STATION.exitDriveway]) {
    ctx.fillRect(bdw.uMin - 1.8, bdw.vMin, bdw.uMax - bdw.uMin + 3.6, bdw.vMax - bdw.vMin);
  }
  // Lateral-only curb edges for dedicated Delivery Zone driveways (markets & Bus Station)
  for (const dz of PROCEDURAL_DELIVERY_ZONES) {
    const d = dz.driveway;
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin, d.vMin - 1.5, d.uMax - d.uMin, d.vMax - d.vMin + 3);
    } else {
      ctx.fillRect(d.uMin - 1.5, d.vMin, d.uMax - d.uMin + 3, d.vMax - d.vMin);
    }
  }

  // 6. Dark textured asphalt roadway layer (streets + access roads + roundabouts + parking & delivery driveways + BAZA)
  ctx.fillStyle = asphaltFill;
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
  // Parking lot asphalt driveways cutting cleanly across sidewalks directly into street asphalt & opening lot rim
  for (const lot of PROCEDURAL_PARKING_LOTS) {
    const d = lot.accessDriveway;
    ctx.fillStyle = '#4e5660';
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin - 2.5, d.vMin, d.uMax - d.uMin + 5, d.vMax - d.vMin);
    } else {
      ctx.fillRect(d.uMin, d.vMin - 2.5, d.uMax - d.uMin, d.vMax - d.vMin + 5);
    }
  }
  // Bus Station separate wide Entry & Exit asphalt driveways cutting across al. Dworcowa sidewalk into bus yard
  for (const bdw of [BUS_STATION.entryDriveway, BUS_STATION.exitDriveway]) {
    ctx.fillStyle = '#4e5660';
    ctx.fillRect(bdw.uMin, bdw.vMin - 2.5, bdw.uMax - bdw.uMin, bdw.vMax - bdw.vMin + 6);
  }
  // Dedicated Delivery Zone asphalt driveways cutting directly from adjacent street into each loading bay
  for (const dz of PROCEDURAL_DELIVERY_ZONES) {
    const d = dz.driveway;
    ctx.fillStyle = '#4a525c';
    if (d.axis === 'u') {
      ctx.fillRect(d.uMin - 2.5, d.vMin, d.uMax - d.uMin + 5, d.vMax - d.vMin);
    } else {
      ctx.fillRect(d.uMin, d.vMin - 2.5, d.uMax - d.uMin, d.vMax - d.vMin + 5);
    }
    // Crisp amber dashed centerline guide marking dedicated loading-zone access
    ctx.save();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.78)';
    ctx.lineWidth = 1.4;
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
  // BAZA internal asphalt road directly connecting BAZA courier driveway into BASE_DEPOT.parking (open entrance)
  ctx.fillStyle = asphaltFill;
  for (const seg of BASE_DEPOT.parking.connectorSegments) {
    const extU = seg.uMax >= BASE_DEPOT.parking.uMin - 1 ? 3 : 0;
    ctx.fillRect(seg.uMin, seg.vMin, seg.uMax - seg.uMin + extU, seg.vMax - seg.vMin);
  }
  // BAZA straight asphalt driveway connecting yard cleanly onto Central Main Avenue
  {
    const dwHalf = BASE_DEPOT.drivewayAsphaltWidth / 2;
    const dwEndU = BASE_DEPOT.u - 10;
    ctx.fillRect(
      BASE_DEPOT.exitU,
      BASE_DEPOT.v - dwHalf,
      dwEndU - BASE_DEPOT.exitU,
      dwHalf * 2
    );
  }

  // 7. Street lane markings (avenues, local streets, and narrow 2-lane residential access roads)
  for (const street of U_STREETS) {
    drawStreetMarkings(ctx, street);
  }
  for (const street of V_STREETS) {
    drawStreetMarkings(ctx, street);
  }
  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    drawAccessRoadMarkings(ctx, ar);
  }

  // BAZA driveway & internal fleet parking connector dashed amber guide lines
  ctx.save();
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.78)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(BASE_DEPOT.exitU + 28, BASE_DEPOT.v);
  ctx.lineTo(BASE_DEPOT.u - 16, BASE_DEPOT.v);
  // Branch line leading neatly from BAZA courier driveway into the fleet parking lot
  ctx.moveTo(82, BASE_DEPOT.v);
  ctx.lineTo(82, -843);
  ctx.lineTo(128, -843);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(241, 245, 249, 0.75)';
  ctx.fillRect(BASE_DEPOT.exitU + 28, BASE_DEPOT.v - 10, 2, 20);
  ctx.restore();

  // 8. Crisp white zebra crosswalks & stop lines at every regular intersection
  for (const ix of INTERSECTIONS) {
    drawIntersectionCrosswalks(ctx, ix);
  }

  // 9. Roundabout circular dashed markings, yield bars, approach zebras & central green islands
  for (const rb of ROUNDABOUTS) {
    drawRoundaboutDetails(ctx, rb, grassFill);
  }

  ctx.restore();
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

/**
 * Draws all buildings and 3D wooden yard fences as clean 3D orthographic isometric prisms
 * in exact Painter's Algorithm back-to-front order using the pre-sorted static scene cache,
 * dynamically interleaving only moving/interactive entities (bike rack, courier) per frame.
 */
export function renderBuildings3D(
  ctx: CanvasRenderingContext2D,
  buildings: Building[],
  selectedId: string | null,
  hoveredId: string | null,
  zoom: number,
  viewBounds?: WorldViewBounds,
  entities: DepthSortedEntity[] = []
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
  for (let i = 0; i < orderedScene.length; i++) {
    const sceneEntry = orderedScene[i];
    if (sceneEntry.kind === 'entity') {
      sceneEntry.entity.draw(ctx);
      continue;
    }

    const staticEntry = sceneEntry.item;
    if (staticEntry.kind === 'fenceSegment') {
      drawFenceSegment3D(ctx, staticEntry.segment, invScale);
      continue;
    }
    if (staticEntry.kind === 'fencePost') {
      drawFencePost3D(ctx, staticEntry.post, invScale);
      continue;
    }

    const { building: b, prism: p } = staticEntry.item;
    const palette = getBuildingPalette(b.typ, b.colorVariant);
    const isSelected = b.id === selectedId;
    const isHovered = b.id === hoveredId;

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

