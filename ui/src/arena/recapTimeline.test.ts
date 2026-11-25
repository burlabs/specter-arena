import { describe, expect, it } from 'vitest';
import { TIMELINE, buildTimeline, markerAt, playToSource, sourceToPlay } from './recapTimeline';
import { HOUR, MIN, T0, covered, notCollected, notCredited, recapOf, rosterOf, runOf } from './recapTestData';

const [bot] = rosterOf(1) as [ReturnType<typeof rosterOf>[number]];
const DAY_MIN = 24 * 60;

describe('length (FP30-R06)', () => {
  const lengthOf = (activeMin: number, kind: 'today' | 'week' = 'today') => buildTimeline(recapOf([runOf(1, bot, 60, 60 + activeMin)], DAY_MIN), kind).totalMs;

  it('is active time over 60, in play milliseconds', () => {
    expect(lengthOf(60)).toBe(60_000);
    expect(lengthOf(90)).toBe(90_000);
  });

  it('is clamped up to 30 s for 10 minutes of work', () => {
    expect(lengthOf(10)).toBe(TIMELINE.MIN_PLAY_MS);
  });

  it('is clamped down to 3 minutes for 3 hours and for 40 hours, and to 4 minutes for This week', () => {
    expect(lengthOf(180)).toBe(180_000);
    const forty = recapOf([runOf(1, bot, 0, 40 * 60)], 48 * 60);
    expect(buildTimeline(forty, 'yesterday').totalMs).toBe(TIMELINE.MAX_PLAY_MS);
    expect(buildTimeline(forty, 'week').totalMs).toBe(TIMELINE.MAX_PLAY_WEEK_MS);
  });

  it('counts overlapping tasks once', () => {
    const recap = recapOf([runOf(1, bot, 0, 60), runOf(2, bot, 30, 90)], DAY_MIN);
    expect(buildTimeline(recap, 'today').activeMs).toBe(90 * MIN);
  });
});

describe('trimming every stretch with no task running', () => {
  const recap = recapOf(
    [
      runOf(1, bot, 5, 15), // 5 minutes of lead-in
      runOf(2, bot, 15 + 1 / 3, 25), // a 20 s stretch
      runOf(3, bot, 6 * 60 + 25, 6 * 60 + 35), // a 6 h stretch
    ],
    7 * 60,
  );
  const timeline = buildTimeline(recap, 'today');

  it('plays no source time for any stretch with no task, the 20 s one and the 6 h one included', () => {
    const skips = timeline.segments.filter((segment) => segment.kind === 'skip');
    expect(skips.map((segment) => segment.srcToMs - segment.srcFromMs)).toEqual([5 * MIN, 20_000, 6 * HOUR, 25 * MIN]);
    expect(skips.every((segment) => segment.playToMs === segment.playFromMs)).toBe(true);
  });

  it('marks each stretch of a minute or more and merges shorter ones into the next marker', () => {
    expect(timeline.markers).toEqual([
      { playAtMs: 0, skippedMs: 5 * MIN, stretches: 1 },
      { playAtMs: expect.any(Number), skippedMs: 6 * HOUR + 20_000, stretches: 2 },
      { playAtMs: expect.any(Number), skippedMs: 25 * MIN, stretches: 1 },
    ]);
    expect(timeline.markers[1]?.playAtMs).toBeGreaterThan(0);
  });

  it('keeps a lone stretch under a minute as its own marker so nothing is cut silently', () => {
    const short = buildTimeline(recapOf([runOf(1, bot, 0, 10), runOf(2, bot, 10 + 1 / 3, 20)], 20), 'today');
    expect(short.markers).toEqual([{ playAtMs: expect.any(Number), skippedMs: 20_000, stretches: 1 }]);
  });

  it('announces a marker for one second when the playhead is on it', () => {
    const marker = timeline.markers[1];
    expect(marker && markerAt(timeline, marker.playAtMs)).toBe(marker);
    expect(marker && markerAt(timeline, marker.playAtMs + 999)).toBe(marker);
    expect(marker && markerAt(timeline, marker.playAtMs + 1_000)).toBeNull();
  });

  it('jumps over the cut time: the playhead goes from the end of one task to the start of the next', () => {
    const first = timeline.tasks[0]!;
    const second = timeline.tasks[1]!;
    expect(playToSource(timeline, first.playToMs - 1)).toBeLessThan(first.srcToMs);
    expect(playToSource(timeline, second.playFromMs)).toBe(second.srcFromMs);
    expect(sourceToPlay(timeline, first.srcToMs + 1_000)).toBe(first.playToMs);
  });
});

