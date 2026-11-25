import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostApi } from '../host';
import { MAX_CACHE_ENTRIES, MAX_IN_FLIGHT, clearAssetCache, loadAssetUrl } from './assetCache';

afterEach(() => clearAssetCache());

const body = (data: string, extra: Record<string, unknown> = {}) => ({ mediaType: 'image/png', dataBase64: data, ...extra });

function apiReturning(...results: unknown[]): HostApi & { getJson: ReturnType<typeof vi.fn> } {
  const getJson = vi.fn();
  for (const result of results) getJson.mockResolvedValueOnce(result);
  return { getJson, postJson: vi.fn() } as unknown as HostApi & { getJson: ReturnType<typeof vi.fn> };
}

describe('loadAssetUrl', () => {
  it('returns a data URL with the fixed prefix and caches the success', async () => {
    const api = apiReturning(body('QUJD'));
    await expect(loadAssetUrl(api, 'ast_1')).resolves.toBe('data:image/png;base64,QUJD');
    await expect(loadAssetUrl(api, 'ast_1')).resolves.toBe('data:image/png;base64,QUJD');
    expect(api.getJson).toHaveBeenCalledTimes(1);
    expect(api.getJson).toHaveBeenCalledWith('/apps/specter-arena/api/assets/ast_1');
  });

  it('dedupes concurrent loads of one asset', async () => {
    const api = apiReturning(body('QUJD'));
    const [a, b] = await Promise.all([loadAssetUrl(api, 'ast_1'), loadAssetUrl(api, 'ast_1')]);
    expect(a).toBe(b);
    expect(api.getJson).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure, so the next call retries', async () => {
    const api = apiReturning();
    api.getJson.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(body('QUJD'));
    await expect(loadAssetUrl(api, 'ast_1')).rejects.toThrow('down');
    await expect(loadAssetUrl(api, 'ast_1')).resolves.toContain('QUJD');
    expect(api.getJson).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a wrong media type', body('QUJD', { mediaType: 'image/svg+xml' })],
    ['a null payload', body(null as unknown as string)],
    ['bad base64', body('not base64!')],
    ['an empty payload', body('')],
    ['an oversize payload', body('A'.repeat(1_500_001))],
    ['a body that is not an object', null],
  ])('rejects %s', async (_name, response) => {
    await expect(loadAssetUrl(apiReturning(response), 'ast_x')).rejects.toThrow('unusable asset');
  });

  it('evicts the oldest entry beyond 64', async () => {
    const getJson = vi.fn().mockResolvedValue(body('QUJD'));
    const api = { getJson, postJson: vi.fn() } as unknown as HostApi;
    for (let index = 0; index <= MAX_CACHE_ENTRIES; index += 1) await loadAssetUrl(api, `ast_${index}`);
    expect(getJson).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 1);
    await loadAssetUrl(api, 'ast_1');
    expect(getJson).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 1);
    await loadAssetUrl(api, 'ast_0');
    expect(getJson).toHaveBeenCalledTimes(MAX_CACHE_ENTRIES + 2);
  });

  it('keeps at most four requests in flight and runs the rest as slots free up', async () => {
    const releases: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    const getJson = vi.fn(
      () =>
        new Promise((resolve) => {
          running += 1;
          peak = Math.max(peak, running);
          releases.push(() => {
            running -= 1;
            resolve(body('QUJD'));
          });
        }),
    );
    const api = { getJson, postJson: vi.fn() } as unknown as HostApi;
    const all = Array.from({ length: 7 }, (_, index) => loadAssetUrl(api, `ast_${index}`));
    await Promise.resolve();
    await Promise.resolve();
    expect(getJson).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
    while (releases.length > 0) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(all);
    expect(peak).toBe(MAX_IN_FLIGHT);
    expect(getJson).toHaveBeenCalledTimes(7);
  });

  it('forgets everything on clear', async () => {
    const api = apiReturning(body('QUJD'), body('QUJD'));
    await loadAssetUrl(api, 'ast_1');
    clearAssetCache();
    await loadAssetUrl(api, 'ast_1');
    expect(api.getJson).toHaveBeenCalledTimes(2);
  });
});
