import { describe, expect, it } from 'vitest';
import { buildSceneModel } from './sceneModel';
import { placeHeroes } from './heroPlacement';
import { createFrameSource, frameAt } from './recapFrames';
import { buildTimeline } from './recapTimeline';
import { covered, notCollected, notCredited, recapOf, rosterOf, runOf } from './recapTestData';
import { NOW, botOf, taskOf } from './testData';
import type { FrameContext } from './recapFrames';

const roster = rosterOf(3);
const [a, b] = roster as [(typeof roster)[number], (typeof roster)[number]];
const context: FrameContext = { roster, specters: [], mode: 'RECORDED' };
const modelAt = (recap: ReturnType<typeof recapOf>, playMs: number) => {
  const timeline = buildTimeline(recap, 'today');
  const frame = frameAt(recap, timeline, playMs, context);
  return { timeline, frame, model: buildSceneModel(frame.inputs) };
};

describe('a task on screen (FP30-R05)', () => {
  const recap = recapOf([runOf(1, a, 10, 40), runOf(2, b, 50, 60, notCredited)], 90);
  const timeline = buildTimeline(recap, 'today');
  const first = timeline.tasks[0]!;
  const second = timeline.tasks[1]!;

  it('opens on the first task with no idle lead-in, and the clock reads its start', () => {
    const frame = frameAt(recap, timeline, 0, context);
    expect(buildSceneModel(frame.inputs).enemies.map((enemy) => enemy.workId)).toEqual([first.task.taskId]);
    expect(frame.sourceMs).toBe(first.task.startedAtMs);
  });

  it('shows nothing of a task that has not started yet', () => {
    const later = recapOf([runOf(1, a, 10, 40), runOf(2, b, 50, 60)], 90);
    const t = buildTimeline(later, 'today');
    const ids = buildSceneModel(frameAt(later, t, t.tasks[0]!.playFromMs + 1, context).inputs).enemies.map((enemy) => enemy.workId);
    expect(ids).toEqual([t.tasks[0]!.task.taskId]);
  });

  it('shows an open minion while the playhead is inside its run, and its bot as working', () => {
    const model = buildSceneModel(frameAt(recap, timeline, (first.playFromMs + first.playToMs) / 2, context).inputs);
    expect(model.enemies).toMatchObject([{ workId: first.task.taskId, state: 'open', defeated: false, committedXp: null, engagedBy: [a.bindingId] }]);
    expect(model.specters.map((s) => [s.bindingId, s.condition])).toEqual([
      [a.bindingId, 'working'],
      [b.bindingId, 'settled'],
      [roster[2]!.bindingId, 'settled'],
    ]);
  });

  it('defeats a credited task at its end with the recorded XP, and keeps the defeated one in the scene', () => {
    const model = buildSceneModel(frameAt(recap, timeline, first.visibleToMs, context).inputs);
    expect(model.enemies.find((enemy) => enemy.workId === first.task.taskId)).toMatchObject({ defeated: true, committedXp: 11, state: 'credited' });
    expect(model.specters[0]?.condition).toBe('settled');
  });

  it('lets a not-credited task leave with no defeat and no XP', () => {
    const during = buildSceneModel(frameAt(recap, timeline, (second.playFromMs + second.playToMs) / 2, context).inputs);
    expect(during.enemies.map((e) => [e.workId, e.state])).toEqual([[first.task.taskId, 'credited'], [second.task.taskId, 'open']].sort());
    const after = buildSceneModel(frameAt(recap, timeline, timeline.totalMs, context).inputs);
    expect(after.enemies.map((e) => e.workId)).toEqual([first.task.taskId]);
    expect(after.enemies.some((e) => e.committedXp === null && e.defeated)).toBe(false);
  });

  it('computes no XP and shows no level: the XP read is empty and not loaded', () => {
    const { inputs } = frameAt(recap, timeline, timeline.totalMs, context);
    expect(inputs.xp).toEqual([]);
    expect(inputs.xpStatus).toBe('loading');
    expect(inputs.mode).toBe('RECORDED');
  });

  it('counts a task of a bot that is not in the roster and does not draw it', () => {
    const stranger = botOf(99);
    const foreign = recapOf([runOf(1, stranger, 10, 40), runOf(2, a, 10, 40)], 60);
    const { frame, model } = modelAt(foreign, 5_000);
    expect(frame.unrostered).toBe(1);
    expect(model.enemies).toHaveLength(1);
  });

  it('keeps a task that is still running open at the very end of the recap', () => {
    const open = recapOf([runOf(1, a, 10, null)], 60);
    const timeline2 = buildTimeline(open, 'today');
    const model = buildSceneModel(frameAt(open, timeline2, timeline2.totalMs, context).inputs);
    expect(model.enemies).toMatchObject([{ state: 'open', defeated: false }]);
  });
});

