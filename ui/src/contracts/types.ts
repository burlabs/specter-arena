// Hand-written types for the seed wire contracts in contracts/schemas/. The schemas are the
// source of truth; contracts.test.ts fails when a type drifts from its schema.

export interface ApiErrorV1 {
  contractVersion: 1;
  error: string;
}

export interface PageV1<Item extends object = Record<string, unknown>> {
  contractVersion: 1;
  items: Item[];
  nextCursor: string | null;
}

export type StoreStateV1 = 'ready' | 'unconfigured' | 'migrating' | 'schema-newer' | 'sqlite-too-old' | 'unavailable' | 'disabled';

export interface ReadyV1 {
  contractVersion: 1;
  status: 'ready' | 'not-ready';
  store: StoreStateV1;
  storeVersion: number | null;
  latestVersion: number | null;
}

// A Record over keyof T makes tsc reject a missing or an extra key, so the test can compare these
// names with the schema's properties in both directions.
export const API_ERROR_KEYS: Record<keyof ApiErrorV1, true> = { contractVersion: true, error: true };
export const PAGE_KEYS: Record<keyof PageV1, true> = { contractVersion: true, items: true, nextCursor: true };
export const READY_KEYS: Record<keyof ReadyV1, true> = { contractVersion: true, status: true, store: true, storeVersion: true, latestVersion: true };
