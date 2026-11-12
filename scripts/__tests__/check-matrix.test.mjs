import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  COMPATIBILITY_DIR,
  EVIDENCE_ROOT,
  SCOPES,
  evidencePath,
  run,
  validateHostFacts,
  validateMatrix,
  validateMonitoringScope,
  validateQuestions,
} from '../check-matrix.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'check-matrix-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const questions = [
  { id: 'app-owned-a', kind: 'matrix', scope: 'app-owned', question: 'q', priority: 'must' },
  { id: 'host-b', kind: 'host-fact', question: 'q', priority: 'must' },
];
const EVIDENCE = `${EVIDENCE_ROOT}/run-1/log.md`;
/** @type {(file: string) => boolean} */
const exists = (file) => file === EVIDENCE;

/** @param {Record<string, unknown>} cell */
function matrixProblems(cell, { markdown = '| `app-owned-a` | ALLOWED |', evidenceExists = exists } = {}) {
  const matrix = { hostVersion: '0.12.0', cells: [{ id: 'app-owned-a', scope: 'app-owned', ...cell }] };
  return validateMatrix(matrix, questions, { evidenceExists, markdown });
}

const allowed = { state: 'ALLOWED', credential: 'APP-TOKEN', evidenceRef: EVIDENCE, probedAt: '2026-11-09T12:00:00Z' };
const untested = { state: 'UNTESTED', credential: null, evidenceRef: null, probedAt: null, notes: 'not yet probed' };

describe('evidencePath', () => {
  it('accepts a path under the evidence root and strips a fragment', () => {
    assert.equal(evidencePath(`${EVIDENCE}#L3`), EVIDENCE);
  });

  it('rejects non-strings, other roots, absolute paths and traversal', () => {
    assert.equal(evidencePath(undefined), null);
    assert.equal(evidencePath(null), null);
    assert.equal(evidencePath('docs/other/log.md'), null);
    assert.equal(evidencePath(`/${EVIDENCE}`), null);
    assert.equal(evidencePath(`${EVIDENCE_ROOT}/../secret.md`), null);
    assert.equal(evidencePath(`${EVIDENCE_ROOT}/a/../../x.md`), null);
  });
});

