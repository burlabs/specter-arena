import type { ReactNode } from 'react';
import { LEVEL_NOTE, XP } from './copy';
import { XpMeter } from './XpMeter';
import type { XpView } from './useXp';

const TITLES = [XP.acceptedWork, XP.xp, XP.level] as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sa-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Failure and loading are words. A missing figure is never shown as 0. */
export function XpCards({ xp }: { xp: XpView }) {
  if (xp.status !== 'ready') {
    const words = xp.status === 'loading' ? XP.loading : xp.failure === 'unsupported' ? XP.unsupported : XP.failed;
    return (
      <div className="sa-cards">
        {TITLES.map((title) => (
          <Card key={title} title={title}>
            <p>{words}</p>
          </Card>
        ))}
      </div>
    );
  }
  const summary = xp.summary;
  return (
    <div className="sa-cards">
      <Card title={XP.acceptedWork}>
        <p className="sa-work-xp-amount">{summary === null ? 0 : summary.acceptedWorkCount}</p>
      </Card>
      <Card title={XP.xp}>
        <p>
          <span className="sa-work-xp-amount">{summary === null ? 0 : summary.totalXp}</span> {XP.unit}
        </p>
      </Card>
      <Card title={XP.level}>
        <p className="sa-work-xp-amount">{XP.levelWord(summary === null ? 1 : summary.level)}</p>
        {summary !== null && <XpMeter summary={summary} />}
        <p className="sa-help">{LEVEL_NOTE}</p>
      </Card>
    </div>
  );
}
