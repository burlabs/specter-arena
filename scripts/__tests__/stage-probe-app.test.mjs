import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  COPY_LIST,
  INSTALL_COMMAND,
  OVERLAY_PATH,
  PHASES,
  V2_EXTRA_API_ENTRY,
  mergeManifest,
  overlayForPhase,
  parseArgs,
  stage,
} from '../stage-probe-app.mjs';
import { DIAGNOSTIC_MARKER, OWN_API_ENTRY } from '../check-fixtures.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'stage-probe-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const realOverlay = JSON.parse(readFileSync(OVERLAY_PATH, 'utf8'));
const realManifest = JSON.parse(readFileSync('app.json', 'utf8'));

/** @param {string} root @param {string} path @param {string} text */
function put(root, path, text) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** @param {{ marker?: boolean, diagnostic?: boolean, release?: boolean, overlay?: unknown }} [options] */
function repo({ marker = true, diagnostic = true, release = true, overlay = realOverlay } = {}) {
  const root = mkdtempSync(join(scratch, 'repo-'));
  put(root, 'app.json', JSON.stringify(realManifest));
  put(root, OVERLAY_PATH, JSON.stringify(overlay));
  put(root, 'requirements.txt', 'starlette==1\n');
  put(root, 'backend/app.py', 'app = 1\n');
  put(root, 'backend/__init__.py', '');
  put(root, 'backend/specter_arena/routes.py', 'x = 1\n');
  put(root, 'backend/specter_arena/__pycache__/routes.cpython-312.pyc', 'bytecode');
  put(root, 'backend/tests/test_routes.py', 'def test(): ...\n');
  put(root, 'backend/uv.lock', 'lock');
  put(root, 'package-lock.json', '{}');
  put(root, 'ui/src/mount.tsx', 'source');
  if (release) put(root, 'ui/dist/index.mjs', 'export default 1;');
  if (diagnostic) put(root, 'ui/diagnostic-dist/index.mjs', marker ? `export default "${DIAGNOSTIC_MARKER}";` : 'export default 1;');
  return root;
}

/** @param {string} root @param {string} phase */
function staged(root, phase) {
  /** @type {string[]} */
  const lines = [];
  const code = stage({ phase, root, log: (line) => lines.push(line) });
  return { code, lines, manifest: () => JSON.parse(readFileSync(join(root, '.probe-app', 'app.json'), 'utf8')) };
}

describe('the committed overlay', () => {
  it('has no backend.hooks and no marker', () => {
    assert.equal(realOverlay.backend, undefined);
    assert.equal(JSON.stringify(realOverlay).includes(DIAGNOSTIC_MARKER), false);
  });

  it('points its page at the diagnostic bundle relative to the staged ui/', () => {
    assert.equal(realOverlay.ui.pages[0].entryPoint, 'diagnostic-dist/index.mjs');
  });

  it('holds the v1 permissions: the own-namespace entry first, three probe api prefixes and slots:user', () => {
    assert.deepEqual(realOverlay.permissions, {
      api: [OWN_API_ENTRY, '/api/agents', '/api/chat/slots', '/api/member-records/*'],
      events: ['slots:user'],
    });
  });

  it('is not reflected in the release manifest, which has no diagnostic reference or grants', () => {
    assert.equal(JSON.stringify(realManifest).toLowerCase().includes('diagnostic'), false);
    assert.deepEqual(realManifest.permissions, { api: [OWN_API_ENTRY] });
    assert.equal(realManifest.backend.hooks, undefined);
  });
});

