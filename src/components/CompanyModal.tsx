import React, { useEffect, useMemo } from 'react';
import { Backpack, Bike, Building2, Warehouse, X } from 'lucide-react';
import type { OrderEconomyState } from '../types/orders';
import {
  BIKE_COURIER_CAPACITY,
  MAX_WAREHOUSE_TIER,
  calculateMonthlyCompanyCosts,
  formatCurrencyUsd,
  getWarehouseTierConfig,
} from '../utils/orderEconomy';

interface CompanyModalProps {
  isOpen: boolean;
  economyState: OrderEconomyState;
  onClose: () => void;
}

export const CompanyModal: React.FC<CompanyModalProps> = ({
  isOpen,
  economyState,
  onClose,
}) => {
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

  const monthlyCosts = useMemo(
    () => calculateMonthlyCompanyCosts(economyState),
    [economyState]
  );

  const warehouseConfig = useMemo(
    () => getWarehouseTierConfig(economyState.warehouseTier),
    [economyState.warehouseTier]
  );

  const bikeCouriersCount = useMemo(
    () =>
      economyState.employees.filter(
        (emp) => emp.role === 'owner_bike_courier' || emp.role === 'bike_courier'
      ).length,
    [economyState.employees]
  );

  const vanDriversCount = useMemo(
    () => economyState.employees.filter((emp) => emp.role === 'van_driver').length,
    [economyState.employees]
  );

  const costsBreakdownTitle = useMemo(() => {
    const parts: string[] = [
      `Utrzymanie Bazy: ${formatCurrencyUsd(monthlyCosts.baseUpkeepAndTaxCost, false)}`,
    ];
    if (monthlyCosts.salariesCost > 0) {
      parts.push(`Pensje: ${formatCurrencyUsd(monthlyCosts.salariesCost, false)}`);
    }
    if (monthlyCosts.courierInsuranceCost > 0) {
      parts.push(
        `Ubezp. kurierów: ${formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false)}`
      );
    }
    if (monthlyCosts.vanInsuranceCost > 0) {
      parts.push(
        `Ubezp. aut: ${formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false)}`
      );
    }
    return parts.join(' | ');
  }, [monthlyCosts]);

  if (!isOpen) return null;

  const fleetLabel =
    vanDriversCount > 0
      ? `${bikeCouriersCount}x Kurier rowerowy, ${vanDriversCount}x Kierowca`
      : `${Math.max(1, bikeCouriersCount)}x Kurier rowerowy`;

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
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 [@media(max-height:540px)]:px-2.5 [@media(max-height:540px)]:py-1.5 bg-[#182030] border-b border-slate-700/80">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <h2
              id="company-modal-heading"
              className="text-sm font-bold text-slate-100 truncate"
            >
              Firma
            </h2>
            <span className="hidden sm:inline text-xs text-slate-400 truncate">
              • Stan przedsiębiorstwa i rozbudowa
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

        {/* Scrollable Content */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain p-2.5 sm:p-3 [@media(max-height:540px)]:p-2 space-y-2.5"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* Current Company Status Summary */}
          <section
            aria-label="Aktualny stan firmy"
            className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          >
            <div className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5">
              <p className="text-[11px] text-slate-400">Gotówka</p>
              <p className="mt-0.5 text-sm font-bold text-emerald-400 font-mono-nums truncate">
                {formatCurrencyUsd(economyState.balance)}
              </p>
            </div>

            <div
              className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5"
              title={costsBreakdownTitle}
            >
              <p className="text-[11px] text-slate-400">Koszty stałe / mies.</p>
              <p className="mt-0.5 text-sm font-bold text-rose-400 font-mono-nums truncate">
                -{formatCurrencyUsd(monthlyCosts.totalFixedCosts, false)}
              </p>
            </div>

            <div className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5">
              <p className="text-[11px] text-slate-400">Aktualna flota</p>
              <p className="mt-0.5 text-xs font-bold text-slate-100 truncate">
                {fleetLabel}
              </p>
              <p className="text-[11px] text-slate-400 font-mono-nums truncate">
                Ładowność: {BIKE_COURIER_CAPACITY} paczek
              </p>
            </div>

            <div className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5">
              <p className="text-[11px] text-slate-400">Magazyn w Bazie</p>
              <p className="mt-0.5 text-xs font-bold text-amber-300 truncate">
                Poz. {economyState.warehouseTier}/{MAX_WAREHOUSE_TIER}
              </p>
              <p className="text-[11px] text-slate-400 font-mono-nums truncate">
                {economyState.warehousePackages}/{economyState.warehouseCapacity} paczek
              </p>
            </div>
          </section>

          {/* Expansion Section Cards (Prepared for Upcoming Updates) */}
          <section
            aria-label="Sekcje rozbudowy firmy"
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            {/* 1. Flota i kurierzy */}
            <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 flex flex-col justify-between gap-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Bike className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                    <h3 className="text-xs font-bold text-slate-100 truncate">
                      Flota i kurierzy
                    </h3>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0">
                    Wkrótce
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Zatrudnianie dodatkowych kurierów rowerowych, zakup rowerów oraz floty aut
                  dostawczych z kierowcami.
                </p>
              </div>
              <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono-nums text-slate-300">
                <span>Personel: {economyState.employees.length}/{economyState.maxEmployees}</span>
                <span>Rowery: {economyState.bicyclesCount}</span>
              </div>
            </article>

            {/* 2. Wyposażenie kuriera */}
            <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 flex flex-col justify-between gap-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Backpack className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                    <h3 className="text-xs font-bold text-slate-100 truncate">
                      Wyposażenie kuriera
                    </h3>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0">
                    Wkrótce
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Ulepszenia plecaków kurierskich, bagażników i napędów elektrycznych zwiększające
                  pojemność i tempo kursów.
                </p>
              </div>
              <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono-nums text-slate-300">
                <span>Pojemność: {BIKE_COURIER_CAPACITY} szt.</span>
                <span>Poziom bazowy</span>
              </div>
            </article>

            {/* 3. Magazyn i Baza */}
            <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 flex flex-col justify-between gap-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Warehouse className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                    <h3 className="text-xs font-bold text-slate-100 truncate">
                      Magazyn i Baza
                    </h3>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300 shrink-0">
                    Wkrótce
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Rozbudowa hali magazynowej Bazy oraz wykup dodatkowych miejsc parkingowych dla
                  pojazdów firmowych.
                </p>
              </div>
              <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono-nums text-slate-300 gap-2">
                <span className="truncate">{warehouseConfig.name}</span>
                <span className="shrink-0">Parking: {economyState.parkingSpots}</span>
              </div>
            </article>
          </section>
        </div>
      </div>
    </div>
  );
};
