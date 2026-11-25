import { useId } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { XpCards } from '../work/XpCards';
import type { XpView } from '../work/useXp';
import { COVERAGE_STATE_WORDS, PRESENCE_WORDS, reasonWords } from './copy';
import { ConditionBadge } from './ConditionBadge';
import { Time } from './Time';
import { botCondition, nameOf, workerChips } from './model';

export function BotSummary({ item, xp }: { item: RosterItemV1; xp: XpView }) {
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
      <XpCards xp={xp} />
    </section>
  );
}
