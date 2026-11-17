import { useId } from 'react';
import { LEGEND } from './copy';

export function OperationalLegend({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const panelId = useId();
  return (
    <div className="sa-legend">
      <button type="button" className="sa-legend__toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        What the states mean
        <span aria-hidden="true">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <dl id={panelId} className="sa-legend__items">
          {LEGEND.map((entry) => (
            <div key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
