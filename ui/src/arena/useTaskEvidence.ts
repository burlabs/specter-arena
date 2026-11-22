import { useMemo } from 'react';
import type { TaskItemV1 } from '../contracts/types';
import { HostApiError, taskPath, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';
import { parseTaskItem } from '../tasks/model';
import { xpFailureOf } from '../work/useXp';
import type { XpFailure } from '../work/useXp';

export type EvidenceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'gone' }
  | { status: 'forbidden' }
  | { status: 'failed'; failure: XpFailure }
  | { status: 'ready'; item: TaskItemV1 };

/**
 * Reads one task. Any failed read of the latest poll clears what was shown: the polling hook keeps the last good body,
 * and this hook refuses to hand it back, so a removed task, a revoked permission or a lost connection never leaves old
 * evidence on screen (FP-11-AC03). A GET only.
 */
export function useTaskEvidence(taskId: string | null): { state: EvidenceState; refresh: () => void } {
  const api = useHostApi();
  const load = useMemo(() => (taskId === null ? null : async () => parseTaskItem(await api.getJson<unknown>(taskPath(taskId)))), [api, taskId]);
  const polled = usePolled(load, taskId ?? '');
  const error = polled.error;
  let state: EvidenceState;
  if (taskId === null) state = { status: 'idle' };
  else if (error instanceof HostApiError && (error.error === 'unknown_task' || error.status === 404)) state = { status: 'gone' };
  else if (error instanceof HostApiError && error.status === 403) state = { status: 'forbidden' };
  else if (error !== null) state = { status: 'failed', failure: xpFailureOf(error) };
  else if (polled.data !== null) state = { status: 'ready', item: polled.data };
  else state = { status: 'loading' };
  return { state, refresh: polled.refresh };
}
