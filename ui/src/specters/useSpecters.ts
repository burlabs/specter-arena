import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpecterV2 } from '../contracts/types';
import { HostApiError, SPECTERS_PATH, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';

export type SpecterFailure = 'unsupported' | 'offline' | 'unexpected' | 'unavailable';

export interface SpectersState {
  status: 'loading' | 'ready' | 'failed';
  byBinding: ReadonlyMap<string, SpecterV2>;
  failure: SpecterFailure | null;
  refresh: () => void;
  /** An action response wins over the poll until the poll reaches the same version. */
  apply: (next: SpecterV2) => void;
}

const MAX_ITEMS = 500;

class ShapeError extends Error {}

const isText = (value: unknown): value is string => typeof value === 'string';

function isSpecter(value: unknown): value is SpecterV2 {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<SpecterV2>;
  const portrait: unknown = item.portrait;
  return (
    isText(item.bindingId) &&
    typeof item.version === 'number' &&
    isText(item.heroId) &&
    isText(item.displayName) &&
    isText(item.name) &&
    typeof item.avatarChosen === 'boolean' &&
    typeof portrait === 'object' &&
    portrait !== null &&
    isText((portrait as { assetId?: unknown }).assetId)
  );
}

/** An older backend (specters.v1), the canned fixture response and a newer major all fail here and show "unexpected". */
export function parseSpecters(body: unknown): SpecterV2[] {
  const envelope = body as { contractVersion?: unknown; items?: unknown } | null;
  const items = envelope?.items;
  if (envelope?.contractVersion !== 2 || !Array.isArray(items) || items.length > MAX_ITEMS || !items.every(isSpecter)) {
    throw new ShapeError('unexpected specters body');
  }
  return items;
}

export function failureOf(error: unknown): SpecterFailure {
  if (error instanceof ShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : 'unavailable';
  return 'offline';
}

type Override = { version: number; specter: SpecterV2 };

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
        const caughtUp = listed !== undefined && listed.version >= override.version;
        if (caughtUp) next.delete(bindingId);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [polledItems]);

  const byBinding = useMemo(() => {
    const map = new Map<string, SpecterV2>((polledItems ?? []).map((item) => [item.bindingId, item]));
    for (const [bindingId, override] of overrides) {
      if ((map.get(bindingId)?.version ?? -1) < override.version) map.set(bindingId, override.specter);
    }
    return map;
  }, [polledItems, overrides]);

  const apply = useCallback((next: SpecterV2) => {
    setOverrides((previous) => new Map(previous).set(next.bindingId, { version: next.version, specter: next }));
  }, []);

  const failure = polled.error === null ? null : failureOf(polled.error);
  const status = polledItems !== null ? 'ready' : failure !== null ? 'failed' : 'loading';
  return { status, byBinding, failure, refresh: polled.refresh, apply };
}
