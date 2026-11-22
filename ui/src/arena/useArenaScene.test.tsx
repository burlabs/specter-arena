import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { POLL_MS } from '../observatory/usePolled';
import { useArenaScene } from './useArenaScene';
import type { SceneEnemy, SceneModel } from './sceneModel';

const enemy = (n: number, defeated: boolean, committedXp: number | null = 25): SceneEnemy => ({
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
  committedXp: defeated ? committedXp : null,
});

const model = (enemies: SceneEnemy[], asOfMs = 1_000): SceneModel => ({
  mode: 'FIXTURE',
  asOfMs,
  specters: [],
  enemies,
  overflow: { enemies: 0, truncated: false },
  coverage: { gaps: 0, unknownBots: 0 },
});

interface Props {
  scene: SceneModel | null;
  at: number | null;
  animate: boolean;
}

const start = (scene: SceneModel | null, at: number | null, animate = true) =>
  renderHook((props: Props) => useArenaScene(props.scene, props.at, props.animate), { initialProps: { scene, at, animate } });

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useArenaScene', () => {
  it('plays nothing on the first model, even for items that are already defeated', () => {
    const { result } = start(model([enemy(1, true)]), 10_000);
    expect(result.current.cues).toEqual([]);
    expect(result.current.celebrating.size).toBe(0);
  });

  it('plays one cue with the committed XP when an item is seen going from open to defeated', () => {
    const { result, rerender } = start(model([enemy(1, false)]), 10_000);
    rerender({ scene: model([enemy(1, true, 40)], 2_000), at: 10_000 + POLL_MS, animate: true });
    expect(result.current.cues).toHaveLength(1);
    expect(result.current.cues[0]).toMatchObject({ workId: 'wrk_1', title: 'Task 1', committedXp: 40 });
    expect([...result.current.celebrating]).toEqual(['wrk_1']);
    act(() => result.current.complete(result.current.cues[0]!.id));
    expect(result.current.cues).toEqual([]);
    expect(result.current.celebrating.size).toBe(0);
  });

  it('plays nothing for a roster-only change that keeps the same poll', () => {
    const { result, rerender } = start(model([enemy(1, false)]), 10_000);
    rerender({ scene: model([enemy(1, true)], 2_000), at: 10_000, animate: true });
    expect(result.current.cues).toEqual([]);
  });

  it('re-baselines after the tab was hidden and celebrates the next live defeat', () => {
    const { result, rerender } = start(model([enemy(1, false), enemy(2, false)]), 10_000);
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    rerender({ scene: model([enemy(1, true), enemy(2, false)], 2_000), at: 10_000 + POLL_MS, animate: true });
    expect(result.current.cues).toEqual([]);
    rerender({ scene: model([enemy(1, true), enemy(2, true)], 3_000), at: 10_000 + 2 * POLL_MS, animate: true });
    expect(result.current.cues.map((cue) => cue.workId)).toEqual(['wrk_2']);
  });

  it('plays nothing after a gap longer than two poll intervals', () => {
    const { result, rerender } = start(model([enemy(1, false)]), 10_000);
    rerender({ scene: model([enemy(1, true)], 2_000), at: 10_000 + 2 * POLL_MS + 1, animate: true });
    expect(result.current.cues).toEqual([]);
  });

  it('plays at most three cues for a burst of five', () => {
    const live = [1, 2, 3, 4, 5].map((n) => enemy(n, false));
    const done = [1, 2, 3, 4, 5].map((n) => enemy(n, true));
    const { result, rerender } = start(model(live), 10_000);
    rerender({ scene: model(done, 2_000), at: 10_000 + POLL_MS, animate: true });
    expect(result.current.cues).toHaveLength(3);
  });

  it('plays nothing when motion is off, and clears cues that were playing when it turns off', () => {
    const { result, rerender } = start(model([enemy(1, false), enemy(2, false)]), 10_000, false);
    rerender({ scene: model([enemy(1, true), enemy(2, false)], 2_000), at: 10_000 + POLL_MS, animate: false });
    expect(result.current.cues).toEqual([]);

    rerender({ scene: model([enemy(1, true), enemy(2, false)], 2_000), at: 10_000 + POLL_MS, animate: true });
    rerender({ scene: model([enemy(1, true), enemy(2, true)], 3_000), at: 10_000 + 2 * POLL_MS, animate: true });
    expect(result.current.cues).toHaveLength(1);
    rerender({ scene: model([enemy(1, true), enemy(2, true)], 3_000), at: 10_000 + 2 * POLL_MS, animate: false });
    expect(result.current.cues).toEqual([]);
  });

  it('waits for data: a null scene or clock plays nothing and keeps no baseline', () => {
    const { result, rerender } = start(null, null);
    rerender({ scene: model([enemy(1, false)]), at: null, animate: true });
    rerender({ scene: model([enemy(1, true)], 2_000), at: 10_000, animate: true });
    expect(result.current.cues).toEqual([]);
  });

  it('starts hidden: the first visible poll after a hidden start is a re-baseline', () => {
    act(() => setVisibility('hidden'));
    const { result, rerender } = start(model([enemy(1, false)]), 10_000);
    act(() => setVisibility('visible'));
    rerender({ scene: model([enemy(1, true)], 2_000), at: 10_000 + POLL_MS, animate: true });
    expect(result.current.cues).toEqual([]);
  });

  describe('rises', () => {
    const risen = (done: number, asOfMs: number): SceneModel => model([{ ...enemy(1, false), progress: { kind: 'milestones', done, total: 4 } }], asOfMs);

    it('reports a milestone rise seen between two visible polls, once, and clears with motion off', () => {
      const { result, rerender } = start(risen(1, 1_000), 10_000);
      expect(result.current.rises).toEqual([]);
      rerender({ scene: risen(2, 2_000), at: 10_000 + POLL_MS, animate: true });
      expect(result.current.rises).toEqual([{ id: `wrk_1@${10_000 + POLL_MS}`, workId: 'wrk_1' }]);
      rerender({ scene: risen(2, 3_000), at: 10_000 + 2 * POLL_MS, animate: true });
      expect(result.current.rises).toHaveLength(1);
      rerender({ scene: risen(2, 3_000), at: 10_000 + 2 * POLL_MS, animate: false });
      expect(result.current.rises).toEqual([]);
    });

    it('reports nothing with motion off, after a hidden tab, or on the first model', () => {
      const off = start(risen(1, 1_000), 10_000, false);
      off.rerender({ scene: risen(2, 2_000), at: 10_000 + POLL_MS, animate: false });
      expect(off.result.current.rises).toEqual([]);
      const hidden = start(risen(1, 1_000), 10_000);
      setVisibility('hidden');
      setVisibility('visible');
      hidden.rerender({ scene: risen(2, 2_000), at: 10_000 + POLL_MS, animate: true });
      expect(hidden.result.current.rises).toEqual([]);
    });
  });
});
