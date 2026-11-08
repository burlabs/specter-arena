import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { FIXTURE_MARKER, backendRuntimeFiles, findFixtureContent, importsTestCode, run, scanBackend, scanBundle } from '../check-fixtures.mjs';

const root = mkdtempSync(join(tmpdir(), 'check-fixtures-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** @param {Record<string, string>} files */
function bundle(files) {
  const dir = mkdtempSync(join(root, 'dist-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

describe('findFixtureContent', () => {
  it('flags the fixture marker', () => {
    assert.deepEqual(findFixtureContent(`const label = "${FIXTURE_MARKER}";`), [`contains ${FIXTURE_MARKER}`]);
  });

  it('flags direct, property and index assignments to the host module map', () => {
    assert.deepEqual(findFixtureContent('window.__kirocrew_modules = {}'), ['assigns __kirocrew_modules']);
    assert.deepEqual(findFixtureContent('globalThis.__kirocrew_modules.react = r'), ['assigns __kirocrew_modules']);
    assert.deepEqual(findFixtureContent('w.__kirocrew_modules["react"]=r'), ['assigns __kirocrew_modules']);
  });

  it('allows reading the host module map', () => {
    assert.deepEqual(findFixtureContent('const m = window.__kirocrew_modules.react;'), []);
    assert.deepEqual(findFixtureContent('if (window.__kirocrew_modules === undefined) {}'), []);
  });
});

describe('scanBundle', () => {
  it('reports each contaminated file relative to the bundle root', () => {
    const dir = bundle({
      'index.mjs': 'export const mount = () => {};',
      'chunks/fixture.mjs': `/* ${FIXTURE_MARKER} */ window.__kirocrew_modules = {};`,
    });
    assert.deepEqual(scanBundle(dir), [
      { file: join('chunks', 'fixture.mjs'), reason: `contains ${FIXTURE_MARKER}` },
      { file: join('chunks', 'fixture.mjs'), reason: 'assigns __kirocrew_modules' },
    ]);
  });
});

describe('check-fixtures run', () => {
  it('returns 0 for a clean bundle', () => {
    /** @type {string[]} */
    const lines = [];
    const dir = bundle({ 'index.mjs': 'export const mount = () => {};' });
    const backendDir = bundle({ 'app.py': 'from .specter_arena.routes import health\n' });
    assert.equal(run({ dir, backendDir, log: (line) => lines.push(line) }), 0);
    assert.deepEqual(lines, [`check:fixtures: ${dir} and ${backendDir} runtime ok`]);
  });

  it('returns 1 and names the file for a contaminated bundle', () => {
    /** @type {string[]} */
    const lines = [];
    const dir = bundle({ 'index.mjs': `"${FIXTURE_MARKER}"` });
    const backendDir = bundle({ 'specter_arena/routes.py': 'from backend.tests.helpers import fake\n' });
    assert.equal(run({ dir, backendDir, log: (line) => lines.push(line) }), 1);
    assert.deepEqual(lines, [
      `check:fixtures: ${dir}/index.mjs contains ${FIXTURE_MARKER}`,
      `check:fixtures: ${backendDir}/${join('specter_arena', 'routes.py')} imports from a tests or fixtures module`,
    ]);
  });

  it('returns 1 when the bundle has not been built', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ dir: join(root, 'absent'), log: (line) => lines.push(line) }), 1);
    assert.match(lines[0] ?? '', /not found; run the production build first/);
  });
});

describe('backend runtime scan', () => {
  it('detects imports from tests or fixtures modules', () => {
    assert.equal(importsTestCode('from backend.tests.helpers import fake'), true);
    assert.equal(importsTestCode('from .fixtures import data'), true);
    assert.equal(importsTestCode('import tests.conftest'), true);
    assert.equal(importsTestCode('from starlette.testclient import TestClient'), false);
    assert.equal(importsTestCode('from .specter_arena.routes import health'), false);
  });

  it('scans app.py and the runtime package but not backend/tests', () => {
    const dir = bundle({
      'app.py': 'x = 1',
      'specter_arena/routes.py': 'x = 1',
      'specter_arena/README.md': 'text',
      'tests/test_health.py': 'from backend.tests.helpers import x',
    });
    assert.deepEqual(backendRuntimeFiles(dir).sort(), ['app.py', join('specter_arena', 'routes.py')]);
    assert.deepEqual(scanBackend(dir), []);
  });

  it('treats a missing backend as clean', () => {
    assert.deepEqual(scanBackend(join(root, 'no-backend')), []);
  });

  it('passes on the real backend', () => {
    assert.deepEqual(scanBackend('backend'), []);
  });
});
