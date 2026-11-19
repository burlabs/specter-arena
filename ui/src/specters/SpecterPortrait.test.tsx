import { setSpecterScenario, useAppApi } from '@kirocrew/app-sdk';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortraitAssetV1 } from '../contracts/types';
import { clearAssetCache } from './assetCache';
import { SpecterPortrait } from './SpecterPortrait';
import { heroOf } from './testData';

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

const FAILED = 'Portrait could not be loaded. Showing a placeholder token.';
const unloadable = (extra = {}) => heroOf({ displayName: 'Lantern Wick', ...extra });
const loadable = (extra = {}) => heroOf({ portrait: asset, ...extra });

describe('SpecterPortrait', () => {
  it('shows the portrait while it loads, then draws a labelled token with the initials if the asset cannot load', async () => {
    const { container } = render(<SpecterPortrait specter={unloadable()} size="md" />);
    expect(container.querySelector('[data-portrait="loading"]')).toBeTruthy();
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.getByText('LW')).toBeTruthy();
  });

  it('uses a hue from the binding id', async () => {
    const { container } = render(<SpecterPortrait specter={unloadable()} size="lg" />);
    await screen.findByText(FAILED);
    expect((container.querySelector('.sa-portrait__token') as HTMLElement).style.getPropertyValue('--sa-hue')).toMatch(/^\d+$/);
  });

  it('labels a small non-decorative token for assistive technology', async () => {
    render(<SpecterPortrait specter={heroOf()} size="sm" />);
    expect(await screen.findByRole('img', { name: `Vell: ${FAILED}` })).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('hides a decorative portrait from assistive technology', async () => {
    const { container } = render(<SpecterPortrait specter={heroOf()} size="sm" decorative />);
    await waitFor(() => expect(container.querySelector('[data-portrait="token"]')).toBeTruthy());
    expect(container.querySelector('.sa-portrait')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps the initials of a decorative token out of its text and in data-initials', async () => {
    const { container } = render(<SpecterPortrait specter={heroOf()} size="sm" decorative />);
    await waitFor(() => expect(container.querySelector('.sa-portrait__token')).toBeTruthy());
    const token = container.querySelector('.sa-portrait__token');
    expect(token?.textContent).toBe('');
    expect(token?.getAttribute('data-initials')).toBe('V');
  });

  it('keeps the initials of a labelled token as text with no data-initials', async () => {
    const { container } = render(<SpecterPortrait specter={heroOf()} size="sm" />);
    await waitFor(() => expect(container.querySelector('.sa-portrait__token')).toBeTruthy());
    const token = container.querySelector('.sa-portrait__token');
    expect(token?.textContent).toBe('V');
    expect(token?.hasAttribute('data-initials')).toBe(false);
  });

  it('shows no caption while the image loads, then the image with an alt from the display name', async () => {
    const { container } = render(<SpecterPortrait specter={loadable({ displayName: 'Vell II' })} size="md" />);
    expect(container.querySelector('[data-portrait="loading"]')).toBeTruthy();
    expect(screen.queryByText(/Placeholder token/)).toBeNull();
    const image = await screen.findByAltText('Portrait of Vell II');
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByText(/Placeholder token/)).toBeNull();
  });

  it('uses an empty alt for a decorative image', async () => {
    const { container } = render(<SpecterPortrait specter={loadable()} size="sm" decorative />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('falls back to the token with the failed caption when the asset cannot load', async () => {
    setSpecterScenario('asset-failed');
    render(<SpecterPortrait specter={loadable()} size="md" />);
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.getByText('V')).toBeTruthy();
  });

  it('adds float and active effects only when motion is allowed', async () => {
    reduceMotion(false);
    const moving = render(<SpecterPortrait specter={loadable()} size="md" active />);
    await act(async () => undefined);
    expect(moving.container.querySelector('.sa-portrait--float')).toBeTruthy();
    expect(moving.container.querySelector('.sa-portrait--active')).toBeTruthy();
    moving.unmount();
    reduceMotion(true);
    const still = render(<SpecterPortrait specter={loadable()} size="md" active />);
    await act(async () => undefined);
    expect(still.container.querySelector('.sa-portrait--float')).toBeNull();
    expect(still.container.querySelector('.sa-portrait--active')).toBeNull();
  });

  it('never floats a row-sized portrait, but still shows the active ring', async () => {
    reduceMotion(false);
    const { container } = render(<SpecterPortrait specter={loadable()} size="sm" active decorative />);
    await act(async () => undefined);
    expect(container.querySelector('.sa-portrait--float')).toBeNull();
    expect(container.querySelector('.sa-portrait--active')).toBeTruthy();
  });
});
