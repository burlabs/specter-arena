// SPECTER-FIXTURE-ONLY: FIXTURE task and XP routes for the preview harness and unit tests; never imported by ui/src.
import type { TaskItemV1, TasksV1, XpEntryV1, XpSummariesV3, XpSummaryV1, XpSummaryV2 } from '../src/contracts/types.ts';
import { XP_SUMMARIES_VIEW, appApiPath } from '../src/host/paths.ts';
import { canonicalArenaScenario, perfTasks } from './arena-scenarios.ts';
import { FIXTURE_NOW_MS, activeScenario, attemptsBody, rosterBody } from './monitoring-bodies.ts';

export const TASK_SCENARIO_NAMES = ['tasks-none', 'tasks', 'tasks-many', 'tasks-failure', 'tasks-offline', 'tasks-expired', 'tasks-unsupported', 'arena-perf-tasks', 'arena-stale-tasks'] as const;
export type TaskScenarioName = (typeof TASK_SCENARIO_NAMES)[number];

const LEVEL_TABLE_VERSION = 'levels-1';
const LEGACY_POLICY = 'xp-policy-1';
const TASK_POLICY = 'xp-policy-2';
const LIST_PAGE = 25;
const HISTORY_PAGE = 50;
const XP_PAGE = 200;
const SMALL_BELOW_MS = 120_000;
const MEDIUM_BELOW_MS = 900_000;
const MINUTE_MS = 60_000;

/** Copy of LEVEL_FLOORS in backend/specter_arena/store/xp_policy.py; the backend is the authority. */
const LEVEL_FLOORS: readonly number[] = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');
const bindingIdOf = (n: number): string => `bnd_${'a'.repeat(20)}${hex(n, 4)}`;
/** The attempt id the monitoring fixtures give attempt `index` of bot `bot`. */
const monitoringAttemptId = (bot: number, index: number): string => `att_${'c'.repeat(16)}${hex(bot, 4)}${hex(index + 1, 4)}`;
const syntheticAttemptId = (bot: number, index: number): string => `att_${'d'.repeat(16)}${hex(bot, 4)}${hex(index + 1, 4)}`;

const hashHex = (text: string): string => {
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b1]) {
    let h = seed;
    for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += hex(h, 8);
  }
  return out;
};
const taskIdOf = (attemptId: string): string => `tsk_${hashHex(attemptId)}`;

const sizeClassOf = (runMs: number): TaskItemV1['sizeClass'] => (runMs < SMALL_BELOW_MS ? 'small' : runMs < MEDIUM_BELOW_MS ? 'medium' : 'large');
/** xp-policy-2: 10 base, 1 per full 2 minutes, capped at 30. */
const bountyOf = (runMs: number): number => Math.min(30, 10 + Math.floor(runMs / SMALL_BELOW_MS));

interface Plan {
  bot: number;
  attemptId: string;
  kind: TaskItemV1['kind'];
  /** How long before the fixture clock the attempt started. */
  startedAgoMs: number;
  /** How long before the fixture clock it ended; null while it runs or is no longer observed. */
  endedAgoMs: number | null;
  attemptState: TaskItemV1['attemptState'];
  /** The close-out the sweep reached for an ended attempt. */
  closeReason: 'clean-end' | 'unknown-terminal' | 'coverage-gap' | 'waiting-at-end' | null;
}

function taskOf(plan: Plan): TaskItemV1 {
  const startedAtMs = FIXTURE_NOW_MS - plan.startedAgoMs;
  const endedAtMs = plan.endedAgoMs === null ? null : FIXTURE_NOW_MS - plan.endedAgoMs;
  const runMs = (endedAtMs ?? FIXTURE_NOW_MS) - startedAtMs;
  const closed = plan.closeReason !== null;
  const credited = plan.closeReason === 'clean-end';
  const closedAtMs = closed && endedAtMs !== null ? endedAtMs + 30_000 : null;
  return {
    contractVersion: 1,
    taskId: taskIdOf(plan.attemptId),
    bindingId: bindingIdOf(plan.bot),
    attemptId: plan.attemptId,
    kind: plan.kind,
    state: credited ? 'credited' : closed ? 'not-credited' : 'open',
    attemptState: plan.attemptState,
    closeReason: plan.closeReason,
    startedAtMs,
    endedAtMs,
    closedAtMs,
    updatedAtMs: closedAtMs ?? (endedAtMs ?? FIXTURE_NOW_MS - 15_000),
    runMs,
    sizeClass: sizeClassOf(runMs),
    xpCredited: credited ? bountyOf(runMs) : null,
    policyVersion: TASK_POLICY,
  };
}

