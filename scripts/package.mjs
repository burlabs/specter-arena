import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { run as checkFixtures } from './check-fixtures.mjs';
import { QA_ART, UI_ICON_RASTERS } from './check-provenance.mjs';

export const DEFAULT_OUT_DIR = '.release';
export const APP_NAME = 'specter-arena';
export const MANIFEST_NAME = 'RELEASE-MANIFEST.txt';
export const BUILT_ENTRY = 'ui/dist/index.mjs';
export const REQUIRED_FILES = ['LICENSE', 'requirements.txt', 'package-lock.json', 'docs/provenance.md', 'DEPENDENCIES.md', 'docs/release/install.md', 'docs/release/blockers.md', ...UI_ICON_RASTERS];
/** Tracked paths left out of the artifact: repository-only art such as the README banner and the Kiro Crew avatar packs, which add install weight and no runtime use, and the registry index, which only a registry install reads. */
export const RELEASE_EXCLUDED = /^(?:(?:docs\/images|avatar-packs)\/|app-registry\.json$)/;
const BLOCK = 512;
const USTAR_NAME_MAX = 100;
const USTAR_PREFIX_MAX = 155;
const SIZE_MAX = 0o77777777777;
const PLACEHOLDER_TOP_DIR = `${APP_NAME}-000.000.000-000000000000/`;

