import { useLayoutEffect } from 'react';
import css from './specters.css?inline';

/** One scoped <style> for the Specter views, removed on unmount. A separate attribute keeps the observatory style count at one. */
export function useSpecterStyle(): void {
  useLayoutEffect(() => {
    const element = document.createElement('style');
    element.setAttribute('data-specter-arena-specters', '');
    element.textContent = css;
    document.head.appendChild(element);
    return () => {
      element.remove();
    };
  }, []);
}
