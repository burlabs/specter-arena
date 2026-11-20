import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { POLL_MS } from '../observatory/usePolled';
import { itemOf, listPageOf, rowOf } from './testData';
import { useWork } from './useWork';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const id = (n: number) => `wrk_${String(n).repeat(24)}`;
const full = (n: number, extra: Parameters<typeof itemOf>[0] = {}) => itemOf({ workId: id(n), title: `Item ${n}`, createdAtMs: n * 1000, ...extra });
const item = (n: number, extra: Parameters<typeof itemOf>[0] = {}) => rowOf({ workId: id(n), title: `Item ${n}`, createdAtMs: n * 1000, ...extra });
const listOf = (...items: ReturnType<typeof item>[]) => listPageOf(items);

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useWork (H-4)', () => {
  it('loads newest first and sends the state filter and page size', async () => {
    api.getJson.mockResolvedValue(listOf(item(1), item(2)));
    const { result } = renderHook(({ filter }) => useWork(filter), { initialProps: { filter: null as string | null } });
    expect(result.current.status).toBe('loading');
    await flush();
    expect(result.current.status).toBe('ready');
    expect(result.current.items.map((entry) => entry.title)).toEqual(['Item 2', 'Item 1']);
    expect(result.current.byId.get(id(1))?.title).toBe('Item 1');
    expect(api.getJson).toHaveBeenLastCalledWith('/apps/specter-arena/api/work?view=list&order=created&limit=25');
  });

  it('resets when the filter changes', async () => {
    api.getJson.mockResolvedValue(listOf(item(1)));
    const { result, rerender } = renderHook(({ filter }) => useWork(filter), { initialProps: { filter: null as string | null } });
    await flush();
    api.getJson.mockResolvedValue(listOf());
    rerender({ filter: 'accepted' });
    expect(result.current.status).toBe('loading');
    await flush();
    expect(result.current.items).toEqual([]);
    expect(api.getJson).toHaveBeenLastCalledWith('/apps/specter-arena/api/work?state=accepted&view=list&order=created&limit=25');
  });

  it('shows an applied item at once, keeps it over an older poll, and drops it once the poll catches up', async () => {
    api.getJson.mockResolvedValue(listOf(item(1)));
    const { result } = renderHook(() => useWork(null));
    await flush();
    act(() => result.current.apply(full(2, { version: 1 })));
    expect(result.current.items.map((entry) => entry.title)).toEqual(['Item 2', 'Item 1']);
    act(() => result.current.apply(full(1, { version: 4, state: 'accepted' })));
    expect(result.current.byId.get(id(1))?.state).toBe('accepted');
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.byId.get(id(1))?.state).toBe('accepted');
    api.getJson.mockResolvedValue(listOf(item(2), item(1, { version: 4, state: 'accepted' })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.byId.get(id(1))?.state).toBe('accepted');
    api.getJson.mockResolvedValue(listOf(item(2), item(1, { version: 5, state: 'reopened' })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(result.current.byId.get(id(1))?.state).toBe('reopened');
  });

  it('hides a created item whose state the filter excludes', async () => {
    api.getJson.mockResolvedValue(listOf());
    const { result } = renderHook(() => useWork('accepted'));
    await flush();
    act(() => result.current.apply(full(1, { state: 'open' })));
    expect(result.current.items).toEqual([]);
    act(() => result.current.apply(full(2, { state: 'accepted' })));
    expect(result.current.items.map((entry) => entry.title)).toEqual(['Item 2']);
  });

  it('pages older items and reports failures as words', async () => {
    api.getJson.mockImplementation(async (path: string) =>
      path.includes('cursor=c1') ? listPageOf([item(1)]) : listPageOf([item(2)], 'created', 'c1'),
    );
    const { result } = renderHook(() => useWork(null));
    await flush();
    expect(result.current.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    await flush();
    expect(result.current.items).toHaveLength(2);
    expect(result.current.hasOlder).toBe(false);
    api.getJson.mockRejectedValue(new HostApiError(404, null));
    const old = renderHook(() => useWork(null));
    await flush();
    expect(old.result.current).toMatchObject({ status: 'failed', failure: 'unsupported' });
  });

  it('keeps a write response as its list projection, with everAccepted from its decisions, and exposes no full-item field', async () => {
    api.getJson.mockResolvedValue(listOf(item(1)));
    const { result } = renderHook(() => useWork(null));
    await flush();
    const accept = { decisionId: 'dec_1', seq: 1, action: 'accept', fromState: 'awaiting-review', toState: 'accepted', actor: 'app-owner' as const, atMs: 1, note: 'secret note', evidenceRevision: null };
    act(() => result.current.apply(full(1, { version: 3, state: 'reopened', decisions: [accept] })));
    const row = result.current.byId.get(id(1)) as unknown as Record<string, unknown>;
    expect(row.everAccepted).toBe(true);
    for (const dropped of ['decisions', 'review', 'milestones', 'evidenceRevision', 'acceptanceCondition', 'policyVersion']) expect(dropped in row).toBe(false);
  });

  it('fails closed on a v1 full-item page, so a backend without view=list shows an error and never a half-parsed list', async () => {
    api.getJson.mockResolvedValue({ contractVersion: 1, items: [itemOf()], nextCursor: null, asOfMs: 1 });
    const { result } = renderHook(() => useWork(null));
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unexpected' });
  });

  it('refuses a page that answers in the other order', async () => {
    api.getJson.mockResolvedValue(listPageOf([item(1)], 'updated'));
    const { result } = renderHook(() => useWork(null));
    await flush();
    expect(result.current).toMatchObject({ status: 'failed', failure: 'unexpected' });
  });
});
