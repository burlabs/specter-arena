import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Identifiers that only appear in files taken from burlabs/dragonboat-cms. Naming
 * the reference repository is allowed (docs/provenance.md does); carrying its
 * package scope, internal module names, or Apache-2.0 headers is not.
 * Extend this list when a new Dragonboat-only identifier is found.
 */
export const DENYLIST = [
  { pattern: /@dragonboat-cms\//, label: 'Dragonboat package scope' },
  { pattern: /\bcms-contracts-lib\b/, label: 'Dragonboat module cms-contracts-lib' },
  { pattern: /\bsite-renderer\b/, label: 'Dragonboat module site-renderer' },
  { pattern: /\bkirocrew-client-py\b/, label: 'Dragonboat module kirocrew-client-py' },
  { pattern: /\bcms-backend\b/, label: 'Dragonboat service cms-backend' },
  { pattern: /\bworkspaces-run\.mjs\b/, label: 'Dragonboat script workspaces-run.mjs' },
  { pattern: /\bbuild-chain-audit-baseline\b/, label: 'Dragonboat build-chain audit baseline' },
  { pattern: /SPDX-License-Identifier:\s*Apache-2\.0/, label: 'Apache-2.0 SPDX header' },
  { pattern: /--profile[= ](?!specter-preview(?![\w-]))\S+/, label: 'AWS CLI profile other than specter-preview' },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, label: 'AWS access key ID' },
];

const SELF = 'scripts/check-provenance.mjs';
const ALLOWED_ENV_FILES = new Set(['.env.example']);

/**
 * @param {string} text
 * @returns {string[]} labels of every denylisted identifier found
 */
export function findDenylisted(text) {
  return DENYLIST.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

/** @param {string} path */
function isEnvFile(path) {
  const name = path.split('/').pop() ?? path;
  return (name === '.env' || name.startsWith('.env.')) && !ALLOWED_ENV_FILES.has(name);
}

/**
 * @typedef {{
 *   trackedFiles: string[],
 *   readFile: (path: string) => string,
 *   isIgnored: (path: string) => boolean,
 * }} Repo
 */

/**
 * @param {Repo} repo
 * @returns {string[]} problems found; empty means the tree is clean
 */
export function checkRepository({ trackedFiles, readFile, isIgnored }) {
  /** @type {string[]} */
  const problems = [];
  const kiroFiles = trackedFiles.filter((path) => path.startsWith('.kiro/'));
  if (kiroFiles.length === 0) problems.push('.kiro/ has no tracked files');
  if (isIgnored('.kiro/steering/product.md')) problems.push('.gitignore matches .kiro/');
  for (const path of trackedFiles) {
    if (isEnvFile(path)) problems.push(`${path}: env files other than .env.example must not be tracked`);
    if (path === SELF) continue;
    let text;
    try {
      text = readFile(path);
    } catch {
      continue;
    }
    for (const label of findDenylisted(text)) problems.push(`${path}: ${label}`);
  }
  return problems;
}

/** @returns {Repo} */
export function gitRepo() {
  return {
    trackedFiles: execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean),
    readFile: (path) => readFileSync(path, 'utf8'),
    isIgnored: (path) => {
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', path]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * @param {{ repo?: Repo, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ repo = gitRepo(), log = console.log } = {}) {
  const problems = checkRepository(repo);
  for (const problem of problems) log(`check:provenance: ${problem}`);
  if (problems.length > 0) return 1;
  log(`check:provenance: ${repo.trackedFiles.length} tracked files clean`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
