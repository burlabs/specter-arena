// SPECTER-DIAGNOSTIC-ONLY
import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_ORDER,
  MAX_EXCERPT_CHARS,
  countByDisplayState,
  countHostFacts,
  describeSnapshotChange,
  displayState,
  distinctCredentials,
  truncate,
} from './labels';
import { makeCell, makeEvidence, makeHostFact, makeProvenance, makeSnapshot } from './testData';

describe('displayState', () => {
  const scopes = ['app-owned', 'user-owned', 'other-app', 'bot', 'external-cli'] as const;

  it.each(scopes)('flags ALLOWED without APP-TOKEN evidence in scope %s', (scope) => {
    expect(displayState(makeCell({ scope, state: 'ALLOWED', evidence: [] }))).toBe('INVALID-EVIDENCE');
    expect(displayState(makeCell({ scope, state: 'ALLOWED', evidence: [makeEvidence({ credential: 'OWNER-SESSION' })] }))).toBe(
      'INVALID-EVIDENCE',
    );
  });

  it('keeps ALLOWED when one APP-TOKEN evidence item exists', () => {
    const evidence = [makeEvidence({ credential: 'OWNER-SESSION' }), makeEvidence({ credential: 'APP-TOKEN' })];
    expect(displayState(makeCell({ state: 'ALLOWED', evidence }))).toBe('ALLOWED');
  });

  it.each(['DENIED', 'UNSUPPORTED', 'UNTESTED'] as const)('passes %s through unchanged', (state) => {
    expect(displayState(makeCell({ state }))).toBe(state);
  });
});

describe('counts', () => {
  it('countByDisplayState returns all five keys including zeros', () => {
    const counts = countByDisplayState([makeCell({ state: 'DENIED' }), makeCell({ state: 'ALLOWED' })]);
    expect(counts).toEqual({ ALLOWED: 0, DENIED: 1, UNSUPPORTED: 0, UNTESTED: 0, 'INVALID-EVIDENCE': 1 });
  });

  it('countHostFacts returns all three keys including zeros', () => {
    expect(countHostFacts([makeHostFact({ status: 'OBSERVED' })])).toEqual({ OBSERVED: 1, 'NOT-OBSERVED': 0, UNTESTED: 0 });
  });
});

describe('distinctCredentials', () => {
  it('orders APP-TOKEN first and removes duplicates', () => {
    const evidence = ['OWNER-SESSION', 'APP-TOKEN', 'OWNER-SESSION'].map((credential) =>
      makeEvidence({ credential: credential as 'APP-TOKEN' | 'OWNER-SESSION' }),
    );
    expect(distinctCredentials({ evidence })).toEqual(['APP-TOKEN', 'OWNER-SESSION']);
  });

  it('knows both credential values', () => {
    expect([...CREDENTIAL_ORDER].sort()).toEqual(['APP-TOKEN', 'OWNER-SESSION']);
  });
});

describe('truncate', () => {
  it('leaves text at exactly the limit alone', () => {
    const text = 'a'.repeat(MAX_EXCERPT_CHARS);
    expect(truncate(text)).toEqual({ text, truncated: false, total: MAX_EXCERPT_CHARS });
  });

  it('cuts text one over the limit', () => {
    const result = truncate('a'.repeat(MAX_EXCERPT_CHARS + 1));
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_EXCERPT_CHARS);
    expect(result.total).toBe(MAX_EXCERPT_CHARS + 1);
  });
});

describe('describeSnapshotChange', () => {
  const allowed = makeEvidence();
  const base = makeSnapshot({
    cells: [makeCell({ key: 'a' }), makeCell({ key: 'b' })],
    hostFacts: [makeHostFact({ id: 'f1' })],
  });

  it('is empty when either side is null', () => {
    expect(describeSnapshotChange(null, base)).toBe('');
    expect(describeSnapshotChange(base, null)).toBe('');
  });

  it('is empty when nothing changed', () => {
    expect(describeSnapshotChange(base, structuredClone(base))).toBe('');
  });

  it('names a replaced run', () => {
    const next = makeSnapshot({ provenance: makeProvenance({ runId: 'run-2' }) });
    expect(describeSnapshotChange(base, next)).toBe('Snapshot replaced by run run-2');
  });

  it('counts one and two changed cells', () => {
    const one = makeSnapshot({ cells: [makeCell({ key: 'a', state: 'DENIED' }), makeCell({ key: 'b' })], hostFacts: base.hostFacts });
    const two = makeSnapshot({
      cells: [makeCell({ key: 'a', state: 'DENIED' }), makeCell({ key: 'b', state: 'ALLOWED', evidence: [allowed] })],
      hostFacts: base.hostFacts,
    });
    expect(describeSnapshotChange(base, one)).toBe('1 capability cell changed state');
    expect(describeSnapshotChange(base, two)).toBe('2 capability cells changed state');
  });

  it('counts a cell that only appears in the next snapshot as changed', () => {
    const next = makeSnapshot({ cells: [...base.cells, makeCell({ key: 'c' })], hostFacts: base.hostFacts });
    expect(describeSnapshotChange(base, next)).toBe('1 capability cell changed state');
  });

  it('counts host fact status changes and joins both messages', () => {
    const next = makeSnapshot({
      cells: [makeCell({ key: 'a', state: 'DENIED' }), makeCell({ key: 'b' })],
      hostFacts: [makeHostFact({ id: 'f1', status: 'OBSERVED' })],
    });
    expect(describeSnapshotChange(base, next)).toBe('1 capability cell changed state; 1 host fact changed status');
    const two = makeSnapshot({
      cells: base.cells,
      hostFacts: [makeHostFact({ id: 'f1', status: 'OBSERVED' }), makeHostFact({ id: 'f2' })],
    });
    expect(describeSnapshotChange(base, two)).toBe('2 host facts changed status');
  });
});
