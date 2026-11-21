// SPECTER-FIXTURE-ONLY: FIXTURE bodies for the preview harness and unit tests; never imported by ui/src.
import type {
  AttemptItemV1,
  AttemptsV1,
  AttemptsWindowV1,
  RosterCollectorV1,
  RosterItemV1,
  RosterItemV2,
  RosterNoteV1,
  RosterSignalsV1,
  RosterTokenReadingV2,
  RosterV1,
  RosterV2,
} from '../src/contracts/types.ts';
import { canonicalArenaScenario, perfBots } from './arena-scenarios.ts';

export const SCENARIO_NAMES = [
  'default',
  'two-concurrent',
  'all-reasons',
  'empty',
  'paused',
  'reconnecting',
  'collector-unavailable',
  'offline',
  'store-not-ready',
  'expired',
  'attempt-gone',
  'not-collected',
  'arena-perf-roster',
  'arena-stale-roster',
  'crew-signals',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** 2026-11-17T12:00:00Z, fixed so no body depends on the real clock. */
export const FIXTURE_NOW_MS = 1794916800000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const FIRST_SEEN_MS = FIXTURE_NOW_MS - 6_800_000;
const COLLECTING_SINCE_MS = FIXTURE_NOW_MS - 6_900_000;
const API_PREFIX = '/apps/specter-arena/api/roster';

export const ALL_BOT_REASONS = [
  'running',
  'not-running',
  'never-observed',
  'presence-absent',
  'presence-unknown',
  'no-coverage',
  'restart',
  'disconnect',
  'auth-stopped',
  'app-disabled',
  'scope-lost-or-silent',
  'overflow',
  'store-unavailable',
  'paused',
  'source-restart',
  'roster-unavailable',
  'feed-absent',
  'no-slot-yet',
  'unsupported-store-less-bot',
  'unobserved-turns',
  'heartbeat-stale',
] as const;

type Presence = RosterItemV1['presence'];
type Coverage = RosterItemV1['coverage'];

interface AttemptSpec {
  kind: 'bot-turn' | 'worker';
  state: 'working' | 'unknown' | 'ended';
  reason: string;
  startedAgoMs: number;
  endedAgoMs?: number;
  endSignal?: string;
}

export interface BotSpec {
  n: number;
  name: string | null;
  state: string;
  reason: string;
  presence?: Presence;
  coverage?: Coverage;
  signals?: Partial<RosterSignalsV1>;
  /** The context reading served on `?view=signals`; omitted means none (null, Not collected). */
  reading?: RosterTokenReadingV2;
  attempts?: AttemptSpec[];
  firstSeenMs?: number;
  coveredMs?: number;
  gapCount?: number;
}

const hex4 = (n: number): string => n.toString(16).padStart(4, '0');
const bindingIdOf = (n: number): string => `bnd_${'a'.repeat(20)}${hex4(n)}`;
const attemptIdOf = (bot: number, index: number): string => `att_${'c'.repeat(16)}${hex4(bot)}${hex4(index + 1)}`;

const COVERED: Coverage = { state: 'covered', sinceMs: COLLECTING_SINCE_MS, reasonCode: null, openGapCount: 0 };

const CRON_NOTE: RosterNoteV1 = { code: 'cron-turns-not-observable', count: null };
const RUNNING_COLLECTOR: RosterCollectorV1 = { state: 'running', reasonCode: null, sinceMs: COLLECTING_SINCE_MS };

const ATLAS: BotSpec = {
  n: 1,
  name: 'Atlas',
  state: 'working',
  reason: 'running',
  reading: { kind: 'context', used: 48_000, window: 200_000, observedAt: FIXTURE_NOW_MS - 20_000 },
  attempts: [
    { kind: 'worker', state: 'working', reason: 'running', startedAgoMs: 300_000 },
    { kind: 'worker', state: 'unknown', reason: 'feed-absent', startedAgoMs: 2_400_000 },
    { kind: 'bot-turn', state: 'ended', reason: 'ended-row-idle', startedAgoMs: 3_600_000, endedAgoMs: 3_000_000, endSignal: 'row-idle' },
  ],
  coveredMs: 6_200_000,
  gapCount: 1,
};

const ENDED_TURN: AttemptSpec = {
  kind: 'bot-turn',
  state: 'ended',
  reason: 'ended-chat-done',
  startedAgoMs: 5_000_000,
  endedAgoMs: 4_800_000,
  endSignal: 'chat-done',
};

const DEFAULT_BOTS: BotSpec[] = [
  ATLAS,
  { n: 2, name: 'Brindle', state: 'settled', reason: 'not-running', attempts: [ENDED_TURN], coveredMs: 6_800_000 },
  { n: 3, name: 'Cinder', state: 'unknown', reason: 'no-slot-yet' },
  { n: 4, name: 'Dune', state: 'unknown', reason: 'never-observed' },
  {
    n: 5,
    name: 'Ember',
    state: 'unknown',
    reason: 'presence-absent',
    presence: 'absent',
    coverage: { state: 'unknown', sinceMs: null, reasonCode: 'no-coverage', openGapCount: 0 },
  },
  { n: 6, name: null, state: 'settled', reason: 'not-running' },
  { n: 7, name: 'Fenn', state: 'settled', reason: 'not-running', signals: { pendingApproval: true } },
];

const PAUSED_BOTS: BotSpec[] = ['Atlas', 'Brindle', 'Cinder'].map((name, index) => ({
  n: index + 1,
  name,
  state: 'unknown',
  reason: 'paused',
  coverage: { state: 'gap', sinceMs: COLLECTING_SINCE_MS, reasonCode: 'paused', openGapCount: 1 },
  gapCount: 1,
}));

const RECONNECTING_BOTS: BotSpec[] = ['Atlas', 'Brindle', 'Cinder'].map((name, index) => ({
  n: index + 1,
  name,
  state: 'unknown',
  reason: 'disconnect',
  coverage: { state: 'gap', sinceMs: COLLECTING_SINCE_MS, reasonCode: 'disconnect', openGapCount: 1 },
  gapCount: 1,
}));

const ALL_REASONS_BOTS: BotSpec[] = ALL_BOT_REASONS.map((reason, index) => ({
  n: index + 1,
  name: `Reason ${reason}`,
  state: reason === 'running' ? 'working' : reason === 'not-running' ? 'settled' : 'unknown',
  reason,
  attempts: [{ kind: 'bot-turn', state: reason === 'running' ? 'working' : 'unknown', reason, startedAgoMs: 600_000 }],
}));

const rowBasis = (state: string): boolean => state === 'working' || state === 'settled' || state === 'waiting';

/** FIXTURE bots for the waiting condition (one per reason), a reading, no reading, and a real zero. */
const CREW_SIGNALS_BOTS: BotSpec[] = [
  { n: 1, name: 'Approval', state: 'waiting', reason: 'approval-pending', signals: { pendingApproval: true }, reading: { kind: 'context', used: 48_000, window: 200_000, observedAt: FIXTURE_NOW_MS - 30_000 } },
  { n: 2, name: 'Question', state: 'waiting', reason: 'question-pending', signals: { needsInput: true } },
  { n: 3, name: 'Zero reading', state: 'settled', reason: 'not-running', reading: { kind: 'context', used: 0, window: 200_000, observedAt: FIXTURE_NOW_MS - 90_000 } },
  { n: 4, name: 'Busy', state: 'working', reason: 'running', reading: { kind: 'context', used: 151_250, window: 200_000, observedAt: FIXTURE_NOW_MS - 10_000 } },
  { n: 5, name: 'No reading', state: 'settled', reason: 'not-running' },
  { n: 6, name: 'Flag only', state: 'settled', reason: 'not-running', signals: { waitingForInput: true, hasOptions: true } },
];

const NOT_COLLECTED_BOT: BotSpec = {
  n: 1,
  name: 'Atlas',
  state: 'unknown',
  reason: 'no-coverage',
  coverage: { state: 'unknown', sinceMs: null, reasonCode: 'no-coverage', openGapCount: 0 },
  firstSeenMs: FIXTURE_NOW_MS - 5 * HOUR_MS,
  coveredMs: 0,
};

const attemptItems = (spec: BotSpec): AttemptItemV1[] =>
  (spec.attempts ?? []).map((attempt, index) => ({
    contractVersion: 1,
    attemptId: attemptIdOf(spec.n, index),
    kind: attempt.kind,
    startedMs: FIXTURE_NOW_MS - attempt.startedAgoMs,
    endedMs: attempt.endedAgoMs === undefined ? null : FIXTURE_NOW_MS - attempt.endedAgoMs,
    endSignal: attempt.endSignal ?? null,
    condition: { state: attempt.state, reasonCode: attempt.reason },
  }));

const countWhere = (items: AttemptItemV1[], kind: string, state: string): number =>
  items.filter((item) => item.kind === kind && item.condition.state === state).length;

function windowOf(items: AttemptItemV1[], spec: BotSpec, windowMs: number): AttemptsWindowV1 {
  const toMs = FIXTURE_NOW_MS;
  const fromMs = toMs - windowMs;
  const observedFromMs = Math.max(fromMs, spec.firstSeenMs ?? FIRST_SEEN_MS);
  const stateCount = (state: string) => items.filter((item) => item.condition.state === state).length;
  const workersStarted = items.filter((item) => item.kind === 'worker').length;
  return {
    fromMs,
    toMs,
    windowMs,
    observedFromMs,
    coveredMs: Math.min(spec.coveredMs ?? 0, toMs - observedFromMs),
    gapCount: spec.gapCount ?? 0,
    botTurnsStarted: items.length - workersStarted,
    workersStarted,
    sampleSize: items.length,
    ended: stateCount('ended'),
    stillOpen: stateCount('working'),
    unknown: stateCount('unknown'),
  };
}

function rosterItem(spec: BotSpec): RosterItemV1 {
  const items = attemptItems(spec);
  const working = rowBasis(spec.state);
  return {
    contractVersion: 1,
    bindingId: bindingIdOf(spec.n),
    displayName: spec.name,
    avatar: null,
    presence: spec.presence ?? 'present',
    condition: {
      state: spec.state,
      reasonCode: spec.reason,
      basis: working ? 'row' : null,
      sourceTimeMs: working ? FIXTURE_NOW_MS - 60_000 : null,
      observedAtMs: working ? FIXTURE_NOW_MS - 59_000 : null,
      signals: { needsInput: false, hasOptions: false, pendingApproval: false, waitingForInput: false, ...spec.signals },
    },
    coverage: spec.coverage ?? COVERED,
    lastObservedAtMs: working ? FIXTURE_NOW_MS - 59_000 : null,
    workers: {
      running: countWhere(items, 'worker', 'working'),
      seen: items.filter((item) => item.kind === 'worker').length,
      unknown: countWhere(items, 'worker', 'unknown'),
    },
  };
}

interface ScenarioData {
  bots: BotSpec[];
  collector: RosterCollectorV1;
  notes: RosterNoteV1[];
}

const STORE_LESS_NOTE: RosterNoteV1 = { code: 'unsupported-store-less-bot', count: 2 };

function scenarioData(name: ScenarioName): ScenarioData {
  switch (name) {
    case 'two-concurrent':
      return { bots: [ATLAS], collector: RUNNING_COLLECTOR, notes: [CRON_NOTE] };
    case 'all-reasons':
      return { bots: ALL_REASONS_BOTS, collector: RUNNING_COLLECTOR, notes: [CRON_NOTE] };
    case 'empty':
      return { bots: [], collector: RUNNING_COLLECTOR, notes: [CRON_NOTE] };
    case 'paused':
      return { bots: PAUSED_BOTS, collector: { state: 'paused', reasonCode: null, sinceMs: COLLECTING_SINCE_MS }, notes: [CRON_NOTE] };
    case 'reconnecting':
      return {
        bots: RECONNECTING_BOTS,
        collector: { state: 'reconnecting', reasonCode: 'disconnect', sinceMs: COLLECTING_SINCE_MS },
        notes: [CRON_NOTE],
      };
    case 'collector-unavailable':
      return { bots: [], collector: { state: 'unavailable', reasonCode: 'collector-not-started', sinceMs: null }, notes: [CRON_NOTE] };
    case 'not-collected':
      return { bots: [NOT_COLLECTED_BOT], collector: RUNNING_COLLECTOR, notes: [CRON_NOTE] };
    case 'crew-signals':
      return { bots: CREW_SIGNALS_BOTS, collector: RUNNING_COLLECTOR, notes: [CRON_NOTE] };
    case 'arena-perf-roster':
      return { bots: perfBots(), collector: RUNNING_COLLECTOR, notes: [CRON_NOTE] };
    default:
      return { bots: DEFAULT_BOTS, collector: RUNNING_COLLECTOR, notes: [CRON_NOTE, STORE_LESS_NOTE] };
  }
}

const REVISION = 4;

export function rosterBody(name: ScenarioName): RosterV1 {
  const data = scenarioData(name);
  return {
    contractVersion: 1,
    items: data.bots.map(rosterItem),
    nextCursor: null,
    rosterRevision: REVISION,
    collector: data.collector,
    notes: data.notes,
  };
}

/** `roster.v2` (`?view=signals`): the v1 items plus `tokenReading`, null when the scenario has none for the bot. */
export function rosterV2Body(name: ScenarioName): RosterV2 {
  const data = scenarioData(name);
  const base = rosterBody(name);
  const items: RosterItemV2[] = base.items.map((item, index) => ({ ...item, contractVersion: 2, tokenReading: data.bots[index]?.reading ?? null }));
  return { ...base, contractVersion: 2, items };
}

/** Null means the binding id is not on this scenario's roster (404 unknown_binding). */
export function attemptsBody(name: ScenarioName, bindingId: string): AttemptsV1 | null {
  const spec = scenarioData(name).bots.find((bot) => bindingIdOf(bot.n) === bindingId);
  if (spec === undefined) return null;
  const items = attemptItems(spec);
  return {
    contractVersion: 1,
    bindingId,
    items,
    nextCursor: null,
    rosterRevision: REVISION,
    asOfMs: FIXTURE_NOW_MS,
    activity: { last24h: windowOf(items, spec, DAY_MS), last7d: windowOf(items, spec, 7 * DAY_MS) },
  };
}

let override: ScenarioName | null = null;

/** Reads of the roster since the scenario was set; `arena-stale` loses one binding after the first read. */
let rosterReads = 0;

export function setFixtureScenario(name: ScenarioName | null): void {
  override = name;
  rosterReads = 0;
}

const isScenario = (value: string | null): value is ScenarioName => SCENARIO_NAMES.some((name) => name === value);

/** The test override, else `?scenario=` on the page URL, else `default`; an unknown name is `default`. */
export function activeScenario(): ScenarioName {
  if (override !== null) return override;
  const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scenario');
  const named = canonicalArenaScenario(requested, { arena: 'default', perf: 'arena-perf-roster', stale: 'arena-stale-roster', empty: 'empty' });
  return isScenario(named) ? named : 'default';
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const apiError = (status: number, error: string): Response => json({ contractVersion: 1, error }, status);

function failureResponse(name: ScenarioName): Promise<Response> | null {
  if (name === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
  if (name === 'store-not-ready') return Promise.resolve(apiError(503, 'store_not_ready'));
  if (name === 'expired') return Promise.resolve(new Response(null, { status: 403 }));
  return null;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const ATTEMPTS_PATH = new RegExp(`^${API_PREFIX}/([^/]+)/attempts$`);

/** Null for any path that is not the roster or an attempts path, so the caller can fall through. */
export function monitoringResponse(pathname: string, search = ''): Promise<Response> | null {
  const attemptsMatch = ATTEMPTS_PATH.exec(pathname);
  if (pathname !== API_PREFIX && attemptsMatch === null) return null;
  const name = activeScenario();
  const failure = failureResponse(name);
  if (failure !== null) return failure;
  if (attemptsMatch === null) {
    const body = new URLSearchParams(search).get('view') === 'signals' ? rosterV2Body(name) : rosterBody(name);
    rosterReads += 1;
    return Promise.resolve(json(name === 'arena-stale-roster' && rosterReads > 1 ? { ...body, items: body.items.slice(0, -1) } : body));
  }
  const body = name === 'attempt-gone' ? null : attemptsBody(name, safeDecode(attemptsMatch[1] ?? ''));
  return Promise.resolve(body === null ? apiError(404, 'unknown_binding') : json(body));
}
