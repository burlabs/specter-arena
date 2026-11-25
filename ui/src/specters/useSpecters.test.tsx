import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecterV3 } from '../contracts/types';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { heroOf, portraitOf } from './testData';
import { errorCodeOf, failureOf, parseSpecters, useSpecters } from './useSpecters';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));

vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const specter = (n: number, version = 1, displayName = `Spec ${n}`): SpecterV3 =>
  heroOf({ bindingId: `bnd_${n}`, version, displayName, avatarChosen: version > 0, portrait: portraitOf(`ast_${String(n).padStart(24, '0')}`) });

const list = (...items: SpecterV3[]) => ({ contractVersion: 3, items, unassignedBindingIds: [] as string[] });
const withUnassigned = (items: SpecterV3[], ...ids: string[]) => ({ contractVersion: 3, items, unassignedBindingIds: ids });
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
  api.postJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('parseSpecters', () => {
  it('accepts a valid list with its unassigned ids and rejects anything else', () => {
    expect(parseSpecters(withUnassigned([specter(1)], 'bnd_9'))).toEqual({ items: [specter(1)], unassigned: ['bnd_9'] });
    const valid = specter(1);
    for (const body of [
      null,
      {},
      { contractVersion: 3, items: 'x', unassignedBindingIds: [] },
      { contractVersion: 3, items: [{}], unassignedBindingIds: [] },
      { contractVersion: 3, items: [{ ...valid, portrait: null }], unassignedBindingIds: [] },
      { contractVersion: 3, items: [{ ...valid, avatarChosen: 'yes' }], unassignedBindingIds: [] },
      { contractVersion: 3, items: [{ ...valid, assignedBy: 'someone' }], unassignedBindingIds: [] },
      { contractVersion: 3, items: [{ ...valid, assignedBy: undefined }], unassignedBindingIds: [] },
      { contractVersion: 3, items: [{ ...valid, contractVersion: 2 }], unassignedBindingIds: [] },
      { contractVersion: 3, items: [valid] },
      { contractVersion: 3, items: [valid], unassignedBindingIds: 'bnd_1' },
      { contractVersion: 3, items: [valid], unassignedBindingIds: [7] },
      { contractVersion: 3, items: [valid], unassignedBindingIds: ['bnd_1'] },
    ]) {
      expect(() => parseSpecters(body)).toThrow('unexpected specters body');
    }
    expect(() => parseSpecters({ contractVersion: 3, items: Array.from({ length: 501 }, (_, n) => specter(n)), unassignedBindingIds: [] })).toThrow();
    expect(() => parseSpecters({ contractVersion: 3, items: [], unassignedBindingIds: Array.from({ length: 501 }, (_, n) => `bnd_${n}`) })).toThrow();
  });

  it('rejects a v2 body and a newer major as unexpected', () => {
    expect(() => parseSpecters({ contractVersion: 2, items: [specter(1)] })).toThrow('unexpected specters body');
    expect(() => parseSpecters({ contractVersion: 4, items: [specter(1)], unassignedBindingIds: [] })).toThrow('unexpected specters body');
  });

  it('accepts a hero id it does not know (a newer roster)', () => {
    expect(parseSpecters(list({ ...specter(1), heroId: 'newcomer' as never })).items).toHaveLength(1);
  });

  it('classifies failures', () => {
    expect(failureOf(new HostApiError(404, null))).toBe('unsupported');
    expect(failureOf(new HostApiError(503, 'store_not_ready'))).toBe('unavailable');
    expect(failureOf(new TypeError('Failed to fetch'))).toBe('offline');
    expect(() => parseSpecters(null)).toThrow();
    expect(errorCodeOf(new HostApiError(503, 'store_unavailable'))).toBe('store_unavailable');
    expect(errorCodeOf(new HostApiError(502, null))).toBe('http_502');
    expect(errorCodeOf(new TypeError('x'))).toBe('offline');
    try {
      parseSpecters(null);
    } catch (error) {
      expect(errorCodeOf(error)).toBe('invalid_response');
    }
  });
});

