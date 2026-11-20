import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_STREETS,
  BASE_DEPOT,
  BUS_STATION,
  CITY_QUARTERS,
  CONCRETE_PLOTS,
  MAP_HEIGHT,
  MAP_WIDTH,
  RESIDENTIAL_ACCESS_ROADS,
  ROUNDABOUTS,
  U_STREETS,
  V_STREETS,
  buildProceduralRoadGraph,
  canvasToIso,
  isoToCanvas,
  streetCoversValue,
} from './cityMap';

test('isoToCanvas and canvasToIso are exact 2:1 orthographic inverses', () => {
  const origin = isoToCanvas(0, 0);
  assert.equal(origin.x, MAP_WIDTH / 2);
  assert.equal(origin.y, MAP_HEIGHT / 2);

  // Pure 2:1 slope along +u and +v
  const du = isoToCanvas(100, 0);
  assert.equal(du.x - origin.x, 100);
  assert.equal(du.y - origin.y, 50);

  const dv = isoToCanvas(0, 100);
  assert.equal(dv.x - origin.x, 100);
  assert.equal(dv.y - origin.y, -50);

  const roundTrip = canvasToIso(du.x + 37, du.y - 83);
  const back = isoToCanvas(roundTrip.u, roundTrip.v);
  assert.ok(Math.abs(back.x - (du.x + 37)) < 1e-6);
  assert.ok(Math.abs(back.y - (du.y - 83)) < 1e-6);
});

test('all 3 roundabouts lie inside map bounds and their 16 ring nodes sit on exact ring radius', () => {
  assert.equal(ROUNDABOUTS.length, 3);
  const graph = buildProceduralRoadGraph();
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const rb of ROUNDABOUTS) {
    const center = isoToCanvas(rb.u, rb.v);
    assert.ok(center.x > 150 && center.x < MAP_WIDTH - 150);
    assert.ok(center.y > 150 && center.y < MAP_HEIGHT - 150);

    for (let k = 0; k < rb.ringSegments; k++) {
      const node = nodeMap.get(`${rb.id}_${k}`);
      assert.ok(node, `missing ring node ${rb.id}_${k}`);
      const iso = canvasToIso(node.x, node.y);
      const r = Math.hypot(iso.u - rb.u, iso.v - rb.v);
      assert.ok(
        Math.abs(r - rb.ringRadius) < 1.5,
        `ring node ${node.id} radius ${r} should match ${rb.ringRadius}`
      );
    }

    const entries = [
      { idx: 0, expectU: rb.u + rb.ringRadius, expectV: rb.v },
      { idx: 4, expectU: rb.u, expectV: rb.v + rb.ringRadius },
      { idx: 8, expectU: rb.u - rb.ringRadius, expectV: rb.v },
      { idx: 12, expectU: rb.u, expectV: rb.v - rb.ringRadius },
    ];
    for (const entry of entries) {
      const node = nodeMap.get(`${rb.id}_${entry.idx}`)!;
      const iso = canvasToIso(node.x, node.y);
      assert.ok(Math.abs(iso.u - entry.expectU) < 1.5);
      assert.ok(Math.abs(iso.v - entry.expectV) < 1.5);
    }

    // All 16 roundabout ring edges must be strictly one-way counter-clockwise (k -> (k+1)%16)
    for (let k = 0; k < rb.ringSegments; k++) {
      const fromId = `${rb.id}_${k}`;
      const toId = `${rb.id}_${(k + 1) % rb.ringSegments}`;
      const fwdEdge = graph.edges.find((e) => e[0] === fromId && e[1] === toId);
      assert.ok(fwdEdge && fwdEdge[2]?.oneWay === true, `missing oneWay CCW edge ${fromId} -> ${toId}`);
      const revEdge = graph.edges.find((e) => e[0] === toId && e[1] === fromId);
      assert.equal(revEdge, undefined, `unexpected reverse clockwise edge ${toId} -> ${fromId}`);
    }
  }
});

