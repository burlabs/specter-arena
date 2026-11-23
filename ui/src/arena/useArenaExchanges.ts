import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_SNAPSHOT, advance, initialPlanner, plannerInputOf, requestCast, signatureOf, snapshotOf } from './exchangePlanner';
import type { ExchangeSnapshot, PlannerState } from './exchangePlanner';
import type { SceneModel } from './sceneModel';
import type { MilestoneRise } from './useArenaScene';

/**
 * Drives the hero attacks and minion recoils of one mounted scene with a single timer that always points at the next
 * moment something changes. `enabled` is false for reduced motion, a hidden tab, the user's pause, and a paused
 * collector: the timer is cleared and the planner is forgotten, so the next start is fresh and nothing catches up.
 * Nothing here reads or writes anything outside the page.
 */
export function useArenaExchanges(model: SceneModel | null, enabled: boolean, rises: readonly MilestoneRise[]): ExchangeSnapshot {
  const planner = useRef<PlannerState>(initialPlanner());
  const handled = useRef<ReadonlySet<string>>(new Set());
  const signature = useRef('|||');
  const [snapshot, setSnapshot] = useState<ExchangeSnapshot>(EMPTY_SNAPSHOT);
  const input = useMemo(() => (model === null ? null : plannerInputOf(model)), [model]);

  useEffect(() => {
    if (!enabled || input === null) {
      planner.current = initialPlanner();
      handled.current = new Set();
      signature.current = '|||';
      setSnapshot((current) => (current === EMPTY_SNAPSHOT ? current : EMPTY_SNAPSHOT));
      return;
    }
    let timer: number | undefined;
    const tick = () => {
      const now = Date.now();
      const result = advance(planner.current, input, now);
      planner.current = result.state;
      const next = snapshotOf(result.state, now);
      const nextSignature = signatureOf(next);
      if (nextSignature !== signature.current) {
        signature.current = nextSignature;
        setSnapshot(next);
      }
      timer = result.nextWakeMs === null ? undefined : window.setTimeout(tick, Math.max(0, result.nextWakeMs - Date.now()));
    };
    const fresh = rises.filter((rise) => !handled.current.has(rise.id));
    if (fresh.length > 0) {
      for (const rise of fresh) planner.current = requestCast(planner.current, input, rise.workId, Date.now());
    }
    handled.current = new Set(rises.map((rise) => rise.id));
    tick();
    return () => window.clearTimeout(timer);
  }, [enabled, input, rises]);

  return snapshot;
}
