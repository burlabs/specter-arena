import { setArenaScenario, setSceneAssetsFailing } from '@kirocrew/app-sdk';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { clearSceneArtCache } from './sceneAssetCache';
import { useSceneAsset } from './useSceneAsset';

afterEach(() => {
  clearSceneArtCache();
  setArenaScenario(null);
});

describe('useSceneAsset', () => {
  it('goes from loading to a data URL for a known key', async () => {
    const { result } = renderHook(() => useSceneAsset('arena-map'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.art?.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(result.current.art).toMatchObject({ width: 160, height: 90 });
  });

  it('is failed, not an error, for a 404', async () => {
    setSceneAssetsFailing(true);
    const { result } = renderHook(() => useSceneAsset('arena-map'));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.art).toBeNull();
  });

  it('ignores a result that arrives after unmount', async () => {
    const { unmount } = renderHook(() => useSceneAsset('arena-map'));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('ignores a failure that arrives after unmount', async () => {
    setSceneAssetsFailing(true);
    const { unmount } = renderHook(() => useSceneAsset('arena-map'));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('is loading again when the key changes', async () => {
    const { result, rerender } = renderHook(({ key }) => useSceneAsset(key), { initialProps: { key: 'arena-map' } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ key: 'minion-patchling-sprite' });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.art).toMatchObject({ width: 64 }));
  });
});
