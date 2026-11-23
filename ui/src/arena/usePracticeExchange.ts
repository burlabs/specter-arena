import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_SNAPSHOT, build, initialPlanner, snapshotOf } from './exchangePlanner';
import type { Exchange, ExchangeSnapshot } from './exchangePlanner';
import type { MinionType } from './AnimatedMinion';
import { combatTimingOf } from './heroCombat';

/** The ids the practice exchange uses for its hero and its target. They are local to the page and never sent anywhere. */
export const PRACTICE_HERO = 'practice-hero';
export const PRACTICE_TARGET = 'practice-target';

export interface PracticeExchange {
  snapshot: ExchangeSnapshot;
  /** True from the press until the whole exchange (strike, hit, strike back, flinch) has ended. */
  playing: boolean;
  play: (kind: 'attack' | 'cast') => void;
}

/**
 * One exchange on a practice target, for the Specters showcase: the same timeline (`build`) and the same snapshot (`snapshotOf`)
 * the arena draws, started by a button instead of a cadence. Presentation only: no task, no XP and no request. With `enabled`
 * false (reduced motion) nothing starts, and turning it off mid-way drops the exchange.
 */
export function usePracticeExchange(heroId: string | undefined, minionType: MinionType, enabled: boolean): PracticeExchange {
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [snapshot, setSnapshot] = useState<ExchangeSnapshot>(EMPTY_SNAPSHOT);
  const nextId = useRef(1);

  useEffect(() => {
    setExchange(null);
    setSnapshot(EMPTY_SNAPSHOT);
  }, [heroId, enabled]);

  useEffect(() => {
    if (exchange === null) return;
    const state = { ...initialPlanner(), active: [exchange] };
    let timer: number | undefined;
    const tick = () => {
      const now = Date.now();
      if (now >= exchange.endMs) {
        setSnapshot(EMPTY_SNAPSHOT);
        setExchange(null);
        return;
      }
      setSnapshot(snapshotOf(state, now));
      const marks = [exchange.impactMs, exchange.heroEndMs, exchange.hitEndMs, exchange.counterStartMs, exchange.counterImpactMs, exchange.counterEndMs, exchange.flinchEndMs, exchange.endMs];
      const next = Math.min(...marks.filter((mark) => mark > now));
      timer = window.setTimeout(tick, Math.max(0, next - Date.now()));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [exchange]);

  const play = useCallback(
    (kind: 'attack' | 'cast') => {
      if (!enabled || heroId === undefined || exchange !== null || combatTimingOf(heroId) === null) return;
      const id = nextId.current;
      nextId.current += 1;
      setExchange(build(id, kind, { key: `${PRACTICE_HERO}:${PRACTICE_TARGET}`, bindingId: PRACTICE_HERO, heroId, workId: PRACTICE_TARGET, minionType }, PRACTICE_TARGET, minionType, Date.now(), kind === 'cast'));
    },
    [enabled, heroId, exchange, minionType],
  );

  return { snapshot, playing: exchange !== null, play };
}
