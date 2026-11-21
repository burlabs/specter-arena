import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import css from './data.css?inline';
import { useDataStyle } from './useDataStyle';

function Probe() {
  useDataStyle();
  return null;
}

describe('useDataStyle', () => {
  it('injects one style with the file text and removes it on unmount', () => {
    const { unmount } = render(<Probe />);
    const styles = document.head.querySelectorAll('style[data-specter-arena-data]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(css);
    expect(css).toContain('.sa-data-section');
    unmount();
    expect(document.head.querySelectorAll('style[data-specter-arena-data]')).toHaveLength(0);
  });
});
