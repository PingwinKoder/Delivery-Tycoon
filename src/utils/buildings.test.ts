import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_STREETS,
  BASE_DEPOT,
  BUS_STATION,
  CITY_QUARTERS,
  RESIDENTIAL_ACCESS_ROADS,
  isoToCanvas,
  rectOverlapsActiveStreet,
  rectOverlapsRoundabout,
} from './cityMap';
import {
  PARCEL_LOCKER_SLOTS,
  PROCEDURAL_BUILDINGS,
  PROCEDURAL_DELIVERY_ZONES,
  PROCEDURAL_HOUSE_YARDS,
  PROCEDURAL_PARKING_LOTS,
  type DepthSortedEntity,
  computeParkingLayout,
  getBuildingPrismPoints,
  hitTestBuilding,
  isIsoPointOnRoadAsphalt,
  mergeEntitiesIntoBackToFrontOrder,
  parcelLockerSlots,
  sortBuildingsBackToFront,
} from './buildings';
import type { Building } from '../types/building';

test('procedural city generates dense vertical buildings, ~20 kiosks, markets, houses, and BAZA', () => {
  assert.ok(
    PROCEDURAL_BUILDINGS.length >= 300 && PROCEDURAL_BUILDINGS.length <= 700,
    `expected 300..700 dense urban buildings, got ${PROCEDURAL_BUILDINGS.length}`
  );

  const byType = new Map<string, Building[]>();
  for (const b of PROCEDURAL_BUILDINGS) {
    if (!byType.has(b.typ)) byType.set(b.typ, []);
    byType.get(b.typ)!.push(b);
  }

  // Baza garage
  const bazaList = byType.get('baza') ?? [];
  assert.equal(bazaList.length, 1, 'must have exactly 1 baza building');
  const baza = bazaList[0];
  assert.equal(baza.pietra, 1);
  assert.equal(baza.mieszkania, 0);
  assert.ok(
    baza.uMin >= BASE_DEPOT.yardUMin &&
      baza.uMax <= BASE_DEPOT.yardUMax &&
      baza.vMin >= BASE_DEPOT.yardVMin &&
      baza.vMax <= BASE_DEPOT.yardVMax,
    'baza garage must sit inside BASE_DEPOT concrete yard'
  );

  // Markets (min 4, wide & low)
  const markets = byType.get('sklep') ?? [];
  assert.ok(markets.length >= 4, `expected at least 4 markets, got ${markets.length}`);
  for (const m of markets) {
    assert.equal(m.pietra, 1);
    assert.equal(m.mieszkania, 0);
    assert.ok(m.height >= 20 && m.height <= 32, `market should stay low, got ${m.height}`);
    assert.ok(m.uMax - m.uMin >= 95 && m.vMax - m.vMin >= 95, 'markets should be wide flat buildings');
  }

  // Kiosks / service pavilions (~20)
  const kiosks = byType.get('kiosk') ?? [];
  assert.ok(
    kiosks.length >= 18 && kiosks.length <= 22,
    `expected ~20 kiosks (18..22), got ${kiosks.length}`
  );
  for (const k of kiosks) {
    assert.equal(k.pietra, 1);
    assert.equal(k.mieszkania, 0);
    assert.equal(k.height, 18);
    assert.ok(k.uMax - k.uMin <= 28 && k.vMax - k.vMin <= 28, 'kiosk must be compact');
  }

  // Residential blocks & houses
  const maly = byType.get('blok_maly') ?? [];
  const sredni = byType.get('blok_sredni') ?? [];
  const wysoki = byType.get('blok_wysoki') ?? [];
  const domy = byType.get('dom') ?? [];

  assert.ok(maly.length >= 25, `expected >= 25 small blocks, got ${maly.length}`);
  assert.ok(sredni.length >= 35, `expected >= 35 medium blocks, got ${sredni.length}`);
  assert.ok(wysoki.length >= 25, `expected >= 25 tall blocks, got ${wysoki.length}`);
  assert.ok(domy.length >= 120, `expected >= 120 single-family houses, got ${domy.length}`);

  for (const b of maly) {
    assert.equal(b.pietra, 3);
    assert.equal(b.mieszkania, 6);
    assert.ok(b.height >= 60 && b.height <= 75);
  }
  for (const b of sredni) {
    assert.equal(b.pietra, 5);
    assert.equal(b.mieszkania, 10);
    assert.ok(b.height >= 100 && b.height <= 125);
  }
  for (const b of wysoki) {
    assert.equal(b.pietra, 7);
    assert.equal(b.mieszkania, 14);
    assert.ok(b.height >= 145 && b.height <= 175);
  }
  for (const b of domy) {
    assert.ok(b.pietra === 1 || b.pietra === 2);
    assert.equal(b.mieszkania, 1);
    assert.ok(b.height >= 20 && b.height <= 46);
    assert.ok(b.uMax - b.uMin <= 42 && b.vMax - b.vMin <= 42);
  }
});

