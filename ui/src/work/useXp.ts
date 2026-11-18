import { useCallback, useMemo } from 'react';
import type { XpSummaryV1 } from '../contracts/types';
import { HostApiError, XP_PATH, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';
import { ShapeError, parseXpSummaries } from './model';

export type XpFailure = 'unsupported' | 'offline' | 'unavailable' | 'unexpected';

export interface XpState {
  status: 'loading' | 'ready' | 'failed';
  byBinding: ReadonlyMap<string, XpSummaryV1>;
  failure: XpFailure | null;
  refresh: () => void;
}

/** What one bot's summary card shows. `summary: null` with status ready means the ledger has no entry for this bot. */
export type XpView = { status: 'loading' } | { status: 'failed'; failure: XpFailure } | { status: 'ready'; summary: XpSummaryV1 | null };

export function xpFailureOf(error: unknown): XpFailure {
  if (error instanceof ShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : 'unavailable';
  return 'offline';
}

export function useXp(): XpState {
  const api = useHostApi();
  const load = useCallback(async () => parseXpSummaries(await api.getJson<unknown>(XP_PATH)), [api]);
  const polled = usePolled(load, 'xp');
  const byBinding = useMemo(() => new Map((polled.data?.items ?? []).map((item) => [item.bindingId, item])), [polled.data]);
  const failure = polled.error === null ? null : xpFailureOf(polled.error);
  const status = polled.data !== null ? 'ready' : failure !== null ? 'failed' : 'loading';
  return { status, byBinding, failure, refresh: polled.refresh };
}

export function xpViewOf(xp: XpState, bindingId: string): XpView {
  if (xp.status === 'loading') return { status: 'loading' };
  if (xp.status === 'failed') return { status: 'failed', failure: xp.failure ?? 'unavailable' };
  return { status: 'ready', summary: xp.byBinding.get(bindingId) ?? null };
}
