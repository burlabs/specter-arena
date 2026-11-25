import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_OFFERED, ONBOARDING_KEY, markOffered, parseOffered, readOffered } from './onboarding';

afterEach(() => vi.restoreAllMocks());

describe('parseOffered', () => {
  it('reads a versioned list of unique binding ids', () => {
    expect(parseOffered(JSON.stringify({ v: 1, offered: ['bnd_a', 'bnd_b', 'bnd_a'] }))).toEqual(['bnd_a', 'bnd_b']);
  });

  it('reads nothing from anything else', () => {
    for (const raw of [null, '', 'not json', '7', 'null', '{}', '{"v":2,"offered":["a"]}', '{"v":1}', '{"v":1,"offered":"a"}']) expect(parseOffered(raw), String(raw)).toEqual([]);
  });

  it('drops values that are not binding ids and stops at the cap', () => {
    expect(parseOffered(JSON.stringify({ v: 1, offered: ['ok', 7, 'has space', '', 'x'.repeat(65), 'fine_1'] }))).toEqual(['ok', 'fine_1']);
    const many = Array.from({ length: MAX_OFFERED + 20 }, (_, n) => `b${n}`);
    expect(parseOffered(JSON.stringify({ v: 1, offered: many }))).toHaveLength(MAX_OFFERED);
  });
});

describe('markOffered and readOffered', () => {
  it('stores ids only, under the versioned key, and reads them back', () => {
    expect(markOffered(['bnd_1', 'bnd_2'])).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(ONBOARDING_KEY) ?? '')).toEqual({ v: 1, offered: ['bnd_1', 'bnd_2'] });
    expect(readOffered()).toEqual(['bnd_1', 'bnd_2']);
  });

  it('adds to what is there without repeating an id', () => {
    markOffered(['bnd_1']);
    markOffered(['bnd_2', 'bnd_1']);
    expect(readOffered().sort()).toEqual(['bnd_1', 'bnd_2']);
  });

  it('keeps the newest ids when the cap is passed', () => {
    markOffered(Array.from({ length: MAX_OFFERED }, (_, n) => `old${n}`));
    markOffered(['new1', 'new2']);
    const kept = readOffered();
    expect(kept).toHaveLength(MAX_OFFERED);
    expect(kept.slice(-2)).toEqual(['new1', 'new2']);
    expect(kept).not.toContain('old0');
  });

  it('ignores a value that is not a binding id', () => {
    markOffered(['bnd 1', 'bnd_2']);
    expect(readOffered()).toEqual(['bnd_2']);
  });

  it('says false when the browser refuses the write, and reads nothing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(markOffered(['bnd_1'])).toBe(false);
    vi.restoreAllMocks();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(markOffered(['bnd_1'])).toBe(false);
    expect(readOffered()).toEqual([]);
  });

  it('reads nothing when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readOffered()).toEqual([]);
  });
});
