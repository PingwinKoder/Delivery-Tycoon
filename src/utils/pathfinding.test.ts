import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ROAD_GRAPH } from '../data/initialRoadGraph';
import type { RoadGraph } from '../types/roadGraph';
import {
  findShortestPath,
  findShortestPathFromRoadPoint,
  findShortestPathToRoadPoint,
} from './pathfinding';

test('Dijkstra chooses shorter weighted route over fewer hops', () => {
  const graph: RoadGraph = {
    nodes: [
      { id: 'base', x: 0, y: 0, kind: 'base' },
      { id: 'a', x: 100, y: 0 },
      { id: 'b', x: 200, y: 0 },
      { id: 'detour', x: 100, y: 500 },
    ],
    edges: [
      ['base', 'detour'],
      ['detour', 'b'],
      ['base', 'a'],
      ['a', 'b'],
    ],
  };

  const res = findShortestPath(graph, 'base', 'b');
  assert.ok(res);
  assert.deepEqual(res.nodeIds, ['base', 'a', 'b']);
  assert.equal(Math.round(res.totalDistance), 200);
});

test('Dijkstra strictly respects oneWay edges and never routes backwards against traffic', () => {
  const ring: RoadGraph = {
    nodes: [
      { id: 'n0', x: 0, y: 0 },
      { id: 'n1', x: 100, y: 0 },
      { id: 'n2', x: 100, y: 100 },
      { id: 'n3', x: 0, y: 100 },
    ],
    edges: [
      ['n0', 'n1', { oneWay: true }],
      ['n1', 'n2', { oneWay: true }],
      ['n2', 'n3', { oneWay: true }],
      ['n3', 'n0', { oneWay: true }],
    ],
  };

  // From n0 to n3 must go the legal one-way way: n0 -> n1 -> n2 -> n3 (never backwards n0 -> n3!)
  const res = findShortestPath(ring, 'n0', 'n3');
  assert.ok(res);
  assert.deepEqual(res.nodeIds, ['n0', 'n1', 'n2', 'n3']);
});

test('findShortestPathToRoadPoint and findShortestPathFromRoadPoint snap cleanly to road edge midpoints', () => {
  const graph: RoadGraph = {
    nodes: [
      { id: 'base', x: 0, y: 0, kind: 'base' },
      { id: 'n1', x: 100, y: 0 },
      { id: 'n2', x: 300, y: 0 },
    ],
    edges: [
      ['base', 'n1'],
      ['n1', 'n2'],
    ],
  };

  const outRes = findShortestPathToRoadPoint(graph, 'base', { x: 200, y: 12 }, 30);
  assert.ok(outRes);
  assert.equal(Math.round(outRes.snappedPoint.x), 200);
  assert.equal(Math.round(outRes.snappedPoint.y), 0);
  assert.equal(Math.round(outRes.totalDistance), 200);

  const retRes = findShortestPathFromRoadPoint(graph, { x: 200, y: 0 }, 'base', 30);
  assert.ok(retRes);
  assert.equal(Math.round(retRes.totalDistance), 200);
});

test('every node in INITIAL_ROAD_GRAPH is reachable from base AND can legally return to base', () => {
  const baseNode = INITIAL_ROAD_GRAPH.nodes.find((n) => n.id === 'base');
  assert.ok(baseNode, 'base node must exist');
  for (const node of INITIAL_ROAD_GRAPH.nodes) {
    const outPath = findShortestPath(INITIAL_ROAD_GRAPH, 'base', node.id);
    assert.ok(outPath, `node ${node.id} should be reachable from base`);
    const backPath = findShortestPath(INITIAL_ROAD_GRAPH, node.id, 'base');
    assert.ok(backPath, `base should be reachable back from ${node.id} obeying one-way roundabouts`);
  }
});

test('routes crossing R1 roundabout strictly travel counter-clockwise (k -> (k+1)%16) on BOTH outbound and return trips', () => {
  // Left turn from SW entry (r1_12) to NW exit (r1_8): MUST go 3/4 around CCW (12->13->...->0->...->4->...->8), NEVER clockwise (12->11->10->9->8)!
  const leftTurn = findShortestPath(INITIAL_ROAD_GRAPH, 'r1_12', 'r1_8');
  assert.ok(leftTurn, 'CCW route from r1_12 to r1_8 must exist');
  assert.deepEqual(leftTurn.nodeIds, [
    'r1_12',
    'r1_13',
    'r1_14',
    'r1_15',
    'r1_0',
    'r1_1',
    'r1_2',
    'r1_3',
    'r1_4',
    'r1_5',
    'r1_6',
    'r1_7',
    'r1_8',
  ]);

  // Return from NW exit (r1_8) back to SW exit (r1_12): MUST continue CCW (8->9->10->11->12)!
  const returnLeg = findShortestPath(INITIAL_ROAD_GRAPH, 'r1_8', 'r1_12');
  assert.ok(returnLeg, 'CCW return route from r1_8 to r1_12 must exist');
  assert.deepEqual(returnLeg.nodeIds, ['r1_8', 'r1_9', 'r1_10', 'r1_11', 'r1_12']);

  // Straight across R1 from base to central intersection: outbound goes 12->13..->4, return goes 4->5..->12
  const outbound = findShortestPath(INITIAL_ROAD_GRAPH, 'base', 'n_u_4_v_4');
  assert.ok(outbound);
  const outR1 = outbound.nodeIds.filter((id) => id.startsWith('r1_'));
  assert.deepEqual(outR1, ['r1_12', 'r1_13', 'r1_14', 'r1_15', 'r1_0', 'r1_1', 'r1_2', 'r1_3', 'r1_4']);

  const inbound = findShortestPath(INITIAL_ROAD_GRAPH, 'n_u_4_v_4', 'base');
  assert.ok(inbound);
  const inR1 = inbound.nodeIds.filter((id) => id.startsWith('r1_'));
  assert.deepEqual(inR1, ['r1_4', 'r1_5', 'r1_6', 'r1_7', 'r1_8', 'r1_9', 'r1_10', 'r1_11', 'r1_12']);
});