describe('validateMatrix', () => {
  it('accepts an ALLOWED cell with APP-TOKEN evidence that exists', () => {
    assert.deepEqual(matrixProblems(allowed), []);
  });

  it('rejects ALLOWED with OWNER-SESSION evidence in every scope', () => {
    for (const scope of SCOPES) {
      const matrix = { hostVersion: '0.12.0', cells: [{ id: 'app-owned-a', scope, ...allowed, credential: 'OWNER-SESSION' }] };
      const problems = validateMatrix(matrix, questions, { evidenceExists: exists, markdown: '| `app-owned-a` | ALLOWED |' });
      assert.ok(problems.includes('app-owned-a: ALLOWED requires APP-TOKEN evidence'), scope);
    }
  });

  it('rejects the retired host scope', () => {
    const problems = matrixProblems({ ...allowed, scope: 'host' });
    assert.ok(problems.includes('app-owned-a: invalid scope host'));
  });

  it('rejects ALLOWED whose evidence file does not exist', () => {
    const problems = matrixProblems(allowed, { evidenceExists: () => false });
    assert.ok(problems.includes(`app-owned-a: evidenceRef missing or not under ${EVIDENCE_ROOT}`));
  });

  it('rejects ALLOWED with no evidence reference, no probe time, or no credential', () => {
    assert.ok(matrixProblems({ ...allowed, evidenceRef: null }).some((p) => p.includes('evidenceRef missing')));
    assert.ok(matrixProblems({ ...allowed, probedAt: null }).includes('app-owned-a: ALLOWED needs probedAt'));
    assert.ok(matrixProblems({ ...allowed, credential: null }).includes('app-owned-a: ALLOWED needs a credential label'));
  });

  it('rejects an evidence reference outside the evidence root', () => {
    const problems = matrixProblems({ ...allowed, evidenceRef: 'docs/other/log.md' }, { evidenceExists: () => true });
    assert.ok(problems.some((p) => p.includes('evidenceRef missing')));
  });

  it('accepts DENIED and UNSUPPORTED with either credential and existing evidence', () => {
    for (const state of ['DENIED', 'UNSUPPORTED']) {
      for (const credential of ['APP-TOKEN', 'OWNER-SESSION']) {
        assert.deepEqual(matrixProblems({ ...allowed, state, credential }, { markdown: `| \`app-owned-a\` | ${state} |` }), []);
      }
    }
  });

  it('rejects DENIED and UNSUPPORTED without an existing evidence reference', () => {
    for (const state of ['DENIED', 'UNSUPPORTED']) {
      assert.ok(matrixProblems({ ...allowed, state, evidenceRef: null }, { markdown: `| \`app-owned-a\` | ${state} |` }).length > 0);
      assert.ok(matrixProblems({ ...allowed, state }, { markdown: `| \`app-owned-a\` | ${state} |`, evidenceExists: () => false }).length > 0);
    }
  });

  it('accepts UNTESTED with notes and all-null fields', () => {
    assert.deepEqual(matrixProblems(untested, { markdown: '| `app-owned-a` | UNTESTED |' }), []);
  });

  it('rejects UNTESTED without notes or with a non-null field', () => {
    const markdown = '| `app-owned-a` | UNTESTED |';
    assert.ok(matrixProblems({ ...untested, notes: '' }, { markdown }).includes('app-owned-a: UNTESTED needs notes saying why'));
    for (const field of ['credential', 'evidenceRef', 'probedAt']) {
      const value = field === 'credential' ? 'APP-TOKEN' : 'x';
      assert.ok(
        matrixProblems({ ...untested, [field]: value }, { markdown }).includes('app-owned-a: UNTESTED must have null credential, evidenceRef and probedAt'),
        field,
      );
    }
  });

  it('rejects an invalid state', () => {
    assert.ok(matrixProblems({ ...allowed, state: 'MAYBE' }).includes('app-owned-a: invalid state MAYBE'));
  });

  it('rejects a wrong host version', () => {
    const problems = validateMatrix({ hostVersion: '0.11.2', cells: [] }, [], { evidenceExists: exists, markdown: '' });
    assert.deepEqual(problems, ['hostVersion must be 0.12.0, got 0.11.2']);
  });

  it('rejects duplicate, missing and extra cells', () => {
    const matrix = {
      hostVersion: '0.12.0',
      cells: [
        { id: 'app-owned-a', scope: 'app-owned', ...untested },
        { id: 'app-owned-a', scope: 'app-owned', ...untested },
        { id: 'host-b', scope: 'app-owned', ...untested },
        { id: 'extra', scope: 'bot', ...untested },
      ],
    };
    const markdown = '| `app-owned-a` | UNTESTED | `host-b` | UNTESTED | `extra` | UNTESTED |';
    const problems = validateMatrix(matrix, questions, { evidenceExists: exists, markdown });
    assert.ok(problems.includes('duplicate cell app-owned-a'));
    assert.ok(problems.includes('cell host-b is not a matrix question in capability-questions.json'));
    assert.ok(problems.includes('cell extra is not a matrix question in capability-questions.json'));
    const empty = validateMatrix({ hostVersion: '0.12.0', cells: [] }, questions, { evidenceExists: exists, markdown: '' });
    assert.deepEqual(empty, ['question app-owned-a has no cell']);
  });

  it('rejects a rendered table that disagrees with the JSON', () => {
    assert.deepEqual(matrixProblems(allowed, { markdown: '| `app-owned-a` | UNTESTED |' }), ['capability-matrix.md disagrees for app-owned-a']);
  });

  it('treats a missing cells list as empty', () => {
    const problems = validateMatrix({ hostVersion: '0.12.0' }, questions, { evidenceExists: exists, markdown: '' });
    assert.deepEqual(problems, ['question app-owned-a has no cell']);
  });
});

