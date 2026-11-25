import { ARENA } from './copy';

interface Props {
  botsObserved: number;
  coverageUnknown: number;
  committedXp: number;
  /** While the ledger has not been read, the card says so instead of showing a zero. */
  xpReading?: 'ready' | 'loading' | 'failed';
}

/** Three counts the arena already holds. A zero is a real zero here: the figures come from the roster and the ledger the arena just read. */
export function ArenaStats({ botsObserved, coverageUnknown, committedXp, xpReading = 'ready' }: Props) {
  const cards = [
    [ARENA.botsObserved, botsObserved],
    [ARENA.coverageUnknown, coverageUnknown],
    [ARENA.committedXp, xpReading === 'loading' ? ARENA.xpLoading : xpReading === 'failed' ? ARENA.xpUnavailable : committedXp],
  ] as const;
  return (
    <div role="group" aria-label={ARENA.statsLabel}>
      <dl className="sa-arena-stats">
        {cards.map(([label, value]) => (
          <div key={label} className="sa-arena-stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
