import { Time } from './Time';
import { CONTEXT_COPY, contextWords } from './copy';
import type { RosterTokenReadingV2 } from '../contracts/types';

/** Operational gauge only: never XP, never a total, never ranked or compared. Null reads "Not collected", never 0. */
export function TokenStat({ reading }: { reading: RosterTokenReadingV2 | null }) {
  return (
    <section className="sa-card sa-tokens" aria-label={CONTEXT_COPY.heading}>
      <h3>{CONTEXT_COPY.heading}</h3>
      <p className="sa-help">{CONTEXT_COPY.note}</p>
      {reading === null ? (
        <p>
          {CONTEXT_COPY.notCollected}. {CONTEXT_COPY.notCollectedWhy}
        </p>
      ) : (
        <dl className="sa-counts">
          <dt>{CONTEXT_COPY.inUse}</dt>
          <dd>{contextWords(reading.used, reading.window)}</dd>
          <dt>{CONTEXT_COPY.read}</dt>
          <dd>
            <Time ms={reading.observedAt} />
          </dd>
        </dl>
      )}
    </section>
  );
}
