import { describe, expect, it } from 'vitest';
import { MAX_CELEBRATIONS_PER_POLL, nextCelebrations } from './celebrations';
import type { SceneEnemy, SceneModel } from './sceneModel';

const POLL = 15_000;
const ctx = { visibleSincePrev: true, gapMs: POLL, pollMs: POLL };

const enemy = (n: number, defeated: boolean): SceneEnemy => ({
  workId: `wrk_${n}`,
  parentId: null,
  title: `Task ${n}`,
  size: 'minion',
  state: defeated ? 'accepted' : 'open',
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
