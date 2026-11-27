import type { Building } from '../../types/building';
import {
  SPRITE_ATLAS_GUTTER,
  SPRITE_ATLAS_MAX_SIZE,
  type BuildingPrismPoints,
  type BuildingSpriteBounds,
  type DepthSortedEntity,
  type FencePost3D,
  type FenceSegment3D,
  type SpriteAtlasRectInput,
  type StaticScene3DItem,
  type UrbanProp3D,
  computeCenteredBuildingSpriteBounds,
  getBuildingPalette,
  getBuildingPrismPoints,
  getBuildingSpriteArchetypeKey,
  getStaticScene3DOrder,
  mergeEntitiesIntoBackToFrontOrder,
  packSpritesIntoAtlasSheets,
} from '../buildings';
import { isoToCanvas } from '../cityMap';
import {
  type FenceSpriteAnchorBounds,
  computeCenteredFenceSpriteBounds,
  getFenceSegmentArchetypeKey,
} from '../houseQuarters';
import { drawBaseWarehouse3DVector, isBaseWarehouseBuilding } from './baseRenderer';
import {
  BUILDING_SPRITE_INV_SCALE,
  BUILDING_SPRITE_PAD,
  BUILDING_SPRITE_SCALE,
  FENCE_COLOR_TOP,
  FENCE_COLOR_U,
  FENCE_COLOR_V,
  FENCE_OUTLINE,
  FENCE_PICKET_SEAM,
  FENCE_RIDGE_SEAM,
  FENCE_SPRITE_INV_SCALE,
  FENCE_SPRITE_PAD,
  FENCE_SPRITE_SCALE,
  disposeAtlasSheets,
} from './helpers';
import type {
  AtlasBakeJob,
  BuildingSprite,
  BuildingSpriteCache,
  FenceSprite,
  FenceSpriteCache,
  SceneSpriteAtlas,
  WorldViewBounds,
} from './types';

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

function isoPtZ(u: number, v: number, z: number): { x: number; y: number } {
  const base = isoToCanvas(u, v);
  return { x: base.x, y: base.y - z };
}

function drawIsoQuad(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  fillStyle?: string,
  strokeStyle?: string,
  lineWidth = 1
) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  zBottom: number,
  zTop: number,
  colors: {
    roof: string;
    leftWall: string;
    rightWall: string;
    outline?: string;
    ridge?: string;
  },
  invScale: number,
  outlineWidth = 1.05
) {
  const bBack = isoPtZ(uMin, vMax, zBottom);
  const bLeft = isoPtZ(uMin, vMin, zBottom);
  const bRight = isoPtZ(uMax, vMax, zBottom);
  const bFront = isoPtZ(uMax, vMin, zBottom);
  const tBack = isoPtZ(uMin, vMax, zTop);
  const tLeft = isoPtZ(uMin, vMin, zTop);
  const tRight = isoPtZ(uMax, vMax, zTop);
  const tFront = isoPtZ(uMax, vMin, zTop);

  // Left wall (SW-facing, v = vMin)
  drawIsoQuad(ctx, [bLeft, bFront, tFront, tLeft], colors.leftWall);
  // Right wall (SE-facing, u = uMax)
  drawIsoQuad(ctx, [bFront, bRight, tRight, tFront], colors.rightWall);
  // Roof top face
  drawIsoQuad(ctx, [tBack, tRight, tFront, tLeft], colors.roof);

  // Subtle roof edge highlight
  if (colors.ridge !== 'none') {
    ctx.strokeStyle = colors.ridge ?? 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 0.95 * invScale;
    ctx.beginPath();
    ctx.moveTo(tLeft.x, tLeft.y);
    ctx.lineTo(tFront.x, tFront.y);
    ctx.lineTo(tRight.x, tRight.y);
    ctx.stroke();
  }

  // Front vertical crease
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.26)';
  ctx.lineWidth = 0.9 * invScale;
  ctx.beginPath();
  ctx.moveTo(tFront.x, tFront.y);
  ctx.lineTo(bFront.x, bFront.y);
  ctx.stroke();

  // Outer silhouette ink contour
  ctx.strokeStyle = colors.outline ?? 'rgba(15, 23, 42, 0.52)';
  ctx.lineWidth = outlineWidth * invScale;
  ctx.beginPath();
  ctx.moveTo(tBack.x, tBack.y);
  ctx.lineTo(tRight.x, tRight.y);
  ctx.lineTo(bRight.x, bRight.y);
  ctx.lineTo(bFront.x, bFront.y);
  ctx.lineTo(bLeft.x, bLeft.y);
  ctx.lineTo(tLeft.x, tLeft.y);
  ctx.closePath();
  ctx.stroke();

  return { bBack, bLeft, bRight, bFront, tBack, tLeft, tRight, tFront };
}

/**
 * Dedicated 3D isometric vector renderer for the Mechanic Garage (`b_mechanic_garage`).
 * Industrial steel-graphite service hall with orange-graphite fascia accent, two wide
 * roll-up service bay doors facing ul. Lipowa, side workshop windows, and roof skylights.
 */
