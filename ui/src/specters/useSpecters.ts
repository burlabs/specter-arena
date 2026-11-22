import { useCallback, useEffect, useMemo, useState } from 'react';
import { ASSIGNED_BY } from '../contracts/types';
import type { AssignHeroRequest, HeroId, SpecterV2, SpecterV3 } from '../contracts/types';
import { HostApiError, SPECTERS_ASSIGNMENT_PATH, specterHeroPath, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';

export type SpecterFailure = 'unsupported' | 'offline' | 'unexpected' | 'unavailable';

/** `assigned`: this call wrote the hero. `already`: the bot already held one (409); the list was reloaded. `failed`: nothing changed. */
export type AssignResult = { kind: 'assigned' } | { kind: 'already' } | { kind: 'failed'; code: string };

export interface SpectersState {
  status: 'loading' | 'ready' | 'failed';
  byBinding: ReadonlyMap<string, SpecterV3>;
  /** Bindings that hold no hero yet (`unassignedBindingIds`); a bot is never in both this list and `byBinding`. */
  unassigned: readonly string[];
  failure: SpecterFailure | null;
  refresh: () => void;
  /** An action response wins over the poll until the poll reaches the same version. The avatar route answers with specter.v2. */
  apply: (next: SpecterV2 | SpecterV3) => void;
  /** Gives a bot a hero (`null` asks for a random one) and shows the result at once. */
  assign: (bindingId: string, heroId: HeroId | null) => Promise<AssignResult>;
}

export interface ParsedSpecters {
  items: SpecterV3[];
  unassigned: string[];
}

const MAX_ITEMS = 500;

class ShapeError extends Error {}

const isText = (value: unknown): value is string => typeof value === 'string';

function isSpecterFields(value: unknown): value is SpecterV2 | SpecterV3 {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<SpecterV3>;
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

function isSpecterV3(value: unknown): value is SpecterV3 {
  if (!isSpecterFields(value)) return false;
  const item = value as Partial<SpecterV3>;
  return item.contractVersion === 3 && ASSIGNED_BY.some((kind) => kind === item.assignedBy);
}

/** An older backend (specters.v2), the canned fixture response and a newer major all fail here and show "unexpected". */
export function parseSpecters(body: unknown): ParsedSpecters {
  const envelope = body as { contractVersion?: unknown; items?: unknown; unassignedBindingIds?: unknown } | null;
  const items = envelope?.items;
  const ids = envelope?.unassignedBindingIds;
  if (
    envelope?.contractVersion !== 3 ||
    !Array.isArray(items) ||
    items.length > MAX_ITEMS ||
    !items.every(isSpecterV3) ||
    !Array.isArray(ids) ||
    ids.length > MAX_ITEMS ||
    !ids.every(isText)
  ) {
    throw new ShapeError('unexpected specters body');
  }
  const held = new Set(items.map((item) => item.bindingId));
  if (ids.some((id) => held.has(id))) throw new ShapeError('unexpected specters body');
  return { items, unassigned: ids };
}

export function failureOf(error: unknown): SpecterFailure {
  if (error instanceof ShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : 'unavailable';
  return 'offline';
}

/** The words key of a write that failed: the backend's error code, `invalid_response`, or `offline`. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof HostApiError) return error.error ?? `http_${error.status}`;
  if (error instanceof ShapeError) return 'invalid_response';
  return 'offline';
}

type Override = { version: number; specter: SpecterV2 | SpecterV3 };

export function useSpecters(): SpectersState {
  const api = useHostApi();
  const load = useCallback(async () => parseSpecters(await api.getJson<unknown>(SPECTERS_ASSIGNMENT_PATH)), [api]);
  const polled = usePolled(load, 'specters');
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Override>>(new Map());

  const polledItems = polled.data?.items ?? null;
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
    const map = new Map<string, SpecterV3>((polledItems ?? []).map((item) => [item.bindingId, item]));
    for (const [bindingId, override] of overrides) {
      const listed = map.get(bindingId);
      if ((listed?.version ?? -1) < override.version) {
        const fallback = listed?.assignedBy ?? 'auto';
        map.set(bindingId, { ...override.specter, contractVersion: 3, assignedBy: 'assignedBy' in override.specter ? override.specter.assignedBy : fallback });
      }
    }
    return map;
  }, [polledItems, overrides]);

  const unassigned = useMemo(() => (polled.data?.unassigned ?? []).filter((id) => !byBinding.has(id)), [polled.data, byBinding]);

  const apply = useCallback((next: SpecterV2 | SpecterV3) => {
    setOverrides((previous) => new Map(previous).set(next.bindingId, { version: next.version, specter: next }));
  }, []);

  const { refresh } = polled;
  const assign = useCallback(
    async (bindingId: string, heroId: HeroId | null): Promise<AssignResult> => {
      const body: AssignHeroRequest = { expectedVersion: 0, heroId };
      try {
        const next = await api.postJson<unknown>(specterHeroPath(bindingId), body);
        if (!isSpecterV3(next)) throw new ShapeError('unexpected specter body');
        apply(next);
        return { kind: 'assigned' };
      } catch (error) {
        if (error instanceof HostApiError && error.status === 409) {
          refresh();
          return { kind: 'already' };
        }
        return { kind: 'failed', code: errorCodeOf(error) };
      }
    },
    [api, apply, refresh],
  );

  const failure = polled.error === null ? null : failureOf(polled.error);
  const status = polledItems !== null ? 'ready' : failure !== null ? 'failed' : 'loading';
  return { status, byBinding, unassigned, failure, refresh, apply, assign };
}
