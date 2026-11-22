import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ClipboardList, Files, X } from 'lucide-react';
import type { ActiveOrder, OrderEconomyState, OrderOffer } from '../types/orders';
import {
  DAYS_PER_WEEK,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  POLISH_MONTHS,
  POLISH_WEEKDAYS,
  POLISH_WEEKDAYS_SHORT,
  getCalendarDateFromGameDay,
  getGameClockDisplay,
} from '../utils/gameClock';
import {
  calculateMonthlyCompanyCosts,
  countUnreadOffers,
  formatCurrencyUsd,
  getScheduledTasksForWeekday,
  roundCurrency,
} from '../utils/orderEconomy';

type OrdersTabId = 'offers' | 'active' | 'schedule';

interface OrdersModalProps {
  isOpen: boolean;
  economyState: OrderEconomyState;
  gameMinutes: number;
  onClose: () => void;
  onMarkOffersSeen: () => void;
  onAcceptOffer: (offerId: string) => void;
  onRejectOffer: (offerId: string) => void;
  onMoveWeeklyTaskPriority: (
    weekdayIndex: number,
    taskId: string,
    direction: 'up' | 'down'
  ) => void;
}

function formatDurationLabel(offer: OrderOffer): string {
  if (offer.kind === 'long_term') {
    return `${offer.durationMonths} mies.`;
  }
  return offer.durationDays === 1 ? '1 dzień' : `${offer.durationDays} dni`;
}

function formatPolishPackages(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (abs === 1) return `${count} paczkę`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} paczki`;
  }
  return `${count} paczek`;
}

function formatPolishPackagesNominative(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (abs === 1) return `${count} paczka`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} paczki`;
  }
  return `${count} paczek`;
}

function formatWeekdaysList(weekdays: readonly number[]): string {
  return weekdays.map((wd) => POLISH_WEEKDAYS_SHORT[wd] ?? '').filter(Boolean).join(', ');
}

function formatTimeRemaining(targetMinutes: number, currentMinutes: number): string {
  const diffMin = Math.max(0, Math.floor(targetMinutes - currentMinutes));
  if (diffMin <= 0) return 'wygasa teraz';

  const totalHours = Math.floor(diffMin / MINUTES_PER_HOUR);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days >= 30) {
    const months = Math.floor(days / 30);
    const remDays = days % 30;
    if (remDays === 0) return `${months} mies.`;
    return `${months} mies. ${remDays} ${remDays === 1 ? 'dzień' : 'dni'}`;
  }
  if (days >= 1) {
    const dayWord = days === 1 ? 'dzień' : 'dni';
    return hours > 0 ? `${days} ${dayWord} ${hours} godz.` : `${days} ${dayWord}`;
  }
  if (totalHours >= 1) {
    return `${totalHours} godz.`;
  }
  return `${diffMin} min`;
}

