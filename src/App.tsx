import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_ROAD_GRAPH } from './data/initialRoadGraph';
import { MapCanvas, type MapCanvasController } from './components/MapCanvas';
import { OrdersModal } from './components/OrdersModal';
import { SkipTimeModal } from './components/SkipTimeModal';
import { Toolbar } from './components/Toolbar';
import {
  PROCEDURAL_BUILDINGS,
  applyWarehouseTierToBuildings,
} from './utils/buildings';
import { buildBaseDepotSpec } from './utils/cityMap';
import type { OrderEconomyState } from './types/orders';
import {
  type GameSpeed,
  INITIAL_GAME_MINUTES,
  MINUTES_PER_DAY,
  NIGHT_MODE_SPEED,
  WORKDAY_START_MINUTES,
  getGameMinutesPerRealSecond,
} from './utils/gameClock';
import {
  acceptOrderOffer,
  advanceOrderEconomy,
  countUnreadOffers,
  createInitialOrderEconomyState,
  findNextScheduledOrderDayMinutes,
  getNextDayMorningMinutes,
  hasEconomyBoundaryBetween,
  isNightHoursForTime,
  markAllPendingOffersSeen,
  moveWeeklyTaskPriority,
  rejectOrderOffer,
} from './utils/orderEconomy';

const MAX_CLOCK_REAL_DT = 0.1;

