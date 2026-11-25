import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../observatory/usePolled';
import { usePagedPolled } from './usePagedPolled';

interface Row {
  id: string;
  n: number;
}
interface Page {
  items: Row[];
  nextCursor: string | null;
}

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const row = (id: string, n = 0): Row => ({ id, n });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(fetchPage: (cursor: string | null) => Promise<Page>, key: string | null = 'k') {
  return renderHook(({ k }) => usePagedPolled<Row, Page>({ key: k, fetchPage, idOf: (item) => item.id, order: (a, b) => a.id.localeCompare(b.id) }), { initialProps: { k: key } });
}

describe('usePagedPolled (H-1)', () => {
  it('polls the first page each interval and merges older pages by id, the polled copy winning', async () => {
    const fetchPage = vi.fn(async (cursor: string | null): Promise<Page> =>
      cursor === null ? { items: [row('b', 2), row('a', 2)], nextCursor: 'c1' } : { items: [row('a', 1), row('c', 1)], nextCursor: null },
    );
    const { result } = setup(fetchPage);
    await flush();
    expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.current.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.items.map((item) => [item.id, item.n])).toEqual([['a', 2], ['b', 2], ['c', 1]]);
    expect(result.current.hasOlder).toBe(false);
    const calls = fetchPage.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(fetchPage.mock.calls.length).toBeGreaterThan(calls);
  });

  it('ignores loadOlder while busy or without a cursor', async () => {
    let release: (page: Page) => void = () => undefined;
    const fetchPage = vi.fn((cursor: string | null) =>
      cursor === null ? Promise.resolve({ items: [row('a')], nextCursor: 'c1' }) : new Promise<Page>((resolve) => (release = resolve)),
    );
    const { result } = setup(fetchPage);
    await flush();
    act(() => result.current.loadOlder());
    act(() => result.current.loadOlder());
    expect(fetchPage.mock.calls.filter(([cursor]) => cursor === 'c1')).toHaveLength(1);
    expect(result.current.loadingOlder).toBe(true);
    await act(async () => release({ items: [row('b')], nextCursor: null }));
    act(() => result.current.loadOlder());
    expect(fetchPage.mock.calls.filter(([cursor]) => cursor === 'c1')).toHaveLength(1);
  });

  it('reports an older failure and lets the caller try again', async () => {
    let fail = true;
    const fetchPage = vi.fn(async (cursor: string | null): Promise<Page> => {
      if (cursor === null) return { items: [row('a')], nextCursor: 'c1' };
      if (fail) throw new Error('boom');
      return { items: [row('b')], nextCursor: null };
    });
    const { result } = setup(fetchPage);
    await flush();
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.olderFailed).toBe(true);
    expect(result.current.hasOlder).toBe(true);
    fail = false;
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.olderFailed).toBe(false);
    expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('drops older pages when the key changes and fetches nothing for a null key', async () => {
    const fetchPage = vi.fn(async (cursor: string | null): Promise<Page> => (cursor === null ? { items: [row('a')], nextCursor: 'c1' } : { items: [row('z')], nextCursor: null }));
    const { result, rerender } = setup(fetchPage);
    await flush();
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.items).toHaveLength(2);
    rerender({ k: 'other' });
    await flush();
    expect(result.current.items.map((item) => item.id)).toEqual(['a']);
    fetchPage.mockClear();
    rerender({ k: null });
    await flush();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current.firstPage).toBeNull();
    act(() => result.current.loadOlder());
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('surfaces a first-page error', async () => {
    const { result } = setup(async () => {
      throw new Error('down');
    });
    await flush();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.firstPage).toBeNull();
    expect(result.current.items).toEqual([]);
  });
});
