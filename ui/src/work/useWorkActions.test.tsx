import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostApiError } from '../host';
import { itemOf } from './testData';
import { codeOf, useWorkActions } from './useWorkActions';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const item = itemOf({ version: 3 });
const CREATE = { title: '  Title ', acceptanceCondition: ' Looks right ', rewardable: true, parentId: null, attemptIds: ['att_1'], milestones: [' One ', 'Two'] };

beforeEach(() => {
  api.postJson.mockReset();
});

describe('codeOf', () => {
  it('words an error as a contract code, a status, a shape problem or offline', () => {
    expect(codeOf(new HostApiError(409, 'version_conflict'))).toBe('version_conflict');
    expect(codeOf(new HostApiError(403, null))).toBe('http_403');
    expect(codeOf(new TypeError('Failed to fetch'))).toBe('offline');
  });
});

describe('useWorkActions request bodies (H-6)', () => {
  it('creates with trimmed text, real booleans and no parentId when there is none', async () => {
    api.postJson.mockResolvedValue(itemOf());
    const { result } = renderHook(() => useWorkActions());
    let outcome;
    await act(async () => void (outcome = await result.current.create(CREATE)));
    expect(outcome).toEqual({ ok: true, item: itemOf() });
    const [path, body] = api.postJson.mock.calls[0] ?? [];
    expect(path).toBe('/apps/specter-arena/api/work');
    expect(body).toEqual({ requestId: expect.stringMatching(/^wrq_[0-9a-f]{24}$/), title: 'Title', acceptanceCondition: 'Looks right', rewardable: true, attemptIds: ['att_1'], milestones: ['One', 'Two'] });
    expect(Object.keys(body)).not.toContain('parentId');
  });

  it('sends the parent when there is one', async () => {
    api.postJson.mockResolvedValue(itemOf());
    const { result } = renderHook(() => useWorkActions());
    await act(async () => void (await result.current.create({ ...CREATE, parentId: 'wrk_p' })));
    expect(api.postJson.mock.calls[0]?.[1]).toMatchObject({ parentId: 'wrk_p' });
  });

  it('links an attempt and sets a milestone against the item version', async () => {
    api.postJson.mockResolvedValue(itemOf());
    const { result } = renderHook(() => useWorkActions());
    await act(async () => void (await result.current.linkAttempt(item, 'att_9')));
    await act(async () => void (await result.current.setMilestone(item, 2, false)));
    expect(api.postJson.mock.calls[0]).toEqual([`/apps/specter-arena/api/work/${item.workId}/attempts`, { expectedVersion: 3, attemptId: 'att_9' }]);
    expect(api.postJson.mock.calls[1]).toEqual([`/apps/specter-arena/api/work/${item.workId}/milestones`, { expectedVersion: 3, position: 2, done: false }]);
  });

  it('decides with the evidence revision only for accept and reject, and the note only when it has text', async () => {
    api.postJson.mockResolvedValue(itemOf());
    const { result } = renderHook(() => useWorkActions());
    await act(async () => void (await result.current.decide(item, { action: 'accept', evidenceRevision: 'a'.repeat(24), note: ' fine ' })));
    await act(async () => void (await result.current.decide(item, { action: 'submit', evidenceRevision: 'a'.repeat(24), note: '  ' })));
    await act(async () => void (await result.current.decide(item, { action: 'reject', evidenceRevision: null, note: '' })));
    expect(api.postJson.mock.calls[0]?.[1]).toEqual({ requestId: expect.any(String), expectedVersion: 3, action: 'accept', evidenceRevision: 'a'.repeat(24), note: 'fine' });
    expect(api.postJson.mock.calls[1]?.[1]).toEqual({ requestId: expect.any(String), expectedVersion: 3, action: 'submit' });
    expect(api.postJson.mock.calls[2]?.[1]).toEqual({ requestId: expect.any(String), expectedVersion: 3, action: 'reject' });
  });
});

describe('useWorkActions retries and errors (H-6)', () => {
  it('reuses the request id after a network error and replaces it after a definite reply', async () => {
    api.postJson.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(itemOf());
    const { result } = renderHook(() => useWorkActions());
    for (let attempt = 0; attempt < 3; attempt += 1) await act(async () => void (await result.current.decide(item, { action: 'submit', evidenceRevision: null, note: '' })));
    const ids = api.postJson.mock.calls.map((call) => call[1].requestId);
    expect(new Set(ids).size).toBe(1);
    await act(async () => void (await result.current.decide(item, { action: 'submit', evidenceRevision: null, note: '' })));
    expect(api.postJson.mock.calls[3]?.[1].requestId).not.toBe(ids[0]);
  });

  it('clears the request id on an error reply and on a reply it cannot read', async () => {
    api.postJson.mockRejectedValueOnce(new HostApiError(409, 'invalid_transition')).mockResolvedValueOnce({ junk: true }).mockResolvedValueOnce(itemOf());
    const { result } = renderHook(() => useWorkActions());
    const outcomes: unknown[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) await act(async () => void outcomes.push(await result.current.create(CREATE)));
    expect(outcomes[0]).toEqual({ ok: false, code: 'invalid_transition' });
    expect(outcomes[1]).toEqual({ ok: false, code: 'unexpected' });
    expect(new Set(api.postJson.mock.calls.map((call) => call[1].requestId)).size).toBe(3);
  });

  it('is busy while a write is in flight and refuses a second write', async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.postJson.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useWorkActions());
    let first: Promise<unknown> = Promise.resolve();
    act(() => void (first = result.current.setMilestone(item, 1, true)));
    expect(result.current.busy).toBe(true);
    let second: unknown;
    await act(async () => void (second = await result.current.setMilestone(item, 1, true)));
    expect(second).toEqual({ ok: false, code: 'busy' });
    expect(api.postJson).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(itemOf());
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});
