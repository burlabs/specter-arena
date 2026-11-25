import { useAppApi } from '@kirocrew/app-sdk';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recapPath } from '../host';
import { periodOf } from './recapPeriods';
import { recapOf, rosterOf, runOf } from './recapTestData';
import { useRecap } from './useRecap';
import type { RecapKind } from './recapPeriods';

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};
const NOW = Date.UTC(2026, 10, 25, 15, 30);
const [bot] = rosterOf(1) as [ReturnType<typeof rosterOf>[number]];
const body = recapOf([runOf(1, bot, 5, 20)], 60);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const answer = (response: Response | Error) => vi.spyOn(useAppApi(), 'get').mockImplementation(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone())));

describe('useRecap', () => {
  it('reads the period of the chosen kind once, with a GET, and never polls', async () => {
    const get = answer(new Response(JSON.stringify(body)));
    const post = vi.spyOn(useAppApi(), 'post');
    const { result } = renderHook(() => useRecap('today'));
    expect(result.current.state.status).toBe('loading');
    await flush();
    expect(result.current.state).toMatchObject({ status: 'ready', kind: 'today', failure: null });
    expect(result.current.state.recap).toEqual(body);
    const period = periodOf('today', NOW);
    expect(get.mock.calls).toEqual([[recapPath(period.fromMs, period.toMs)]]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(120_000)));
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it.each<[RecapKind]>([['yesterday'], ['week']])('asks for the %s period', async (kind) => {
    const get = answer(new Response(JSON.stringify(body)));
    renderHook(() => useRecap(kind));
    await flush();
    const period = periodOf(kind, NOW);
    expect(get).toHaveBeenCalledWith(recapPath(period.fromMs, period.toMs));
  });

  it('reads again when the kind changes, and shows loading rather than the old recap in between', async () => {
    const get = answer(new Response(JSON.stringify(body)));
    const { result, rerender } = renderHook(({ kind }: { kind: RecapKind }) => useRecap(kind), { initialProps: { kind: 'today' as RecapKind } });
    await flush();
    rerender({ kind: 'week' });
    expect(result.current.state).toMatchObject({ status: 'loading', kind: 'week', recap: null });
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({ status: 'ready', kind: 'week' });
  });

  it('reads again on refresh', async () => {
    const get = answer(new Response(JSON.stringify(body)));
    const { result } = renderHook(() => useRecap('today'));
    await flush();
    await act(async () => result.current.refresh());
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unsupported', new Response('{}', { status: 404 })],
    ['forbidden', new Response('{}', { status: 403 })],
    ['unavailable', new Response('{}', { status: 500 })],
    ['unexpected', new Response(JSON.stringify({ nope: true }))],
    ['unexpected', new Response(JSON.stringify({ ...body, taskCap: 5 }))],
    ['offline', new TypeError('Failed to fetch')],
  ])('is failed with %s and plays no partial recap', async (failure, response) => {
    answer(response);
    const { result } = renderHook(() => useRecap('today'));
    await flush();
    expect(result.current.state).toMatchObject({ status: 'failed', failure, recap: null });
  });

  it('ignores an answer that arrives after the view moved on', async () => {
    let release: (response: Response) => void = () => undefined;
    vi.spyOn(useAppApi(), 'get').mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    const { result, unmount } = renderHook(() => useRecap('today'));
    unmount();
    release(new Response(JSON.stringify(body)));
    await flush();
    expect(result.current.state.status).toBe('loading');
  });
});
