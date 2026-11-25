import { describe, expect, it } from 'vitest';
import { lengthOf, tokenHue, tokenInitials } from './model';

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

describe('lengthOf', () => {
  it('counts code points', () => {
    expect(lengthOf('a👻')).toBe(2);
  });
});