const kindOf = (kind: string): TaskItemV1['kind'] => (kind === 'bot-turn' ? 'bot-turn' : 'worker');

const CLEAN_ENDS = new Set(['row-idle', 'chat-done', 'chat_done']);

/** One task per qualifying attempt of the active monitoring scenario, the way the backend builds them: a worker at once, a bot turn from 60 s. */
function observedPlans(): Plan[] {
  const monitoring = activeScenario();
  const plans: Plan[] = [];
  for (const bot of rosterBody(monitoring).items) {
    const n = Number.parseInt(bot.bindingId.slice(-4), 16);
    for (const attempt of attemptsBody(monitoring, bot.bindingId)?.items ?? []) {
      const runMs = (attempt.endedMs ?? FIXTURE_NOW_MS) - attempt.startedMs;
      if (attempt.kind === 'bot-turn' && runMs < MINUTE_MS) continue;
      const ended = attempt.endedMs !== null;
      const gap = bot.coverage.state === 'gap' || bot.coverage.openGapCount > 0;
      plans.push({
        bot: n,
        attemptId: attempt.attemptId,
        kind: kindOf(attempt.kind),
        startedAgoMs: FIXTURE_NOW_MS - attempt.startedMs,
        endedAgoMs: attempt.endedMs === null ? null : FIXTURE_NOW_MS - attempt.endedMs,
        attemptState: attempt.condition.state === 'working' ? 'working' : ended ? 'ended' : 'unknown',
        closeReason: !ended ? null : gap ? 'coverage-gap' : attempt.endSignal !== null && CLEAN_ENDS.has(attempt.endSignal) ? 'clean-end' : 'unknown-terminal',
      });
    }
  }
  return plans;
}

/** Tasks the monitoring fixtures do not list: a small, a medium and a large one running, and closed ones with every reason. */
const EXTRA_PLANS: readonly Plan[] = [
  { bot: 1, attemptId: syntheticAttemptId(1, 0), kind: 'worker', startedAgoMs: 90_000, endedAgoMs: null, attemptState: 'working', closeReason: null },
  { bot: 1, attemptId: syntheticAttemptId(1, 1), kind: 'worker', startedAgoMs: 22 * MINUTE_MS, endedAgoMs: null, attemptState: 'working', closeReason: null },
  { bot: 2, attemptId: syntheticAttemptId(2, 0), kind: 'worker', startedAgoMs: 95 * MINUTE_MS, endedAgoMs: 83 * MINUTE_MS, attemptState: 'ended', closeReason: 'clean-end' },
  { bot: 2, attemptId: syntheticAttemptId(2, 1), kind: 'worker', startedAgoMs: 140 * MINUTE_MS, endedAgoMs: 131 * MINUTE_MS, attemptState: 'ended', closeReason: 'coverage-gap' },
  { bot: 1, attemptId: syntheticAttemptId(1, 2), kind: 'worker', startedAgoMs: 190 * MINUTE_MS, endedAgoMs: 184 * MINUTE_MS, attemptState: 'ended', closeReason: 'waiting-at-end' },
  { bot: 1, attemptId: syntheticAttemptId(1, 3), kind: 'bot-turn', startedAgoMs: 260 * MINUTE_MS, endedAgoMs: 256 * MINUTE_MS, attemptState: 'ended', closeReason: 'unknown-terminal' },
  { bot: 3, attemptId: syntheticAttemptId(3, 0), kind: 'worker', startedAgoMs: 40 * MINUTE_MS, endedAgoMs: 38 * MINUTE_MS, attemptState: 'ended', closeReason: 'clean-end' },
];

const WATCHED_ATTEMPT = syntheticAttemptId(1, 9);
/** The id of the task the demo closes on request, so a live defeat can be shown and tested without a clock or a write. */
export const WATCHED_TASK_ID = taskIdOf(WATCHED_ATTEMPT);
let watchedClosed = false;

/** A worker of Atlas that runs until `closeWatchedTask` is called, then ends cleanly a minute earlier and is credited. */
const watchedPlan = (): Plan => ({
  bot: 1,
  attemptId: WATCHED_ATTEMPT,
  kind: 'worker',
  startedAgoMs: 7 * MINUTE_MS,
  endedAgoMs: watchedClosed ? MINUTE_MS : null,
  attemptState: watchedClosed ? 'ended' : 'working',
  closeReason: watchedClosed ? 'clean-end' : null,
});