test('connected apartment blocks touch wall-to-wall (0 px gap) with zero interior overlap and remain separate objects', () => {
  const blocks = PROCEDURAL_BUILDINGS.filter(
    (b) => b.typ === 'blok_maly' || b.typ === 'blok_sredni' || b.typ === 'blok_wysoki'
  );

  for (let i = 0; i < PROCEDURAL_BUILDINGS.length; i++) {
    const a = PROCEDURAL_BUILDINGS[i];
    for (let j = i + 1; j < PROCEDURAL_BUILDINGS.length; j++) {
      const b = PROCEDURAL_BUILDINGS[j];
      const uOverlap = Math.min(a.uMax, b.uMax) - Math.max(a.uMin, b.uMin);
      const vOverlap = Math.min(a.vMax, b.vMax) - Math.max(a.vMin, b.vMin);
      assert.ok(
        !(uOverlap > 0.5 && vOverlap > 0.5),
        `buildings ${a.id} and ${b.id} overlap interiors (${uOverlap.toFixed(1)} x ${vOverlap.toFixed(1)})`
      );
    }
  }

  let touchingPairs = 0;
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      const uGap = Math.max(a.uMin - b.uMax, b.uMin - a.uMax);
      const vGap = Math.max(a.vMin - b.vMax, b.vMin - a.vMax);
      const uOverlap = Math.min(a.uMax, b.uMax) - Math.max(a.uMin, b.uMin);
      const vOverlap = Math.min(a.vMax, b.vMax) - Math.max(a.vMin, b.vMin);

      if ((Math.abs(uGap) <= 0.5 && vOverlap >= 20) || (Math.abs(vGap) <= 0.5 && uOverlap >= 20)) {
        touchingPairs++;
      }
    }
  }

  assert.ok(
    touchingPairs >= 60,
    `expected >= 60 wall-to-wall touching block pairs forming L/U frontages, got ${touchingPairs}`
  );
});

test('every parking lot has an unobstructed street access driveway, and exactly 8 reserved parcel locker slots are cleanly placed', () => {
  const marketLots = PROCEDURAL_PARKING_LOTS.filter((p) => p.kind === 'market');
  const courtyardLots = PROCEDURAL_PARKING_LOTS.filter((p) => p.kind === 'courtyard');

  assert.ok(marketLots.length >= 4, `expected >= 4 market parking lots, got ${marketLots.length}`);
  assert.ok(
    courtyardLots.length >= 12,
    `expected >= 12 block courtyard parking lots, got ${courtyardLots.length}`
  );

  for (const lot of PROCEDURAL_PARKING_LOTS) {
    assert.ok(lot.accessDriveway, `parking lot ${lot.id} must have a street access driveway`);
    assert.equal(
      rectOverlapsActiveStreet(lot.uMin, lot.uMax, lot.vMin, lot.vMax),
      false,
      `parking lot ${lot.id} overlaps an active street`
    );
    assert.equal(
      rectOverlapsRoundabout(lot.uMin, lot.uMax, lot.vMin, lot.vMax, 6),
      false,
      `parking lot ${lot.id} overlaps a roundabout`
    );
    assert.equal(
      rectOverlapsRoundabout(
        lot.accessDriveway.uMin,
        lot.accessDriveway.uMax,
        lot.accessDriveway.vMin,
        lot.accessDriveway.vMax,
        2
      ),
      false,
      `parking driveway of ${lot.id} overlaps a roundabout`
    );

    for (const b of PROCEDURAL_BUILDINGS) {
      const uOverlap = Math.min(lot.uMax, b.uMax) - Math.max(lot.uMin, b.uMin);
      const vOverlap = Math.min(lot.vMax, b.vMax) - Math.max(lot.vMin, b.vMin);
      assert.ok(
        !(uOverlap > 0 && vOverlap > 0),
        `parking lot ${lot.id} overlaps building ${b.id}`
      );
      const dU = Math.min(lot.accessDriveway.uMax, b.uMax) - Math.max(lot.accessDriveway.uMin, b.uMin);
      const dV = Math.min(lot.accessDriveway.vMax, b.vMax) - Math.max(lot.accessDriveway.vMin, b.vMin);
      assert.ok(
        !(dU > 0 && dV > 0),
        `parking driveway of ${lot.id} overlaps building ${b.id}`
      );
    }

    // Driveway must stay clear of roundabouts and intersection zebra crosswalks
    assert.ok(
      lot.accessDriveway.junctionClearance >= 4,
      `parking driveway of ${lot.id} is too close to a roundabout or crosswalk (${lot.accessDriveway.junctionClearance})`
    );

    // Driving throat into the lot must NEVER cross painted parking stalls
    const layout = computeParkingLayout(lot);
    const dw = lot.accessDriveway;
    const throatDepth = 22;
    const throat =
      dw.entrySide === 'uMin'
        ? { uMin: lot.uMin, uMax: lot.uMin + throatDepth, vMin: dw.vMin, vMax: dw.vMax }
        : dw.entrySide === 'uMax'
          ? { uMin: lot.uMax - throatDepth, uMax: lot.uMax, vMin: dw.vMin, vMax: dw.vMax }
          : dw.entrySide === 'vMin'
            ? { uMin: dw.uMin, uMax: dw.uMax, vMin: lot.vMin, vMax: lot.vMin + throatDepth }
            : { uMin: dw.uMin, uMax: dw.uMax, vMin: lot.vMax - throatDepth, vMax: lot.vMax };

    for (const stall of layout.allStalls) {
      const ovU = Math.min(throat.uMax, stall.uMax) - Math.max(throat.uMin, stall.uMin);
      const ovV = Math.min(throat.vMax, stall.vMax) - Math.max(throat.vMin, stall.vMin);
      assert.ok(
        !(ovU > 0.5 && ovV > 0.5),
        `parking lot ${lot.id} driveway crosses painted stall (${stall.row}) by ${ovU.toFixed(1)}x${ovV.toFixed(1)}`
      );
    }

    // Center island lots must leave generous perimeter driving aisles on all 4 sides
    if (lot.hasCenterIsland) {
      assert.ok(layout.centerIsland, `large parking lot ${lot.id} expected a center double-row island`);
      assert.ok(
        layout.centerIsland.sideAisleWidth >= 22,
        `center island side aisle too narrow on ${lot.id}: ${layout.centerIsland.sideAisleWidth}`
      );
      assert.ok(
        layout.centerIsland.endAisleWidth >= 24,
        `center island end aisle too narrow on ${lot.id}: ${layout.centerIsland.endAisleWidth}`
      );
      assert.ok(layout.centerIsland.stalls.length >= 3, `center island on ${lot.id} needs >= 3 stall pairs`);
    }
  }

  const islandLots = PROCEDURAL_PARKING_LOTS.filter((p) => p.hasCenterIsland);
  assert.ok(
    islandLots.length >= 12,
    `expected >= 12 larger parking lots (markets + big courtyards) with center double-row islands, got ${islandLots.length}`
  );

  // Exactly 8 reserved parcel locker slots across distinct quarters
  assert.equal(PARCEL_LOCKER_SLOTS.length, 8, `expected exactly 8 parcel locker slots, got ${PARCEL_LOCKER_SLOTS.length}`);
  assert.equal(parcelLockerSlots.length, 8);
  const slotQuarters = new Set(PARCEL_LOCKER_SLOTS.map((s) => s.quarterId));
  assert.equal(slotQuarters.size, 8, 'all 8 parcel locker slots should be distributed across 8 distinct quarters');

  for (const slot of PARCEL_LOCKER_SLOTS) {
    assert.equal(slot.occupied, false);
    assert.equal(rectOverlapsActiveStreet(slot.uMin, slot.uMax, slot.vMin, slot.vMax), false);
    assert.equal(rectOverlapsRoundabout(slot.uMin, slot.uMax, slot.vMin, slot.vMax, 8), false);

    for (const b of PROCEDURAL_BUILDINGS) {
      const uOv = Math.min(slot.uMax, b.uMax) - Math.max(slot.uMin, b.uMin);
      const vOv = Math.min(slot.vMax, b.vMax) - Math.max(slot.vMin, b.vMin);
      assert.ok(!(uOv > 0 && vOv > 0), `parcel locker slot ${slot.id} overlaps building ${b.id}`);
    }
    for (const lot of PROCEDURAL_PARKING_LOTS) {
      const uOv = Math.min(slot.uMax, lot.uMax) - Math.max(slot.uMin, lot.uMin);
      const vOv = Math.min(slot.vMax, lot.vMax) - Math.max(slot.vMin, lot.vMin);
      assert.ok(!(uOv > 0 && vOv > 0), `parcel locker slot ${slot.id} overlaps parking ${lot.id}`);
      const dU = Math.min(slot.uMax, lot.accessDriveway.uMax) - Math.max(slot.uMin, lot.accessDriveway.uMin);
      const dV = Math.min(slot.vMax, lot.accessDriveway.vMax) - Math.max(slot.vMin, lot.accessDriveway.vMin);
      assert.ok(!(dU > 0 && dV > 0), `parcel locker slot ${slot.id} blocks driveway of ${lot.id}`);
    }
  }

  // Verify the remaining reserved green park (q_2_2) stays completely empty
  const parks = CITY_QUARTERS.filter((q) => q.kind === 'park');
  assert.equal(parks.length, 1);
  assert.equal(parks[0].id, 'q_2_2');
  for (const park of parks) {
    for (const b of PROCEDURAL_BUILDINGS) {
      const cu = (b.uMin + b.uMax) / 2;
      const cv = (b.vMin + b.vMax) / 2;
      const insidePark =
        cu > park.uMin && cu < park.uMax && cv > park.vMin && cv < park.vMax;
      assert.equal(insidePark, false, `building ${b.id} placed inside reserved park ${park.id}`);
    }
    for (const lot of PROCEDURAL_PARKING_LOTS) {
      assert.notEqual(lot.quarterId, park.id);
    }
    for (const slot of PARCEL_LOCKER_SLOTS) {
      assert.notEqual(slot.quarterId, park.id);
    }
  }
});

