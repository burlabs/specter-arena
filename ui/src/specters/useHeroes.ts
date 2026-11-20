import { useCallback, useMemo } from 'react';
import type { HeroesItemV1 } from '../contracts/types';
import { HEROES_PATH, HostApiError, useHostApi } from '../host';
import { usePolled } from '../observatory/usePolled';

export type HeroesFailure = 'unsupported' | 'offline' | 'unexpected' | 'unavailable';

export interface HeroesState {
  status: 'loading' | 'ready' | 'failed';
  /** The 11 roster heroes in roster order; `null` until the first good response. */
  items: readonly HeroesItemV1[] | null;
  failure: HeroesFailure | null;
  refresh: () => void;
}

/** The roster has exactly 11 heroes (heroes.v1 `minItems` and `maxItems`). */
export const HERO_COUNT = 11;

class ShapeError extends Error {}

const isText = (value: unknown): value is string => typeof value === 'string';

function isHero(value: unknown): value is HeroesItemV1 {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<HeroesItemV1>;
  return (
    isText(item.heroId) &&
    isText(item.name) &&
    isText(item.epithet) &&
    isText(item.personality) &&
    typeof item.assigned === 'boolean' &&
    typeof item.assignedCount === 'number' &&
    Number.isInteger(item.assignedCount) &&
    item.assignedCount >= 0
  );
}

/** A newer major, a list that is not exactly 11 heroes and any malformed item all fail here and show "unexpected". */
export function parseHeroes(body: unknown): HeroesItemV1[] {
  const envelope = body as { contractVersion?: unknown; items?: unknown } | null;
  const items = envelope?.items;
  if (envelope?.contractVersion !== 1 || !Array.isArray(items) || items.length !== HERO_COUNT || !items.every(isHero)) {
    throw new ShapeError('unexpected heroes body');
  }
  return items;
}

export function heroesFailureOf(error: unknown): HeroesFailure {
  if (error instanceof ShapeError) return 'unexpected';
  if (error instanceof HostApiError) return error.status === 404 ? 'unsupported' : 'unavailable';
  return 'offline';
}

export function useHeroes(): HeroesState {
  const api = useHostApi();
  const load = useCallback(async () => parseHeroes(await api.getJson<unknown>(HEROES_PATH)), [api]);
  const polled = usePolled(load, 'heroes');
  const items = polled.data;
  const failure = useMemo(() => (polled.error === null ? null : heroesFailureOf(polled.error)), [polled.error]);
  const status = items !== null ? 'ready' : failure !== null ? 'failed' : 'loading';
  return { status, items, failure, refresh: polled.refresh };
}
