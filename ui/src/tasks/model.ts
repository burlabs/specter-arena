import { TASK_ITEM_KEYS } from '../contracts/types';
import type { TaskAttemptStateV1, TaskCloseReasonV1, TaskItemV1, TaskKindV1, TaskSizeClassV1, TaskStateV1, TasksV1 } from '../contracts/types';
import { ShapeError } from '../work/model';

/** Size thresholds on `runMs` (pa3-shared-contract §1). The backend computes `sizeClass`; the parser checks it agrees. */
export const SMALL_BELOW_MS = 120_000;
export const MEDIUM_BELOW_MS = 900_000;

export const sizeClassOf = (runMs: number): TaskSizeClassV1 => (runMs < SMALL_BELOW_MS ? 'small' : runMs < MEDIUM_BELOW_MS ? 'medium' : 'large');

const KINDS: readonly string[] = ['bot-turn', 'worker'];
const STATES: readonly string[] = ['open', 'credited', 'not-credited'];
const ATTEMPT_STATES: readonly string[] = ['working', 'ended', 'unknown'];
const REASONS: readonly string[] = ['clean-end', 'unknown-terminal', 'coverage-gap', 'waiting-at-end'];
const SIZES: readonly string[] = ['small', 'medium', 'large'];
const TASK_ID = /^tsk_[0-9a-f]{24}$/;
const ATTEMPT_ID = /^att_[0-9a-f]{24}$/;
const BINDING_ID = /^bnd_[0-9a-f]{24}$/;
const POLICY = /^[a-z][a-z0-9-]{0,31}$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMs = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isTextIn = (value: unknown, allowed: readonly string[]): boolean => typeof value === 'string' && allowed.includes(value);
const isMatch = (value: unknown, pattern: RegExp): boolean => typeof value === 'string' && pattern.test(value);
const isMsOrNull = (value: unknown): boolean => value === null || isMs(value);

/**
 * `task-item.v1`, checked member by member and against the rules of the contract: `credited` if and only if the reason
 * is `clean-end` and an award exists, a reason only once closed, and a size class that matches `runMs`.
 */
export function isTaskItem(value: unknown): value is TaskItemV1 {
  if (!isObject(value)) return false;
  const v = value;
  // The object is closed: a member this version does not name means the body is not a v1 task.
  if (Object.keys(v).some((key) => !(key in TASK_ITEM_KEYS))) return false;
  if (
    v.contractVersion !== 1 ||
    !isMatch(v.taskId, TASK_ID) ||
    !isMatch(v.bindingId, BINDING_ID) ||
    !isMatch(v.attemptId, ATTEMPT_ID) ||
    !isTextIn(v.kind, KINDS) ||
    !isTextIn(v.state, STATES) ||
    !isTextIn(v.attemptState, ATTEMPT_STATES) ||
    !(v.closeReason === null || isTextIn(v.closeReason, REASONS)) ||
    !isMs(v.startedAtMs) ||
    !isMsOrNull(v.endedAtMs) ||
    !isMsOrNull(v.closedAtMs) ||
    !isMs(v.updatedAtMs) ||
    !isMs(v.runMs) ||
    !isTextIn(v.sizeClass, SIZES) ||
    !(v.xpCredited === null || (typeof v.xpCredited === 'number' && Number.isInteger(v.xpCredited) && v.xpCredited >= 1 && v.xpCredited <= 30)) ||
    !isMatch(v.policyVersion, POLICY)
  ) {
    return false;
  }
  const credited = v.state === 'credited';
  if (credited !== (v.closeReason === 'clean-end') || credited !== (v.xpCredited !== null)) return false;
  if ((v.state === 'open') !== (v.closeReason === null)) return false;
  return v.sizeClass === sizeClassOf(v.runMs as number);
}

/** `task-item.v1` from `GET /api/tasks/{taskId}`. Fails closed. */
export function parseTaskItem(body: unknown): TaskItemV1 {
  if (!isTaskItem(body)) throw new ShapeError('unexpected task body');
  return body;
}

/** `tasks.v1`. Fails closed on another contract version, more than 25 items, or any malformed item. */
export function parseTasksPage(body: unknown): TasksV1 {
  const page = isObject(body) ? body : null;
  if (
    page === null ||
    page.contractVersion !== 1 ||
    !Array.isArray(page.items) ||
    page.items.length > 25 ||
    !page.items.every(isTaskItem) ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string') ||
    !isMs(page.asOfMs)
  ) {
    throw new ShapeError('unexpected tasks body');
  }
  return { contractVersion: 1, items: page.items, nextCursor: page.nextCursor, asOfMs: page.asOfMs };
}

export type { TaskAttemptStateV1, TaskCloseReasonV1, TaskKindV1, TaskSizeClassV1, TaskStateV1 };

/** Newest update wins; on a tie the first argument wins. */
export function newestTask(...items: ReadonlyArray<TaskItemV1 | null | undefined>): TaskItemV1 | null {
  let best: TaskItemV1 | null = null;
  for (const item of items) if (item != null && (best === null || item.updatedAtMs > best.updatedAtMs)) best = item;
  return best;
}

/** Whether a task is on the field: open, running or no longer observed. */
export const isOnField = (task: TaskItemV1): boolean => task.state === 'open';
