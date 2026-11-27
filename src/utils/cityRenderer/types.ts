import type { Building } from '../../types/building';
import type { RoadGraph } from '../../types/roadGraph';
import type {
  BuildingSpriteBounds,
  FencePost3D,
  FenceSegment3D,
  PrecomputedBuilding3D,
} from '../buildings';
import type { BaseDepotSpec, StreetSpec } from '../cityMap';
import type { FenceSpriteAnchorBounds } from '../houseQuarters';
import type { ParkingNavNetwork } from '../parkingNavigation';

export interface ProceduralTextures {
  grassPattern: CanvasPattern | null;
  asphaltPattern: CanvasPattern | null;
  concretePattern: CanvasPattern | null;
}

export interface MeadowPatch {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
  color: string;
  alpha: number;
}

export interface GrassTuft {
  x: number;
  y: number;
  scale: number;
  blades: 2 | 3;
  lean: number;
}

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

export interface StreetLabelPlacement {
  name: string;
  kind: StreetSpec['kind'] | 'access';
  x: number;
  y: number;
  angle: number;
}

export interface WorldViewBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

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

export type AtlasBakeJob =
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
