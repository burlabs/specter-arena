import { useCallback, useEffect, useState } from 'react';

export const WATCHED_KEY = 'specter-arena:watched:v1';
export const MAX_WATCHED = 500;
const BINDING_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseWatched(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return [];
    const { v, ids } = value as { v?: unknown; ids?: unknown };
    if (v !== 1 || !Array.isArray(ids)) return [];
    const kept: string[] = [];
    for (const id of ids) {
      if (typeof id === 'string' && BINDING_ID.test(id) && !kept.includes(id)) kept.push(id);
      if (kept.length === MAX_WATCHED) break;
    }
    return kept;
  } catch {
    return [];
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readWatched(): string[] {
  try {
    return parseWatched(storage()?.getItem(WATCHED_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Returns false when the browser refused the write (private mode, quota). */
export function writeWatched(ids: Iterable<string>): boolean {
  try {
    const target = storage();
    if (target === null) return false;
    target.setItem(WATCHED_KEY, JSON.stringify({ v: 1, ids: [...ids] }));
    return true;
  } catch {
    return false;
  }
}

/** Drops ids that left the roster. Callers pass `rosterIds` only for a complete (not truncated) load. */
export const pruneWatched = (watched: ReadonlySet<string>, rosterIds: ReadonlySet<string>): Set<string> =>
  new Set([...watched].filter((id) => rosterIds.has(id)));

export interface WatchedRoster {
  ids: ReadonlySet<string>;
  complete: boolean;
}

export function useWatched(roster: WatchedRoster | null) {
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set(readWatched()));
  const [persistFailed, setPersistFailed] = useState(false);

  const commit = useCallback((next: ReadonlySet<string>) => {
    setWatched(next);
    setPersistFailed(!writeWatched(next));
  }, []);

  useEffect(() => {
    if (roster?.complete !== true) return;
    const pruned = pruneWatched(watched, roster.ids);
    if (pruned.size !== watched.size) commit(pruned);
  }, [roster, watched, commit]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === WATCHED_KEY || event.key === null) setWatched(new Set(readWatched()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(watched);
      if (!next.delete(id)) {
        if (next.size >= MAX_WATCHED) return;
        next.add(id);
      }
      commit(next);
    },
    [watched, commit],
  );

  const clear = useCallback(() => commit(new Set()), [commit]);
  return { watched, toggle, clear, persistFailed, full: watched.size >= MAX_WATCHED };
}
