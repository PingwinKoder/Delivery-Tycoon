import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  Clock,
  FolderOpen,
  Package,
  Play,
  Plus,
  Settings,
  Trash2,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import { t } from '../i18n/translations';
import { formatBalanceUsd, getGameClockDisplay } from '../utils/gameClock';
import {
  SAVE_SLOT_IDS,
  type SaveSlotEntry,
  type SaveSlotId,
} from '../utils/saveSystem';
import type { SupportedLanguage } from '../utils/settingsSystem';

export interface StartScreenModalProps {
  isVisible: boolean;
  language: SupportedLanguage;
  slots: Record<SaveSlotId, SaveSlotEntry | null>;
  onStartNewGame: (slotId: SaveSlotId) => void;
  onLoadGame: (slotId: SaveSlotId) => void;
  onDeleteSlot: (slotId: SaveSlotId) => void;
  onOpenSettings: () => void;
}

type StartScreenView = 'menu' | 'load';

function formatSavedTimestamp(isoString: string, lang: SupportedLanguage): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return t(lang, 'save.noDate');
  }
  const locale = lang === 'en' ? 'en-US' : 'pl-PL';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    return parsed.toLocaleString();
  }
}

export const StartScreenModal: React.FC<StartScreenModalProps> = ({
  isVisible,
  language,
  slots,
  onStartNewGame,
  onLoadGame,
  onDeleteSlot,
  onOpenSettings,
}) => {
  const [view, setView] = useState<StartScreenView>('menu');
  const [confirmDeleteSlotId, setConfirmDeleteSlotId] = useState<SaveSlotId | null>(null);

  const firstFreeSlot = useMemo<SaveSlotId | null>(() => {
    for (const slotId of SAVE_SLOT_IDS) {
      if (slots[slotId] === null) {
        return slotId;
      }
    }
    return null;
  }, [slots]);

  const savedSlotsCount = useMemo(() => {
    let count = 0;
    for (const slotId of SAVE_SLOT_IDS) {
      if (slots[slotId] !== null) count += 1;
    }
    return count;
  }, [slots]);

  // Reset to main menu whenever the Start Screen is shown again (e.g. after Save & Exit)
  useEffect(() => {
    if (isVisible) {
      setView('menu');
      setConfirmDeleteSlotId(null);
    }
  }, [isVisible]);

  // Clear pending delete confirmation if the target slot is removed externally
  useEffect(() => {
    if (confirmDeleteSlotId !== null && slots[confirmDeleteSlotId] === null) {
      setConfirmDeleteSlotId(null);
    }
  }, [confirmDeleteSlotId, slots]);

  // Escape returns from Load view back to Main Menu
  useEffect(() => {
    if (!isVisible || view !== 'load') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmDeleteSlotId(null);
        setView('menu');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, view]);

  const [isSettledVisible, setIsSettledVisible] = useState<boolean>(isVisible);

  // Release will-change-[opacity] cleanly after the 300ms fade-in completes
  useEffect(() => {
    if (!isVisible) {
      setIsSettledVisible(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsSettledVisible(true);
    }, 340);
    return () => window.clearTimeout(timer);
  }, [isVisible]);

  const handleConfirmDelete = (slotId: SaveSlotId) => {
    setConfirmDeleteSlotId(null);
    onDeleteSlot(slotId);
  };

  return (
    <div
      onTransitionEnd={(e) => {
        if (isVisible && e.target === e.currentTarget && e.propertyName === 'opacity') {
          setIsSettledVisible(true);
        }
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 [@media(max-height:540px)]:p-1.5 transition-opacity duration-300 ease-out touch-none ${
        isVisible
          ? isSettledVisible
            ? 'opacity-100 pointer-events-auto will-change-auto'
            : 'opacity-100 pointer-events-auto will-change-[opacity]'
          : 'opacity-0 pointer-events-none will-change-[opacity]'
      }`}
      role="dialog"
      aria-modal={isVisible}
      aria-hidden={!isVisible}
      aria-labelledby="start-screen-heading"
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {view === 'menu' ? (
        <div className="w-[92vw] max-w-sm [@media(max-height:540px)]:max-w-xs flex flex-col rounded-xl bg-slate-900/95 border border-slate-700 shadow-md overflow-hidden text-slate-100 touch-auto">
          {/* Brand Header */}
          <div className="px-4 py-4 [@media(max-height:540px)]:px-3.5 [@media(max-height:540px)]:py-2.5 bg-slate-950/85 border-b border-slate-700/90 flex flex-col items-center text-center gap-2 [@media(max-height:540px)]:gap-1">
            <div className="w-11 h-11 [@media(max-height:540px)]:w-8 [@media(max-height:540px)]:h-8 rounded-xl bg-orange-500/15 border border-orange-500/50 text-orange-400 flex items-center justify-center shadow-sm">
              <Package
                className="w-6 h-6 [@media(max-height:540px)]:w-4 [@media(max-height:540px)]:h-4"
                aria-hidden="true"
              />
            </div>
            <div>
              <h1
                id="start-screen-heading"
                className="text-xl sm:text-2xl [@media(max-height:540px)]:text-base font-extrabold tracking-tight text-slate-100 leading-tight"
              >
                {t(language, 'game.title')}
              </h1>
              <p className="text-xs [@media(max-height:540px)]:text-[10px] text-slate-400 mt-0.5 leading-snug">
                {t(language, 'start.subtitle')}
              </p>
            </div>
          </div>

          {/* 3 Primary Menu Buttons */}
          <div className="p-4 [@media(max-height:540px)]:p-2.5 flex flex-col gap-2 [@media(max-height:540px)]:gap-1.5">
            <div className="space-y-1">
              <button
                type="button"
                disabled={firstFreeSlot === null || !isVisible}
                onClick={() => {
                  if (firstFreeSlot !== null) {
                    setConfirmDeleteSlotId(null);
                    onStartNewGame(firstFreeSlot);
                  }
                }}
                className={`w-full py-2.5 [@media(max-height:540px)]:py-1.5 px-4 rounded-lg text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-2 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                  firstFreeSlot !== null
                    ? 'bg-orange-500 hover:bg-orange-400 text-slate-950 cursor-pointer shadow-sm'
                    : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                }`}
              >
                <Plus className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 shrink-0" aria-hidden="true" />
                <span>{t(language, 'start.newGame')}</span>
              </button>
              {firstFreeSlot === null && (
                <p className="text-[11px] [@media(max-height:540px)]:text-[10px] font-medium text-amber-300 leading-tight text-center">
                  {t(language, 'start.noFreeSlots')}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={!isVisible}
              onClick={() => {
                setConfirmDeleteSlotId(null);
                setView('load');
              }}
              className="w-full py-2.5 [@media(max-height:540px)]:py-1.5 px-4 rounded-lg bg-slate-800/95 hover:bg-slate-700 text-slate-100 border border-slate-700 text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
            >
              <FolderOpen className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 text-orange-400 shrink-0" aria-hidden="true" />
              <span>{t(language, 'start.loadGame')}</span>
              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-bold text-slate-300 tabular-nums leading-none">
                {savedSlotsCount}/{SAVE_SLOT_IDS.length}
              </span>
            </button>

            <button
              type="button"
              disabled={!isVisible}
              onClick={onOpenSettings}
              className="w-full py-2.5 [@media(max-height:540px)]:py-1.5 px-4 rounded-lg bg-slate-800/95 hover:bg-slate-700 text-slate-100 border border-slate-700 text-sm [@media(max-height:540px)]:text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
            >
              <Settings className="w-4 h-4 [@media(max-height:540px)]:w-3.5 [@media(max-height:540px)]:h-3.5 text-orange-400 shrink-0" aria-hidden="true" />
              <span>{t(language, 'start.settings')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="w-[95vw] max-w-3xl max-h-[92vh] [@media(max-height:540px)]:max-h-[96vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700 shadow-md overflow-hidden text-slate-100 touch-auto overscroll-contain">
          {/* Compact Header: Back Button + Load Game Title */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 sm:px-4 sm:py-3 [@media(max-height:540px)]:px-3 [@media(max-height:540px)]:py-2 bg-slate-950/85 border-b border-slate-700">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 [@media(max-height:540px)]:w-7 [@media(max-height:540px)]:h-7 rounded-lg bg-orange-500/15 border border-orange-500/50 text-orange-400 flex items-center justify-center shrink-0">
                <FolderOpen className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1
                  id="start-screen-heading"
                  className="text-base sm:text-lg [@media(max-height:540px)]:text-sm font-extrabold tracking-tight text-slate-100 leading-tight truncate"
                >
                  {t(language, 'start.loadTitle')}
                </h1>
                <p className="text-[11px] [@media(max-height:540px)]:text-[10px] text-slate-400 leading-tight truncate">
                  {t(language, 'start.loadSubtitle')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setConfirmDeleteSlotId(null);
                setView('menu');
              }}
              className="px-3 py-1.5 [@media(max-height:540px)]:px-2.5 [@media(max-height:540px)]:py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(language, 'start.backToMenu')}</span>
            </button>
          </div>

          {/* 3 Save Slot Cards */}
          <div
            className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 [@media(max-height:540px)]:p-2"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 [@media(max-height:540px)]:grid-cols-3 [@media(max-height:540px)]:gap-2">
              {SAVE_SLOT_IDS.map((slotId) => {
                const entry = slots[slotId];
                const isConfirmingDelete = confirmDeleteSlotId === slotId;

                if (!entry) {
                  return (
                    <article
                      key={slotId}
                      className="rounded-lg bg-slate-950/80 border border-slate-700/85 p-3 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2.5 [@media(max-height:540px)]:gap-1.5 min-h-[156px] [@media(max-height:540px)]:min-h-[120px]"
                    >
                      <div className="flex items-center justify-between gap-1.5 border-b border-slate-800 pb-1.5 [@media(max-height:540px)]:pb-1">
                        <span className="text-xs font-bold text-slate-200 tracking-wide">
                          {t(language, 'save.slotLabel', { slot: slotId })}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-400 leading-none">
                          {t(language, 'save.emptyBadge')}
                        </span>
                      </div>

                      <div className="flex-1 flex flex-col items-center justify-center text-center py-2 [@media(max-height:540px)]:py-0.5">
                        <FolderOpen
                          className="w-5 h-5 text-slate-600 mb-1 [@media(max-height:540px)]:w-4 [@media(max-height:540px)]:h-4"
                          aria-hidden="true"
                        />
                        <p className="text-xs font-medium text-slate-400">
                          {t(language, 'save.emptyBadge')}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5 hidden sm:block [@media(max-height:540px)]:hidden">
                          {t(language, 'save.emptyHint')}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={!isVisible}
                        onClick={() => {
                          setConfirmDeleteSlotId(null);
                          onStartNewGame(slotId);
                        }}
                        className="w-full py-1.5 [@media(max-height:540px)]:py-1 px-2.5 rounded-md bg-orange-500/15 hover:bg-orange-500 text-orange-300 hover:text-slate-950 border border-orange-500/50 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-orange-400"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{t(language, 'start.newGame')}</span>
                      </button>
                    </article>
                  );
                }

                const clock = getGameClockDisplay(entry.state.gameMinutes);
                const hiredCount = Math.max(
                  1,
                  entry.state.couriers.filter((c) => c.hired).length
                );
                const savedAtLabel = formatSavedTimestamp(entry.updatedAt, language);

                return (
                  <article
                    key={slotId}
                    className="rounded-lg bg-slate-950/80 border border-slate-700 p-3 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5 min-h-[156px] [@media(max-height:540px)]:min-h-[120px]"
                  >
                    {/* Slot Header & Real-World Save Date */}
                    <div className="flex items-center justify-between gap-1.5 border-b border-slate-800 pb-1.5 [@media(max-height:540px)]:pb-1">
                      <span className="text-xs font-bold text-orange-400 tracking-wide shrink-0">
                        {t(language, 'save.slotLabel', { slot: slotId })}
                      </span>
                      <span
                        className="text-[10px] tabular-nums text-slate-400 truncate"
                        title={t(language, 'save.savedAtTooltip', { date: savedAtLabel })}
                      >
                        {savedAtLabel}
                      </span>
                    </div>

                    {/* Progress Summary */}
                    <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="inline-flex items-center gap-1 text-slate-200 font-semibold tabular-nums truncate">
                          <Clock className="w-3 h-3 text-orange-400 shrink-0" aria-hidden="true" />
                          <span>
                            {t(language, 'save.dayTime', {
                              day: clock.gameDay,
                              time: clock.timeText,
                            })}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-[11px] text-slate-400">
                          {t(language, 'save.cash')}
                        </span>
                        <span
                          className={`text-xs font-bold tabular-nums ${
                            entry.state.cash >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatBalanceUsd(entry.state.cash)}
                        </span>
                      </div>

                      <div className="rounded-md bg-slate-900/95 border border-slate-800 px-2 py-1.5 [@media(max-height:540px)]:px-1.5 [@media(max-height:540px)]:py-1 text-[11px] [@media(max-height:540px)]:text-[10px] text-slate-300 tabular-nums leading-snug">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Warehouse className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                            <span>
                              {t(language, 'save.warehouse', {
                                level: entry.state.warehouseLevel,
                              })}
                            </span>
                          </span>
                          <span className="text-slate-600" aria-hidden="true">•</span>
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Bike className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                            <span>
                              {t(language, 'save.bikes', { count: entry.state.bikesCount })}
                            </span>
                          </span>
                          <span className="text-slate-600" aria-hidden="true">•</span>
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Truck className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                            <span>
                              {t(language, 'save.vans', { count: entry.state.vansCount })}
                            </span>
                          </span>
                          <span className="text-slate-600" aria-hidden="true">•</span>
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Users className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                            <span>{t(language, 'save.team', { count: hiredCount })}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Slot Actions: Load + Two-Step Delete Confirmation */}
                    <div className="pt-1 border-t border-slate-800">
                      {isConfirmingDelete ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleConfirmDelete(slotId)}
                            className="flex-1 py-1.5 [@media(max-height:540px)]:py-1 px-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-400"
                          >
                            {t(language, 'save.confirmDelete')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSlotId(null)}
                            className="py-1.5 [@media(max-height:540px)]:py-1 px-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-orange-400"
                          >
                            {t(language, 'save.cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={!isVisible}
                            onClick={() => {
                              setConfirmDeleteSlotId(null);
                              onLoadGame(slotId);
                            }}
                            className="flex-1 py-1.5 [@media(max-height:540px)]:py-1 px-2.5 rounded-md bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-orange-300"
                          >
                            <Play className="w-3.5 h-3.5 shrink-0 fill-current" aria-hidden="true" />
                            <span>{t(language, 'save.load')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSlotId(slotId)}
                            aria-label={t(language, 'save.deleteAria', { slot: slotId })}
                            className="py-1.5 [@media(max-height:540px)]:py-1 px-2.5 rounded-md bg-slate-800 hover:bg-rose-950/90 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/60 text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>{t(language, 'save.delete')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
