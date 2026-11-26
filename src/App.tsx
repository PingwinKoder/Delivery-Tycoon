import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_ROAD_GRAPH } from './data/initialRoadGraph';
import { CompanyModal } from './components/CompanyModal';
import { MapCanvas, type MapCanvasController } from './components/MapCanvas';
import { OrdersModal } from './components/OrdersModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SettingsModal, type SettingsOpenedFrom } from './components/SettingsModal';
import { SkipTimeModal } from './components/SkipTimeModal';
import { StartScreenModal } from './components/StartScreenModal';
import { Toolbar } from './components/Toolbar';
import { t } from './i18n/translations';
import {
  PROCEDURAL_BUILDINGS,
  applyWarehouseTierToBuildings,
} from './utils/buildings';
import { buildBaseDepotSpec } from './utils/cityMap';
import type { CourierFleetStatusSnapshot } from './utils/courierSim';
import type {
  ActiveVehicleSelection,
  CompanyCourier,
  CourierQualification,
  OrderEconomyState,
  VanModelId,
  WarehouseLoadedBatch,
  WeeklyScheduleTask,
  WeeklyTaskSortMode,
} from './types/orders';
import {
  DAYS_PER_WEEK,
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
  applyVehicleWearBatch,
  assignCourierVehicle,
  completeVehicleRepair,
  countUnreadOffers,
  createInitialOrderEconomyState,
  findNextScheduledOrderDayMinutes,
  fireCourierInSlot,
  getFreeWarehouseCapacity,
  getNextDayMorningMinutes,
  getRemainingPickupPackagesForOrderToday,
  getScheduledTasksForWeekday,
  getVehicleCourierCapacityForSelection,
  getWarehouseTierConfig,
  hasEconomyBoundaryBetween,
  hireCourierInSlot,
  isNightHoursForTime,
  loadPackagesFromWarehouseForBike,
  markAllPendingOffersSeen,
  moveWeeklyTaskPriority,
  promoteCourierInSlot,
  purchaseBicycle,
  purchaseEmployeeLicense,
  purchaseParkingSpot,
  purchaseVan,
  purchaseWarehouseUpgrade,
  recordPackageDelivery,
  recordPackagePickup,
  rejectOrderOffer,
  requestVehicleRepair,
  returnPackagesToWarehouse,
  setOwnerActiveVehicle,
  sortWeeklyTasksPriority,
  unloadPackagesToWarehouse,
} from './utils/orderEconomy';
import {
  type SaveSlotEntry,
  type SaveSlotId,
  type SavedGameState,
  createSavedGameState,
  deleteSaveSlot,
  getAllSaveSlots,
  loadGameFromSlot,
  saveGameToSlot,
} from './utils/saveSystem';
import {
  type GameSettings,
  isMobileTouchDevice,
  loadGameSettings,
  requestMobileFullscreen,
  saveGameSettings,
} from './utils/settingsSystem';

const MAX_CLOCK_REAL_DT = 0.1;

const INITIAL_COURIER_AT_BASE_BY_SLOT: Record<number, boolean> = {
  1: true,
  2: true,
  3: true,
  4: true,
  5: true,
  6: true,
};

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

function createNewCareerEconomyState(): OrderEconomyState {
  const initial = createInitialOrderEconomyState(PROCEDURAL_BUILDINGS);
  if (!devOverride) return initial;
  return {
    ...initial,
    parkingSpots: devOverride.parkingSpots,
    vansCount: devOverride.vansCount,
    deliveryVansCount: devOverride.vansCount,
    activeVehicle: { ...devOverride.activeVehicle },
    couriers: initial.couriers.map((c) =>
      c.slotIndex === 1 ? { ...c, assignedVehicle: { ...devOverride.activeVehicle } } : c
    ),
  };
}

/**
 * Produces a consistent economy state snapshot where any packages currently in transit on
 * courier vehicles are safely placed back into Base warehouse up to its capacity, and any
 * overflow beyond warehouse capacity is returned to the respective active order's pending
 * pickup pool so no package is ever lost or overflows the warehouse after reloading.
 */
