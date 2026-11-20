import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCEDURAL_PARKING_LOTS } from './buildings';
import { BASE_DEPOT, BUS_STATION, buildProceduralRoadGraph } from './cityMap';
import {
  ALL_PARKING_NAV_NETWORKS,
  PARKING_NAV_BY_LOT_ID,
  planParkingEntryRoute,
  planParkingExitRoute,
  segmentIntersectsRectInterior,
} from './parkingNavigation';

test('ALL_PARKING_NAV_NETWORKS covers every procedural parking lot, Bus Station yard, and BAZA fleet parking', () => {
  const expectedCount = PROCEDURAL_PARKING_LOTS.length + 2;
  assert.equal(
    ALL_PARKING_NAV_NETWORKS.length,
    expectedCount,
    `expected ${expectedCount} parking navigation networks, got ${ALL_PARKING_NAV_NETWORKS.length}`
  );

  for (const lot of PROCEDURAL_PARKING_LOTS) {
    assert.ok(PARKING_NAV_BY_LOT_ID.has(lot.id), `missing parking nav network for ${lot.id}`);
  }
  assert.ok(PARKING_NAV_BY_LOT_ID.has(BUS_STATION.id), 'missing parking nav network for BUS_STATION');
  assert.ok(PARKING_NAV_BY_LOT_ID.has(BASE_DEPOT.parking.id), 'missing parking nav network for BAZA parking');
});

test('every parking navigation network links cleanly to an existing roadGraph edge without adding extra road nodes', () => {
  const roadGraph = buildProceduralRoadGraph();
  const edgeKeys = new Set<string>();
  for (const e of roadGraph.edges) {
    edgeKeys.add(`${e[0]}|${e[1]}`);
    if (!e[2]?.oneWay) {
      edgeKeys.add(`${e[1]}|${e[0]}`);
    }
  }

  for (const net of ALL_PARKING_NAV_NETWORKS) {
    const entryNode = net.nodes.find((n) => n.id === net.entryRoadNodeId);
    const exitNode = net.nodes.find((n) => n.id === net.exitRoadNodeId);
    assert.ok(entryNode?.roadConnection, `${net.lotId} missing entry roadConnection`);
    assert.ok(exitNode?.roadConnection, `${net.lotId} missing exit roadConnection`);

    const [ea, eb] = entryNode.roadConnection.edge;
    assert.ok(
      edgeKeys.has(`${ea}|${eb}`),
      `${net.lotId} entry edge [${ea}, ${eb}] not found in roadGraph`
    );
    const [xa, xb] = exitNode.roadConnection.edge;
    assert.ok(
      edgeKeys.has(`${xa}|${xb}`),
      `${net.lotId} exit edge [${xa}, ${xb}] not found in roadGraph`
    );
  }
});

test('Dworzec Autobusowy parking network strictly enforces separate one-way entry and exit driveways', () => {
  const busNet = PARKING_NAV_BY_LOT_ID.get(BUS_STATION.id);
  assert.ok(busNet);
  assert.equal(busNet.kind, 'bus_station');
  assert.equal(busNet.hasSeparateExit, true);
  assert.notEqual(busNet.entryRoadNodeId, busNet.exitRoadNodeId);
  assert.equal(busNet.spots.length, 6);

  const entryNode = busNet.nodes.find((n) => n.id === busNet.entryRoadNodeId)!;
  const exitNode = busNet.nodes.find((n) => n.id === busNet.exitRoadNodeId)!;
  const expectedEntryU = (BUS_STATION.entryDriveway.uMin + BUS_STATION.entryDriveway.uMax) / 2;
  const expectedExitU = (BUS_STATION.exitDriveway.uMin + BUS_STATION.exitDriveway.uMax) / 2;
  assert.ok(Math.abs(entryNode.u - expectedEntryU) < 2, `bus entry u=${entryNode.u} expected ~${expectedEntryU}`);
  assert.ok(Math.abs(exitNode.u - expectedExitU) < 2, `bus exit u=${exitNode.u} expected ~${expectedExitU}`);

  // All internal edges on the bus station yard must be one-way
  assert.ok(busNet.edges.every((e) => e.oneWay), 'all bus station circulation edges must be one-way');

  for (const spot of busNet.spots) {
    const entryRoute = planParkingEntryRoute(busNet, spot.id);
    const exitRoute = planParkingExitRoute(busNet, spot.id);
    assert.ok(entryRoute && exitRoute, `bus bay ${spot.id} must have valid entry & exit routes`);
    assert.ok(
      Math.abs(entryRoute.isoPoints[0].u - expectedEntryU) < 2,
      `bus bay ${spot.id} entry must start at bus_entry`
    );
    assert.ok(
      Math.abs(exitRoute.isoPoints[exitRoute.isoPoints.length - 1].u - expectedExitU) < 2,
      `bus bay ${spot.id} exit must end at bus_exit`
    );
  }
});

test('ZERO aisle edges or planned spot entry/exit trajectories ever cut across any painted parking stall on ANY parking lot', () => {
  let totalSpotsChecked = 0;

  for (const net of ALL_PARKING_NAV_NETWORKS) {
    assert.ok(net.spots.length >= 2, `parking lot ${net.lotId} must expose individual spots`);
    const nodeById = new Map(net.nodes.map((n) => [n.id, n]));

    // 1. No aisle or driveway edge may intersect the interior of ANY stall on this lot
    for (const edge of net.edges) {
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      assert.ok(a && b, `${net.lotId} edge references unknown node`);
      for (const spot of net.spots) {
        const cuts = segmentIntersectsRectInterior(a.u, a.v, b.u, b.v, spot.rect, 0.25);
        assert.equal(
          cuts,
          false,
          `${net.lotId} edge ${edge.from}->${edge.to} cuts across stall ${spot.id}`
        );
      }
    }

    // 2. Every individual spot must have valid entry & exit routes that NEVER intersect any other stall
    for (const spot of net.spots) {
      totalSpotsChecked++;
      const entryRoute = planParkingEntryRoute(net, spot.id);
      const exitRoute = planParkingExitRoute(net, spot.id);
      assert.ok(entryRoute && entryRoute.isoPoints.length >= 3, `${net.lotId}/${spot.id} missing entry route`);
      assert.ok(exitRoute && exitRoute.isoPoints.length >= 3, `${net.lotId}/${spot.id} missing exit route`);

      // Verify unit entry/exit directions are opposites
      assert.equal(spot.entryDirIso.u + spot.exitDirIso.u, 0);
      assert.equal(spot.entryDirIso.v + spot.exitDirIso.v, 0);
      assert.equal(Math.hypot(spot.entryDirIso.u, spot.entryDirIso.v), 1);

      for (const route of [entryRoute, exitRoute]) {
        for (let i = 1; i < route.isoPoints.length; i++) {
          const p0 = route.isoPoints[i - 1];
          const p1 = route.isoPoints[i];
          for (const other of net.spots) {
            if (other.id === spot.id) continue;
            const cutsOther = segmentIntersectsRectInterior(
              p0.u,
              p0.v,
              p1.u,
              p1.v,
              other.rect,
              0.25
            );
            assert.equal(
              cutsOther,
              false,
              `${net.lotId} ${route.direction} route for ${spot.id} cuts through other stall ${other.id}`
            );
          }
        }
      }
    }
  }

  assert.ok(
    totalSpotsChecked >= 400,
    `expected >= 400 total navigable parking stalls across the city, got ${totalSpotsChecked}`
  );
});
