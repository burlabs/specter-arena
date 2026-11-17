import type { AttemptItemV1 } from '../contracts/types';
import { ConditionBadge } from './ConditionBadge';
import { Time } from './Time';
import { FAILURE_COPY, attemptKindLabel, endSignalLabel } from './copy';
import { attemptCondition } from './model';
import { ErrorState, Button } from './ui';
import type { AttemptsState } from './useAttempts';

interface Props {
  items: readonly AttemptItemV1[];
  hasOlder: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  onLoadOlder: () => void;
}

export function AttemptsList({ items, hasOlder, loadingOlder, olderFailed, onLoadOlder }: Props) {
  return (
    <div className="sa-attempts">
      {items.length === 0 ? (
        <p>No tracked attempts for this bot yet. That is not a count of zero work: older history and scheduled turns may not be collected.</p>
      ) : (
        <ol aria-label="Attempts, newest first">
          {items.map((attempt) => {
            const view = attemptCondition(attempt);
            return (
              <li key={attempt.attemptId} className="sa-attempt">
                <div className="sa-chips">
                  <strong>{attemptKindLabel(attempt.kind)}</strong>
                  <ConditionBadge view={view} />
                </div>
                <p>{view.reason}</p>
                <p>
                  First seen <Time ms={attempt.startedMs} />.{' '}
                  {attempt.endedMs === null ? 'Still open.' : (
                    <>
                      Ended <Time ms={attempt.endedMs} />.
                    </>
                  )}{' '}
                  Signal: {endSignalLabel(attempt.endSignal)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {olderFailed && <p role="alert">Could not load older attempts. Retry.</p>}
      {hasOlder && (
        <Button onClick={onLoadOlder} disabled={loadingOlder}>
          Load older
        </Button>
      )}
    </div>
  );
}

/** What the attempts tabs show until a first page has loaded. */
export function AttemptsStatus({ state, onRetry }: { state: Exclude<AttemptsState, { status: 'ready' }>; onRetry: () => void }) {
  if (state.status === 'gone') return <p role="status">This bot is no longer on the roster.</p>;
  if (state.status === 'failed') {
    const copy = FAILURE_COPY[state.failure];
    return <ErrorState title={copy.title} body={copy.body} onRetry={onRetry} />;
  }
  return <p role="status">Loading attempts…</p>;
}
