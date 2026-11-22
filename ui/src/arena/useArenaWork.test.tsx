import { setArenaScenario, useAppApi } from '@kirocrew/app-sdk';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskItemV1 } from '../contracts/types';
import { HostApiError, tasksPath } from '../host';
import { ShapeError } from '../work/model';
import { botOf, creditedOf, notCreditedOf, taskOf } from './testData';
import { arenaFailureOf, useArenaWork } from './useArenaWork';

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const bot = botOf(1);
// The stubs answer as the backend does: `tasks.v1`, task items only.
const page = (items: TaskItemV1[], nextCursor: string | null = null, asOfMs = 5) => new Response(JSON.stringify({ contractVersion: 1, items, nextCursor, asOfMs }));
const stateOf = (path: string): string | null => new URL(path, 'http://x').searchParams.get('state');

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
  it('collects 100 open and 12 credited tasks in a handful of GET requests', async () => {
    setArenaScenario('arena-perf-1');
    const get = vi.spyOn(useAppApi(), 'get');
    const post = vi.spyOn(useAppApi(), 'post');
    const { result } = renderHook(() => useArenaWork());
    expect(result.current.state.status).toBe('loading');
    await flush();
    const state = result.current.state;
    expect(state.status).toBe('ready');
    expect(state.snapshot?.items).toHaveLength(112);
    expect(state.snapshot?.items.filter((task) => task.state === 'credited')).toHaveLength(12);
    expect(state.snapshot?.truncated).toBe(false);
    expect(state.snapshot?.asOfMs).toBe(1794916800000);
    expect(state.failure).toBeNull();
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(get.mock.calls.length).toBeLessThanOrEqual(8);
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
  it('follows cursors, stops at 8 pages of open tasks and says the counts are a minimum', async () => {
    const urls: string[] = [];
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => {
      urls.push(path);
      return Promise.resolve(stateOf(path) === 'open' ? page([], 't_1') : page([]));
    });
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(urls.filter((url) => stateOf(url) === 'open')).toHaveLength(8);
    expect(urls.filter((url) => stateOf(url) === 'credited')).toHaveLength(1);
    expect(urls.filter((url) => stateOf(url) === 'not-credited')).toHaveLength(1);
    expect(result.current.state.snapshot?.truncated).toBe(true);
    expect(urls[0]).toBe(tasksPath({ state: 'open', limit: 25, cursor: null }));
  });

  it('reads the credited and not-credited streams once even when they have more', async () => {
    const urls: string[] = [];
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => {
      urls.push(path);
      return Promise.resolve(stateOf(path) === 'open' ? page([]) : page([], 't_1'));
    });
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(urls).toHaveLength(3);
    expect(result.current.state.snapshot?.truncated).toBe(false);
  });

  it('keeps the newer update of a task seen in two streams and the largest asOfMs', async () => {
    const old = taskOf(1, bot, { updatedAtMs: 1_000 });
    const newer = creditedOf(1, bot, { updatedAtMs: 2_000 });
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      Promise.resolve(stateOf(path) === 'open' ? page([old], null, 3) : stateOf(path) === 'credited' ? page([newer], null, 9) : page([], null, 1)),
    );
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(result.current.state.snapshot?.items).toEqual([newer]);
    expect(result.current.state.snapshot?.asOfMs).toBe(9);
  });

  it('fails the whole poll when one stream fails, and keeps the last good snapshot with the failure named', async () => {
    let broken = false;
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      broken && stateOf(path) === 'not-credited' ? Promise.resolve(new Response('{}', { status: 403 })) : Promise.resolve(stateOf(path) === 'open' ? page([taskOf(1, bot)]) : page([])),
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
    ['unexpected', new Response(JSON.stringify({ contractVersion: 2, items: [], nextCursor: null, asOfMs: 1 }))],
    ['unexpected', new Response(JSON.stringify({ contractVersion: 1, items: [{ taskId: 'tsk_1' }], nextCursor: null, asOfMs: 1 }))],
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

describe('useArenaWork reads tasks, and only reads', () => {
  it('sends GET /api/tasks with a state and limit=25 on every request, and no work route', async () => {
    const urls: string[] = [];
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => {
      urls.push(path);
      return Promise.resolve(page([]));
    });
    const post = vi.spyOn(useAppApi(), 'post');
    renderHook(() => useArenaWork());
    await flush();
    expect(urls).toHaveLength(3);
    for (const url of urls) expect(url).toMatch(/^\/apps\/specter-arena\/api\/tasks\?state=(open|credited|not-credited)&limit=25$/);
    expect(post).not.toHaveBeenCalled();
  });

  it('lists a not-credited task beside open and credited ones', async () => {
    const closed = notCreditedOf(3, bot);
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      Promise.resolve(stateOf(path) === 'open' ? page([taskOf(1, bot)]) : stateOf(path) === 'credited' ? page([creditedOf(2, bot)]) : page([closed])),
    );
    const { result } = renderHook(() => useArenaWork());
    await flush();
    expect(result.current.state.snapshot?.items.map((task) => task.state).sort()).toEqual(['credited', 'not-credited', 'open']);
  });
});
