import { setSceneAssetsFailing } from '@kirocrew/app-sdk';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSceneArtCache } from '../arena/sceneAssetCache';
import { HeroThumb } from './HeroThumb';

beforeEach(() => clearSceneArtCache());
afterEach(() => setSceneAssetsFailing(false));

describe('HeroThumb', () => {
  it('shows the initials token while the thumbnail loads, then the image at the requested size', async () => {
    const { container } = render(<HeroThumb heroId="vell" name="Vell" size={64} />);
    expect(container.querySelector('.sa-portrait__token')?.getAttribute('data-initials')).toBe('V');
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    const image = container.querySelector('img');
    expect(image?.getAttribute('width')).toBe('64');
    expect(image?.getAttribute('height')).toBe('64');
    expect(image?.getAttribute('src')).toMatch(/^(?:blob:|data:image\/png;base64,)/);
    expect(container.querySelector('.sa-portrait__token')).toBeNull();
  });

  it('is decorative by default and names the hero when asked', async () => {
    const decorative = render(<HeroThumb heroId="stitch" name="Stitch" size={32} />);
    await waitFor(() => expect(decorative.container.querySelector('img')).toBeTruthy());
    expect(decorative.container.querySelector('img')?.getAttribute('alt')).toBe('');
    const named = render(<HeroThumb heroId="stitch" name="Stitch" size={32} decorative={false} />);
    await waitFor(() => expect(named.container.querySelector('img')).toBeTruthy());
    expect(named.container.querySelector('img')?.getAttribute('alt')).toBe('Stitch');
  });

  it('keeps the initials token when the thumbnail cannot load', async () => {
    setSceneAssetsFailing(true);
    const { container } = render(<HeroThumb heroId="vell" name="Vell" size={32} />);
    await act(async () => undefined);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.sa-portrait__token')?.getAttribute('aria-hidden')).toBe('true');
  });
});
