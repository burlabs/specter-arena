import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DENIED_TOKENS } from '../check-schema.mjs';

const PYTHON_TEST = 'backend/tests/test_store_no_classifier.py';

/**
 * @param {string} source
 * @returns {string[]} the quoted words of the DENYLIST frozenset literal, sorted
 */
function pythonDenylist(source) {
  const block = /DENYLIST\s*=\s*frozenset\(\s*\{([\s\S]*?)\}\s*\)/.exec(source);
  assert.ok(block, 'DENYLIST literal not found');
  return [...(block[1] ?? '').matchAll(/"([a-z]+)"/g)].map((match) => match[1] ?? '').sort();
}

describe('denylist parity (FP-02-AC06)', () => {
  it('the SQL test denylist equals the schema guard denylist', () => {
    assert.deepEqual(pythonDenylist(readFileSync(PYTHON_TEST, 'utf8')), [...DENIED_TOKENS].sort());
  });

  it('detects a missing word (positive control)', () => {
    const doctored = 'DENYLIST = frozenset(\n    {\n        "class",\n    }\n)';
    assert.notDeepEqual(pythonDenylist(doctored), [...DENIED_TOKENS].sort());
  });

  it('fails loudly when the literal moves', () => {
    assert.throws(() => pythonDenylist('nothing here'), /DENYLIST literal not found/);
  });
});