describe('validateHostFacts', () => {
  const fact = { id: 'host-b', status: 'OBSERVED', evidence: [{ credential: 'OWNER-SESSION', at: '2026-11-09T12:00:00Z', ref: EVIDENCE }] };

  /** @param {Record<string, unknown>} change */
  function factProblems(change, { markdown = '| `host-b` | OBSERVED |', evidenceExists = exists } = {}) {
    return validateHostFacts({ hostVersion: '0.12.0', facts: [{ ...fact, ...change }] }, questions, { evidenceExists, markdown });
  }

  it('accepts OBSERVED and NOT-OBSERVED on OWNER-SESSION evidence', () => {
    assert.deepEqual(factProblems({}), []);
    assert.deepEqual(factProblems({ status: 'NOT-OBSERVED' }, { markdown: '| `host-b` | NOT-OBSERVED |' }), []);
  });

  it('rejects OBSERVED with no evidence', () => {
    assert.ok(factProblems({ evidence: [] }).includes('host-b: OBSERVED needs evidence'));
  });

  it('rejects evidence with a missing file or no credential label', () => {
    assert.ok(factProblems({}, { evidenceExists: () => false }).includes(`host-b: evidence ref missing or not under ${EVIDENCE_ROOT}`));
    const unlabeled = [{ at: 'x', ref: EVIDENCE }];
    assert.ok(factProblems({ evidence: unlabeled }).includes('host-b: evidence needs a credential label'));
  });

  it('requires notes for UNTESTED and allows empty evidence', () => {
    const markdown = '| `host-b` | UNTESTED |';
    assert.deepEqual(factProblems({ status: 'UNTESTED', evidence: [], notes: 'not yet probed' }, { markdown }), []);
    assert.ok(factProblems({ status: 'UNTESTED', evidence: [] }, { markdown }).includes('host-b: UNTESTED needs notes saying why'));
  });

  it('rejects an invalid status, a wrong version and a record that disagrees', () => {
    assert.ok(factProblems({ status: 'GUESSED' }).includes('host-b: invalid status GUESSED'));
    assert.ok(factProblems({}, { markdown: '| `host-b` | UNTESTED |' }).includes('crew-0.12.0.md disagrees for host-b'));
    const wrong = validateHostFacts({ hostVersion: '0.11.2', facts: [] }, [], { evidenceExists: exists, markdown: '' });
    assert.deepEqual(wrong, ['host-facts hostVersion must be 0.12.0, got 0.11.2']);
  });

  it('rejects duplicate, missing and extra facts', () => {
    const doc = {
      hostVersion: '0.12.0',
      facts: [
        { ...fact, status: 'UNTESTED', notes: 'n', evidence: [] },
        { ...fact, status: 'UNTESTED', notes: 'n', evidence: [] },
        { id: 'app-owned-a', status: 'UNTESTED', notes: 'n', evidence: [] },
      ],
    };
    const markdown = '| `host-b` | UNTESTED | `app-owned-a` | UNTESTED |';
    const problems = validateHostFacts(doc, questions, { evidenceExists: exists, markdown });
    assert.ok(problems.includes('duplicate fact host-b'));
    assert.ok(problems.includes('fact app-owned-a is not a host-fact question in capability-questions.json'));
    const empty = validateHostFacts({ hostVersion: '0.12.0' }, questions, { evidenceExists: exists, markdown: '' });
    assert.deepEqual(empty, ['host fact host-b missing']);
  });
});

describe('validateMonitoringScope', () => {
  it('accepts NOT APPROVED', () => {
    assert.deepEqual(validateMonitoringScope('# t\n\nStatus: NOT APPROVED\n'), []);
  });

  it('requires a status line', () => {
    assert.equal(validateMonitoringScope('# t\n').length, 1);
    assert.equal(validateMonitoringScope('Status: maybe\n').length, 1);
  });

  it('requires an approver and a date for APPROVED', () => {
    assert.deepEqual(validateMonitoringScope('Status: APPROVED\n'), ['APPROVED needs a "Approved by:" line', 'APPROVED needs a "Approved on:" line']);
    assert.deepEqual(validateMonitoringScope('Status: APPROVED\nApproved by: Eric\nApproved on: 2026-11-12\n'), []);
    assert.equal(validateMonitoringScope('Status: APPROVED\nApproved by:\nApproved on: 2026-11-12\n').length, 1);
  });
});

