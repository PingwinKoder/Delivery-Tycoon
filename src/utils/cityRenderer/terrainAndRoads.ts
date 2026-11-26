import type { RoadGraph } from '../../types/roadGraph';
import { translateStreetName } from '../../i18n/translations';
import type { SupportedLanguage } from '../settingsSystem';
import {
  type DeliveryZone,
  type HouseYardFence,
  type ParcelLockerSlot,
  type ParkingLot,
  type ServiceFacilitySpec,
  computeParkingLayout,
} from '../buildings';
import {
  ALL_STREETS,
  BASE_DEPOT,
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
} from '../cityMap';
import {
  PARKING_GROUND_STYLE,
  computeParkingLotPerimeterSegments,
  computeRectPerimeterWithGaps,
  groupContiguousStallRuns,
} from '../parkingLayout';
import type { ParkingNavNetwork } from '../parkingNavigation';
import { drawBaseYardMarkings } from './baseRenderer';
import {
  GROUND_PALETTE,
  STATIC_GRID_INV_SCALE,
  VIEWPORT_CAMERA_POS_EPSILON,
  VIEWPORT_CAMERA_ZOOM_EPSILON,
  drawHazardFrameBorder,
  drawHazardStripeRect,
  mulberry32,
  strokeContourSegments,
} from './helpers';
import type {
  ClampedDrawImageRect,
  GrassTuft,
  MeadowPatch,
  StaticGroundBuffer,
  StreetLabelPlacement,
  ViewportGroundCache,
  ViewportGroundUpdateParams,
  WorldViewBounds,
} from './types';

export const INTERSECTIONS: IntersectionInfo[] = getAllIntersections();

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

export const MEADOW_PATCHES: MeadowPatch[] = buildMeadowPatches();
export const GRASS_TUFTS: GrassTuft[] = buildGrassTufts();

export function drawGrassTuft(ctx: CanvasRenderingContext2D, tuft: GrassTuft) {
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

export function drawConcretePlot(
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
    drawBaseYardMarkings(ctx, baseDepot);
  }

  ctx.restore();
}

/**
 * Draws a sharp stylized isometric parking lot (warm curb, dark ink contour with open
 * driveway mouth, deep slate-graphite asphalt, and crisp white stall lines) in (u, v) space.
 */
