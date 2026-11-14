import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPATIBILITY_DIR, LEGACY_HOST_VERSION, knownHostVersions } from './check-matrix.mjs';

export const RECORDED_ROOT = 'tests/recorded';
export const EVENT_TYPES_FILE = `${COMPATIBILITY_DIR}/event-vocabulary.json`;
export const CAPTURES = ['event-frames'];
export const HASHED_ID = /^sha256:[0-9a-f]{12}$/;
export const REDACTED = /^<redacted type=(?:str|list|object) len=\d+>$/;
export const ROW_KINDS = ['probe', 'non-probe'];

const CREDENTIAL_SHAPES = [
  { pattern: /\bBearer\s+\S{12,}/i, label: 'bearer credential' },
  { pattern: /x-kirocrew-proxy[-\w]*"?\s*:\s*"[^<"]{8,}/i, label: 'proxy header value' },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, label: 'AWS access key ID' },
];
/**
 * Release code may read neither. `contracts/cases` is exempt for test files only: the Vitest and
 * pytest contract runners live beside the code they test and are not release code.
 */
const FORBIDDEN_REFERENCES = [
  { pattern: /tests[/.]recorded/, reason: 'references tests/recorded from release code', testsMayRead: false },
  { pattern: /contracts[/.]cases/, reason: 'references contracts/cases from release code', testsMayRead: true },
];
const TEST_FILE = /(?:\.test\.[cm]?[jt]sx?$|\/__tests__\/|(?:^|\/)test_[^/]*\.py$)/;
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
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
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
 * @param {{ knownVersions?: string[], expectedVersion?: string, eventTypes?: string[] }} [options]
 *   `knownVersions` are the hosts with a compatibility record; `expectedVersion` is the host named by
 *   the directory, which the file must match; `eventTypes` is the controlled vocabulary for event-frame files.
 * @returns {string[]} problems; empty means valid
 */
export function validateRecordedFile(name, json, { knownVersions = [LEGACY_HOST_VERSION], expectedVersion, eventTypes = [] } = {}) {
  if (!isRecord(json)) return [`${name}: must be an object with _meta and rows`];
  /** @type {string[]} */
  const problems = [];
  const meta = json._meta;
  let frames = false;
  if (!isRecord(meta)) problems.push(`${name}: _meta missing`);
  else {
    if (typeof meta.sanitisation !== 'string' || meta.sanitisation === '') problems.push(`${name}: _meta.sanitisation missing`);
    const allowed = expectedVersion === undefined ? knownVersions : [expectedVersion];
    if (typeof meta.hostVersion !== 'string' || !allowed.includes(meta.hostVersion)) problems.push(`${name}: _meta.hostVersion must be ${allowed.join(' or ')}`);
    if (meta.capture !== undefined && !CAPTURES.includes(String(meta.capture))) problems.push(`${name}: _meta.capture must be ${CAPTURES.join(' or ')} when present`);
    frames = meta.capture === 'event-frames';
  }
  if (!Array.isArray(json.rows)) return [...problems, `${name}: rows must be a list`];
  const seen = new Set();
  json.rows.forEach((row, index) => {
    const where = `${name}: rows[${index}]`;
    if (!isRecord(row)) {
      problems.push(`${where} must be an object`);
      return;
    }
    const { rowKind, ...withType } = row;
    // In an event-frame file the top-level eventType is a controlled-vocabulary name, not free text.
    const { eventType, ...withoutType } = withType;
    const rest = frames ? withoutType : withType;
    if (!ROW_KINDS.includes(String(rowKind))) problems.push(`${where}: rowKind must be probe or non-probe`);
    const checked = rowKind === 'probe' ? probeProblems(rest) : nonProbeProblems(rest);
    problems.push(...checked.map((problem) => `${where}${problem.slice(1)}`));
    problems.push(...acceptedOutcomeProblems(rest).map((problem) => `${where}${problem.slice(1)}`));
    if (frames) {
      const sequence = rest.frameSeq;
      if (!isNonNegativeInteger(sequence)) problems.push(`${where}: frameSeq must be a non-negative integer`);
      else if (seen.has(`frameSeq:${sequence}`)) problems.push(`${where}: duplicate frameSeq ${sequence}`);
      else seen.add(`frameSeq:${sequence}`);
      if (!isNonNegativeInteger(rest.receivedAtMs)) problems.push(`${where}: receivedAtMs must be a non-negative integer (epoch milliseconds)`);
      if (typeof eventType !== 'string' || !eventTypes.includes(eventType)) problems.push(`${where}: eventType ${String(eventType)} is not in ${EVENT_TYPES_FILE}`);
      return;
    }
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
        .flatMap((path) => {
          const text = readFileSync(path, 'utf8');
          return FORBIDDEN_REFERENCES.filter(({ pattern, testsMayRead }) => pattern.test(text) && !(testsMayRead && TEST_FILE.test(path))).map(({ reason }) => ({ file: path, reason }));
        }),
    );
}

/**
 * @param {string} root
 * @returns {string[]} directories named crew-<version> under the recorded root
 */
function recordedDirs(root) {
  return existsSync(root) ? readdirSync(root).filter((name) => /^crew-\d+\.\d+\.\d+$/.test(name) && statSync(join(root, name)).isDirectory()).sort().map((name) => join(root, name)) : [];
}

/**
 * @param {{ dir?: string, root?: string, compatibilityDir?: string, eventTypesFile?: string, runtimeDirs?: string[], log?: (line: string) => void }} [options]
 *   `dir` validates one directory of captures; otherwise every `crew-<version>` directory under `root` is
 *   validated against the host version in its name, which must have a record under `compatibilityDir`.
 * @returns {number} process exit code
 */
export function run({
  dir,
  root = RECORDED_ROOT,
  compatibilityDir = COMPATIBILITY_DIR,
  eventTypesFile = EVENT_TYPES_FILE,
  runtimeDirs = ['ui/src', 'backend/app.py', 'backend/specter_arena'],
  log = console.log,
} = {}) {
  const knownVersions = knownHostVersions(compatibilityDir);
  /** @type {string[]} */
  const problems = [];
  let eventTypes = /** @type {string[]} */ ([]);
  if (existsSync(eventTypesFile)) {
    try {
      const doc = JSON.parse(readFileSync(eventTypesFile, 'utf8'));
      eventTypes = isRecord(doc) && Array.isArray(doc.eventTypes) ? doc.eventTypes.map(String) : [];
      if (eventTypes.length === 0) problems.push(`${eventTypesFile}: eventTypes must be a non-empty list`);
    } catch {
      problems.push(`${eventTypesFile}: not valid JSON`);
    }
  }
  const fileOptions = { knownVersions: knownVersions.length > 0 ? knownVersions : [LEGACY_HOST_VERSION], eventTypes };
  const dirs = dir === undefined ? recordedDirs(root) : [dir];
  let count = 0;
  for (const directory of dirs) {
    const version = /^crew-(\d+\.\d+\.\d+)$/.exec(directory.split('/').pop() ?? '')?.[1];
    if (version !== undefined && !knownVersions.includes(version)) problems.push(`${directory}: no ${compatibilityDir}/crew-${version}.md record`);
    const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.json')) : [];
    count += names.length;
    for (const name of names) {
      try {
        const json = JSON.parse(readFileSync(join(directory, name), 'utf8'));
        problems.push(...validateRecordedFile(name, json, { ...fileOptions, expectedVersion: version }));
      } catch {
        problems.push(`${name}: not valid JSON`);
      }
    }
  }
  problems.push(...scanImports(runtimeDirs).map(({ file, reason }) => `${relative('.', file)} ${reason}`));
  for (const problem of problems) log(`check:recorded: ${problem}`);
  if (problems.length > 0) return 1;
  log(`check:recorded: ${count} recorded file(s) ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
