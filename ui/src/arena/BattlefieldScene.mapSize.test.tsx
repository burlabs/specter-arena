import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSceneFixture, resetSceneAssetFixtures } from '../../fixtures/scene-bodies.ts';
import { BattlefieldScene, MAX_CSS_VAR_URL_CHARS } from './BattlefieldScene';
import { clearSceneArtCache } from './sceneAssetCache';
import { buildSceneModel } from './sceneModel';
import { inputsOf } from './testData';

const urlApi = URL as unknown as { createObjectURL: ((blob: Blob) => string) | undefined };
const nativeCreateObjectURL = urlApi.createObjectURL;
const CHROMIUM_CUSTOM_PROPERTY_LIMIT = 2 * 1024 * 1024;

function showMap() {
  const model = buildSceneModel(inputsOf());
  return render(<BattlefieldScene model={model} selection={null} onSelect={vi.fn()} motion={{ animate: false, paused: false, togglePause: vi.fn() }} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} />);
}

beforeEach(() => {
  clearSceneArtCache();
  installSceneFixture('arena-map', 1000, 700);
});

afterEach(() => {
  resetSceneAssetFixtures();
  clearSceneArtCache();
  urlApi.createObjectURL = nativeCreateObjectURL;
});

describe('a map image that is longer than a CSS custom property can hold', () => {
  it('puts a blob URL in --sa-map when the browser can make one', async () => {
    urlApi.createObjectURL = () => 'blob:http://localhost/map';
    const { container } = showMap();
    await waitFor(() => expect(container.querySelector('[data-map="ready"]')).not.toBeNull());
    expect(container.querySelector<HTMLElement>('.sa-arena-scene')?.style.getPropertyValue('--sa-map')).toBe('url("blob:http://localhost/map")');
    expect(container.querySelector('.sa-arena-map')?.className).toContain('sa-has-art');
    expect(container.querySelector('.sa-arena-minimap__frame')?.className).toContain('sa-has-art');
    expect(container.querySelector('.sa-arena-plate')).toBeNull();
  });

  it('never puts a data URL above 2,000,000 characters in a custom property, and shows the plate instead', async () => {
    urlApi.createObjectURL = undefined;
    const { container } = showMap();
    await waitFor(() => expect(container.querySelector('[data-map="ready"]')).not.toBeNull());
    const scene = container.querySelector<HTMLElement>('.sa-arena-scene');
    expect(scene?.style.getPropertyValue('--sa-map')).toBe('');
    expect((scene?.getAttribute('style') ?? '').length).toBeLessThan(MAX_CSS_VAR_URL_CHARS);
    expect(container.querySelector('.sa-arena-map')?.className).not.toContain('sa-has-art');
    expect(container.querySelector('.sa-arena-minimap__frame')?.className).not.toContain('sa-has-art');
    expect(container.querySelector('.sa-arena-plate')?.textContent).toBe('Map art is not available. Positions are still correct.');
  });

  it('keeps the guard below the Chromium limit', () => {
    expect(MAX_CSS_VAR_URL_CHARS).toBeLessThan(CHROMIUM_CUSTOM_PROPERTY_LIMIT);
  });
});
