import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, CalendarDays, Check, ClipboardList, Files, X } from 'lucide-react';
import {
  getMonthName,
  getWeekdayName,
  t,
  translateOrderText,
} from '../i18n/translations';
import type {
  ActiveOrder,
  OrderEconomyState,
  OrderOffer,
  WeeklyScheduleTask,
} from '../types/orders';
import {
  DAYS_PER_WEEK,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
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
import type { SupportedLanguage } from '../utils/settingsSystem';

type OrdersTabId = 'offers' | 'active' | 'schedule';

interface OrdersModalProps {
  isOpen: boolean;
  language: SupportedLanguage;
  economyState: OrderEconomyState;
  gameMinutes: number;
  taskAssignmentsByTaskId?: Readonly<Record<string, number>>;
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

function formatDurationLabel(offer: OrderOffer, lang: SupportedLanguage): string {
  if (offer.kind === 'long_term') {
    return t(lang, 'orders.durationMonths', { months: offer.durationMonths });
  }
  return offer.durationDays === 1
    ? t(lang, 'orders.durationDaysOne')
    : t(lang, 'orders.durationDaysMany', { days: offer.durationDays });
}

function formatLocalizedPackages(count: number, lang: SupportedLanguage): string {
  const abs = Math.abs(count);
  if (lang === 'en') {
    return abs === 1 ? `${count} package` : `${count} packages`;
  }
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (abs === 1) return `${count} paczkę`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} paczki`;
  }
  return `${count} paczek`;
}

function formatWeekdaysList(weekdays: readonly number[], lang: SupportedLanguage): string {
  return weekdays
    .map((wd) => getWeekdayName(lang, wd, true))
    .filter(Boolean)
    .join(', ');
}

function formatTimeRemaining(
  targetMinutes: number,
  currentMinutes: number,
  lang: SupportedLanguage
): string {
  const diffMin = Math.max(0, Math.floor(targetMinutes - currentMinutes));
  if (diffMin <= 0) return t(lang, 'orders.expiresNow');

  const totalHours = Math.floor(diffMin / MINUTES_PER_HOUR);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days >= 30) {
    const months = Math.floor(days / 30);
    const remDays = days % 30;
    if (remDays === 0) return t(lang, 'orders.timeMonthsOnly', { months });
    const dayWord =
      remDays === 1 ? t(lang, 'orders.daySingular') : t(lang, 'orders.dayPlural');
    return t(lang, 'orders.timeMonthsDays', { months, days: remDays, dayWord });
  }
  if (days >= 1) {
    const dayWord =
      days === 1 ? t(lang, 'orders.daySingular') : t(lang, 'orders.dayPlural');
    return hours > 0
      ? t(lang, 'orders.timeDaysHours', { days, dayWord, hours })
      : t(lang, 'orders.timeDaysOnly', { days, dayWord });
  }
  if (totalHours >= 1) {
    return t(lang, 'orders.timeHoursOnly', { hours: totalHours });
  }
  return t(lang, 'orders.timeMinutesOnly', { minutes: diffMin });
}

function formatSatisfactionValue(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function getSatisfactionVisuals(
  satisfaction: number,
  lang: SupportedLanguage
): {
  textClass: string;
  label: string;
} {
  if (satisfaction >= 75) {
    return {
      textClass: 'text-emerald-400',
      label: t(lang, 'orders.satHigh'),
    };
  }
  if (satisfaction >= 45) {
    return {
      textClass: 'text-amber-300',
      label: t(lang, 'orders.satMedium'),
    };
  }
  if (satisfaction >= 20) {
    return {
      textClass: 'text-orange-400',
      label: t(lang, 'orders.satRisk'),
    };
  }
  return {
    textClass: 'text-rose-400',
    label: t(lang, 'orders.satCritical'),
  };
}

export const OrdersModal: React.FC<OrdersModalProps> = ({
  isOpen,
  language,
  economyState,
  gameMinutes,
  taskAssignmentsByTaskId,
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

  // Default Weekly Plan selector to today whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedWeekday(latestDayIndexRef.current);
    }
  }, [isOpen]);

  // Mark all currently listed pending offers as seen immediately when the "New Offers" tab is open
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

  const nextMonthName = getMonthName(language, (clock.monthIndex + 1) % 12, false);
  const accruedLongTerm = economyState.pendingMonthlyLongTermPayout;
  const monthlyCosts = useMemo(() => calculateMonthlyCompanyCosts(economyState), [economyState]);
  const monthlyNetForecast = roundCurrency(accruedLongTerm - monthlyCosts.totalFixedCosts);
  const monthlyCostsBreakdownTitle = useMemo(() => {
    const warehouseLevel = economyState.warehouseLevel ?? economyState.warehouseTier;
    const parts: string[] = [
      t(language, 'orders.costBaseUpkeep', {
        level: warehouseLevel,
        amount: formatCurrencyUsd(monthlyCosts.baseUpkeepAndTaxCost, false),
      }),
    ];
    if (monthlyCosts.salariesCost > 0) {
      parts.push(
        t(language, 'orders.costSalaries', {
          amount: formatCurrencyUsd(monthlyCosts.salariesCost, false),
        })
      );
    }
    if (monthlyCosts.courierInsuranceCost > 0) {
      parts.push(
        t(language, 'orders.costBikeInsurance', {
          amount: formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false),
        })
      );
    }
    if (monthlyCosts.vanInsuranceCost > 0) {
      parts.push(
        t(language, 'orders.costVanInsurance', {
          amount: formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false),
        })
      );
    }
    return parts.join(' | ');
  }, [language, monthlyCosts, economyState.warehouseLevel, economyState.warehouseTier]);

  const weeklyColumns = useMemo(() => {
    const weekMondayGameDay = clock.gameDay - clock.dayIndex;
    return Array.from({ length: DAYS_PER_WEEK }, (_, weekdayIndex) => {
      const date = getCalendarDateFromGameDay(weekMondayGameDay + weekdayIndex);
      const isToday = weekdayIndex === clock.dayIndex;
      const rawTasks = getScheduledTasksForWeekday(economyState, weekdayIndex, clock.gameDay);
      const tasks: WeeklyScheduleTask[] = isToday
        ? rawTasks.map((task) => {
            const assignedCourierId =
              taskAssignmentsByTaskId?.[task.taskId] ?? taskAssignmentsByTaskId?.[task.orderId];
            return assignedCourierId !== undefined
              ? { ...task, assignedCourierId }
              : task;
          })
        : rawTasks;
      return {
        weekdayIndex,
        weekdayName: getWeekdayName(language, weekdayIndex, false),
        weekdayShort: getWeekdayName(language, weekdayIndex, true),
        dateLabel: `${date.dayOfMonth} ${getMonthName(language, date.monthIndex, true)}`,
        isToday,
        tasks,
      };
    });
  }, [economyState, clock.gameDay, clock.dayIndex, taskAssignmentsByTaskId, language]);

  const selectedDay = weeklyColumns[selectedWeekday] ?? weeklyColumns[clock.dayIndex] ?? weeklyColumns[0];

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-3 [@media(max-height:540px)]:p-1.5 bg-slate-950/80 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orders-modal-heading"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-[94vw] max-w-4xl h-[min(84vh,680px)] max-h-[84vh] [@media(max-height:540px)]:h-[95vh] [@media(max-height:540px)]:max-h-[95vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-lg overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Single-Line Company Status Bar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 [@media(max-height:540px)]:px-2.5 [@media(max-height:540px)]:py-1.5 bg-[#182030] border-b border-slate-700/80">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs min-w-0 leading-tight">
            <h2 id="orders-modal-heading" className="sr-only">
              {t(language, 'orders.headingSr')}
            </h2>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'orders.completed')} </span>
              <span className="font-bold text-slate-100 font-mono-nums">
                {economyState.completedOrdersCount}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">
                {t(language, 'orders.satisfactionYear', { year: clock.year })}{' '}
              </span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {formatSatisfactionValue(economyState.annualSatisfactionAvg)}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-slate-400 whitespace-nowrap">
                {t(language, 'orders.settlementDate', { month: nextMonthName })}
              </span>
              <span className="font-mono-nums font-semibold text-emerald-400 whitespace-nowrap">
                +{formatCurrencyUsd(accruedLongTerm, false)}
              </span>
              <span className="text-slate-500" aria-hidden="true">/</span>
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
                ({monthlyNetForecast >= 0 ? '+' : ''}
                {formatCurrencyUsd(monthlyNetForecast, false)})
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'orders.closeAria')}
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
            aria-label={t(language, 'orders.tabsAria')}
          >
            <button
              id="tab-offers"
              type="button"
              role="tab"
              aria-selected={activeTab === 'offers'}
              aria-controls="panel-offers"
              onClick={() => setActiveTab('offers')}
              className={`relative px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'offers'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Files className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(language, 'orders.tabOffers')}</span>
              <span
                className={`font-mono-nums ${
                  activeTab === 'offers' ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                ({economyState.pendingOffers.length})
              </span>
              {activeTab !== 'offers' && unreadOffersCount > 0 && (
                <span
                  aria-label={t(language, 'orders.unreadCountAria', { count: unreadOffersCount })}
                  className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold font-mono-nums inline-flex items-center justify-center"
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
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'active'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(language, 'orders.tabActive')}</span>
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
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'schedule'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(language, 'orders.tabSchedule')}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Tab Content Area */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain p-2.5 sm:p-3 [@media(max-height:540px)]:p-2"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* TAB 1: NEW OFFERS */}
          {activeTab === 'offers' && (
            <div id="panel-offers" role="tabpanel" aria-labelledby="tab-offers">
              {economyState.pendingOffers.length === 0 ? (
                <div className="py-8 px-4 text-center border border-slate-800 rounded-lg bg-slate-900/60">
                  <p className="text-xs sm:text-sm font-semibold text-slate-200">
                    {t(language, 'orders.offersEmptyTitle')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t(language, 'orders.offersEmptyDesc')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {economyState.pendingOffers.map((offer) => (
                    <OfferCard
                      key={offer.id}
                      offer={offer}
                      language={language}
                      gameMinutes={gameMinutes}
                      onAccept={onAcceptOffer}
                      onReject={onRejectOffer}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ACTIVE ORDERS */}
          {activeTab === 'active' && (
            <div id="panel-active" role="tabpanel" aria-labelledby="tab-active">
              {economyState.activeOrders.length === 0 ? (
                <div className="py-8 px-4 text-center border border-slate-800 rounded-lg bg-slate-900/60">
                  <p className="text-xs sm:text-sm font-semibold text-slate-200">
                    {t(language, 'orders.activeEmptyTitle')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t(language, 'orders.activeEmptyDesc')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {economyState.activeOrders.map((order) => (
                    <ActiveOrderCard
                      key={order.id}
                      order={order}
                      language={language}
                      gameMinutes={gameMinutes}
                      storedInWarehouse={economyState.warehouseInventory[order.id] ?? 0}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: WEEKLY PLAN */}
          {activeTab === 'schedule' && selectedDay && (
            <div id="panel-schedule" role="tabpanel" aria-labelledby="tab-schedule" className="space-y-2">
              {/* Tier 1: 7 Compact Day-Selector Tiles */}
              <div
                className="grid grid-cols-7 gap-1"
                role="group"
                aria-label={t(language, 'orders.weekdayGroupAria')}
              >
                {weeklyColumns.map((day) => {
                  const isSelected = day.weekdayIndex === selectedDay.weekdayIndex;
                  return (
                    <button
                      key={day.weekdayIndex}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedWeekday(day.weekdayIndex)}
                      className={`min-w-0 rounded-lg border p-1.5 text-left flex flex-col justify-between gap-0.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-400 shadow-sm'
                          : day.isToday
                            ? 'bg-[#1a2438] border-amber-400/50 hover:border-amber-400/80'
                            : 'bg-[#172030] border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <div className="flex items-baseline gap-1 min-w-0 truncate">
                          <span
                            className={`text-xs font-bold shrink-0 ${
                              isSelected || day.isToday ? 'text-amber-300' : 'text-slate-100'
                            }`}
                          >
                            {day.weekdayShort}
                          </span>
                          <span
                            className={`text-[10px] font-mono-nums truncate ${
                              isSelected ? 'text-slate-200' : 'text-slate-400'
                            }`}
                          >
                            {day.dateLabel}
                          </span>
                        </div>
                        {day.isToday && (
                          <span className="hidden md:inline px-1 py-0.5 rounded bg-amber-400/20 text-[9px] font-bold text-amber-300 shrink-0 leading-none">
                            {t(language, 'orders.todayBadge')}
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[10px] font-mono-nums font-semibold leading-none ${
                          day.tasks.length > 0
                            ? isSelected
                              ? 'text-amber-200'
                              : 'text-slate-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {t(language, 'orders.tasksCountShort', { count: day.tasks.length })}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Tier 2: Compact Single-Row Task List */}
              <section
                aria-label={t(language, 'orders.scheduleDayAria', {
                  weekday: selectedDay.weekdayName,
                  date: selectedDay.dateLabel,
                })}
                className="rounded-lg bg-[#151d2c] border border-slate-800/90 p-1.5"
              >
                {selectedDay.tasks.length === 0 ? (
                  <div className="py-6 px-3 text-center rounded-md bg-slate-900/50 border border-slate-800/80">
                    <p className="text-xs font-semibold text-slate-300">
                      {t(language, 'orders.scheduleEmptyTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {t(language, 'orders.scheduleEmptyDesc')}
                    </p>
                  </div>
                ) : (
                  <ol className="flex flex-col gap-1">
                    {selectedDay.tasks.map((task, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === selectedDay.tasks.length - 1;
                      const totalPkgs = Math.max(0, task.totalPackages);
                      const pickedUp = Math.max(0, Math.min(totalPkgs, task.pickedUpCount));
                      const delivered = Math.max(0, Math.min(totalPkgs, task.deliveredCount));
                      const allPickedUp = totalPkgs > 0 && pickedUp >= totalPkgs;
                      const translatedClient = translateOrderText(language, task.clientName);
                      const translatedAddress = translateOrderText(language, task.pickupAddress);
                      return (
                        <li
                          key={`${selectedDay.weekdayIndex}-${task.taskId}`}
                          className="rounded-md bg-[#182030] border border-slate-700/85 py-1 px-2 flex items-center gap-1.5 text-xs min-w-0"
                        >
                          <span className="font-mono-nums font-bold text-amber-400 min-w-[22px] shrink-0">
                            #{task.priorityRank}
                          </span>

                          <p
                            className="flex-1 min-w-0 truncate text-xs text-slate-100"
                            title={`#${task.orderNumber} • ${translatedClient} (${translatedAddress})`}
                          >
                            <span className="font-mono-nums font-semibold text-amber-300">
                              #{task.orderNumber}
                            </span>
                            <span className="text-slate-500 mx-1" aria-hidden="true">
                              •
                            </span>
                            <span className="font-semibold">{translatedClient}</span>
                            <span className="text-slate-400"> ({translatedAddress})</span>
                          </p>

                          <div className="flex items-center gap-1 shrink-0 tabular-nums text-[11px]">
                            <span
                              title={t(language, 'orders.pickedUpTooltip', {
                                picked: pickedUp,
                                total: totalPkgs,
                              })}
                              aria-label={t(language, 'orders.pickedUpAria', {
                                picked: pickedUp,
                                total: totalPkgs,
                              })}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${
                                allPickedUp
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                                  : 'bg-sky-500/15 text-sky-300 border-sky-400/40'
                              }`}
                            >
                              <Boxes className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span className="font-semibold">
                                {pickedUp}/{totalPkgs}
                              </span>
                            </span>

                            <span
                              title={t(language, 'orders.deliveredTooltip', {
                                delivered,
                                total: totalPkgs,
                              })}
                              aria-label={t(language, 'orders.deliveredAria', {
                                delivered,
                                total: totalPkgs,
                              })}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border leading-none whitespace-nowrap bg-emerald-500/15 text-emerald-400 border-emerald-400/40"
                            >
                              <Check className="w-3.5 h-3.5 shrink-0 stroke-[2.5]" aria-hidden="true" />
                              <span className="font-semibold">
                                {delivered}/{totalPkgs}
                              </span>
                            </span>
                          </div>

                          {task.assignedCourierId !== undefined && (
                            <span
                              title={
                                task.assignedCourierId === 1
                                  ? t(language, 'orders.inProgressOwner')
                                  : t(language, 'orders.inProgressCourier', {
                                      slot: task.assignedCourierId,
                                    })
                              }
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap shrink-0 leading-none ${
                                task.assignedCourierId === 1
                                  ? 'bg-amber-500/15 text-amber-300 border-amber-400/40'
                                  : 'bg-violet-500/15 text-violet-300 border-violet-400/40'
                              }`}
                            >
                              {task.assignedCourierId === 1
                                ? t(language, 'orders.ownerBadge')
                                : t(language, 'orders.courierBadge', {
                                    slot: task.assignedCourierId,
                                  })}
                            </span>
                          )}

                          <div className="flex items-center gap-1 shrink-0">
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
                              aria-label={t(language, 'orders.moveUpAria', {
                                weekday: selectedDay.weekdayName,
                                orderNumber: task.orderNumber,
                                clientName: translatedClient,
                              })}
                              title={t(language, 'orders.moveUpTitle')}
                              className={`w-7 h-7 rounded-md text-[11px] font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
                              aria-label={t(language, 'orders.moveDownAria', {
                                weekday: selectedDay.weekdayName,
                                orderNumber: task.orderNumber,
                                clientName: translatedClient,
                              })}
                              title={t(language, 'orders.moveDownTitle')}
                              className={`w-7 h-7 rounded-md text-[11px] font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
// Offer Card (Tab 1: New Offers)
// ============================================================================

interface OfferCardProps {
  offer: OrderOffer;
  language: SupportedLanguage;
  gameMinutes: number;
  onAccept: (offerId: string) => void;
  onReject: (offerId: string) => void;
}

const OfferCard: React.FC<OfferCardProps> = ({
  offer,
  language,
  gameMinutes,
  onAccept,
  onReject,
}) => {
  const isLongTerm = offer.kind === 'long_term';
  const durationLabel = formatDurationLabel(offer, language);
  const rawRemaining = formatTimeRemaining(offer.expiresAtMinutes, gameMinutes, language);
  const expiresLabel =
    offer.expiresAtMinutes - gameMinutes <= 0
      ? rawRemaining
      : t(language, 'orders.expiresInPrefix', { time: rawRemaining });
  const expiresUrgent = offer.expiresAtMinutes - gameMinutes < MINUTES_PER_DAY;
  const translatedClient = translateOrderText(language, offer.clientName);
  const translatedAddress = translateOrderText(language, offer.pickupLocation.address);

  const paramsSummary =
    offer.kind === 'long_term'
      ? `${durationLabel} • ${offer.packagesPerWeek}${t(language, 'orders.perWeekShort')} (${formatWeekdaysList(offer.pickupWeekdays, language)}) • ${formatCurrencyUsd(offer.ratePerPackage)}${t(language, 'orders.perPkgShort')}`
      : `${durationLabel} • ${formatLocalizedPackages(offer.totalPackages, language)} • ${formatCurrencyUsd(offer.ratePerPackage)}${t(language, 'orders.perPkgShort')}`;

  return (
    <article className="flex flex-col justify-between rounded-lg bg-[#182030] border border-slate-700/85 p-2 gap-1">
      {/* 1. Order type + expiry */}
      <div className="flex items-center justify-between gap-1.5 text-[11px] leading-tight">
        <span className={`font-medium truncate ${isLongTerm ? 'text-sky-300' : 'text-amber-300'}`}>
          {isLongTerm ? t(language, 'orders.kindLongTerm') : t(language, 'orders.kindShortTerm')}
        </span>
        <span
          className={`font-mono-nums shrink-0 ${
            expiresUrgent ? 'text-rose-400 font-semibold' : 'text-slate-400'
          }`}
        >
          {expiresLabel}
        </span>
      </div>

      {/* 2. Client name & street address */}
      <div className="min-w-0">
        <h3
          className="text-xs font-semibold text-slate-100 truncate leading-snug"
          title={`#${offer.orderNumber} • ${translatedClient}`}
        >
          <span className="font-mono-nums text-amber-300">#{offer.orderNumber}</span>
          <span className="text-slate-500 mx-1" aria-hidden="true">•</span>
          <span>{translatedClient}</span>
        </h3>
        <p
          className="text-[11px] text-slate-400 truncate leading-tight"
          title={translatedAddress}
        >
          {translatedAddress}
        </p>
      </div>

      {/* 3. Single combined parameters strip */}
      <p
        className="text-[11px] text-slate-300 font-mono-nums truncate pt-0.5"
        title={paramsSummary}
      >
        {paramsSummary}
      </p>

      {/* 4. Bottom action bar */}
      <div className="flex items-center justify-between gap-1.5 pt-1.5 mt-0.5 border-t border-slate-800">
        <div className="min-w-0 leading-none">
          <span className="text-sm font-bold text-emerald-400 font-mono-nums">
            {formatCurrencyUsd(
              offer.kind === 'long_term' ? offer.totalContractValue : offer.totalExpectedPayout
            )}
          </span>
          {offer.kind === 'long_term' && (
            <span className="ml-1 text-[10px] text-slate-400 font-mono-nums whitespace-nowrap">
              ({formatCurrencyUsd(offer.estimatedMonthlyPayout, false)}
              {t(language, 'orders.perMonthShort')})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onAccept(offer.id)}
            className="px-2.5 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-300"
          >
            {t(language, 'orders.accept')}
          </button>
          <button
            type="button"
            onClick={() => onReject(offer.id)}
            className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400"
          >
            {t(language, 'orders.reject')}
          </button>
        </div>
      </div>
    </article>
  );
};

// ============================================================================
// Active Order Card (Tab 2: Active)
// ============================================================================

interface ActiveOrderCardProps {
  order: ActiveOrder;
  language: SupportedLanguage;
  gameMinutes: number;
  storedInWarehouse: number;
}

const ActiveOrderCard: React.FC<ActiveOrderCardProps> = ({
  order,
  language,
  gameMinutes,
  storedInWarehouse,
}) => {
  const isLongTerm = order.kind === 'long_term';
  const remainingText = formatTimeRemaining(order.endMinutes, gameMinutes, language);
  const endDate = getCalendarDateFromGameDay(order.endGameDay);
  const endDateShort = `${endDate.dayOfMonth} ${getMonthName(language, endDate.monthIndex, true)}`;
  const satisfactionVis = getSatisfactionVisuals(order.satisfaction, language);
  const translatedClient = translateOrderText(language, order.clientName);
  const translatedAddress = translateOrderText(language, order.pickupLocation.address);

  const weeklyTarget = order.weekly.expectedPackagesThisWeek;
  const pickedUpThisWeek = order.weekly.pickedUpPackagesThisWeek;
  const deliveredThisWeek = order.weekly.deliveredPackagesThisWeek;

  const shortTermTotal = order.kind === 'short_term' ? order.totalPackages : weeklyTarget;
  const shortTermPickedUp =
    order.kind === 'short_term'
      ? Math.min(
          order.totalPackages,
          Math.max(
            order.pickedUpPackagesTotal ?? 0,
            order.deliveredPackagesTotal + storedInWarehouse,
            pickedUpThisWeek
          )
        )
      : pickedUpThisWeek;

  const progressText = isLongTerm
    ? t(language, 'orders.progressSummary', {
        picked: pickedUpThisWeek,
        delivered: deliveredThisWeek,
        total: weeklyTarget,
      })
    : t(language, 'orders.progressSummary', {
        picked: shortTermPickedUp,
        delivered: order.deliveredPackagesTotal,
        total: shortTermTotal,
      });

  return (
    <article className="flex flex-col justify-between rounded-lg bg-[#182030] border border-slate-700/85 p-2 gap-1">
      {/* 1. Order type + remaining time */}
      <div className="flex items-center justify-between gap-1.5 text-[11px] leading-tight">
        <span className={`font-medium truncate ${isLongTerm ? 'text-sky-300' : 'text-amber-300'}`}>
          {isLongTerm ? t(language, 'orders.kindLongTerm') : t(language, 'orders.kindShortTerm')}
        </span>
        <span className="text-slate-300 font-mono-nums shrink-0">
          {isLongTerm ? `${remainingText} • ${endDateShort}` : remainingText}
        </span>
      </div>

      {/* 2. Client name & street address */}
      <div className="min-w-0">
        <h3
          className="text-xs font-semibold text-slate-100 truncate leading-snug"
          title={`#${order.orderNumber} • ${translatedClient}`}
        >
          <span className="font-mono-nums text-amber-300">#{order.orderNumber}</span>
          <span className="text-slate-500 mx-1" aria-hidden="true">•</span>
          <span>{translatedClient}</span>
        </h3>
        <p
          className="text-[11px] text-slate-400 truncate leading-tight"
          title={translatedAddress}
        >
          {translatedAddress}
        </p>
      </div>

      {/* 2b. Scheduled realization weekday(s) for long-term contracts */}
      {order.kind === 'long_term' && (
        <div className="flex items-center gap-1 text-[11px] leading-tight">
          <CalendarDays className="w-3 h-3 text-sky-400 shrink-0" aria-hidden="true" />
          <span className="truncate">
            <span className="text-slate-400">
              {order.pickupWeekdays.length > 1
                ? `${t(language, 'orders.deliveryDayPlural')} `
                : `${t(language, 'orders.deliveryDaySingle')} `}
            </span>
            <span className="font-semibold text-sky-200">
              {order.pickupWeekdays.length === 1
                ? getWeekdayName(language, order.pickupWeekdays[0], false)
                : formatWeekdaysList(order.pickupWeekdays, language)}
            </span>
          </span>
        </div>
      )}

      {/* 3. Combined progress & payout row */}
      <div className="flex items-baseline justify-between gap-1.5 text-[11px] font-mono-nums pt-0.5">
        <span className="text-slate-200 truncate">{progressText}</span>
        <span className="font-bold text-emerald-400 shrink-0">
          {order.kind === 'long_term'
            ? `${formatCurrencyUsd(order.accruedMonthlyPayout, false)}${t(language, 'orders.perMonthShort')}`
            : formatCurrencyUsd(order.totalExpectedPayout)}
        </span>
      </div>

      {/* 4. Compact satisfaction bar */}
      <div className="pt-1 mt-0.5 border-t border-slate-800 space-y-1">
        <div className="flex items-center justify-between gap-1 text-[11px] leading-none">
          <span className="text-slate-400">{t(language, 'orders.satisfactionLabel')}</span>
          <span className={`font-bold font-mono-nums ${satisfactionVis.textClass}`}>
            {order.satisfaction}% • {satisfactionVis.label}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t(language, 'orders.satisfactionAria', { client: translatedClient })}
          aria-valuenow={order.satisfaction}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`h-1.5 w-full rounded-full bg-slate-800 overflow-hidden ${satisfactionVis.textClass}`}
        >
          <svg
            viewBox="0 0 100 6"
            preserveAspectRatio="none"
            className="block w-full h-full"
            aria-hidden="true"
          >
            <rect
              x="0"
              y="0"
              width={Math.max(0, Math.min(100, order.satisfaction))}
              height="6"
              rx="3"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    </article>
  );
};
