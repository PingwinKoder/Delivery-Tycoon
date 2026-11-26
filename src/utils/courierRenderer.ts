import type { Point } from '../types/roadGraph';
import type { ScooterModelId, VanCondition, VanTier } from '../types/orders';
import type { BaseBikeRackSpec, BaseLoadingZoneSpec } from './cityMap';
import { isoToCanvas } from './cityMap';
import type { SupportedLanguage } from './settingsSystem';

/** Compact, minimalist bicycle & rider scale (~20% smaller than 0.67 for crisp city readability) */
export const DEFAULT_BICYCLE_SCALE = 0.54;
/** Orthographic isometric scale for courier scooters (compact 2-wheeler silhouette slightly fuller than bicycles) */
export const DEFAULT_SCOOTER_SCALE = 0.62;
/** Orthographic isometric scale for delivery vans (fits cleanly in P1–P8 stalls) */
export const DEFAULT_VAN_SCALE = 1.0;

export interface ScooterRenderOptions {
  x: number;
  y: number;
  /** World-canvas heading angle in radians (Math.atan2(dy, dx)) */
  angle: number;
  /** True when courier rider wearing a helmet sits on the scooter; false when parked empty */
  withRider: boolean;
  /** Wheel rotation angle in radians */
  wheelPhase: number;
  /** Scooter catalog model: 'scooter_city' (compact top box) or 'scooter_cargo' (larger insulated cargo box) */
  modelId?: ScooterModelId;
  /** True while halted at destination handing parcels */
  isDelivering?: boolean;
  /** Optional 1-based courier slot index (#1–#6) shown in the floating label */
  courierSlotIndex?: number;
  /** Current number of packages onboard */
  cargoCount?: number;
  /** Maximum scooter cargo capacity (7 or 8) */
  cargoCapacity?: number;
  /** Inverse zoom scale factor for crisp floating cargo badge */
  invScale?: number;
  /** Scale multiplier (defaults to DEFAULT_SCOOTER_SCALE) */
  scale?: number;
}

export interface DeliveryVanRenderOptions {
  x: number;
  y: number;
  /** World-canvas heading angle in radians (Math.atan2(dy, dx)) */
  angle: number;
  /** Wheel rotation phase in radians */
  wheelPhase: number;
  /** True while halted at destination handing off parcels */
  isDelivering?: boolean;
  /** Vehicle condition styling ('used' warm cream + ribs/steel rims vs 'new' crisp white + LED/alloys) */
  condition?: VanCondition;
  /** Van tier controlling roof height (Lite/Standard/Pro) and 1/2/3 horizontal livery stripes */
  tier?: VanTier;
  /** Optional 1-based courier slot index (#1–#6) shown in the floating label (e.g. "#2 • 14/20") */
  courierSlotIndex?: number;
  /** Current number of packages onboard (draws crisp cargo counter when provided) */
  cargoCount?: number;
  /** Maximum van cargo capacity (defaults to 12) */
  cargoCapacity?: number;
  /** Inverse zoom scale factor for crisp floating cargo badge */
  invScale?: number;
  /** Scale multiplier (defaults to DEFAULT_VAN_SCALE) */
  scale?: number;
}

export interface BicycleRenderOptions {
  x: number;
  y: number;
  /** World-canvas heading angle in radians (Math.atan2(dy, dx)) */
  angle: number;
  /** True when courier rider with orange backpack is on the bike; false for empty parked bike */
  withRider: boolean;
  /** Wheel rotation angle in radians (drives subtle spoke spin & riding motion) */
  wheelPhase: number;
  /** True while paused at destination handing off the parcel (rider inside building/yard, empty bike parked) */
  isDelivering?: boolean;
  /** Optional 1-based courier slot index (#1–#6) shown in the floating label (e.g. "#1 • 3/5") */
  courierSlotIndex?: number;
  /** Current number of packages onboard (draws crisp floating badge on active couriers when provided) */
  cargoCount?: number;
  /** Maximum bicycle cargo capacity (defaults to 5) */
  cargoCapacity?: number;
  /** Inverse zoom scale factor for crisp floating cargo badge */
  invScale?: number;
  /** Scale multiplier (defaults to DEFAULT_BICYCLE_SCALE in world pixel units) */
  scale?: number;
}

interface Vec2 {
  x: number;
  y: number;
}

function drawCourierFloatingBadge(
  ctx: CanvasRenderingContext2D,
  anchor: Vec2,
  cargoCount: number,
  cargoCapacity: number,
  invScale: number,
  courierSlotIndex?: number
) {
  const badgeScale = Math.max(0.75, Math.min(1.55, invScale));
  const label =
    typeof courierSlotIndex === 'number'
      ? `#${courierSlotIndex} • ${cargoCount}/${cargoCapacity}`
      : `${cargoCount}/${cargoCapacity}`;
  const fontSize = 9.2 * badgeScale;
  ctx.font = `700 ${fontSize}px 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`;
  const textW = ctx.measureText(label).width;
  const padX = 4.2 * badgeScale;
  const boxW = textW + padX * 2;
  const boxH = 13.5 * badgeScale;
  const bx = anchor.x - boxW / 2;
  const by = anchor.y - boxH;
  const r = 3.2 * badgeScale;

  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + boxW - r, by);
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
  ctx.lineTo(bx + boxW, by + boxH - r);
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
  ctx.lineTo(bx + r, by + boxH);
  ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();

  ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
  ctx.fill();
  ctx.strokeStyle = cargoCount > 0 ? '#f97316' : '#64748b';
  ctx.lineWidth = 1.15 * badgeScale;
  ctx.stroke();

  ctx.fillStyle = cargoCount > 0 ? '#fed7aa' : '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, anchor.x, by + boxH / 2 + 0.3 * badgeScale);
}

/**
 * Computes orthonormal 2:1 isometric ground basis vectors for a canvas heading angle:
 *  - forward (fwdX, fwdY): unit vector along road heading in canvas pixels
 *  - side (sideX, sideY): perpendicular vector in the isometric (u, v) ground plane
 *  - vertical up is straight screen-up (0, -1), keeping bike & rider cleanly upright.
 */
function buildIsoBasis(angle: number): {
  fwdX: number;
  fwdY: number;
  sideX: number;
  sideY: number;
} {
  const fwdX = Math.cos(angle);
  const fwdY = Math.sin(angle);

  const du = fwdX * 0.5 + fwdY;
  const dv = fwdX * 0.5 - fwdY;

  const rawSideX = -dv + du;
  const rawSideY = (-dv - du) * 0.5;
  const rawLen = Math.hypot(rawSideX, rawSideY) || 1;

  const sideScale = 0.72;
  return {
    fwdX,
    fwdY,
    sideX: (rawSideX / rawLen) * sideScale,
    sideY: (rawSideY / rawLen) * sideScale,
  };
}

/**
 * Renders a crisp, minimalist orthographic isometric bicycle (and optional courier rider
 * with orange backpack) directly in canvas world pixel space.
 */
