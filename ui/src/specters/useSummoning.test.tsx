import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { readResume, writeResume } from './model';
import { BINDING, REQUEST, profile, specterOf, summoningOf } from './testData';
import { MAX_POLL_FAILURES, SUMMONING_GIVE_UP_MS, SUMMONING_POLL_MS, useSummoning } from './useSummoning';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));

vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
}

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
  api.postJson.mockReset();
  window.sessionStorage.clear();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const tickPoll = () => act(async () => void (await vi.advanceTimersByTimeAsync(SUMMONING_POLL_MS)));
const input = { purpose: '', style: '', keep: [] as string[] };
const ready = summoningOf({ status: 'ready', candidate: profile('Mossgrave'), finishedAtMs: 2 });
const sentId = (): string => api.postJson.mock.calls[0]?.[1].requestId;

async function started() {
  api.postJson.mockResolvedValueOnce(summoningOf());
  const hook = renderHook(() => useSummoning(BINDING));
  await settle();
  await act(() => hook.result.current.start(input));
  return hook;
}

describe('start and poll', () => {
  it('runs queued, running, ready on the 1.5 s timer and keeps the budget', async () => {
    const { result } = await started();
    expect(result.current.state).toMatchObject({ phase: 'active', request: { status: 'queued' } });
    expect(result.current.budget?.bindingRemaining).toBe(4);
    expect(readResume(BINDING)).toBe(sentId());
    api.getJson.mockResolvedValueOnce(summoningOf({ status: 'running' }));
    await tickPoll();
    expect(result.current.state).toMatchObject({ phase: 'active', request: { status: 'running' } });
    api.getJson.mockResolvedValueOnce(ready);
    await tickPoll();
    expect(result.current.state).toMatchObject({ phase: 'done', request: { status: 'ready' } });
    expect(readResume(BINDING)).not.toBeNull();
    const calls = api.getJson.mock.calls.length;
    await tickPoll();
    expect(api.getJson.mock.calls.length).toBe(calls);
  });

  it('sends a minted request id, the trimmed text only when present, and the keep list', async () => {
    api.postJson.mockResolvedValueOnce(summoningOf());
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    await act(() => result.current.start({ purpose: '  helps with taxes ', style: '  ', keep: ['name'] }));
    const [path, body] = api.postJson.mock.calls[0] ?? [];
    expect(path).toBe(`/apps/specter-arena/api/specters/${BINDING}/summonings`);
    expect(body).toMatchObject({ purpose: 'helps with taxes', keep: ['name'] });
    expect(body).not.toHaveProperty('style');
    expect(body.requestId).toMatch(/^req_[0-9a-f]{24}$/);
  });

  it.each(['failed', 'cancelled', 'accepted', 'superseded', 'mystery'])('stops polling and clears the resume id on %s', async (status) => {
    api.postJson.mockResolvedValueOnce(summoningOf({ status: 'running' }));
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    await act(() => result.current.start(input));
    api.getJson.mockResolvedValueOnce(summoningOf({ status, error: status === 'failed' ? 'timeout' : null }));
    await tickPoll();
    expect(result.current.state).toMatchObject({ phase: 'done' });
    expect(readResume(BINDING)).toBeNull();
    expect(api.getJson).toHaveBeenCalledTimes(1);
  });

  it('ignores a start while one is active', async () => {
    const { result } = await started();
    await act(() => result.current.start(input));
    expect(api.postJson).toHaveBeenCalledTimes(1);
  });

  it('ignores start without a binding', async () => {
    const { result } = renderHook(() => useSummoning(null));
    await act(() => result.current.start(input));
    expect(api.postJson).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ phase: 'idle' });
  });

  it('shows the code of a refused start and lets a new one use a new id', async () => {
    api.postJson.mockRejectedValueOnce(new HostApiError(429, 'budget_exhausted')).mockResolvedValueOnce(summoningOf());
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    await act(() => result.current.start(input));
    expect(result.current.state).toEqual({ phase: 'error', code: 'budget_exhausted' });
    await act(() => result.current.start(input));
    expect(api.postJson.mock.calls[1]?.[1].requestId).not.toBe(sentId());
  });

  it('uses http_<status> when the error has no code', async () => {
    api.postJson.mockRejectedValueOnce(new HostApiError(500, null));
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    await act(() => result.current.start(input));
    expect(result.current.state).toEqual({ phase: 'error', code: 'http_500' });
  });

  it('reuses the same request id after a network failure of the start itself', async () => {
    api.postJson.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(summoningOf());
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    await act(() => result.current.start(input));
    expect(result.current.state).toEqual({ phase: 'error', code: 'offline' });
    await act(() => result.current.start(input));
    expect(api.postJson.mock.calls[1]?.[1].requestId).toBe(sentId());
    expect(result.current.state.phase).toBe('active');
  });

  it('clears an error back to idle', async () => {
    api.postJson.mockRejectedValueOnce(new HostApiError(409, 'generation_in_flight'));
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    await act(() => result.current.start(input));
    act(() => result.current.clearError());
    expect(result.current.state).toEqual({ phase: 'idle' });
    act(() => result.current.clearError());
    expect(result.current.state).toEqual({ phase: 'idle' });
  });
});