describe('size grows with the recorded run', () => {
  it('steps small, medium and large as the real run crosses 2 and 15 minutes', () => {
    const recap = recapOf([runOf(1, a, 0, 20)], 30);
    const timeline = buildTimeline(recap, 'today');
    const item = timeline.tasks[0]!;
    const sizeAt = (fraction: number) => buildSceneModel(frameAt(recap, timeline, item.playFromMs + (item.playToMs - item.playFromMs) * fraction, context).inputs).enemies[0]?.sizeClass;
    expect([sizeAt(0.01), sizeAt(0.2), sizeAt(0.9)]).toEqual(['small', 'medium', 'large']);
  });

  it('starts a task that began before the period at the size its real run already has', () => {
    const recap = recapOf([runOf(1, a, -30, 20)], 30);
    expect(modelAt(recap, 1).model.enemies[0]?.sizeClass).toBe('large');
  });
});

describe('not collected', () => {
  const recap = recapOf([runOf(1, a, 0, 10), runOf(2, b, 40, 50)], 60, [covered(0, 20), notCollected(20, 30), covered(30, 60)]);
  const timeline = buildTimeline(recap, 'today');
  const beat = timeline.segments.find((segment) => segment.kind === 'beat')!;

  it('shows every bot as unknown, never settled, during a beat, and names the span', () => {
    const frame = frameAt(recap, timeline, beat.playFromMs + 100, context);
    const model = buildSceneModel(frame.inputs);
    expect(frame.notCollected).toMatchObject({ reason: 'paused' });
    expect(model.specters.map((s) => s.condition)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(model.coverage.unknownBots).toBe(3);
  });

  it('shows no span outside it', () => {
    expect(frameAt(recap, timeline, 100, context).notCollected).toBeNull();
    expect(frameAt(recap, timeline, timeline.totalMs, context).notCollected).toBeNull();
  });

  it('keeps the working bot working and the rest unknown inside a running task', () => {
    const inside = recapOf([runOf(1, a, 0, 30)], 30, [covered(0, 10), notCollected(10, 20, 'collector-gap'), covered(20, 30)]);
    const t = buildTimeline(inside, 'today');
    const hatched = t.segments.find((segment) => segment.kind === 'play' && segment.notCollected !== null)!;
    const frame = frameAt(inside, t, (hatched.playFromMs + hatched.playToMs) / 2, context);
    const model = buildSceneModel(frame.inputs);
    expect(frame.notCollected?.reason).toBe('collector-gap');
    expect(model.specters.map((s) => s.condition)).toEqual(['working', 'unknown', 'unknown']);
  });

  it('reads a whole-period not-collected recap at its end', () => {
    const none = recapOf([], 60, [notCollected(0, 60, 'no-collector')]);
    const t = buildTimeline(none, 'today');
    expect(frameAt(none, t, 0, context).notCollected).toMatchObject({ reason: 'no-collector' });
  });
});

describe('a stable scene between events (NFR-2)', () => {
  const recap = recapOf([runOf(1, a, 0, 60), runOf(2, b, 30, 90)], 120);
  const timeline = buildTimeline(recap, 'today');

  it('keeps one signature and one inputs object across 1,000 play times inside one event interval', () => {
    const open = timeline.events.findIndex((time, index) => (timeline.events[index + 1] ?? 0) - time > 2_000);
    const start = timeline.events[open]!;
    const end = timeline.events[open + 1]!;
    const next = createFrameSource(recap, timeline, context);
    const first = next(start);
    for (let index = 0; index < 1000; index += 1) {
      const frame = next(start + ((end - start) * index) / 1000);
      expect(frame.signature).toBe(first.signature);
      expect(frame.inputs).toBe(first.inputs);
    }
    expect(next(end).signature).not.toBe(first.signature);
  });

  it('moves the source time with the playhead even when the scene holds still', () => {
    const next = createFrameSource(recap, timeline, context);
    const start = timeline.events[1]!;
    expect(next(start + 1_000).sourceMs).toBeGreaterThan(next(start).sourceMs);
  });

  it('gives the same inputs back for a play time visited again after a scrub', () => {
    const one = frameAt(recap, timeline, 4_000, context);
    const again = frameAt(recap, timeline, 4_000, context);
    expect(again.inputs).toEqual(one.inputs);
  });

  it('clamps a play time outside the recap', () => {
    expect(frameAt(recap, timeline, -10, context).sourceMs).toBe(timeline.tasks[0]!.srcFromMs);
    expect(frameAt(recap, timeline, timeline.totalMs + 99, context).sourceMs).toBe(timeline.toMs);
  });
});

describe('limits (FP30-R09)', () => {
  it('draws 80 enemies at most and says how many are not drawn: 81 at once gives overflow 1', () => {
    const bots = rosterOf(2);
    const tasks = Array.from({ length: 81 }, (_, index) => runOf(index + 1, bots[index % 2]!, 10, 50));
    const recap = recapOf(tasks, 60);
    const timeline = buildTimeline(recap, 'today');
    const middle = (timeline.tasks[0]!.playFromMs + timeline.tasks[0]!.playToMs) / 2;
    const model = buildSceneModel(frameAt(recap, timeline, middle, { roster: bots, specters: [], mode: 'RECORDED' }).inputs);
    expect(model.enemies).toHaveLength(80);
    expect(model.overflow.enemies).toBe(1);
  });

  it('passes the payload truncation on to the scene', () => {
    const recap = { ...recapOf([runOf(1, a, 10, 40)], 60), truncated: true, omittedCount: 4 };
    expect(buildSceneModel(frameAt(recap, buildTimeline(recap, 'today'), 0, context).inputs).overflow.truncated).toBe(true);
  });
});

describe('heroes stand where the live arena puts them', () => {
  it('places heroes from the bot ids alone, so a recap and the live arena agree', () => {
    const recap = recapOf([runOf(1, a, 10, 40)], 60);
    const recapModel = buildSceneModel(frameAt(recap, buildTimeline(recap, 'today'), 1_000, context).inputs);
    const live = buildSceneModel({ mode: 'LIVE', nowMs: NOW, roster, specters: [], xp: [], tasks: [taskOf(1, a)] });
    const ids = (model: typeof live) => model.specters.map((s) => s.bindingId);
    expect(ids(recapModel)).toEqual(ids(live));
    expect([...placeHeroes(new Map(), ids(recapModel))]).toEqual([...placeHeroes(new Map(), ids(live))]);
  });
});

describe('a three-task recap played end to end', () => {
  it('prints the scene at five play times', () => {
    const recap = recapOf([runOf(1, a, 5, 25), runOf(2, b, 20, 45), runOf(3, a, 90, 100, notCredited)], 120);
    const timeline = buildTimeline(recap, 'today');
    const rows = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
      const playMs = timeline.totalMs * fraction;
      const model = buildSceneModel(frameAt(recap, timeline, playMs, context).inputs);
      return `${Math.round(playMs)} ms: ${model.enemies.map((enemy) => `${enemy.workId.slice(-1)}=${enemy.defeated ? 'defeated' : `${enemy.state}/${enemy.sizeClass}`}`).join(' ') || 'none'}`;
    });
    console.info(`RECAP-DEMO total=${Math.round(timeline.totalMs)} ms\n${rows.join('\n')}`);
    expect(rows).toHaveLength(5);
  });
});
