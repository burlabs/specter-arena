import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostApi } from '../host';
import { MAX_BASE64_CHARS, MAX_CACHE_ENTRIES, MAX_IN_FLIGHT, clearSceneArtCache, loadSceneArt } from './sceneAssetCache';

afterEach(() => clearSceneArtCache());

const body = (key: string, extra: Record<string, unknown> = {}) => ({ key, mediaType: 'image/png', width: 16, height: 9, dataBase64: 'QUJD', ...extra });

function apiReturning(...results: unknown[]): HostApi & { getJson: ReturnType<typeof vi.fn> } {
  const getJson = vi.fn();
  for (const result of results) getJson.mockResolvedValueOnce(result);
  return { getJson, postJson: vi.fn() } as unknown as HostApi & { getJson: ReturnType<typeof vi.fn> };
}

describe('loadSceneArt', () => {
  it('returns a data URL with its size, asks the scene route and caches the success', async () => {
    const api = apiReturning(body('arena-map'));
    await expect(loadSceneArt(api, 'arena-map')).resolves.toEqual({ url: 'data:image/png;base64,QUJD', width: 16, height: 9 });
    await loadSceneArt(api, 'arena-map');
    expect(api.getJson).toHaveBeenCalledTimes(1);
    expect(api.getJson).toHaveBeenCalledWith('/apps/specter-arena/api/scene-assets/arena-map');
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

  it('runs at most two fetches at once and queues the rest', async () => {
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
    const all = [loadSceneArt(api, 'a'), loadSceneArt(api, 'b'), loadSceneArt(api, 'c')];
    await Promise.resolve();
    expect(peak).toBe(MAX_IN_FLIGHT);
    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(all);
    expect(api.getJson).toHaveBeenCalledTimes(3);
  });
});
