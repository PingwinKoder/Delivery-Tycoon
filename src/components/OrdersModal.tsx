import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Files,
  Wrench,
  X,
} from 'lucide-react';
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
  WeeklyTaskSortMode,
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
  getUpcomingLongTermPickupQuota,
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
  onSortWeeklyTasksPriority: (weekdayIndex: number, sortMode: WeeklyTaskSortMode) => void;
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
  onSortWeeklyTasksPriority,
}) => {
  const [activeTab, setActiveTab] = useState<OrdersTabId>('offers');
  const [sortMenuOpen, setSortMenuOpen] = useState<boolean>(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  const clock = useMemo(() => getGameClockDisplay(gameMinutes), [gameMinutes]);
  const [selectedWeekday, setSelectedWeekday] = useState<number>(clock.dayIndex);
  const latestDayIndexRef = useRef<number>(clock.dayIndex);
  latestDayIndexRef.current = clock.dayIndex;

  const unreadOffersCount = useMemo(() => countUnreadOffers(economyState), [economyState]);

  // Default Weekly Plan selector to today whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedWeekday(latestDayIndexRef.current);
      setSortMenuOpen(false);
    }
  }, [isOpen]);

  // Close sort menu when switching tabs or selected weekday
  useEffect(() => {
    setSortMenuOpen(false);
  }, [activeTab, selectedWeekday]);

  // Close sort menu on outside pointer press
  useEffect(() => {
    if (!sortMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [sortMenuOpen]);

  // Mark all currently listed pending offers as seen immediately when the "New Offers" tab is open
  useEffect(() => {
    if (isOpen && activeTab === 'offers' && unreadOffersCount > 0) {
      onMarkOffersSeen();
    }
  }, [isOpen, activeTab, unreadOffersCount, onMarkOffersSeen]);

  // Close sort menu first, or modal on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (sortMenuOpen) {
          setSortMenuOpen(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, sortMenuOpen, onClose]);

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
    return Array.from({ length: DAYS_PER_WEEK }, (_, dayOffset) => {
      const targetGameDay = clock.gameDay + dayOffset;
      const date = getCalendarDateFromGameDay(targetGameDay);
      const weekdayIndex = date.dayIndex;
      const isToday = dayOffset === 0;
      const rawTasks = getScheduledTasksForWeekday(
        economyState,
        weekdayIndex,
        clock.gameDay,
        targetGameDay
      );
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
        targetGameDay,
        weekdayIndex,
        weekdayName: getWeekdayName(language, weekdayIndex, false),
        weekdayShort: getWeekdayName(language, weekdayIndex, true),
        dateLabel: `${date.dayOfMonth} ${getMonthName(language, date.monthIndex, true)}`,
        isToday,
        tasks,
      };
    });
  }, [economyState, clock.gameDay, taskAssignmentsByTaskId, language]);

  const selectedDay =
    weeklyColumns.find((day) => day.weekdayIndex === selectedWeekday) ?? weeklyColumns[0];

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:p-4 bg-slate-950/80 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orders-modal-heading"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-[94vw] max-w-4xl h-[min(84vh,680px)] max-h-[84vh] [@media(max-height:540px)]:h-[95vh] [@media(max-height:540px)]:max-h-[95vh] [@media(min-width:1024px)_and_(min-height:541px)]:w-[90vw] [@media(min-width:1024px)_and_(min-height:541px)]:max-w-[1160px] [@media(min-width:1024px)_and_(min-height:541px)]:h-[min(90vh,860px)] [@media(min-width:1024px)_and_(min-height:541px)]:max-h-[90vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-lg overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Single-Line Company Status Bar */}
        <div className="flex items-center justify-between gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3 px-2 py-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 [@media(min-width:1024px)_and_(min-height:541px)]:py-3 bg-[#182030] border-b border-slate-700/80">
          <div className="flex flex-wrap items-center gap-x-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-x-3 gap-y-0.5 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm min-w-0 leading-tight">
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
            className="min-w-[26px] min-h-[26px] [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[38px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[38px] p-1 [@media(min-width:1024px)_and_(min-height:541px)]:p-1.5 rounded-lg flex items-center justify-center shrink-0 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Compact Navigation Tabs Bar */}
        <div className="px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 [@media(min-width:1024px)_and_(min-height:541px)]:py-2.5 bg-[#151d2c] border-b border-slate-800">
          <div
            className="flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 overflow-x-auto overscroll-x-contain"
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
              className={`relative px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 [@media(min-width:1024px)_and_(min-height:541px)]:py-1.5 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'offers'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Files className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
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
                  className="ml-0.5 min-w-[14px] h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[20px] [@media(min-width:1024px)_and_(min-height:541px)]:h-5 px-1 rounded-full bg-rose-600 text-white text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold font-mono-nums inline-flex items-center justify-center"
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
              className={`px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 [@media(min-width:1024px)_and_(min-height:541px)]:py-1.5 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'active'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <ClipboardList className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
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
              className={`px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 [@media(min-width:1024px)_and_(min-height:541px)]:py-1.5 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'schedule'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <CalendarDays className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
              <span>{t(language, 'orders.tabSchedule')}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Tab Content Area */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain p-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:p-4"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* TAB 1: NEW OFFERS */}
          {activeTab === 'offers' && (
            <div id="panel-offers" role="tabpanel" aria-labelledby="tab-offers">
              {economyState.pendingOffers.length === 0 ? (
                <div className="py-6 [@media(min-width:1024px)_and_(min-height:541px)]:py-10 px-3 [@media(min-width:1024px)_and_(min-height:541px)]:px-5 text-center border border-slate-800 rounded-lg bg-slate-900/60">
                  <p className="text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-base font-semibold text-slate-200">
                    {t(language, 'orders.offersEmptyTitle')}
                  </p>
                  <p className="mt-1 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm text-slate-400">
                    {t(language, 'orders.offersEmptyDesc')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3">
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
                <div className="py-6 [@media(min-width:1024px)_and_(min-height:541px)]:py-10 px-3 [@media(min-width:1024px)_and_(min-height:541px)]:px-5 text-center border border-slate-800 rounded-lg bg-slate-900/60">
                  <p className="text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-base font-semibold text-slate-200">
                    {t(language, 'orders.activeEmptyTitle')}
                  </p>
                  <p className="mt-1 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm text-slate-400">
                    {t(language, 'orders.activeEmptyDesc')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3">
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
            <div id="panel-schedule" role="tabpanel" aria-labelledby="tab-schedule" className="space-y-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:space-y-3">
              {/* Tier 1: 7 Compact Day-Selector Tiles */}
              <div
                className="grid grid-cols-7 gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2"
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
                      className={`min-w-0 rounded-lg border p-1 [@media(min-width:1024px)_and_(min-height:541px)]:p-2.5 text-left flex flex-col justify-between gap-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
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
                            className={`text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold shrink-0 ${
                              isSelected || day.isToday ? 'text-amber-300' : 'text-slate-100'
                            }`}
                          >
                            {day.weekdayShort}
                          </span>
                          <span
                            className={`text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-mono-nums truncate ${
                              isSelected ? 'text-slate-200' : 'text-slate-400'
                            }`}
                          >
                            {day.dateLabel}
                          </span>
                        </div>
                        {day.isToday && (
                          <span className="hidden md:inline px-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-1.5 py-0.5 rounded bg-amber-400/20 text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-[11px] font-bold text-amber-300 shrink-0 leading-none">
                            {t(language, 'orders.todayBadge')}
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-mono-nums font-semibold leading-none ${
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
                className="rounded-lg bg-[#151d2c] border border-slate-800/90 p-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:p-3 min-h-[160px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[260px]"
              >
                <div className="flex items-center justify-between gap-2 px-1 pb-1 [@media(min-width:1024px)_and_(min-height:541px)]:pb-2 mb-1 [@media(min-width:1024px)_and_(min-height:541px)]:mb-2 border-b border-slate-800/90">
                  <div className="flex items-baseline gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 min-w-0">
                    <span className="text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-base font-bold text-slate-100 truncate">
                      {selectedDay.weekdayName}
                    </span>
                    <span className="text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm text-slate-400 font-mono-nums shrink-0">
                      {selectedDay.dateLabel}
                    </span>
                    <span className="text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm text-slate-500 font-mono-nums shrink-0">
                      • {t(language, 'orders.tasksCountShort', { count: selectedDay.tasks.length })}
                    </span>
                  </div>

                  <div ref={sortMenuRef} className="relative shrink-0">
                    <button
                      type="button"
                      disabled={selectedDay.tasks.length === 0}
                      aria-haspopup="menu"
                      aria-expanded={sortMenuOpen}
                      aria-label={t(language, 'orders.sortAria', {
                        weekday: selectedDay.weekdayName,
                      })}
                      onClick={() => setSortMenuOpen((prev) => !prev)}
                      className={`px-1.5 py-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-3 [@media(min-width:1024px)_and_(min-height:541px)]:py-1.5 rounded-md text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-semibold border flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
                        selectedDay.tasks.length === 0
                          ? 'bg-slate-900/50 text-slate-600 border-slate-800/80 cursor-not-allowed'
                          : sortMenuOpen
                            ? 'bg-amber-500/15 text-amber-200 border-amber-400/70 cursor-pointer'
                            : 'bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 border-slate-700 cursor-pointer'
                      }`}
                    >
                      <ArrowUpDown className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
                      <span>{t(language, 'orders.sortBtn')}</span>
                      <ChevronDown
                        className={`w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0 transition-transform duration-150 ${
                          sortMenuOpen ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>

                    {sortMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 z-30 w-48 [@media(min-width:1024px)_and_(min-height:541px)]:w-64 rounded-lg bg-[#182030] border border-slate-700 shadow-lg py-1 text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm"
                      >
                        <div className="px-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 py-1 text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t(language, 'orders.sortGroupType')}
                        </div>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSortWeeklyTasksPriority(selectedDay.weekdayIndex, 'short_term_first');
                            setSortMenuOpen(false);
                          }}
                          className="w-full text-left px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 text-slate-100 hover:bg-slate-700/80 hover:text-amber-200 transition-colors cursor-pointer touch-manipulation"
                        >
                          {t(language, 'orders.sortShortTermFirst')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSortWeeklyTasksPriority(selectedDay.weekdayIndex, 'long_term_first');
                            setSortMenuOpen(false);
                          }}
                          className="w-full text-left px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 text-slate-100 hover:bg-slate-700/80 hover:text-amber-200 transition-colors cursor-pointer touch-manipulation"
                        >
                          {t(language, 'orders.sortLongTermFirst')}
                        </button>

                        <div className="my-1 border-t border-slate-700/80" />

                        <div className="px-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 py-1 text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t(language, 'orders.sortGroupPackages')}
                        </div>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSortWeeklyTasksPriority(selectedDay.weekdayIndex, 'packages_desc');
                            setSortMenuOpen(false);
                          }}
                          className="w-full text-left px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 text-slate-100 hover:bg-slate-700/80 hover:text-amber-200 transition-colors cursor-pointer touch-manipulation"
                        >
                          {t(language, 'orders.sortPackagesDesc')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSortWeeklyTasksPriority(selectedDay.weekdayIndex, 'packages_asc');
                            setSortMenuOpen(false);
                          }}
                          className="w-full text-left px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 text-slate-100 hover:bg-slate-700/80 hover:text-amber-200 transition-colors cursor-pointer touch-manipulation"
                        >
                          {t(language, 'orders.sortPackagesAsc')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {selectedDay.tasks.length === 0 ? (
                  <div className="py-5 [@media(min-width:1024px)_and_(min-height:541px)]:py-8 px-3 text-center rounded-md bg-slate-900/50 border border-slate-800/80">
                    <p className="text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold text-slate-300">
                      {t(language, 'orders.scheduleEmptyTitle')}
                    </p>
                    <p className="mt-0.5 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs text-slate-500">
                      {t(language, 'orders.scheduleEmptyDesc')}
                    </p>
                  </div>
                ) : (
                  <ol className="flex flex-col gap-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5">
                    {selectedDay.tasks.map((task, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === selectedDay.tasks.length - 1;

                      if (task.taskType === 'repair' && task.repairVehicle) {
                        const durabilityPct = Math.round(task.repairDurability ?? 0);
                        const repairTitle =
                          task.repairVehicle.type === 'van'
                            ? t(language, 'orders.repairVanTitle', {
                                index: task.repairVehicle.index,
                                durability: durabilityPct,
                              })
                            : t(language, 'orders.repairBikeTitle', {
                                index: task.repairVehicle.index,
                                durability: durabilityPct,
                              });
                        const mechanicLocation = t(language, 'orders.repairMechanicLocation');

                        return (
                          <li
                            key={`${selectedDay.weekdayIndex}-${task.taskId}`}
                            className="rounded-md bg-[#1c2233] border border-amber-500/45 py-1 px-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-3 flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm min-w-0"
                          >
                            <Wrench
                              className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 text-amber-400 shrink-0"
                              aria-hidden="true"
                            />
                            <p
                              className="flex-1 min-w-0 truncate text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm leading-tight text-slate-100"
                              title={`${repairTitle} (${mechanicLocation})`}
                            >
                              <span className="font-semibold text-amber-200 font-mono-nums">
                                {repairTitle}
                              </span>
                              <span className="text-slate-400"> ({mechanicLocation})</span>
                            </p>

                            {task.assignedCourierId !== undefined ? (
                              <span
                                title={
                                  task.assignedCourierId === 1
                                    ? t(language, 'orders.inProgressOwner')
                                    : t(language, 'orders.inProgressCourier', {
                                        slot: task.assignedCourierId,
                                      })
                                }
                                className={`px-1 py-[1px] [@media(min-width:1024px)_and_(min-height:541px)]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-0.5 rounded text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold border whitespace-nowrap shrink-0 leading-none ${
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
                            ) : task.repairWaitingForCourier ? (
                              <span
                                className="px-1 py-[1px] [@media(min-width:1024px)_and_(min-height:541px)]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-0.5 rounded text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-semibold border whitespace-nowrap shrink-0 leading-none bg-amber-500/10 text-amber-300/95 border-amber-400/35"
                                title={t(language, 'orders.repairWaitingCourier')}
                              >
                                {t(language, 'orders.repairWaitingCourierShort')}
                              </span>
                            ) : null}

                            <div className="flex items-center gap-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1 shrink-0">
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
                                aria-label={t(language, 'orders.repairMoveUpAria', {
                                  weekday: selectedDay.weekdayName,
                                  title: repairTitle,
                                })}
                                title={t(language, 'orders.moveUpTitle')}
                                className={`w-5 h-5 [@media(min-width:1024px)_and_(min-height:541px)]:w-7 [@media(min-width:1024px)_and_(min-height:541px)]:h-7 rounded text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
                                aria-label={t(language, 'orders.repairMoveDownAria', {
                                  weekday: selectedDay.weekdayName,
                                  title: repairTitle,
                                })}
                                title={t(language, 'orders.moveDownTitle')}
                                className={`w-5 h-5 [@media(min-width:1024px)_and_(min-height:541px)]:w-7 [@media(min-width:1024px)_and_(min-height:541px)]:h-7 rounded text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
                      }

                      const totalPkgs = Math.max(0, task.totalPackages);
                      const pickedUp = Math.max(0, Math.min(totalPkgs, task.pickedUpCount));
                      const delivered = Math.max(0, Math.min(totalPkgs, task.deliveredCount));
                      const allPickedUp = totalPkgs > 0 && pickedUp >= totalPkgs;
                      const isExpiring = Boolean(task.isExpiringOnDay) && delivered < totalPkgs;
                      const expiringTooltip = task.isDeliveryWindowDeadline
                        ? t(language, 'orders.expiringDeliveryWindowTooltip')
                        : t(language, 'orders.expiringLastDayTooltip');
                      const translatedClient = translateOrderText(language, task.clientName);
                      const translatedAddress = translateOrderText(language, task.pickupAddress);
                      return (
                        <li
                          key={`${selectedDay.weekdayIndex}-${task.taskId}`}
                          className={`rounded-md border py-0.5 px-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-3 flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm min-w-0 ${
                            isExpiring
                              ? 'animate-expiring-task'
                              : 'bg-[#182030] border-slate-700/85'
                          }`}
                        >
                          {isExpiring && (
                            <span
                              title={expiringTooltip}
                              aria-label={expiringTooltip}
                              className="inline-flex items-center justify-center w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5 rounded-full bg-rose-500/25 border border-rose-400/75 text-rose-300 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-extrabold leading-none shrink-0"
                            >
                              !
                            </span>
                          )}
                          <p
                            className="flex-1 min-w-0 truncate text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm leading-tight text-slate-100"
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

                          <div className="flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 shrink-0 tabular-nums text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs">
                            <span
                              title={t(language, 'orders.pickedUpTooltip', {
                                picked: pickedUp,
                                total: totalPkgs,
                              })}
                              aria-label={t(language, 'orders.pickedUpAria', {
                                picked: pickedUp,
                                total: totalPkgs,
                              })}
                              className={`inline-flex items-center gap-1 px-1 py-[1px] [@media(min-width:1024px)_and_(min-height:541px)]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-0.5 rounded border leading-none whitespace-nowrap ${
                                allPickedUp
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                                  : 'bg-sky-500/15 text-sky-300 border-sky-400/40'
                              }`}
                            >
                              <Boxes className="w-2.5 h-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:h-3.5 shrink-0" aria-hidden="true" />
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
                              className="inline-flex items-center gap-1 px-1 py-[1px] [@media(min-width:1024px)_and_(min-height:541px)]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-0.5 rounded border leading-none whitespace-nowrap bg-emerald-500/15 text-emerald-400 border-emerald-400/40"
                            >
                              <Check className="w-2.5 h-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:h-3.5 shrink-0 stroke-[2.5]" aria-hidden="true" />
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
                              className={`px-1 py-[1px] [@media(min-width:1024px)_and_(min-height:541px)]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-0.5 rounded text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold border whitespace-nowrap shrink-0 leading-none ${
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

                          <div className="flex items-center gap-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1 shrink-0">
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
                              className={`w-5 h-5 [@media(min-width:1024px)_and_(min-height:541px)]:w-7 [@media(min-width:1024px)_and_(min-height:541px)]:h-7 rounded text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
                              className={`w-5 h-5 [@media(min-width:1024px)_and_(min-height:541px)]:w-7 [@media(min-width:1024px)_and_(min-height:541px)]:h-7 rounded text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-bold flex items-center justify-center border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
    <article className="flex flex-col justify-between rounded-lg bg-[#182030] border border-slate-700/85 p-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:p-3.5 gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2">
      {/* 1. Order type + expiry */}
      <div className="flex items-center justify-between gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs leading-tight">
        <div className="flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 min-w-0">
          <span className={`font-medium truncate ${isLongTerm ? 'text-sky-300' : 'text-amber-300'}`}>
            {isLongTerm ? t(language, 'orders.kindLongTerm') : t(language, 'orders.kindShortTerm')}
          </span>
          {offer.kind === 'long_term' && offer.pickupDaysPerWeek === 2 && (
            <span className="px-1 py-[1px] [@media(min-width:1024px)_and_(min-height:541px)]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-0.5 rounded bg-sky-500/15 border border-sky-400/45 text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-[11px] font-bold text-sky-200 font-mono-nums whitespace-nowrap shrink-0">
              {t(language, 'orders.freqTwicePerWeek')}
            </span>
          )}
        </div>
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
          className="text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold text-slate-100 truncate leading-snug"
          title={`#${offer.orderNumber} • ${translatedClient}`}
        >
          <span className="font-mono-nums text-amber-300">#{offer.orderNumber}</span>
          <span className="text-slate-500 mx-1" aria-hidden="true">•</span>
          <span>{translatedClient}</span>
        </h3>
        <p
          className="text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs text-slate-400 truncate leading-tight"
          title={translatedAddress}
        >
          {translatedAddress}
        </p>
      </div>

      {/* 3. Single combined parameters strip */}
      <div className="min-w-0 pt-0.5">
        <p
          className="text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs text-slate-300 font-mono-nums truncate"
          title={paramsSummary}
        >
          {paramsSummary}
        </p>
        {offer.kind === 'long_term' && (
          <p
            className="text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs text-sky-300/90 font-mono-nums truncate leading-tight mt-0.5"
            title={t(language, 'orders.deliveryWindow3DaysHint')}
          >
            {t(language, 'orders.deliveryWindow3Days')}
          </p>
        )}
      </div>

      {/* 4. Bottom action bar */}
      <div className="flex items-center justify-between gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 pt-1 [@media(min-width:1024px)_and_(min-height:541px)]:pt-2.5 mt-0.5 border-t border-slate-800">
        <div className="min-w-0 leading-none">
          <span className="text-xs [@media(min-width:1024px)_and_(min-height:541px)]:text-base font-bold text-emerald-400 font-mono-nums">
            {formatCurrencyUsd(
              offer.kind === 'long_term' ? offer.totalContractValue : offer.totalExpectedPayout
            )}
          </span>
          {offer.kind === 'long_term' && (
            <span className="ml-1 text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs text-slate-400 font-mono-nums whitespace-nowrap">
              ({formatCurrencyUsd(offer.estimatedMonthlyPayout, false)}
              {t(language, 'orders.perMonthShort')})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAccept(offer.id)}
            className="px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-300"
          >
            {t(language, 'orders.accept')}
          </button>
          <button
            type="button"
            onClick={() => onReject(offer.id)}
            className="px-2 py-1 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400"
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

  const currentGameDay = Math.floor(Math.max(0, gameMinutes) / MINUTES_PER_DAY) + 1;
  const rawWeeklyTarget = order.weekly.expectedPackagesThisWeek;
  const weeklyTarget =
    order.kind === 'long_term' && rawWeeklyTarget <= 0
      ? getUpcomingLongTermPickupQuota(order, currentGameDay)
      : rawWeeklyTarget;
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
    <article className="flex flex-col justify-between rounded-lg bg-[#182030] border border-slate-700/85 p-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:p-3.5 gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2">
      {/* 1. Order type + remaining time */}
      <div className="flex items-center justify-between gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs leading-tight">
        <div className="flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 min-w-0">
          <span className={`font-medium truncate ${isLongTerm ? 'text-sky-300' : 'text-amber-300'}`}>
            {isLongTerm ? t(language, 'orders.kindLongTerm') : t(language, 'orders.kindShortTerm')}
          </span>
          {order.kind === 'long_term' && order.pickupDaysPerWeek === 2 && (
            <span className="px-1 py-[1px] [@media(min-width:1024px)_and_(min-height:541px)]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-0.5 rounded bg-sky-500/15 border border-sky-400/45 text-[9px] [@media(min-width:1024px)_and_(min-height:541px)]:text-[11px] font-bold text-sky-200 font-mono-nums whitespace-nowrap shrink-0">
              {t(language, 'orders.freqTwicePerWeek')}
            </span>
          )}
        </div>
        <span className="text-slate-300 font-mono-nums shrink-0">
          {isLongTerm ? `${remainingText} • ${endDateShort}` : remainingText}
        </span>
      </div>

      {/* 2. Client name & street address */}
      <div className="min-w-0">
        <h3
          className="text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold text-slate-100 truncate leading-snug"
          title={`#${order.orderNumber} • ${translatedClient}`}
        >
          <span className="font-mono-nums text-amber-300">#{order.orderNumber}</span>
          <span className="text-slate-500 mx-1" aria-hidden="true">•</span>
          <span>{translatedClient}</span>
        </h3>
        <p
          className="text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs text-slate-400 truncate leading-tight"
          title={translatedAddress}
        >
          {translatedAddress}
        </p>
      </div>

      {/* 2b. Scheduled pickup weekday(s) & 3-day delivery window for long-term contracts */}
      {order.kind === 'long_term' && (
        <div
          className="flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs leading-tight"
          title={t(language, 'orders.deliveryWindow3DaysHint')}
        >
          <CalendarDays className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 text-sky-400 shrink-0" aria-hidden="true" />
          <span className="truncate">
            <span className="text-slate-400">
              {order.pickupWeekdays.length > 1
                ? `${t(language, 'orders.pickupDayPlural')} `
                : `${t(language, 'orders.pickupDaySingle')} `}
            </span>
            <span className="font-semibold text-sky-200">
              {order.pickupWeekdays.length === 1
                ? getWeekdayName(language, order.pickupWeekdays[0], false)
                : formatWeekdaysList(order.pickupWeekdays, language)}
            </span>
            <span className="text-slate-500 mx-1" aria-hidden="true">•</span>
            <span className="text-sky-300/90 font-mono-nums">
              {t(language, 'orders.deliveryWindow3Days')}
            </span>
          </span>
        </div>
      )}

      {/* 3. Combined progress & payout row */}
      <div className="flex items-baseline justify-between gap-1.5 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-mono-nums pt-0.5">
        <span className="text-slate-200 truncate">{progressText}</span>
        <span className="font-bold text-emerald-400 shrink-0">
          {order.kind === 'long_term'
            ? `${formatCurrencyUsd(order.accruedMonthlyPayout, false)}${t(language, 'orders.perMonthShort')}`
            : formatCurrencyUsd(order.totalExpectedPayout)}
        </span>
      </div>

      {/* 4. Compact satisfaction bar */}
      <div className="pt-1 [@media(min-width:1024px)_and_(min-height:541px)]:pt-2 mt-0.5 border-t border-slate-800 space-y-1 [@media(min-width:1024px)_and_(min-height:541px)]:space-y-1.5">
        <div className="flex items-center justify-between gap-1 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs leading-none">
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
          className={`h-1 [@media(min-width:1024px)_and_(min-height:541px)]:h-2 w-full rounded-full bg-slate-800 overflow-hidden ${satisfactionVis.textClass}`}
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
