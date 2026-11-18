import { describe, expect, it } from 'vitest';
import { CLOSED, canSend, reviewReducer } from './reviewMachine';
import type { ReviewState } from './reviewMachine';

const REV = 'a'.repeat(24);
const NEXT = 'b'.repeat(24);
const confirming = (extra: Partial<Extract<ReviewState, { phase: 'confirming' }>> = {}): ReviewState => ({
  phase: 'confirming',
  action: 'accept',
  revision: REV,
  acknowledged: false,
  note: '',
  error: null,
  ...extra,
});
const sending: ReviewState = { phase: 'sending', action: 'accept', revision: REV, acknowledged: true, note: 'n' };
const stale: ReviewState = { phase: 'stale', action: 'accept', revision: REV, note: 'kept' };

describe('reviewReducer', () => {
  it('opens only from closed or stale, and keeps the note from stale (R-1)', () => {
    expect(reviewReducer(CLOSED, { type: 'open', action: 'reject', revision: REV })).toEqual(confirming({ action: 'reject' }));
    expect(reviewReducer(stale, { type: 'open', action: 'accept', revision: NEXT })).toEqual(confirming({ revision: NEXT, note: 'kept' }));
    expect(reviewReducer(confirming(), { type: 'open', action: 'cancel', revision: NEXT })).toEqual(confirming());
    expect(reviewReducer(sending, { type: 'open', action: 'cancel', revision: NEXT })).toBe(sending);
  });

  it('needs the acknowledgement only for accept (R-2)', () => {
    expect(canSend(confirming())).toBe(false);
    expect(canSend(confirming({ acknowledged: true }))).toBe(true);
    expect(canSend(confirming({ action: 'reject' }))).toBe(true);
    expect(canSend(CLOSED)).toBe(false);
    expect(reviewReducer(confirming(), { type: 'send' })).toEqual(confirming());
    expect(reviewReducer(confirming({ acknowledged: true }), { type: 'send' })).toEqual({ phase: 'sending', action: 'accept', revision: REV, acknowledged: true, note: '' });
  });

  it('records the acknowledgement and the note only while confirming (R-3)', () => {
    expect(reviewReducer(confirming({ error: 'x' }), { type: 'acknowledge', value: true })).toEqual(confirming({ acknowledged: true }));
    expect(reviewReducer(confirming(), { type: 'note', value: 'why' })).toEqual(confirming({ note: 'why' }));
    expect(reviewReducer(sending, { type: 'acknowledge', value: false })).toBe(sending);
    expect(reviewReducer(CLOSED, { type: 'note', value: 'x' })).toBe(CLOSED);
  });

  it('ignores everything but sent and failed while sending (R-4)', () => {
    expect(reviewReducer(sending, { type: 'close' })).toBe(sending);
    expect(reviewReducer(sending, { type: 'observed', revision: NEXT })).toBe(sending);
    expect(reviewReducer(sending, { type: 'send' })).toBe(sending);
    expect(reviewReducer(sending, { type: 'sent' })).toBe(CLOSED);
    expect(reviewReducer(confirming(), { type: 'sent' })).toEqual(confirming());
  });

  it('goes stale on stale_evidence and back to confirming, unticked, on any other failure (R-5, R-6)', () => {
    expect(reviewReducer(sending, { type: 'failed', code: 'stale_evidence' })).toEqual({ phase: 'stale', action: 'accept', revision: REV, note: 'n' });
    expect(reviewReducer(sending, { type: 'failed', code: 'version_conflict' })).toEqual(confirming({ note: 'n', error: 'version_conflict', acknowledged: false }));
    expect(reviewReducer(confirming(), { type: 'failed', code: 'x' })).toEqual(confirming());
  });

  it('flips accept and reject to stale when another revision is observed, and nothing else (R-7, R-8)', () => {
    expect(reviewReducer(confirming(), { type: 'observed', revision: NEXT })).toEqual({ phase: 'stale', action: 'accept', revision: REV, note: '' });
    expect(reviewReducer(confirming({ action: 'reject' }), { type: 'observed', revision: NEXT }).phase).toBe('stale');
    expect(reviewReducer(confirming(), { type: 'observed', revision: REV })).toEqual(confirming());
    expect(reviewReducer(confirming({ action: 'cancel' }), { type: 'observed', revision: NEXT }).phase).toBe('confirming');
    expect(reviewReducer(confirming({ action: 'reopen' }), { type: 'observed', revision: NEXT }).phase).toBe('confirming');
    expect(reviewReducer(CLOSED, { type: 'observed', revision: NEXT })).toBe(CLOSED);
  });

  it('closes from confirming and stale (R-9)', () => {
    expect(reviewReducer(confirming(), { type: 'close' })).toBe(CLOSED);
    expect(reviewReducer(stale, { type: 'close' })).toBe(CLOSED);
  });
});
