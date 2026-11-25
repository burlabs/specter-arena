// SPECTER-FIXTURE-ONLY: the FIXTURE `GET /api/recap` for the preview harness and unit tests; never imported by ui/src.
import type { RecapSpanV1, RecapV1, TaskItemV1 } from '../src/contracts/types.ts';
import { appApiPath } from '../src/host/paths.ts';
import { activeTaskScenario } from './task-bodies.ts';

const RECAP_PATH = appApiPath('/recap');
const EIGHT_DAYS_MS = 8 * 24 * 3_600_000;
const SMALL_BELOW_MS = 120_000;
const MEDIUM_BELOW_MS = 900_000;

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');
const bindingIdOf = (n: number): string => `bnd_${'a'.repeat(20)}${hex(n, 4)}`;
const sizeClassOf = (runMs: number): TaskItemV1['sizeClass'] => (runMs < SMALL_BELOW_MS ? 'small' : runMs < MEDIUM_BELOW_MS ? 'medium' : 'large');

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, error: string): Response => json({ contractVersion: 1, error }, status);

interface Plan {
  bot: number;
  /** Where the run starts and ends as a fraction of the period; an end of null is a task still running. */
  from: number;
  to: number | null;
  closeReason: TaskItemV1['closeReason'];
}

/** Six runs placed by fraction, so any period (a day, yesterday, a week) gets the same shape: overlap, a not-credited end, a run that is still going. */
const PLANS: readonly Plan[] = [
  { bot: 1, from: 0.1, to: 0.18, closeReason: 'clean-end' },
  { bot: 2, from: 0.15, to: 0.4, closeReason: 'clean-end' },
  { bot: 3, from: 0.55, to: 0.58, closeReason: 'waiting-at-end' },
  { bot: 1, from: 0.7, to: 0.74, closeReason: 'clean-end' },
  { bot: 3, from: 0.8, to: 0.83, closeReason: 'clean-end' },
  { bot: 2, from: 0.9, to: null, closeReason: null },
];

function taskOf(plan: Plan, index: number, fromMs: number, toMs: number): TaskItemV1 {
  const length = toMs - fromMs;
  const startedAtMs = fromMs + Math.round(plan.from * length);
  const endedAtMs = plan.to === null ? null : fromMs + Math.round(plan.to * length);
  const runMs = (endedAtMs ?? toMs) - startedAtMs;
  const credited = plan.closeReason === 'clean-end';
  const attemptId = `att_${'e'.repeat(16)}${hex(plan.bot, 4)}${hex(index + 1, 4)}`;
  return {
    contractVersion: 1,
    taskId: `tsk_${'e'.repeat(16)}${hex(plan.bot, 4)}${hex(index + 1, 4)}`,
    bindingId: bindingIdOf(plan.bot),
    attemptId,
    kind: 'worker',
    state: credited ? 'credited' : plan.closeReason === null ? 'open' : 'not-credited',
    attemptState: endedAtMs === null ? 'working' : 'ended',
    closeReason: plan.closeReason,
    startedAtMs,
    endedAtMs,
    closedAtMs: endedAtMs,
    updatedAtMs: endedAtMs ?? startedAtMs,
    runMs,
    sizeClass: sizeClassOf(runMs),
    xpCredited: credited ? Math.min(30, 10 + Math.floor(runMs / SMALL_BELOW_MS)) : null,
    policyVersion: 'xp-policy-2',
  };
}

/** Collected throughout, except a pause where no task ran and a gap in the middle of a task. */
function spansOf(fromMs: number, toMs: number): RecapSpanV1[] {
  const at = (fraction: number): number => fromMs + Math.round(fraction * (toMs - fromMs));
  const span = (from: number, to: number, notCollected: RecapSpanV1['reason'] | null): RecapSpanV1 => ({ fromMs: from, toMs: to, state: notCollected === null ? 'covered' : 'not-collected', reason: notCollected ?? 'collecting' });
  return [span(fromMs, at(0.45), null), span(at(0.45), at(0.5), 'paused'), span(at(0.5), at(0.71), null), span(at(0.71), at(0.73), 'collector-gap'), span(at(0.73), toMs, null)];
}

function recapBody(fromMs: number, toMs: number, empty: boolean): RecapV1 {
  return {
    contractVersion: 1,
    asOfMs: toMs,
    fromMs,
    toMs,
    tasks: empty ? [] : PLANS.map((plan, index) => taskOf(plan, index, fromMs, toMs)).sort((a, b) => a.startedAtMs - b.startedAtMs || (a.taskId < b.taskId ? -1 : 1)),
    taskCap: 1000,
    truncated: false,
    omittedCount: 0,
    coverage: { firstRunMs: fromMs - 3_600_000, purgeHorizonMs: null, spans: empty ? [{ fromMs, toMs, state: 'covered', reason: 'collecting' }] : spansOf(fromMs, toMs) },
  };
}

const WHOLE_NUMBER = /^[0-9]{1,16}$/;

/** Null for any path that is not the recap route. It answers the period it is asked for, so every period has the same shape, and it follows the task scenario's failures. */
export function recapResponse(pathname: string, method: 'GET' | 'POST', search = ''): Promise<Response> | null {
  if (pathname !== RECAP_PATH) return null;
  if (method !== 'GET') return Promise.resolve(apiError(405, 'invalid_request'));
  const scenario = activeTaskScenario();
  if (scenario === 'tasks-offline') return Promise.reject(new TypeError('Failed to fetch'));
  if (scenario === 'tasks-failure') return Promise.resolve(apiError(503, 'store_not_ready'));
  if (scenario === 'tasks-expired') return Promise.resolve(new Response(null, { status: 403 }));
  if (scenario === 'tasks-unsupported') return Promise.resolve(apiError(404, 'not_found'));
  const params = new URLSearchParams(search);
  const from = params.get('fromMs') ?? '';
  const to = params.get('toMs') ?? '';
  if (!WHOLE_NUMBER.test(from) || !WHOLE_NUMBER.test(to) || Number(to) <= Number(from) || Number(to) - Number(from) > EIGHT_DAYS_MS) return Promise.resolve(apiError(400, 'bad_period'));
  return Promise.resolve(json(recapBody(Number(from), Number(to), scenario === 'tasks-none')));
}
