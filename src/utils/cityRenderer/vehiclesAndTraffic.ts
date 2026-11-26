import type { VanCondition, VanTier } from '../../types/orders';
import type { DepthSortedEntity } from '../buildings';
import {
  DEFAULT_BICYCLE_SCALE,
  DEFAULT_SCOOTER_SCALE,
  DEFAULT_VAN_SCALE,
  type BicycleRenderOptions,
  type DeliveryVanRenderOptions,
  type ParkedScooterRenderEntry,
  type ScooterRenderOptions,
  drawBaseLoadingZone,
  drawBikeRackWithOptionalBike,
  drawCourierDestinationPin,
  drawCourierRoute,
  drawIsometricBicycle,
  drawIsometricDeliveryVan,
  drawIsometricScooter,
} from '../courierRenderer';

export {
  DEFAULT_BICYCLE_SCALE,
  DEFAULT_SCOOTER_SCALE,
  DEFAULT_VAN_SCALE,
  type BicycleRenderOptions,
  type DeliveryVanRenderOptions,
  type ParkedScooterRenderEntry,
  type ScooterRenderOptions,
  drawBaseLoadingZone,
  drawBikeRackWithOptionalBike,
  drawCourierDestinationPin,
  drawCourierRoute,
  drawIsometricBicycle,
  drawIsometricDeliveryVan,
  drawIsometricScooter,
};

export interface ParkedVanSlotEntityInput {
  vanIndex: number;
  spot: {
    u: number;
    v: number;
    x: number;
    y: number;
  };
  parkedAngle: number;
  condition?: VanCondition;
  tier?: VanTier;
}

/**
 * Wraps a parked delivery van slot into a Z-sorted dynamic isometric entity
 * for Painter's Algorithm interleaving with buildings and fences.
 */
export function createParkedVanDepthEntity(
  slot: ParkedVanSlotEntityInput
): DepthSortedEntity {
  return {
    id: `base_parked_van_${slot.vanIndex}`,
    uMin: slot.spot.u - 5.0,
    uMax: slot.spot.u + 5.0,
    vMin: slot.spot.v - 9.6,
    vMax: slot.spot.v + 9.6,
    draw: (drawCtx) =>
      drawIsometricDeliveryVan(drawCtx, {
        x: slot.spot.x,
        y: slot.spot.y,
        angle: slot.parkedAngle,
        wheelPhase: 0,
        condition: slot.condition ?? 'used',
        tier: slot.tier ?? 'standard',
      }),
  };
}
