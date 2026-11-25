import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRegistryProblems, REGISTRY_FILE } from './check-registry.mjs';
import { APP_NAME, BUILT_ENTRY, MANIFEST_NAME, buildReleaseEntries, defaultBuild, defaultRun, readJson, renderManifest, resolveCommit, sha256 } from './package.mjs';

export const RELEASE_BRANCH = 'release';
export const REPOSITORY_URL = 'https://github.com/burlabs/specter-arena';
/** Present in the tarball, absent from the branch: with no root package.json Crew runs no npm step on the installing machine. */
export const BRANCH_OMITS = 'package.json';
const ABSENT_FROM_BRANCH = ['package.json', 'avatar-packs', 'docs/images', 'agents'];

/**
 * @typedef {import('./package.mjs').Run} Run
 */

/**
 * @param {string} name
 * @param {string} repoUrl
 * @returns {string} app-registry.json text for the release branch
 */
export function renderRegistry(name, repoUrl) {
  return `${JSON.stringify([{ name, gitUrl: repoUrl, repo: repoUrl, branch: RELEASE_BRANCH }], null, 2)}\n`;
}

/**
 * @param {string[]} tarballPaths paths inside the release tarball, without the top directory
 * @returns {string[]} the paths the release branch holds, sorted
 */
export function expectedBranchPaths(tarballPaths) {
  return [...new Set([...tarballPaths.filter((path) => path !== BRANCH_OMITS), REGISTRY_FILE])].sort();
}

/**
 * @param {string} listing output of `tar -tzf`
 * @returns {string[]} file paths without the single top directory, sorted
 */
export function parseTarListing(listing) {
  return listing
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('/'))
    .map((line) => line.slice(line.indexOf('/') + 1))
    .sort();
}

/**
 * @param {string[]} actual
 * @param {string[]} expected
 * @returns {string[]} one line per path that differs
 */
export function diffPaths(actual, expected) {
  const have = new Set(actual);
  const want = new Set(expected);
  return [...expected.filter((path) => !have.has(path)).map((path) => `${path}: missing from the branch tree`), ...actual.filter((path) => !want.has(path)).map((path) => `${path}: not in the tarball`)];
}

/**
 * @param {string} dir
 * @returns {string[]} file paths relative to dir, sorted
 */
export function listFiles(dir) {
  /** @param {string} base @returns {string[]} */
  const walk = (base) =>
    readdirSync(join(dir, base)).flatMap((name) => {
      const path = base === '' ? name : `${base}/${name}`;
      return statSync(join(dir, path)).isDirectory() ? walk(path) : [path];
    });
  return walk('').sort();
}

/**
 * @param {string} dir assembled branch tree
 * @returns {string[]} problems, one line each
 */
