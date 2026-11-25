import type { AttemptsV1, RosterCollectorV1, RosterItemV1 } from '../contracts/types';
import { Time } from './Time';
import { SIGNAL_LABELS, signalWords } from './copy';
import { sourceRows } from './model';

interface Props {
  item: RosterItemV1;
  collector: RosterCollectorV1;
  rosterRevision: number;
  attempts: AttemptsV1 | null;
}

export function SourcePanel({ item, collector, rosterRevision, attempts }: Props) {
  return (
    <div className="sa-source">
      <dl className="sa-counts">
        {sourceRows(item, collector, rosterRevision, attempts).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{'text' in row ? row.text : <Time ms={row.ms} long />}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="sa-raw-signals">
        <h3 id="sa-raw-signals">Raw signals from Crew (unverified, not used for the condition)</h3>
        <dl className="sa-counts">
          {SIGNAL_LABELS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{signalWords(item.condition.signals[key])}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
