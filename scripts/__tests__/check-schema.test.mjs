import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  caseProblems,
  deniedToken,
  forEachSchema,
  futureMajorProblems,
  parseExemptions,
  parseOwners,
  run,
  schemaFindings,
  sqlFindings,
  tokens,
} from '../check-schema.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'check-schema-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** @param {Record<string, unknown>} [change] */
const schema = (change = {}) => ({
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'urn:specter-arena:contract:thing:v1',
  title: 'Thing v1',
  type: 'object',
  properties: { contractVersion: { type: 'integer', const: 1 }, label: { type: 'string' } },
  required: ['contractVersion'],
  additionalProperties: false,
  ...change,
});

const FILE = 'contracts/schemas/thing.v1.schema.json';
const OWNERS_TEXT = '| Schema | Version | Owner | Status | Notes |\n|---|---|---|---|---|\n| `thing` | 1 | work-ledger | DRAFT | x |\n';

/**
 * A contracts tree that passes; `files` overrides or adds entries and `null` removes one.
 * @param {Record<string, string | null>} [files]
 * @returns {string} root
 */
function tree(files = {}) {
  const base = {
    'contracts/OWNERS.md': OWNERS_TEXT,
    'contracts/VERSIONING.md': 'rules',
    'contracts/guard-exemptions.json': '{"version":1,"exemptions":[]}',
    [FILE]: JSON.stringify(schema()),
    'contracts/cases/thing/v1/cases.json': JSON.stringify([
      { file: 'valid/a.json', valid: true },
      { file: 'invalid/b.json', valid: false, instancePath: '/label' },
      { file: 'invalid/v2.json', valid: false, instancePath: '/contractVersion' },
    ]),
    'contracts/cases/thing/v1/valid/a.json': '{"contractVersion":1}',
    'contracts/cases/thing/v1/invalid/b.json': '{"contractVersion":1,"label":1}',
    'contracts/cases/thing/v1/invalid/v2.json': '{"contractVersion":2}',
  };
  const root = mkdtempSync(join(tmp, 'root-'));
  for (const [name, text] of Object.entries({ ...base, ...files })) {
    if (text === null) continue;
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

/** @param {string} root */
function runLogged(root) {
  /** @type {string[]} */
  const lines = [];
  const code = run({ root, log: (line) => lines.push(line) });
  return { code, lines };
}

/** @param {{ code: number, lines: string[] }} result @param {RegExp} pattern */
function failsWith(result, pattern) {
  assert.equal(result.code, 1, result.lines.join('\n'));
  assert.ok(result.lines.some((line) => pattern.test(line)), `no line matches ${pattern}: ${result.lines.join('\n')}`);
}

/** @param {unknown} value @param {object} [options] */
const rules = (value, options) => schemaFindings(FILE, value, options).map((finding) => finding.rule);

describe('token matching', () => {
  it('splits camelCase, snake_case and kebab-case into lower-case tokens', () => {
    assert.deepEqual(tokens('specterClass_tier-1'), ['specter', 'class', 'tier', '1']);
  });

  it('matches whole tokens only', () => {
    assert.equal(deniedToken('archetype'), 'archetype');
    assert.equal(deniedToken('powerRank'), 'rank');
    assert.equal(deniedToken('SPECIES'), 'species');
    assert.equal(deniedToken('classroom'), undefined);
    assert.equal(deniedToken('storeVersion'), undefined);
  });
});

describe('schemaFindings', () => {
  it('accepts a conforming schema', () => {
    assert.deepEqual(schemaFindings(FILE, schema()), []);
  });

  it('rejects a schema that is not an object', () => {
    assert.deepEqual(rules([]), ['schema-shape']);
  });

  it('checks the file name, dialect, id, title, root type and contractVersion', () => {
    assert.ok(schemaFindings('contracts/schemas/Thing.json', schema()).some((finding) => finding.rule === 'file-name'));
    assert.ok(rules(schema({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).includes('dialect'));
    assert.ok(rules(schema({ $id: 'urn:other:thing:v1' })).includes('id'));
    assert.ok(rules(schema({ title: '' })).includes('title'));
    assert.ok(rules(schema({ type: 'array' })).includes('root-type'));
    assert.ok(rules(schema({ properties: { label: { type: 'string' } } })).includes('contract-version'));
    assert.ok(rules(schema({ required: [] })).includes('contract-version'));
    assert.ok(rules(schema({ properties: { contractVersion: { const: 1 } } })).includes('contract-version'));
  });

  it('flags the format keyword but not a property named format', () => {
    assert.ok(rules(schema({ properties: { contractVersion: { type: 'integer', const: 1 }, at: { type: 'string', format: 'date-time' } } })).includes('format-keyword'));
    assert.deepEqual(rules(schema({ properties: { contractVersion: { type: 'integer', const: 1 }, format: { type: 'string' } } })), []);
  });

  it('flags open objects, except if/then/else fragments', () => {
    assert.ok(rules(schema({ additionalProperties: true })).includes('open-object'));
    assert.deepEqual(rules(schema({ if: { properties: { label: { const: 'a' } } }, then: { properties: { label: { type: 'string' } } }, else: { properties: { label: { type: 'string' } } } })), []);
  });

  it('flags property names that are not plain camelCase', () => {
    assert.ok(rules(schema({ properties: { contractVersion: { type: 'integer', const: 1 }, 'my.field': { type: 'string' } } })).includes('property-name-shape'));
  });

  it('flags allOf combined with a closed object', () => {
    assert.ok(rules(schema({ allOf: [{ type: 'object' }] })).includes('allof-closed'));
    assert.ok(rules(schema({ additionalProperties: true, allOf: [{ additionalProperties: false }] })).includes('allof-closed'));
  });

  it('accepts a $ref by contract id or local definition and rejects other forms', () => {
    const withRef = (/** @type {string} */ ref) => schema({ properties: { contractVersion: { type: 'integer', const: 1 }, other: { $ref: ref } } });
    assert.deepEqual(rules(withRef('urn:specter-arena:contract:other:v1')), []);
    assert.deepEqual(rules(withRef('#/definitions/x')), []);
    assert.ok(rules(withRef('https://example.test/x.json')).includes('ref-form'));
  });

  it('requires a type beside a numeric or boolean const or enum', () => {
    const withValue = (/** @type {Record<string, unknown>} */ value) => schema({ properties: { contractVersion: { type: 'integer', const: 1 }, n: value } });
    assert.ok(rules(withValue({ const: 1 })).includes('untyped-const'));
    assert.ok(rules(withValue({ enum: [true, false] })).includes('untyped-const'));
    assert.deepEqual(rules(withValue({ type: 'integer', const: 1 })), []);
  });

  it('denies class-like property, required and definition names (FP-02-AC06 positive controls)', () => {
    for (const name of ['archetype', 'speciesName', 'powerScore', 'category', 'role']) {
      const property = schema({ properties: { contractVersion: { type: 'integer', const: 1 }, [name]: { type: 'string' } } });
      assert.ok(schemaFindings(FILE, property).some((finding) => finding.rule === 'denied-name' && finding.name === name), name);
    }
    assert.ok(rules(schema({ required: ['contractVersion', 'tier'] })).includes('denied-name'));
    assert.ok(rules(schema({ definitions: { classifier: { type: 'string' } } })).includes('denied-name'));
    assert.ok(rules(schema({ $defs: { rarity: { type: 'string' } } })).includes('denied-name'));
  });

  it('denies class-like enum and const values', () => {
    const withEnum = (/** @type {Record<string, unknown>} */ value) => schema({ properties: { contractVersion: { type: 'integer', const: 1 }, label: { type: 'string', ...value } } });
    assert.ok(rules(withEnum({ enum: ['warrior', 'rarity-epic'] })).includes('denied-enum'));
    assert.ok(rules(withEnum({ const: 'species' })).includes('denied-enum'));
    assert.deepEqual(rules(withEnum({ enum: ['ready', 'not-ready'] })), []);
  });

  it('treats any multi-value enum in a specter-identity schema as a taxonomy', () => {
    const withEnum = schema({ properties: { contractVersion: { type: 'integer', const: 1 }, state: { type: 'string', enum: ['draft', 'accepted'] } } });
    assert.ok(rules(withEnum, { owner: 'specter-identity' }).includes('identity-enum'));
    assert.deepEqual(rules(withEnum, { owner: 'work-ledger' }), []);
  });
});

describe('forEachSchema', () => {
  it('visits nested schemas and ignores non-objects', () => {
    /** @type {string[]} */
    const seen = [];
    forEachSchema({ properties: { a: { items: [{ type: 'string' }] } }, oneOf: [{ not: {} }] }, (_node, pointer) => seen.push(pointer));
    assert.deepEqual(seen, ['', '/properties/a', '/properties/a/items/0', '/oneOf/0', '/oneOf/0/not']);
    forEachSchema('text', () => assert.fail('not a schema'));
  });
});

describe('sqlFindings', () => {
  it('flags denied identifiers in tables, columns and indexes', () => {
    const names = sqlFindings('m.sql', 'CREATE TABLE store_meta (store_id TEXT, specter_class TEXT); CREATE INDEX ix_tier ON store_meta(store_id);').map((finding) => finding.name);
    assert.deepEqual(names, ['specter_class', 'ix_tier']);
  });

  it('ignores comments and string literals', () => {
    assert.deepEqual(sqlFindings('m.sql', "-- archetype\n/* role */ INSERT INTO t VALUES ('species', 'it''s a rank');"), []);
  });
});

describe('parseOwners and parseExemptions', () => {
  it('reads owner rows and ignores other lines', () => {
    assert.deepEqual([...parseOwners(OWNERS_TEXT)], [['thing.v1', { owner: 'work-ledger', status: 'DRAFT' }]]);
  });

  it('accepts complete exemptions and reports incomplete ones', () => {
    const ok = { file: 'f', name: 'n', reason: 'r', approvedBy: 'Eric' };
    assert.deepEqual(parseExemptions({ version: 1, exemptions: [ok] }), { problems: [], exemptions: [{ file: 'f', name: 'n' }] });
    assert.deepEqual(parseExemptions({ version: 1, exemptions: [{ file: 'f' }] }).problems, ['guard-exemptions.json: exemptions[0] needs file, name, reason and approvedBy']);
    assert.equal(parseExemptions({ version: 2 }).problems.length, 1);
  });
});

describe('caseProblems', () => {
  const listing = (/** @type {Record<string, string[]>} */ dirs) => (/** @type {string} */ sub) => dirs[sub] ?? [];

  it('accepts a consistent case list', () => {
    const cases = JSON.stringify([{ file: 'valid/a.json', valid: true }, { file: 'invalid/b.json', valid: false, instancePath: '' }]);
    assert.deepEqual(caseProblems('d', 'L', cases, listing({ valid: ['a.json'], invalid: ['b.json'] }), () => true), []);
  });

  it('rejects malformed lists, missing files, wrong folders and bad pointers', () => {
    assert.deepEqual(caseProblems('d', 'L', '{', listing({}), () => true), ['L: cases.json is not valid JSON']);
    assert.deepEqual(caseProblems('d', 'L', '{}', listing({}), () => true), ['L: cases.json must be a list']);
    const bad = JSON.stringify([
      { file: 1, valid: true },
      { file: 'invalid/a.json', valid: true, instancePath: '/x' },
      { file: 'invalid/c.json', valid: false, instancePath: 'x' },
    ]);
    const problems = caseProblems('d', 'L', bad, listing({}), () => false);
    for (const expected of ['every case needs', 'must live under valid/', 'does not exist', 'must not carry instancePath', 'must be a JSON Pointer']) {
      assert.ok(problems.some((problem) => problem.includes(expected)), expected);
    }
    const empty = caseProblems('d', 'L', '[]', listing({}), () => true);
    assert.deepEqual(empty, ['L: needs at least one valid case', 'L: needs at least one invalid case']);
  });

  it('reports a case file nobody listed', () => {
    const cases = JSON.stringify([{ file: 'valid/a.json', valid: true }, { file: 'invalid/b.json', valid: false }]);
    assert.deepEqual(caseProblems('d', 'L', cases, listing({ valid: ['a.json', 'extra.json', 'notes.txt'], invalid: ['b.json'] }), () => true), ['L: valid/extra.json is not listed in cases.json']);
  });
});

describe('futureMajorProblems', () => {
  const cases = JSON.stringify([{ file: 'valid/a.json', valid: true }, { file: 'invalid/v2.json', valid: false }]);
  it('accepts an invalid case that names the next major', () => {
    assert.deepEqual(futureMajorProblems('d', 'L', cases, 1, () => '{"contractVersion":2}'), []);
  });
  it('fails when no invalid case names the next major (positive control)', () => {
    assert.deepEqual(futureMajorProblems('d', 'L', cases, 1, () => '{"contractVersion":1}'), ['L: needs an invalid case whose body has contractVersion 2 (VERSIONING.md rule 5)']);
  });
  it('ignores a valid case that names it, an unreadable body and a body that is not an object', () => {
    const onlyValid = JSON.stringify([{ file: 'valid/a.json', valid: true }]);
    assert.equal(futureMajorProblems('d', 'L', onlyValid, 1, () => '{"contractVersion":2}').length, 1);
    assert.equal(futureMajorProblems('d', 'L', cases, 1, () => { throw new Error('x'); }).length, 1);
    assert.equal(futureMajorProblems('d', 'L', cases, 1, () => '[2]').length, 1);
    assert.equal(futureMajorProblems('d', 'L', JSON.stringify([null, { valid: false }]), 1, () => '{"contractVersion":2}').length, 1);
  });
  it('leaves an unparseable or non-list cases file to caseProblems', () => {
    assert.deepEqual(futureMajorProblems('d', 'L', '{', 1, () => ''), []);
    assert.deepEqual(futureMajorProblems('d', 'L', '{}', 1, () => ''), []);
  });
});

describe('run', () => {
  it('passes a conforming tree', () => {
    assert.deepEqual(runLogged(tree()), { code: 0, lines: ['check:schema: 1 schema(s) and 0 migration(s) ok'] });
  });

  it('is clean for an empty contracts tree except for the required files', () => {
    failsWith(runLogged(mkdtempSync(join(tmp, 'empty-'))), /contracts\/OWNERS\.md is missing/);
  });

  it('fails on a denied property name (FP-02-AC06 positive control)', () => {
    const bad = schema({ properties: { contractVersion: { type: 'integer', const: 1 }, archetype: { type: 'string' } } });
    failsWith(runLogged(tree({ [FILE]: JSON.stringify(bad) })), /archetype.*denied token "archetype".*\[denied-name\]/);
  });

  it('fails on a denied identifier in a store migration (positive control)', () => {
    const files = { 'backend/specter_arena/store/migrations/0001_baseline.sql': 'CREATE TABLE bots (id TEXT, species TEXT);' };
    failsWith(runLogged(tree(files)), /0001_baseline\.sql: identifier "species".*\[sql-denied\]/);
  });

  it('passes a clean migration and fails when the store exists without migrations', () => {
    assert.equal(runLogged(tree({ 'backend/specter_arena/store/migrations/0001_baseline.sql': 'CREATE TABLE store_meta (store_id TEXT);' })).code, 0);
    failsWith(runLogged(tree({ 'backend/specter_arena/store/__init__.py': '' })), /holds no \.sql file/);
  });

  it('honours an approved exemption and reports an unused one', () => {
    const bad = schema({ properties: { contractVersion: { type: 'integer', const: 1 }, tier: { type: 'string' } } });
    const exemption = { file: FILE, name: 'tier', reason: 'billing tier of the host, not a character', approvedBy: 'Eric' };
    const exempt = JSON.stringify({ version: 1, exemptions: [exemption] });
    assert.equal(runLogged(tree({ [FILE]: JSON.stringify(bad), 'contracts/guard-exemptions.json': exempt })).code, 0);
    failsWith(runLogged(tree({ 'contracts/guard-exemptions.json': exempt })), /matches nothing/);
  });

  it('never lets an exemption waive a structural rule', () => {
    const bad = schema({ additionalProperties: true });
    const exempt = JSON.stringify({ version: 1, exemptions: [{ file: FILE, name: '', reason: 'r', approvedBy: 'Eric' }] });
    failsWith(runLogged(tree({ [FILE]: JSON.stringify(bad), 'contracts/guard-exemptions.json': exempt })), /\[open-object\]/);
  });

  it('fails on an invalid exemptions file', () => {
    failsWith(runLogged(tree({ 'contracts/guard-exemptions.json': '{"version":1,"exemptions":[{}]}' })), /exemptions\[0\] needs/);
  });

  it('fails on OWNERS.md drift in both directions and on an unknown owner', () => {
    failsWith(runLogged(tree({ 'contracts/OWNERS.md': '' })), /has no row for thing\.v1/);
    failsWith(runLogged(tree({ 'contracts/OWNERS.md': `${OWNERS_TEXT}| \`ghost\` | 1 | work-ledger | DRAFT | x |\n` })), /ghost\.v1, which has no schema file/);
    failsWith(runLogged(tree({ 'contracts/OWNERS.md': OWNERS_TEXT.replace('work-ledger', 'someone') })), /known owner/);
  });

  it('fails on a specter-identity schema with a closed list (FP-05 plug-in control)', () => {
    const bad = schema({ properties: { contractVersion: { type: 'integer', const: 1 }, state: { type: 'string', enum: ['draft', 'accepted'] } } });
    failsWith(runLogged(tree({ [FILE]: JSON.stringify(bad), 'contracts/OWNERS.md': OWNERS_TEXT.replace('work-ledger', 'specter-identity') })), /\[identity-enum\]/);
  });

  it('fails on missing, unparseable and unlisted case data', () => {
    failsWith(runLogged(tree({ 'contracts/cases/thing/v1/cases.json': null })), /cases\.json is missing/);
    failsWith(runLogged(tree({ 'contracts/cases/thing/v1/valid/extra.json': '{}' })), /extra\.json is not listed/);
  });

  it('fails when a schema has no future-major case (positive control)', () => {
    const files = { 'contracts/cases/thing/v1/cases.json': JSON.stringify([{ file: 'valid/a.json', valid: true }, { file: 'invalid/b.json', valid: false }]), 'contracts/cases/thing/v1/invalid/v2.json': null };
    failsWith(runLogged(tree(files)), /needs an invalid case whose body has contractVersion 2/);
  });

  it('fails on a duplicate $id, an unparseable schema and a schema Ajv rejects', () => {
    const copy = JSON.stringify(schema());
    failsWith(runLogged(tree({ 'contracts/schemas/other.v1.schema.json': copy, 'contracts/OWNERS.md': `${OWNERS_TEXT}| \`other\` | 1 | work-ledger | DRAFT | x |\n` })), /duplicate \$id/);
    failsWith(runLogged(tree({ [FILE]: '{' })), /is not valid JSON/);
    const strict = schema({ properties: { contractVersion: { type: 'integer', const: 1 }, n: { type: 'integer', pattern: 'x' } }, madeUpKeyword: true });
    failsWith(runLogged(tree({ [FILE]: JSON.stringify(strict) })), /madeUpKeyword|strict mode/);
  });

  it('fails on a $ref to a schema nobody registered', () => {
    const dangling = schema({ properties: { contractVersion: { type: 'integer', const: 1 }, other: { $ref: 'urn:specter-arena:contract:nothing:v1' } } });
    failsWith(runLogged(tree({ [FILE]: JSON.stringify(dangling) })), /can't resolve reference|nothing:v1/);
  });

  it('passes on the committed repository', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ log: (line) => lines.push(line) }), 0, lines.join('\n'));
  });
});
