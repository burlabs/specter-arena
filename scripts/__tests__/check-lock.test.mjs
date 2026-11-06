import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { UV_EXPORT_ARGS, findMissingLinuxVariants, findRequirementsDrift, run, uvRequirementsCheck } from '../check-lock.mjs';

const darwin = { os: ['darwin'], cpu: ['arm64'] };
const linuxGlibc = { os: ['linux'], cpu: ['x64'], libc: ['glibc'] };
const linuxMusl = { os: ['linux'], cpu: ['x64'], libc: ['musl'] };

/** @param {Record<string, object>} variants */
function lockWithFamily(variants) {
  return {
    packages: {
      '': {},
      'node_modules/native': {
        optionalDependencies: Object.fromEntries(Object.keys(variants).map((name) => [name, '1.0.0'])),
      },
      ...Object.fromEntries(Object.entries(variants).map(([name, node]) => [`node_modules/${name}`, node])),
    },
  };
}

describe('findMissingLinuxVariants', () => {
  it('passes a family that has darwin and linux glibc builds', () => {
    const lock = lockWithFamily({ '@native/darwin-arm64': darwin, '@native/linux-x64-gnu': linuxGlibc });
    assert.deepEqual(findMissingLinuxVariants(lock), []);
  });

  it('flags a family that only has a darwin build', () => {
    const lock = lockWithFamily({ '@native/darwin-arm64': darwin });
    assert.deepEqual(findMissingLinuxVariants(lock), ['node_modules/native']);
  });

  it('does not accept a musl-only linux build as the glibc variant', () => {
    const lock = lockWithFamily({ '@native/darwin-arm64': darwin, '@native/linux-x64-musl': linuxMusl });
    assert.deepEqual(findMissingLinuxVariants(lock), ['node_modules/native']);
  });

  it('accepts a linux build that does not declare libc', () => {
    const lock = lockWithFamily({ '@native/darwin-arm64': darwin, '@native/linux-x64': { os: ['linux'], cpu: ['x64'] } });
    assert.deepEqual(findMissingLinuxVariants(lock), []);
  });

  it('resolves nested platform packages before hoisted ones', () => {
    const lock = {
      packages: {
        'node_modules/native': { optionalDependencies: { '@native/darwin-arm64': '1', '@native/linux-x64-gnu': '1' } },
        'node_modules/native/node_modules/@native/darwin-arm64': darwin,
        'node_modules/native/node_modules/@native/linux-x64-gnu': linuxGlibc,
      },
    };
    assert.deepEqual(findMissingLinuxVariants(lock), []);
  });

  it('ignores optional dependencies that are not platform builds', () => {
    const lock = {
      packages: {
        'node_modules/tool': { optionalDependencies: { helper: '1' } },
        'node_modules/helper': {},
      },
    };
    assert.deepEqual(findMissingLinuxVariants(lock), []);
  });

  it('names the root package as (root)', () => {
    const lock = { packages: { '': { optionalDependencies: { 'x-darwin': '1' } }, 'node_modules/x-darwin': darwin } };
    assert.deepEqual(findMissingLinuxVariants(lock), ['(root)']);
  });

  it('treats a lock without packages as clean', () => {
    assert.deepEqual(findMissingLinuxVariants({}), []);
  });
});

describe('check-lock run', () => {
  /** @param {Record<string, string>} files */
  function harness(files) {
    /** @type {string[]} */
    const lines = [];
    const readFile = (/** @type {string} */ path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return /** @type {string} */ (files[path]);
    };
    return { lines, readFile, log: (/** @type {string} */ line) => lines.push(line) };
  }

  it('returns 0 and reports ok for a complete lock', () => {
    const { lines, readFile, log } = harness({ 'a.json': JSON.stringify(lockWithFamily({ d: darwin, l: linuxGlibc })) });
    assert.equal(run({ files: ['a.json'], readFile, log }), 0);
    assert.deepEqual(lines, ['check:lock: a.json ok']);
  });

  it('returns 1 and names the family for an incomplete lock', () => {
    const { lines, readFile, log } = harness({ 'a.json': JSON.stringify(lockWithFamily({ d: darwin })) });
    assert.equal(run({ files: ['a.json'], readFile, log }), 1);
    assert.match(lines[0] ?? '', /lacks a linux-x64 glibc variant for: node_modules\/native/);
  });

  it('returns 1 when a lockfile is missing or unparsable', () => {
    const { lines, readFile, log } = harness({ 'bad.json': '{not json' });
    assert.equal(run({ files: ['missing.json', 'bad.json'], readFile, log }), 1);
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? '', /cannot read missing\.json/);
    assert.match(lines[1] ?? '', /cannot read bad\.json/);
  });

  it('passes on the repository root lockfile', () => {
    assert.equal(run({ log: () => {} }), 0);
  });
});

describe('requirements.txt agreement', () => {
  const cleanLock = JSON.stringify({ packages: {} });

  /**
   * @param {string} committed
   * @param {() => string} exportRequirements
   */
  function check(committed, exportRequirements) {
    /** @type {string[]} */
    const lines = [];
    const files = /** @type {Record<string, string>} */ ({ 'package-lock.json': cleanLock, 'requirements.txt': committed });
    const code = run({
      requirements: { file: 'requirements.txt', exportRequirements },
      readFile: (path) => /** @type {string} */ (files[path]),
      log: (line) => lines.push(line),
    });
    return { code, lines };
  }

  it('passes when the committed file matches the export', () => {
    const { code, lines } = check('a==1\n', () => 'a==1\n');
    assert.equal(code, 0);
    assert.equal(lines[0], 'check:lock: requirements.txt matches backend/uv.lock');
  });

  it('fails and names the export command on drift', () => {
    const { code, lines } = check('a==1\n', () => 'a==2\n');
    assert.equal(code, 1);
    assert.equal(findRequirementsDrift({ file: 'requirements.txt', exportRequirements: () => 'b' }, () => 'a'), lines[0]?.replace('check:lock: ', ''));
    assert.match(lines[0] ?? '', /uv export --project backend --frozen --no-dev --no-emit-project/);
  });

  it('fails when uv cannot export', () => {
    const { code, lines } = check('a==1\n', () => {
      throw new Error('uv: command not found');
    });
    assert.equal(code, 1);
    assert.match(lines[0] ?? '', /cannot compare requirements\.txt with backend\/uv\.lock: uv: command not found/);
  });

  it('matches the committed requirements.txt with the real uv export', () => {
    assert.equal(findRequirementsDrift(uvRequirementsCheck(), (path) => readFileSync(path, 'utf8')), null);
  });

  it('uses the same export arguments as the lock-agreement CI job', () => {
    assert.ok(readFileSync('.github/workflows/ci.yml', 'utf8').includes(`uv ${UV_EXPORT_ARGS.join(' ')}`));
  });
});