describe('stop conditions', () => {
  it('goes lost/unreachable after three failed polls and Check again recovers', async () => {
    const { result } = await started();
    api.getJson.mockRejectedValue(new TypeError('down'));
    for (let index = 0; index < MAX_POLL_FAILURES; index += 1) await tickPoll();
    expect(result.current.state).toMatchObject({ phase: 'lost', why: 'unreachable' });
    const calls = api.getJson.mock.calls.length;
    await tickPoll();
    expect(api.getJson.mock.calls.length).toBe(calls);
    api.getJson.mockReset();
    api.getJson.mockResolvedValueOnce(ready);
    await act(() => result.current.checkAgain());
    expect(result.current.state).toMatchObject({ phase: 'done', request: { status: 'ready' } });
  });

  it('resets the failure count after a good poll', async () => {
    const { result } = await started();
    api.getJson
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(summoningOf({ status: 'running' }))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'));
    for (let index = 0; index < 5; index += 1) await tickPoll();
    expect(result.current.state.phase).toBe('active');
  });

  it('gives up after 100 s as lost/timeout', async () => {
    const { result } = await started();
    api.getJson.mockResolvedValue(summoningOf({ status: 'running' }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(SUMMONING_GIVE_UP_MS + SUMMONING_POLL_MS * 2)));
    expect(result.current.state).toMatchObject({ phase: 'lost', why: 'timeout' });
  });

  it('pauses while hidden and polls once on becoming visible', async () => {
    const { result } = await started();
    api.getJson.mockResolvedValue(summoningOf({ status: 'running' }));
    setVisibility('hidden');
    await act(async () => void (await vi.advanceTimersByTimeAsync(SUMMONING_POLL_MS * 4)));
    expect(api.getJson).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(api.getJson).not.toHaveBeenCalled();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(api.getJson).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(api.getJson).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe('active');
  });

  it('drops a late response for another request id', async () => {
    const { result } = await started();
    api.getJson.mockResolvedValueOnce(summoningOf({ requestId: `req_${'9'.repeat(24)}`, status: 'ready', candidate: profile() }));
    await tickPoll();
    expect(result.current.state).toMatchObject({ phase: 'active', request: { status: 'queued' } });
  });

  it('stops everything on unmount', async () => {
    const { unmount } = await started();
    unmount();
    await tickPoll();
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('ignores a poll response that lands after unmount', async () => {
    const { unmount } = await started();
    let resolve: (value: unknown) => void = () => undefined;
    api.getJson.mockReturnValue(new Promise((done) => (resolve = done)));
    await tickPoll();
    unmount();
    await act(async () => resolve(ready));
  });

  it('ignores a poll failure that lands after unmount', async () => {
    const { unmount } = await started();
    let reject: (reason: unknown) => void = () => undefined;
    api.getJson.mockReturnValue(new Promise((_, fail) => (reject = fail)));
    await tickPoll();
    unmount();
    await act(async () => reject(new Error('late')));
  });
});

type Binding = string | null;
const withBinding = (id: Binding) => renderHook(({ id: current }: { id: Binding }) => useSummoning(current), { initialProps: { id } });

describe('binding changes and resume', () => {
  it('goes back to idle and forgets the budget when the binding changes', async () => {
    api.postJson.mockResolvedValueOnce(summoningOf());
    const { result, rerender } = withBinding(BINDING);
    await settle();
    await act(() => result.current.start(input));
    rerender({ id: `bnd_${'b'.repeat(24)}` });
    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(result.current.budget).toBeNull();
    await tickPoll();
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('drops a start response that arrives after the binding changed', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.postJson.mockReturnValue(new Promise((done) => (resolve = done)));
    const { result, rerender } = withBinding(BINDING);
    await settle();
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start(input);
    });
    rerender({ id: null });
    await act(async () => {
      resolve(summoningOf());
      await pending;
    });
    expect(result.current.state).toEqual({ phase: 'idle' });
  });

  it('drops a start failure that arrives after the binding changed', async () => {
    let reject: (reason: unknown) => void = () => undefined;
    api.postJson.mockReturnValue(new Promise((_, fail) => (reject = fail)));
    const { result, rerender } = withBinding(BINDING);
    await settle();
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start(input);
    });
    rerender({ id: null });
    await act(async () => {
      reject(new Error('late'));
      await pending;
    });
    expect(result.current.state).toEqual({ phase: 'idle' });
  });

  it('resumes a stored request on mount and polls it to the end', async () => {
    writeResume(BINDING, REQUEST);
    api.getJson.mockResolvedValueOnce(summoningOf({ status: 'running' })).mockResolvedValueOnce(ready);
    const { result } = renderHook(() => useSummoning(BINDING));
    expect(result.current.state).toEqual({ phase: 'starting', requestId: REQUEST });
    await settle();
    expect(result.current.state).toMatchObject({ phase: 'active' });
    await tickPoll();
    expect(result.current.state).toMatchObject({ phase: 'done', request: { status: 'ready' } });
  });

  it('shows a ready candidate straight away after a refresh', async () => {
    writeResume(BINDING, REQUEST);
    api.getJson.mockResolvedValueOnce(ready);
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    expect(result.current.state).toMatchObject({ phase: 'done', request: { status: 'ready' } });
  });

  it('forgets a stored id the server no longer knows', async () => {
    writeResume(BINDING, REQUEST);
    api.getJson.mockRejectedValueOnce(new HostApiError(404, 'unknown_request'));
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(readResume(BINDING)).toBeNull();
  });

  it('forgets a stored id that belongs to another binding', async () => {
    writeResume(BINDING, REQUEST);
    api.getJson.mockResolvedValueOnce(summoningOf({ bindingId: `bnd_${'c'.repeat(24)}` }));
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(readResume(BINDING)).toBeNull();
  });

  it('shows lost/unreachable when the resume lookup fails for another reason', async () => {
    writeResume(BINDING, REQUEST);
    api.getJson.mockRejectedValueOnce(new TypeError('down'));
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    expect(result.current.state).toEqual({ phase: 'lost', requestId: REQUEST, why: 'unreachable' });
  });

  it('ignores a resume reply that lands after unmount', async () => {
    writeResume(BINDING, REQUEST);
    let resolve: (value: unknown) => void = () => undefined;
    api.getJson.mockReturnValue(new Promise((done) => (resolve = done)));
    const { unmount } = renderHook(() => useSummoning(BINDING));
    unmount();
    await act(async () => resolve(ready));
  });

  it('ignores a resume failure that lands after unmount', async () => {
    writeResume(BINDING, REQUEST);
    let reject: (reason: unknown) => void = () => undefined;
    api.getJson.mockReturnValue(new Promise((_, fail) => (reject = fail)));
    const { unmount } = renderHook(() => useSummoning(BINDING));
    unmount();
    await act(async () => reject(new Error('late')));
  });
});

