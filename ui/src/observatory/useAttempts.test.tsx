import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttemptsV1 } from '../contracts/types';
import { HostApiError } from '../host';
import { useAttempts } from './useAttempts';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => client }));
const { attemptsBody } = await vi.importActual<typeof import('@kirocrew/app-sdk')>('@kirocrew/app-sdk');

beforeEach(() => client.get.mockReset());

const flush = () =>
  act(async () => {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  });

const BOT = 'bnd_aaaaaaaaaaaaaaaaaaaa0001';
const body = (cursor: string | null): AttemptsV1 => {
  const base = attemptsBody('two-concurrent', BOT);
  if (base === null) throw new Error('fixture');
  return { ...base, nextCursor: cursor };
};
const olderPage = (): AttemptsV1 => {
  const base = body(null);
  const [first] = base.items;
  if (first === undefined) throw new Error('fixture');
  return { ...base, items: [{ ...first, attemptId: 'att_oldest', startedMs: 5 }, first] };
};

describe('useAttempts', () => {
  it('is idle with nothing selected and makes no request', () => {
    const { result } = renderHook(() => useAttempts(null));
    expect(result.current.state).toEqual({ status: 'idle' });
    act(() => result.current.loadOlder());
    expect(client.get).not.toHaveBeenCalled();
  });

  it('loads the first page and encodes the id into the path', async () => {
    client.get.mockResolvedValue(new Response(JSON.stringify(body(null))));
    const { result } = renderHook(() => useAttempts('a/b'));
    expect(result.current.state.status).toBe('loading');
    await flush();
    expect(client.get.mock.calls[0]?.[0]).toBe('/apps/specter-arena/api/roster/a%2Fb/attempts?limit=50');
    const { state } = result.current;
    expect(state.status === 'ready' && [state.items.length, state.hasOlder, state.failure]).toEqual([3, false, null]);
  });

  it('pages older attempts with the cursor and merges them without duplicates', async () => {
    client.get.mockResolvedValueOnce(new Response(JSON.stringify(body('c1')))).mockResolvedValueOnce(new Response(JSON.stringify(olderPage())));
    const { result } = renderHook(() => useAttempts(BOT));
    await flush();
    expect(result.current.state.status === 'ready' && result.current.state.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    await flush();
    expect(client.get.mock.calls[1]?.[0]).toBe(`/apps/specter-arena/api/roster/${BOT}/attempts?limit=50&cursor=c1`);
    const { state } = result.current;
    expect(state.status === 'ready' && state.items.map((item) => item.attemptId)).toEqual([
      'att_cccccccccccccccc00010001',
      'att_cccccccccccccccc00010002',
      'att_cccccccccccccccc00010003',
      'att_oldest',
    ]);
    expect(state.status === 'ready' && state.hasOlder).toBe(false);
  });

  it('reports a failed older page and lets the next try succeed', async () => {
    client.get.mockResolvedValueOnce(new Response(JSON.stringify(body('c1')))).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useAttempts(BOT));
    await flush();
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.state.status === 'ready' && result.current.state.olderFailed).toBe(true);
    client.get.mockResolvedValueOnce(new Response(JSON.stringify(olderPage())));
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.state.status === 'ready' && result.current.state.olderFailed).toBe(false);
  });

  it('ignores loadOlder while a page is already loading', async () => {
    let release: (value: Response) => void = () => undefined;
    client.get.mockResolvedValueOnce(new Response(JSON.stringify(body('c1')))).mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
    const { result } = renderHook(() => useAttempts(BOT));
    await flush();
    act(() => result.current.loadOlder());
    act(() => result.current.loadOlder());
    expect(client.get).toHaveBeenCalledTimes(2);
    await act(async () => release(new Response(JSON.stringify(olderPage()))));
  });

  it('treats any 404 as gone', async () => {
    client.get.mockResolvedValue(new Response('', { status: 404 }));
    const { result } = renderHook(() => useAttempts(BOT));
    await flush();
    expect(result.current.state).toEqual({ status: 'gone' });
  });

  it('reports a first-load failure, then keeps the last page under a failure flag', async () => {
    client.get.mockImplementationOnce(() => Promise.reject(new HostApiError(503, 'store_not_ready')));
    const { result } = renderHook(() => useAttempts(BOT));
    await flush();
    expect(result.current.state).toEqual({ status: 'failed', failure: 'store-not-ready' });
    client.get.mockResolvedValueOnce(new Response(JSON.stringify(body(null))));
    act(() => result.current.refresh());
    await flush();
    client.get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => result.current.refresh());
    await flush();
    expect(result.current.state.status === 'ready' && result.current.state.failure).toBe('offline');
  });

  it('drops older pages and data when the selection changes', async () => {
    client.get.mockResolvedValueOnce(new Response(JSON.stringify(body('c1')))).mockResolvedValueOnce(new Response(JSON.stringify(olderPage())));
    const { result, rerender } = renderHook(({ id }) => useAttempts(id), { initialProps: { id: BOT as string | null } });
    await flush();
    act(() => result.current.loadOlder());
    await flush();
    client.get.mockResolvedValue(new Response(JSON.stringify({ ...body(null), bindingId: 'bnd_other' })));
    rerender({ id: 'bnd_other' });
    expect(result.current.state.status).toBe('loading');
    await flush();
    expect(result.current.state.status === 'ready' && result.current.state.items).toHaveLength(3);
  });
});
