import { useId } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { COVERAGE_STATE_WORDS, PRESENCE_WORDS, UNAVAILABLE_TEXT, reasonWords } from './copy';
import { ConditionBadge } from './ConditionBadge';
import { Time } from './Time';
import { botCondition, nameOf, workerChips } from './model';

const UNAVAILABLE_CARDS = ['Accepted work', 'XP', 'Level'] as const;

export function BotSummary({ item }: { item: RosterItemV1 }) {
  const headingId = useId();
  const condition = botCondition(item.condition);
  const { coverage } = item;
  return (
    <section className="sa-detail" aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        {nameOf(item)}
      </h2>
      <div className="sa-chips">
        <ConditionBadge view={condition} />
        {workerChips(item.workers).map((chip) => (
          <span key={chip.key} className={`sa-chip sa-chip--${chip.key}`}>
            {chip.text}
          </span>
        ))}
      </div>
      <p>{condition.reason}</p>
      <div className="sa-facts">
        <p>{PRESENCE_WORDS[item.presence] ?? item.presence}</p>
        <p>
          {COVERAGE_STATE_WORDS[coverage.state] ?? coverage.state}
          {coverage.reasonCode !== null && `. ${reasonWords(coverage.reasonCode)}`}
        </p>
        {coverage.sinceMs !== null && (
          <p>
            Collecting since <Time ms={coverage.sinceMs} />
          </p>
        )}
        {coverage.openGapCount > 0 && (
          <p>{`${coverage.openGapCount} open ${coverage.openGapCount === 1 ? 'gap' : 'gaps'}`}</p>
        )}
        <p>
          Last observed <Time ms={item.lastObservedAtMs} />
        </p>
      </div>
      <div className="sa-cards">
        {UNAVAILABLE_CARDS.map((title) => (
          <div key={title} className="sa-card">
            <h3>{title}</h3>
            <p>{UNAVAILABLE_TEXT}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
