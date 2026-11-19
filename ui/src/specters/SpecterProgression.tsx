import type { XpSummaryV1 } from '../contracts/types';
import { XP } from '../work/copy';
import { levelSpan } from '../work/model';

interface Props {
  /** `undefined` when the ledger has no entry for the bot: level 1 and 0 XP, with no bar. */
  summary: XpSummaryV1 | undefined;
  compact?: boolean;
  /** XP could not be read, so the card says so in words and never shows a zero. */
  unavailable?: 'loading' | 'failed';
}

/** Level, bar and XP of one bot, from the same fields and words as `XpMeter`. */
export function SpecterProgression({ summary, compact = false, unavailable }: Props) {
  const className = `sa-progression${compact ? ' sa-progression--compact' : ''}`;
  if (unavailable !== undefined) {
    return (
      <div className={className}>
        <small className="sa-help">{unavailable === 'loading' ? XP.loading : XP.failed}</small>
      </div>
    );
  }
  if (summary === undefined) {
    return (
      <div className={className}>
        <strong>{XP.levelWord(1)}</strong>
        <small>{`0 ${XP.xp}`}</small>
      </div>
    );
  }
  const { into, span } = levelSpan(summary);
  const label = span === null ? XP.topLevel : XP.toward(into, span, summary.level + 1);
  const percent = span === null ? 100 : Math.min(100, Math.round((into / span) * 100));
  return (
    <div className={className}>
      <strong>{XP.levelWord(summary.level)}</strong>
      <div className="sa-xp-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={span ?? 1} aria-valuenow={span === null ? 1 : Math.min(into, span)}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{summary.nextLevelXp === null ? `${summary.totalXp} ${XP.xp}` : `${summary.totalXp} / ${summary.nextLevelXp} ${XP.xp}`}</small>
    </div>
  );
}
