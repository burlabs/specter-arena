import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  DIAGNOSTIC_MARKER,
  FIXTURE_MARKER,
  backendRuntimeFiles,
  findFixtureContent,
  importsTestCode,
  run,
  runPositiveControl,
  scanBackend,
  scanBundle,
  scanManifest,
  scanReleaseTree,
} from '../check-fixtures.mjs';

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

/** @param {string} text */
function manifestFile(text) {
  const path = join(mkdtempSync(join(root, 'manifest-')), 'app.json');
  writeFileSync(path, text);
  return path;
}

describe('diagnostic marker', () => {
  it('is flagged on its own', () => {
    assert.deepEqual(findFixtureContent(`const label = "${DIAGNOSTIC_MARKER}";`), [`contains ${DIAGNOSTIC_MARKER}`]);
  });

  it('is reported after the fixture marker when both are present', () => {
    assert.deepEqual(findFixtureContent(`"${DIAGNOSTIC_MARKER}" "${FIXTURE_MARKER}"`), [`contains ${FIXTURE_MARKER}`, `contains ${DIAGNOSTIC_MARKER}`]);
  });

  it('is reported for a nested chunk with its relative path', () => {
    const dir = bundle({ 'index.mjs': 'export default 1;', 'chunks/a/diag.mjs': `"${DIAGNOSTIC_MARKER}"` });
    assert.deepEqual(scanBundle(dir), [{ file: join('chunks', 'a', 'diag.mjs'), reason: `contains ${DIAGNOSTIC_MARKER}` }]);
  });

  it('turns a release bundle that imports diagnostic code red (deliberate violation)', () => {
    /** @type {string[]} */
    const lines = [];
    const dir = bundle({ 'index.mjs': `export const leaked = "${DIAGNOSTIC_MARKER}";` });
    const backendDir = bundle({ 'app.py': 'x = 1\n' });
    const manifest = join(root, 'absent-app.json');
    assert.equal(run({ dir, backendDir, manifest, releaseRoots: [], log: (line) => lines.push(line) }), 1);
    assert.deepEqual(lines, [`check:fixtures: ${dir}/index.mjs contains ${DIAGNOSTIC_MARKER}`]);
  });
});

describe('scanManifest', () => {
  it('passes the real release manifest', () => {
    assert.deepEqual(scanManifest('app.json'), []);
  });

  it('allows a release manifest with only dist/ references and minKiroCrewVersion', () => {
    const path = manifestFile(JSON.stringify({ minKiroCrewVersion: '0.12.0', ui: { entry: 'dist/index.mjs', pages: [{ route: '/a', label: 'A' }] } }));
    assert.deepEqual(scanManifest(path), []);
  });

  it('treats a missing manifest as clean', () => {
    assert.deepEqual(scanManifest(join(root, 'no-app.json')), []);
  });

  it('flags permissions and backend.hooks', () => {
    const path = manifestFile(JSON.stringify({ permissions: { api: [] }, backend: { hooks: {} }, ui: { entry: 'dist/index.mjs' } }));
    assert.deepEqual(
      scanManifest(path).map(({ reason }) => reason),
      [
        'release manifest declares permissions (probe permissions belong in probe/manifest-overlay.json)',
        'release manifest declares backend.hooks',
      ],
    );
  });

  it('flags a ui.entry or page entryPoint outside dist/ or naming the diagnostic bundle', () => {
    const path = manifestFile(
      JSON.stringify({ ui: { entry: 'diagnostic-dist/x.mjs', pages: [{ entryPoint: '../ui/diagnostic-dist/x.mjs' }, { entryPoint: 'dist/diagnostic.mjs' }, { entryPoint: 'dist/ok.mjs' }, {}] } }),
    );
    assert.deepEqual(
      scanManifest(path).map(({ reason }) => reason),
      [
        'ui reference diagnostic-dist/x.mjs is not a release dist/ path',
        'ui reference ../ui/diagnostic-dist/x.mjs is not a release dist/ path',
        'ui reference dist/diagnostic.mjs is not a release dist/ path',
      ],
    );
  });

  it('flags the marker text', () => {
    const path = manifestFile(JSON.stringify({ description: DIAGNOSTIC_MARKER, ui: { entry: 'dist/index.mjs' } }));
    assert.deepEqual(scanManifest(path), [{ file: path, reason: `contains ${DIAGNOSTIC_MARKER}` }]);
  });

  it('reports invalid JSON as a finding instead of throwing', () => {
    const path = manifestFile('{ nope');
    assert.deepEqual(scanManifest(path), [{ file: path, reason: 'is not valid JSON' }]);
  });

  it('tolerates a manifest without ui or with non-array pages', () => {
    assert.deepEqual(scanManifest(manifestFile('{}')), []);
    assert.deepEqual(scanManifest(manifestFile(JSON.stringify({ ui: { pages: 'x' } }))), []);
  });
});

