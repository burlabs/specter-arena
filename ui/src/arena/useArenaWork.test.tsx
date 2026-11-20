import { setArenaScenario, useAppApi } from '@kirocrew/app-sdk';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workListPath } from '../host';
import { arenaFailureOf, useArenaWork } from './useArenaWork';
import { ShapeError, listItemOf } from '../work/model';
import { HostApiError } from '../host';
import { workOf } from './testData';

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The stubs answer as the backend does for view=list: list items only, `work-items.v2`.
const page = (items: ReturnType<typeof workOf>[], nextCursor: string | null = null, asOfMs = 5) =>
  new Response(JSON.stringify({ contractVersion: 2, order: 'updated', items: items.map(listItemOf), nextCursor, asOfMs }));

describe('failure mapping', () => {
  it('maps shapes, statuses and everything else', () => {
    expect(arenaFailureOf(new ShapeError('x'))).toBe('unexpected');
    expect(arenaFailureOf(new HostApiError(404, 'not_found'))).toBe('unsupported');
    expect(arenaFailureOf(new HostApiError(403, null))).toBe('forbidden');
    expect(arenaFailureOf(new HostApiError(503, null))).toBe('unavailable');
    expect(arenaFailureOf(new TypeError('Failed to fetch'))).toBe('offline');
  });
});

describe('useArenaWork on the perf fixture', () => {
  it('collects 100 on-field items and 12 accepted in a handful of GET requests', async () => {
    setArenaScenario('arena-perf-1');
    const get = vi.spyOn(useAppApi(), 'get');
    const post = vi.spyOn(useAppApi(), 'post');
    const { result } = renderHook(() => useArenaWork());
    expect(result.current.state.status).toBe('loading');
    await flush();
    const state = result.current.state;
    expect(state.status).toBe('ready');
    expect(state.snapshot?.items).toHaveLength(112);
    expect(state.snapshot?.truncated).toBe(false);
    expect(state.snapshot?.asOfMs).toBe(1794916800000);
    expect(state.failure).toBeNull();
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(get.mock.calls.length).toBeLessThanOrEqual(12);
    expect(post).not.toHaveBeenCalled();
  });

  it('polls again every 15 seconds while mounted', async () => {
    setArenaScenario('arena');
    const get = vi.spyOn(useAppApi(), 'get');
    renderHook(() => useArenaWork());
    await flush();
    const first = get.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    await flush();
    expect(get.mock.calls.length).toBeGreaterThan(first);
  });
});

describe('useArenaWork against stubbed pages', () => {
  it('follows cursors, stops at 8 pages and says the counts are a minimum', async () => {
    const urls: string[] = [];
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => {
      urls.push(path);
      return Promise.resolve(path.includes('state=accepted') ? page([]) : page([], 'c_1'));
    });
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(urls.filter((url) => url.includes('state=open'))).toHaveLength(8);
    expect(urls.filter((url) => url.includes('state=accepted'))).toHaveLength(1);
    expect(result.current.state.snapshot?.truncated).toBe(true);
    expect(urls[0]).toBe(workListPath('open', 25, null, 'updated'));
  });

  it('reads the accepted stream once even when it has more', async () => {
    const urls: string[] = [];
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => {
      urls.push(path);
      return Promise.resolve(path.includes('state=accepted') ? page([], 'c_1') : page([]));
    });
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(urls.filter((url) => url.includes('state=accepted'))).toHaveLength(1);
    expect(result.current.state.snapshot?.truncated).toBe(false);
  });

  it('keeps the higher version of an item seen in two streams and the largest asOfMs', async () => {
    const old = workOf(1, { version: 1, state: 'open' });
    const newer = workOf(1, { version: 2, state: 'blocked' });
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      Promise.resolve(path.includes('state=open') ? page([old], null, 3) : path.includes('state=blocked') ? page([newer], null, 9) : page([newer, old], null, 1)),
    );
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(result.current.state.snapshot?.items).toEqual([listItemOf(newer)]);
    expect(result.current.state.snapshot?.asOfMs).toBe(9);
  });

  it('fails the whole poll when one stream fails, and keeps the last good snapshot with the failure named', async () => {
    let broken = false;
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      broken && path.includes('state=blocked') ? Promise.resolve(new Response('{}', { status: 403 })) : Promise.resolve(page([workOf(1)])),
    );
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(result.current.state.status).toBe('ready');
    broken = true;
    await act(async () => result.current.refresh());
    await flush();
    expect(result.current.state).toMatchObject({ status: 'ready', failure: 'forbidden' });
    expect(result.current.state.snapshot?.items).toHaveLength(1);
  });

  it.each([
    ['unsupported', new Response('{}', { status: 404 })],
    ['unavailable', new Response('{}', { status: 500 })],
    ['unexpected', new Response(JSON.stringify({ nope: true }))],
    ['unexpected', new Response(JSON.stringify({ contractVersion: 1, items: [], nextCursor: null, asOfMs: 1 }))],
  ])('is failed with %s when the first read fails', async (failure, response) => {
    vi.spyOn(useAppApi(), 'get').mockImplementation(() => Promise.resolve(response.clone()));
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(result.current.state).toMatchObject({ status: 'failed', failure, snapshot: null });
  });

  it('is failed offline when the network rejects', async () => {
    vi.spyOn(useAppApi(), 'get').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(result.current.state).toMatchObject({ status: 'failed', failure: 'offline' });
  });
});

describe('useArenaWork reads the list projection in update order (FP-18)', () => {
  it('sends view=list&order=updated on every request and never a v1 read', async () => {
    const urls: string[] = [];
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => {
      urls.push(path);
      return Promise.resolve(page([]));
    });
    renderHook(() => useArenaWork());
    await flush();
    expect(urls).toHaveLength(5);
    for (const url of urls) expect(url).toMatch(/[?&]view=list&order=updated&limit=25/);
  });

  it('finds an item created long ago and accepted today on the one accepted page (KL-09)', async () => {
    // 30 accepted items: item 30 is the oldest by creation but the newest by update. A creation-ordered page of 25 would drop it.
    const all = Array.from({ length: 30 }, (_, i) => workOf(i + 1, { state: 'accepted', createdAtMs: 1_000_000 - i, updatedAtMs: i === 29 ? 9_000_000 : 5_000_000 - i }));
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => {
      const params = new URL(path, 'http://x').searchParams;
      if (params.get('state') !== 'accepted') return Promise.resolve(page([]));
      const key = params.get('order') === 'updated' ? 'updatedAtMs' : 'createdAtMs';
      const sorted = [...all].sort((a, b) => b[key] - a[key]);
      return Promise.resolve(page(sorted.slice(0, 25), 'u_25'));
    });
    const { result } = renderHook(() => useArenaWork());
    await flush();
    const ids = result.current.state.snapshot?.items.map((item) => item.workId) ?? [];
    expect(ids).toHaveLength(25);
    expect(ids).toContain(all[29]?.workId);
    expect(result.current.state.snapshot?.truncated).toBe(false);
  });

  it('keeps no full-item field on the snapshot, so a consumer cannot read evidence from the list', async () => {
    vi.spyOn(useAppApi(), 'get').mockImplementation(() => Promise.resolve(page([workOf(1, { state: 'open' })])));
    const { result } = renderHook(() => useArenaWork());
    await flush();
    const row = result.current.state.snapshot?.items[0] as unknown as Record<string, unknown>;
    for (const dropped of ['decisions', 'review', 'milestones', 'evidenceRevision', 'acceptanceCondition', 'policyVersion']) expect(dropped in row).toBe(false);
    expect(row.everAccepted).toBe(false);
  });
});
