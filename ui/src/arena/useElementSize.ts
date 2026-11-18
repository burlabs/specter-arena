import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Size } from './geometry';

export const DEFAULT_VIEWPORT: Size = { width: 800, height: 450 };

/** The element's content box. jsdom has no ResizeObserver, so the default size stays. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(DEFAULT_VIEWPORT);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined && box.width > 0 && box.height > 0) {
        setSize((previous) => (previous.width === box.width && previous.height === box.height ? previous : { width: box.width, height: box.height }));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
