import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  COMPATIBILITY_DIR,
  EVIDENCE_ROOT,
  LEGACY_EVIDENCE,
  LEGACY_HOST_VERSION,
  SCOPES,
  compareVersions,
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
const EVIDENCE = `${EVIDENCE_ROOT}/L3-v1b/log.md`;
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

  it('keeps at least the 62 FP-01 questions: 46 matrix cells and 16 host facts', () => {
    const doc = JSON.parse(readFileSync(join(COMPATIBILITY_DIR, 'capability-questions.json'), 'utf8'));
    assert.ok(doc.questions.length >= 62);
    assert.ok(doc.questions.filter((/** @type {{ kind: string }} */ q) => q.kind === 'matrix').length >= 46);
    assert.ok(doc.questions.filter((/** @type {{ kind: string }} */ q) => q.kind === 'host-fact').length >= 16);
  });

  it('never loses proof: at least the 17 ALLOWED, DENIED or UNSUPPORTED FP-01 cells stay proven, every cell id once', () => {
    const matrix = JSON.parse(readFileSync(join(COMPATIBILITY_DIR, 'capability-matrix.json'), 'utf8'));
    const states = /** @type {Record<string, number>} */ ({});
    for (const cell of matrix.cells) states[cell.state] = (states[cell.state] ?? 0) + 1;
    assert.ok((states.ALLOWED ?? 0) + (states.DENIED ?? 0) + (states.UNSUPPORTED ?? 0) >= 17, JSON.stringify(states));
    assert.equal(new Set(matrix.cells.map((/** @type {{ id: string }} */ cell) => cell.id)).size, matrix.cells.length);
  });

  it('never loses a host fact: at least 15 stay OBSERVED or NOT-OBSERVED', () => {
    const facts = JSON.parse(readFileSync(join(COMPATIBILITY_DIR, 'host-facts.json'), 'utf8'));
    const proven = facts.facts.filter((/** @type {{ status: string }} */ fact) => fact.status !== 'UNTESTED').length;
    assert.ok(proven >= 15, String(proven));
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
    const evidence = join(root, EVIDENCE_ROOT, 'L3-v1b');
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
    const evidence = join(root, EVIDENCE_ROOT, 'L3-v1b');
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
    edit(root, 'monitoring-scope.md', (text) => text.replace(/^Status:.*$/m, ''));
    assert.equal(runLogged(root).code, 1);
  });
});

