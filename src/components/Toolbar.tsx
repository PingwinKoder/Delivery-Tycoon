import React from 'react';
import {
  Clock,
  Eye,
  EyeOff,
  Files,
  Layers,
  Pause,
  Signpost,
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
  ordersOpen: boolean;
  onToggleGrid: () => void;
  onToggleFootprintOnly: () => void;
  onToggleStreetNames: () => void;
  onChangeGameSpeed: (speed: GameSpeed) => void;
  onOpenOrders: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  showGrid,
  footprintOnly,
  showStreetNames,
  balance,
  gameMinutes,
  gameSpeed,
  ordersOpen,
  onToggleGrid,
  onToggleFootprintOnly,
  onToggleStreetNames,
  onChangeGameSpeed,
  onOpenOrders,
}) => {
  const clock = getGameClockDisplay(gameMinutes);
  const formattedBalance = formatBalanceUsd(balance);

  return (
    <header className="pointer-events-none fixed top-0 left-0 right-0 z-20 p-2 sm:p-3 flex flex-wrap items-start justify-between gap-2">
      {/* Left panel: Brand & Map View Toggles */}
      <div
        className="pointer-events-auto max-w-full flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl border border-white/15 shadow-lg overflow-x-auto"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.90)' }}
      >
        <span className="hidden md:inline text-sm sm:text-base font-bold tracking-tight text-amber-400 whitespace-nowrap shrink-0 pr-0.5 sm:pr-1">
          Delivery Tycoon
        </span>

        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleFootprintOnly();
          }}
          aria-pressed={footprintOnly}
          aria-label="Podstawy budynków"
          className={`min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
            footprintOnly
              ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              : 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-white/10'
          }`}
        >
          <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="xl:hidden">Podstawy</span>
          <span className="hidden xl:inline">Podstawy budynków</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleStreetNames();
          }}
          aria-pressed={showStreetNames}
          aria-label="Nazwy ulic"
          className={`min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
            showStreetNames
              ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/10'
          }`}
        >
          <Signpost className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Nazwy ulic</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleGrid();
          }}
          aria-pressed={showGrid}
          aria-label={showGrid ? 'Ukryj siatkę dróg' : 'Pokaż siatkę dróg'}
          className="min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 bg-slate-800 text-slate-100 hover:bg-slate-700 border border-white/10 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          {showGrid ? (
            <>
              <EyeOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="xl:hidden">Ukryj siatkę</span>
              <span className="hidden xl:inline">Ukryj siatkę dróg</span>
            </>
          ) : (
            <>
              <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="xl:hidden">Pokaż siatkę</span>
              <span className="hidden xl:inline">Pokaż siatkę dróg</span>
            </>
          )}
        </button>
      </div>

      {/* Right panel: Economy Balance, Weekly Clock, Game Speed Controls & Orders Button */}
      <div
        className="pointer-events-auto w-full sm:w-auto max-w-full ml-auto flex flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl border border-white/15 shadow-lg"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.90)' }}
      >
        {/* Account Balance & Weekly Clock */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <div
            aria-label={`Saldo konta: ${formattedBalance}`}
            className="min-h-[40px] px-2.5 sm:px-3 rounded-lg bg-emerald-500/15 border border-emerald-400/35 flex items-center text-xs sm:text-sm font-bold text-emerald-300 font-mono-nums whitespace-nowrap shrink-0"
          >
            {formattedBalance}
          </div>

          <div
            aria-label={`${clock.weekday}, Tydzień ${clock.week}, godzina ${clock.timeText}`}
            className="min-h-[40px] px-2.5 sm:px-3 rounded-lg bg-slate-800/90 border border-white/10 flex items-center gap-1.5 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0"
          >
            <Clock
              className={`w-3.5 h-3.5 shrink-0 ${
                gameSpeed === 0 ? 'text-rose-400' : 'text-amber-400'
              }`}
              aria-hidden="true"
            />
            <span className="sm:hidden">{clock.weekdayShort}</span>
            <span className="hidden sm:inline">{clock.weekday}</span>
            <span className="text-slate-400" aria-hidden="true">•</span>
            <span className="text-slate-300">Tydz. {clock.week}</span>
            <span className="text-slate-400" aria-hidden="true">•</span>
            <span className="font-mono-nums text-amber-300">{clock.timeText}</span>
          </div>
        </div>

        {/* Speed Controls & Orders Button */}
        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto sm:ml-0 shrink-0">
          <div
            role="group"
            aria-label="Tempo gry"
            className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900/90 border border-white/10"
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
                  className={`min-h-[36px] min-w-[36px] px-2 rounded-md text-xs font-bold flex items-center justify-center transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
                    isActive
                      ? isPause
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
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

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenOrders();
            }}
            aria-haspopup="dialog"
            aria-expanded={ordersOpen}
            aria-label="Zlecenia"
            title="Zlecenia"
            className={`min-h-[40px] min-w-[40px] px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              ordersOpen
                ? 'bg-amber-400 text-slate-950 shadow-sm'
                : 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-sm'
            }`}
          >
            <Files className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Zlecenia</span>
          </button>
        </div>
      </div>
    </header>
  );
};
