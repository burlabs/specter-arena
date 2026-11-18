import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { itemOf } from '../work/testData';
import { useWorkEvidence } from './useWorkEvidence';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const nextPoll = () => act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useWorkEvidence', () => {
  it('is idle without an id and makes no request', async () => {
    const { result } = renderHook(() => useWorkEvidence(null));
    await flush();
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('loads, then is ready with the item', async () => {
    api.getJson.mockResolvedValue(itemOf());
    const { result } = renderHook(() => useWorkEvidence('wrk_1'));
    expect(result.current.state.status).toBe('loading');
    await flush();
    expect(result.current.state).toEqual({ status: 'ready', item: itemOf() });
  });

  it('clears the item the moment the next read says it is gone', async () => {
    api.getJson.mockResolvedValueOnce(itemOf()).mockRejectedValue(new HostApiError(404, 'unknown_work'));
    const { result } = renderHook(() => useWorkEvidence('wrk_1'));
    await flush();
    expect(result.current.state.status).toBe('ready');
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'gone' });
  });

  it('clears the item on a 403 and says forbidden', async () => {
    api.getJson.mockResolvedValueOnce(itemOf()).mockRejectedValue(new HostApiError(403, null));
    const { result } = renderHook(() => useWorkEvidence('wrk_1'));
    await flush();
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'forbidden' });
  });

  it('clears the item on a network failure, and shows it again when a later read succeeds', async () => {
    api.getJson.mockResolvedValueOnce(itemOf()).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(itemOf({ version: 2 }));
    const { result } = renderHook(() => useWorkEvidence('wrk_1'));
    await flush();
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'failed', failure: 'offline' });
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'ready', item: itemOf({ version: 2 }) });
  });

  it('treats any other 404 as an unsupported backend and a malformed body as unexpected', async () => {
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const old = renderHook(() => useWorkEvidence('wrk_1'));
    await flush();
    expect(old.result.current.state).toEqual({ status: 'failed', failure: 'unsupported' });
    api.getJson.mockReset().mockResolvedValue({ nope: true });
    const odd = renderHook(() => useWorkEvidence('wrk_2'));
    await flush();
    expect(odd.result.current.state).toEqual({ status: 'failed', failure: 'unexpected' });
  });
});