export function verifyBranchTree(dir) {
  /** @type {string[]} */
  const problems = [];
  if (!existsSync(join(dir, BUILT_ENTRY))) problems.push(`${BUILT_ENTRY}: missing, Crew would install an app with no UI`);
  for (const path of ABSENT_FROM_BRANCH) if (existsSync(join(dir, path))) problems.push(`${path}: must not be on the release branch`);
  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    manifest = readJson(join(dir, 'app.json'));
  } catch (error) {
    return [...problems, `app.json: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (manifest.name !== APP_NAME) problems.push(`app.json name is ${JSON.stringify(manifest.name)}, expected ${APP_NAME}`);
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) problems.push(`app.json version ${JSON.stringify(manifest.version)} is not x.y.z`);
  if (typeof manifest.minKiroCrewVersion !== 'string') problems.push('app.json has no minKiroCrewVersion');
  /** @type {unknown} */
  let registry;
  try {
    registry = JSON.parse(readFileSync(join(dir, REGISTRY_FILE), 'utf8'));
  } catch (error) {
    return [...problems, `${REGISTRY_FILE}: ${error instanceof Error ? error.message : String(error)}`];
  }
  problems.push(
    ...findRegistryProblems({
      registry,
      manifest,
      sizeOf: (path) => (existsSync(join(dir, path)) && statSync(join(dir, path)).isFile() ? statSync(join(dir, path)).size : null),
    }),
  );
  if (Array.isArray(registry) && /** @type {{ branch?: unknown }} */ (registry[0] ?? {}).branch !== RELEASE_BRANCH) problems.push(`${REGISTRY_FILE}: branch must be ${RELEASE_BRANCH}`);
  return problems;
}

/**
 * @param {string} dir
 * @param {string} src
 * @param {{ path: string, mode: string }[]} entries tracked files of the source clone
 * @param {string} commit
 * @param {string} npmVersion
 */
function assembleTree(dir, src, entries, commit, npmVersion) {
  /** @type {{ path: string, data: Buffer }[]} */
  const written = [];
  /** @param {string} path @param {Buffer} data @param {number} mode */
  const put = (path, data, mode) => {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    chmodSync(target, mode);
    written.push({ path, data });
  };
  for (const { path, mode } of entries) {
    if (path !== BRANCH_OMITS) put(path, readFileSync(join(src, path)), mode === '100755' ? 0o755 : 0o644);
  }
  put(BUILT_ENTRY, readFileSync(join(src, BUILT_ENTRY)), 0o644);
  const app = readJson(join(src, 'app.json'));
  put(REGISTRY_FILE, Buffer.from(renderRegistry(String(app.name), REPOSITORY_URL)), 0o644);
  const manifest = renderManifest({
    commit,
    version: String(app.version),
    nodeVersion: process.versions.node,
    npmVersion,
    minCrew: String(app.minKiroCrewVersion),
    files: written.map(({ path, data }) => ({ path, sha256: sha256(data) })),
  });
  put(MANIFEST_NAME, Buffer.from(manifest), 0o644);
}

/**
 * @param {string} repoPath
 * @param {Run} run
 * @param {string[]} args
 * @returns {string | null} trimmed stdout, or null when git exits non-zero
 */
function gitOut(repoPath, run, args) {
  try {
    return run('git', ['-C', repoPath, ...args]).toString('utf8').trim();
  } catch {
    return null;
  }
}

/**
 * @param {string} repoPath
 * @param {string} sha
 * @param {Run} run
 * @returns {string | null} the reason to refuse, or null when the checkout may commit a release
 */
export function commitRefusal(repoPath, sha, run) {
  if (gitOut(repoPath, run, ['status', '--porcelain']) !== '') return 'the working tree is not clean; commit or stash first';
  if (gitOut(repoPath, run, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']) === null) return 'origin/main is unknown here; run git fetch origin first';
  if (gitOut(repoPath, run, ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']) === null) return `${sha} is not on origin/main; release only commits that are merged`;
  if (gitOut(repoPath, run, ['symbolic-ref', '-q', 'HEAD']) === `refs/heads/${RELEASE_BRANCH}`) return `the checkout is on ${RELEASE_BRANCH}; switch to main first`;
  return null;
}

/**
 * @param {string} repoPath
 * @param {Run} run
 * @returns {{ parent: string | null, current: string | null } | { refusal: string }}
 */
export function previousTip(repoPath, run) {
  const local = gitOut(repoPath, run, ['rev-parse', '--verify', '-q', `refs/heads/${RELEASE_BRANCH}`]);
  const remote = gitOut(repoPath, run, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${RELEASE_BRANCH}`]);
  if (local === null) return { parent: remote, current: null };
  if (remote !== null && gitOut(repoPath, run, ['merge-base', '--is-ancestor', remote, local]) === null) {
    return { refusal: `local ${RELEASE_BRANCH} does not contain origin/${RELEASE_BRANCH}; fetch and reconcile first` };
  }
  return { parent: local, current: local };
}

/**
 * Commits the assembled tree onto the local release branch without touching the checkout.
 *
 * @param {{ repoPath: string, tree: string, work: string, parent: string | null, current: string | null, message: string, run: Run }} input
 * @returns {{ commit: string, changed: boolean }}
 */
export function commitTree({ repoPath, tree, work, parent, current, message, run }) {
  const gitDir = /** @type {string} */ (gitOut(repoPath, run, ['rev-parse', '--absolute-git-dir']));
  const env = { GIT_DIR: gitDir, GIT_WORK_TREE: tree, GIT_INDEX_FILE: join(work, 'index') };
  /** @param {string[]} args */
  const plumbing = (args) => run('git', ['-c', 'core.autocrlf=false', ...args], { cwd: tree, env }).toString('utf8').trim();
  plumbing(['add', '-A', '-f', '--', '.']);
  const treeId = plumbing(['write-tree']);
  if (parent !== null && plumbing(['rev-parse', `${parent}^{tree}`]) === treeId) return { commit: parent, changed: false };
  const commit = plumbing(['commit-tree', treeId, ...(parent === null ? [] : ['-p', parent]), '-m', message]);
  plumbing(['update-ref', '-m', 'release-branch', `refs/heads/${RELEASE_BRANCH}`, commit, current ?? '0'.repeat(40)]);
  return { commit, changed: true };
}

/**
 * @param {{
 *   repo?: string, ref?: string, dryRun?: boolean, outDir?: string, compareTarball?: string,
 *   run?: Run, build?: (clone: string, run: Run) => void, log?: (line: string) => void, tmpRoot?: string,
 * }} [options]
 * @returns {number} process exit code
 */
