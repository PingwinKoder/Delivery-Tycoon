import type { Building } from '../../types/building';
import { formatBuildingAddress } from '../../types/building';
import type {
  LongTermDurationMonths,
  LongTermOrderOffer,
  OrderDeliveryStop,
  OrderEconomyState,
  OrderLocation,
  OrderOffer,
  ReputationLevel,
  ShortTermOrderOffer,
} from '../../types/orders';
import { MINUTES_PER_DAY, getCalendarDateFromElapsedDays } from '../gameClock';
import {
  LONG_TERM_OFFER_EXPIRY_DAYS,
  MAX_PENDING_OFFERS,
  SHORT_TERM_OFFER_EXPIRY_DAYS,
  TWO_DAY_LONG_TERM_MIN_COMPLETED_ORDERS,
  TWO_DAY_LONG_TERM_OFFER_CHANCE,
  getReputationTierConfig,
  nextRng,
  rngInt,
  rngPick,
  rngRate,
  roundCurrency,
} from './constantsAndHelpers';

export const SHOP_CLIENT_NAMES = [
  'Market Świeży Koszyk',
  'Delikatesy Centrum',
  'Sklep Spożywczy Gama',
  'Hurtownia EkoSmak',
  'Supermarket Blisko',
  'Sklep Elektroniczny Volt',
  'Dom i Ogród Kwadrat',
  'Sklep Wielobranżowy Plus',
  'Apteka i Drogeria Zdrowie',
  'Księgarnia Papiernicza A4',
] as const;

export const STATION_CLIENT_NAMES = [
  'Punkt Przesyłek — Dworzec Autobusowy',
  'Terminal Kurierski PKS',
  'Biuro Nadawcze Dworzec',
] as const;

export const KIOSK_CLIENT_NAMES = [
  'Pawilon Usługowy Kropka',
  'Kwiaciarnia i Upominki',
  'Piekarnia Rzemieślnicza',
  'Punkt Ksero i Druk',
  'Kiosk Prasowy i Paczki',
  'Pracownia Optyczna Fokus',
] as const;

/** Business weekdays (Poniedziałek–Piątek: 0..4) allowed for long-term pickup schedules */
export const LONG_TERM_PICKUP_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4] as const;

/** All 2x/week long-term pickup weekday pairs strictly within Monday–Friday (0..4) */
export const TWO_DAY_WEEKDAY_PAIRS: readonly (readonly [number, number])[] = [
  [0, 3], // Poniedziałek, Czwartek
  [1, 4], // Wtorek, Piątek
  [0, 4], // Poniedziałek, Piątek
  [1, 3], // Wtorek, Czwartek
  [2, 4], // Środa, Piątek
] as const;

// ============================================================================
// Real Map Building Pools & Location Builders
// ============================================================================

function toOrderLocation(building: Building): OrderLocation {
  const stop = building.deliveryStopPoint ?? {
    x: 0,
    y: 0,
    u: (building.uMin + building.uMax) * 0.5,
    v: (building.vMin + building.vMax) * 0.5,
    surface: 'plaza' as const,
  };

  return {
    buildingId: building.id,
    buildingType: building.typ,
    address: formatBuildingAddress(building),
    streetName: building.nazwaUlicy,
    buildingNumber: building.numerBudynku,
    deliveryStopPoint: stop,
    ...(building.roadApproachPoint ? { roadApproachPoint: building.roadApproachPoint } : {}),
  };
}

export function getBuildingPools(buildings: readonly Building[]): {
  pickupBuildings: Building[];
  deliveryBuildings: Building[];
} {
  const validDeliverable = buildings.filter(
    (b) => b.typ !== 'baza' && b.dostepnyDlaDostaw !== false && b.deliveryStopPoint !== undefined
  );

  const commercialPickups = validDeliverable.filter(
    (b) => b.typ === 'sklep' || b.typ === 'dworzec' || b.typ === 'kiosk'
  );
  const residentialDeliveries = validDeliverable.filter(
    (b) =>
      b.typ === 'dom' ||
      b.typ === 'blok_maly' ||
      b.typ === 'blok_sredni' ||
      b.typ === 'blok_wysoki'
  );

  return {
    pickupBuildings: commercialPickups.length > 0 ? commercialPickups : validDeliverable,
    deliveryBuildings:
      residentialDeliveries.length > 0 ? residentialDeliveries : validDeliverable,
  };
}

