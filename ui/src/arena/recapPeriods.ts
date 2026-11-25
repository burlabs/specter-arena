export type RecapKind = 'today' | 'yesterday' | 'week';

export interface RecapPeriod {
  kind: RecapKind;
  fromMs: number;
  toMs: number;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const HOUR_MS = 3_600_000;
const SEARCH_HOURS = 48;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** What a wall clock in `timeZone` reads at `ms`, written as if it were UTC. Sub-second digits are dropped. */
function wallAsUtc(ms: number, timeZone: string | undefined): number {
  const parts = new Map<string, number>();
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) parts.set(part.type, Number(part.value));
  const at = (type: string): number => parts.get(type) ?? 0;
  return Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'));
}

const wholeSecond = (ms: number): number => ms - (((ms % 1000) + 1000) % 1000);
const offsetAt = (ms: number, timeZone: string | undefined): number => wallAsUtc(ms, timeZone) - wholeSecond(ms);

function dateOf(ms: number, timeZone: string | undefined): CalendarDate {
  const wall = new Date(wallAsUtc(ms, timeZone));
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

const addDays = (date: CalendarDate, days: number): CalendarDate => {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
};

/**
 * The first instant the wall clock reads `date` at 00:00. Every offset the zone uses within two days either side is tried,
 * so a 25-hour day, a 23-hour day and a 30-minute shift all resolve. When no instant reads exactly 00:00 (the clock jumps
 * over midnight, as in America/Havana), it is the first instant after the jump.
 */
function midnightOf(date: CalendarDate, timeZone: string | undefined): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day);
  const samples = Array.from({ length: 2 * SEARCH_HOURS + 1 }, (_, index) => wall + (index - SEARCH_HOURS) * HOUR_MS);
  const offsets = new Set(samples.map((sample) => offsetAt(sample, timeZone)));
  const exact = [...offsets].map((offset) => wall - offset).filter((candidate) => wallAsUtc(candidate, timeZone) === wall);
  if (exact.length > 0) return Math.min(...exact);
  const next = samples.findIndex((sample) => wallAsUtc(sample, timeZone) >= wall);
  let low = (samples[next - 1] ?? wall) as number;
  let high = samples[next] as number;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (wallAsUtc(middle, timeZone) >= wall) high = middle;
    else low = middle;
  }
  return high;
}

/** Local midnight of the day that holds `ms`, by calendar date (never `n * 86_400_000`). */
export const startOfLocalDay = (ms: number, timeZone?: string): number => midnightOf(dateOf(ms, timeZone), timeZone);

/** Local 00:00 of the Monday that starts the calendar week holding `ms`. Monday is first in every locale. */
export function mondayOf(ms: number, timeZone?: string): number {
  const today = dateOf(ms, timeZone);
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  return midnightOf(addDays(today, -((weekday + 6) % 7)), timeZone);
}

/**
 * The period a recap covers, as two epoch-millisecond integers. Today and This week end at `nowMs`; Yesterday ends at
 * today's local midnight. On a Monday, This week equals Today. A period is never empty: `toMs` is at least `fromMs + 1`.
 */
export function periodOf(kind: RecapKind, nowMs: number, timeZone?: string): RecapPeriod {
  const today = dateOf(nowMs, timeZone);
  const midnight = midnightOf(today, timeZone);
  const range = (fromMs: number, toMs: number): RecapPeriod => ({ kind, fromMs, toMs: Math.max(toMs, fromMs + 1) });
  if (kind === 'today') return range(midnight, nowMs);
  if (kind === 'yesterday') return range(midnightOf(addDays(today, -1), timeZone), midnight);
  return range(mondayOf(nowMs, timeZone), nowMs);
}

export const isMondayToday = (nowMs: number, timeZone?: string): boolean => mondayOf(nowMs, timeZone) === startOfLocalDay(nowMs, timeZone);
