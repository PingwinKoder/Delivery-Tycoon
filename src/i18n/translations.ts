import type { SupportedLanguage } from '../utils/settingsSystem';

export interface LanguageMetadata {
  code: SupportedLanguage;
  nativeLabel: string;
}

/**
 * Extensible language registry — adding new languages requires only appending
 * the language code to SupportedLanguage, this list, and the TRANSLATIONS table.
 */
export const SUPPORTED_LANGUAGES: readonly LanguageMetadata[] = [
  { code: 'pl', nativeLabel: 'Polski' },
  { code: 'en', nativeLabel: 'English' },
];

const pl = {
  // Game Title & Start Screen Main Menu
  'game.title': 'Delivery Tycoon',
  'start.subtitle': 'Zbuduj lokalną firmę kurierską od zera',
  'start.newGame': 'Nowa gra',
  'start.loadGame': 'Wczytaj grę',
  'start.settings': 'Ustawienia',
  'start.noFreeSlots': 'Brak wolnych slotów — usuń jeden z zapisów w „Wczytaj grę”',
  'start.loadTitle': 'Wczytaj zapis kariery',
  'start.loadSubtitle': 'Wybierz zapis gry lub rozpocznij nową karierę w wolnym slocie',
  'start.backToMenu': 'Menu główne',

  // Save Slot Cards
  'save.slotLabel': 'Zapis #{slot}',
  'save.emptyBadge': 'Wolne miejsce',
  'save.emptyHint': 'Rozpocznij nową karierę w tym slocie',
  'save.noDate': 'Brak daty',
  'save.savedAtTooltip': 'Zapisano: {date}',
  'save.dayTime': 'Dzień {day} • {time}',
  'save.cash': 'Gotówka:',
  'save.warehouse': 'Magazyn Poz. {level}',
  'save.bikes': 'Rowery: {count}',
  'save.vans': 'Busy: {count}',
  'save.team': 'Zespół: {count}/6',
  'save.load': 'Wczytaj',
  'save.delete': 'Usuń',
  'save.deleteAria': 'Usuń Zapis #{slot}',
  'save.confirmDelete': 'Potwierdź usunięcie',
  'save.cancel': 'Anuluj',

  // Settings Modal
  'settings.title': 'Ustawienia',
  'settings.subtitle': 'Dźwięk i język interfejsu',
  'settings.sfxVolume': 'Głośność gry (SFX)',
  'settings.musicVolume': 'Głośność muzyki',
  'settings.language': 'Język',
  'settings.autoSaveHint': 'Ustawienia zapisują się automatycznie',
  'settings.close': 'Zamknij',
  'settings.closeAria': 'Zamknij okno Ustawienia',

  // Main HUD Buttons
  'hud.orders': 'Zlecenia',
  'hud.ordersUnreadAria': 'Zlecenia ({count} nieprzeczytanych ofert)',
  'hud.ordersUnreadTitle': 'Zlecenia ({count} nowych ofert)',
  'hud.company': 'Firma',
  'hud.companyTitle': 'Firma — stan przedsiębiorstwa i rozbudowa',
  'hud.settings': 'Ustawienia',
  'hud.settingsTitle': 'Ustawienia gry (pauza)',
} as const;

export type TranslationKey = keyof typeof pl;

const en: Record<TranslationKey, string> = {
  // Game Title & Start Screen Main Menu
  'game.title': 'Delivery Tycoon',
  'start.subtitle': 'Build a local courier company from the ground up',
  'start.newGame': 'New Game',
  'start.loadGame': 'Load Game',
  'start.settings': 'Settings',
  'start.noFreeSlots': 'No free slots — delete a save in "Load Game"',
  'start.loadTitle': 'Load Career Save',
  'start.loadSubtitle': 'Choose a saved career or start fresh in an empty slot',
  'start.backToMenu': 'Main Menu',

  // Save Slot Cards
  'save.slotLabel': 'Save #{slot}',
  'save.emptyBadge': 'Empty slot',
  'save.emptyHint': 'Start a new career in this slot',
  'save.noDate': 'No date',
  'save.savedAtTooltip': 'Saved: {date}',
  'save.dayTime': 'Day {day} • {time}',
  'save.cash': 'Cash:',
  'save.warehouse': 'Warehouse Lvl. {level}',
  'save.bikes': 'Bikes: {count}',
  'save.vans': 'Vans: {count}',
  'save.team': 'Team: {count}/6',
  'save.load': 'Load',
  'save.delete': 'Delete',
  'save.deleteAria': 'Delete Save #{slot}',
  'save.confirmDelete': 'Confirm delete',
  'save.cancel': 'Cancel',

  // Settings Modal
  'settings.title': 'Settings',
  'settings.subtitle': 'Audio & interface language',
  'settings.sfxVolume': 'Game Volume (SFX)',
  'settings.musicVolume': 'Music Volume',
  'settings.language': 'Language',
  'settings.autoSaveHint': 'Settings are saved automatically',
  'settings.close': 'Close',
  'settings.closeAria': 'Close Settings modal',

  // Main HUD Buttons
  'hud.orders': 'Orders',
  'hud.ordersUnreadAria': 'Orders ({count} unread offers)',
  'hud.ordersUnreadTitle': 'Orders ({count} new offers)',
  'hud.company': 'Company',
  'hud.companyTitle': 'Company — overview and upgrades',
  'hud.settings': 'Settings',
  'hud.settingsTitle': 'Game Settings (pauses game)',
};

export const TRANSLATIONS: Record<SupportedLanguage, Record<TranslationKey, string>> = {
  pl,
  en,
};

export function t(
  lang: SupportedLanguage,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const dictionary = TRANSLATIONS[lang] ?? TRANSLATIONS.pl;
  let template = dictionary[key] ?? TRANSLATIONS.pl[key] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      template = template.replace(
        new RegExp(`\\{${paramKey}\\}`, 'g'),
        String(paramValue)
      );
    }
  }

  return template;
}