test('base depot lies in lower-left quadrant, connects straight to exit node, and owns structured fleet parking', () => {
  const graph = buildProceduralRoadGraph();
  const base = graph.nodes.find((n) => n.id === 'base');
  const exit = graph.nodes.find((n) => n.id === 'n_base_exit');
  assert.ok(base && exit);

  assert.ok(base.x < MAP_WIDTH * 0.45, 'base should be in left half');
  assert.ok(base.y > MAP_HEIGHT * 0.55, 'base should be in lower half');
  assert.equal(BASE_DEPOT.v, BASE_DEPOT.exitV);

  const hasEdge = graph.edges.some(
    ([a, b]) =>
      (a === 'base' && b === 'n_base_exit') ||
      (a === 'n_base_exit' && b === 'base')
  );
  assert.ok(hasEdge, 'base must connect directly to n_base_exit');

  // Verify BASE_DEPOT.parking data structure, individual spots, and internal connector
  const p = BASE_DEPOT.parking;
  assert.ok(p.spots.length >= 8, `expected >= 8 BAZA fleet spots, got ${p.spots.length}`);
  assert.ok(p.connectorSegments.length >= 2, 'BAZA parking must have internal asphalt connector segments');
  assert.ok(
    p.connectorSegments.some((s) => s.vMin <= BASE_DEPOT.v && s.vMax >= BASE_DEPOT.v),
    'BAZA internal connector must join the courier exit driveway directly'
  );
  for (const spot of p.spots) {
    assert.equal(spot.occupied, false);
    assert.ok(spot.u >= p.uMin && spot.u <= p.uMax);
    assert.ok(spot.v >= p.vMin && spot.v <= p.vMax);
    const canvasPt = isoToCanvas(spot.u, spot.v);
    assert.ok(Math.abs(canvasPt.x - spot.x) < 1 && Math.abs(canvasPt.y - spot.y) < 1);
  }

  // Verify exterior BAZA bike rack against SW garage wall, completely separate from car parking
  const rack = BASE_DEPOT.bikeRack;
  assert.equal(rack.id, 'base_bike_rack');
  assert.ok(rack.uMin >= BASE_DEPOT.yardUMin && rack.uMax <= BASE_DEPOT.yardUMax);
  assert.ok(rack.vMin >= BASE_DEPOT.yardVMin && rack.vMax <= BASE_DEPOT.yardVMax);
  assert.ok(rack.vMax < p.vMin, 'bike rack must sit completely separate from car parking spots');
  assert.ok(rack.hoopsU.length >= 3, 'bike rack should have multiple metal hoops');
  assert.ok(rack.exitWaypoints.length >= 2, 'bike rack must define concrete-yard exit waypoints');
});

test('residential access roads bisect large single-family house quarters and connect directly into roadGraph', () => {
  assert.ok(
    RESIDENTIAL_ACCESS_ROADS.length >= 6,
    `expected >= 6 residential access roads, got ${RESIDENTIAL_ACCESS_ROADS.length}`
  );
  const graph = buildProceduralRoadGraph();
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    const idA = `n_${ar.id}_a`;
    const idB = `n_${ar.id}_b`;
    assert.ok(nodeIds.has(idA), `missing T-junction node ${idA} in roadGraph`);
    assert.ok(nodeIds.has(idB), `missing T-junction node ${idB} in roadGraph`);
    const hasAccessEdge = graph.edges.some(
      ([a, b]) => (a === idA && b === idB) || (a === idB && b === idA)
    );
    assert.ok(hasAccessEdge, `missing road edge for residential access road ${ar.id}`);
  }
});

test('quarter zoning reserves 1 green park, 1 bus_station on al. Dworcowa, and puts flush concrete on base, bus_station, market, and block quarters', () => {
  const parks = CITY_QUARTERS.filter((q) => q.kind === 'park');
  const busStations = CITY_QUARTERS.filter((q) => q.kind === 'bus_station');
  const markets = CITY_QUARTERS.filter((q) => q.kind === 'market');
  const blocks = CITY_QUARTERS.filter((q) => q.kind === 'blocks');
  const houses = CITY_QUARTERS.filter((q) => q.kind === 'houses');

  assert.equal(parks.length, 1, `expected 1 remaining reserved green park, got ${parks.length}`);
  assert.equal(parks[0].id, 'q_2_2', 'q_2_2 should remain untouched as reserved green park');
  assert.equal(busStations.length, 1, `expected 1 bus_station quarter, got ${busStations.length}`);
  assert.equal(busStations[0].id, 'q_3_4', 'bus station must sit on q_3_4 directly along al. Dworcowa');
  assert.ok(markets.length >= 4, `expected >= 4 market quarters, got ${markets.length}`);
  assert.ok(blocks.length >= 15, `expected >= 15 block quarters, got ${blocks.length}`);
  assert.ok(houses.length >= 15, `expected >= 15 house quarters, got ${houses.length}`);

  const quarterById = new Map(CITY_QUARTERS.map((q) => [q.id, q]));
  assert.ok(CONCRETE_PLOTS.some((p) => p.isBaseYard));
  assert.ok(CONCRETE_PLOTS.some((p) => p.quarterId === 'q_3_4'));
  assert.equal(
    CONCRETE_PLOTS.length,
    1 + busStations.length + markets.length + blocks.length,
    'every base, bus_station, market, and blocks quarter must have a flush concrete slab, and zero on houses/parks'
  );

  for (const plot of CONCRETE_PLOTS) {
    const q = quarterById.get(plot.quarterId);
    assert.ok(
      q &&
        (q.kind === 'base' ||
          q.kind === 'bus_station' ||
          q.kind === 'market' ||
          q.kind === 'blocks')
    );

    for (const us of U_STREETS) {
      const halfAsphalt = us.asphaltWidth / 2;
      if (us.coord + halfAsphalt > plot.uMin + 0.5 && us.coord - halfAsphalt < plot.uMax - 0.5) {
        const midV = (plot.vMin + plot.vMax) / 2;
        assert.equal(
          streetCoversValue(us, midV),
          false,
          `plot ${plot.id} intrudes into asphalt of ${us.id}`
        );
      }
    }
    for (const vs of V_STREETS) {
      const halfAsphalt = vs.asphaltWidth / 2;
      if (vs.coord + halfAsphalt > plot.vMin + 0.5 && vs.coord - halfAsphalt < plot.vMax - 0.5) {
        const midU = (plot.uMin + plot.uMax) / 2;
        assert.equal(
          streetCoversValue(vs, midU),
          false,
          `plot ${plot.id} intrudes into asphalt of ${vs.id}`
        );
      }
    }
  }
});