describe('host-version policy', () => {
  const NEW_EVIDENCE = `${EVIDENCE_ROOT}/20261115T180000Z-abc123/export.json`;
  /** @type {(file: string) => boolean} */
  const existsNew = (file) => file === NEW_EVIDENCE || file === EVIDENCE;
  const known = ['0.12.0', '0.12.2'];
  const newCell = { ...allowed, evidenceRef: NEW_EVIDENCE };

  /**
   * @param {Record<string, unknown>} cell
   * @param {string} [top] matrix hostVersion
   */
  function cellProblems(cell, top = '0.12.2') {
    const matrix = { hostVersion: top, cells: [{ id: 'app-owned-a', scope: 'app-owned', ...cell }] };
    return validateMatrix(matrix, questions, { evidenceExists: existsNew, markdown: '| `app-owned-a` | ALLOWED |', knownVersions: known });
  }

  it('orders dotted versions numerically', () => {
    assert.ok(compareVersions('0.12.2', '0.12.0') > 0);
    assert.ok(compareVersions('0.9.0', '0.12.0') < 0);
    assert.equal(compareVersions('0.12', '0.12.0'), 0);
    assert.equal(LEGACY_HOST_VERSION, '0.12.0');
    assert.ok(LEGACY_EVIDENCE.includes('L3-v1b'));
  });

  it('reads a cell without hostVersion as FP-01 evidence when its evidence is FP-01 evidence', () => {
    assert.deepEqual(cellProblems(allowed), []);
  });

  it('requires hostVersion on a cell whose evidence is a new run (deliberate violation)', () => {
    assert.deepEqual(cellProblems(newCell), ['app-owned-a: hostVersion is required unless all evidence is FP-01 evidence (0.12.0)']);
  });

  it('accepts a declared known hostVersion and an FP-01 cell kept at 0.12.0 beside it', () => {
    assert.deepEqual(cellProblems({ ...newCell, hostVersion: '0.12.2' }), []);
    assert.deepEqual(cellProblems({ ...allowed, hostVersion: '0.12.0' }), []);
  });

  it('rejects an unknown hostVersion and one newer than the matrix', () => {
    assert.deepEqual(cellProblems({ ...newCell, hostVersion: '0.13.0' }), ['app-owned-a: hostVersion 0.13.0 has no docs/compatibility/crew-<version>.md record']);
    assert.equal(cellProblems({ ...newCell, hostVersion: '0.12.2' }, '0.12.0').length, 1);
    assert.deepEqual(cellProblems({ ...newCell, hostVersion: 12 }), ['app-owned-a: hostVersion 12 has no docs/compatibility/crew-<version>.md record']);
  });

  it('rejects a matrix hostVersion with no compatibility record', () => {
    assert.deepEqual(cellProblems(allowed, '0.13.0'), ['hostVersion must be 0.12.0 or 0.12.2, got 0.13.0']);
  });

  it('keeps an UNTESTED cell free of hostVersion', () => {
    assert.ok(cellProblems({ ...untested, hostVersion: '0.12.2' }).includes('app-owned-a: UNTESTED must not declare hostVersion'));
  });

  /**
   * @param {Record<string, unknown>} fact
   * @param {Record<string, string>} recordTexts
   */
  function factProblems(fact, recordTexts) {
    const doc = { hostVersion: '0.12.2', facts: [{ id: 'host-b', status: 'OBSERVED', ...fact }] };
    return validateHostFacts(doc, questions, { evidenceExists: existsNew, markdown: recordTexts['0.12.0'] ?? '', knownVersions: known, recordTexts });
  }

  const evidence = (/** @type {string} */ ref) => [{ credential: 'OWNER-SESSION', at: 'x', ref }];

  it('checks each fact against the record of its own host version', () => {
    const texts = { '0.12.0': '| `host-b` | OBSERVED |', '0.12.2': '| `host-b` | NOT-OBSERVED |' };
    assert.deepEqual(factProblems({ evidence: evidence(EVIDENCE) }, texts), []);
    assert.deepEqual(factProblems({ status: 'NOT-OBSERVED', hostVersion: '0.12.2', evidence: evidence(NEW_EVIDENCE) }, texts), []);
    assert.deepEqual(factProblems({ hostVersion: '0.12.2', evidence: evidence(NEW_EVIDENCE) }, texts), ['crew-0.12.2.md disagrees for host-b']);
  });

  it('requires hostVersion on a fact whose evidence is a new run and rejects unknown and newer ones', () => {
    const texts = { '0.12.0': '| `host-b` | OBSERVED |', '0.12.2': '| `host-b` | OBSERVED |' };
    assert.ok(factProblems({ evidence: evidence(NEW_EVIDENCE) }, texts).includes('host-b: hostVersion is required unless all evidence is FP-01 evidence (0.12.0)'));
    assert.ok(factProblems({ hostVersion: '0.13.0', evidence: evidence(EVIDENCE) }, texts).some((problem) => problem.includes('has no docs/compatibility/crew-<version>.md record')));
    const doc = { hostVersion: '0.12.0', facts: [{ id: 'host-b', status: 'OBSERVED', hostVersion: '0.12.2', evidence: evidence(NEW_EVIDENCE) }] };
    const older = validateHostFacts(doc, questions, { evidenceExists: existsNew, markdown: '', knownVersions: known, recordTexts: texts });
    assert.ok(older.includes('host-b: hostVersion 0.12.2 is newer than the host-facts hostVersion 0.12.0'));
  });

  it('lets an UNTESTED fact omit evidence and hostVersion', () => {
    assert.deepEqual(factProblems({ status: 'UNTESTED', notes: 'n' }, { '0.12.0': '| `host-b` | UNTESTED |' }), []);
  });

  it('run() discovers every crew-<version>.md record and accepts a 0.12.2 cell with its own evidence', () => {
    const root = mkdtempSync(join(tmp, 'policy-'));
    cpSync(COMPATIBILITY_DIR, join(root, COMPATIBILITY_DIR), { recursive: true });
    mkdirSync(dirname(join(root, NEW_EVIDENCE)), { recursive: true });
    writeFileSync(join(root, NEW_EVIDENCE), '{}');
    writeFileSync(join(root, COMPATIBILITY_DIR, 'crew-0.12.2.md'), '# Crew 0.12.2\n');
    const matrixPath = join(root, COMPATIBILITY_DIR, 'capability-matrix.json');
    const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
    Object.assign(matrix.cells[0], { state: 'ALLOWED', credential: 'APP-TOKEN', evidenceRef: NEW_EVIDENCE, probedAt: '2026-11-15T18:00:00Z', hostVersion: '0.12.2' });
    matrix.hostVersion = '0.12.2';
    writeFileSync(matrixPath, JSON.stringify(matrix));
    const mdPath = join(root, COMPATIBILITY_DIR, 'capability-matrix.md');
    writeFileSync(mdPath, readFileSync(mdPath, 'utf8').replace(`| \`${matrix.cells[0].id}\` | UNTESTED |`, `| \`${matrix.cells[0].id}\` | ALLOWED |`));
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ root, log: (line) => lines.push(line) }), 0, lines.join('\n'));
    delete matrix.cells[0].hostVersion;
    writeFileSync(matrixPath, JSON.stringify(matrix));
    assert.equal(run({ root, log: (line) => lines.push(line) }), 1);
    assert.ok(lines.some((line) => line.includes('hostVersion is required')));
  });
});
