import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import css from './specters.css?inline';
import { useInjectedStyle } from '../observatory/useInjectedStyle';
import { useSpecterStyle } from './useSpecterStyle';

function Probe({ both = false }: { both?: boolean }) {
  useSpecterStyle();
  if (both) useInjectedStyle();
  return null;
}

describe('useSpecterStyle', () => {
  it('injects one style with the file text and removes it on unmount', () => {
    const { unmount } = render(<Probe />);
    const styles = document.head.querySelectorAll('style[data-specter-arena-specters]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(css);
    expect(css).toContain('@keyframes sa-float');
    unmount();
    expect(document.head.querySelectorAll('style[data-specter-arena-specters]')).toHaveLength(0);
  });

  it('leaves the observatory style count at one', () => {
    render(<Probe both />);
    expect(document.head.querySelectorAll('style[data-specter-arena]')).toHaveLength(1);
    expect(document.head.querySelectorAll('style[data-specter-arena-specters]')).toHaveLength(1);
  });
});
