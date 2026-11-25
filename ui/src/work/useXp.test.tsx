import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { ATLAS, BRINDLE, summaryOf, xpPageOf } from './testData';
import { ShapeError } from './model';
import { XP_MAX_PAGES, useXp, xpFailureOf, xpViewOf } from './useXp';

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
    api.getJson.mockResolvedValue(xpPageOf([summaryOf(), summaryOf({ bindingId: BRINDLE, totalXp: 50, level: 1 })]));
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
    api.getJson.mockResolvedValueOnce(xpPageOf([summaryOf()]));
    const { result } = renderHook(() => useXp());
    expect(xpViewOf(result.current, ATLAS)).toEqual({ status: 'loading' });
    await flush();
    api.getJson.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.status).toBe('ready');
    expect(xpViewOf(result.current, ATLAS)).toEqual({ status: 'ready', summary: summaryOf() });
  });

  const binding = (n: number) => `bnd_${n.toString(16).padStart(24, '0')}`;
  const pagesOf = (total: number, size = 200) => async (path: string) => {
    const cursor = new URL(path, 'http://x').searchParams.get('cursor');
    const start = cursor === null ? 0 : Number(cursor.slice(2));
    const end = Math.min(start + size, total);
    return xpPageOf(
      Array.from({ length: end - start }, (_, i) => summaryOf({ bindingId: binding(start + i) })),
      end < total ? `p_${end}` : null,
    );
  };

  it('walks every page, so 501 bindings all arrive (KL-11)', async () => {
    api.getJson.mockImplementation(pagesOf(501));
    const { result } = renderHook(() => useXp());
    await flush();
    expect(result.current.status).toBe('ready');
    expect(result.current.byBinding.size).toBe(501);
    expect(result.current.truncated).toBe(false);
    expect(xpViewOf(result.current, binding(500))).toMatchObject({ status: 'ready', summary: { bindingId: binding(500) } });
    expect(api.getJson.mock.calls.map(([path]) => path)).toEqual([
      '/apps/specter-arena/api/xp?view=tasks&limit=200',
      '/apps/specter-arena/api/xp?view=tasks&limit=200&cursor=p_200',
      '/apps/specter-arena/api/xp?view=tasks&limit=200&cursor=p_400',
    ]);
  });

  it('fails the whole poll when the second page fails, and shows no partial map', async () => {
    api.getJson.mockImplementation(async (path: string) => {
      if (path.includes('cursor=')) throw new HostApiError(503, 'store_not_ready');
      return pagesOf(450)(path);
    });
    const { result } = renderHook(() => useXp());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unavailable' });
    expect(result.current.byBinding.size).toBe(0);
  });

  it('keeps the last complete map when a later poll fails on a later page', async () => {
    api.getJson.mockImplementation(pagesOf(450));
    const { result } = renderHook(() => useXp());
    await flush();
    expect(result.current.byBinding.size).toBe(450);
    api.getJson.mockImplementation(async (path: string) => {
      if (path.includes('cursor=')) throw new TypeError('Failed to fetch');
      return pagesOf(450)(path);
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.status).toBe('ready');
    expect(result.current.byBinding.size).toBe(450);
    expect(result.current.failure).toBe('offline');
  });

  it('stops at the page cap, marks the result truncated and never shows a missing bot as 0 XP', async () => {
    api.getJson.mockImplementation(async (path: string) => {
      const cursor = new URL(path, 'http://x').searchParams.get('cursor');
      const n = cursor === null ? 0 : Number(cursor.slice(2));
      return xpPageOf([summaryOf({ bindingId: binding(n) })], `p_${n + 1}`);
    });
    const { result } = renderHook(() => useXp());
    await flush();
    expect(api.getJson).toHaveBeenCalledTimes(XP_MAX_PAGES);
    expect(result.current.truncated).toBe(true);
    expect(xpViewOf(result.current, binding(0))).toMatchObject({ status: 'ready' });
    expect(xpViewOf(result.current, 'bnd_missing')).toEqual({ status: 'failed', failure: 'unavailable' });
  });

  it('fails a cursor that does not advance instead of looping', async () => {
    api.getJson.mockResolvedValue(xpPageOf([summaryOf()], 'p_1'));
    const { result } = renderHook(() => useXp());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unexpected' });
    expect(api.getJson).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a v1 body', { contractVersion: 1, items: [summaryOf()], asOfMs: 1 }],
    ['a v2 page', { contractVersion: 2, items: [summaryOf()], nextCursor: null, asOfMs: 1 }],
    ['a v3 page whose items are xp-summary v1', { contractVersion: 3, items: [{ ...summaryOf(), contractVersion: 1 }], nextCursor: null, asOfMs: 1 }],
    ['a v3 page whose items lack creditedTaskCount', { contractVersion: 3, items: [{ ...summaryOf(), creditedTaskCount: undefined }], nextCursor: null, asOfMs: 1 }],
    ['a v3 page with a negative credited count', { contractVersion: 3, items: [summaryOf({ creditedTaskCount: -1 })], nextCursor: null, asOfMs: 1 }],
    ['a v3 page with more than 200 items', { contractVersion: 3, items: Array.from({ length: 201 }, () => summaryOf()), nextCursor: null, asOfMs: 1 }],
  ])('fails closed on %s', async (_name, body) => {
    api.getJson.mockResolvedValue(body);
    const { result } = renderHook(() => useXp());
    await flush();
    expect(result.current.failure).toBe('unexpected');
  });

  it('reads the credited task count and both-ledger total of the v2 summary', async () => {
    api.getJson.mockResolvedValue(xpPageOf([summaryOf({ totalXp: 340, creditedTaskCount: 21 })]));
    const { result } = renderHook(() => useXp());
    await flush();
    expect(xpViewOf(result.current, ATLAS)).toMatchObject({ status: 'ready', summary: { totalXp: 340, creditedTaskCount: 21, contractVersion: 2 } });
  });
});
