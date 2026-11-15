import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PHASES, parseArgs, runOptions } from '../stage-probe-app.mjs';

const RUNBOOK = 'docs/development/probe-slice1-runbook.md';
const text = readFileSync(RUNBOOK, 'utf8');
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
const KNOWN_FLAGS = ['--phase', ...Object.keys(parseArgs([]).flags)];
const stageLines = text.split('\n').filter((line) => line.trim().startsWith('npm run probe:stage'));

describe('the slice-1 owner runbook', () => {
  it('names only npm scripts that exist', () => {
    const named = [...text.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]);
    assert.ok(named.length > 0);
    for (const name of named) assert.ok(name in scripts, `npm run ${name}`);
  });

  it('uses only flags the stage script reads', () => {
    for (const line of stageLines) {
      for (const flag of line.match(/--[a-z-]+/g) ?? []) assert.ok(KNOWN_FLAGS.includes(flag), flag);
    }
  });

  it('stages each documented phase with options the script accepts', () => {
    assert.deepEqual(
      stageLines.map((line) => parseArgs(line.split(/\s+/)).phase),
      ['v0', 'v1'],
    );
    for (const line of stageLines) {
      const { phase, flags } = parseArgs(line.replaceAll('X.Y.Z', '0.12.2').split(/\s+/));
      assert.ok(PHASES.includes(phase));
      assert.equal(runOptions(phase, flags)?.hostVersion, '0.12.2', line);
    }
  });

  it('documents every stage flag and the D-P1 grants', () => {
    for (const flag of KNOWN_FLAGS) assert.ok(text.includes(flag), flag);
    for (const grant of ['slots:user', 'subagent:user', '/api/agents', '/api/usage', '/api/sessions/usage']) {
      assert.ok(text.includes(grant), grant);
    }
  });
});