test('Dworzec Autobusowy (b_bus_station) is an expanded 2-story terminal occupying the former platform space with 6 bays, dedicated side delivery zone, and 3D/2D hit testing', () => {
  const stations = PROCEDURAL_BUILDINGS.filter((b) => b.typ === 'dworzec');
  assert.equal(stations.length, 1, `expected exactly 1 dworzec building, got ${stations.length}`);

  const station = stations[0];
  assert.equal(station.id, 'b_bus_station');
  assert.equal(station.nazwaUlicy, 'al. Dworcowa');
  assert.ok(Number.isInteger(station.numerBudynku) && station.numerBudynku >= 1);
  assert.equal(station.pietra, 2);
  assert.equal(station.mieszkania, 0);
  assert.equal(station.height, 46);
  assert.equal(station.dostepnyDlaDostaw, true);
  assert.equal(station.stanowiskaAutobusowe, 6);
  assert.equal('strefaPeronow' in station, false, 'strefaPeronow must be removed from b_bus_station');

  // Expanded terminal footprint absorbing former platform strip (v=210..336)
  const uSpan = station.uMax - station.uMin;
  const vSpan = station.vMax - station.vMin;
  assert.ok(uSpan >= 220 && vSpan >= 120, `expected expanded terminal dimensions, got ${uSpan} x ${vSpan}`);

  // Placed strictly inside q_3_4 and clear of bus yard
  assert.ok(station.uMin >= BUS_STATION.quarterBounds.uMin && station.uMax <= BUS_STATION.quarterBounds.uMax);
  assert.ok(station.vMin >= BUS_STATION.asphaltYard.vMax + 4 && station.vMax <= BUS_STATION.quarterBounds.vMax);

  // Hit-testable in both 3D and 2D ("Podstawy budynków") modes across both old terminal & former platform space
  const formerPlatformPt = isoToCanvas((station.uMin + station.uMax) / 2, 235);
  const rearTerminalPt = isoToCanvas((station.uMin + station.uMax) / 2, 305);
  assert.equal(hitTestBuilding(PROCEDURAL_BUILDINGS, formerPlatformPt, true)?.id, 'b_bus_station');
  assert.equal(hitTestBuilding(PROCEDURAL_BUILDINGS, formerPlatformPt, false)?.id, 'b_bus_station');
  assert.equal(hitTestBuilding(PROCEDURAL_BUILDINGS, rearTerminalPt, true)?.id, 'b_bus_station');
  assert.equal(hitTestBuilding(PROCEDURAL_BUILDINGS, rearTerminalPt, false)?.id, 'b_bus_station');

  // Dedicated side delivery zone binding
  assert.equal(station.deliveryStopPoint?.surface, 'delivery_zone');
});