describe('validateQuestions', () => {
  const question = { id: 'a-b', kind: 'matrix', scope: 'bot', question: 'q', priority: 'must' };

  it('accepts a sorted, well-formed list', () => {
    assert.deepEqual(validateQuestions({ version: 1, questions: [question, { id: 'c-d', kind: 'host-fact', question: 'q', priority: 'deferred' }] }), []);
  });

  it('rejects a non-object and a wrong version', () => {
    assert.deepEqual(validateQuestions([]), ['capability-questions.json must be an object']);
    assert.ok(validateQuestions({ version: 2, questions: [] }).includes('capability-questions.json version must be 1'));
  });

  it('rejects a question list holding non-objects', () => {
    assert.ok(validateQuestions({ version: 1, questions: ['x'] }).includes('questions must be a list of objects'));
    assert.ok(validateQuestions({ version: 1 }).includes('questions must be a list of objects'));
  });

  it('rejects bad ids, duplicates and unsorted order', () => {
    assert.ok(validateQuestions({ version: 1, questions: [{ ...question, id: 'bot.list' }] }).includes('bot.list: id must be kebab-case'));
    const duplicate = validateQuestions({ version: 1, questions: [question, question] });
    assert.ok(duplicate.includes('duplicate question a-b'));
    const unsorted = validateQuestions({ version: 1, questions: [{ ...question, id: 'z-z' }, question] });
    assert.ok(unsorted.includes('a-b: questions must be sorted by id'));
  });

  it('rejects bad kind, scope, text and priority', () => {
    const bad = (/** @type {Record<string, unknown>} */ change) => validateQuestions({ version: 1, questions: [{ ...question, ...change }] });
    assert.ok(bad({ kind: 'other' }).includes('a-b: invalid kind other'));
    assert.ok(bad({ scope: 'host' }).includes('a-b: matrix question needs a valid scope'));
    assert.ok(bad({ kind: 'host-fact', scope: 'bot' }).includes('a-b: host-fact question must not have a scope'));
    assert.ok(bad({ question: '' }).includes('a-b: question text missing'));
    assert.ok(bad({ priority: 'best' }).includes('a-b: invalid priority best'));
  });
});

