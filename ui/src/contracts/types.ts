// Hand-written types for the seed wire contracts in contracts/schemas/. The schemas are the
// source of truth; contracts.test.ts fails when a type drifts from its schema.

export interface ApiErrorV1 {
  contractVersion: 1;
  error: string;
}

export interface PageV1<Item extends object = Record<string, unknown>> {
  contractVersion: 1;
  items: Item[];
  nextCursor: string | null;
}

export type StoreStateV1 = 'ready' | 'unconfigured' | 'migrating' | 'schema-newer' | 'sqlite-too-old' | 'unavailable' | 'disabled';

export interface ReadyV1 {
  contractVersion: 1;
  status: 'ready' | 'not-ready';
  store: StoreStateV1;
  storeVersion: number | null;
  latestVersion: number | null;
}

export interface RosterAvatarV1 {
  kind: string;
  ref: string | null;
}

/** The four Crew flags as the collector last saw them (null when not seen); not mapped to a state. */
export interface RosterSignalsV1 {
  needsInput: boolean | null;
  hasOptions: boolean | null;
  pendingApproval: boolean | null;
  waitingForInput: boolean | null;
}

/** state is a documented token, not a closed list: working, settled, unknown today. */
export interface RosterConditionV1 {
  state: string;
  reasonCode: string;
  basis: 'row' | 'event' | null;
  sourceTimeMs: number | null;
  observedAtMs: number | null;
  signals: RosterSignalsV1;
}

export interface RosterCoverageV1 {
  state: 'covered' | 'gap' | 'unknown';
  sinceMs: number | null;
  reasonCode: string | null;
  openGapCount: number;
}

/** running + unknown is the open worker count; unknown is never folded into running. */
export interface RosterWorkersV1 {
  running: number;
  seen: number;
  unknown: number;
}

export interface RosterItemV1 {
  contractVersion: 1;
  bindingId: string;
  displayName: string | null;
  avatar: RosterAvatarV1 | null;
  presence: 'present' | 'absent' | 'unknown';
  condition: RosterConditionV1;
  coverage: RosterCoverageV1;
  lastObservedAtMs: number | null;
  workers: RosterWorkersV1;
}

export interface RosterCollectorV1 {
  state: string;
  reasonCode: string | null;
  sinceMs: number | null;
}

/** code is a token such as cron-turns-not-observable; count is null when the note has no number. */
export interface RosterNoteV1 {
  code: string;
  count: number | null;
}

export interface RosterV1 {
  contractVersion: 1;
  items: RosterItemV1[];
  nextCursor: string | null;
  rosterRevision: number;
  collector: RosterCollectorV1;
  notes: RosterNoteV1[];
}

/** state is a documented token, not a closed list: working, ended, unknown today. */
export interface AttemptConditionV1 {
  state: string;
  reasonCode: string;
}

/** attemptId is opaque. endedMs and endSignal are null while the attempt is open. */
export interface AttemptItemV1 {
  contractVersion: 1;
  attemptId: string;
  kind: string;
  startedMs: number;
  endedMs: number | null;
  endSignal: string | null;
  condition: AttemptConditionV1;
}

/** sampleSize = botTurnsStarted + workersStarted = ended + stillOpen + unknown. coveredMs 0 means not collected. */
export interface AttemptsWindowV1 {
  fromMs: number;
  toMs: number;
  windowMs: number;
  observedFromMs: number;
  coveredMs: number;
  gapCount: number;
  botTurnsStarted: number;
  workersStarted: number;
  sampleSize: number;
  ended: number;
  stillOpen: number;
  unknown: number;
}

export interface AttemptsActivityV1 {
  last24h: AttemptsWindowV1;
  last7d: AttemptsWindowV1;
}

export interface AttemptsV1 {
  contractVersion: 1;
  bindingId: string;
  items: AttemptItemV1[];
  nextCursor: string | null;
  rosterRevision: number;
  asOfMs: number;
  activity: AttemptsActivityV1;
}

// A Record over keyof T makes tsc reject a missing or an extra key, so the test can compare these
// names with the schema's properties in both directions.
export const API_ERROR_KEYS: Record<keyof ApiErrorV1, true> = { contractVersion: true, error: true };
export const PAGE_KEYS: Record<keyof PageV1, true> = { contractVersion: true, items: true, nextCursor: true };
export const READY_KEYS: Record<keyof ReadyV1, true> = { contractVersion: true, status: true, store: true, storeVersion: true, latestVersion: true };
export const ROSTER_AVATAR_KEYS: Record<keyof RosterAvatarV1, true> = { kind: true, ref: true };
export const ROSTER_SIGNALS_KEYS: Record<keyof RosterSignalsV1, true> = { needsInput: true, hasOptions: true, pendingApproval: true, waitingForInput: true };
export const ROSTER_CONDITION_KEYS: Record<keyof RosterConditionV1, true> = { state: true, reasonCode: true, basis: true, sourceTimeMs: true, observedAtMs: true, signals: true };
export const ROSTER_COVERAGE_KEYS: Record<keyof RosterCoverageV1, true> = { state: true, sinceMs: true, reasonCode: true, openGapCount: true };
export const ROSTER_WORKERS_KEYS: Record<keyof RosterWorkersV1, true> = { running: true, seen: true, unknown: true };
export const ROSTER_ITEM_KEYS: Record<keyof RosterItemV1, true> = { contractVersion: true, bindingId: true, displayName: true, avatar: true, presence: true, condition: true, coverage: true, lastObservedAtMs: true, workers: true };
export const ROSTER_COLLECTOR_KEYS: Record<keyof RosterCollectorV1, true> = { state: true, reasonCode: true, sinceMs: true };
export const ROSTER_NOTE_KEYS: Record<keyof RosterNoteV1, true> = { code: true, count: true };
export const ROSTER_KEYS: Record<keyof RosterV1, true> = { contractVersion: true, items: true, nextCursor: true, rosterRevision: true, collector: true, notes: true };
export const ATTEMPT_CONDITION_KEYS: Record<keyof AttemptConditionV1, true> = { state: true, reasonCode: true };
export const ATTEMPT_ITEM_KEYS: Record<keyof AttemptItemV1, true> = { contractVersion: true, attemptId: true, kind: true, startedMs: true, endedMs: true, endSignal: true, condition: true };
export const ATTEMPTS_WINDOW_KEYS: Record<keyof AttemptsWindowV1, true> = { fromMs: true, toMs: true, windowMs: true, observedFromMs: true, coveredMs: true, gapCount: true, botTurnsStarted: true, workersStarted: true, sampleSize: true, ended: true, stillOpen: true, unknown: true };
export const ATTEMPTS_ACTIVITY_KEYS: Record<keyof AttemptsActivityV1, true> = { last24h: true, last7d: true };
export const ATTEMPTS_KEYS: Record<keyof AttemptsV1, true> = { contractVersion: true, bindingId: true, items: true, nextCursor: true, rosterRevision: true, asOfMs: true, activity: true };
