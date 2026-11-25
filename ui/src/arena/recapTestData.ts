import type { RecapSpanV1, RecapV1, RosterItemV1, TaskItemV1 } from '../contracts/types';
import { sizeClassOf } from '../tasks/model';
import { attemptIdOf, botOf, taskIdOf } from './testData';

export const MIN = 60_000;
export const HOUR = 3_600_000;
/** 2026-11-25 00:00 in America/Denver. */
export const T0 = Date.UTC(2026, 10, 25, 7);

export const rosterOf = (count: number): RosterItemV1[] => Array.from({ length: count }, (_, index) => botOf(index + 1));

/** A recorded task from `startMin` to `endMin` minutes after `T0` (null: still running). Credited with 11 XP unless `extra` says otherwise. */
export function runOf(n: number, bot: RosterItemV1, startMin: number, endMin: number | null, extra: Partial<TaskItemV1> = {}): TaskItemV1 {
  const started = T0 + Math.round(startMin * MIN);
  const ended = endMin === null ? null : T0 + Math.round(endMin * MIN);
  const runMs = (ended ?? T0 + 24 * HOUR) - started;
  const open = ended === null;
  return {
    contractVersion: 1,
    taskId: taskIdOf(n),
    bindingId: bot.bindingId,
    attemptId: attemptIdOf(n),
    kind: 'worker',
    state: open ? 'open' : 'credited',
    attemptState: open ? 'working' : 'ended',
    closeReason: open ? null : 'clean-end',
    startedAtMs: started,
    endedAtMs: ended,
    closedAtMs: ended,
    updatedAtMs: ended ?? started,
    runMs,
    sizeClass: sizeClassOf(runMs),
    xpCredited: open ? null : 11,
    policyVersion: 'xp-policy-2',
    ...extra,
  };
}

export const notCredited = { state: 'not-credited', closeReason: 'waiting-at-end', xpCredited: null } as const;

export const covered = (fromMin: number, toMin: number): RecapSpanV1 => ({ fromMs: T0 + fromMin * MIN, toMs: T0 + toMin * MIN, state: 'covered', reason: 'collecting' });
export const notCollected = (fromMin: number, toMin: number, reason: RecapSpanV1['reason'] = 'paused'): RecapSpanV1 => ({ fromMs: T0 + fromMin * MIN, toMs: T0 + toMin * MIN, state: 'not-collected', reason });

/** A recap of `[T0 + fromMin, T0 + toMin]`; with no spans given the whole period was collected. */
export function recapOf(tasks: TaskItemV1[], toMin: number, spans?: RecapSpanV1[], fromMin = 0): RecapV1 {
  return {
    contractVersion: 1,
    asOfMs: T0 + toMin * MIN,
    fromMs: T0 + fromMin * MIN,
    toMs: T0 + toMin * MIN,
    tasks,
    taskCap: 1000,
    truncated: false,
    omittedCount: 0,
    coverage: { firstRunMs: T0 - HOUR, purgeHorizonMs: null, spans: spans ?? [covered(fromMin, toMin)] },
  };
}