describe('useSpecters', () => {
  it('reads the assignment view and keys the Specters by binding, with the unassigned ids beside them', async () => {
    api.getJson.mockResolvedValue(withUnassigned([specter(1), specter(2)], 'bnd_3', 'bnd_4'));
    const { result } = renderHook(() => useSpecters());
    expect(result.current.status).toBe('loading');
    await flush();
    expect(api.getJson).toHaveBeenCalledWith('/apps/specter-arena/api/specters?view=assignment');
    expect(result.current.status).toBe('ready');
    expect([...result.current.byBinding.keys()]).toEqual(['bnd_1', 'bnd_2']);
    expect(result.current.byBinding.get('bnd_1')?.contractVersion).toBe(3);
    expect(result.current.unassigned).toEqual(['bnd_3', 'bnd_4']);
    expect(result.current.failure).toBeNull();
  });

  it('turns a body of the wrong shape into an empty map and an unexpected failure', async () => {
    api.getJson.mockResolvedValue({ ok: true, source: 'canned' });
    const { result } = renderHook(() => useSpecters());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unexpected', unassigned: [] });
    expect(result.current.byBinding.size).toBe(0);
  });

  it('names an old backend (404) as unsupported', async () => {
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const { result } = renderHook(() => useSpecters());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unsupported' });
  });

  it('keeps the last good list under a failure flag when a later poll breaks', async () => {
    api.getJson.mockResolvedValueOnce(withUnassigned([specter(1)], 'bnd_2')).mockRejectedValueOnce(new TypeError('down'));
    const { result } = renderHook(() => useSpecters());
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current).toMatchObject({ status: 'ready', failure: 'offline' });
    expect(result.current.byBinding.size).toBe(1);
    expect(result.current.unassigned).toEqual(['bnd_2']);
  });

  it('lets an applied action response win until the poll reaches its version, then drops the override', async () => {
    api.getJson.mockResolvedValue(list(specter(1, 1, 'Old')));
    const { result } = renderHook(() => useSpecters());
    await flush();
    act(() => result.current.apply(specter(1, 2, 'New')));
    expect(result.current.byBinding.get('bnd_1')?.displayName).toBe('New');
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.byBinding.get('bnd_1')?.displayName).toBe('New');
    api.getJson.mockResolvedValue(list(specter(1, 3, 'Newest')));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.byBinding.get('bnd_1')?.displayName).toBe('Newest');
  });

  it('keeps the way a hero was assigned when the avatar route answers with a v2 body', async () => {
    api.getJson.mockResolvedValue(list({ ...specter(1, 0), assignedBy: 'picked' }));
    const { result } = renderHook(() => useSpecters());
    await flush();
    const { contractVersion: _kept, assignedBy: _dropped, ...v2 } = specter(1, 1, 'Changed');
    act(() => result.current.apply({ ...v2, contractVersion: 2 }));
    expect(result.current.byBinding.get('bnd_1')).toMatchObject({ contractVersion: 3, assignedBy: 'picked', displayName: 'Changed' });
  });

  it('adds a Specter the poll does not list yet, and takes it off the unassigned list', async () => {
    api.getJson.mockResolvedValue(withUnassigned([], 'bnd_5', 'bnd_6'));
    const { result } = renderHook(() => useSpecters());
    await flush();
    act(() => result.current.apply(specter(5, 0)));
    expect(result.current.byBinding.has('bnd_5')).toBe(true);
    expect(result.current.byBinding.get('bnd_5')?.assignedBy).toBe('auto');
    expect(result.current.unassigned).toEqual(['bnd_6']);
  });

  it('refreshes on demand', async () => {
    api.getJson.mockResolvedValue(list());
    const { result } = renderHook(() => useSpecters());
    await flush();
    act(() => result.current.refresh());
    expect(api.getJson).toHaveBeenCalledTimes(2);
  });
});

describe('assign', () => {
  const picked = (n: number): SpecterV3 => ({ ...specter(n, 0), heroId: 'tide', assignedBy: 'picked' });

  async function ready(...ids: string[]) {
    api.getJson.mockResolvedValue(withUnassigned([], ...ids));
    const view = renderHook(() => useSpecters());
    await flush();
    return view;
  }

  it('posts expectedVersion 0 with the hero, shows the result at once and takes the bot off the unassigned list', async () => {
    const { result } = await ready('bnd_1', 'bnd_2');
    api.postJson.mockResolvedValue(picked(1));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.assign('bnd_1', 'tide');
    });
    expect(outcome).toEqual({ kind: 'assigned' });
    expect(api.postJson).toHaveBeenCalledWith('/apps/specter-arena/api/specters/bnd_1/hero', { expectedVersion: 0, heroId: 'tide' });
    expect(result.current.byBinding.get('bnd_1')?.assignedBy).toBe('picked');
    expect(result.current.unassigned).toEqual(['bnd_2']);
  });

  it('asks for a random hero with a null hero id', async () => {
    const { result } = await ready('bnd_1');
    api.postJson.mockResolvedValue({ ...picked(1), assignedBy: 'random' });
    await act(async () => void (await result.current.assign('bnd_1', null)));
    expect(api.postJson).toHaveBeenCalledWith(expect.any(String), { expectedVersion: 0, heroId: null });
    expect(result.current.byBinding.get('bnd_1')?.assignedBy).toBe('random');
  });

  it('keeps a poll that has not listed the bot yet from undoing the write', async () => {
    const { result } = await ready('bnd_1');
    api.postJson.mockResolvedValue(picked(1));
    await act(async () => void (await result.current.assign('bnd_1', 'tide')));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.byBinding.has('bnd_1')).toBe(true);
    expect(result.current.unassigned).toEqual([]);
    api.getJson.mockResolvedValue(list(picked(1)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.byBinding.get('bnd_1')?.heroId).toBe('tide');
  });

  it('reloads on a 409 and says the bot already had a hero', async () => {
    const { result } = await ready('bnd_1');
    api.postJson.mockRejectedValue(new HostApiError(409, 'version_conflict'));
    api.getJson.mockResolvedValue(list(picked(1)));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.assign('bnd_1', 'vell');
    });
    expect(outcome).toEqual({ kind: 'already' });
    await flush();
    expect(result.current.byBinding.get('bnd_1')?.heroId).toBe('tide');
    expect(result.current.unassigned).toEqual([]);
  });

  it('reports the error code of any other failure and changes nothing', async () => {
    const { result } = await ready('bnd_1');
    for (const [error, code] of [
      [new HostApiError(503, 'store_unavailable'), 'store_unavailable'],
      [new HostApiError(404, 'unknown_binding'), 'unknown_binding'],
      [new TypeError('Failed to fetch'), 'offline'],
    ] as const) {
      api.postJson.mockRejectedValueOnce(error);
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.assign('bnd_1', 'vell');
      });
      expect(outcome).toEqual({ kind: 'failed', code });
    }
    expect(result.current.unassigned).toEqual(['bnd_1']);
  });

  it('refuses an answer that is not a specter.v3 body', async () => {
    const { result } = await ready('bnd_1');
    api.postJson.mockResolvedValue({ contractVersion: 2 });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.assign('bnd_1', 'vell');
    });
    expect(outcome).toEqual({ kind: 'failed', code: 'invalid_response' });
    expect(result.current.byBinding.size).toBe(0);
  });
});
