import { useCallback, useMemo } from 'react';
import type { XpSummaryV2 } from '../contracts/types';
import { HostApiError, useHostApi, xpPagedPath } from '../host';
import { usePolled } from '../observatory/usePolled';
import { ShapeError, parseXpSummariesPage } from './model';

export type XpFailure = 'unsupported' | 'offline' | 'unavailable' | 'unexpected';

/** 200 bindings a page (the contract maximum), so the cap is 10,000 bindings: far above any real install. */
export const XP_PAGE_SIZE = 200;
export const XP_MAX_PAGES = 50;

interface XpSnapshot {
  items: XpSummaryV2[];
  /** The cap ended the walk with a cursor left, so a bot missing from `items` may still have XP. */
  truncated: boolean;
}

export interface XpState {
  status: 'loading' | 'ready' | 'failed';
  byBinding: ReadonlyMap<string, XpSummaryV2>;
  /** Optional so a state built by hand (the Specters tests build one) means a complete walk. */
  truncated?: boolean;
  failure: XpFailure | null;
  refresh: () => void;
}

/** What one bot's summary card shows. `summary: null` with status ready means the ledger has no entry for this bot. */
export type XpView = { status: 'loading' } | { status: 'failed'; failure: XpFailure } | { status: 'ready'; summary: XpSummaryV2 | null };

export function xpFailureOf(error: unknown): XpFailure {
  if (error instanceof ShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : 'unavailable';
  return 'offline';
}

/**
 * Walks every page of `xp-summaries.v3` (one `xp-summary.v2` per bot, both ledgers) in one poll. Any failing page fails the whole poll, so the map never holds
 * a partial ledger: `usePolled` keeps the last complete one and `failure` says it is stale. A cursor that does not
 * advance is a server fault and fails the poll rather than looping.
 */
export function useXp(): XpState {
  const api = useHostApi();
  const load = useCallback(async (): Promise<XpSnapshot> => {
    const items: XpSummaryV2[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < XP_MAX_PAGES; page += 1) {
      const body = parseXpSummariesPage(await api.getJson<unknown>(xpPagedPath(XP_PAGE_SIZE, cursor)));
      items.push(...body.items);
      if (body.nextCursor === null) return { items, truncated: false };
      if (body.nextCursor === cursor) throw new ShapeError('xp cursor did not advance');
      cursor = body.nextCursor;
    }
    return { items, truncated: true };
  }, [api]);
  const polled = usePolled(load, 'xp');
  const byBinding = useMemo(() => new Map((polled.data?.items ?? []).map((item) => [item.bindingId, item])), [polled.data]);
  const failure = polled.error === null ? null : xpFailureOf(polled.error);
  const status = polled.data !== null ? 'ready' : failure !== null ? 'failed' : 'loading';
  return { status, byBinding, truncated: polled.data?.truncated ?? false, failure, refresh: polled.refresh };
}

export function xpViewOf(xp: XpState, bindingId: string): XpView {
  if (xp.status === 'loading') return { status: 'loading' };
  if (xp.status === 'failed') return { status: 'failed', failure: xp.failure ?? 'unavailable' };
  const summary = xp.byBinding.get(bindingId) ?? null;
  // After a capped walk a missing bot is unknown, not zero: show the existing could-not-load words, never "0 XP".
  if (summary === null && xp.truncated === true) return { status: 'failed', failure: 'unavailable' };
  return { status: 'ready', summary };
}
