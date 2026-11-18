import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAttempts } from '../observatory/useAttempts';
import { useWorkItem } from '../work/useWorkItem';
import { HostApiError, useHostApi } from './useHostApi';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => client }));

beforeEach(() => {
  client.get.mockReset();
  client.post.mockReset();
});

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('useHostApi mode', () => {
  it('is LIVE for a client without the marker, with another value, and FIXTURE only for the exact marker', () => {
    const modeOf = (extra: object) => {
      Object.assign(client, extra);
      return renderHook(() => useHostApi()).result.current.mode;
    };
    expect(modeOf({})).toBe('LIVE');
    expect(modeOf({ sourceMode: 'LIVE' })).toBe('LIVE');
    expect(modeOf({ sourceMode: 'fixture' })).toBe('LIVE');
    expect(modeOf({ sourceMode: 'FIXTURE' })).toBe('FIXTURE');
    delete (client as { sourceMode?: unknown }).sourceMode;
  });
});

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

  it('exposes the mode and the two JSON methods, never the client', () => {
    const { result } = renderHook(() => useHostApi());
    expect(Object.keys(result.current).sort()).toEqual(['getJson', 'mode', 'postJson']);
  });

  it('keeps the same api object while the client is unchanged', () => {
    const { result, rerender } = renderHook(() => useHostApi());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

const apiError = (status: unknown, body?: unknown) => Object.assign(new Error('ApiError'), { status, body });

const flush = () =>
  act(async () => {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  });

describe('useHostApi with the installed SDK, which throws ApiError', () => {
  it('turns a thrown status and JSON body into a HostApiError with the api-error code', async () => {
    client.get.mockRejectedValue(apiError(404, '{"contractVersion":1,"error":"unknown_work"}'));
    const { result } = renderHook(() => useHostApi());
    const failure: unknown = await result.current.getJson('/x').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HostApiError);
    expect(failure).toMatchObject({ status: 404, error: 'unknown_work' });
  });

  it('maps a thrown post the same way', async () => {
    client.post.mockRejectedValue(apiError(409, '{"contractVersion":1,"error":"stale_evidence"}'));
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.postJson('/x', {})).rejects.toMatchObject({ status: 409, error: 'stale_evidence' });
  });

  it('reports no code when the thrown body is not JSON, not a string or has no code', async () => {
    const { result } = renderHook(() => useHostApi());
    for (const body of ['<html>', undefined, 7, '{"error":"Not Allowed!"}']) {
      client.get.mockRejectedValueOnce(apiError(502, body));
      await expect(result.current.getJson('/x')).rejects.toMatchObject({ status: 502, error: null });
    }
  });

  it('rethrows an existing HostApiError unchanged', async () => {
    const original = new HostApiError(503, 'store_not_ready');
    client.get.mockRejectedValue(original);
    const { result } = renderHook(() => useHostApi());
    await expect(result.current.getJson('/x')).rejects.toBe(original);
  });

  it('rethrows an error without a usable HTTP status unchanged', async () => {
    const { result } = renderHook(() => useHostApi());
    const unchanged: unknown[] = [apiError(99), apiError(600), apiError(404.5), apiError('404'), new Error('Missing permissions'), 'boom', null];
    for (const error of unchanged) {
      client.get.mockRejectedValueOnce(error);
      await expect(result.current.getJson('/x')).rejects.toBe(error);
    }
  });

  it('reaches the gone branch of useWorkItem on a thrown 404 unknown_work', async () => {
    client.get.mockRejectedValue(apiError(404, '{"contractVersion":1,"error":"unknown_work"}'));
    const { result } = renderHook(() => useWorkItem('wrk_1'));
    await flush();
    expect(result.current.state).toEqual({ status: 'gone' });
  });

  it('reaches the gone branch of useAttempts on a thrown 404', async () => {
    client.get.mockRejectedValue(apiError(404, '{"contractVersion":1,"error":"no_binding"}'));
    const { result } = renderHook(() => useAttempts('bnd_aaaaaaaaaaaaaaaaaaaa0001'));
    await flush();
    expect(result.current.state).toEqual({ status: 'gone' });
  });
});
