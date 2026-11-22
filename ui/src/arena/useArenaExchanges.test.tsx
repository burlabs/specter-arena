import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CADENCE_MAX_MS } from './exchangePlanner';
import type { SceneEnemy, SceneModel, SceneSpecter } from './sceneModel';
import { useArenaExchanges } from './useArenaExchanges';

const hero = (id: string, work: string[]): SceneSpecter => ({
  bindingId: id, displayName: id, specterName: id, heroId: 'vell', portraitAssetId: null, condition: 'working', openAttemptIds: [], engagedWorkIds: work, xpTotal: 0, level: 1, xpReading: 'ready', waitingReason: null,
});
const minion = (id: string): SceneEnemy => ({ workId: id, parentId: null, title: id, size: 'minion', state: 'open', sizeClass: 'medium', runMs: 300_000, progress: { kind: 'unknown' }, parts: null, blocked: false, engagedBy: [], defeated: false, committedXp: null });
const model = (specters: SceneSpecter[], enemies: SceneEnemy[]): SceneModel => ({ mode: 'FIXTURE', asOfMs: 1, specters, enemies, overflow: { enemies: 0, truncated: false }, coverage: { gaps: 0, unknownBots: 0 } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useArenaExchanges', () => {
  const scene = model([hero('a', ['w1'])], [minion('w1')]);

  it('starts nothing at once, attacks within the cadence, hits at the impact time and goes back to idle', () => {
    const { result } = renderHook(() => useArenaExchanges(scene, true, []));
    expect(result.current.heroes.size).toBe(0);
    act(() => void vi.advanceTimersByTime(CADENCE_MAX_MS));
    expect(result.current.heroes.get('a')).toMatchObject({ kind: 'attack', workId: 'w1' });
    expect(result.current.enemies.size).toBe(0);
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current.enemies.get('w1')).toMatchObject({ strong: false, bindingId: 'a' });
    act(() => void vi.advanceTimersByTime(600));
    expect(result.current.heroes.size).toBe(0);
    expect(result.current.enemies.size).toBe(0);
  });

  it('clears the timer on unmount', () => {
    const { unmount } = renderHook(() => useArenaExchanges(scene, true, []));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops and forgets everything when disabled, and starts fresh with no catch-up when enabled again', () => {
    const { result, rerender } = renderHook((props: { on: boolean }) => useArenaExchanges(scene, props.on, []), { initialProps: { on: true } });
    act(() => void vi.advanceTimersByTime(CADENCE_MAX_MS));
    expect(result.current.heroes.size).toBe(1);
    rerender({ on: false });
    expect(result.current.heroes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => void vi.advanceTimersByTime(60_000));
    rerender({ on: true });
    expect(result.current.heroes.size).toBe(0);
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current.heroes.size).toBe(0);
    act(() => void vi.advanceTimersByTime(2_100));
    expect(result.current.heroes.size).toBe(1);
  });

  it('plays nothing without a model', () => {
    const { result } = renderHook(() => useArenaExchanges(null, true, []));
    expect(result.current.layers).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('casts once for a rise and does not repeat it on the next render', () => {
    const rises = [{ id: 'w1@5', workId: 'w1' }];
    const { result, rerender } = renderHook((props: { m: SceneModel }) => useArenaExchanges(props.m, true, rises), { initialProps: { m: scene } });
    expect(result.current.heroes.get('a')).toMatchObject({ kind: 'cast' });
    act(() => void vi.advanceTimersByTime(700));
    expect(result.current.enemies.get('w1')).toMatchObject({ strong: true });
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current.heroes.size).toBe(0);
    rerender({ m: model([hero('a', ['w1'])], [minion('w1')]) });
    expect(result.current.heroes.size).toBe(0);
  });

  it('drops a playing attack when the enemy becomes defeated', () => {
    const { result, rerender } = renderHook((props: { m: SceneModel }) => useArenaExchanges(props.m, true, []), { initialProps: { m: scene } });
    act(() => void vi.advanceTimersByTime(CADENCE_MAX_MS));
    expect(result.current.heroes.size).toBe(1);
    rerender({ m: model([hero('a', ['w1'])], [{ ...minion('w1'), defeated: true, state: 'credited' }]) });
    expect(result.current.heroes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
