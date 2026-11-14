import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATES = ['ALLOWED', 'DENIED', 'UNSUPPORTED', 'UNTESTED'];
export const CREDENTIALS = ['APP-TOKEN', 'OWNER-SESSION'];
export const SCOPES = ['app-owned', 'user-owned', 'other-app', 'bot', 'external-cli'];
export const FACT_STATUSES = ['OBSERVED', 'NOT-OBSERVED', 'UNTESTED'];
export const KINDS = ['matrix', 'host-fact'];
export const PRIORITIES = ['must', 'best-effort', 'deferred'];
/** FP-01 evidence was captured on this host; an entry without `hostVersion` is read as this version. */
export const LEGACY_HOST_VERSION = '0.12.0';
export const COMPATIBILITY_DIR = 'docs/compatibility';
export const EVIDENCE_ROOT = `${COMPATIBILITY_DIR}/evidence`;
/** First path segment under the evidence root of every FP-01 run; new runs are not on this list. */
export const LEGACY_EVIDENCE = ['L1', 'L2', 'L3-v0', 'L3-v1', 'L3-v1b', 'README.md', 'SUMMARY.md'];
const RECORD_FILE = /^crew-(\d+\.\d+\.\d+)\.md$/;

/**
 * @typedef {Record<string, unknown>} Json
 * @typedef {{
 *   evidenceExists: (file: string) => boolean,
 *   markdown: string,
 *   knownVersions?: string[],
 *   recordTexts?: Record<string, string>,
 * }} Context
 * `knownVersions` lists the hosts that have a docs/compatibility/crew-<version>.md record; `recordTexts` maps
 * each version to the text of that record. Both default to the FP-01 host alone.
 */

/**
 * @param {unknown} value
 * @returns {value is Json}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {Json[]}
 */
