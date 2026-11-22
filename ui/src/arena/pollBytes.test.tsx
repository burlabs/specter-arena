import { setArenaScenario, useAppApi } from '@kirocrew/app-sdk';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArenaWork } from './useArenaWork';

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Reads one arena poll on arena-perf-1 and returns the bytes of every response body the poll received. */
async function pollBytes(): Promise<{ requests: number; items: number; bytes: number }> {
  const api = useAppApi();
  const original = api.get.bind(api);
  const sizes: number[] = [];
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    const response = (await original(path)) as Response;
    sizes.push((await response.clone().text()).length);
    return response;
  });
  const { result } = renderHook(() => useArenaWork());
  await flush();
  expect(result.current.state.status).toBe('ready');
  return { requests: sizes.length, items: result.current.state.snapshot?.items.length ?? 0, bytes: sizes.reduce((sum, size) => sum + size, 0) };
}

describe('arena poll payload (FP-22)', () => {
  it('stays under 60,000 bytes for the 112 arena-perf-1 tasks (the FP-18 work poll was under 80,000, the v1 poll 109,406)', async () => {
    setArenaScenario('arena-perf-1');
    const poll = await pollBytes();
    expect(poll.items).toBe(112);
    expect(poll.bytes).toBeLessThan(60_000);
  });

  it('is a fixed-size row per task: the 16 closed members and nothing that can grow, so a long-running bot adds no payload', async () => {
    setArenaScenario('arena-perf-1');
    const api = useAppApi();
    const page = (await ((await api.get('/apps/specter-arena/api/tasks?state=open&limit=25')) as Response).json()) as { items: Record<string, unknown>[] };
    expect(page.items).toHaveLength(25);
    for (const item of page.items) expect(Object.keys(item)).toHaveLength(16);
    const poll = await pollBytes();
    expect(poll.bytes / poll.items).toBeLessThan(600);
  });
});
