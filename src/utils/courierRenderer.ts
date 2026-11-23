import type { Point } from '../types/roadGraph';
import type { BaseBikeRackSpec, BaseLoadingZoneSpec } from './cityMap';
import { isoToCanvas } from './cityMap';

/** Compact, minimalist bicycle & rider scale (~20% smaller than 0.67 for crisp city readability) */
export const DEFAULT_BICYCLE_SCALE = 0.54;
/** Orthographic isometric scale for the 20-package used delivery van (fits cleanly in P1–P8 stalls) */
export const DEFAULT_VAN_SCALE = 1.0;

export interface DeliveryVanRenderOptions {
  x: number;
  y: number;
  /** World-canvas heading angle in radians (Math.atan2(dy, dx)) */
  angle: number;
  /** Wheel rotation phase in radians */
  wheelPhase: number;
  /** True while halted at destination handing off parcels */
  isDelivering?: boolean;
  /** Current number of packages onboard (draws crisp X/20 cargo counter when provided) */
  cargoCount?: number;
  /** Maximum van cargo capacity (defaults to 20) */
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
    cargoCount,
    cargoCapacity = 20,
    invScale = 1,
    scale = DEFAULT_VAN_SCALE,
  } = opts;

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

  const zChassis = 2.0 + driveBob;
  const zStripeBot = 4.2 + driveBob;
  const zStripeTop = 6.1 + driveBob;
  const zBelt = 6.9 + driveBob;
  const zRoof = 11.2 + driveBob;
  const zHood = 6.2 + driveBob;

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

    // Crisp silver hubcap center
    const hub = pt(axleFwd, wheelSide, r);
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 0.95 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#cbd5e1';
    ctx.fill();
  };

  // Draw far-side wheels peeking cleanly under the chassis
  drawWheel(-5.0, farSideSign);
  drawWheel(5.2, farSideSign);

  // 3. Draw vertical hull faces sorted back-to-front (only the 2 viewer-facing faces + sloped hood/windshield)
  const drawSideFace = (sideSign: number) => {
    const sideCoord = sideSign * halfW;
    const isLitSide = sideSign === -1;
    const bodyFill = isLitSide ? '#ffffff' : '#e2e8f0';
    const stripeFill = isLitSide ? '#f97316' : '#ea580c';
    const bumperFill = isLitSide ? '#475569' : '#334155';

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

    // Lower dark chassis sill strip
    fillPoly(
      [
        pt(rearL, sideCoord, zChassis),
        pt(frontL, sideCoord, zChassis),
        pt(frontL, sideCoord, zChassis + 1.25),
        pt(rearL, sideCoord, zChassis + 1.25),
      ],
      bumperFill
    );

    // Signature company orange stripe running along cargo box + cab door
    fillPoly(
      [
        pt(rearL + 0.2, sideCoord, zStripeBot),
        pt(frontL - 0.3, sideCoord, zStripeBot),
        pt(frontL - 0.3, sideCoord, zStripeTop),
        pt(rearL + 0.2, sideCoord, zStripeTop),
      ],
      stripeFill
    );

    // Side cab window
    fillPoly(
      [
        pt(cabSplitL + 0.35, sideCoord, zBelt + 0.2),
        pt(hoodL - 0.3, sideCoord, zBelt + 0.2),
        pt(cabSplitL + 0.55, sideCoord, zRoof - 0.9),
        pt(cabSplitL + 0.35, sideCoord, zRoof - 0.9),
      ],
      '#38bdf8',
      '#1e293b',
      0.85 * s
    );

    // Subtle vertical cargo/cab panel seam
    const seamBot = pt(cabSplitL - 0.1, sideCoord, zChassis + 1.2);
    const seamTop = pt(cabSplitL - 0.1, sideCoord, zRoof - 0.3);
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.45)';
    ctx.lineWidth = 0.85 * s;
    ctx.beginPath();
    ctx.moveTo(seamBot.x, seamBot.y);
    ctx.lineTo(seamTop.x, seamTop.y);
    ctx.stroke();

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
    fillPoly(nosePts, '#f1f5f9', '#1e293b', 1.2 * s);

    // Dark bumper bar
    fillPoly(
      [
        pt(frontL, -halfW, zChassis),
        pt(frontL, halfW, zChassis),
        pt(frontL, halfW, zChassis + 1.3),
        pt(frontL, -halfW, zChassis + 1.3),
      ],
      '#334155',
      '#1e293b',
      0.9 * s
    );

    // Dark front radiator grille
    fillPoly(
      [
        pt(frontL, -halfW * 0.56, zChassis + 1.55),
        pt(frontL, halfW * 0.56, zChassis + 1.55),
        pt(frontL, halfW * 0.56, zHood - 0.9),
        pt(frontL, -halfW * 0.56, zHood - 0.9),
      ],
      '#1e293b'
    );

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

    // Warm crisp headlights
    const drawHeadlight = (sideSign: number) => {
      fillPoly(
        [
          pt(frontL, sideSign * (halfW - 0.25), zChassis + 1.7),
          pt(frontL, sideSign * (halfW - 1.35), zChassis + 1.7),
          pt(frontL, sideSign * (halfW - 1.35), zChassis + 2.95),
          pt(frontL, sideSign * (halfW - 0.25), zChassis + 2.95),
        ],
        '#fef08a',
        '#1e293b',
        0.65 * s
      );
    };
    drawHeadlight(-1);
    drawHeadlight(1);

    // Sloped white hood deck
    fillPoly(
      [
        pt(frontL, -halfW, zHood),
        pt(frontL, halfW, zHood),
        pt(hoodL, halfW, zBelt),
        pt(hoodL, -halfW, zBelt),
      ],
      '#f8fafc',
      '#1e293b',
      1.15 * s
    );

    // Sloped cab windshield
    fillPoly(
      [
        pt(hoodL, -halfW, zBelt),
        pt(hoodL, halfW, zBelt),
        pt(cabSplitL, halfW, zRoof),
        pt(cabSplitL, -halfW, zRoof),
      ],
      '#e2e8f0',
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
      '#38bdf8',
      '#0f172a',
      0.85 * s
    );

    // Crisp diagonal glass glare reflection
    const glA = pt(hoodL - 0.6, -halfW * 0.4, zBelt + 0.9);
    const glB = pt(cabSplitL + 0.65, -halfW * 0.05, zRoof - 1.0);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
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
    fillPoly(rearPts, '#cbd5e1', '#1e293b', 1.2 * s);

    // Dark rear bumper
    fillPoly(
      [
        pt(rearL, -halfW, zChassis),
        pt(rearL, halfW, zChassis),
        pt(rearL, halfW, zChassis + 1.3),
        pt(rearL, -halfW, zChassis + 1.3),
      ],
      '#334155',
      '#1e293b',
      0.9 * s
    );

    // Matching company orange rear stripe
    fillPoly(
      [
        pt(rearL, -halfW + 0.2, zStripeBot),
        pt(rearL, halfW - 0.2, zStripeBot),
        pt(rearL, halfW - 0.2, zStripeTop),
        pt(rearL, -halfW + 0.2, zStripeTop),
      ],
      '#ea580c'
    );

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

  // 4. Flat white cargo roof + subtle orange roof identification band
  fillPoly(
    [
      pt(rearL, -halfW, zRoof),
      pt(cabSplitL, -halfW, zRoof),
      pt(cabSplitL, halfW, zRoof),
      pt(rearL, halfW, zRoof),
    ],
    '#f8fafc',
    '#1e293b',
    1.2 * s
  );

  // Subtle orange company roof accent bar near cab edge
  fillPoly(
    [
      pt(cabSplitL - 2.3, -halfW + 0.75, zRoof),
      pt(cabSplitL - 0.55, -halfW + 0.75, zRoof),
      pt(cabSplitL - 0.55, halfW - 0.75, zRoof),
      pt(cabSplitL - 2.3, halfW - 0.75, zRoof),
    ],
    '#f97316'
  );

  // 5. Near-side wheels cleanly anchored along the lower wheel arches
  drawWheel(-5.0, nearSideSign);
  drawWheel(5.2, nearSideSign);

  // 6. Crisp floating onboard cargo counter badge (`X/20`) when active on route
  if (typeof cargoCount === 'number') {
    const badgeScale = Math.max(0.75, Math.min(1.55, invScale));
    const anchor = pt(-1.6, 0, zRoof + 4.8);
    const label = `${cargoCount}/${cargoCapacity}`;
    const fontSize = 9.5 * badgeScale;
    ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
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

  ctx.restore();
}