function buildConsistentEconomyForSave(
  state: OrderEconomyState,
  inFlightCargo: readonly WarehouseLoadedBatch[]
): OrderEconomyState {
  if (inFlightCargo.length === 0) return state;

  let current = state;
  const overflowByOrder = new Map<string, number>();

  for (const batch of inFlightCargo) {
    if (batch.count <= 0) continue;
    const isActive = current.activeOrders.some(
      (o) => o.id === batch.orderId && o.status === 'active'
    );
    if (!isActive) continue;

    const unloaded = unloadPackagesToWarehouse(current, batch.orderId, batch.count);
    current = unloaded.state;
    if (unloaded.overflowCount > 0) {
      overflowByOrder.set(
        batch.orderId,
        (overflowByOrder.get(batch.orderId) ?? 0) + unloaded.overflowCount
      );
    }
  }

  if (overflowByOrder.size === 0) {
    return current;
  }

  return {
    ...current,
    activeOrders: current.activeOrders.map((order) => {
      const overflow = overflowByOrder.get(order.id) ?? 0;
      if (overflow <= 0 || order.status !== 'active') return order;

      const stored = current.warehouseInventory[order.id] ?? 0;
      const minPickedTotal = order.deliveredPackagesTotal + stored;
      const nextPickedTotal = Math.max(
        minPickedTotal,
        (order.pickedUpPackagesTotal ?? 0) - overflow
      );
      const nextPickedThisWeek = Math.max(
        order.weekly.deliveredPackagesThisWeek,
        order.weekly.pickedUpPackagesThisWeek - overflow
      );
      const nextPickedOnLastDay =
        typeof order.weekly.pickedUpOnLastPickupDay === 'number'
          ? Math.max(0, order.weekly.pickedUpOnLastPickupDay - overflow)
          : order.weekly.pickedUpOnLastPickupDay;

      return {
        ...order,
        pickedUpPackagesTotal: nextPickedTotal,
        weekly: {
          ...order.weekly,
          pickedUpPackagesThisWeek: nextPickedThisWeek,
          pickedUpOnLastPickupDay: nextPickedOnLastDay,
        },
      };
    }),
  };
}

function buildWeeklyPlanSnapshot(
  ecoState: OrderEconomyState,
  currentMinutes: number
): Record<number, WeeklyScheduleTask[]> {
  const gameDay = Math.floor(Math.max(0, currentMinutes) / MINUTES_PER_DAY) + 1;
  const plan: Record<number, WeeklyScheduleTask[]> = {};
  for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
    plan[wd] = getScheduledTasksForWeekday(ecoState, wd, gameDay).map(
      ({ assignedCourierId: _dropped, ...task }) => task
    );
  }
  return plan;
}

function restoreEconomyStateFromSavedEntry(saved: SavedGameState): OrderEconomyState {
  const base = saved.economyState
    ? saved.economyState
    : createInitialOrderEconomyState(PROCEDURAL_BUILDINGS);

  const warehouseLevel = saved.warehouseLevel;
  const warehouseConfig = getWarehouseTierConfig(warehouseLevel);
  const cleanCouriers: CompanyCourier[] =
    saved.couriers.length > 0
      ? saved.couriers.map(({ inRoute: _inRoute, ...courier }) => ({
        ...courier,
        assignedVehicle: courier.assignedVehicle ? { ...courier.assignedVehicle } : null,
      }))
      : base.couriers;

  const unlockedCount = Math.max(1, cleanCouriers.filter((c) => c.unlocked).length);

  let weeklyPriorityOrder = base.weeklyPriorityOrder;
  if (!saved.economyState && saved.weeklyPlan) {
    const derived: Record<number, string[]> = {};
    for (let wd = 0; wd < DAYS_PER_WEEK; wd++) {
      const tasks = saved.weeklyPlan[wd] ?? [];
      derived[wd] = tasks.map((t) => t.taskId);
    }
    weeklyPriorityOrder = derived;
  }

  // Clamp restored warehouse inventory against warehouse capacity in case an older save overflowed
  const clampedInventory: Record<string, number> = {};
  const overflowBatches: WarehouseLoadedBatch[] = [];
  let storedTotal = 0;
  for (const [orderId, rawCount] of Object.entries(saved.warehouseInventory)) {
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (count <= 0) continue;
    const room = Math.max(0, warehouseConfig.capacity - storedTotal);
    const keep = Math.min(count, room);
    if (keep > 0) {
      clampedInventory[orderId] = keep;
      storedTotal += keep;
    }
    const overflow = count - keep;
    if (overflow > 0) {
      overflowBatches.push({ orderId, count: overflow });
    }
  }

  const restoredBase: OrderEconomyState = {
    ...base,
    balance: saved.cash,
    completedOrdersCount: saved.completedOrdersCount,
    annualSatisfactionAvg: saved.annualSatisfactionAvg,
    reputationLevel: saved.reputationLevel,
    warehouseLevel,
    warehouseTier: warehouseLevel,
    warehouseCapacity: warehouseConfig.capacity,
    warehousePackages: storedTotal,
    warehouseInventory: clampedInventory,
    parkingSpots: saved.parkingSpots,
    maxEmployees: Math.max(base.maxEmployees, unlockedCount),
    couriers: cleanCouriers,
    bikesCount: saved.bikesCount,
    bicyclesCount: saved.bikesCount,
    vansCount: saved.vansCount,
    deliveryVansCount: saved.vansCount,
    activeVehicle: { ...saved.activeVehicle },
    pendingOffers: saved.offeredOrders,
    activeOrders: saved.activeOrders,
    weeklyPriorityOrder,
    lastProcessedMinutes: saved.gameMinutes,
  };

  // Reconcile any residual overflow or legacy inTransitCargo safely without exceeding warehouse capacity
  const residualCargo: WarehouseLoadedBatch[] = [
    ...overflowBatches,
    ...(saved.inTransitCargo ?? []),
  ];
  return residualCargo.length > 0
    ? buildConsistentEconomyForSave(restoredBase, residualCargo)
    : restoredBase;
}

