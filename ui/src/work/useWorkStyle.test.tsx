import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import css from './work.css?inline';
import { useWorkStyle } from './useWorkStyle';

function Probe() {
  useWorkStyle();
  return null;
}

describe('useWorkStyle', () => {
  it('injects one style with the file text and removes it on unmount', () => {
    const { unmount } = render(<Probe />);
    const styles = document.head.querySelectorAll('style[data-specter-arena-work]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(css);
    expect(css).toContain('.sa-xp-bar');
    unmount();
    expect(document.head.querySelectorAll('style[data-specter-arena-work]')).toHaveLength(0);
  });
});
