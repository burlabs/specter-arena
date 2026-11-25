import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REGISTRY_FILE = 'app-registry.json';
export const MANIFEST_FILE = 'app.json';
export const ENTRY_KEYS = ['name', 'gitUrl', 'repo', 'branch'];
export const BRANCH_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_\-./]*$/;
export const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const ART_FIELD = /^(?:iconPath|heroImage|screenshots)/;
export const ART_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'];
export const ART_MAX_BYTES = 8 * 1024 * 1024;
export const ART_MAX_LIST = 12;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} entry
 * @param {string} manifestName
 * @returns {string[]}
 */
function entryProblems(entry, manifestName) {
  if (!isRecord(entry)) return ['the entry is not an object'];
  /** @type {string[]} */
  const problems = [];
  if ('subdirectory' in entry) problems.push('the entry has a subdirectory key; Crew rejects "." and the root needs no key');
  for (const key of Object.keys(entry)) {
    if (key !== 'subdirectory' && !ENTRY_KEYS.includes(key)) problems.push(`the entry has an unexpected key ${key}`);
  }
  if (entry.name !== manifestName) problems.push(`entry name ${JSON.stringify(entry.name)} does not equal ${MANIFEST_FILE} name ${JSON.stringify(manifestName)}`);
  for (const key of ['gitUrl', 'repo']) {
    const value = entry[key];
    if (typeof value !== 'string' || !GITHUB_URL.test(value)) problems.push(`${key} must be an https GitHub repository URL`);
  }
  if (entry.gitUrl !== entry.repo) problems.push('gitUrl must equal repo');
  if (typeof entry.branch !== 'string' || !BRANCH_SHAPE.test(entry.branch)) problems.push('branch is missing or has an unsafe shape');
  return problems;
}

/**
 * @param {string} field
 * @param {unknown} value
 * @param {(path: string) => number | null} sizeOf
 * @returns {string[]}
 */
function artProblems(field, value, sizeOf) {
  const paths = Array.isArray(value) ? value : [value];
  /** @type {string[]} */
  const problems = [];
  if (Array.isArray(value) && value.length > ART_MAX_LIST) problems.push(`${field} lists ${value.length} paths; Crew reads at most ${ART_MAX_LIST}`);
  for (const path of paths) {
    if (typeof path !== 'string' || path === '') {
      problems.push(`${field} holds a value that is not a path`);
      continue;
    }
    if (path.startsWith('/') || path.split('/').includes('..')) {
      problems.push(`${field}: ${path} must stay inside the repository`);
      continue;
    }
    if (!ART_EXTENSIONS.includes(extname(path).toLowerCase())) problems.push(`${field}: ${path} has an extension Crew does not serve`);
    const size = sizeOf(path);
    if (size === null) problems.push(`${field}: ${path} does not exist`);
    else if (size > ART_MAX_BYTES) problems.push(`${field}: ${path} is ${size} bytes; the limit is ${ART_MAX_BYTES}`);
  }
  return problems;
}

/**
 * Checks the committed registry index against the contract Crew enforces when it
 * reads an external registry and fetches store art before install.
 *
 * @param {{ registry: unknown, manifest: Record<string, unknown>, sizeOf: (path: string) => number | null }} input
 * @returns {string[]} one line per problem
 */
export function findRegistryProblems({ registry, manifest, sizeOf }) {
  if (!Array.isArray(registry)) return [`${REGISTRY_FILE} must be a JSON list`];
  if (registry.length !== 1) return [`${REGISTRY_FILE} must hold exactly one entry, found ${registry.length}`];
  const problems = entryProblems(registry[0], String(manifest.name));
  for (const [field, value] of Object.entries(manifest)) {
    if (ART_FIELD.test(field)) problems.push(...artProblems(field, value, sizeOf));
  }
  return problems;
}

/**
 * @param {string} path
 * @returns {number | null}
 */
function fileSize(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   readFile?: (path: string) => string,
 *   sizeOf?: (path: string) => number | null,
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {number} process exit code
 */
export function run({ readFile = (path) => readFileSync(path, 'utf8'), sizeOf = fileSize, log = console.log } = {}) {
  /** @type {unknown} */
  let registry;
  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    registry = JSON.parse(readFile(REGISTRY_FILE));
    manifest = JSON.parse(readFile(MANIFEST_FILE));
  } catch (error) {
    log(`check:registry: cannot read the registry or manifest: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const problems = findRegistryProblems({ registry, manifest, sizeOf });
  for (const problem of problems) log(`check:registry: ${problem}`);
  if (problems.length === 0) log(`check:registry: ${REGISTRY_FILE} ok`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