/** Test and preview seam: the watched task ends cleanly at the next read. */
export function closeWatchedTask(): void {
  watchedClosed = true;
}

if (typeof window !== 'undefined') (window as unknown as { __specterFixtureTasks: { close: () => void; watchedTaskId: string } }).__specterFixtureTasks = { close: closeWatchedTask, watchedTaskId: WATCHED_TASK_ID };

function perfPlans(): Plan[] {
  const monitoring = activeScenario();
  const plans: Plan[] = [];
  for (const spec of perfTasks()) {
    if (spec.credited) {
      plans.push({ bot: spec.bot, attemptId: syntheticAttemptId(spec.bot, spec.n), kind: 'worker', startedAgoMs: (spec.ageMinutes + spec.runMinutes) * MINUTE_MS, endedAgoMs: spec.ageMinutes * MINUTE_MS, attemptState: 'ended', closeReason: 'clean-end' });
    } else if (spec.workingAttempt !== null) {
      const [bot, index] = spec.workingAttempt;
      const real = attemptsBody(monitoring, bindingIdOf(bot))?.items[index];
      plans.push({ bot, attemptId: monitoringAttemptId(bot, index), kind: real === undefined ? 'worker' : kindOf(real.kind), startedAgoMs: real === undefined ? spec.runMinutes * MINUTE_MS : FIXTURE_NOW_MS - real.startedMs, endedAgoMs: null, attemptState: 'working', closeReason: null });
    } else {
      plans.push({ bot: spec.bot, attemptId: syntheticAttemptId(spec.bot, spec.n), kind: 'worker', startedAgoMs: spec.runMinutes * MINUTE_MS, endedAgoMs: null, attemptState: 'unknown', closeReason: null });
    }
  }
  return plans;
}

function manyPlans(): Plan[] {
  return Array.from({ length: 60 }, (_, index) => ({
    bot: 1,
    attemptId: syntheticAttemptId(1, index),
    kind: 'worker' as const,
    startedAgoMs: (200 + index * 5) * MINUTE_MS,
    endedAgoMs: (198 + index * 5) * MINUTE_MS,
    attemptState: 'ended' as const,
    closeReason: index % 4 === 0 ? ('coverage-gap' as const) : ('clean-end' as const),
  }));
}

let override: TaskScenarioName | null = null;

export function setTaskScenario(name: TaskScenarioName | null): void {
  override = name;
}

const isTaskScenario = (value: string | null): value is TaskScenarioName => TASK_SCENARIO_NAMES.some((name) => name === value);

/** The test override, else `?scenario=` on the page URL; every other name is `tasks-none`. */
export function activeTaskScenario(): TaskScenarioName {
  if (override !== null) return override;
  const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scenario');
  const named = canonicalArenaScenario(requested, { arena: 'tasks', perf: 'arena-perf-tasks', stale: 'arena-stale-tasks', empty: 'tasks-none' });
  return isTaskScenario(named) ? named : 'tasks-none';
}

export function resetTaskFixtures(): void {
  override = null;
  watchedClosed = false;
}

const byUpdated = (a: TaskItemV1, b: TaskItemV1): number => b.updatedAtMs - a.updatedAtMs || (a.taskId < b.taskId ? 1 : a.taskId > b.taskId ? -1 : 0);

/** Every task of one scenario, newest update first. */
export function tasksOf(scenario: TaskScenarioName): TaskItemV1[] {
  let plans: Plan[];
  if (scenario === 'tasks' || scenario === 'arena-stale-tasks') plans = [...observedPlans(), ...EXTRA_PLANS, watchedPlan()];
  else if (scenario === 'arena-perf-tasks') plans = perfPlans();
  else if (scenario === 'tasks-many') plans = [...observedPlans(), ...manyPlans()];
  else plans = [];
  return plans.map(taskOf).sort(byUpdated);
}

interface Legacy {
  bot: number;
  workId: string;
  workTitle: string;
  amount: number;
}

/** What `xp-policy-1` already wrote: history that still counts. */
const LEGACY: readonly Legacy[] = [{ bot: 1, workId: `wrk_${hex(1, 24)}`, workTitle: 'Reconcile the Q3 invoices', amount: 100 }];

