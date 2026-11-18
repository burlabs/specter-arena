import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpecterV1 } from '../contracts/types';
import { HostApiError, SPECTERS_PATH, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';

export type SpecterFailure = 'unsupported' | 'offline' | 'unexpected' | 'unavailable';

export interface SpectersState {
  status: 'loading' | 'ready' | 'failed';
  byBinding: ReadonlyMap<string, SpecterV1>;
  failure: SpecterFailure | null;
  refresh: () => void;
  /** An action response wins over the poll until the poll reaches the same version. */
  apply: (next: SpecterV1) => void;
  /** Tombstone for an archived Specter, dropped once a poll no longer lists the bot. */
  remove: (bindingId: string) => void;
}

const MAX_ITEMS = 500;

class ShapeError extends Error {}

const isText = (value: unknown): value is string => typeof value === 'string';

function isSpecter(value: unknown): value is SpecterV1 {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<SpecterV1>;
  const profile: unknown = item.profile;
  return (
    isText(item.bindingId) &&
    typeof item.version === 'number' &&
    typeof profile === 'object' &&
    profile !== null &&
    isText((profile as { name?: unknown }).name)
  );
}

/** The canned fixture response and an older backend can return anything, so the body is checked before use. */
export function parseSpecters(body: unknown): SpecterV1[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length > MAX_ITEMS || !items.every(isSpecter)) throw new ShapeError('unexpected specters body');
  return items;
}

export function failureOf(error: unknown): SpecterFailure {
  if (error instanceof ShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : 'unavailable';
  return 'offline';
}

type Override = { version: number; specter: SpecterV1 | null };

export function useSpecters(): SpectersState {
  const api = useHostApi();
  const load = useCallback(async () => parseSpecters(await api.getJson<unknown>(SPECTERS_PATH)), [api]);
  const polled = usePolled(load, 'specters');
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Override>>(new Map());

  const polledItems = polled.data;
  useEffect(() => {
    if (polledItems === null) return;
    setOverrides((previous) => {
      const next = new Map(previous);
      for (const [bindingId, override] of previous) {
        const listed = polledItems.find((item) => item.bindingId === bindingId);
        const caughtUp = override.specter === null ? listed === undefined : listed !== undefined && listed.version >= override.version;
        if (caughtUp) next.delete(bindingId);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [polledItems]);

  const byBinding = useMemo(() => {
    const map = new Map<string, SpecterV1>((polledItems ?? []).map((item) => [item.bindingId, item]));
    for (const [bindingId, override] of overrides) {
      if (override.specter === null) map.delete(bindingId);
      else if ((map.get(bindingId)?.version ?? 0) < override.version) map.set(bindingId, override.specter);
    }
    return map;
  }, [polledItems, overrides]);

  const apply = useCallback((next: SpecterV1) => {
    setOverrides((previous) => new Map(previous).set(next.bindingId, { version: next.version, specter: next }));
  }, []);
  const remove = useCallback((bindingId: string) => {
    setOverrides((previous) => new Map(previous).set(bindingId, { version: Number.MAX_SAFE_INTEGER, specter: null }));
  }, []);

  const failure = polled.error === null ? null : failureOf(polled.error);
  const status = polledItems !== null ? 'ready' : failure !== null ? 'failed' : 'loading';
  return { status, byBinding, failure, refresh: polled.refresh, apply, remove };
}
