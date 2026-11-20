import {
  U_STREETS,
  V_STREETS,
  type CityQuarter,
  type ResidentialAccessRoad,
  type StreetAxis,
  type StreetSpec,
  isoToCanvas,
  rectOverlapsRoundabout,
  streetCoversValue,
} from './cityMap';

export type HouseYardSide = 'uMin' | 'uMax' | 'vMin' | 'vMax';

export interface HouseYardFence {
  id: string;
  buildingId: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  /** Which yard edge borders the active street/access road and has the entrance gate break */
  streetSide: HouseYardSide;
  /** Street or residential access road ID that this yard opens onto */
  streetId: string;
  /** Gate break interval [gateMin, gateMax] along the orthogonal axis on streetSide */
  gateMin: number;
  gateMax: number;
  /** Exact center of the gate break on the fence line (iso & canvas) */
  gateCenter: { u: number; v: number; x: number; y: number };
  /** Exact courier stop point right outside the gate break on the sidewalk (iso & canvas) */
  deliveryStop: { u: number; v: number; x: number; y: number };
}

export interface OrganicHouseSlot {
  alongMin: number;
  alongMax: number;
  depth: number;
  setback: number;
}

export interface HouseCandidateInput {
  typ: 'dom';
  pietra: number;
  mieszkania: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  colorVariant: number;
  forcedStreetId?: string;
}

