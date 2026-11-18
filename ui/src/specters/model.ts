import type { SpecterProfileV1 } from '../contracts/types';

export type ProfileField = Exclude<keyof SpecterProfileV1, 'contractVersion'>;

export const PROFILE_FIELDS: readonly ProfileField[] = ['name', 'epithet', 'personality', 'appearance', 'mannerism', 'signatureAction', 'assignmentRationale', 'artBrief'];

/** Bounds from specter-profile.v1, counted in code points. `required` mirrors null-ability in the schema. */
export const FIELD_BOUNDS: Readonly<Record<ProfileField, { max: number; required: boolean; multiline: boolean }>> = {
  name: { max: 40, required: true, multiline: false },
  epithet: { max: 60, required: false, multiline: false },
  personality: { max: 400, required: true, multiline: true },
  appearance: { max: 400, required: true, multiline: true },
  mannerism: { max: 200, required: true, multiline: true },
  signatureAction: { max: 200, required: false, multiline: false },
  assignmentRationale: { max: 300, required: true, multiline: true },
  artBrief: { max: 400, required: true, multiline: true },
};

/** Fields the user can ask to keep fixed on a reroll. */
export const KEEP_FIELDS = ['name', 'epithet', 'personality', 'appearance', 'mannerism', 'signatureAction'] as const;

export const SUMMONING_STORAGE_KEY = 'specter-arena:summoning:v1';
const BINDING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_ID = /^req_[0-9a-f]{24}$/;
const MAX_RESUME_ENTRIES = 50;

/** FNV-1a over UTF-16 code units, folded to a hue; the same id always gives the same colour. */
export function tokenHue(specterId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < specterId.length; index += 1) {
    hash = Math.imul(hash ^ specterId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash % 360;
}

/** First letters of up to two words, by code point so a surrogate pair is never split; "?" when empty. */
export function tokenInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  const initials = letters.join('').toUpperCase();
  return initials === '' ? '?' : initials;
}

export function newRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `req_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Only queued and running keep a request alive; any other or unknown token ends polling. */
export const isActive = (status: string): boolean => status === 'queued' || status === 'running';

export const lengthOf = (text: string): number => Array.from(text).length;

export function parseResume(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    const { v, ids } = value as { v?: unknown; ids?: unknown };
    if (v !== 1 || typeof ids !== 'object' || ids === null || Array.isArray(ids)) return {};
    const kept: Record<string, string> = {};
    for (const [bindingId, requestId] of Object.entries(ids)) {
      if (Object.keys(kept).length >= MAX_RESUME_ENTRIES) break;
      if (BINDING_ID.test(bindingId) && typeof requestId === 'string' && REQUEST_ID.test(requestId)) kept[bindingId] = requestId;
    }
    return kept;
  } catch {
    return {};
  }
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readResume(bindingId: string): string | null {
  try {
    return parseResume(session()?.getItem(SUMMONING_STORAGE_KEY) ?? null)[bindingId] ?? null;
  } catch {
    return null;
  }
}

/** A null request id removes the entry. Never throws: a blocked sessionStorage just disables resume. */
export function writeResume(bindingId: string, requestId: string | null): void {
  try {
    const target = session();
    if (target === null) return;
    const ids = parseResume(target.getItem(SUMMONING_STORAGE_KEY));
    if (requestId === null) delete ids[bindingId];
    else ids[bindingId] = requestId;
    target.setItem(SUMMONING_STORAGE_KEY, JSON.stringify({ v: 1, ids }));
  } catch {
    // resume is a convenience; losing it only costs a candidate the user can summon again
  }
}
