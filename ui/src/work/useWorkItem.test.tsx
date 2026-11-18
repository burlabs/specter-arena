import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { itemOf } from './testData';
import { useWorkItem } from './useWorkItem';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useWorkItem (H-5)', () => {
  it('is idle without an id', async () => {
    const { result } = renderHook(() => useWorkItem(null));
    await flush();
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('loads the item and shows loading first', async () => {
    api.getJson.mockResolvedValue(itemOf());
    const { result } = renderHook(() => useWorkItem('wrk_1'));
    expect(result.current.state.status).toBe('loading');
    await flush();
    expect(result.current.state).toEqual({ status: 'ready', item: itemOf() });
  });

  it('is gone only for unknown_work, and unsupported for any other 404', async () => {
    api.getJson.mockRejectedValue(new HostApiError(404, 'unknown_work'));
    const gone = renderHook(() => useWorkItem('wrk_1'));
    await flush();
    expect(gone.result.current.state).toEqual({ status: 'gone' });
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const old = renderHook(() => useWorkItem('wrk_1'));
    await flush();
    expect(old.result.current.state).toEqual({ status: 'failed', failure: 'unsupported' });
  });

  it('fails on a body that is not a work item and on a network error', async () => {
    api.getJson.mockResolvedValue({ nope: true });
    const odd = renderHook(() => useWorkItem('wrk_1'));
    await flush();
    expect(odd.result.current.state).toEqual({ status: 'failed', failure: 'unexpected' });
    api.getJson.mockRejectedValue(new TypeError('Failed to fetch'));
    const down = renderHook(() => useWorkItem('wrk_1'));
    await flush();
    expect(down.result.current.state).toEqual({ status: 'failed', failure: 'offline' });
  });
});