test('every market (sklep) and Dworzec Autobusowy has a dedicated side DeliveryZone with independent street driveway and zero overlaps', () => {
  const markets = PROCEDURAL_BUILDINGS.filter((b) => b.typ === 'sklep');
  const station = PROCEDURAL_BUILDINGS.find((b) => b.id === 'b_bus_station');
  assert.ok(markets.length >= 4 && station);

  assert.equal(
    PROCEDURAL_DELIVERY_ZONES.length,
    markets.length + 1,
    `expected ${markets.length + 1} delivery zones (all markets + bus station), got ${PROCEDURAL_DELIVERY_ZONES.length}`
  );

  const dzByBuildingId = new Map(PROCEDURAL_DELIVERY_ZONES.map((z) => [z.buildingId, z]));

  for (const b of [...markets, station]) {
    const dz = dzByBuildingId.get(b.id);
    assert.ok(dz, `building ${b.id} (${b.typ}) is missing a dedicated DeliveryZone`);
    assert.ok(b.deliveryStopPoint && b.roadApproachPoint);
    assert.equal(
      b.deliveryStopPoint.surface,
      'delivery_zone',
      `building ${b.id} deliveryStopPoint must target its dedicated delivery_zone`
    );
    assert.ok(
      (b.deliveryStopPoint.approachWaypoints?.length ?? 0) >= 1,
      `building ${b.id} must route through its dedicated delivery driveway mouth`
    );

    // Clearance from roundabouts and intersection crosswalks
    assert.ok(
      dz.driveway.junctionClearance >= 4,
      `delivery driveway for ${b.id} too close to crosswalk/roundabout (${dz.driveway.junctionClearance})`
    );
    assert.equal(
      rectOverlapsActiveStreet(dz.bay.uMin, dz.bay.uMax, dz.bay.vMin, dz.bay.vMax),
      false,
      `delivery bay ${dz.id} overlaps active street`
    );
    assert.equal(
      rectOverlapsRoundabout(dz.bay.uMin, dz.bay.uMax, dz.bay.vMin, dz.bay.vMax, 4),
      false,
      `delivery bay ${dz.id} overlaps roundabout`
    );
    assert.equal(
      rectOverlapsRoundabout(
        dz.driveway.uMin,
        dz.driveway.uMax,
        dz.driveway.vMin,
        dz.driveway.vMax,
        2
      ),
      false,
      `delivery driveway ${dz.id} overlaps roundabout`
    );

    // Zero overlap with any building
    for (const other of PROCEDURAL_BUILDINGS) {
      const bU = Math.min(dz.bay.uMax, other.uMax) - Math.max(dz.bay.uMin, other.uMin);
      const bV = Math.min(dz.bay.vMax, other.vMax) - Math.max(dz.bay.vMin, other.vMin);
      assert.ok(!(bU > 0.5 && bV > 0.5), `delivery bay ${dz.id} overlaps building ${other.id}`);
      const dU = Math.min(dz.driveway.uMax, other.uMax) - Math.max(dz.driveway.uMin, other.uMin);
      const dV = Math.min(dz.driveway.vMax, other.vMax) - Math.max(dz.driveway.vMin, other.vMin);
      assert.ok(!(dU > 0.5 && dV > 0.5), `delivery driveway ${dz.id} overlaps building ${other.id}`);
    }

    // Zero overlap with any parking lot or parking driveway (completely independent from customer/bus parking)
    for (const lot of PROCEDURAL_PARKING_LOTS) {
      const bU = Math.min(dz.bay.uMax, lot.uMax) - Math.max(dz.bay.uMin, lot.uMin);
      const bV = Math.min(dz.bay.vMax, lot.vMax) - Math.max(dz.bay.vMin, lot.vMin);
      assert.ok(!(bU > 0.5 && bV > 0.5), `delivery bay ${dz.id} overlaps parking lot ${lot.id}`);
      const dU =
        Math.min(dz.driveway.uMax, lot.accessDriveway.uMax) -
        Math.max(dz.driveway.uMin, lot.accessDriveway.uMin);
      const dV =
        Math.min(dz.driveway.vMax, lot.accessDriveway.vMax) -
        Math.max(dz.driveway.vMin, lot.accessDriveway.vMin);
      assert.ok(
        !(dU > 0.5 && dV > 0.5),
        `delivery driveway ${dz.id} overlaps parking driveway of ${lot.id}`
      );
    }

    // Zero overlap with Bus Station asphalt yard
    const yard = BUS_STATION.asphaltYard;
    const yU = Math.min(dz.bay.uMax, yard.uMax) - Math.max(dz.bay.uMin, yard.uMin);
    const yV = Math.min(dz.bay.vMax, yard.vMax) - Math.max(dz.bay.vMin, yard.vMin);
    assert.ok(!(yU > 0.5 && yV > 0.5), `delivery bay ${dz.id} overlaps bus station yard`);
  }
});

