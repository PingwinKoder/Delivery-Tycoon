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
  computeCenteredBuildingSpriteBounds,
  getBuildingPalette,
  getBuildingPrismPoints,
  getBuildingSpriteArchetypeKey,
  getStaticScene3DOrder,
  mergeEntitiesIntoBackToFrontOrder,
  packSpritesIntoAtlasSheets,
} from '../buildings';
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
