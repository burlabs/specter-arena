import { ARENA } from './copy';

interface Props {
  botsObserved: number;
  coverageUnknown: number;
  committedXp: number;
}

/** Three counts the arena already holds. A zero is a real zero here: the figures come from the roster and the ledger the arena just read. */
export function ArenaStats({ botsObserved, coverageUnknown, committedXp }: Props) {
  const cards = [
    [ARENA.botsObserved, botsObserved],
    [ARENA.coverageUnknown, coverageUnknown],
    [ARENA.committedXp, committedXp],
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
