export type GameSpeed = 0 | 1 | 2 | 4;

/** Automatic night fast-forward speed multiplier when workday ends and all couriers are at base */
export const NIGHT_MODE_SPEED = 15;

export type EffectiveGameSpeed = GameSpeed | typeof NIGHT_MODE_SPEED;

export const GAME_SPEED_OPTIONS: readonly GameSpeed[] = [0, 1, 2, 4];

/** Base in-game clock rate at 1x speed: 1 real second = 1.25 in-game minutes (2x = 2.5/s, 4x = 5/s, 15x = 18.75/s) */
export const BASE_GAME_MINUTES_PER_REAL_SECOND = 1.25;

export function getGameMinutesPerRealSecond(speed: EffectiveGameSpeed): number {
  return speed * BASE_GAME_MINUTES_PER_REAL_SECOND;
}

export const INITIAL_BALANCE = 1500;

export const WORKDAY_START_HOUR = 8;
/** Standard workday start minute-of-day: 08:00 (480 minutes) */
export const WORKDAY_START_MINUTES = WORKDAY_START_HOUR * 60;

/** Initial game time: Day 1 (1 Czerwiec, Rok 1, Poniedziałek) at 08:00 */
export const INITIAL_GAME_MINUTES = WORKDAY_START_MINUTES;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR; // 1440
export const DAYS_PER_WEEK = 7;
export const MINUTES_PER_WEEK = DAYS_PER_WEEK * MINUTES_PER_DAY; // 10080
export const DAYS_PER_YEAR = 365;

export const START_YEAR = 1;
/** 0-indexed month index for Czerwiec (0 = Styczeń .. 11 = Grudzień) */
export const START_MONTH_INDEX = 5;
export const START_DAY_OF_MONTH = 1;

export interface PolishMonthSpec {
  /** 0-based month index (0 = Styczeń .. 11 = Grudzień) */
  index: number;
  /** 1-based month number (1..12) */
  number: number;
  /** Polish month name in nominative case (mianownik) */
  name: string;
  /** Short 3-letter abbreviation for compact mobile UI */
  shortName: string;
  /** Fixed number of days in this month */
  days: number;
}

export const POLISH_MONTHS: readonly PolishMonthSpec[] = [
  { index: 0, number: 1, name: 'Styczeń', shortName: 'Sty', days: 31 },
  { index: 1, number: 2, name: 'Luty', shortName: 'Lut', days: 28 },
  { index: 2, number: 3, name: 'Marzec', shortName: 'Mar', days: 31 },
  { index: 3, number: 4, name: 'Kwiecień', shortName: 'Kwi', days: 30 },
  { index: 4, number: 5, name: 'Maj', shortName: 'Maj', days: 31 },
  { index: 5, number: 6, name: 'Czerwiec', shortName: 'Cze', days: 30 },
  { index: 6, number: 7, name: 'Lipiec', shortName: 'Lip', days: 31 },
  { index: 7, number: 8, name: 'Sierpień', shortName: 'Sie', days: 31 },
  { index: 8, number: 9, name: 'Wrzesień', shortName: 'Wrz', days: 30 },
  { index: 9, number: 10, name: 'Październik', shortName: 'Paź', days: 31 },
  { index: 10, number: 11, name: 'Listopad', shortName: 'Lis', days: 30 },
  { index: 11, number: 12, name: 'Grudzień', shortName: 'Gru', days: 31 },
] as const;

/** Cumulative day offset of the 1st day of each month within a 365-day year */
const MONTH_START_DAY_OF_YEAR: readonly number[] = POLISH_MONTHS.reduce<number[]>(
  (acc, month, idx) => {
    acc.push(idx === 0 ? 0 : acc[idx - 1] + POLISH_MONTHS[idx - 1].days);
    return acc;
  },
  []
);

/** 0-based day-of-year offset for 1 Czerwiec (31+28+31+30+31 = 151) */
export const START_DAY_OF_YEAR =
  MONTH_START_DAY_OF_YEAR[START_MONTH_INDEX] + (START_DAY_OF_MONTH - 1);

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

export interface GameCalendarDate {
  /** 0-based elapsed days since game start (0 = 1 Czerwiec, Rok 1) */
  elapsedDays: number;
  /** 1-based gameplay day counter (1 = 1 Czerwiec, Rok 1) */
  gameDay: number;
  /** 0 = Poniedziałek .. 6 = Niedziela (continuous cycle across months & years) */
  dayIndex: number;
  weekday: string;
  weekdayShort: string;
  /** Day of the calendar month (1..31) */
  dayOfMonth: number;
  /** 0-based month index (0 = Styczeń .. 11 = Grudzień) */
  monthIndex: number;
  /** 1-based month number (1..12) */
  monthNumber: number;
  monthName: string;
  monthShort: string;
  /** Calendar year starting at 1 (increments after 31 Grudzień) */
  year: number;
  /** Stable identifier for the calendar month (e.g. "1-06", "2-01") */
  monthKey: string;
  /** Monotonic calendar month index ((year - 1) * 12 + monthIndex) */
  absoluteMonthIndex: number;
}