export interface PlacedHouseRecord {
  id: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export interface GenerateHouseQuarterParams {
  quarter: CityQuarter;
  quarterIndex: number;
  accessRoad?: ResidentialAccessRoad;
  tryPush: (candidate: HouseCandidateInput) => PlacedHouseRecord | null;
  isIsoPointOnRoadAsphalt: (u: number, v: number, margin?: number) => boolean;
}

/** Deterministic unit hash in [0, 1) for organic suburban spacing and setbacks */
export function hashUnit(seed: number): number {
  let x = (seed | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/**
 * Generates an organic single-family house row along [spanStart, spanEnd]:
 *  - Explicit target house count (so neighboring rows differ by 1–2 houses)
 *  - Subtle irregular house dimensions and non-uniform inter-house spacing
 *  - Individual street setback variation keeping safe clearance from sidewalks & backyards
 */
export function buildOrganicHouseRow(
  spanStart: number,
  spanEnd: number,
  targetCount: number,
  rowSeed: number,
  maxSetback: number,
  minGap = 18
): OrganicHouseSlot[] {
  const total = spanEnd - spanStart;
  if (total < 32 || targetCount <= 0) return [];

  let count = targetCount;
  while (count > 1 && total - (count - 1) * minGap < count * 32) {
    count--;
  }
  if (count <= 0) return [];

  const widths: number[] = [];
  const depths: number[] = [];
  for (let i = 0; i < count; i++) {
    const rW = hashUnit(rowSeed * 37 + i * 19 + 3);
    const rD = hashUnit(rowSeed * 53 + i * 29 + 7);
    widths.push(Math.round((32.5 + rW * 4.5) * 2) / 2); // 32.5 .. 37.0
    depths.push(Math.round((31.5 + rD * 4.5) * 2) / 2); // 31.5 .. 36.0
  }

  const sumW = widths.reduce((acc, w) => acc + w, 0);
  const slack = total - sumW;
  if (slack < 0) {
    return [];
  }

  // Distribute slack into [startMargin, gap_0, ..., gap_{count-2}, endMargin]
  // guaranteeing every interior gap >= minGap while introducing clear organic variation
  const baseInterior = (count - 1) * minGap;
  const extraSlack = Math.max(0, slack - baseInterior);

  const weights: number[] = [];
  // Edge margins get lighter weights so houses remain distributed naturally along the whole street
  weights.push(0.28 + hashUnit(rowSeed * 71 + 11) * 0.45);
  for (let g = 0; g < count - 1; g++) {
    // Alternate bias + deterministic hash so neighboring gaps visibly vary
    const wave = g % 2 === 0 ? 0.18 : -0.12;
    weights.push(Math.max(0.35, 0.72 + wave + hashUnit(rowSeed * 89 + g * 31 + 5) * 0.95));
  }
  weights.push(0.28 + hashUnit(rowSeed * 73 + 17) * 0.45);

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const startMargin = (extraSlack * weights[0]) / totalWeight;

  const out: OrganicHouseSlot[] = [];
  let cursor = spanStart + startMargin;
  const clampedMaxSetback = Math.max(0, Math.min(11, maxSetback));

  for (let i = 0; i < count; i++) {
    const rSet = hashUnit(rowSeed * 97 + i * 41 + 13);
    // Mix alternating rhythm with deterministic noise so neighboring houses subtly stagger
    const stagger = i % 2 === 0 ? 0.15 : 0.55;
    const normSetback = Math.min(1, Math.max(0, stagger * 0.45 + rSet * 0.75));
    const setback = Math.round(normSetback * clampedMaxSetback * 2) / 2;

    out.push({
      alongMin: cursor,
      alongMax: cursor + widths[i],
      depth: depths[i],
      setback,
    });

    if (i < count - 1) {
      const gap = minGap + (extraSlack * weights[i + 1]) / totalWeight;
      cursor += widths[i] + gap;
    }
  }

  return out;
}

/**
 * Chooses house counts for a sequence of adjacent rows in a quarter so that:
 *  - No two adjacent rows share the same count (differ by 1–2 buildings)
 *  - Overall house count drops naturally from maximal grid packing
 */
export function pickVariedRowCounts(
  maxFit: number,
  rowCount: number,
  quarterSeed: number
): number[] {
  if (maxFit <= 1) return Array(rowCount).fill(Math.max(1, maxFit));
  if (maxFit === 2) {
    const startHigh = quarterSeed % 2 === 0;
    return Array.from({ length: rowCount }, (_, i) => ((i % 2 === 0) === startHigh ? 2 : 1));
  }
  if (maxFit === 3) {
    const startHigh = quarterSeed % 2 === 0;
    return Array.from({ length: rowCount }, (_, i) => ((i % 2 === 0) === startHigh ? 3 : 2));
  }
  if (maxFit === 4) {
    const patterns = [
      [3, 2, 4, 2],
      [2, 4, 3, 2],
      [4, 2, 3, 2],
      [3, 2, 3, 4],
    ];
    const pat = patterns[Math.abs(quarterSeed) % patterns.length];
    return Array.from({ length: rowCount }, (_, i) => pat[i % pat.length]);
  }
  // maxFit >= 5: drop 1..3 houses per row with adjacent differences strictly in {1, 2}
  const dropPatterns = [
    [1, 2, 1, 3],
    [2, 1, 3, 1],
    [1, 3, 2, 1],
    [2, 1, 2, 3],
  ];
  const drops = dropPatterns[Math.abs(quarterSeed) % dropPatterns.length];
  return Array.from({ length: rowCount }, (_, i) => Math.max(2, maxFit - drops[i % drops.length]));
}

function findActiveStreetForEdge(
  side: HouseYardSide,
  edgeCoord: number,
  alongCenter: number
): StreetSpec | null {
  const list = side === 'uMin' || side === 'uMax' ? U_STREETS : V_STREETS;
  for (const s of list) {
    const half = s.asphaltWidth / 2 + s.sidewalkWidth;
    const expected = side === 'uMin' || side === 'vMin' ? s.coord + half : s.coord - half;
    if (Math.abs(expected - edgeCoord) <= 6 && streetCoversValue(s, alongCenter, -6)) {
      return s;
    }
  }
  return null;
}

function buildRowYards(
  rowHouses: PlacedHouseRecord[],
  streetSide: HouseYardSide,
  streetId: string,
  frontCoord: number,
  backCoord: number,
  alongBoundsMin: number,
  alongBoundsMax: number,
  isIsoPointOnRoadAsphalt: (u: number, v: number, margin?: number) => boolean,
  outYards: HouseYardFence[]
) {
  if (rowHouses.length === 0) return;
  const alongV = streetSide === 'uMin' || streetSide === 'uMax';
  const sorted = [...rowHouses].sort((a, b) => (alongV ? a.vMin - b.vMin : a.uMin - b.uMin));
  const sharedNeighborMaxGap = 68;
  const outerSideMargin = 12;

  // Precompute exact shared split coordinates between adjacent houses in the row
  const splits: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const curMax = alongV ? sorted[i].vMax : sorted[i].uMax;
    const nxtMin = alongV ? sorted[i + 1].vMin : sorted[i + 1].uMin;
    splits.push((curMax + nxtMin) * 0.5);
  }

  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    const hAlongMin = alongV ? h.vMin : h.uMin;
    const hAlongMax = alongV ? h.vMax : h.uMax;

    let yAlongMin: number;
    if (i > 0) {
      const prevMax = alongV ? sorted[i - 1].vMax : sorted[i - 1].uMax;
      yAlongMin =
        hAlongMin - prevMax <= sharedNeighborMaxGap
          ? splits[i - 1]
          : Math.max(alongBoundsMin, hAlongMin - outerSideMargin);
    } else {
      yAlongMin = Math.max(alongBoundsMin, hAlongMin - outerSideMargin);
    }

    let yAlongMax: number;
    if (i < sorted.length - 1) {
      const nxtMin = alongV ? sorted[i + 1].vMin : sorted[i + 1].uMin;
      yAlongMax =
        nxtMin - hAlongMax <= sharedNeighborMaxGap
          ? splits[i]
          : Math.min(alongBoundsMax, hAlongMax + outerSideMargin);
    } else {
      yAlongMax = Math.min(alongBoundsMax, hAlongMax + outerSideMargin);
    }

    yAlongMin = Math.max(alongBoundsMin, Math.min(yAlongMin, hAlongMin - 3));
    yAlongMax = Math.min(alongBoundsMax, Math.max(yAlongMax, hAlongMax + 3));

    let uMin = alongV ? Math.min(frontCoord, backCoord) : yAlongMin;
    let uMax = alongV ? Math.max(frontCoord, backCoord) : yAlongMax;
    let vMin = alongV ? yAlongMin : Math.min(frontCoord, backCoord);
    let vMax = alongV ? yAlongMax : Math.max(frontCoord, backCoord);

    // Trim outer corner smoothly if a yard edge clips a nearby roundabout sidewalk
    let trimGuard = 0;
    while (rectOverlapsRoundabout(uMin, uMax, vMin, vMax, 2.5) && trimGuard < 12) {
      trimGuard++;
      if (i === 0) {
        if (alongV) vMin = Math.min(h.vMin - 3, vMin + 2.5);
        else uMin = Math.min(h.uMin - 3, uMin + 2.5);
      } else if (i === sorted.length - 1) {
        if (alongV) vMax = Math.max(h.vMax + 3, vMax - 2.5);
        else uMax = Math.max(h.uMax + 3, uMax - 2.5);
      } else {
        break;
      }
    }

    // Gate opening (12u wide) centered on the house along streetSide
    const gateHalf = 6.0;
    const curAlongMin = alongV ? vMin : uMin;
    const curAlongMax = alongV ? vMax : uMax;
    const rawGateCenter = (hAlongMin + hAlongMax) * 0.5;
    const minGateCenter = curAlongMin + gateHalf + 2.5;
    const maxGateCenter = curAlongMax - gateHalf - 2.5;
    const gateCenterAlong =
      minGateCenter <= maxGateCenter
        ? Math.max(minGateCenter, Math.min(maxGateCenter, rawGateCenter))
        : (curAlongMin + curAlongMax) * 0.5;

    const gateMin = Math.round((gateCenterAlong - gateHalf) * 10) / 10;
    const gateMax = Math.round((gateCenterAlong + gateHalf) * 10) / 10;

    const gateU = streetSide === 'uMin' ? uMin : streetSide === 'uMax' ? uMax : gateCenterAlong;
    const gateV = streetSide === 'vMin' ? vMin : streetSide === 'vMax' ? vMax : gateCenterAlong;
    const gatePt = isoToCanvas(gateU, gateV);

    // Place deliveryStop right outside the gate gap on the sidewalk (guaranteed off road asphalt)
    let outStep = 4.0;
    let stopU =
      streetSide === 'uMin'
        ? uMin - outStep
        : streetSide === 'uMax'
          ? uMax + outStep
          : gateCenterAlong;
    let stopV =
      streetSide === 'vMin'
        ? vMin - outStep
        : streetSide === 'vMax'
          ? vMax + outStep
          : gateCenterAlong;

    while (outStep > 1.8 && isIsoPointOnRoadAsphalt(stopU, stopV, 1.8)) {
      outStep -= 0.5;
      stopU =
        streetSide === 'uMin'
          ? uMin - outStep
          : streetSide === 'uMax'
            ? uMax + outStep
            : gateCenterAlong;
      stopV =
        streetSide === 'vMin'
          ? vMin - outStep
          : streetSide === 'vMax'
            ? vMax + outStep
            : gateCenterAlong;
    }
    const stopPt = isoToCanvas(stopU, stopV);

    outYards.push({
      id: `yard_${h.id}`,
      buildingId: h.id,
      uMin: Math.round(uMin * 10) / 10,
      uMax: Math.round(uMax * 10) / 10,
      vMin: Math.round(vMin * 10) / 10,
      vMax: Math.round(vMax * 10) / 10,
      streetSide,
      streetId,
      gateMin,
      gateMax,
      gateCenter: {
        u: Math.round(gateU * 10) / 10,
        v: Math.round(gateV * 10) / 10,
        x: Math.round(gatePt.x * 10) / 10,
        y: Math.round(gatePt.y * 10) / 10,
      },
      deliveryStop: {
        u: Math.round(stopU * 10) / 10,
        v: Math.round(stopV * 10) / 10,
        x: Math.round(stopPt.x * 10) / 10,
        y: Math.round(stopPt.y * 10) / 10,
      },
    });
  }
}

/**
 * Unified axis-parameterized generator for bisected single-family house quarters
 * (handles both accessRoad.axis === 'u' and accessRoad.axis === 'v').
 */
function generateBisectedHouseQuarter(
  q: CityQuarter,
  accessRoad: ResidentialAccessRoad,
  axis: StreetAxis,
  seed: number,
  nominalSize: number,
  nominalGap: number,
  fenceEdgeInset: number,
  tryPush: (candidate: HouseCandidateInput) => PlacedHouseRecord | null,
  isIsoPointOnRoadAsphalt: (u: number, v: number, margin?: number) => boolean,
  outYards: HouseYardFence[]
) {
  const arHalf = accessRoad.asphaltWidth / 2 + accessRoad.sidewalkWidth;
  const outerInset = 11;
  const innerInset = 10;

  const isUAxis = axis === 'u';
  const alongMinEdge = isUAxis ? q.vMin : q.uMin;
  const alongMaxEdge = isUAxis ? q.vMax : q.uMax;
  const crossMinEdge = isUAxis ? q.uMin : q.vMin;
  const crossMaxEdge = isUAxis ? q.uMax : q.vMax;

  const alongStart = alongMinEdge + outerInset;
  const alongEnd = alongMaxEdge - outerInset;
  const midAlong = (alongMinEdge + alongMaxEdge) * 0.5;
  const maxFit = Math.max(
    1,
    Math.floor((alongEnd - alongStart + nominalGap) / (nominalSize + nominalGap))
  );
  const counts = pickVariedRowCounts(maxFit, 4, seed);

  const minSide: HouseYardSide = isUAxis ? 'uMin' : 'vMin';
  const maxSide: HouseYardSide = isUAxis ? 'uMax' : 'vMax';
  const outerSeedOffset = isUAxis ? 1 : 2;
  const innerSeedOffset = isUAxis ? 3 : 5;

  const halves: Array<{
    outerSide: HouseYardSide;
    innerSide: HouseYardSide;
    outerEdge: number;
    innerEdge: number;
    outerAnchor: number;
    outerDir: 1 | -1;
    innerAnchor: number;
    innerDir: 1 | -1;
    backyardSpan: number;
    outerRowIdx: number;
    innerRowIdx: number;
  }> = [
    {
      outerSide: minSide,
      innerSide: maxSide,
      outerEdge: crossMinEdge,
      innerEdge: accessRoad.coord - arHalf,
      outerAnchor: crossMinEdge + outerInset,
      outerDir: 1,
      innerAnchor: accessRoad.coord - arHalf - innerInset,
      innerDir: -1,
      backyardSpan: accessRoad.coord - arHalf - innerInset - (crossMinEdge + outerInset),
      outerRowIdx: 0,
      innerRowIdx: 1,
    },
    {
      outerSide: maxSide,
      innerSide: minSide,
      outerEdge: crossMaxEdge,
      innerEdge: accessRoad.coord + arHalf,
      outerAnchor: crossMaxEdge - outerInset,
      outerDir: -1,
      innerAnchor: accessRoad.coord + arHalf + innerInset,
      innerDir: 1,
      backyardSpan: crossMaxEdge - outerInset - (accessRoad.coord + arHalf + innerInset),
      outerRowIdx: 3,
      innerRowIdx: 2,
    },
  ];

  const arMinAlong = Math.min(accessRoad.startCoord, accessRoad.endCoord);
  const arMaxAlong = Math.max(accessRoad.startCoord, accessRoad.endCoord);
  const houseCrossMin = (h: PlacedHouseRecord) => (isUAxis ? h.uMin : h.vMin);
  const houseCrossMax = (h: PlacedHouseRecord) => (isUAxis ? h.uMax : h.vMax);
  const alongYardMin = alongMinEdge + fenceEdgeInset;
  const alongYardMax = alongMaxEdge - fenceEdgeInset;

  let hCount = 0;

  for (const half of halves) {
    const hasRoomForTwoRows = half.backyardSpan >= 36 * 2 + 16;
    const setbackBudget = hasRoomForTwoRows
      ? Math.max(0, Math.min(10, (half.backyardSpan - 36 * 2 - 14) / 2))
      : 10;

    const outerStreet = findActiveStreetForEdge(half.outerSide, half.outerEdge, midAlong);
    const outerPlaced: PlacedHouseRecord[] = [];
    const innerPlaced: PlacedHouseRecord[] = [];

    if (outerStreet) {
      const outerSlots = buildOrganicHouseRow(
        alongStart,
        alongEnd,
        counts[half.outerRowIdx],
        seed * 19 + half.outerRowIdx * 7 + outerSeedOffset,
        setbackBudget
      );
      for (const slot of outerSlots) {
        const slotMid = (slot.alongMin + slot.alongMax) * 0.5;
        if (!streetCoversValue(outerStreet, slotMid, -6)) continue;
        const crossMin =
          half.outerDir === 1
            ? half.outerAnchor + slot.setback
            : half.outerAnchor - slot.setback - slot.depth;
        const crossMax = crossMin + slot.depth;
        const placed = tryPush({
          typ: 'dom',
          pietra: hashUnit(seed * 31 + hCount * 13) > 0.48 ? 2 : 1,
          mieszkania: 1,
          uMin: isUAxis ? crossMin : slot.alongMin,
          uMax: isUAxis ? crossMax : slot.alongMax,
          vMin: isUAxis ? slot.alongMin : crossMin,
          vMax: isUAxis ? slot.alongMax : crossMax,
          colorVariant: (seed + hCount * 3) % 4,
          forcedStreetId: outerStreet.id,
        });
        if (placed) outerPlaced.push(placed);
        hCount++;
      }
    }

    if (hasRoomForTwoRows || !outerStreet) {
      const innerSlots = buildOrganicHouseRow(
        alongStart,
        alongEnd,
        counts[half.innerRowIdx],
        seed * 23 + half.innerRowIdx * 11 + innerSeedOffset,
        setbackBudget
      );
      for (const slot of innerSlots) {
        const slotMid = (slot.alongMin + slot.alongMax) * 0.5;
        if (slotMid < arMinAlong + 6 || slotMid > arMaxAlong - 6) continue;
        const crossMin =
          half.innerDir === 1
            ? half.innerAnchor + slot.setback
            : half.innerAnchor - slot.setback - slot.depth;
        const crossMax = crossMin + slot.depth;
        const placed = tryPush({
          typ: 'dom',
          pietra: hashUnit(seed * 37 + hCount * 17) > 0.48 ? 2 : 1,
          mieszkania: 1,
          uMin: isUAxis ? crossMin : slot.alongMin,
          uMax: isUAxis ? crossMax : slot.alongMax,
          vMin: isUAxis ? slot.alongMin : crossMin,
          vMax: isUAxis ? slot.alongMax : crossMax,
          colorVariant: (seed + hCount * 3 + 1) % 4,
          forcedStreetId: accessRoad.id,
        });
        if (placed) innerPlaced.push(placed);
        hCount++;
      }
    }

    // Compute exact shared rear fence line between back-to-back rows
    const outerFront =
      half.outerDir === 1 ? half.outerEdge + fenceEdgeInset : half.outerEdge - fenceEdgeInset;
    const innerFront =
      half.innerDir === 1 ? half.innerEdge + fenceEdgeInset : half.innerEdge - fenceEdgeInset;

    if (outerPlaced.length > 0 && innerPlaced.length > 0 && outerStreet) {
      const outerBackHouse =
        half.outerDir === 1
          ? Math.max(...outerPlaced.map(houseCrossMax))
          : Math.min(...outerPlaced.map(houseCrossMin));
      const innerBackHouse =
        half.innerDir === 1
          ? Math.max(...innerPlaced.map(houseCrossMax))
          : Math.min(...innerPlaced.map(houseCrossMin));
      const sharedBack = (outerBackHouse + innerBackHouse) * 0.5;

      buildRowYards(
        outerPlaced,
        half.outerSide,
        outerStreet.id,
        outerFront,
        sharedBack,
        alongYardMin,
        alongYardMax,
        isIsoPointOnRoadAsphalt,
        outYards
      );
      buildRowYards(
        innerPlaced,
        half.innerSide,
        accessRoad.id,
        innerFront,
        sharedBack,
        alongYardMin,
        alongYardMax,
        isIsoPointOnRoadAsphalt,
        outYards
      );
    } else if (outerPlaced.length > 0 && outerStreet) {
      const back =
        half.outerDir === 1
          ? Math.min(innerFront, Math.max(...outerPlaced.map(houseCrossMax)) + 14)
          : Math.max(innerFront, Math.min(...outerPlaced.map(houseCrossMin)) - 14);
      buildRowYards(
        outerPlaced,
        half.outerSide,
        outerStreet.id,
        outerFront,
        back,
        alongYardMin,
        alongYardMax,
        isIsoPointOnRoadAsphalt,
        outYards
      );
    } else if (innerPlaced.length > 0) {
      const back =
        half.innerDir === 1
          ? Math.min(outerFront, Math.max(...innerPlaced.map(houseCrossMax)) + 14)
          : Math.max(outerFront, Math.min(...innerPlaced.map(houseCrossMin)) - 14);
      buildRowYards(
        innerPlaced,
        half.innerSide,
        accessRoad.id,
        innerFront,
        back,
        alongYardMin,
        alongYardMax,
        isIsoPointOnRoadAsphalt,
        outYards
      );
    }
  }
}

/**
 * Generates all single-family houses, shared-boundary yard fences, entrance gates (furtki),
 * and sidewalk gate delivery stops for a single residential house quarter (`q.kind === 'houses'`).
 */
export function generateHouseQuarter({
  quarter: q,
  quarterIndex: qIdx,
  accessRoad,
  tryPush,
  isIsoPointOnRoadAsphalt,
}: GenerateHouseQuarterParams): HouseYardFence[] {
  const houseYards: HouseYardFence[] = [];
  const nominalSize = 35;
  const nominalGap = 22;
  const seed = Math.abs(q.ui * 17 + q.vi * 11 + qIdx * 3 + 5);
  const fenceEdgeInset = 2.0;

  if (accessRoad) {
    generateBisectedHouseQuarter(
      q,
      accessRoad,
      accessRoad.axis,
      seed,
      nominalSize,
      nominalGap,
      fenceEdgeInset,
      tryPush,
      isIsoPointOnRoadAsphalt,
      houseYards
    );
    return houseYards;
  }

  // Non-bisected residential quarters & outer map-edge residential bands
  let hCount = 0;
  const inset = 12;
  const bu0 = q.uMin + inset;
  const bu1 = q.uMax - inset;
  const bv0 = q.vMin + inset;
  const bv1 = q.vMax - inset;
  const uW = bu1 - bu0;
  const vW = bv1 - bv0;
  if (uW < 42 || vW < 42) return houseYards;

  const midU = (q.uMin + q.uMax) * 0.5;
  const midV = (q.vMin + q.vMax) * 0.5;
  const uMinStreet = findActiveStreetForEdge('uMin', q.uMin, midV);
  const uMaxStreet = findActiveStreetForEdge('uMax', q.uMax, midV);
  const vMinStreet = findActiveStreetForEdge('vMin', q.vMin, midU);
  const vMaxStreet = findActiveStreetForEdge('vMax', q.vMax, midU);

  if (q.isOuterBand) {
    // Outer map-edge band: place ONLY a single organic street-fronting row along
    // the bordering ring street so zero isolated houses ever sit deep in the green edge.
    const candidateEdge: { side: HouseYardSide; street: StreetSpec } | null = vMaxStreet
      ? { side: 'vMax', street: vMaxStreet }
      : uMinStreet
        ? { side: 'uMin', street: uMinStreet }
        : vMinStreet
          ? { side: 'vMin', street: vMinStreet }
          : uMaxStreet
            ? { side: 'uMax', street: uMaxStreet }
            : null;

    if (!candidateEdge) return houseYards;
    const { side, street } = candidateEdge;
    const alongV = side === 'uMin' || side === 'uMax';
    const primaryStart = alongV ? bv0 : bu0;
    const primaryEnd = alongV ? bv1 : bu1;
    const maxFit = Math.max(1, Math.floor((primaryEnd - primaryStart + 22) / (nominalSize + 22)));
    const targetCount = Math.max(1, maxFit - (hashUnit(seed * 7 + 3) > 0.55 ? 1 : 0));
    const slots = buildOrganicHouseRow(primaryStart, primaryEnd, targetCount, seed * 29 + 9, 10, 20);

    const placedRow: PlacedHouseRecord[] = [];
    for (const slot of slots) {
      const slotMid = (slot.alongMin + slot.alongMax) * 0.5;
      if (!streetCoversValue(street, slotMid, -6)) continue;
      let uMin: number;
      let uMax: number;
      let vMin: number;
      let vMax: number;
      if (side === 'uMin') {
        uMin = bu0 + slot.setback;
        uMax = uMin + slot.depth;
        vMin = slot.alongMin;
        vMax = slot.alongMax;
      } else if (side === 'uMax') {
        uMax = bu1 - slot.setback;
        uMin = uMax - slot.depth;
        vMin = slot.alongMin;
        vMax = slot.alongMax;
      } else if (side === 'vMin') {
        uMin = slot.alongMin;
        uMax = slot.alongMax;
        vMin = bv0 + slot.setback;
        vMax = vMin + slot.depth;
      } else {
        uMin = slot.alongMin;
        uMax = slot.alongMax;
        vMax = bv1 - slot.setback;
        vMin = vMax - slot.depth;
      }

      const placed = tryPush({
        typ: 'dom',
        pietra: hashUnit(seed * 43 + hCount * 19) > 0.48 ? 2 : 1,
        mieszkania: 1,
        uMin,
        uMax,
        vMin,
        vMax,
        colorVariant: (seed + hCount * 3) % 4,
        forcedStreetId: street.id,
      });
      if (placed) placedRow.push(placed);
      hCount++;
    }

    if (placedRow.length > 0) {
      const frontCoord =
        side === 'uMin'
          ? q.uMin + fenceEdgeInset
          : side === 'uMax'
            ? q.uMax - fenceEdgeInset
            : side === 'vMin'
              ? q.vMin + fenceEdgeInset
              : q.vMax - fenceEdgeInset;
      const backCoord =
        side === 'uMin'
          ? Math.min(q.uMax - fenceEdgeInset, Math.max(...placedRow.map((h) => h.uMax)) + 14)
          : side === 'uMax'
            ? Math.max(q.uMin + fenceEdgeInset, Math.min(...placedRow.map((h) => h.uMin)) - 14)
            : side === 'vMin'
              ? Math.min(q.vMax - fenceEdgeInset, Math.max(...placedRow.map((h) => h.vMax)) + 14)
              : Math.max(q.vMin + fenceEdgeInset, Math.min(...placedRow.map((h) => h.vMin)) - 14);
      buildRowYards(
        placedRow,
        side,
        street.id,
        frontCoord,
        backCoord,
        (alongV ? q.vMin : q.uMin) + fenceEdgeInset,
        (alongV ? q.vMax : q.uMax) - fenceEdgeInset,
        isIsoPointOnRoadAsphalt,
        houseYards
      );
    }
    return houseYards;
  }

  // Non-bisected interior house quarter: perimeter street-fronting rows only
  const maxFitV = Math.max(1, Math.floor((vW + nominalGap) / (nominalSize + nominalGap)));
  const vCounts = pickVariedRowCounts(maxFitV, 2, seed);
  const placeTwoURows = uW >= 36 * 2 + 20;
  const uSetbackBudget = placeTwoURows
    ? Math.max(0, Math.min(10, (uW - 36 * 2 - 16) / 2))
    : Math.max(0, Math.min(10, uW - 36));

  const leftPlaced: PlacedHouseRecord[] = [];
  const rightPlaced: PlacedHouseRecord[] = [];
  const topInfillPlaced: PlacedHouseRecord[] = [];
  const botInfillPlaced: PlacedHouseRecord[] = [];

  if (uMinStreet) {
    const leftSlots = buildOrganicHouseRow(bv0, bv1, vCounts[0], seed * 19 + 1, uSetbackBudget);
    for (const slot of leftSlots) {
      const slotMid = (slot.alongMin + slot.alongMax) * 0.5;
      if (!streetCoversValue(uMinStreet, slotMid, -6)) continue;
      const uMin = bu0 + slot.setback;
      const placed = tryPush({
        typ: 'dom',
        pietra: hashUnit(seed * 31 + hCount * 13) > 0.48 ? 2 : 1,
        mieszkania: 1,
        uMin,
        uMax: Math.min(bu1, uMin + slot.depth),
        vMin: slot.alongMin,
        vMax: slot.alongMax,
        colorVariant: (seed + hCount * 3) % 4,
        forcedStreetId: uMinStreet.id,
      });
      if (placed) leftPlaced.push(placed);
      hCount++;
    }
  }

  if (placeTwoURows && uMaxStreet) {
    const rightSlots = buildOrganicHouseRow(bv0, bv1, vCounts[1], seed * 23 + 7, uSetbackBudget);
    for (const slot of rightSlots) {
      const slotMid = (slot.alongMin + slot.alongMax) * 0.5;
      if (!streetCoversValue(uMaxStreet, slotMid, -6)) continue;
      const uMax = bu1 - slot.setback;
      const placed = tryPush({
        typ: 'dom',
        pietra: hashUnit(seed * 37 + hCount * 17) > 0.48 ? 2 : 1,
        mieszkania: 1,
        uMin: Math.max(bu0, uMax - slot.depth),
        uMax,
        vMin: slot.alongMin,
        vMax: slot.alongMax,
        colorVariant: (seed + hCount * 3 + 1) % 4,
        forcedStreetId: uMaxStreet.id,
      });
      if (placed) rightPlaced.push(placed);
      hCount++;
    }
  }

  const midU0 = bu0 + 36 + uSetbackBudget + 16;
  const midU1 = bu1 - 36 - uSetbackBudget - 16;
  if (placeTwoURows && midU1 - midU0 >= 36) {
    const maxFitMid = Math.max(
      1,
      Math.floor((midU1 - midU0 + nominalGap) / (nominalSize + nominalGap))
    );
    const midCounts = pickVariedRowCounts(maxFitMid, 2, seed + 5);
    const placeTwoVCols = vW >= 36 * 2 + 24;
    const vSetbackBudget = placeTwoVCols
      ? Math.max(0, Math.min(9, (vW - 36 * 2 - 20) / 2))
      : 8;

    if (vMinStreet) {
      const topSlots = buildOrganicHouseRow(
        midU0,
        midU1,
        midCounts[0],
        seed * 41 + 3,
        vSetbackBudget
      );
      for (const slot of topSlots) {
        const slotMid = (slot.alongMin + slot.alongMax) * 0.5;
        if (!streetCoversValue(vMinStreet, slotMid, -6)) continue;
        const vMin = bv0 + slot.setback;
        const placed = tryPush({
          typ: 'dom',
          pietra: hashUnit(seed * 47 + hCount * 11) > 0.48 ? 2 : 1,
          mieszkania: 1,
          uMin: slot.alongMin,
          uMax: slot.alongMax,
          vMin,
          vMax: vMin + slot.depth,
          colorVariant: (seed + hCount * 3) % 4,
          forcedStreetId: vMinStreet.id,
        });
        if (placed) topInfillPlaced.push(placed);
        hCount++;
      }
    }

    if (placeTwoVCols && vMaxStreet) {
      const botSlots = buildOrganicHouseRow(
        midU0,
        midU1,
        midCounts[1],
        seed * 43 + 9,
        vSetbackBudget
      );
      for (const slot of botSlots) {
        const slotMid = (slot.alongMin + slot.alongMax) * 0.5;
        if (!streetCoversValue(vMaxStreet, slotMid, -6)) continue;
        const vMax = bv1 - slot.setback;
        const placed = tryPush({
          typ: 'dom',
          pietra: hashUnit(seed * 53 + hCount * 17) > 0.48 ? 2 : 1,
          mieszkania: 1,
          uMin: slot.alongMin,
          uMax: slot.alongMax,
          vMin: vMax - slot.depth,
          vMax,
          colorVariant: (seed + hCount * 3 + 2) % 4,
          forcedStreetId: vMaxStreet.id,
        });
        if (placed) botInfillPlaced.push(placed);
        hCount++;
      }
    }
  }

  // Compute clean non-overlapping shared yard boundaries across all perimeter rows
  const allInfill = [...topInfillPlaced, ...botInfillPlaced];
  const leftMaxHouseU =
    leftPlaced.length > 0 ? Math.max(...leftPlaced.map((h) => h.uMax)) : q.uMin;
  const rightMinHouseU =
    rightPlaced.length > 0 ? Math.min(...rightPlaced.map((h) => h.uMin)) : q.uMax;

  let leftBackU = Math.min(q.uMax - fenceEdgeInset, leftMaxHouseU + 14);
  let rightBackU = Math.max(q.uMin + fenceEdgeInset, rightMinHouseU - 14);

  if (allInfill.length > 0) {
    const infillMinU = Math.min(...allInfill.map((h) => h.uMin));
    const infillMaxU = Math.max(...allInfill.map((h) => h.uMax));
    if (leftPlaced.length > 0) {
      leftBackU = (leftMaxHouseU + infillMinU) * 0.5;
    }
    if (rightPlaced.length > 0) {
      rightBackU = (infillMaxU + rightMinHouseU) * 0.5;
    }
  } else if (leftPlaced.length > 0 && rightPlaced.length > 0) {
    const gapU = rightMinHouseU - leftMaxHouseU;
    if (gapU <= 60) {
      const sharedU = (leftMaxHouseU + rightMinHouseU) * 0.5;
      leftBackU = sharedU;
      rightBackU = sharedU;
    }
  }

  if (leftPlaced.length > 0 && uMinStreet) {
    buildRowYards(
      leftPlaced,
      'uMin',
      uMinStreet.id,
      q.uMin + fenceEdgeInset,
      leftBackU,
      q.vMin + fenceEdgeInset,
      q.vMax - fenceEdgeInset,
      isIsoPointOnRoadAsphalt,
      houseYards
    );
  }
  if (rightPlaced.length > 0 && uMaxStreet) {
    buildRowYards(
      rightPlaced,
      'uMax',
      uMaxStreet.id,
      q.uMax - fenceEdgeInset,
      rightBackU,
      q.vMin + fenceEdgeInset,
      q.vMax - fenceEdgeInset,
      isIsoPointOnRoadAsphalt,
      houseYards
    );
  }

  if (allInfill.length > 0) {
    const infillAlongMin = leftPlaced.length > 0 ? leftBackU : q.uMin + fenceEdgeInset;
    const infillAlongMax = rightPlaced.length > 0 ? rightBackU : q.uMax - fenceEdgeInset;
    const topMaxV =
      topInfillPlaced.length > 0 ? Math.max(...topInfillPlaced.map((h) => h.vMax)) : q.vMin;
    const botMinV =
      botInfillPlaced.length > 0 ? Math.min(...botInfillPlaced.map((h) => h.vMin)) : q.vMax;

    let topBackV = Math.min(q.vMax - fenceEdgeInset, topMaxV + 14);
    let botBackV = Math.max(q.vMin + fenceEdgeInset, botMinV - 14);
    if (topInfillPlaced.length > 0 && botInfillPlaced.length > 0 && botMinV - topMaxV <= 60) {
      const sharedV = (topMaxV + botMinV) * 0.5;
      topBackV = sharedV;
      botBackV = sharedV;
    }

    if (topInfillPlaced.length > 0 && vMinStreet) {
      buildRowYards(
        topInfillPlaced,
        'vMin',
        vMinStreet.id,
        q.vMin + fenceEdgeInset,
        topBackV,
        infillAlongMin,
        infillAlongMax,
        isIsoPointOnRoadAsphalt,
        houseYards
      );
    }
    if (botInfillPlaced.length > 0 && vMaxStreet) {
      buildRowYards(
        botInfillPlaced,
        'vMax',
        vMaxStreet.id,
        q.vMax - fenceEdgeInset,
        botBackV,
        infillAlongMin,
        infillAlongMax,
        isIsoPointOnRoadAsphalt,
        houseYards
      );
    }
  }

  return houseYards;
}
