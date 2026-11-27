export type SupportedLanguage = 'pl' | 'en';
export type PcMaxFpsOption = 30 | 60 | 90 | 120 | 'unlimited';
export type MobileMaxFpsOption = 30 | 45 | 60;
export type MaxFpsLimit = PcMaxFpsOption | MobileMaxFpsOption;

export const PC_MAX_FPS_OPTIONS: readonly PcMaxFpsOption[] = [30, 60, 90, 120, 'unlimited'];
export const MOBILE_MAX_FPS_OPTIONS: readonly MobileMaxFpsOption[] = [30, 45, 60];

export interface GameSettings {
  /** Game sound effects volume (0–100) */
  sfxVolume: number;
  /** Background music volume (0–100) */
  musicVolume: number;
  /** Active UI language */
  language: SupportedLanguage;
  /** Upper FPS cap on PC / desktop */
  pcMaxFps: PcMaxFpsOption;
  /** Upper FPS cap on mobile phones */
  mobileMaxFps: MobileMaxFpsOption;
  /** Whether to show the top-right FPS counter badge in the HUD */
  showFpsCounter: boolean;
  /** Whether to render street name labels on roads */
  showStreetNames: boolean;
}

export const SETTINGS_STORAGE_KEY = 'delivery_tycoon_settings_v1';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  sfxVolume: 80,
  musicVolume: 60,
  language: 'pl',
  pcMaxFps: 60,
  mobileMaxFps: 60,
  showFpsCounter: true,
  showStreetNames: true,
};

const VALID_LANGUAGES: readonly SupportedLanguage[] = ['pl', 'en'];

function clampVolume(raw: unknown, fallback: number): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeLanguage(raw: unknown, fallback: SupportedLanguage): SupportedLanguage {
  if (typeof raw === 'string' && (VALID_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as SupportedLanguage;
  }
  return fallback;
}

function normalizePcMaxFps(raw: unknown, fallback: PcMaxFpsOption): PcMaxFpsOption {
  if (raw === 'unlimited') return 'unlimited';
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (num === 30 || num === 60 || num === 90 || num === 120) {
    return num;
  }
  return fallback;
}

function normalizeMobileMaxFps(raw: unknown, fallback: MobileMaxFpsOption): MobileMaxFpsOption {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (num === 30 || num === 45 || num === 60) {
    return num;
  }
  return fallback;
}

function normalizeShowFpsCounter(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  return fallback;
}

export function normalizeGameSettings(raw: Partial<GameSettings> | null | undefined): GameSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_GAME_SETTINGS };
  }
  return {
    sfxVolume: clampVolume(raw.sfxVolume, DEFAULT_GAME_SETTINGS.sfxVolume),
    musicVolume: clampVolume(raw.musicVolume, DEFAULT_GAME_SETTINGS.musicVolume),
    language: normalizeLanguage(raw.language, DEFAULT_GAME_SETTINGS.language),
    pcMaxFps: normalizePcMaxFps(raw.pcMaxFps, DEFAULT_GAME_SETTINGS.pcMaxFps),
    mobileMaxFps: normalizeMobileMaxFps(raw.mobileMaxFps, DEFAULT_GAME_SETTINGS.mobileMaxFps),
    showFpsCounter: normalizeShowFpsCounter(
      raw.showFpsCounter,
      DEFAULT_GAME_SETTINGS.showFpsCounter
    ),
    showStreetNames: normalizeShowFpsCounter(
      raw.showStreetNames,
      DEFAULT_GAME_SETTINGS.showStreetNames
    ),
  };
}

/**
 * Returns true strictly for small touchscreen phones (narrow viewport, coarse pointer, no fine pointer).
 * Desktop PCs and touchscreen laptops return false.
 */
export function isMobileTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.innerWidth < 1024 &&
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(pointer: fine)').matches
  );
}

export function loadGameSettings(): GameSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_GAME_SETTINGS };
  }

  try {
    const serialized = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!serialized) {
      return { ...DEFAULT_GAME_SETTINGS };
    }
    const parsed = JSON.parse(serialized) as Partial<GameSettings> | null;
    return normalizeGameSettings(parsed);
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

export function saveGameSettings(settings: GameSettings): GameSettings {
  const normalized = normalizeGameSettings(settings);
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalized;
  }

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota or private-mode errors gracefully
  }

  return normalized;
}

/**
 * Requests browser fullscreen mode on mobile / coarse-pointer devices when not already fullscreen.
 * Uses standard Fullscreen API with webkitRequestFullscreen fallback and ignores promise rejections.
 */
export function requestMobileFullscreen(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const isMobile =
    window.innerWidth < 1024 &&
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(pointer: fine)').matches;
  if (!isMobile) return;

  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return;

  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  try {
    if (typeof root.requestFullscreen === 'function') {
      const result = root.requestFullscreen();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } else if (typeof root.webkitRequestFullscreen === 'function') {
      const result = root.webkitRequestFullscreen();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    }
  } catch {
    // Gracefully ignore Fullscreen API errors on unsupported browsers
  }
}
