import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { CUE } from './copy';

export const MAX_CONCURRENT_CUE_GROUPS = 4;
export const MAX_DECORATIVE_PARTICLES = 24;

/** A celebration of an outcome the ledger already committed. It carries no reward value of its own. */
export interface PresentationCue {
  id: string;
  workId: string;
  title: string;
  committedXp: number | null;
  durationMs: number;
}

type TimerApi = { set: (callback: () => void, delayMs: number) => unknown; clear: (handle: unknown) => void };

const WINDOW_TIMERS: TimerApi = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (handle) => window.clearTimeout(handle as number),
};

/** One pending timer per cue id; scheduling an id again replaces its timer. */
export function createPresentationCueScheduler(timers: TimerApi = WINDOW_TIMERS) {
  const pending = new Map<string, unknown>();
  return {
    schedule(id: string, delayMs: number, callback: () => void) {
      const existing = pending.get(id);
      if (existing !== undefined) timers.clear(existing);
      pending.set(
        id,
        timers.set(() => {
          pending.delete(id);
          callback();
        }, delayMs),
      );
    },
    cancelAll() {
      for (const handle of pending.values()) timers.clear(handle);
      pending.clear();
    },
    pendingCount: () => pending.size,
  };
}

interface CardProps {
  cue: PresentationCue;
  particles: number;
  onComplete: (id: string) => void;
}

function CueCard({ cue, particles, onComplete }: CardProps) {
  const scheduler = useMemo(() => createPresentationCueScheduler(), []);
  useEffect(() => {
    scheduler.schedule(cue.id, cue.durationMs, () => onComplete(cue.id));
    return () => scheduler.cancelAll();
  }, [scheduler, cue.id, cue.durationMs, onComplete]);

  return (
    <div className="sa-cue" data-cue={cue.workId}>
      <span className="sa-cue__ring" />
      <span className="sa-cue__particles">
        {Array.from({ length: particles }, (_, index) => (
          <i key={index} style={{ '--sa-particle': index } as CSSProperties} />
        ))}
      </span>
      <span className="sa-cue__eyebrow">{CUE.eyebrow}</span>
      <strong>{CUE.title}</strong>
      <small>{cue.committedXp === null ? cue.title : `${cue.title} · +${cue.committedXp} XP`}</small>
    </div>
  );
}

/** Hidden from assistive technology: the same facts are in the list view and the live region. */
export function PresentationCueLayer({ cues, onComplete }: { cues: readonly PresentationCue[]; onComplete: (id: string) => void }) {
  const shown = cues.slice(0, MAX_CONCURRENT_CUE_GROUPS);
  const particles = shown.length === 0 ? 0 : Math.floor(MAX_DECORATIVE_PARTICLES / shown.length);
  return (
    <div className="sa-cue-layer" aria-hidden="true">
      {shown.map((cue) => (
        <CueCard key={cue.id} cue={cue} particles={Math.min(particles, 8)} onComplete={onComplete} />
      ))}
    </div>
  );
}
