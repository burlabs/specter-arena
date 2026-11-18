import { useMemo } from 'react';
import type { WorkItemV1 } from '../contracts/types';
import { HostApiError, useHostApi, workPath } from '../host';
import { usePolled } from '../observatory/usePolled';
import { parseWorkItem } from './model';
import { xpFailureOf } from './useXp';
import type { XpFailure } from './useXp';

export type WorkItemState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'gone' }
  | { status: 'failed'; failure: XpFailure }
  | { status: 'ready'; item: WorkItemV1 };

/** `unknown_work` means the item is gone; any other 404 means the backend lacks Work support. */
export function useWorkItem(workId: string | null): { state: WorkItemState; refresh: () => void } {
  const api = useHostApi();
  const load = useMemo(() => (workId === null ? null : async () => parseWorkItem(await api.getJson<unknown>(workPath(workId)))), [api, workId]);
  const polled = usePolled(load, workId ?? '');
  let state: WorkItemState;
  if (workId === null) state = { status: 'idle' };
  else if (polled.error instanceof HostApiError && polled.error.error === 'unknown_work') state = { status: 'gone' };
  else if (polled.data !== null) state = { status: 'ready', item: polled.data };
  else if (polled.error !== null) state = { status: 'failed', failure: xpFailureOf(polled.error) };
  else state = { status: 'loading' };
  return { state, refresh: polled.refresh };
}