describe('scanReleaseTree', () => {
  it('flags a probe switch file in any release root', () => {
    const clean = mkdtempSync(join(root, 'tree-'));
    const dirty = mkdtempSync(join(root, 'tree-'));
    writeFileSync(join(dirty, '.probe-enabled'), '');
    assert.deepEqual(scanReleaseTree([clean]), []);
    assert.deepEqual(scanReleaseTree([clean, dirty]), [{ file: join(dirty, '.probe-enabled'), reason: 'probe switch file present in the release tree' }]);
  });

  it('passes the real repository tree', () => {
    assert.deepEqual(scanReleaseTree(), []);
  });

  it('is part of run()', () => {
    /** @type {string[]} */
    const lines = [];
    const dir = bundle({ 'index.mjs': 'export default 1;' });
    const backendDir = bundle({ 'app.py': 'x = 1\n' });
    const tree = mkdtempSync(join(root, 'tree-'));
    writeFileSync(join(tree, '.probe-enabled'), '');
    const manifest = join(root, 'absent-app.json');
    assert.equal(run({ dir, backendDir, manifest, releaseRoots: [tree], log: (line) => lines.push(line) }), 1);
    assert.deepEqual(lines, [`check:fixtures: ${join(tree, '.probe-enabled')} probe switch file present in the release tree`]);
  });

  it('run() also reports a bad release manifest', () => {
    /** @type {string[]} */
    const lines = [];
    const dir = bundle({ 'index.mjs': 'export default 1;' });
    const backendDir = bundle({ 'app.py': 'x = 1\n' });
    const manifest = manifestFile(JSON.stringify({ permissions: {} }));
    assert.equal(run({ dir, backendDir, manifest, releaseRoots: [], log: (line) => lines.push(line) }), 1);
    assert.match(lines[0] ?? '', /release manifest declares permissions/);
  });
});

describe('runPositiveControl', () => {
  it('fails when the diagnostic bundle has not been built', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(runPositiveControl({ dir: join(root, 'absent-diag'), log: (line) => lines.push(line) }), 1);
    assert.match(lines[0] ?? '', /not found; run npm run build:diagnostic first/);
  });

  it('fails when the bundle no longer carries the marker, so the exclusion scan would be vacuous', () => {
    /** @type {string[]} */
    const lines = [];
    const dir = bundle({ 'index.mjs': 'export default 1;' });
    assert.equal(runPositiveControl({ dir, log: (line) => lines.push(line) }), 1);
    assert.match(lines[0] ?? '', /vacuous/);
  });

  it('passes and counts the files that carry the marker', () => {
    /** @type {string[]} */
    const lines = [];
    const dir = bundle({ 'index.mjs': `"${DIAGNOSTIC_MARKER}"`, 'other.mjs': 'x', 'chunks/c.mjs': `// ${DIAGNOSTIC_MARKER}` });
    assert.equal(runPositiveControl({ dir, log: (line) => lines.push(line) }), 0);
    assert.deepEqual(lines, [`check:diagnostic: ${dir} carries ${DIAGNOSTIC_MARKER} in 2 file(s)`]);
  });
});
