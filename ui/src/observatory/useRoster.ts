import { useCallback } from 'react';
import type { RosterCollectorV1, RosterItemV1, RosterNoteV1, RosterV1 } from '../contracts/types';
import { HostApiError, rosterPath, useHostApi } from '../host';
import { sortRoster } from './model';
import { usePolled } from './usePolled';

const PAGE_LIMIT = 200;
export const MAX_ROSTER_PAGES = 10;

export type FailureKind = 'offline' | 'expired' | 'store-not-ready' | 'store-unavailable' | 'unknown';

export interface RosterData {
  items: RosterItemV1[];
  collector: RosterCollectorV1;
  notes: RosterNoteV1[];
  rosterRevision: number;
  truncated: boolean;
  complete: boolean;
  fetchedAtMs: number;
}

export type RosterState =
  | { status: 'loading'; data: null; failure: null }
  | { status: 'ready'; data: RosterData; failure: FailureKind | null }
  | { status: 'failed'; data: null; failure: FailureKind };

export function failureOf(error: unknown): FailureKind {
  if (error instanceof HostApiError) {
    if (error.status === 403) return 'expired';
    if (error.status === 503) return error.error === 'store_not_ready' ? 'store-not-ready' : 'store-unavailable';
    return 'unknown';
  }
  return 'offline';
}

export function useRoster(): { state: RosterState; refresh: () => void } {
  const api = useHostApi();
  const load = useCallback(async (): Promise<RosterData> => {
    const items: RosterItemV1[] = [];
    let first: RosterV1 | null = null;
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: RosterV1 = await api.getJson<RosterV1>(rosterPath(PAGE_LIMIT, cursor));
      first ??= page;
      items.push(...page.items);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < MAX_ROSTER_PAGES);
    const truncated = cursor !== null;
    return {
      items: sortRoster(items),
      collector: first.collector,
      notes: first.notes,
      rosterRevision: first.rosterRevision,
      truncated,
      complete: !truncated,
      fetchedAtMs: Date.now(),
    };
  }, [api]);

  const polled = usePolled(load, 'roster');
  const failure = polled.error === null ? null : failureOf(polled.error);
  let state: RosterState;
  if (polled.data !== null) state = { status: 'ready', data: polled.data, failure };
  else if (failure !== null) state = { status: 'failed', data: null, failure };
  else state = { status: 'loading', data: null, failure: null };
  return { state, refresh: polled.refresh };
}
