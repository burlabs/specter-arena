import { useCallback, useEffect, useState } from 'react';
import type { RecapV1 } from '../contracts/types';
import { recapPath, useHostApi } from '../host';
import { parseRecap } from './recapParse';
import { periodOf } from './recapPeriods';
import type { RecapKind } from './recapPeriods';
import { arenaFailureOf } from './useArenaWork';
import type { ArenaWorkFailure } from './useArenaWork';

export type RecapState =
  | { status: 'loading'; kind: RecapKind; recap: null; failure: null }
  | { status: 'ready'; kind: RecapKind; recap: RecapV1; failure: null }
  | { status: 'failed'; kind: RecapKind; recap: null; failure: ArenaWorkFailure };

/**
 * One GET of `recap.v1` for the period `kind` names in the browser's local zone, read when it mounts, when `kind` changes
 * and on `refresh`. It never polls, so a recap is a fixed record. Any failure fails the whole read: no partial recap plays.
 */
export function useRecap(kind: RecapKind): { state: RecapState; refresh: () => void } {
  const api = useHostApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RecapState>({ status: 'loading', kind, recap: null, failure: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', kind, recap: null, failure: null });
    const period = periodOf(kind, Date.now());
    api
      .getJson<unknown>(recapPath(period.fromMs, period.toMs))
      .then(parseRecap)
      .then(
        (recap) => !cancelled && setState({ status: 'ready', kind, recap, failure: null }),
        (error: unknown) => !cancelled && setState({ status: 'failed', kind, recap: null, failure: arenaFailureOf(error) }),
      );
    return () => {
      cancelled = true;
    };
  }, [api, kind, attempt]);

  const refresh = useCallback(() => setAttempt((count) => count + 1), []);
  return { state: state.kind === kind ? state : { status: 'loading', kind, recap: null, failure: null }, refresh };
}
