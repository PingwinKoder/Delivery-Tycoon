import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_ROAD_GRAPH } from './data/initialRoadGraph';
import { CompanyModal } from './components/CompanyModal';
import { MapCanvas, type MapCanvasController } from './components/MapCanvas';
import { OrdersModal } from './components/OrdersModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SkipTimeModal } from './components/SkipTimeModal';
import { Toolbar } from './components/Toolbar';
import {
  PROCEDURAL_BUILDINGS,
  applyWarehouseTierToBuildings,
} from './utils/buildings';
import { buildBaseDepotSpec } from './utils/cityMap';
import type {
  ActiveVehicleSelection,
  OrderEconomyState,
  WarehouseLoadedBatch,
} from './types/orders';
import {
  type GameSpeed,
  INITIAL_GAME_MINUTES,
  MINUTES_PER_DAY,
  NIGHT_MODE_SPEED,
  WORKDAY_START_MINUTES,
  getCalendarDateFromGameDay,
  getGameMinutesPerRealSecond,
} from './utils/gameClock';
import {
  acceptOrderOffer,
  advanceOrderEconomy,
  assignCourierVehicle,
  countUnreadOffers,
  createInitialOrderEconomyState,
  findNextScheduledOrderDayMinutes,
  fireCourierInSlot,
  getFreeWarehouseCapacity,
  getNextDayMorningMinutes,
  getRemainingPickupPackagesForOrderToday,
  getVehicleCourierCapacity,
  hasEconomyBoundaryBetween,
  hireCourierInSlot,
  isNightHoursForTime,
  loadPackagesFromWarehouseForBike,
  markAllPendingOffersSeen,
  moveWeeklyTaskPriority,
  purchaseBicycle,
  purchaseEmployeeLicense,
  purchaseParkingSpot,
  purchaseUsedVan,
  purchaseWarehouseUpgrade,
  recordPackageDelivery,
  recordPackagePickup,
  rejectOrderOffer,
  returnPackagesToWarehouse,
  setOwnerActiveVehicle,
} from './utils/orderEconomy';

const MAX_CLOCK_REAL_DT = 0.1;

const devModules = import.meta.glob('./devVanTest.ts', { eager: true }) as Record<
  string,
  {
    DEV_VAN_OVERRIDE?: {
      parkingSpots: number;
      vansCount: number;
      activeVehicle: { type: 'bike' | 'van'; index: number };
    };
  }
>;
const devOverride = Object.values(devModules)[0]?.DEV_VAN_OVERRIDE;

