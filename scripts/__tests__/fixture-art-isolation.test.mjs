import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const REAL_ART = 'ui/fixtures/real-art.ts';
const PREVIEW_ENTRY = 'ui/preview/main.tsx';
const SOURCE = /\.(?:ts|tsx|mts|mjs)$/;
const PNG_DIRECTORIES = /backend\/specter_arena\/specters\/(?:scene|art)\//;

/**
 * Real art may reach the preview bundle only through the fixture module imported by the preview entry.
 * @param {Record<string, string>} files tracked source files by repository path
 * @returns {string[]} one message per file that breaks the rule
 */
function findRealArtLeaks(files) {
  const problems = [];
  for (const [path, text] of Object.entries(files)) {
    if (!SOURCE.test(path) || path === REAL_ART) continue;
    const importsRealArt = /from\s+['"][^'"]*real-art(?:\.ts)?['"]/.test(text);
    if (importsRealArt && path !== PREVIEW_ENTRY) problems.push(`${path}: imports ${REAL_ART}, which only ${PREVIEW_ENTRY} may do`);
    if (path.startsWith('ui/src/') && !/\.test\.[a-z]+$/.test(path) && (PNG_DIRECTORIES.test(text) || /\.png\?inline/.test(text))) {
      problems.push(`${path}: reaches the backend PNG folders or inlines a PNG; raster art must not enter ui/dist`);
    }
  }
  if (files[PREVIEW_ENTRY] !== undefined && !/from\s+['"][^'"]*real-art(?:\.ts)?['"]/.test(files[PREVIEW_ENTRY])) {
    problems.push(`${PREVIEW_ENTRY}: does not import ${REAL_ART}, so the preview shows no real art`);
  }
  return problems;
}

const tracked = () =>
  Object.fromEntries(
    execFileSync('git', ['ls-files', 'ui', 'tests'], { encoding: 'utf8' })
      .split('\n')
      .filter((path) => SOURCE.test(path))
      .map((path) => [path, readFileSync(path, 'utf8')]),
  );

describe('fixture art isolation', () => {
  it('holds for the tracked tree: only the preview entry imports real-art, and ui/src never reaches the PNG folders', () => {
    assert.deepEqual(findRealArtLeaks(tracked()), []);
  });

  it('flags another module that imports real-art', () => {
    const files = { [PREVIEW_ENTRY]: "import { REAL_ART } from '../fixtures/real-art.ts';", 'ui/src/arena/Leak.tsx': "import { REAL_ART } from '../../fixtures/real-art.ts';" };
    assert.equal(findRealArtLeaks(files).length, 1);
  });

  it('flags a ui/src file that inlines a backend PNG', () => {
    const files = {
      [PREVIEW_ENTRY]: "import { REAL_ART } from '../fixtures/real-art.ts';",
      'ui/src/arena/Leak.tsx': "import url from '../../../backend/specter_arena/specters/scene/arena-map.png?inline';",
    };
    assert.equal(findRealArtLeaks(files).length, 1);
  });

  it('flags a preview entry that no longer loads the real art', () => {
    assert.equal(findRealArtLeaks({ [PREVIEW_ENTRY]: "import 'react';" }).length, 1);
  });
});