describe('not collected (FP30-R04, R06)', () => {
  const tasks = [runOf(1, bot, 0, 10), runOf(2, bot, 40, 50)];
  const withPause = recapOf(tasks, 60, [covered(0, 20), notCollected(20, 30, 'paused'), covered(30, 60)]);

  it('plays a not-collected stretch with no task as a 1.2 s beat, never trimming it', () => {
    const timeline = buildTimeline(withPause, 'today');
    const beats = timeline.segments.filter((segment) => segment.kind === 'beat');
    expect(beats).toHaveLength(1);
    expect(beats[0]?.playToMs).toBe((beats[0]?.playFromMs ?? 0) + TIMELINE.NOT_COLLECTED_BEAT_MS);
    expect(beats[0]?.notCollected?.reason).toBe('paused');
    expect(timeline.totalMs).toBe(TIMELINE.MIN_PLAY_MS + TIMELINE.NOT_COLLECTED_BEAT_MS);
    expect(timeline.notCollectedMs).toBe(10 * MIN);
    expect(timeline.collectedMs).toBe(50 * MIN);
  });

  it('merges adjacent not-collected stretches into one beat and keeps the longest reason', () => {
    const timeline = buildTimeline(recapOf(tasks, 60, [covered(0, 20), notCollected(20, 22, 'collector-gap'), notCollected(22, 30, 'no-collector'), covered(30, 60)]), 'today');
    const beats = timeline.segments.filter((segment) => segment.kind === 'beat');
    expect(beats).toHaveLength(1);
    expect(beats[0]?.notCollected?.reason).toBe('no-collector');
  });

  it('caps all beats together at 6 s of play time', () => {
    const ten = Array.from({ length: 11 }, (_, index) => runOf(index + 1, bot, index * 20, index * 20 + 10));
    const spans = Array.from({ length: 10 }, (_, index) => notCollected(index * 20 + 10, index * 20 + 20));
    const timeline = buildTimeline(recapOf(ten, 220, [covered(0, 10), ...spans.flatMap((span, index) => [span, covered(index * 20 + 20, index * 20 + 30)])].slice(0, 21)), 'today');
    const beats = timeline.segments.filter((segment) => segment.kind === 'beat');
    expect(beats).toHaveLength(10);
    const total = beats.reduce((sum, beat) => sum + (beat.playToMs - beat.playFromMs), 0);
    expect(total).toBeCloseTo(TIMELINE.BEATS_MAX_MS, 6);
    expect(beats.every((beat) => beat.playToMs - beat.playFromMs <= TIMELINE.NOT_COLLECTED_BEAT_MS)).toBe(true);
  });

  it('plays a not-collected stretch inside a running task at the normal rate, hatched', () => {
    const timeline = buildTimeline(recapOf([runOf(1, bot, 0, 30)], 30, [covered(0, 10), notCollected(10, 20, 'paused'), covered(20, 30)]), 'today');
    const plays = timeline.segments.filter((segment) => segment.kind === 'play');
    expect(plays.map((segment) => segment.notCollected?.reason ?? null)).toEqual([null, 'paused', null]);
    const [before, hatched] = plays as [(typeof plays)[number], (typeof plays)[number]];
    expect(hatched.playToMs - hatched.playFromMs).toBeCloseTo(before.playToMs - before.playFromMs, 6);
    expect(timeline.segments.some((segment) => segment.kind === 'beat')).toBe(false);
  });
});

