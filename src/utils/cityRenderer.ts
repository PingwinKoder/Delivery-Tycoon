import {
  PARCEL_LOCKER_SLOTS,
  PROCEDURAL_DELIVERY_ZONES,
  PROCEDURAL_HOUSE_YARDS,
  PROCEDURAL_PARKING_LOTS,
} from './buildings';
import {
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
  type BaseDepotSpec,
} from './cityMap';
import { PARKING_GROUND_STYLE } from './parkingLayout';
import {
  createBaseParkedVanEntities,
  drawBaseDrivewayAsphalt,
  drawBaseDrivewayCurbInk,
  drawBaseDrivewayMarkings,
  drawBaseDrivewayOuterInk,
  drawBaseDrivewaySidewalk,
  drawBaseParking,
  drawBaseParkingConnectorAsphalt,
  drawBaseParkingConnectorCurbInk,
} from './cityRenderer/baseRenderer';
import {
  buildBuildingSpriteCache,
  buildFenceSpriteCache,
  buildSceneSpriteAtlas,
  disposeBuildingSpriteCache,
  disposeFenceSpriteCache,
  disposeSceneSpriteAtlas,
  renderBuildingFootprints,
  renderBuildings3D,
} from './cityRenderer/buildings';
import {
  BUILDING_SPRITE_SCALE,
  FENCE_SPRITE_SCALE,
  GROUND_PALETTE,
  STATIC_GROUND_BUFFER_SCALE,
  STATIC_GROUND_TILE_OVERLAP_WORLD,
  STATIC_GROUND_TILE_PIXEL_SIZE,
  STATIC_GRID_INV_SCALE,
  createProceduralTextures,
} from './cityRenderer/helpers';
import {
  GRASS_TUFTS,
  INTERSECTIONS,
  MEADOW_PATCHES,
  clampGroundDrawRect,
  createViewportGroundCache,
  disposeStaticGroundBuffer,
  disposeViewportGroundCache,
  drawAccessRoadMarkings,
  drawAccessRoadSidewalkJoints,
  drawAccessRoadStrip,
  drawBusStationSurface,
  drawConcretePlot,
  drawDeliveryZone,
  drawGrassTuft,
  drawHouseYardWalkway,
  drawIntersectionCrosswalks,
  drawParcelLockerSlot,
  drawParkingLot,
  drawRoundaboutDetails,
  drawRoundaboutGrassTufts,
  drawRoundaboutSidewalkJoints,
  drawStaticGroundBuffer,
  drawStreetCurbDetails,
  drawStreetMarkings,
  drawStreetSidewalkJoints,
  drawStreetStrip,
  renderStaticRoadGrid,
  renderStreetNames,
  updateViewportGroundCache,
} from './cityRenderer/terrainAndRoads';
import type {
  BuildingSprite,
  BuildingSpriteCache,
  ClampedDrawImageRect,
  FenceSprite,
  FenceSpriteCache,
  ProceduralTextures,
  SceneSpriteAtlas,
  StaticGroundBuffer,
  StaticGroundBufferOptions,
  StaticGroundTile,
  ViewportGroundCache,
  ViewportGroundUpdateParams,
  WorldViewBounds,
} from './cityRenderer/types';

export type {
  BuildingSprite,
  BuildingSpriteCache,
  ClampedDrawImageRect,
  FenceSprite,
  FenceSpriteCache,
  ProceduralTextures,
  SceneSpriteAtlas,
  StaticGroundBuffer,
  StaticGroundBufferOptions,
  StaticGroundTile,
  ViewportGroundCache,
  ViewportGroundUpdateParams,
  WorldViewBounds,
};

export {
  BUILDING_SPRITE_SCALE,
  FENCE_SPRITE_SCALE,
  STATIC_GROUND_BUFFER_SCALE,
  STATIC_GROUND_TILE_PIXEL_SIZE,
  buildBuildingSpriteCache,
  buildFenceSpriteCache,
  buildSceneSpriteAtlas,
  clampGroundDrawRect,
  createBaseParkedVanEntities,
  createProceduralTextures,
  createViewportGroundCache,
  disposeBuildingSpriteCache,
  disposeFenceSpriteCache,
  disposeSceneSpriteAtlas,
  disposeStaticGroundBuffer,
  disposeViewportGroundCache,
  drawStaticGroundBuffer,
  renderBuildingFootprints,
  renderBuildings3D,
  renderStaticRoadGrid,
  renderStreetNames,
  updateViewportGroundCache,
};

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
  drawBaseDrivewayOuterInk(ctx, BASE_DEPOT);

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
  drawBaseDrivewaySidewalk(ctx, BASE_DEPOT);

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
  drawBaseDrivewayCurbInk(ctx, BASE_DEPOT);
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
  drawBaseParkingConnectorCurbInk(ctx, baseDepot);
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
  drawBaseParkingConnectorAsphalt(ctx, baseDepot, asphaltFill);
  // BAZA straight asphalt driveway connecting yard cleanly onto Central Main Avenue
  drawBaseDrivewayAsphalt(ctx, baseDepot, asphaltFill);

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
  drawBaseDrivewayMarkings(ctx, baseDepot);

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
