import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PREVIEW_CONFIG, run } from '../dev.mjs';

describe('dev run', () => {
  it('explains that the harness is absent and exits 0', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ exists: () => false, log: (line) => lines.push(line) }), 0);
    assert.match(lines[0] ?? '', /not in this checkout yet/);
  });

  it('fails loudly once the harness exists but the script was not updated', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ exists: (path) => path === PREVIEW_CONFIG, log: (line) => lines.push(line) }), 1);
    assert.match(lines[0] ?? '', /update scripts\/dev\.mjs/);
  });
});
