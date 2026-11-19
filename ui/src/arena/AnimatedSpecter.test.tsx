import { setSceneAssetsFailing } from '@kirocrew/app-sdk';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnimatedSpecter } from './AnimatedSpecter';
import { clearSceneArtCache } from './sceneAssetCache';

beforeEach(() => clearSceneArtCache());
afterEach(() => setSceneAssetsFailing(false));

const sprite = (container: HTMLElement) => container.querySelector<HTMLElement>('.sa-hero');

describe('AnimatedSpecter', () => {
  it('draws the sprite as an img when it is ready', async () => {
    const { container } = render(<AnimatedSpecter heroId="vell" animate initials="V" />);
    expect(container.querySelector('.sa-token__placeholder')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('img.sa-hero__img')).not.toBeNull());
    const image = container.querySelector('img.sa-hero__img');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('src')).toMatch(/^(?:blob:|data:image\/png;base64,)/);
    expect(container.querySelector('.sa-token__placeholder')).toBeNull();
  });

  it('shows the initials while loading and when the fetch fails', async () => {
    setSceneAssetsFailing(true);
    const { container } = render(<AnimatedSpecter heroId="vell" animate initials="V" />);
    expect(container.querySelector('.sa-token__placeholder')?.getAttribute('data-initials')).toBe('V');
    await act(async () => undefined);
    expect(container.querySelector('.sa-hero')).toBeNull();
    expect(container.querySelector('.sa-token__placeholder')?.getAttribute('data-initials')).toBe('V');
  });

  it('idles only when animate is true', async () => {
    const moving = render(<AnimatedSpecter heroId="vell" animate initials="V" />);
    await waitFor(() => expect(sprite(moving.container)).not.toBeNull());
    expect(sprite(moving.container)?.className).toContain('sa-is-animated');
    const still = render(<AnimatedSpecter heroId="vell" animate={false} initials="V" />);
    await waitFor(() => expect(sprite(still.container)).not.toBeNull());
    expect(sprite(still.container)?.className).toContain('sa-is-static');
    expect(sprite(still.container)?.className).not.toContain('sa-is-animated');
  });

  it('pivots on the hero anchor and uses the hero idle length', async () => {
    const { container } = render(<AnimatedSpecter heroId="ember" animate initials="E" />);
    await waitFor(() => expect(sprite(container)).not.toBeNull());
    expect(sprite(container)?.style.getPropertyValue('--sa-ax')).toBe('0.56244721');
    expect(sprite(container)?.style.getPropertyValue('--sa-idle-ms')).toBe('1450ms');
    expect(sprite(container)?.style.transformOrigin).toBe('56.24% 90.04%');
    expect(sprite(container)?.className).toContain('sa-hero--ember');
  });

  it('keeps the initials for a hero id whose art the backend does not serve', async () => {
    const { container } = render(<AnimatedSpecter heroId="newcomer" animate initials="N" />);
    await act(async () => undefined);
    expect(sprite(container)).toBeNull();
    expect(container.querySelector('.sa-token__placeholder')).not.toBeNull();
  });

  it('is hidden from assistive technology', async () => {
    const { container } = render(<AnimatedSpecter heroId="vell" animate initials="V" />);
    await waitFor(() => expect(sprite(container)).not.toBeNull());
    expect(sprite(container)?.getAttribute('aria-hidden')).toBe('true');
  });
});
