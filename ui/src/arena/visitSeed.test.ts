import { describe, expect, it, vi } from 'vitest';
import { newVisitSeed } from './visitSeed';

describe('newVisitSeed', () => {
  it('reads one 32-bit value from the random source', () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 0xdeadbeef;
      return array;
    });
    expect(newVisitSeed({ getRandomValues } as Pick<Crypto, 'getRandomValues'>)).toBe(0xdeadbeef);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('falls back to the clock when there is no random source', () => {
    expect(newVisitSeed(null, () => 1_794_916_800_123)).toBe(1_794_916_800_123 >>> 0);
  });

  it('falls back to the clock when the source returns nothing', () => {
    const empty = { getRandomValues: () => new Uint32Array(0) } as unknown as Pick<Crypto, 'getRandomValues'>;
    expect(newVisitSeed(empty, () => 77)).toBe(77);
  });

  it('gives an unsigned 32-bit integer by default', () => {
    const seed = newVisitSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
