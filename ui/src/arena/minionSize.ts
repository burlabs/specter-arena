import type { TaskSizeClassV1 } from '../contracts/types';
import { ENEMY_CELL } from './sceneLayout';

/** How much larger than the base a minion is drawn. Presentation only: never progress, health, effort or XP. */
export const MINION_SCALE: Readonly<Record<TaskSizeClassV1, number>> = { small: 0.8, medium: 1, large: 1.3 };
/** The base minion size in px. `arena.css` carries the same number as the fallback of `--sa-minion-base`. */
export const MINION_BASE_PX = 28;
/** The largest minion fills at most this share of one lattice cell across. */
export const MINION_FIT = 0.95;

/** The base minion size for a map shown `stageWidthPx` wide: 28 px, or less when a large minion would not fit one lattice cell. */
export function minionBasePx(stageWidthPx: number): number {
  return Math.min(MINION_BASE_PX, (stageWidthPx * ENEMY_CELL.x * MINION_FIT) / MINION_SCALE.large);
}
