/** The bindings this browser has already offered the assignment walkthrough for. Ids only; no names. */
export const ONBOARDING_KEY = 'specter-arena:onboarding:v1';
export const MAX_OFFERED = 500;
const BINDING_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseOffered(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return [];
    const { v, offered } = value as { v?: unknown; offered?: unknown };
    if (v !== 1 || !Array.isArray(offered)) return [];
    const kept: string[] = [];
    for (const id of offered) {
      if (typeof id === 'string' && BINDING_ID.test(id) && !kept.includes(id)) kept.push(id);
      if (kept.length === MAX_OFFERED) break;
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

export function readOffered(): string[] {
  try {
    return parseOffered(storage()?.getItem(ONBOARDING_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Adds ids and keeps the newest MAX_OFFERED. Returns false when the browser refused the write (private mode, quota). */
export function markOffered(ids: Iterable<string>): boolean {
  try {
    const target = storage();
    if (target === null) return false;
    const merged = [...readOffered().filter((id) => ![...ids].includes(id)), ...[...ids].filter((id) => BINDING_ID.test(id))];
    target.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, offered: merged.slice(-MAX_OFFERED) }));
    return true;
  } catch {
    return false;
  }
}
