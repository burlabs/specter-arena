import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POLL_MS } from '../observatory/usePolled';
import { nextCelebrations } from './celebrations';
import type { PresentationCue } from './PresentationCueLayer';
import type { SceneModel } from './sceneModel';

export const CUE_DURATION_MS = 1_800;

interface Seen {
  model: SceneModel;
  receivedAtMs: number;
}

export interface ArenaCelebrations {
  cues: readonly PresentationCue[];
  /** Work ids whose defeat animation is playing right now. */
  celebrating: ReadonlySet<string>;
  complete: (id: string) => void;
}

/**
 * Session memory only. Each new work poll is compared with the one before it; a defeat is celebrated once, and only
 * when the user watched it happen. First load, a hidden tab, a long gap and a scene-clock reset all re-baseline
 * silently, and with motion off a defeat shows its static label instead. Nothing here is stored or sent.
 */
export function useArenaScene(scene: SceneModel | null, receivedAtMs: number | null, animate: boolean): ArenaCelebrations {
  const previous = useRef<Seen | null>(null);
  const hiddenSincePrevious = useRef(false);
  const [cues, setCues] = useState<readonly PresentationCue[]>([]);

  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') hiddenSincePrevious.current = true;
    };
    onChange();
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  useEffect(() => {
    if (scene === null || receivedAtMs === null) return;
    const before = previous.current;
    previous.current = { model: scene, receivedAtMs };
    if (before === null || before.receivedAtMs === receivedAtMs) return;
    const visibleSincePrev = !hiddenSincePrevious.current;
    hiddenSincePrevious.current = false;
    const ids = nextCelebrations(before.model, scene, { visibleSincePrev, gapMs: receivedAtMs - before.receivedAtMs, pollMs: POLL_MS });
    if (!animate || ids.length === 0) return;
    const fresh = ids.flatMap((workId): PresentationCue[] => {
      const enemy = scene.enemies.find((candidate) => candidate.workId === workId);
      return enemy === undefined ? [] : [{ id: `${workId}@${receivedAtMs}`, workId, title: enemy.title, committedXp: enemy.committedXp, durationMs: CUE_DURATION_MS }];
    });
    setCues((current) => [...current, ...fresh]);
  }, [scene, receivedAtMs, animate]);

  useEffect(() => {
    if (!animate) setCues((current) => (current.length === 0 ? current : []));
  }, [animate]);

  const complete = useCallback((id: string) => setCues((current) => current.filter((cue) => cue.id !== id)), []);
  const celebrating = useMemo(() => new Set(cues.map((cue) => cue.workId)), [cues]);
  return { cues, celebrating, complete };
}
