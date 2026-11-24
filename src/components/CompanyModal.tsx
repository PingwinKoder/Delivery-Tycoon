import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  Ban,
  Bike,
  Building2,
  Car,
  Check,
  ChevronDown,
  Lock,
  ParkingSquare,
  Truck,
  UserMinus,
  UserPlus,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import type {
  ActiveVehicleSelection,
  CompanyCourier,
  CourierQualification,
  OrderEconomyState,
} from '../types/orders';
import {
  BICYCLE_PURCHASE_COST,
  BIKE_COURIER_CAPACITY,
  COURIER_INSURANCE_COST,
  HIRED_BIKE_COURIER_SALARY,
  HIRED_VAN_DRIVER_SALARY,
  MAX_BICYCLES,
  MAX_EMPLOYEES,
  MAX_PARKING_SPOTS,
  MAX_VANS,
  MAX_WAREHOUSE_TIER,
  PARKING_SPOT_COST,
  USED_VAN_INSURANCE_COST,
  USED_VAN_PURCHASE_COST,
  VAN_COURIER_CAPACITY,
  WAREHOUSE_TIERS,
  calculateMonthlyCompanyCosts,
  canCourierDriveVehicle,
  countHiredCouriers,
  findCourierAssignedToVehicle,
  formatCurrencyUsd,
  getEmployeeLicenseCost,
  getNextParkingSpotUpgrade,
  getNextWarehouseUpgrade,
  getOwnedFleetVehicles,
  getWarehouseTierConfig,
  vehiclesEqual,
} from '../utils/orderEconomy';

type CompanyTabId = 'base' | 'fleet' | 'employees';

interface CompanyModalProps {
  isOpen: boolean;
  economyState: OrderEconomyState;
  isOwnerAtBase: boolean;
  courierAtBaseBySlot?: Readonly<Record<number, boolean>>;
  onClose: () => void;
  onUpgradeWarehouse: () => void;
  onBuyParkingSpot: () => void;
  onBuyBicycle: () => void;
  onBuyUsedVan: () => void;
  onSelectActiveVehicle: (vehicle: ActiveVehicleSelection) => void;
  onBuyEmployeeLicense: () => void;
  onHireCourier: (slotIndex: number, qualification: CourierQualification) => void;
  onPromoteCourier: (slotIndex: number) => void;
  onFireCourier: (slotIndex: number) => void;
  onAssignCourierVehicle: (slotIndex: number, vehicle: ActiveVehicleSelection | null) => void;
}

interface CourierVehicleDropdownProps {
  courier: CompanyCourier;
  effectiveAssigned: ActiveVehicleSelection | null;
  availableVehicles: readonly ActiveVehicleSelection[];
  disabled: boolean;
  isOpen: boolean;
  openUpward: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (vehicle: ActiveVehicleSelection | null) => void;
}

