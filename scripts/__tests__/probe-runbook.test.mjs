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

describe('the FP-20 sitting runbook', () => {
  const fp20 = readFileSync('docs/compatibility/fp20-sitting-runbook.md', 'utf8');
  const minutes = [...fp20.matchAll(/^\d+\. \((\d+) min/gm)].map((match) => Number(match[1]));

  it('has nine numbered steps that add up to at most 30 minutes', () => {
    assert.equal(minutes.length, 9);
    assert.ok(minutes.reduce((a, b) => a + b, 0) <= 30);
  });

  it('names only npm scripts that exist and stage flags the stager reads', () => {
    for (const match of fp20.matchAll(/npm run ([\w:-]+)/g)) assert.ok(match[1] in scripts, match[1]);
    const stage = fp20.split('\n').find((line) => line.includes('npm run probe:stage')) ?? '';
    const flags = [...stage.matchAll(/ (--[a-z-]+)/g)].map((match) => match[1]);
    for (const flag of flags) assert.ok([...KNOWN_FLAGS, '--extra-steps'].includes(flag), flag);
    assert.ok(PHASES.includes('v3'));
  });

  it('keeps both stop rules and the probe removal step', () => {
    assert.match(fp20, /Stop if the install screen/);
    assert.match(fp20, /Stop if the host version is not 0\.13\.0/);
    assert.match(fp20, /Remove the probe: run `kirocrew app install <extracted release folder>`/);
  });
});