export function App() {
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [footprintOnly, setFootprintOnly] = useState<boolean>(false);
  const [showStreetNames, setShowStreetNames] = useState<boolean>(true);
  const [economyState, setEconomyState] = useState<OrderEconomyState>(() =>
    createInitialOrderEconomyState(PROCEDURAL_BUILDINGS)
  );
  const [gameMinutes, setGameMinutes] = useState<number>(INITIAL_GAME_MINUTES);
  // Start paused while StartScreenModal is shown over the map
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>(0);
  const [saveSlots, setSaveSlots] = useState<Record<SaveSlotId, SaveSlotEntry | null>>(() =>
    getAllSaveSlots()
  );
  const [activeSlotId, setActiveSlotId] = useState<SaveSlotId | null>(null);
  const [startScreenOpen, setStartScreenOpen] = useState<boolean>(true);
  const [startScreenMounted, setStartScreenMounted] = useState<boolean>(true);
  const [inStartPanorama, setInStartPanorama] = useState<boolean>(true);
  const [cameraTransition, setCameraTransition] = useState<'to-game' | 'to-menu' | null>(null);
  const [hudVisible, setHudVisible] = useState<boolean>(false);
  const [mapReady, setMapReady] = useState<boolean>(false);
  const [startDataReady, setStartDataReady] = useState<boolean>(false);
  const [sessionEpoch, setSessionEpoch] = useState<number>(0);

  const [settings, setSettings] = useState<GameSettings>(() => loadGameSettings());
  const [isMobileDevice, setIsMobileDevice] = useState<boolean>(() => isMobileTouchDevice());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsOpenedFrom, setSettingsOpenedFrom] = useState<SettingsOpenedFrom>('start');
  const [exitConfirmOpen, setExitConfirmOpen] = useState<boolean>(false);

  // Tracks per-slot courier Base presence (#1–#6) and live Plan tygodnia task assignments
  const [courierAtBaseBySlot, setCourierAtBaseBySlot] = useState<Record<number, boolean>>(
    INITIAL_COURIER_AT_BASE_BY_SLOT
  );
  const [taskAssignmentsByTaskId, setTaskAssignmentsByTaskId] = useState<Record<string, number>>(
    {}
  );
  // Tracks whether ALL couriers are currently parked at Base (required for automatic 15x Night Mode)
  const [allCouriersAtBase, setAllCouriersAtBase] = useState<boolean>(true);
  const [ordersOpen, setOrdersOpen] = useState<boolean>(false);
  const [companyOpen, setCompanyOpen] = useState<boolean>(false);
  const [skipTimeOpen, setSkipTimeOpen] = useState<boolean>(false);
  const [fps, setFps] = useState<number | null>(null);

  const canvasControllerRef = useRef<MapCanvasController | null>(null);
  const economyStateRef = useRef<OrderEconomyState>(economyState);
  const exactGameMinutesRef = useRef<number>(INITIAL_GAME_MINUTES);
  const lastEconomyCheckMinutesRef = useRef<number>(INITIAL_GAME_MINUTES);
  const courierAtBaseBySlotRef = useRef<Record<number, boolean>>(courierAtBaseBySlot);
  const allCouriersAtBaseRef = useRef<boolean>(allCouriersAtBase);
  const activeSlotIdRef = useRef<SaveSlotId | null>(activeSlotId);
  const lastSavedCompletedOrdersRef = useRef<number>(economyState.completedOrdersCount);
  const lastAutoSavedMorningDayRef = useRef<number>(1);
  const introRafIdsRef = useRef<number[]>([]);
  const outroSaveTimerRef = useRef<number | null>(null);

  const clearIntroRafs = useCallback(() => {
    for (const rafId of introRafIdsRef.current) {
      window.cancelAnimationFrame(rafId);
    }
    introRafIdsRef.current = [];
    if (outroSaveTimerRef.current !== null) {
      window.clearTimeout(outroSaveTimerRef.current);
      outroSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearIntroRafs();
    };
  }, [clearIntroRafs]);

  const scheduleCinematicFlyInAfterPaint = useCallback(() => {
    clearIntroRafs();
    // Wait two animation frames so React commit, localStorage write, and first post-save paint
    // complete completely before starting the 2.5s camera fly-in, canvas fog dissipation, and HUD slide-in
    const raf1 = window.requestAnimationFrame(() => {
      const raf2 = window.requestAnimationFrame(() => {
        introRafIdsRef.current = [];
        canvasControllerRef.current?.beginArmedIntroFlyIn();
        setHudVisible(true);
      });
      introRafIdsRef.current = [raf2];
    });
    introRafIdsRef.current = [raf1];
  }, [clearIntroRafs]);

  const handleMapReady = useCallback(() => {
    setMapReady(true);
  }, []);

  // Ensure StartScreenModal save slots & settings are hydrated before dismissing the splash screen
  useEffect(() => {
    setSaveSlots(getAllSaveSlots());
    setSettings(loadGameSettings());
    setStartDataReady(true);
  }, []);

  // Keep mobile vs PC detection synced on resize / orientation change for FPS cap selection
  useEffect(() => {
    const handleResize = () => {
      setIsMobileDevice(isMobileTouchDevice());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Automatically enforce fullscreen mode on mobile devices upon user touch/pointer interaction
  useEffect(() => {
    const handleMobileInteraction = () => {
      if (isMobileTouchDevice()) {
        requestMobileFullscreen();
      }
    };

    window.addEventListener('pointerdown', handleMobileInteraction, { passive: true });
    window.addEventListener('touchend', handleMobileInteraction, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleMobileInteraction);
      window.removeEventListener('touchend', handleMobileInteraction);
    };
  }, []);

  // Keep the HTML splash screen visible until BOTH MapCanvas rendered its first full frame
  // AND StartScreenModal save slots / settings are hydrated
  useEffect(() => {
    if (!mapReady || !startDataReady) return;
    const splash = document.getElementById('app-splash');
    if (!splash) return;

    let removeTimer: number | null = null;
    const rafId = window.requestAnimationFrame(() => {
      splash.classList.add('is-hidden');
      removeTimer = window.setTimeout(() => {
        splash.remove();
      }, 440);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      if (removeTimer !== null) {
        window.clearTimeout(removeTimer);
      }
    };
  }, [mapReady, startDataReady]);

  const handleIntroFlyInComplete = useCallback(() => {
    setStartScreenMounted(false);
    setCameraTransition(null);
  }, []);

  const handleOutroFlyOutComplete = useCallback(() => {
    setInStartPanorama(true);
    setCameraTransition(null);
    setStartScreenMounted(true);
    clearIntroRafs();
    // Wait 1 animation frame after full canvas fog & modal mount at opacity 0 before fading in (250ms)
    const rafId = window.requestAnimationFrame(() => {
      introRafIdsRef.current = [];
      setStartScreenOpen(true);
    });
    introRafIdsRef.current = [rafId];
  }, [clearIntroRafs]);

  const handleUpdateSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings((prev) => saveGameSettings({ ...prev, ...patch }));
  }, []);

  const handleOpenSettingsFromStart = useCallback(() => {
    setSettingsOpenedFrom('start');
    setSettingsOpen(true);
  }, []);

  const handleOpenSettingsFromGame = useCallback(() => {
    setOrdersOpen(false);
    setCompanyOpen(false);
    setSkipTimeOpen(false);
    setExitConfirmOpen(false);
    setSettingsOpenedFrom('game');
    setSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleRequestExitToMenu = useCallback(() => {
    setSettingsOpen(false);
    setCompanyOpen(false);
    setOrdersOpen(false);
    setSkipTimeOpen(false);
    setExitConfirmOpen(true);
  }, []);

  const handleCancelExitToMenu = useCallback(() => {
    setExitConfirmOpen(false);
  }, []);

  // Escape dismisses the exit confirmation dialog
  useEffect(() => {
    if (!exitConfirmOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExitConfirmOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitConfirmOpen]);

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

  const persistGameToSlot = useCallback(
    (
      slotId: SaveSlotId,
      liveEconomy: OrderEconomyState,
      currentMinutes: number,
      inFlightCargoOverride?: readonly WarehouseLoadedBatch[]
    ) => {
      const inFlightCargo =
        inFlightCargoOverride ?? canvasControllerRef.current?.getInFlightCargo() ?? [];
      const consistentEconomy = buildConsistentEconomyForSave(liveEconomy, inFlightCargo);
      const weeklyPlan = buildWeeklyPlanSnapshot(consistentEconomy, currentMinutes);
      const savedPayload = createSavedGameState(consistentEconomy, currentMinutes, {
        inRouteBySlot: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
        weeklyPlan,
        inTransitCargo: [],
      });
      saveGameToSlot(slotId, savedPayload);
      setSaveSlots(getAllSaveSlots());
    },
    []
  );

  const handleCourierAtBaseChange = useCallback((atBase: boolean) => {
    allCouriersAtBaseRef.current = atBase;
    setAllCouriersAtBase(atBase);
  }, []);

  const handleCourierStatusChange = useCallback((status: CourierFleetStatusSnapshot) => {
    courierAtBaseBySlotRef.current = status.atBaseBySlot;
    allCouriersAtBaseRef.current = status.allAtBase;
    setCourierAtBaseBySlot(status.atBaseBySlot);
    setAllCouriersAtBase(status.allAtBase);
    setTaskAssignmentsByTaskId(status.taskAssignmentsByTaskId);
  }, []);

  const handleStartNewGame = useCallback(
    (slotId: SaveSlotId) => {
      // Lock panoramic camera framing before state updates so zero 1-frame jump occurs
      canvasControllerRef.current?.armIntroFlyIn();

      const freshEconomy = createNewCareerEconomyState();
      economyStateRef.current = freshEconomy;
      setEconomyState(freshEconomy);

      exactGameMinutesRef.current = INITIAL_GAME_MINUTES;
      lastEconomyCheckMinutesRef.current = INITIAL_GAME_MINUTES;
      setGameMinutes(INITIAL_GAME_MINUTES);

      // Reset all couriers safely at Base and clear any stale task claims
      handleCourierStatusChange({
        atBaseBySlot: INITIAL_COURIER_AT_BASE_BY_SLOT,
        allAtBase: true,
        taskAssignmentsByTaskId: {},
      });
      canvasControllerRef.current?.resetCouriersToBase(freshEconomy.couriers);
      setSessionEpoch((prev) => prev + 1);

      lastSavedCompletedOrdersRef.current = freshEconomy.completedOrdersCount;
      lastAutoSavedMorningDayRef.current = 1;

      activeSlotIdRef.current = slotId;
      setActiveSlotId(slotId);
      setOrdersOpen(false);
      setCompanyOpen(false);
      setSkipTimeOpen(false);
      setSettingsOpen(false);
      setExitConfirmOpen(false);
      setHudVisible(false);
      setInStartPanorama(false);
      setCameraTransition('to-game');
      setStartScreenOpen(false);
      setGameSpeed(1);

      // Auto-save trigger #1: persist starter state BEFORE starting the camera fly-in timer
      persistGameToSlot(slotId, freshEconomy, INITIAL_GAME_MINUTES, []);
      scheduleCinematicFlyInAfterPaint();
    },
    [handleCourierStatusChange, persistGameToSlot, scheduleCinematicFlyInAfterPaint]
  );

  const handleLoadGame = useCallback(
    (slotId: SaveSlotId) => {
      const entry = loadGameFromSlot(slotId);
      if (!entry) return;

      // Lock panoramic camera framing before state updates so zero 1-frame jump occurs
      canvasControllerRef.current?.armIntroFlyIn();

      const restoredEconomy = restoreEconomyStateFromSavedEntry(entry.state);
      const restoredMinutes = entry.state.gameMinutes;
      const loadedDay = Math.floor(restoredMinutes / MINUTES_PER_DAY) + 1;
      const minuteOfDay = restoredMinutes % MINUTES_PER_DAY;

      economyStateRef.current = restoredEconomy;
      setEconomyState(restoredEconomy);

      exactGameMinutesRef.current = restoredMinutes;
      lastEconomyCheckMinutesRef.current = restoredMinutes;
      setGameMinutes(restoredMinutes);

      // Reinitialize all couriers safely parked at Base (inRoute: false) with clean weeklyPlan claims
      handleCourierStatusChange({
        atBaseBySlot: INITIAL_COURIER_AT_BASE_BY_SLOT,
        allAtBase: true,
        taskAssignmentsByTaskId: {},
      });
      canvasControllerRef.current?.resetCouriersToBase(restoredEconomy.couriers);
      setSessionEpoch((prev) => prev + 1);

      lastSavedCompletedOrdersRef.current = restoredEconomy.completedOrdersCount;
      lastAutoSavedMorningDayRef.current =
        minuteOfDay >= WORKDAY_START_MINUTES ? loadedDay : Math.max(0, loadedDay - 1);

      activeSlotIdRef.current = slotId;
      setActiveSlotId(slotId);
      setOrdersOpen(false);
      setCompanyOpen(false);
      setSkipTimeOpen(false);
      setSettingsOpen(false);
      setExitConfirmOpen(false);
      setHudVisible(false);
      setInStartPanorama(false);
      setCameraTransition('to-game');
      setStartScreenOpen(false);
      setGameSpeed(1);

      scheduleCinematicFlyInAfterPaint();
    },
    [handleCourierStatusChange, scheduleCinematicFlyInAfterPaint]
  );

  const handleDeleteSaveSlot = useCallback((slotId: SaveSlotId) => {
    deleteSaveSlot(slotId);
    if (activeSlotIdRef.current === slotId) {
      activeSlotIdRef.current = null;
      setActiveSlotId(null);
    }
    setSaveSlots(getAllSaveSlots());
  }, []);

  const beginMirrorReturnToStartScreen = useCallback(
    (shouldSave: boolean) => {
      clearIntroRafs();

      // Step 1: Immediately pause simulation, lock current camera coordinates (no motion yet),
      // close all modals & hide HUD so the outro fly-out + fog animation starts without frame drops.
      canvasControllerRef.current?.armOutroFlyOut();
      setGameSpeed(0);
      setCompanyOpen(false);
      setOrdersOpen(false);
      setSkipTimeOpen(false);
      setSettingsOpen(false);
      setExitConfirmOpen(false);
      setHudVisible(false);
      setInStartPanorama(false);
      setStartScreenOpen(false);
      setStartScreenMounted(false);
      setCameraTransition('to-menu');

      // Step 2: Decouple animation start by two frames so modals unmount and HUD fades cleanly
      // before starting the synchronized canvas camera zoom-out & fog roll-in.
      const raf1 = window.requestAnimationFrame(() => {
        const raf2 = window.requestAnimationFrame(() => {
          introRafIdsRef.current = [];
          canvasControllerRef.current?.beginArmedOutroFlyOut();
        });
        introRafIdsRef.current = [raf2];
      });
      introRafIdsRef.current = [raf1];

      // Step 3: Delay localStorage JSON serialization by 120 ms so it never blocks animation startup.
      const slotId = activeSlotIdRef.current;
      const economySnapshot = economyStateRef.current;
      const minutesSnapshot = exactGameMinutesRef.current;
      outroSaveTimerRef.current = window.setTimeout(() => {
        outroSaveTimerRef.current = null;
        if (shouldSave && slotId !== null) {
          persistGameToSlot(slotId, economySnapshot, minutesSnapshot);
        } else {
          setSaveSlots(getAllSaveSlots());
        }
      }, 120);
    },
    [clearIntroRafs, persistGameToSlot]
  );

  const handleConfirmSaveAndExit = useCallback(() => {
    beginMirrorReturnToStartScreen(true);
  }, [beginMirrorReturnToStartScreen]);

  const handleConfirmExitWithoutSaving = useCallback(() => {
    beginMirrorReturnToStartScreen(false);
  }, [beginMirrorReturnToStartScreen]);

  // Auto-save trigger #2: save immediately whenever completedOrdersCount increases
  useEffect(() => {
    if (activeSlotId === null || startScreenOpen) return;
    const completed = economyState.completedOrdersCount;
    if (completed > lastSavedCompletedOrdersRef.current) {
      lastSavedCompletedOrdersRef.current = completed;
      persistGameToSlot(activeSlotId, economyStateRef.current, exactGameMinutesRef.current);
    }
  }, [economyState.completedOrdersCount, activeSlotId, startScreenOpen, persistGameToSlot]);

  // Auto-save trigger #3: save once each workday morning when game clock reaches 08:00 of a new day
  useEffect(() => {
    if (activeSlotId === null || startScreenOpen) return;
    const currentDay = Math.floor(gameMinutes / MINUTES_PER_DAY) + 1;
    const minuteOfDay = gameMinutes % MINUTES_PER_DAY;
    if (
      minuteOfDay >= WORKDAY_START_MINUTES &&
      currentDay > lastAutoSavedMorningDayRef.current
    ) {
      lastAutoSavedMorningDayRef.current = currentDay;
      persistGameToSlot(activeSlotId, economyStateRef.current, gameMinutes);
    }
  }, [gameMinutes, activeSlotId, startScreenOpen, persistGameToSlot]);

  // Advance world clock smoothly:
  // - Pause (0x), StartScreenModal, SettingsModal, or active camera fly-in stops clock updates
  //   (prevents React re-renders during the 1.2s intro fly-in)
  // - Daytime runs at user's chosen speed (1x/2x/4x -> 2/4/8 in-game min/s)
  // - Night hours (from seasonal closing time until 08:00) auto-switch to 15x when allCouriersAtBase is true
  const isPausedByOverlay =
    startScreenOpen ||
    inStartPanorama ||
    cameraTransition !== null ||
    settingsOpen ||
    exitConfirmOpen;

  useEffect(() => {
    if (isPausedByOverlay || gameSpeed === 0) return;

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
  }, [gameSpeed, isPausedByOverlay, applyEconomyUpdate]);

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
    setSettingsOpen(false);
    setOrdersOpen(true);
  }, []);

  const handleCloseOrders = useCallback(() => {
    setOrdersOpen(false);
  }, []);

  const handleOpenCompany = useCallback(() => {
    setOrdersOpen(false);
    setSkipTimeOpen(false);
    setSettingsOpen(false);
    setCompanyOpen(true);
  }, []);

  const handleCloseCompany = useCallback(() => {
    setCompanyOpen(false);
  }, []);

  const handleOpenSkipTime = useCallback(() => {
    setOrdersOpen(false);
    setCompanyOpen(false);
    setSettingsOpen(false);
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
          capacityOverride ?? getVehicleCourierCapacityForSelection(prev, prev.activeVehicle);
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
          capacityOverride ?? getVehicleCourierCapacityForSelection(prev, prev.activeVehicle);
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

  const handleApplyVehicleWearBatch = useCallback(
    (entries: ReadonlyArray<{ vehicle: ActiveVehicleSelection; distancePx: number }>) => {
      if (entries.length === 0) return;
      applyEconomyUpdate((prev) => applyVehicleWearBatch(prev, entries));
    },
    [applyEconomyUpdate]
  );

  const handleCompleteVehicleRepair = useCallback(
    (vehicle: ActiveVehicleSelection) => {
      applyEconomyUpdate((prev) => completeVehicleRepair(prev, vehicle));
    },
    [applyEconomyUpdate]
  );

  const jumpWorldClockTo = useCallback(
    (targetMinutes: number) => {
      // Recall all couriers back to Base and secure any carried packages in Base warehouse before skipping time
      const recoveredCargo = canvasControllerRef.current?.recallCourierToBase() ?? [];
      handleCourierStatusChange({
        atBaseBySlot: INITIAL_COURIER_AT_BASE_BY_SLOT,
        allAtBase: true,
        taskAssignmentsByTaskId: {},
      });

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
    [applyEconomyUpdate, handleCourierStatusChange]
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

  const handleSortWeeklyTasksPriority = useCallback(
    (weekdayIndex: number, sortMode: WeeklyTaskSortMode) => {
      const currentGameDay = Math.floor(exactGameMinutesRef.current / MINUTES_PER_DAY) + 1;
      applyEconomyUpdate((prev) =>
        sortWeeklyTasksPriority(prev, weekdayIndex, sortMode, currentGameDay)
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

  const handleBuyVan = useCallback(
    (modelId: VanModelId) => {
      applyEconomyUpdate((prev) => purchaseVan(prev, modelId).state);
    },
    [applyEconomyUpdate]
  );

  const handleRequestVehicleRepair = useCallback(
    (vehicle: ActiveVehicleSelection) => {
      const currentGameDay = Math.floor(exactGameMinutesRef.current / MINUTES_PER_DAY) + 1;
      applyEconomyUpdate((prev) => requestVehicleRepair(prev, vehicle, currentGameDay).state);
    },
    [applyEconomyUpdate]
  );

  const handleSelectActiveVehicle = useCallback(
    (vehicle: ActiveVehicleSelection) => {
      if (courierAtBaseBySlotRef.current[1] === false) return;
      applyEconomyUpdate((prev) => setOwnerActiveVehicle(prev, vehicle));
    },
    [applyEconomyUpdate]
  );

  const handleBuyEmployeeLicense = useCallback(() => {
    applyEconomyUpdate((prev) => purchaseEmployeeLicense(prev).state);
  }, [applyEconomyUpdate]);

  const handleHireCourier = useCallback(
    (slotIndex: number, qualification: CourierQualification) => {
      const currentGameDay = Math.floor(exactGameMinutesRef.current / MINUTES_PER_DAY) + 1;
      applyEconomyUpdate(
        (prev) => hireCourierInSlot(prev, slotIndex, qualification, currentGameDay).state
      );
    },
    [applyEconomyUpdate]
  );

  const handlePromoteCourier = useCallback(
    (slotIndex: number) => {
      applyEconomyUpdate((prev) => promoteCourierInSlot(prev, slotIndex).state);
    },
    [applyEconomyUpdate]
  );

  const handleFireCourier = useCallback(
    (slotIndex: number) => {
      if (courierAtBaseBySlotRef.current[slotIndex] === false) return;
      applyEconomyUpdate((prev) => fireCourierInSlot(prev, slotIndex).state);
    },
    [applyEconomyUpdate]
  );

  const handleAssignCourierVehicle = useCallback(
    (slotIndex: number, vehicle: ActiveVehicleSelection | null) => {
      if (courierAtBaseBySlotRef.current[slotIndex] === false) return;
      applyEconomyUpdate((prev) => assignCourierVehicle(prev, slotIndex, vehicle));
    },
    [applyEconomyUpdate]
  );

  const unreadOffersCount = startScreenOpen ? 0 : countUnreadOffers(economyState);
  const effectiveSimSpeed: GameSpeed = isPausedByOverlay ? 0 : gameSpeed;
  const isNightMode =
    !isPausedByOverlay && allCouriersAtBase && gameSpeed !== 0 && isNightHoursForTime(gameMinutes);

  const nextDayMorningMinutes = useMemo(
    () =>
      startScreenOpen || !skipTimeOpen
        ? INITIAL_GAME_MINUTES
        : getNextDayMorningMinutes(gameMinutes),
    [gameMinutes, startScreenOpen, skipTimeOpen]
  );

  const nextScheduledOrderMinutes = useMemo(
    () =>
      startScreenOpen || !skipTimeOpen
        ? null
        : findNextScheduledOrderDayMinutes(economyState, gameMinutes),
    [economyState, gameMinutes, startScreenOpen, skipTimeOpen]
  );

  const activeWarehouseLevel = economyState.warehouseLevel ?? economyState.warehouseTier;
  const activeBikesCount = economyState.bikesCount ?? economyState.bicyclesCount;
  const activeVansCount =
    economyState.vans?.length ?? economyState.vansCount ?? economyState.deliveryVansCount ?? 0;
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
    <main className="relative w-full h-[100dvh] overflow-hidden">
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
        gameSpeed={effectiveSimSpeed}
        gameMinutesRef={exactGameMinutesRef}
        economyStateRef={economyStateRef}
        overviewMode={inStartPanorama || startScreenOpen}
        interactionBlocked={
          startScreenOpen ||
          inStartPanorama ||
          cameraTransition !== null ||
          ordersOpen ||
          skipTimeOpen ||
          companyOpen ||
          settingsOpen ||
          exitConfirmOpen
        }
        sessionEpoch={sessionEpoch}
        maxFps={isMobileDevice ? settings.mobileMaxFps : settings.pcMaxFps}
        onFpsChange={setFps}
        onMapReady={handleMapReady}
        onIntroFlyInComplete={handleIntroFlyInComplete}
        onOutroFlyOutComplete={handleOutroFlyOutComplete}
        onCourierAtBaseChange={handleCourierAtBaseChange}
        onCourierStatusChange={handleCourierStatusChange}
        onLoadFromWarehouse={handleLoadFromWarehouse}
        onPickupPackagesLoaded={handlePickupPackagesLoaded}
        onDeliverPackages={handleDeliverPackages}
        onReturnCargoToWarehouse={handleReturnCargoToWarehouse}
        onApplyVehicleWearBatch={handleApplyVehicleWearBatch}
        onCompleteVehicleRepair={handleCompleteVehicleRepair}
        controllerRef={canvasControllerRef}
      />

      <Toolbar
        hudVisible={hudVisible}
        language={settings.language}
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        balance={economyState.balance}
        gameMinutes={gameMinutes}
        gameSpeed={effectiveSimSpeed}
        isNightMode={isNightMode}
        ordersOpen={ordersOpen}
        companyOpen={companyOpen}
        settingsOpen={settingsOpen}
        unreadOffersCount={unreadOffersCount}
        fps={fps}
        showFpsCounter={settings.showFpsCounter}
        onToggleGrid={handleToggleGrid}
        onToggleFootprintOnly={handleToggleFootprintOnly}
        onToggleStreetNames={handleToggleStreetNames}
        onChangeGameSpeed={handleChangeGameSpeed}
        onOpenSkipTime={handleOpenSkipTime}
        onOpenOrders={handleOpenOrders}
        onOpenCompany={handleOpenCompany}
        onOpenSettings={handleOpenSettingsFromGame}
      />

      {ordersOpen && (
        <OrdersModal
          isOpen={ordersOpen}
          language={settings.language}
          economyState={economyState}
          gameMinutes={gameMinutes}
          taskAssignmentsByTaskId={taskAssignmentsByTaskId}
          onClose={handleCloseOrders}
          onMarkOffersSeen={handleMarkOffersSeen}
          onAcceptOffer={handleAcceptOffer}
          onRejectOffer={handleRejectOffer}
          onMoveWeeklyTaskPriority={handleMoveWeeklyTaskPriority}
          onSortWeeklyTasksPriority={handleSortWeeklyTasksPriority}
        />
      )}

      {companyOpen && (
        <CompanyModal
          isOpen={companyOpen}
          language={settings.language}
          economyState={economyState}
          isOwnerAtBase={courierAtBaseBySlot[1] ?? true}
          courierAtBaseBySlot={courierAtBaseBySlot}
          onClose={handleCloseCompany}
          onUpgradeWarehouse={handleUpgradeWarehouse}
          onBuyParkingSpot={handleBuyParkingSpot}
          onBuyBicycle={handleBuyBicycle}
          onBuyVan={handleBuyVan}
          onRequestVehicleRepair={handleRequestVehicleRepair}
          onSelectActiveVehicle={handleSelectActiveVehicle}
          onBuyEmployeeLicense={handleBuyEmployeeLicense}
          onHireCourier={handleHireCourier}
          onPromoteCourier={handlePromoteCourier}
          onFireCourier={handleFireCourier}
          onAssignCourierVehicle={handleAssignCourierVehicle}
        />
      )}

      {skipTimeOpen && (
        <SkipTimeModal
          isOpen={skipTimeOpen}
          language={settings.language}
          nextDayMorningMinutes={nextDayMorningMinutes}
          nextScheduledOrderMinutes={nextScheduledOrderMinutes}
          onClose={handleCloseSkipTime}
          onSkipDay={handleSkipOneDay}
          onSkipToNextOrder={handleSkipToNextOrder}
        />
      )}

      {startScreenMounted && (
        <StartScreenModal
          isVisible={startScreenOpen}
          language={settings.language}
          slots={saveSlots}
          onStartNewGame={handleStartNewGame}
          onLoadGame={handleLoadGame}
          onDeleteSlot={handleDeleteSaveSlot}
          onOpenSettings={handleOpenSettingsFromStart}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          isOpen={settingsOpen}
          openedFrom={settingsOpenedFrom}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onRequestExitToMenu={
            settingsOpenedFrom === 'game' ? handleRequestExitToMenu : undefined
          }
          onClose={handleCloseSettings}
        />
      )}

      {/* Compact Save-Before-Exit Confirmation Dialog */}
      {exitConfirmOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-3 bg-slate-950/75 touch-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-confirm-heading"
          onClick={handleCancelExitToMenu}
          onWheel={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div
            className="w-[92vw] max-w-sm rounded-xl bg-slate-900 border border-slate-700 shadow-lg overflow-hidden text-slate-100 touch-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-slate-950/85 border-b border-slate-800">
              <h2
                id="exit-confirm-heading"
                className="text-sm sm:text-base font-bold text-slate-100 leading-tight"
              >
                {t(settings.language, 'exitConfirm.title')}
              </h2>
              <p className="text-xs text-slate-300 mt-1 leading-snug">
                {t(settings.language, 'exitConfirm.question')}
              </p>
            </div>

            <div className="p-3.5 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleConfirmSaveAndExit}
                className="w-full py-2.5 px-4 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
              >
                {t(settings.language, 'exitConfirm.saveAndExit')}
              </button>

              <button
                type="button"
                onClick={handleConfirmExitWithoutSaving}
                className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-slate-700 hover:border-rose-500/60 text-xs sm:text-sm font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
              >
                {t(settings.language, 'exitConfirm.exitWithoutSaving')}
              </button>

              <button
                type="button"
                onClick={handleCancelExitToMenu}
                className="w-full py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
              >
                {t(settings.language, 'exitConfirm.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <PWAInstallButton language={settings.language} />
    </main>
  );
}

export default App;
