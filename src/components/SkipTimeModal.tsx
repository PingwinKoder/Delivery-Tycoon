import React, { useEffect } from 'react';
import { SkipForward, X } from 'lucide-react';
import { getMonthName, getWeekdayName, t } from '../i18n/translations';
import { getGameClockDisplay } from '../utils/gameClock';
import type { SupportedLanguage } from '../utils/settingsSystem';

interface SkipTimeModalProps {
  isOpen: boolean;
  language: SupportedLanguage;
  nextDayMorningMinutes: number;
  onClose: () => void;
  onSkipDay: () => void;
}

export const SkipTimeModal: React.FC<SkipTimeModalProps> = ({
  isOpen,
  language,
  nextDayMorningMinutes,
  onClose,
  onSkipDay,
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
  const nextDayText = `${getWeekdayName(language, nextDayClock.dayIndex, false)} | ${nextDayClock.dayOfMonth} ${getMonthName(language, nextDayClock.monthIndex, false)} | 08:00`;

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
        className="w-full max-w-md [@media(max-height:540px)]:max-h-[94vh] rounded-2xl [@media(max-height:540px)]:rounded-xl bg-[#182030] border border-slate-700/90 shadow-lg overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 [@media(max-height:540px)]:px-3 py-3 [@media(max-height:540px)]:py-2 border-b border-slate-700/80 bg-[#141b29]">
          <div className="flex items-center gap-2 [@media(max-height:540px)]:gap-1.5 min-w-0">
            <SkipForward className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
            <h2 id="skip-time-modal-title" className="text-sm sm:text-base [@media(max-height:540px)]:text-sm font-bold text-slate-100">
              {t(language, 'skipTime.title')}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'skipTime.closeAria')}
            className="min-w-[40px] min-h-[40px] [@media(max-height:540px)]:min-w-[32px] [@media(max-height:540px)]:min-h-[32px] p-2 [@media(max-height:540px)]:p-1.5 rounded-lg flex items-center justify-center text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Helper description */}
        <div className="px-4 sm:px-5 [@media(max-height:540px)]:px-3 pt-4 [@media(max-height:540px)]:pt-2.5 pb-3 [@media(max-height:540px)]:pb-2 space-y-2.5 [@media(max-height:540px)]:space-y-1.5 text-xs sm:text-sm [@media(max-height:540px)]:text-xs text-slate-300 leading-relaxed [@media(max-height:540px)]:leading-snug">
          <p>
            <span className="font-semibold text-slate-100">{t(language, 'skipTime.dayLabel')}</span>{' '}
            {t(language, 'skipTime.dayDescPrefix')}
            <span className="font-mono-nums text-amber-300">{nextDayText}</span>
            {t(language, 'skipTime.dayDescSuffix')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="px-4 sm:px-5 [@media(max-height:540px)]:px-3 pb-4 [@media(max-height:540px)]:pb-2.5 pt-2 [@media(max-height:540px)]:pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 [@media(max-height:540px)]:gap-1.5 border-t border-slate-800/90">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] [@media(max-height:540px)]:min-h-0 px-4 [@media(max-height:540px)]:px-3 py-2 [@media(max-height:540px)]:py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-semibold transition-colors cursor-pointer touch-manipulation whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            {t(language, 'skipTime.cancel')}
          </button>

          <button
            type="button"
            onClick={onSkipDay}
            className="min-h-[42px] [@media(max-height:540px)]:min-h-0 px-4 [@media(max-height:540px)]:px-3 py-2 [@media(max-height:540px)]:py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer touch-manipulation whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            <SkipForward className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
            <span>{t(language, 'skipTime.skipDayBtn')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
