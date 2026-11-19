import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { DIAGNOSTIC_MARKER, FIXTURE_MARKER } from '../check-fixtures.mjs';
import { QA_ART } from '../check-provenance.mjs';
import {
  FORBIDDEN_RULES,
  assertRelease,
  buildTarGz,
  checkEntries,
  defaultBuild,
  defaultRun,
  packageRelease,
  parseArgs,
  parseLsFiles,
  renderManifest,
  resolveCommit,
  sha256,
  splitUstarName,
  tarEntry,
} from '../package.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';
process.env.GIT_AUTHOR_DATE = '2026-11-18T00:00:00Z';
process.env.GIT_COMMITTER_DATE = '2026-11-18T00:00:00Z';

const scratch = mkdtempSync(join(tmpdir(), 'package-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const realApp = JSON.parse(readFileSync('app.json', 'utf8'));
const nodeMajor = process.versions.node.split('.')[0] ?? '';

/** @type {import('../package.mjs').Run} */
const testRun = (command, args, options) => (command === 'npm' ? Buffer.from('11.20.0\n') : defaultRun(command, args, options));

/** @param {string} cwd @param {...string} args */
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** @param {string} root @param {string} path @param {string | Buffer} text */
function put(root, path, text) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** @param {Record<string, string | null>} [overrides] null removes a base file */
function baseFiles(overrides = {}) {
  /** @type {Record<string, string>} */
  const files = {
    'app.json': `${JSON.stringify({ ...realApp, version: '0.1.0' }, null, 2)}\n`,
    'package.json': '{"name":"specter-arena","version":"0.1.0"}\n',
    '.nvmrc': `${nodeMajor}\n`,
    '.gitignore': 'node_modules/\nui/dist/\n',
    LICENSE: 'MIT\n',
    'requirements.txt': 'starlette==1\n',
    'package-lock.json': '{}\n',
    'DEPENDENCIES.md': 'deps\n',
    'docs/provenance.md': 'provenance\n',
    'docs/release/install.md': 'install\n',
    'docs/release/blockers.md': 'blockers\n',
    'backend/app.py': 'app = 1\n',
    'ui/src/a.ts': 'export const a = 1;\n',
    '.env.example': 'KEY=\n',
  };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return files;
}

/** @param {Record<string, string>} files @returns {string} repo root, one commit on main */
function gitRepo(files) {
  const root = mkdtempSync(join(scratch, 'repo-'));
  git(root, 'init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries(files)) put(root, path, text);
  git(root, 'add', '-Af');
  git(root, 'commit', '-q', '-m', 'x');
  return root;
}

/** @param {string} root @param {string} [message] */
function commitAll(root, message = 'y') {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** @type {(clone: string) => void} */
const cleanBuild = (clone) => put(clone, 'ui/dist/index.mjs', 'export default 1;');

/**
 * @param {string} repo
 * @param {{ ref?: string, build?: (clone: string, run: import('../package.mjs').Run) => void, outDir?: string, tmpRoot?: string, run?: import('../package.mjs').Run }} [options]
 */
function pack(repo, { ref = 'HEAD', build = cleanBuild, outDir, tmpRoot, run = testRun } = {}) {
  const out = outDir ?? mkdtempSync(join(scratch, 'out-'));
  /** @type {string[]} */
  const lines = [];
  const code = packageRelease({ repo, ref, outDir: out, run, build, tmpRoot: tmpRoot ?? mkdtempSync(join(scratch, 'tmp-')), log: (line) => lines.push(line) });
  return { code, lines, out, text: lines.join('\n') };
}

/** @param {string} out @returns {string[]} */
const artifacts = (out) => (existsSync(out) ? readdirSync(out) : []);

/** @param {string} file @returns {string} extraction directory */
function extract(file) {
  const dest = mkdtempSync(join(scratch, 'x-'));
  execFileSync('tar', ['-xzf', file, '-C', dest]);
  return dest;
}

/** @param {string} out @returns {string} */
const tarballIn = (out) => join(out, /** @type {string} */ (artifacts(out).find((name) => name.endsWith('.tar.gz'))));

describe('forbidden paths', () => {
  const forbidden = [
    '.env',
    '.env.local',
    '.probe-app/x',
    '.probe-enabled',
    'data/store/specter-arena.db',
    'a.db',
    'x-light-dark-check.jpg',
    'reference-crops/a.png',
    'roster-reference.png',
    'x-master.png',
    'ui/preview-dist/a',
    'ui/diagnostic-dist/a',
    'infra/cdk.out/a',
    'node_modules/a',
    '.venv/a',
    '.deps/a',
    'coverage/a',
    'playwright-report/a',
    'test-results/a',
    '.release/a',
    'a/__pycache__/b.pyc',
    '.DS_Store',
    'k.pem',
  ];

  for (const path of forbidden) {
    it(`refuses ${path}`, () => {
      const repo = gitRepo(baseFiles({ [path]: 'x' }));
      const result = pack(repo);
      assert.equal(result.code, 1);
      assert.match(result.text, new RegExp(`package: ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
      assert.deepEqual(artifacts(result.out), []);
    });
  }

  it('covers every rule with at least one example', () => {
    for (const { pattern } of FORBIDDEN_RULES) assert.ok(forbidden.some((path) => pattern.test(path)), String(pattern));
  });

  it('allows look-alikes', () => {
    const repo = gitRepo(
      baseFiles({
        'probe/manifest-overlay.json': '{}',
        'backend/specter_arena/probe/x.py': 'x = 1\n',
        'scripts/stage-probe-app.mjs': 'x\n',
        'docs/ops/crew-probe-runbook.md': 'x\n',
      }),
    );
    const result = pack(repo);
    assert.equal(result.code, 0, result.text);
  });
});

describe('packageRelease content', () => {
  it('ships exactly the tracked files at the commit plus the build', () => {
    const repo = gitRepo(baseFiles({ 'backend/data-notes.md': 'committed\n' }));
    put(repo, 'backend/app.py', 'app = "modified only in the working tree"\n');
    put(repo, 'untracked.txt', 'untracked');
    put(repo, 'node_modules/x/index.js', 'ignored');
    const result = pack(repo);
    assert.equal(result.code, 0, result.text);
    const root = extract(tarballIn(result.out));
    const [top] = readdirSync(root);
    assert.match(top ?? '', /^specter-arena-0\.1\.0-[0-9a-f]{12}$/);
    const dir = join(root, top ?? '');
    assert.equal(readFileSync(join(dir, 'backend/app.py'), 'utf8'), 'app = 1\n');
    assert.equal(readFileSync(join(dir, 'ui/dist/index.mjs'), 'utf8'), 'export default 1;');
    assert.equal(existsSync(join(dir, 'untracked.txt')), false);
    assert.equal(existsSync(join(dir, 'node_modules')), false);
    assert.ok(existsSync(join(dir, '.env.example')));
  });

  it('keeps the executable bit of a tracked script', () => {
    const repo = gitRepo(baseFiles({ 'run.sh': '#!/bin/sh\n' }));
    git(repo, 'update-index', '--chmod=+x', 'run.sh');
    git(repo, 'commit', '-q', '-m', 'exec');
    const result = pack(repo);
    const dir = join(extract(tarballIn(result.out)), /** @type {string} */ (readdirSync(extract(tarballIn(result.out)))[0]));
    assert.equal(statSync(join(dir, 'run.sh')).mode & 0o111, 0o111);
    assert.equal(statSync(join(dir, 'LICENSE')).mode & 0o111, 0);
  });

  it('writes a manifest and a sidecar that match the files', () => {
    const repo = gitRepo(baseFiles());
    const sha = git(repo, 'rev-parse', 'HEAD');
    const result = pack(repo);
    assert.equal(result.code, 0, result.text);
    const tarball = tarballIn(result.out);
    const root = extract(tarball);
    const dir = join(root, /** @type {string} */ (readdirSync(root)[0]));
    const manifest = readFileSync(join(dir, 'RELEASE-MANIFEST.txt'), 'utf8');
    const [header = '', listing = ''] = manifest.split('\n\n');
    assert.match(header, new RegExp(`^Specter Arena release manifest\\ncommit: ${sha}\\nversion: 0\\.1\\.0\\n`));
    assert.match(header, /minKiroCrewVersion: \d+\.\d+\.\d+\n/);
    assert.doesNotMatch(manifest, new RegExp(userInfo().username.length > 3 ? userInfo().username : '\u0000'));
    const lines = listing.trim().split('\n');
    assert.equal(header.match(/files: (\d+)/)?.[1], String(lines.length));
    for (const line of lines) {
      const [hash, path] = /** @type {[string, string]} */ (line.split('  '));
      assert.equal(sha256(readFileSync(join(dir, path))), hash, path);
    }
    assert.equal(readFileSync(`${tarball}.sha256`, 'utf8'), `${sha256(readFileSync(tarball))}  ${tarball.split('/').pop()}\n`);
    execFileSync('shasum', ['-a', '256', '-c', `${tarball.split('/').pop()}.sha256`], { cwd: result.out });
  });

  it('is byte-identical across runs and carries no owner names', () => {
    const repo = gitRepo(baseFiles());
    const first = pack(repo);
    const here = process.cwd();
    process.chdir(scratch);
    const second = pack(repo);
    process.chdir(here);
    assert.deepEqual(readFileSync(tarballIn(first.out)), readFileSync(tarballIn(second.out)));
    const listing = execFileSync('tar', ['-tvzf', tarballIn(first.out)], { encoding: 'utf8' }).trim().split('\n');
    for (const line of listing) {
      const columns = line.split(/\s+/).slice(0, 3).join(' ');
      assert.match(columns, /^\S+ (?:0 0|0\/0)(?: |$)/, line);
      assert.equal(columns.includes(userInfo().username), false, line);
    }
  });

  it('round-trips an 83-byte path under the top directory', () => {
    const path = 'contracts/cases/xp-history/v1/valid/award-correction-reinstatement-with-cursor.json';
    assert.equal(Buffer.byteLength(path), 83);
    const repo = gitRepo(baseFiles({ [path]: '{"ok":true}' }));
    const result = pack(repo);
    assert.equal(result.code, 0, result.text);
    const root = extract(tarballIn(result.out));
    assert.equal(readFileSync(join(root, /** @type {string} */ (readdirSync(root)[0]), path), 'utf8'), '{"ok":true}');
  });
});

describe('packageRelease failures', () => {
  it('refuses a symlink', () => {
    const repo = gitRepo(baseFiles());
    symlinkSync('app.json', join(repo, 'link'));
    commitAll(repo);
    const result = pack(repo);
    assert.equal(result.code, 1);
    assert.match(result.text, /package: link: symlink/);
    assert.deepEqual(artifacts(result.out), []);
  });

  it('refuses a submodule entry', () => {
    const repo = gitRepo(baseFiles());
    git(repo, 'update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},sub`);
    git(repo, 'commit', '-q', '-m', 'gitlink');
    const result = pack(repo);
    assert.equal(result.code, 1);
    assert.match(result.text, /package: sub: submodule/);
  });

  for (const marker of [FIXTURE_MARKER, DIAGNOSTIC_MARKER]) {
    it(`fails the build carrying ${marker}`, () => {
      const repo = gitRepo(baseFiles());
      const result = pack(repo, { build: (clone) => put(clone, 'ui/dist/index.mjs', `export default "${marker}";`) });
      assert.equal(result.code, 1);
      assert.match(result.text, /package: check:fixtures: <clone>\/ui\/dist\/index\.mjs contains/);
      assert.match(result.text, /fixture or diagnostic content/);
      assert.doesNotMatch(result.text, new RegExp(scratch));
      assert.deepEqual(artifacts(result.out), []);
    });
  }

  it('passes the clean build', () => {
    assert.equal(pack(gitRepo(baseFiles())).code, 0);
  });

  it('stops on a tracked probe switch before building', () => {
    const repo = gitRepo(baseFiles({ '.probe-enabled': '' }));
    /** @type {string[]} */
    const built = [];
    const result = pack(repo, { build: (clone) => built.push(clone) });
    assert.equal(result.code, 1);
    assert.match(result.text, /package: \.probe-enabled: probe artifact/);
    assert.deepEqual(built, []);
  });

  it('rejects an extra file in ui/dist', () => {
    const repo = gitRepo(baseFiles());
    const result = pack(repo, {
      build: (clone) => {
        cleanBuild(clone);
        put(clone, 'ui/dist/x.png', 'png');
      },
    });
    assert.equal(result.code, 1);
    assert.match(result.text, /ui\/dist must hold exactly index\.mjs, found: index\.mjs, x\.png/);
  });

  it('rejects a missing build output', () => {
    const result = pack(gitRepo(baseFiles()), { build: () => {} });
    assert.equal(result.code, 1);
    assert.match(result.text, /ui\/dist not found/);
  });

  it('rejects a tracked ui/dist/index.mjs', () => {
    const repo = gitRepo(baseFiles());
    put(repo, 'ui/dist/index.mjs', 'tracked');
    git(repo, 'add', '-f', 'ui/dist/index.mjs');
    git(repo, 'commit', '-q', '-m', 'tracked build');
    const result = pack(repo);
    assert.equal(result.code, 1);
    assert.match(result.text, /ui\/dist\/index\.mjs: tracked, but it must come from the build/);
  });

  it('reports a failing build without leaking the environment', () => {
    const repo = gitRepo(baseFiles());
    const result = pack(repo, {
      build: () => {
        throw new Error('Command failed: npm ci\nsecret details');
      },
    });
    assert.equal(result.code, 1);
    assert.equal(result.text, 'package: build failed: Command failed: npm ci');
  });

  it('reports a non-Error build failure', () => {
    const result = pack(gitRepo(baseFiles()), {
      build: () => {
        throw 'plain';
      },
    });
    assert.match(result.text, /build failed: plain/);
  });

  const mutations = /** @type {[string, Record<string, string | null>, RegExp][]} */ ([
    ['version mismatch', { 'package.json': '{"version":"0.2.0"}' }, /app\.json version 0\.1\.0 differs from package\.json version 0\.2\.0/],
    ['version not x.y.z', { 'app.json': JSON.stringify({ ...realApp, version: '1.0' }) }, /is not x\.y\.z/],
    ['wrong app name', { 'app.json': JSON.stringify({ ...realApp, name: 'other', version: '0.1.0' }) }, /name is "other"/],
    ['no minimum host version', { 'app.json': JSON.stringify({ ...realApp, version: '0.1.0', minKiroCrewVersion: undefined }) }, /no minKiroCrewVersion/],
    ['unpinned node', { '.nvmrc': '1\n' }, /\.nvmrc pins Node 1 but this is Node/],
    ['missing nvmrc', { '.nvmrc': null }, /\.nvmrc pins Node nothing/],
    ['missing LICENSE', { LICENSE: null }, /LICENSE: required file missing/],
    ['missing install guide', { 'docs/release/install.md': null }, /docs\/release\/install\.md: required file missing/],
    ['missing blocker list', { 'docs/release/blockers.md': null }, /docs\/release\/blockers\.md: required file missing/],
    ['invalid app.json', { 'app.json': 'not json' }, /app\.json is not valid JSON/],
    ['app.json not an object', { 'app.json': '[]' }, /is not a JSON object/],
  ]);
  for (const [title, overrides, expected] of mutations) {
    it(`fails on ${title}`, () => {
      const result = pack(gitRepo(baseFiles(overrides)));
      assert.equal(result.code, 1);
      assert.match(result.text, expected);
      assert.deepEqual(artifacts(result.out), []);
    });
  }

  it('fails on a non-ASCII path', () => {
    const result = pack(gitRepo(baseFiles({ 'caf\u00e9.txt': 'x' })));
    assert.equal(result.code, 1);
    assert.match(result.text, /non-ASCII or control character/);
  });

  it('fails on a path ustar cannot hold and names it', () => {
    const long = `${'a'.repeat(100)}/${'b'.repeat(100)}/${'c'.repeat(100)}.txt`;
    const result = pack(gitRepo(baseFiles({ [long]: 'x' })));
    assert.equal(result.code, 1);
    assert.ok(result.text.includes(`package: ${long}: path too long for ustar`));
  });

  it('rejects an unknown ref', () => {
    const result = pack(gitRepo(baseFiles()), { ref: 'nope' });
    assert.equal(result.code, 1);
    assert.match(result.text, /package: not a commit: nope/);
  });

  it('rejects a directory that is not a repository', () => {
    const result = pack(mkdtempSync(join(scratch, 'plain-')));
    assert.equal(result.code, 1);
    assert.match(result.text, /is not a git repository/);
  });

  it('rejects a commit that no branch or tag reaches', () => {
    const repo = gitRepo(baseFiles());
    git(repo, 'checkout', '-q', '--detach');
    put(repo, 'orphan.txt', 'x');
    const orphan = commitAll(repo, 'orphan');
    git(repo, 'checkout', '-q', 'main');
    const result = pack(repo, { ref: orphan });
    assert.equal(result.code, 1);
    assert.match(result.text, new RegExp(`commit ${orphan} is not reachable from a branch or tag`));
  });

  it('rejects --out inside the repository except .release', () => {
    const repo = gitRepo(baseFiles());
    const result = pack(repo, { outDir: join(repo, 'docs') });
    assert.equal(result.code, 1);
    assert.match(result.text, /is inside the repository/);
    const allowed = pack(repo, { outDir: join(repo, '.release') });
    assert.equal(allowed.code, 0, allowed.text);
    const nested = pack(repo, { outDir: join(repo, '.release', 'sub') });
    assert.equal(nested.code, 0, nested.text);
  });

  it('rejects --out inside the temporary clone', () => {
    const repo = gitRepo(baseFiles());
    const here = process.cwd();
    /** @type {import('../package.mjs').Run} */
    const moving = (command, args, options) => {
      if (command === 'git' && args.includes('clone')) process.chdir(dirname(/** @type {string} */ (args.at(-1))));
      return testRun(command, args, options);
    };
    try {
      /** @type {string[]} */
      const lines = [];
      const code = packageRelease({ repo, outDir: 'out', run: moving, build: cleanBuild, tmpRoot: mkdtempSync(join(scratch, 'tmp-')), log: (line) => lines.push(line) });
      assert.equal(code, 1);
      assert.match(lines.join('\n'), /must not be inside the temporary build clone/);
    } finally {
      process.chdir(here);
    }
  });

  it('removes the temporary clone after success and after failure', () => {
    const repo = gitRepo(baseFiles());
    const ok = mkdtempSync(join(scratch, 'tmp-'));
    assert.equal(pack(repo, { tmpRoot: ok }).code, 0);
    assert.deepEqual(readdirSync(ok), []);
    const bad = mkdtempSync(join(scratch, 'tmp-'));
    assert.equal(pack(repo, { tmpRoot: bad, build: () => assert.fail('boom') }).code, 1);
    assert.deepEqual(readdirSync(bad), []);
  });

  it('leaves no partial or temporary output when writing fails', () => {
    const repo = gitRepo(baseFiles());
    const sha = git(repo, 'rev-parse', 'HEAD');
    const out = mkdtempSync(join(scratch, 'out-'));
    const sidecar = join(out, `specter-arena-0.1.0-${sha.slice(0, 12)}.tar.gz.sha256`);
    mkdirSync(join(sidecar, 'blocker'), { recursive: true });
    const result = pack(repo, { outDir: out });
    assert.equal(result.code, 1);
    assert.deepEqual(readdirSync(out), [`specter-arena-0.1.0-${sha.slice(0, 12)}.tar.gz.sha256`]);
  });
});

describe('helpers', () => {
  it('resolveCommit accepts a branch and rejects an option-shaped ref', () => {
    const repo = gitRepo(baseFiles());
    assert.equal(resolveCommit(repo, 'main', defaultRun), git(repo, 'rev-parse', 'HEAD'));
    assert.throws(() => resolveCommit(repo, '--all', defaultRun), /not a commit: --all/);
  });

  it('parseLsFiles reads modes and paths and rejects bad records', () => {
    const entries = parseLsFiles(Buffer.from(`100755 ${'a'.repeat(40)} 0\tdir/a b.sh\x00120000 ${'b'.repeat(40)} 0\tl\0`));
    assert.deepEqual(entries, [
      { mode: '100755', path: 'dir/a b.sh' },
      { mode: '120000', path: 'l' },
    ]);
    assert.throws(() => parseLsFiles(Buffer.from('garbage\0')), /unreadable ls-files record/);
    assert.throws(() => parseLsFiles(Buffer.from(`100644 ${'a'.repeat(40)} 2\tx\0`)), /unmerged index entry: x/);
  });

  it('assertRelease reports an unreadable manifest and a missing dist directory', () => {
    const dir = mkdtempSync(join(scratch, 'bare-'));
    assert.match(assertRelease(dir)[0] ?? '', /app\.json or package\.json unreadable/);
    put(dir, 'app.json', JSON.stringify({ name: 'specter-arena', version: '0.1.0', minKiroCrewVersion: '0.12.0' }));
    put(dir, 'package.json', '{"version":"0.1.0"}');
    assert.ok(assertRelease(dir).some((problem) => problem.includes('found: nothing')));
  });

  it('checkEntries passes ordinary paths', () => {
    assert.deepEqual(checkEntries([{ mode: '100644', path: 'a/b.txt' }]), []);
  });

  it('splitUstarName handles the 100-byte and prefix boundaries', () => {
    assert.deepEqual(splitUstarName('a/b'), ['', 'a/b']);
    const hundred = `d/${'x'.repeat(98)}`;
    assert.deepEqual(splitUstarName(hundred), ['', hundred]);
    const longBase = `top/${'x'.repeat(98)}/y`;
    assert.equal(Buffer.byteLength(longBase), 104);
    assert.deepEqual(splitUstarName(longBase), ['top', `${'x'.repeat(98)}/y`]);
    assert.deepEqual(splitUstarName(`${'p'.repeat(155)}/${'b'.repeat(100)}`), ['p'.repeat(155), 'b'.repeat(100)]);
    assert.throws(() => splitUstarName(`${'p'.repeat(156)}/${'b'.repeat(100)}`), /path too long for ustar/);
    assert.throws(() => splitUstarName('x'.repeat(101)), /path too long for ustar: x+/);
  });

  it('tarEntry writes a ustar header with zero owners and no names', () => {
    const [header, data, padding] = /** @type {[Buffer, Buffer, Buffer]} */ (tarEntry('top/dir/file.txt', Buffer.from('hello'), 0o644, 1000));
    assert.equal(header.length, 512);
    assert.equal(data.toString(), 'hello');
    assert.equal(padding.length, 507);
    assert.equal(header.subarray(257, 263).toString(), 'ustar\0');
    assert.equal(header.subarray(108, 116).toString(), '0000000\0');
    assert.equal(header.subarray(116, 124).toString(), '0000000\0');
    assert.ok(header.subarray(265, 329).every((byte) => byte === 0));
    const stored = Number.parseInt(header.subarray(148, 154).toString(), 8);
    const blanked = Buffer.from(header);
    blanked.fill(0x20, 148, 156);
    assert.equal(stored, blanked.reduce((sum, byte) => sum + byte, 0));
  });

  it('tarEntry refuses a file ustar cannot size', () => {
    assert.throws(() => tarEntry('a', /** @type {Uint8Array} */ ({ length: 8 ** 11 }), 0o644, 0), /file too large/);
  });

  it('buildTarGz sorts by name and ends with two zero blocks', () => {
    const tar = gunzipSync(
      buildTarGz(
        [
          { path: 't/b', data: Buffer.from('b'), mode: 0o644 },
          { path: 't/a', data: Buffer.from('a'), mode: 0o644 },
        ],
        0,
      ),
    );
    assert.equal(tar.length, 512 * 6);
    assert.ok(tar.subarray(0, 100).toString().startsWith('t/a'));
    assert.ok(tar.subarray(1024, 1124).toString().startsWith('t/b'));
    assert.ok(tar.subarray(2048).every((byte) => byte === 0));
  });

  it('renderManifest sorts files and ends with a newline', () => {
    const text = renderManifest({
      commit: 'c'.repeat(40),
      version: '0.1.0',
      nodeVersion: '26.0.0',
      npmVersion: '11.0.0',
      minCrew: '0.12.0',
      files: [
        { path: 'b', sha256: '2' },
        { path: 'a', sha256: '1' },
      ],
    });
    assert.equal(text.split('\n').slice(-3).join('|'), '1  a|2  b|');
    assert.match(text, /^Specter Arena release manifest\ncommit: c{40}\n/);
    assert.match(text, /files: 2\n\n1 {2}a/);
  });

  it('defaultRun runs a real command and defaultBuild runs npm ci then the build', () => {
    assert.match(defaultRun('git', ['--version']).toString(), /^git version/);
    /** @type {string[][]} */
    const calls = [];
    defaultBuild('/clone', (command, args, options) => {
      calls.push([command, ...args, options?.cwd ?? '']);
      return Buffer.alloc(0);
    });
    assert.deepEqual(calls, [
      ['npm', 'ci', '/clone'],
      ['npm', 'run', 'build', '/clone'],
    ]);
  });

  it('parseArgs reads the flags and rejects the rest', () => {
    assert.deepEqual(parseArgs([]), { ref: 'HEAD', outDir: '.release' });
    assert.deepEqual(parseArgs(['--commit', 'abc', '--out', 'elsewhere']), { ref: 'abc', outDir: 'elsewhere' });
    assert.throws(() => parseArgs(['--bogus', 'x']), /usage: npm run package/);
    assert.throws(() => parseArgs(['--commit']), /usage: npm run package/);
  });

  it('the command line prints usage and exits 1 on a bad flag', () => {
    const result = spawnSync('node', ['scripts/package.mjs', '--bogus', 'x'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /usage: npm run package/);
  });

  it('every tracked file in this repository passes the rules', () => {
    const entries = parseLsFiles(execFileSync('git', ['ls-files', '-s', '-z'], { maxBuffer: 64 * 1024 * 1024 }));
    assert.ok(entries.length > 100);
    assert.deepEqual(checkEntries(entries), []);
  });

  it('QA_ART is the shared regular expression for the four documented shapes', () => {
    assert.ok(QA_ART instanceof RegExp);
    for (const path of ['x-light-dark-check.jpg', 'a/reference-crops/b.png', 'roster-reference.png', 'x-master.png']) assert.ok(QA_ART.test(path), path);
    assert.equal(QA_ART.test('backend/specter_arena/specters/scene/arena-map.png'), false);
  });
});
