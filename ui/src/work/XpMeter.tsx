import type { XpSummaryV1 } from '../contracts/types';
import { xpBarOf } from '../specters/xpBar';

/** The bar width comes from the XP fields of the summary and nothing else. */
export function XpMeter({ summary }: { summary: XpSummaryV1 }) {
  const bar = xpBarOf(summary);
  if (bar.top) return <p className="sa-work-xp-note">{bar.label}</p>;
  return (
    <div className="sa-xp-meter">
      <div className="sa-xp-bar" role="progressbar" aria-label={bar.label} aria-valuemin={0} aria-valuemax={bar.valueMax} aria-valuenow={bar.valueNow}>
        <span style={{ width: `${bar.percent}%` }} />
      </div>
      <p className="sa-work-xp-note">{bar.label}</p>
    </div>
  );
}
