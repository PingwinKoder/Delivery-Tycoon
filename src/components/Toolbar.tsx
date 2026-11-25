import React from 'react';
import {
  Building2,
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
  companyOpen: boolean;
  unreadOffersCount: number;
  fps: number | null;
  onToggleGrid: () => void;
  onToggleFootprintOnly: () => void;
  onToggleStreetNames: () => void;
  onChangeGameSpeed: (speed: GameSpeed) => void;
  onOpenSkipTime: () => void;
  onOpenOrders: () => void;
  onOpenCompany: () => void;
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
  companyOpen,
  unreadOffersCount,
  fps,
  onToggleGrid,
  onToggleFootprintOnly,
  onToggleStreetNames,
  onChangeGameSpeed,
  onOpenSkipTime,
  onOpenOrders,
  onOpenCompany,
}) => {
  const clock = getGameClockDisplay(gameMinutes);
  const formattedBalance = formatBalanceUsd(balance);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20">
      {/* Top-center docked status bar (flush to top: 0, solid #182030, rounded bottom corners only) */}
      <div className="flex justify-center pl-1.5 pr-[54px] min-[560px]:px-2 [@media(max-height:540px)]:px-1.5">
        <div className="pointer-events-auto max-w-full flex flex-col min-[560px]:flex-row items-center gap-1 min-[560px]:gap-1.5 sm:gap-2.5 [@media(max-height:540px)]:gap-1.5 px-2.5 min-[560px]:px-2 sm:px-3.5 [@media(max-height:540px)]:px-2 py-1 min-[560px]:py-1.5 [@media(max-height:540px)]:py-1 rounded-b-xl rounded-t-none bg-[#182030] [@media(max-height:540px)]:bg-slate-900/95 border-x border-b border-t-0 border-slate-700/90 shadow-lg">
          {/* Balance + Date/Clock group */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 [@media(max-height:540px)]:gap-1.5 min-w-0">
            {/* Account Balance directly on bar surface */}
            <div
              aria-label={`Saldo konta: ${formattedBalance}`}
              className="text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap shrink-0"
            >
              {formattedBalance}
            </div>

            <div className="w-px h-4 min-[560px]:h-5 [@media(max-height:540px)]:h-4 bg-slate-700/80 shrink-0" aria-hidden="true" />

            {/* Weekday, Calendar Date, Year & Clock directly on bar surface */}
            <div
              aria-label={`${clock.weekday}, ${clock.dayOfMonth} ${clock.monthName}, Rok ${clock.year}, godzina ${clock.timeText}`}
              className="flex items-center gap-1 sm:gap-1.5 [@media(max-height:540px)]:gap-1 text-[11px] sm:text-xs [@media(max-height:540px)]:text-[11px] font-semibold text-slate-100 whitespace-nowrap shrink-0"
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
              <span className="inline [@media(min-width:1024px)_and_(min-height:541px)]:hidden">
                {clock.weekdayShort}
              </span>
              <span className="hidden [@media(min-width:1024px)_and_(min-height:541px)]:inline">
                {clock.weekday}
              </span>
              <span className="text-slate-500" aria-hidden="true">|</span>
              <span className="inline [@media(min-width:1024px)_and_(min-height:541px)]:hidden text-slate-200 tabular-nums">
                {clock.dayOfMonth} {clock.monthShort}
              </span>
              <span className="hidden [@media(min-width:1024px)_and_(min-height:541px)]:inline text-slate-200 tabular-nums">
                {clock.dayOfMonth} {clock.monthName}
              </span>
              <span className="text-slate-500" aria-hidden="true">|</span>
              <span className="inline [@media(min-width:1024px)_and_(min-height:541px)]:hidden text-slate-300 tabular-nums">
                R{clock.year}
              </span>
              <span className="hidden [@media(min-width:1024px)_and_(min-height:541px)]:inline text-slate-300 tabular-nums">
                Rok {clock.year}
              </span>
              <span className="text-slate-500" aria-hidden="true">|</span>
              <span
                className={`tabular-nums ${
                  isNightMode ? 'text-indigo-300' : 'text-amber-300'
                }`}
              >
                {clock.timeText}
              </span>
            </div>
          </div>

          <div className="hidden min-[560px]:block w-px h-5 [@media(max-height:540px)]:h-4 bg-slate-700/80 shrink-0" aria-hidden="true" />

          {/* Game Speed Controls + Skip Time Button directly on bar surface */}
          <div className="flex items-center gap-0.5 sm:gap-1 [@media(max-height:540px)]:gap-0.5 shrink-0">
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
                    className={`h-7 min-w-[28px] min-[560px]:h-auto min-[560px]:min-h-[38px] min-[560px]:min-w-[26px] sm:min-h-[40px] sm:min-w-[36px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:h-8 [@media(max-height:540px)]:min-w-[28px] px-1.5 min-[560px]:px-1 sm:px-2 [@media(max-height:540px)]:px-1.5 rounded-md text-xs [@media(max-height:540px)]:text-[11px] font-bold flex items-center justify-center transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
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
                      <span className="tabular-nums">{speed}x</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="w-px h-4 min-[560px]:h-5 [@media(max-height:540px)]:h-4 bg-slate-700/80 mx-0.5 shrink-0" aria-hidden="true" />

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSkipTime();
              }}
              aria-label="Pomiń czas"
              title="Pomiń dzień lub przejdź do zlecenia"
              className="h-7 w-7 min-[560px]:h-auto min-[560px]:w-auto min-[560px]:min-h-[38px] min-[560px]:min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:min-w-0 [@media(max-height:540px)]:h-8 [@media(max-height:540px)]:w-8 px-1.5 min-[560px]:px-2 [@media(max-height:540px)]:px-1.5 rounded-md text-slate-200 hover:text-white hover:bg-slate-700/70 flex items-center justify-center transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400"
            >
              <SkipForward className="w-3.5 h-3.5 min-[560px]:w-4 min-[560px]:h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Left Map View Toolbar:
          - On desktop (>=1360px): aligned at top-3.5 in top-left corner
          - On mobile/tablet (<1360px): positioned cleanly below the top-center bar with zero overlap */}
      <div className="fixed left-2 sm:left-3 [@media(max-height:540px)]:left-1.5 top-[68px] min-[560px]:top-[58px] [@media(max-height:540px)_and_(min-width:560px)_and_(max-width:1359px)]:top-[46px] min-[1360px]:top-3.5 z-20 pointer-events-auto max-w-[calc(100%-64px)] sm:max-w-none flex items-center gap-1 sm:gap-1.5 [@media(max-height:540px)]:gap-1 px-1.5 sm:px-2 [@media(max-height:540px)]:px-1.5 py-1.5 [@media(max-height:540px)]:py-1 rounded-xl [@media(max-height:540px)]:rounded-lg bg-[#182030] [@media(max-height:540px)]:bg-slate-900/95 border border-slate-700/90 shadow-lg">
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleFootprintOnly();
          }}
          aria-pressed={footprintOnly}
          aria-label="Podstawy budynków"
          className={`min-h-[38px] sm:min-h-[40px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:h-8 px-2 sm:px-3 [@media(max-height:540px)]:px-2 py-1.5 [@media(max-height:540px)]:py-1 rounded-lg text-xs [@media(max-height:540px)]:text-[11px] font-semibold flex items-center gap-1.5 [@media(max-height:540px)]:gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
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
          className={`min-h-[38px] sm:min-h-[40px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:h-8 px-2 sm:px-3 [@media(max-height:540px)]:px-2 py-1.5 [@media(max-height:540px)]:py-1 rounded-lg text-xs [@media(max-height:540px)]:text-[11px] font-semibold flex items-center gap-1.5 [@media(max-height:540px)]:gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
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
          className="min-h-[38px] sm:min-h-[40px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:h-8 px-2 sm:px-3 [@media(max-height:540px)]:px-2 py-1.5 [@media(max-height:540px)]:py-1 rounded-lg text-xs [@media(max-height:540px)]:text-[11px] font-semibold flex items-center gap-1.5 [@media(max-height:540px)]:gap-1 whitespace-nowrap shrink-0 bg-slate-800/90 text-slate-100 hover:bg-slate-700 border border-slate-700/80 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
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

      {/* Right Vertical Action Column: "Zlecenia" + "Firma" + compact FPS counter tucked right near top-right edge */}
      <div className="fixed right-2 sm:right-3 [@media(max-height:540px)]:right-1.5 top-2 min-[1360px]:top-3.5 z-20 flex flex-col items-end gap-1.5 [@media(max-height:540px)]:gap-1 pointer-events-none">
        <div className="flex flex-col items-stretch gap-1.5 [@media(max-height:540px)]:gap-1 shrink-0 pointer-events-none">
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
            className={`relative pointer-events-auto min-h-[40px] min-w-[40px] sm:min-h-[44px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:min-w-0 [@media(max-height:540px)]:h-8 px-2.5 sm:px-4 [@media(max-height:540px)]:px-2.5 py-2 [@media(max-height:540px)]:py-1 rounded-xl [@media(max-height:540px)]:rounded-lg text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-2 [@media(max-height:540px)]:gap-1.5 whitespace-nowrap shrink-0 border shadow-lg transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              ordersOpen
                ? 'bg-amber-400 text-slate-950 border-amber-300'
                : 'bg-amber-500 text-slate-950 hover:bg-amber-400 border-amber-400/80'
            }`}
          >
            <Files className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Zlecenia</span>
            {unreadOffersCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-1.5 -right-1.5 [@media(max-height:540px)]:-top-1 [@media(max-height:540px)]:-right-1 min-w-[20px] h-5 [@media(max-height:540px)]:min-w-[16px] [@media(max-height:540px)]:h-4 px-1.5 [@media(max-height:540px)]:px-1 rounded-full bg-rose-600 text-white text-[11px] [@media(max-height:540px)]:text-[10px] font-bold tabular-nums leading-none flex items-center justify-center border border-slate-950/90 shadow-md pointer-events-none"
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
            aria-label="Firma"
            title="Firma — stan przedsiębiorstwa i rozbudowa"
            className={`pointer-events-auto min-h-[40px] min-w-[40px] sm:min-h-[44px] [@media(max-height:540px)]:min-h-0 [@media(max-height:540px)]:min-w-0 [@media(max-height:540px)]:h-8 px-2.5 sm:px-4 [@media(max-height:540px)]:px-2.5 py-2 [@media(max-height:540px)]:py-1 rounded-xl [@media(max-height:540px)]:rounded-lg text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-2 [@media(max-height:540px)]:gap-1.5 whitespace-nowrap shrink-0 border shadow-lg transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              companyOpen
                ? 'bg-slate-800 text-amber-300 border-amber-400/70'
                : 'bg-slate-900/95 text-slate-100 hover:bg-slate-800 border-slate-700/80'
            }`}
          >
            <Building2 className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span className="hidden sm:inline">Firma</span>
          </button>
        </div>

        <div
          aria-label={fps !== null ? `Wydajność: ${fps} klatek na sekundę` : 'Pomiar FPS'}
          className="pointer-events-none select-none px-2 py-0.5 rounded-md bg-slate-900/95 border border-slate-700/80 shadow-sm text-[11px] font-semibold tabular-nums leading-tight flex items-center gap-1"
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
          <span className="text-slate-400 text-[10px]">FPS</span>
        </div>
      </div>
    </header>
  );
};
