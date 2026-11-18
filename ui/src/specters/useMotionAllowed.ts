import { useEffect, useState } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function allowed(): boolean {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;
  return !reduced && document.visibilityState !== 'hidden';
}

/** False while the user asks for reduced motion or the page is hidden. Effects read this and nothing else. */
export function useMotionAllowed(): boolean {
  const [motion, setMotion] = useState(allowed);
  useEffect(() => {
    const update = () => setMotion(allowed());
    const query = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED) : null;
    query?.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      query?.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return motion;
}
