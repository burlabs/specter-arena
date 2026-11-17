import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useInjectedStyle } from './useInjectedStyle';

const file = readFileSync(join(import.meta.dirname, 'observatory.css'), 'utf8');

function Probe() {
  useInjectedStyle();
  return null;
}

const injected = () => [...document.head.querySelectorAll('style[data-specter-arena]')];

describe('useInjectedStyle', () => {
  it('injects the stylesheet text as one style element and removes it on unmount', () => {
    const { unmount } = render(<Probe />);
    expect(injected()).toHaveLength(1);
    expect(injected()[0]?.textContent).toBe(file);
    unmount();
    expect(injected()).toHaveLength(0);
  });

  it('leaves one element after a remount', () => {
    const first = render(<Probe />);
    first.unmount();
    render(<Probe />);
    expect(injected()).toHaveLength(1);
  });
});
