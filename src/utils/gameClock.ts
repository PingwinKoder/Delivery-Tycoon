export type GameSpeed = 0 | 1 | 2 | 4;

export const GAME_SPEED_OPTIONS: readonly GameSpeed[] = [0, 1, 2, 4];

export const INITIAL_BALANCE = 1500;

/** Initial game time: Monday (day 0), Week 1, 08:00 (480 minutes from Week 1 start) */
export const INITIAL_GAME_MINUTES = 8 * 60;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR; // 1440
export const DAYS_PER_WEEK = 7;
export const MINUTES_PER_WEEK = DAYS_PER_WEEK * MINUTES_PER_DAY; // 10080

export const POLISH_WEEKDAYS = [
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
  'Niedziela',
] as const;

export const POLISH_WEEKDAYS_SHORT = [
  'Pon',
  'Wt',
  'Śr',
  'Czw',
  'Pt',
  'Sob',
  'Nd',
] as const;

export interface GameClockDisplay {
  week: number;
  dayIndex: number;
  weekday: string;
  weekdayShort: string;
  hours: number;
  minutes: number;
  timeText: string;
}

/**
 * Converts elapsed game minutes (starting at 0 = Week 1, Monday 00:00) into
 * structured Polish weekday, week number, and HH:MM time fields.
 * After Sunday 23:59 (minute 10079), minute 10080 rolls over to Monday Week 2 00:00.
 */
export function getGameClockDisplay(totalMinutes: number): GameClockDisplay {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const week = Math.floor(safeMinutes / MINUTES_PER_WEEK) + 1;
  const minuteInWeek = safeMinutes % MINUTES_PER_WEEK;
  const dayIndex = Math.floor(minuteInWeek / MINUTES_PER_DAY);
  const minuteInDay = minuteInWeek % MINUTES_PER_DAY;
  const hours = Math.floor(minuteInDay / MINUTES_PER_HOUR);
  const minutes = minuteInDay % MINUTES_PER_HOUR;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');

  return {
    week,
    dayIndex,
    weekday: POLISH_WEEKDAYS[dayIndex],
    weekdayShort: POLISH_WEEKDAYS_SHORT[dayIndex],
    hours,
    minutes,
    timeText: `${hh}:${mm}`,
  };
}

/**
 * Formats an account balance in USD with space thousands separators (e.g. "$1 500").
 */
export function formatBalanceUsd(amount: number): string {
  const isNegative = amount < 0;
  const rounded = Math.round(Math.abs(amount));
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${isNegative ? '-' : ''}$${grouped}`;
}
