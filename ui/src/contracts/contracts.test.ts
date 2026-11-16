// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_KEYS,
  PAGE_KEYS,
  READY_KEYS,
  ROSTER_AVATAR_KEYS,
  ROSTER_COLLECTOR_KEYS,
  ROSTER_CONDITION_KEYS,
  ROSTER_COVERAGE_KEYS,
  ROSTER_ITEM_KEYS,
  ROSTER_KEYS,
  ROSTER_NOTE_KEYS,
  ROSTER_SIGNALS_KEYS,
  ROSTER_WORKERS_KEYS,
} from './types.ts';
import type { ApiErrorV1, PageV1, ReadyV1, RosterItemV1, RosterV1 } from './types.ts';

// The wire schemas and their shared cases live outside ui/src and backend/specter_arena, so
// neither coverage scope sees them. backend/tests/test_contracts.py runs the same cases.
const contractsDir = fileURLToPath(new URL('../../../contracts/', import.meta.url));
const schemasDir = `${contractsDir}schemas/`;

interface CaseEntry {
  file: string;
  valid: boolean;
  instancePath?: string;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const schemaFiles = readdirSync(schemasDir)
  .filter((name) => name.endsWith('.schema.json'))
  .sort();

// One registry holds every schema, so a schema from another owner can $ref by $id.
const ajv = new Ajv({ strict: true });
for (const name of schemaFiles) ajv.addSchema(readJson(`${schemasDir}${name}`) as object);

/** Parse failure counts as invalid, like NaN in Python: both languages must reject it. */
function parseCase(path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: readJson(path) };
  } catch {
    return { ok: false };
  }
}

describe.each(schemaFiles)('contract %s', (schemaFile) => {
  const match = /^(?<name>[a-z][a-z0-9-]*)\.v(?<major>[1-9][0-9]*)\.schema\.json$/.exec(schemaFile);
  if (match?.groups === undefined) throw new Error(`${schemaFile}: unexpected schema file name`);
  const { name, major } = match.groups;
  const caseDir = `${contractsDir}cases/${name}/v${major}/`;
  const entries = readJson(`${caseDir}cases.json`) as CaseEntry[];
  const validate = ajv.getSchema(`urn:specter-arena:contract:${name}:v${major}`);

  it('is registered under its urn $id', () => {
    expect(validate).toBeDefined();
  });

  it('lists at least one valid and one invalid case', () => {
    expect(entries.some((entry) => entry.valid)).toBe(true);
    expect(entries.some((entry) => !entry.valid)).toBe(true);
  });

  it.each(entries)('$file', (entry) => {
    const parsed = parseCase(`${caseDir}${entry.file}`);
    if (!parsed.ok) {
      expect(entry.valid).toBe(false);
      expect(entry.instancePath).toBeUndefined();
      return;
    }
    const ok = validate?.(parsed.value) === true;
    expect(ok).toBe(entry.valid);
    if (!ok && entry.instancePath !== undefined) {
      // Only the first error's JSON Pointer is compared: keywords and messages differ per library.
      expect(validate?.errors?.[0]?.instancePath).toBe(entry.instancePath);
    }
  });
});

interface TypedSchema {
  readonly schema: string;
  /** Path to a nested object schema inside the file, e.g. ['properties', 'condition']. */
  readonly path: readonly string[];
  readonly keys: Record<string, true>;
}

const TYPED: readonly TypedSchema[] = [
  { schema: 'api-error', path: [], keys: API_ERROR_KEYS },
  { schema: 'page', path: [], keys: PAGE_KEYS },
  { schema: 'ready', path: [], keys: READY_KEYS },
  { schema: 'roster-item', path: [], keys: ROSTER_ITEM_KEYS },
  { schema: 'roster-item', path: ['properties', 'avatar'], keys: ROSTER_AVATAR_KEYS },
  { schema: 'roster-item', path: ['properties', 'condition'], keys: ROSTER_CONDITION_KEYS },
  { schema: 'roster-item', path: ['properties', 'condition', 'properties', 'signals'], keys: ROSTER_SIGNALS_KEYS },
  { schema: 'roster-item', path: ['properties', 'coverage'], keys: ROSTER_COVERAGE_KEYS },
  { schema: 'roster-item', path: ['properties', 'workers'], keys: ROSTER_WORKERS_KEYS },
  { schema: 'roster', path: [], keys: ROSTER_KEYS },
  { schema: 'roster', path: ['properties', 'collector'], keys: ROSTER_COLLECTOR_KEYS },
  { schema: 'roster', path: ['properties', 'notes', 'items'], keys: ROSTER_NOTE_KEYS },
];
/** Schemas with no TypeScript reader. A schema in neither list fails the test below. */
const BACKEND_ONLY = ['bot-binding', 'observation', 'quarantine-record'];