test('single-family house neighborhoods have organic varied row counts, irregular spacing, and varied street setbacks', () => {
  const houses = PROCEDURAL_BUILDINGS.filter((b) => b.typ === 'dom');
  assert.ok(
    houses.length >= 160 && houses.length <= 360,
    `expected organic single-family house count in 160..360 (reduced from rigid grid), got ${houses.length}`
  );

  let quartersWithVariedRowCounts = 0;
  let rowsWithIrregularGaps = 0;
  let rowsWithVariedSetbacks = 0;

  for (const ar of RESIDENTIAL_ACCESS_ROADS) {
    const q = CITY_QUARTERS.find((cq) => cq.id === ar.quarterId);
    if (!q) continue;

    const qHouses = houses.filter((h) => {
      const cu = (h.uMin + h.uMax) / 2;
      const cv = (h.vMin + h.vMax) / 2;
      return cu >= q.uMin && cu <= q.uMax && cv >= q.vMin && cv <= q.vMax;
    });
    if (qHouses.length < 4) continue;

    // Group houses into the 4 bands (outerA, innerA, innerB, outerB) relative to the access road
    const bands: Building[][] = [[], [], [], []];
    for (const h of qHouses) {
      const crossCenter = ar.axis === 'u' ? (h.uMin + h.uMax) / 2 : (h.vMin + h.vMax) / 2;
      const qMinCross = ar.axis === 'u' ? q.uMin : q.vMin;
      const qMaxCross = ar.axis === 'u' ? q.uMax : q.vMax;
      if (crossCenter < ar.coord) {
        const mid = (qMinCross + ar.coord) / 2;
        bands[crossCenter < mid ? 0 : 1].push(h);
      } else {
        const mid = (ar.coord + qMaxCross) / 2;
        bands[crossCenter < mid ? 2 : 3].push(h);
      }
    }

    const nonEmptyCounts = bands.map((b) => b.length).filter((c) => c > 0);
    if (new Set(nonEmptyCounts).size >= 2) {
      quartersWithVariedRowCounts++;
    }

    for (const band of bands) {
      if (band.length >= 3) {
        const sorted = [...band].sort((a, b) =>
          ar.axis === 'u' ? a.vMin - b.vMin : a.uMin - b.uMin
        );
        const gaps: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          const g =
            ar.axis === 'u'
              ? sorted[i].vMin - sorted[i - 1].vMax
              : sorted[i].uMin - sorted[i - 1].uMax;
          assert.ok(g >= 14, `houses in ${q.id} too crowded: gap ${g.toFixed(1)}`);
          gaps.push(g);
        }
        if (Math.max(...gaps) - Math.min(...gaps) >= 2.5) {
          rowsWithIrregularGaps++;
        }

        const setbacks = sorted.map((h) => (ar.axis === 'u' ? h.uMin : h.vMin));
        if (Math.max(...setbacks) - Math.min(...setbacks) >= 2.0) {
          rowsWithVariedSetbacks++;
        }
      }
    }
  }

  assert.ok(
    quartersWithVariedRowCounts >= 8,
    `expected >= 8 bisected residential quarters with differing neighboring row counts, got ${quartersWithVariedRowCounts}`
  );
  assert.ok(
    rowsWithIrregularGaps >= 12,
    `expected >= 12 house rows with organic irregular spacing, got ${rowsWithIrregularGaps}`
  );
  assert.ok(
    rowsWithVariedSetbacks >= 12,
    `expected >= 12 house rows with varied street setbacks, got ${rowsWithVariedSetbacks}`
  );
});

