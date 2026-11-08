import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from './mount';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLElement[] = [];

function newContainer() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe('mount', () => {
  it('renders the stub shell without a host context', () => {
    const container = newContainer();
    let cleanup: () => void = () => {};
    act(() => {
      cleanup = mount(container);
    });
    expect(container.querySelector('h1')?.textContent).toBe('Specter Arena');
    expect(container.querySelector('[data-specter-stub="true"]')?.getAttribute('aria-label')).toBe('Specter Arena');
    act(() => cleanup());
  });

  it('accepts and ignores a host context', () => {
    const container = newContainer();
    let cleanup: () => void = () => {};
    act(() => {
      cleanup = mount(container, { appName: 'specter-arena' });
    });
    expect(container.textContent).toContain('No product features yet.');
    act(() => cleanup());
  });

  it('returns a cleanup that empties the container', () => {
    const container = newContainer();
    let cleanup: () => void = () => {};
    act(() => {
      cleanup = mount(container);
    });
    act(() => cleanup());
    expect(container.childNodes).toHaveLength(0);
  });
});
