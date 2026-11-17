import type { AttemptItemV1, AttemptsV1, AttemptsWindowV1, RosterCollectorV1, RosterItemV1, RosterConditionV1, RosterWorkersV1 } from '../contracts/types';
import { reasonWords } from './copy';

export type Tone = 'working' | 'settled' | 'unknown' | 'ended';

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

const ATTEMPT_LABELS: Readonly<Record<string, { tone: Tone; label: string }>> = {
  working: { tone: 'working', label: 'Working' },
  ended: { tone: 'ended', label: 'Ended' },
  unknown: { tone: 'unknown', label: 'Unknown' },
};

const unknownToken = (state: string): ConditionView => ({ tone: 'unknown', label: 'Unknown', reason: `Reason code: ${state}` });

/** Bot level (FP4-D1). A token outside the table is Unknown with its code. */
export function botCondition(condition: RosterConditionV1): ConditionView {
  const known = BOT_LABELS[condition.state];
  return known ? { ...known, reason: reasonWords(condition.reasonCode) } : unknownToken(condition.state);
}

/** Attempt level. `kind` picks "turn" or "worker" for the `running` sentence. */
export function attemptCondition(attempt: AttemptItemV1): ConditionView {
  const known = ATTEMPT_LABELS[attempt.condition.state];
  return known ? { ...known, reason: reasonWords(attempt.condition.reasonCode, attempt.kind) } : unknownToken(attempt.condition.state);
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

export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes === 0) return ms > 0 ? 'under 1 m' : '0 m';
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  return [days > 0 ? `${days} d` : '', hours > 0 ? `${hours} h` : '', rest > 0 ? `${rest} m` : ''].filter((part) => part !== '').join(' ');
}

/** Coverage in words with its denominator. No percentage and no rate. */
export function coverageSentence(window: AttemptsWindowV1, windowLabel: '24 h' | '7 d'): string {
  if (window.coveredMs <= 0) return 'Not collected';
  const span =
    window.observedFromMs === window.fromMs
      ? `of ${windowLabel}`
      : `of the ${formatDuration(window.toMs - window.observedFromMs)} since this bot was first seen`;
  const gaps = window.gapCount === 0 ? '' : ` (${window.gapCount} ${window.gapCount === 1 ? 'gap' : 'gaps'})`;
  return `Collector covered ${formatDuration(window.coveredMs)} ${span}${gaps}`;
}

/** Newest first, `attemptId` descending as tiebreak; the first list wins a duplicate id. */
export function mergeAttempts(first: readonly AttemptItemV1[], older: readonly AttemptItemV1[]): AttemptItemV1[] {
  const seen = new Set<string>();
  const merged: AttemptItemV1[] = [];
  for (const attempt of [...first, ...older]) {
    if (seen.has(attempt.attemptId)) continue;
    seen.add(attempt.attemptId);
    merged.push(attempt);
  }
  return merged.sort((a, b) => b.startedMs - a.startedMs || (a.attemptId < b.attemptId ? 1 : a.attemptId > b.attemptId ? -1 : 0));
}

export type SourceRow = { label: string; text: string } | { label: string; ms: number | null };

const textRow = (label: string, text: string | number | null): SourceRow => ({ label, text: text === null ? 'None' : String(text) });
const timeRow = (label: string, ms: number | null): SourceRow => ({ label, ms });

/** Rows are built by naming each field, never by iterating keys, so an extra wire key cannot reach the page. */
export function sourceRows(
  item: RosterItemV1,
  collector: RosterCollectorV1,
  rosterRevision: number,
  attempts: AttemptsV1 | null,
): SourceRow[] {
  const rows: SourceRow[] = [
    textRow('Presence', item.presence),
    textRow('Condition state', item.condition.state),
    textRow('Condition reason code', item.condition.reasonCode),
    textRow('Basis', item.condition.basis),
    timeRow('Source time', item.condition.sourceTimeMs),
    timeRow('Observed time', item.condition.observedAtMs),
    timeRow('Last observed', item.lastObservedAtMs),
    textRow('Coverage state', item.coverage.state),
    timeRow('Coverage since', item.coverage.sinceMs),
    textRow('Coverage reason code', item.coverage.reasonCode),
    textRow('Open gaps', item.coverage.openGapCount),
    textRow('Workers running', item.workers.running),
    textRow('Workers unknown', item.workers.unknown),
    textRow('Workers seen', item.workers.seen),
    textRow('Collector state', collector.state),
    textRow('Collector reason code', collector.reasonCode),
    timeRow('Collector since', collector.sinceMs),
    textRow('Roster revision', rosterRevision),
  ];
  if (attempts === null) return rows;
  for (const [key, window] of [['24 h', attempts.activity.last24h], ['7 d', attempts.activity.last7d]] as const) {
    rows.push(
      timeRow(`${key} window from`, window.fromMs),
      timeRow(`${key} window to`, window.toMs),
      timeRow(`${key} observed from`, window.observedFromMs),
      textRow(`${key} window length (ms)`, window.windowMs),
      textRow(`${key} covered (ms)`, window.coveredMs),
      textRow(`${key} gaps`, window.gapCount),
    );
  }
  return rows;
}

export const isOpen = (attempt: AttemptItemV1): boolean => attempt.condition.state !== 'ended';
