import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAssetCache } from './assetCache';
import { useAsset } from './useAsset';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));

vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

beforeEach(() => {
  api.getJson.mockReset();
  clearAssetCache();
});
afterEach(() => clearAssetCache());

const png = { mediaType: 'image/png', dataBase64: 'QUJD' };

describe('useAsset', () => {
  it('is none for a null id and never calls the host', () => {
    const { result } = renderHook(() => useAsset(null));
    expect(result.current).toEqual({ status: 'none', src: null });
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('goes from loading to ready', async () => {
    api.getJson.mockResolvedValue(png);
    const { result } = renderHook(() => useAsset('ast_1'));
    expect(result.current).toEqual({ status: 'loading', src: null });
    await act(async () => undefined);
    expect(result.current).toEqual({ status: 'ready', src: 'data:image/png;base64,QUJD' });
  });

  it('ends failed when the asset cannot be used', async () => {
    api.getJson.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useAsset('ast_1'));
    await act(async () => undefined);
    expect(result.current).toEqual({ status: 'failed', src: null });
  });

  it('shows loading again when the id changes, never the old image', async () => {
    api.getJson.mockResolvedValueOnce(png).mockResolvedValueOnce({ ...png, dataBase64: 'REVG' });
    const { result, rerender } = renderHook(({ id }) => useAsset(id), { initialProps: { id: 'ast_1' } });
    await act(async () => undefined);
    rerender({ id: 'ast_2' });
    expect(result.current).toEqual({ status: 'loading', src: null });
    await act(async () => undefined);
    expect(result.current.src).toBe('data:image/png;base64,REVG');
  });

  it('sets no state when it unmounts mid-load', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.getJson.mockReturnValue(new Promise((done) => (resolve = done)));
    const { result, unmount } = renderHook(() => useAsset('ast_1'));
    unmount();
    await act(async () => resolve(png));
    expect(result.current.status).toBe('loading');
  });

  it('ignores a failure that arrives after unmount', async () => {
    let reject: (reason: unknown) => void = () => undefined;
    api.getJson.mockReturnValue(new Promise((_, fail) => (reject = fail)));
    const { unmount } = renderHook(() => useAsset('ast_1'));
    unmount();
    await act(async () => reject(new Error('late')));
  });
});
