import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_WATCHED, WATCHED_KEY, parseWatched, pruneWatched, readWatched, useWatched, writeWatched } from './watched';

afterEach(() => vi.restoreAllMocks());

const stored = (ids: unknown, v: unknown = 1) => JSON.stringify({ v, ids });

describe('parseWatched', () => {
  it('returns an empty list for null, bad JSON, non-objects and a wrong version', () => {
    expect(parseWatched(null)).toEqual([]);
    expect(parseWatched('{nope')).toEqual([]);
    expect(parseWatched('7')).toEqual([]);
    expect(parseWatched('null')).toEqual([]);
    expect(parseWatched(stored(['a'], 2))).toEqual([]);
    expect(parseWatched(stored('a'))).toEqual([]);
  });

  it('keeps only valid, distinct ids', () => {
    expect(parseWatched(stored(['a', 'a', 7, 'bad id', '', 'b_-1', 'x'.repeat(65)]))).toEqual(['a', 'b_-1']);
  });

  it('caps the list at 500', () => {
    const ids = Array.from({ length: 600 }, (_, index) => `id${index}`);
    expect(parseWatched(stored(ids))).toHaveLength(MAX_WATCHED);
  });
});

describe('storage helpers', () => {
  it('round-trips through localStorage under one key', () => {
    expect(writeWatched(['a', 'b'])).toBe(true);
    expect(readWatched()).toEqual(['a', 'b']);
    expect(Object.keys(window.localStorage)).toEqual([WATCHED_KEY]);
  });

  it('reports a refused write and survives a throwing read', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(writeWatched(['a'])).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readWatched()).toEqual([]);
  });

  it('reports no storage when the property getter throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(writeWatched(['a'])).toBe(false);
    expect(readWatched()).toEqual([]);
  });

  it('prunes ids that left the roster', () => {
    expect([...pruneWatched(new Set(['a', 'b']), new Set(['b', 'c']))]).toEqual(['b']);
  });
});

describe('useWatched', () => {
  it('toggles, clears and persists', () => {
    const { result } = renderHook(() => useWatched(null));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('b'));
    act(() => result.current.toggle('a'));
    expect([...result.current.watched]).toEqual(['b']);
    expect(readWatched()).toEqual(['b']);
    act(() => result.current.clear());
    expect(result.current.watched.size).toBe(0);
  });

  it('starts from the stored set', () => {
    writeWatched(['a']);
    const { result } = renderHook(() => useWatched(null));
    expect([...result.current.watched]).toEqual(['a']);
  });

  it('prunes only after a complete load', () => {
    writeWatched(['a', 'gone']);
    const ids = new Set(['a']);
    const { result, rerender } = renderHook((roster: { ids: ReadonlySet<string>; complete: boolean } | null) => useWatched(roster), {
      initialProps: { ids, complete: false } as { ids: ReadonlySet<string>; complete: boolean } | null,
    });
    expect([...result.current.watched]).toEqual(['a', 'gone']);
    rerender({ ids, complete: true });
    expect([...result.current.watched]).toEqual(['a']);
    expect(readWatched()).toEqual(['a']);
    rerender({ ids: new Set(['a']), complete: true });
    expect([...result.current.watched]).toEqual(['a']);
  });

  it('warns when the write is refused but keeps the in-memory set', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useWatched(null));
    act(() => result.current.toggle('a'));
    expect(result.current.persistFailed).toBe(true);
    expect([...result.current.watched]).toEqual(['a']);
  });

  it('refuses a 501st id', () => {
    writeWatched(Array.from({ length: MAX_WATCHED }, (_, index) => `id${index}`));
    const { result } = renderHook(() => useWatched(null));
    expect(result.current.full).toBe(true);
    act(() => result.current.toggle('extra'));
    expect(result.current.watched.has('extra')).toBe(false);
    act(() => result.current.toggle('id0'));
    expect(result.current.watched.has('id0')).toBe(false);
  });

  it('follows a storage event from another tab', () => {
    const { result } = renderHook(() => useWatched(null));
    writeWatched(['other']);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: WATCHED_KEY }));
    });
    expect([...result.current.watched]).toEqual(['other']);
    writeWatched(['again']);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    });
    expect([...result.current.watched]).toEqual(['other']);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect([...result.current.watched]).toEqual(['again']);
  });
});
