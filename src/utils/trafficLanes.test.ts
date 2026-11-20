import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRightHandLaneOffsets,
  classifyRoadSegment,
  computeRightHandUnitIso,
  getLaneLateralOffsetIso,
} from './trafficLanes';
import { ROUNDABOUTS, canvasToIso, isoToCanvas } from './cityMap';
import { INITIAL_ROAD_GRAPH } from '../data/initialRoadGraph';
import { findShortestPath } from './pathfinding';

test('computeRightHandUnitIso computes exact world-space right perpendicular vector for all 4 directions and CCW roundabouts', () => {
  // Heading +v (NE, up-right) -> right is +u (SE, down-right)
  assert.deepEqual(computeRightHandUnitIso(0, 100), { rightU: 1, rightV: 0 });
  // Heading -v (SW, down-left) -> right is -u (NW, up-left)
  assert.deepEqual(computeRightHandUnitIso(0, -100), { rightU: -1, rightV: 0 });
  // Heading +u (SE, down-right) -> right is -v (SW, down-left)
  assert.deepEqual(computeRightHandUnitIso(100, 0), { rightU: 0, rightV: -1 });
  // Heading -u (NW, up-left) -> right is +v (NE, up-right)
  assert.deepEqual(computeRightHandUnitIso(-100, 0), { rightU: 0, rightV: 1 });

  // Tangent on CCW roundabout at theta = 315 deg (du=+0.707, dv=+0.707) -> right is outward (+0.707, -0.707)
  const r = computeRightHandUnitIso(1, 1);
  assert.ok(Math.abs(r.rightU - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(r.rightV - -Math.SQRT1_2) < 1e-6);
});

test('classifyRoadSegment distinguishes 2-lane avenues, 1-lane local streets, and 2-lane roundabouts', () => {
  const ave = classifyRoadSegment(isoToCanvas(0, -500), isoToCanvas(0, -100));
  assert.equal(ave.roadClass, 'avenue');
  assert.equal(ave.lanesPerDirection, 2);

  const local = classifyRoadSegment(isoToCanvas(340, -500), isoToCanvas(340, -100));
  assert.equal(local.roadClass, 'local');
  assert.equal(local.lanesPerDirection, 1);

  // Roundabout R1 chord (k=0 -> k=1 on ringRadius=61)
  const rbA = isoToCanvas(61, -740);
  const rbB = isoToCanvas(61 * Math.cos(Math.PI / 8), -740 + 61 * Math.sin(Math.PI / 8));
  const rb = classifyRoadSegment(rbA, rbB);
  assert.equal(rb.roadClass, 'roundabout');
  assert.equal(rb.lanesPerDirection, 2);
  assert.equal(rb.roundaboutId, 'r1');
});

test('lane architecture provides distinct outer lane 0 and inner left-turn/overtaking lane 1 on 2-lane avenues and roundabouts', () => {
  const bikeLane0 = getLaneLateralOffsetIso('avenue', { laneIndex: 0, vehicleClass: 'bicycle' });
  const bikeLane1 = getLaneLateralOffsetIso('avenue', { laneIndex: 1, vehicleClass: 'bicycle' });
  const carLane0 = getLaneLateralOffsetIso('avenue', { laneIndex: 0, vehicleClass: 'car' });
  const carLane1 = getLaneLateralOffsetIso('avenue', { laneIndex: 1, vehicleClass: 'car' });

  // Outer lane 0 stays close to right curb; inner lane 1 sits cleanly between centerline (+2) and divider (+13.5)
  assert.ok(bikeLane0 >= carLane0 && bikeLane0 < 24, 'cyclist outer lane 0 keeps right near curb');
  assert.ok(bikeLane1 > 2 && bikeLane1 < 13.5, 'bicycle left-turn lane 1 sits cleanly inside left lane');
  assert.ok(carLane1 > 2 && carLane1 < 13.5, 'car inner lane 1 fits cleanly between yellow centerline and dashed divider');
  assert.ok(carLane0 > 13.5 && carLane0 < 24, 'car outer lane 0 fits cleanly between dashed divider and shoulder');

  // Roundabout: outer lane 0 > 0 (radially outward), inner lane 1 < 0 (radially inward)
  const rbBikeOuter = getLaneLateralOffsetIso('roundabout', { laneIndex: 0, vehicleClass: 'bicycle' });
  const rbBikeInner = getLaneLateralOffsetIso('roundabout', { laneIndex: 1, vehicleClass: 'bicycle' });
  const rbCarInner = getLaneLateralOffsetIso('roundabout', { laneIndex: 1, vehicleClass: 'car' });
  assert.ok(rbBikeOuter > 10 && rbBikeOuter < 21, 'bicycle outer roundabout lane sits inside outerAsphaltRadius');
  assert.ok(rbBikeInner < -5 && rbBikeInner > -20, 'bicycle inner roundabout lane sits cleanly inside inner ring');
  assert.ok(rbCarInner < -5 && rbCarInner > -20, 'car lane 1 stays cleanly on inner roundabout lane');
});

test('applyRightHandLaneOffsets aligns 90-degree right turns cleanly via exact miter onto the new right lane', () => {
  // Route along al. Główna (u=0) heading +v from v=-300 to v=0, turning RIGHT onto al. Dworcowa (v=0) heading +u to u=300
  const centerline = [isoToCanvas(0, -300), isoToCanvas(0, 0), isoToCanvas(300, 0)];
  const offsetPts = applyRightHandLaneOffsets(centerline, {
    laneIndex: 0,
    vehicleClass: 'bicycle',
  });

  assert.equal(offsetPts.length, 3, '90-degree right-turn miter should stay crisp with 3 exact lane waypoints');

  const p0 = canvasToIso(offsetPts[0].x, offsetPts[0].y);
  const p1 = canvasToIso(offsetPts[1].x, offsetPts[1].y);
  const p2 = canvasToIso(offsetPts[2].x, offsetPts[2].y);

  assert.ok(Math.abs(p0.u - 20.5) < 0.2, `expected start u≈20.5, got ${p0.u}`);
  assert.ok(Math.abs(p1.u - 20.5) < 0.2, `expected miter u≈20.5, got ${p1.u}`);
  assert.ok(Math.abs(p1.v - -20.5) < 0.2, `expected miter v≈-20.5, got ${p1.v}`);
  assert.ok(Math.abs(p2.v - -20.5) < 0.2, `expected end v≈-20.5, got ${p2.v}`);
});

test('applyRightHandLaneOffsets smoothly shifts to left lane (lane 1) 1 intersection before a left turn and returns to right lane (lane 0) afterward', () => {
  // 2-block approach on al. Główna (u=0):
  //   Block 1: v=-700 -> v=-380 (straight through ul. Parkowa) -> stays in right lane (u≈20.5)
  //   Block 2: v=-380 -> v=0    (turns LEFT onto al. Dworcowa) -> transitions smoothly to left lane (u≈8.0)
  //   Block 3: u=0 -> u=-340    (continues straight along al. Dworcowa) -> turns into left lane (v≈8.0), then returns smoothly to right lane (v≈20.5)
  const centerline = [
    isoToCanvas(0, -640),
    isoToCanvas(0, -380),
    isoToCanvas(0, 0),
    isoToCanvas(-340, 0),
  ];

  const offsetPts = applyRightHandLaneOffsets(centerline, {
    laneIndex: 0,
    vehicleClass: 'bicycle',
  });
  const isoPts = offsetPts.map((p) => canvasToIso(p.x, p.y));

  // Block 1 (before straight intersection v=-380): remains in right lane u ≈ 20.5
  const block1Pts = isoPts.filter((p) => p.v <= -379);
  assert.ok(block1Pts.length >= 2, 'should have points on first block');
  for (const p of block1Pts) {
    assert.ok(Math.abs(p.u - 20.5) < 0.3, `expected right lane u≈20.5 before straight intersection, got ${p.u} at v=${p.v}`);
  }

  // Block 2 (approaching left turn at v=0): smoothly transitions from u≈20.5 to u≈8.0 BEFORE v=0
  const preTurnPt = isoPts.find((p) => p.v > -45 && p.v < 12 && Math.abs(p.u - 8.0) < 0.3);
  assert.ok(preTurnPt, 'should be settled in left lane (u≈8.0) before left turn intersection');

  // Exact left-turn miter corner at (u≈8.0, v≈8.0)
  const cornerPt = isoPts.find((p) => Math.abs(p.u - 8.0) < 0.3 && Math.abs(p.v - 8.0) < 0.3);
  assert.ok(cornerPt, 'left turn between 2-lane avenues should execute cleanly through left-lane corner (8, 8)');

  // Outgoing avenue (u -> -340): returns smoothly back to right lane (v≈20.5)
  const endPt = isoPts[isoPts.length - 1];
  assert.ok(Math.abs(endPt.v - 20.5) < 0.3, `expected return to right lane v≈20.5 after left turn, got ${endPt.v}`);
});

test('roundabout entry and exit connect smoothly onto outer lane (right/straight) without any inward dip toward centerline ringRadius=61', () => {
  const r1 = ROUNDABOUTS.find((r) => r.id === 'r1')!;
  // Route from base -> across R1 heading RIGHT onto al. Zachodnia (+u, 90° CCW)
  const res = findShortestPath(INITIAL_ROAD_GRAPH, 'base', 'n_u_5_v_2');
  assert.ok(res, 'expected valid path from base through R1 to ul. Słoneczna / al. Zachodnia');

  const lanePts = applyRightHandLaneOffsets(res.points, {
    laneIndex: 0,
    vehicleClass: 'bicycle',
  });
  const isoPts = lanePts.map((p) => canvasToIso(p.x, p.y));

  // Every point within the roundabout asphalt apron (r < outerAsphaltRadius + 8) must stay
  // cleanly on or outside the outer lane circle (r >= 74.0) — NEVER dipping inward toward ringRadius=61!
  const nearR1 = isoPts.filter((p) => Math.hypot(p.u - r1.u, p.v - r1.v) < r1.outerAsphaltRadius + 6);
  assert.ok(nearR1.length >= 8, `expected smooth multi-point curve around R1, got ${nearR1.length} pts`);

  for (const p of nearR1) {
    const r = Math.hypot(p.u - r1.u, p.v - r1.v);
    assert.ok(
      r >= 74.0,
      `outer-lane roundabout path dipped inward to r=${r.toFixed(2)} (expected >= 74.0 near R=75.5, no jog toward ringRadius=61)`
    );
  }
});

test('left turn (270° CCW) through a roundabout shifts to left lane before entry, rides inner roundabout ring, and returns to right lane after exit', () => {
  const r1 = ROUNDABOUTS.find((r) => r.id === 'r1')!;
  // Route from base -> al. Główna (+v) -> R1 LEFT TURN (270° CCW) -> al. Zachodnia (-u, heading NW toward u=-360)
  const res = findShortestPath(INITIAL_ROAD_GRAPH, 'base', 'n_u_3_v_2');
  assert.ok(res, 'expected valid path from base turning left at R1 onto NW al. Zachodnia');

  const lanePts = applyRightHandLaneOffsets(res.points, {
    laneIndex: 0,
    vehicleClass: 'bicycle',
  });
  const isoPts = lanePts.map((p) => canvasToIso(p.x, p.y));

  // 1. Before entering R1 along al. Główna (v between -880 and -815), vehicle should have moved into left lane u≈8.0..8.6
  const preRoundaboutLeft = isoPts.find(
    (p) => p.v > -870 && p.v < -810 && Math.abs(p.u - 8.0) < 1.0
  );
  assert.ok(preRoundaboutLeft, 'expected vehicle to move into left lane (u≈8.0) before entering R1 for a left turn');

  // 2. Inside R1 arc, vehicle rides smoothly along the INNER roundabout lane (R ≈ 50.5, strictly between innerCurb 38 and ringRadius 61)
  const innerArcPts = isoPts.filter((p) => {
    const r = Math.hypot(p.u - r1.u, p.v - r1.v);
    return r >= 49.0 && r <= 52.0;
  });
  assert.ok(innerArcPts.length >= 10, `expected smooth inner-lane arc (>= 10 pts around R≈50.5), got ${innerArcPts.length}`);

  // 3. Never clips inner curb (r >= 48)
  for (const p of isoPts) {
    const r = Math.hypot(p.u - r1.u, p.v - r1.v);
    assert.ok(r >= 48.0, `inner-lane roundabout trajectory clipped too close to island (r=${r.toFixed(2)})`);
  }

  // 4. After exiting R1 onto NW al. Zachodnia (-u, v=-740, right is +v), returns smoothly to right lane (v ≈ -740 + 20.5 = -719.5)
  const endPt = isoPts[isoPts.length - 1];
  assert.ok(
    Math.abs(endPt.v - (-740 + 20.5)) < 0.5,
    `expected smooth return to right lane v≈-719.5 after roundabout exit, got v=${endPt.v.toFixed(2)}`
  );
});
