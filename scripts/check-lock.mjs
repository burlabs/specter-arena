import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ os?: string[], cpu?: string[], libc?: string[], optionalDependencies?: Record<string, string> }} LockNode
 * @typedef {{ packages?: Record<string, LockNode> }} Lockfile
 */

export const DEFAULT_LOCKFILES = ['package-lock.json'];

/**
 * @param {LockNode} node
 * @param {string} os
 * @param {string} cpu
 */
function targets(node, os, cpu) {
  return Boolean(node.os?.includes(os) && node.cpu?.includes(cpu));
}

/** @param {LockNode} node */
function servesLinuxGlibc(node) {
  return targets(node, 'linux', 'x64') && (!node.libc || node.libc.includes('glibc'));
}

/**
 * @param {Record<string, LockNode>} packages
 * @param {string} parentPath
 * @param {string} depName
 */
function resolveDependency(packages, parentPath, depName) {
  const nested = `${parentPath}/node_modules/${depName}`;
  return packages[nested] ?? packages[`node_modules/${depName}`];
}

/**
 * Package families are derived from the lock itself: any package whose optional
 * dependencies include a platform-specific build is a family. A family with a
 * darwin-arm64 build must also carry a linux-x64 glibc build, or `npm ci` on a
 * Linux runner silently skips the native binary.
 *
 * @param {Lockfile} lock
 * @returns {string[]} family paths missing a linux-x64 glibc variant
 */
export function findMissingLinuxVariants(lock) {
  const packages = lock.packages ?? {};
  /** @type {string[]} */
  const missing = [];
  for (const [path, node] of Object.entries(packages)) {
    const variants = Object.keys(node.optionalDependencies ?? {})
      .map((name) => resolveDependency(packages, path, name))
      .filter((variant) => variant?.os);
    if (variants.length === 0) continue;
    const hasDarwin = variants.some((variant) => variant && targets(variant, 'darwin', 'arm64'));
    const hasLinux = variants.some((variant) => variant && servesLinuxGlibc(variant));
    if (hasDarwin && !hasLinux) missing.push(path === '' ? '(root)' : path);
  }
  return missing;
}

/**
 * @typedef {{ file: string, exportRequirements: () => string }} RequirementsCheck
 */

export const UV_EXPORT_ARGS = [
  'export',
  '--project',
  'backend',
  '--frozen',
  '--no-dev',
  '--no-emit-project',
  '--no-header',
  '--format',
  'requirements-txt',
];

/** @returns {RequirementsCheck} */
export function uvRequirementsCheck() {
  return {
    file: 'requirements.txt',
    exportRequirements: () => execFileSync('uv', UV_EXPORT_ARGS, { encoding: 'utf8' }),
  };
}

/**
 * @param {RequirementsCheck} check
 * @param {(path: string) => string} readFile
 * @returns {string | null} problem description, or null when the committed file matches the lock
 */
export function findRequirementsDrift({ file, exportRequirements }, readFile) {
  let committed;
  let exported;
  try {
    committed = readFile(file);
    exported = exportRequirements();
  } catch (error) {
    return `cannot compare ${file} with backend/uv.lock: ${error instanceof Error ? error.message : String(error)}`;
  }
  return committed === exported ? null : `${file} does not match \`uv ${UV_EXPORT_ARGS.join(' ')}\``;
}

/**
 * @param {{
 *   files?: string[],
 *   requirements?: RequirementsCheck | null,
 *   readFile?: (path: string) => string,
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {number} process exit code
 */
export function run({
  files = DEFAULT_LOCKFILES,
  requirements = null,
  readFile = (path) => readFileSync(path, 'utf8'),
  log = console.log,
} = {}) {
  let failures = 0;
  if (requirements) {
    const drift = findRequirementsDrift(requirements, readFile);
    if (drift) {
      log(`check:lock: ${drift}`);
      log('check:lock: re-export requirements.txt as described in CONTRIBUTING.md');
      failures += 1;
    } else {
      log(`check:lock: ${requirements.file} matches backend/uv.lock`);
    }
  }
  for (const file of files) {
    /** @type {Lockfile} */
    let lock;
    try {
      lock = JSON.parse(readFile(file));
    } catch (error) {
      log(`check:lock: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      failures += 1;
      continue;
    }
    const missing = findMissingLinuxVariants(lock);
    if (missing.length > 0) {
      log(`check:lock: ${file} lacks a linux-x64 glibc variant for: ${missing.join(', ')}`);
      log('check:lock: regenerate the lock as described in CONTRIBUTING.md');
      failures += 1;
    } else {
      log(`check:lock: ${file} ok`);
    }
  }
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run({
    files: process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_LOCKFILES,
    requirements: uvRequirementsCheck(),
  });
}
