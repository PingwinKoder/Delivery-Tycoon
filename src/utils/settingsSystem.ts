export type SupportedLanguage = 'pl' | 'en';

export interface GameSettings {
  /** Game sound effects volume (0–100) */
  sfxVolume: number;
  /** Background music volume (0–100) */
  musicVolume: number;
  /** Active UI language */
  language: SupportedLanguage;
}

export const SETTINGS_STORAGE_KEY = 'delivery_tycoon_settings_v1';

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  sfxVolume: 80,
  musicVolume: 60,
  language: 'pl',
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

export function normalizeGameSettings(raw: Partial<GameSettings> | null | undefined): GameSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_GAME_SETTINGS };
  }
  return {
    sfxVolume: clampVolume(raw.sfxVolume, DEFAULT_GAME_SETTINGS.sfxVolume),
    musicVolume: clampVolume(raw.musicVolume, DEFAULT_GAME_SETTINGS.musicVolume),
    language: normalizeLanguage(raw.language, DEFAULT_GAME_SETTINGS.language),
  };
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