export interface GameClockDisplay extends GameCalendarDate {
  hours: number;
  minutes: number;
  timeText: string;
  /** Full date & clock label: "Poniedziałek | 1 Czerwiec | Rok 1 | 08:00" */
  fullText: string;
}

/**
 * Resolves a 0-based elapsed day offset (0 = 1 Czerwiec, Rok 1, Poniedziałek)
 * into full Polish calendar date fields with a continuous Mon–Sun weekday cycle.
 */
export function getCalendarDateFromElapsedDays(elapsedDays: number): GameCalendarDate {
  const safeElapsed = Math.max(0, Math.floor(elapsedDays));
  const dayIndex = safeElapsed % DAYS_PER_WEEK;

  const absoluteCalendarDay = START_DAY_OF_YEAR + safeElapsed;
  const year = START_YEAR + Math.floor(absoluteCalendarDay / DAYS_PER_YEAR);
  let remainingDayOfYear = absoluteCalendarDay % DAYS_PER_YEAR;

  let monthSpec = POLISH_MONTHS[0];
  for (let i = 0; i < POLISH_MONTHS.length; i++) {
    const m = POLISH_MONTHS[i];
    if (remainingDayOfYear < m.days) {
      monthSpec = m;
      break;
    }
    remainingDayOfYear -= m.days;
  }

  const dayOfMonth = remainingDayOfYear + 1;
  const monthKey = `${year}-${String(monthSpec.number).padStart(2, '0')}`;

  return {
    elapsedDays: safeElapsed,
    gameDay: safeElapsed + 1,
    dayIndex,
    weekday: POLISH_WEEKDAYS[dayIndex],
    weekdayShort: POLISH_WEEKDAYS_SHORT[dayIndex],
    dayOfMonth,
    monthIndex: monthSpec.index,
    monthNumber: monthSpec.number,
    monthName: monthSpec.name,
    monthShort: monthSpec.shortName,
    year,
    monthKey,
    absoluteMonthIndex: (year - 1) * 12 + monthSpec.index,
  };
}

/**
 * Converts a 1-based gameplay day (1 = 1 Czerwiec, Rok 1) into a GameCalendarDate.
 */
export function getCalendarDateFromGameDay(gameDay: number): GameCalendarDate {
  return getCalendarDateFromElapsedDays(Math.max(1, Math.floor(gameDay)) - 1);
}

/**
 * Computes the 1-based gameplay day after adding `months` calendar months
 * to `startGameDay` (clamping day-of-month if the target month has fewer days).
 */
export function addCalendarMonthsToGameDay(startGameDay: number, months: number): number {
  const start = getCalendarDateFromGameDay(startGameDay);
  const totalMonths = (start.year - 1) * 12 + start.monthIndex + months;
  const targetYear = Math.floor(totalMonths / 12) + 1;
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const targetMonth = POLISH_MONTHS[targetMonthIndex];
  const clampedDay = Math.min(start.dayOfMonth, targetMonth.days);

  const targetAbsoluteDay =
    (targetYear - START_YEAR) * DAYS_PER_YEAR +
    MONTH_START_DAY_OF_YEAR[targetMonthIndex] +
    (clampedDay - 1);

  return Math.max(1, targetAbsoluteDay - START_DAY_OF_YEAR + 1);
}

/**
 * Converts elapsed game minutes (starting at 0 = 1 Czerwiec, Rok 1, Poniedziałek 00:00)
 * into structured Polish calendar date and HH:MM clock fields.
 */
export function getGameClockDisplay(totalMinutes: number): GameClockDisplay {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const elapsedDays = Math.floor(safeMinutes / MINUTES_PER_DAY);
  const minuteInDay = safeMinutes % MINUTES_PER_DAY;
  const hours = Math.floor(minuteInDay / MINUTES_PER_HOUR);
  const minutes = minuteInDay % MINUTES_PER_HOUR;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const timeText = `${hh}:${mm}`;

  const date = getCalendarDateFromElapsedDays(elapsedDays);
  const fullText = `${date.weekday} | ${date.dayOfMonth} ${date.monthName} | Rok ${date.year} | ${timeText}`;

  return {
    ...date,
    hours,
    minutes,
    timeText,
    fullText,
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
