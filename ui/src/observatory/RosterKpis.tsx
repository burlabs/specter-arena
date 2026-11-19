import type { RosterItemV1 } from '../contracts/types';

/** Three counts over the bots the roster holds. Nothing here is a rate or a score. */
export function RosterKpis({ items }: { items: readonly RosterItemV1[] }) {
  const cards = [
    ['Tracked bots', items.length],
    ['Working now', items.filter((item) => item.condition.state === 'working').length],
    ['Coverage gaps', items.filter((item) => item.coverage.state === 'gap').length],
  ] as const;
  return (
    <div role="group" aria-label="Roster summary">
      <dl className="sa-kpis">
        {cards.map(([label, value]) => (
          <div key={label} className="sa-kpi">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
