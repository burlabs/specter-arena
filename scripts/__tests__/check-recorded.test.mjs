import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  HASHED_ID,
  REDACTED,
  acceptedOutcomeProblems,
  nonProbeProblems,
  probeProblems,
  run,
  scanImports,
  validateRecordedFile,
} from '../check-recorded.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'check-recorded-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * @param {Record<string, string>} files
 * @returns {string} directory holding the files
 */
function tree(files) {
  const dir = mkdtempSync(join(tmp, 'tree-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

const meta = { sanitisation: 'shape only', hostVersion: '0.12.0' };

describe('sanitised grammar', () => {
  it('accepts the documented valid examples', () => {
    for (const value of ['sha256:0123456789ab', '<redacted type=str len=12>', '<redacted type=list len=0>', '<redacted type=object len=3>']) {
      assert.deepEqual(nonProbeProblems(value), [], value);
    }
  });

  it('rejects the documented invalid examples', () => {
    for (const value of ['sha256:0123456789a', 'sha256:0123456789abc', 'sha256:0123456789AB', 'h:0123456789ab', '<redacted type=int len=3>', '<redacted type=str>', '<str>', 'Eric Jeffers', '']) {
      assert.deepEqual(nonProbeProblems(value), ['$: string is not in the sanitised grammar'], value);
    }
  });

  it('exports the grammar patterns', () => {
    assert.ok(HASHED_ID.test('sha256:abcdef012345'));
    assert.ok(REDACTED.test('<redacted type=str len=1>'));
  });

  it('accepts numbers, booleans and null and ignores object keys', () => {
    assert.deepEqual(nonProbeProblems({ 'any free key': 1, nested: [true, null, { n: 2.5 }] }), []);
  });

  it('reports the path of a bad leaf', () => {
    assert.deepEqual(nonProbeProblems({ a: [1, 'name'] }), ['$.a[1]: string is not in the sanitised grammar']);
  });

  it('rejects unsupported values', () => {
    assert.deepEqual(nonProbeProblems(undefined), ['$: unsupported value']);
  });
});

describe('probeProblems', () => {
  it('flags credential-shaped strings at any depth', () => {
    assert.deepEqual(probeProblems({ h: ['Bearer abcdefghijklmnop'] }), ['$.h[0]: looks like a bearer credential']);
    assert.deepEqual(probeProblems('x-kirocrew-proxy-v2: "abcdefgh1234"'), ['$: looks like a proxy header value']);
    assert.deepEqual(probeProblems('AKIA' + 'A'.repeat(16)), ['$: looks like a AWS access key ID']);
  });

  it('allows ordinary text and ignores non-strings', () => {
    assert.deepEqual(probeProblems({ name: 'specter-probe-bot', n: 3, ok: true, none: null }), []);
  });

  it('allows a redacted proxy header placeholder', () => {
    assert.deepEqual(probeProblems('x-kirocrew-proxy-v2: "<redacted>"'), []);
  });
});

describe('acceptedOutcomeProblems', () => {
  it('flags outcomeEvidence that claims acceptance, in any case and depth', () => {
    assert.deepEqual(acceptedOutcomeProblems({ rows: [{ outcomeEvidence: 'accepted by review' }] }), ['$.rows[0].outcomeEvidence: outcomeEvidence must not claim acceptance']);
    assert.equal(acceptedOutcomeProblems({ outcomeEvidence: 'Accepted' }).length, 1);
  });

  it('allows unknown, null and other fields that mention the word', () => {
    assert.deepEqual(acceptedOutcomeProblems({ outcomeEvidence: 'unknown' }), []);
    assert.deepEqual(acceptedOutcomeProblems({ outcomeEvidence: null }), []);
    assert.deepEqual(acceptedOutcomeProblems({ note: 'accepted' }), []);
    assert.deepEqual(acceptedOutcomeProblems('accepted'), []);
  });
});

describe('validateRecordedFile', () => {
  const good = { _meta: meta, rows: [{ rowKind: 'non-probe', id: 7, count: 3 }, { rowKind: 'probe', attemptId: 'a1', title: 'harmless task' }] };

  it('accepts a well-formed file', () => {
    assert.deepEqual(validateRecordedFile('f.json', good), []);
  });

  it('rejects a non-object file and a missing rows list', () => {
    assert.deepEqual(validateRecordedFile('f.json', []), ['f.json: must be an object with _meta and rows']);
    assert.deepEqual(validateRecordedFile('f.json', { _meta: meta }), ['f.json: rows must be a list']);
  });

  it('rejects missing _meta, missing sanitisation and a wrong host version', () => {
    assert.deepEqual(validateRecordedFile('f.json', { rows: [] }), ['f.json: _meta missing']);
    assert.deepEqual(validateRecordedFile('f.json', { _meta: { hostVersion: '0.12.0' }, rows: [] }), ['f.json: _meta.sanitisation missing']);
    assert.deepEqual(validateRecordedFile('f.json', { _meta: { sanitisation: 's', hostVersion: '0.11.2' }, rows: [] }), ['f.json: _meta.hostVersion must be 0.12.0']);
  });

  it('rejects rows that are not objects or have an unknown rowKind', () => {
    assert.ok(validateRecordedFile('f.json', { _meta: meta, rows: [1] }).includes('f.json: rows[0] must be an object'));
    assert.ok(validateRecordedFile('f.json', { _meta: meta, rows: [{ rowKind: 'other' }] }).includes('f.json: rows[0]: rowKind must be probe or non-probe'));
  });

  it('applies the grammar to non-probe rows only', () => {
    const problems = validateRecordedFile('f.json', { _meta: meta, rows: [{ rowKind: 'non-probe', botName: 'Eric Bot' }, { rowKind: 'probe', botName: 'Eric Bot' }] });
    assert.deepEqual(problems, ['f.json: rows[0].botName: string is not in the sanitised grammar']);
  });

  it('flags credential-shaped values in probe rows', () => {
    const problems = validateRecordedFile('f.json', { _meta: meta, rows: [{ rowKind: 'probe', header: 'Bearer abcdefghijklmnop' }] });
    assert.deepEqual(problems, ['f.json: rows[0].header: looks like a bearer credential']);
  });

  it('rejects outcomeEvidence that says accepted', () => {
    const problems = validateRecordedFile('f.json', { _meta: meta, rows: [{ rowKind: 'probe', outcomeEvidence: 'work accepted' }] });
    assert.deepEqual(problems, ['f.json: rows[0].outcomeEvidence: outcomeEvidence must not claim acceptance']);
  });

  it('rejects duplicate ids, keys and attempt ids but allows the same value in different fields', () => {
    const rows = [
      { rowKind: 'non-probe', id: 1, key: 1, attemptId: 1 },
      { rowKind: 'non-probe', id: 1, key: 2, attemptId: 1 },
    ];
    const problems = validateRecordedFile('f.json', { _meta: meta, rows });
    assert.deepEqual(problems, ['f.json: rows[1]: duplicate id 1', 'f.json: rows[1]: duplicate attemptId 1']);
  });
});

describe('scanImports', () => {
  it('flags release sources that reference tests/recorded', () => {
    const dir = tree({
      'ui/src/a.ts': "import data from '../../tests/recorded/crew-0.12.0/x.json';",
      'ui/src/b.ts': 'export const ok = 1;',
      'ui/src/notes.md': 'tests/recorded is mentioned in prose',
      'backend/app.py': 'p = "tests.recorded"',
    });
    const found = scanImports([join(dir, 'ui/src'), join(dir, 'backend/app.py'), join(dir, 'missing')]);
    assert.deepEqual(
      found.map(({ file }) => file.slice(dir.length + 1)).sort(),
      ['backend/app.py', 'ui/src/a.ts'],
    );
    assert.ok(found.every(({ reason }) => reason === 'references tests/recorded from release code'));
  });

  it('is clean for sources without references', () => {
    assert.deepEqual(scanImports([tree({ 'a.ts': 'export {};' })]), []);
  });
});

describe('run', () => {
  /**
   * @param {string} dir
   * @param {string[]} runtimeDirs
   */
  function runLogged(dir, runtimeDirs = []) {
    /** @type {string[]} */
    const lines = [];
    const code = run({ dir, runtimeDirs, log: (line) => lines.push(line) });
    return { code, lines };
  }

  it('is clean when the recorded directory is absent or empty', () => {
    assert.deepEqual(runLogged(join(tmp, 'absent')), { code: 0, lines: ['check:recorded: 0 recorded file(s) ok'] });
    assert.equal(runLogged(tree({ 'README.md': 'x' })).code, 0);
  });

  it('passes a valid recorded file', () => {
    const dir = tree({ 'a.json': JSON.stringify({ _meta: meta, rows: [{ rowKind: 'non-probe', n: 1 }] }) });
    assert.deepEqual(runLogged(dir), { code: 0, lines: ['check:recorded: 1 recorded file(s) ok'] });
  });

  it('fails a file with an unsanitised non-probe value (deliberate violation)', () => {
    const dir = tree({ 'a.json': JSON.stringify({ _meta: meta, rows: [{ rowKind: 'non-probe', title: 'Quarterly plan' }] }) });
    assert.deepEqual(runLogged(dir), { code: 1, lines: ['check:recorded: a.json: rows[0].title: string is not in the sanitised grammar'] });
  });

  it('fails a file that is not valid JSON', () => {
    assert.deepEqual(runLogged(tree({ 'a.json': '{' })), { code: 1, lines: ['check:recorded: a.json: not valid JSON'] });
  });

  it('fails when release code references tests/recorded (deliberate violation)', () => {
    const dir = tree({ 'ui/src/a.ts': "import x from '../../tests/recorded/x.json';" });
    const { code, lines } = runLogged(join(tmp, 'absent'), [join(dir, 'ui/src')]);
    assert.equal(code, 1);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]?.endsWith('references tests/recorded from release code'));
  });

  it('passes on the committed repository', () => {
    /** @type {string[]} */
    const lines = [];
    assert.equal(run({ log: (line) => lines.push(line) }), 0, lines.join('\n'));
  });
});

describe('event-frame captures', () => {
  const frames = { sanitisation: 'frames: counts and enums only', hostVersion: '0.12.2', capture: 'event-frames' };
  const options = { knownVersions: ['0.12.0', '0.12.2'], eventTypes: ['chat_status', 'chat_done'] };
  /** @param {Record<string, unknown>[]} rows @param {Record<string, unknown>} [metaChange] */
  const check = (rows, metaChange = {}) => validateRecordedFile('f.json', { _meta: { ...frames, ...metaChange }, rows }, options);

  it('accepts repeated id, key and attemptId because frameSeq is the identity', () => {
    const rows = [
      { rowKind: 'non-probe', frameSeq: 0, receivedAtMs: 1731474000000, eventType: 'chat_status', id: 7, key: 1, attemptId: 1 },
      { rowKind: 'non-probe', frameSeq: 1, receivedAtMs: 1731474000000, eventType: 'chat_done', id: 7, key: 1, attemptId: 1 },
    ];
    assert.deepEqual(check(rows), []);
  });

  it('rejects a duplicate, missing, negative or fractional frameSeq (deliberate violation)', () => {
    const base = { rowKind: 'non-probe', eventType: 'chat_status', receivedAtMs: 1731474000000 };
    assert.deepEqual(check([{ ...base, frameSeq: 3 }, { ...base, frameSeq: 3 }]), ['f.json: rows[1]: duplicate frameSeq 3']);
    for (const extra of [{}, { frameSeq: -1 }, { frameSeq: 1.5 }]) {
      assert.deepEqual(check([{ ...base, ...extra }]), ['f.json: rows[0]: frameSeq must be a non-negative integer']);
    }
  });

  it('requires receivedAtMs as integer epoch milliseconds on every row, probe rows included (deliberate violation)', () => {
    const message = 'f.json: rows[0]: receivedAtMs must be a non-negative integer (epoch milliseconds)';
    for (const rowKind of ['non-probe', 'probe']) {
      for (const receivedAtMs of [undefined, -1, 1731474000000.5, true, '1731474000000']) {
        const problems = check([{ rowKind, frameSeq: 0, eventType: 'chat_status', receivedAtMs }]);
        assert.ok(problems.includes(message), `${rowKind} ${String(receivedAtMs)}: ${problems.join('; ')}`);
      }
    }
  });

  it('rejects an eventType outside the vocabulary, or missing', () => {
    assert.deepEqual(check([{ rowKind: 'non-probe', frameSeq: 0, receivedAtMs: 1731474000000, eventType: 'made_up' }]), ['f.json: rows[0]: eventType made_up is not in docs/compatibility/event-vocabulary.json']);
    assert.deepEqual(check([{ rowKind: 'non-probe', frameSeq: 0, receivedAtMs: 1731474000000 }]), ['f.json: rows[0]: eventType undefined is not in docs/compatibility/event-vocabulary.json']);
  });

  it('still applies the sanitised grammar to every other string, including a nested eventType', () => {
    const rows = [{ rowKind: 'non-probe', frameSeq: 0, receivedAtMs: 1731474000000, eventType: 'chat_status', title: 'Quarterly plan', nested: { eventType: 'chat_done' } }];
    assert.deepEqual(check(rows), ['f.json: rows[0].title: string is not in the sanitised grammar', 'f.json: rows[0].nested.eventType: string is not in the sanitised grammar']);
  });

  it('does not exempt eventType outside an event-frame file', () => {
    const rows = [{ rowKind: 'non-probe', eventType: 'chat_status', n: 1 }];
    assert.deepEqual(validateRecordedFile('f.json', { _meta: { sanitisation: 's', hostVersion: '0.12.0' }, rows }), ['f.json: rows[0].eventType: string is not in the sanitised grammar']);
  });

  it('rejects an unknown capture kind and a host version that is not known or not the directory version', () => {
    assert.deepEqual(check([], { capture: 'screenshots' }), ['f.json: _meta.capture must be event-frames when present']);
    assert.deepEqual(check([], { hostVersion: '0.13.0' }), ['f.json: _meta.hostVersion must be 0.12.0 or 0.12.2']);
    const mismatch = validateRecordedFile('f.json', { _meta: frames, rows: [] }, { ...options, expectedVersion: '0.12.0' });
    assert.deepEqual(mismatch, ['f.json: _meta.hostVersion must be 0.12.0']);
  });

  it('keeps the credential and acceptance rules for probe frame rows', () => {
    const rows = [{ rowKind: 'probe', frameSeq: 0, receivedAtMs: 1731474000000, eventType: 'chat_done', header: 'Bearer abcdefghijklmnop', outcomeEvidence: 'work accepted' }];
    assert.deepEqual(check(rows), ['f.json: rows[0].header: looks like a bearer credential', 'f.json: rows[0].outcomeEvidence: outcomeEvidence must not claim acceptance']);
  });
});

describe('contracts/cases in release code', () => {
  it('flags release sources but lets test files read the cases', () => {
    const dir = tree({
      'ui/src/a.ts': "import cases from '../../contracts/cases/ready/v1/cases.json';",
      'ui/src/contracts/contracts.test.ts': "const dir = '../../../contracts/cases/';",
      'ui/src/__tests__/b.ts': "const dir = 'contracts/cases';",
      'backend/specter_arena/c.py': 'p = "contracts/cases"',
      'backend/tests/test_contracts.py': 'p = "contracts" / "cases"',
      'backend/specter_arena/ok.py': 'p = "contracts/schemas"',
    });
    const found = scanImports([join(dir, 'ui/src'), join(dir, 'backend/specter_arena'), join(dir, 'backend/tests')]);
    assert.deepEqual(found.map(({ file }) => file.slice(dir.length + 1)).sort(), ['backend/specter_arena/c.py', 'ui/src/a.ts']);
    assert.ok(found.every(({ reason }) => reason === 'references contracts/cases from release code'));
  });

  it('still forbids tests/recorded in test files', () => {
    const dir = tree({ 'ui/src/a.test.ts': "import x from '../../tests/recorded/x.json';" });
    assert.equal(scanImports([join(dir, 'ui/src')]).length, 1);
  });
});

describe('run across host versions', () => {
  const frameFile = (/** @type {string} */ version, /** @type {string} */ type) => JSON.stringify({ _meta: { sanitisation: 's', hostVersion: version, capture: 'event-frames' }, rows: [{ rowKind: 'non-probe', frameSeq: 0, receivedAtMs: 1731474000000, eventType: type }] });

  /**
   * @param {Record<string, string>} files
   * @param {string[]} versions hosts that have a compatibility record
   */
  function runTree(files, versions = ['0.12.0', '0.12.2']) {
    const dir = tree({
      ...files,
      ...Object.fromEntries(versions.map((version) => [`compat/crew-${version}.md`, '# record'])),
      'compat/notes.md': 'not a record',
    });
    /** @type {string[]} */
    const lines = [];
    const code = run({ root: join(dir, 'recorded'), compatibilityDir: join(dir, 'compat'), eventTypesFile: join(dir, 'compat/event-vocabulary.json'), runtimeDirs: [], log: (line) => lines.push(line) });
    return { code, lines };
  }

  const vocabulary = JSON.stringify({ version: 1, eventTypes: ['chat_status'] });

  it('validates every crew-<version> directory against its own version, including nested uniqueness rules', () => {
    const result = runTree({ 'compat/event-vocabulary.json': vocabulary, 'recorded/crew-0.12.2/frames.json': frameFile('0.12.2', 'chat_status'), 'recorded/crew-0.12.0/a.json': JSON.stringify({ _meta: { sanitisation: 's', hostVersion: '0.12.0' }, rows: [] }) });
    assert.deepEqual(result, { code: 0, lines: ['check:recorded: 2 recorded file(s) ok'] });
  });

  it('fails a file whose hostVersion differs from its directory (deliberate violation)', () => {
    const result = runTree({ 'compat/event-vocabulary.json': vocabulary, 'recorded/crew-0.12.2/frames.json': frameFile('0.12.0', 'chat_status') });
    assert.deepEqual(result, { code: 1, lines: ['check:recorded: frames.json: _meta.hostVersion must be 0.12.2'] });
  });

  it('fails a directory for a host with no compatibility record', () => {
    const result = runTree({ 'compat/event-vocabulary.json': vocabulary, 'recorded/crew-0.13.0/frames.json': frameFile('0.13.0', 'chat_status') }, ['0.12.0']);
    assert.equal(result.code, 1);
    assert.match(result.lines[0] ?? '', /crew-0\.13\.0: no .*crew-0\.13\.0\.md record$/);
  });

  it('fails an event type that is not in the vocabulary file', () => {
    const result = runTree({ 'compat/event-vocabulary.json': vocabulary, 'recorded/crew-0.12.2/frames.json': frameFile('0.12.2', 'chat_done') });
    assert.equal(result.code, 1);
    assert.ok(result.lines[0]?.includes('eventType chat_done is not in'));
  });

  it('fails an empty or unparseable vocabulary file', () => {
    assert.ok(runTree({ 'compat/event-vocabulary.json': JSON.stringify({ version: 1, eventTypes: [] }) }).lines[0]?.endsWith('eventTypes must be a non-empty list'));
    assert.ok(runTree({ 'compat/event-vocabulary.json': '{' }).lines[0]?.endsWith('not valid JSON'));
  });

  it('ignores directories that are not crew-<version>', () => {
    assert.deepEqual(runTree({ 'recorded/scratch/x.json': '{', 'recorded/README.md': 'x' }), { code: 0, lines: ['check:recorded: 0 recorded file(s) ok'] });
  });
});
