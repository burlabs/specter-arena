import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECORDED_DIR = 'tests/recorded/crew-0.12.0';
export const HASHED_ID = /^sha256:[0-9a-f]{12}$/;
export const REDACTED = /^<redacted type=(?:str|list|object) len=\d+>$/;
export const ROW_KINDS = ['probe', 'non-probe'];

const CREDENTIAL_SHAPES = [
  { pattern: /\bBearer\s+\S{12,}/i, label: 'bearer credential' },
  { pattern: /x-kirocrew-proxy[-\w]*"?\s*:\s*"[^<"]{8,}/i, label: 'proxy header value' },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, label: 'AWS access key ID' },
];
const RECORDED_REFERENCE = /tests[/.]recorded/;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py'];

/**
 * @typedef {Record<string, unknown>} Json
 */

/**
 * @param {unknown} value
 * @returns {value is Json}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * Non-probe rows may carry only numbers, booleans, null, a short hash, or a redaction marker. Object keys are free.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function nonProbeProblems(value, path = '$') {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return [];
  if (typeof value === 'string') {
    return HASHED_ID.test(value) || REDACTED.test(value) ? [] : [`${path}: string is not in the sanitised grammar`];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => nonProbeProblems(item, `${path}[${index}]`));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => nonProbeProblems(item, `${path}.${key}`));
  return [`${path}: unsupported value`];
}

/**
 * Probe rows come from the throwaway probe bot and may hold text, but never credential-shaped values.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function probeProblems(value, path = '$') {
  if (typeof value === 'string') {
    return CREDENTIAL_SHAPES.filter(({ pattern }) => pattern.test(value)).map(({ label }) => `${path}: looks like a ${label}`);
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => probeProblems(item, `${path}[${index}]`));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => probeProblems(item, `${path}.${key}`));
  return [];
}

/**
 * A completed model turn is not accepted work, so no outcome evidence may claim acceptance.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function acceptedOutcomeProblems(value, path = '$') {
  if (Array.isArray(value)) return value.flatMap((item, index) => acceptedOutcomeProblems(item, `${path}[${index}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const here = `${path}.${key}`;
    if (key === 'outcomeEvidence' && typeof item === 'string' && /accepted/i.test(item)) {
      return [`${here}: outcomeEvidence must not claim acceptance`];
    }
    return acceptedOutcomeProblems(item, here);
  });
}

/**
 * @param {string} name file name used in messages
 * @param {unknown} json parsed file
 * @returns {string[]} problems; empty means valid
 */
export function validateRecordedFile(name, json) {
  if (!isRecord(json)) return [`${name}: must be an object with _meta and rows`];
  /** @type {string[]} */
  const problems = [];
  const meta = json._meta;
  if (!isRecord(meta)) problems.push(`${name}: _meta missing`);
  else {
    if (typeof meta.sanitisation !== 'string' || meta.sanitisation === '') problems.push(`${name}: _meta.sanitisation missing`);
    if (meta.hostVersion !== '0.12.0') problems.push(`${name}: _meta.hostVersion must be 0.12.0`);
  }
  if (!Array.isArray(json.rows)) return [...problems, `${name}: rows must be a list`];
  const seen = new Set();
  json.rows.forEach((row, index) => {
    const where = `${name}: rows[${index}]`;
    if (!isRecord(row)) {
      problems.push(`${where} must be an object`);
      return;
    }
    const { rowKind, ...rest } = row;
    if (!ROW_KINDS.includes(String(rowKind))) problems.push(`${where}: rowKind must be probe or non-probe`);
    const checked = rowKind === 'probe' ? probeProblems(rest) : nonProbeProblems(rest);
    problems.push(...checked.map((problem) => `${where}${problem.slice(1)}`));
    problems.push(...acceptedOutcomeProblems(rest).map((problem) => `${where}${problem.slice(1)}`));
    for (const field of ['id', 'key', 'attemptId']) {
      const value = rest[field];
      if (value === undefined) continue;
      const identity = `${field}:${String(value)}`;
      if (seen.has(identity)) problems.push(`${where}: duplicate ${field} ${String(value)}`);
      seen.add(identity);
    }
  });
  return problems;
}

/**
 * Recorded captures are test inputs; release code must never read them.
 * @param {string[]} dirs directories holding release runtime sources
 * @returns {{ file: string, reason: string }[]}
 */
export function scanImports(dirs) {
  return dirs
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      (statSync(dir).isDirectory() ? listFiles(dir) : [dir])
        .filter((path) => SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)))
        .filter((path) => RECORDED_REFERENCE.test(readFileSync(path, 'utf8')))
        .map((path) => ({ file: path, reason: 'references tests/recorded from release code' })),
    );
}

/**
 * @param {{ dir?: string, runtimeDirs?: string[], log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ dir = RECORDED_DIR, runtimeDirs = ['ui/src', 'backend/app.py', 'backend/specter_arena'], log = console.log } = {}) {
  const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
  const problems = [
    ...names.flatMap((name) => {
      try {
        return validateRecordedFile(name, JSON.parse(readFileSync(join(dir, name), 'utf8')));
      } catch {
        return [`${name}: not valid JSON`];
      }
    }),
    ...scanImports(runtimeDirs).map(({ file, reason }) => `${relative('.', file)} ${reason}`),
  ];
  for (const problem of problems) log(`check:recorded: ${problem}`);
  if (problems.length > 0) return 1;
  log(`check:recorded: ${names.length} recorded file(s) ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
