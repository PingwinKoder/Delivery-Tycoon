import type { Building } from '../../types/building';
import type { OwnedVan } from '../../types/orders';
import {
  type BuildingPrismPoints,
  type DepthSortedEntity,
  getBuildingPalette,
} from '../buildings';
import type { BaseDepotSpec, BaseParkingSpec } from '../cityMap';
import {
  PARKING_GROUND_STYLE,
  computeBaseParkingLayout,
  computeBaseParkingPerimeterSegments,
  getBaseParkedVanSlots,
} from '../parkingLayout';
import {
  GROUND_PALETTE,
  drawHazardFrameBorder,
  drawHazardStripeRect,
  strokeContourSegments,
} from './helpers';
import { createParkedVanDepthEntity } from './vehiclesAndTraffic';

/**
 * Draws special logistics yard markings on the player's BAZA plot:
 * industrial apron, yellow-graphite hazard frame, white loading bay dividers,
 * and dedicated loadingZone dock threshold strip.
 */
export function drawBaseYardMarkings(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec
) {
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

/**
 * Draws the BAZA dedicated fleet parking lot directly from baseDepot.parking
 * with sharp dark ink contours, crisp white stalls, and yellow-graphite wheel-stop bars.
 */
export function drawBaseParking(
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

  // 6. Subtle painted P1–P8 stall markings near the open aisle edge (baked once into static ground buffer)
  ctx.font = '700 6.5px "Plus Jakarta Sans", ui-monospace, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(248, 250, 252, 0.42)';
  for (const spot of parking.spots) {
    const labelV = spot.row === 0 ? spot.vMin + 5.2 : spot.vMax - 5.2;
    ctx.fillText(`P${spot.index}`, spot.u, labelV);
  }

  ctx.restore();
}

/**
 * BAZA straight driveway outer sidewalk ink border (stops cleanly at yard perimeter).
 */
export function drawBaseDrivewayOuterInk(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec
) {
  const dwHalf = baseDepot.drivewayAsphaltWidth / 2 + baseDepot.drivewaySidewalkWidth + 1.75;
  const dwEndU = baseDepot.yardUMin + 4;
  ctx.fillRect(
    baseDepot.exitU,
    baseDepot.v - dwHalf,
    dwEndU - baseDepot.exitU,
    dwHalf * 2
  );
}

/**
 * BAZA straight driveway warm cream-sand sidewalk strip.
 */
export function drawBaseDrivewaySidewalk(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec
) {
  const dwHalf = baseDepot.drivewayAsphaltWidth / 2 + baseDepot.drivewaySidewalkWidth;
  const dwEndU = baseDepot.yardUMin + 4;
  ctx.fillRect(
    baseDepot.exitU,
    baseDepot.v - dwHalf,
    dwEndU - baseDepot.exitU,
    dwHalf * 2
  );
}

/**
 * BAZA straight driveway dark ink curb contour.
 */
export function drawBaseDrivewayCurbInk(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec
) {
  const dwHalf = baseDepot.drivewayAsphaltWidth / 2 + 1.75;
  const dwEndU = baseDepot.u - 10;
  ctx.fillRect(
    baseDepot.exitU,
    baseDepot.v - dwHalf,
    dwEndU - baseDepot.exitU,
    dwHalf * 2
  );
}

/**
 * Lateral-only ink curb edges on BAZA internal parking connector (stopping cleanly at baseDepot.parking mouth).
 */
export function drawBaseParkingConnectorCurbInk(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec
) {
  for (const seg of baseDepot.parking.connectorSegments) {
    const uMaxTrim = Math.min(seg.uMax, baseDepot.parking.uMin - 1.5);
    const vMinTrim = Math.max(seg.vMin, baseDepot.v);
    if (uMaxTrim > seg.uMin) {
      ctx.fillRect(
        seg.uMin - 1.75,
        vMinTrim - 1.75,
        uMaxTrim - seg.uMin + 3.5,
        seg.vMax - vMinTrim + 3.5
      );
    }
  }
}

/**
 * BAZA internal asphalt road directly connecting BAZA courier driveway into baseDepot.parking (open entrance).
 */
export function drawBaseParkingConnectorAsphalt(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec,
  asphaltFill: CanvasPattern | string
) {
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
}

/**
 * BAZA straight asphalt driveway connecting yard cleanly onto Central Main Avenue.
 */
export function drawBaseDrivewayAsphalt(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec,
  asphaltFill: CanvasPattern | string
) {
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

/**
 * BAZA driveway & internal fleet parking connector dashed yellow guide lines and stop bar.
 */
export function drawBaseDrivewayMarkings(
  ctx: CanvasRenderingContext2D,
  baseDepot: BaseDepotSpec
) {
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
}

/**
 * Identifies the player's Base warehouse building so future visual upgrades
 * (tiered warehouse architecture, dock doors, signage) can be developed here.
 */
export function isBaseWarehouseBuilding(b: Building): boolean {
  return b.typ === 'baza';
}

/**
 * Dedicated 3D vector renderer for the player's Base warehouse building.
 * Preserves the exact isometric prism appearance while isolating Base building
 * visuals in baseRenderer.ts for future upgrades.
 */
export function drawBaseWarehouse3DVector(
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

  // Clean outer silhouette hairline
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

/**
 * Creates Z-sorted dynamic isometric entities for all company delivery vans currently parked
 * on Base fleet parking stalls (`P1–P8`), skipping `activeOutVanIndex` while that van is
 * out on a route. Keeps static ground caching (`viewportGroundCanvas`) completely untouched.
 */
export function createBaseParkedVanEntities(
  baseDepot: BaseDepotSpec,
  vansCount: number,
  activeOutVanIndex: number | null,
  ownedVans?: readonly OwnedVan[]
): DepthSortedEntity[] {
  const slots = getBaseParkedVanSlots(baseDepot.parking, vansCount, activeOutVanIndex);
  return slots.map((slot) => {
    const owned = ownedVans?.find((v) => v.index === slot.vanIndex);
    return createParkedVanDepthEntity({
      ...slot,
      condition: owned?.condition ?? 'used',
      tier: owned?.tier ?? 'standard',
    });
  });
}
