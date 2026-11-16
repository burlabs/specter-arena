import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { idProblems, parseRegistry, run, splitId } from '../check-spec-ids.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'check-spec-ids-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const REGISTRY = [
  '| Prefix | Meaning | Owner | Numbers | Status |',
  '|---|---|---|---|---|',
  '| `FP09-REQ` | requirements | delivery | 1-9 | open |',
  '| `FP-09-AC` | criteria | delivery | 1-99 | open |',
].join('\n');

const REQUIREMENTS = [
  '- **FP-09-AC01:** Something holds.',
  '',
  '| Id | Requirement |',
  '|---|---|',
  '| FP09-REQ-01 | Does a thing. Covers FP-09-AC01. |',
].join('\n');

/**
 * @param {Record<string, string>} files
 * @returns {string} root
 */
function tree(files) {
  const root = mkdtempSync(join(tmp, 'root-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

/** @param {string} root */
function runLogged(root) {
  /** @type {string[]} */
  const lines = [];
  const code = run({ root, log: (line) => lines.push(line) });
  return { code, lines };
}

const { rows } = parseRegistry(REGISTRY);
/** @param {string} text @param {string} [file] */
const problems = (text, file = '.kiro/specs/x/requirements.md') => idProblems([{ file, text }], rows);

describe('splitId', () => {
  it('separates the prefix from the number', () => {
    assert.deepEqual(splitId('FP02-REQ-03'), { prefix: 'FP02-REQ', number: 3 });
    assert.deepEqual(splitId('FP-02-AC04'), { prefix: 'FP-02-AC', number: 4 });
    assert.deepEqual(splitId('FP0203-WL-12'), { prefix: 'FP0203-WL', number: 12 });
  });
});

describe('parseRegistry', () => {
  it('reads prefixes and ranges and reports duplicates and empty ranges', () => {
    assert.deepEqual([...rows], [['FP09-REQ', { min: 1, max: 9 }], ['FP-09-AC', { min: 1, max: 99 }]]);
    const bad = parseRegistry(`${REGISTRY}\n| \`FP09-REQ\` | again | delivery | 5-2 | open |`);
    assert.deepEqual(bad.problems, ['spec/ids.md: prefix FP09-REQ is registered twice', 'spec/ids.md: prefix FP09-REQ has an empty range 5-2']);
  });
});

describe('idProblems', () => {
  it('accepts definitions and references that resolve', () => {
    assert.deepEqual(problems(REQUIREMENTS), []);
    assert.deepEqual(idProblems([{ file: '.kiro/specs/x/requirements.md', text: REQUIREMENTS }, { file: '.kiro/specs/x/tasks.md', text: 'Covers FP09-REQ-01 and FP-09-AC01.' }], rows), []);
  });

  it('rejects an id defined twice, within a file and across files (deliberate violation)', () => {
    assert.deepEqual(problems(`${REQUIREMENTS}\n| FP09-REQ-01 | Again. |`), ['.kiro/specs/x/requirements.md:6: FP09-REQ-01 is already defined at .kiro/specs/x/requirements.md:5']);
    const other = idProblems([{ file: '.kiro/specs/x/requirements.md', text: REQUIREMENTS }, { file: '.kiro/specs/y/requirements.md', text: '- **FP-09-AC01:** Again.' }], rows);
    assert.deepEqual(other, ['.kiro/specs/y/requirements.md:1: FP-09-AC01 is already defined at .kiro/specs/x/requirements.md:1']);
  });

  it('rejects an unregistered prefix and a number outside the reserved range', () => {
    assert.deepEqual(problems('| FP08-REQ-01 | x |'), ['.kiro/specs/x/requirements.md:1: prefix FP08-REQ of FP08-REQ-01 is not registered in spec/ids.md']);
    assert.deepEqual(problems('| FP09-REQ-10 | x |'), ['.kiro/specs/x/requirements.md:1: FP09-REQ-10 is outside the reserved range 1-9']);
  });

  it('rejects a reference that no requirements file defines', () => {
    assert.deepEqual(problems(`${REQUIREMENTS}\n\nSee FP09-REQ-02.`), ['.kiro/specs/x/requirements.md:7: FP09-REQ-02 is referenced but defined in no requirements.md']);
    assert.deepEqual(idProblems([{ file: '.kiro/specs/x/design.md', text: 'See FP-09-AC05.' }], rows), ['.kiro/specs/x/design.md:1: FP-09-AC05 is referenced but defined in no requirements.md']);
  });

  it('defines only in requirements.md', () => {
    const found = problems(REQUIREMENTS, '.kiro/specs/x/design.md');
    assert.equal(found.length, 3);
    assert.ok(found.every((problem) => problem.endsWith('is referenced but defined in no requirements.md')));
  });
});

describe('run', () => {
  it('passes a consistent tree', () => {
    const root = tree({ 'spec/ids.md': REGISTRY, '.kiro/specs/x/requirements.md': REQUIREMENTS, '.kiro/specs/x/notes.txt': 'FP99-REQ-1', '.kiro/specs/x/design.md': 'Uses FP09-REQ-01.' });
    assert.deepEqual(runLogged(root), { code: 0, lines: ['check:spec-ids: 2 prefix(es), 2 spec document(s) ok'] });
  });

  it('fails without a registry', () => {
    assert.deepEqual(runLogged(mkdtempSync(join(tmp, 'none-'))), { code: 1, lines: ['check:spec-ids: spec/ids.md not found'] });
  });

  it('fails on an unregistered prefix found by walking nested spec folders', () => {
    const root = tree({ 'spec/ids.md': REGISTRY, '.kiro/specs/a/b/requirements.md': '| FP07-REQ-01 | x |' });
    const { code, lines } = runLogged(root);
    assert.equal(code, 1);
    assert.deepEqual(lines, ['check:spec-ids: .kiro/specs/a/b/requirements.md:1: prefix FP07-REQ of FP07-REQ-01 is not registered in spec/ids.md']);
  });

  it('passes on the committed repository', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ log: (line) => lines.push(line) }), 0, lines.join('\n'));
  });
});
