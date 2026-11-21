import type { RefObject } from 'react';
import type { RosterCollectorV1, RosterItemV1, SpecterV2, XpSummaryV1 } from '../contracts/types';
import { ActivityPanel } from '../observatory/ActivityPanel';
import { AttemptsList, AttemptsStatus } from '../observatory/AttemptsList';
import { ConditionBadge } from '../observatory/ConditionBadge';
import { SourcePanel } from '../observatory/SourcePanel';
import { Time } from '../observatory/Time';
import { COVERAGE_STATE_WORDS } from '../observatory/copy';
import { botCondition } from '../observatory/model';
import { useAttempts } from '../observatory/useAttempts';
import { Button } from '../observatory/ui';
import { SpecterPortrait } from '../specters/SpecterPortrait';
import { entryKindWords } from '../work/copy';
import { amountWords } from '../work/model';
import type { WorkRowV1 } from '../work/model';
import { useXpHistory } from '../work/useXpHistory';
import { HandoffRow } from './HandoffRow';
import { INSPECTOR, levelXpText } from './copy';
import { diagnosticSummary } from './diagnosticSummary';
import type { SceneModel, SceneSpecter } from './sceneModel';
import type { ArenaSelection } from './selection';

interface Props {
  specter: SceneSpecter;
  bot: RosterItemV1;
  record: SpecterV2 | undefined;
  summary: XpSummaryV1 | undefined;
  headingRef: RefObject<HTMLHeadingElement>;
  list: SceneModel;
  collector: RosterCollectorV1;
  rosterRevision: number;
  items: ReadonlyMap<string, WorkRowV1>;
  onSelect: (selection: ArenaSelection) => void;
  onClose: () => void;
}

/** Work this bot has an open attempt on, drawn from the arena's own snapshot. */
function openWorkOf(bindingId: string, items: ReadonlyMap<string, WorkRowV1>): WorkRowV1[] {
  return [...items.values()]
    .filter((item) => item.state !== 'accepted' && item.attempts.some((attempt) => attempt.bindingId === bindingId && attempt.present && !attempt.ended))
    .sort((a, b) => (a.workId < b.workId ? -1 : 1));
}

export function SpecterInspector({ specter, bot, record, summary, headingRef, list, collector, rosterRevision, items, onSelect, onClose }: Props) {
  const attempts = useAttempts(specter.bindingId);
  const history = useXpHistory(specter.bindingId);
  const openWork = openWorkOf(specter.bindingId, items);
  const attemptsData = attempts.state.status === 'ready' ? attempts.state.data : null;
  const name = specter.specterName ?? specter.displayName;

  return (
    <div className="sa-arena-inspector__body">
      <div className="sa-arena-inspector__head">
        {record !== undefined && <SpecterPortrait specter={record} size="md" />}
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            {name}
          </h2>
          {specter.specterName !== null && <p>{INSPECTOR.forBot(specter.displayName)}</p>}
        </div>
      </div>
      <p className="sa-arena-inspector__state">
        <ConditionBadge view={botCondition(bot.condition)} />
        <span>{levelXpText(specter.xpReading, specter.level, specter.xpTotal, ' committed')}</span>
      </p>
      <p className="sa-help">{botCondition(bot.condition).reason}</p>

      {record !== undefined && (
        <figure className="sa-arena-fiction">
          <figcaption>{INSPECTOR.specterFiction}</figcaption>
          <p>{record.epithet}</p>
          <p>{record.personality}</p>
        </figure>
      )}

      <section className="sa-arena-section" aria-label={INSPECTOR.openWork}>
        <h3>{INSPECTOR.openWork}</h3>
        {openWork.length === 0 ? (
          <p>{INSPECTOR.noOpenWork}</p>
        ) : (
          <ul className="sa-arena-plain">
            {openWork.map((item) => (
              <li key={item.workId}>
                <Button variant="ghost" onClick={() => onSelect({ kind: 'work', workId: item.workId })}>
                  {item.title}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.attempts}>
        <h3>{INSPECTOR.attempts}</h3>
        {attempts.state.status === 'ready' ? (
          <AttemptsList
            items={attempts.state.items}
            hasOlder={attempts.state.hasOlder}
            loadingOlder={attempts.state.loadingOlder}
            olderFailed={attempts.state.olderFailed}
            onLoadOlder={attempts.loadOlder}
          />
        ) : attempts.state.status === 'idle' ? null : (
          <AttemptsStatus state={attempts.state} onRetry={attempts.refresh} />
        )}
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.coverage}>
        <h3>{INSPECTOR.coverage}</h3>
        <p>{COVERAGE_STATE_WORDS[bot.coverage.state] ?? bot.coverage.state}</p>
        {attempts.state.status === 'ready' && <ActivityPanel activity={attempts.state.data.activity} />}
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.xpLedger}>
        <h3>{INSPECTOR.xpLedger}</h3>
        {history.status === 'ready' && history.entries.length === 0 && <p>{INSPECTOR.noXp}</p>}
        {history.entries.length > 0 && (
          <ul className="sa-arena-plain" aria-label={INSPECTOR.xpLedger}>
            {history.entries.map((entry) => (
              <li key={entry.entryId}>
                <span>{INSPECTOR.entryLine(entryKindWords(entry.kind), amountWords(entry.amount), entry.workTitle)}</span> <Time ms={entry.createdAtMs} />
                <Button variant="ghost" aria-label={`${INSPECTOR.openEvidence}: ${entry.workTitle}`} onClick={() => onSelect({ kind: 'work', workId: entry.workId, decisionId: entry.decisionId })}>
                  {INSPECTOR.openEvidence}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {history.olderFailed && <p role="alert">{INSPECTOR.olderFailed}</p>}
        {history.hasOlder && (
          <Button onClick={history.loadOlder} disabled={history.loadingOlder}>
            {history.loadingOlder ? INSPECTOR.loadingOlder : INSPECTOR.loadOlder}
          </Button>
        )}
      </section>

      <section className="sa-arena-section" aria-label={INSPECTOR.source}>
        <h3>{INSPECTOR.source}</h3>
        <SourcePanel item={bot} collector={collector} rosterRevision={rosterRevision} attempts={attemptsData} />
      </section>

      <HandoffRow buildSummary={() => diagnosticSummary({ selection: { kind: 'specter', bindingId: specter.bindingId }, model: list, bot, work: null, xp: summary ?? null })} />
      <div className="sa-actions">
        <Button variant="ghost" onClick={onClose}>
          {INSPECTOR.close}
        </Button>
      </div>
    </div>
  );
}
