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
import { t, translateOrderText } from '../i18n/translations';
import type {
  ActiveVehicleSelection,
  CompanyCourier,
  CourierQualification,
  OrderEconomyState,
} from '../types/orders';
import type { SupportedLanguage } from '../utils/settingsSystem';
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

function formatMissingFunds(cost: number, balance: number, lang: SupportedLanguage): string {
  const missing = Math.round(Math.max(0, cost - balance) * 100) / 100;
  const hasCents = Math.abs(missing - Math.round(missing)) > 0.001;
  return t(lang, 'company.missingFunds', { amount: formatCurrencyUsd(missing, hasCents) });
}

interface CompanyModalProps {
  isOpen: boolean;
  language: SupportedLanguage;
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
  language: SupportedLanguage;
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
  language,
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
      ? t(language, 'company.vehicleVan', { index: effectiveAssigned.index })
      : t(language, 'company.vehicleBike', { index: effectiveAssigned.index })
    : t(language, 'company.noVehicle');
  const triggerCapacity = effectiveAssigned
    ? t(language, 'company.pcsShort', {
        count: effectiveAssigned.type === 'van' ? VAN_COURIER_CAPACITY : BIKE_COURIER_CAPACITY,
      })
    : null;
  const courierAriaName = courier.isOwner
    ? t(language, 'orders.ownerBadge')
    : t(language, 'orders.courierBadge', { slot: courier.slotIndex });

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
          aria-label={t(language, 'company.selectVehicleAria', { name: courierAriaName })}
          className={`absolute left-0 right-0 z-30 rounded-md bg-slate-950 border border-slate-700 shadow-lg py-1 max-h-48 overflow-y-auto overscroll-contain ${
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
                  <span className="truncate">{t(language, 'company.noVehicle')}</span>
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
            const label = isVan
              ? t(language, 'company.vehicleVan', { index: vehicle.index })
              : t(language, 'company.vehicleBike', { index: vehicle.index });
            const capacityLabel = t(language, 'company.pcsShort', {
              count: isVan ? VAN_COURIER_CAPACITY : BIKE_COURIER_CAPACITY,
            });

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
              {t(language, 'company.noFreeVehicles')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export const CompanyModal: React.FC<CompanyModalProps> = ({
  isOpen,
  language,
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
      t(language, 'company.costBase', {
        level: warehouseLevel,
        amount: formatCurrencyUsd(monthlyCosts.baseUpkeepAndTaxCost, false),
      }),
    ];
    if (monthlyCosts.courierInsuranceCost > 0) {
      parts.push(
        t(language, 'company.costBikes', {
          amount: formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false),
        })
      );
    }
    if (monthlyCosts.vanInsuranceCost > 0) {
      parts.push(
        t(language, 'company.costVans', {
          amount: formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false),
        })
      );
    }
    if (monthlyCosts.salariesCost > 0) {
      parts.push(
        t(language, 'company.costSalaries', {
          amount: formatCurrencyUsd(monthlyCosts.salariesCost, false),
        })
      );
    }
    return parts.join(' | ');
  }, [language, monthlyCosts, warehouseLevel]);

  if (!isOpen) return null;

  const perMonth = t(language, 'company.perMonth');
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
        className="w-[94vw] max-w-4xl max-h-[84vh] [@media(max-height:540px)]:max-h-[95vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-lg overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header & Single-Line Company Summary Bar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 [@media(max-height:540px)]:px-2.5 [@media(max-height:540px)]:py-1.5 bg-[#182030] border-b border-slate-700/80">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs min-w-0 leading-tight">
            <div className="flex items-center gap-1.5 shrink-0">
              <Building2 className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              <h2 id="company-modal-heading" className="text-xs sm:text-sm font-bold text-slate-100">
                {t(language, 'company.title')}
              </h2>
            </div>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.cash')} </span>
              <span className="font-bold text-emerald-400 font-mono-nums">
                {formatCurrencyUsd(economyState.balance)}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.warehouse')} </span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {economyState.warehousePackages}/{economyState.warehouseCapacity}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.bikes')} </span>
              <span className="font-bold text-sky-300 font-mono-nums">
                {bikesCount}/{MAX_BICYCLES}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.vans')} </span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {vansCount}/{economyState.parkingSpots}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.team')} </span>
              <span className="font-bold text-emerald-300 font-mono-nums">
                {hiredCouriersCount}/{MAX_EMPLOYEES}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap" title={costsBreakdownTitle}>
              <span className="text-slate-400">{t(language, 'company.fixedCosts')} </span>
              <span className="font-bold text-rose-400 font-mono-nums">
                -{formatCurrencyUsd(monthlyCosts.totalFixedCosts, false)}
                {perMonth}
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'company.closeAria')}
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
            aria-label={t(language, 'company.tabsAria')}
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
              <span>{t(language, 'company.tabBase')}</span>
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
              <span>{t(language, 'company.tabFleet')}</span>
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
              <span>{t(language, 'company.tabEmployees')}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain p-2 sm:p-2.5 [@media(max-height:540px)]:p-1.5"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* TAB 1: BASE & PARKING */}
          {activeTab === 'base' && (
            <div
              id="company-panel-base"
              role="tabpanel"
              aria-labelledby="company-tab-base"
              className="grid grid-cols-1 md:grid-cols-2 [@media(max-height:540px)]:grid-cols-2 gap-2"
            >
              {/* Card 1: Base Warehouse */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5">
                <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Warehouse className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        {t(language, 'company.warehouseTitle')}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-[11px] font-bold text-amber-300 font-mono-nums shrink-0">
                      {t(language, 'company.levelBadge', {
                        level: warehouseLevel,
                        max: MAX_WAREHOUSE_TIER,
                      })}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-tight">
                    {t(language, 'company.warehouseDesc', {
                      tierName: translateOrderText(language, warehouseConfig.name),
                    })}
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
                          className={`rounded border px-1 py-0.5 text-[10px] leading-tight ${
                            isCurrent
                              ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                              : isNext
                                ? 'bg-slate-800/90 border-sky-400/50 text-sky-200 font-semibold'
                                : isUnlocked
                                  ? 'bg-slate-800/60 border-slate-700 text-slate-300'
                                  : 'bg-slate-900/60 border-slate-800 text-slate-500'
                          }`}
                        >
                          <div>{t(language, 'company.tierShort', { tier: tier.tier })}</div>
                          <div>{t(language, 'company.pcsShort', { count: tier.capacity })}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Current vs next specs */}
                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.capacityLabel')}</span>
                      <span className="text-slate-100 font-semibold">
                        {nextWarehouseUpgrade
                          ? t(language, 'company.capacityUpgrade', {
                              from: nextWarehouseUpgrade.currentCapacity,
                              to: nextWarehouseUpgrade.nextCapacity,
                            })
                          : t(language, 'company.capacityMax', {
                              count: warehouseConfig.capacity,
                            })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.baseUpkeepLabel')}</span>
                      <span className="text-rose-300 font-semibold">
                        {nextWarehouseUpgrade
                          ? `${formatCurrencyUsd(nextWarehouseUpgrade.currentMonthlyUpkeepCost, false)} → ${formatCurrencyUsd(nextWarehouseUpgrade.nextMonthlyUpkeepCost, false)}${perMonth}`
                          : `${formatCurrencyUsd(warehouseConfig.monthlyUpkeepCost, false)}${perMonth}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.occupancyLabel')}</span>
                      <span className="text-amber-300 font-semibold">
                        {economyState.warehousePackages}/{economyState.warehouseCapacity} ({warehouseFillPercent}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0 leading-tight">
                    <span className="block text-[11px] text-slate-400 font-mono-nums">
                      {nextWarehouseUpgrade
                        ? t(language, 'company.costLabel', {
                            amount: formatCurrencyUsd(nextWarehouseUpgrade.cost, false),
                          })
                        : t(language, 'company.maxLevelReached')}
                    </span>
                    {nextWarehouseUpgrade && !canUpgradeWarehouse && (
                      <span className="block text-[11px] font-semibold text-rose-300 font-mono-nums">
                        {formatMissingFunds(
                          nextWarehouseUpgrade.cost,
                          economyState.balance,
                          language
                        )}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canUpgradeWarehouse}
                    onClick={onUpgradeWarehouse}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono-nums shrink-0 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canUpgradeWarehouse
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {nextWarehouseUpgrade
                      ? t(language, 'company.upgradeBtn', {
                          amount: formatCurrencyUsd(nextWarehouseUpgrade.cost, false),
                        })
                      : t(language, 'company.maxLevelBtn')}
                  </button>
                </div>
              </article>

              {/* Card 2: Parking Spots */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5">
                <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ParkingSquare className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        {t(language, 'company.parkingTitle')}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-[11px] font-bold text-sky-300 font-mono-nums shrink-0">
                      {economyState.parkingSpots} / {MAX_PARKING_SPOTS}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-tight">
                    {t(language, 'company.parkingDesc')}
                  </p>

                  {/* 8-slot visual grid */}
                  <div
                    className="grid grid-cols-4 gap-1"
                    aria-label={t(language, 'company.parkingGridAria', {
                      current: economyState.parkingSpots,
                      max: MAX_PARKING_SPOTS,
                    })}
                  >
                    {Array.from({ length: MAX_PARKING_SPOTS }, (_, idx) => {
                      const unlocked = idx < economyState.parkingSpots;
                      return (
                        <div
                          key={idx}
                          className={`rounded border px-1 py-0.5 text-center text-[10px] font-mono-nums leading-tight ${
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

                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.parkingSpotsLabel')}
                      </span>
                      <span className="text-slate-100 font-semibold">
                        {t(language, 'company.parkingSpotsValue', {
                          current: economyState.parkingSpots,
                          max: MAX_PARKING_SPOTS,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.parkingPriceLabel')}
                      </span>
                      <span className="text-emerald-300 font-semibold">
                        {formatCurrencyUsd(PARKING_SPOT_COST, false)} {t(language, 'company.oneTime')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.monthlyCostLabel')}
                      </span>
                      <span className="text-slate-300 font-semibold">$0{perMonth}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0 leading-tight">
                    <span className="block text-[11px] text-slate-400">
                      {nextParkingUpgrade
                        ? t(language, 'company.parkingNextHint', {
                            spot: nextParkingUpgrade.nextSpotNumber,
                          })
                        : t(language, 'company.parkingAllBought')}
                    </span>
                    {nextParkingUpgrade && !canBuyParkingSpot && (
                      <span className="block text-[11px] font-semibold text-rose-300 font-mono-nums">
                        {formatMissingFunds(
                          nextParkingUpgrade.cost,
                          economyState.balance,
                          language
                        )}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canBuyParkingSpot}
                    onClick={onBuyParkingSpot}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono-nums shrink-0 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canBuyParkingSpot
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {nextParkingUpgrade
                      ? t(language, 'company.buySpotBtn', {
                          amount: formatCurrencyUsd(nextParkingUpgrade.cost, false),
                        })
                      : t(language, 'company.maxSpotsBtn')}
                  </button>
                </div>
              </article>
            </div>
          )}

          {/* TAB 2: FLEET */}
          {activeTab === 'fleet' && (
            <div
              id="company-panel-fleet"
              role="tabpanel"
              aria-labelledby="company-tab-fleet"
              className="grid grid-cols-1 md:grid-cols-3 [@media(max-height:540px)]:grid-cols-3 gap-2"
            >
              {/* Card 1: Courier Bikes */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5">
                <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Bike className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        {t(language, 'company.bikesTitle')}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-[11px] font-bold text-sky-300 font-mono-nums shrink-0">
                      {bikesCount} / {MAX_BICYCLES}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-tight">
                    {t(language, 'company.bikesDesc')}
                  </p>

                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.payloadLabel')}</span>
                      <span className="text-slate-100 font-semibold">
                        {t(language, 'company.packagesCount', { count: BIKE_COURIER_CAPACITY })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.bikeInsuranceLabel')}
                      </span>
                      <span className="text-rose-300 font-semibold">
                        +{formatCurrencyUsd(COURIER_INSURANCE_COST, false)}
                        {perMonth}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.currentInsuranceLabel')}
                      </span>
                      <span className="text-slate-200 font-semibold">
                        +{formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false)}
                        {perMonth}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-800 space-y-1">
                  {!bikesMaxed && !canBuyBicycle && (
                    <p className="text-[11px] font-semibold text-rose-300 font-mono-nums leading-tight">
                      {formatMissingFunds(BICYCLE_PURCHASE_COST, economyState.balance, language)}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!canBuyBicycle}
                    onClick={onBuyBicycle}
                    className={`w-full px-2.5 py-1 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canBuyBicycle
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {bikesMaxed
                      ? t(language, 'company.limitReached', {
                          current: MAX_BICYCLES,
                          max: MAX_BICYCLES,
                        })
                      : t(language, 'company.buyBikeBtn', {
                          amount: formatCurrencyUsd(BICYCLE_PURCHASE_COST, false),
                        })}
                  </button>
                </div>
              </article>

              {/* Card 2: Used Delivery Van */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5">
                <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Car className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 leading-tight">
                        {t(language, 'company.usedVanTitle')}
                      </h3>
                    </div>
                    <span
                      title={t(language, 'company.vansCountTitle')}
                      className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-[11px] font-bold text-amber-300 font-mono-nums shrink-0 whitespace-nowrap"
                    >
                      {vansCount} / {economyState.parkingSpots}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-tight">
                    {t(language, 'company.usedVanDesc', { capacity: VAN_COURIER_CAPACITY })}
                  </p>

                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.payloadLabel')}</span>
                      <span className="text-slate-100 font-semibold">
                        {t(language, 'company.packagesCount', { count: VAN_COURIER_CAPACITY })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.vanInsuranceLabel')}
                      </span>
                      <span className="text-rose-300 font-semibold">
                        +{formatCurrencyUsd(USED_VAN_INSURANCE_COST, false)}
                        {perMonth}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.currentInsuranceLabel')}
                      </span>
                      <span className="text-slate-200 font-semibold">
                        +{formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false)}
                        {perMonth}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-800 space-y-1">
                  {!vansMaxed && !canBuyUsedVan && (
                    <div className="space-y-0.5 text-[11px] font-semibold leading-tight">
                      {!hasFreeParkingForVan && (
                        <p className="text-amber-300">
                          {t(language, 'company.requiresFreeParking')}
                        </p>
                      )}
                      {economyState.balance < USED_VAN_PURCHASE_COST && (
                        <p className="text-rose-300 font-mono-nums">
                          {formatMissingFunds(
                            USED_VAN_PURCHASE_COST,
                            economyState.balance,
                            language
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!canBuyUsedVan}
                    onClick={onBuyUsedVan}
                    className={`w-full px-2.5 py-1 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canBuyUsedVan
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {vansMaxed
                      ? t(language, 'company.limitReached', {
                          current: MAX_VANS,
                          max: MAX_VANS,
                        })
                      : t(language, 'company.buyVanBtn', {
                          amount: formatCurrencyUsd(USED_VAN_PURCHASE_COST, false),
                        })}
                  </button>
                </div>
              </article>

              {/* Card 3: Heavy Delivery Van (Coming Soon) */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5 opacity-85">
                <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Truck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 leading-tight">
                        {t(language, 'company.heavyVanTitle')}
                      </h3>
                    </div>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0">
                      {t(language, 'company.comingSoon')}
                    </span>
                  </div>

                  <p className="text-[11px] font-semibold text-slate-200 leading-tight">
                    {t(language, 'company.heavyVanSubtitle')}
                  </p>
                  <p className="text-[11px] text-slate-400 leading-tight">
                    {t(language, 'company.heavyVanDesc')}
                  </p>
                </div>

                <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono-nums text-slate-400">
                  <span>{t(language, 'company.heavyVanCapacity')}</span>
                  <span>{t(language, 'company.requiresParking')}</span>
                </div>
              </article>
            </div>
          )}

          {/* TAB 3: STAFF */}
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
                    {t(language, 'company.teamHeader', {
                      hired: hiredCouriersCount,
                      max: MAX_EMPLOYEES,
                    })}
                  </h3>
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono-nums text-slate-300">
                    {t(language, 'company.licensesBadge', {
                      current: economyState.maxEmployees,
                      max: MAX_EMPLOYEES,
                    })}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-nums">
                  <span className="text-slate-400">
                    {t(language, 'company.salariesLabel')}{' '}
                    <span className="font-bold text-rose-300">
                      {formatCurrencyUsd(monthlyCosts.salariesCost, false)}
                      {perMonth}
                    </span>
                  </span>
                  <span className="text-slate-600" aria-hidden="true">•</span>
                  <span className="text-slate-400">
                    {t(language, 'company.qualBike')}:{' '}
                    {formatCurrencyUsd(HIRED_BIKE_COURIER_SALARY, false)} |{' '}
                    {t(language, 'company.qualBikeAndVan')}:{' '}
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
                      ? t(language, 'company.ownerRoleHeading')
                      : t(language, 'company.courierRoleHeading', { slot: courier.slotIndex });
                    const hasVanQualification =
                      courier.isOwner || courier.qualification === 'bike_and_van';
                    const qualificationLabel = hasVanQualification
                      ? t(language, 'company.qualBikeAndVan')
                      : t(language, 'company.qualBike');

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
                                {slotAtBase
                                  ? t(language, 'company.statusAvailable')
                                  : t(language, 'company.statusOnRoute')}
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
                              {formatCurrencyUsd(courier.monthlySalary, false)}
                              {perMonth}
                            </span>
                          </div>

                          {/* Custom filtered dark vehicle selector */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <label
                                htmlFor={`courier-vehicle-${courier.slotIndex}`}
                                className="text-[11px] text-slate-400"
                              >
                                {t(language, 'company.assignedVehicleLabel')}
                              </label>
                              {!slotAtBase && (
                                <span className="text-[10px] text-amber-300/90">
                                  {t(language, 'company.changeAtBaseHint')}
                                </span>
                              )}
                            </div>

                            <CourierVehicleDropdown
                              language={language}
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
                              ? t(language, 'company.ownerFooterDesc')
                              : effectiveAssigned
                                ? t(language, 'company.courierPayload', {
                                    count:
                                      effectiveAssigned.type === 'van'
                                        ? VAN_COURIER_CAPACITY
                                        : BIKE_COURIER_CAPACITY,
                                  })
                                : hasVanQualification
                                  ? t(language, 'company.assignBikeOrVan')
                                  : t(language, 'company.assignBikeOrPromote')}
                          </span>

                          {!courier.isOwner && (
                            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                              {!hasVanQualification && (
                                <button
                                  type="button"
                                  title={t(language, 'company.promoteTitle', {
                                    salary: formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false),
                                  })}
                                  onClick={() => onPromoteCourier(courier.slotIndex)}
                                  className="px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/45 text-amber-300 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                                >
                                  <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span>{t(language, 'company.promoteBtn')}</span>
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
                                <span>{t(language, 'company.fireBtn')}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  }

                  // 2. Unlocked but Vacant Slot
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
                                {t(language, 'company.courierRoleHeading', {
                                  slot: courier.slotIndex,
                                })}
                              </h4>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-sky-300 text-[10px] font-semibold shrink-0">
                              {t(language, 'company.vacantBadge')}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 leading-snug">
                            {t(language, 'company.vacantDesc')}
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
                              {t(language, 'company.hireBikeBtn', {
                                salary: formatCurrencyUsd(HIRED_BIKE_COURIER_SALARY, false),
                              })}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onHireCourier(courier.slotIndex, 'bike_and_van')}
                            className="w-full px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono-nums flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                          >
                            <Car className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              {t(language, 'company.hireVanBtn', {
                                salary: formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false),
                              })}
                            </span>
                          </button>
                        </div>
                      </article>
                    );
                  }

                  // 3. Locked Slot
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
                              {t(language, 'company.lockedSlotHeading', {
                                slot: courier.slotIndex,
                              })}
                            </h4>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-semibold shrink-0">
                            {t(language, 'company.lockedBadge')}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-400 leading-snug">
                          {isNextToUnlock
                            ? t(language, 'company.lockedNextDesc', { slot: courier.slotIndex })
                            : t(language, 'company.lockedPrevDesc', {
                                prevSlot: courier.slotIndex - 1,
                              })}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                        <div className="min-w-0 leading-tight">
                          {!canBuyLicense && (
                            <span
                              className={`block text-[11px] font-semibold font-mono-nums ${
                                !isNextToUnlock ? 'text-amber-300' : 'text-rose-300'
                              }`}
                            >
                              {!isNextToUnlock
                                ? t(language, 'company.requiresPrevLicense', {
                                    prevSlot: courier.slotIndex - 1,
                                  })
                                : formatMissingFunds(licenseCost, economyState.balance, language)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={!canBuyLicense}
                          onClick={onBuyEmployeeLicense}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-nums shrink-0 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                            canBuyLicense
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                          }`}
                        >
                          {t(language, 'company.buyLicenseBtn', {
                            amount: formatCurrencyUsd(licenseCost, false),
                          })}
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
