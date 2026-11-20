import type { XpSummaryV1 } from '../contracts/types';
import { XP } from '../work/copy';
import { xpBarOf } from './xpBar';

interface Props {
  /** `undefined` when the ledger has no entry for the bot: level 1 and 0 XP, with no bar. */
  summary: XpSummaryV1 | undefined;
  /** Inside a button: phrasing elements only, and the bar is decoration (the level and "n / m XP" text carry the facts). */
  compact?: boolean;
  /** XP could not be read, so the card says so in words and never shows a zero. */
  unavailable?: 'loading' | 'failed';
}

/** Level, bar and XP of one bot, from the same fields and words as `XpMeter`. */
export function SpecterProgression({ summary, compact = false, unavailable }: Props) {
  const className = `sa-progression${compact ? ' sa-progression--compact' : ''}`;
  const Box = compact ? 'span' : 'div';
  if (unavailable !== undefined) {
    return (
      <Box className={className}>
        <small className="sa-help">{unavailable === 'loading' ? XP.loading : XP.failed}</small>
      </Box>
    );
  }
  if (summary === undefined) {
    return (
      <Box className={className}>
        <strong>{XP.levelWord(1)}</strong>
        <small>{`0 ${XP.xp}`}</small>
      </Box>
    );
  }
  const bar = xpBarOf(summary);
  const fill = <span style={{ width: `${bar.percent}%` }} />;
  return (
    <Box className={className}>
      <strong>{XP.levelWord(summary.level)}</strong>
      {compact ? (
        <span className="sa-xp-bar" aria-hidden="true">
          {fill}
        </span>
      ) : (
        <div className="sa-xp-bar" role="progressbar" aria-label={bar.label} aria-valuemin={0} aria-valuemax={bar.valueMax} aria-valuenow={bar.valueNow}>
          {fill}
        </div>
      )}
      <small>{summary.nextLevelXp === null ? `${summary.totalXp} ${XP.xp}` : `${summary.totalXp} / ${summary.nextLevelXp} ${XP.xp}`}</small>
    </Box>
  );
}