export function releaseBranch({ repo = '.', ref = 'HEAD', dryRun = false, outDir, compareTarball, run = defaultRun, build = defaultBuild, log = console.log, tmpRoot = tmpdir() } = {}) {
  /** @type {string | undefined} */
  let work;
  try {
    const repoPath = resolve(repo);
    if (gitOut(repoPath, run, ['rev-parse', '--git-dir']) === null) {
      log(`release-branch: ${repo} is not a git repository`);
      return 1;
    }
    const sha = resolveCommit(repoPath, ref, run);
    if (!dryRun) {
      const refusal = commitRefusal(repoPath, sha, run);
      if (refusal !== null) {
        log(`release-branch: ${refusal}`);
        return 1;
      }
    }
    const tip = dryRun ? { parent: null, current: null } : previousTip(repoPath, run);
    if ('refusal' in tip) {
      log(`release-branch: ${tip.refusal}`);
      return 1;
    }
    work = mkdtempSync(join(tmpRoot, 'specter-release-'));
    const src = join(work, 'src');
    const tree = join(work, 'tree');
    /** @param {string} line */
    const scrub = (line) => line.split(work).join('<work>');
    if (outDir !== undefined) {
      const out = resolve(outDir);
      const inside = relative(repoPath, out);
      if ((!inside.startsWith('..') && !isAbsolute(inside)) || existsSync(out)) {
        log(`release-branch: --out ${outDir} must be a new directory outside the repository`);
        return 1;
      }
    }
    run('git', ['clone', '--quiet', '--no-local', '--no-checkout', '-c', 'core.autocrlf=false', '--', repoPath, src]);
    try {
      run('git', ['-C', src, 'checkout', '--quiet', '--detach', sha]);
    } catch {
      log(`release-branch: commit ${sha} is not reachable from a branch or tag of ${repo}`);
      return 1;
    }
    const entries = buildReleaseEntries({ src, run, build, log, scrub, prefix: 'release-branch' });
    if (entries === null) return 1;
    mkdirSync(tree);
    assembleTree(tree, src, entries, sha, run('npm', ['--version'], { cwd: src }).toString('utf8').trim());
    const problems = verifyBranchTree(tree);
    if (compareTarball !== undefined) {
      const listing = run('tar', ['-tzf', resolve(compareTarball)]).toString('utf8');
      problems.push(...diffPaths(listFiles(tree), expectedBranchPaths(parseTarListing(listing))));
    }
    if (problems.length > 0) {
      for (const problem of problems) log(`release-branch: ${problem}`);
      return 1;
    }
    const fileCount = listFiles(tree).length;
    if (dryRun) {
      if (outDir !== undefined) copyTree(tree, resolve(outDir));
      log(`release-branch: dry run ok, ${fileCount} files from ${sha}; nothing committed`);
      return 0;
    }
    const version = String(readJson(join(tree, 'app.json')).version);
    const message = `release: ${APP_NAME} ${version} from main ${sha}\n\nsource: ${sha}\nversion: ${version}\n`;
    const { commit, changed } = commitTree({ repoPath, tree, work, parent: tip.parent, current: tip.current, message, run });
    if (!changed) {
      log(`release-branch: ${RELEASE_BRANCH} already holds this build (${commit}); nothing committed`);
      return 0;
    }
    log(`release-branch: committed ${commit} to local ${RELEASE_BRANCH} (${fileCount} files, source main ${sha})`);
    log(`release-branch: nothing was pushed. To publish it, run:`);
    log(`  cd ${repoPath}`);
    log(`  git push origin ${RELEASE_BRANCH}`);
    return 0;
  } catch (error) {
    log(`release-branch: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`);
    return 1;
  } finally {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  }
}

/**
 * @param {string} from
 * @param {string} to
 */
function copyTree(from, to) {
  for (const path of listFiles(from)) {
    mkdirSync(dirname(join(to, path)), { recursive: true });
    copyFileSync(join(from, path), join(to, path));
  }
}

/**
 * @param {string[]} args
 * @returns {{ ref: string, dryRun: boolean, outDir?: string, compareTarball?: string }}
 */
export function parseArgs(args) {
  const usage = 'usage: npm run release:branch -- [--commit <ref>] [--dry-run [--out <dir>] [--compare-tarball <file>]]';
  /** @type {{ ref: string, dryRun: boolean, outDir?: string, compareTarball?: string }} */
  const parsed = { ref: 'HEAD', dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value === '' || (flag !== '--commit' && flag !== '--out' && flag !== '--compare-tarball')) throw new Error(usage);
    index += 1;
    if (flag === '--commit') parsed.ref = value;
    else if (flag === '--out') parsed.outDir = value;
    else parsed.compareTarball = value;
  }
  if (!parsed.dryRun && (parsed.outDir !== undefined || parsed.compareTarball !== undefined)) throw new Error(usage);
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = releaseBranch(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
