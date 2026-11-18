import { needsEvidence } from './model';
import type { ConfirmAction } from './model';

export type ReviewState =
  | { phase: 'closed' }
  | { phase: 'confirming'; action: ConfirmAction; revision: string; acknowledged: boolean; note: string; error: string | null }
  | { phase: 'sending'; action: ConfirmAction; revision: string; acknowledged: boolean; note: string }
  | { phase: 'stale'; action: ConfirmAction; revision: string; note: string };

export type ReviewEvent =
  | { type: 'open'; action: ConfirmAction; revision: string }
  | { type: 'acknowledge'; value: boolean }
  | { type: 'note'; value: string }
  | { type: 'send' }
  | { type: 'sent' }
  | { type: 'failed'; code: string }
  | { type: 'observed'; revision: string }
  | { type: 'close' };

export const CLOSED: ReviewState = { phase: 'closed' };

/** Accept needs the acknowledgement; the other confirmed actions only need the click. */
export const canSend = (state: ReviewState): boolean => state.phase === 'confirming' && (state.action !== 'accept' || state.acknowledged);

export function reviewReducer(state: ReviewState, event: ReviewEvent): ReviewState {
  switch (event.type) {
    case 'open':
      if (state.phase !== 'closed' && state.phase !== 'stale') return state;
      return { phase: 'confirming', action: event.action, revision: event.revision, acknowledged: false, note: state.phase === 'stale' ? state.note : '', error: null };
    case 'acknowledge':
      return state.phase === 'confirming' ? { ...state, acknowledged: event.value, error: null } : state;
    case 'note':
      return state.phase === 'confirming' ? { ...state, note: event.value } : state;
    case 'send':
      return canSend(state) && state.phase === 'confirming'
        ? { phase: 'sending', action: state.action, revision: state.revision, acknowledged: state.acknowledged, note: state.note }
        : state;
    case 'sent':
      return state.phase === 'sending' ? CLOSED : state;
    case 'failed':
      if (state.phase !== 'sending') return state;
      return event.code === 'stale_evidence'
        ? { phase: 'stale', action: state.action, revision: state.revision, note: state.note }
        : { phase: 'confirming', action: state.action, revision: state.revision, acknowledged: false, note: state.note, error: event.code };
    case 'observed':
      return state.phase === 'confirming' && needsEvidence(state.action) && event.revision !== state.revision
        ? { phase: 'stale', action: state.action, revision: state.revision, note: state.note }
        : state;
    case 'close':
      return state.phase === 'sending' ? state : CLOSED;
  }
}
