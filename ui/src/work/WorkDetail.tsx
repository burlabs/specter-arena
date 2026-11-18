import { useEffect, useId, useRef, useState } from 'react';
import type { RosterItemV1, WorkItemV1 } from '../contracts/types';
import { Time } from '../observatory/Time';
import { Button } from '../observatory/ui';
import { AttemptPicker } from './AttemptPicker';
import type { PickedAttempt } from './AttemptPicker';
import { ReviewPanel } from './ReviewPanel';
import { ProgressLine } from './ProgressLine';
import { StateBadge } from './StateBadge';
import { ANNOUNCE, DETAIL, REFRESH_CODES, actionWords, errorWords, kindWords } from './copy';
import { STATE_VIEWS, botNameOf, isTerminalForLinks, shortId, stateView } from './model';
import type { WorkActions } from './useWorkActions';

interface Props {
  item: WorkItemV1;
  bots: readonly RosterItemV1[];
  parentTitle: string | null;
  linked: ReadonlyMap<string, string>;
  actions: WorkActions;
  focusOnMount: boolean;
  onFocused: () => void;
  onApplied: (item: WorkItemV1) => void;
  onRefresh: () => void;
  onLedgerChanged: () => void;
  announce: (text: string) => void;
}

const xpFact = (item: WorkItemV1): string =>
  item.childCount > 0 ? DETAIL.groupsParts(item.childCount) : item.rewardable ? DETAIL.rewardedWhenAccepted(item.bountyXp, item.policyVersion) : DETAIL.noXpItem;