function levelOf(total: number): { level: number; floor: number; next: number | null } {
  let index = 0;
  while (index + 1 < LEVEL_FLOORS.length && total >= (LEVEL_FLOORS[index + 1] ?? Infinity)) index += 1;
  return { level: index + 1, floor: LEVEL_FLOORS[index] ?? 0, next: LEVEL_FLOORS[index + 1] ?? null };
}

/** Sixty small awards for one bot, so the history route has a second page. */
const ARCHIVED: readonly Legacy[] = Array.from({ length: 60 }, (_, index) => ({ bot: 1, workId: `wrk_${hex(100 + index, 24)}`, workTitle: `Archived task ${String(index + 1).padStart(2, '0')}`, amount: 5 }));

function legacyOf(scenario: TaskScenarioName): readonly Legacy[] {
  if (scenario === 'tasks-many') return [...LEGACY, ...ARCHIVED];
  return scenario === 'tasks' || scenario === 'arena-perf-tasks' || scenario === 'arena-stale-tasks' ? LEGACY : [];
}

function summaryOf(scenario: TaskScenarioName, bindingId: string): XpSummaryV2 {
  const credited = tasksOf(scenario).filter((task) => task.bindingId === bindingId && task.state === 'credited');
  const legacy = legacyOf(scenario).filter((entry) => bindingIdOf(entry.bot) === bindingId);
  const total = credited.reduce((sum, task) => sum + (task.xpCredited ?? 0), 0) + legacy.reduce((sum, entry) => sum + entry.amount, 0);
  const { level, floor, next } = levelOf(total);
  return {
    contractVersion: 2,
    bindingId,
    totalXp: total,
    level,
    levelTableVersion: LEVEL_TABLE_VERSION,
    levelFloorXp: floor,
    nextLevelXp: next,
    acceptedWorkCount: legacy.length,
    creditedTaskCount: credited.length,
    policyVersion: TASK_POLICY,
  };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, error: string): Response => json({ contractVersion: 1, error }, status);

function pageOf<T>(all: readonly T[], search: string, size: number): { items: T[]; nextCursor: string | null } | null {
  const params = new URLSearchParams(search);
  const rawCursor = params.get('cursor');
  const offset = rawCursor === null ? 0 : /^t_\d{1,6}$/.test(rawCursor) ? Number(rawCursor.slice(2)) : -1;
  if (offset < 0) return null;
  const rawLimit = params.get('limit');
  const limit = rawLimit !== null && /^\d{1,6}$/.test(rawLimit) ? Math.min(Math.max(Number(rawLimit), 1), size) : size;
  return { items: all.slice(offset, offset + limit), nextCursor: offset + limit < all.length ? `t_${offset + limit}` : null };
}

function listTasks(scenario: TaskScenarioName, search: string): Response {
  const params = new URLSearchParams(search);
  const state = params.get('state');
  if (state !== null && state !== 'open' && state !== 'credited' && state !== 'not-credited') return apiError(400, 'invalid_request');
  const binding = params.get('bindingId');
  const all = tasksOf(scenario).filter((task) => (state === null || task.state === state) && (binding === null || task.bindingId === binding));
  const page = pageOf(all, search, LIST_PAGE);
  if (page === null) return apiError(400, 'invalid_cursor');
  const body: TasksV1 = { contractVersion: 1, items: page.items, nextCursor: page.nextCursor, asOfMs: FIXTURE_NOW_MS };
  return json(body);
}

function xpSummaries(scenario: TaskScenarioName, search: string): Response {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const ids = [...new Set([...tasksOf(scenario).filter((task) => task.state === 'credited').map((task) => task.bindingId), ...legacyOf(scenario).map((entry) => bindingIdOf(entry.bot))])].sort();
  if (view !== XP_SUMMARIES_VIEW) return apiError(400, 'invalid_request');
  const rawCursor = params.get('cursor');
  if (rawCursor !== null && !/^b_bnd_[0-9a-f]{24}$/.test(rawCursor)) return apiError(400, 'invalid_cursor');
  const rawLimit = params.get('limit');
  if (rawLimit !== null && !/^\d{1,6}$/.test(rawLimit)) return apiError(400, 'invalid_request');
  const limit = rawLimit === null ? XP_PAGE : Math.min(Math.max(Number(rawLimit), 1), XP_PAGE);
  const after = rawCursor === null ? null : rawCursor.slice(2);
  const rest = ids.filter((id) => after === null || id > after);
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  const body: XpSummariesV3 = { contractVersion: 3, items: page.map((id) => summaryOf(scenario, id)), nextCursor: rest.length > limit && last !== undefined ? `b_${last}` : null, asOfMs: FIXTURE_NOW_MS };
  return json(body);
}

