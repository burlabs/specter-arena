import { useMemo } from 'react';
import type { WorkItemV1 } from '../contracts/types';
import { HostApiError, useHostApi, workPath } from '../host';
import { usePolled } from '../observatory/usePolled';
import { parseWorkItem } from '../work/model';
import { xpFailureOf } from '../work/useXp';
import type { XpFailure } from '../work/useXp';

export type EvidenceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'gone' }
  | { status: 'forbidden' }
  | { status: 'failed'; failure: XpFailure }
  | { status: 'ready'; item: WorkItemV1 };

/**
 * Reads one work item with its evidence. Unlike `useWorkItem`, any failed read of the latest poll clears what was shown:
 * the polling hook keeps the last good body, and this hook refuses to hand it back, so a deleted item, a revoked
 * permission or a lost connection never leaves old evidence on screen (FP-11-AC03).
 */
export function useWorkEvidence(workId: string | null): { state: EvidenceState; refresh: () => void } {
  const api = useHostApi();
  const load = useMemo(() => (workId === null ? null : async () => parseWorkItem(await api.getJson<unknown>(workPath(workId)))), [api, workId]);
  const polled = usePolled(load, workId ?? '');
  const error = polled.error;
  let state: EvidenceState;
  if (workId === null) state = { status: 'idle' };
  else if (error instanceof HostApiError && error.error === 'unknown_work') state = { status: 'gone' };
  else if (error instanceof HostApiError && error.status === 403) state = { status: 'forbidden' };
  else if (error !== null) state = { status: 'failed', failure: xpFailureOf(error) };
  else if (polled.data !== null) state = { status: 'ready', item: polled.data };
  else state = { status: 'loading' };
  return { state, refresh: polled.refresh };
}
