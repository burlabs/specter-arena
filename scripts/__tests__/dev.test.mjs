import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEV_COMMAND, PREVIEW_CONFIG, run } from '../dev.mjs';

describe('dev run', () => {
  it('serves the preview harness with vite and returns its exit status', () => {
    /** @type {string[]} */
    const lines = [];
    /** @type {[string, string[]][]} */
    const calls = [];
    const code = run({
      exists: (path) => path === PREVIEW_CONFIG,
      runner: (command, args) => {
        calls.push([command, args]);
        return { status: 0 };
      },
      log: (line) => lines.push(line),
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [DEV_COMMAND]);
    assert.match(lines[0] ?? '', /FIXTURE preview harness/);
  });

  it('reports a failed or killed dev server as a failure', () => {
    const options = { exists: () => true, log: () => {} };
    assert.equal(run({ ...options, runner: () => ({ status: 2 }) }), 2);
    assert.equal(run({ ...options, runner: () => ({ status: null }) }), 1);
  });

  it('fails when the harness config is missing', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ exists: () => false, runner: () => assert.fail('must not run'), log: (line) => lines.push(line) }), 1);
    assert.match(lines[0] ?? '', /is missing; nothing to serve/);
  });

  it('points at a config that exists', () => {
    assert.equal(run({ runner: () => ({ status: 0 }), log: () => {} }), 0);
  });
});