export function App() {
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [footprintOnly, setFootprintOnly] = useState<boolean>(false);
  const [showStreetNames, setShowStreetNames] = useState<boolean>(true);
  const [economyState, setEconomyState] = useState<OrderEconomyState>(() => {
    const initial = createInitialOrderEconomyState(PROCEDURAL_BUILDINGS);
    if (!devOverride) return initial;
    return {
      ...initial,
      parkingSpots: devOverride.parkingSpots,
      vansCount: devOverride.vansCount,
      deliveryVansCount: devOverride.vansCount,
      activeVehicle: devOverride.activeVehicle,
      couriers: initial.couriers.map((c) =>
        c.slotIndex === 1 ? { ...c, assignedVehicle: { ...devOverride.activeVehicle } } : c
      ),
    };
  });
  const [gameMinutes, setGameMinutes] = useState<number>(INITIAL_GAME_MINUTES);
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>(1);
  // Tracks whether all couriers are currently parked at Base (required for automatic 15x Night Mode)
  const [allCouriersAtBase, setAllCouriersAtBase] = useState<boolean>(true);
  const [ordersOpen, setOrdersOpen] = useState<boolean>(false);
  const [companyOpen, setCompanyOpen] = useState<boolean>(false);
  const [skipTimeOpen, setSkipTimeOpen] = useState<boolean>(false);
  const [fps, setFps] = useState<number | null>(null);

  const canvasControllerRef = useRef<MapCanvasController | null>(null);
  const economyStateRef = useRef<OrderEconomyState>(economyState);
  const exactGameMinutesRef = useRef<number>(INITIAL_GAME_MINUTES);
  const lastEconomyCheckMinutesRef = useRef<number>(INITIAL_GAME_MINUTES);
  const allCouriersAtBaseRef = useRef<boolean>(allCouriersAtBase);

  const applyEconomyUpdate = useCallback(
    (updater: (prev: OrderEconomyState) => OrderEconomyState): OrderEconomyState => {
      const next = updater(economyStateRef.current);
      if (next !== economyStateRef.current) {
        economyStateRef.current = next;
        setEconomyState(next);
      }
      return next;
    },
    []
  );

  const handleCourierAtBaseChange = useCallback((atBase: boolean) => {
    allCouriersAtBaseRef.current = atBase;
    setAllCouriersAtBase(atBase);
  }, []);

  // Advance world clock smoothly:
  // - Pause (0x) always stops time completely
  // - Daytime runs at user's chosen speed (1x/2x/4x -> 2/4/8 in-game min/s)
  // - Night hours (from seasonal closing time until 08:00) auto-switch to 15x when allCouriersAtBase is true
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

      // When waking up from 15x Night Mode at 08:00, snap cleanly to 08:00 so player speed resumes accurately
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
          applyEconomyUpdate((prev) =>
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
  }, [gameSpeed, applyEconomyUpdate]);

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
    setCompanyOpen(false);
    setOrdersOpen(true);
  }, []);

  const handleCloseOrders = useCallback(() => {
    setOrdersOpen(false);
  }, []);

  const handleOpenCompany = useCallback(() => {
    setOrdersOpen(false);
    setSkipTimeOpen(false);
    setCompanyOpen(true);
  }, []);

  const handleCloseCompany = useCallback(() => {
    setCompanyOpen(false);
  }, []);

  const handleOpenSkipTime = useCallback(() => {
    setOrdersOpen(false);
    setCompanyOpen(false);
    setSkipTimeOpen(true);
  }, []);

  const handleCloseSkipTime = useCallback(() => {
    setSkipTimeOpen(false);
  }, []);

  const handleLoadFromWarehouse = useCallback(
    (
      orderId?: string,
      priorityOrderIds?: readonly string[],
      capacityOverride?: number
    ): WarehouseLoadedBatch[] => {
      let loaded: WarehouseLoadedBatch[] = [];
      applyEconomyUpdate((prev) => {
        const vehicleCapacity =
          capacityOverride ?? getVehicleCourierCapacity(prev.activeVehicle?.type ?? 'bike');
        const res = loadPackagesFromWarehouseForBike(
          prev,
          orderId,
          vehicleCapacity,
          priorityOrderIds
        );
        loaded = res.loadedPackages;
        return res.state;
      });
      return loaded;
    },
    [applyEconomyUpdate]
  );

  const handlePickupPackagesLoaded = useCallback(
    (
      orderId: string,
      requestedCount: number,
      currentGameDay: number,
      capacityOverride?: number
    ): number => {
      let actualCount = 0;
      applyEconomyUpdate((prev) => {
        const order = prev.activeOrders.find((o) => o.id === orderId && o.status === 'active');
        if (!order) return prev;
        const date = getCalendarDateFromGameDay(currentGameDay);
        const remainingToday = getRemainingPickupPackagesForOrderToday(
          prev,
          order,
          date.dayIndex,
          currentGameDay
        );
        const freeSpace = getFreeWarehouseCapacity(prev);
        const vehicleCapacity =
          capacityOverride ?? getVehicleCourierCapacity(prev.activeVehicle?.type ?? 'bike');
        actualCount = Math.min(
          Math.max(0, requestedCount),
          vehicleCapacity,
          remainingToday,
          freeSpace
        );
        if (actualCount <= 0) return prev;
        return recordPackagePickup(prev, orderId, actualCount, currentGameDay);
      });
      return actualCount;
    },
    [applyEconomyUpdate]
  );

  const handleDeliverPackages = useCallback(
    (items: readonly WarehouseLoadedBatch[], currentGameMinutes: number) => {
      if (items.length === 0) return;
      applyEconomyUpdate((prev) => {
        let current = prev;
        for (const item of items) {
          if (item.count <= 0) continue;
          current = recordPackageDelivery(current, item.orderId, item.count, currentGameMinutes);
        }
        return current;
      });
    },
    [applyEconomyUpdate]
  );

  const handleReturnCargoToWarehouse = useCallback(
    (cargo: readonly WarehouseLoadedBatch[]) => {
      if (cargo.length === 0) return;
      applyEconomyUpdate((prev) => returnPackagesToWarehouse(prev, cargo));
    },
    [applyEconomyUpdate]
  );

  const jumpWorldClockTo = useCallback(
    (targetMinutes: number) => {
      // Recall courier back to Base and secure any carried packages in Base warehouse before skipping time
      const recoveredCargo = canvasControllerRef.current?.recallCourierToBase() ?? [];
      handleCourierAtBaseChange(true);

      const safeTarget = Math.max(
        Math.floor(exactGameMinutesRef.current),
        Math.floor(targetMinutes)
      );
      exactGameMinutesRef.current = safeTarget;
      lastEconomyCheckMinutesRef.current = safeTarget;
      setGameMinutes(safeTarget);

      applyEconomyUpdate((prev) => {
        const withRecoveredCargo =
          recoveredCargo.length > 0 ? returnPackagesToWarehouse(prev, recoveredCargo) : prev;
        return advanceOrderEconomy(withRecoveredCargo, safeTarget, PROCEDURAL_BUILDINGS);
      });
      setSkipTimeOpen(false);
    },
    [applyEconomyUpdate, handleCourierAtBaseChange]
  );

  const handleSkipOneDay = useCallback(() => {
    const target = getNextDayMorningMinutes(exactGameMinutesRef.current);
    jumpWorldClockTo(target);
  }, [jumpWorldClockTo]);

  const handleSkipToNextOrder = useCallback(() => {
    const target = findNextScheduledOrderDayMinutes(
      economyStateRef.current,
      exactGameMinutesRef.current
    );
    if (target !== null) {
      jumpWorldClockTo(target);
    }
  }, [jumpWorldClockTo]);

  const handleMarkOffersSeen = useCallback(() => {
    applyEconomyUpdate((prev) => markAllPendingOffersSeen(prev));
  }, [applyEconomyUpdate]);

  const handleAcceptOffer = useCallback(
    (offerId: string) => {
      const nowMinutes = Math.floor(exactGameMinutesRef.current);
      applyEconomyUpdate((prev) => acceptOrderOffer(prev, offerId, nowMinutes));
    },
    [applyEconomyUpdate]
  );

  const handleRejectOffer = useCallback(
    (offerId: string) => {
      applyEconomyUpdate((prev) => rejectOrderOffer(prev, offerId));
    },
    [applyEconomyUpdate]
  );

  const handleMoveWeeklyTaskPriority = useCallback(
    (weekdayIndex: number, taskId: string, direction: 'up' | 'down') => {
      const currentGameDay = Math.floor(exactGameMinutesRef.current / MINUTES_PER_DAY) + 1;
      applyEconomyUpdate((prev) =>
        moveWeeklyTaskPriority(prev, weekdayIndex, taskId, direction, currentGameDay)
      );
    },
    [applyEconomyUpdate]
  );

  const handleUpgradeWarehouse = useCallback(() => {
    applyEconomyUpdate((prev) => purchaseWarehouseUpgrade(prev).state);
  }, [applyEconomyUpdate]);

  const handleBuyParkingSpot = useCallback(() => {
    applyEconomyUpdate((prev) => purchaseParkingSpot(prev).state);
  }, [applyEconomyUpdate]);

  const handleBuyBicycle = useCallback(() => {
    applyEconomyUpdate((prev) => purchaseBicycle(prev).state);
  }, [applyEconomyUpdate]);

  const handleBuyUsedVan = useCallback(() => {
    applyEconomyUpdate((prev) => purchaseUsedVan(prev).state);
  }, [applyEconomyUpdate]);

  const handleSelectActiveVehicle = useCallback(
    (vehicle: ActiveVehicleSelection) => {
      if (!allCouriersAtBaseRef.current) return;
      applyEconomyUpdate((prev) => setOwnerActiveVehicle(prev, vehicle));
    },
    [applyEconomyUpdate]
  );

  const handleBuyEmployeeLicense = useCallback(() => {
    applyEconomyUpdate((prev) => purchaseEmployeeLicense(prev).state);
  }, [applyEconomyUpdate]);

  const handleHireCourier = useCallback(
    (slotIndex: number) => {
      const currentGameDay = Math.floor(exactGameMinutesRef.current / MINUTES_PER_DAY) + 1;
      applyEconomyUpdate((prev) => hireCourierInSlot(prev, slotIndex, currentGameDay).state);
    },
    [applyEconomyUpdate]
  );

  const handleFireCourier = useCallback(
    (slotIndex: number) => {
      if (slotIndex === 1 && !allCouriersAtBaseRef.current) return;
      applyEconomyUpdate((prev) => fireCourierInSlot(prev, slotIndex).state);
    },
    [applyEconomyUpdate]
  );

  const handleAssignCourierVehicle = useCallback(
    (slotIndex: number, vehicle: ActiveVehicleSelection | null) => {
      if (slotIndex === 1 && !allCouriersAtBaseRef.current) return;
      applyEconomyUpdate((prev) => assignCourierVehicle(prev, slotIndex, vehicle));
    },
    [applyEconomyUpdate]
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

  const activeWarehouseLevel = economyState.warehouseLevel ?? economyState.warehouseTier;
  const activeBikesCount = economyState.bikesCount ?? economyState.bicyclesCount;
  const activeVansCount = economyState.vansCount ?? economyState.deliveryVansCount ?? 0;
  const ownerActiveVehicle = economyState.activeVehicle ?? { type: 'bike' as const, index: 1 };

  const baseDepot = useMemo(
    () => buildBaseDepotSpec(activeWarehouseLevel, economyState.parkingSpots),
    [activeWarehouseLevel, economyState.parkingSpots]
  );

  const mapBuildings = useMemo(
    () => applyWarehouseTierToBuildings(PROCEDURAL_BUILDINGS, activeWarehouseLevel),
    [activeWarehouseLevel]
  );

  return (
    <main className="relative w-full h-full overflow-hidden">
      <MapCanvas
        graph={INITIAL_ROAD_GRAPH}
        buildings={mapBuildings}
        baseDepot={baseDepot}
        bikesCount={activeBikesCount}
        vansCount={activeVansCount}
        activeVehicle={ownerActiveVehicle}
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        gameSpeed={gameSpeed}
        gameMinutesRef={exactGameMinutesRef}
        economyStateRef={economyStateRef}
        interactionBlocked={ordersOpen || skipTimeOpen || companyOpen}
        onFpsChange={setFps}
        onCourierAtBaseChange={handleCourierAtBaseChange}
        onLoadFromWarehouse={handleLoadFromWarehouse}
        onPickupPackagesLoaded={handlePickupPackagesLoaded}
        onDeliverPackages={handleDeliverPackages}
        onReturnCargoToWarehouse={handleReturnCargoToWarehouse}
        controllerRef={canvasControllerRef}
      />

      {/* Compact, discreet FPS counter in top-right corner (cleanly below "Zlecenia" + "Firma" column) */}
      <div
        aria-label={fps !== null ? `Wydajność: ${fps} klatek na sekundę` : 'Pomiar FPS'}
        className="fixed right-2 sm:right-3 [@media(max-height:540px)]:right-1.5 top-[152px] sm:top-[160px] [@media(max-height:540px)]:top-[122px] min-[1360px]:top-[116px] z-20 pointer-events-none select-none px-2 py-0.5 rounded-md bg-slate-900/95 border border-slate-700/80 shadow-sm text-[11px] font-semibold font-mono-nums leading-tight flex items-center gap-1"
      >
        <span
          className={
            fps === null
              ? 'text-slate-400'
              : fps >= 50
                ? 'text-emerald-400'
                : fps >= 30
                  ? 'text-amber-400'
                  : 'text-rose-400'
          }
        >
          {fps ?? '--'}
        </span>
        <span className="text-slate-400 text-[10px]">FPS</span>
      </div>

      <Toolbar
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        balance={economyState.balance}
        gameMinutes={gameMinutes}
        gameSpeed={gameSpeed}
        isNightMode={isNightMode}
        ordersOpen={ordersOpen}
        companyOpen={companyOpen}
        unreadOffersCount={unreadOffersCount}
        onToggleGrid={handleToggleGrid}
        onToggleFootprintOnly={handleToggleFootprintOnly}
        onToggleStreetNames={handleToggleStreetNames}
        onChangeGameSpeed={handleChangeGameSpeed}
        onOpenSkipTime={handleOpenSkipTime}
        onOpenOrders={handleOpenOrders}
        onOpenCompany={handleOpenCompany}
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

      <CompanyModal
        isOpen={companyOpen}
        economyState={economyState}
        isOwnerAtBase={allCouriersAtBase}
        courierAtBaseBySlot={{
          1: allCouriersAtBase,
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
        }}
        onClose={handleCloseCompany}
        onUpgradeWarehouse={handleUpgradeWarehouse}
        onBuyParkingSpot={handleBuyParkingSpot}
        onBuyBicycle={handleBuyBicycle}
        onBuyUsedVan={handleBuyUsedVan}
        onSelectActiveVehicle={handleSelectActiveVehicle}
        onBuyEmployeeLicense={handleBuyEmployeeLicense}
        onHireCourier={handleHireCourier}
        onFireCourier={handleFireCourier}
        onAssignCourierVehicle={handleAssignCourierVehicle}
      />

      <SkipTimeModal
        isOpen={skipTimeOpen}
        nextDayMorningMinutes={nextDayMorningMinutes}
        nextScheduledOrderMinutes={nextScheduledOrderMinutes}
        onClose={handleCloseSkipTime}
        onSkipDay={handleSkipOneDay}
        onSkipToNextOrder={handleSkipToNextOrder}
      />

      <PWAInstallButton />
    </main>
  );
}

export default App;
