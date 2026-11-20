import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkItemV1, WorkItemsV2, WorkListItemV1 } from '../contracts/types';
import { useHostApi, workListPath } from '../host';
import { byCreated, listItemOf, parseWorkListPage } from './model';
import { usePagedPolled } from './usePagedPolled';
import { xpFailureOf } from './useXp';
import type { XpFailure } from './useXp';

export type WorkFailure = XpFailure;

export interface WorkListState {
  status: 'loading' | 'ready' | 'failed';
  /** The list projection with overrides applied, newest first. Detail, review and evidence come from `useWorkItem`, never from here. */
  items: WorkListItemV1[];
  byId: ReadonlyMap<string, WorkListItemV1>;
  failure: WorkFailure | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  loadOlder: () => void;
  refresh: () => void;
  /** A write response (a full item) wins over the poll, as its list projection, until the poll reaches the same version. */
  apply: (next: WorkItemV1) => void;
}

export function useWork(stateFilter: string | null): WorkListState {
  const api = useHostApi();
  const fetchPage = useCallback(
    async (cursor: string | null) => parseWorkListPage(await api.getJson<unknown>(workListPath(stateFilter, 25, cursor, 'created')), 'created'),
    [api, stateFilter],
  );
  const paged = usePagedPolled<WorkListItemV1, WorkItemsV2>({ key: `work:${stateFilter ?? 'all'}`, fetchPage, idOf: (item) => item.workId, order: byCreated });
  const [overrides, setOverrides] = useState<ReadonlyMap<string, WorkListItemV1>>(new Map());

  const first = paged.firstPage?.items ?? null;
  useEffect(() => {
    if (first === null) return;
    setOverrides((previous) => {
      const next = new Map(previous);
      for (const [id, override] of previous) {
        if ((first.find((item) => item.workId === id)?.version ?? -1) >= override.version) next.delete(id);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [first]);

  const items = useMemo(() => {
    const merged = new Map(paged.items.map((item) => [item.workId, item]));
    for (const [id, override] of overrides) {
      const current = merged.get(id);
      if (current !== undefined ? current.version < override.version : stateFilter === null || override.state === stateFilter) merged.set(id, override);
    }
    return [...merged.values()].sort(byCreated);
  }, [paged.items, overrides, stateFilter]);
  const byId = useMemo(() => new Map(items.map((item) => [item.workId, item])), [items]);

  const apply = useCallback((next: WorkItemV1) => {
    setOverrides((previous) => new Map(previous).set(next.workId, listItemOf(next)));
  }, []);

  const failure = paged.error === null ? null : xpFailureOf(paged.error);
  const status = paged.firstPage !== null ? 'ready' : failure !== null ? 'failed' : 'loading';
  return {
    status,
    items,
    byId,
    failure,
    hasOlder: paged.hasOlder,
    loadingOlder: paged.loadingOlder,
    olderFailed: paged.olderFailed,
    loadOlder: paged.loadOlder,
    refresh: paged.refresh,
    apply,
  };
}
