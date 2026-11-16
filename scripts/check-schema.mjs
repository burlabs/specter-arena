import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Ajv } from 'ajv';

export const CONTRACTS_DIR = 'contracts';
export const STORE_DIR = 'backend/specter_arena/store';
export const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';
export const ID_PREFIX = 'urn:specter-arena:contract:';
export const SCHEMA_FILE = /^(?<name>[a-z][a-z0-9-]*)\.v(?<major>[1-9][0-9]*)\.schema\.json$/;
export const OWNERS = ['crew-integration', 'work-ledger', 'specter-identity', 'experience', 'delivery'];
export const OWNER_STATUSES = ['DRAFT', 'FROZEN'];
/** FP-02-AC06: whole-token matches, case-insensitive, after splitting camelCase, `_` and `-`. */
export const DENIED_TOKENS = new Set([
  'class', 'classes', 'archetype', 'archetypes', 'species', 'category', 'categories', 'taxonomy',
  'role', 'roles', 'rarity', 'tier', 'rank', 'score', 'scores', 'rating', 'classifier', 'classification',
  'capability', 'capabilities', 'alignment', 'element', 'specialty', 'specialization',
]);
const NAME_SHAPE = /^[a-z][A-Za-z0-9]*$/;
const POINTER = /^(?:\/[^/]*)*$/;
const SCHEMA_MAPS = ['properties', 'patternProperties', 'definitions', '$defs'];
const SCHEMA_SINGLE = ['items', 'additionalProperties', 'additionalItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else'];
const SCHEMA_LISTS = ['allOf', 'anyOf', 'oneOf', 'items'];
/** Rules an approved exemption may waive; the structural rules can never be waived. */
const EXEMPTABLE = ['denied-name', 'denied-enum', 'identity-enum', 'sql-denied'];

/**
 * @typedef {Record<string, unknown>} Json
 * @typedef {{ file: string, rule: string, pointer: string, name: string, message: string }} Finding
 */

/**
 * @param {unknown} value
 * @returns {value is Json}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} name
 * @returns {string[]} lower-case tokens
 */
export function tokens(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token !== '')
    .map((token) => token.toLowerCase());
}

/**
 * @param {string} name
 * @returns {string | undefined} the first denied token in the name
 */
export function deniedToken(name) {
  return tokens(name).find((token) => DENIED_TOKENS.has(token));
}

/**
 * Visits every subschema with its JSON Pointer. Property names are data, not keywords, so a
 * property called `format` is not mistaken for the `format` keyword.
 * @param {unknown} node
 * @param {(schema: Json, pointer: string) => void} visit
 * @param {string} [pointer]
 */
