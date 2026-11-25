import type { CSSProperties } from 'react';
import { anchorOf, heroSpriteKey, idleMsOf } from '../specters/heroes';
import { AttackEffect, CastEffect } from './HeroEffects';
import { combatTimingOf } from './heroCombat';
import { useSceneAsset } from './useSceneAsset';

export type HeroAnimation = 'idle' | 'attack' | 'cast' | 'flinch';

interface Props {
  heroId: string;
  /** False when motion is reduced, the page is hidden or the user paused: no loop runs and no effect layer is drawn. */
  animate: boolean;
  initials: string;
  /** A one-shot the exchange planner asked for. Anything but `idle` is drawn only while `animate` is true. */
  animation?: HeroAnimation;
  /** Degrees toward the target, already clamped. */
  angle?: number;
  /** -1 when the target stands to the left of the hero: the effect layer is mirrored, never turned over. A flinch recoils away from it. */
  flip?: 1 | -1;
}

const SPRITE_SIZE = 44;

/** Decorative only: the idle motion, the attack and the cast say nothing about progress, health or acceptance. */
export function AnimatedSpecter({ heroId, animate, initials, animation = 'idle', angle = 0, flip = 1 }: Props) {
  const sprite = useSceneAsset(heroSpriteKey(heroId));
  if (sprite.status !== 'ready') return <span className="sa-token__placeholder" aria-hidden="true" data-initials={initials} />;
  const [anchorX, anchorY] = anchorOf(heroId);
  const playing: HeroAnimation = animate && animation !== 'idle' && combatTimingOf(heroId) !== null ? animation : 'idle';
  const style = { '--sa-ax': anchorX, '--sa-idle-ms': `${idleMsOf(heroId)}ms`, '--sa-flinch': -flip, transformOrigin: `${(anchorX * 100).toFixed(2)}% ${(anchorY * 100).toFixed(2)}%` } as CSSProperties;
  const fx = { '--sa-fx-angle': `${angle.toFixed(1)}deg`, '--sa-fx-flip': flip } as CSSProperties;
  return (
    <span className={`sa-hero sa-hero--${heroId} sa-is-${playing} ${animate ? 'sa-is-animated' : 'sa-is-static'}`} aria-hidden="true" data-hero={heroId} data-animation={playing} style={style}>
      <img className="sa-hero__img" src={sprite.art.url} alt="" width={SPRITE_SIZE} height={SPRITE_SIZE} draggable={false} />
      {(playing === 'attack' || playing === 'cast') && (
        <span className="sa-hero__fx" style={fx}>
          {playing === 'attack' ? <AttackEffect heroId={heroId} /> : <CastEffect heroId={heroId} />}
        </span>
      )}
    </span>
  );
}
