import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoadGraph } from '../types/roadGraph';
import {
  addNode,
  deleteNode,
  moveNode,
  serializeGraphToJson,
  toggleEdge,
} from './graphEditor';

const sampleGraph: RoadGraph = {
  nodes: [
    { id: 'base', x: 100, y: 100, kind: 'base', label: 'Baza' },
    { id: 'n1', x: 200, y: 100, kind: 'intersection' },
    { id: 'n2', x: 300, y: 200, kind: 'intersection' },
  ],
  edges: [['base', 'n1']],
};

test('addNode creates unique node clamped inside map bounds', () => {
  const { graph, createdNode } = addNode(sampleGraph, -20, 2000, 2752, 1536);
  assert.equal(createdNode.x, 0);
  assert.equal(createdNode.y, 1536);
  assert.equal(graph.nodes.length, 4);
});

test('moveNode updates target node coordinates clamped to map', () => {
  const moved = moveNode(sampleGraph, 'n1', 450.7, 320.2, 2752, 1536);
  const n1 = moved.nodes.find((n) => n.id === 'n1')!;
  assert.equal(n1.x, 451);
  assert.equal(n1.y, 320);
});

test('toggleEdge adds missing edge and removes existing undirected edge', () => {
  const added = toggleEdge(sampleGraph, 'n1', 'n2');
  assert.equal(added.action, 'added');
  assert.equal(added.graph.edges.length, 2);

  const removed = toggleEdge(added.graph, 'n2', 'n1');
  assert.equal(removed.action, 'removed');
  assert.equal(removed.graph.edges.length, 1);
});

test('deleteNode removes non-base node and incident edges but protects base', () => {
  const baseAttempt = deleteNode(sampleGraph, 'base');
  assert.equal(baseAttempt.deleted, false);
  assert.equal(baseAttempt.reason, 'protected_base');

  const n1Delete = deleteNode(sampleGraph, 'n1');
  assert.equal(n1Delete.deleted, true);
  assert.equal(n1Delete.graph.nodes.length, 2);
  assert.equal(n1Delete.graph.edges.length, 0);
});

test('serializeGraphToJson produces valid JSON with nodes and edges', () => {
  const json = serializeGraphToJson(sampleGraph);
  const parsed = JSON.parse(json) as RoadGraph;
  assert.equal(parsed.nodes.length, 3);
  assert.equal(parsed.edges.length, 1);
});
