import { describe, expect, it } from 'vitest';
import { MAX_CROSSING_MS, crossings } from './recapCues';
import { buildTimeline } from './recapTimeline';
import { notCredited, recapOf, rosterOf, runOf } from './recapTestData';

const [a] = rosterOf(1) as [ReturnType<typeof rosterOf>[number]];
const recap = recapOf([runOf(1, a, 0, 30), runOf(2, a, 40, 50, notCredited), runOf(3, a, 60, null)], 90);
const timeline = buildTimeline(recap, 'today');
const defeat = timeline.tasks[0]!.defeatAtMs!;

describe('cues for the defeats the playhead walks across', () => {
  it('celebrates a defeat crossed going forward, with the recorded XP', () => {
    expect(crossings(defeat - 100, defeat + 100, timeline)).toEqual([
      { id: `${timeline.tasks[0]!.task.taskId}@${defeat}`, workId: timeline.tasks[0]!.task.taskId, title: expect.any(String), committedXp: 11, durationMs: expect.any(Number) },
    ]);
  });

  it('includes a defeat that lands exactly on the end of the step and none that lands on its start', () => {
    expect(crossings(defeat - 50, defeat, timeline)).toHaveLength(1);
    expect(crossings(defeat, defeat + 50, timeline)).toEqual([]);
  });

  it('plays nothing for a jump of 1.5 s or more: a scrub, a restart, a step or a long frame', () => {
    expect(crossings(defeat - 1_000, defeat + MAX_CROSSING_MS, timeline)).toEqual([]);
    expect(crossings(0, timeline.totalMs, timeline)).toEqual([]);
  });

  it('plays nothing going backward or standing still', () => {
    expect(crossings(defeat + 100, defeat - 100, timeline)).toEqual([]);
    expect(crossings(defeat, defeat, timeline)).toEqual([]);
  });

  it('never celebrates a not-credited end or a task still running at the end of the period', () => {
    const [, notCreditedTask, running] = timeline.tasks as [unknown, (typeof timeline.tasks)[number], (typeof timeline.tasks)[number]];
    expect(crossings(notCreditedTask.visibleToMs - 100, notCreditedTask.visibleToMs + 100, timeline)).toEqual([]);
    expect(crossings(running.visibleFromMs - 100, timeline.totalMs, timeline)).toEqual([]);
  });
});