/** Rules applied to every tracked path and every built path. The first match is reported. */
export const FORBIDDEN_RULES = [
  { pattern: /(?:^|\/)\.env(?:\.(?!example$)[^/]*)?$/, label: 'env file other than .env.example' },
  { pattern: /(?:^|\/)\.probe-[^/]*(?:\/|$)/, label: 'probe artifact' },
  { pattern: /(?:^|\/)data\//, label: 'data directory' },
  { pattern: /\.(?:db|db-wal|db-shm|sqlite3?)$/i, label: 'database file' },
  { pattern: QA_ART, label: 'QA art file' },
  { pattern: /^ui\/(?:preview-dist|diagnostic-dist)\//, label: 'preview or diagnostic build output' },
  { pattern: /^infra\/cdk\.out\//, label: 'CDK output' },
  { pattern: /^\.release\//, label: 'release output' },
  {
    pattern: /(?:^|\/)(?:node_modules|\.venv|\.deps|coverage|playwright-report|test-results|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)\//,
    label: 'dependency, cache or report directory',
  },
  { pattern: /(?:^|\/)(?:\.coverage|\.DS_Store)$|\.pyc$/, label: 'local cache file' },
  { pattern: /(?:^|\/)(?:id_rsa[^/]*|[^/]+\.(?:pem|key|p12))$/i, label: 'credential-shaped file name' },
];

/**
 * @typedef {(command: string, args: string[], options?: { cwd?: string, env?: Record<string, string> }) => Buffer} Run
 * @typedef {{ mode: string, path: string }} Entry
 * @typedef {{ path: string, data: Uint8Array, mode: number }} TarFile
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 * @returns {Buffer}
 */
export function defaultRun(command, args, options = {}) {
  return execFileSync(command, args, {
    ...options,
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', ...options.env },
  });
}

/**
 * @param {string} clone
 * @param {Run} run
 */
export function defaultBuild(clone, run) {
  run('npm', ['ci'], { cwd: clone });
  run('npm', ['run', 'build'], { cwd: clone });
}

/**
 * @param {string} repo
 * @param {string} ref
 * @param {Run} run
 * @returns {string} the full 40-hex commit id
 */
export function resolveCommit(repo, ref, run) {
  /** @type {string} */
  let sha = '';
  if (!ref.startsWith('-')) {
    try {
      sha = run('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`]).toString('utf8').trim();
    } catch {
      sha = '';
    }
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a commit: ${ref}`);
  return sha;
}

/**
 * @param {Buffer} buffer output of `git ls-files -s -z`
 * @returns {Entry[]}
 */
export function parseLsFiles(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const match = /^(\d{6}) [0-9a-f]+ (\d)\t([\s\S]+)$/.exec(record);
      if (!match) throw new Error(`unreadable ls-files record: ${record}`);
      if (match[2] !== '0') throw new Error(`unmerged index entry: ${match[3]}`);
      return { mode: /** @type {string} */ (match[1]), path: /** @type {string} */ (match[3]) };
    });
}

/**
 * @param {string} name full entry name
 * @returns {[string, string]} ustar prefix and base name
 */
export function splitUstarName(name) {
  if (Buffer.byteLength(name) <= USTAR_NAME_MAX) return ['', name];
  for (let index = name.indexOf('/'); index !== -1; index = name.indexOf('/', index + 1)) {
    const prefix = name.slice(0, index);
    const base = name.slice(index + 1);
    if (Buffer.byteLength(base) <= USTAR_NAME_MAX && Buffer.byteLength(prefix) <= USTAR_PREFIX_MAX) return [prefix, base];
  }
  throw new Error(`path too long for ustar: ${name}`);
}

/**
 * @param {string} path
 * @returns {string | undefined} label of the first forbidden rule the path matches
 */
export function forbiddenLabel(path) {
  return FORBIDDEN_RULES.find(({ pattern }) => pattern.test(path))?.label;
}

/**
 * @param {Entry[]} entries
 * @returns {string[]} problems, one line each
 */
export function checkEntries(entries) {
  /** @type {string[]} */
  const problems = [];
  for (const { mode, path } of entries) {
    if (mode === '120000') problems.push(`${path}: symlink`);
    else if (mode === '160000') problems.push(`${path}: submodule`);
    const label = forbiddenLabel(path);
    if (label !== undefined) problems.push(`${path}: ${label}`);
    if (/[^\x20-\x7e]/.test(path)) problems.push(`${JSON.stringify(path)}: non-ASCII or control character in path`);
    else {
      try {
        splitUstarName(`${PLACEHOLDER_TOP_DIR}${path}`);
      } catch {
        problems.push(`${path}: path too long for ustar`);
      }
    }
  }
  return problems;
}

/**
 * @param {number} value
 * @param {number} width
 */
function octal(value, width) {
  return value.toString(8).padStart(width - 1, '0');
}

/**
 * @param {Buffer} header
 * @param {string} text
 * @param {number} offset
 * @param {number} length
 */
function putText(header, text, offset, length) {
  header.write(text, offset, length, 'utf8');
}

/**
 * @param {string} name full entry name
 * @param {Uint8Array} data
 * @param {number} mode
 * @param {number} mtime seconds since the epoch
 * @returns {Buffer[]} header, data and zero padding blocks
 */
export function tarEntry(name, data, mode, mtime) {
  if (data.length > SIZE_MAX) throw new Error(`file too large for ustar: ${name}`);
  const [prefix, base] = splitUstarName(name);
  const header = Buffer.alloc(BLOCK);
  putText(header, base, 0, USTAR_NAME_MAX);
  putText(header, octal(mode, 8), 100, 8);
  putText(header, octal(0, 8), 108, 8);
  putText(header, octal(0, 8), 116, 8);
  putText(header, octal(data.length, 12), 124, 12);
  putText(header, octal(mtime, 12), 136, 12);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 'utf8');
  putText(header, 'ustar', 257, 6);
  putText(header, '00', 263, 2);
  putText(header, prefix, 345, USTAR_PREFIX_MAX);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  putText(header, `${octal(checksum, 7)}\0 `, 148, 8);
  const padding = Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK);
  return [header, Buffer.from(data), padding];
}

/**
 * @param {TarFile[]} files names are full entry names
 * @param {number} mtime seconds since the epoch
 * @returns {Buffer} gzip-compressed ustar archive, identical for identical input
 */
export function buildTarGz(files, mtime) {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const blocks = sorted.flatMap(({ path, data, mode }) => tarEntry(path, data, mode, mtime));
  blocks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

/**
 * @param {Uint8Array | string} data
 * @returns {string} lowercase hex sha256
 */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * @param {{ commit: string, version: string, nodeVersion: string, npmVersion: string, minCrew: string, files: { path: string, sha256: string }[] }} fields
 * @returns {string} RELEASE-MANIFEST.txt text
 */
export function renderManifest({ commit, version, nodeVersion, npmVersion, minCrew, files }) {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return [
    'Specters of the Abyss release manifest',
    `commit: ${commit}`,
    `version: ${version}`,
    `node: ${nodeVersion}`,
    `npm: ${npmVersion}`,
    `minKiroCrewVersion: ${minCrew}`,
    'install guide: docs/release/install.md',
    `files: ${sorted.length}`,
    '',
    ...sorted.map(({ path, sha256: hash }) => `${hash}  ${path}`),
    '',
  ].join('\n');
}

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
export function readJson(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

/**
 * @param {string} dir
 * @returns {string[]} file paths relative to dir
 */
function listRelative(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listRelative(path).map((child) => `${name}/${child}`) : [name];
  });
}

/**
 * @param {string} clone
 * @returns {string[]} problems with the release content of the build
 */
export function assertRelease(clone) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Record<string, unknown>} */
  let app;
  /** @type {Record<string, unknown>} */
  let pkg;
  try {
    app = readJson(join(clone, 'app.json'));
    pkg = readJson(join(clone, 'package.json'));
  } catch (error) {
    return [`app.json or package.json unreadable: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (app.name !== APP_NAME) problems.push(`app.json name is ${JSON.stringify(app.name)}, expected ${APP_NAME}`);
  if (typeof app.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(app.version)) problems.push(`app.json version ${JSON.stringify(app.version)} is not x.y.z`);
  else if (app.version !== pkg.version) problems.push(`app.json version ${app.version} differs from package.json version ${String(pkg.version)}`);
  if (typeof app.minKiroCrewVersion !== 'string') problems.push('app.json has no minKiroCrewVersion');
  for (const file of REQUIRED_FILES) if (!existsSync(join(clone, file))) problems.push(`${file}: required file missing`);
  const dist = join(clone, 'ui/dist');
  const built = existsSync(dist) ? listRelative(dist).sort() : [];
  if (built.length !== 1 || built[0] !== 'index.mjs') problems.push(`ui/dist must hold exactly index.mjs, found: ${built.join(', ') || 'nothing'}`);
  for (const name of built) {
    const label = forbiddenLabel(`ui/dist/${name}`);
    if (label !== undefined) problems.push(`ui/dist/${name}: ${label}`);
  }
  const nvmrc = existsSync(join(clone, '.nvmrc')) ? readFileSync(join(clone, '.nvmrc'), 'utf8').trim().replace(/^v/, '') : '';
  const pinned = Number.parseInt(nvmrc, 10);
  const running = Number.parseInt(process.versions.node, 10);
  if (pinned !== running) problems.push(`.nvmrc pins Node ${nvmrc || 'nothing'} but this is Node ${process.versions.node}`);
  return problems;
}

/**
 * @param {string} mode git file mode
 * @returns {number}
 */
function tarMode(mode) {
  return mode === '100755' ? 0o755 : 0o644;
}

/**
 * @param {string} text
 * @returns {string}
 */
function firstLine(text) {
  return text.split('\n')[0] ?? '';
}

/**
 * Lists the tracked release files of a checked-out clone, builds it and validates the build.
 *
 * @param {{ src: string, run: Run, build: (clone: string, run: Run) => void, log: (line: string) => void, scrub: (line: string) => string, prefix?: string }} input
 * @returns {Entry[] | null} the tracked entries that ship, or null after logging each problem
 */
export function buildReleaseEntries({ src, run, build, log, scrub, prefix = 'package' }) {
  const entries = parseLsFiles(run('git', ['-C', src, 'ls-files', '-s', '-z'])).filter(({ path }) => !RELEASE_EXCLUDED.test(path));
  const problems = checkEntries(entries);
  if (problems.length > 0) {
    for (const problem of problems) log(`${prefix}: ${problem}`);
    return null;
  }
  try {
    build(src, run);
  } catch (error) {
    log(`${prefix}: build failed: ${scrub(firstLine(error instanceof Error ? error.message : String(error)))}`);
    return null;
  }
  /** @type {string[]} */
  const fixtureLog = [];
  const fixtureCode = checkFixtures({
    dir: join(src, 'ui/dist'),
    backendDir: join(src, 'backend'),
    manifest: join(src, 'app.json'),
    releaseRoots: [src, join(src, 'ui'), join(src, 'backend')],
    log: (line) => fixtureLog.push(scrub(line)),
  });
  if (fixtureCode !== 0) {
    for (const line of fixtureLog) log(`${prefix}: ${line}`);
    log(`${prefix}: fixture or diagnostic content in the release tree`);
    return null;
  }
  const releaseProblems = assertRelease(src);
  if (entries.some(({ path }) => path === BUILT_ENTRY)) releaseProblems.push(`${BUILT_ENTRY}: tracked, but it must come from the build`);
  if (releaseProblems.length > 0) {
    for (const problem of releaseProblems) log(`${prefix}: ${problem}`);
    return null;
  }
  return entries;
}

/**
 * @param {{ repo?: string, ref?: string, outDir?: string, run?: Run, build?: (clone: string, run: Run) => void, log?: (line: string) => void, tmpRoot?: string }} [options]
 * @returns {number} process exit code
 */
export function packageRelease({ repo = '.', ref = 'HEAD', outDir = DEFAULT_OUT_DIR, run = defaultRun, build = defaultBuild, log = console.log, tmpRoot = tmpdir() } = {}) {
  /** @type {string | undefined} */
  let work;
  /** @type {string[]} */
  const writing = [];
  try {
    const repoPath = resolve(repo);
    const outPath = resolve(outDir);
    try {
      run('git', ['-C', repoPath, 'rev-parse', '--git-dir']);
    } catch {
      log(`package: ${repo} is not a git repository`);
      return 1;
    }
    const insideRepo = relative(repoPath, outPath);
    const underRelease = insideRepo === DEFAULT_OUT_DIR || insideRepo.startsWith(`${DEFAULT_OUT_DIR}/`);
    if (!insideRepo.startsWith('..') && !isAbsolute(insideRepo) && !underRelease) {
      log(`package: --out ${outDir} is inside the repository; use ${DEFAULT_OUT_DIR} or a directory outside it`);
      return 1;
    }
    const sha = resolveCommit(repoPath, ref, run);
    work = mkdtempSync(join(tmpRoot, 'specter-package-'));
    const src = join(work, 'src');
    /** @param {string} line */
    const scrub = (line) => line.split(src).join('<clone>');
    run('git', ['clone', '--quiet', '--no-local', '--no-checkout', '-c', 'core.autocrlf=false', '--', repoPath, src]);
    try {
      run('git', ['-C', src, 'checkout', '--quiet', '--detach', sha]);
    } catch {
      log(`package: commit ${sha} is not reachable from a branch or tag of ${repo}; create a branch first`);
      return 1;
    }
    const finalOut = resolve(outDir);
    const insideWork = relative(work, finalOut);
    if (!insideWork.startsWith('..') && !isAbsolute(insideWork)) {
      log('package: --out must not be inside the temporary build clone');
      return 1;
    }
    const entries = buildReleaseEntries({ src, run, build, log, scrub });
    if (entries === null) return 1;
    const app = readJson(join(src, 'app.json'));
    const version = /** @type {string} */ (app.version);
    const name = `${APP_NAME}-${version}-${sha.slice(0, 12)}`;
    /** @type {TarFile[]} */
    const files = [
      ...entries.map(({ mode, path }) => ({ path, data: readFileSync(join(src, path)), mode: tarMode(mode) })),
      { path: BUILT_ENTRY, data: readFileSync(join(src, BUILT_ENTRY)), mode: 0o644 },
    ];
    const manifest = Buffer.from(
      renderManifest({
        commit: sha,
        version,
        nodeVersion: process.versions.node,
        npmVersion: run('npm', ['--version'], { cwd: src }).toString('utf8').trim(),
        minCrew: /** @type {string} */ (app.minKiroCrewVersion),
        files: files.map(({ path, data }) => ({ path, sha256: sha256(data) })),
      }),
    );
    files.push({ path: MANIFEST_NAME, data: manifest, mode: 0o644 });
    const mtime = Number(run('git', ['-C', src, 'show', '-s', '--format=%ct', sha]).toString('utf8').trim());
    const tarball = buildTarGz(
      files.map((file) => ({ ...file, path: `${name}/${file.path}` })),
      mtime,
    );
    const archive = join(finalOut, `${name}.tar.gz`);
    const sidecar = `${archive}.sha256`;
    const hash = sha256(tarball);
    mkdirSync(finalOut, { recursive: true });
    writing.push(`${archive}.tmp`, `${sidecar}.tmp`);
    writeFileSync(`${archive}.tmp`, tarball);
    writeFileSync(`${sidecar}.tmp`, `${hash}  ${name}.tar.gz\n`);
    renameSync(`${archive}.tmp`, archive);
    writing.push(archive);
    renameSync(`${sidecar}.tmp`, sidecar);
    writing.length = 0;
    log(`package: wrote ${join(outDir, `${name}.tar.gz`)}`);
    log(`package: sha256 ${hash}`);
    log(`package: commit ${sha}`);
    log(`package: files ${files.length}`);
    return 0;
  } catch (error) {
    for (const path of writing) rmSync(path, { force: true });
    log(`package: ${error instanceof Error ? firstLine(error.message) : String(error)}`);
    return 1;
  } finally {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  }
}

/**
 * @param {string[]} args
 * @returns {{ ref: string, outDir: string }}
 */
export function parseArgs(args) {
  let ref = 'HEAD';
  let outDir = DEFAULT_OUT_DIR;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value === '' || (flag !== '--commit' && flag !== '--out')) {
      throw new Error('usage: npm run package -- [--commit <ref>] [--out <dir>]');
    }
    if (flag === '--commit') ref = value;
    else outDir = value;
  }
  return { ref, outDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = packageRelease(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
