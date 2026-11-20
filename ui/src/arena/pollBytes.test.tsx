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

describe('arena poll payload (FP-18 R10)', () => {
  it('stays under 80,000 bytes for the 112 arena-perf-1 items (the v1 poll was 109,406)', async () => {
    setArenaScenario('arena-perf-1');
    const poll = await pollBytes();
    expect(poll.items).toBe(112);
    expect(poll.bytes).toBeLessThan(80_000);
  });

  it('does not grow when items carry a full decision history, because decisions are not in the list projection', async () => {
    setArenaScenario('arena-perf-1');
    const api = useAppApi();
    const first = (await ((await api.get('/apps/specter-arena/api/work?state=open&view=list&order=updated&limit=10')) as Response).json()) as { items: { workId: string; version: number }[] };
    let n = 0;
    for (const item of first.items) {
      let version = item.version;
      for (let cycle = 0; cycle < 25; cycle += 1) {
        for (const action of ['block', 'unblock']) {
          n += 1;
          const response = (await api.post(`/apps/specter-arena/api/work/${item.workId}/decisions`, { requestId: `req_${n}_abcdefgh`, expectedVersion: version, action, note: 'N'.repeat(280) })) as Response;
          expect(response.status).toBe(200);
          version += 1;
        }
      }
    }
    const poll = await pollBytes();
    expect(poll.bytes).toBeLessThan(80_000);
  });
});
