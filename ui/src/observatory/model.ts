import type { RosterConditionV1, RosterItemV1, RosterWorkersV1 } from '../contracts/types';
import { reasonWords } from './copy';

export type Tone = 'working' | 'settled' | 'unknown';

export interface ConditionView {
  tone: Tone;
  label: string;
  reason: string;
}

const BOT_LABELS: Readonly<Record<string, { tone: Tone; label: string }>> = {
  working: { tone: 'working', label: 'Working' },
  settled: { tone: 'settled', label: 'No turn running' },
  unknown: { tone: 'unknown', label: 'Unknown' },
};

const unknownToken = (state: string): ConditionView => ({ tone: 'unknown', label: 'Unknown', reason: `Reason code: ${state}` });

/** Bot level (FP4-D1). A token outside the table is Unknown with its code. */
export function botCondition(condition: RosterConditionV1): ConditionView {
  const known = BOT_LABELS[condition.state];
  return known ? { ...known, reason: reasonWords(condition.reasonCode) } : unknownToken(condition.state);
}

export interface Chip {
  key: 'working' | 'unknown';
  count: number;
  text: string;
}

const plural = (count: number): string => `${count} worker${count === 1 ? '' : 's'}`;

/** Row chips: unknown is its own chip and never joins working; zero counts are omitted. */
export function workerChips(workers: RosterWorkersV1): Chip[] {
  const chips: Chip[] = [];
  if (workers.running > 0) chips.push({ key: 'working', count: workers.running, text: `${plural(workers.running)} working` });
  if (workers.unknown > 0) chips.push({ key: 'unknown', count: workers.unknown, text: `${plural(workers.unknown)} unknown` });
  return chips;
}

export const UNNAMED = 'Unnamed bot';

export const nameOf = (item: RosterItemV1): string =>
  item.displayName !== null && item.displayName.trim() !== '' ? item.displayName : UNNAMED;

/** Initials come from the display name, never from bindingId; "?" when there is no name. */
export function initialsOf(item: RosterItemV1): string {
  if (item.displayName === null) return '?';
  const words = item.displayName.trim().split(/\s+/).filter((word) => word !== '');
  const initials = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase();
  return initials === '' ? '?' : initials;
}

/** Locale, case-insensitive; bindingId breaks ties so a refresh never reorders equals. */
export function sortRoster(items: readonly RosterItemV1[]): RosterItemV1[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  return [...items].sort(
    (a, b) => collator.compare(nameOf(a), nameOf(b)) || (a.bindingId < b.bindingId ? -1 : a.bindingId > b.bindingId ? 1 : 0),
  );
}

export function matchesQuery(item: RosterItemV1, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return needle === '' || nameOf(item).toLocaleLowerCase().includes(needle);
}

export interface TimeOptions {
  locale?: string;
  timeZone?: string;
  long?: boolean;
}

/** Epoch ms in, user-locale text out. Tests pin `locale` and `timeZone`. */
export function formatTime(ms: number, options: TimeOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeStyle: options.long === true ? 'long' : 'short',
    timeZone: options.timeZone,
  }).format(new Date(ms));
}