describe('check again', () => {
  async function lost() {
    writeResume(BINDING, REQUEST);
    api.getJson.mockRejectedValueOnce(new TypeError('down'));
    const hook = renderHook(() => useSummoning(BINDING));
    await settle();
    return hook;
  }

  it('does nothing unless the state is lost', async () => {
    const { result } = renderHook(() => useSummoning(BINDING));
    await act(() => result.current.checkAgain());
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('stays lost when the backend is still unreachable', async () => {
    const { result } = await lost();
    api.getJson.mockRejectedValueOnce(new TypeError('still down'));
    await act(() => result.current.checkAgain());
    expect(result.current.state).toMatchObject({ phase: 'lost', why: 'unreachable' });
  });

  it('goes idle when the server no longer knows the request', async () => {
    const { result } = await lost();
    api.getJson.mockRejectedValueOnce(new HostApiError(404, 'unknown_request'));
    await act(() => result.current.checkAgain());
    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(readResume(BINDING)).toBeNull();
  });

  it('drops the reply when the binding changed meanwhile', async () => {
    writeResume(BINDING, REQUEST);
    api.getJson.mockRejectedValueOnce(new TypeError('down'));
    const { result, rerender } = withBinding(BINDING);
    await settle();
    let resolve: (value: unknown) => void = () => undefined;
    api.getJson.mockReturnValue(new Promise((done) => (resolve = done)));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.checkAgain();
    });
    rerender({ id: null });
    await act(async () => {
      resolve(ready);
      await pending;
    });
    expect(result.current.state).toEqual({ phase: 'idle' });
  });
});