export function drawIsometricBicycle(
  ctx: CanvasRenderingContext2D,
  opts: BicycleRenderOptions
) {
  const {
    x,
    y,
    angle,
    withRider,
    wheelPhase,
    isDelivering = false,
    courierSlotIndex,
    cargoCount,
    cargoCapacity = 5,
    invScale = 1,
    scale = DEFAULT_BICYCLE_SCALE,
  } = opts;

  const { fwdX, fwdY, sideX, sideY } = buildIsoBasis(angle);
  const s = scale;

  const pt = (fwd: number, side: number, up: number): Vec2 => ({
    x: x + (fwd * fwdX + side * sideX) * s,
    y: y + (fwd * fwdY + side * sideY - up) * s,
  });

  const line = (a: Vec2, b: Vec2) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  const ridingBob = withRider && !isDelivering ? Math.abs(Math.sin(wheelPhase * 1.4)) * 0.65 : 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Subtle orange handoff ring around the parked empty bike while courier delivers
  if (isDelivering) {
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.85)';
    ctx.fillStyle = 'rgba(249, 115, 22, 0.16)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.ellipse(x, y, 10.5 * s + 2.5, 5.2 * s + 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 2. Grounded shadow ellipse
  ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const p = pt(Math.cos(a) * 9.8, Math.sin(a) * 3.4, 0);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  // 3. Minimalist isometric wheels (clean dark tire + 2 rotating crossed spokes)
  const drawWheel = (centerFwd: number) => {
    const r = 4.2;
    const centerUp = r;
    const steps = 12;

    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const p = pt(centerFwd + Math.cos(theta) * r, 0, centerUp + Math.sin(theta) * r);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(248, 250, 252, 0.16)';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.0 * s;
    ctx.stroke();

    // Subtle spinning crossed spokes
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.lineWidth = 0.8 * s;
    for (let k = 0; k < 2; k++) {
      const a = wheelPhase + (k * Math.PI) / 2;
      line(
        pt(centerFwd + Math.cos(a) * (r - 0.8), 0, centerUp + Math.sin(a) * (r - 0.8)),
        pt(centerFwd - Math.cos(a) * (r - 0.8), 0, centerUp - Math.sin(a) * (r - 0.8))
      );
    }
  };

  const rearAxle = pt(-6.5, 0, 4.2);
  const frontAxle = pt(6.5, 0, 4.2);
  if (rearAxle.y <= frontAxle.y) {
    drawWheel(-6.5);
    drawWheel(6.5);
  } else {
    drawWheel(6.5);
    drawWheel(-6.5);
  }

  // 4. Clean diamond bicycle frame (dark outline + BAZA orange core)
  const bb = pt(-0.8, 0, 4.4);
  const seatTop = pt(-3.2, 0, 10.5 + ridingBob * 0.25);
  const headTop = pt(4.3, 0, 11.4 + ridingBob * 0.25);

  const strokeFrame = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * s;
    line(rearAxle, bb);
    line(rearAxle, seatTop);
    line(bb, seatTop);
    line(bb, headTop);
    line(seatTop, headTop);
    line(frontAxle, headTop);
  };

  strokeFrame('#0f172a', 2.9);
  strokeFrame('#f97316', 1.65);

  // Compact saddle
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5 * s;
  line(pt(-4.7, 0, 11.2 + ridingBob * 0.25), pt(-1.7, 0, 11.2 + ridingBob * 0.25));

  // Clean handlebar
  const barL = pt(4.0, -3.9, 12.0 + ridingBob * 0.25);
  const barR = pt(4.0, 3.9, 12.0 + ridingBob * 0.25);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.3 * s;
  line(barL, barR);

  // 5. Minimalist courier rider silhouette (legs, torso, arms, vivid orange backpack, helmet)
  if (withRider) {
    const shoulderL = pt(0.5, -2.6, 18.2 + ridingBob);
    const shoulderR = pt(0.5, 2.6, 18.2 + ridingBob);
    const hipL = pt(-2.8, -1.8, 11.5 + ridingBob);
    const hipR = pt(-2.8, 1.8, 11.5 + ridingBob);

    // Simple alternating pedal legs
    const pedal = isDelivering ? 0 : Math.sin(wheelPhase * 1.4) * 1.4;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.4 * s;
    line(hipL, pt(-0.8, -1.5, 4.6 + pedal));
    line(hipR, pt(-0.8, 1.5, 4.6 - pedal));

    // Far arm
    const leftIsFar = shoulderL.y < shoulderR.y;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.2 * s;
    line(leftIsFar ? shoulderL : shoulderR, leftIsFar ? barL : barR);

    // Leaning dark-slate torso
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.15 * s;
    ctx.beginPath();
    ctx.moveTo(hipL.x, hipL.y);
    ctx.lineTo(hipR.x, hipR.y);
    ctx.lineTo(shoulderR.x, shoulderR.y);
    ctx.lineTo(shoulderL.x, shoulderL.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bold minimalist orange courier backpack (clean rounded block on rider's back)
    const bpBack = -6.0;
    const bpFront = -1.6;
    const bpHalf = 2.8;
    const bpBot = 13.0 + ridingBob;
    const bpTop = 20.4 + ridingBob;

    const b1 = pt(bpBack, -bpHalf, bpBot);
    const b2 = pt(bpFront, -bpHalf, bpBot);
    const b3 = pt(bpFront, bpHalf, bpBot);
    const b4 = pt(bpBack, bpHalf, bpBot);
    const t1 = pt(bpBack, -bpHalf, bpTop);
    const t2 = pt(bpFront, -bpHalf, bpTop);
    const t3 = pt(bpFront, bpHalf, bpTop);
    const t4 = pt(bpBack, bpHalf, bpTop);

    const drawQuad = (a: Vec2, b: Vec2, c: Vec2, d: Vec2, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#7c2d12';
      ctx.lineWidth = 0.9 * s;
      ctx.stroke();
    };

    const sideFaces: Array<{ avgY: number; pts: [Vec2, Vec2, Vec2, Vec2]; fill: string }> = [
      { avgY: (b1.y + b4.y) / 2, pts: [b1, b4, t4, t1], fill: '#ea580c' },
      { avgY: (b2.y + b3.y) / 2, pts: [b2, b3, t3, t2], fill: '#c2410c' },
      { avgY: (b1.y + b2.y) / 2, pts: [b1, b2, t2, t1], fill: '#f97316' },
      { avgY: (b4.y + b3.y) / 2, pts: [b4, b3, t3, t4], fill: '#ea580c' },
    ];
    sideFaces.sort((a, b) => a.avgY - b.avgY);
    drawQuad(...sideFaces[2].pts, sideFaces[2].fill);
    drawQuad(...sideFaces[3].pts, sideFaces[3].fill);
    drawQuad(t1, t2, t3, t4, '#fb923c');

    // Near arm
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.2 * s;
    line(leftIsFar ? shoulderR : shoulderL, leftIsFar ? barR : barL);

    // Clean head + white courier helmet dome
    const headPos = pt(1.5, 0, 21.6 + ridingBob);
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(headPos.x, headPos.y + 0.7 * s, 2.3 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.arc(headPos.x, headPos.y - 0.3 * s, 2.9 * s, Math.PI * 0.92, Math.PI * 2.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 6. Crisp floating courier & cargo badge (`#1 • 3/5`) above active courier bicycle
  if (typeof cargoCount === 'number') {
    const anchor = pt(-0.8, 0, withRider ? 27.5 + ridingBob : 17.0);
    drawCourierFloatingBadge(ctx, anchor, cargoCount, cargoCapacity, invScale, courierSlotIndex);
  }

  ctx.restore();
}

/**
 * Computes exact 2:1 isometric ground basis vectors aligned to a canvas heading angle,
 * where 1 unit of `fwd` or `side` equals 1 exact isometric grid unit on the city ground plane.
 */
function buildExactIsoGroundBasis(angle: number): {
  fwdX: number;
  fwdY: number;
  sideX: number;
  sideY: number;
} {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rawU = cos * 0.5 + sin;
  const rawV = cos * 0.5 - sin;
  const isoLen = Math.hypot(rawU, rawV) || 1;
  const uFwd = rawU / isoLen;
  const vFwd = rawV / isoLen;

  // 90° clockwise right vector in isometric (u, v) space
  const uSide = vFwd;
  const vSide = -uFwd;

  return {
    fwdX: uFwd + vFwd,
    fwdY: (uFwd - vFwd) * 0.5,
    sideX: uSide + vSide,
    sideY: (uSide - vSide) * 0.5,
  };
}

/**
 * Renders a crisp, sharp-outlined isometric delivery van (20-package class) matching the game's
 * illustrated aesthetic: dark `#1e293b` contours, white body, company orange livery stripe,
 * sloped windshield, wheels, headlights/taillights, and optional live cargo counter (`X/20`).
 */
export function drawIsometricDeliveryVan(
  ctx: CanvasRenderingContext2D,
  opts: DeliveryVanRenderOptions
) {
  const {
    x,
    y,
    angle,
    wheelPhase,
    isDelivering = false,
    condition = 'used',
    tier = 'standard',
    courierSlotIndex,
    cargoCount,
    cargoCapacity = 12,
    invScale = 1,
    scale = DEFAULT_VAN_SCALE,
  } = opts;

  const isNew = condition === 'new';

  const { fwdX, fwdY, sideX, sideY } = buildExactIsoGroundBasis(angle);
  const s = scale;

  const pt = (fwd: number, side: number, up: number): Vec2 => ({
    x: x + (fwd * fwdX + side * sideX) * s,
    y: y + (fwd * fwdY + side * sideY) * s - up * s,
  });

  const fillPoly = (
    pts: readonly Vec2[],
    fill: string,
    stroke?: string,
    lineWidth = 1.15 * s
  ) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  };

  // Subtle chassis bounce only while moving
  const driveBob = !isDelivering && wheelPhase !== 0 ? Math.abs(Math.sin(wheelPhase * 1.1)) * 0.3 : 0;

  // Dimensions in isometric units (fits comfortably inside 11.5 x 22 Base parking stall)
  const rearL = -8.6;
  const cabSplitL = 3.2;
  const hoodL = 6.2;
  const frontL = 8.7;
  const halfW = 4.15;

  const roofBaseHeight = tier === 'lite' ? 10.1 : tier === 'pro' ? 12.4 : 11.2;
  const zChassis = 2.0 + driveBob;
  const zBelt = 6.9 + driveBob;
  const zRoof = roofBaseHeight + driveBob;
  const zHood = 6.2 + driveBob;

  // Full-length horizontal stripe bands strictly inside [3.45, 5.95] so they run cleanly from rearL to frontL
  const stripeBands: ReadonlyArray<readonly [number, number]> =
    tier === 'lite'
      ? [[4.45 + driveBob, 5.15 + driveBob]]
      : tier === 'pro'
        ? [
            [3.5 + driveBob, 4.02 + driveBob],
            [4.38 + driveBob, 4.9 + driveBob],
            [5.26 + driveBob, 5.78 + driveBob],
          ]
        : [
            [3.85 + driveBob, 4.5 + driveBob],
            [4.95 + driveBob, 5.6 + driveBob],
          ];

  // Condition-specific color palette (Used: warm cream-white + dark plastic vs New: crisp pure white + body-colored trim)
  const litBodyFill = isNew ? '#ffffff' : '#f1efe9';
  const shadedBodyFill = isNew ? '#e2e8f0' : '#d6d3cb';
  const roofFill = isNew ? '#ffffff' : '#ebe8e0';
  const noseFill = isNew ? '#f8fafc' : '#e7e4dc';
  const hoodFill = isNew ? '#ffffff' : '#edeae2';
  const windshieldFrameFill = isNew ? '#f1f5f9' : '#d6d3cb';
  const rearBodyFill = isNew ? '#e2e8f0' : '#d6d3cb';
  const glassFill = isNew ? '#0ea5e9' : '#38bdf8';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Subtle orange handoff ring when stopped at a city delivery/pickup point
  if (isDelivering) {
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.88)';
    ctx.fillStyle = 'rgba(249, 115, 22, 0.15)';
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.ellipse(x, y, 14.5 * s + 2.5, 7.6 * s + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 2. Grounded isometric drop shadow
  const shadowPts = [
    pt(rearL - 0.6, -halfW - 0.5, 0),
    pt(frontL + 0.7, -halfW - 0.5, 0),
    pt(frontL + 0.7, halfW + 0.5, 0),
    pt(rearL - 0.6, halfW + 0.5, 0),
  ].map((p) => ({ x: p.x + 1.2 * s, y: p.y + 0.9 * s }));
  fillPoly(shadowPts, 'rgba(15, 23, 42, 0.30)');

  // Determine which side (left = -halfW vs right = +halfW) and end (front vs rear) face the viewer
  const leftSideCenter = pt(0, -halfW, zBelt);
  const rightSideCenter = pt(0, halfW, zBelt);
  const frontCenter = pt(frontL, 0, zBelt);
  const rearCenter = pt(rearL, 0, zBelt);

  const leftFacingViewer = leftSideCenter.y >= rightSideCenter.y;
  const frontFacingViewer = frontCenter.y >= rearCenter.y;
  const nearSideSign = leftFacingViewer ? -1 : 1;
  const farSideSign = -nearSideSign;

  // Helper to draw a crisp isometric wheel at (axleFwd, sideSign * halfW)
  const drawWheel = (axleFwd: number, sideSign: number) => {
    const r = 2.05;
    const wheelSide = sideSign * (halfW - 0.25);
    const steps = 10;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = pt(axleFwd + Math.cos(a) * r, wheelSide, r + Math.sin(a) * r);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.85 * s;
    ctx.stroke();

    const hub = pt(axleFwd, wheelSide, r);
    if (isNew) {
      // Modern black alloy rim with dark-gray metallic spokes
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 1.05 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 0.6 * s;
      ctx.stroke();

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 0.55 * s;
      for (let k = 0; k < 3; k++) {
        const spAngle = wheelPhase * 0.5 + (k * Math.PI) / 3;
        const dx = Math.cos(spAngle) * 0.85 * s;
        const dy = Math.sin(spAngle) * 0.85 * s;
        ctx.beginPath();
        ctx.moveTo(hub.x - dx, hub.y - dy);
        ctx.lineTo(hub.x + dx, hub.y + dy);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 0.32 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
    } else {
      // Classic steel rim (#475569) with crisp silver outer ring
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 1.0 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#475569';
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 0.65 * s;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 0.35 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
    }
  };

  // Draw far-side wheels peeking cleanly under the chassis
  drawWheel(-5.0, farSideSign);
  drawWheel(5.2, farSideSign);

  // 3. Draw vertical hull faces sorted back-to-front (only the 2 viewer-facing faces + sloped hood/windshield)
  const drawSideFace = (sideSign: number) => {
    const sideCoord = sideSign * halfW;
    const isLitSide = sideSign === -1;
    const bodyFill = isLitSide ? litBodyFill : shadedBodyFill;
    const stripeFill = isLitSide ? '#f97316' : '#ea580c';

    // Main side silhouette (cargo box + sloped cab hood)
    const hullPts = [
      pt(rearL, sideCoord, zChassis),
      pt(frontL, sideCoord, zChassis),
      pt(frontL, sideCoord, zHood),
      pt(hoodL, sideCoord, zBelt),
      pt(cabSplitL, sideCoord, zRoof),
      pt(rearL, sideCoord, zRoof),
    ];
    fillPoly(hullPts, bodyFill, '#1e293b', 1.2 * s);

    if (isNew) {
      // New van: clean body-colored sill with subtle slim aerodynamic skirt accent
      fillPoly(
        [
          pt(rearL, sideCoord, zChassis),
          pt(frontL, sideCoord, zChassis),
          pt(frontL, sideCoord, zChassis + 0.65),
          pt(rearL, sideCoord, zChassis + 0.65),
        ],
        isLitSide ? '#cbd5e1' : '#94a3b8'
      );
    } else {
      // Used van: prominent dark-gray plastic lower sill cladding & rub strip
      fillPoly(
        [
          pt(rearL, sideCoord, zChassis),
          pt(frontL, sideCoord, zChassis),
          pt(frontL, sideCoord, zChassis + 1.35),
          pt(rearL, sideCoord, zChassis + 1.35),
        ],
        isLitSide ? '#475569' : '#334155'
      );
    }

    // 1 / 2 / 3 horizontal livery stripes running along full body length (rearL -> frontL)
    for (const [zBot, zTop] of stripeBands) {
      fillPoly(
        [
          pt(rearL + 0.16, sideCoord, zBot),
          pt(frontL - 0.18, sideCoord, zBot),
          pt(frontL - 0.18, sideCoord, zTop),
          pt(rearL + 0.16, sideCoord, zTop),
        ],
        stripeFill
      );
    }

    // Side cab window (adapts height cleanly to Lite/Standard/Pro roof)
    const winTop = Math.min(zRoof - 0.85, zBelt + 3.45);
    fillPoly(
      [
        pt(cabSplitL + 0.35, sideCoord, zBelt + 0.2),
        pt(hoodL - 0.3, sideCoord, zBelt + 0.2),
        pt(cabSplitL + 0.55, sideCoord, winTop),
        pt(cabSplitL + 0.35, sideCoord, winTop),
      ],
      glassFill,
      '#1e293b',
      0.85 * s
    );

    // Subtle vertical cargo/cab panel seam
    const seamBot = pt(cabSplitL - 0.1, sideCoord, zChassis + 1.2);
    const seamTop = pt(cabSplitL - 0.1, sideCoord, zRoof - 0.3);
    ctx.strokeStyle = isNew ? 'rgba(30, 41, 59, 0.34)' : 'rgba(30, 41, 59, 0.52)';
    ctx.lineWidth = 0.85 * s;
    ctx.beginPath();
    ctx.moveTo(seamBot.x, seamBot.y);
    ctx.lineTo(seamTop.x, seamTop.y);
    ctx.stroke();

    // Extra subtle body molding crease on used vans
    if (!isNew) {
      const creaseA = pt(rearL + 0.4, sideCoord, zBelt + 0.15);
      const creaseB = pt(cabSplitL - 0.25, sideCoord, zBelt + 0.15);
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.32)';
      ctx.lineWidth = 0.7 * s;
      ctx.beginPath();
      ctx.moveTo(creaseA.x, creaseA.y);
      ctx.lineTo(creaseB.x, creaseB.y);
      ctx.stroke();
    }

    // Re-stroke crisp outer hull outline so inner strips never bleed past border
    ctx.beginPath();
    ctx.moveTo(hullPts[0].x, hullPts[0].y);
    for (let i = 1; i < hullPts.length; i++) {
      ctx.lineTo(hullPts[i].x, hullPts[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
  };

  const drawFrontFace = () => {
    // Lower front bumper + grille nose
    const nosePts = [
      pt(frontL, -halfW, zChassis),
      pt(frontL, halfW, zChassis),
      pt(frontL, halfW, zHood),
      pt(frontL, -halfW, zHood),
    ];
    fillPoly(nosePts, noseFill, '#1e293b', 1.2 * s);

    if (isNew) {
      // New van: body-colored front bumper with wide sleek black lower air intake
      fillPoly(
        [
          pt(frontL, -halfW, zChassis),
          pt(frontL, halfW, zChassis),
          pt(frontL, halfW, zChassis + 1.35),
          pt(frontL, -halfW, zChassis + 1.35),
        ],
        '#f8fafc',
        '#94a3b8',
        0.75 * s
      );

      // Wide black lower air intake inset
      fillPoly(
        [
          pt(frontL, -halfW * 0.72, zChassis + 0.22),
          pt(frontL, halfW * 0.72, zChassis + 0.22),
          pt(frontL, halfW * 0.66, zChassis + 1.15),
          pt(frontL, -halfW * 0.66, zChassis + 1.15),
        ],
        '#0f172a'
      );

      // Modern upper dark grille with sharp silver accent trim
      fillPoly(
        [
          pt(frontL, -halfW * 0.54, zChassis + 1.65),
          pt(frontL, halfW * 0.54, zChassis + 1.65),
          pt(frontL, halfW * 0.58, zHood - 0.95),
          pt(frontL, -halfW * 0.58, zHood - 0.95),
        ],
        '#0f172a'
      );
      const trimA = pt(frontL, -halfW * 0.48, zChassis + 2.38);
      const trimB = pt(frontL, halfW * 0.48, zChassis + 2.38);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 0.75 * s;
      ctx.beginPath();
      ctx.moveTo(trimA.x, trimA.y);
      ctx.lineTo(trimB.x, trimB.y);
      ctx.stroke();

      // Sleek orange brand accent bar across upper nose
      fillPoly(
        [
          pt(frontL, -halfW + 0.2, zHood - 0.78),
          pt(frontL, halfW - 0.2, zHood - 0.78),
          pt(frontL, halfW - 0.2, zHood - 0.18),
          pt(frontL, -halfW + 0.2, zHood - 0.18),
        ],
        '#f97316'
      );

      // Sharp modern LED headlights (#e0f2fe + cyan LED signature #38bdf8)
      const drawLedHeadlight = (sideSign: number) => {
        fillPoly(
          [
            pt(frontL, sideSign * (halfW - 0.18), zChassis + 1.85),
            pt(frontL, sideSign * (halfW - 1.55), zChassis + 1.7),
            pt(frontL, sideSign * (halfW - 1.55), zChassis + 2.65),
            pt(frontL, sideSign * (halfW - 0.18), zChassis + 2.95),
          ],
          '#e0f2fe',
          '#0f172a',
          0.65 * s
        );
        const ledA = pt(frontL, sideSign * (halfW - 0.28), zChassis + 2.02);
        const ledB = pt(frontL, sideSign * (halfW - 1.42), zChassis + 1.9);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 0.95 * s;
        ctx.beginPath();
        ctx.moveTo(ledA.x, ledA.y);
        ctx.lineTo(ledB.x, ledB.y);
        ctx.stroke();
      };
      drawLedHeadlight(-1);
      drawLedHeadlight(1);
    } else {
      // Used van: prominent dark-gray plastic bumper bar
      fillPoly(
        [
          pt(frontL, -halfW, zChassis),
          pt(frontL, halfW, zChassis),
          pt(frontL, halfW, zChassis + 1.4),
          pt(frontL, -halfW, zChassis + 1.4),
        ],
        '#334155',
        '#1e293b',
        0.95 * s
      );

      // Classic dark radiator grille with horizontal slats
      fillPoly(
        [
          pt(frontL, -halfW * 0.58, zChassis + 1.6),
          pt(frontL, halfW * 0.58, zChassis + 1.6),
          pt(frontL, halfW * 0.58, zHood - 0.9),
          pt(frontL, -halfW * 0.58, zHood - 0.9),
        ],
        '#1e293b'
      );
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 0.65 * s;
      for (const slatZ of [zChassis + 2.0, zChassis + 2.5, zChassis + 3.0]) {
        const slA = pt(frontL, -halfW * 0.52, slatZ);
        const slB = pt(frontL, halfW * 0.52, slatZ);
        ctx.beginPath();
        ctx.moveTo(slA.x, slA.y);
        ctx.lineTo(slB.x, slB.y);
        ctx.stroke();
      }

      // Orange accent bar across upper nose
      fillPoly(
        [
          pt(frontL, -halfW + 0.2, zHood - 0.85),
          pt(frontL, halfW - 0.2, zHood - 0.85),
          pt(frontL, halfW - 0.2, zHood - 0.15),
          pt(frontL, -halfW + 0.2, zHood - 0.15),
        ],
        '#f97316'
      );

      // Classic rectangular warm halogen headlights
      const drawHalogenHeadlight = (sideSign: number) => {
        fillPoly(
          [
            pt(frontL, sideSign * (halfW - 0.25), zChassis + 1.72),
            pt(frontL, sideSign * (halfW - 1.32), zChassis + 1.72),
            pt(frontL, sideSign * (halfW - 1.32), zChassis + 2.95),
            pt(frontL, sideSign * (halfW - 0.25), zChassis + 2.95),
          ],
          '#fef08a',
          '#1e293b',
          0.65 * s
        );
      };
      drawHalogenHeadlight(-1);
      drawHalogenHeadlight(1);
    }

    // Sloped hood deck
    fillPoly(
      [
        pt(frontL, -halfW, zHood),
        pt(frontL, halfW, zHood),
        pt(hoodL, halfW, zBelt),
        pt(hoodL, -halfW, zBelt),
      ],
      hoodFill,
      '#1e293b',
      1.15 * s
    );

    // Sloped cab windshield frame
    fillPoly(
      [
        pt(hoodL, -halfW, zBelt),
        pt(hoodL, halfW, zBelt),
        pt(cabSplitL, halfW, zRoof),
        pt(cabSplitL, -halfW, zRoof),
      ],
      windshieldFrameFill,
      '#1e293b',
      1.15 * s
    );

    // Tinted windshield glass inset
    fillPoly(
      [
        pt(hoodL - 0.25, -halfW + 0.55, zBelt + 0.4),
        pt(hoodL - 0.25, halfW - 0.55, zBelt + 0.4),
        pt(cabSplitL + 0.35, halfW - 0.55, zRoof - 0.65),
        pt(cabSplitL + 0.35, -halfW + 0.55, zRoof - 0.65),
      ],
      glassFill,
      '#0f172a',
      0.85 * s
    );

    // Crisp diagonal glass glare reflection
    const glA = pt(hoodL - 0.6, -halfW * 0.4, zBelt + 0.9);
    const glB = pt(cabSplitL + 0.65, -halfW * 0.05, zRoof - 1.0);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.76)';
    ctx.lineWidth = 1.1 * s;
    ctx.beginPath();
    ctx.moveTo(glA.x, glA.y);
    ctx.lineTo(glB.x, glB.y);
    ctx.stroke();
  };

  const drawRearFace = () => {
    const rearPts = [
      pt(rearL, -halfW, zChassis),
      pt(rearL, halfW, zChassis),
      pt(rearL, halfW, zRoof),
      pt(rearL, -halfW, zRoof),
    ];
    fillPoly(rearPts, rearBodyFill, '#1e293b', 1.2 * s);

    // Rear bumper (body-colored on New, dark-gray plastic on Used)
    fillPoly(
      [
        pt(rearL, -halfW, zChassis),
        pt(rearL, halfW, zChassis),
        pt(rearL, halfW, zChassis + (isNew ? 1.15 : 1.35)),
        pt(rearL, -halfW, zChassis + (isNew ? 1.15 : 1.35)),
      ],
      isNew ? '#cbd5e1' : '#334155',
      '#1e293b',
      0.9 * s
    );

    // Matching 1 / 2 / 3 company orange rear stripes
    for (const [zBot, zTop] of stripeBands) {
      fillPoly(
        [
          pt(rearL, -halfW + 0.18, zBot),
          pt(rearL, halfW - 0.18, zBot),
          pt(rearL, halfW - 0.18, zTop),
          pt(rearL, -halfW + 0.18, zTop),
        ],
        '#ea580c'
      );
    }

    // Split rear cargo door vertical seam
    const midBot = pt(rearL, 0, zChassis + 1.3);
    const midTop = pt(rearL, 0, zRoof - 0.2);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.9 * s;
    ctx.beginPath();
    ctx.moveTo(midBot.x, midBot.y);
    ctx.lineTo(midTop.x, midTop.y);
    ctx.stroke();

    // Red rear taillights
    const drawTailLight = (sideSign: number) => {
      fillPoly(
        [
          pt(rearL, sideSign * (halfW - 0.25), zChassis + 1.6),
          pt(rearL, sideSign * (halfW - 1.2), zChassis + 1.6),
          pt(rearL, sideSign * (halfW - 1.2), zChassis + 3.4),
          pt(rearL, sideSign * (halfW - 0.25), zChassis + 3.4),
        ],
        '#ef4444',
        '#1e293b',
        0.65 * s
      );
    };
    drawTailLight(-1);
    drawTailLight(1);
  };

  // Draw the two visible faces back-to-front
  const nearSideY = nearSideSign === -1 ? leftSideCenter.y : rightSideCenter.y;
  const endY = frontFacingViewer ? frontCenter.y : rearCenter.y;

  if (nearSideY <= endY) {
    drawSideFace(nearSideSign);
    if (frontFacingViewer) drawFrontFace();
    else drawRearFace();
  } else {
    if (frontFacingViewer) drawFrontFace();
    else drawRearFace();
    drawSideFace(nearSideSign);
  }

  // 4. Cargo roof (Used: warm cream with visible longitudinal stiffening ribs vs New: smooth bright white)
  fillPoly(
    [
      pt(rearL, -halfW, zRoof),
      pt(cabSplitL, -halfW, zRoof),
      pt(cabSplitL, halfW, zRoof),
      pt(rearL, halfW, zRoof),
    ],
    roofFill,
    '#1e293b',
    1.2 * s
  );

  if (!isNew) {
    // Visible longitudinal roof ribs/creases characteristic of older/used cargo vans
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.48)';
    ctx.lineWidth = 0.78 * s;
    for (const ribSide of [-halfW * 0.62, -halfW * 0.21, halfW * 0.21, halfW * 0.62]) {
      const rA = pt(rearL + 0.65, ribSide, zRoof);
      const rB = pt(cabSplitL - 2.55, ribSide, zRoof);
      ctx.beginPath();
      ctx.moveTo(rA.x, rA.y);
      ctx.lineTo(rB.x, rB.y);
      ctx.stroke();
    }
  }

  // Subtle orange company roof accent bar near cab edge
  fillPoly(
    [
      pt(cabSplitL - 2.25, -halfW + 0.75, zRoof),
      pt(cabSplitL - 0.55, -halfW + 0.75, zRoof),
      pt(cabSplitL - 0.55, halfW - 0.75, zRoof),
      pt(cabSplitL - 2.25, halfW - 0.75, zRoof),
    ],
    '#f97316'
  );

  // 5. Near-side wheels cleanly anchored along the lower wheel arches
  drawWheel(-5.0, nearSideSign);
  drawWheel(5.2, nearSideSign);

  // 6. Crisp floating courier & onboard cargo badge (`#2 • 14/20`) when active on route
  if (typeof cargoCount === 'number') {
    const anchor = pt(-1.6, 0, zRoof + 4.8);
    drawCourierFloatingBadge(ctx, anchor, cargoCount, cargoCapacity, invScale, courierSlotIndex);
  }

  ctx.restore();
}

/**
 * Renders a crisp orthographic isometric delivery scooter (step-through floorboard, front
 * fairing with headlight, wide seat, courier cargo top-box, and optional helmeted rider).
 */
export function drawIsometricScooter(
  ctx: CanvasRenderingContext2D,
  opts: ScooterRenderOptions
) {
  const {
    x,
    y,
    angle,
    withRider,
    wheelPhase,
    modelId = 'scooter_city',
    isDelivering = false,
    courierSlotIndex,
    cargoCount,
    cargoCapacity = modelId === 'scooter_cargo' ? 8 : 7,
    invScale = 1,
    scale = DEFAULT_SCOOTER_SCALE,
  } = opts;

  const isCargo = modelId === 'scooter_cargo';
  const { fwdX, fwdY, sideX, sideY } = buildIsoBasis(angle);
  const s = scale;

  const pt = (fwd: number, side: number, up: number): Vec2 => ({
    x: x + (fwd * fwdX + side * sideX) * s,
    y: y + (fwd * fwdY + side * sideY - up) * s,
  });

  const fillPoly = (pts: Vec2[], fill: string, stroke?: string, lineWidth = 0.8) => {
    if (pts.length === 0) return;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth * s;
      ctx.stroke();
    }
  };

  const line = (a: Vec2, b: Vec2) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  const roadVibe = withRider && !isDelivering ? Math.abs(Math.sin(wheelPhase * 1.1)) * 0.3 : 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Subtle orange handoff ring when stopped at delivery/pickup point
  if (isDelivering) {
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.88)';
    ctx.fillStyle = 'rgba(249, 115, 22, 0.16)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.ellipse(x, y, 11.2 * s + 2.5, 5.8 * s + 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 2. Grounded shadow ellipse
  ctx.fillStyle = 'rgba(15, 23, 42, 0.34)';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const p = pt(Math.cos(a) * 10.6, Math.sin(a) * 4.2, 0);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  // 3. Smaller thicker scooter wheels
  const drawScooterWheel = (centerFwd: number) => {
    const r = 3.0;
    const centerUp = r;
    const steps = 12;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const p = pt(centerFwd + Math.cos(theta) * r, 0, centerUp + Math.sin(theta) * r);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.1 * s;
    ctx.stroke();

    const hub = pt(centerFwd, 0, centerUp);
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 1.3 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
  };

  const rearAxle = pt(-6.6, 0, 3.0);
  const frontAxle = pt(6.6, 0, 3.0);
  if (rearAxle.y <= frontAxle.y) {
    drawScooterWheel(-6.6);
    drawScooterWheel(6.6);
  } else {
    drawScooterWheel(6.6);
    drawScooterWheel(-6.6);
  }

  // Body palette: City Scooter = sky-blue + white shield, Cargo Scooter = amber-orange + dark slate trim
  const bodyPrimary = isCargo ? '#ea580c' : '#0284c7';
  const bodyAccent = isCargo ? '#f97316' : '#38bdf8';
  const fairingFront = isCargo ? '#f8fafc' : '#e0f2fe';

  // 4. Step-through floorboard (przekrok) + rear body nacelle + front fairing legshield
  const floorPts = [
    pt(-2.5, -2.0, 2.7 + roadVibe),
    pt(3.8, -2.0, 2.7 + roadVibe),
    pt(3.8, 2.0, 2.7 + roadVibe),
    pt(-2.5, 2.0, 2.7 + roadVibe),
  ];
  fillPoly(floorPts, '#1e293b', '#0f172a', 0.8);

  // Rear body cowling box
  const leftSideCenter = pt(-4.5, -2.3, 6.0);
  const rightSideCenter = pt(-4.5, 2.3, 6.0);
  const nearSign = leftSideCenter.y >= rightSideCenter.y ? -1 : 1;

  fillPoly(
    [
      pt(-8.2, nearSign * 2.2, 4.2 + roadVibe),
      pt(-2.0, nearSign * 2.2, 4.2 + roadVibe),
      pt(-2.0, nearSign * 2.0, 8.6 + roadVibe),
      pt(-7.8, nearSign * 2.0, 8.6 + roadVibe),
    ],
    bodyPrimary,
    '#0f172a',
    0.85
  );
  fillPoly(
    [
      pt(-7.8, -2.0, 8.6 + roadVibe),
      pt(-2.0, -2.0, 8.6 + roadVibe),
      pt(-2.0, 2.0, 8.6 + roadVibe),
      pt(-7.8, 2.0, 8.6 + roadVibe),
    ],
    bodyAccent,
    '#0f172a',
    0.8
  );

  // Front legshield / fairing column
  fillPoly(
    [
      pt(4.0, nearSign * 2.1, 3.8 + roadVibe),
      pt(7.8, nearSign * 1.4, 4.5 + roadVibe),
      pt(6.2, nearSign * 1.4, 11.4 + roadVibe),
      pt(3.4, nearSign * 1.9, 10.8 + roadVibe),
    ],
    bodyPrimary,
    '#0f172a',
    0.85
  );
  // Front apron panel
  fillPoly(
    [
      pt(7.8, -1.4, 4.5 + roadVibe),
      pt(7.8, 1.4, 4.5 + roadVibe),
      pt(6.2, 1.4, 11.4 + roadVibe),
      pt(6.2, -1.4, 11.4 + roadVibe),
    ],
    fairingFront,
    '#0f172a',
    0.8
  );

  // Compact glowing headlight
  const headlight = pt(7.2, 0, 9.5 + roadVibe);
  ctx.fillStyle = '#fde047';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.7 * s;
  ctx.beginPath();
  ctx.arc(headlight.x, headlight.y, 1.15 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wide upholstered scooter saddle
  fillPoly(
    [
      pt(-5.2, -1.8, 9.0 + roadVibe),
      pt(-0.6, -1.7, 9.0 + roadVibe),
      pt(-0.6, 1.7, 9.0 + roadVibe),
      pt(-5.2, 1.8, 9.0 + roadVibe),
    ],
    '#0f172a',
    '#334155',
    0.8
  );

  // Steering stem & wide scooter handlebars
  const stemBase = pt(5.0, 0, 10.6 + roadVibe);
  const stemTop = pt(4.6, 0, 12.2 + roadVibe);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.0 * s;
  line(stemBase, stemTop);

  const barL = pt(4.4, -3.4, 12.2 + roadVibe);
  const barR = pt(4.4, 3.4, 12.2 + roadVibe);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2.2 * s;
  line(barL, barR);

  // Small windscreen on scooter_cargo or clean cowling highlight on scooter_city
  if (isCargo) {
    fillPoly(
      [
        pt(5.3, -1.6, 11.8 + roadVibe),
        pt(5.3, 1.6, 11.8 + roadVibe),
        pt(4.6, 1.4, 14.4 + roadVibe),
        pt(4.6, -1.4, 14.4 + roadVibe),
      ],
      'rgba(186, 230, 253, 0.65)',
      '#334155',
      0.7
    );
  }

  // 5. Rear Courier Top-Box (compact cube on scooter_city, large insulated cargo box on scooter_cargo)
  const boxBack = isCargo ? -11.4 : -9.8;
  const boxFront = isCargo ? -5.2 : -5.4;
  const boxHalf = isCargo ? 3.2 : 2.3;
  const boxBot = 8.9 + roadVibe;
  const boxTop = (isCargo ? 16.0 : 13.6) + roadVibe;

  const b1 = pt(boxBack, -boxHalf, boxBot);
  const b2 = pt(boxFront, -boxHalf, boxBot);
  const b3 = pt(boxFront, boxHalf, boxBot);
  const b4 = pt(boxBack, boxHalf, boxBot);
  const t1 = pt(boxBack, -boxHalf, boxTop);
  const t2 = pt(boxFront, -boxHalf, boxTop);
  const t3 = pt(boxFront, boxHalf, boxTop);
  const t4 = pt(boxBack, boxHalf, boxTop);

  const boxFaces: Array<{ avgY: number; pts: Vec2[]; fill: string }> = [
    { avgY: (b1.y + b4.y) / 2, pts: [b1, b4, t4, t1], fill: isCargo ? '#c2410c' : '#ea580c' },
    { avgY: (b2.y + b3.y) / 2, pts: [b2, b3, t3, t2], fill: isCargo ? '#ea580c' : '#f97316' },
    { avgY: (b1.y + b2.y) / 2, pts: [b1, b2, t2, t1], fill: '#f97316' },
    { avgY: (b4.y + b3.y) / 2, pts: [b4, b3, t3, t4], fill: '#f97316' },
  ].sort((a, b) => a.avgY - b.avgY);

  for (const face of boxFaces) {
    fillPoly(face.pts, face.fill, '#7c2d12', 0.85);
  }
  fillPoly([t1, t2, t3, t4], isCargo ? '#fb923c' : '#fdba74', '#7c2d12', 0.85);

  if (isCargo) {
    // Bold reflective orange/white brand band on larger cargo box roof
    fillPoly(
      [
        pt(boxBack + 1.0, -boxHalf + 0.6, boxTop + 0.1),
        pt(boxFront - 1.0, -boxHalf + 0.6, boxTop + 0.1),
        pt(boxFront - 1.0, boxHalf - 0.6, boxTop + 0.1),
        pt(boxBack + 1.0, boxHalf - 0.6, boxTop + 0.1),
      ],
      '#f8fafc'
    );
  }

  // 6. Upright scooter rider with helmet & tucked boots on the step-through floorboard
  if (withRider) {
    const hipL = pt(-2.2, -1.6, 9.6 + roadVibe);
    const hipR = pt(-2.2, 1.6, 9.6 + roadVibe);
    const shoulderL = pt(-0.6, -2.5, 16.5 + roadVibe);
    const shoulderR = pt(-0.6, 2.5, 16.5 + roadVibe);

    // Legs resting neatly down on the step-through floorboard
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.4 * s;
    line(hipL, pt(1.2, -1.5, 4.0 + roadVibe));
    line(hipR, pt(1.2, 1.5, 4.0 + roadVibe));

    // Arms reaching forward to handlebars
    const leftIsFar = shoulderL.y < shoulderR.y;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.1 * s;
    line(leftIsFar ? shoulderL : shoulderR, leftIsFar ? barL : barR);

    // Rider courier jacket torso
    fillPoly([hipL, hipR, shoulderR, shoulderL], '#1e293b', '#0f172a', 1.0);

    // Orange chest vest accent stripe
    fillPoly(
      [
        pt(-1.6, -1.3, 12.2 + roadVibe),
        pt(-1.6, 1.3, 12.2 + roadVibe),
        pt(-0.8, 1.6, 15.6 + roadVibe),
        pt(-0.8, -1.6, 15.6 + roadVibe),
      ],
      '#f97316'
    );

    // Near arm reaching handlebar
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2.1 * s;
    line(leftIsFar ? shoulderR : shoulderL, leftIsFar ? barR : barL);

    // Full-face / open-face courier helmet
    const head = pt(0.2, 0, 19.3 + roadVibe);
    ctx.fillStyle = isCargo ? '#f8fafc' : '#38bdf8';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.0 * s;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2.35 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tinted visor strip facing forward
    const visor = pt(1.3, 0, 19.2 + roadVibe);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(visor.x, visor.y, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Crisp floating courier badge (`#N • cargo/cap`)
  if (typeof cargoCount === 'number') {
    const anchorZ = Math.max(withRider ? 22.8 : 16.0, boxTop + 3.0);
    const anchor = pt(-2.2, 0, anchorZ);
    drawCourierFloatingBadge(ctx, anchor, cargoCount, cargoCapacity, invScale, courierSlotIndex);
  }

  ctx.restore();
}

export interface ParkedScooterRenderEntry {
  index: number;
  modelId: ScooterModelId;
}

/**
 * Draws the upgraded exterior 4-bay covered two-wheeler shelter against the Base SW wall,
 * rendering parked bicycles and scooters neatly beneath the translucent canopy roof.
 */
export function drawBikeRackWithOptionalBike(
  ctx: CanvasRenderingContext2D,
  rack: BaseBikeRackSpec,
  parkedBikes: boolean | readonly number[],
  parkedScooters: readonly ParkedScooterRenderEntry[] = []
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Concrete shelter pad flush against the BAZA garage wall
  const p0 = isoToCanvas(rack.uMin, rack.vMin);
  const p1 = isoToCanvas(rack.uMax, rack.vMin);
  const p2 = isoToCanvas(rack.uMax, rack.vMax);
  const p3 = isoToCanvas(rack.uMin, rack.vMax);

  ctx.fillStyle = 'rgba(51, 65, 85, 0.42)';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.lineWidth = 1.05;
  ctx.stroke();

  // Front safety threshold stripe along yard entrance edge (vMin + 0.6)
  const thA = isoToCanvas(rack.uMin + 0.8, rack.vMin + 0.6);
  const thB = isoToCanvas(rack.uMax - 0.8, rack.vMin + 0.6);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.58)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(thA.x, thA.y);
  ctx.lineTo(thB.x, thB.y);
  ctx.stroke();

  // Painted parking bay dividers across 4 bays
  const bayWidth = (rack.uMax - rack.uMin) / Math.max(1, rack.hoopsU.length);
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.36)';
  ctx.lineWidth = 0.85;
  for (let i = 1; i < rack.hoopsU.length; i++) {
    const divU = rack.uMin + bayWidth * i;
    const d0 = isoToCanvas(divU, rack.vMin + 1.0);
    const d1 = isoToCanvas(divU, rack.vMax - 1.2);
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.stroke();
  }

  // Subtle roof shadow cast across the pad
  const shadowOffsetX = 2.6;
  const shadowOffsetY = 1.4;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
  ctx.beginPath();
  ctx.moveTo(p0.x + shadowOffsetX, p0.y + shadowOffsetY);
  ctx.lineTo(p1.x + shadowOffsetX, p1.y + shadowOffsetY);
  ctx.lineTo(p2.x + shadowOffsetX, p2.y + shadowOffsetY);
  ctx.lineTo(p3.x + shadowOffsetX, p3.y + shadowOffsetY);
  ctx.closePath();
  ctx.fill();

  // Horizontal steel mounting rail + compact low wheel-stop bollards at rear of each bay
  const railA = isoToCanvas(rack.uMin + 1.8, rack.vMax - 1.6);
  const railB = isoToCanvas(rack.uMax - 1.8, rack.vMax - 1.6);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(railA.x, railA.y);
  ctx.lineTo(railB.x, railB.y);
  ctx.stroke();

  const drawWheelStop = (u: number) => {
    const baseNear = isoToCanvas(u, rack.vMax - 3.6);
    const baseFar = isoToCanvas(u, rack.vMax - 1.2);
    const stopH = 3.2;

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(baseFar.x, baseFar.y);
    ctx.lineTo(baseFar.x, baseFar.y - stopH);
    ctx.lineTo(baseNear.x, baseNear.y - stopH);
    ctx.lineTo(baseNear.x, baseNear.y);
    ctx.stroke();

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(baseFar.x, baseFar.y - 0.35);
    ctx.lineTo(baseFar.x, baseFar.y - stopH);
    ctx.lineTo(baseNear.x, baseNear.y - stopH);
    ctx.lineTo(baseNear.x, baseNear.y - 0.35);
    ctx.stroke();
  };

  // Back corner posts under the canopy roof (drawn before parked two-wheelers for correct Z order)
  const postBackH = 14.5;
  const postFrontH = 12.2;
  const postInsetU = 1.1;
  const postInsetV = 0.9;
  const bPostL = isoToCanvas(rack.uMin + postInsetU, rack.vMax - postInsetV);
  const bPostR = isoToCanvas(rack.uMax - postInsetU, rack.vMax - postInsetV);
  const fPostL = isoToCanvas(rack.uMin + postInsetU, rack.vMin + postInsetV);
  const fPostR = isoToCanvas(rack.uMax - postInsetU, rack.vMin + postInsetV);

  const drawPost = (base: Vec2, h: number) => {
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, base.y - h);
    ctx.stroke();

    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(base.x - 0.25, base.y);
    ctx.lineTo(base.x - 0.25, base.y - h);
    ctx.stroke();
  };

  drawPost(bPostL, postBackH);
  drawPost(bPostR, postBackH);

  // Assign parked bicycles & scooters cleanly into bays 0..3 without overlapping
  const bikeIndices =
    typeof parkedBikes === 'boolean' ? (parkedBikes ? [1] : []) : parkedBikes;

  const baySlotVehicle = new Map<
    number,
    | { kind: 'bike'; seed: number }
    | { kind: 'scooter'; modelId: ScooterModelId; seed: number }
  >();
  const preferredBayOrder = [1, 2, 0, 3];
  const claimFreeBay = (preferred?: number): number | null => {
    if (
      preferred !== undefined &&
      preferred >= 0 &&
      preferred < rack.hoopsU.length &&
      !baySlotVehicle.has(preferred)
    ) {
      return preferred;
    }
    for (const candidate of preferredBayOrder) {
      if (candidate < rack.hoopsU.length && !baySlotVehicle.has(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  for (const bikeIdx of bikeIndices) {
    const preferred = bikeIdx === 1 ? 1 : bikeIdx === 2 ? 2 : bikeIdx === 3 ? 0 : 3;
    const bay = claimFreeBay(preferred);
    if (bay !== null) {
      baySlotVehicle.set(bay, { kind: 'bike', seed: 0.35 + bikeIdx * 0.5 });
    }
  }
  for (const scooter of parkedScooters) {
    const bay = claimFreeBay();
    if (bay !== null) {
      baySlotVehicle.set(bay, {
        kind: 'scooter',
        modelId: scooter.modelId,
        seed: 0.25 + scooter.index * 0.45,
      });
    }
  }

  for (let i = 0; i < rack.hoopsU.length; i++) {
    const u = rack.hoopsU[i];
    drawWheelStop(u);
    const parkedItem = baySlotVehicle.get(i);
    if (!parkedItem) continue;

    const pt =
      i === 1 && Math.abs(u - rack.parkedU) < 0.5
        ? { x: rack.parkedX, y: rack.parkedY }
        : isoToCanvas(u, rack.parkedV);

    if (parkedItem.kind === 'bike') {
      drawIsometricBicycle(ctx, {
        x: pt.x,
        y: pt.y,
        angle: rack.parkedAngle,
        withRider: false,
        wheelPhase: parkedItem.seed,
        scale: DEFAULT_BICYCLE_SCALE,
      });
    } else {
      drawIsometricScooter(ctx, {
        x: pt.x,
        y: pt.y,
        angle: rack.parkedAngle,
        withRider: false,
        wheelPhase: parkedItem.seed,
        modelId: parkedItem.modelId,
        scale: DEFAULT_SCOOTER_SCALE,
      });
    }
  }

  // Front support posts + sloped translucent canopy roof above parked vehicles
  drawPost(fPostL, postFrontH);
  drawPost(fPostR, postFrontH);

  const roof0 = { x: p0.x, y: p0.y - postFrontH };
  const roof1 = { x: p1.x, y: p1.y - postFrontH };
  const roof2 = { x: p2.x, y: p2.y - postBackH };
  const roof3 = { x: p3.x, y: p3.y - postBackH };

  ctx.fillStyle = 'rgba(56, 189, 248, 0.20)';
  ctx.beginPath();
  ctx.moveTo(roof0.x, roof0.y);
  ctx.lineTo(roof1.x, roof1.y);
  ctx.lineTo(roof2.x, roof2.y);
  ctx.lineTo(roof3.x, roof3.y);
  ctx.closePath();
  ctx.fill();

  // Internal roof purlins/ribs aligned with bays
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 0.85;
  for (let i = 1; i < rack.hoopsU.length; i++) {
    const tFrac = i / rack.hoopsU.length;
    ctx.beginPath();
    ctx.moveTo(roof0.x + (roof1.x - roof0.x) * tFrac, roof0.y + (roof1.y - roof0.y) * tFrac);
    ctx.lineTo(roof3.x + (roof2.x - roof3.x) * tFrac, roof3.y + (roof2.y - roof3.y) * tFrac);
    ctx.stroke();
  }

  // Canopy perimeter steel frame + subtle orange courier fascia strip along the front edge
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  ctx.moveTo(roof0.x, roof0.y);
  ctx.lineTo(roof1.x, roof1.y);
  ctx.lineTo(roof2.x, roof2.y);
  ctx.lineTo(roof3.x, roof3.y);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(roof0.x, roof0.y + 0.6);
  ctx.lineTo(roof1.x, roof1.y + 0.6);
  ctx.stroke();

  ctx.restore();
}

/**
 * Renders the courier's active road route with a subtle, slender stroke so streets
 * and buildings remain crisp and unobstructed.
 */
export function drawCourierRoute(
  ctx: CanvasRenderingContext2D,
  route: readonly Point[],
  invScale: number
) {
  if (route.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Subtle dark outer casing
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.58)';
  ctx.lineWidth = 4.2 * invScale;
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  for (let i = 1; i < route.length; i++) {
    ctx.lineTo(route[i].x, route[i].y);
  }
  ctx.stroke();

  // Slender courier orange inner line
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 2.1 * invScale;
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  for (let i = 1; i < route.length; i++) {
    ctx.lineTo(route[i].x, route[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Renders a crisp, understated destination marker at the active pickup or delivery stop.
 */
export function drawCourierDestinationPin(
  ctx: CanvasRenderingContext2D,
  targetPoint: Point,
  invScale: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(targetPoint.x, targetPoint.y, 5.5 * invScale, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(249, 115, 22, 0.24)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(targetPoint.x, targetPoint.y, 3.0 * invScale, 0, Math.PI * 2);
  ctx.fillStyle = '#f97316';
  ctx.fill();
  ctx.lineWidth = 1.4 * invScale;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

/**
 * Renders the dedicated package loading/unloading bay on the Base yard directly opposite
 * the street driveway entrance (flush in front of the Base building front facade).
 */
export function drawBaseLoadingZone(
  ctx: CanvasRenderingContext2D,
  zone: BaseLoadingZoneSpec
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const p0 = isoToCanvas(zone.uMin, zone.vMin);
  const p1 = isoToCanvas(zone.uMax, zone.vMin);
  const p2 = isoToCanvas(zone.uMax, zone.vMax);
  const p3 = isoToCanvas(zone.uMin, zone.vMax);

  // Subtle translucent concrete/amber transfer bay fill
  ctx.fillStyle = 'rgba(245, 158, 11, 0.13)';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();

  // Crisp dashed amber logistics zone border
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Accent loading dock threshold strip flush against the Base entrance (uMax edge)
  const dockIn0 = isoToCanvas(zone.uMax - 3.2, zone.vMin + 2.0);
  const dockIn1 = isoToCanvas(zone.uMax - 0.6, zone.vMin + 2.0);
  const dockIn2 = isoToCanvas(zone.uMax - 0.6, zone.vMax - 2.0);
  const dockIn3 = isoToCanvas(zone.uMax - 3.2, zone.vMax - 2.0);

  ctx.fillStyle = 'rgba(249, 115, 22, 0.34)';
  ctx.beginPath();
  ctx.moveTo(dockIn0.x, dockIn0.y);
  ctx.lineTo(dockIn1.x, dockIn1.y);
  ctx.lineTo(dockIn2.x, dockIn2.y);
  ctx.lineTo(dockIn3.x, dockIn3.y);
  ctx.closePath();
  ctx.fill();

  // Small directional chevron at bay center pointing toward Base entrance (+u)
  const tip = isoToCanvas(zone.stopU + 2.4, zone.stopV);
  const wingL = isoToCanvas(zone.stopU - 1.6, zone.stopV - 3.0);
  const wingR = isoToCanvas(zone.stopU - 1.6, zone.stopV + 3.0);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.78)';
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  ctx.moveTo(wingL.x, wingL.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(wingR.x, wingR.y);
  ctx.stroke();

  ctx.restore();
}

export interface GasStationPylonSpec {
  id: 'sf_gas_station_1' | 'sf_gas_station_2';
  u: number;
  v: number;
}

/** Exact roadside pylon anchors placed beside each gas station driveway without blocking lanes or entry */
export const GAS_STATION_PRICE_PYLONS: readonly GasStationPylonSpec[] = [
  { id: 'sf_gas_station_1', u: -936, v: 414 },
  { id: 'sf_gas_station_2', u: 164, v: -686 },
] as const;

/**
 * Renders a crisp isometric roadside gas-station price pylon with a dark illuminated cabinet,
 * FUEL header, trend arrow, and large high-contrast price readable on both phones and desktops.
 */
export function drawGasStationPricePylon(
  ctx: CanvasRenderingContext2D,
  station: GasStationPylonSpec,
  fuelPricePerLiter: number,
  prevPricePerLiter: number,
  invScale: number,
  language: SupportedLanguage = 'pl'
) {
  const base = isoToCanvas(station.u, station.v);
  // Keep readable floor even when zoomed out on mobile screens, cap when zoomed in closely
  const s = Math.max(0.85, Math.min(2.35, invScale * 1.08));

  const postH = 18 * s;
  const boardW = 54 * s;
  const boardH = 30 * s;
  const bx = base.x - boardW / 2;
  const by = base.y - postH - boardH;
  const r = 4.2 * s;

  const delta = fuelPricePerLiter - prevPricePerLiter;
  const isCheaper = delta < -0.004;
  const isMoreExpensive = delta > 0.004;
  const priceText = `$${fuelPricePerLiter.toFixed(2)}`;
  const trendSymbol = isCheaper ? '▼' : isMoreExpensive ? '▲' : '';
  const priceColor = isCheaper ? '#34d399' : isMoreExpensive ? '#fbbf24' : '#6ee7b7';
  const accentColor = isCheaper ? '#10b981' : isMoreExpensive ? '#f59e0b' : '#38bdf8';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Ground shadow + concrete plinth base
  ctx.fillStyle = 'rgba(15, 23, 42, 0.36)';
  ctx.beginPath();
  ctx.ellipse(base.x + 2.2 * s, base.y + 1.2 * s, 7.5 * s, 3.6 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#334155';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.0 * s;
  ctx.beginPath();
  ctx.ellipse(base.x, base.y, 4.4 * s, 2.2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 2. Vertical metallic pylon support column
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4.2 * s;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(base.x, base.y - postH);
  ctx.stroke();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.9 * s;
  ctx.beginPath();
  ctx.moveTo(base.x - 0.5 * s, base.y);
  ctx.lineTo(base.x - 0.5 * s, base.y - postH);
  ctx.stroke();

  // 3. Dark illuminated pylon sign cabinet
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + boardW - r, by);
  ctx.quadraticCurveTo(bx + boardW, by, bx + boardW, by + r);
  ctx.lineTo(bx + boardW, by + boardH - r);
  ctx.quadraticCurveTo(bx + boardW, by + boardH, bx + boardW - r, by + boardH);
  ctx.lineTo(bx + r, by + boardH);
  ctx.quadraticCurveTo(bx, by + boardH, bx, by + boardH - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();

  ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();

  // Top header band inside sign
  const headerH = 9.5 * s;
  ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
  ctx.beginPath();
  ctx.moveTo(bx + r, by + 0.8 * s);
  ctx.lineTo(bx + boardW - r, by + 0.8 * s);
  ctx.quadraticCurveTo(bx + boardW - 0.8 * s, by + 0.8 * s, bx + boardW - 0.8 * s, by + r);
  ctx.lineTo(bx + boardW - 0.8 * s, by + headerH);
  ctx.lineTo(bx + 0.8 * s, by + headerH);
  ctx.lineTo(bx + 0.8 * s, by + r);
  ctx.quadraticCurveTo(bx + 0.8 * s, by + 0.8 * s, bx + r, by + 0.8 * s);
  ctx.closePath();
  ctx.fill();

  // Miniature fuel pump glyph on header left
  const pumpX = bx + 5.2 * s;
  const pumpY = by + 2.4 * s;
  ctx.fillStyle = accentColor;
  ctx.fillRect(pumpX, pumpY, 4.2 * s, 5.2 * s);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(pumpX + 0.8 * s, pumpY + 0.8 * s, 2.6 * s, 1.8 * s);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.8 * s;
  ctx.beginPath();
  ctx.moveTo(pumpX + 4.2 * s, pumpY + 1.5 * s);
  ctx.lineTo(pumpX + 5.6 * s, pumpY + 2.4 * s);
  ctx.lineTo(pumpX + 5.4 * s, pumpY + 4.8 * s);
  ctx.stroke();

  // "PALIWO" / "FUEL" header text + optional trend indicator
  const headerFontSize = (language === 'pl' ? 6.6 : 7.4) * s;
  ctx.font = `800 ${headerFontSize}px 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(language === 'pl' ? 'PALIWO' : 'FUEL', bx + 12.2 * s, by + headerH / 2 + 0.3 * s);

  if (trendSymbol) {
    ctx.textAlign = 'right';
    ctx.fillStyle = isCheaper ? '#34d399' : '#fb7185';
    ctx.fillText(trendSymbol, bx + boardW - 4.2 * s, by + headerH / 2 + 0.3 * s);
  }

  // 4. Large high-contrast price display ($1.60) with crisp dark outline
  const priceFontSize = 13.6 * s;
  ctx.font = `800 ${priceFontSize}px 'JetBrains Mono', 'Inter', ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const priceY = by + headerH + (boardH - headerH) / 2 + 0.6 * s;

  ctx.strokeStyle = '#020617';
  ctx.lineWidth = 2.6 * s;
  ctx.strokeText(priceText, base.x, priceY);
  ctx.fillStyle = priceColor;
  ctx.fillText(priceText, base.x, priceY);

  ctx.restore();
}

