import type { XpSummaryV1 } from '../contracts/types';
import { XP } from '../work/copy';
import { levelSpan } from '../work/model';

/** What a level bar shows, from the XP fields of one summary and nothing else. */
export interface XpBar {
  /** "50 of 150 XP toward level 3", or "Top level reached". */
  label: string;
  /** 0 to 100, rounded; 100 at the top level. */
  percent: number;
  valueMax: number;
  valueNow: number;
  /** True when there is no next level. `XpMeter` then shows words only; `SpecterProgression` shows a full bar. */
  top: boolean;
}

export function xpBarOf(summary: XpSummaryV1): XpBar {
  const { into, span } = levelSpan(summary);
  if (span === null) return { label: XP.topLevel, percent: 100, valueMax: 1, valueNow: 1, top: true };
  return {
    label: XP.toward(into, span, summary.level + 1),
    percent: Math.min(100, Math.round((into / span) * 100)),
    valueMax: span,
    valueNow: Math.min(into, span),
    top: false,
  };
}
