import { useCallback, useEffect, useRef, useState } from 'react';

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type RecapSpeed = (typeof SPEEDS)[number];

export interface PlayerOptions {
  /** Play length of the recap. */
  totalMs: number;
  /** Play times the Previous and Next steps move between, ascending. */
  events: readonly number[];
  /** False for reduced motion or a hidden tab: the player never plays by itself and `play` does nothing. */
  allowed: boolean;
}

export interface RecapPlayer {
  playMs: number;
  playing: boolean;
  speed: RecapSpeed;
  /** The last stretch the playhead walked by itself, or null after any jump. Defeats are celebrated only inside it. */
  advance: { fromMs: number; toMs: number } | null;
  play: () => void;
  pause: () => void;
  restart: () => void;
  seek: (playMs: number) => void;
  step: (direction: 1 | -1) => void;
  setSpeed: (speed: RecapSpeed) => void;
}

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/**
 * The recap clock: one `requestAnimationFrame` loop that moves the playhead by the browser's own `performance.now()`
 * deltas times the speed. It starts paused, pauses itself at the end and when `allowed` turns false, and reports
 * `advance` only for steps it walked itself, so a seek, a restart, a step or a speed change plays no celebration.
 */
export function useRecapPlayer({ totalMs, events, allowed }: PlayerOptions): RecapPlayer {
  const [playMs, setPlayMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<RecapSpeed>(1);
  const [advance, setAdvance] = useState<RecapPlayer['advance']>(null);
  const position = useRef(0);
  const live = playing && allowed && totalMs > 0;

  const jump = useCallback(
    (to: number) => {
      position.current = clamp(to, totalMs);
      setPlayMs(position.current);
      setAdvance(null);
    },
    [totalMs],
  );

  useEffect(() => {
    if (!live) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const from = position.current;
      const to = clamp(from + (now - last) * speed, totalMs);
      last = now;
      position.current = to;
      setPlayMs(to);
      setAdvance({ fromMs: from, toMs: to });
      if (to >= totalMs) setPlaying(false);
      else frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [live, speed, totalMs]);

  useEffect(() => {
    if (!allowed) setPlaying(false);
  }, [allowed]);

  useEffect(() => {
    jump(0);
    setPlaying(false);
  }, [totalMs, jump]);

  const play = useCallback(() => {
    if (!allowed || totalMs === 0) return;
    if (position.current >= totalMs) jump(0);
    setAdvance(null);
    setPlaying(true);
  }, [allowed, totalMs, jump]);
  const pause = useCallback(() => {
    setPlaying(false);
    setAdvance(null);
  }, []);
  const restart = useCallback(() => {
    jump(0);
    setPlaying(false);
  }, [jump]);
  const step = useCallback(
    (direction: 1 | -1) => {
      const now = position.current;
      const next = direction === 1 ? events.find((time) => time > now + 1) : [...events].reverse().find((time) => time < now - 1);
      jump(next ?? (direction === 1 ? totalMs : 0));
      setPlaying(false);
    },
    [events, totalMs, jump],
  );
  const setSpeed = useCallback((next: RecapSpeed) => {
    setSpeedState(next);
    setAdvance(null);
  }, []);

  return { playMs, playing: live, speed, advance, play, pause, restart, seek: jump, step, setSpeed };
}
