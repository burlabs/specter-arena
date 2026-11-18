import { setSpecterScenario, useAppApi } from '@kirocrew/app-sdk';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortraitAssetV1 } from '../contracts/types';
import { clearAssetCache } from './assetCache';
import { SpecterPortrait } from './SpecterPortrait';
import { specterOf } from './testData';

let asset: PortraitAssetV1 = {
  contractVersion: 1,
  assetId: 'ast_000000000000000000000001',
  mediaType: 'image/png',
  width: 8,
  height: 8,
  byteLength: 10,
  origin: 'bundled',
  label: 'Violet portrait',
  dataBase64: null,
};

beforeEach(async () => {
  clearAssetCache();
  setSpecterScenario('specters-none');
  const gallery = (await ((await useAppApi().get('/apps/specter-arena/api/portraits')) as Response).json()) as { items: PortraitAssetV1[] };
  asset = gallery.items[0] ?? asset;
});
afterEach(() => vi.unstubAllGlobals());

function reduceMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('SpecterPortrait', () => {
  it('draws a labelled token with the Specter initials when there is no portrait', () => {
    render(<SpecterPortrait specter={specterOf({ profile: { ...specterOf().profile, name: 'Lantern Wick' } })} size="md" />);
    expect(screen.getByText('LW')).toBeTruthy();
    expect(screen.getByText('Placeholder token, not a portrait')).toBeTruthy();
  });

  it('uses a hue from the specter id', () => {
    const { container } = render(<SpecterPortrait specter={specterOf()} size="lg" />);
    expect((container.querySelector('.sa-portrait__token') as HTMLElement).style.getPropertyValue('--sa-hue')).toMatch(/^\d+$/);
  });

  it('labels a small non-decorative token for assistive technology', () => {
    render(<SpecterPortrait specter={specterOf()} size="sm" />);
    expect(screen.getByRole('img', { name: 'Lanternwick: Placeholder token, not a portrait' })).toBeTruthy();
    expect(screen.queryByText('Placeholder token, not a portrait')).toBeNull();
  });

  it('hides a decorative portrait from assistive technology', () => {
    const { container } = render(<SpecterPortrait specter={specterOf()} size="sm" decorative />);
    expect(container.querySelector('.sa-portrait')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows no caption while the image loads, then the image with an alt', async () => {
    const { container } = render(<SpecterPortrait specter={specterOf({ portrait: asset })} size="md" />);
    expect(container.querySelector('[data-portrait="loading"]')).toBeTruthy();
    expect(screen.queryByText(/Placeholder token/)).toBeNull();
    const image = await screen.findByAltText('Portrait of Lanternwick');
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByText(/Placeholder token/)).toBeNull();
  });

  it('uses an empty alt for a decorative image', async () => {
    const { container } = render(<SpecterPortrait specter={specterOf({ portrait: asset })} size="sm" decorative />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('falls back to the token with the failed caption when the asset cannot load', async () => {
    setSpecterScenario('asset-failed');
    render(<SpecterPortrait specter={specterOf({ portrait: asset })} size="md" />);
    expect(await screen.findByText('Portrait could not be loaded. Showing a placeholder token.')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy();
  });

  it('adds float and active effects only when motion is allowed', async () => {
    reduceMotion(false);
    const moving = render(<SpecterPortrait specter={specterOf()} size="md" active />);
    await act(async () => undefined);
    expect(moving.container.querySelector('.sa-portrait--float')).toBeTruthy();
    expect(moving.container.querySelector('.sa-portrait--active')).toBeTruthy();
    moving.unmount();
    reduceMotion(true);
    const still = render(<SpecterPortrait specter={specterOf()} size="md" active />);
    await act(async () => undefined);
    expect(still.container.querySelector('.sa-portrait--float')).toBeNull();
    expect(still.container.querySelector('.sa-portrait--active')).toBeNull();
  });

  it('never floats a row-sized portrait, but still shows the active ring', async () => {
    reduceMotion(false);
    const { container } = render(<SpecterPortrait specter={specterOf()} size="sm" active decorative />);
    await act(async () => undefined);
    expect(container.querySelector('.sa-portrait--float')).toBeNull();
    expect(container.querySelector('.sa-portrait--active')).toBeTruthy();
  });
});
