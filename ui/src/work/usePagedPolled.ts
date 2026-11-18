import { useCallback, useState } from 'react';
import { usePolled } from '../observatory/usePolled';

interface Older<Item> {
  key: string;
  items: Item[];
  cursor: string | null | undefined;
  busy: boolean;
  failed: boolean;
}

const emptyOlder = <Item,>(key: string): Older<Item> => ({ key, items: [], cursor: undefined, busy: false, failed: false });

export interface Paged<Item, Page> {
  firstPage: Page | null;
  items: Item[];
  hasOlder: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  error: unknown;
  loading: boolean;
  refresh: () => void;
  loadOlder: () => void;
}

interface Options<Item, Page extends { items: Item[]; nextCursor: string | null }> {
  /** null means inactive: nothing is fetched. A new key drops every older page. */
  key: string | null;
  fetchPage: (cursor: string | null) => Promise<Page>;
  idOf: (item: Item) => string;
  order: (a: Item, b: Item) => number;
}

/** The first page is polled; older pages are fetched on demand and merged by id, the polled copy winning a duplicate. */
export function usePagedPolled<Item, Page extends { items: Item[]; nextCursor: string | null }>(options: Options<Item, Page>): Paged<Item, Page> {
  const { key, fetchPage, idOf, order } = options;
  const polled = usePolled(key === null ? null : () => fetchPage(null), key ?? '');
  const [older, setOlder] = useState<Older<Item>>(emptyOlder(''));
  const mine = key !== null && older.key === key ? older : emptyOlder<Item>(key ?? '');
  const firstCursor = polled.data?.nextCursor ?? null;
  const cursor = mine.cursor === undefined ? firstCursor : mine.cursor;

  const loadOlder = useCallback(() => {
    if (key === null || cursor === null || mine.busy) return;
    setOlder({ ...mine, key, busy: true, failed: false });
    fetchPage(cursor).then(
      (page) =>
        setOlder((prev) => ({ key, items: [...(prev.key === key ? prev.items : []), ...page.items], cursor: page.nextCursor, busy: false, failed: false })),
      () => setOlder((prev) => ({ ...(prev.key === key ? prev : emptyOlder<Item>(key)), busy: false, failed: true })),
    );
  }, [key, cursor, mine, fetchPage]);

  const seen = new Set<string>();
  const items: Item[] = [];
  for (const item of [...(polled.data?.items ?? []), ...mine.items]) {
    const id = idOf(item);
    if (!seen.has(id)) {
      seen.add(id);
      items.push(item);
    }
  }
  items.sort(order);
  return {
    firstPage: polled.data,
    items,
    hasOlder: cursor !== null && polled.data !== null,
    loadingOlder: mine.busy,
    olderFailed: mine.failed,
    error: polled.error,
    loading: polled.loading,
    refresh: polled.refresh,
    loadOlder,
  };
}
