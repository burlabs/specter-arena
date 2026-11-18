import { useLayoutEffect } from 'react';
import css from './work.css?inline';

/** One scoped <style> for the Work views, removed on unmount. A separate attribute keeps the other style counts unchanged. */
export function useWorkStyle(): void {
  useLayoutEffect(() => {
    const element = document.createElement('style');
    element.setAttribute('data-specter-arena-work', '');
    element.textContent = css;
    document.head.appendChild(element);
    return () => {
      element.remove();
    };
  }, []);
}
