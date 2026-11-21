import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { dataBody } from './testData';
import { DataShapeError } from './model';
import { dataFailureOf, useData } from './useData';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), putJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useData', () => {
  it('loads, then polls, and keeps the last good body when a poll fails', async () => {
    api.getJson.mockResolvedValue(dataBody());
    const { result } = renderHook(() => useData());
    expect(result.current.state.status).toBe('loading');
    await flush();
    expect(result.current.state).toMatchObject({ status: 'ready', failure: null });
    expect(api.getJson).toHaveBeenCalledWith('/apps/specter-arena/api/data');
    api.getJson.mockRejectedValue(new HostApiError(503, 'store_unavailable'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.state).toMatchObject({ status: 'ready', failure: 'unavailable' });
  });

  it('fails when the first read fails', async () => {
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const { result } = renderHook(() => useData());
    await flush();
    expect(result.current.state).toEqual({ status: 'failed', data: null, failure: 'unsupported' });
  });
});

describe('dataFailureOf', () => {
  it('names each failure', () => {
    expect(dataFailureOf(new DataShapeError('x'))).toBe('unexpected');
    expect(dataFailureOf(new HostApiError(404, null))).toBe('unsupported');
    expect(dataFailureOf(new HostApiError(500, null))).toBe('unavailable');
    expect(dataFailureOf(new TypeError('x'))).toBe('offline');
  });
});