function pickClientNameForBuilding(
  rngState: number,
  building: Building
): { clientName: string; nextState: number } {
  if (building.typ === 'dworzec') {
    const picked = rngPick(rngState, STATION_CLIENT_NAMES);
    return { clientName: picked.value, nextState: picked.nextState };
  }
  if (building.typ === 'kiosk') {
    const picked = rngPick(rngState, KIOSK_CLIENT_NAMES);
    return { clientName: picked.value, nextState: picked.nextState };
  }
  const picked = rngPick(rngState, SHOP_CLIENT_NAMES);
  return { clientName: picked.value, nextState: picked.nextState };
}

export function buildDeliveryStops(
  rngState: number,
  orderId: string,
  totalPackages: number,
  pickupBuildingId: string,
  deliveryPool: readonly Building[]
): { stops: OrderDeliveryStop[]; nextState: number } {
  let state = rngState;
  const eligible = deliveryPool.filter((b) => b.id !== pickupBuildingId);
  const pool = eligible.length > 0 ? eligible : deliveryPool;

  if (pool.length === 0 || totalPackages <= 0) {
    return { stops: [], nextState: state };
  }

  // Distribute totalPackages across distinct destination buildings (1–3 packages per address)
  const targetStopCount = Math.min(
    pool.length,
    Math.max(1, Math.min(totalPackages, Math.ceil(totalPackages / 2)))
  );

  const chosen: Building[] = [];
  const usedIds = new Set<string>();
  let guard = 0;

  while (chosen.length < targetStopCount && guard < targetStopCount * 8) {
    guard++;
    const pick = rngPick(state, pool);
    state = pick.nextState;
    if (!usedIds.has(pick.value.id)) {
      usedIds.add(pick.value.id);
      chosen.push(pick.value);
    }
  }

  // Assign at least 1 package to each stop, then distribute remaining packages
  const counts = chosen.map(() => 1);
  let remaining = totalPackages - chosen.length;
  while (remaining > 0) {
    const idxStep = rngInt(state, 0, chosen.length - 1);
    state = idxStep.nextState;
    counts[idxStep.value] += 1;
    remaining -= 1;
  }

  const stops: OrderDeliveryStop[] = chosen.map((building, index) => ({
    id: `${orderId}-stop-${index + 1}`,
    location: toOrderLocation(building),
    packageCount: counts[index],
    deliveredCount: 0,
  }));

  return { stops, nextState: state };
}

// ============================================================================
// Offer Generator
// ============================================================================

const ORDER_NUMBER_MIN = 101;
const ORDER_NUMBER_MAX = 999;
const ORDER_NUMBER_SPAN = ORDER_NUMBER_MAX - ORDER_NUMBER_MIN + 1; // 899

/**
 * Draws a random 3-digit integer in [101, 999] that is not currently used by any
 * active order or pending offer.
 */
export function generateUniqueOrderNumber(usedNumbers: ReadonlySet<number>): number {
  for (let attempt = 0; attempt < 250; attempt++) {
    const candidate = Math.floor(Math.random() * ORDER_NUMBER_SPAN) + ORDER_NUMBER_MIN;
    if (!usedNumbers.has(candidate)) {
      return candidate;
    }
  }
  // Linear fallback scan in case nearly all 899 numbers are occupied simultaneously
  const startOffset = Math.floor(Math.random() * ORDER_NUMBER_SPAN);
  for (let i = 0; i < ORDER_NUMBER_SPAN; i++) {
    const candidate = ORDER_NUMBER_MIN + ((startOffset + i) % ORDER_NUMBER_SPAN);
    if (!usedNumbers.has(candidate)) {
      return candidate;
    }
  }
  return Math.floor(Math.random() * ORDER_NUMBER_SPAN) + ORDER_NUMBER_MIN;
}

