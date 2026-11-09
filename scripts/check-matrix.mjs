import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATES = ['ALLOWED', 'DENIED', 'UNSUPPORTED', 'UNTESTED'];
export const CREDENTIALS = ['APP-TOKEN', 'OWNER-SESSION'];
export const SCOPES = ['app-owned', 'user-owned', 'other-app', 'bot', 'external-cli'];
export const FACT_STATUSES = ['OBSERVED', 'NOT-OBSERVED', 'UNTESTED'];
export const KINDS = ['matrix', 'host-fact'];
export const PRIORITIES = ['must', 'best-effort', 'deferred'];
export const HOST_VERSION = '0.12.0';
export const COMPATIBILITY_DIR = 'docs/compatibility';
export const EVIDENCE_ROOT = `${COMPATIBILITY_DIR}/evidence`;

/**
 * @typedef {Record<string, unknown>} Json
 * @typedef {{ evidenceExists: (file: string) => boolean, markdown: string }} Context
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
export function validateMatrix(matrix, questions, { evidenceExists, markdown }) {
  /** @type {string[]} */
  const problems = [];
  if (matrix.hostVersion !== HOST_VERSION) problems.push(`hostVersion must be ${HOST_VERSION}, got ${String(matrix.hostVersion)}`);
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
      if (!cell.notes) problems.push(`${id}: UNTESTED needs notes saying why`);
      if (cell.credential !== null || cell.evidenceRef !== null || cell.probedAt !== null) {
        problems.push(`${id}: UNTESTED must have null credential, evidenceRef and probedAt`);
      }
      continue;
    }
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
export function validateHostFacts(doc, questions, { evidenceExists, markdown }) {
  /** @type {string[]} */
  const problems = [];
  if (doc.hostVersion !== HOST_VERSION) problems.push(`host-facts hostVersion must be ${HOST_VERSION}, got ${String(doc.hostVersion)}`);
  const wanted = idsOfKind(questions, 'host-fact');
  /** @type {Map<string, Json>} */
  const byId = new Map();
  for (const fact of records(doc.facts)) {
    const id = String(fact.id);
    if (byId.has(id)) problems.push(`duplicate fact ${id}`);
    byId.set(id, fact);
    if (!FACT_STATUSES.includes(String(fact.status))) problems.push(`${id}: invalid status ${String(fact.status)}`);
    const items = records(fact.evidence);
    if (fact.status === 'UNTESTED') {
      if (!fact.notes) problems.push(`${id}: UNTESTED needs notes saying why`);
    } else {
      if (items.length === 0) problems.push(`${id}: ${String(fact.status)} needs evidence`);
      for (const item of items) {
        if (!CREDENTIALS.includes(String(item.credential))) problems.push(`${id}: evidence needs a credential label`);
        if (evidenceProblem(item.ref, evidenceExists)) problems.push(`${id}: evidence ref missing or not under ${EVIDENCE_ROOT}`);
      }
    }
    if (!markdown.includes(`| \`${id}\` | ${String(fact.status)} |`)) problems.push(`crew-0.12.0.md disagrees for ${id}`);
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
    record: join(dir, 'crew-0.12.0.md'),
    scope: join(dir, 'monitoring-scope.md'),
  };
  const missing = Object.values(files).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    for (const file of missing) log(`check:matrix: ${file} not found`);
    return 1;
  }
  const evidenceExists = (/** @type {string} */ file) => existsSync(join(root, file));
  const questionsDoc = readJson(files.questions);
  const matrix = readJson(files.matrix);
  const facts = readJson(files.facts);
  const problems = validateQuestions(questionsDoc);
  if (problems.length === 0 && isRecord(questionsDoc) && isRecord(matrix) && isRecord(facts)) {
    const questions = records(questionsDoc.questions);
    problems.push(
      ...validateMatrix(matrix, questions, { evidenceExists, markdown: readFileSync(files.matrixMarkdown, 'utf8') }),
      ...validateHostFacts(facts, questions, { evidenceExists, markdown: readFileSync(files.record, 'utf8') }),
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
