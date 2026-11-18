import { useCallback } from 'react';
import type { WorkItemV1 } from '../contracts/types';
import { HostApiError, useHostApi, workListPath } from '../host';
import { usePolled } from '../observatory/usePolled';
import { ShapeError, parseWorkItems } from '../work/model';

export const STREAM_PAGES = 8;
export const PAGE_SIZE = 25;
const FIELD_STATES = ['open', 'awaiting-review', 'blocked', 'reopened'] as const;

export interface ArenaWorkSnapshot {
  items: WorkItemV1[];
  /** The largest `asOfMs` any page reported. The scene clock; never the browser clock. */
  asOfMs: number;
  /** A stream still had a cursor after the page cap, so counts are a minimum. */
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
 * The arena's only poll of its own: four on-field streams read up to STREAM_PAGES pages each, plus one page of
 * accepted items. Any failing read fails the whole poll, so a snapshot never mixes ages; `usePolled` keeps the
 * last good snapshot and `failure` says it is stale. Every request is a GET.
 */
export function useArenaWork(): { state: ArenaWorkState; refresh: () => void } {
  const api = useHostApi();
  const load = useCallback(async (): Promise<ArenaWorkSnapshot> => {
    let asOfMs = 0;
    let truncated = false;
    const readStream = async (state: string, pages: number): Promise<WorkItemV1[]> => {
      const out: WorkItemV1[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < pages; page += 1) {
        const body = parseWorkItems(await api.getJson<unknown>(workListPath(state, PAGE_SIZE, cursor)));
        out.push(...body.items);
        asOfMs = Math.max(asOfMs, body.asOfMs);
        cursor = body.nextCursor;
        if (cursor === null) return out;
      }
      if (state !== 'accepted') truncated = true;
      return out;
    };
    const streams = await Promise.all([...FIELD_STATES.map((state) => readStream(state, STREAM_PAGES)), readStream('accepted', 1)]);
    const newest = new Map<string, WorkItemV1>();
    for (const item of streams.flat()) {
      const known = newest.get(item.workId);
      if (known === undefined || known.version < item.version) newest.set(item.workId, item);
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
