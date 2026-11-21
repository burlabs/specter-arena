import { useRef, useState } from 'react';
import type { CollectorControlV1, DataLifecycleV1, RetentionDaysV1 } from '../contracts/types';
import {
  COLLECTOR_PATH,
  DATA_ASSET_CLEANUP_PATH,
  DATA_EXPORT_PATH,
  DATA_PURGE_PATH,
  DATA_RETENTION_PATH,
  HostApiError,
  useHostApi,
} from '../host';
import { DataShapeError, parseCollectorControl, parseDataLifecycle } from './model';

export type LifecycleResult = { ok: true; data: DataLifecycleV1 } | { ok: false; code: string };
export type CollectorResult = { ok: true; control: CollectorControlV1 } | { ok: false; code: string };

export interface DataActions {
  /** True while a write is in flight; every control is disabled meanwhile, so two writes never overlap. */
  busy: boolean;
  setRetention: (days: RetentionDaysV1 | null) => Promise<LifecycleResult>;
  /** `days` is the saved window the panel is showing; the backend refuses the purge when it no longer matches. */
  purge: (days: RetentionDaysV1) => Promise<LifecycleResult>;
  exportStore: () => Promise<LifecycleResult>;
  cleanupUploads: () => Promise<LifecycleResult>;
  setPaused: (paused: boolean) => Promise<CollectorResult>;
}

export const codeOf = (error: unknown): string =>
  error instanceof DataShapeError ? 'unexpected' : error instanceof HostApiError ? (error.error ?? `http_${error.status}`) : 'offline';

/**
 * Writes one Data request at a time. None of these carries a request id: the retention write and the pause write
 * are idempotent by value, and a purge, export or cleanup that the network lost is safe to look at again because
 * the next poll shows `lastPurge`, `lastExport` or `lastCleanup` before the owner decides to repeat it.
 */
export function useDataActions(): DataActions {
  const api = useHostApi();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const guarded = async <T extends { ok: boolean }>(send: () => Promise<T>): Promise<T | { ok: false; code: string }> => {
    if (inFlight.current) return { ok: false, code: 'busy' };
    inFlight.current = true;
    setBusy(true);
    try {
      return await send();
    } catch (error) {
      return { ok: false, code: codeOf(error) };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const lifecycle = (send: () => Promise<unknown>): Promise<LifecycleResult> =>
    guarded<LifecycleResult>(async () => ({ ok: true, data: parseDataLifecycle(await send()) }));

  return {
    busy,
    setRetention: (days) => lifecycle(() => api.putJson(DATA_RETENTION_PATH, { retentionDays: days })),
    purge: (days) => lifecycle(() => api.postJson(DATA_PURGE_PATH, { retentionDays: days })),
    exportStore: () => lifecycle(() => api.postJson(DATA_EXPORT_PATH, {})),
    cleanupUploads: () => lifecycle(() => api.postJson(DATA_ASSET_CLEANUP_PATH, {})),
    setPaused: (paused) => guarded<CollectorResult>(async () => ({ ok: true, control: parseCollectorControl(await api.postJson(COLLECTOR_PATH, { paused })) })),
  };
}