const CourierVehicleDropdown: React.FC<CourierVehicleDropdownProps> = ({
  courier,
  effectiveAssigned,
  availableVehicles,
  disabled,
  isOpen,
  openUpward,
  onToggle,
  onClose,
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, onClose]);

  const triggerLabel = effectiveAssigned
    ? effectiveAssigned.type === 'van'
      ? `Bus #${effectiveAssigned.index}`
      : `Rower #${effectiveAssigned.index}`
    : 'Brak pojazdu';
  const triggerCapacity = effectiveAssigned
    ? effectiveAssigned.type === 'van'
      ? `${VAN_COURIER_CAPACITY} szt.`
      : `${BIKE_COURIER_CAPACITY} szt.`
    : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        id={`courier-vehicle-${courier.slotIndex}`}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`courier-vehicle-menu-${courier.slotIndex}`}
        onClick={() => {
          if (!disabled) onToggle();
        }}
        className={`w-full rounded-md border px-2.5 py-1.5 text-xs font-mono-nums flex items-center justify-between gap-2 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
          disabled
            ? 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
            : isOpen
              ? 'bg-slate-950 border-amber-400/80 text-slate-100 cursor-pointer'
              : 'bg-slate-950 border-slate-700 text-slate-100 hover:border-slate-500 cursor-pointer'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {effectiveAssigned?.type === 'van' ? (
            <Car className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          ) : effectiveAssigned?.type === 'bike' ? (
            <Bike className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
          ) : (
            <Ban className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
          )}
          <span className="font-semibold truncate">{triggerLabel}</span>
          {triggerCapacity && (
            <span className="text-[11px] text-slate-400 shrink-0">({triggerCapacity})</span>
          )}
        </span>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
            isOpen ? 'rotate-180 text-amber-300' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen && !disabled && (
        <ul
          id={`courier-vehicle-menu-${courier.slotIndex}`}
          role="listbox"
          aria-label={`Wybierz pojazd dla ${courier.isOwner ? 'Właściciela' : `Kuriera #${courier.slotIndex}`}`}
          className={`absolute left-0 right-0 z-30 rounded-md bg-slate-950 border border-slate-700 shadow-2xl py-1 max-h-48 overflow-y-auto overscroll-contain ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {!courier.isOwner && (
            <li role="option" aria-selected={effectiveAssigned === null}>
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  onClose();
                }}
                className={`w-full px-2.5 py-1.5 text-left text-xs font-mono-nums flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  effectiveAssigned === null
                    ? 'bg-amber-500/15 text-amber-200 font-semibold'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0 truncate">
                  <Ban className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                  <span className="truncate">Brak pojazdu</span>
                </span>
                {effectiveAssigned === null && (
                  <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                )}
              </button>
            </li>
          )}

          {availableVehicles.map((vehicle) => {
            const isSelected = vehiclesEqual(effectiveAssigned, vehicle);
            const isVan = vehicle.type === 'van';
            const label = isVan ? `Bus #${vehicle.index}` : `Rower #${vehicle.index}`;
            const capacityLabel = isVan
              ? `${VAN_COURIER_CAPACITY} szt.`
              : `${BIKE_COURIER_CAPACITY} szt.`;

            return (
              <li
                key={`${vehicle.type}:${vehicle.index}`}
                role="option"
                aria-selected={isSelected}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelect(vehicle);
                    onClose();
                  }}
                  className={`w-full px-2.5 py-1.5 text-left text-xs font-mono-nums flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/15 text-amber-200 font-semibold'
                      : 'text-slate-200 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    {isVan ? (
                      <Car className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <Bike className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate">{label}</span>
                    <span
                      className={`text-[11px] shrink-0 ${
                        isSelected ? 'text-amber-300/90' : 'text-slate-400'
                      }`}
                    >
                      ({capacityLabel})
                    </span>
                  </span>

                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}

          {availableVehicles.length === 0 && (
            <li className="px-2.5 py-1.5 text-[11px] text-slate-500">
              Brak innych wolnych pojazdów dla tych uprawnień
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export const CompanyModal: React.FC<CompanyModalProps> = ({
  isOpen,
  economyState,
  isOwnerAtBase,
  courierAtBaseBySlot,
  onClose,
  onUpgradeWarehouse,
  onBuyParkingSpot,
  onBuyBicycle,
  onBuyUsedVan,
  onSelectActiveVehicle,
  onBuyEmployeeLicense,
  onHireCourier,
  onPromoteCourier,
  onFireCourier,
  onAssignCourierVehicle,
}) => {
  const [activeTab, setActiveTab] = useState<CompanyTabId>('base');
  const [openVehicleSlot, setOpenVehicleSlot] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setOpenVehicleSlot(null);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (openVehicleSlot !== null) {
          setOpenVehicleSlot(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, openVehicleSlot, onClose]);

  useEffect(() => {
    setOpenVehicleSlot(null);
  }, [activeTab]);

  const warehouseLevel = economyState.warehouseLevel ?? economyState.warehouseTier;
  const bikesCount = economyState.bikesCount ?? economyState.bicyclesCount;
  const vansCount = economyState.vansCount ?? economyState.deliveryVansCount ?? 0;
  const activeVehicle: ActiveVehicleSelection = economyState.activeVehicle ?? {
    type: 'bike',
    index: 1,
  };

  const monthlyCosts = useMemo(
    () => calculateMonthlyCompanyCosts(economyState),
    [economyState]
  );

  const warehouseConfig = useMemo(
    () => getWarehouseTierConfig(warehouseLevel),
    [warehouseLevel]
  );

  const nextWarehouseUpgrade = useMemo(
    () => getNextWarehouseUpgrade(economyState),
    [economyState]
  );

  const nextParkingUpgrade = useMemo(
    () => getNextParkingSpotUpgrade(economyState),
    [economyState]
  );

  const costsBreakdownTitle = useMemo(() => {
    const parts: string[] = [
      `Baza (Poz. ${warehouseLevel}): ${formatCurrencyUsd(monthlyCosts.baseUpkeepAndTaxCost, false)}`,
    ];
    if (monthlyCosts.courierInsuranceCost > 0) {
      parts.push(
        `Ubezp. dodatkowych rowerów: ${formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false)}`
      );
    }
    if (monthlyCosts.vanInsuranceCost > 0) {
      parts.push(`Ubezp. busów: ${formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false)}`);
    }
    if (monthlyCosts.salariesCost > 0) {
      parts.push(`Pensje: ${formatCurrencyUsd(monthlyCosts.salariesCost, false)}`);
    }
    return parts.join(' | ');
  }, [monthlyCosts, warehouseLevel]);

  if (!isOpen) return null;

  const canUpgradeWarehouse =
    nextWarehouseUpgrade !== null && economyState.balance >= nextWarehouseUpgrade.cost;
  const canBuyParkingSpot =
    nextParkingUpgrade !== null && economyState.balance >= nextParkingUpgrade.cost;
  const bikesMaxed = bikesCount >= MAX_BICYCLES;
  const canBuyBicycle = !bikesMaxed && economyState.balance >= BICYCLE_PURCHASE_COST;
  const vansMaxed = vansCount >= MAX_VANS;
  const hasFreeParkingForVan = vansCount < economyState.parkingSpots;
  const canBuyUsedVan =
    !vansMaxed && hasFreeParkingForVan && economyState.balance >= USED_VAN_PURCHASE_COST;

  const hiredCouriersCount = countHiredCouriers(economyState);
  const ownedFleet = getOwnedFleetVehicles(economyState);
  const couriers = economyState.couriers;

  const isSlotAtBase = (slotIndex: number): boolean => {
    if (courierAtBaseBySlot && typeof courierAtBaseBySlot[slotIndex] === 'boolean') {
      return courierAtBaseBySlot[slotIndex];
    }
    return slotIndex === 1 ? isOwnerAtBase : true;
  };

  const warehouseFillPercent =
    economyState.warehouseCapacity > 0
      ? Math.min(100, Math.round((economyState.warehousePackages / economyState.warehouseCapacity) * 100))
      : 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-3 [@media(max-height:540px)]:p-1.5 bg-slate-950/80 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-modal-heading"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-[94vw] max-w-4xl max-h-[84vh] [@media(max-height:540px)]:max-h-[95vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-2xl overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header & Single-Line Company Summary Bar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 [@media(max-height:540px)]:px-2.5 [@media(max-height:540px)]:py-1.5 bg-[#182030] border-b border-slate-700/80">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs min-w-0 leading-tight">
            <div className="flex items-center gap-1.5 shrink-0">
              <Building2 className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              <h2 id="company-modal-heading" className="text-xs sm:text-sm font-bold text-slate-100">
                Firma
              </h2>
            </div>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">Gotówka: </span>
              <span className="font-bold text-emerald-400 font-mono-nums">
                {formatCurrencyUsd(economyState.balance)}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">Magazyn: </span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {economyState.warehousePackages}/{economyState.warehouseCapacity}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">Rowery: </span>
              <span className="font-bold text-sky-300 font-mono-nums">
                {bikesCount}/{MAX_BICYCLES}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">Busy: </span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {vansCount}/{economyState.parkingSpots}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">Zespół: </span>
              <span className="font-bold text-emerald-300 font-mono-nums">
                {hiredCouriersCount}/{MAX_EMPLOYEES}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap" title={costsBreakdownTitle}>
              <span className="text-slate-400">Koszty stałe: </span>
              <span className="font-bold text-rose-400 font-mono-nums">
                -{formatCurrencyUsd(monthlyCosts.totalFixedCosts, false)}/mies.
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno Firma"
            className="min-w-[30px] min-h-[30px] p-1 rounded-lg flex items-center justify-center shrink-0 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Compact Navigation Tabs Bar */}
        <div className="px-3 py-1.5 [@media(max-height:540px)]:px-2.5 bg-[#151d2c] border-b border-slate-800">
          <div
            className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain"
            role="tablist"
            aria-label="Zakładki zarządzania firmą"
          >
            <button
              id="company-tab-base"
              type="button"
              role="tab"
              aria-selected={activeTab === 'base'}
              aria-controls="company-panel-base"
              onClick={() => setActiveTab('base')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'base'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Warehouse className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Baza i Parkingi</span>
            </button>

            <button
              id="company-tab-fleet"
              type="button"
              role="tab"
              aria-selected={activeTab === 'fleet'}
              aria-controls="company-panel-fleet"
              onClick={() => setActiveTab('fleet')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'fleet'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Bike className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Flota</span>
            </button>

            <button
              id="company-tab-employees"
              type="button"
              role="tab"
              aria-selected={activeTab === 'employees'}
              aria-controls="company-panel-employees"
              onClick={() => setActiveTab('employees')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'employees'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Pracownicy</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain p-2.5 sm:p-3 [@media(max-height:540px)]:p-2"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* TAB 1: BAZA I PARKINGI */}
          {activeTab === 'base' && (
            <div
              id="company-panel-base"
              role="tabpanel"
              aria-labelledby="company-tab-base"
              className="grid grid-cols-1 md:grid-cols-2 gap-2.5"
            >
              {/* Card 1: Magazyn w Bazie */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2.5 flex flex-col justify-between gap-2.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Warehouse className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        Magazyn w Bazie
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-[11px] font-bold text-amber-300 font-mono-nums shrink-0">
                      Poziom {warehouseLevel}/{MAX_WAREHOUSE_TIER}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-snug">
                    {warehouseConfig.name}. Rozbudowa powiększa halę Bazy na mapie i zwiększa
                    limit paczek przyjmowanych podczas odbiorów.
                  </p>

                  {/* Tier progression strip */}
                  <div className="grid grid-cols-4 gap-1 text-center font-mono-nums">
                    {WAREHOUSE_TIERS.map((tier) => {
                      const isCurrent = tier.tier === warehouseLevel;
                      const isUnlocked = tier.tier <= warehouseLevel;
                      const isNext = nextWarehouseUpgrade?.nextTier === tier.tier;
                      return (
                        <div
                          key={tier.tier}
                          className={`rounded border px-1.5 py-1 text-[10px] leading-tight ${
                            isCurrent
                              ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                              : isNext
                                ? 'bg-slate-800/90 border-sky-400/50 text-sky-200 font-semibold'
                                : isUnlocked
                                  ? 'bg-slate-800/60 border-slate-700 text-slate-300'
                                  : 'bg-slate-900/60 border-slate-800 text-slate-500'
                          }`}
                        >
                          <div>Poz. {tier.tier}</div>
                          <div>{tier.capacity} szt.</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Current vs next specs */}
                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2.5 py-1.5 space-y-1 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Pojemność:</span>
                      <span className="text-slate-100 font-semibold">
                        {nextWarehouseUpgrade
                          ? `${nextWarehouseUpgrade.currentCapacity} → ${nextWarehouseUpgrade.nextCapacity} paczek`
                          : `${warehouseConfig.capacity} paczek (maks.)`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Koszt utrzymania Bazy:</span>
                      <span className="text-rose-300 font-semibold">
                        {nextWarehouseUpgrade
                          ? `${formatCurrencyUsd(nextWarehouseUpgrade.currentMonthlyUpkeepCost, false)} → ${formatCurrencyUsd(nextWarehouseUpgrade.nextMonthlyUpkeepCost, false)}/mies.`
                          : `${formatCurrencyUsd(warehouseConfig.monthlyUpkeepCost, false)}/mies.`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Zapełnienie:</span>
                      <span className="text-amber-300 font-semibold">
                        {economyState.warehousePackages}/{economyState.warehouseCapacity} ({warehouseFillPercent}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    {nextWarehouseUpgrade
                      ? `Koszt: ${formatCurrencyUsd(nextWarehouseUpgrade.cost, false)}`
                      : 'Osiągnięto maks. poziom'}
                  </span>
                  <button
                    type="button"
                    disabled={!canUpgradeWarehouse}
                    onClick={onUpgradeWarehouse}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canUpgradeWarehouse
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {nextWarehouseUpgrade
                      ? `Rozbuduj (${formatCurrencyUsd(nextWarehouseUpgrade.cost, false)})`
                      : 'Maksymalny poziom'}
                  </button>
                </div>
              </article>

              {/* Card 2: Miejsca parkingowe */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2.5 flex flex-col justify-between gap-2.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ParkingSquare className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        Miejsca parkingowe
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-[11px] font-bold text-sky-300 font-mono-nums shrink-0">
                      {economyState.parkingSpots} / {MAX_PARKING_SPOTS}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-snug">
                    Stanowiska postojowe dla busów na placu Bazy. Zakup każdego busa dostawczego
                    wymaga posiadania wolnego miejsca parkingowego przy Bazie.
                  </p>

                  {/* 8-slot visual grid (2 rows x 4 spots matching map layout) */}
                  <div
                    className="grid grid-cols-4 gap-1"
                    aria-label={`Wykupione miejsca parkingowe: ${economyState.parkingSpots} z ${MAX_PARKING_SPOTS}`}
                  >
                    {Array.from({ length: MAX_PARKING_SPOTS }, (_, idx) => {
                      const unlocked = idx < economyState.parkingSpots;
                      return (
                        <div
                          key={idx}
                          className={`rounded border px-1.5 py-1 text-center text-[10px] font-mono-nums ${
                            unlocked
                              ? 'bg-sky-500/20 border-sky-400/70 text-sky-200 font-bold'
                              : 'bg-slate-900/60 border-slate-800 text-slate-500'
                          }`}
                        >
                          P{idx + 1}
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2.5 py-1.5 space-y-1 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Stanowiska na placu Bazy:</span>
                      <span className="text-slate-100 font-semibold">
                        {economyState.parkingSpots} / {MAX_PARKING_SPOTS} miejsc
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Cena za miejsce:</span>
                      <span className="text-emerald-300 font-semibold">
                        {formatCurrencyUsd(PARKING_SPOT_COST, false)} (jednorazowo)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Koszt miesięczny:</span>
                      <span className="text-slate-300 font-semibold">$0/mies.</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    {nextParkingUpgrade
                      ? `Miejsce #${nextParkingUpgrade.nextSpotNumber} pojawi się na mapie`
                      : 'Komplet 8 miejsc wykupiony'}
                  </span>
                  <button
                    type="button"
                    disabled={!canBuyParkingSpot}
                    onClick={onBuyParkingSpot}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canBuyParkingSpot
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {nextParkingUpgrade
                      ? `Kup miejsce (${formatCurrencyUsd(nextParkingUpgrade.cost, false)})`
                      : 'Maks. miejsc (8/8)'}
                  </button>
                </div>
              </article>
            </div>
          )}

          {/* TAB 2: FLOTA */}
          {activeTab === 'fleet' && (
            <div
              id="company-panel-fleet"
              role="tabpanel"
              aria-labelledby="company-tab-fleet"
              className="grid grid-cols-1 md:grid-cols-3 gap-2.5"
            >
              {/* Card 1: Rowery kurierskie (Interactive Stage 1) */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2.5 flex flex-col justify-between gap-2.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Bike className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        Rowery kurierskie
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-[11px] font-bold text-sky-300 font-mono-nums shrink-0">
                      {bikesCount} / {MAX_BICYCLES}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-snug">
                    Zwrotna flota rowerowa do szybkich kursów miejskich. Pierwszy rower wliczony w
                    bazowy koszt Bazy.
                  </p>

                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2.5 py-1.5 space-y-1 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Ładowność:</span>
                      <span className="text-slate-100 font-semibold">
                        {BIKE_COURIER_CAPACITY} paczek
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Ubezpieczenie (2. i 3.):</span>
                      <span className="text-rose-300 font-semibold">
                        +{formatCurrencyUsd(COURIER_INSURANCE_COST, false)}/mies.
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Aktualnie ubezp.:</span>
                      <span className="text-slate-200 font-semibold">
                        +{formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false)}/mies.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-end">
                  <button
                    type="button"
                    disabled={!canBuyBicycle}
                    onClick={onBuyBicycle}
                    className={`w-full px-3 py-1.5 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canBuyBicycle
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {bikesMaxed
                      ? `Limit osiągnięty (${MAX_BICYCLES}/${MAX_BICYCLES})`
                      : `Kup rower (${formatCurrencyUsd(BICYCLE_PURCHASE_COST, false)})`}
                  </button>
                </div>
              </article>

              {/* Card 2: Używany bus dostawczy 20 paczek (Active Stage 2A) */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2.5 flex flex-col justify-between gap-2.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Car className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        Używany bus dostawczy
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-[11px] font-bold text-amber-300 font-mono-nums shrink-0 whitespace-nowrap">
                      Busy: {vansCount} / {economyState.parkingSpots}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-snug">
                    Klasa {VAN_COURIER_CAPACITY} paczek. Zwiększa ładowność pojedynczego kursu
                    i wymaga wolnego stanowiska postojowego przy Bazie.
                  </p>

                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2.5 py-1.5 space-y-1 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Ładowność:</span>
                      <span className="text-slate-100 font-semibold">
                        {VAN_COURIER_CAPACITY} paczek
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Ubezpieczenie (szt.):</span>
                      <span className="text-rose-300 font-semibold">
                        +{formatCurrencyUsd(USED_VAN_INSURANCE_COST, false)}/mies.
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Aktualnie ubezp.:</span>
                      <span className="text-slate-200 font-semibold">
                        +{formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false)}/mies.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 space-y-1.5">
                  {!vansMaxed && !hasFreeParkingForVan && (
                    <p className="text-[11px] text-amber-300/90 leading-snug">
                      Wymaga wolnego miejsca parkingowego P1–P8
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!canBuyUsedVan}
                    onClick={onBuyUsedVan}
                    className={`w-full px-3 py-1.5 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canBuyUsedVan
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {vansMaxed
                      ? `Limit osiągnięty (${MAX_VANS}/${MAX_VANS})`
                      : `Kup busa (${formatCurrencyUsd(USED_VAN_PURCHASE_COST, false)})`}
                  </button>
                </div>
              </article>

              {/* Card 3: Bus dostawczy 30 paczek (Preview Future) */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2.5 flex flex-col justify-between gap-2.5 opacity-85">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Truck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        Bus dostawczy
                      </h3>
                    </div>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0">
                      Wkrótce
                    </span>
                  </div>

                  <p className="text-[11px] font-semibold text-slate-200">
                    Klasa 30 paczek — ciężka flota miejska
                  </p>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Najwyższa pojemność pojedynczego kursu przeznaczona do dużych kontraktów
                    długoterminowych i hurtowni.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono-nums text-slate-400">
                  <span>Ładowność: 30 paczek</span>
                  <span>Wymaga parkingu</span>
                </div>
              </article>
            </div>
          )}

          {/* TAB 3: PRACOWNICY */}
          {activeTab === 'employees' && (
            <div
              id="company-panel-employees"
              role="tabpanel"
              aria-labelledby="company-tab-employees"
              className="space-y-2.5"
            >
              {/* Compact Team Overview Header */}
              <div className="rounded-lg bg-[#182030] border border-slate-700/85 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Users className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                  <h3 className="text-xs sm:text-sm font-bold text-slate-100">
                    Zespół kurierów ({hiredCouriersCount} / {MAX_EMPLOYEES})
                  </h3>
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono-nums text-slate-300">
                    Licencje: {economyState.maxEmployees}/{MAX_EMPLOYEES}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-nums">
                  <span className="text-slate-400">
                    Pensje:{' '}
                    <span className="font-bold text-rose-300">
                      {formatCurrencyUsd(monthlyCosts.salariesCost, false)}/mies.
                    </span>
                  </span>
                  <span className="text-slate-600" aria-hidden="true">•</span>
                  <span className="text-slate-400">
                    Rower: {formatCurrencyUsd(HIRED_BIKE_COURIER_SALARY, false)} | Rower + Bus:{' '}
                    {formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false)}
                  </span>
                </div>
              </div>

              {/* 6-Slot Staff Roster Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {couriers.map((courier) => {
                  const slotAtBase = isSlotAtBase(courier.slotIndex);
                  const effectiveAssigned = courier.isOwner
                    ? courier.assignedVehicle ?? activeVehicle
                    : courier.assignedVehicle;

                  // 1. Unlocked & Hired Slot
                  if (courier.unlocked && courier.hired) {
                    const roleHeading = courier.isOwner
                      ? '#1 Właściciel'
                      : `#${courier.slotIndex} Kurier`;
                    const hasVanQualification =
                      courier.isOwner || courier.qualification === 'bike_and_van';
                    const qualificationLabel = hasVanQualification ? 'Rower + Bus' : 'Rower';

                    // Strictly free vehicles (not assigned to any other courier) matching this courier's qualifications
                    const availableVehicles = ownedFleet.filter(
                      (vehicle) =>
                        canCourierDriveVehicle(courier, vehicle.type) &&
                        findCourierAssignedToVehicle(couriers, vehicle, courier.slotIndex) === null
                    );

                    return (
                      <article
                        key={courier.id}
                        className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 flex flex-col justify-between gap-2 text-xs"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              {effectiveAssigned?.type === 'van' ? (
                                <Car className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                              ) : effectiveAssigned?.type === 'bike' ? (
                                <Bike className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                              ) : (
                                <Users className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                              )}
                              <h4 className="font-bold text-slate-100 truncate">{roleHeading}</h4>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                                  slotAtBase
                                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                    : 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                                }`}
                              >
                                {slotAtBase ? 'W Bazie' : 'W trasie'}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                                  hasVanQualification
                                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                                    : 'bg-sky-500/15 border-sky-400/40 text-sky-300'
                                }`}
                              >
                                {qualificationLabel}
                              </span>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono-nums border shrink-0 ${
                                courier.isOwner
                                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                  : 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                              }`}
                            >
                              {formatCurrencyUsd(courier.monthlySalary, false)}/mies.
                            </span>
                          </div>

                          {/* Custom filtered dark vehicle selector */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <label
                                htmlFor={`courier-vehicle-${courier.slotIndex}`}
                                className="text-[11px] text-slate-400"
                              >
                                Przypisany pojazd:
                              </label>
                              {!slotAtBase && (
                                <span className="text-[10px] text-amber-300/90">
                                  Zmiana po powrocie do Bazy
                                </span>
                              )}
                            </div>

                            <CourierVehicleDropdown
                              courier={courier}
                              effectiveAssigned={effectiveAssigned}
                              availableVehicles={availableVehicles}
                              disabled={!slotAtBase}
                              isOpen={openVehicleSlot === courier.slotIndex}
                              openUpward={courier.slotIndex >= 5}
                              onToggle={() =>
                                setOpenVehicleSlot((prev) =>
                                  prev === courier.slotIndex ? null : courier.slotIndex
                                )
                              }
                              onClose={() =>
                                setOpenVehicleSlot((prev) =>
                                  prev === courier.slotIndex ? null : prev
                                )
                              }
                              onSelect={(selectedVehicle) => {
                                if (courier.isOwner && selectedVehicle) {
                                  onSelectActiveVehicle(selectedVehicle);
                                } else {
                                  onAssignCourierVehicle(courier.slotIndex, selectedVehicle);
                                }
                              }}
                            />
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-[11px] text-slate-400">
                            {courier.isOwner
                              ? 'Właściciel firmy — uprawnienia Rower + Bus'
                              : effectiveAssigned
                                ? `Ładowność: ${effectiveAssigned.type === 'van' ? VAN_COURIER_CAPACITY : BIKE_COURIER_CAPACITY} paczek`
                                : hasVanQualification
                                  ? 'Przypisz wolny rower lub busa'
                                  : 'Przypisz wolny rower lub awansuj'}
                          </span>

                          {!courier.isOwner && (
                            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                              {!hasVanQualification && (
                                <button
                                  type="button"
                                  title={`Zmień uprawnienia na Rower + Bus (pensja ${formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false)}/mies.)`}
                                  onClick={() => onPromoteCourier(courier.slotIndex)}
                                  className="px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/45 text-amber-300 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                                >
                                  <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span>Awansuj (Rower + Bus)</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={!slotAtBase}
                                onClick={() => onFireCourier(courier.slotIndex)}
                                className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                                  slotAtBase
                                    ? 'bg-rose-500/15 hover:bg-rose-500/25 border-rose-400/45 text-rose-300 cursor-pointer'
                                    : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                                }`}
                              >
                                <UserMinus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>Zwolnij</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  }

                  // 2. Unlocked but Vacant Slot (License purchased, choose qualification profile to hire)
                  if (courier.unlocked && !courier.hired) {
                    return (
                      <article
                        key={courier.id}
                        className="rounded-lg bg-[#182030] border border-sky-500/40 p-2.5 flex flex-col justify-between gap-2 text-xs"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <UserPlus className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                              <h4 className="font-bold text-slate-100 truncate">
                                #{courier.slotIndex} Kurier
                              </h4>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-sky-300 text-[10px] font-semibold shrink-0">
                              Wolne stanowisko
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 leading-snug">
                            Licencja aktywna. Wybierz profil uprawnień pracownika (bez opłaty
                            wstępnej — kuriera rowerowego możesz później awansować):
                          </p>
                        </div>

                        <div className="pt-2 border-t border-slate-800 flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => onHireCourier(courier.slotIndex, 'bike_only')}
                            className="w-full px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono-nums flex items-center justify-center gap-1.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/50 text-sky-200 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                          >
                            <Bike className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              Zatrudnij: Rower ({formatCurrencyUsd(HIRED_BIKE_COURIER_SALARY, false)}/mies.)
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onHireCourier(courier.slotIndex, 'bike_and_van')}
                            className="w-full px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono-nums flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                          >
                            <Car className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              Zatrudnij: Rower + Bus ({formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false)}/mies.)
                            </span>
                          </button>
                        </div>
                      </article>
                    );
                  }

                  // 3. Locked Slot (Sequential License Purchase #2..#6)
                  const licenseCost = getEmployeeLicenseCost(courier.slotIndex) ?? 0;
                  const isNextToUnlock = courier.slotIndex === economyState.maxEmployees + 1;
                  const canBuyLicense = isNextToUnlock && economyState.balance >= licenseCost;

                  return (
                    <article
                      key={courier.id}
                      className={`rounded-lg bg-[#151d2b] border p-2.5 flex flex-col justify-between gap-2 text-xs ${
                        isNextToUnlock
                          ? 'border-amber-400/45'
                          : 'border-slate-800 opacity-75'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                            <h4 className="font-bold text-slate-200 truncate">
                              #{courier.slotIndex} Stanowisko kurierskie
                            </h4>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-semibold shrink-0">
                            Zablokowane
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-400 leading-snug">
                          {isNextToUnlock
                            ? `Jednorazowy zakup licencji na ${courier.slotIndex}. stanowisko pozwala zatrudnić kolejnego kuriera.`
                            : `Wymaga wcześniejszego wykupienia licencji na stanowisko #${courier.slotIndex - 1}.`}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400 font-mono-nums">
                          Licencja: {formatCurrencyUsd(licenseCost, false)}
                        </span>
                        <button
                          type="button"
                          disabled={!canBuyLicense}
                          onClick={onBuyEmployeeLicense}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                            canBuyLicense
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed'
                          }`}
                        >
                          Kup licencję ({formatCurrencyUsd(licenseCost, false)})
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