/**
 * Draws the exterior BAZA bike rack against the SW garage wall, plus any parked empty bicycles
 * (`boolean` for single starter bike or 1-based parked bike indices `1..3`).
 */
export function drawBikeRackWithOptionalBike(
  ctx: CanvasRenderingContext2D,
  rack: BaseBikeRackSpec,
  parkedBikes: boolean | readonly number[]
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

  const bikeIndices =
    typeof parkedBikes === 'boolean' ? (parkedBikes ? [1] : []) : parkedBikes;

  // Map 1-based bike index -> deterministic hoop index on the 4-hoop Base bike rack
  // Bike #1 keeps original hoop index 1 (rack.parkedU); Bike #2 uses hoop 2; Bike #3 uses hoop 0
  const occupiedHoopIndices = new Set<number>();
  for (const bikeIdx of bikeIndices) {
    if (bikeIdx === 1 && rack.hoopsU.length > 1) occupiedHoopIndices.add(1);
    else if (bikeIdx === 2 && rack.hoopsU.length > 2) occupiedHoopIndices.add(2);
    else if (bikeIdx === 3 && rack.hoopsU.length > 0) occupiedHoopIndices.add(0);
    else if (rack.hoopsU.length > 0) {
      occupiedHoopIndices.add(Math.min(bikeIdx - 1, rack.hoopsU.length - 1));
    }
  }

  for (let i = 0; i < rack.hoopsU.length; i++) {
    const u = rack.hoopsU[i];
    drawHoop(u);
    if (occupiedHoopIndices.has(i)) {
      const pt =
        i === 1 && Math.abs(u - rack.parkedU) < 0.5
          ? { x: rack.parkedX, y: rack.parkedY }
          : isoToCanvas(u, rack.parkedV);
      drawIsometricBicycle(ctx, {
        x: pt.x,
        y: pt.y,
        angle: rack.parkedAngle,
        withRider: false,
        wheelPhase: 0.35 + i * 0.5,
        scale: DEFAULT_BICYCLE_SCALE,
      });
    }
  }

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

