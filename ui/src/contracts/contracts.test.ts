// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { API_ERROR_KEYS, PAGE_KEYS, READY_KEYS } from './types.ts';
import type { ApiErrorV1, PageV1, ReadyV1 } from './types.ts';

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

describe('hand-written types', () => {
  const properties = (name: string): string[] => {
    const schema = readJson(`${schemasDir}${name}.v1.schema.json`) as { properties: Record<string, unknown>; required: string[] };
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    return Object.keys(schema.properties).sort();
  };

  it('name exactly the schema properties', () => {
    expect(Object.keys(API_ERROR_KEYS).sort()).toEqual(properties('api-error'));
    expect(Object.keys(PAGE_KEYS).sort()).toEqual(properties('page'));
    expect(Object.keys(READY_KEYS).sort()).toEqual(properties('ready'));
  });

  it('accept values the schemas accept', () => {
    const error: ApiErrorV1 = { contractVersion: 1, error: 'unauthorized' };
    const page: PageV1 = { contractVersion: 1, items: [{ id: 'a' }], nextCursor: null };
    const ready: ReadyV1 = { contractVersion: 1, status: 'not-ready', store: 'migrating', storeVersion: null, latestVersion: 1 };
    for (const [name, value] of [['api-error', error], ['page', page], ['ready', ready]] as const) {
      expect(ajv.getSchema(`urn:specter-arena:contract:${name}:v1`)?.(value)).toBe(true);
    }
  });
});
