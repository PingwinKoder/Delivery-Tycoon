import React, { useEffect, useState } from 'react';
import {
  Building2,
  Clock,
  Files,
  Frown,
  Layers,
  Meh,
  Moon,
  Pause,
  Settings,
  SkipForward,
  Smile,
} from 'lucide-react';
import { getMonthName, getWeekdayName, t } from '../i18n/translations';
import {
  GAME_SPEED_OPTIONS,
  type GameSpeed,
  formatBalanceUsd,
  getGameClockDisplay,
} from '../utils/gameClock';
import type { SupportedLanguage } from '../utils/settingsSystem';

interface ToolbarProps {
  hudVisible: boolean;
  language: SupportedLanguage;
  footprintOnly: boolean;
  balance: number;
  companySatisfaction: number;
  gameMinutes: number;
  gameSpeed: GameSpeed;
  isNightMode: boolean;
  ordersOpen: boolean;
  companyOpen: boolean;
  settingsOpen: boolean;
  unreadOffersCount: number;
  fps: number | null;
  showFpsCounter?: boolean;
  onToggleFootprintOnly: () => void;
  onChangeGameSpeed: (speed: GameSpeed) => void;
  onOpenSkipTime: () => void;
  onOpenOrders: () => void;
  onOpenCompany: () => void;
  onOpenSettings: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = React.memo(({
  hudVisible,
  language,
  footprintOnly,
  balance,
  companySatisfaction,
  gameMinutes,
  gameSpeed,
  isNightMode,
  ordersOpen,
  companyOpen,
  settingsOpen,
  unreadOffersCount,
  fps,
  showFpsCounter = true,
  onToggleFootprintOnly,
  onChangeGameSpeed,
  onOpenSkipTime,
  onOpenOrders,
  onOpenCompany,
  onOpenSettings,
}) => {
  const [hudSettled, setHudSettled] = useState<boolean>(false);

  useEffect(() => {
    if (!hudVisible) {
      setHudSettled(false);
      return;
    }

    // Fallback in case prefers-reduced-motion skips CSS transitionend
    const settleTimer = window.setTimeout(() => {
      setHudSettled(true);
    }, 2050);

    return () => {
      window.clearTimeout(settleTimer);
    };
  }, [hudVisible]);

  const clock = getGameClockDisplay(gameMinutes);
  const weekdayFull = getWeekdayName(language, clock.dayIndex, false);
  const weekdayShort = getWeekdayName(language, clock.dayIndex, true);
  const monthFull = getMonthName(language, clock.monthIndex, false);
  const monthShort = getMonthName(language, clock.monthIndex, true);
  const formattedBalance = formatBalanceUsd(balance);
  const interactiveClass = hudVisible ? 'pointer-events-auto' : 'pointer-events-none';
  const ordersLabel = t(language, 'hud.orders');
  const companyLabel = t(language, 'hud.company');
  const settingsLabel = t(language, 'hud.settings');

  const headerMotionClass = hudVisible
    ? hudSettled
      ? 'opacity-100 transform-none will-change-auto'
      : 'will-change-[opacity,transform] transition-[opacity,transform] ease-out duration-[1200ms] delay-[800ms] opacity-100 [transform:translate3d(0,0,0)]'
    : 'transition-[opacity,transform] ease-out duration-500 delay-0 opacity-0 [transform:translate3d(0,-16px,0)] will-change-auto';

  return (
    <header
      aria-hidden={!hudVisible}
      onTransitionEnd={(e) => {
        if (hudVisible && e.target === e.currentTarget && e.propertyName === 'transform') {
          setHudSettled(true);
        }
      }}
      className={`pointer-events-none fixed inset-x-0 top-0 z-20 ${headerMotionClass}`}
    >
      {/* Top-center docked status bar (flush to top: 0, solid #182030, rounded bottom corners only) */}
      <div className="flex justify-center pl-1.5 pr-[54px] min-[560px]:px-2 [@media(max-height:540px)]:px-1.5">
        <div
          className={`${interactiveClass} max-w-full flex flex-col min-[560px]:flex-row items-center gap-1 min-[560px]:gap-1.5 sm:gap-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3 [@media(max-height:540px)]:gap-1.5 px-2.5 min-[560px]:px-2 sm:px-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 [@media(max-height:540px)]:px-2 py-1 min-[560px]:py-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 [@media(max-height:540px)]:py-1 rounded-b-xl rounded-t-none bg-[#182030] [@media(max-height:540px)]:bg-slate-900/95 border-x border-b border-t-0 border-slate-700/90 shadow-lg`}
        >
          {/* Balance + Date/Clock group */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3 [@media(max-height:540px)]:gap-1.5 min-w-0">
            {/* Account Balance directly on bar surface */}
            <div
              aria-label={t(language, 'hud.balanceAria', { amount: formattedBalance })}
              className="text-xs sm:text-sm [@media(min-width:1024px)_and_(min-height:541px)]:text-[15.5px] [@media(max-height:540px)]:text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap shrink-0"
            >
              {formattedBalance}
            </div>

            <div className="w-px h-4 min-[560px]:h-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-[22px] [@media(max-height:540px)]:h-4 bg-slate-700/80 shrink-0" aria-hidden="true" />

            {/* Client Satisfaction Smiley + % Badge */}
            {(() => {
              const satPct = Math.round(Math.max(0, Math.min(100, companySatisfaction)));
              const satColorClass =
                satPct >= 80
                  ? 'text-emerald-400'
                  : satPct >= 60
                    ? 'text-amber-400'
                    : 'text-rose-400';
              const SatIcon = satPct >= 80 ? Smile : satPct >= 60 ? Meh : Frown;
              return (
                <div
                  aria-label={t(language, 'hud.satisfactionAria', { percent: satPct })}
                  className={`flex items-center gap-0.5 sm:gap-1 text-xs sm:text-sm [@media(min-width:1024px)_and_(min-height:541px)]:text-[14.5px] [@media(max-height:540px)]:text-xs font-bold tabular-nums whitespace-nowrap shrink-0 ${satColorClass}`}
                >
                  <SatIcon
                    className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{satPct}%</span>
                </div>
              );
            })()}

            <div className="w-px h-4 min-[560px]:h-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-[22px] [@media(max-height:540px)]:h-4 bg-slate-700/80 shrink-0" aria-hidden="true" />

            {/* Weekday, Calendar Date, Year & Clock directly on bar surface */}
            <div
              aria-label={t(language, 'hud.dateAria', {
                weekday: weekdayFull,
                day: clock.dayOfMonth,
                month: monthFull,
                year: clock.year,
                time: clock.timeText,
              })}
              className="flex items-center gap-1 sm:gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 [@media(max-height:540px)]:gap-1 text-[11px] sm:text-xs [@media(min-width:1024px)_and_(min-height:541px)]:text-[13.5px] [@media(max-height:540px)]:text-[11px] font-semibold text-slate-100 whitespace-nowrap shrink-0"
            >
              {isNightMode ? (
                <Moon
                  className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0 text-indigo-300"
                  aria-hidden="true"
                />
              ) : (
                <Clock
                  className={`hidden min-[420px]:inline-block w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0 ${gameSpeed === 0 ? 'text-rose-400' : 'text-amber-400'
                    }`}
                  aria-hidden="true"
                />
              )}
              <span className="inline [@media(min-width:1024px)_and_(min-height:541px)]:hidden">
                {weekdayShort}
              </span>
              <span className="hidden [@media(min-width:1024px)_and_(min-height:541px)]:inline">
                {weekdayFull}
              </span>
              <span className="text-slate-500" aria-hidden="true">|</span>
              <span className="inline [@media(min-width:1024px)_and_(min-height:541px)]:hidden text-slate-200 tabular-nums">
                {clock.dayOfMonth} {monthShort}
              </span>
              <span className="hidden [@media(min-width:1024px)_and_(min-height:541px)]:inline text-slate-200 tabular-nums">
                {clock.dayOfMonth} {monthFull}
              </span>
              <span className="text-slate-500" aria-hidden="true">|</span>
              <span className="inline [@media(min-width:1024px)_and_(min-height:541px)]:hidden text-slate-300 tabular-nums">
                {t(language, 'hud.yearShort', { year: clock.year })}
              </span>
              <span className="hidden [@media(min-width:1024px)_and_(min-height:541px)]:inline text-slate-300 tabular-nums">
                {t(language, 'hud.yearFull', { year: clock.year })}
              </span>
              <span className="text-slate-500" aria-hidden="true">|</span>
              <span
                className={`tabular-nums ${isNightMode ? 'text-indigo-300' : 'text-amber-300'
                  }`}
              >
                {clock.timeText}
              </span>
            </div>
          </div>

          <div className="hidden min-[560px]:block w-px h-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-[22px] [@media(max-height:540px)]:h-4 bg-slate-700/80 shrink-0" aria-hidden="true" />

          {/* Game Speed Controls + Skip Time Button directly on bar surface */}
          <div className="flex items-center gap-0.5 sm:gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1.5 [@media(max-height:540px)]:gap-0.5 shrink-0">
            <div
              role="group"
              aria-label={t(language, 'hud.speedGroupAria')}
              className="flex items-center gap-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-1 shrink-0"
            >
              {GAME_SPEED_OPTIONS.map((speed) => {
                const isActive = gameSpeed === speed;
                const isPause = speed === 0;
                return (
                  <button
                    key={speed}
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onChangeGameSpeed(speed);
                    }}
                    aria-pressed={isActive}
                    aria-label={
                      isPause
                        ? t(language, 'hud.pause')
                        : t(language, 'hud.speedAria', { speed })
                    }
                    className={`h-7 min-w-[28px] min-[560px]:h-auto min-[560px]:min-h-[38px] min-[560px]:min-w-[26px] sm:min-h-[40px] sm:min-w-[36px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[44px] [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[40px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:h-8 [@media(max-height:540px)]:min-w-[28px] px-1.5 min-[560px]:px-1 sm:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-2.5 [@media(max-height:540px)]:px-1.5 rounded-md text-xs [@media(min-width:1024px)_and_(min-height:541px)]:text-[13.5px] [@media(max-height:540px)]:text-[11px] font-bold flex items-center justify-center transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${isActive
                      ? isPause
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                      }`}
                  >
                    {isPause ? (
                      <Pause className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4" aria-hidden="true" />
                    ) : (
                      <span className="tabular-nums">{speed}x</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="w-px h-4 min-[560px]:h-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-[22px] [@media(max-height:540px)]:h-4 bg-slate-700/80 mx-0.5 shrink-0" aria-hidden="true" />

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSkipTime();
              }}
              aria-label={t(language, 'hud.skipTimeAria')}
              className="h-7 w-7 min-[560px]:h-auto min-[560px]:w-auto min-[560px]:min-h-[38px] min-[560px]:min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[44px] [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[44px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:min-w-0 [@media(max-height:540px)]:h-8 [@media(max-height:540px)]:w-8 px-1.5 min-[560px]:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-2.5 [@media(max-height:540px)]:px-1.5 rounded-md text-slate-200 hover:text-white hover:bg-slate-700/70 flex items-center justify-center transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400"
            >
              <SkipForward className="w-3.5 h-3.5 min-[560px]:w-4 min-[560px]:h-4 [@media(min-width:1024px)_and_(min-height:541px)]:w-[18px] [@media(min-width:1024px)_and_(min-height:541px)]:h-[18px] [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Left Map View Toolbar */}
      <div
        className={`fixed left-2 sm:left-3 [@media(max-height:540px)]:left-1.5 top-[68px] min-[560px]:top-[58px] [@media(min-width:1024px)_and_(min-height:541px)_and_(max-width:1439px)]:top-[68px] [@media(max-height:540px)_and_(min-width:560px)_and_(max-width:1359px)]:top-[46px] min-[1440px]:top-3.5 z-20 ${interactiveClass} max-w-[calc(100%-64px)] sm:max-w-none flex items-center gap-1 sm:gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 [@media(max-height:540px)]:gap-1 px-1.5 sm:px-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-2.5 [@media(max-height:540px)]:px-1.5 py-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 [@media(max-height:540px)]:py-1 rounded-xl [@media(max-height:540px)]:rounded-lg bg-[#182030] [@media(max-height:540px)]:bg-slate-900/95 border border-slate-700/90 shadow-lg`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleFootprintOnly();
          }}
          aria-pressed={footprintOnly}
          aria-label={t(language, 'hud.footprintsFull')}
          className={`min-h-[38px] sm:min-h-[40px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[44px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:h-8 px-2 sm:px-3 [@media(min-width:1024px)_and_(min-height:541px)]:px-3.5 [@media(max-height:540px)]:px-2 py-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 [@media(max-height:540px)]:py-1 rounded-lg text-xs [@media(min-width:1024px)_and_(min-height:541px)]:text-[13.5px] [@media(max-height:540px)]:text-[11px] font-semibold flex items-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 [@media(max-height:540px)]:gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${footprintOnly
            ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
            : 'bg-slate-800/90 text-slate-100 hover:bg-slate-700 border border-slate-700/80'
            }`}
        >
          <Layers className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
          <span className="2xl:hidden">{t(language, 'hud.footprintsShort')}</span>
          <span className="hidden 2xl:inline">{t(language, 'hud.footprintsFull')}</span>
        </button>
      </div>

      {/* Right Top Action Cluster: Settings + Orders + Company + FPS badge */}
      <div className="fixed right-2 sm:right-3 [@media(max-height:540px)]:right-1.5 top-2 min-[1360px]:top-3.5 z-20 flex flex-col sm:flex-row items-end sm:items-start gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 [@media(max-height:540px)]:gap-1 pointer-events-none">
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenSettings();
          }}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-label={settingsLabel}
          className={`${interactiveClass} order-2 sm:order-1 min-h-[40px] min-w-[40px] sm:min-h-[44px] sm:min-w-[44px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[49px] [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[49px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:min-w-0 [@media(max-height:540px)]:h-8 [@media(max-height:540px)]:w-8 rounded-xl [@media(max-height:540px)]:rounded-lg flex items-center justify-center shrink-0 border shadow-lg transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${settingsOpen
            ? 'bg-slate-800 text-amber-300 border-amber-400/70'
            : 'bg-slate-900/95 text-slate-200 hover:bg-slate-800 hover:text-amber-300 border-slate-700/80'
            }`}
        >
          <Settings
            className="w-4 h-4 [@media(min-width:1024px)_and_(min-height:541px)]:w-[18px] [@media(min-width:1024px)_and_(min-height:541px)]:h-[18px] [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0"
            aria-hidden="true"
          />
        </button>

        <div className="order-1 sm:order-2 flex flex-col items-end gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 [@media(max-height:540px)]:gap-1 pointer-events-none">
          <div className="flex flex-col items-stretch gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 [@media(max-height:540px)]:gap-1 shrink-0 pointer-events-none">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenOrders();
              }}
              aria-haspopup="dialog"
              aria-expanded={ordersOpen}
              aria-label={
                unreadOffersCount > 0
                  ? t(language, 'hud.ordersUnreadAria', { count: unreadOffersCount })
                  : ordersLabel
              }
              className={`relative ${interactiveClass} min-h-[40px] min-w-[40px] sm:min-h-[44px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[49px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:min-w-0 [@media(max-height:540px)]:h-8 px-2.5 sm:px-4 [@media(min-width:1024px)_and_(min-height:541px)]:px-[18px] [@media(max-height:540px)]:px-2 py-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-2.5 [@media(max-height:540px)]:py-1 rounded-xl [@media(max-height:540px)]:rounded-lg text-xs sm:text-sm [@media(min-width:1024px)_and_(min-height:541px)]:text-[15.5px] [@media(max-height:540px)]:text-[11px] font-bold flex items-center justify-center gap-2 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2.5 [@media(max-height:540px)]:gap-1 whitespace-nowrap shrink-0 border shadow-lg transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${ordersOpen
                ? 'bg-amber-400 text-slate-950 border-amber-300'
                : 'bg-amber-500 text-slate-950 hover:bg-amber-400 border-amber-400/80'
                }`}
            >
              <Files className="w-4 h-4 [@media(min-width:1024px)_and_(min-height:541px)]:w-[18px] [@media(min-width:1024px)_and_(min-height:541px)]:h-[18px] [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{ordersLabel}</span>
              {unreadOffersCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 -right-1.5 [@media(max-height:540px)]:-top-1 [@media(max-height:540px)]:-right-1 min-w-[20px] h-5 [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[22px] [@media(min-width:1024px)_and_(min-height:541px)]:h-[22px] [@media(max-height:540px)]:min-w-[16px] [@media(max-height:540px)]:h-4 px-1.5 [@media(max-height:540px)]:px-1 rounded-full bg-rose-600 text-white text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs [@media(max-height:540px)]:text-[10px] font-bold tabular-nums leading-none flex items-center justify-center border border-slate-950/90 shadow-md pointer-events-none"
                >
                  {unreadOffersCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenCompany();
              }}
              aria-haspopup="dialog"
              aria-expanded={companyOpen}
              aria-label={companyLabel}
              className={`${interactiveClass} min-h-[40px] min-w-[40px] sm:min-h-[44px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[49px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:min-w-0 [@media(max-height:540px)]:h-8 px-2.5 sm:px-4 [@media(min-width:1024px)_and_(min-height:541px)]:px-[18px] [@media(max-height:540px)]:px-2 py-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-2.5 [@media(max-height:540px)]:py-1 rounded-xl [@media(max-height:540px)]:rounded-lg text-xs sm:text-sm [@media(min-width:1024px)_and_(min-height:541px)]:text-[15.5px] [@media(max-height:540px)]:text-[11px] font-bold flex items-center justify-center gap-2 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2.5 [@media(max-height:540px)]:gap-1 whitespace-nowrap shrink-0 border shadow-lg transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${companyOpen
                ? 'bg-slate-800 text-amber-300 border-amber-400/70'
                : 'bg-slate-900/95 text-slate-100 hover:bg-slate-800 border-slate-700/80'
                }`}
            >
              <Building2 className="w-4 h-4 [@media(min-width:1024px)_and_(min-height:541px)]:w-[18px] [@media(min-width:1024px)_and_(min-height:541px)]:h-[18px] [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0 text-amber-400" aria-hidden="true" />
              <span className="hidden sm:inline">{companyLabel}</span>
            </button>
          </div>

          {showFpsCounter && (
            <div
              aria-label={
                fps !== null
                  ? t(language, 'hud.fpsAria', { fps })
                  : t(language, 'hud.fpsMeasuringAria')
              }
              className="pointer-events-none select-none px-2 py-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-1 rounded-md bg-slate-900/95 border border-slate-700/80 shadow-sm text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-xs font-semibold tabular-nums leading-tight flex items-center gap-1"
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
              <span className="text-slate-400 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-[11px]">FPS</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
});
