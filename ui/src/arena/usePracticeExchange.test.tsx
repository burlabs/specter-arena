import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_HERO, PRACTICE_TARGET, usePracticeExchange } from './usePracticeExchange';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePracticeExchange', () => {
  it('plays the arena timeline once per press and reads nothing from the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => usePracticeExchange('vell', 'patchling', true));
    act(() => result.current.play('cast'));
    expect(result.current.playing).toBe(true);
    expect(result.current.snapshot.heroes.get(PRACTICE_HERO)?.kind).toBe('cast');
    act(() => result.current.play('attack'));
    expect(result.current.snapshot.heroes.get(PRACTICE_HERO)?.kind).toBe('cast');
    await act(async () => void (await vi.advanceTimersByTimeAsync(610)));
    expect(result.current.snapshot.enemies.get(PRACTICE_TARGET)?.strong).toBe(true);
    await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
    expect(result.current.playing).toBe(false);
    expect(result.current.snapshot.heroes.size + result.current.snapshot.enemies.size + result.current.snapshot.counters.size + result.current.snapshot.flinches.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when motion is off, for an unknown hero, or with no hero, and drops a playing exchange when motion turns off', () => {
    const off = renderHook(() => usePracticeExchange('vell', 'patchling', false));
    act(() => off.result.current.play('attack'));
    expect(off.result.current.playing).toBe(false);
    const unknown = renderHook(() => usePracticeExchange('not-a-hero', 'patchling', true));
    act(() => unknown.result.current.play('attack'));
    expect(unknown.result.current.playing).toBe(false);
    const none = renderHook(() => usePracticeExchange(undefined, 'patchling', true));
    act(() => none.result.current.play('attack'));
    expect(none.result.current.playing).toBe(false);
    const live = renderHook(({ enabled }) => usePracticeExchange('vell', 'patchling', enabled), { initialProps: { enabled: true } });
    act(() => live.result.current.play('attack'));
    expect(live.result.current.playing).toBe(true);
    live.rerender({ enabled: false });
    expect(live.result.current.playing).toBe(false);
  });
});
