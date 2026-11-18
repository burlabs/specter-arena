import { useLayoutEffect } from 'react';
import css from './arena.css?inline';

/** One scoped <style> for the Arena views, removed on unmount. A separate attribute keeps the other style counts unchanged. */
export function useArenaStyle(): void {
  useLayoutEffect(() => {
    const element = document.createElement('style');
    element.setAttribute('data-specter-arena-scene', '');
    element.textContent = css;
    document.head.appendChild(element);
    return () => {
      element.remove();
    };
  }, []);
}