describe('overlayForPhase', () => {
  it('v0 keeps only the own-namespace api entry: no probe grants, no events', () => {
    const overlay = overlayForPhase(realOverlay, 'v0');
    assert.deepEqual(overlay.permissions, { api: [OWN_API_ENTRY] });
    assert.deepEqual(overlay.ui, realOverlay.ui);
  });

  it('v1 is the overlay as committed', () => {
    assert.deepEqual(overlayForPhase(realOverlay, 'v1'), realOverlay);
  });

  it('v2 adds exactly one api entry to v1', () => {
    const v1 = overlayForPhase(realOverlay, 'v1');
    const v2 = overlayForPhase(realOverlay, 'v2');
    assert.deepEqual(v2.permissions.api, [...v1.permissions.api, V2_EXTRA_API_ENTRY]);
    assert.equal(v2.permissions.api[0], OWN_API_ENTRY);
    assert.equal(v1.permissions.api[0], OWN_API_ENTRY);
    assert.deepEqual(v2.permissions.events, v1.permissions.events);
  });

  it('does not mutate the overlay it reads', () => {
    const before = JSON.stringify(realOverlay);
    for (const phase of PHASES) overlayForPhase(realOverlay, phase);
    assert.equal(JSON.stringify(realOverlay), before);
  });

  it('tolerates an overlay whose permissions are missing or malformed', () => {
    assert.deepEqual(overlayForPhase({ version: 'x' }, 'v2').permissions, { api: [OWN_API_ENTRY, V2_EXTRA_API_ENTRY] });
    assert.deepEqual(overlayForPhase({ permissions: 'nope' }, 'v1').permissions, { api: [OWN_API_ENTRY] });
    assert.deepEqual(overlayForPhase({}, 'v0').permissions, { api: [OWN_API_ENTRY] });
  });

  it('rejects an unknown phase', () => {
    assert.throws(() => overlayForPhase(realOverlay, 'v9'), /unknown phase v9/);
  });

  it('does not duplicate the own-namespace entry when the overlay already lists it', () => {
    const overlay = { permissions: { api: [OWN_API_ENTRY, '/api/x', OWN_API_ENTRY] } };
    assert.deepEqual(overlayForPhase(overlay, 'v1').permissions.api, [OWN_API_ENTRY, '/api/x']);
  });

  it('adds the own-namespace entry in every phase even when the overlay omits it', () => {
    for (const phase of PHASES) {
      assert.equal(overlayForPhase({ permissions: { api: ['/api/x'] } }, phase).permissions.api[0], OWN_API_ENTRY);
    }
  });

  it('rejects an overlay that declares backend.hooks', () => {
    assert.throws(() => overlayForPhase({ ...realOverlay, backend: { hooks: {} } }, 'v1'), /backend\.hooks/);
  });
});

describe('mergeManifest', () => {
  it('replaces scalars, appends pages and adds permissions', () => {
    const merged = mergeManifest(realManifest, overlayForPhase(realOverlay, 'v1'));
    assert.equal(merged.version, '0.0.0-probe.1');
    assert.equal(merged.minKiroCrewVersion, realManifest.minKiroCrewVersion);
    assert.equal(merged.ui.entry, realManifest.ui.entry);
    assert.deepEqual(merged.ui.pages, [...realManifest.ui.pages, ...realOverlay.ui.pages]);
    assert.deepEqual(merged.permissions, realOverlay.permissions);
  });

  it('merges only the own-namespace entry for v0', () => {
    assert.deepEqual(mergeManifest(realManifest, overlayForPhase(realOverlay, 'v0')).permissions, { api: [OWN_API_ENTRY] });
  });

  it('keeps the base untouched when the overlay has no ui', () => {
    const merged = mergeManifest({ ui: { entry: 'dist/index.mjs' } }, { version: '1' });
    assert.deepEqual(merged.ui, { entry: 'dist/index.mjs', pages: [] });
  });

  it('tolerates a base without a ui section', () => {
    assert.deepEqual(mergeManifest({ name: 'x' }, { ui: { pages: [{ route: '/a' }] } }).ui, { pages: [{ route: '/a' }] });
  });
});