function drawMechanicGarage3DVector(
  ctx: CanvasRenderingContext2D,
  b: Building,
  invScale: number
) {
  const wallH = Math.max(20, b.height - 3);
  const { uMin, uMax, vMin, vMax } = b;

  // 1. Main steel-graphite industrial workshop prism
  drawIsoBox(
    ctx,
    uMin,
    uMax,
    vMin,
    vMax,
    0,
    wallH,
    {
      roof: '#3b4453',
      leftWall: '#5b6575',
      rightWall: '#434c5a',
      outline: 'rgba(15, 23, 42, 0.58)',
    },
    invScale,
    1.15
  );

  // 2. Signature orange-graphite upper accent fascia stripe on both visible walls
  const bandZ0 = wallH - 5.2;
  const bandZ1 = wallH - 1.6;
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMin, vMin, bandZ0),
      isoPtZ(uMax, vMin, bandZ0),
      isoPtZ(uMax, vMin, bandZ1),
      isoPtZ(uMin, vMin, bandZ1),
    ],
    '#f97316'
  );
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMax, vMin, bandZ0),
      isoPtZ(uMax, vMax, bandZ0),
      isoPtZ(uMax, vMax, bandZ1),
      isoPtZ(uMax, vMin, bandZ1),
    ],
    '#ea580c'
  );
  // Crisp graphite pinstripe below orange fascia
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.0 * invScale;
  ctx.beginPath();
  const sL = isoPtZ(uMin, vMin, bandZ0);
  const sF = isoPtZ(uMax, vMin, bandZ0);
  const sR = isoPtZ(uMax, vMax, bandZ0);
  ctx.moveTo(sL.x, sL.y);
  ctx.lineTo(sF.x, sF.y);
  ctx.lineTo(sR.x, sR.y);
  ctx.stroke();

  // 3. Two wide industrial roll-up service bay doors on SE-facing right wall (u = uMax, facing ul. Lipowa)
  const vSpan = vMax - vMin;
  const bayHalfV = vSpan * 0.5;
  const doorH = Math.min(16.5, bandZ0 - 2.2);
  for (let i = 0; i < 2; i++) {
    const dv0 = vMin + i * bayHalfV + 9;
    const dv1 = vMin + (i + 1) * bayHalfV - 9;
    // Recessed dark frame
    drawIsoQuad(
      ctx,
      [
        isoPtZ(uMax, dv0 - 1.4, 0),
        isoPtZ(uMax, dv1 + 1.4, 0),
        isoPtZ(uMax, dv1 + 1.4, doorH + 1.4),
        isoPtZ(uMax, dv0 - 1.4, doorH + 1.4),
      ],
      '#1e293b'
    );
    // Light corrugated aluminum roll-up shutter
    drawIsoQuad(
      ctx,
      [
        isoPtZ(uMax, dv0, 0.4),
        isoPtZ(uMax, dv1, 0.4),
        isoPtZ(uMax, dv1, doorH),
        isoPtZ(uMax, dv0, doorH),
      ],
      '#cbd5e1',
      '#334155',
      0.85 * invScale
    );
    // Horizontal shutter slats
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.55)';
    ctx.lineWidth = 0.75 * invScale;
    ctx.beginPath();
    for (let z = 3.2; z < doorH - 1; z += 2.8) {
      const a = isoPtZ(uMax, dv0, z);
      const c = isoPtZ(uMax, dv1, z);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
    // Subtle dark rubber bottom seal + warm amber bay lamp above each bay door
    drawIsoQuad(
      ctx,
      [
        isoPtZ(uMax, dv0, 0.4),
        isoPtZ(uMax, dv1, 0.4),
        isoPtZ(uMax, dv1, 2.0),
        isoPtZ(uMax, dv0, 2.0),
      ],
      '#334155'
    );
    const lamp = isoPtZ(uMax, (dv0 + dv1) * 0.5, doorH + 2.6);
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 1.55, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Side workshop windows & personnel office door on SW-facing left wall (v = vMin)
  const uSpan = uMax - uMin;
  // Glazed workshop window strip
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMin + 8, vMin, 10),
      isoPtZ(uMin + uSpan * 0.58, vMin, 10),
      isoPtZ(uMin + uSpan * 0.58, vMin, 16.5),
      isoPtZ(uMin + 8, vMin, 16.5),
    ],
    '#7dd3fc',
    '#1e293b',
    0.95 * invScale
  );
  // Window mullion divider
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.9 * invScale;
  ctx.beginPath();
  const wmU = uMin + 8 + (uSpan * 0.58 - 8) * 0.5;
  const wmB = isoPtZ(wmU, vMin, 10);
  const wmT = isoPtZ(wmU, vMin, 16.5);
  ctx.moveTo(wmB.x, wmB.y);
  ctx.lineTo(wmT.x, wmT.y);
  ctx.stroke();

  // Office side door
  const pDoorU0 = uMax - 18;
  const pDoorU1 = uMax - 8;
  drawIsoQuad(
    ctx,
    [
      isoPtZ(pDoorU0, vMin, 0.5),
      isoPtZ(pDoorU1, vMin, 0.5),
      isoPtZ(pDoorU1, vMin, 12.5),
      isoPtZ(pDoorU0, vMin, 12.5),
    ],
    '#334155',
    '#0f172a',
    0.9 * invScale
  );
  // Door glass pane
  drawIsoQuad(
    ctx,
    [
      isoPtZ(pDoorU0 + 1.8, vMin, 6.8),
      isoPtZ(pDoorU1 - 1.8, vMin, 6.8),
      isoPtZ(pDoorU1 - 1.8, vMin, 11.2),
      isoPtZ(pDoorU0 + 1.8, vMin, 11.2),
    ],
    '#93c5fd'
  );

  // 5. Roof inset deck + corrugated seams + two rooftop skylight vents (staying <= b.height)
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMin + 3.5, vMax - 3.5, wallH),
      isoPtZ(uMax - 3.5, vMax - 3.5, wallH),
      isoPtZ(uMax - 3.5, vMin + 3.5, wallH),
      isoPtZ(uMin + 3.5, vMin + 3.5, wallH),
    ],
    '#475569',
    'rgba(15, 23, 42, 0.35)',
    0.85 * invScale
  );

  // Two sleek industrial skylight boxes on the roof (z = wallH..b.height)
  const skyZTop = b.height - 0.3;
  drawIsoBox(
    ctx,
    uMin + 12,
    uMax - 12,
    vMin + 14,
    vMin + 30,
    wallH,
    skyZTop,
    { roof: '#93c5fd', leftWall: '#64748b', rightWall: '#475569', ridge: 'none' },
    invScale,
    0.85
  );
  drawIsoBox(
    ctx,
    uMin + 12,
    uMax - 12,
    vMax - 30,
    vMax - 14,
    wallH,
    skyZTop,
    { roof: '#93c5fd', leftWall: '#64748b', rightWall: '#475569', ridge: 'none' },
    invScale,
    0.85
  );

  // Crisp centered orange workshop emblem on the flat roof between skylights
  const emblemCenter = isoPtZ((uMin + uMax) * 0.5, (vMin + vMax) * 0.5, wallH + 0.2);
  ctx.save();
  ctx.translate(emblemCenter.x, emblemCenter.y);
  ctx.fillStyle = '#ea580c';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.0 * invScale;
  ctx.beginPath();
  ctx.ellipse(0, 0, 12.5, 6.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Stylized white wrench bar inside the roof badge
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2.0 * invScale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5.5, 1.8);
  ctx.lineTo(5.5, -1.8);
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(-5.8, 1.9, 2.2, 0, Math.PI * 2);
  ctx.arc(5.8, -1.9, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Dedicated 3D isometric vector renderer for Gas Stations (`b_gas_station_1`, `b_gas_station_2`).
 * Renders within the building's bounding prism:
 *  - Back glazed cashier/shop pavilion (lower height, behind canopy for zero occlusion)
 *  - Raised concrete fuel pump island with 2 fuel dispenser cabinets & 2 steel support pillars
 *  - Elevated illuminated overhead canopy with bold emerald-green & amber brand fascia
 */
function drawGasStation3DVector(
  ctx: CanvasRenderingContext2D,
  b: Building,
  invScale: number
) {
  const { uMin, uMax, vMin, vMax } = b;
  const uSpan = uMax - uMin;
  const vSpan = vMax - vMin;

  // 1. Back Cashier / Convenience Pavilion along vMax edge (drawn first — behind canopy)
  const shopVMin = vMax - Math.min(28, vSpan * 0.31);
  const shopUMin = uMin + 8;
  const shopUMax = uMax - 8;
  const shopH = 19;

  drawIsoBox(
    ctx,
    shopUMin,
    shopUMax,
    shopVMin,
    vMax,
    0,
    shopH,
    {
      roof: '#475569',
      leftWall: '#e2e8f0',
      rightWall: '#cbd5e1',
      outline: 'rgba(15, 23, 42, 0.56)',
    },
    invScale,
    1.05
  );

  // Emerald green accent fascia band around top of cashier pavilion
  drawIsoQuad(
    ctx,
    [
      isoPtZ(shopUMin, shopVMin, shopH - 3.6),
      isoPtZ(shopUMax, shopVMin, shopH - 3.6),
      isoPtZ(shopUMax, shopVMin, shopH - 0.6),
      isoPtZ(shopUMin, shopVMin, shopH - 0.6),
    ],
    '#10b981'
  );
  drawIsoQuad(
    ctx,
    [
      isoPtZ(shopUMax, shopVMin, shopH - 3.6),
      isoPtZ(shopUMax, vMax, shopH - 3.6),
      isoPtZ(shopUMax, vMax, shopH - 0.6),
      isoPtZ(shopUMax, shopVMin, shopH - 0.6),
    ],
    '#059669'
  );

  // Wide glazed panoramic storefront windows on cashier front wall (v = shopVMin)
  drawIsoQuad(
    ctx,
    [
      isoPtZ(shopUMin + 5, shopVMin, 3.2),
      isoPtZ(shopUMax - 5, shopVMin, 3.2),
      isoPtZ(shopUMax - 5, shopVMin, 12.8),
      isoPtZ(shopUMin + 5, shopVMin, 12.8),
    ],
    '#7dd3fc',
    '#1e293b',
    0.85 * invScale
  );
  // Central sliding glass door frame
  const shopMidU = (shopUMin + shopUMax) * 0.5;
  drawIsoQuad(
    ctx,
    [
      isoPtZ(shopMidU - 7, shopVMin, 0.6),
      isoPtZ(shopMidU + 7, shopVMin, 0.6),
      isoPtZ(shopMidU + 7, shopVMin, 12.8),
      isoPtZ(shopMidU - 7, shopVMin, 12.8),
    ],
    '#bae6fd',
    '#1e293b',
    0.9 * invScale
  );

  // 2. Fuel Pump Island + 2 Fuel Dispensers + 2 Steel Canopy Pillars under the canopy
  const canopyVMax = Math.min(shopVMin - 6, vMin + vSpan * 0.58);
  const islandMidV = (vMin + canopyVMax) * 0.5;
  const islandVMin = islandMidV - 5.5;
  const islandVMax = islandMidV + 5.5;
  const islandUMin = uMin + 12;
  const islandUMax = uMax - 12;

  // Raised concrete pump island curb
  drawIsoBox(
    ctx,
    islandUMin,
    islandUMax,
    islandVMin,
    islandVMax,
    0,
    2.4,
    {
      roof: '#e2e8f0',
      leftWall: '#94a3b8',
      rightWall: '#64748b',
      ridge: 'none',
    },
    invScale,
    0.85
  );

  // Canopy underside height
  const canopyZ0 = Math.max(19, b.height - 7.5);
  const canopyZ1 = b.height;

  // Draw pillars & fuel dispensers in strict back-to-front order (increasing u)
  const p1U0 = islandUMin + 3;
  const p1U1 = p1U0 + 4.4;
  const d1U0 = uMin + uSpan * 0.31;
  const d1U1 = d1U0 + 10.5;
  const d2U0 = uMin + uSpan * 0.58;
  const d2U1 = d2U0 + 10.5;
  const p2U1 = islandUMax - 3;
  const p2U0 = p2U1 - 4.4;

  // Back-left canopy support pillar
  drawIsoBox(
    ctx,
    p1U0,
    p1U1,
    islandMidV - 2.2,
    islandMidV + 2.2,
    2.4,
    canopyZ0 + 0.6,
    { roof: '#475569', leftWall: '#475569', rightWall: '#334155', ridge: 'none' },
    invScale,
    0.85
  );

  // Fuel Dispenser #1 & #2
  for (const [du0, du1] of [
    [d1U0, d1U1],
    [d2U0, d2U1],
  ]) {
    drawIsoBox(
      ctx,
      du0,
      du1,
      islandMidV - 3.2,
      islandMidV + 3.2,
      2.4,
      12.4,
      {
        roof: '#10b981',
        leftWall: '#f8fafc',
        rightWall: '#e2e8f0',
        outline: '#1e293b',
        ridge: 'none',
      },
      invScale,
      0.85
    );
    // Dark digital display panel on left face
    drawIsoQuad(
      ctx,
      [
        isoPtZ(du0 + 1.8, islandMidV - 3.2, 7.6),
        isoPtZ(du1 - 1.8, islandMidV - 3.2, 7.6),
        isoPtZ(du1 - 1.8, islandMidV - 3.2, 10.8),
        isoPtZ(du0 + 1.8, islandMidV - 3.2, 10.8),
      ],
      '#0f172a'
    );
    // Subtle emerald base stripe
    drawIsoQuad(
      ctx,
      [
        isoPtZ(du0 + 0.5, islandMidV - 3.2, 2.8),
        isoPtZ(du1 - 0.5, islandMidV - 3.2, 2.8),
        isoPtZ(du1 - 0.5, islandMidV - 3.2, 5.2),
        isoPtZ(du0 + 0.5, islandMidV - 3.2, 5.2),
      ],
      '#059669'
    );
  }

  // Front-right canopy support pillar
  drawIsoBox(
    ctx,
    p2U0,
    p2U1,
    islandMidV - 2.2,
    islandMidV + 2.2,
    2.4,
    canopyZ0 + 0.6,
    { roof: '#475569', leftWall: '#475569', rightWall: '#334155', ridge: 'none' },
    invScale,
    0.85
  );

  // 3. Elevated Overhead Canopy Deck (z = canopyZ0..canopyZ1)
  drawIsoBox(
    ctx,
    uMin,
    uMax,
    vMin,
    canopyVMax,
    canopyZ0,
    canopyZ1,
    {
      roof: '#f1f5f9',
      leftWall: '#059669',
      rightWall: '#047857',
      outline: 'rgba(15, 23, 42, 0.62)',
      ridge: 'rgba(255, 255, 255, 0.65)',
    },
    invScale,
    1.15
  );

  // Crisp bright amber-gold accent pinstripe wrapping the visible SW & SE canopy fascia
  const stripeZ0 = canopyZ0 + 1.2;
  const stripeZ1 = canopyZ0 + 3.0;
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMin, vMin, stripeZ0),
      isoPtZ(uMax, vMin, stripeZ0),
      isoPtZ(uMax, vMin, stripeZ1),
      isoPtZ(uMin, vMin, stripeZ1),
    ],
    '#f59e0b'
  );
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMax, vMin, stripeZ0),
      isoPtZ(uMax, canopyVMax, stripeZ0),
      isoPtZ(uMax, canopyVMax, stripeZ1),
      isoPtZ(uMax, vMin, stripeZ1),
    ],
    '#d97706'
  );

  // Clean recessed roof panel & emerald brand stripe across top of canopy
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMin + 4, canopyVMax - 4, canopyZ1),
      isoPtZ(uMax - 4, canopyVMax - 4, canopyZ1),
      isoPtZ(uMax - 4, vMin + 4, canopyZ1),
      isoPtZ(uMin + 4, vMin + 4, canopyZ1),
    ],
    '#e2e8f0',
    'rgba(100, 116, 139, 0.35)',
    0.8 * invScale
  );
  // Brand green stripe & circular fuel drop badge on canopy roof
  drawIsoQuad(
    ctx,
    [
      isoPtZ(uMin + 5, islandMidV + 4.5, canopyZ1),
      isoPtZ(uMax - 5, islandMidV + 4.5, canopyZ1),
      isoPtZ(uMax - 5, islandMidV - 4.5, canopyZ1),
      isoPtZ(uMin + 5, islandMidV - 4.5, canopyZ1),
    ],
    '#10b981'
  );
  const badgeCenter = isoPtZ((uMin + uMax) * 0.5, islandMidV, canopyZ1 + 0.1);
  ctx.save();
  ctx.translate(badgeCenter.x, badgeCenter.y);
  ctx.fillStyle = '#fef08a';
  ctx.strokeStyle = '#047857';
  ctx.lineWidth = 1.0 * invScale;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9.5, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
  if (isBaseWarehouseBuilding(b)) {
    drawBaseWarehouse3DVector(ctx, b, p, invScale);
    return;
  }
  if (b.typ === 'mechanik') {
    drawMechanicGarage3DVector(ctx, b, invScale);
    return;
  }
  if (b.typ === 'stacja_paliw') {
    drawGasStation3DVector(ctx, b, invScale);
    return;
  }
  if (b.typ === 'garaz') {
    drawResidentialGarage3DVector(ctx, b, p, invScale);
    return;
  }

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

