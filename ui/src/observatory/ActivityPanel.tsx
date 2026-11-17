import type { AttemptsActivityV1, AttemptsWindowV1 } from '../contracts/types';
import { Time } from './Time';
import { METRIC_DEFINITIONS } from './copy';
import { coverageSentence } from './model';

const WINDOWS = [
  ['24 hours', '24 h', 'last24h'],
  ['7 days', '7 d', 'last7d'],
] as const;

function Window({ title, label, window }: { title: string; label: '24 h' | '7 d'; window: AttemptsWindowV1 }) {
  const empty = window.coveredMs <= 0 && window.sampleSize === 0;
  return (
    <section className="sa-card" aria-label={`Last ${title}`}>
      <h3>{`Last ${title}`}</h3>
      <p className="sa-facts">
        From <Time ms={window.fromMs} /> to <Time ms={window.toMs} />
      </p>
      <p>{coverageSentence(window, label)}</p>
      {empty ? (
        <p>No collected time in this window, so there are no counts.</p>
      ) : (
        <dl className="sa-counts">
          <dt>Sample size</dt>
          <dd>{window.sampleSize}</dd>
          <dt>Bot turns started</dt>
          <dd>{window.botTurnsStarted}</dd>
          <dt>Workers started</dt>
          <dd>{window.workersStarted}</dd>
          <dt>Working</dt>
          <dd>{window.stillOpen}</dd>
          <dt>Ended</dt>
          <dd>{window.ended}</dd>
          <dt>Unknown</dt>
          <dd>{window.unknown}</dd>
        </dl>
      )}
    </section>
  );
}

export function ActivityPanel({ activity }: { activity: AttemptsActivityV1 }) {
  return (
    <div className="sa-activity">
      <div className="sa-cards">
        {WINDOWS.map(([title, label, key]) => (
          <Window key={key} title={title} label={label} window={activity[key]} />
        ))}
      </div>
      <details className="sa-glossary">
        <summary>How these counts work</summary>
        <dl>
          {METRIC_DEFINITIONS.map((entry) => (
            <div key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