export function drawParkingLot(
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
 * Draws the Central Bus Station ground infrastructure in isometric (u, v) coordinates
 * with sharp ink contours, deep slate asphalt, white bus bays, and crisp yellow-graphite stops.
 */
export function drawBusStationSurface(
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
export function drawDeliveryZone(ctx: CanvasRenderingContext2D, zone: DeliveryZone) {
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
 * Draws the static ground yard/forecourt for Mechanic Garage (service apron, cobblestone pad,
 * marked repair bays & hazard thresholds) and Gas Stations (asphalt forecourt, canopy concrete
 * apron, refueling lane guides & pedestrian crosswalk to cashier pavilion).
 * Baked once into the static ground buffer for 0 per-frame cost (60 FPS).
 */
export function drawServiceFacilityGround(
  ctx: CanvasRenderingContext2D,
  facility: ServiceFacilitySpec,
  asphaltFill: CanvasPattern | string
) {
  const { yard, driveway, buildingRect, kind } = facility;
  const uW = yard.uMax - yard.uMin;
  const vW = yard.vMax - yard.vMin;
  if (uW < 24 || vW < 24) return;

  ctx.save();

  // 1. Warm curb edging around yard perimeter
  ctx.fillStyle = PARKING_GROUND_STYLE.curbFill;
  ctx.fillRect(yard.uMin - 2.2, yard.vMin - 2.2, uW + 4.4, vW + 4.4);

  // 2. Curb-step inner shadow + textured slate-graphite asphalt yard
  ctx.fillStyle = GROUND_PALETTE.asphaltCurbShadow;
  ctx.fillRect(yard.uMin, yard.vMin, uW, vW);

  ctx.fillStyle = asphaltFill;
  ctx.fillRect(yard.uMin + 1.4, yard.vMin + 1.4, uW - 2.8, vW - 2.8);

  // 3. Sharp dark ink contours cleanly open at the driveway mouth
  const gap =
    driveway.entrySide === 'uMin' || driveway.entrySide === 'uMax'
      ? { side: driveway.entrySide, min: driveway.vMin, max: driveway.vMax }
      : { side: driveway.entrySide, min: driveway.uMin, max: driveway.uMax };

  const innerContour = computeRectPerimeterWithGaps(
    yard.uMin,
    yard.uMax,
    yard.vMin,
    yard.vMax,
    [gap]
  );
  const outerContour = computeRectPerimeterWithGaps(
    yard.uMin - 2.2,
    yard.uMax + 2.2,
    yard.vMin - 2.2,
    yard.vMax + 2.2,
    [gap]
  );
  strokeContourSegments(ctx, innerContour, PARKING_GROUND_STYLE.inkDark, 1.55);
  strokeContourSegments(ctx, outerContour, PARKING_GROUND_STYLE.inkOutline, 1.9);

  if (kind === 'mechanik') {
    // 4a. Interlocking cobblestone/concrete service apron directly in front of workshop bay doors (uMax wall)
    const apronUMin = buildingRect.uMax - 1;
    const apronUMax = Math.min(yard.uMax - 12, buildingRect.uMax + 40);
    const apronVMin = buildingRect.vMin - 4;
    const apronVMax = buildingRect.vMax + 4;
    const apronW = apronUMax - apronUMin;
    const apronH = apronVMax - apronVMin;

    ctx.fillStyle = '#8b939e';
    ctx.fillRect(apronUMin, apronVMin, apronW, apronH);

    // Crisp cobblestone paver grid lines
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.24)';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    for (let u = apronUMin + 6; u < apronUMax; u += 6) {
      ctx.moveTo(u, apronVMin);
      ctx.lineTo(u, apronVMax);
    }
    for (let v = apronVMin + 6; v < apronVMax; v += 6) {
      ctx.moveTo(apronUMin, v);
      ctx.lineTo(apronUMax, v);
    }
    ctx.stroke();

    ctx.strokeStyle = PARKING_GROUND_STYLE.inkOutline;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(apronUMin, apronVMin, apronW, apronH);

    // Two dedicated service bays directly facing the workshop roll-up doors
    const baySpanV = (buildingRect.vMax - buildingRect.vMin) * 0.5;
    const bayPadV = 7;
    const bayUMin = buildingRect.uMax + 4.5;
    const bayUMax = apronUMax - 3.5;

    // Yellow-and-graphite hazard threshold strip flush along the garage bay doors
    drawHazardStripeRect(
      ctx,
      buildingRect.uMax + 0.5,
      buildingRect.vMin + 4,
      3.4,
      buildingRect.vMax - buildingRect.vMin - 8,
      5.2,
      2.5
    );
    ctx.strokeStyle = GROUND_PALETTE.inkOutline;
    ctx.lineWidth = 0.95;
    ctx.strokeRect(
      buildingRect.uMax + 0.5,
      buildingRect.vMin + 4,
      3.4,
      buildingRect.vMax - buildingRect.vMin - 8
    );

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.88)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      const bV0 = buildingRect.vMin + i * baySpanV + bayPadV;
      const bV1 = buildingRect.vMin + (i + 1) * baySpanV - bayPadV;
      ctx.strokeRect(bayUMin, bV0, bayUMax - bayUMin, bV1 - bV0);
    }

    // Service waiting bay along the far side of the asphalt apron (near vMax corner)
    const waitUMin = apronUMax + 4;
    const waitUMax = yard.uMax - 6;
    const waitVMin = yard.vMax - 36;
    const waitVMax = yard.vMax - 8;
    if (waitUMax - waitUMin >= 14) {
      ctx.strokeStyle = PARKING_GROUND_STYLE.stallLine;
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.moveTo(waitUMin, waitVMin);
      ctx.lineTo(waitUMax, waitVMin);
      ctx.lineTo(waitUMax, waitVMax);
      ctx.lineTo(waitUMin, waitVMax);
      ctx.stroke();
    }

    // Subtle yellow dashed approach guide line leading from ul. Lipowa driveway mouth onto the apron
    const dwMidV = (driveway.vMin + driveway.vMax) * 0.5;
    ctx.strokeStyle = GROUND_PALETTE.markingYellow;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(yard.uMax - 2, dwMidV);
    ctx.lineTo(apronUMax + 1, dwMidV);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // 4b. Gas station forecourt concrete refueling pad directly beneath the canopy
    const padUMin = buildingRect.uMin - 8;
    const padUMax = buildingRect.uMax + 8;
    const padVMin = buildingRect.vMin - 10;
    const padVMax = buildingRect.vMax + 4;

    ctx.fillStyle = 'rgba(203, 213, 225, 0.16)';
    ctx.fillRect(padUMin, padVMin, padUMax - padUMin, padVMax - padVMin);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.28)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(padUMin, padVMin, padUMax - padUMin, padVMax - padVMin);

    // Crisp white refueling lane guide lines & emerald-accent forecourt trim
    const laneMidV = buildingRect.vMin - 14;
    const laneMidU = buildingRect.uMin - 14;

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    if (driveway.axis === 'v') {
      // Driveway enters along vMin -> horizontal refueling lane along u
      const laneV = Math.max(yard.vMin + 12, laneMidV);
      ctx.moveTo(yard.uMin + 16, laneV);
      ctx.lineTo(yard.uMax - 16, laneV);
      // Entry stem from driveway
      const dwMidU = (driveway.uMin + driveway.uMax) * 0.5;
      ctx.moveTo(dwMidU, yard.vMin + 2);
      ctx.lineTo(dwMidU, laneV);
    } else {
      // Driveway enters along uMin -> vertical refueling lane along v
      const laneU = Math.max(yard.uMin + 14, laneMidU);
      ctx.moveTo(laneU, yard.vMin + 16);
      ctx.lineTo(laneU, yard.vMax - 16);
      // Entry stem from driveway
      const dwMidV = (driveway.vMin + driveway.vMax) * 0.5;
      ctx.moveTo(yard.uMin + 2, dwMidV);
      ctx.lineTo(laneU, dwMidV);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Small crisp white zebra crossing between canopy pump island and back cashier pavilion
    const crossU = (buildingRect.uMin + buildingRect.uMax) * 0.5;
    const crossV = buildingRect.vMax - 34;
    ctx.fillStyle = 'rgba(248, 250, 252, 0.72)';
    for (let offset = -10; offset <= 10; offset += 5) {
      ctx.fillRect(crossU + offset - 1.2, crossV - 2.6, 2.4, 5.2);
    }

    // Subtle green-white safety stop bar near the refueling stop point
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    if (driveway.axis === 'v') {
      ctx.moveTo(facility.stop.u - 12, facility.stop.v + 5);
      ctx.lineTo(facility.stop.u + 12, facility.stop.v + 5);
    } else {
      ctx.moveTo(facility.stop.u + 5, facility.stop.v - 12);
      ctx.lineTo(facility.stop.u + 5, facility.stop.v + 12);
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws a crisp cobblestone paver pad reserving space for a future parcel locker
 * with a clean dark ink contour matching the stylized ground treatment.
 */
export function drawParcelLockerSlot(ctx: CanvasRenderingContext2D, slot: ParcelLockerSlot) {
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

export function drawAccessRoadStrip(
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

export function drawAccessRoadSidewalkJoints(
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

export function drawAccessRoadMarkings(ctx: CanvasRenderingContext2D, road: ResidentialAccessRoad) {
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

export function drawStreetStrip(
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
export function drawStreetSidewalkJoints(ctx: CanvasRenderingContext2D, street: StreetSpec) {
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
export function drawRoundaboutSidewalkJoints(ctx: CanvasRenderingContext2D, rb: RoundaboutSpec) {
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
export function drawStreetCurbDetails(ctx: CanvasRenderingContext2D, street: StreetSpec) {
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

export function drawStreetMarkings(ctx: CanvasRenderingContext2D, street: StreetSpec) {
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

export function drawIntersectionCrosswalks(ctx: CanvasRenderingContext2D, ix: IntersectionInfo) {
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

export function drawRoundaboutDetails(
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
export function drawRoundaboutGrassTufts(
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
export function drawHouseYardWalkway(ctx: CanvasRenderingContext2D, yard: HouseYardFence) {
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

/**
 * Draws discrete Polish street names rotated cleanly along the 2:1 isometric road axes
 * with subtle semi-transparent backing for crisp legibility.
 */
export function renderStreetNames(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  viewBounds?: WorldViewBounds,
  language: SupportedLanguage = 'pl'
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
    const displayName = translateStreetName(language, label.name);
    const isAvenue = label.kind === 'avenue';
    const fontSize = Math.round((isAvenue ? 11.5 : 10) * invScale * 10) / 10;

    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(label.angle);

    ctx.font = `${isAvenue ? 700 : 600} ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
    const metrics = ctx.measureText(displayName);
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
    ctx.fillText(displayName, 0, 0.5 * invScale);

    ctx.restore();
  }

  ctx.restore();
}