describe('hand-written types', () => {
  const nested = (entry: TypedSchema): { properties: Record<string, unknown>; required: string[] } =>
    entry.path.reduce<unknown>(
      (node, key) => (node as Record<string, unknown>)[key],
      readJson(`${schemasDir}${entry.schema}.v1.schema.json`),
    ) as { properties: Record<string, unknown>; required: string[] };

  it.each(TYPED)('$schema $path names exactly the schema properties, all required', (entry) => {
    const node = nested(entry);
    expect(Object.keys(entry.keys).sort()).toEqual(Object.keys(node.properties).sort());
    expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
  });

  it('covers every schema file', () => {
    const typed = new Set(TYPED.map((entry) => entry.schema));
    const names = schemaFiles.map((file) => file.replace(/\.v\d+\.schema\.json$/, ''));
    expect(names.filter((name) => !typed.has(name) && !BACKEND_ONLY.includes(name))).toEqual([]);
    expect(BACKEND_ONLY.filter((name) => !names.includes(name))).toEqual([]);
  });

  it('accept values the schemas accept', () => {
    const error: ApiErrorV1 = { contractVersion: 1, error: 'unauthorized' };
    const page: PageV1 = { contractVersion: 1, items: [{ id: 'a' }], nextCursor: null };
    const ready: ReadyV1 = { contractVersion: 1, status: 'not-ready', store: 'migrating', storeVersion: null, latestVersion: 1 };
    const item: RosterItemV1 = {
      contractVersion: 1,
      bindingId: 'bnd_fake',
      displayName: null,
      avatar: null,
      presence: 'absent',
      condition: {
        state: 'unknown',
        reasonCode: 'never-observed',
        basis: null,
        sourceTimeMs: null,
        observedAtMs: null,
        signals: { needsInput: null, hasOptions: null, pendingApproval: null, waitingForInput: null },
      },
      coverage: { state: 'unknown', sinceMs: null, reasonCode: null, openGapCount: 0 },
      lastObservedAtMs: null,
      workers: { running: 0, seen: 0 },
    };
    const roster: RosterV1 = {
      contractVersion: 1,
      items: [item],
      nextCursor: null,
      rosterRevision: 0,
      collector: { state: 'running', reasonCode: null, sinceMs: null },
      notes: [{ code: 'cron-turns-not-observable', count: null }],
    };
    for (const [name, value] of [['api-error', error], ['page', page], ['ready', ready], ['roster-item', item], ['roster', roster]] as const) {
      expect(ajv.getSchema(`urn:specter-arena:contract:${name}:v1`)?.(value)).toBe(true);
    }
  });
});

describe('$ref forms the contracts rely on', () => {
  it('resolves a fragment $ref to another schema definition', () => {
    const local = new Ajv({ strict: true });
    for (const name of schemaFiles) local.addSchema(readJson(`${schemasDir}${name}`) as object);
    const validate = local.compile({
      $id: 'urn:specter-arena:contract:fragment-probe:v1',
      type: 'object',
      properties: { id: { $ref: 'urn:specter-arena:contract:bot-binding:v1#/definitions/bindingId' } },
      required: ['id'],
      additionalProperties: false,
    });
    expect(validate({ id: 'bnd_0a1b2c3d' })).toBe(true);
    expect(validate({ id: 'not an id!' })).toBe(false);
    expect(validate({ id: 7 })).toBe(false);
  });
});