function formatSatisfactionValue(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function getSatisfactionVisuals(satisfaction: number): {
  textClass: string;
  label: string;
} {
  if (satisfaction >= 75) {
    return {
      textClass: 'text-emerald-400',
      label: 'Wysokie',
    };
  }
  if (satisfaction >= 45) {
    return {
      textClass: 'text-amber-300',
      label: 'Średnie',
    };
  }
  if (satisfaction >= 20) {
    return {
      textClass: 'text-orange-400',
      label: 'Zagrożone',
    };
  }
  return {
    textClass: 'text-rose-400',
    label: 'Krytyczne',
  };
}

export const OrdersModal: React.FC<OrdersModalProps> = ({
  isOpen,
  economyState,
  gameMinutes,
  onClose,
  onMarkOffersSeen,
  onAcceptOffer,
  onRejectOffer,
  onMoveWeeklyTaskPriority,
}) => {
  const [activeTab, setActiveTab] = useState<OrdersTabId>('offers');

  const clock = useMemo(() => getGameClockDisplay(gameMinutes), [gameMinutes]);
  const [selectedWeekday, setSelectedWeekday] = useState<number>(clock.dayIndex);
  const latestDayIndexRef = useRef<number>(clock.dayIndex);
  latestDayIndexRef.current = clock.dayIndex;

  const unreadOffersCount = useMemo(() => countUnreadOffers(economyState), [economyState]);

  // Default Plan tygodnia selector to today whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedWeekday(latestDayIndexRef.current);
    }
  }, [isOpen]);

  // Mark all currently listed pending offers as seen immediately when the "Nowe oferty" tab is open
  useEffect(() => {
    if (isOpen && activeTab === 'offers' && unreadOffersCount > 0) {
      onMarkOffersSeen();
    }
  }, [isOpen, activeTab, unreadOffersCount, onMarkOffersSeen]);

  // Close modal on Escape key
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

  const nextMonthName = POLISH_MONTHS[(clock.monthIndex + 1) % 12].name;
  const accruedLongTerm = economyState.pendingMonthlyLongTermPayout;
  const monthlyCosts = useMemo(() => calculateMonthlyCompanyCosts(economyState), [economyState]);
  const monthlyNetForecast = roundCurrency(accruedLongTerm - monthlyCosts.totalFixedCosts);
  const monthlyCostsBreakdownTitle = useMemo(() => {
    const parts: string[] = [
      `Utrzymanie i podatek Bazy: ${formatCurrencyUsd(monthlyCosts.baseUpkeepAndTaxCost, false)}`,
    ];
    if (monthlyCosts.salariesCost > 0) {
      parts.push(`Pensje pracowników: ${formatCurrencyUsd(monthlyCosts.salariesCost, false)}`);
    }
    if (monthlyCosts.courierInsuranceCost > 0) {
      parts.push(
        `Ubezpieczenie kuriera: ${formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false)}`
      );
    }
    if (monthlyCosts.vanInsuranceCost > 0) {
      parts.push(
        `Ubezpieczenie kierowców i aut: ${formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false)}`
      );
    }
    return parts.join(' | ');
  }, [monthlyCosts]);

  const weeklyColumns = useMemo(() => {
    const weekMondayGameDay = clock.gameDay - clock.dayIndex;
    return Array.from({ length: DAYS_PER_WEEK }, (_, weekdayIndex) => {
      const date = getCalendarDateFromGameDay(weekMondayGameDay + weekdayIndex);
      const tasks = getScheduledTasksForWeekday(economyState, weekdayIndex, clock.gameDay);
      return {
        weekdayIndex,
        weekdayName: POLISH_WEEKDAYS[weekdayIndex],
        weekdayShort: POLISH_WEEKDAYS_SHORT[weekdayIndex],
        dateLabel: `${date.dayOfMonth} ${date.monthShort}`,
        isToday: weekdayIndex === clock.dayIndex,
        tasks,
      };
    });
  }, [economyState, clock.gameDay, clock.dayIndex]);

  const selectedDay = weeklyColumns[selectedWeekday] ?? weeklyColumns[clock.dayIndex] ?? weeklyColumns[0];

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-1.5 sm:p-4 bg-slate-950/70 backdrop-blur-[2px] touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orders-modal-heading"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-[96vw] max-w-6xl h-[min(90vh,780px)] flex flex-col rounded-2xl bg-[#131a27] border border-slate-700/90 shadow-2xl overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Company Status Bar (no reputation level displayed) */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 sm:px-5 py-2.5 bg-[#182030] border-b border-slate-700/80">
          <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1.5 text-xs sm:text-sm min-w-0">
            <h2 id="orders-modal-heading" className="sr-only">
              Panel zleceń firmy
            </h2>

            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-slate-400">Ukończone zlecenia:</span>
              <span className="font-bold text-slate-100 font-mono-nums">
                {economyState.completedOrdersCount}
              </span>
            </div>

            <span className="hidden sm:inline text-slate-600" aria-hidden="true">|</span>

            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-slate-400">Średnie zadowolenie (Rok {clock.year}):</span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {formatSatisfactionValue(economyState.annualSatisfactionAvg)}
              </span>
            </div>

            <span className="hidden md:inline text-slate-600" aria-hidden="true">|</span>

            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="text-slate-400 whitespace-nowrap">
                Rozliczenie 1 {nextMonthName}:
              </span>
              <span className="font-mono-nums font-semibold text-emerald-400 whitespace-nowrap">
                +{formatCurrencyUsd(accruedLongTerm, false)}
              </span>
              <span className="text-slate-500" aria-hidden="true">|</span>
              <span
                title={monthlyCostsBreakdownTitle}
                className="font-mono-nums font-semibold text-rose-400 whitespace-nowrap"
              >
                -{formatCurrencyUsd(monthlyCosts.totalFixedCosts, false)}
              </span>
              <span
                className={`font-mono-nums font-bold whitespace-nowrap ${
                  monthlyNetForecast >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                (netto {monthlyNetForecast >= 0 ? '+' : ''}
                {formatCurrencyUsd(monthlyNetForecast, false)})
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno Zlecenia"
            className="min-w-[40px] min-h-[40px] p-2 rounded-lg flex items-center justify-center shrink-0 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="px-3 sm:px-5 py-2.5 bg-[#151d2c] border-b border-slate-800">
          <div
            className="flex items-center gap-2 overflow-x-auto overscroll-x-contain pb-0.5 sm:pb-0"
            role="tablist"
            aria-label="Zakładki panelu zleceń"
          >
            <button
              id="tab-offers"
              type="button"
              role="tab"
              aria-selected={activeTab === 'offers'}
              aria-controls="panel-offers"
              onClick={() => setActiveTab('offers')}
              className={`relative min-h-[40px] px-3.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'offers'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Files className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Nowe oferty</span>
              <span
                className={`font-mono-nums ${
                  activeTab === 'offers' ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                ({economyState.pendingOffers.length})
              </span>
              {activeTab !== 'offers' && unreadOffersCount > 0 && (
                <span
                  aria-label={`${unreadOffersCount} nieprzeczytanych`}
                  className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold font-mono-nums inline-flex items-center justify-center"
                >
                  {unreadOffersCount}
                </span>
              )}
            </button>

            <button
              id="tab-active"
              type="button"
              role="tab"
              aria-selected={activeTab === 'active'}
              aria-controls="panel-active"
              onClick={() => setActiveTab('active')}
              className={`min-h-[40px] px-3.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'active'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <ClipboardList className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Aktualne</span>
              <span
                className={`font-mono-nums ${
                  activeTab === 'active' ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                ({economyState.activeOrders.length})
              </span>
            </button>

            <button
              id="tab-schedule"
              type="button"
              role="tab"
              aria-selected={activeTab === 'schedule'}
              aria-controls="panel-schedule"
              onClick={() => setActiveTab('schedule')}
              className={`min-h-[40px] px-3.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'schedule'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <CalendarDays className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Plan tygodnia</span>
            </button>
          </div>
        </div>

        {/* Scrollable Tab Content Area */}
        <div
          className={`flex-1 overflow-y-auto overscroll-contain ${
            activeTab === 'schedule' ? 'p-2 sm:p-4' : 'p-3 sm:p-5'
          }`}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* TAB 1: NOWE OFERTY */}
          {activeTab === 'offers' && (
            <div id="panel-offers" role="tabpanel" aria-labelledby="tab-offers">
              {economyState.pendingOffers.length === 0 ? (
                <div className="py-12 px-4 text-center border border-slate-800 rounded-xl bg-slate-900/50">
                  <p className="text-sm sm:text-base font-semibold text-slate-200">
                    Brak oczekujących ofert zleceń
                  </p>
                  <p className="mt-1.5 text-xs sm:text-sm text-slate-400">
                    Nowe propozycje od lokalnych firm pojawią się automatycznie wraz z upływem dni.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {economyState.pendingOffers.map((offer) => (
                    <OfferCard
                      key={offer.id}
                      offer={offer}
                      gameMinutes={gameMinutes}
                      onAccept={onAcceptOffer}
                      onReject={onRejectOffer}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: AKTUALNE */}
          {activeTab === 'active' && (
            <div id="panel-active" role="tabpanel" aria-labelledby="tab-active">
              {economyState.activeOrders.length === 0 ? (
                <div className="py-12 px-4 text-center border border-slate-800 rounded-xl bg-slate-900/50">
                  <p className="text-sm sm:text-base font-semibold text-slate-200">
                    Brak aktywnych zleceń
                  </p>
                  <p className="mt-1.5 text-xs sm:text-sm text-slate-400">
                    Przejdź do zakładki „Nowe oferty”, aby przyjąć pierwsze zlecenie lub kontrakt.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {economyState.activeOrders.map((order) => (
                    <ActiveOrderCard
                      key={order.id}
                      order={order}
                      gameMinutes={gameMinutes}
                      storedInWarehouse={economyState.warehouseInventory[order.id] ?? 0}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PLAN TYGODNIA — two-tier layout: 7 day-selector tiles on top + full-width task list below */}
          {activeTab === 'schedule' && selectedDay && (
            <div id="panel-schedule" role="tabpanel" aria-labelledby="tab-schedule" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 px-0.5">
                <span>
                  Wybierz dzień tygodnia i ustaw priorytet osobnych zadań „Odbiór” oraz „Rozwózka” dla kuriera.
                </span>
                <span className="font-mono-nums text-slate-300">
                  Dziś: {clock.weekday} | {clock.dayOfMonth} {clock.monthName}
                </span>
              </div>

              {/* Tier 1: 7 Day-Selector Tiles (Pon – Nd) */}
              <div
                className="grid grid-cols-7 gap-1.5 sm:gap-2"
                role="group"
                aria-label="Wybór dnia tygodnia"
              >
                {weeklyColumns.map((day) => {
                  const isSelected = day.weekdayIndex === selectedDay.weekdayIndex;
                  return (
                    <button
                      key={day.weekdayIndex}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedWeekday(day.weekdayIndex)}
                      className={`min-w-0 min-h-[64px] sm:min-h-[72px] rounded-xl border px-1.5 sm:px-3 py-2 text-left flex flex-col justify-between gap-1 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-400 shadow-sm'
                          : day.isToday
                            ? 'bg-[#1a2438] border-amber-400/50 hover:border-amber-400/80'
                            : 'bg-[#172030] border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <span
                          className={`text-xs sm:text-sm font-bold truncate ${
                            isSelected || day.isToday ? 'text-amber-300' : 'text-slate-100'
                          }`}
                        >
                          {day.weekdayShort}
                        </span>
                        {day.isToday && (
                          <span className="hidden sm:inline px-1.5 py-0.5 rounded bg-amber-400/20 text-[10px] font-bold text-amber-300 shrink-0 leading-none">
                            Dziś
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 text-[10px] sm:text-xs font-mono-nums">
                        <span className={isSelected ? 'text-slate-200' : 'text-slate-400'}>
                          {day.dateLabel}
                        </span>
                        <span
                          className={`font-semibold shrink-0 ${
                            day.tasks.length > 0
                              ? isSelected
                                ? 'text-amber-200'
                                : 'text-slate-200'
                              : 'text-slate-500'
                          }`}
                        >
                          <span className="sm:hidden">{day.tasks.length}</span>
                          <span className="hidden sm:inline">{day.tasks.length} zad.</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Tier 2: Full-Width Horizontal Task List for the Selected Day */}
              <section
                aria-label={`Zadania na ${selectedDay.weekdayName}, ${selectedDay.dateLabel}`}
                className="rounded-xl bg-[#151d2c] border border-slate-800/90 p-3 sm:p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-100">
                      {selectedDay.weekdayName}, {selectedDay.dateLabel}
                    </h3>
                    {selectedDay.isToday && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-[11px] font-bold text-amber-300">
                        Dziś
                      </span>
                    )}
                  </div>
                  <span className="text-xs sm:text-sm text-slate-400 font-mono-nums">
                    Liczba zadań: <strong className="text-slate-200">{selectedDay.tasks.length}</strong>
                  </span>
                </div>

                {selectedDay.tasks.length === 0 ? (
                  <div className="py-10 px-4 text-center rounded-lg bg-slate-900/45 border border-slate-800/80">
                    <p className="text-sm font-semibold text-slate-300">
                      Brak zaplanowanych zadań na ten dzień
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Przyjmij nowe oferty w zakładce „Nowe oferty” lub wybierz inny dzień powyżej.
                    </p>
                  </div>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {selectedDay.tasks.map((task, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === selectedDay.tasks.length - 1;
                      const isPickup = task.taskType === 'pickup';
                      return (
                        <li
                          key={`${selectedDay.weekdayIndex}-${task.taskId}`}
                          className="rounded-xl bg-[#182030] border border-slate-700/85 px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4"
                        >
                          {/* Left: Priority Rank, Distinct Stage Badge (ODBIÓR / ROZWÓZKA) & Package Count */}
                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 shrink-0">
                            <span className="font-mono-nums text-sm font-bold text-amber-400 min-w-[28px]">
                              #{task.priorityRank}
                            </span>
                            <span
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide uppercase border shrink-0 ${
                                isPickup
                                  ? 'bg-sky-500/15 text-sky-300 border-sky-400/40'
                                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                              }`}
                            >
                              {isPickup ? 'ODBIÓR' : 'ROZWÓZKA'}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold text-slate-200 font-mono-nums whitespace-nowrap min-w-[82px]">
                              {formatPolishPackagesNominative(task.packageCount)}
                            </span>
                          </div>

                          {/* Center: Full Client Name & Full Address (no truncation) */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm sm:text-base font-bold text-slate-100 leading-snug break-words">
                              {task.clientName}
                            </p>
                            <p className="mt-0.5 text-xs sm:text-sm text-slate-400 leading-snug break-words">
                              {task.pickupAddress}
                            </p>
                          </div>

                          {/* Right: Side-by-side Priority Reorder Controls (min 40x40px touch targets) */}
                          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                            <button
                              type="button"
                              disabled={isFirst}
                              onClick={() =>
                                onMoveWeeklyTaskPriority(
                                  selectedDay.weekdayIndex,
                                  task.taskId,
                                  'up'
                                )
                              }
                              aria-label={`Zwiększ priorytet w ${selectedDay.weekdayName}: ${task.taskLabel} – ${task.clientName}`}
                              title="Wyżej w kolejności"
                              className={`min-h-[40px] min-w-[40px] rounded-lg text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
                                isFirst
                                  ? 'bg-slate-900/50 text-slate-600 border-slate-800/80 cursor-not-allowed'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700 cursor-pointer'
                              }`}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={isLast}
                              onClick={() =>
                                onMoveWeeklyTaskPriority(
                                  selectedDay.weekdayIndex,
                                  task.taskId,
                                  'down'
                                )
                              }
                              aria-label={`Zmniejsz priorytet w ${selectedDay.weekdayName}: ${task.taskLabel} – ${task.clientName}`}
                              title="Niżej w kolejności"
                              className={`min-h-[40px] min-w-[40px] rounded-lg text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
                                isLast
                                  ? 'bg-slate-900/50 text-slate-600 border-slate-800/80 cursor-not-allowed'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700 cursor-pointer'
                              }`}
                            >
                              ▼
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Offer Card (Tab 1: Nowe oferty)
// ============================================================================

interface OfferCardProps {
  offer: OrderOffer;
  gameMinutes: number;
  onAccept: (offerId: string) => void;
  onReject: (offerId: string) => void;
}

const OfferCard: React.FC<OfferCardProps> = ({ offer, gameMinutes, onAccept, onReject }) => {
  const isLongTerm = offer.kind === 'long_term';
  const durationLabel = formatDurationLabel(offer);
  const expiresRemaining = formatTimeRemaining(offer.expiresAtMinutes, gameMinutes);
  const expiresUrgent = offer.expiresAtMinutes - gameMinutes < MINUTES_PER_DAY;

  return (
    <article className="flex flex-col justify-between rounded-xl bg-[#182030] border border-slate-700/85 p-4 gap-3.5">
      <div className="space-y-2.5">
        {/* Quiet Metadata Kicker (order type name only) & Expiry Countdown */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={`font-medium ${isLongTerm ? 'text-sky-300' : 'text-amber-300'}`}>
            {isLongTerm ? 'Zlecenie długoterminowe' : 'Zlecenie krótkoterminowe'}
          </span>
          <span
            className={`font-mono-nums ${
              expiresUrgent ? 'text-rose-400 font-semibold' : 'text-slate-400'
            }`}
          >
            Wygasa za: {expiresRemaining}
          </span>
        </div>

        {/* Client Name & Pickup Address */}
        <div>
          <h3 className="text-base font-bold text-slate-100 leading-snug">{offer.clientName}</h3>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-400">
            Adres odbioru: <span className="text-slate-200">{offer.pickupLocation.address}</span>
          </p>
        </div>

        {/* Key Terms Grid */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pt-2.5 border-t border-slate-800 text-xs sm:text-sm">
          <div>
            <dt className="text-slate-400">Czas realizacji | Ilość i rodzaj</dt>
            <dd className="mt-0.5 font-semibold text-slate-100 font-mono-nums">
              {offer.kind === 'long_term' ? (
                <>
                  {durationLabel} | {offer.packagesPerWeek} paczek/tydz. |{' '}
                  {formatWeekdaysList(offer.pickupWeekdays)}
                </>
              ) : (
                <>
                  {durationLabel} | {formatPolishPackages(offer.totalPackages)}
                </>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-slate-400">Stawka za paczkę</dt>
            <dd className="mt-0.5 font-bold text-slate-100 font-mono-nums">
              {formatCurrencyUsd(offer.ratePerPackage)}
            </dd>
          </div>

          <div className="sm:col-span-2 pt-1">
            <dt className="text-slate-400">
              {offer.kind === 'long_term'
                ? 'Przewidywana wartość kontraktu'
                : 'Przewidywana wypłata całkowita'}
            </dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="text-base font-bold text-emerald-400 font-mono-nums">
                {formatCurrencyUsd(
                  offer.kind === 'long_term' ? offer.totalContractValue : offer.totalExpectedPayout
                )}
              </span>
              {offer.kind === 'long_term' ? (
                <span className="text-xs text-slate-300 font-mono-nums">
                  {formatCurrencyUsd(offer.estimatedMonthlyPayout)} / mies. | płatne 1. dnia mies.
                </span>
              ) : (
                <span className="text-xs text-slate-400">
                  Wypłata po dostarczeniu ostatniej paczki
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2.5 pt-3 border-t border-slate-800">
        <button
          type="button"
          onClick={() => onAccept(offer.id)}
          className="flex-1 min-h-[42px] px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        >
          Przyjmij
        </button>
        <button
          type="button"
          onClick={() => onReject(offer.id)}
          className="min-h-[42px] px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          Odrzuć
        </button>
      </div>
    </article>
  );
};

// ============================================================================
// Active Order Card (Tab 2: Aktualne)
// ============================================================================

interface ActiveOrderCardProps {
  order: ActiveOrder;
  gameMinutes: number;
  storedInWarehouse: number;
}

const ActiveOrderCard: React.FC<ActiveOrderCardProps> = ({
  order,
  gameMinutes,
  storedInWarehouse,
}) => {
  const isLongTerm = order.kind === 'long_term';
  const remainingText = formatTimeRemaining(order.endMinutes, gameMinutes);
  const endDate = getCalendarDateFromGameDay(order.endGameDay);
  const satisfactionVis = getSatisfactionVisuals(order.satisfaction);

  const weeklyTarget = order.weekly.expectedPackagesThisWeek;
  const pickedUpThisWeek = order.weekly.pickedUpPackagesThisWeek;
  const deliveredThisWeek = order.weekly.deliveredPackagesThisWeek;

  const shortTermTotal = order.kind === 'short_term' ? order.totalPackages : weeklyTarget;
  const shortTermPickedUp =
    order.kind === 'short_term'
      ? Math.min(
          order.totalPackages,
          Math.max(order.deliveredPackagesTotal + storedInWarehouse, pickedUpThisWeek)
        )
      : pickedUpThisWeek;

  return (
    <article className="flex flex-col justify-between rounded-xl bg-[#182030] border border-slate-700/85 p-4 gap-3.5">
      <div className="space-y-2.5">
        {/* Top Metadata (order type only, no per-package rate) & Remaining Time */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={`font-medium ${isLongTerm ? 'text-sky-300' : 'text-amber-300'}`}>
            {isLongTerm ? 'Zlecenie długoterminowe' : 'Zlecenie krótkoterminowe'}
          </span>
          <span className="text-slate-300 font-mono-nums">
            {isLongTerm
              ? `Pozostało: ${remainingText} | do ${endDate.dayOfMonth} ${endDate.monthShort}`
              : `Pozostało: ${remainingText}`}
          </span>
        </div>

        {/* Client Name & Pickup Address */}
        <div>
          <h3 className="text-base font-bold text-slate-100 leading-snug">{order.clientName}</h3>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-400">
            Adres odbioru: <span className="text-slate-200">{order.pickupLocation.address}</span>
          </p>
        </div>

        {/* Progress & Payout */}
        <div className="pt-2.5 border-t border-slate-800 space-y-2 text-xs sm:text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-slate-400">
              {isLongTerm ? 'Postęp w tym tygodniu:' : 'Postęp:'}
            </span>
            <span className="font-semibold text-slate-100 font-mono-nums">
              {isLongTerm
                ? `Odebrano: ${pickedUpThisWeek}/${weeklyTarget} | Dostarczono: ${deliveredThisWeek}/${weeklyTarget}`
                : `Odebrano: ${shortTermPickedUp}/${shortTermTotal} | Dostarczono: ${order.deliveredPackagesTotal}/${shortTermTotal}`}
            </span>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-slate-400">
              {order.kind === 'long_term'
                ? 'Naliczone w bieżącym miesiącu:'
                : 'Przewidywana wypłata:'}
            </span>
            <span className="font-bold text-emerald-400 font-mono-nums">
              {order.kind === 'long_term' ? (
                <>
                  {formatCurrencyUsd(order.accruedMonthlyPayout)}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    | szac. {formatCurrencyUsd(order.estimatedMonthlyPayout)}/mies.
                  </span>
                </>
              ) : (
                formatCurrencyUsd(order.totalExpectedPayout)
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Individual Client Satisfaction Bar (0–100%) */}
      <div className="pt-3 border-t border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-300 font-medium">Zadowolenie klienta</span>
          <span className={`font-bold font-mono-nums ${satisfactionVis.textClass}`}>
            {order.satisfaction}% | {satisfactionVis.label}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Zadowolenie klienta ${order.clientName}`}
          aria-valuenow={order.satisfaction}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`h-2.5 w-full rounded-full bg-slate-800 overflow-hidden ${satisfactionVis.textClass}`}
        >
          <svg
            viewBox="0 0 100 10"
            preserveAspectRatio="none"
            className="block w-full h-full"
            aria-hidden="true"
          >
            <rect
              x="0"
              y="0"
              width={Math.max(0, Math.min(100, order.satisfaction))}
              height="10"
              rx="4"
              fill="currentColor"
            />
          </svg>
        </div>
        <div className="flex items-center justify-end text-[11px] text-slate-400">
          <span>Zerwanie umowy: poniżej 20%</span>
        </div>
      </div>
    </article>
  );
};