export function generateSingleOffer(
  reputationLevel: ReputationLevel,
  currentMinutes: number,
  buildings: readonly Building[],
  orderSeq: number,
  rngState: number,
  usedOrderNumbers?: ReadonlySet<number>,
  completedOrdersCount = 0
): { offer: OrderOffer; nextState: number } {
  let state = rngState;
  const tier = getReputationTierConfig(reputationLevel);
  const { pickupBuildings, deliveryBuildings } = getBuildingPools(buildings);

  const pickupPick = rngPick(state, pickupBuildings);
  state = pickupPick.nextState;
  const pickupBuilding = pickupPick.value;
  const pickupLocation = toOrderLocation(pickupBuilding);

  const clientPick = pickClientNameForBuilding(state, pickupBuilding);
  state = clientPick.nextState;

  const ratePick = rngRate(state, tier.ratePerPackageMin, tier.ratePerPackageMax);
  state = ratePick.nextState;
  const ratePerPackage = ratePick.value;

  const createdDate = getCalendarDateFromElapsedDays(Math.floor(currentMinutes / MINUTES_PER_DAY));
  const createdAtGameDay = createdDate.gameDay;
  const id = `ord-${orderSeq}`;
  const orderNumber = generateUniqueOrderNumber(usedOrderNumbers ?? new Set<number>());

  // Decide short-term vs long-term based on reputation tier unlocks
  const canGenerateLongTerm = tier.allowedLongTermMonths.length > 0;
  let isLongTerm = false;
  if (canGenerateLongTerm) {
    const roll = nextRng(state);
    state = roll.nextState;
    isLongTerm = roll.value < 0.45;
  }

  const expiryDays = isLongTerm ? LONG_TERM_OFFER_EXPIRY_DAYS : SHORT_TERM_OFFER_EXPIRY_DAYS;
  const expiresAtGameDay = createdAtGameDay + expiryDays;
  const expiresAtMinutes = (expiresAtGameDay - 1) * MINUTES_PER_DAY;

  if (isLongTerm) {
    const monthsPick = rngPick(state, tier.allowedLongTermMonths);
    state = monthsPick.nextState;
    const durationMonths: LongTermDurationMonths = monthsPick.value;

    // Late-game long-term contracts (rep 3–4 or >= 25 completed orders) have a ~33% chance
    // to roll a 2x/week schedule with higher weekly volume split evenly across two weekdays.
    const canRollTwoDays =
      reputationLevel >= 3 || completedOrdersCount >= TWO_DAY_LONG_TERM_MIN_COMPLETED_ORDERS;
    let pickupDaysPerWeek: 1 | 2 = 1;
    if (canRollTwoDays) {
      const twoDayRoll = nextRng(state);
      state = twoDayRoll.nextState;
      pickupDaysPerWeek = twoDayRoll.value < TWO_DAY_LONG_TERM_OFFER_CHANCE ? 2 : 1;
    }

    let packagesPerWeek: number;
    let pickupWeekdays: readonly number[];
    if (pickupDaysPerWeek === 2) {
      const perDayMin = reputationLevel >= 4 ? 12 : 10;
      const perDayMax = reputationLevel >= 4 ? 18 : 16;
      const perDayStep = rngInt(state, perDayMin, perDayMax);
      state = perDayStep.nextState;
      packagesPerWeek = perDayStep.value * 2; // Clean even split across both scheduled days

      const pairStep = rngPick(state, TWO_DAY_WEEKDAY_PAIRS);
      state = pairStep.nextState;
      pickupWeekdays = pairStep.value;
    } else {
      const singleMin = reputationLevel >= 4 ? 16 : reputationLevel >= 3 ? 13 : 10;
      const singleMax = reputationLevel >= 4 ? 24 : reputationLevel >= 3 ? 20 : 16;
      const pkgStep = rngInt(state, singleMin, singleMax);
      state = pkgStep.nextState;
      packagesPerWeek = pkgStep.value;

      const dayStep = rngPick(state, LONG_TERM_PICKUP_WEEKDAYS); // Poniedziałek–Piątek (0..4)
      state = dayStep.nextState;
      pickupWeekdays = [dayStep.value];
    }

    // 3m = 13 weeks, 6m = 26 weeks, 12m = 52 weeks (aligned with 365-day calendar)
    const estimatedTotalWeeks = Math.round((durationMonths * 52) / 12);
    const totalContractValue = roundCurrency(
      packagesPerWeek * estimatedTotalWeeks * ratePerPackage
    );
    const estimatedMonthlyPayout = roundCurrency(totalContractValue / durationMonths);

    const sampleStops = buildDeliveryStops(
      state,
      id,
      packagesPerWeek,
      pickupBuilding.id,
      deliveryBuildings
    );
    state = sampleStops.nextState;

    const offer: LongTermOrderOffer = {
      id,
      orderNumber,
      kind: 'long_term',
      clientName: clientPick.clientName,
      title: `Kontrakt ${durationMonths} mies. — ${clientPick.clientName}`,
      description: `Stała obsługa przesyłek z ${pickupLocation.address} (${packagesPerWeek} paczek/tydz., rozliczenie 1. dnia miesiąca).`,
      reputationTierAtCreation: reputationLevel,
      pickupLocation,
      ratePerPackage,
      createdAtGameDay,
      createdAtMinutes: currentMinutes,
      expiresAtGameDay,
      expiresAtMinutes,
      isSeen: false,
      durationMonths,
      packagesPerWeek,
      pickupDaysPerWeek,
      pickupWeekdays,
      estimatedMonthlyPayout,
      totalContractValue,
      sampleDeliveryStops: sampleStops.stops,
    };

    return { offer, nextState: state };
  }

  // Short-term offer:
  // - 1–3 days -> 5–8 packages
  // - 7–14 days -> 12–22 packages (capped at 7 days on Level 1)
  const bandRoll = nextRng(state);
  state = bandRoll.nextState;
  const isMediumBand = bandRoll.value >= 0.5;

  let durationDays: number;
  let totalPackages: number;

  if (isMediumBand) {
    const mediumDurations = tier.maxShortTermDays >= 14 ? [7, 10, 14] : [7];
    const durPick = rngPick(state, mediumDurations);
    state = durPick.nextState;
    durationDays = durPick.value;

    const pkgPick = rngInt(state, 12, 22);
    state = pkgPick.nextState;
    totalPackages = pkgPick.value;
  } else {
    const durPick = rngInt(state, 1, 3);
    state = durPick.nextState;
    durationDays = durPick.value;

    const pkgPick = rngInt(state, 5, 8);
    state = pkgPick.nextState;
    totalPackages = pkgPick.value;
  }

  const totalExpectedPayout = roundCurrency(totalPackages * ratePerPackage);
  const stopsResult = buildDeliveryStops(
    state,
    id,
    totalPackages,
    pickupBuilding.id,
    deliveryBuildings
  );
  state = stopsResult.nextState;

  const dayLabel = durationDays === 1 ? '1 dzień' : `${durationDays} dni`;
  const offer: ShortTermOrderOffer = {
    id,
    orderNumber,
    kind: 'short_term',
    clientName: clientPick.clientName,
    title: `Zlecenie (${dayLabel}) — ${clientPick.clientName}`,
    description: `Odbiór ${totalPackages} paczek z ${pickupLocation.address} i dostawa do odbiorców na terenie miasta.`,
    reputationTierAtCreation: reputationLevel,
    pickupLocation,
    ratePerPackage,
    createdAtGameDay,
    createdAtMinutes: currentMinutes,
    expiresAtGameDay,
    expiresAtMinutes,
    isSeen: false,
    durationDays,
    totalPackages,
    totalExpectedPayout,
    deliveryStops: stopsResult.stops,
  };

  return { offer, nextState: state };
}

