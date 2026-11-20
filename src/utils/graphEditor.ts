import type { NodeKind, RoadEdge, RoadGraph, RoadNode } from '../types/roadGraph';

export function clampToMap(
  x: number,
  y: number,
  mapWidth: number,
  mapHeight: number
): { x: number; y: number } {
  return {
    x: Math.round(Math.max(0, Math.min(mapWidth, x))),
    y: Math.round(Math.max(0, Math.min(mapHeight, y))),
  };
}

export function generateNodeId(graph: RoadGraph): string {
  const existing = new Set(graph.nodes.map((n) => n.id));
  let idx = 1;
  while (existing.has(`w_${idx}`)) {
    idx++;
  }
  return `w_${idx}`;
}

export function addNode(
  graph: RoadGraph,
  x: number,
  y: number,
  mapWidth: number,
  mapHeight: number,
  kind: NodeKind = 'intersection'
): { graph: RoadGraph; createdNode: RoadNode } {
  const clamped = clampToMap(x, y, mapWidth, mapHeight);
  const createdNode: RoadNode = {
    id: generateNodeId(graph),
    x: clamped.x,
    y: clamped.y,
    kind,
  };
  return {
    graph: {
      nodes: [...graph.nodes, createdNode],
      edges: [...graph.edges],
    },
    createdNode,
  };
}

export function moveNode(
  graph: RoadGraph,
  nodeId: string,
  x: number,
  y: number,
  mapWidth: number,
  mapHeight: number
): RoadGraph {
  const clamped = clampToMap(x, y, mapWidth, mapHeight);
  return {
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, x: clamped.x, y: clamped.y } : node
    ),
    edges: graph.edges,
  };
}

export function hasEdge(graph: RoadGraph, aId: string, bId: string): boolean {
  return graph.edges.some(
    ([u, v]) => (u === aId && v === bId) || (u === bId && v === aId)
  );
}

export function toggleEdge(
  graph: RoadGraph,
  aId: string,
  bId: string
): { graph: RoadGraph; action: 'added' | 'removed' | 'ignored' } {
  if (aId === bId) {
    return { graph, action: 'ignored' };
  }
  const hasA = graph.nodes.some((n) => n.id === aId);
  const hasB = graph.nodes.some((n) => n.id === bId);
  if (!hasA || !hasB) {
    return { graph, action: 'ignored' };
  }

  if (hasEdge(graph, aId, bId)) {
    return {
      graph: {
        nodes: graph.nodes,
        edges: graph.edges.filter(
          ([u, v]) => !((u === aId && v === bId) || (u === bId && v === aId))
        ),
      },
      action: 'removed',
    };
  }

  const nextEdge: RoadEdge = [aId, bId];
  return {
    graph: {
      nodes: graph.nodes,
      edges: [...graph.edges, nextEdge],
    },
    action: 'added',
  };
}

export function deleteNode(
  graph: RoadGraph,
  nodeId: string
): { graph: RoadGraph; deleted: boolean; reason?: 'protected_base' | 'not_found' } {
  if (nodeId === 'base') {
    return { graph, deleted: false, reason: 'protected_base' };
  }
  const exists = graph.nodes.some((n) => n.id === nodeId);
  if (!exists) {
    return { graph, deleted: false, reason: 'not_found' };
  }
  return {
    graph: {
      nodes: graph.nodes.filter((n) => n.id !== nodeId),
      edges: graph.edges.filter(([u, v]) => u !== nodeId && v !== nodeId),
    },
    deleted: true,
  };
}

export function hitTestNode(
  graph: RoadGraph,
  worldX: number,
  worldY: number,
  hitRadius: number
): RoadNode | null {
  let closest: RoadNode | null = null;
  let minD = hitRadius;
  for (const node of graph.nodes) {
    const d = Math.hypot(node.x - worldX, node.y - worldY);
    if (d <= minD) {
      minD = d;
      closest = node;
    }
  }
  return closest;
}

export function serializeGraphToJson(graph: RoadGraph): string {
  const cleanGraph: RoadGraph = {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      x: Math.round(n.x),
      y: Math.round(n.y),
      ...(n.kind ? { kind: n.kind } : {}),
      ...(n.label ? { label: n.label } : {}),
    })),
    edges: graph.edges.map((edge) =>
      edge[2]?.oneWay ? [edge[0], edge[1], { oneWay: true }] : [edge[0], edge[1]]
    ),
  };
  return JSON.stringify(cleanGraph, null, 2);
}