export function App() {
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [footprintOnly, setFootprintOnly] = useState<boolean>(false);
  const [showStreetNames, setShowStreetNames] = useState<boolean>(true);
  const [economyState, setEconomyState] = useState<OrderEconomyState>(() =>
    createInitialOrderEconomyState(PROCEDURAL_BUILDINGS)
  );
  const [gameMinutes, setGameMinutes] = useState<number>(INITIAL_GAME_MINUTES);
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>(1);
  // Prepared flag for future courier shift simulation: night mode 12x engages once all couriers return to base
  const [allCouriersAtBase] = useState<boolean>(true);
  const [ordersOpen, setOrdersOpen] = useState<boolean>(false);
  const [skipTimeOpen, setSkipTimeOpen] = useState<boolean>(false);

  const canvasControllerRef = useRef<MapCanvasController | null>(null);
  const exactGameMinutesRef = useRef<number>(INITIAL_GAME_MINUTES);
  const lastEconomyCheckMinutesRef = useRef<number>(INITIAL_GAME_MINUTES);
  const allCouriersAtBaseRef = useRef<boolean>(allCouriersAtBase);

  useEffect(() => {
    allCouriersAtBaseRef.current = allCouriersAtBase;
  }, [allCouriersAtBase]);

  // Advance world clock smoothly:
  // - Pause (0x) always stops time completely
  // - Daytime runs at user's chosen speed (1x/2x/4x -> 2/4/8 in-game min/s)
  // - Night hours (from seasonal closing time until 08:00) auto-switch to 12x when allCouriersAtBase is true
  useEffect(() => {
    if (gameSpeed === 0) return;

    let rafId: number | null = null;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const realDt = Math.min(Math.max(0, (now - lastTime) / 1000), MAX_CLOCK_REAL_DT);
      lastTime = now;

      const currentExact = exactGameMinutesRef.current;
      const prevWhole = Math.floor(currentExact);
      const isNightNow = allCouriersAtBaseRef.current && isNightHoursForTime(currentExact);
      const effectiveSpeed = isNightNow ? NIGHT_MODE_SPEED : gameSpeed;
      const minutesPerRealSecond = getGameMinutesPerRealSecond(effectiveSpeed);

      let nextExact = currentExact + realDt * minutesPerRealSecond;

      // When waking up from 12x Night Mode at 08:00, snap cleanly to 08:00 so player speed resumes accurately
      if (isNightNow && !isNightHoursForTime(nextExact)) {
        const morningDay = Math.floor(nextExact / MINUTES_PER_DAY);
        nextExact = morningDay * MINUTES_PER_DAY + WORKDAY_START_MINUTES;
      }

      exactGameMinutesRef.current = nextExact;
      const nextWhole = Math.floor(nextExact);

      if (nextWhole !== prevWhole) {
        setGameMinutes(nextWhole);

        if (hasEconomyBoundaryBetween(lastEconomyCheckMinutesRef.current, nextWhole)) {
          lastEconomyCheckMinutesRef.current = nextWhole;
          setEconomyState((prev) =>
            advanceOrderEconomy(prev, nextWhole, PROCEDURAL_BUILDINGS)
          );
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [gameSpeed]);

  const handleToggleGrid = useCallback(() => {
    setShowGrid((prev) => !prev);
  }, []);

  const handleToggleFootprintOnly = useCallback(() => {
    setFootprintOnly((prev) => !prev);
  }, []);

  const handleToggleStreetNames = useCallback(() => {
    setShowStreetNames((prev) => !prev);
  }, []);

  const handleChangeGameSpeed = useCallback((speed: GameSpeed) => {
    setGameSpeed(speed);
  }, []);

  const handleOpenOrders = useCallback(() => {
    setSkipTimeOpen(false);
    setOrdersOpen(true);
  }, []);

  const handleCloseOrders = useCallback(() => {
    setOrdersOpen(false);
  }, []);

  const handleOpenSkipTime = useCallback(() => {
    setOrdersOpen(false);
    setSkipTimeOpen(true);
  }, []);

  const handleCloseSkipTime = useCallback(() => {
    setSkipTimeOpen(false);
  }, []);

  const jumpWorldClockTo = useCallback((targetMinutes: number) => {
    const safeTarget = Math.max(Math.floor(exactGameMinutesRef.current), Math.floor(targetMinutes));
    exactGameMinutesRef.current = safeTarget;
    lastEconomyCheckMinutesRef.current = safeTarget;
    setGameMinutes(safeTarget);
    setEconomyState((prev) =>
      advanceOrderEconomy(prev, safeTarget, PROCEDURAL_BUILDINGS)
    );
    setSkipTimeOpen(false);
  }, []);

  const handleSkipOneDay = useCallback(() => {
    const target = getNextDayMorningMinutes(exactGameMinutesRef.current);
    jumpWorldClockTo(target);
  }, [jumpWorldClockTo]);

  const handleSkipToNextOrder = useCallback(() => {
    const target = findNextScheduledOrderDayMinutes(economyState, exactGameMinutesRef.current);
    if (target !== null) {
      jumpWorldClockTo(target);
    }
  }, [economyState, jumpWorldClockTo]);

  const handleMarkOffersSeen = useCallback(() => {
    setEconomyState((prev) => markAllPendingOffersSeen(prev));
  }, []);

  const handleAcceptOffer = useCallback((offerId: string) => {
    const nowMinutes = Math.floor(exactGameMinutesRef.current);
    setEconomyState((prev) => acceptOrderOffer(prev, offerId, nowMinutes));
  }, []);

  const handleRejectOffer = useCallback((offerId: string) => {
    setEconomyState((prev) => rejectOrderOffer(prev, offerId));
  }, []);

  const handleMoveWeeklyTaskPriority = useCallback(
    (weekdayIndex: number, orderId: string, direction: 'up' | 'down') => {
      const currentGameDay = Math.floor(exactGameMinutesRef.current / MINUTES_PER_DAY) + 1;
      setEconomyState((prev) =>
        moveWeeklyTaskPriority(prev, weekdayIndex, orderId, direction, currentGameDay)
      );
    },
    []
  );

  const unreadOffersCount = countUnreadOffers(economyState);
  const isNightMode = allCouriersAtBase && gameSpeed !== 0 && isNightHoursForTime(gameMinutes);

  const nextDayMorningMinutes = useMemo(
    () => getNextDayMorningMinutes(gameMinutes),
    [gameMinutes]
  );

  const nextScheduledOrderMinutes = useMemo(
    () => findNextScheduledOrderDayMinutes(economyState, gameMinutes),
    [economyState, gameMinutes]
  );

  const baseDepot = useMemo(
    () => buildBaseDepotSpec(economyState.warehouseTier, economyState.parkingSpots),
    [economyState.warehouseTier, economyState.parkingSpots]
  );

  const mapBuildings = useMemo(
    () => applyWarehouseTierToBuildings(PROCEDURAL_BUILDINGS, economyState.warehouseTier),
    [economyState.warehouseTier]
  );

  return (
    <main className="relative w-full h-full overflow-hidden">
      <MapCanvas
        graph={INITIAL_ROAD_GRAPH}
        buildings={mapBuildings}
        baseDepot={baseDepot}
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        gameSpeed={gameSpeed}
        interactionBlocked={ordersOpen || skipTimeOpen}
        controllerRef={canvasControllerRef}
      />

      <Toolbar
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        balance={economyState.balance}
        gameMinutes={gameMinutes}
        gameSpeed={gameSpeed}
        isNightMode={isNightMode}
        ordersOpen={ordersOpen}
        unreadOffersCount={unreadOffersCount}
        onToggleGrid={handleToggleGrid}
        onToggleFootprintOnly={handleToggleFootprintOnly}
        onToggleStreetNames={handleToggleStreetNames}
        onChangeGameSpeed={handleChangeGameSpeed}
        onOpenSkipTime={handleOpenSkipTime}
        onOpenOrders={handleOpenOrders}
      />

      <OrdersModal
        isOpen={ordersOpen}
        economyState={economyState}
        gameMinutes={gameMinutes}
        onClose={handleCloseOrders}
        onMarkOffersSeen={handleMarkOffersSeen}
        onAcceptOffer={handleAcceptOffer}
        onRejectOffer={handleRejectOffer}
        onMoveWeeklyTaskPriority={handleMoveWeeklyTaskPriority}
      />

      <SkipTimeModal
        isOpen={skipTimeOpen}
        nextDayMorningMinutes={nextDayMorningMinutes}
        nextScheduledOrderMinutes={nextScheduledOrderMinutes}
        onClose={handleCloseSkipTime}
        onSkipDay={handleSkipOneDay}
        onSkipToNextOrder={handleSkipToNextOrder}
      />
    </main>
  );
}

export default App;