export function forEachSchema(node, visit, pointer = '') {
  if (!isRecord(node)) return;
  visit(node, pointer);
  for (const key of SCHEMA_MAPS) {
    const map = node[key];
    if (isRecord(map)) for (const [name, child] of Object.entries(map)) forEachSchema(child, visit, `${pointer}/${key}/${name}`);
  }
  for (const key of SCHEMA_SINGLE) forEachSchema(node[key], visit, `${pointer}/${key}`);
  for (const key of SCHEMA_LISTS) {
    const list = node[key];
    if (Array.isArray(list)) list.forEach((child, index) => forEachSchema(child, visit, `${pointer}/${key}/${index}`));
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Structural and AC06 findings for one schema document.
 * @param {string} file path used in findings
 * @param {unknown} schema parsed schema
 * @param {{ owner?: string }} [options] owner from OWNERS.md; specter-identity schemas may not carry closed lists
 * @returns {Finding[]}
 */
export function schemaFindings(file, schema, { owner } = {}) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {(rule: string, pointer: string, name: string, message: string) => void} */
  const add = (rule, pointer, name, message) => findings.push({ file, rule, pointer, name, message });
  if (!isRecord(schema)) return [{ file, rule: 'schema-shape', pointer: '', name: '', message: 'schema must be an object' }];
  const match = SCHEMA_FILE.exec(file.split('/').pop() ?? '');
  if (match?.groups === undefined) {
    add('file-name', '', '', 'file name must be <name>.v<N>.schema.json');
  } else {
    const { name, major } = match.groups;
    if (schema.$schema !== DRAFT_07) add('dialect', '/$schema', '', `$schema must be ${DRAFT_07}`);
    if (schema.$id !== `${ID_PREFIX}${name}:v${major}`) add('id', '/$id', '', `$id must be ${ID_PREFIX}${name}:v${major}`);
    const version = isRecord(schema.properties) ? schema.properties.contractVersion : undefined;
    if (!isRecord(version) || version.type !== 'integer' || version.const !== Number(major) || !strings(schema.required).includes('contractVersion')) {
      add('contract-version', '/properties/contractVersion', '', `must require contractVersion as {type: integer, const: ${major}}`);
    }
  }
  if (typeof schema.title !== 'string' || schema.title === '') add('title', '/title', '', 'title is required');
  if (schema.type !== 'object') add('root-type', '/type', '', 'the root must be type object');
  forEachSchema(schema, (node, pointer) => {
    if ('format' in node) add('format-keyword', `${pointer}/format`, 'format', 'format is not asserted the same way in every validator; use pattern');
    if (isRecord(node.properties)) {
      // if/then/else fragments constrain the same instance as their parent, so they stay open.
      if (node.additionalProperties !== false && !/\/(?:if|then|else)$/.test(pointer)) add('open-object', pointer, '', 'an object with properties must set additionalProperties to false');
      for (const name of Object.keys(node.properties)) {
        if (!NAME_SHAPE.test(name)) add('property-name-shape', `${pointer}/properties/${name}`, name, 'property names are camelCase letters and digits');
      }
    }
    if (Array.isArray(node.allOf) && (node.additionalProperties === false || node.allOf.some((branch) => isRecord(branch) && branch.additionalProperties === false))) {
      add('allof-closed', pointer, '', 'allOf with additionalProperties false rejects every branch; compose by $ref to a closed sub-schema');
    }
    if (typeof node.$ref === 'string' && !node.$ref.startsWith(ID_PREFIX) && !node.$ref.startsWith('#/definitions/')) {
      add('ref-form', `${pointer}/$ref`, node.$ref, '$ref must be a contract $id or a local #/definitions pointer');
    }
    const numericOrBoolean = [node.const, ...(Array.isArray(node.enum) ? node.enum : [])].some((value) => typeof value === 'number' || typeof value === 'boolean');
    if (numericOrBoolean && node.type === undefined) add('untyped-const', pointer, '', 'a numeric or boolean const/enum needs a type (Python treats true == 1)');
    for (const name of [...Object.keys(isRecord(node.properties) ? node.properties : {}), ...Object.keys(isRecord(node.definitions) ? node.definitions : {}), ...Object.keys(isRecord(node.$defs) ? node.$defs : {}), ...strings(node.required)]) {
      const token = deniedToken(name);
      if (token !== undefined) add('denied-name', `${pointer}/${name}`, name, `"${name}" contains the denied token "${token}" (FP-02-AC06)`);
    }
    for (const value of [...strings(node.enum), ...strings([node.const])]) {
      const token = deniedToken(value);
      if (token !== undefined) add('denied-enum', pointer, value, `enum value "${value}" contains the denied token "${token}" (FP-02-AC06)`);
    }
    if (owner === 'specter-identity' && Array.isArray(node.enum) && node.enum.length > 1) {
      add('identity-enum', pointer, pointer.split('/').filter((part) => part !== '').pop() ?? '', 'a closed list in an identity schema is a taxonomy; needs a reviewed exemption');
    }
  });
  return findings;
}

/**
 * Identifier tokens in a migration; comments and string literals are ignored.
 * @param {string} file
 * @param {string} sql
 * @returns {Finding[]}
 */
export function sqlFindings(file, sql) {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  const names = new Set(stripped.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  return [...names].flatMap((name) => {
    const token = deniedToken(name);
    return token === undefined ? [] : [{ file, rule: 'sql-denied', pointer: '', name, message: `identifier "${name}" contains the denied token "${token}" (FP-02-AC06)` }];
  });
}

/**
 * @param {string} markdown OWNERS.md
 * @returns {Map<string, { owner: string, status: string }>} keyed by `<name>.v<N>`
 */
export function parseOwners(markdown) {
  /** @type {Map<string, { owner: string, status: string }>} */
  const rows = new Map();
  for (const line of markdown.split('\n')) {
    const cells = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*([1-9][0-9]*)\s*\|\s*([\w-]+)\s*\|\s*([A-Z]+)\s*\|/.exec(line);
    if (cells) rows.set(`${cells[1]}.v${cells[2]}`, { owner: cells[3] ?? '', status: cells[4] ?? '' });
  }
  return rows;
}

/**
 * @param {unknown} doc parsed guard-exemptions.json
 * @returns {{ problems: string[], exemptions: { file: string, name: string }[] }}
 */
export function parseExemptions(doc) {
  /** @type {string[]} */
  const problems = [];
  if (!isRecord(doc) || doc.version !== 1 || !Array.isArray(doc.exemptions)) {
    return { problems: ['guard-exemptions.json must be {"version": 1, "exemptions": [...]}'], exemptions: [] };
  }
  const exemptions = doc.exemptions.flatMap((entry, index) => {
    const complete = isRecord(entry) && ['file', 'name', 'reason', 'approvedBy'].every((key) => typeof entry[key] === 'string' && entry[key] !== '');
    if (!complete) {
      problems.push(`guard-exemptions.json: exemptions[${index}] needs file, name, reason and approvedBy`);
      return [];
    }
    return [{ file: String(entry.file), name: String(entry.name) }];
  });
  return { problems, exemptions };
}

/**
 * @param {string} dir directory holding cases.json and valid/ invalid/
 * @param {string} label
 * @param {string} cases text of cases.json
 * @param {(sub: string) => string[]} listDir file names under `valid` or `invalid`
 * @param {(file: string) => boolean} exists
 * @returns {string[]}
 */
export function caseProblems(dir, label, cases, listDir, exists) {
  /** @type {unknown} */
  let entries;
  try {
    entries = JSON.parse(cases);
  } catch {
    return [`${label}: cases.json is not valid JSON`];
  }
  if (!Array.isArray(entries)) return [`${label}: cases.json must be a list`];
  /** @type {string[]} */
  const problems = [];
  const listed = new Set();
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.file !== 'string' || typeof entry.valid !== 'boolean') {
      problems.push(`${label}: every case needs a string file and a boolean valid`);
      continue;
    }
    const file = entry.file;
    listed.add(file);
    if (!file.startsWith(entry.valid ? 'valid/' : 'invalid/') || file.includes('..')) problems.push(`${label}: ${file} must live under ${entry.valid ? 'valid' : 'invalid'}/`);
    if (!exists(join(dir, file))) problems.push(`${label}: ${file} does not exist`);
    if (entry.valid && entry.instancePath !== undefined) problems.push(`${label}: valid case ${file} must not carry instancePath`);
    if (entry.instancePath !== undefined && (typeof entry.instancePath !== 'string' || !POINTER.test(entry.instancePath))) problems.push(`${label}: ${file} instancePath must be a JSON Pointer`);
  }
  if (!entries.some((entry) => isRecord(entry) && entry.valid === true)) problems.push(`${label}: needs at least one valid case`);
  if (!entries.some((entry) => isRecord(entry) && entry.valid === false)) problems.push(`${label}: needs at least one invalid case`);
  for (const sub of ['valid', 'invalid']) {
    for (const name of listDir(sub)) if (name.endsWith('.json') && !listed.has(`${sub}/${name}`)) problems.push(`${label}: ${sub}/${name} is not listed in cases.json`);
  }
  return problems;
}

