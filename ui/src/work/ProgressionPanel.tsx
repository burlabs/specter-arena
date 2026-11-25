import type { XpSummaryV1 } from '../contracts/types';
import { Button, EmptyState, ErrorState } from '../observatory/ui';
import { Time } from '../observatory/Time';
import { LEVEL_NOTE, PROGRESSION, XP, entryKindWords } from './copy';
import { amountWords } from './model';
import { XpMeter } from './XpMeter';
import { useXpHistory } from './useXpHistory';

/**
 * The ledger behind a bot's level: every entry the history route lists, the policy that wrote it, and the level table in
 * force. The total and level come from `total` (the v2 read, both ledgers) when the bot has one. The history route's own
 * summary is `xp-summary.v1` and does not carry task awards, so it is only the fallback for a bot with no XP at all.
 */
export function ProgressionPanel({ bindingId, botName, total }: { bindingId: string; botName: string; total: XpSummaryV1 | null }) {
  const history = useXpHistory(bindingId);

  if (history.status === 'loading' || history.status === 'idle') return <p role="status">{PROGRESSION.loading}</p>;
  if (history.status === 'gone') return <p role="status">{PROGRESSION.gone}</p>;
  if (history.status === 'failed' || history.summary === null) {
    return history.failure === 'unsupported' ? (
      <EmptyState title={PROGRESSION.unsupportedTitle} body={PROGRESSION.unsupportedBody} />
    ) : (
      <ErrorState title={PROGRESSION.failedTitle} body={XP.failed} onRetry={history.refresh} />
    );
  }

  const summary = total ?? history.summary;
  return (
    <section className="sa-work-progression" aria-label={`${PROGRESSION.label}: ${botName}`}>
      <div className="sa-work-progression__head">
        <p className="sa-work-xp-amount">
          {XP.levelWord(summary.level)} · {summary.totalXp} {XP.unit}
        </p>
        <XpMeter summary={summary} />
        <p className="sa-help">{XP.policy(summary.policyVersion, summary.levelTableVersion)}</p>
        <p className="sa-help">{LEVEL_NOTE}</p>
        <p className="sa-help">{PROGRESSION.basis}</p>
      </div>
      {history.entries.length === 0 ? (
        <p>{PROGRESSION.empty}</p>
      ) : (
        <ol className="sa-work-ledger" aria-label={PROGRESSION.entries}>
          {history.entries.map((entry) => (
            <li key={entry.entryId} className="sa-work-ledger__entry">
              <strong className="sa-work-xp-amount">{amountWords(entry.amount)}</strong>
              <span>{entryKindWords(entry.kind)}</span>
              <span className="sa-work-ledger__title">{entry.workTitle}</span>
              <span className="sa-help">
                <Time ms={entry.createdAtMs} /> · {XP.entryPolicy(entry.policyVersion)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {history.olderFailed && <p className="sa-error" role="alert">{PROGRESSION.olderFailed}</p>}
      {history.hasOlder && (
        <Button disabled={history.loadingOlder} onClick={history.loadOlder}>
          {history.loadingOlder ? PROGRESSION.loadingOlder : PROGRESSION.loadOlder}
        </Button>
      )}
    </section>
  );
}
