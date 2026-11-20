import { useId, useState } from 'react';
import type { RefObject } from 'react';
import type { RosterItemV1, WorkItemV1 } from '../contracts/types';
import type { WorkRowV1 } from '../work/model';
import { Time } from '../observatory/Time';
import { Button } from '../observatory/ui';
import { ProgressLine } from '../work/ProgressLine';
import { ReviewPanel } from '../work/ReviewPanel';
import { StateBadge } from '../work/StateBadge';
import { DETAIL, actionWords, kindWords } from '../work/copy';
import { botNameOf, newest, shortId, stateView } from '../work/model';
import { useWorkActions } from '../work/useWorkActions';
import { HandoffRow } from './HandoffRow';
import { ARENA, INSPECTOR } from './copy';
import { diagnosticSummary } from './diagnosticSummary';
import { committedXpOf } from './sceneModel';
import type { SceneModel } from './sceneModel';
import { useWorkEvidence } from './useWorkEvidence';

interface Props {
  workId: string;
  /** The decision an XP entry pointed at; it is marked in the decision list. */
  decisionId: string | null;
  headingRef: RefObject<HTMLHeadingElement>;
  list: SceneModel;
  bots: readonly RosterItemV1[];
  /** The arena's own snapshot, used only for a title while the evidence loads. */
  known: WorkRowV1 | undefined;
  onClose: () => void;
  onLedgerChanged: () => void;
  onWorkChanged: () => void;
}

const xpFact = (item: WorkItemV1): string =>
  item.childCount > 0 ? DETAIL.groupsParts(item.childCount) : item.rewardable ? DETAIL.rewardedWhenAccepted(item.bountyXp, item.policyVersion) : DETAIL.noXpItem;

function blockerLine(item: WorkItemV1): string {
  if (item.state !== 'blocked') return INSPECTOR.noBlocker;
  const latest = [...item.decisions].filter((decision) => decision.action === 'block').sort((a, b) => b.seq - a.seq)[0];
  return latest?.note ? `${INSPECTOR.blockedBecause}: ${latest.note}` : INSPECTOR.blockedNoReason;
}

function Fallback({ headingRef, title, body, onRetry, onClose }: { headingRef: RefObject<HTMLHeadingElement>; title: string; body: string; onRetry?: () => void; onClose: () => void }) {
  return (
    <div className="sa-arena-inspector__body">
      <h2 ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      <p role="status">{body}</p>
      <div className="sa-actions">
        {onRetry !== undefined && <Button onClick={onRetry}>{INSPECTOR.retry}</Button>}
        <Button variant="ghost" onClick={onClose}>
          {INSPECTOR.close}
        </Button>
      </div>
    </div>
  );
}