export function generateOffersBatch(
  state: OrderEconomyState,
  desiredCount: number,
  currentMinutes: number,
  buildings: readonly Building[],
  useRandomRng = false
): OrderEconomyState {
  const freeSlots = Math.max(0, MAX_PENDING_OFFERS - state.pendingOffers.length);
  const toGenerate = Math.min(desiredCount, freeSlots);
  if (toGenerate <= 0) {
    return state;
  }

  const newOffers: OrderOffer[] = [];
  const usedOrderNumbers = new Set<number>();
  for (const active of state.activeOrders) {
    usedOrderNumbers.add(active.orderNumber);
  }
  for (const pending of state.pendingOffers) {
    usedOrderNumbers.add(pending.orderNumber);
  }

  let activeRngState = useRandomRng ? state.randomRngState : state.rngState;
  let nextOrderSeq = state.nextOrderSeq;

  for (let i = 0; i < toGenerate; i++) {
    const generated = generateSingleOffer(
      state.reputationLevel,
      currentMinutes,
      buildings,
      nextOrderSeq,
      activeRngState,
      usedOrderNumbers,
      state.completedOrdersCount
    );
    usedOrderNumbers.add(generated.offer.orderNumber);
    newOffers.push(generated.offer);
    activeRngState = generated.nextState;
    nextOrderSeq += 1;
  }

  return {
    ...state,
    pendingOffers: [...state.pendingOffers, ...newOffers],
    nextOrderSeq,
    ...(useRandomRng ? { randomRngState: activeRngState } : { rngState: activeRngState }),
  };
}

/**
 * Picks a random deliverable city building as a package recipient, strictly excluding
 * Base and the order's sender building.
 */
export function pickRandomRecipientBuildingForPackage(
  buildings: readonly Building[],
  senderBuildingId: string | null
): Building | null {
  const eligible = buildings.filter(
    (b) =>
      b.typ !== 'baza' &&
      b.dostepnyDlaDostaw !== false &&
      b.deliveryStopPoint !== undefined &&
      b.roadApproachPoint !== undefined &&
      b.id !== senderBuildingId
  );
  if (eligible.length === 0) return null;
  const idx = Math.floor(Math.random() * eligible.length);
  return eligible[idx] ?? eligible[0];
}
