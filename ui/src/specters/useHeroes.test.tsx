import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO_IDS } from '../contracts/types';
import { HostApiError } from '../host';
import { HERO_COUNT, heroesFailureOf, parseHeroes, useHeroes } from './useHeroes';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));

vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const hero = (index: number, extra: Record<string, unknown> = {}) => ({ heroId: HERO_IDS[index], name: `Hero ${index}`, epithet: 'e', personality: 'p', assigned: false, assignedCount: 0, ...extra });
const body = (count = HERO_COUNT, version = 1) => ({ contractVersion: version, items: Array.from({ length: count }, (_, index) => hero(index % 11)) });
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('parseHeroes', () => {
  it('accepts exactly 11 heroes', () => {
    expect(parseHeroes(body())).toHaveLength(11);
  });

  it.each([
    ['null', null],
    ['a newer major', body(11, 2)],
    ['10 heroes', body(10)],
    ['12 heroes', body(12)],
    ['a hero with no name', { contractVersion: 1, items: [{ ...hero(0), name: undefined }, ...body(10).items] }],
    ['a count below zero', { contractVersion: 1, items: [hero(0, { assignedCount: -1 }), ...body(10).items] }],
    ['a fractional count', { contractVersion: 1, items: [hero(0, { assignedCount: 1.5 }), ...body(10).items] }],
    ['assigned as text', { contractVersion: 1, items: [hero(0, { assigned: 'yes' }), ...body(10).items] }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseHeroes(value)).toThrow('unexpected heroes body');
  });

  it('classifies failures like the Specter and XP hooks', () => {
    expect(heroesFailureOf(new HostApiError(404, null))).toBe('unsupported');
    expect(heroesFailureOf(new HostApiError(503, 'store_unavailable'))).toBe('unavailable');
    expect(heroesFailureOf(new TypeError('Failed to fetch'))).toBe('offline');
    try {
      parseHeroes(null);
    } catch (error) {
      expect(heroesFailureOf(error)).toBe('unexpected');
    }
  });
});

describe('useHeroes', () => {
  it('loads the heroes', async () => {
    api.getJson.mockResolvedValue(body());
    const { result } = renderHook(() => useHeroes());
    expect(result.current.status).toBe('loading');
    await flush();
    expect(result.current).toMatchObject({ status: 'ready', failure: null });
    expect(result.current.items).toHaveLength(11);
    expect(api.getJson).toHaveBeenCalledWith('/apps/specter-arena/api/heroes');
  });

  it.each([
    [new HostApiError(404, null), 'unsupported'],
    [new TypeError('down'), 'offline'],
  ] as const)('reports %s as %s', async (error, failure) => {
    api.getJson.mockRejectedValue(error);
    const { result } = renderHook(() => useHeroes());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure, items: null });
  });

  it('turns a body of the wrong shape into an unexpected failure', async () => {
    api.getJson.mockResolvedValue({ contractVersion: 1, items: [] });
    const { result } = renderHook(() => useHeroes());
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unexpected' });
  });

  it('retries on refresh', async () => {
    api.getJson.mockRejectedValueOnce(new TypeError('down')).mockResolvedValue(body());
    const { result } = renderHook(() => useHeroes());
    await flush();
    expect(result.current.status).toBe('failed');
    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toBe('ready');
  });
});
