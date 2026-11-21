import { useLayoutEffect } from 'react';
import css from './data.css?inline';

/** One scoped <style> for the Data tab, removed on unmount. A separate attribute keeps the other style counts unchanged. */
export function useDataStyle(): void {
  useLayoutEffect(() => {
    const element = document.createElement('style');
    element.setAttribute('data-specter-arena-data', '');
    element.textContent = css;
    document.head.appendChild(element);
    return () => {
      element.remove();
    };
  }, []);
}