export function WorkInspector({ workId, decisionId, headingRef, list, bots, known, onClose, onLedgerChanged, onWorkChanged }: Props) {
  const { state, refresh } = useWorkEvidence(workId);
  const actions = useWorkActions();
  const [applied, setApplied] = useState<WorkItemV1 | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const inAppId = useId();

  if (state.status === 'gone') return <Fallback headingRef={headingRef} title={INSPECTOR.goneTitle} body={INSPECTOR.goneBody} onClose={onClose} />;
  if (state.status === 'forbidden') return <Fallback headingRef={headingRef} title={INSPECTOR.forbiddenTitle} body={INSPECTOR.forbiddenBody} onClose={onClose} />;
  if (state.status === 'failed') return <Fallback headingRef={headingRef} title={INSPECTOR.failedTitle} body={INSPECTOR.failedBody} onRetry={refresh} onClose={onClose} />;
  if (state.status !== 'ready') {
    return (
      <div className="sa-arena-inspector__body">
        <h2 ref={headingRef} tabIndex={-1}>
          {known?.title ?? ARENA.selectionLabel}
        </h2>
        <p role="status">{INSPECTOR.loading}</p>
      </div>
    );
  }

  const item = newest(state.item, applied?.workId === workId ? applied : null) ?? state.item;
  const committed = item.state === 'accepted' ? committedXpOf(item) : null;
  const decisions = [...item.decisions].sort((a, b) => b.seq - a.seq);
  const focusHeading = () => headingRef.current?.focus();

  return (
    <div className="sa-arena-inspector__body">
      <h2 ref={headingRef} tabIndex={-1}>
        {item.title}
      </h2>
      <p className="sa-arena-inspector__state">
        <StateBadge state={item.state} />
        {item.state === 'accepted' && <strong>{INSPECTOR.defeated}</strong>}
        {committed !== null && <span>{INSPECTOR.committedXp(committed)}</span>}
      </p>
      <p className="sa-help">{stateView(item.state).reason}</p>

      <section className="sa-arena-section" aria-label={INSPECTOR.whereItStands}>
        <h3>{INSPECTOR.whereItStands}</h3>
        <ProgressLine progress={item.progress} />
        {item.childCount > 0 && <p>{DETAIL.partsAccepted(item.childrenAccepted, item.childCount)}</p>}
        <p>{blockerLine(item)}</p>
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.evidence}>
        <h3>{INSPECTOR.evidence}</h3>
        {item.attempts.length === 0 ? (
          <p>{DETAIL.noEvidence}</p>
        ) : (
          <ol className="sa-arena-plain" aria-label={INSPECTOR.evidence}>
            {item.attempts.map((attempt) => (
              <li key={attempt.attemptId}>
                {DETAIL.evidenceRow(kindWords(attempt.kind), shortId(attempt.attemptId), attempt.present ? (attempt.ended ? DETAIL.ended : DETAIL.stillOpen) : DETAIL.notFound)}
              </li>
            ))}
          </ol>
        )}
        <p className="sa-help">{DETAIL.evidenceHelp}</p>
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.contributors}>
        <h3>{INSPECTOR.contributors}</h3>
        {item.contributors.length === 0 ? (
          <p>{ARENA.noContributors}</p>
        ) : (
          <ul className="sa-arena-plain" aria-label={INSPECTOR.contributors}>
            {item.contributors.map((contributor) => (
              <li key={contributor.bindingId}>{DETAIL.contributorLine(botNameOf(bots, contributor.bindingId), contributor.attemptCount, contributor.xpNet)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.decisions}>
        <h3>{INSPECTOR.decisions}</h3>
        {decisions.length === 0 ? (
          <p>{DETAIL.noDecisions}</p>
        ) : (
          <ol className="sa-arena-plain" aria-label={INSPECTOR.decisions}>
            {decisions.map((decision) => (
              <li key={decision.decisionId} aria-current={decision.decisionId === decisionId ? 'true' : undefined} className={decision.decisionId === decisionId ? 'sa-arena-opened' : undefined}>
                <span>
                  {DETAIL.decisionLine(decision.seq, actionWords(decision.action), stateView(decision.fromState).label, stateView(decision.toState).label)} <Time ms={decision.atMs} />
                </span>
                {decision.evidenceRevision !== null && <span className="sa-help">{DETAIL.evidenceRef(decision.evidenceRevision.slice(0, 8))}</span>}
                {decision.decisionId === decisionId && <span className="sa-help">{INSPECTOR.decisionOpened}</span>}
                {decision.note !== null && <span className="sa-work-text">{decision.note}</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="sa-help">{DETAIL.decisionsHelp}</p>
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.reward}>
        <h3>{INSPECTOR.reward}</h3>
        <p>{xpFact(item)}</p>
      </section>

      <section className="sa-arena-section" aria-labelledby={inAppId}>
        <h3 id={inAppId}>{INSPECTOR.inAppHeading}</h3>
        <p className="sa-help">{INSPECTOR.inAppNote}</p>
        <ReviewPanel
          item={item}
          actions={actions}
          onApplied={(updated) => {
            setApplied(updated);
            refresh();
            onWorkChanged();
          }}
          onRefresh={refresh}
          onLedgerChanged={onLedgerChanged}
          announce={setAnnouncement}
          focusHeading={focusHeading}
        />
      </section>

      <HandoffRow buildSummary={() => diagnosticSummary({ selection: { kind: 'work', workId }, model: list, bot: null, work: item, xp: null })} />
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="sa-actions">
        <Button variant="ghost" onClick={onClose}>
          {INSPECTOR.close}
        </Button>
      </div>
    </div>
  );
}