describe('minimum visible time and the length of a recap that has nothing to play', () => {
  it('keeps a minion on screen for at least 0.9 s of play time, however short its run', () => {
    const recap = recapOf([runOf(1, bot, 0, 3 * 60), runOf(2, bot, 5 * 60, 5 * 60 + 0.01)], 6 * 60);
    const tiny = buildTimeline(recap, 'today').tasks[1]!;
    expect(tiny.playToMs - tiny.playFromMs).toBeLessThan(TIMELINE.MIN_VISIBLE_MS);
    expect(tiny.visibleToMs - tiny.visibleFromMs).toBe(TIMELINE.MIN_VISIBLE_MS);
  });

  it('extends the end of the recap so the last minion also stays 0.9 s', () => {
    const recap = recapOf([runOf(1, bot, 0, 180), runOf(2, bot, 200, 200.01)], 200.01);
    const timeline = buildTimeline(recap, 'today');
    expect(timeline.totalMs).toBe(timeline.tasks[1]!.playFromMs + TIMELINE.MIN_VISIBLE_MS);
  });

  it('has nothing to play with no task in a collected period', () => {
    const timeline = buildTimeline(recapOf([], 60), 'today');
    expect(timeline).toMatchObject({ empty: 'no-tasks', totalMs: 0, activeMs: 0 });
    expect(timeline.markers).toEqual([]);
  });

  it('says not collected when the whole period was', () => {
    const timeline = buildTimeline(recapOf([], 60, [notCollected(0, 60, 'no-collector')]), 'today');
    expect(timeline).toMatchObject({ empty: 'not-collected', totalMs: 0, notCollectedMs: 60 * MIN });
  });

  it('plays tasks that have no length without dividing by zero', () => {
    const timeline = buildTimeline(recapOf([runOf(1, bot, 10, 10)], 60), 'today');
    expect(timeline.empty).toBeNull();
    expect(timeline.rate).toBe(1);
    expect(timeline.tasks[0]!.visibleToMs - timeline.tasks[0]!.visibleFromMs).toBe(TIMELINE.MIN_VISIBLE_MS);
  });
});

describe('tasks on the timeline', () => {
  it('lets a task still running at the end of the period stay to the end and never be defeated', () => {
    const timeline = buildTimeline(recapOf([runOf(1, bot, 0, 30), runOf(2, bot, 40, null)], 60), 'today');
    const running = timeline.tasks[1]!;
    expect(running).toMatchObject({ endsInPeriod: false, defeatAtMs: null, visibleToMs: timeline.totalMs });
  });

  it('treats a task that ended after the period as still running at its end', () => {
    const late = runOf(1, bot, 10, 90);
    const timeline = buildTimeline(recapOf([late], 60), 'yesterday');
    expect(timeline.tasks[0]).toMatchObject({ endsInPeriod: false, defeatAtMs: null });
  });

  it('defeats a credited task at its end and a not-credited one never', () => {
    const timeline = buildTimeline(recapOf([runOf(1, bot, 0, 30), runOf(2, bot, 40, 50, notCredited)], 60), 'today');
    expect(timeline.tasks[0]!.defeatAtMs).toBe(timeline.tasks[0]!.visibleToMs);
    expect(timeline.tasks[1]!.defeatAtMs).toBeNull();
  });

  it('starts a task that began before the period at the first moment of play', () => {
    const timeline = buildTimeline(recapOf([runOf(1, bot, -30, 30)], 60), 'today');
    expect(timeline.tasks[0]).toMatchObject({ playFromMs: 0, srcFromMs: T0 });
  });

  it('lists events in order from 0 to the end, with the size steps of a long task', () => {
    const timeline = buildTimeline(recapOf([runOf(1, bot, 0, 20)], 30), 'today');
    expect(timeline.events[0]).toBe(0);
    expect(timeline.events.at(-1)).toBe(timeline.totalMs);
    expect([...timeline.events].sort((a, b) => a - b)).toEqual(timeline.events);
    expect(new Set(timeline.events).size).toBe(timeline.events.length);
    const task = timeline.tasks[0]!;
    const smallToMedium = sourceToPlay(timeline, task.task.startedAtMs + 120_000);
    const mediumToLarge = sourceToPlay(timeline, task.task.startedAtMs + 900_000);
    expect(timeline.events).toEqual(expect.arrayContaining([smallToMedium, mediumToLarge]));
  });

  it('maps play time to source time and back for time that plays', () => {
    const timeline = buildTimeline(recapOf([runOf(1, bot, 10, 70), runOf(2, bot, 200, 260)], 300), 'today');
    for (const playMs of [0, 5_000, 12_345, 30_000, 31_000]) {
      expect(sourceToPlay(timeline, playToSource(timeline, playMs))).toBeCloseTo(playMs, 6);
    }
    expect(playToSource(timeline, -5)).toBe(timeline.tasks[0]!.srcFromMs);
    expect(playToSource(timeline, timeline.totalMs + 5)).toBe(timeline.toMs);
    expect(sourceToPlay(timeline, timeline.fromMs - 1)).toBe(0);
    expect(sourceToPlay(timeline, timeline.toMs + 1)).toBe(timeline.totalMs);
  });

  it('starts at the period start when nothing plays', () => {
    const timeline = buildTimeline(recapOf([], 60), 'today');
    expect(playToSource(timeline, 0)).toBe(timeline.fromMs);
  });
});
