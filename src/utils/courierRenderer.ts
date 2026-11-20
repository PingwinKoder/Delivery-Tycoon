import type { BaseBikeRackSpec } from './cityMap';
import { isoToCanvas } from './cityMap';

/** Compact, minimalist bicycle & rider scale (~20% smaller than 0.67 for crisp city readability) */
export const DEFAULT_BICYCLE_SCALE = 0.54;

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
  /** Scale multiplier (defaults to DEFAULT_BICYCLE_SCALE in world pixel units) */
  scale?: number;
}

interface Vec2 {
  x: number;
  y: number;
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

  ctx.restore();
}

/**
 * Draws the exterior BAZA bike rack against the SW garage wall, plus the parked empty bicycle
 * whenever the courier is idle at base.
 */
export function drawBikeRackWithOptionalBike(
  ctx: CanvasRenderingContext2D,
  rack: BaseBikeRackSpec,
  showParkedBike: boolean
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Subtle concrete/slate mounting strip flush against the BAZA garage wall
  const p0 = isoToCanvas(rack.uMin, rack.vMin);
  const p1 = isoToCanvas(rack.uMax, rack.vMin);
  const p2 = isoToCanvas(rack.uMax, rack.vMax);
  const p3 = isoToCanvas(rack.uMin, rack.vMax);

  ctx.fillStyle = 'rgba(71, 85, 105, 0.32)';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(30, 41, 59, 0.45)';
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Horizontal steel mounting rail connecting all inverted-U hoops
  const railA = isoToCanvas(rack.uMin + 1.8, rack.vMax - 1.8);
  const railB = isoToCanvas(rack.uMax - 1.8, rack.vMax - 1.8);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  ctx.moveTo(railA.x, railA.y);
  ctx.lineTo(railB.x, railB.y);
  ctx.stroke();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(railA.x, railA.y - 0.35);
  ctx.lineTo(railB.x, railB.y - 0.35);
  ctx.stroke();

  // Clean isometric inverted-U steel hoop proportioned for the compact 0.54-scale bicycle
  const drawHoop = (u: number) => {
    const baseNear = isoToCanvas(u, rack.vMax - 4.0);
    const baseFar = isoToCanvas(u, rack.vMax - 1.1);
    const hoopH = 3.8;

    ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(baseNear.x + 1.0, baseNear.y + 0.35);
    ctx.lineTo(baseFar.x + 1.6, baseFar.y + 0.35);
    ctx.stroke();

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.moveTo(baseFar.x, baseFar.y);
    ctx.lineTo(baseFar.x, baseFar.y - hoopH);
    ctx.lineTo(baseNear.x, baseNear.y - hoopH);
    ctx.lineTo(baseNear.x, baseNear.y);
    ctx.stroke();

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(baseFar.x, baseFar.y - 0.35);
    ctx.lineTo(baseFar.x, baseFar.y - hoopH);
    ctx.lineTo(baseNear.x, baseNear.y - hoopH);
    ctx.lineTo(baseNear.x, baseNear.y - 0.35);
    ctx.stroke();
  };

  let bikeDrawn = false;
  for (const u of rack.hoopsU) {
    drawHoop(u);
    if (showParkedBike && !bikeDrawn && Math.abs(u - rack.parkedU) < 1) {
      drawIsometricBicycle(ctx, {
        x: rack.parkedX,
        y: rack.parkedY,
        angle: rack.parkedAngle,
        withRider: false,
        wheelPhase: 0.35,
        scale: DEFAULT_BICYCLE_SCALE,
      });
      bikeDrawn = true;
    }
  }

  if (showParkedBike && !bikeDrawn) {
    drawIsometricBicycle(ctx, {
      x: rack.parkedX,
      y: rack.parkedY,
      angle: rack.parkedAngle,
      withRider: false,
      wheelPhase: 0.35,
      scale: DEFAULT_BICYCLE_SCALE,
    });
  }

  ctx.restore();
}
