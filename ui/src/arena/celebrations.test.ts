import { describe, expect, it } from 'vitest';
import { MAX_CELEBRATIONS_PER_POLL, nextCelebrations, nextMilestoneRises } from './celebrations';
import type { SceneEnemy, SceneModel } from './sceneModel';

const POLL = 15_000;
const ctx = { visibleSincePrev: true, gapMs: POLL, pollMs: POLL };

const enemy = (n: number, defeated: boolean): SceneEnemy => ({
  workId: `wrk_${n}`,
  parentId: null,
  title: `Task ${n}`,
  size: 'minion',
  state: defeated ? 'credited' : 'open',
  sizeClass: 'medium',
  runMs: 300_000,
  progress: { kind: 'unknown' },
  parts: null,
  blocked: false,
  engagedBy: [],
  defeated,
  committedXp: defeated ? 10 : null,
});

const model = (enemies: SceneEnemy[], asOfMs = 1_000): SceneModel => ({
  mode: 'FIXTURE',
  asOfMs,
  specters: [],
  enemies,
  overflow: { enemies: 0, truncated: false },
  coverage: { gaps: 0, unknownBots: 0 },
});

describe('nextCelebrations', () => {
  it('celebrates nothing on the first model', () => {
    expect(nextCelebrations(null, model([enemy(1, true)]), ctx)).toEqual([]);
  });

  it('celebrates an item seen live and then defeated between two visible polls', () => {
    expect(nextCelebrations(model([enemy(1, false)]), model([enemy(1, true)], 2_000), ctx)).toEqual(['wrk_1']);
  });

  it('celebrates nothing after the tab was hidden', () => {
    expect(nextCelebrations(model([enemy(1, false)]), model([enemy(1, true)], 2_000), { ...ctx, visibleSincePrev: false })).toEqual([]);
  });

  it('celebrates nothing after a gap of more than two poll intervals, and does at exactly two', () => {
    const prev = model([enemy(1, false)]);
    const next = model([enemy(1, true)], 2_000);
    expect(nextCelebrations(prev, next, { ...ctx, gapMs: 2 * POLL + 1 })).toEqual([]);
    expect(nextCelebrations(prev, next, { ...ctx, gapMs: 2 * POLL })).toEqual(['wrk_1']);
  });

  it('celebrates nothing when the scene clock went backwards', () => {
    expect(nextCelebrations(model([enemy(1, false)], 5_000), model([enemy(1, true)], 4_000), ctx)).toEqual([]);
  });

  it('caps a burst at three, in a stable order', () => {
    const live = [5, 3, 1, 4, 2].map((n) => enemy(n, false));
    const done = [5, 3, 1, 4, 2].map((n) => enemy(n, true));
    expect(MAX_CELEBRATIONS_PER_POLL).toBe(3);
    expect(nextCelebrations(model(live), model(done, 2_000), ctx)).toEqual(['wrk_1', 'wrk_2', 'wrk_3']);
  });

  it('ignores an item absent from the previous model and one defeated in both', () => {
    const prev = model([enemy(2, true)]);
    const next = model([enemy(1, true), enemy(2, true)], 2_000);
    expect(nextCelebrations(prev, next, ctx)).toEqual([]);
  });

  it('celebrates again when an item was reopened and is accepted a second time', () => {
    const afterReopen = model([enemy(1, false)], 2_000);
    expect(nextCelebrations(model([enemy(1, true)]), afterReopen, ctx)).toEqual([]);
    expect(nextCelebrations(afterReopen, model([enemy(1, true)], 3_000), ctx)).toEqual(['wrk_1']);
  });
});

describe('nextMilestoneRises', () => {
  const progressed = (n: number, done: number, total = 4, defeated = false): SceneModel['enemies'][number] => ({
    workId: `wrk_${n}`, parentId: null, title: `T${n}`, size: 'minion', state: defeated ? 'credited' : 'open',
  sizeClass: 'medium',
  runMs: 300_000, progress: { kind: 'milestones', done, total }, parts: null, blocked: false, engagedBy: [], defeated, committedXp: null,
  });
  const withEnemies = (enemies: SceneModel['enemies'], asOfMs = 1_000): SceneModel => ({ mode: 'FIXTURE', asOfMs, specters: [], enemies, overflow: { enemies: 0, truncated: false }, coverage: { gaps: 0, unknownBots: 0 } });
  const ctx = { visibleSincePrev: true, gapMs: 10_000, pollMs: 10_000 };

  it('reports an enemy whose done count rose, sorted, at most three', () => {
    const prev = withEnemies([1, 2, 3, 4, 5].map((n) => progressed(n, 1)));
    const next = withEnemies([5, 4, 3, 2, 1].map((n) => progressed(n, 2)), 2_000);
    expect(nextMilestoneRises(prev, next, ctx)).toEqual(['wrk_1', 'wrk_2', 'wrk_3']);
  });

  it('ignores a first model, a hidden tab, a long gap, a clock that went back, unchanged, lower, defeated, new and unknown progress', () => {
    const prev = withEnemies([progressed(1, 1), progressed(2, 1), progressed(3, 2), { ...progressed(4, 0), progress: { kind: 'unknown' } }]);
    const next = withEnemies([progressed(1, 1), progressed(2, 3, 4, true), progressed(3, 1), { ...progressed(4, 0), progress: { kind: 'milestones', done: 1, total: 2 } }, progressed(5, 2)], 2_000);
    expect(nextMilestoneRises(prev, next, ctx)).toEqual([]);
    const rose = withEnemies([progressed(1, 2)], 2_000);
    expect(nextMilestoneRises(null, rose, ctx)).toEqual([]);
    expect(nextMilestoneRises(prev, rose, { ...ctx, visibleSincePrev: false })).toEqual([]);
    expect(nextMilestoneRises(prev, rose, { ...ctx, gapMs: 20_001 })).toEqual([]);
    expect(nextMilestoneRises(withEnemies([progressed(1, 1)], 5_000), rose, ctx)).toEqual([]);
    expect(nextMilestoneRises(withEnemies([progressed(1, 1)]), rose, ctx)).toEqual(['wrk_1']);
  });
});
