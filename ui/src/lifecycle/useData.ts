import { useCallback } from 'react';
import type { DataLifecycleV1 } from '../contracts/types';
import { DATA_PATH, HostApiError, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';
import { DataShapeError, parseDataLifecycle } from './model';

export type DataFailure = 'unsupported' | 'offline' | 'unavailable' | 'unexpected';

export type DataState =
  | { status: 'loading'; data: null; failure: null }
  | { status: 'ready'; data: DataLifecycleV1; failure: DataFailure | null }
  | { status: 'failed'; data: null; failure: DataFailure };

export function dataFailureOf(error: unknown): DataFailure {
  if (error instanceof DataShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : 'unavailable';
  return 'offline';
}

/** Polls `GET /api/data`. A failed poll keeps the last good body and says it is stale through `failure`. */
export function useData(): { state: DataState; refresh: () => void } {
  const api = useHostApi();
  const load = useCallback(async () => parseDataLifecycle(await api.getJson<unknown>(DATA_PATH)), [api]);
  const polled = usePolled(load, 'data');
  const failure = polled.error === null ? null : dataFailureOf(polled.error);
  let state: DataState;
  if (polled.data !== null) state = { status: 'ready', data: polled.data, failure };
  else if (failure !== null) state = { status: 'failed', data: null, failure };
  else state = { status: 'loading', data: null, failure: null };
  return { state, refresh: polled.refresh };
}
