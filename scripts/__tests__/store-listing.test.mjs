import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STORE_ART } from '../check-provenance.mjs';
import { RELEASE_EXCLUDED } from '../package.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));

/** Mirrors Crew 0.13.1 `registry_pipeline/store_art.py`: the declared art fields, the image allowlist and the size ceiling. */
const ART_FIELDS = ['iconPath', 'iconPathDark', 'heroImage', 'heroImageDark', 'heroImageDetail', 'heroImageDetailDark'];
const ART_LIST_FIELDS = ['screenshots', 'screenshotsDark'];
const ART_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
const ART_MAX_BYTES = 8 * 1024 * 1024;
const MAX_LIST_PATHS = 12;

/** @returns {string[]} */
function declaredArt() {
  const paths = ART_FIELDS.flatMap((field) => (typeof app[field] === 'string' ? [app[field]] : []));
  for (const field of ART_LIST_FIELDS) paths.push(...(Array.isArray(app[field]) ? app[field].slice(0, MAX_LIST_PATHS) : []));
  return paths;
}

describe('the Crew app store listing in app.json', () => {
  it('declares every art path in a field Crew reads, and every file exists in the artifact at an allowed type and size', () => {
    const paths = declaredArt();
    assert.ok(paths.length >= 6);
    for (const path of paths) {
      assert.match(path, /^[A-Za-z0-9._@/-]+$/, path);
      assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), path);
      assert.ok(ART_EXTENSIONS.has(extname(path).toLowerCase()), path);
      assert.equal(RELEASE_EXCLUDED.test(path), false, `${path} is excluded from the artifact`);
      const size = statSync(join(root, path)).size;
      assert.ok(size > 0 && size <= ART_MAX_BYTES, `${path}: ${size} bytes`);
    }
  });

  it('lists three to five screenshots, all under store/ and allowed by the provenance guard', () => {
    for (const field of ART_LIST_FIELDS) {
      const list = app[field];
      assert.ok(list.length >= 3 && list.length <= 5, field);
      for (const path of list) assert.match(path, STORE_ART, path);
    }
  });

  it('uses the banner byte for byte as the hero, and keeps docs/images out of the artifact', () => {
    /** @param {string} path */
    const hash = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
    assert.equal(app.heroImage, 'store/hero.png');
    assert.equal(hash('store/hero.png'), hash('docs/images/banner.png'));
    assert.ok(RELEASE_EXCLUDED.test('docs/images/banner.png'));
    assert.equal(RELEASE_EXCLUDED.test('store/hero.png'), false);
  });

  it('carries the listing text, named as the app and its heroes are', () => {
    assert.equal(app.author, 'burlabs');
    assert.ok(Array.isArray(app.tags) && app.tags.length >= 3);
    assert.ok(app.highlights.length >= 4 && app.highlights.length <= 6);
    assert.ok(app.useCases.length >= 1 && app.configuration.length >= 1);
    assert.deepEqual(app.platform, { os: ['macos', 'linux'] });
    const text = JSON.stringify([app.description, app.highlights, app.useCases, app.configuration]);
    assert.doesNotMatch(text, /Specters of the Abyss/);
    assert.doesNotMatch(text, /\b(?:AI[- ]generated|generates?|generated)\b/i);
    assert.match(app.description, /demo data/);
    const heroes = JSON.parse(readFileSync(join(root, 'backend/specter_arena/specters/heroes.json'), 'utf8')).heroes;
    const names = (Array.isArray(heroes) ? heroes : Object.values(heroes)).map((hero) => hero.name);
    assert.equal(names.length, 11);
    for (const name of names) assert.ok(app.highlights[0].includes(name), name);
  });

  it('leaves the permissions and the version as they were', () => {
    assert.deepEqual(app.permissions, { api: ['/apps/specter-arena/api/*', '/api/agents'], events: ['slots:user'] });
    assert.equal(app.version, '0.1.0');
    assert.equal(app.minKiroCrewVersion, '0.12.0');
  });
});
