import { useLayoutEffect } from 'react';
import css from './observatory.css?inline';

/** One scoped <style>, removed on unmount. useLayoutEffect so the first paint is styled. */
export function useInjectedStyle(): void {
  useLayoutEffect(() => {
    const element = document.createElement('style');
    element.setAttribute('data-specter-arena', '');
    element.textContent = css;
    document.head.appendChild(element);
    return () => {
      element.remove();
    };
  }, []);
}
