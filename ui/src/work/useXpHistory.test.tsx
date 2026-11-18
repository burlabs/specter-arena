import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { ATLAS, summaryOf } from './testData';
import { useXpHistory } from './useXpHistory';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const entry = (n: number, amount = 50) => ({ entryId: `xpe_${n}`, workId: 'wrk_1', workTitle: 'Title', kind: 'award', amount, policyVersion: 'xp-policy-1', decisionId: 'dec_1', createdAtMs: n });

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useXpHistory (H-3)', () => {
  it('is idle without a binding and fetches nothing', async () => {
    const { result } = renderHook(() => useXpHistory(null));
    await flush();
    expect(result.current.status).toBe('idle');
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('loads the summary and entries newest first, then older pages', async () => {
    api.getJson.mockImplementation(async (path: string) =>
      path.includes('cursor=c1')
        ? { contractVersion: 1, bindingId: ATLAS, summary: summaryOf(), items: [entry(1)], nextCursor: null, asOfMs: 1 }
        : { contractVersion: 1, bindingId: ATLAS, summary: summaryOf(), items: [entry(3), entry(2)], nextCursor: 'c1', asOfMs: 1 },
    );
    const { result } = renderHook(() => useXpHistory(ATLAS));
    expect(result.current.status).toBe('loading');
    await flush();
    expect(result.current.status).toBe('ready');
    expect(result.current.summary).toEqual(summaryOf());
    expect(result.current.entries.map((item) => item.entryId)).toEqual(['xpe_3', 'xpe_2']);
    expect(result.current.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.entries.map((item) => item.entryId)).toEqual(['xpe_3', 'xpe_2', 'xpe_1']);
    expect(result.current.hasOlder).toBe(false);
  });

  it('is gone for an unknown binding and unsupported for an older backend', async () => {
    api.getJson.mockRejectedValue(new HostApiError(404, 'unknown_binding'));
    const gone = renderHook(() => useXpHistory(ATLAS));
    await flush();
    expect(gone.result.current.status).toBe('gone');
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const old = renderHook(() => useXpHistory(ATLAS));
    await flush();
    expect(old.result.current.status).toBe('failed');
    expect(old.result.current.failure).toBe('unsupported');
  });

  it('breaks ties on the entry id so a poll never reorders equals', async () => {
    api.getJson.mockResolvedValue({ contractVersion: 1, bindingId: ATLAS, summary: summaryOf(), items: [{ ...entry(1), createdAtMs: 5 }, { ...entry(2), createdAtMs: 5 }], nextCursor: null, asOfMs: 1 });
    const { result } = renderHook(() => useXpHistory(ATLAS));
    await flush();
    expect(result.current.entries.map((item) => item.entryId)).toEqual(['xpe_2', 'xpe_1']);
  });
});
