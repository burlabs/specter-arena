import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, usePolled } from './usePolled';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

describe('usePolled', () => {
  it('loads at mount and then every interval while visible', async () => {
    const load = vi.fn().mockResolvedValue('a');
    const { result } = renderHook(() => usePolled(load, 'k'));
    expect(result.current.loading).toBe(true);
    await flush();
    expect(result.current).toMatchObject({ data: 'a', loading: false, error: null });
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('skips ticks while hidden and refreshes once on becoming visible', async () => {
    const load = vi.fn().mockResolvedValue('a');
    renderHook(() => usePolled(load, 'k'));
    await flush();
    setVisibility('hidden');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(load).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops a response that is not from the newest request', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const load = vi.fn(() => new Promise<string>((resolve) => resolvers.push(resolve)));
    const { result } = renderHook(() => usePolled(load, 'k'));
    act(() => result.current.refresh());
    await act(async () => {
      resolvers[1]?.('new');
      resolvers[0]?.('old');
    });
    expect(result.current.data).toBe('new');
  });

  it('keeps the last good data when a later load fails, and clears it for a new key', async () => {
    const load = vi.fn().mockResolvedValueOnce('good').mockRejectedValueOnce(new Error('down'));
    const { result, rerender } = renderHook(({ k }) => usePolled(load, k), { initialProps: { k: 'one' } });
    await flush();
    act(() => result.current.refresh());
    await flush();
    expect(result.current.data).toBe('good');
    expect(result.current.error).toBeInstanceOf(Error);
    load.mockResolvedValue('other');
    rerender({ k: 'two' });
    expect(result.current).toMatchObject({ data: null, loading: true });
    await flush();
    expect(result.current.data).toBe('other');
  });

  it('shows a first failure with no data', async () => {
    const load = vi.fn().mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => usePolled(load, 'k'));
    await flush();
    expect(result.current).toMatchObject({ data: null, loading: false });
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('does nothing with a null loader and stops the timer on unmount', async () => {
    const idle = renderHook(() => usePolled<string>(null, 'k'));
    expect(idle.result.current).toMatchObject({ data: null, loading: false });
    act(() => idle.result.current.refresh());
    const load = vi.fn().mockResolvedValue('a');
    const { unmount } = renderHook(() => usePolled(load, 'k'));
    await flush();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that arrives after unmount', async () => {
    let resolve: (value: string) => void = () => undefined;
    const load = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    const { result, unmount } = renderHook(() => usePolled(load, 'k'));
    unmount();
    await act(async () => resolve('late'));
    expect(result.current.data).toBeNull();
  });
});