test('all streets have unique realistic Polish names matching their hierarchy', () => {
  assert.equal(ALL_STREETS.length, 18);
  const names = new Set<string>();
  for (const s of ALL_STREETS) {
    assert.ok(s.name.length >= 6, `street ${s.id} name too short: ${s.name}`);
    assert.ok(!names.has(s.name), `duplicate street name: ${s.name}`);
    names.add(s.name);
    if (s.kind === 'avenue') {
      assert.ok(s.name.startsWith('al. '), `avenue ${s.id} should start with 'al. ': ${s.name}`);
    } else {
      assert.ok(s.name.startsWith('ul. '), `local street ${s.id} should start with 'ul. ': ${s.name}`);
    }
  }
});

test('BUS_STATION on q_3_4 has 6 oversized bus bays, separate wide entry/exit driveways clear of crosswalks, and an expanded terminal footprint without platformReserve', () => {
  assert.equal(BUS_STATION.quarterId, 'q_3_4');
  assert.equal(BUS_STATION.streetId, 'v_4');
  assert.equal(BUS_STATION.streetName, 'al. Dworcowa');

  // Separate wide Entry and Exit driveways onto al. Dworcowa
  const { entryDriveway: entry, exitDriveway: exit } = BUS_STATION;
  assert.equal(entry.role, 'entry');
  assert.equal(exit.role, 'exit');
  assert.ok(entry.width >= 26 && exit.width >= 26, 'bus entry/exit driveways must be extra wide for buses');
  assert.ok(exit.uMin - entry.uMax >= 120, 'entry and exit driveways must be clearly separated');

  // Clearances past NW crosswalk (ul. Lipowa ends at u = -312) and SE crosswalk (al. Główna ends at u = -60)
  assert.ok(entry.uMin >= -300, `bus entry too close to NW crosswalk: uMin=${entry.uMin}`);
  assert.ok(exit.uMax <= -80, `bus exit too close to SE crosswalk: uMax=${exit.uMax}`);

  // 6 oversized bus bays clearly larger than car stalls (15x19) and unobstructed by entry/exit lanes
  assert.equal(BUS_STATION.busBays.length, 6);
  for (const bay of BUS_STATION.busBays) {
    assert.ok(bay.uMax - bay.uMin >= 22, `bus bay width too narrow: ${bay.uMax - bay.uMin}`);
    assert.ok(bay.vMax - bay.vMin >= 45, `bus bay length too short: ${bay.vMax - bay.vMin}`);
    assert.ok(bay.uMin > entry.uMax, `bus bay ${bay.id} overlaps entry lane`);
    assert.ok(bay.uMax < exit.uMin, `bus bay ${bay.id} overlaps exit lane`);
    assert.equal(bay.occupied, false);
  }

  // Former platformReserve must be removed and absorbed into the expanded terminal building footprint
  assert.equal('platformReserve' in BUS_STATION, false, 'platformReserve must be removed from BUS_STATION');
  const term = BUS_STATION.terminalFootprint;
  assert.ok(term.vMin >= BUS_STATION.asphaltYard.vMax + 4, 'terminal must leave a pedestrian curb beside the bus yard');
  assert.ok(term.vMin <= 214, `expanded terminal should occupy former platform space, got vMin=${term.vMin}`);
  assert.ok(term.vMax - term.vMin >= 120, `expanded terminal depth should be >= 120, got ${term.vMax - term.vMin}`);
  assert.ok(term.uMax - term.uMin >= 220, `expanded terminal length should be >= 220, got ${term.uMax - term.uMin}`);
});