/**
 * Draws a compact single-story residential garage (`typ: 'garaz'`) with roof trim and
 * a crisp paneled sectional garage door on its wider visible front wall.
 */
function drawResidentialGarage3DVector(
  ctx: CanvasRenderingContext2D,
  b: Building,
  p: BuildingPrismPoints,
  invScale: number
) {
  const palette = getBuildingPalette(b.typ, b.colorVariant);

  // Left wall
  ctx.fillStyle = palette.leftWall;
  ctx.beginPath();
  ctx.moveTo(p.bLeft.x, p.bLeft.y);
  ctx.lineTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // Right wall
  ctx.fillStyle = palette.rightWall;
  ctx.beginPath();
  ctx.moveTo(p.bFront.x, p.bFront.y);
  ctx.lineTo(p.bRight.x, p.bRight.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.closePath();
  ctx.fill();

  // Roof face with slight dark parapet trim
  ctx.fillStyle = palette.roof;
  ctx.beginPath();
  ctx.moveTo(p.tBack.x, p.tBack.y);
  ctx.lineTo(p.tRight.x, p.tRight.y);
  ctx.lineTo(p.tFront.x, p.tFront.y);
  ctx.lineTo(p.tLeft.x, p.tLeft.y);
  ctx.closePath();
  ctx.fill();

  // Sectional garage door on the shorter (front-entry) visible wall
  const leftW = Math.hypot(p.bFront.x - p.bLeft.x, p.bFront.y - p.bLeft.y);
  const rightW = Math.hypot(p.bRight.x - p.bFront.x, p.bRight.y - p.bFront.y);
  const doorOnLeft = leftW <= rightW;
  const d0 = doorOnLeft ? p.bLeft : p.bFront;
  const d1 = doorOnLeft ? p.bFront : p.bRight;
  const t0 = doorOnLeft ? p.tLeft : p.tFront;
  const t1 = doorOnLeft ? p.tFront : p.tRight;

  const lerpPt = (a: { x: number; y: number }, c: { x: number; y: number }, t: number) => ({
    x: a.x + (c.x - a.x) * t,
    y: a.y + (c.y - a.y) * t,
  });
  const bl = lerpPt(d0, d1, 0.16);
  const br = lerpPt(d0, d1, 0.84);
  const tl = lerpPt(bl, lerpPt(t0, t1, 0.16), 0.72);
  const tr = lerpPt(br, lerpPt(t0, t1, 0.84), 0.72);

  ctx.fillStyle = doorOnLeft ? '#e2e8f0' : '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(tl.x, tl.y);
  ctx.closePath();
  ctx.fill();

  // Horizontal garage door slats
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.45)';
  ctx.lineWidth = 0.8 * invScale;
  ctx.beginPath();
  for (let row = 1; row <= 3; row++) {
    const f = row / 4;
    const sl = lerpPt(bl, tl, f);
    const sr = lerpPt(br, tr, f);
    ctx.moveTo(sl.x, sl.y);
    ctx.lineTo(sr.x, sr.y);
  }
  ctx.stroke();

  // Door frame
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.05 * invScale;
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.stroke();

  // Crisp building outline
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.5)';
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

