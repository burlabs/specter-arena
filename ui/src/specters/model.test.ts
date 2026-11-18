import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUMMONING_STORAGE_KEY, isActive, lengthOf, newRequestId, parseResume, readResume, tokenHue, tokenInitials, writeResume } from './model';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('tokenHue', () => {
  it('is deterministic and inside 0 to 359', () => {
    expect(tokenHue('spc_aaaa')).toBe(tokenHue('spc_aaaa'));
    for (const id of ['', 'a', 'spc_0123', 'spc_ffff', '👻']) {
      const hue = tokenHue(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('separates different ids', () => {
    expect(tokenHue('spc_aaaa')).not.toBe(tokenHue('spc_aaab'));
  });
});

describe('tokenInitials', () => {
  it('uses one letter for one word and two for two or more', () => {
    expect(tokenInitials('vesper')).toBe('V');
    expect(tokenInitials('Lantern Wick')).toBe('LW');
    expect(tokenInitials('  one two three ')).toBe('OT');
  });

  it('does not split a surrogate pair', () => {
    expect(tokenInitials('👻 Boo')).toBe('👻B');
  });

  it('falls back to a question mark when there is nothing to show', () => {
    expect(tokenInitials('')).toBe('?');
    expect(tokenInitials('   ')).toBe('?');
  });
});

describe('request ids and statuses', () => {
  it('mints req_ plus 24 hex characters from crypto', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint8Array).fill(171);
      return array;
    });
    expect(newRequestId()).toBe(`req_${'ab'.repeat(12)}`);
    expect(newRequestId()).toMatch(/^req_[0-9a-f]{24}$/);
  });

  it('treats only queued and running as active, so an unknown token ends polling', () => {
    expect(isActive('queued')).toBe(true);
    expect(isActive('running')).toBe(true);
    for (const status of ['ready', 'failed', 'cancelled', 'accepted', 'superseded', 'mystery']) expect(isActive(status)).toBe(false);
  });

  it('counts code points', () => {
    expect(lengthOf('a👻')).toBe(2);
  });
});

const REQ = `req_${'0'.repeat(24)}`;

describe('resume storage', () => {
  it('rejects every malformed shape', () => {
    for (const raw of [null, 'not json', '7', 'null', '{}', '{"v":2,"ids":{}}', '{"v":1,"ids":[]}', '{"v":1,"ids":null}']) {
      expect(parseResume(raw)).toEqual({});
    }
  });

  it('keeps only valid binding and request ids and caps the entries', () => {
    const ids: Record<string, unknown> = { good: REQ, 'bad id': REQ, short: 'req_1', num: 4 };
    for (let index = 0; index < 60; index += 1) ids[`b${index}`] = REQ;
    const parsed = parseResume(JSON.stringify({ v: 1, ids }));
    expect(parsed.good).toBe(REQ);
    expect(parsed['bad id']).toBeUndefined();
    expect(parsed.short).toBeUndefined();
    expect(parsed.num).toBeUndefined();
    expect(Object.keys(parsed)).toHaveLength(50);
  });

  it('writes, reads and removes one id per binding', () => {
    writeResume('bnd_1', REQ);
    writeResume('bnd_2', REQ);
    expect(readResume('bnd_1')).toBe(REQ);
    writeResume('bnd_1', null);
    expect(readResume('bnd_1')).toBeNull();
    expect(readResume('bnd_2')).toBe(REQ);
  });

  it('never throws when sessionStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readResume('bnd_1')).toBeNull();
    expect(() => writeResume('bnd_1', REQ)).not.toThrow();
  });

  it('is disabled when the storage object itself is unavailable', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readResume('bnd_1')).toBeNull();
    expect(() => writeResume('bnd_1', REQ)).not.toThrow();
    expect(window.localStorage.getItem(SUMMONING_STORAGE_KEY)).toBeNull();
  });
});