export function WorkDetail({ item, bots, parentTitle, linked, actions, focusOnMount, onFocused, onApplied, onRefresh, onLedgerChanged, announce }: Props) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [picked, setPicked] = useState<ReadonlyMap<string, PickedAttempt>>(new Map());

  useEffect(() => {
    if (!focusOnMount) return;
    headingRef.current?.focus();
    onFocused();
  }, [focusOnMount, onFocused]);

  const known = item.state in STATE_VIEWS;
  const view = stateView(item.state);
  const focusHeading = () => headingRef.current?.focus();

  const fail = (code: string) => {
    setWriteError(code);
    if (REFRESH_CODES.includes(code)) onRefresh();
  };

  const toggleMilestone = async (position: number, label: string, done: boolean) => {
    setWriteError(null);
    const result = await actions.setMilestone(item, position, done);
    if (!result.ok) return fail(result.code);
    onApplied(result.item);
    announce(done ? ANNOUNCE.milestoneOn(label) : ANNOUNCE.milestoneOff(label));
  };

  const linkPicked = async () => {
    const [attempt] = [...picked.values()];
    if (attempt === undefined) return;
    setWriteError(null);
    const result = await actions.linkAttempt(item, attempt.attemptId);
    if (!result.ok) return fail(result.code);
    onApplied(result.item);
    announce(ANNOUNCE.linked);
    setPicked(new Map());
    setLinking(false);
  };

  const togglePicked = (attempt: PickedAttempt) => setPicked((previous) => (previous.has(attempt.attemptId) ? new Map() : new Map([[attempt.attemptId, attempt]])));

  const decisionsAtCap = item.decisions.length >= 50;
  const cancelled = item.state === 'cancelled';

  return (
    <section className="sa-work-detail" aria-labelledby={headingId}>
      <div className="sa-work-detail__head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {item.title}
        </h2>
        <StateBadge state={item.state} />
        <p className="sa-help">{view.reason}</p>
        {!known && <p className="sa-help">{DETAIL.unknownStateNote}</p>}
      </div>

      <dl className="sa-work-facts">
        <div className="sa-field">
          <dt>{DETAIL.condition}</dt>
          <dd className="sa-work-text">{item.acceptanceCondition}</dd>
        </div>
        {item.parentId !== null && (
          <div className="sa-field">
            <dt>{DETAIL.partOf}</dt>
            <dd>{parentTitle ?? item.parentId}</dd>
          </div>
        )}
        <div className="sa-field">
          <dt>{DETAIL.xp}</dt>
          <dd>{xpFact(item)}</dd>
        </div>
        {item.childCount > 0 && (
          <div className="sa-field">
            <dt>{DETAIL.partOf}</dt>
            <dd>{DETAIL.partsAccepted(item.childrenAccepted, item.childCount)}</dd>
          </div>
        )}
        <div className="sa-field">
          <dt>{DETAIL.created}</dt>
          <dd>
            <Time ms={item.createdAtMs} />
          </dd>
        </div>
        <div className="sa-field">
          <dt>{DETAIL.changed}</dt>
          <dd>
            <Time ms={item.updatedAtMs} />
          </dd>
        </div>
      </dl>

      <div className="sa-work-section">
        <ProgressLine progress={item.progress} />
        {item.milestones.length > 0 && (
          <fieldset className="sa-work-milestones">
            <legend>{DETAIL.milestones}</legend>
            {item.milestones.map((milestone) => (
              <label key={milestone.position}>
                <input
                  type="checkbox"
                  checked={milestone.doneAtMs !== null}
                  disabled={cancelled || actions.busy}
                  onChange={(event) => void toggleMilestone(milestone.position, milestone.label, event.currentTarget.checked)}
                />
                <span>{milestone.label}</span>
              </label>
            ))}
            <span className="sa-help">{DETAIL.milestoneHint}</span>
          </fieldset>
        )}
      </div>

      {writeError !== null && (
        <p className="sa-error" role="alert">
          {errorWords(writeError)}
        </p>
      )}

      <div className="sa-work-section">
        <h3>{DETAIL.contributors}</h3>
        {item.contributors.length === 0 ? (
          <p>{DETAIL.noContributors}</p>
        ) : (
          <ul className="sa-work-plain" aria-label={DETAIL.contributors}>
            {item.contributors.map((contributor) => (
              <li key={contributor.bindingId}>{DETAIL.contributorLine(botNameOf(bots, contributor.bindingId), contributor.attemptCount, contributor.xpNet)}</li>
            ))}
          </ul>
        )}
        <p className="sa-help">{DETAIL.contributorsHelp}</p>
      </div>

      <div className="sa-work-section">
        <h3>{DETAIL.evidence}</h3>
        {item.attempts.length === 0 ? (
          <p>{DETAIL.noEvidence}</p>
        ) : (
          <ol className="sa-work-evidence" aria-label={DETAIL.evidence}>
            {item.attempts.map((attempt) => (
              <li key={attempt.attemptId}>
                <span>{DETAIL.evidenceRow(kindWords(attempt.kind), shortId(attempt.attemptId), attempt.present ? (attempt.ended ? DETAIL.ended : DETAIL.stillOpen) : DETAIL.notFound)}</span>
                {attempt.present ? (
                  attempt.startedMs !== null && (
                    <span className="sa-help">
                      <Time ms={attempt.startedMs} />
                    </span>
                  )
                ) : (
                  <span className="sa-help">{DETAIL.missingAttempt}</span>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="sa-help">{DETAIL.evidenceHelp}</p>
      </div>

      {known && (
        <ReviewPanel
          item={item}
          actions={actions}
          onApplied={onApplied}
          onRefresh={onRefresh}
          onLedgerChanged={onLedgerChanged}
          announce={announce}
          focusHeading={focusHeading}
        />
      )}

      <div className="sa-work-section">
        <h3>{DETAIL.decisions}</h3>
        {item.decisions.length === 0 ? (
          <p>{DETAIL.noDecisions}</p>
        ) : (
          <ol className="sa-work-timeline" aria-label={DETAIL.decisions}>
            {item.decisions.map((decision) => (
              <li key={decision.decisionId}>
                <span>
                  {DETAIL.decisionLine(decision.seq, actionWords(decision.action), stateView(decision.fromState).label, stateView(decision.toState).label)} <Time ms={decision.atMs} />
                </span>
                {decision.note !== null && <span className="sa-work-text">{decision.note}</span>}
                {decision.evidenceRevision !== null && <span className="sa-help">{DETAIL.evidenceRef(decision.evidenceRevision.slice(0, 8))}</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="sa-help">{DETAIL.decisionsHelp}</p>
        {decisionsAtCap && <p className="sa-help">{DETAIL.decisionCap}</p>}
      </div>

      {known && !isTerminalForLinks(item.state) && (
        <div className="sa-work-section">
          <Button aria-expanded={linking} onClick={() => setLinking((open) => !open)}>
            {DETAIL.linkAttempt}
          </Button>
          {linking && (
            <div className="sa-form">
              <AttemptPicker bots={bots} selected={picked} linked={linked} max={1} single onToggle={togglePicked} />
              <div className="sa-actions">
                <Button disabled={picked.size === 0 || actions.busy} onClick={() => void linkPicked()}>
                  {DETAIL.linkSubmit}
                </Button>
                <Button variant="ghost" onClick={() => setLinking(false)}>
                  {DETAIL.linkCancel}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
