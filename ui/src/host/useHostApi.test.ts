import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError, useHostApi } from './useHostApi';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => client }));

beforeEach(() => {
  client.get.mockReset();
  client.post.mockReset();
});

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('useHostApi', () => {
  it('parses a successful Response from get', async () => {
    client.get.mockResolvedValue(response({ ok: true }));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.getJson('/apps/specter-arena/api/ping')).resolves.toEqual({ ok: true });
    expect(client.get).toHaveBeenCalledWith('/apps/specter-arena/api/ping');
  });

  it('rejects on a non-2xx Response', async () => {
    client.get.mockResolvedValue(response({ error: 'nope' }, 403));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.getJson('/apps/specter-arena/api/ping')).rejects.toThrow('Request failed with status 403');
  });

  it('carries the typed api-error code of a 503', async () => {
    client.get.mockResolvedValue(response({ contractVersion: 1, error: 'store_not_ready' }, 503));
    const { result } = renderHook(() => useHostApi());
    const failure: unknown = await result.current.getJson('/apps/specter-arena/api/roster').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HostApiError);
    expect(failure).toMatchObject({ status: 503, error: 'store_not_ready', message: 'Request failed with status 503' });
  });

  it('reports no code when the error body is not JSON', async () => {
    client.get.mockResolvedValue(new Response('<html>', { status: 502 }));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.getJson('/x')).rejects.toMatchObject({ status: 502, error: null });
  });

  it('ignores a code outside the api-error pattern and a body without one', async () => {
    client.get.mockResolvedValueOnce(response({ error: 'Not Allowed!' }, 400));
    client.get.mockResolvedValueOnce(response(['x'], 400));
    client.get.mockResolvedValueOnce(response({ error: 7 }, 400));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.getJson('/x')).rejects.toMatchObject({ error: null });
    await expect(result.current.getJson('/x')).rejects.toMatchObject({ error: null });
    await expect(result.current.getJson('/x')).rejects.toMatchObject({ error: null });
  });

  it('returns already-parsed data unchanged', async () => {
    client.get.mockResolvedValue({ at: 'now' });
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.getJson('/apps/specter-arena/api/ping')).resolves.toEqual({ at: 'now' });
  });

  it('posts a body and parses the reply', async () => {
    client.post.mockResolvedValue(response({ id: 1 }));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.postJson('/apps/specter-arena/api/x', { a: 1 })).resolves.toEqual({ id: 1 });
    expect(client.post).toHaveBeenCalledWith('/apps/specter-arena/api/x', { a: 1 });
  });

  it('resolves undefined for an empty 204 reply instead of parsing a body', async () => {
    client.post.mockResolvedValue(new Response(null, { status: 204 }));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.postJson('/apps/specter-arena/api/probe/config', { probeSlug: 'x' })).resolves.toBeUndefined();
  });

  it('propagates client rejections', async () => {
    client.get.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.getJson('/apps/specter-arena/api/ping')).rejects.toThrow('network down');
  });

  it('exposes only the two JSON methods, never the client', () => {
    const { result } = renderHook(() => useHostApi());
    expect(Object.keys(result.current).sort()).toEqual(['getJson', 'postJson']);
  });

  it('keeps the same api object while the client is unchanged', () => {
    const { result, rerender } = renderHook(() => useHostApi());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
