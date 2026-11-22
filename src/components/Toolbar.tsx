import React from 'react';
import {
  Clock,
  Eye,
  EyeOff,
  Files,
  Layers,
  Moon,
  Pause,
  Signpost,
  SkipForward,
} from 'lucide-react';
import {
  GAME_SPEED_OPTIONS,
  type GameSpeed,
  NIGHT_MODE_SPEED,
  formatBalanceUsd,
  getGameClockDisplay,
} from '../utils/gameClock';

interface ToolbarProps {
  showGrid: boolean;
  footprintOnly: boolean;
  showStreetNames: boolean;
  balance: number;
  gameMinutes: number;
  gameSpeed: GameSpeed;
  isNightMode: boolean;
  ordersOpen: boolean;
  unreadOffersCount: number;
  onToggleGrid: () => void;
  onToggleFootprintOnly: () => void;
  onToggleStreetNames: () => void;
  onChangeGameSpeed: (speed: GameSpeed) => void;
  onOpenSkipTime: () => void;
  onOpenOrders: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  showGrid,
  footprintOnly,
  showStreetNames,
  balance,
  gameMinutes,
  gameSpeed,
  isNightMode,
  ordersOpen,
  unreadOffersCount,
  onToggleGrid,
  onToggleFootprintOnly,
  onToggleStreetNames,
  onChangeGameSpeed,
  onOpenSkipTime,
  onOpenOrders,
}) => {
  const clock = getGameClockDisplay(gameMinutes);
  const formattedBalance = formatBalanceUsd(balance);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20">
      {/* Top-center docked status bar (flush to top: 0, solid #182030, rounded bottom corners only) */}
      <div className="flex justify-center px-1 sm:px-2">
        <div className="pointer-events-auto max-w-full flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3.5 py-1.5 rounded-b-xl rounded-t-none bg-[#182030] border-x border-b border-t-0 border-slate-700/90 shadow-lg">
          {/* Account Balance directly on bar surface */}
          <div
            aria-label={`Saldo konta: ${formattedBalance}`}
            className="text-xs sm:text-sm font-bold text-emerald-400 font-mono-nums whitespace-nowrap shrink-0"
          >
            {formattedBalance}
          </div>

          <div className="w-px h-5 bg-slate-700/80 shrink-0" aria-hidden="true" />

          {/* Weekday, Calendar Date, Year & Clock directly on bar surface */}
          <div
            aria-label={`${clock.weekday}, ${clock.dayOfMonth} ${clock.monthName}, Rok ${clock.year}, godzina ${clock.timeText}`}
            className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0"
          >
            {isNightMode ? (
              <Moon
                className="w-3.5 h-3.5 shrink-0 text-indigo-300"
                aria-hidden="true"
              />
            ) : (
              <Clock
                className={`hidden min-[420px]:inline-block w-3.5 h-3.5 shrink-0 ${
                  gameSpeed === 0 ? 'text-rose-400' : 'text-amber-400'
                }`}
                aria-hidden="true"
              />
            )}
            <span className="sm:hidden">{clock.weekdayShort}</span>
            <span className="hidden sm:inline">{clock.weekday}</span>
            <span className="text-slate-500" aria-hidden="true">|</span>
            <span className="sm:hidden text-slate-200">
              {clock.dayOfMonth} {clock.monthShort}
            </span>
            <span className="hidden sm:inline text-slate-200">
              {clock.dayOfMonth} {clock.monthName}
            </span>
            <span className="text-slate-500" aria-hidden="true">|</span>
            <span className="sm:hidden text-slate-300">R{clock.year}</span>
            <span className="hidden sm:inline text-slate-300">Rok {clock.year}</span>
            <span className="text-slate-500" aria-hidden="true">|</span>
            <span
              className={`font-mono-nums ${
                isNightMode ? 'text-indigo-300' : 'text-amber-300'
              }`}
            >
              {clock.timeText}
            </span>
            {isNightMode && (
              <>
                <span className="hidden sm:inline text-slate-500" aria-hidden="true">|</span>
                <span
                  aria-label={`Tryb nocy ${NIGHT_MODE_SPEED}x`}
                  className="hidden sm:inline font-mono-nums text-indigo-300 font-bold"
                >
                  Noc {NIGHT_MODE_SPEED}x
                </span>
                <span
                  aria-label={`Tryb nocy ${NIGHT_MODE_SPEED}x`}
                  className="sm:hidden font-mono-nums text-indigo-300 font-bold text-[10px]"
                >
                  {NIGHT_MODE_SPEED}x
                </span>
              </>
            )}
          </div>

          <div className="w-px h-5 bg-slate-700/80 shrink-0" aria-hidden="true" />

          {/* Game Speed Controls + Skip Time Button directly on bar surface */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <div
              role="group"
              aria-label="Tempo gry"
              className="flex items-center gap-0.5 shrink-0"
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
                    aria-label={isPause ? 'Pauza' : `Tempo gry ${speed}x`}
                    title={isPause ? 'Pauza' : `Tempo ${speed}x`}
                    className={`min-h-[38px] min-w-[26px] sm:min-h-[40px] sm:min-w-[36px] px-1 sm:px-2 rounded-md text-xs font-bold flex items-center justify-center transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
                      isActive
                        ? isPause
                          ? 'bg-rose-500 text-white shadow-sm'
                          : 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                    }`}
                  >
                    {isPause ? (
                      <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <span className="font-mono-nums">{speed}x</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="w-px h-5 bg-slate-700/80 mx-0.5 shrink-0" aria-hidden="true" />

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSkipTime();
              }}
              aria-label="Pomiń czas"
              title="Pomiń dzień lub przejdź do zlecenia"
              className="min-h-[40px] min-w-[40px] px-2 rounded-md text-slate-200 hover:text-white hover:bg-slate-700/70 flex items-center justify-center transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400"
            >
              <SkipForward className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Left Map View Toolbar & Separate Right "Zlecenia" Button
          - On desktop (>=1360px): aligned at top-3.5 (14px), slightly lower than the top-0 docked center bar
          - On mobile/tablet (<1360px): positioned cleanly below the docked center bar with zero overlap */}
      <div className="fixed inset-x-0 top-[58px] min-[1360px]:top-3.5 px-2 sm:px-3 flex items-center justify-between gap-2 pointer-events-none">
        {/* Left toolbar: 3 map view buttons only */}
        <div className="pointer-events-auto max-w-[calc(100%-52px)] sm:max-w-none flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1.5 rounded-xl bg-[#182030] border border-slate-700/90 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleFootprintOnly();
            }}
            aria-pressed={footprintOnly}
            aria-label="Podstawy budynków"
            className={`min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              footprintOnly
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-slate-800/90 text-slate-100 hover:bg-slate-700 border border-slate-700/80'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="2xl:hidden">Podstawy</span>
            <span className="hidden 2xl:inline">Podstawy budynków</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleStreetNames();
            }}
            aria-pressed={showStreetNames}
            aria-label="Nazwy ulic"
            className={`min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              showStreetNames
                ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35'
                : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 border border-slate-700/80'
            }`}
          >
            <Signpost className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="sm:hidden">Ulice</span>
            <span className="hidden sm:inline">Nazwy ulic</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleGrid();
            }}
            aria-pressed={showGrid}
            aria-label={showGrid ? 'Ukryj siatkę dróg' : 'Pokaż siatkę dróg'}
            className="min-h-[38px] sm:min-h-[40px] px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 bg-slate-800/90 text-slate-100 hover:bg-slate-700 border border-slate-700/80 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            {showGrid ? (
              <>
                <EyeOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="sm:hidden">Siatka</span>
                <span className="hidden sm:inline 2xl:hidden">Ukryj siatkę</span>
                <span className="hidden 2xl:inline">Ukryj siatkę dróg</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="sm:hidden">Siatka</span>
                <span className="hidden sm:inline 2xl:hidden">Pokaż siatkę</span>
                <span className="hidden 2xl:inline">Pokaż siatkę dróg</span>
              </>
            )}
          </button>
        </div>

        {/* Separate Right "Zlecenia" Button with unread newly-generated offers badge */}
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
              ? `Zlecenia (${unreadOffersCount} nieprzeczytanych ofert)`
              : 'Zlecenia'
          }
          title={
            unreadOffersCount > 0
              ? `Zlecenia (${unreadOffersCount} nowych ofert)`
              : 'Zlecenia'
          }
          className={`relative pointer-events-auto min-h-[40px] min-w-[40px] sm:min-h-[44px] px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 border shadow-lg transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
            ordersOpen
              ? 'bg-amber-400 text-slate-950 border-amber-300'
              : 'bg-amber-500 text-slate-950 hover:bg-amber-400 border-amber-400/80'
          }`}
        >
          <Files className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Zlecenia</span>
          {unreadOffersCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold font-mono-nums leading-none flex items-center justify-center border border-slate-950/90 shadow-md pointer-events-none"
            >
              {unreadOffersCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
