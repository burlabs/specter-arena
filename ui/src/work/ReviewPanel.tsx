import { useEffect, useId, useReducer, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { WorkItemV1 } from '../contracts/types';
import { Button } from '../observatory/ui';
import { ACTION_ANNOUNCE, ACTION_LABELS, DETAIL, REFRESH_CODES, REVIEW, blockerWords, errorWords } from './copy';
import { actionsFor, isConfirmed, needsEvidence, shortId } from './model';
import type { ConfirmAction, DecisionAction } from './model';
import { CLOSED, canSend, reviewReducer } from './reviewMachine';
import type { WorkActions } from './useWorkActions';

interface Props {
  item: WorkItemV1;
  actions: WorkActions;
  onApplied: (item: WorkItemV1) => void;
  onRefresh: () => void;
  onLedgerChanged: () => void;
  announce: (text: string) => void;
  focusHeading: () => void;
}

const HEADINGS: Readonly<Record<ConfirmAction, string>> = {
  accept: REVIEW.accept.heading,
  reject: REVIEW.reject.heading,
  cancel: REVIEW.cancel.heading,
  reopen: REVIEW.reopen.heading,
};

const SUBMIT_LABELS: Readonly<Record<ConfirmAction, string>> = {
  accept: REVIEW.accept.submit,
  reject: REVIEW.reject.submit,
  cancel: REVIEW.cancel.submit,
  reopen: REVIEW.reopen.submit,
};

function ConfirmBody({ action, item }: { action: ConfirmAction; item: WorkItemV1 }) {
  if (action === 'accept') {
    const xpLine = !item.rewardable
      ? REVIEW.accept.noXp
      : item.childCount > 0
        ? REVIEW.accept.groups(item.childCount)
        : REVIEW.accept.award(item.bountyXp, item.contributors.length);
    return (
      <>
        <p>
          {item.attempts.length === 0 ? REVIEW.accept.noAttempts : REVIEW.accept.evidence(item.attempts.length, item.attempts.map((attempt) => shortId(attempt.attemptId)).join(', '))}
        </p>
        <p>{REVIEW.accept.warning}</p>
        <p>{xpLine}</p>
      </>
    );
  }
  if (action === 'reject') return <p>{REVIEW.reject.body}</p>;
  if (action === 'cancel') return <p>{REVIEW.cancel.body}</p>;
  return <p>{item.contributors.some((contributor) => contributor.xpNet > 0) ? REVIEW.reopen.takesBack : REVIEW.reopen.noXp}</p>;
}

/** Action buttons for the item's state. Accept, reject, cancel and reopen go through a confirm form driven by `reviewReducer`. */
export function ReviewPanel({ item, actions, onApplied, onRefresh, onLedgerChanged, announce, focusHeading }: Props) {
  const [review, dispatch] = useReducer(reviewReducer, CLOSED);
  const [directError, setDirectError] = useState<string | null>(null);
  const formHeadingId = useId();
  const noteId = useId();
  const blockersId = useId();
  const formHeading = useRef<HTMLHeadingElement>(null);
  const openers = useRef(new Map<DecisionAction, HTMLButtonElement>());
  const focusNext = useRef<'form' | 'opener' | null>(null);
  const lastOpened = useRef<DecisionAction | null>(null);

  useEffect(() => {
    dispatch({ type: 'observed', revision: item.evidenceRevision });
  }, [item.evidenceRevision]);

  useEffect(() => {
    if (review.phase === 'closed' || review.phase === 'sending') return;
    if (actionsFor(item.state).includes(review.action)) return;
    dispatch({ type: 'close' });
    announce(REVIEW.changed);
  }, [item.state, review, announce]);

  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    if (target === 'form' && formHeading.current !== null) formHeading.current.focus();
    else if (target === 'opener' && lastOpened.current !== null) openers.current.get(lastOpened.current)?.focus();
    else return;
    focusNext.current = null;
  });

  const open = (action: ConfirmAction) => {
    lastOpened.current = action;
    focusNext.current = 'form';
    dispatch({ type: 'open', action, revision: item.evidenceRevision });
  };

  const close = () => {
    focusNext.current = 'opener';
    dispatch({ type: 'close' });
  };

  const settle = (action: DecisionAction, applied: WorkItemV1) => {
    onApplied(applied);
    announce(ACTION_ANNOUNCE[action] ?? '');
    if (action === 'accept' || (action === 'reopen' && item.state === 'accepted')) onLedgerChanged();
    focusHeading();
  };

  const direct = async (action: DecisionAction) => {
    setDirectError(null);
    const result = await actions.decide(item, { action, evidenceRevision: null, note: '' });
    if (result.ok) return settle(action, result.item);
    setDirectError(result.code);
    if (REFRESH_CODES.includes(result.code)) onRefresh();
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (review.phase !== 'confirming' || !canSend(review)) return;
    const { action, revision, note } = review;
    dispatch({ type: 'send' });
    const result = await actions.decide(item, { action, evidenceRevision: needsEvidence(action) ? revision : null, note });
    if (result.ok) {
      dispatch({ type: 'sent' });
      return settle(action, result.item);
    }
    dispatch({ type: 'failed', code: result.code });
    if (REFRESH_CODES.includes(result.code)) onRefresh();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && review.phase !== 'sending') {
      event.stopPropagation();
      close();
    }
  };

  const available = actionsFor(item.state);
  const panelOpen = review.phase !== 'closed';
  const blocked = item.state === 'awaiting-review' && !item.review.canAccept;

  return (
    <div className="sa-work-section">
      <h3>{DETAIL.reviewHeading}</h3>
      {available.length === 0 ? null : (
        <div className="sa-actions">
          {available.map((action) => {
            const confirmed = isConfirmed(action);
            const blockedAccept = action === 'accept' && blocked;
            return (
              <Button
                key={action}
                ref={(element) => {
                  if (element) openers.current.set(action, element);
                  else openers.current.delete(action);
                }}
                aria-expanded={confirmed ? review.phase !== 'closed' && review.action === action : undefined}
                aria-describedby={blockedAccept ? blockersId : undefined}
                disabled={actions.busy || panelOpen || blockedAccept}
                onClick={() => (confirmed ? open(action) : void direct(action))}
              >
                {ACTION_LABELS[action]}
              </Button>
            );
          })}
        </div>
      )}
      {blocked && (
        <div id={blockersId} className="sa-help">
          <p>{DETAIL.blockedBy}</p>
          <ul className="sa-work-plain">
            {item.review.blockers.map((blocker) => (
              <li key={blocker}>{blockerWords(blocker)}</li>
            ))}
          </ul>
        </div>
      )}
      {directError !== null && (
        <p className="sa-error" role="alert">
          {errorWords(directError)}
        </p>
      )}
      {review.phase === 'stale' && (
        <div className="sa-error" role="alert">
          <p>{REVIEW.stale}</p>
          <div className="sa-actions">
            <Button disabled={item.evidenceRevision === review.revision} onClick={() => dispatch({ type: 'open', action: review.action, revision: item.evidenceRevision })}>
              {REVIEW.reviewAgain}
            </Button>
            <Button variant="ghost" onClick={close}>
              {REVIEW.back}
            </Button>
          </div>
          {item.evidenceRevision === review.revision && <p className="sa-help">{REVIEW.reloading}</p>}
        </div>
      )}
      {(review.phase === 'confirming' || review.phase === 'sending') && (
        <form className="sa-form sa-work-confirm" aria-labelledby={formHeadingId} onSubmit={(event) => void send(event)} onKeyDown={onKeyDown}>
          <h3 id={formHeadingId} ref={formHeading} tabIndex={-1}>
            {HEADINGS[review.action]}
          </h3>
          <ConfirmBody action={review.action} item={item} />
          <label htmlFor={noteId}>
            {review.action === 'accept' ? REVIEW.noteLabel : REVIEW.reasonLabel}
            <textarea id={noteId} rows={2} maxLength={280} value={review.note} disabled={review.phase === 'sending'} onChange={(event) => dispatch({ type: 'note', value: event.target.value })} />
          </label>
          {review.action === 'accept' && (
            <label className="sa-work-check">
              <input
                type="checkbox"
                checked={review.acknowledged}
                disabled={review.phase === 'sending'}
                onChange={(event) => dispatch({ type: 'acknowledge', value: event.currentTarget.checked })}
              />
              <span>{REVIEW.accept.acknowledge}</span>
            </label>
          )}
          {review.phase === 'confirming' && review.error !== null && (
            <p className="sa-error" role="alert">
              {errorWords(review.error)}
            </p>
          )}
          <div className="sa-actions">
            <Button type="submit" disabled={!canSend(review)}>
              {SUBMIT_LABELS[review.action]}
            </Button>
            <Button variant="ghost" disabled={review.phase === 'sending'} onClick={close}>
              {REVIEW.back}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
