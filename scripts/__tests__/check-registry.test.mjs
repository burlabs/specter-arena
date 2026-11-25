import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ART_MAX_BYTES, findRegistryProblems, run } from '../check-registry.mjs';

const URL = 'https://github.com/burlabs/specter-arena';
const goodEntry = { name: 'specter-arena', gitUrl: URL, repo: URL, branch: 'main' };
const goodManifest = {
  name: 'specter-arena',
  iconPath: 'ui/icons/logo.png',
  heroImage: 'store/hero.png',
  screenshots: ['store/a.png', 'store/b.webp'],
  description: 'not art',
};
const sizeOf = () => 1024;

/**
 * @param {unknown} registry
 * @param {Record<string, unknown>} [manifest]
 * @param {(path: string) => number | null} [sizes]
 */
const problems = (registry, manifest = goodManifest, sizes = sizeOf) => findRegistryProblems({ registry, manifest, sizeOf: sizes });

describe('findRegistryProblems', () => {
  it('accepts the one-entry index that points back at the repository', () => {
    assert.deepEqual(problems([goodEntry]), []);
  });

  it('rejects an index that is not a list', () => {
    assert.deepEqual(problems(goodEntry), ['app-registry.json must be a JSON list']);
  });

  it('rejects an empty list and a list with two entries', () => {
    assert.match(problems([])[0] ?? '', /exactly one entry, found 0/);
    assert.match(problems([goodEntry, goodEntry])[0] ?? '', /exactly one entry, found 2/);
  });

  it('rejects an entry that is not an object', () => {
    assert.deepEqual(problems(['specter-arena']), ['the entry is not an object']);
  });

  it('rejects a subdirectory key, including the "." Crew refuses', () => {
    assert.match(problems([{ ...goodEntry, subdirectory: '.' }])[0] ?? '', /subdirectory key/);
  });

  it('rejects an unexpected key', () => {
    assert.match(problems([{ ...goodEntry, label: 'x' }])[0] ?? '', /unexpected key label/);
  });

  it('rejects a name that differs from the manifest name', () => {
    assert.match(problems([{ ...goodEntry, name: 'other' }])[0] ?? '', /does not equal app\.json name/);
  });

  it('rejects a gitUrl or repo that is not an https GitHub URL', () => {
    const found = problems([{ ...goodEntry, gitUrl: 'git@github.com:burlabs/specter-arena.git', repo: 'http://github.com/burlabs/specter-arena' }]);
    assert.ok(found.some((line) => line.startsWith('gitUrl must be')));
    assert.ok(found.some((line) => line.startsWith('repo must be')));
    assert.ok(found.includes('gitUrl must equal repo'));
  });

  it('rejects a gitUrl that differs from repo', () => {
    assert.deepEqual(problems([{ ...goodEntry, gitUrl: 'https://github.com/burlabs/other' }]), ['gitUrl must equal repo']);
  });

  it('rejects a missing or unsafe branch', () => {
    assert.match(problems([{ ...goodEntry, branch: '-x' }])[0] ?? '', /branch/);
    assert.match(problems([{ ...goodEntry, branch: undefined }])[0] ?? '', /branch/);
    assert.match(problems([{ ...goodEntry, branch: 'a b' }])[0] ?? '', /branch/);
  });

  it('rejects an art path that does not exist', () => {
    const found = problems([goodEntry], goodManifest, (path) => (path === 'store/b.webp' ? null : 10));
    assert.deepEqual(found, ['screenshots: store/b.webp does not exist']);
  });

  it('rejects art over 8 MiB and accepts exactly 8 MiB', () => {
    assert.match(problems([goodEntry], goodManifest, () => ART_MAX_BYTES + 1)[0] ?? '', /bytes; the limit is/);
    assert.deepEqual(problems([goodEntry], goodManifest, () => ART_MAX_BYTES), []);
  });

  it('rejects an extension Crew does not serve', () => {
    assert.match(problems([goodEntry], { ...goodManifest, heroImage: 'store/hero.bmp' })[0] ?? '', /extension Crew does not serve/);
  });

  it('rejects more than 12 screenshots', () => {
    const screenshots = Array.from({ length: 13 }, (_, index) => `store/s${index}.png`);
    assert.match(problems([goodEntry], { ...goodManifest, screenshots })[0] ?? '', /lists 13 paths/);
  });

  it('rejects absolute and parent-relative art paths without stat-ing them', () => {
    /** @type {string[]} */
    const statted = [];
    const found = problems([goodEntry], { ...goodManifest, iconPath: '/etc/x.png', heroImage: '../x.png' }, (path) => {
      statted.push(path);
      return 10;
    });
    assert.equal(found.filter((line) => line.includes('must stay inside the repository')).length, 2);
    assert.deepEqual(statted, ['store/a.png', 'store/b.webp']);
  });

  it('rejects an art field that holds a non-path', () => {
    assert.match(problems([goodEntry], { ...goodManifest, iconPath: 7 })[0] ?? '', /not a path/);
    assert.match(problems([goodEntry], { ...goodManifest, screenshots: [''] })[0] ?? '', /not a path/);
  });

  it('ignores manifest fields that are not art', () => {
    assert.deepEqual(problems([goodEntry], { name: 'specter-arena', description: 7 }), []);
  });
});

describe('run', () => {
  /** @param {Record<string, string>} files */
  const readFrom = (files) => (/** @type {string} */ path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  };

  it('exits 0 and says ok for a valid pair', () => {
    /** @type {string[]} */
    const lines = [];
    const code = run({
      readFile: readFrom({ 'app-registry.json': JSON.stringify([goodEntry]), 'app.json': JSON.stringify(goodManifest) }),
      sizeOf,
      log: (line) => lines.push(line),
    });
    assert.equal(code, 0);
    assert.deepEqual(lines, ['check:registry: app-registry.json ok']);
  });

  it('exits 1 and prints each problem', () => {
    /** @type {string[]} */
    const lines = [];
    const code = run({
      readFile: readFrom({ 'app-registry.json': JSON.stringify([{ ...goodEntry, name: 'x' }]), 'app.json': JSON.stringify(goodManifest) }),
      sizeOf,
      log: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.match(lines[0] ?? '', /^check:registry: entry name/);
  });

  it('exits 1 when a file is missing or is not JSON', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ readFile: readFrom({}), log: (line) => lines.push(line) }), 1);
    assert.equal(run({ readFile: readFrom({ 'app-registry.json': '{', 'app.json': '{}' }), log: (line) => lines.push(line) }), 1);
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? '', /cannot read the registry or manifest/);
  });

  it('passes on the committed registry and manifest', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ log: (line) => lines.push(line) }), 0, lines.join('\n'));
  });

  it('reports a committed-file layout where the registry names a missing art file', () => {
    const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
    manifest.heroImage = 'store/not-there.png';
    /** @type {string[]} */
    const lines = [];
    const code = run({
      readFile: (path) => (path === 'app.json' ? JSON.stringify(manifest) : readFileSync(path, 'utf8')),
      log: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.deepEqual(lines, ['check:registry: heroImage: store/not-there.png does not exist']);
  });
});
