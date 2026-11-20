export type BuildingType =
  | 'baza'
  | 'blok_maly'
  | 'blok_sredni'
  | 'blok_wysoki'
  | 'dom'
  | 'sklep'
  | 'kiosk'
  | 'dworzec';

export interface BuildingPalette {
  roof: string;
  leftWall: string;
  rightWall: string;
  footprintFill: string;
  footprintStroke: string;
  accent: string;
}

export interface RoadApproachPoint {
  /** World canvas coordinates snapped onto the nearest roadGraph edge */
  x: number;
  y: number;
  /** Isometric (u, v) coordinates */
  u: number;
  v: number;
  /** Exact roadGraph edge [fromId, toId] this point lies on (zero extra road nodes added) */
  edge: [string, string];
  /** Normalized parameter t in [0, 1] along edge[0] -> edge[1] */
  t: number;
}

export interface DeliveryStopPoint {
  /** Off-road world canvas coordinates directly in front of the building entrance or inside its delivery zone */
  x: number;
  y: number;
  /** Isometric (u, v) coordinates */
  u: number;
  v: number;
  /** Off-road surface type where the courier stops during parcel handoff */
  surface: 'sidewalk' | 'parking' | 'plaza' | 'delivery_zone' | 'gate';
  /** Optional intermediate off-road waypoints (e.g. dedicated delivery driveway mouth) */
  approachWaypoints?: Array<{ x: number; y: number }>;
}

export interface Building {
  id: string;
  typ: BuildingType;
  nazwaUlicy: string;
  numerBudynku: number;
  pietra: number;
  mieszkania: number;
  /** Footprint in logical isometric (u, v) coordinates */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Extrusion height in canvas pixels */
  height: number;
  /** Deterministic color variant index for subtle architectural variety */
  colorVariant: number;
  /** Whether couriers can deliver parcels to this building */
  dostepnyDlaDostaw?: boolean;
  /** Point on the nearest roadGraph edge used as street approach/re-entry for deliveries */
  roadApproachPoint?: RoadApproachPoint;
  /** Off-road point right in front of building entrance or inside dedicated delivery zone */
  deliveryStopPoint?: DeliveryStopPoint;
  /** Number of bus parking bays (for bus station buildings) */
  stanowiskaAutobusowe?: number;
}

export interface BuildingTypeMeta {
  label: string;
  shortLabel: string;
  description: string;
  badgeColor: string;
}

export const BUILDING_TYPE_META: Record<BuildingType, BuildingTypeMeta> = {
  baza: {
    label: 'Baza kurierska',
    shortLabel: 'Baza',
    description: 'Garaż i centrum dyspozytorskie firmy',
    badgeColor: '#f97316',
  },
  blok_maly: {
    label: 'Mały blok',
    shortLabel: 'Mały blok',
    description: 'Niski budynek mieszkalny wielorodzinny',
    badgeColor: '#d97706',
  },
  blok_sredni: {
    label: 'Średni blok',
    shortLabel: 'Średni blok',
    description: 'Zabudowa wielorodzinna średniej wysokości',
    badgeColor: '#64748b',
  },
  blok_wysoki: {
    label: 'Wysoki blok',
    shortLabel: 'Wysoki blok',
    description: 'Wysokościowy budynek mieszkalny przy głównej arterii',
    badgeColor: '#475569',
  },
  dom: {
    label: 'Dom jednorodzinny',
    shortLabel: 'Dom',
    description: 'Niska zabudowa jednorodzinna',
    badgeColor: '#c2410c',
  },
  sklep: {
    label: 'Sklep / Market',
    shortLabel: 'Market',
    description: 'Parterowy obiekt handlowy z dedykowaną strefą dostaw',
    badgeColor: '#2563eb',
  },
  kiosk: {
    label: 'Pawilon / Kiosk',
    shortLabel: 'Kiosk',
    description: 'Niewielki parterowy pawilon usługowo-handlowy',
    badgeColor: '#06b6d4',
  },
  dworzec: {
    label: 'Dworzec Autobusowy',
    shortLabel: 'Dworzec',
    description:
      'Rozbudowany obiekt publiczny i punkt dostaw kurierskich z dedykowaną strefą dostaw oraz placem postojowym dla autobusów',
    badgeColor: '#0f766e',
  },
};

export function formatBuildingAddress(building: Pick<Building, 'nazwaUlicy' | 'numerBudynku'>): string {
  return `${building.nazwaUlicy} ${building.numerBudynku}`;
}