test('every single-family house directly borders an active street, has a non-overlapping fenced yard with shared neighbor boundaries, and delivers right outside its gate', () => {
  const houses = PROCEDURAL_BUILDINGS.filter((b) => b.typ === 'dom');
  assert.equal(
    PROCEDURAL_HOUSE_YARDS.length,
    houses.length,
    `expected 1 yard fence per single-family house (${houses.length}), got ${PROCEDURAL_HOUSE_YARDS.length}`
  );

  const houseById = new Map(houses.map((h) => [h.id, h]));
  const roadById = new Map<
    string,
    { id: string; coord: number; asphaltWidth: number; sidewalkWidth: number }
  >([
    ...ALL_STREETS.map((s) => [s.id, s] as const),
    ...RESIDENTIAL_ACCESS_ROADS.map((ar) => [ar.id, ar] as const),
  ]);

  for (const yard of PROCEDURAL_HOUSE_YARDS) {
    const h = houseById.get(yard.buildingId);
    assert.ok(h, `yard ${yard.id} references unknown house ${yard.buildingId}`);

    // Yard strictly encloses its house
    assert.ok(
      yard.uMin <= h.uMin - 1 &&
        yard.uMax >= h.uMax + 1 &&
        yard.vMin <= h.vMin - 1 &&
        yard.vMax >= h.vMax + 1,
      `yard ${yard.id} does not cleanly enclose house ${h.id}`
    );

    // Yard front edge directly borders an active street/access road (zero isolated interior houses!)
    const road = roadById.get(yard.streetId);
    assert.ok(road, `yard ${yard.id} references unknown street ${yard.streetId}`);
    const roadHalf = road.asphaltWidth / 2 + road.sidewalkWidth;
    const frontEdgeCoord =
      yard.streetSide === 'uMin'
        ? yard.uMin
        : yard.streetSide === 'uMax'
          ? yard.uMax
          : yard.streetSide === 'vMin'
            ? yard.vMin
            : yard.vMax;
    const distFrontToSidewalk = Math.abs(Math.abs(frontEdgeCoord - road.coord) - roadHalf);
    assert.ok(
      distFrontToSidewalk <= 5,
      `yard ${yard.id} front fence is not flush with bordering street ${road.id} sidewalk (dist=${distFrontToSidewalk.toFixed(1)})`
    );

    // House itself sits within natural setback distance of the bordering sidewalk
    const houseFrontCoord =
      yard.streetSide === 'uMin'
        ? h.uMin
        : yard.streetSide === 'uMax'
          ? h.uMax
          : yard.streetSide === 'vMin'
            ? h.vMin
            : h.vMax;
    const houseSetback = Math.abs(houseFrontCoord - frontEdgeCoord);
    assert.ok(
      houseSetback <= 26,
      `house ${h.id} is too far from its street fence (${houseSetback.toFixed(1)}u)`
    );

    // Yard never intrudes onto any active street/access-road sidewalk or roundabout
    for (const s of ALL_STREETS) {
      const half = s.asphaltWidth / 2 + s.sidewalkWidth;
      if (s.axis === 'u') {
        if (
          s.coord + half > yard.uMin + 0.1 &&
          s.coord - half < yard.uMax - 0.1 &&
          s.spans.some(([sMin, sMax]) => sMax > yard.vMin && sMin < yard.vMax)
        ) {
          assert.fail(`yard ${yard.id} intrudes onto street ${s.id} sidewalk`);
        }
      } else {
        if (
          s.coord + half > yard.vMin + 0.1 &&
          s.coord - half < yard.vMax - 0.1 &&
          s.spans.some(([sMin, sMax]) => sMax > yard.uMin && sMin < yard.uMax)
        ) {
          assert.fail(`yard ${yard.id} intrudes onto street ${s.id} sidewalk`);
        }
      }
    }
    for (const ar of RESIDENTIAL_ACCESS_ROADS) {
      const half = ar.asphaltWidth / 2 + ar.sidewalkWidth;
      if (ar.axis === 'u') {
        if (
          ar.coord + half > yard.uMin + 0.1 &&
          ar.coord - half < yard.uMax - 0.1 &&
          ar.endCoord > yard.vMin &&
          ar.startCoord < yard.vMax
        ) {
          assert.fail(`yard ${yard.id} intrudes onto access road ${ar.id} sidewalk`);
        }
      } else {
        if (
          ar.coord + half > yard.vMin + 0.1 &&
          ar.coord - half < yard.vMax - 0.1 &&
          ar.endCoord > yard.uMin &&
          ar.startCoord < yard.uMax
        ) {
          assert.fail(`yard ${yard.id} intrudes onto access road ${ar.id} sidewalk`);
        }
      }
    }
    assert.equal(
      rectOverlapsRoundabout(yard.uMin, yard.uMax, yard.vMin, yard.vMax, 1.5),
      false,
      `yard ${yard.id} overlaps roundabout`
    );

    // Gate sits cleanly inside the street-facing edge
    const alongMin = yard.streetSide === 'uMin' || yard.streetSide === 'uMax' ? yard.vMin : yard.uMin;
    const alongMax = yard.streetSide === 'uMin' || yard.streetSide === 'uMax' ? yard.vMax : yard.uMax;
    assert.ok(
      yard.gateMin > alongMin + 1 && yard.gateMax < alongMax - 1 && yard.gateMax - yard.gateMin >= 10,
      `yard ${yard.id} gate [${yard.gateMin}, ${yard.gateMax}] invalid on [${alongMin}, ${alongMax}]`
    );

    // House deliveryStopPoint points directly outside the fence gate (surface: 'gate')
    assert.equal(h.deliveryStopPoint?.surface, 'gate', `house ${h.id} must deliver at fence gate`);
    const dGate = Math.hypot(
      (h.deliveryStopPoint?.u ?? 0) - yard.gateCenter.u,
      (h.deliveryStopPoint?.v ?? 0) - yard.gateCenter.v
    );
    assert.ok(
      dGate >= 1.4 && dGate <= 6.0,
      `house ${h.id} deliveryStopPoint should sit right outside gate (dist=${dGate.toFixed(1)})`
    );
  }

  // Zero interior overlaps between any two house yards + confirm adjacent yards share flush boundaries
  let sharedFencePairs = 0;
  for (let i = 0; i < PROCEDURAL_HOUSE_YARDS.length; i++) {
    const a = PROCEDURAL_HOUSE_YARDS[i];
    for (let j = i + 1; j < PROCEDURAL_HOUSE_YARDS.length; j++) {
      const b = PROCEDURAL_HOUSE_YARDS[j];
      const uOv = Math.min(a.uMax, b.uMax) - Math.max(a.uMin, b.uMin);
      const vOv = Math.min(a.vMax, b.vMax) - Math.max(a.vMin, b.vMin);
      assert.ok(
        !(uOv > 0.6 && vOv > 0.6),
        `yards ${a.id} and ${b.id} overlap interiors (${uOv.toFixed(1)} x ${vOv.toFixed(1)})`
      );

      const uGap = Math.max(a.uMin - b.uMax, b.uMin - a.uMax);
      const vGap = Math.max(a.vMin - b.vMax, b.vMin - a.vMax);
      if ((Math.abs(uGap) <= 0.3 && vOv >= 15) || (Math.abs(vGap) <= 0.3 && uOv >= 15)) {
        sharedFencePairs++;
      }
    }
  }
  assert.ok(
    sharedFencePairs >= 140,
    `expected >= 140 flush shared-fence yard pairs between neighboring houses, got ${sharedFencePairs}`
  );
});

test('every building (including kiosks and access-road houses) has a unique valid Polish street address and clears all roads & roundabouts', () => {
  const validNames = new Set([
    ...ALL_STREETS.map((s) => s.name),
    ...RESIDENTIAL_ACCESS_ROADS.map((ar) => ar.name),
  ]);
  const seenAddresses = new Set<string>();
  const seenIds = new Set<string>();

  for (const b of PROCEDURAL_BUILDINGS) {
    assert.ok(!seenIds.has(b.id), `duplicate building id ${b.id}`);
    seenIds.add(b.id);

    assert.ok(validNames.has(b.nazwaUlicy), `unknown street name: ${b.nazwaUlicy}`);
    assert.ok(Number.isInteger(b.numerBudynku) && b.numerBudynku >= 1);

    const addr = `${b.nazwaUlicy} ${b.numerBudynku}`;
    assert.ok(!seenAddresses.has(addr), `duplicate address ${addr}`);
    seenAddresses.add(addr);

    assert.equal(
      rectOverlapsActiveStreet(b.uMin, b.uMax, b.vMin, b.vMax),
      false,
      `building ${b.id} overlaps an active street or residential access road`
    );
    assert.equal(
      rectOverlapsRoundabout(b.uMin, b.uMax, b.vMin, b.vMax, 8),
      false,
      `building ${b.id} overlaps a roundabout`
    );
  }
});