const DECIDUOUS_TREE_PALETTES = [
  { dark: '#1e5631', mid: '#2f7d32', light: '#5cb85c' },
  { dark: '#235d3a', mid: '#3a8c4a', light: '#6cc070' },
  { dark: '#2d5a27', mid: '#4a7c38', light: '#7eb356' },
  { dark: '#1c4d32', mid: '#2e7048', light: '#52a36e' },
] as const;

const CONIFER_TREE_PALETTES = [
  { dark: '#163a2c', mid: '#1f543e', light: '#2f7556' },
  { dark: '#1b4332', mid: '#266047', light: '#3b8262' },
] as const;

/**
 * Renders pre-sorted 3D urban props (park fountain, black wrought-iron park fence,
 * trees, benches, and park street lamps) in exact isometric Painter's Algorithm order.
 */
function drawUrbanProp3D(
  ctx: CanvasRenderingContext2D,
  prop: UrbanProp3D,
  invScale: number
) {
  if (prop.propKind === 'fountain') {
    const c = isoToCanvas(prop.u, prop.v);
    const rx = prop.radius * 1.42;
    const ry = prop.radius * 0.71;
    const rimH = 6.5;

    ctx.save();
    // Ground shadow
    ctx.fillStyle = 'rgba(15, 23, 42, 0.26)';
    ctx.beginPath();
    ctx.ellipse(c.x + 3.5, c.y + 2.2, rx + 2, ry + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stone outer basin wall
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(c.x - rx, c.y - rimH);
    ctx.ellipse(c.x, c.y - rimH, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.2 * invScale;
    ctx.stroke();

    // Stone top rim
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - rimH, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.15 * invScale;
    ctx.stroke();

    // Turquoise-blue water surface
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - rimH + 0.6, rx * 0.84, ry * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();

    // Subtle light water ripple ring
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.72)';
    ctx.lineWidth = 1.0 * invScale;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - rimH + 0.6, rx * 0.56, ry * 0.54, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Central stone pedestal & upper bowl
    const colH = 14;
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.0 * invScale;
    ctx.beginPath();
    ctx.roundRect(c.x - 3.6, c.y - rimH - colH, 7.2, colH + 1, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - rimH - colH, rx * 0.34, ry * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - rimH - colH, rx * 0.25, ry * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arcing water spray jets from central spire
    const spireTopY = c.y - rimH - colH - 7;
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.9)';
    ctx.lineWidth = 1.2 * invScale;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - rimH - colH);
    ctx.lineTo(c.x, spireTopY);
    ctx.moveTo(c.x, spireTopY);
    ctx.quadraticCurveTo(c.x - 6, spireTopY - 4, c.x - 10, c.y - rimH + 0.5);
    ctx.moveTo(c.x, spireTopY);
    ctx.quadraticCurveTo(c.x + 6, spireTopY - 4, c.x + 10, c.y - rimH + 0.5);
    ctx.moveTo(c.x, spireTopY);
    ctx.quadraticCurveTo(c.x - 3, spireTopY - 3, c.x - 5.5, c.y - rimH + 2.5);
    ctx.moveTo(c.x, spireTopY);
    ctx.quadraticCurveTo(c.x + 3, spireTopY - 3, c.x + 5.5, c.y - rimH + 2.5);
    ctx.stroke();

    ctx.restore();
    return;
  }

  if (prop.propKind === 'parkFenceSegment') {
    const p1 = isoToCanvas(prop.u1, prop.v1);
    const p2 = isoToCanvas(prop.u2, prop.v2);
    const h = prop.height;

    ctx.save();
    // Low stone curb plinth
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2.6 * invScale;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Vertical black wrought-iron pickets
    const segPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const picketCount = Math.max(3, Math.round(segPx / 3.8));
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.05 * invScale;
    ctx.beginPath();
    for (let i = 1; i < picketCount; i++) {
      const t = i / picketCount;
      const x = p1.x + (p2.x - p1.x) * t;
      const y = p1.y + (p2.y - p1.y) * t;
      ctx.moveTo(x, y - 1);
      ctx.lineTo(x, y - h);
    }
    ctx.stroke();

    // Top and lower horizontal black iron rails
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.65 * invScale;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y - h + 1.5);
    ctx.lineTo(p2.x, p2.y - h + 1.5);
    ctx.moveTo(p1.x, p1.y - 3.0);
    ctx.lineTo(p2.x, p2.y - 3.0);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (prop.propKind === 'parkFencePost') {
    const c = isoToCanvas(prop.u, prop.v);
    const h = prop.height;
    const w = prop.isGatePost ? 4.2 : 2.6;

    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(c.x - w / 2, c.y - h, w, h + 1);
    ctx.fillStyle = '#334155';
    ctx.fillRect(c.x - w / 2, c.y - h, w * 0.45, h);
    if (prop.isGatePost) {
      // Ornamental black/slate pillar cap
      ctx.fillStyle = '#475569';
      ctx.fillRect(c.x - w * 0.72, c.y - h - 2.2, w * 1.44, 2.4);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.9 * invScale;
      ctx.strokeRect(c.x - w * 0.72, c.y - h - 2.2, w * 1.44, 2.4);
    }
    ctx.restore();
    return;
  }

  if (prop.propKind === 'tree') {
    const c = isoToCanvas(prop.u, prop.v);
    const r = prop.crownRadius;
    const h = prop.height;

    ctx.save();
    // Soft grounded tree shadow on grass
    ctx.fillStyle = 'rgba(15, 23, 42, 0.24)';
    ctx.beginPath();
    ctx.ellipse(c.x + r * 0.45, c.y + r * 0.14, r * 1.05, r * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trunk
    const trunkH = prop.species === 'conifer' ? h * 0.26 : h * 0.42;
    const trunkW = Math.max(2.4, r * 0.3);
    ctx.fillStyle = '#5c3d2e';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.95 * invScale;
    ctx.beginPath();
    ctx.roundRect(c.x - trunkW * 0.5, c.y - trunkH, trunkW, trunkH + 1.2, 1);
    ctx.fill();
    ctx.stroke();

    if (prop.species === 'conifer') {
      const pal = CONIFER_TREE_PALETTES[prop.variant % CONIFER_TREE_PALETTES.length];
      // 3 stacked evergreen conifer tiers
      const tiers = [
        { baseY: c.y - trunkH * 0.75, topY: c.y - h * 0.62, halfW: r * 1.05 },
        { baseY: c.y - h * 0.42, topY: c.y - h * 0.84, halfW: r * 0.82 },
        { baseY: c.y - h * 0.66, topY: c.y - h, halfW: r * 0.56 },
      ];
      for (const tier of tiers) {
        ctx.fillStyle = pal.mid;
        ctx.beginPath();
        ctx.moveTo(c.x, tier.topY);
        ctx.lineTo(c.x + tier.halfW, tier.baseY);
        ctx.lineTo(c.x, tier.baseY + tier.halfW * 0.28);
        ctx.lineTo(c.x - tier.halfW, tier.baseY);
        ctx.closePath();
        ctx.fill();

        // Sunlit left facet
        ctx.fillStyle = pal.light;
        ctx.beginPath();
        ctx.moveTo(c.x, tier.topY);
        ctx.lineTo(c.x, tier.baseY + tier.halfW * 0.28);
        ctx.lineTo(c.x - tier.halfW, tier.baseY);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.0 * invScale;
        ctx.beginPath();
        ctx.moveTo(c.x, tier.topY);
        ctx.lineTo(c.x + tier.halfW, tier.baseY);
        ctx.lineTo(c.x, tier.baseY + tier.halfW * 0.28);
        ctx.lineTo(c.x - tier.halfW, tier.baseY);
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      const pal = DECIDUOUS_TREE_PALETTES[prop.variant % DECIDUOUS_TREE_PALETTES.length];
      const cy = c.y - h * 0.64;
      // Shadowed lower crown mass
      ctx.fillStyle = pal.dark;
      ctx.beginPath();
      ctx.ellipse(c.x + 1.2, cy + r * 0.22, r * 1.06, r * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();

      // Main mid-green foliage body
      ctx.fillStyle = pal.mid;
      ctx.beginPath();
      ctx.ellipse(c.x, cy, r * 1.04, r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sunlit upper-left foliage crown lobe
      ctx.fillStyle = pal.light;
      ctx.beginPath();
      ctx.ellipse(c.x - r * 0.26, cy - r * 0.26, r * 0.62, r * 0.48, -0.25, 0, Math.PI * 2);
      ctx.fill();

      // Crisp dark outline around canopy
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.05 * invScale;
      ctx.beginPath();
      ctx.ellipse(c.x, cy, r * 1.05, r * 0.82, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    return;
  }

  if (prop.propKind === 'bench') {
    const halfLen = 3.6;
    const u1 = prop.axis === 'u' ? prop.u - halfLen : prop.u;
    const v1 = prop.axis === 'u' ? prop.v : prop.v - halfLen;
    const u2 = prop.axis === 'u' ? prop.u + halfLen : prop.u;
    const v2 = prop.axis === 'u' ? prop.v : prop.v + halfLen;
    const p1 = isoToCanvas(u1, v1);
    const p2 = isoToCanvas(u2, v2);
    const backShiftU = prop.axis === 'u' ? 0 : -prop.facingSign * 1.3;
    const backShiftV = prop.axis === 'u' ? -prop.facingSign * 1.3 : 0;
    const b1 = isoToCanvas(u1 + backShiftU, v1 + backShiftV);
    const b2 = isoToCanvas(u2 + backShiftU, v2 + backShiftV);

    ctx.save();
    // Ground shadow
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.lineWidth = 4.2 * invScale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x + 1.2, p1.y + 1.0);
    ctx.lineTo(p2.x + 1.2, p2.y + 1.0);
    ctx.stroke();

    // Cast-iron legs
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.6 * invScale;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y + 0.5);
    ctx.lineTo(p1.x, p1.y - 3.2);
    ctx.moveTo(p2.x, p2.y + 0.5);
    ctx.lineTo(p2.x, p2.y - 3.2);
    ctx.stroke();

    // Wooden seat slat
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2.6 * invScale;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y - 2.6);
    ctx.lineTo(p2.x, p2.y - 2.6);
    ctx.stroke();

    // Wooden backrest slat
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2.1 * invScale;
    ctx.beginPath();
    ctx.moveTo(b1.x, b1.y - 5.2);
    ctx.lineTo(b2.x, b2.y - 5.2);
    ctx.stroke();

    // Dark ink highlight line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.75 * invScale;
    ctx.beginPath();
    ctx.moveTo(b1.x, b1.y - 6.2);
    ctx.lineTo(b2.x, b2.y - 6.2);
    ctx.stroke();

    ctx.restore();
    return;
  }

  // Park street lamp
  const c = isoToCanvas(prop.u, prop.v);
  const h = prop.height;
  ctx.save();
  // Ground shadow
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
  ctx.lineWidth = 1.8 * invScale;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + h * 0.28, c.y - h * 0.08);
  ctx.stroke();

  // Flared cast-iron base
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 2.2, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Slender dark pole
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.8 * invScale;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x, c.y - h);
  ctx.stroke();

  // Subtle warm glow halo
  ctx.fillStyle = 'rgba(254, 240, 138, 0.32)';
  ctx.beginPath();
  ctx.arc(c.x, c.y - h - 1.5, 5.2, 0, Math.PI * 2);
  ctx.fill();

  // Lantern globe
  ctx.fillStyle = '#fef9c3';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.9 * invScale;
  ctx.beginPath();
  ctx.arc(c.x, c.y - h - 1.5, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Lantern cap
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(c.x - 3.0, c.y - h - 3.2);
  ctx.lineTo(c.x + 3.0, c.y - h - 3.2);
  ctx.lineTo(c.x, c.y - h - 5.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

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

const VISIBLE_BOUNDS_GRID_PX = 16;

let cachedVisibleBuildingsRef: Building[] | null = null;
let cachedVisibleHasBounds = false;
let cachedVisibleMinX = 0;
let cachedVisibleMaxX = 0;
let cachedVisibleMinY = 0;
let cachedVisibleMaxY = 0;
let cachedVisibleItems: StaticScene3DItem[] = [];

/**
 * Draws all buildings and 3D wooden yard fences in exact Painter's Algorithm back-to-front
 * order using the pre-sorted static scene cache and per-building / per-fence cached sprites,
 * dynamically interleaving only moving/interactive entities (bike rack, parked vans, courier) per frame.
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
  const hasBounds = Boolean(viewBounds);
  const qMinX = viewBounds ? Math.floor(viewBounds.minX / VISIBLE_BOUNDS_GRID_PX) * VISIBLE_BOUNDS_GRID_PX : 0;
  const qMaxX = viewBounds ? Math.ceil(viewBounds.maxX / VISIBLE_BOUNDS_GRID_PX) * VISIBLE_BOUNDS_GRID_PX : 0;
  const qMinY = viewBounds ? Math.floor(viewBounds.minY / VISIBLE_BOUNDS_GRID_PX) * VISIBLE_BOUNDS_GRID_PX : 0;
  const qMaxY = viewBounds ? Math.ceil(viewBounds.maxY / VISIBLE_BOUNDS_GRID_PX) * VISIBLE_BOUNDS_GRID_PX : 0;

      let visible: StaticScene3DItem[];
      if (
        cachedVisibleBuildingsRef === buildings &&
        cachedVisibleHasBounds === hasBounds &&
        (!hasBounds ||
          (cachedVisibleMinX === qMinX &&
            cachedVisibleMaxX === qMaxX &&
            cachedVisibleMinY === qMinY &&
            cachedVisibleMaxY === qMaxY))
      ) {
        visible = cachedVisibleItems;
      } else {
        const staticScene = getStaticScene3DOrder(buildings);
        visible = [];
        for (let i = 0; i < staticScene.length; i++) {
          const entry = staticScene[i];
          if (
            hasBounds &&
            (entry.maxX < qMinX ||
              entry.minX > qMaxX ||
              entry.maxY < qMinY ||
              entry.minY > qMaxY)
          ) {
            continue;
          }
          visible.push(entry);
        }
        cachedVisibleBuildingsRef = buildings;
        cachedVisibleHasBounds = hasBounds;
        cachedVisibleMinX = qMinX;
        cachedVisibleMaxX = qMaxX;
        cachedVisibleMinY = qMinY;
        cachedVisibleMaxY = qMaxY;
        cachedVisibleItems = visible;
      }

      ctx.save();
      ctx.lineJoin = 'round';

      // Pass 1: Soft grounded cast shadows (strictly below all buildings, fences & vehicles)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.19)';
      ctx.beginPath();
      for (let i = 0; i < visible.length; i++) {
        const entry = visible[i];
        if (entry.kind === 'urbanProp') continue;
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

        if (staticEntry.kind === 'urbanProp') {
          drawUrbanProp3D(ctx, staticEntry.prop, invScale);
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
