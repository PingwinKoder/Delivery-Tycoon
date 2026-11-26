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
  const isMobile =
    window.innerWidth < 1024 &&
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(pointer: fine)').matches;
  return !isMobile;
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
      document.exitFullscreen().catch(() => { });
    }
  };

  const handleSetFullscreen = () => {
    if (
      !document.fullscreenElement &&
      typeof document.documentElement.requestFullscreen === 'function'
    ) {
      document.documentElement.requestFullscreen().catch(() => { });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:p-4 bg-slate-950/75 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-heading"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-[92vw] max-w-md [@media(min-width:1024px)_and_(min-height:541px)]:max-w-[580px] max-h-[92vh] [@media(max-height:540px)]:max-h-[95vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700 shadow-lg overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3 px-2.5 py-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-5 [@media(min-width:1024px)_and_(min-height:541px)]:py-3.5 bg-slate-950/80 border-b border-slate-700">
          <div className="flex items-center gap-2 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3 min-w-0">
            <div className="w-6 h-6 [@media(min-width:1024px)_and_(min-height:541px)]:w-10 [@media(min-width:1024px)_and_(min-height:541px)]:h-10 rounded-lg bg-orange-500/15 border border-orange-500/50 text-orange-400 flex items-center justify-center shrink-0">
              <Settings className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="settings-modal-heading"
                className="text-xs [@media(min-width:1024px)_and_(min-height:541px)]:text-lg font-bold text-slate-100 leading-tight truncate"
              >
                {t(lang, 'settings.title')}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, 'settings.closeAria')}
            className="min-w-[26px] min-h-[26px] [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[38px] [@media(min-width:1024px)_and_(min-height:541px)]:min-h-[38px] p-1 [@media(min-width:1024px)_and_(min-height:541px)]:p-1.5 rounded-lg flex items-center justify-center shrink-0 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          >
            <X className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Top Tabs: Audio always; Graphics exclusively on PC */}
        <div
          role="tablist"
          aria-label={t(lang, 'settings.title')}
          className="flex items-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 px-2.5 py-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-5 [@media(min-width:1024px)_and_(min-height:541px)]:py-2.5 bg-slate-950/55 border-b border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'audio'}
            onClick={() => setActiveTab('audio')}
            className={`flex-1 py-1 px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold flex items-center justify-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 border transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${effectiveTab === 'audio'
                ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
          >
            <Volume2 className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
            <span>{t(lang, 'settings.tabAudio')}</span>
          </button>

          {isDesktop && (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === 'graphics'}
              onClick={() => setActiveTab('graphics')}
              className={`flex-1 py-1 px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-2 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold flex items-center justify-center gap-1 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 border transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${effectiveTab === 'graphics'
                  ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
            >
              <Monitor className="w-3 h-3 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
              <span>{t(lang, 'settings.tabGraphics')}</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-2 [@media(min-width:1024px)_and_(min-height:541px)]:p-5 space-y-2 [@media(min-width:1024px)_and_(min-height:541px)]:space-y-4">
          {effectiveTab === 'audio' ? (
            <>
              {/* SFX Volume */}
              <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-2 [@media(min-width:1024px)_and_(min-height:541px)]:p-4 space-y-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="settings-sfx-volume"
                    className="flex items-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2.5 text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold text-slate-200"
                  >
                    {settings.sfxVolume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5 text-slate-500 shrink-0" aria-hidden="true" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5 text-orange-400 shrink-0" aria-hidden="true" />
                    )}
                    <span>{t(lang, 'settings.sfxVolume')}</span>
                  </label>
                  <span className="px-1.5 py-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-1 rounded bg-slate-900 border border-slate-700/90 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold text-orange-300 tabular-nums min-w-[38px] [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[54px] text-center">
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
                  className="w-full h-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:h-2.5 rounded-lg appearance-none bg-slate-800 accent-orange-500 cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                />
              </div>

              {/* Music Volume */}
              <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-2 [@media(min-width:1024px)_and_(min-height:541px)]:p-4 space-y-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="settings-music-volume"
                    className="flex items-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2.5 text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold text-slate-200"
                  >
                    <Music
                      className={`w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5 shrink-0 ${settings.musicVolume === 0 ? 'text-slate-500' : 'text-orange-400'
                        }`}
                      aria-hidden="true"
                    />
                    <span>{t(lang, 'settings.musicVolume')}</span>
                  </label>
                  <span className="px-1.5 py-0.5 [@media(min-width:1024px)_and_(min-height:541px)]:px-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-1 rounded bg-slate-900 border border-slate-700/90 text-[10px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold text-orange-300 tabular-nums min-w-[38px] [@media(min-width:1024px)_and_(min-height:541px)]:min-w-[54px] text-center">
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
                  className="w-full h-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:h-2.5 rounded-lg appearance-none bg-slate-800 accent-orange-500 cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                />
              </div>

              {/* Language Selector — strictly visible ONLY when opened from Start Screen */}
              {openedFrom === 'start' && (
                <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-2 [@media(min-width:1024px)_and_(min-height:541px)]:p-4 space-y-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:space-y-3">
                  <div className="flex items-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2.5 text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold text-slate-200">
                    <Globe className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5 text-orange-400 shrink-0" aria-hidden="true" />
                    <span>{t(lang, 'settings.language')}</span>
                  </div>

                  <div
                    role="group"
                    aria-label={t(lang, 'settings.language')}
                    className="grid grid-cols-2 gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3"
                  >
                    {SUPPORTED_LANGUAGES.map((entry) => {
                      const isSelected = settings.language === entry.code;
                      return (
                        <button
                          key={entry.code}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => onUpdateSettings({ language: entry.code })}
                          className={`py-1.5 px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-3 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold border transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${isSelected
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
            <div className="rounded-lg bg-slate-950/75 border border-slate-800 p-2 [@media(min-width:1024px)_and_(min-height:541px)]:p-4 space-y-2 [@media(min-width:1024px)_and_(min-height:541px)]:space-y-3">
              <div className="flex items-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2.5 text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-semibold text-slate-200">
                <Monitor className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5 text-orange-400 shrink-0" aria-hidden="true" />
                <span>{t(lang, 'settings.displayMode')}</span>
              </div>

              <div
                role="group"
                aria-label={t(lang, 'settings.displayMode')}
                className="grid grid-cols-2 gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-3"
              >
                <button
                  type="button"
                  aria-pressed={!isFullscreen}
                  onClick={handleSetWindowed}
                  className={`py-1.5 px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-3 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold border flex items-center justify-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${!isFullscreen
                      ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                      : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }`}
                >
                  <Minimize2 className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
                  <span>{t(lang, 'settings.windowed')}</span>
                </button>

                <button
                  type="button"
                  aria-pressed={isFullscreen}
                  onClick={handleSetFullscreen}
                  className={`py-1.5 px-2 [@media(min-width:1024px)_and_(min-height:541px)]:py-3 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 rounded-lg text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold border flex items-center justify-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${isFullscreen
                      ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                      : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }`}
                >
                  <Maximize2 className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-4 [@media(min-width:1024px)_and_(min-height:541px)]:h-4 shrink-0" aria-hidden="true" />
                  <span>{t(lang, 'settings.fullscreen')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Exit to Main Menu button (visible only during active gameplay) */}
          {openedFrom === 'game' && onRequestExitToMenu && (
            <div className="pt-1 [@media(min-width:1024px)_and_(min-height:541px)]:pt-2 border-t border-slate-800/90">
              <button
                type="button"
                onClick={onRequestExitToMenu}
                className="w-full py-1.5 px-2.5 [@media(min-width:1024px)_and_(min-height:541px)]:py-3 [@media(min-width:1024px)_and_(min-height:541px)]:px-4 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-slate-700 hover:border-rose-500/60 text-[11px] [@media(min-width:1024px)_and_(min-height:541px)]:text-sm font-bold flex items-center justify-center gap-1.5 [@media(min-width:1024px)_and_(min-height:541px)]:gap-2.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
              >
                <LogOut className="w-3.5 h-3.5 [@media(min-width:1024px)_and_(min-height:541px)]:w-5 [@media(min-width:1024px)_and_(min-height:541px)]:h-5 shrink-0" aria-hidden="true" />
                <span>{t(lang, 'settings.exitToMenu')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