/**
 * VERSIONING.md rule 5: a newer-than-known major fails closed, so each schema needs an invalid case
 * whose body names the next major.
 * @param {string} dir directory holding cases.json and valid/ invalid/
 * @param {string} label
 * @param {string} cases text of cases.json
 * @param {number} major the schema's major version
 * @param {(file: string) => string} read file text
 * @returns {string[]}
 */
export function futureMajorProblems(dir, label, cases, major, read) {
  /** @type {unknown} */
  let entries;
  try {
    entries = JSON.parse(cases);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const found = entries.some((entry) => {
    if (!isRecord(entry) || entry.valid !== false || typeof entry.file !== 'string') return false;
    try {
      const body = JSON.parse(read(join(dir, entry.file)));
      return isRecord(body) && body.contractVersion === major + 1;
    } catch {
      return false;
    }
  });
  return found ? [] : [`${label}: needs an invalid case whose body has contractVersion ${major + 1} (VERSIONING.md rule 5)`];
}

/**
 * @param {string} root
 * @param {string} path
 * @returns {string[]}
 */
function listNames(root, path) {
  const full = join(root, path);
  return existsSync(full) ? readdirSync(full).sort() : [];
}

/**
 * @param {{ root?: string, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ root = '.', log = console.log } = {}) {
  const contracts = join(root, CONTRACTS_DIR);
  /** @type {string[]} */
  const problems = [];
  const schemaNames = listNames(root, `${CONTRACTS_DIR}/schemas`).filter((name) => name.endsWith('.json'));
  const ownersPath = join(contracts, 'OWNERS.md');
  const owners = parseOwners(existsSync(ownersPath) ? readFileSync(ownersPath, 'utf8') : '');
  for (const required of ['OWNERS.md', 'VERSIONING.md', 'guard-exemptions.json']) {
    if (!existsSync(join(contracts, required))) problems.push(`${CONTRACTS_DIR}/${required} is missing`);
  }
  const exemptionsPath = join(contracts, 'guard-exemptions.json');
  const parsedExemptions = existsSync(exemptionsPath)
    ? parseExemptions(JSON.parse(readFileSync(exemptionsPath, 'utf8')))
    : { problems: [], exemptions: [] };
  problems.push(...parsedExemptions.problems);

  /** @type {Finding[]} */
  const findings = [];
  const ajv = new Ajv({ strict: true });
  /** @type {Map<string, Json>} */
  const parsed = new Map();
  for (const name of schemaNames) {
    const file = `${CONTRACTS_DIR}/schemas/${name}`;
    try {
      const schema = JSON.parse(readFileSync(join(root, file), 'utf8'));
      parsed.set(name, schema);
    } catch {
      problems.push(`${file} is not valid JSON`);
    }
  }
  /** @type {Set<string>} */
  const ids = new Set();
  for (const [name, schema] of parsed) {
    const id = String(schema.$id);
    if (ids.has(id)) problems.push(`${CONTRACTS_DIR}/schemas/${name}: duplicate $id ${id}`);
    ids.add(id);
    try {
      ajv.addSchema(schema);
    } catch (error) {
      problems.push(`${CONTRACTS_DIR}/schemas/${name}: ${error instanceof Error ? error.message : 'cannot be added'}`);
    }
  }
  for (const [name, schema] of parsed) {
    const file = `${CONTRACTS_DIR}/schemas/${name}`;
    const key = name.replace(/\.schema\.json$/, '');
    const owner = owners.get(key);
    findings.push(...schemaFindings(file, schema, { owner: owner?.owner }));
    try {
      ajv.getSchema(String(schema.$id));
    } catch (error) {
      problems.push(`${file}: ${error instanceof Error ? error.message : 'does not compile'}`);
    }
    if (owner === undefined) problems.push(`${CONTRACTS_DIR}/OWNERS.md has no row for ${key}`);
    else if (!OWNERS.includes(owner.owner) || !OWNER_STATUSES.includes(owner.status)) problems.push(`${CONTRACTS_DIR}/OWNERS.md: ${key} needs a known owner and DRAFT or FROZEN`);
    const match = SCHEMA_FILE.exec(name);
    if (match?.groups !== undefined) {
      const caseDir = `${CONTRACTS_DIR}/cases/${match.groups.name}/v${match.groups.major}`;
      const casesFile = join(root, caseDir, 'cases.json');
      if (!existsSync(casesFile)) problems.push(`${caseDir}/cases.json is missing`);
      else {
        const casesText = readFileSync(casesFile, 'utf8');
        problems.push(...caseProblems(join(root, caseDir), caseDir, casesText, (sub) => listNames(root, `${caseDir}/${sub}`), existsSync));
        problems.push(...futureMajorProblems(join(root, caseDir), caseDir, casesText, Number(match.groups.major), (file) => readFileSync(file, 'utf8')));
      }
    }
  }
  for (const key of owners.keys()) {
    if (!parsed.has(`${key}.schema.json`)) problems.push(`${CONTRACTS_DIR}/OWNERS.md lists ${key}, which has no schema file`);
  }
  const storeDir = join(root, STORE_DIR);
  const migrationsDir = `${STORE_DIR}/migrations`;
  const migrations = listNames(root, migrationsDir).filter((name) => name.endsWith('.sql'));
  if (existsSync(storeDir) && migrations.length === 0) problems.push(`${STORE_DIR} exists but ${migrationsDir} holds no .sql file; the guard would scan nothing`);
  for (const name of migrations) findings.push(...sqlFindings(`${migrationsDir}/${name}`, readFileSync(join(root, migrationsDir, name), 'utf8')));

  const used = new Set();
  for (const finding of findings) {
    const exemption = parsedExemptions.exemptions.find((entry) => entry.file === finding.file && entry.name === finding.name);
    if (exemption !== undefined && EXEMPTABLE.includes(finding.rule)) {
      used.add(`${exemption.file}\u0000${exemption.name}`);
      continue;
    }
    problems.push(`${finding.file}${finding.pointer === '' ? '' : ` ${finding.pointer}`}: ${finding.message} [${finding.rule}]`);
  }
  for (const entry of parsedExemptions.exemptions) {
    if (!used.has(`${entry.file}\u0000${entry.name}`)) problems.push(`guard-exemptions.json: ${entry.file} ${entry.name} matches nothing; remove it`);
  }
  for (const problem of problems) log(`check:schema: ${problem}`);
  if (problems.length > 0) return 1;
  log(`check:schema: ${schemaNames.length} schema(s) and ${migrations.length} migration(s) ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
