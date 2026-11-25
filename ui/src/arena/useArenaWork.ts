import { useCallback } from 'react';
import type { TaskItemV1 } from '../contracts/types';
import { HostApiError, tasksPath, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';
import { parseTasksPage } from '../tasks/model';
import { ShapeError } from '../work/model';

export const STREAM_PAGES = 8;
export const PAGE_SIZE = 25;

export interface ArenaWorkSnapshot {
  /** Open tasks, then the latest credited and not-credited pages, each task once. The inspector reads one task through `useTaskEvidence`. */
  items: TaskItemV1[];
  /** The largest `asOfMs` any page reported. The scene clock; never the browser clock. */
  asOfMs: number;
  /** The open-task stream still had a cursor after the page cap, so counts are a minimum. */
  truncated: boolean;
  receivedAtMs: number;
}

export type ArenaWorkFailure = 'unsupported' | 'forbidden' | 'offline' | 'unavailable' | 'unexpected';

export type ArenaWorkState =
  | { status: 'loading'; snapshot: null; failure: null }
  | { status: 'ready'; snapshot: ArenaWorkSnapshot; failure: ArenaWorkFailure | null }
  | { status: 'failed'; snapshot: null; failure: ArenaWorkFailure };

export function arenaFailureOf(error: unknown): ArenaWorkFailure {
  if (error instanceof ShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : error.status === 403 ? 'forbidden' : 'unavailable';
  return 'offline';
}

/**
 * The arena's only poll of its own: the open-task stream read up to STREAM_PAGES pages, plus one page each of the
 * latest credited and not-credited tasks. Every stream reads `GET /api/tasks` newest update first, so when the page cap
 * drops anything, it drops the stalest. Any failing read fails the whole poll, so a snapshot never mixes ages;
 * `usePolled` keeps the last good snapshot and `failure` says it is stale. Every request is a GET.
 */
export function useArenaWork(): { state: ArenaWorkState; refresh: () => void } {
  const api = useHostApi();
  const load = useCallback(async (): Promise<ArenaWorkSnapshot> => {
    let asOfMs = 0;
    let truncated = false;
    const readStream = async (state: 'open' | 'credited' | 'not-credited', pages: number): Promise<TaskItemV1[]> => {
      const out: TaskItemV1[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < pages; page += 1) {
        const body = parseTasksPage(await api.getJson<unknown>(tasksPath({ state, limit: PAGE_SIZE, cursor })));
        out.push(...body.items);
        asOfMs = Math.max(asOfMs, body.asOfMs);
        cursor = body.nextCursor;
        if (cursor === null) return out;
      }
      if (state === 'open') truncated = true;
      return out;
    };
    const streams = await Promise.all([readStream('open', STREAM_PAGES), readStream('credited', 1), readStream('not-credited', 1)]);
    const newest = new Map<string, TaskItemV1>();
    for (const item of streams.flat()) {
      const known = newest.get(item.taskId);
      if (known === undefined || known.updatedAtMs < item.updatedAtMs) newest.set(item.taskId, item);
    }
    return { items: [...newest.values()], asOfMs, truncated, receivedAtMs: Date.now() };
  }, [api]);
  const polled = usePolled(load, 'arena-work');
  const failure = polled.error === null ? null : arenaFailureOf(polled.error);
  const state: ArenaWorkState =
    polled.data !== null
      ? { status: 'ready', snapshot: polled.data, failure }
      : failure !== null
        ? { status: 'failed', snapshot: null, failure }
        : { status: 'loading', snapshot: null, failure: null };
  return { state, refresh: polled.refresh };
}
