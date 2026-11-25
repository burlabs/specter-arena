import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { UI_ICON_RASTERS } from '../check-provenance.mjs';
import { defaultRun, packageRelease } from '../package.mjs';
import {
  RELEASE_BRANCH,
  commitRefusal,
  diffPaths,
  expectedBranchPaths,
  listFiles,
  parseArgs,
  parseTarListing,
  previousTip,
  releaseBranch,
  renderRegistry,
  verifyBranchTree,
} from '../release-branch.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';
process.env.GIT_AUTHOR_NAME = 't';
process.env.GIT_AUTHOR_EMAIL = 't@example.invalid';
process.env.GIT_COMMITTER_NAME = 't';
process.env.GIT_COMMITTER_EMAIL = 't@example.invalid';

const scratch = mkdtempSync(join(tmpdir(), 'release-branch-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const realApp = JSON.parse(readFileSync('app.json', 'utf8'));
const nodeMajor = process.versions.node.split('.')[0] ?? '';
const app = Object.fromEntries(Object.entries(realApp).filter(([key]) => !/^(?:iconPath|heroImage|screenshots)/.test(key)));
const URL = 'https://github.com/burlabs/specter-arena';

/** @type {import('../package.mjs').Run} */
const testRun = (command, args, options) => (command === 'npm' ? Buffer.from('11.20.0\n') : defaultRun(command, args, options));

/** @param {string} cwd @param {...string} args */
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** @param {string} root @param {string} path @param {string | Buffer} text */
function put(root, path, text) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** @param {Record<string, string | null>} [overrides] */
function baseFiles(overrides = {}) {
  /** @type {Record<string, string>} */
  const files = {
    'app.json': `${JSON.stringify({ ...app, version: '0.1.0' }, null, 2)}\n`,
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
    'docs/images/banner.png': 'png\n',
    'avatar-packs/index.json': '{}\n',
    'app-registry.json': '[]\n',
    'infra/package.json': '{}\n',
    ...Object.fromEntries(UI_ICON_RASTERS.map((path) => [path, 'icon\n'])),
    'backend/app.py': 'app = 1\n',
    'ui/src/a.ts': 'export const a = 1;\n',
  };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return files;
}

/**
 * A checkout whose origin/main is the pushed main, like a developer clone.
 * @param {Record<string, string>} [files]
 * @returns {{ origin: string, repo: string }}
 */
function checkout(files = baseFiles()) {
  const origin = mkdtempSync(join(scratch, 'origin-'));
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const repo = mkdtempSync(join(scratch, 'repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries(files)) put(repo, path, text);
  git(repo, 'add', '-Af');
  git(repo, 'commit', '-q', '-m', 'x');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin');
  return { origin, repo };
}

/** @param {string} repo @param {string} path @param {string} text @param {boolean} [push] */
function advance(repo, path, text, push = true) {
  put(repo, path, text);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', `change ${path}`);
  if (push) {
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'fetch', '-q', 'origin');
  }
  return git(repo, 'rev-parse', 'HEAD');
}

/** @type {(clone: string) => void} */
const cleanBuild = (clone) => {
  put(clone, 'ui/dist/index.mjs', 'export default 1;');
  put(clone, 'store/note.txt', 'ignored by the checks\n');
};

/**
 * @param {string} repo
 * @param {Partial<Parameters<typeof releaseBranch>[0]>} [options]
 */
function release(repo, options = {}) {
  /** @type {string[]} */
  const lines = [];
  const code = releaseBranch({ repo, run: testRun, build: cleanBuild, tmpRoot: mkdtempSync(join(scratch, 'tmp-')), log: (line) => lines.push(line), ...options });
  return { code, lines, text: lines.join('\n') };
}

/** @param {string} repo @param {string} ref @param {string} path */
const show = (repo, ref, path) => git(repo, 'show', `${ref}:${path}`);

describe('renderRegistry', () => {
  it('points the index at the release branch and omits subdirectory', () => {
    const entries = JSON.parse(renderRegistry('specter-arena', URL));
    assert.deepEqual(entries, [{ name: 'specter-arena', gitUrl: URL, repo: URL, branch: RELEASE_BRANCH }]);
    assert.equal('subdirectory' in entries[0], false);
  });
});

describe('path lists', () => {
  it('derives the branch list from the tarball list: no package.json, plus the generated index', () => {
    assert.deepEqual(expectedBranchPaths(['b', 'package.json', 'a', 'infra/package.json']), ['a', 'app-registry.json', 'b', 'infra/package.json']);
  });

  it('strips the top directory and directory entries from a tar listing', () => {
    assert.deepEqual(parseTarListing('top/b\ntop/a/c\ntop/a/\n\n'), ['a/c', 'b']);
  });

  it('reports missing and extra paths', () => {
    assert.deepEqual(diffPaths(['a', 'x'], ['a', 'b']), ['b: missing from the branch tree', 'x: not in the tarball']);
    assert.deepEqual(diffPaths(['a'], ['a']), []);
  });
});

describe('parseArgs', () => {
  it('defaults to a real run at HEAD', () => {
    assert.deepEqual(parseArgs([]), { ref: 'HEAD', dryRun: false });
  });

  it('reads the commit and the dry-run options', () => {
    assert.deepEqual(parseArgs(['--commit', 'abc', '--dry-run', '--out', 'o', '--compare-tarball', 't.tar.gz']), { ref: 'abc', dryRun: true, outDir: 'o', compareTarball: 't.tar.gz' });
  });

  it('rejects an unknown flag, a missing value, and dry-run options on a real run', () => {
    for (const args of [['--nope'], ['--commit'], ['--commit', ''], ['--out', 'o'], ['--compare-tarball', 't']]) assert.throws(() => parseArgs(args), /usage: npm run release:branch/);
  });

  it('prints usage and exits 1 from the command line', () => {
    const result = spawnSync(process.execPath, ['scripts/release-branch.mjs', '--bogus'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /usage: npm run release:branch/);
  });
});

describe('verifyBranchTree', () => {
  /** @param {Record<string, string | null>} [overrides] */
  function tree(overrides = {}) {
    const dir = mkdtempSync(join(scratch, 'tree-'));
    /** @type {Record<string, string | null>} */
    const files = { 'app.json': JSON.stringify({ ...app, version: '0.1.0' }), 'ui/dist/index.mjs': 'x', 'app-registry.json': renderRegistry('specter-arena', URL), ...overrides };
    for (const [path, text] of Object.entries(files)) if (text !== null) put(dir, path, text);
    return dir;
  }

  it('accepts a tree with the built UI, a valid manifest and a release index', () => {
    assert.deepEqual(verifyBranchTree(tree()), []);
  });

  it('flags a missing UI bundle and each path the branch must not hold', () => {
    const found = verifyBranchTree(tree({ 'ui/dist/index.mjs': null, 'package.json': '{}', 'avatar-packs/a.json': '{}', 'docs/images/a.png': 'x', 'agents/a.md': 'x' }));
    assert.ok(found.some((line) => line.startsWith('ui/dist/index.mjs: missing')));
    for (const path of ['package.json', 'avatar-packs', 'docs/images', 'agents']) assert.ok(found.includes(`${path}: must not be on the release branch`), path);
  });

  it('flags an index that targets another branch', () => {
    const wrong = JSON.stringify([{ name: 'specter-arena', gitUrl: URL, repo: URL, branch: 'main' }]);
    assert.deepEqual(verifyBranchTree(tree({ 'app-registry.json': wrong })), ['app-registry.json: branch must be release']);
  });

  it('flags an index that is unreadable or invalid', () => {
    assert.match(verifyBranchTree(tree({ 'app-registry.json': '{' }))[0] ?? '', /^app-registry\.json: /);
    assert.match(verifyBranchTree(tree({ 'app-registry.json': null }))[0] ?? '', /^app-registry\.json: /);
    assert.match(verifyBranchTree(tree({ 'app-registry.json': '[]' }))[0] ?? '', /exactly one entry/);
  });

  it('flags a manifest with the wrong name, version or floor', () => {
    const found = verifyBranchTree(tree({ 'app.json': JSON.stringify({ name: 'other', version: '1' }) }));
    assert.ok(found.some((line) => line.startsWith('app.json name is "other"')));
    assert.ok(found.some((line) => line.includes('is not x.y.z')));
    assert.ok(found.includes('app.json has no minKiroCrewVersion'));
  });

  it('flags an unreadable manifest', () => {
    assert.match(verifyBranchTree(tree({ 'app.json': '{' }))[0] ?? '', /^app\.json: /);
  });

  it('flags store art the manifest names but the tree lacks, and accepts it once present', () => {
    const withArt = JSON.stringify({ ...app, version: '0.1.0', heroImage: 'store/hero.png' });
    assert.deepEqual(verifyBranchTree(tree({ 'app.json': withArt })), ['heroImage: store/hero.png does not exist']);
    assert.deepEqual(verifyBranchTree(tree({ 'app.json': withArt, 'store/hero.png': 'png' })), []);
    assert.deepEqual(verifyBranchTree(tree({ 'app.json': withArt, 'store/hero.png/x': 'png' })), ['heroImage: store/hero.png does not exist']);
  });
});

describe('releaseBranch', () => {
  it('commits the built runtime tree to a local release branch and does not push', () => {
    const { origin, repo } = checkout();
    const main = git(repo, 'rev-parse', 'HEAD');
    const { code, lines } = release(repo);
    assert.equal(code, 0, lines.join('\n'));
    const tip = git(repo, 'rev-parse', 'refs/heads/release');
    const files = git(repo, 'ls-tree', '-r', '--name-only', tip).split('\n');
    assert.ok(files.includes('ui/dist/index.mjs'));
    assert.ok(files.includes('app-registry.json'));
    assert.ok(files.includes('RELEASE-MANIFEST.txt'));
    assert.ok(files.includes('infra/package.json'));
    for (const absent of ['package.json', 'avatar-packs/index.json', 'docs/images/banner.png']) assert.equal(files.includes(absent), false, absent);
    assert.deepEqual(JSON.parse(show(repo, tip, 'app-registry.json')), [{ name: 'specter-arena', gitUrl: URL, repo: URL, branch: 'release' }]);
    assert.match(show(repo, tip, 'RELEASE-MANIFEST.txt'), new RegExp(`^commit: ${main}$`, 'm'));
    assert.doesNotMatch(show(repo, tip, 'RELEASE-MANIFEST.txt'), / package\.json$/m);
    assert.match(git(repo, 'log', '-1', '--format=%B', tip), new RegExp(`from main ${main}[\\s\\S]*source: ${main}`));
    assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.equal(git(repo, 'status', '--porcelain'), '');
    assert.equal(git(origin, 'branch', '--list', 'release'), '');
    assert.ok(lines.includes('  git push origin release'));
    assert.ok(lines.includes(`  cd ${repo}`));
  });

  it('adds one commit per run on top of the previous release tip and skips an unchanged build', () => {
    const { repo } = checkout();
    assert.equal(release(repo).code, 0);
    const first = git(repo, 'rev-parse', 'refs/heads/release');
    const unchanged = release(repo);
    assert.equal(unchanged.code, 0);
    assert.match(unchanged.text, /already holds this build/);
    assert.equal(git(repo, 'rev-parse', 'refs/heads/release'), first);
    const next = advance(repo, 'ui/src/a.ts', 'export const a = 2;\n');
    assert.equal(release(repo).code, 0);
    const second = git(repo, 'rev-parse', 'refs/heads/release');
    assert.notEqual(second, first);
    assert.equal(git(repo, 'rev-parse', `${second}^`), first);
    assert.match(show(repo, second, 'RELEASE-MANIFEST.txt'), new RegExp(`^commit: ${next}$`, 'm'));
    assert.equal(show(repo, second, 'ui/src/a.ts'), 'export const a = 2;');
  });

  it('builds from the requested commit, not the checkout', () => {
    const { repo } = checkout();
    const first = git(repo, 'rev-parse', 'HEAD');
    advance(repo, 'ui/src/a.ts', 'export const a = 3;\n');
    assert.equal(release(repo, { ref: first }).code, 0);
    assert.match(show(repo, 'release', 'RELEASE-MANIFEST.txt'), new RegExp(`^commit: ${first}$`, 'm'));
  });

  it('continues from origin/release when the local branch does not exist yet', () => {
    const { origin, repo } = checkout();
    assert.equal(release(repo).code, 0);
    git(repo, 'push', '-q', 'origin', 'release');
    git(repo, 'fetch', '-q', 'origin');
    const published = git(repo, 'rev-parse', 'refs/heads/release');
    git(repo, 'branch', '-q', '-D', 'release');
    advance(repo, 'ui/src/a.ts', 'export const a = 4;\n');
    const again = release(repo);
    assert.equal(again.code, 0, again.text);
    assert.equal(git(repo, 'rev-parse', 'release^'), published);
    assert.equal(git(origin, 'rev-parse', 'refs/heads/release'), published);
  });

  it('refuses when local release does not contain origin/release', () => {
    const { repo } = checkout();
    assert.equal(release(repo).code, 0);
    git(repo, 'push', '-q', 'origin', 'release');
    git(repo, 'fetch', '-q', 'origin');
    git(repo, 'branch', '-q', '-f', 'release', 'main');
    advance(repo, 'ui/src/a.ts', 'export const a = 5;\n');
    const { code, text } = release(repo);
    assert.equal(code, 1);
    assert.match(text, /does not contain origin\/release/);
  });

  it('refuses a dirty working tree', () => {
    const { repo } = checkout();
    put(repo, 'stray.txt', 'x');
    const { code, text } = release(repo);
    assert.equal(code, 1);
    assert.match(text, /working tree is not clean/);
    assert.equal(git(repo, 'branch', '--list', 'release'), '');
  });

  it('refuses a commit that is not on origin/main', () => {
    const { repo } = checkout();
    const local = advance(repo, 'ui/src/a.ts', 'export const a = 6;\n', false);
    const { code, text } = release(repo);
    assert.equal(code, 1);
    assert.match(text, new RegExp(`${local} is not on origin/main`));
    assert.equal(git(repo, 'branch', '--list', 'release'), '');
  });

  it('refuses when origin/main is unknown', () => {
    const { repo } = checkout();
    git(repo, 'remote', 'remove', 'origin');
    const { code, text } = release(repo);
    assert.equal(code, 1);
    assert.match(text, /origin\/main is unknown/);
  });

  it('refuses when the checkout is on the release branch', () => {
    const { repo } = checkout();
    assert.equal(release(repo).code, 0);
    git(repo, 'checkout', '-q', 'release');
    assert.match(commitRefusal(repo, git(repo, 'rev-parse', 'main'), testRun) ?? '', /on release/);
    const { code, text } = release(repo, { ref: 'main' });
    assert.equal(code, 1);
    assert.match(text, /on release; switch to main/);
  });

  it('refuses a path that is not a git repository and a ref that is not a commit', () => {
    assert.match(release(mkdtempSync(join(scratch, 'plain-'))).text, /is not a git repository/);
    const { repo } = checkout();
    const { code, text } = release(repo, { ref: 'no-such-ref' });
    assert.equal(code, 1);
    assert.match(text, /not a commit: no-such-ref/);
  });

  it('reports a build failure without scratch paths and commits nothing', () => {
    const { repo } = checkout();
    const { code, text } = release(repo, {
      build: (clone) => {
        throw new Error(`boom in ${clone}\nsecond line`);
      },
    });
    assert.equal(code, 1);
    assert.match(text, /release-branch: build failed: boom in <work>\/src/);
    assert.doesNotMatch(text, /second line/);
    assert.equal(git(repo, 'branch', '--list', 'release'), '');
  });

  it('reports a build that leaves no UI bundle', () => {
    const { repo } = checkout();
    const { code, text } = release(repo, { build: () => {} });
    assert.equal(code, 1);
    assert.match(text, /ui\/dist not found/);
  });

  it('rejects a tracked path the release rules forbid', () => {
    const { repo } = checkout(baseFiles({ '.env': 'SECRET=1\n' }));
    const { code, text } = release(repo);
    assert.equal(code, 1);
    assert.match(text, /\.env: env file/);
  });

  it('reports a commit that cannot be checked out of the clone', () => {
    const { repo } = checkout();
    const run = /** @type {import('../package.mjs').Run} */ (
      (command, args, options) => {
        if (command === 'git' && args.includes('--detach')) throw new Error('no checkout');
        return testRun(command, args, options);
      }
    );
    const { code, text } = release(repo, { run });
    assert.equal(code, 1);
    assert.match(text, /is not reachable from a branch or tag/);
  });

  it('turns an unexpected failure into one log line', () => {
    const { repo } = checkout();
    const { code, text } = release(repo, { run: () => { throw new Error('disk gone\nmore'); } });
    assert.equal(code, 1);
    assert.match(text, /release-branch: /);
  });
});

describe('releaseBranch --dry-run', () => {
  it('builds and verifies without committing, even from a dirty checkout or a commit off main', () => {
    const { repo } = checkout();
    advance(repo, 'ui/src/a.ts', 'export const a = 7;\n', false);
    put(repo, 'stray.txt', 'x');
    const { code, text } = release(repo, { dryRun: true });
    assert.equal(code, 0, text);
    assert.match(text, /dry run ok, \d+ files from [0-9a-f]{40}; nothing committed/);
    assert.equal(git(repo, 'branch', '--list', 'release'), '');
  });

  it('writes the tree to --out for inspection', () => {
    const { repo } = checkout();
    const out = join(mkdtempSync(join(scratch, 'out-')), 'tree');
    const { code, text } = release(repo, { dryRun: true, outDir: out });
    assert.equal(code, 0, text);
    assert.ok(statSync(join(out, 'ui/dist/index.mjs')).isFile());
    assert.equal(existsSync(join(out, 'package.json')), false);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'app-registry.json'), 'utf8'))[0].branch, 'release');
    assert.ok(listFiles(out).includes('RELEASE-MANIFEST.txt'));
  });

  it('refuses an --out that exists or sits inside the repository', () => {
    const { repo } = checkout();
    assert.match(release(repo, { dryRun: true, outDir: mkdtempSync(join(scratch, 'out-')) }).text, /must be a new directory outside the repository/);
    assert.match(release(repo, { dryRun: true, outDir: join(repo, 'tree') }).text, /must be a new directory outside the repository/);
  });

  it('accepts a branch tree whose file list matches the tarball, and rejects one that does not', () => {
    const { repo } = checkout();
    const outDir = mkdtempSync(join(scratch, 'tarball-'));
    /** @type {string[]} */
    const packed = [];
    assert.equal(packageRelease({ repo, outDir, run: testRun, build: cleanBuild, tmpRoot: mkdtempSync(join(scratch, 'tmp-')), log: (line) => packed.push(line) }), 0, packed.join('\n'));
    const tarball = join(outDir, /** @type {string} */ (execFileSync('ls', [outDir], { encoding: 'utf8' }).split('\n').find((name) => name.endsWith('.tar.gz'))));
    const same = release(repo, { dryRun: true, compareTarball: tarball });
    assert.equal(same.code, 0, same.text);
    const extra = release(repo, {
      dryRun: true,
      compareTarball: tarball,
      build: (clone) => {
        cleanBuild(clone);
        put(clone, 'ui/dist/extra.mjs', 'x');
      },
    });
    assert.equal(extra.code, 1);
    const missing = release(repo, { dryRun: true, compareTarball: join(scratch, 'missing.tar.gz') });
    assert.equal(missing.code, 1);
  });
});

describe('previousTip', () => {
  it('has no parent on a fresh clone', () => {
    const { repo } = checkout();
    assert.deepEqual(previousTip(repo, testRun), { parent: null, current: null });
  });
});
