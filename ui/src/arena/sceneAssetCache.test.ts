import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostApi } from '../host';
import { MAX_BASE64_CHARS, MAX_CACHE_ENTRIES, MAX_IN_FLIGHT, clearSceneArtCache, loadSceneArt } from './sceneAssetCache';

const urlApi = URL as unknown as { createObjectURL: ((blob: Blob) => string) | undefined };
const nativeCreateObjectURL = urlApi.createObjectURL;

afterEach(() => {
  clearSceneArtCache();
  urlApi.createObjectURL = nativeCreateObjectURL;
});

const body = (key: string, extra: Record<string, unknown> = {}) => ({ key, mediaType: 'image/png', width: 16, height: 9, dataBase64: 'QUJD', ...extra });

function apiReturning(...results: unknown[]): HostApi & { getJson: ReturnType<typeof vi.fn> } {
  const getJson = vi.fn();
  for (const result of results) getJson.mockResolvedValueOnce(result);
  return { getJson, postJson: vi.fn() } as unknown as HostApi & { getJson: ReturnType<typeof vi.fn> };
}

describe('loadSceneArt', () => {
  it('returns the data URL when createObjectURL is not available, with its size, asks the scene route and caches the success', async () => {
    urlApi.createObjectURL = undefined;
    const api = apiReturning(body('arena-map'));
    await expect(loadSceneArt(api, 'arena-map')).resolves.toEqual({ url: 'data:image/png;base64,QUJD', width: 16, height: 9 });
    await loadSceneArt(api, 'arena-map');
    expect(api.getJson).toHaveBeenCalledTimes(1);
    expect(api.getJson).toHaveBeenCalledWith('/apps/specter-arena/api/scene-assets/arena-map');
  });

  it('returns a blob URL for the decoded PNG bytes when createObjectURL exists', async () => {
    const created = vi.fn<(blob: Blob) => string>(() => 'blob:http://localhost/map');
    urlApi.createObjectURL = created;
    const api = apiReturning(body('arena-map'));
    await expect(loadSceneArt(api, 'arena-map')).resolves.toEqual({ url: 'blob:http://localhost/map', width: 16, height: 9 });
    const blob = created.mock.calls[0]?.[0];
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(3);
  });

  it('falls back to the data URL when createObjectURL throws', async () => {
    urlApi.createObjectURL = () => {
      throw new Error('refused');
    };
    await expect(loadSceneArt(apiReturning(body('arena-map')), 'arena-map')).resolves.toMatchObject({ url: 'data:image/png;base64,QUJD' });
  });

  it('does not cache a failure, so the next call retries', async () => {
    const api = apiReturning();
    api.getJson.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(body('k'));
    await expect(loadSceneArt(api, 'k')).rejects.toThrow('down');
    await expect(loadSceneArt(api, 'k')).resolves.toMatchObject({ width: 16 });
  });

  it.each([
    ['a different key', body('other')],
    ['a wrong media type', body('k', { mediaType: 'image/svg+xml' })],
    ['a null payload', body('k', { dataBase64: null })],
    ['bad base64', body('k', { dataBase64: 'not base64!' })],
    ['an oversize payload', body('k', { dataBase64: 'A'.repeat(MAX_BASE64_CHARS + 1) })],
    ['a zero width', body('k', { width: 0 })],
    ['a fractional height', body('k', { height: 1.5 })],
    ['no body', null],
  ])('rejects %s', async (_name, response) => {
    await expect(loadSceneArt(apiReturning(response), 'k')).rejects.toThrow('unusable scene asset');
  });

  it('evicts the oldest entry beyond the cap', async () => {
    const api = apiReturning();
    api.getJson.mockImplementation((path: string) => Promise.resolve(body(path.split('/').pop() ?? '')));
    for (let i = 0; i <= MAX_CACHE_ENTRIES; i += 1) await loadSceneArt(api, `k${i}`);
    await loadSceneArt(api, 'k0');
    expect(api.getJson).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 2);
  });

  it('holds the 25 art keys of the arena without evicting the map', async () => {
    const api = apiReturning();
    api.getJson.mockImplementation((path: string) => Promise.resolve(body(path.split('/').pop() ?? '')));
    for (let i = 0; i < 25; i += 1) await loadSceneArt(api, i === 0 ? 'arena-map' : `key-${i}`);
    await loadSceneArt(api, 'arena-map');
    expect(MAX_CACHE_ENTRIES).toBeGreaterThanOrEqual(25);
    expect(api.getJson).toHaveBeenCalledTimes(25);
  });

  it('runs at most four fetches at once and queues the rest', async () => {
    let running = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const api = apiReturning();
    api.getJson.mockImplementation((path: string) => {
      running += 1;
      peak = Math.max(peak, running);
      return new Promise((resolve) => {
        resolvers.push(() => {
          running -= 1;
          resolve(body(path.split('/').pop() ?? ''));
        });
      });
    });
    const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => loadSceneArt(api, key));
    await Promise.resolve();
    expect(peak).toBe(MAX_IN_FLIGHT);
    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(all);
    expect(api.getJson).toHaveBeenCalledTimes(6);
  });
});
