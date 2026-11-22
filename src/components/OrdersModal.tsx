import React, { useEffect, useMemo, useState } from 'react';
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
  MONTHLY_FIXED_COSTS,
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
    orderId: string,
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
  const unreadOffersCount = useMemo(() => countUnreadOffers(economyState), [economyState]);

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
  const monthlyNetForecast = roundCurrency(accruedLongTerm - MONTHLY_FIXED_COSTS);

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
              <span className="font-mono-nums font-semibold text-rose-400 whitespace-nowrap">
                -{formatCurrencyUsd(MONTHLY_FIXED_COSTS, false)}
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
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PLAN TYGODNIA — unified 7-column grid with no horizontal scrolling */}
          {activeTab === 'schedule' && (
            <div id="panel-schedule" role="tabpanel" aria-labelledby="tab-schedule">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 px-0.5">
                <span>
                  Zadania z aktywnych umów trafiają tu automatycznie. Kolejność w kolumnie dnia ustala priorytet dla kuriera.
                </span>
                <span className="font-mono-nums text-slate-300">
                  Dziś: {clock.weekday} | {clock.dayOfMonth} {clock.monthName}
                </span>
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-2 items-start">
                {weeklyColumns.map((day) => (
                  <section
                    key={day.weekdayIndex}
                    aria-label={`${day.weekdayName}, ${day.dateLabel}`}
                    className={`min-w-0 rounded-xl border p-1 sm:p-2 flex flex-col gap-1.5 sm:gap-2 ${
                      day.isToday
                        ? 'bg-[#1a2438] border-amber-400/80'
                        : 'bg-[#172030] border-slate-800'
                    }`}
                  >
                    {/* Compact Day Column Header (Pon – Nd) */}
                    <div className="pb-1.5 border-b border-slate-800/90 text-center sm:text-left">
                      <div className="flex items-center justify-center sm:justify-between gap-1 min-w-0">
                        <h3
                          className={`text-[11px] sm:text-xs font-bold truncate ${
                            day.isToday ? 'text-amber-300' : 'text-slate-100'
                          }`}
                        >
                          {day.weekdayShort}
                        </h3>
                        {day.isToday && (
                          <span className="hidden sm:inline text-[10px] font-bold text-amber-300 shrink-0">
                            Dziś
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center justify-center sm:justify-between gap-1 text-[10px] text-slate-400 font-mono-nums">
                        <span className="truncate">{day.dateLabel}</span>
                        <span className="hidden md:inline shrink-0">{day.tasks.length}</span>
                      </div>
                    </div>

                    {/* Scheduled Tasks List */}
                    {day.tasks.length === 0 ? (
                      <p className="py-3 text-center text-[10px] sm:text-xs text-slate-500 leading-tight">
                        <span className="sm:hidden">—</span>
                        <span className="hidden sm:inline">Brak zadań</span>
                      </p>
                    ) : (
                      <ol className="flex flex-col gap-1.5">
                        {day.tasks.map((task, idx) => {
                          const isFirst = idx === 0;
                          const isLast = idx === day.tasks.length - 1;
                          return (
                            <li
                              key={`${day.weekdayIndex}-${task.orderId}`}
                              className="min-w-0 rounded-lg bg-slate-900/75 border border-slate-800/90 p-1 sm:p-2 flex flex-col gap-1"
                            >
                              <div className="min-w-0">
                                <div className="flex items-baseline gap-1 min-w-0">
                                  <span className="font-mono-nums text-[10px] sm:text-xs font-bold text-amber-400 shrink-0">
                                    #{task.priorityRank}
                                  </span>
                                  <span
                                    title={task.clientName}
                                    className="text-[10px] sm:text-xs font-semibold text-slate-100 truncate"
                                  >
                                    {task.clientName}
                                  </span>
                                </div>
                                <p
                                  title={task.pickupAddress}
                                  className="hidden sm:block mt-0.5 text-[11px] text-slate-400 truncate"
                                >
                                  {task.pickupAddress}
                                </p>
                                <p className="mt-0.5 text-[10px] sm:text-[11px] text-slate-300 font-mono-nums truncate">
                                  <span className="md:hidden">{task.packageCount} szt.</span>
                                  <span className="hidden md:inline">
                                    {task.taskLabel} | {formatPolishPackages(task.packageCount)}
                                  </span>
                                </p>
                              </div>

                              {/* Priority Reorder Controls (min 40px touch height, fits inside 7-col grid) */}
                              <div className="flex flex-col sm:grid sm:grid-cols-2 gap-1 pt-0.5">
                                <button
                                  type="button"
                                  disabled={isFirst}
                                  onClick={() =>
                                    onMoveWeeklyTaskPriority(
                                      day.weekdayIndex,
                                      task.orderId,
                                      'up'
                                    )
                                  }
                                  aria-label={`Zwiększ priorytet w ${day.weekdayName}: ${task.clientName}`}
                                  title="Wyżej w kolejności"
                                  className={`min-h-[40px] w-full rounded-md text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
                                      day.weekdayIndex,
                                      task.orderId,
                                      'down'
                                    )
                                  }
                                  aria-label={`Zmniejsz priorytet w ${day.weekdayName}: ${task.clientName}`}
                                  title="Niżej w kolejności"
                                  className={`min-h-[40px] w-full rounded-md text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
                ))}
              </div>
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
}

const ActiveOrderCard: React.FC<ActiveOrderCardProps> = ({ order, gameMinutes }) => {
  const isLongTerm = order.kind === 'long_term';
  const remainingText = formatTimeRemaining(order.endMinutes, gameMinutes);
  const endDate = getCalendarDateFromGameDay(order.endGameDay);
  const satisfactionVis = getSatisfactionVisuals(order.satisfaction);

  const weeklyTarget = order.weekly.expectedPackagesThisWeek;
  const pickedUpThisWeek = order.weekly.pickedUpPackagesThisWeek;
  const deliveredThisWeek = order.weekly.deliveredPackagesThisWeek;

  return (
    <article className="flex flex-col justify-between rounded-xl bg-[#182030] border border-slate-700/85 p-4 gap-3.5">
      <div className="space-y-2.5">
        {/* Top Metadata & Remaining Time */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <span className={isLongTerm ? 'text-sky-300' : 'text-amber-300'}>
              {isLongTerm ? `Kontrakt ${order.durationMonths} mies.` : 'Zlecenie krótkoterminowe'}
            </span>
            <span className="text-slate-600" aria-hidden="true">|</span>
            <span className="text-slate-300 font-mono-nums">
              {formatCurrencyUsd(order.ratePerPackage)}
            </span>
          </div>
          <span className="text-slate-300 font-mono-nums">
            Pozostało: {remainingText} | do {endDate.dayOfMonth} {endDate.monthShort}
          </span>
        </div>

        {/* Client Name & Pickup Address */}
        <div>
          <h3 className="text-base font-bold text-slate-100 leading-snug">{order.clientName}</h3>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-400">
            Adres odbioru: <span className="text-slate-200">{order.pickupLocation.address}</span>
          </p>
        </div>

        {/* Weekly Progress & Payout */}
        <div className="pt-2.5 border-t border-slate-800 space-y-2 text-xs sm:text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-slate-400">Postęp w tym tygodniu:</span>
            <span className="font-semibold text-slate-100 font-mono-nums">
              Odebrano: {pickedUpThisWeek}/{weeklyTarget} | Dostarczono: {deliveredThisWeek}/
              {weeklyTarget}
            </span>
          </div>

          {order.kind === 'short_term' && order.totalPackages !== weeklyTarget && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="text-slate-400">Postęp całkowity zlecenia:</span>
              <span className="text-slate-300 font-mono-nums">
                Dostarczono: {order.deliveredPackagesTotal}/{order.totalPackages} paczek
              </span>
            </div>
          )}

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
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>Ocena tygodniowa: Nd 23:59</span>
          <span>Zerwanie umowy: poniżej 20%</span>
        </div>
      </div>
    </article>
  );
};