describe('stage', () => {
  it('writes .probe-app with the merged manifest and the probe switch file', () => {
    const root = repo();
    const { code, manifest } = staged(root, 'v1');
    assert.equal(code, 0);
    assert.equal(existsSync(join(root, '.probe-app', '.probe-enabled')), true);
    assert.deepEqual(manifest().permissions, realOverlay.permissions);
    assert.equal(manifest().backend.hooks, undefined);
  });

  it('stages only the own-namespace entry for v0 and one extra api entry for v2', () => {
    const root = repo();
    assert.deepEqual(staged(root, 'v0').manifest().permissions, { api: [OWN_API_ENTRY] });
    const v2 = staged(root, 'v2').manifest();
    assert.equal(v2.permissions.api.length, realOverlay.permissions.api.length + 1);
  });

  it('copies the runtime and both bundles, never tests, lockfiles, bytecode or sources', () => {
    const root = repo();
    staged(root, 'v1');
    const out = join(root, '.probe-app');
    for (const path of ['requirements.txt', 'backend/app.py', 'backend/__init__.py', 'backend/specter_arena/routes.py', 'ui/dist/index.mjs', 'ui/diagnostic-dist/index.mjs']) {
      assert.equal(existsSync(join(out, path)), true, path);
    }
    for (const path of ['backend/tests', 'backend/uv.lock', 'package-lock.json', 'ui/src', 'backend/specter_arena/__pycache__']) {
      assert.equal(existsSync(join(out, path)), false, path);
    }
    assert.ok(COPY_LIST.every((path) => !/tests|lock/.test(path)));
  });

  it('replaces a previous staging directory', () => {
    const root = repo();
    put(root, '.probe-app/stale.txt', 'old');
    staged(root, 'v0');
    assert.equal(existsSync(join(root, '.probe-app', 'stale.txt')), false);
  });

  it('prints the install command as text and installs nothing', () => {
    const { lines } = staged(repo(), 'v0');
    assert.ok(lines.some((line) => line.includes(`${INSTALL_COMMAND} .probe-app`)));
  });

  it('refuses a diagnostic bundle without the marker and leaves no staging directory', () => {
    const root = repo({ marker: false });
    const { code, lines } = staged(root, 'v1');
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /lacks SPECTER-DIAGNOSTIC-ONLY/);
    assert.equal(existsSync(join(root, '.probe-app')), false);
  });

  it('asks for the builds it needs', () => {
    assert.match(staged(repo({ diagnostic: false }), 'v1').lines.join('\n'), /run npm run build:diagnostic first/);
    assert.match(staged(repo({ release: false }), 'v1').lines.join('\n'), /run npm run build first/);
  });

  it('reports a bad phase and an unreadable overlay without staging', () => {
    const root = repo();
    assert.match(staged(root, 'v9').lines.join('\n'), /unknown phase v9/);
    assert.match(staged(repo({ overlay: [] }), 'v1').lines.join('\n'), /is not a JSON object/);
    assert.match(staged(repo({ overlay: { backend: { hooks: {} } } }), 'v1').lines.join('\n'), /backend\.hooks/);
    assert.equal(existsSync(join(root, '.probe-app')), false);
  });

  it('keeps the output directory inside the repository', () => {
    const root = repo();
    for (const outDir of ['.', '..', '../elsewhere']) {
      /** @type {string[]} */
      const lines = [];
      assert.equal(stage({ phase: 'v0', root, outDir, log: (line) => lines.push(line) }), 1);
      assert.match(lines.join('\n'), /must be a directory inside the repository/);
    }
  });

  it('reads the overlay from probe/manifest-overlay.json only', () => {
    const root = repo();
    put(root, 'ui/manifest-overlay.json', JSON.stringify({ permissions: { api: ['/api/everything'] } }));
    assert.equal(JSON.stringify(staged(root, 'v1').manifest()).includes('/api/everything'), false);
    assert.equal(OVERLAY_PATH, 'probe/manifest-overlay.json');
  });
});

describe('parseArgs', () => {
  it('defaults to v0', () => {
    assert.equal(parseArgs([]).phase, 'v0');
  });

  it('reads --phase', () => {
    assert.equal(parseArgs(['--phase', 'v2']).phase, 'v2');
  });

  it('passes a missing phase value through so staging reports it', () => {
    assert.equal(parseArgs(['--phase']).phase, '');
  });
});
