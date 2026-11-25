import React, { useEffect, useState } from 'react';
import {
  Globe,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  Music,
  Settings,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, t } from '../i18n/translations';
import type { GameSettings } from '../utils/settingsSystem';

export type SettingsOpenedFrom = 'start' | 'game';
type SettingsTab = 'audio' | 'graphics';

export interface SettingsModalProps {
  isOpen: boolean;
  openedFrom: SettingsOpenedFrom;
  settings: GameSettings;
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
  onRequestExitToMenu?: () => void;
  onClose: () => void;
}

function isDesktopEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const isNarrowScreen = window.innerWidth < 1024;
  return !isCoarsePointer && !isNarrowScreen;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  openedFrom,
  settings,
  onUpdateSettings,
  onRequestExitToMenu,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('audio');
  const [isDesktop, setIsDesktop] = useState<boolean>(() => isDesktopEnvironment());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );

  // Reset to Audio tab whenever modal opens and refresh desktop detection
  useEffect(() => {
    if (!isOpen) return;
    const desktop = isDesktopEnvironment();
    setIsDesktop(desktop);
    if (!desktop) {
      setActiveTab('audio');
    }
    setIsFullscreen(Boolean(document.fullscreenElement));
  }, [isOpen]);

  // Keep desktop detection synced on resize / orientation change
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      const desktop = isDesktopEnvironment();
      setIsDesktop(desktop);
      if (!desktop) {
        setActiveTab('audio');
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  // Synchronize fullscreen button state with native browser Fullscreen API (including Esc exits)
  useEffect(() => {
    if (!isOpen) return;

    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, [isOpen]);

  // Escape closes Settings modal
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

  const lang = settings.language;
  const effectiveTab: SettingsTab = isDesktop ? activeTab : 'audio';

  const handleSetWindowed = () => {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleSetFullscreen = () => {
    if (
      !document.fullscreenElement &&
      typeof document.documentElement.requestFullscreen === 'function'
    ) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-3 [@media(max-height:540px)]:p-1.5 bg-slate-950/75 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-heading"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-[92vw] max-w-md max-h-[92vh] [@media(max-height:540px)]:max-h-[95vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700 shadow-lg overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 [@media(max-height:540px)]:px-3 [@media(max-height:540px)]:py-2 bg-slate-950/80 border-b border-slate-700">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 [@media(max-height:540px)]:w-7 [@media(max-height:540px)]:h-7 rounded-lg bg-orange-500/15 border border-orange-500/50 text-orange-400 flex items-center justify-center shrink-0">
              <Settings className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="settings-modal-heading"
                className="text-sm sm:text-base [@media(max-height:540px)]:text-sm font-bold text-slate-100 leading-tight truncate"
              >
                {t(lang, 'settings.title')}
              </h2>
              <p className="text-[11px] [@media(max-height:540px)]:text-[10px] text-slate-400 leading-tight truncate">
                {t(lang, 'settings.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, 'settings.closeAria')}
            className="min-w-[30px] min-h-[30px] p-1 rounded-lg flex items-center justify-center shrink-0 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Top Tabs: Audio always; Graphics exclusively on PC */}
        <div
          role="tablist"
          aria-label={t(lang, 'settings.title')}
          className="flex items-center gap-1.5 px-3.5 py-2 [@media(max-height:540px)]:px-3 [@media(max-height:540px)]:py-1.5 bg-slate-950/55 border-b border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'audio'}
            onClick={() => setActiveTab('audio')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
              effectiveTab === 'audio'
                ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{t(lang, 'settings.tabAudio')}</span>
          </button>

          {isDesktop && (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === 'graphics'}
              onClick={() => setActiveTab('graphics')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                effectiveTab === 'graphics'
                  ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(lang, 'settings.tabGraphics')}</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3.5 sm:p-4 [@media(max-height:540px)]:p-2.5 space-y-3.5 [@media(max-height:540px)]:space-y-2.5">
          {effectiveTab === 'audio' ? (
            <>
              {/* SFX Volume */}
              <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-3 [@media(max-height:540px)]:p-2 space-y-2 [@media(max-height:540px)]:space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="settings-sfx-volume"
                    className="flex items-center gap-2 text-xs font-semibold text-slate-200"
                  >
                    {settings.sfxVolume === 0 ? (
                      <VolumeX className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-orange-400 shrink-0" aria-hidden="true" />
                    )}
                    <span>{t(lang, 'settings.sfxVolume')}</span>
                  </label>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700/90 text-xs font-bold text-orange-300 tabular-nums min-w-[46px] text-center">
                    {settings.sfxVolume}%
                  </span>
                </div>

                <input
                  id="settings-sfx-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.sfxVolume}
                  onChange={(e) => onUpdateSettings({ sfxVolume: Number(e.target.value) })}
                  className="w-full h-2 rounded-lg appearance-none bg-slate-800 accent-orange-500 cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                />
              </div>

              {/* Music Volume */}
              <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-3 [@media(max-height:540px)]:p-2 space-y-2 [@media(max-height:540px)]:space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="settings-music-volume"
                    className="flex items-center gap-2 text-xs font-semibold text-slate-200"
                  >
                    <Music
                      className={`w-4 h-4 shrink-0 ${
                        settings.musicVolume === 0 ? 'text-slate-500' : 'text-orange-400'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{t(lang, 'settings.musicVolume')}</span>
                  </label>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700/90 text-xs font-bold text-orange-300 tabular-nums min-w-[46px] text-center">
                    {settings.musicVolume}%
                  </span>
                </div>

                <input
                  id="settings-music-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.musicVolume}
                  onChange={(e) => onUpdateSettings({ musicVolume: Number(e.target.value) })}
                  className="w-full h-2 rounded-lg appearance-none bg-slate-800 accent-orange-500 cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                />
              </div>

              {/* Language Selector — strictly visible ONLY when opened from Start Screen */}
              {openedFrom === 'start' && (
                <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-3 [@media(max-height:540px)]:p-2 space-y-2 [@media(max-height:540px)]:space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Globe className="w-4 h-4 text-orange-400 shrink-0" aria-hidden="true" />
                    <span>{t(lang, 'settings.language')}</span>
                  </div>

                  <div
                    role="group"
                    aria-label={t(lang, 'settings.language')}
                    className="grid grid-cols-2 gap-2"
                  >
                    {SUPPORTED_LANGUAGES.map((entry) => {
                      const isSelected = settings.language === entry.code;
                      return (
                        <button
                          key={entry.code}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => onUpdateSettings({ language: entry.code })}
                          className={`py-2 [@media(max-height:540px)]:py-1.5 px-3 rounded-lg text-xs font-bold border transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                            isSelected
                              ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                              : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
                          }`}
                        >
                          {entry.nativeLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Graphics Tab (PC only): Windowed vs Fullscreen toggle */
            <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Monitor className="w-4 h-4 text-orange-400 shrink-0" aria-hidden="true" />
                <span>{t(lang, 'settings.displayMode')}</span>
              </div>

              <div
                role="group"
                aria-label={t(lang, 'settings.displayMode')}
                className="grid grid-cols-2 gap-2"
              >
                <button
                  type="button"
                  aria-pressed={!isFullscreen}
                  onClick={handleSetWindowed}
                  className={`py-2.5 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                    !isFullscreen
                      ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                      : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                >
                  <Minimize2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t(lang, 'settings.windowed')}</span>
                </button>

                <button
                  type="button"
                  aria-pressed={isFullscreen}
                  onClick={handleSetFullscreen}
                  className={`py-2.5 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                    isFullscreen
                      ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                      : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                >
                  <Maximize2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t(lang, 'settings.fullscreen')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Exit to Main Menu button (visible only during active gameplay) */}
          {openedFrom === 'game' && onRequestExitToMenu && (
            <div className="pt-1 border-t border-slate-800/90">
              <button
                type="button"
                onClick={onRequestExitToMenu}
                className="w-full py-2.5 [@media(max-height:540px)]:py-2 px-3.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-slate-700 hover:border-rose-500/60 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
              >
                <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t(lang, 'settings.exitToMenu')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-2 [@media(max-height:540px)]:px-3 [@media(max-height:540px)]:py-1.5 bg-slate-950/80 border-t border-slate-800">
          <span className="text-[11px] text-slate-400 truncate">
            {t(lang, 'settings.autoSaveHint')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 [@media(max-height:540px)]:py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          >
            {t(lang, 'settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
