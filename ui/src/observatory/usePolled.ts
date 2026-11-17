import { useCallback, useEffect, useRef, useState } from 'react';

export const POLL_MS = 15_000;

interface Slot<T> {
  key: string;
  data: T | null;
  error: unknown;
  loading: boolean;
}

export interface Polled<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

/**
 * Runs `load` now, every POLL_MS while the page is visible, on becoming visible, and on refresh().
 * A response that is not from the newest request, or is for an earlier `key`, is dropped.
 */
export function usePolled<T>(load: (() => Promise<T>) | null, key: string): Polled<T> {
  const [slot, setSlot] = useState<Slot<T>>({ key, data: null, error: null, loading: load !== null });
  const loadRef = useRef(load);
  loadRef.current = load;
  const newest = useRef(0);

  const run = useCallback(() => {
    const fn = loadRef.current;
    if (fn === null) return;
    const id = ++newest.current;
    fn().then(
      (data) => {
        if (id === newest.current) setSlot({ key, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (id === newest.current) setSlot((prev) => ({ key, data: prev.key === key ? prev.data : null, error, loading: false }));
      },
    );
  }, [key]);

  const active = load !== null;
  useEffect(() => {
    if (!active) return;
    setSlot((prev) => (prev.key === key ? prev : { key, data: null, error: null, loading: true }));
    run();
    const tick = () => {
      if (document.visibilityState === 'visible') run();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      newest.current += 1;
    };
  }, [active, key, run]);

  const current: Slot<T> = slot.key === key ? slot : { key, data: null, error: null, loading: active };
  return { data: current.data, error: current.error, loading: current.loading, refresh: run };
}