describe('run', () => {
  /** Copies the committed compatibility directory into a temp root. */
  function copyRoot() {
    const root = mkdtempSync(join(tmp, 'root-'));
    cpSync(COMPATIBILITY_DIR, join(root, COMPATIBILITY_DIR), { recursive: true });
    return root;
  }

  /**
   * @param {string} root
   * @param {string} name
   * @param {(text: string) => string} edit
   */
  function edit(root, name, edit) {
    const path = join(root, COMPATIBILITY_DIR, name);
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
  }

  /** @param {string} root */
  function runLogged(root) {
    /** @type {string[]} */
    const lines = [];
    const code = run({ root, log: (line) => lines.push(line) });
    return { code, lines };
  }

  it('passes on the committed compatibility files', () => {
    const { code, lines } = runLogged('.');
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(lines, ['check:matrix: capability matrix, host facts and monitoring scope ok']);
  });

  it('commits exactly the 62 questions: 46 matrix cells and 16 host facts', () => {
    const doc = JSON.parse(readFileSync(join(COMPATIBILITY_DIR, 'capability-questions.json'), 'utf8'));
    assert.equal(doc.questions.length, 62);
    assert.equal(doc.questions.filter((/** @type {{ kind: string }} */ q) => q.kind === 'matrix').length, 46);
    assert.equal(doc.questions.filter((/** @type {{ kind: string }} */ q) => q.kind === 'host-fact').length, 16);
  });

  it('commits the closed live run: 7 ALLOWED, 10 DENIED and 29 UNTESTED cells, every cell id once', () => {
    const matrix = JSON.parse(readFileSync(join(COMPATIBILITY_DIR, 'capability-matrix.json'), 'utf8'));
    const states = /** @type {Record<string, number>} */ ({});
    for (const cell of matrix.cells) states[cell.state] = (states[cell.state] ?? 0) + 1;
    assert.deepEqual(states, { ALLOWED: 7, DENIED: 10, UNTESTED: 29 });
    assert.equal(new Set(matrix.cells.map((/** @type {{ id: string }} */ cell) => cell.id)).size, 46);
  });

  it('commits one fact per host-fact question, with no host fact claimed beyond the evidence', () => {
    const facts = JSON.parse(readFileSync(join(COMPATIBILITY_DIR, 'host-facts.json'), 'utf8'));
    const statuses = /** @type {Record<string, number>} */ ({});
    for (const fact of facts.facts) statuses[fact.status] = (statuses[fact.status] ?? 0) + 1;
    assert.deepEqual(statuses, { OBSERVED: 15, UNTESTED: 1 });
  });

  it('fails when a file is missing', () => {
    const root = copyRoot();
    rmSync(join(root, COMPATIBILITY_DIR, 'host-facts.json'));
    const { code, lines } = runLogged(root);
    assert.equal(code, 1);
    assert.ok(lines[0]?.endsWith('host-facts.json not found'));
  });

  it('fails when an ALLOWED cell has OWNER-SESSION evidence (deliberate violation)', () => {
    const root = copyRoot();
    const evidence = join(root, EVIDENCE_ROOT, 'run-1');
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, 'log.md'), 'log');
    edit(root, 'capability-matrix.json', (text) => {
      const matrix = JSON.parse(text);
      Object.assign(matrix.cells[0], { state: 'ALLOWED', credential: 'OWNER-SESSION', evidenceRef: EVIDENCE, probedAt: '2026-11-09T12:00:00Z', notes: undefined });
      return JSON.stringify(matrix);
    });
    const id = JSON.parse(readFileSync(join(root, COMPATIBILITY_DIR, 'capability-matrix.json'), 'utf8')).cells[0].id;
    edit(root, 'capability-matrix.md', (text) => text.replace(`| \`${id}\` | UNTESTED |`, `| \`${id}\` | ALLOWED |`));
    const { code, lines } = runLogged(root);
    assert.equal(code, 1);
    assert.deepEqual(lines, [`check:matrix: ${id}: ALLOWED requires APP-TOKEN evidence`]);
  });

  it('passes the same ALLOWED cell once the evidence is APP-TOKEN', () => {
    const root = copyRoot();
    const evidence = join(root, EVIDENCE_ROOT, 'run-1');
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, 'log.md'), 'log');
    edit(root, 'capability-matrix.json', (text) => {
      const matrix = JSON.parse(text);
      Object.assign(matrix.cells[0], { state: 'ALLOWED', credential: 'APP-TOKEN', evidenceRef: EVIDENCE, probedAt: '2026-11-09T12:00:00Z' });
      return JSON.stringify(matrix);
    });
    const id = JSON.parse(readFileSync(join(root, COMPATIBILITY_DIR, 'capability-matrix.json'), 'utf8')).cells[0].id;
    edit(root, 'capability-matrix.md', (text) => text.replace(`| \`${id}\` | UNTESTED |`, `| \`${id}\` | ALLOWED |`));
    assert.equal(runLogged(root).code, 0);
  });

  it('fails on an invalid question file before checking the rest', () => {
    const root = copyRoot();
    edit(root, 'capability-questions.json', () => JSON.stringify({ version: 2, questions: [] }));
    const { code, lines } = runLogged(root);
    assert.equal(code, 1);
    assert.deepEqual(lines, ['check:matrix: capability-questions.json version must be 1']);
  });

  it('fails when the matrix or host facts are not objects', () => {
    const root = copyRoot();
    edit(root, 'capability-matrix.json', () => '[]');
    const { code, lines } = runLogged(root);
    assert.equal(code, 1);
    assert.deepEqual(lines, ['check:matrix: capability-matrix.json and host-facts.json must be objects']);
  });

  it('fails when the monitoring scope has no status', () => {
    const root = copyRoot();
    mkdirSync(dirname(join(root, COMPATIBILITY_DIR, 'monitoring-scope.md')), { recursive: true });
    edit(root, 'monitoring-scope.md', (text) => text.replace('Status: NOT APPROVED', ''));
    assert.equal(runLogged(root).code, 1);
  });
});
