import React, { useEffect } from 'react';
import { CalendarArrowUp, SkipForward, X } from 'lucide-react';
import { getGameClockDisplay } from '../utils/gameClock';

interface SkipTimeModalProps {
  isOpen: boolean;
  nextDayMorningMinutes: number;
  nextScheduledOrderMinutes: number | null;
  onClose: () => void;
  onSkipDay: () => void;
  onSkipToNextOrder: () => void;
}

export const SkipTimeModal: React.FC<SkipTimeModalProps> = ({
  isOpen,
  nextDayMorningMinutes,
  nextScheduledOrderMinutes,
  onClose,
  onSkipDay,
  onSkipToNextOrder,
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

  if (!isOpen) return null;

  const nextDayClock = getGameClockDisplay(nextDayMorningMinutes);
  const nextOrderClock =
    nextScheduledOrderMinutes !== null ? getGameClockDisplay(nextScheduledOrderMinutes) : null;
  const hasUpcomingOrder = nextOrderClock !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 [@media(max-height:540px)]:p-2 bg-slate-950/80 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skip-time-modal-title"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md [@media(max-height:540px)]:max-h-[94vh] rounded-2xl [@media(max-height:540px)]:rounded-xl bg-[#182030] border border-slate-700/90 shadow-2xl overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 [@media(max-height:540px)]:px-3 py-3 [@media(max-height:540px)]:py-2 border-b border-slate-700/80 bg-[#141b29]">
          <div className="flex items-center gap-2 [@media(max-height:540px)]:gap-1.5 min-w-0">
            <SkipForward className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
            <h2 id="skip-time-modal-title" className="text-sm sm:text-base [@media(max-height:540px)]:text-sm font-bold text-slate-100">
              Pomiń czas
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno pomijania czasu"
            className="min-w-[40px] min-h-[40px] [@media(max-height:540px)]:min-w-[32px] [@media(max-height:540px)]:min-h-[32px] p-2 [@media(max-height:540px)]:p-1.5 rounded-lg flex items-center justify-center text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Subtle helper description above action buttons (only for the two skip options) */}
        <div className="px-4 sm:px-5 [@media(max-height:540px)]:px-3 pt-4 [@media(max-height:540px)]:pt-2.5 pb-3 [@media(max-height:540px)]:pb-2 space-y-2.5 [@media(max-height:540px)]:space-y-1.5 text-xs sm:text-sm [@media(max-height:540px)]:text-xs text-slate-300 leading-relaxed [@media(max-height:540px)]:leading-snug">
          <p>
            <span className="font-semibold text-slate-100">Pomiń - dzień:</span> przeskakuje czas
            gry do początku następnego dnia (
            <span className="font-mono-nums text-amber-300">
              {nextDayClock.weekday} | {nextDayClock.dayOfMonth} {nextDayClock.monthName} | 08:00
            </span>
            ).
          </p>
          <p>
            <span className="font-semibold text-slate-100">Pomiń - do zlecenia:</span> przeskakuje
            czas gry do najbliższego kolejnego dnia w planie tygodniowym (
            {nextOrderClock ? (
              <span className="font-mono-nums text-emerald-300">
                {nextOrderClock.weekday} | {nextOrderClock.dayOfMonth} {nextOrderClock.monthName} |
                08:00
              </span>
            ) : (
              <span className="text-slate-400">brak zaplanowanych aktywnych zleceń</span>
            )}
            ), w którym zaplanowane jest aktywne zlecenie.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="px-4 sm:px-5 [@media(max-height:540px)]:px-3 pb-4 [@media(max-height:540px)]:pb-2.5 pt-2 [@media(max-height:540px)]:pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 [@media(max-height:540px)]:gap-1.5 border-t border-slate-800/90">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] [@media(max-height:540px)]:min-h-0 px-4 [@media(max-height:540px)]:px-3 py-2 [@media(max-height:540px)]:py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-semibold transition-colors cursor-pointer touch-manipulation whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            Anuluj
          </button>

          <button
            type="button"
            onClick={onSkipDay}
            className="min-h-[42px] [@media(max-height:540px)]:min-h-0 px-4 [@media(max-height:540px)]:px-3 py-2 [@media(max-height:540px)]:py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer touch-manipulation whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            <SkipForward className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
            <span>Pomiń - dzień</span>
          </button>

          <button
            type="button"
            disabled={!hasUpcomingOrder}
            onClick={onSkipToNextOrder}
            className={`min-h-[42px] [@media(max-height:540px)]:min-h-0 px-4 [@media(max-height:540px)]:px-3 py-2 [@media(max-height:540px)]:py-2 rounded-lg text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-1.5 transition-colors touch-manipulation whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 ${
              hasUpcomingOrder
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                : 'bg-slate-800/70 text-slate-500 border border-slate-700/70 cursor-not-allowed'
            }`}
          >
            <CalendarArrowUp className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
            <span>Pomiń - do zlecenia</span>
          </button>
        </div>
      </div>
    </div>
  );
};
