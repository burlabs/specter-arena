import { useState } from 'react';
import { useMotionAllowed } from '../specters/useMotionAllowed';

export interface ArenaMotion {
  /** False when reduced motion is asked for, the page is hidden, or the user paused the animation. */
  animate: boolean;
  paused: boolean;
  togglePause: () => void;
}

/** View-local pause plus the shared motion gate. It changes presentation only and never reaches the backend. */
export function useArenaMotion(): ArenaMotion {
  const allowed = useMotionAllowed();
  const [paused, setPaused] = useState(false);
  return { animate: allowed && !paused, paused, togglePause: () => setPaused((value) => !value) };
}
