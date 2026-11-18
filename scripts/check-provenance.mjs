import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
export const PROVENANCE_DOC = 'docs/provenance.md';
/** Every shipped raster needs a row in PROVENANCE_DOC naming its repo path and sha256. */
const RASTER = /\.(?:png|jpe?g|gif|webp)$/i;
/** QA artifacts of the art pack, never shipped (FP-10+11 SC10-3). */
export const QA_ART = /-light-dark-[a-z-]*check\.jpe?g$|(?:^|\/)reference-crops\/|(?:^|\/)roster-reference\.[a-z]+$|-master\.png$/i;
/** Wording the art release replaced (B13); it must not come back in the docs. */
export const RETIRED_ART_WORDING = [
  { pattern: /derived non-generatively/i, label: 'retired art wording "derived non-generatively"' },
  { pattern: /no licensing determination/i, label: 'retired art wording "no licensing determination"' },
];
export const ART_STATEMENT = 'created by Eric Jeffers using ChatGPT (OpenAI) image generation';
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
 *   readBytes?: (path: string) => Uint8Array,
 * }} Repo
 */

/**
 * Art rows: every tracked raster has a QA-free path and a row in docs/provenance.md that names its
 * repo path and its sha256, and the doc carries the creation statement and none of the retired wording.
 * @param {Repo} repo
 * @returns {string[]} problems found
 */
export function checkArt({ trackedFiles, readFile, readBytes }) {
  /** @type {string[]} */
  const problems = [];
  const rasters = trackedFiles.filter((path) => RASTER.test(path));
  for (const path of rasters) if (QA_ART.test(path)) problems.push(`${path}: QA art file must not ship`);
  if (rasters.length === 0 || readBytes === undefined) return problems;
  let doc;
  try {
    doc = readFile(PROVENANCE_DOC);
  } catch {
    return [...problems, `${PROVENANCE_DOC} is missing but ${rasters.length} raster file(s) are tracked`];
  }
  if (!doc.includes(ART_STATEMENT)) problems.push(`${PROVENANCE_DOC} lacks the statement "${ART_STATEMENT}"`);
  for (const { pattern, label } of RETIRED_ART_WORDING) if (pattern.test(doc)) problems.push(`${PROVENANCE_DOC}: ${label}`);
  const rows = doc.split('\n').filter((line) => line.startsWith('|'));
  for (const path of rasters) {
    if (QA_ART.test(path)) continue;
    const sha256 = createHash('sha256').update(readBytes(path)).digest('hex');
    if (!rows.some((row) => row.includes(`\`${path}\``) && row.includes(`\`${sha256}\``))) {
      problems.push(`${path}: no row in ${PROVENANCE_DOC} with this path and sha256 ${sha256}`);
    }
  }
  return problems;
}

/**
 * A Figma Make row (first cell starts `FP-`) names the files it was adapted into; each `ui/src/` path
 * in it must be a tracked file, so a renamed or dropped port cannot leave a stale row behind.
 * @param {Repo} repo
 * @returns {string[]} problems found
 */
export function checkPortedRows({ trackedFiles, readFile }) {
  let doc;
  try {
    doc = readFile(PROVENANCE_DOC);
  } catch {
    return [];
  }
  const tracked = new Set(trackedFiles);
  /** @type {string[]} */
  const problems = [];
  for (const row of doc.split('\n').filter((line) => line.startsWith('| FP-'))) {
    for (const [, path = ''] of row.matchAll(/`(ui\/src\/[^`]+)`/g)) {
      if (!tracked.has(path)) problems.push(`${PROVENANCE_DOC}: row names ${path}, which is not a tracked file`);
    }
  }
  return problems;
}

/**
 * @param {Repo} repo
 * @returns {string[]} problems found; empty means the tree is clean
 */
export function checkRepository({ trackedFiles, readFile, isIgnored, readBytes }) {
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
  problems.push(...checkArt({ trackedFiles, readFile, isIgnored, readBytes }));
  problems.push(...checkPortedRows({ trackedFiles, readFile, isIgnored, readBytes }));
  return problems;
}

/** @returns {Repo} */
export function gitRepo() {
  return {
    trackedFiles: execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean),
    readFile: (path) => readFileSync(path, 'utf8'),
    readBytes: (path) => readFileSync(path),
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
