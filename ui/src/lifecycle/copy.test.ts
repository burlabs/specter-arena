import { describe, expect, it } from 'vitest';
import { DATA_MODE, EXPORT, PURGE, RETENTION, errorWords, runWords } from './copy';
import { runOf } from './testData';

describe('runWords', () => {
  it('says what a finished purge deleted', () => {
    expect(runWords(runOf(), 'T')).toBe('Last purge finished T: deleted 5,200 observations, 12 quarantined records and 410 attempt records.');
  });

  it('says what a finished cleanup removed', () => {
    expect(runWords(runOf({ kind: 'asset-cleanup', deleted: { observations: 0, quarantine: 0, attempts: 0, assets: 1 } }), 'T')).toBe('Last upload cleanup finished T: removed 1 uploaded image.');
  });

  it('keeps what an interrupted run deleted and says to run it again', () => {
    expect(runWords(runOf({ state: 'interrupted' }), 'T')).toContain('What it deleted stays deleted. Run it again to finish.');
  });

  it('names a failed run and points at the counts for a purge only', () => {
    expect(runWords(runOf({ state: 'failed' }), 'T')).toBe('The last purge failed (T). Check the counts below before you try again.');
    expect(runWords(runOf({ kind: 'asset-cleanup', state: 'failed' }), 'T')).toBe('The last upload cleanup failed (T). Try again.');
  });

  it('says a running run is running', () => {
    expect(runWords(runOf({ state: 'running', endedMs: null }), 'T')).toBe('A purge is running (started T). Wait for it to finish.');
  });
});

describe('fixed words', () => {
  it('never says no activity about a purged span', () => {
    expect(PURGE.horizon('Nov 1')).toBe('History before Nov 1 was purged. Coverage for that time is unknown.');
    expect(PURGE.horizon('Nov 1')).not.toMatch(/no activity|zero/i);
  });

  it('states the promise, the backup and the file size in the History words', () => {
    expect(RETENTION.kept).toContain('XP');
    expect(RETENTION.backup).toContain('data/store/backups/');
    expect(RETENTION.noShrink).toContain('does not shrink');
  });

  it('says where an export went', () => {
    expect(EXPORT.saved('export-v9-x.db')).toBe('Saved to data/exports/export-v9-x.db in the app folder.');
  });

  it('labels all three source modes', () => {
    expect(Object.keys(DATA_MODE).sort()).toEqual(['FIXTURE', 'LIVE', 'RECORDED']);
    expect(DATA_MODE.FIXTURE).toMatch(/^FIXTURE/);
  });

  it.each(['invalid_body', 'lifecycle_busy', 'retention_not_set', 'retention_mismatch', 'backup_failed', 'export_failed', 'store_unavailable', 'collector_unavailable', 'offline', 'unexpected'])(
    'has words for %s',
    (code) => expect(errorWords(code)).not.toContain('The request failed'),
  );

  it('falls back to the code for one it does not know, and says nothing was changed', () => {
    expect(errorWords('http_418')).toBe('The request failed (http_418). Nothing was changed.');
  });
});
