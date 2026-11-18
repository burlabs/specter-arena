import { useCallback } from 'react';
import type { XpEntryV1, XpHistoryV1, XpSummaryV1 } from '../contracts/types';
import { HostApiError, useHostApi, xpHistoryPath } from '../host';
import { parseXpHistory } from './model';
import { usePagedPolled } from './usePagedPolled';
import { xpFailureOf } from './useXp';
import type { XpFailure } from './useXp';

export type XpHistoryStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'gone';

export interface XpHistoryState {
  status: XpHistoryStatus;
  summary: XpSummaryV1 | null;
  entries: XpEntryV1[];
  hasOlder: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  failure: XpFailure | null;
  loadOlder: () => void;
  refresh: () => void;
}

const newestFirst = (a: XpEntryV1, b: XpEntryV1): number => b.createdAtMs - a.createdAtMs || (a.entryId < b.entryId ? 1 : a.entryId > b.entryId ? -1 : 0);

export function useXpHistory(bindingId: string | null): XpHistoryState {
  const api = useHostApi();
  const fetchPage = useCallback(
    async (cursor: string | null) => parseXpHistory(await api.getJson<unknown>(xpHistoryPath(bindingId ?? '', 50, cursor))),
    [api, bindingId],
  );
  const paged = usePagedPolled<XpEntryV1, XpHistoryV1>({
    key: bindingId === null ? null : `xp:${bindingId}`,
    fetchPage,
    idOf: (entry) => entry.entryId,
    order: newestFirst,
  });
  const gone = paged.error instanceof HostApiError && paged.error.error === 'unknown_binding' && paged.firstPage === null;
  const status: XpHistoryStatus = bindingId === null ? 'idle' : gone ? 'gone' : paged.firstPage !== null ? 'ready' : paged.error !== null ? 'failed' : 'loading';
  return {
    status,
    summary: paged.firstPage?.summary ?? null,
    entries: paged.items,
    hasOlder: paged.hasOlder,
    loadingOlder: paged.loadingOlder,
    olderFailed: paged.olderFailed,
    failure: paged.error === null ? null : xpFailureOf(paged.error),
    loadOlder: paged.loadOlder,
    refresh: paged.refresh,
  };
}
