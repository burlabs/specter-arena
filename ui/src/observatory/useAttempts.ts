import { useCallback, useMemo, useState } from 'react';
import type { AttemptItemV1, AttemptsV1 } from '../contracts/types';
import { HostApiError, attemptsPath, useHostApi } from '../host';
import { mergeAttempts } from './model';
import { failureOf } from './useRoster';
import type { FailureKind } from './useRoster';
import { usePolled } from './usePolled';

const PAGE_LIMIT = 50;

export type AttemptsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'gone' }
  | { status: 'failed'; failure: FailureKind }
  | {
      status: 'ready';
      data: AttemptsV1;
      items: AttemptItemV1[];
      hasOlder: boolean;
      loadingOlder: boolean;
      olderFailed: boolean;
      failure: FailureKind | null;
    };

interface Older {
  id: string;
  items: AttemptItemV1[];
  cursor: string | null | undefined;
  busy: boolean;
  failed: boolean;
}

const emptyOlder = (id: string): Older => ({ id, items: [], cursor: undefined, busy: false, failed: false });

const isGone = (error: unknown): boolean => error instanceof HostApiError && error.status === 404;

/** The first page is polled; older pages are fetched on demand and merged by attemptId. */
export function useAttempts(bindingId: string | null): { state: AttemptsState; loadOlder: () => void; refresh: () => void } {
  const api = useHostApi();
  const load = useMemo(
    () => (bindingId === null ? null : () => api.getJson<AttemptsV1>(attemptsPath(bindingId, PAGE_LIMIT))),
    [api, bindingId],
  );
  const polled = usePolled(load, bindingId ?? '');
  const [older, setOlder] = useState<Older>(emptyOlder(''));
  const mine = older.id === bindingId ? older : emptyOlder(bindingId ?? '');
  const firstCursor = polled.data?.nextCursor ?? null;
  const cursor = mine.cursor === undefined ? firstCursor : mine.cursor;

  const loadOlder = useCallback(() => {
    if (bindingId === null || cursor === null || mine.busy) return;
    setOlder({ ...mine, id: bindingId, busy: true, failed: false });
    api.getJson<AttemptsV1>(attemptsPath(bindingId, PAGE_LIMIT, cursor)).then(
      (page) =>
        setOlder((prev) => ({
          id: bindingId,
          items: mergeAttempts(prev.id === bindingId ? prev.items : [], page.items),
          cursor: page.nextCursor,
          busy: false,
          failed: false,
        })),
      () => setOlder((prev) => ({ ...(prev.id === bindingId ? prev : emptyOlder(bindingId)), busy: false, failed: true })),
    );
  }, [api, bindingId, cursor, mine]);

  let state: AttemptsState;
  if (bindingId === null) state = { status: 'idle' };
  else if (isGone(polled.error)) state = { status: 'gone' };
  else if (polled.data !== null) {
    state = {
      status: 'ready',
      data: polled.data,
      items: mergeAttempts(polled.data.items, mine.items),
      hasOlder: cursor !== null,
      loadingOlder: mine.busy,
      olderFailed: mine.failed,
      failure: polled.error === null ? null : failureOf(polled.error),
    };
  } else if (polled.error !== null) state = { status: 'failed', failure: failureOf(polled.error) };
  else state = { status: 'loading' };
  return { state, loadOlder, refresh: polled.refresh };
}
