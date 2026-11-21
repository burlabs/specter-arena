import { describe, expect, it } from 'vitest';
import { DataShapeError, attemptWords, formatBytes, observationWords, parseCollectorControl, parseDataLifecycle, previewTotal, quarantineWords, uploadWords } from './model';
import { dataBody, runOf } from './testData';

describe('parseDataLifecycle', () => {
  it('accepts the contract body and keeps it as is', () => {
    const body = dataBody();
    expect(parseDataLifecycle(body)).toBe(body);
  });

  it('accepts every retention window and a full body', () => {
    for (const days of [30, 90, 180, 365] as const) {
      expect(parseDataLifecycle(dataBody({ retention: { retentionDays: days, changedAtMs: 5, revision: 1 } })).retention.retentionDays).toBe(days);
    }
    const full = dataBody({ running: runOf({ state: 'running', endedMs: null }), lastPurge: runOf(), lastCleanup: runOf({ kind: 'asset-cleanup' }) });
    expect(parseDataLifecycle(full).running?.state).toBe('running');
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['a newer version', { ...dataBody(), contractVersion: 2 }],
    ['a window the store never offers', dataBody({ retention: { retentionDays: 7 as 30, changedAtMs: null, revision: 0 } })],
    ['a fractional count', dataBody({ uploads: { stored: 1.5, cap: 100, unused: 0 } })],
    ['a negative count', dataBody({ uploads: { stored: -1, cap: 100, unused: 0 } })],
    ['a missing preview field', { ...dataBody(), preview: { cutoffMs: 1, observations: 1, quarantine: 1 } }],
    ['an unknown run kind', dataBody({ lastPurge: runOf({ kind: 'vacuum' as 'purge' }) })],
    ['an unknown run state', dataBody({ lastPurge: runOf({ state: 'paused' as 'running' }) })],
    ['a run without counts', dataBody({ lastPurge: { ...runOf(), deleted: { observations: 1 } as never } })],
    ['an export with a path for a name', dataBody({ lastExport: { fileName: '../x.db', byteLength: 1, sha256: 'a'.repeat(64), createdMs: 1 } })],
    ['an export with a short hash', dataBody({ lastExport: { fileName: 'x.db', byteLength: 1, sha256: 'abc', createdMs: 1 } })],
    ['more than 20 exports', dataBody({ exports: Array.from({ length: 21 }, (_, index) => ({ fileName: `e${index}.db`, byteLength: 1, sha256: 'a'.repeat(64), createdMs: 1 })) })],
    ['a non-boolean paused', { ...dataBody(), paused: 'no' }],
    ['no uploads', { ...dataBody(), uploads: null }],
  ])('rejects %s', (_name, body) => {
    expect(() => parseDataLifecycle(body)).toThrow(DataShapeError);
  });
});

describe('parseCollectorControl', () => {
  const good = { contractVersion: 1, paused: true, revision: 3, changedAtMs: 10, state: 'paused' };
  it('accepts the contract body', () => expect(parseCollectorControl(good)).toBe(good));
  it.each([null, { ...good, contractVersion: 2 }, { ...good, paused: 'true' }, { ...good, revision: -1 }, { ...good, state: 1 }, { ...good, changedAtMs: 1.5 }])('rejects %j', (body) => {
    expect(() => parseCollectorControl(body)).toThrow(DataShapeError);
  });
});

describe('words', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [4_194_304, '4 MB'],
    [4_300_000, '4.1 MB'],
    [150 * 1024 * 1024, '150 MB'],
    [3 * 1024 ** 3, '3 GB'],
    [5000 * 1024 ** 4, '5000 TB'],
  ])('formats %i bytes as %s', (bytes, words) => expect(formatBytes(bytes)).toBe(words));

  it('counts with the right singular and groups thousands', () => {
    expect(observationWords(1)).toBe('1 observation');
    expect(observationWords(5200)).toBe('5,200 observations');
    expect(quarantineWords(1)).toBe('1 quarantined record');
    expect(attemptWords(2)).toBe('2 attempt records');
    expect(uploadWords(1)).toBe('1 uploaded image');
    expect(uploadWords(0)).toBe('0 uploaded images');
  });

  it('adds the three purge counts', () => expect(previewTotal({ observations: 1, quarantine: 2, attempts: 3 })).toBe(6));
});
