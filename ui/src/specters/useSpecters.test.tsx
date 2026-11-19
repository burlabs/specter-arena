import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecterV2 } from '../contracts/types';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { heroOf, portraitOf } from './testData';
import { failureOf, parseSpecters, useSpecters } from './useSpecters';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));

vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const specter = (n: number, version = 1, displayName = `Spec ${n}`): SpecterV2 =>
  heroOf({ bindingId: `bnd_${n}`, version, displayName, avatarChosen: version > 0, portrait: portraitOf(`ast_${String(n).padStart(24, '0')}`) });

const list = (...items: SpecterV2[]) => ({ contractVersion: 2, items });
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('parseSpecters', () => {
  it('accepts a valid list and rejects anything else', () => {
    expect(parseSpecters(list(specter(1)))).toHaveLength(1);
    for (const body of [null, {}, { contractVersion: 2, items: 'x' }, { contractVersion: 2, items: [{}] }, { contractVersion: 2, items: [{ ...specter(1), portrait: null }] }, { contractVersion: 2, items: [{ ...specter(1), avatarChosen: 'yes' }] }]) {
      expect(() => parseSpecters(body)).toThrow('unexpected specters body');
    }
    expect(() => parseSpecters({ contractVersion: 2, items: Array.from({ length: 501 }, (_, n) => specter(n)) })).toThrow();
  });

  it('rejects a v1 body and a newer major as unexpected', () => {
    expect(() => parseSpecters({ contractVersion: 1, items: [specter(1)] })).toThrow('unexpected specters body');
    expect(() => parseSpecters({ contractVersion: 3, items: [specter(1)] })).toThrow('unexpected specters body');
  });

  it('accepts a hero id it does not know (a newer roster)', () => {
    expect(parseSpecters(list({ ...specter(1), heroId: 'newcomer' as never }))).toHaveLength(1);
  });

  it('classifies failures', () => {
    expect(failureOf(new HostApiError(404, null))).toBe('unsupported');
    expect(failureOf(new HostApiError(503, 'store_not_ready'))).toBe('unavailable');
    expect(failureOf(new TypeError('Failed to fetch'))).toBe('offline');
    expect(() => parseSpecters(null)).toThrow();
  });
});

describe('useSpecters', () => {
  it('loads a valid list keyed by binding', async () => {
    api.getJson.mockResolvedValue(list(specter(1), specter(2)));
    const { result } = renderHook(() => useSpecters());
    expect(result.current.status).toBe('loading');
    await flush();
    expect(result.current.status).toBe('ready');
    expect([...result.current.byBinding.keys()]).toEqual(['bnd_1', 'bnd_2']);
    expect(result.current.failure).toBeNull();
  });

  it('turns a body of the wrong shape into an empty map and an unexpected failure', async () => {
    api.getJson.mockResolvedValue({ ok: true, source: 'canned' });
    const { result } = renderHook(() => useSpecters());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unexpected' });
    expect(result.current.byBinding.size).toBe(0);
  });

  it('names an old backend (404) as unsupported', async () => {
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const { result } = renderHook(() => useSpecters());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unsupported' });
  });

  it('keeps the last good list under a failure flag when a later poll breaks', async () => {
    api.getJson.mockResolvedValueOnce(list(specter(1))).mockRejectedValueOnce(new TypeError('down'));
    const { result } = renderHook(() => useSpecters());
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current).toMatchObject({ status: 'ready', failure: 'offline' });
    expect(result.current.byBinding.size).toBe(1);
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
    api.getJson.mockResolvedValue(list(specter(1, 3, 'Newest')));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
  });

  it('adds a Specter the poll does not list yet', async () => {
    api.getJson.mockResolvedValue(list());
    const { result } = renderHook(() => useSpecters());
    await flush();
    act(() => result.current.apply(specter(5)));
    expect(result.current.byBinding.has('bnd_5')).toBe(true);
  });

  it('refreshes on demand', async () => {
    api.getJson.mockResolvedValue(list());
    const { result } = renderHook(() => useSpecters());
    await flush();
    act(() => result.current.refresh());
    expect(api.getJson).toHaveBeenCalledTimes(2);
  });
});
