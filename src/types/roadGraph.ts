export type NodeKind = 'intersection' | 'roundabout' | 'base' | 'endpoint';

export interface Point {
  x: number;
  y: number;
}

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  kind?: NodeKind;
  label?: string;
}

export interface RoadEdgeMeta {
  /** True for strictly one-way directed edges (e.g. counter-clockwise roundabout ring segments) */
  oneWay?: boolean;
}

export type RoadEdge = [string, string] | [string, string, RoadEdgeMeta];

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}
