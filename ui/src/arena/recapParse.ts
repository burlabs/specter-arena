import { RECAP_COVERAGE_KEYS, RECAP_KEYS, RECAP_SPAN_KEYS } from '../contracts/types';
import type { RecapSpanV1, RecapV1, TaskItemV1 } from '../contracts/types';
import { isTaskItem } from '../tasks/model';
import { ShapeError } from '../work/model';

export const RECAP_TASK_CAP = 1000;
const NOT_COLLECTED_REASONS: readonly string[] = ['paused', 'collector-gap', 'no-collector', 'before-first-run', 'purged'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMs = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hasExactKeys = (value: Record<string, unknown>, keys: Record<string, true>): boolean => {
  const names = Object.keys(keys);
  return Object.keys(value).length === names.length && names.every((name) => name in value);
};

const bad = (what: string): never => {
  throw new ShapeError(`unexpected recap body: ${what}`);
};

function parseSpans(value: unknown, fromMs: number, toMs: number): RecapSpanV1[] {
  if (!Array.isArray(value) || value.length === 0) return bad('spans');
  let reached = fromMs;
  for (const span of value) {
    if (!isObject(span) || !hasExactKeys(span, RECAP_SPAN_KEYS) || !isMs(span.fromMs) || !isMs(span.toMs)) return bad('span');
    if (span.fromMs !== reached || span.toMs <= span.fromMs) return bad('spans must follow one another without a gap or overlap');
    const collecting = span.state === 'covered' && span.reason === 'collecting';
    const notCollected = span.state === 'not-collected' && typeof span.reason === 'string' && NOT_COLLECTED_REASONS.includes(span.reason);
    if (!collecting && !notCollected) return bad('span state and reason');
    reached = span.toMs;
  }
  if (reached !== toMs) return bad('spans must end where the period ends');
  return value as RecapSpanV1[];
}

function parseTasks(value: unknown, fromMs: number, toMs: number): TaskItemV1[] {
  if (!Array.isArray(value) || value.length > RECAP_TASK_CAP || !value.every(isTaskItem)) return bad('tasks');
  let previous: TaskItemV1 | null = null;
  for (const task of value) {
    const outOfOrder = previous !== null && (task.startedAtMs < previous.startedAtMs || (task.startedAtMs === previous.startedAtMs && task.taskId <= previous.taskId));
    const contradicts = task.startedAtMs >= toMs || (task.endedAtMs !== null && (task.endedAtMs < task.startedAtMs || (task.endedAtMs <= fromMs && task.startedAtMs < fromMs)));
    if (outOfOrder || contradicts) return bad('task order or times');
    previous = task;
  }
  return value;
}

/** `recap.v1`. Fails closed on anything the contract does not allow, and on tasks or spans that contradict the period. */
export function parseRecap(body: unknown): RecapV1 {
  if (!isObject(body) || !hasExactKeys(body, RECAP_KEYS) || body.contractVersion !== 1) return bad('shape');
  const { asOfMs, fromMs, toMs, coverage } = body;
  if (!isMs(asOfMs) || !isMs(fromMs) || !isMs(toMs) || toMs <= fromMs || toMs > asOfMs) return bad('times');
  if (body.taskCap !== RECAP_TASK_CAP || typeof body.truncated !== 'boolean' || !isMs(body.omittedCount) || body.truncated !== body.omittedCount > 0) return bad('limits');
  if (!isObject(coverage) || !hasExactKeys(coverage, RECAP_COVERAGE_KEYS)) return bad('coverage');
  const { firstRunMs, purgeHorizonMs } = coverage;
  if (!(firstRunMs === null || isMs(firstRunMs)) || !(purgeHorizonMs === null || isMs(purgeHorizonMs))) return bad('coverage times');
  return {
    contractVersion: 1,
    asOfMs,
    fromMs,
    toMs,
    tasks: parseTasks(body.tasks, fromMs, toMs),
    taskCap: RECAP_TASK_CAP,
    truncated: body.truncated,
    omittedCount: body.omittedCount,
    coverage: { firstRunMs, purgeHorizonMs, spans: parseSpans(coverage.spans, fromMs, toMs) },
  };
}