const BINDING_ID = /^bnd_[0-9a-f]{24}$/;

/** `xp-history.v1` is frozen: it lists the manual-acceptance ledger only, and its summary is `xp-summary.v1`. */
function xpHistory(scenario: TaskScenarioName, bindingId: string, search: string): Response {
  const onRoster = BINDING_ID.test(bindingId) && rosterBody(activeScenario()).items.some((bot) => bot.bindingId === bindingId);
  const mine = legacyOf(scenario).filter((entry) => bindingIdOf(entry.bot) === bindingId);
  if (!onRoster && mine.length === 0) return apiError(404, 'unknown_binding');
  const entries: XpEntryV1[] = mine.map((entry, index) => ({
    entryId: `xpe_${hex(index + 1, 24)}`,
    workId: entry.workId,
    workTitle: entry.workTitle,
    kind: 'award',
    amount: entry.amount,
    policyVersion: LEGACY_POLICY,
    decisionId: `dec_${hex(index + 1, 24)}`,
    createdAtMs: FIXTURE_NOW_MS - 86_400_000 + index * 60_000,
  })).reverse();
  const page = pageOf(entries, search, HISTORY_PAGE);
  if (page === null) return apiError(400, 'invalid_cursor');
  const total = mine.reduce((sum, entry) => sum + entry.amount, 0);
  const { level, floor, next } = levelOf(total);
  const summary: XpSummaryV1 = { contractVersion: 1, bindingId, totalXp: total, level, levelTableVersion: LEVEL_TABLE_VERSION, levelFloorXp: floor, nextLevelXp: next, acceptedWorkCount: mine.length, policyVersion: LEGACY_POLICY };
  return json({ contractVersion: 1, bindingId, summary, items: page.items, nextCursor: page.nextCursor, asOfMs: FIXTURE_NOW_MS });
}

const SEGMENT = '([^/]+)';
const safeDecode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

interface Route {
  pattern: RegExp;
  handle: (scenario: TaskScenarioName, match: RegExpExecArray, search: string) => Response;
}

const routes: readonly Route[] = [
  { pattern: new RegExp(`^${appApiPath('/tasks')}$`), handle: (scenario, _match, search) => listTasks(scenario, search) },
  {
    pattern: new RegExp(`^${appApiPath('/tasks')}/${SEGMENT}$`),
    handle: (scenario, match) => {
      const id = safeDecode(match[1] ?? '');
      const task = scenario === 'arena-stale-tasks' ? undefined : tasksOf(scenario).find((candidate) => candidate.taskId === id);
      return task === undefined ? apiError(404, 'unknown_task') : json(task);
    },
  },
  { pattern: new RegExp(`^${appApiPath('/xp')}$`), handle: (scenario, _match, search) => xpSummaries(scenario, search) },
  { pattern: new RegExp(`^${appApiPath('/roster')}/${SEGMENT}/xp$`), handle: (scenario, match, search) => xpHistory(scenario, safeDecode(match[1] ?? ''), search) },
];

function failureFor(scenario: TaskScenarioName): Promise<Response> | null {
  if (scenario === 'tasks-offline') return Promise.reject(new TypeError('Failed to fetch'));
  if (scenario === 'tasks-failure') return Promise.resolve(apiError(503, 'store_not_ready'));
  if (scenario === 'tasks-expired') return Promise.resolve(new Response(null, { status: 403 }));
  if (scenario === 'tasks-unsupported') return Promise.resolve(apiError(404, 'not_found'));
  return null;
}

/** Null for any path that is not a task or XP route, so the caller can fall through. Every task route is a GET; any other method is refused. */
export function taskResponse(pathname: string, method: 'GET' | 'POST', _body?: unknown, search = ''): Promise<Response> | null {
  const route = routes.find((candidate) => candidate.pattern.test(pathname));
  if (route === undefined) return null;
  const scenario = activeTaskScenario();
  const failure = failureFor(scenario);
  if (failure !== null) return failure;
  const match = route.pattern.exec(pathname);
  if (method !== 'GET' || match === null) return Promise.resolve(apiError(405, 'invalid_request'));
  return Promise.resolve(route.handle(scenario, match, search));
}
