import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_PAUSE_SECONDS,
  createCourierFromPath,
  createIdleCourier,
  prependRackExitToPath,
  stepCourier,
  stitchWaypoints,
} from './courierSim';

test('courier executes full delivery lifecycle: outbound (rider mounted) -> 1.8s empty-bike stop (rider dismounted) -> separate directed return (rider remounted) -> idle', () => {
  assert.ok(
    DELIVERY_PAUSE_SECONDS >= 1.5 && DELIVERY_PAUSE_SECONDS <= 2.0,
    `expected delivery pause in 1.5..2.0s, got ${DELIVERY_PAUSE_SECONDS}`
  );

  const outbound = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  // Distinct directed return path (simulating opposite right-hand lane / CCW roundabout loop)
  const directedReturn = [
    { x: 100, y: 100 },
    { x: 80, y: 20 },
    { x: 0, y: 0 },
  ];

  let courier = createCourierFromPath(
    outbound,
    200,
    DELIVERY_PAUSE_SECONDS,
    directedReturn,
    'ul. Słoneczna 4'
  );

  assert.equal(courier.phase, 'outbound');
  assert.equal(courier.active, true);
  assert.equal(courier.arrived, false);
  assert.equal(courier.riderMounted, true, 'rider must be mounted while riding outbound');
  assert.equal(courier.totalDistance, 200);
  assert.equal(courier.wheelPhase, 0);

  // Advance 0.25s -> 50px along first segment
  for (let i = 0; i < 5; i++) {
    courier = stepCourier(courier, 0.05);
  }
  assert.ok(Math.abs(courier.x - 50) < 1e-6);
  assert.ok(Math.abs(courier.y - 0) < 1e-6);
  assert.equal(courier.riderMounted, true);
  assert.ok(courier.wheelPhase > 0, 'wheelPhase should advance while riding');

  // Advance remaining 150px -> arrives at deliveryStopPoint and dismounts (empty parked bike)
  for (let i = 0; i < 15; i++) {
    courier = stepCourier(courier, 0.05);
  }
  assert.equal(courier.phase, 'delivering');
  assert.equal(courier.active, true);
  assert.equal(courier.arrived, true);
  assert.equal(courier.riderMounted, false, 'human rider must disappear during delivery pause');
  assert.equal(courier.x, 100);
  assert.equal(courier.y, 100);
  const frozenWheelPhase = courier.wheelPhase;

  // During 1.0s of the 1.8s pause, empty bike remains stationary with riderMounted === false
  for (let i = 0; i < 20; i++) {
    courier = stepCourier(courier, 0.05);
  }
  assert.equal(courier.phase, 'delivering');
  assert.equal(courier.riderMounted, false);
  assert.equal(courier.wheelPhase, frozenWheelPhase);

  // Finish remaining 0.85s -> rider remounts and follows the separate directedReturn path
  for (let i = 0; i < 17; i++) {
    courier = stepCourier(courier, 0.05);
  }
  assert.equal(courier.phase, 'returning');
  assert.equal(courier.active, true);
  assert.equal(courier.arrived, false);
  assert.equal(courier.riderMounted, true, 'rider must reappear on bicycle for return trip');
  assert.ok(courier.x < 100 && courier.y < 100, 'courier should follow separate directedReturn leg');

  // Complete return leg back to BAZA rack
  for (let i = 0; i < 30; i++) {
    courier = stepCourier(courier, 0.05);
  }
  assert.equal(courier.phase, 'idle');
  assert.equal(courier.active, false);
  assert.equal(courier.riderMounted, false);
});

test('stitchWaypoints and prependRackExitToPath cleanly join legs without duplicate boundary points', () => {
  const joined = prependRackExitToPath(
    [
      { x: 826, y: 1614 },
      { x: 785, y: 1593.5 },
      { x: 820, y: 1545 },
    ],
    [
      { x: 820, y: 1545 },
      { x: 665, y: 1467.5 },
    ]
  );

  assert.equal(joined.length, 4);
  assert.deepEqual(joined[0], { x: 826, y: 1614 });
  assert.deepEqual(joined[3], { x: 665, y: 1467.5 });

  const stitched = stitchWaypoints(
    [{ x: 1, y: 1 }],
    [{ x: 1, y: 1 }, { x: 20, y: 20 }],
    undefined,
    [{ x: 20, y: 20 }, { x: 35, y: 30 }]
  );
  assert.equal(stitched.length, 3);

  const idle = createIdleCourier();
  assert.equal(stepCourier(idle, 0.05).phase, 'idle');
  assert.equal(idle.riderMounted, false);
});
