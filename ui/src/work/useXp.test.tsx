import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { ATLAS, BRINDLE, summaryOf } from './testData';
import { ShapeError } from './model';
import { useXp, xpFailureOf, xpViewOf } from './useXp';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('xpFailureOf (H-2)', () => {
  it('classifies failures', () => {
    expect(xpFailureOf(new ShapeError('x'))).toBe('unexpected');
    expect(xpFailureOf(new HostApiError(404, null))).toBe('unsupported');
    expect(xpFailureOf(new HostApiError(503, 'store_not_ready'))).toBe('unavailable');
    expect(xpFailureOf(new TypeError('Failed to fetch'))).toBe('offline');
  });
});

describe('useXp (H-2)', () => {
  it('loads summaries keyed by binding', async () => {
    api.getJson.mockResolvedValue({ contractVersion: 1, items: [summaryOf(), summaryOf({ bindingId: BRINDLE, totalXp: 50, level: 1 })], asOfMs: 1 });
    const { result } = renderHook(() => useXp());
    expect(result.current.status).toBe('loading');
    await flush();
    expect(result.current.status).toBe('ready');
    expect([...result.current.byBinding.keys()]).toEqual([ATLAS, BRINDLE]);
    expect(xpViewOf(result.current, ATLAS)).toEqual({ status: 'ready', summary: summaryOf() });
    expect(xpViewOf(result.current, 'bnd_nobody')).toEqual({ status: 'ready', summary: null });
  });

  it.each([
    [new HostApiError(404, null), 'unsupported'],
    [new HostApiError(503, 'store_not_ready'), 'unavailable'],
    [new TypeError('Failed to fetch'), 'offline'],
  ])('fails closed with %s', async (error, failure) => {
    api.getJson.mockRejectedValue(error);
    const { result } = renderHook(() => useXp());
    await flush();
    expect(result.current.status).toBe('failed');
    expect(result.current.failure).toBe(failure);
    expect(xpViewOf(result.current, ATLAS)).toEqual({ status: 'failed', failure });
  });

  it('treats a body that does not match the contract as unexpected', async () => {
    api.getJson.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useXp());
    await flush();
    expect(result.current.failure).toBe('unexpected');
  });

  it('reads loading before the first reply and keeps the last good data when a later poll fails', async () => {
    api.getJson.mockResolvedValueOnce({ contractVersion: 1, items: [summaryOf()], asOfMs: 1 });
    const { result } = renderHook(() => useXp());
    expect(xpViewOf(result.current, ATLAS)).toEqual({ status: 'loading' });
    await flush();
    api.getJson.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.status).toBe('ready');
    expect(xpViewOf(result.current, ATLAS)).toEqual({ status: 'ready', summary: summaryOf() });
  });
});
