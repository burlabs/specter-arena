import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkItemV1, WorkItemsV1 } from '../contracts/types';
import { useHostApi, workListPath } from '../host';
import { byCreated, parseWorkItems } from './model';
import { usePagedPolled } from './usePagedPolled';
import { xpFailureOf } from './useXp';
import type { XpFailure } from './useXp';

export type WorkFailure = XpFailure;

export interface WorkListState {
  status: 'loading' | 'ready' | 'failed';
  /** Overrides applied, newest first. */
  items: WorkItemV1[];
  byId: ReadonlyMap<string, WorkItemV1>;
  failure: WorkFailure | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  loadOlder: () => void;
  refresh: () => void;
  /** A write response wins over the poll until the poll reaches the same version. */
  apply: (next: WorkItemV1) => void;
}

export function useWork(stateFilter: string | null): WorkListState {
  const api = useHostApi();
  const fetchPage = useCallback(
    async (cursor: string | null) => parseWorkItems(await api.getJson<unknown>(workListPath(stateFilter, 25, cursor))),
    [api, stateFilter],
  );
  const paged = usePagedPolled<WorkItemV1, WorkItemsV1>({ key: `work:${stateFilter ?? 'all'}`, fetchPage, idOf: (item) => item.workId, order: byCreated });
  const [overrides, setOverrides] = useState<ReadonlyMap<string, WorkItemV1>>(new Map());

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
    setOverrides((previous) => new Map(previous).set(next.workId, next));
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
