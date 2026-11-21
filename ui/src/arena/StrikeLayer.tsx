import type { CSSProperties } from 'react';
import type { ExchangeSnapshot } from './exchangePlanner';
import { combatTimingOf, strikeColorOf } from './heroCombat';

/** Where a hero and its target stand, in the same 0-1 stage units as the tokens, and the size of the stage in pixels. */
export interface StrikeGeometry {
  from: { x: number; y: number };
  to: { x: number; y: number };
  stageWidth: number;
  stageHeight: number;
}

export interface StrikeShot {
  key: string;
  heroId: string;
  kind: 'attack' | 'cast';
  geometry: StrikeGeometry;
}

/** The sprite's centre sits this far above its token's anchor, and the enemy's a little further. */
export const STRIKE_FROM_LIFT_PX = 34;
export const STRIKE_TO_LIFT_PX = 30;

/**
 * One bright bolt per playing exchange, travelling along the engagement line so it lands at the hero's impact time.
 * It exists only while the exchange plays (so never under reduced motion and never past the 8-layer cap), carries
 * no number and no bar, and says nothing about damage or progress.
 */
export function StrikeLayer({ shots }: { shots: readonly StrikeShot[] }) {
  return (
    <div className="sa-strike-layer" aria-hidden="true">
      {shots.map((shot) => {
        const timing = combatTimingOf(shot.heroId);
        if (timing === null) return null;
        const { from, to, stageWidth, stageHeight } = shot.geometry;
        const dx = (to.x - from.x) * stageWidth;
        const dy = (to.y - from.y) * stageHeight - (STRIKE_TO_LIFT_PX - STRIKE_FROM_LIFT_PX);
        const impact = shot.kind === 'cast' ? timing.castImpact : timing.attackImpact;
        const style = {
          left: `${from.x * 100}%`,
          top: `${from.y * 100}%`,
          '--sa-sx': `${dx.toFixed(1)}px`,
          '--sa-sy': `${dy.toFixed(1)}px`,
          '--sa-strike-ms': `${impact}ms`,
          '--sa-strike-color': strikeColorOf(shot.heroId),
          '--sa-strike-angle': `${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}deg`,
        } as CSSProperties;
        return (
          <span key={shot.key} className={`sa-strike sa-strike--${shot.kind}`} data-strike={shot.heroId} style={style}>
            <i className="sa-strike__bolt" />
            <i className="sa-strike__head" />
          </span>
        );
      })}
    </div>
  );
}

/** The strikes to draw for a snapshot, with a position for both ends; a hero or enemy with no placement draws none. */
export function strikeShotsOf(
  snapshot: ExchangeSnapshot,
  heroIdOf: (bindingId: string) => string | null,
  from: (bindingId: string) => { x: number; y: number } | undefined,
  to: (workId: string) => { x: number; y: number } | undefined,
  stage: { width: number; height: number },
): StrikeShot[] {
  const shots: StrikeShot[] = [];
  for (const [bindingId, view] of snapshot.heroes) {
    const heroId = heroIdOf(bindingId);
    const a = from(bindingId);
    const b = to(view.workId);
    if (heroId === null || a === undefined || b === undefined) continue;
    shots.push({ key: `${bindingId}:${view.exchangeId}`, heroId, kind: view.kind, geometry: { from: a, to: b, stageWidth: stage.width, stageHeight: stage.height } });
  }
  return shots;
}