function records(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * An evidence reference is a relative path under the evidence root; a `#fragment` is allowed and stripped.
 * @param {unknown} ref
 * @returns {string | null} the file path, or null when the reference is not acceptable
 */
export function evidencePath(ref) {
  if (typeof ref !== 'string') return null;
  const file = posix.normalize(ref.split('#')[0] ?? '');
  return file.startsWith(`${EVIDENCE_ROOT}/`) && !file.includes('..') ? file : null;
}

/**
 * @param {unknown} ref
 * @returns {boolean} true when the reference points into an FP-01 (host 0.12.0) evidence run
 */
function isLegacyEvidence(ref) {
  const file = evidencePath(ref);
  return file !== null && LEGACY_EVIDENCE.includes(file.slice(EVIDENCE_ROOT.length + 1).split('/')[0] ?? '');
}

/**
 * @param {string} left dotted version
 * @param {string} right dotted version
 * @returns {number} negative, zero or positive
 */
export function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The host an entry was observed on. An entry that declares none is FP-01 evidence, and the
 * evidence refs prove it; anything newer must say which host it ran on.
 * @param {string} id
 * @param {Json} entry cell or fact
 * @param {unknown[]} refs evidence refs of the entry
 * @param {string[]} knownVersions
 * @param {string[]} problems
 * @returns {string} the effective host version
 */
function entryVersion(id, entry, refs, knownVersions, problems) {
  const declared = entry.hostVersion;
  if (declared === undefined) {
    if (!refs.every(isLegacyEvidence)) problems.push(`${id}: hostVersion is required unless all evidence is FP-01 evidence (${LEGACY_HOST_VERSION})`);
    return LEGACY_HOST_VERSION;
  }
  if (typeof declared !== 'string' || !knownVersions.includes(declared)) {
    problems.push(`${id}: hostVersion ${String(declared)} has no ${COMPATIBILITY_DIR}/crew-<version>.md record`);
    return LEGACY_HOST_VERSION;
  }
  return declared;
}

/**
 * @param {unknown} ref
 * @param {(file: string) => boolean} evidenceExists
 */
function evidenceProblem(ref, evidenceExists) {
  const file = evidencePath(ref);
  return file === null || !evidenceExists(file);
}

/**
 * @param {unknown} doc parsed capability-questions.json
 * @returns {string[]} problems; empty means valid
 */
export function validateQuestions(doc) {
  if (!isRecord(doc)) return ['capability-questions.json must be an object'];
  /** @type {string[]} */
  const problems = [];
  if (doc.version !== 1) problems.push('capability-questions.json version must be 1');
  const questions = records(doc.questions);
  if (!Array.isArray(doc.questions) || questions.length !== doc.questions.length) problems.push('questions must be a list of objects');
  const seen = new Set();
  let previous = '';
  for (const question of questions) {
    const id = String(question.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) problems.push(`${id}: id must be kebab-case`);
    if (seen.has(id)) problems.push(`duplicate question ${id}`);
    seen.add(id);
    if (id < previous) problems.push(`${id}: questions must be sorted by id`);
    previous = id;
    if (!KINDS.includes(String(question.kind))) problems.push(`${id}: invalid kind ${String(question.kind)}`);
    if (question.kind === 'matrix' && !SCOPES.includes(String(question.scope))) problems.push(`${id}: matrix question needs a valid scope`);
    if (question.kind === 'host-fact' && question.scope !== undefined) problems.push(`${id}: host-fact question must not have a scope`);
    if (typeof question.question !== 'string' || question.question === '') problems.push(`${id}: question text missing`);
    if (!PRIORITIES.includes(String(question.priority))) problems.push(`${id}: invalid priority ${String(question.priority)}`);
  }
  return problems;
}

/**
 * @param {Json[]} questions
 * @param {string} kind
 * @returns {string[]}
 */
function idsOfKind(questions, kind) {
  return questions.filter((question) => question.kind === kind).map((question) => String(question.id));
}

/**
 * @param {Json} matrix parsed capability-matrix.json
 * @param {Json[]} questions entries of capability-questions.json
 * @param {Context} context
 * @returns {string[]} problems; empty means valid
 */
export function validateMatrix(matrix, questions, { evidenceExists, markdown, knownVersions = [LEGACY_HOST_VERSION] }) {
  /** @type {string[]} */
  const problems = [];
  const latest = String(matrix.hostVersion);
  if (!knownVersions.includes(latest)) problems.push(`hostVersion must be ${knownVersions.join(' or ')}, got ${latest}`);
  const wanted = idsOfKind(questions, 'matrix');
  /** @type {Map<string, Json>} */
  const byId = new Map();
  for (const cell of records(matrix.cells)) {
    const id = String(cell.id);
    if (byId.has(id)) problems.push(`duplicate cell ${id}`);
    byId.set(id, cell);
    if (!STATES.includes(String(cell.state))) problems.push(`${id}: invalid state ${String(cell.state)}`);
    if (!SCOPES.includes(String(cell.scope))) problems.push(`${id}: invalid scope ${String(cell.scope)}`);
    if (cell.state === 'UNTESTED') {
      if (cell.hostVersion !== undefined) problems.push(`${id}: UNTESTED must not declare hostVersion`);
      if (!cell.notes) problems.push(`${id}: UNTESTED needs notes saying why`);
      if (cell.credential !== null || cell.evidenceRef !== null || cell.probedAt !== null) {
        problems.push(`${id}: UNTESTED must have null credential, evidenceRef and probedAt`);
      }
      continue;
    }
    const version = entryVersion(id, cell, [cell.evidenceRef], knownVersions, problems);
    if (compareVersions(version, latest) > 0) problems.push(`${id}: hostVersion ${version} is newer than the matrix hostVersion ${latest}`);
    if (!CREDENTIALS.includes(String(cell.credential))) problems.push(`${id}: ${String(cell.state)} needs a credential label`);
    if (cell.state === 'ALLOWED' && cell.credential !== 'APP-TOKEN') problems.push(`${id}: ALLOWED requires APP-TOKEN evidence`);
    if (typeof cell.probedAt !== 'string' || cell.probedAt === '') problems.push(`${id}: ${String(cell.state)} needs probedAt`);
    if (evidenceProblem(cell.evidenceRef, evidenceExists)) problems.push(`${id}: evidenceRef missing or not under ${EVIDENCE_ROOT}`);
  }
  for (const id of wanted) if (!byId.has(id)) problems.push(`question ${id} has no cell`);
  for (const id of byId.keys()) if (!wanted.includes(id)) problems.push(`cell ${id} is not a matrix question in capability-questions.json`);
  for (const [id, cell] of byId) {
    if (!markdown.includes(`| \`${id}\` | ${String(cell.state)} |`)) problems.push(`capability-matrix.md disagrees for ${id}`);
  }
  return problems;
}

/**
 * Host facts describe mechanisms, not permissions, so either credential may support one.
 * @param {Json} doc parsed host-facts.json
 * @param {Json[]} questions entries of capability-questions.json
 * @param {Context} context
 * @returns {string[]} problems; empty means valid
 */
export function validateHostFacts(doc, questions, { evidenceExists, markdown, knownVersions = [LEGACY_HOST_VERSION], recordTexts = { [LEGACY_HOST_VERSION]: markdown } }) {
  /** @type {string[]} */
  const problems = [];
  const latest = String(doc.hostVersion);
  if (!knownVersions.includes(latest)) problems.push(`host-facts hostVersion must be ${knownVersions.join(' or ')}, got ${latest}`);
  const wanted = idsOfKind(questions, 'host-fact');
  /** @type {Map<string, Json>} */
  const byId = new Map();
  for (const fact of records(doc.facts)) {
    const id = String(fact.id);
    if (byId.has(id)) problems.push(`duplicate fact ${id}`);
    byId.set(id, fact);
    if (!FACT_STATUSES.includes(String(fact.status))) problems.push(`${id}: invalid status ${String(fact.status)}`);
    const items = records(fact.evidence);
    const version = entryVersion(id, fact, fact.status === 'UNTESTED' ? [] : items.map((item) => item.ref), knownVersions, problems);
    if (compareVersions(version, latest) > 0) problems.push(`${id}: hostVersion ${version} is newer than the host-facts hostVersion ${latest}`);
    if (fact.status === 'UNTESTED') {
      if (!fact.notes) problems.push(`${id}: UNTESTED needs notes saying why`);
    } else {
      if (items.length === 0) problems.push(`${id}: ${String(fact.status)} needs evidence`);
      for (const item of items) {
        if (!CREDENTIALS.includes(String(item.credential))) problems.push(`${id}: evidence needs a credential label`);
        if (evidenceProblem(item.ref, evidenceExists)) problems.push(`${id}: evidence ref missing or not under ${EVIDENCE_ROOT}`);
      }
    }
    if (!(recordTexts[version] ?? '').includes(`| \`${id}\` | ${String(fact.status)} |`)) problems.push(`crew-${version}.md disagrees for ${id}`);
  }
  for (const id of wanted) if (!byId.has(id)) problems.push(`host fact ${id} missing`);
  for (const id of byId.keys()) if (!wanted.includes(id)) problems.push(`fact ${id} is not a host-fact question in capability-questions.json`);
  return problems;
}

/**
 * Monitoring work stays blocked until the status line reads APPROVED with an approver and a date.
 * @param {string} text monitoring-scope.md
 * @returns {string[]} problems; empty means valid
 */
export function validateMonitoringScope(text) {
  const status = /^Status:[ \t]*(APPROVED|NOT APPROVED)[ \t]*$/m.exec(text)?.[1];
  if (status === undefined) return ['monitoring-scope.md needs a "Status: APPROVED" or "Status: NOT APPROVED" line'];
  if (status === 'NOT APPROVED') return [];
  return ['Approved by', 'Approved on']
    .filter((label) => !new RegExp(`^${label}:[ \\t]*\\S`, 'm').test(text))
    .map((label) => `APPROVED needs a "${label}:" line`);
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * A host version is known when `dir` holds its `crew-<version>.md` compatibility record.
 * @param {string} dir compatibility directory
 * @returns {string[]} known host versions; empty when the directory is absent
 */
export function knownHostVersions(dir) {
  return existsSync(dir) ? readdirSync(dir).flatMap((name) => RECORD_FILE.exec(name)?.[1] ?? []) : [];
}

/**
 * @param {{ root?: string, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ root = '.', log = console.log } = {}) {
  const dir = join(root, COMPATIBILITY_DIR);
  const files = {
    questions: join(dir, 'capability-questions.json'),
    matrix: join(dir, 'capability-matrix.json'),
    matrixMarkdown: join(dir, 'capability-matrix.md'),
    facts: join(dir, 'host-facts.json'),
    record: join(dir, `crew-${LEGACY_HOST_VERSION}.md`),
    scope: join(dir, 'monitoring-scope.md'),
  };
  const missing = Object.values(files).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    for (const file of missing) log(`check:matrix: ${file} not found`);
    return 1;
  }
  const evidenceExists = (/** @type {string} */ file) => existsSync(join(root, file));
  const knownVersions = knownHostVersions(dir);
  const recordTexts = Object.fromEntries(knownVersions.map((version) => [version, readFileSync(join(dir, `crew-${version}.md`), 'utf8')]));
  const questionsDoc = readJson(files.questions);
  const matrix = readJson(files.matrix);
  const facts = readJson(files.facts);
  const problems = validateQuestions(questionsDoc);
  if (problems.length === 0 && isRecord(questionsDoc) && isRecord(matrix) && isRecord(facts)) {
    const questions = records(questionsDoc.questions);
    problems.push(
      ...validateMatrix(matrix, questions, { evidenceExists, markdown: readFileSync(files.matrixMarkdown, 'utf8'), knownVersions }),
      ...validateHostFacts(facts, questions, { evidenceExists, markdown: recordTexts[LEGACY_HOST_VERSION] ?? '', knownVersions, recordTexts }),
      ...validateMonitoringScope(readFileSync(files.scope, 'utf8')),
    );
  } else if (problems.length === 0) {
    problems.push('capability-matrix.json and host-facts.json must be objects');
  }
  for (const problem of problems) log(`check:matrix: ${problem}`);
  if (problems.length > 0) return 1;
  log('check:matrix: capability matrix, host facts and monitoring scope ok');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
