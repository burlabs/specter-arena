import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DENYLIST, checkRepository, findDenylisted, gitRepo, run } from '../check-provenance.mjs';

// Markers are assembled at runtime so this file never contains them literally.
const scopedImport = `import x from '@${'dragonboat'}-cms/app';`;
const apacheHeader = `// SPDX-License-Identifier: ${'Apache'}-2.0`;

/**
 * @param {Record<string, string>} files
 * @param {{ ignored?: string[] }} [options]
 */
function repo(files, { ignored = [] } = {}) {
  return {
    trackedFiles: Object.keys(files),
    readFile: (/** @type {string} */ path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`EISDIR ${path}`);
      return text;
    },
    isIgnored: (/** @type {string} */ path) => ignored.some((prefix) => path.startsWith(prefix)),
  };
}

const cleanTree = { '.kiro/steering/product.md': '# Product', 'README.md': 'Specter Arena, see burlabs/dragonboat-cms for reference.' };

describe('findDenylisted', () => {
  it('names each Dragonboat-only identifier it finds', () => {
    assert.deepEqual(findDenylisted(scopedImport), ['Dragonboat package scope']);
    assert.deepEqual(findDenylisted(apacheHeader), ['Apache-2.0 SPDX header']);
  });

  it('allows naming the reference repository', () => {
    assert.deepEqual(findDenylisted('Pattern reference: burlabs/dragonboat-cms@8c63c62a'), []);
  });

  it('has a label for every pattern', () => {
    for (const entry of DENYLIST) assert.ok(entry.label.length > 0);
  });
});

describe('checkRepository', () => {
  it('passes a clean tree', () => {
    assert.deepEqual(checkRepository(repo(cleanTree)), []);
  });

  it('fails a planted Dragonboat marker', () => {
    const problems = checkRepository(repo({ ...cleanTree, 'src/copied.ts': scopedImport }));
    assert.deepEqual(problems, ['src/copied.ts: Dragonboat package scope']);
  });

  it('fails when .kiro/ has no tracked files', () => {
    assert.deepEqual(checkRepository(repo({ 'README.md': 'hi' })), ['.kiro/ has no tracked files']);
  });

  it('fails when .gitignore matches .kiro/', () => {
    assert.deepEqual(checkRepository(repo(cleanTree, { ignored: ['.kiro/'] })), ['.gitignore matches .kiro/']);
  });

  it('fails a tracked env file but allows .env.example', () => {
    const problems = checkRepository(repo({ ...cleanTree, '.env.example': 'KEY=', 'config/.env.local': 'KEY=x', '.env': 'KEY=y' }));
    assert.deepEqual(problems, [
      'config/.env.local: env files other than .env.example must not be tracked',
      '.env: env files other than .env.example must not be tracked',
    ]);
  });

  it('skips its own denylist and unreadable entries', () => {
    assert.deepEqual(checkRepository(repo({ ...cleanTree, 'scripts/check-provenance.mjs': scopedImport })), []);
    const unreadable = repo(cleanTree);
    unreadable.trackedFiles.push('a-directory');
    assert.deepEqual(checkRepository(unreadable), []);
  });
});

describe('check-provenance run', () => {
  it('returns 0 and counts files for a clean tree', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ repo: repo(cleanTree), log: (line) => lines.push(line) }), 0);
    assert.deepEqual(lines, ['check:provenance: 2 tracked files clean']);
  });

  it('returns 1 and prints each problem', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ repo: repo({ 'x.md': apacheHeader }), log: (line) => lines.push(line) }), 1);
    assert.deepEqual(lines, ['check:provenance: .kiro/ has no tracked files', 'check:provenance: x.md: Apache-2.0 SPDX header']);
  });

  it('reads the real git index', () => {
    const real = gitRepo();
    assert.ok(real.trackedFiles.includes('LICENSE'));
    assert.equal(real.isIgnored('node_modules/x'), true);
    assert.equal(real.isIgnored('.kiro/steering/product.md'), false);
    assert.match(real.readFile('LICENSE'), /MIT License/);
  });
});
