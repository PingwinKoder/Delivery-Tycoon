import type { Point, RoadEdge, RoadEdgeMeta, RoadGraph, RoadNode } from '../types/roadGraph';

export interface PathResult {
  nodeIds: string[];
  points: Point[];
  totalDistance: number;
  snappedPoint: Point;
  snappedEdge?: [string, string];
  snappedNodeId?: string;
}

export interface RoadSnapMatch {
  point: Point;
  distanceToClick: number;
  edge: [string, string] | null;
  edgeMeta?: RoadEdgeMeta;
  nodeId: string | null;
  t: number;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function projectPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { point: { x: a.x, y: a.y }, t: 0, dist: dist(p, a) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { point: proj, t, dist: dist(p, proj) };
}

/**
 * Builds a directed weighted adjacency list from a RoadGraph.
 * Bidirectional edges add both a -> b and b -> a; oneWay edges add ONLY a -> b
 * (e.g., counter-clockwise roundabout rings so vehicles never drive wrong-way).
 */
export function buildAdjacencyList(
  graph: RoadGraph
): Map<string, Array<{ to: string; weight: number }>> {
  const nodeById = new Map<string, RoadNode>();
  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
  }

  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const aId = edge[0];
    const bId = edge[1];
    const meta = edge[2];
    const a = nodeById.get(aId);
    const b = nodeById.get(bId);
    if (!a || !b || aId === bId) continue;
    const w = dist(a, b);
    adj.get(aId)!.push({ to: bId, weight: w });
    if (!meta?.oneWay) {
      adj.get(bId)!.push({ to: aId, weight: w });
    }
  }

  return adj;
}

export function findShortestPath(
  graph: RoadGraph,
  startId: string,
  targetId: string
): { nodeIds: string[]; points: Point[]; totalDistance: number } | null {
  const nodeById = new Map<string, RoadNode>();
  for (const n of graph.nodes) {
    nodeById.set(n.id, n);
  }
  if (!nodeById.has(startId) || !nodeById.has(targetId)) {
    return null;
  }
  if (startId === targetId) {
    const p = nodeById.get(startId)!;
    return { nodeIds: [startId], points: [{ x: p.x, y: p.y }], totalDistance: 0 };
  }

  const adj = buildAdjacencyList(graph);
  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const n of graph.nodes) {
    distances.set(n.id, Infinity);
    previous.set(n.id, null);
  }
  distances.set(startId, 0);

  // Simple priority queue via unvisited selection (graph ~150-300 nodes, runs in <0.1ms)
  const queue: string[] = [startId];

  while (queue.length > 0) {
    let bestIdx = 0;
    let bestDist = distances.get(queue[0]) ?? Infinity;
    for (let i = 1; i < queue.length; i++) {
      const d = distances.get(queue[i]) ?? Infinity;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const current = queue[bestIdx];
    queue.splice(bestIdx, 1);

    if (visited.has(current)) continue;
    visited.add(current);

    if (current === targetId) break;
    if (bestDist === Infinity) break;

    const neighbors = adj.get(current) ?? [];
    for (const { to, weight } of neighbors) {
      if (visited.has(to)) continue;
      const alt = bestDist + weight;
      if (alt < (distances.get(to) ?? Infinity)) {
        distances.set(to, alt);
        previous.set(to, current);
        queue.push(to);
      }
    }
  }

  const finalDist = distances.get(targetId) ?? Infinity;
  if (!Number.isFinite(finalDist)) {
    return null;
  }

  const nodeIds: string[] = [];
  let curr: string | null = targetId;
  while (curr !== null) {
    nodeIds.push(curr);
    curr = previous.get(curr) ?? null;
  }
  nodeIds.reverse();

  const points = nodeIds.map((id) => {
    const n = nodeById.get(id)!;
    return { x: n.x, y: n.y };
  });

  return {
    nodeIds,
    points,
    totalDistance: finalDist,
  };
}

function findMatchingGraphEdge(
  graph: RoadGraph,
  aId: string,
  bId: string
): RoadEdge | undefined {
  return graph.edges.find(
    (e) => (e[0] === aId && e[1] === bId) || (e[0] === bId && e[1] === aId)
  );
}

/**
 * Inserts a temporary virtual waypoint strictly along an existing RoadEdge (preserving oneWay directionality)
 * without mutating the persistent RoadGraph or adding visible nodes.
 */
function buildTempGraphWithEdgePoint(
  graph: RoadGraph,
  edge: [string, string],
  point: Point,
  tempId: string
): RoadGraph | null {
  const matched = findMatchingGraphEdge(graph, edge[0], edge[1]);
  if (!matched) return null;
  const fromId = matched[0];
  const toId = matched[1];
  const meta = matched[2];

  const remainingEdges = graph.edges.filter((e) => e !== matched);
  const splitEdges: RoadEdge[] = meta?.oneWay
    ? [
        [fromId, tempId, { oneWay: true }],
        [tempId, toId, { oneWay: true }],
      ]
    : [
        [fromId, tempId],
        [tempId, toId],
      ];

  return {
    nodes: [...graph.nodes, { id: tempId, x: point.x, y: point.y, kind: 'endpoint' }],
    edges: [...remainingEdges, ...splitEdges],
  };
}