test('Painter algorithm Z-sorting strictly places rear buildings before front buildings (including wall-to-wall blocks & kiosks)', () => {
  const eps = 1e-3;
  for (let i = 0; i < PROCEDURAL_BUILDINGS.length; i++) {
    const a = PROCEDURAL_BUILDINGS[i];
    const aXMin = a.uMin + a.vMin;
    const aXMax = a.uMax + a.vMax;

    for (let j = i + 1; j < PROCEDURAL_BUILDINGS.length; j++) {
      const b = PROCEDURAL_BUILDINGS[j];
      const bXMin = b.uMin + b.vMin;
      const bXMax = b.uMax + b.vMax;

      if (aXMax <= bXMin + eps || bXMax <= aXMin + eps) continue;

      const bStrictlyBehindA = b.uMax <= a.uMin + eps || b.vMin >= a.vMax - eps;
      const aStrictlyBehindB = a.uMax <= b.uMin + eps || a.vMin >= b.vMax - eps;
      assert.equal(
        bStrictlyBehindA && !aStrictlyBehindB,
        false,
        `Z-sort violation: ${b.id} is behind ${a.id} but drawn after it`
      );
    }
  }
});

test('hitTestBuilding supports 3D/2D hit testing on blocks, kiosks, and resolves front-to-back occlusion', () => {
  const tall = PROCEDURAL_BUILDINGS.find((b) => b.typ === 'blok_wysoki');
  const kiosk = PROCEDURAL_BUILDINGS.find((b) => b.typ === 'kiosk');
  assert.ok(tall && kiosk, 'need a tall block and a kiosk for hit testing');

  const kioskCenter = isoToCanvas((kiosk.uMin + kiosk.uMax) / 2, (kiosk.vMin + kiosk.vMax) / 2);
  assert.equal(hitTestBuilding(PROCEDURAL_BUILDINGS, kioskCenter, true)?.id, kiosk.id);
  assert.equal(hitTestBuilding([kiosk], kioskCenter, false)?.id, kiosk.id);

  const centerBase = isoToCanvas((tall.uMin + tall.uMax) / 2, (tall.vMin + tall.vMax) / 2);
  assert.equal(hitTestBuilding(PROCEDURAL_BUILDINGS, centerBase, true)?.id, tall.id);
  assert.equal(hitTestBuilding([tall], centerBase, false)?.id, tall.id);

  const prism = getBuildingPrismPoints(tall);
  const roofUpperPt = {
    x: prism.tBack.x,
    y: prism.tBack.y + 10,
  };
  assert.equal(hitTestBuilding([tall], roofUpperPt, false)?.id, tall.id);
  assert.equal(hitTestBuilding([tall], roofUpperPt, true), null);

  const rear: Building = {
    id: 'rear',
    typ: 'dom',
    nazwaUlicy: 'ul. Testowa',
    numerBudynku: 1,
    pietra: 1,
    mieszkania: 1,
    uMin: 0,
    uMax: 60,
    vMin: 0,
    vMax: 60,
    height: 16,
    colorVariant: 0,
  };
  const front: Building = {
    id: 'front',
    typ: 'blok_wysoki',
    nazwaUlicy: 'ul. Testowa',
    numerBudynku: 3,
    pietra: 7,
    mieszkania: 14,
    uMin: 70,
    uMax: 130,
    vMin: -70,
    vMax: -10,
    height: 120,
    colorVariant: 0,
  };
  const sorted = sortBuildingsBackToFront([front, rear]);
  assert.equal(sorted[0].id, 'rear');
  assert.equal(sorted[1].id, 'front');

  const overlapPt = isoToCanvas(30, 30);
  const frontPts = getBuildingPrismPoints(front);
  assert.ok(frontPts.tBack.y < overlapPt.y && overlapPt.y < frontPts.bFront.y);
  assert.equal(hitTestBuilding(sorted, overlapPt, false)?.id, 'front');
  assert.equal(hitTestBuilding(sorted, overlapPt, true)?.id, 'rear');
});

