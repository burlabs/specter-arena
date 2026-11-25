import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { MINION_COUNTER } from './heroCombat';
import { EnemyObjectiveSvg, EnemyTaskSvg } from './SceneSvgs';

export type MinionType = 'patchling' | 'patchbrute';
export type MinionAnimation = 'idle' | 'engaged' | 'hit' | 'attack' | 'defeat';

export const MINION_DURATIONS_MS: Readonly<Record<MinionType, Record<MinionAnimation, number>>> = {
  patchling: { idle: 1_650, engaged: 1_100, hit: 320, attack: MINION_COUNTER.patchling.attack, defeat: 650 },
  patchbrute: { idle: 2_200, engaged: 1_400, hit: 420, attack: MINION_COUNTER.patchbrute.attack, defeat: 900 },
};

export interface AnimatedMinionProps {
  minionType: MinionType;
  animation: MinionAnimation;
  /** False when motion is reduced, the page is hidden or the user paused: no loop and no timer run. */
  animate: boolean;
  /** False while the sprite is loading or failed; the drawing fallback shows instead. */
  spriteReady: boolean;
  defeated?: boolean;
  facing?: 'left' | 'right';
  requestId?: number;
  /** Which way a `hit` pushes the minion on screen: 1 to the right, -1 to the left, away from whoever hit it. */
  recoil?: -1 | 1;
  /** A milestone recoil: the same motion, larger. It is never a health reading. */
  strong?: boolean;
  /** Which way an `attack` lunges on screen: 1 to the right, -1 to the left, toward the hero it strikes. */
  lunge?: -1 | 1;
  onAnimationComplete?: (requestId: number) => void;
}

function HitEffect({ minionType }: { minionType: MinionType }) {
  return (
    <span className={`sa-minion-impact sa-minion-impact--${minionType}`} aria-hidden="true">
      <i className="sa-minion-impact__flash" />
      <i className="sa-minion-impact__chip sa-minion-impact__chip--one" />
      <i className="sa-minion-impact__chip sa-minion-impact__chip--two" />
    </span>
  );
}

function DefeatEffect({ minionType }: { minionType: MinionType }) {
  return (
    <span className={`sa-minion-collapse sa-minion-collapse--${minionType}`} aria-hidden="true">
      <i className="sa-minion-collapse__dust" />
      <i className="sa-minion-collapse__mote sa-minion-collapse__mote--one" />
      <i className="sa-minion-collapse__mote sa-minion-collapse__mote--two" />
    </span>
  );
}

/**
 * Decorative only: the animation says nothing about progress, health or acceptance. A one-shot (hit, attack, defeat)
 * reports completion once, by timer when animated and at once when static.
 */
export function AnimatedMinion({ minionType, animation, animate, spriteReady, defeated = false, facing = 'left', requestId = 0, recoil = 1, strong = false, lunge = 1, onAnimationComplete }: AnimatedMinionProps) {
  const completion = useRef(onAnimationComplete);
  completion.current = onAnimationComplete;
  const oneShot = animation === 'hit' || animation === 'attack' || animation === 'defeat';

  useEffect(() => {
    if (!oneShot) return;
    if (!animate) {
      completion.current?.(requestId);
      return;
    }
    const timer = window.setTimeout(() => completion.current?.(requestId), MINION_DURATIONS_MS[minionType][animation]);
    return () => window.clearTimeout(timer);
  }, [oneShot, animate, animation, minionType, requestId]);

  const classes = ['sa-minion', `sa-minion--${minionType}`, `sa-is-${animation}`, animate ? 'sa-is-animated' : 'sa-is-static'];
  if (defeated) classes.push('sa-is-defeated');
  if (animation === 'hit' && strong) classes.push('sa-is-strong');
  const style =
    animation === 'hit' ? ({ '--sa-recoil': recoil, '--sa-recoil-mag': strong ? 1.8 : 1 } as CSSProperties) : animation === 'attack' ? ({ '--sa-lunge': lunge } as CSSProperties) : undefined;
  return (
    <span key={`${animation}:${requestId}`} className={classes.join(' ')} style={style} data-minion={minionType} data-facing={facing} aria-hidden="true">
      {spriteReady ? <span className="sa-minion__art" /> : minionType === 'patchbrute' ? <EnemyObjectiveSvg title="" decorative className="sa-minion__fallback" /> : <EnemyTaskSvg title="" decorative className="sa-minion__fallback" />}
      {animation === 'hit' && <HitEffect minionType={minionType} />}
      {animation === 'defeat' && <DefeatEffect minionType={minionType} />}
    </span>
  );
}
