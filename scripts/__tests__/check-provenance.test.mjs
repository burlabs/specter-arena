import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { ART_STATEMENT, DENYLIST, checkArt, checkPortedRows, checkRepository, findDenylisted, gitRepo, run } from '../check-provenance.mjs';

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

  it('flags AWS profiles other than specter-preview', () => {
    const label = 'AWS CLI profile other than specter-preview';
    assert.deepEqual(findDenylisted(`cdk deploy --${'profile'} cruisely-dev`), [label]);
    assert.deepEqual(findDenylisted(`aws s3 ls --${'profile'}=default`), [label]);
    assert.deepEqual(findDenylisted(`cdk deploy --${'profile'} specter-preview-old`), [label]);
    assert.deepEqual(findDenylisted(`cdk deploy --${'profile'} specter-preview && echo ok`), []);
    assert.deepEqual(findDenylisted(`aws sts get-caller-identity --${'profile'}=specter-preview`), []);
  });

  it('flags AWS access key IDs', () => {
    assert.deepEqual(findDenylisted(`key = ${'AKIA'}${'Z'.repeat(16)}`), ['AWS access key ID']);
    assert.deepEqual(findDenylisted(`key = ${'ASIA'}${'7'.repeat(16)}`), ['AWS access key ID']);
    assert.deepEqual(findDenylisted(`${'AKIA'}SHORT`), []);
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

const PNG = 'backend/specter_arena/specters/art/ember.png';
const PNG_BYTES = Buffer.from('not really a png');
const PNG_SHA = createHash('sha256').update(PNG_BYTES).digest('hex');
/** @type {(path: string, sha: string) => string} */
const row = (path, sha) => `| \`${path}\` | \`ember-portrait.png\` | 256 x 256 RGBA | 16 | \`${sha}\` | gallery portrait |`;
/** @type {(...lines: string[]) => string} */
const doc = (...lines) => ['# Provenance', `Every raster was ${ART_STATEMENT}.`, '| File | Export | Pixels | Bytes | sha256 | Use |', ...lines].join('\n');

/**
 * @param {Record<string, string>} files
 * @param {Record<string, Buffer>} [bytes]
 */
function artRepo(files, bytes = { [PNG]: PNG_BYTES }) {
  return { ...repo({ ...files }), trackedFiles: [...Object.keys(files), ...Object.keys(bytes)], readBytes: (/** @type {string} */ path) => bytes[path] ?? Buffer.alloc(0) };
}

describe('checkArt (B13)', () => {
  it('passes when every tracked image has a row with its path and sha256', () => {
    assert.deepEqual(checkArt(artRepo({ 'docs/provenance.md': doc(row(PNG, PNG_SHA)) })), []);
  });

  it('fails an image whose hash is not in its row, and one with no row', () => {
    const problems = checkArt(artRepo({ 'docs/provenance.md': doc(row(PNG, '0'.repeat(64))) }));
    assert.deepEqual(problems, [`${PNG}: no row in docs/provenance.md with this path and sha256 ${PNG_SHA}`]);
    assert.equal(checkArt(artRepo({ 'docs/provenance.md': doc() })).length, 1);
  });

  it('fails a tracked image when the doc is missing, lacks the statement, or carries retired wording', () => {
    assert.deepEqual(checkArt(artRepo({})), ['docs/provenance.md is missing but 1 raster file(s) are tracked']);
    const bare = checkArt(artRepo({ 'docs/provenance.md': `${row(PNG, PNG_SHA)}\nderived non-generatively; No licensing determination` }));
    assert.deepEqual(bare, [
      `docs/provenance.md lacks the statement "${ART_STATEMENT}"`,
      'docs/provenance.md: retired art wording "derived non-generatively"',
      'docs/provenance.md: retired art wording "no licensing determination"',
    ]);
  });

  it('fails QA art files even when the doc is fine', () => {
    const qa = 'backend/specter_arena/specters/art/a02-light-dark-anchor-check.jpg';
    const problems = checkArt(artRepo({ 'docs/provenance.md': doc(row(PNG, PNG_SHA)) }, { [PNG]: PNG_BYTES, [qa]: Buffer.from('q') }));
    assert.deepEqual(problems, [`${qa}: QA art file must not ship`]);
    for (const name of ['x/reference-crops/a.png', 'roster-reference.png', 'bur-master.png']) {
      assert.ok(checkArt(artRepo({}, { [name]: Buffer.from('q') })).includes(`${name}: QA art file must not ship`), name);
    }
  });

  it('does nothing when no image is tracked or bytes cannot be read', () => {
    assert.deepEqual(checkArt(repo(cleanTree)), []);
    assert.deepEqual(checkArt({ ...repo({ 'a.png': 'x' }) }), []);
  });
});

describe('checkPortedRows', () => {
  const portedDoc = '| FP-10+11 | `components/X.tsx` | `ui/src/arena/X.tsx`, `ui/src/arena/Y.tsx` | note |\n| other | `ui/src/ignored.ts` |';
  it('flags a ported path that is not tracked and ignores rows that are not Figma Make rows', () => {
    const files = { 'docs/provenance.md': portedDoc, 'ui/src/arena/X.tsx': '' };
    assert.deepEqual(checkPortedRows(repo(files)), ['docs/provenance.md: row names ui/src/arena/Y.tsx, which is not a tracked file']);
  });

  it('passes when every ported path is tracked and when the doc is absent', () => {
    assert.deepEqual(checkPortedRows(repo({ 'docs/provenance.md': portedDoc, 'ui/src/arena/X.tsx': '', 'ui/src/arena/Y.tsx': '' })), []);
    assert.deepEqual(checkPortedRows(repo(cleanTree)), []);
  });
});

describe('the real repository', () => {
  it('passes the art and ported-row checks', () => {
    assert.deepEqual(checkArt(gitRepo()), []);
    assert.deepEqual(checkPortedRows(gitRepo()), []);
  });
});
