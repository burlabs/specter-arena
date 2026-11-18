import type { XpSummaryV1 } from '../contracts/types';
import { XP } from './copy';
import { levelSpan } from './model';

/** The bar width comes from the XP fields of the summary and nothing else. */
export function XpMeter({ summary }: { summary: XpSummaryV1 }) {
  const { into, span } = levelSpan(summary);
  if (span === null) return <p className="sa-work-xp-note">{XP.topLevel}</p>;
  const label = XP.toward(into, span, summary.level + 1);
  const percent = Math.min(100, Math.round((into / span) * 100));
  return (
    <div className="sa-xp-meter">
      <div className="sa-xp-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={span} aria-valuenow={Math.min(into, span)}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="sa-work-xp-note">{label}</p>
    </div>
  );
}
