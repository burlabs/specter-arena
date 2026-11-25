import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { botOf, taskOf } from './testData';
import { useTaskEvidence } from './useTaskEvidence';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const nextPoll = () => act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
const task = taskOf(1, botOf(1));
const ID = task.taskId;

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useTaskEvidence', () => {
  it('is idle without an id and makes no request', async () => {
    const { result } = renderHook(() => useTaskEvidence(null));
    await flush();
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('loads one task from its own route with a GET, then is ready', async () => {
    api.getJson.mockResolvedValue(task);
    const { result } = renderHook(() => useTaskEvidence(ID));
    expect(result.current.state.status).toBe('loading');
    await flush();
    expect(result.current.state).toEqual({ status: 'ready', item: task });
    expect(api.getJson).toHaveBeenCalledWith(`/apps/specter-arena/api/tasks/${ID}`);
    expect(api.postJson).not.toHaveBeenCalled();
  });

  it('clears the task the moment the next read says it is gone', async () => {
    api.getJson.mockResolvedValueOnce(task).mockRejectedValue(new HostApiError(404, 'unknown_task'));
    const { result } = renderHook(() => useTaskEvidence(ID));
    await flush();
    expect(result.current.state.status).toBe('ready');
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'gone' });
  });

  it('clears the task on a 403 and says forbidden', async () => {
    api.getJson.mockResolvedValueOnce(task).mockRejectedValue(new HostApiError(403, null));
    const { result } = renderHook(() => useTaskEvidence(ID));
    await flush();
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'forbidden' });
  });

  it('clears the task on a network failure, and shows it again when a later read succeeds', async () => {
    const later = { ...task, updatedAtMs: task.updatedAtMs + 1 };
    api.getJson.mockResolvedValueOnce(task).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(later);
    const { result } = renderHook(() => useTaskEvidence(ID));
    await flush();
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'failed', failure: 'offline' });
    await nextPoll();
    expect(result.current.state).toEqual({ status: 'ready', item: later });
  });

  it('treats an unnamed 404 as gone and a malformed body as unexpected', async () => {
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const old = renderHook(() => useTaskEvidence(ID));
    await flush();
    expect(old.result.current.state).toEqual({ status: 'gone' });
    api.getJson.mockReset().mockResolvedValue({ nope: true });
    const odd = renderHook(() => useTaskEvidence(taskOf(2, botOf(1)).taskId));
    await flush();
    expect(odd.result.current.state).toEqual({ status: 'failed', failure: 'unexpected' });
  });

  it('refuses a task whose size class disagrees with its run time', async () => {
    api.getJson.mockResolvedValue({ ...task, sizeClass: 'small' });
    const { result } = renderHook(() => useTaskEvidence(ID));
    await flush();
    expect(result.current.state).toEqual({ status: 'failed', failure: 'unexpected' });
  });
});
