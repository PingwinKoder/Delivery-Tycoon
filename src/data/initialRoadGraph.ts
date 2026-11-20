import type { RoadGraph } from '../types/roadGraph';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  buildProceduralRoadGraph,
} from '../utils/cityMap';

export { MAP_HEIGHT, MAP_WIDTH };

export const INITIAL_ROAD_GRAPH: RoadGraph = buildProceduralRoadGraph();
