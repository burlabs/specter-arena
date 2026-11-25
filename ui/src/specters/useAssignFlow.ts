import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { markOffered, readOffered } from './onboarding';

export interface AssignFlow {
  /** Unassigned bindings that are on the roster, in roster order. */
  pending: readonly string[];
  /** Null while closed. A snapshot taken when the walkthrough opened, so steps do not reshuffle while assignments land. */
  queue: readonly string[] | null;
  /** Opens for every pending bot, starting at `first` when it is pending. Does nothing when no bot is pending. */
  open: (first?: string) => void;
  /** Records every shown bot as offered, then closes. */
  close: (shown: readonly string[]) => void;
}

interface Input {
  /** True once the roster is complete and the Specters have loaded. */
  ready: boolean;
  bots: readonly RosterItemV1[];
  unassigned: readonly string[];
}

/** Owns whether the assignment walkthrough is open. It opens itself at most once per page load, for bots this browser was never offered. */
export function useAssignFlow({ ready, bots, unassigned }: Input): AssignFlow {
  const [queue, setQueue] = useState<readonly string[] | null>(null);
  const tried = useRef(false);
  const pending = useMemo(() => {
    const wanted = new Set(unassigned);
    return bots.filter((bot) => wanted.has(bot.bindingId)).map((bot) => bot.bindingId);
  }, [bots, unassigned]);

  useEffect(() => {
    if (!ready || tried.current) return;
    tried.current = true;
    const offered = new Set(readOffered());
    const fresh = pending.filter((id) => !offered.has(id));
    if (fresh.length > 0) setQueue(fresh);
  }, [ready, pending]);

  const open = useCallback(
    (first?: string) => {
      if (pending.length === 0) return;
      const at = first === undefined ? -1 : pending.indexOf(first);
      setQueue(at > 0 ? [...pending.slice(at), ...pending.slice(0, at)] : pending);
    },
    [pending],
  );
  const close = useCallback((shown: readonly string[]) => {
    markOffered(shown);
    setQueue(null);
  }, []);
  return { pending, queue, open, close };
}
