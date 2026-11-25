import { taskTitle } from '../tasks/copy';
import type { PresentationCue } from './PresentationCueLayer';
import type { Timeline } from './recapTimeline';
import { CUE_DURATION_MS } from './useArenaScene';

/** A defeat is celebrated only when the playhead walks across it: a step of more than this is a jump, and plays nothing. */
export const MAX_CROSSING_MS = 1_500;

/**
 * The defeats the playhead crossed going forward from `prevPlayMs` to `nextPlayMs`. Scrubbing, restarting, stepping and a
 * long frame all re-baseline: they cross nothing. The XP on a cue is the recorded credit and nothing is computed here.
 */
export function crossings(prevPlayMs: number, nextPlayMs: number, timeline: Timeline): PresentationCue[] {
  const step = nextPlayMs - prevPlayMs;
  if (!(step > 0) || step >= MAX_CROSSING_MS) return [];
  return timeline.tasks
    .filter((item) => item.defeatAtMs !== null && item.defeatAtMs > prevPlayMs && item.defeatAtMs <= nextPlayMs)
    .map((item) => ({ id: `${item.task.taskId}@${item.defeatAtMs}`, workId: item.task.taskId, title: taskTitle(item.task), committedXp: item.task.xpCredited, durationMs: CUE_DURATION_MS }));
}
