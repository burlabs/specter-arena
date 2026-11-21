import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { dataBody } from './testData';
import { codeOf, useDataActions } from './useDataActions';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), putJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

beforeEach(() => {
  api.postJson.mockReset();
  api.putJson.mockReset();
});

const PREFIX = '/apps/specter-arena/api';

describe('useDataActions', () => {
  it('sends each write to its route with the contract body', async () => {
    api.putJson.mockResolvedValue(dataBody());
    api.postJson.mockResolvedValue(dataBody());
    const { result } = renderHook(() => useDataActions());
    await act(async () => void (await result.current.setRetention(30)));
    await act(async () => void (await result.current.setRetention(null)));
    await act(async () => void (await result.current.purge(90)));
    await act(async () => void (await result.current.exportStore()));
    await act(async () => void (await result.current.cleanupUploads()));
    expect(api.putJson.mock.calls).toEqual([
      [`${PREFIX}/data/retention`, { retentionDays: 30 }],
      [`${PREFIX}/data/retention`, { retentionDays: null }],
    ]);
    expect(api.postJson.mock.calls).toEqual([
      [`${PREFIX}/data/purge`, { retentionDays: 90 }],
      [`${PREFIX}/data/export`, {}],
      [`${PREFIX}/data/asset-cleanup`, {}],
    ]);
  });

  it('parses the collector answer', async () => {
    api.postJson.mockResolvedValue({ contractVersion: 1, paused: true, revision: 1, changedAtMs: 5, state: 'paused' });
    const { result } = renderHook(() => useDataActions());
    let outcome: unknown;
    await act(async () => void (outcome = await result.current.setPaused(true)));
    expect(api.postJson).toHaveBeenCalledWith(`${PREFIX}/collector`, { paused: true });
    expect(outcome).toMatchObject({ ok: true, control: { paused: true, revision: 1 } });
  });

  it('turns a reply that is not the contract into the unexpected code', async () => {
    api.postJson.mockResolvedValue({ contractVersion: 1 });
    const { result } = renderHook(() => useDataActions());
    let outcome: unknown;
    await act(async () => void (outcome = await result.current.exportStore()));
    expect(outcome).toEqual({ ok: false, code: 'unexpected' });
    await act(async () => void (outcome = await result.current.setPaused(false)));
    expect(outcome).toEqual({ ok: false, code: 'unexpected' });
  });

  it('refuses a second write while one is in flight and reports busy', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.postJson.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { result } = renderHook(() => useDataActions());
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.exportStore();
    });
    expect(result.current.busy).toBe(true);
    let second: unknown;
    await act(async () => void (second = await result.current.cleanupUploads()));
    expect(second).toEqual({ ok: false, code: 'busy' });
    expect(api.postJson).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(dataBody());
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});

describe('codeOf', () => {
  it('maps a typed api error, an untyped status, a shape fault and a network failure', () => {
    expect(codeOf(new HostApiError(409, 'lifecycle_busy'))).toBe('lifecycle_busy');
    expect(codeOf(new HostApiError(502, null))).toBe('http_502');
    expect(codeOf(new TypeError('Failed to fetch'))).toBe('offline');
  });
});
