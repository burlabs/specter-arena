import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterV1 } from '../contracts/types';
import { HostApiError } from '../host';
import { MAX_ROSTER_PAGES, failureOf, useRoster } from './useRoster';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => client }));

const { rosterBody } = await vi.importActual<typeof import('@kirocrew/app-sdk')>('@kirocrew/app-sdk');

beforeEach(() => client.get.mockReset());

const flush = () =>
  act(async () => {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  });

function page(base: RosterV1, nextCursor: string | null, names: string[]): RosterV1 {
  const [template] = base.items;
  if (template === undefined) throw new Error('fixture has no item');
  return { ...base, nextCursor, items: names.map((name, index) => ({ ...template, bindingId: `${name}${index}`, displayName: name })) };
}

describe('useRoster', () => {
  it('starts loading, then serves a sorted complete roster', async () => {
    client.get.mockResolvedValue(rosterBody('default'));
    const { result } = renderHook(() => useRoster());
    expect(result.current.state.status).toBe('loading');
    await flush();
    const { state } = result.current;
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.data.items.map((item) => item.displayName)).toEqual(['Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Fenn', null]);
    expect(state.data.complete).toBe(true);
    expect(state.data.truncated).toBe(false);
    expect(state.failure).toBeNull();
    expect(client.get.mock.calls[0]?.[0]).toBe('/apps/specter-arena/api/roster?view=signals&limit=200');
  });

  it('follows nextCursor across pages', async () => {
    const base = rosterBody('default');
    client.get.mockResolvedValueOnce(page(base, 'c1', ['Beta'])).mockResolvedValueOnce(page(base, null, ['Alpha']));
    const { result } = renderHook(() => useRoster());
    await flush();
    await flush();
    const { state } = result.current;
    expect(state.status === 'ready' && state.data.items.map((item) => item.displayName)).toEqual(['Alpha', 'Beta']);
    expect(client.get.mock.calls[1]?.[0]).toBe('/apps/specter-arena/api/roster?view=signals&limit=200&cursor=c1');
  });

  it('stops at the page cap and marks the roster truncated and incomplete', async () => {
    const base = rosterBody('default');
    client.get.mockImplementation(() => Promise.resolve(page(base, 'more', ['Bot'])));
    const { result } = renderHook(() => useRoster());
    await act(async () => {
      for (let turn = 0; turn < MAX_ROSTER_PAGES + 2; turn += 1) await Promise.resolve();
    });
    const { state } = result.current;
    expect(client.get).toHaveBeenCalledTimes(MAX_ROSTER_PAGES);
    expect(state.status === 'ready' && [state.data.truncated, state.data.complete]).toEqual([true, false]);
  });

  it('keeps the last good list and reports a failure when a later load breaks', async () => {
    client.get.mockResolvedValueOnce(rosterBody('default'));
    const { result } = renderHook(() => useRoster());
    await flush();
    client.get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => result.current.refresh());
    await flush();
    const { state } = result.current;
    expect(state.status).toBe('ready');
    expect(state.failure).toBe('offline');
    expect(state.data?.items).toHaveLength(7);
  });

  it('never replaces a good list with a half list when page 2 fails', async () => {
    const base = rosterBody('default');
    client.get.mockResolvedValueOnce(rosterBody('default'));
    const { result } = renderHook(() => useRoster());
    await flush();
    client.get.mockResolvedValueOnce(page(base, 'c1', ['Only'])).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => result.current.refresh());
    await flush();
    await flush();
    expect(result.current.state.data?.items).toHaveLength(7);
  });

  it('reports a failed first load', async () => {
    client.get.mockRejectedValueOnce(new HostApiError(500, null)).mockRejectedValueOnce(new HostApiError(503, 'store_not_ready'));
    const { result } = renderHook(() => useRoster());
    await flush();
    await flush();
    expect(result.current.state).toEqual({ status: 'failed', data: null, failure: 'store-not-ready' });
  });

  it('falls back to the v1 roster when the signals read fails', async () => {
    client.get.mockRejectedValueOnce(new HostApiError(400, 'invalid_view')).mockResolvedValueOnce(rosterBody('default'));
    const { result } = renderHook(() => useRoster());
    await flush();
    await flush();
    expect(client.get.mock.calls.map((call) => call[0])).toEqual([
      '/apps/specter-arena/api/roster?view=signals&limit=200',
      '/apps/specter-arena/api/roster?limit=200',
    ]);
    expect(result.current.state.status).toBe('ready');
    expect(result.current.state.data?.items).toHaveLength(7);
  });

  it('restarts from the first page on v1 when the signals read fails on a later page', async () => {
    const base = rosterBody('default');
    client.get
      .mockResolvedValueOnce(page(base, 'c1', ['Beta']))
      .mockRejectedValueOnce(new HostApiError(500, null))
      .mockResolvedValueOnce(page(base, null, ['Alpha']));
    const { result } = renderHook(() => useRoster());
    await flush();
    await flush();
    expect(result.current.state.data?.items.map((item) => item.displayName)).toEqual(['Alpha']);
    expect(client.get.mock.calls[2]?.[0]).toBe('/apps/specter-arena/api/roster?limit=200');
  });

  it('does not retry on v1 after an expired session', async () => {
    client.get.mockRejectedValueOnce(new HostApiError(403, null));
    const { result } = renderHook(() => useRoster());
    await flush();
    await flush();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'failed', data: null, failure: 'expired' });
  });

  it('reports the v1 failure when both reads fail', async () => {
    client.get.mockRejectedValueOnce(new HostApiError(500, null)).mockRejectedValueOnce(new HostApiError(503, 'store_not_ready'));
    const { result } = renderHook(() => useRoster());
    await flush();
    await flush();
    expect(result.current.state).toEqual({ status: 'failed', data: null, failure: 'store-not-ready' });
  });
});

describe('failureOf', () => {
  it.each([
    [new HostApiError(403, null), 'expired'],
    [new HostApiError(401, 'unauthorized'), 'unknown'],
    [new HostApiError(503, 'store_not_ready'), 'store-not-ready'],
    [new HostApiError(503, 'store_unavailable'), 'store-unavailable'],
    [new HostApiError(503, null), 'store-unavailable'],
    [new HostApiError(500, null), 'unknown'],
    [new TypeError('Failed to fetch'), 'offline'],
    ['text', 'offline'],
  ])('maps %s to %s', (error, kind) => {
    expect(failureOf(error)).toBe(kind);
  });
});