test('mergeEntitiesIntoBackToFrontOrder naturally occludes courier behind tall blocks and places BAZA bike rack in front of BAZA garage', () => {
  const tall = PROCEDURAL_BUILDINGS.find((b) => b.typ === 'blok_wysoki');
  const garage = PROCEDURAL_BUILDINGS.find((b) => b.id === 'b_base_garage');
  assert.ok(tall && garage, 'expected tall block and BAZA garage');

  const noop = () => {};

  // 1. Courier riding directly behind tall block (-u back wall) MUST render BEFORE the tall block
  const midV = (tall.vMin + tall.vMax) / 2;
  const courierBehind: DepthSortedEntity = {
    id: 'courier_behind',
    uMin: tall.uMin - 18,
    uMax: tall.uMin - 9,
    vMin: midV - 4.5,
    vMax: midV + 4.5,
    draw: noop,
  };
  const sceneBehind = mergeEntitiesIntoBackToFrontOrder(PROCEDURAL_BUILDINGS, [courierBehind]);
  const idxCourierBehind = sceneBehind.findIndex(
    (e) => e.kind === 'entity' && e.entity.id === 'courier_behind'
  );
  const idxTallBehind = sceneBehind.findIndex(
    (e) => e.kind === 'building' && e.item.id === tall.id
  );
  assert.ok(
    idxCourierBehind !== -1 && idxTallBehind !== -1 && idxCourierBehind < idxTallBehind,
    `courier behind tall block (${idxCourierBehind}) must draw BEFORE tall block (${idxTallBehind})`
  );

  // 2. Courier riding directly in front of tall block (+u front wall) MUST render AFTER the tall block
  const courierInFront: DepthSortedEntity = {
    id: 'courier_in_front',
    uMin: tall.uMax + 9,
    uMax: tall.uMax + 18,
    vMin: midV - 4.5,
    vMax: midV + 4.5,
    draw: noop,
  };
  const sceneInFront = mergeEntitiesIntoBackToFrontOrder(PROCEDURAL_BUILDINGS, [courierInFront]);
  const idxCourierFront = sceneInFront.findIndex(
    (e) => e.kind === 'entity' && e.entity.id === 'courier_in_front'
  );
  const idxTallFront = sceneInFront.findIndex(
    (e) => e.kind === 'building' && e.item.id === tall.id
  );
  assert.ok(
    idxCourierFront !== -1 && idxTallFront !== -1 && idxCourierFront > idxTallFront,
    `courier in front of tall block (${idxCourierFront}) must draw AFTER tall block (${idxTallFront})`
  );

  // 3. BAZA bike rack against SW exterior garage wall MUST render AFTER b_base_garage (never hidden behind garage)
  const rack = BASE_DEPOT.bikeRack;
  const rackEntity: DepthSortedEntity = {
    id: rack.id,
    uMin: rack.uMin,
    uMax: rack.uMax,
    vMin: rack.vMin,
    vMax: rack.vMax,
    draw: noop,
  };
  const sceneRack = mergeEntitiesIntoBackToFrontOrder(PROCEDURAL_BUILDINGS, [rackEntity]);
  const idxRack = sceneRack.findIndex((e) => e.kind === 'entity' && e.entity.id === rack.id);
  const idxGarage = sceneRack.findIndex(
    (e) => e.kind === 'building' && e.item.id === 'b_base_garage'
  );
  assert.ok(
    idxRack !== -1 && idxGarage !== -1 && idxRack > idxGarage,
    `BAZA bike rack (${idxRack}) must draw AFTER b_base_garage (${idxGarage})`
  );
});

test('every deliverable building (blocks, houses, markets, kiosks, bus station) has a valid roadApproachPoint on roadGraph and off-road deliveryStopPoint', () => {
  const deliverable = PROCEDURAL_BUILDINGS.filter(
    (b) => b.typ !== 'baza' && b.dostepnyDlaDostaw !== false
  );
  assert.ok(deliverable.length >= 400, `expected >= 400 deliverable buildings, got ${deliverable.length}`);

  let deliveryZoneStopCount = 0;
  let gateStopCount = 0;
  let sidewalkStopCount = 0;

  for (const b of deliverable) {
    assert.ok(b.roadApproachPoint, `building ${b.id} (${b.typ}) missing roadApproachPoint`);
    assert.ok(b.deliveryStopPoint, `building ${b.id} (${b.typ}) missing deliveryStopPoint`);

    const ap = b.roadApproachPoint!;
    const sp = b.deliveryStopPoint!;
    assert.equal(ap.edge.length, 2, `building ${b.id} roadApproachPoint must reference a valid [a, b] edge`);
    assert.ok(ap.t >= 0 && ap.t <= 1, `building ${b.id} edge parameter t out of range: ${ap.t}`);

    // deliveryStopPoint must NEVER sit on active street, access road, driveway, or roundabout asphalt
    // (dedicated delivery_zone, yard gate, sidewalk, parking lot, and plaza stops are valid)
    assert.equal(
      isIsoPointOnRoadAsphalt(sp.u, sp.v, 1.5),
      false,
      `building ${b.id} (${b.typ}) deliveryStopPoint (${sp.u}, ${sp.v}) sits on road asphalt`
    );

    // deliveryStopPoint must sit OUTSIDE the building's own footprint (in front of entrance/gate)
    const insideSelf =
      sp.u > b.uMin + 0.5 && sp.u < b.uMax - 0.5 && sp.v > b.vMin + 0.5 && sp.v < b.vMax - 0.5;
    assert.equal(
      insideSelf,
      false,
      `building ${b.id} (${b.typ}) deliveryStopPoint should sit outside building footprint`
    );

    if (sp.surface === 'delivery_zone') deliveryZoneStopCount++;
    if (sp.surface === 'gate') gateStopCount++;
    if (sp.surface === 'sidewalk') sidewalkStopCount++;
  }

  const housesCount = PROCEDURAL_BUILDINGS.filter((b) => b.typ === 'dom').length;
  assert.equal(gateStopCount, housesCount, `expected every single-family house (${housesCount}) to stop at its gate, got ${gateStopCount}`);
  assert.ok(
    sidewalkStopCount + gateStopCount >= 260,
    `expected >= 260 street-side (sidewalk + gate) delivery stops, got ${sidewalkStopCount + gateStopCount}`
  );
  assert.equal(
    deliveryZoneStopCount,
    PROCEDURAL_DELIVERY_ZONES.length,
    `expected ${PROCEDURAL_DELIVERY_ZONES.length} dedicated delivery_zone stops (markets + bus station), got ${deliveryZoneStopCount}`
  );

  // BAZA garage itself is not a customer delivery target
  const baza = PROCEDURAL_BUILDINGS.find((b) => b.typ === 'baza');
  assert.ok(baza);
  assert.equal(baza.dostepnyDlaDostaw, false);
});
