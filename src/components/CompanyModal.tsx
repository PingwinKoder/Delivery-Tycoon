import React, { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Building2,
  Car,
  ParkingSquare,
  Truck,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import type { OrderEconomyState } from '../types/orders';
import {
  BICYCLE_PURCHASE_COST,
  BIKE_COURIER_CAPACITY,
  COURIER_INSURANCE_COST,
  MAX_BICYCLES,
  MAX_EMPLOYEES,
  MAX_PARKING_SPOTS,
  MAX_WAREHOUSE_TIER,
  PARKING_SPOT_COST,
  WAREHOUSE_TIERS,
  calculateMonthlyCompanyCosts,
  formatCurrencyUsd,
  getNextParkingSpotUpgrade,
  getNextWarehouseUpgrade,
  getWarehouseTierConfig,
} from '../utils/orderEconomy';

type CompanyTabId = 'base' | 'fleet' | 'employees';

interface CompanyModalProps {
  isOpen: boolean;
  economyState: OrderEconomyState;
  onClose: () => void;
  onUpgradeWarehouse: () => void;
  onBuyParkingSpot: () => void;
  onBuyBicycle: () => void;
}

export const CompanyModal: React.FC<CompanyModalProps> = ({
  isOpen,
  economyState,
  onClose,
  onUpgradeWarehouse,
  onBuyParkingSpot,
  onBuyBicycle,
}) => {
  const [activeTab, setActiveTab] = useState<CompanyTabId>('base');

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const warehouseLevel = economyState.warehouseLevel ?? economyState.warehouseTier;
  const bikesCount = economyState.bikesCount ?? economyState.bicyclesCount;

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
    if (monthlyCosts.salariesCost > 0) {
      parts.push(`Pensje: ${formatCurrencyUsd(monthlyCosts.salariesCost, false)}`);
    }
    if (monthlyCosts.vanInsuranceCost > 0) {
      parts.push(`Ubezp. aut: ${formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false)}`);
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
                {economyState.warehousePackages}/{economyState.warehouseCapacity} szt.
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
              <span className="text-slate-400">Parkingi: </span>
              <span className="font-bold text-slate-100 font-mono-nums">
                {economyState.parkingSpots}/{MAX_PARKING_SPOTS}
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

              {/* Card 2: Bus dostawczy 20 paczek (Preview Stage 2) */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2.5 flex flex-col justify-between gap-2.5 opacity-90">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Car className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        Bus dostawczy
                      </h3>
                    </div>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0 whitespace-nowrap">
                      Wkrótce (Etap 2)
                    </span>
                  </div>

                  <p className="text-[11px] font-semibold text-slate-200">
                    Klasa 20 paczek — warianty Lite / Standard / Pro
                  </p>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Szybkie dostawy większych partii paczek w jednym kursie. Wymaga wolnego miejsca
                    parkingowego przy Bazie.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono-nums text-slate-400">
                  <span>Ładowność: 20 paczek</span>
                  <span>Parkingi: {economyState.parkingSpots}/{MAX_PARKING_SPOTS}</span>
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
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Users className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                    <h3 className="text-xs sm:text-sm font-bold text-slate-100">
                      Zespół kurierów ({economyState.employees.length} / {MAX_EMPLOYEES})
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0">
                    Wkrótce (Etap 3)
                  </span>
                </div>

                <div className="rounded-md bg-slate-900/75 border border-slate-800 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bike className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-100 truncate">
                        Właściciel — Kurier rowerowy
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Stanowisko startowe • obsługuje zlecenia na rowerze firmowym
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-bold font-mono-nums text-[11px] shrink-0">
                    $0/mies.
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-snug">
                  W kolejnym etapie pojawią się licencje pracownicze odblokowujące stanowiska{' '}
                  <span className="text-slate-200 font-mono-nums">2–{MAX_EMPLOYEES}</span> oraz
                  możliwość zatrudniania dodatkowych kurierów rowerowych i kierowców busów.
                </p>
              </article>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