describe('cancel, accept and discard', () => {
  async function readyState() {
    writeResume(BINDING, REQUEST);
    api.getJson.mockResolvedValueOnce(ready);
    const hook = renderHook(() => useSummoning(BINDING));
    await settle();
    return hook;
  }

  it('cancels the active request through the route and shows the answer', async () => {
    const { result } = await started();
    api.postJson.mockResolvedValueOnce(summoningOf({ status: 'cancelled' }));
    await act(() => result.current.cancel());
    expect(api.postJson.mock.calls[1]?.[0]).toBe(`/apps/specter-arena/api/summonings/${REQUEST}/cancel`);
    expect(api.postJson.mock.calls[1]?.[1]).toEqual({});
    expect(result.current.state).toMatchObject({ phase: 'done', request: { status: 'cancelled' } });
  });

  it('does nothing when there is no request to cancel', async () => {
    const { result } = renderHook(() => useSummoning(BINDING));
    await settle();
    await act(() => result.current.cancel());
    expect(api.postJson).not.toHaveBeenCalled();
  });

  it('shows the code when cancel is refused', async () => {
    const { result } = await started();
    api.postJson.mockRejectedValueOnce(new HostApiError(404, 'unknown_request'));
    await act(() => result.current.cancel());
    expect(result.current.state).toEqual({ phase: 'error', code: 'unknown_request' });
  });

  it('accepts a ready candidate with the expected version and returns the Specter', async () => {
    const { result } = await readyState();
    const saved = specterOf({ version: 3 });
    api.postJson.mockResolvedValueOnce(saved);
    let returned: unknown = null;
    await act(async () => {
      returned = await result.current.accept(2);
    });
    expect(returned).toEqual(saved);
    expect(api.postJson).toHaveBeenCalledWith(`/apps/specter-arena/api/summonings/${REQUEST}/accept`, { expectedVersion: 2 });
    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(readResume(BINDING)).toBeNull();
  });

  it.each(['version_conflict', 'not_ready'])('reports %s and returns null', async (code) => {
    const { result } = await readyState();
    api.postJson.mockRejectedValueOnce(new HostApiError(409, code));
    let returned: unknown = 'unset';
    await act(async () => {
      returned = await result.current.accept(0);
    });
    expect(returned).toBeNull();
    expect(result.current.state).toEqual({ phase: 'error', code });
  });

  it('refuses to accept when nothing is ready', async () => {
    const { result } = renderHook(() => useSummoning(BINDING));
    let returned: unknown = 'unset';
    await act(async () => {
      returned = await result.current.accept(0);
    });
    expect(returned).toBeNull();
    expect(api.postJson).not.toHaveBeenCalled();
  });

  it('drops an accept answer and an accept failure that land after unmount', async () => {
    for (const settleWith of ['resolve', 'reject'] as const) {
      api.getJson.mockReset();
      api.postJson.mockReset();
      const { result, unmount } = await readyState();
      let finish: (value: unknown) => void = () => undefined;
      api.postJson.mockReturnValue(new Promise((done, fail) => (finish = settleWith === 'resolve' ? done : fail)));
      let pending: Promise<unknown> = Promise.resolve();
      act(() => {
        pending = result.current.accept(0);
      });
      unmount();
      await act(async () => {
        finish(settleWith === 'resolve' ? specterOf() : new Error('late'));
        expect(await pending).toBeNull();
      });
    }
  });

  it('discards a ready candidate locally and tells the server to cancel it', async () => {
    const { result } = await readyState();
    api.postJson.mockResolvedValueOnce(summoningOf({ status: 'cancelled' }));
    act(() => result.current.discard());
    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(readResume(BINDING)).toBeNull();
    expect(api.postJson.mock.calls[0]?.[0]).toBe(`/apps/specter-arena/api/summonings/${REQUEST}/cancel`);
  });

  it('swallows a failed server-side cancel on discard', async () => {
    const { result } = await readyState();
    api.postJson.mockRejectedValueOnce(new Error('down'));
    act(() => result.current.discard());
    await settle();
    expect(result.current.state).toEqual({ phase: 'idle' });
  });

  it('does not call the server when discarding something that is not ready', async () => {
    const { result } = renderHook(() => useSummoning(BINDING));
    act(() => result.current.discard());
    expect(api.postJson).not.toHaveBeenCalled();
  });
});