export function findClosestRoadTarget(
  graph: RoadGraph,
  clickPoint: Point,
  maxSnapDistance = 52
): RoadSnapMatch | null {
  const nodeById = new Map<string, RoadNode>();
  for (const n of graph.nodes) {
    nodeById.set(n.id, n);
  }

  let bestEdgeMatch: RoadSnapMatch | null = null;
  for (const edge of graph.edges) {
    const aId = edge[0];
    const bId = edge[1];
    const meta = edge[2];
    const a = nodeById.get(aId);
    const b = nodeById.get(bId);
    if (!a || !b) continue;
    const proj = projectPointOnSegment(clickPoint, a, b);
    if (proj.dist <= maxSnapDistance) {
      if (!bestEdgeMatch || proj.dist < bestEdgeMatch.distanceToClick) {
        const snapNodeThreshold = 0.08;
        let snappedNodeId: string | null = null;
        if (proj.t <= snapNodeThreshold) snappedNodeId = aId;
        else if (proj.t >= 1 - snapNodeThreshold) snappedNodeId = bId;

        bestEdgeMatch = {
          point: snappedNodeId
            ? { x: nodeById.get(snappedNodeId)!.x, y: nodeById.get(snappedNodeId)!.y }
            : proj.point,
          distanceToClick: proj.dist,
          edge: [aId, bId],
          edgeMeta: meta,
          nodeId: snappedNodeId,
          t: proj.t,
        };
      }
    }
  }

  let bestNodeMatch: RoadSnapMatch | null = null;
  for (const n of graph.nodes) {
    const d = dist(clickPoint, n);
    if (d <= maxSnapDistance && (!bestNodeMatch || d < bestNodeMatch.distanceToClick)) {
      bestNodeMatch = {
        point: { x: n.x, y: n.y },
        distanceToClick: d,
        edge: null,
        nodeId: n.id,
        t: 0,
      };
    }
  }

  if (
    bestNodeMatch &&
    (!bestEdgeMatch || bestNodeMatch.distanceToClick <= bestEdgeMatch.distanceToClick + 6)
  ) {
    return bestNodeMatch;
  }
  return bestEdgeMatch ?? bestNodeMatch;
}

export function findShortestPathToRoadPoint(
  graph: RoadGraph,
  startId: string,
  clickPoint: Point,
  maxSnapDistance = 52
): PathResult | null {
  const match = findClosestRoadTarget(graph, clickPoint, maxSnapDistance);
  if (!match) return null;

  if (match.nodeId) {
    const res = findShortestPath(graph, startId, match.nodeId);
    if (!res) return null;
    return {
      ...res,
      snappedPoint: match.point,
      snappedNodeId: match.nodeId,
    };
  }

  if (match.edge) {
    const tempId = '__target_point__';
    const tempGraph = buildTempGraphWithEdgePoint(graph, match.edge, match.point, tempId);
    if (!tempGraph) return null;

    const res = findShortestPath(tempGraph, startId, tempId);
    if (!res) return null;
    return {
      nodeIds: res.nodeIds.filter((id) => id !== tempId),
      points: res.points,
      totalDistance: res.totalDistance,
      snappedPoint: match.point,
      snappedEdge: match.edge,
    };
  }

  return null;
}

/**
 * Computes a directed shortest path FROM a snapped road point (node or mid-edge point) BACK to targetId
 * (e.g., returning to 'base' while strictly obeying one-way CCW roundabouts!).
 */
export function findShortestPathFromRoadPoint(
  graph: RoadGraph,
  startPoint: Point,
  targetId: string,
  maxSnapDistance = 52
): PathResult | null {
  const match = findClosestRoadTarget(graph, startPoint, maxSnapDistance);
  if (!match) return null;

  if (match.nodeId) {
    const res = findShortestPath(graph, match.nodeId, targetId);
    if (!res) return null;
    return {
      ...res,
      snappedPoint: match.point,
      snappedNodeId: match.nodeId,
    };
  }

  if (match.edge) {
    const tempId = '__start_point__';
    const tempGraph = buildTempGraphWithEdgePoint(graph, match.edge, match.point, tempId);
    if (!tempGraph) return null;

    const res = findShortestPath(tempGraph, tempId, targetId);
    if (!res) return null;
    return {
      nodeIds: res.nodeIds.filter((id) => id !== tempId),
      points: res.points,
      totalDistance: res.totalDistance,
      snappedPoint: match.point,
      snappedEdge: match.edge,
    };
  }

  return null;
}

/**
 * Computes a directed shortest path FROM startId TO a precomputed building roadApproachPoint on an exact edge.
 * Falls back cleanly to snapping by coordinates if the user edited/replaced that edge in Edit Mode.
 */
export function findShortestPathToEdgePoint(
  graph: RoadGraph,
  startId: string,
  edge: [string, string],
  point: Point
): PathResult | null {
  const tempId = '__building_approach__';
  const tempGraph = buildTempGraphWithEdgePoint(graph, edge, point, tempId);
  if (tempGraph) {
    const res = findShortestPath(tempGraph, startId, tempId);
    if (res) {
      return {
        nodeIds: res.nodeIds.filter((id) => id !== tempId),
        points: res.points,
        totalDistance: res.totalDistance,
        snappedPoint: point,
        snappedEdge: edge,
      };
    }
  }
  return findShortestPathToRoadPoint(graph, startId, point, 96);
}

/**
 * Computes a directed shortest path FROM a precomputed building roadApproachPoint on an exact edge BACK to targetId.
 * Falls back cleanly to snapping by coordinates if the user edited/replaced that edge in Edit Mode.
 */
export function findShortestPathFromEdgePoint(
  graph: RoadGraph,
  edge: [string, string],
  point: Point,
  targetId: string
): PathResult | null {
  const tempId = '__building_depart__';
  const tempGraph = buildTempGraphWithEdgePoint(graph, edge, point, tempId);
  if (tempGraph) {
    const res = findShortestPath(tempGraph, tempId, targetId);
    if (res) {
      return {
        nodeIds: res.nodeIds.filter((id) => id !== tempId),
        points: res.points,
        totalDistance: res.totalDistance,
        snappedPoint: point,
        snappedEdge: edge,
      };
    }
  }
  return findShortestPathFromRoadPoint(graph, point, targetId, 96);
}
