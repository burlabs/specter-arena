import { useEffect, useRef } from 'react';
import { EnemyObjectiveSvg, EnemyTaskSvg } from './SceneSvgs';

export type MinionType = 'patchling' | 'patchbrute';
export type MinionAnimation = 'idle' | 'engaged' | 'hit' | 'defeat';

export const MINION_DURATIONS_MS: Readonly<Record<MinionType, Record<MinionAnimation, number>>> = {
  patchling: { idle: 1_650, engaged: 1_100, hit: 320, defeat: 650 },
  patchbrute: { idle: 2_200, engaged: 1_400, hit: 420, defeat: 900 },
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
 * Decorative only: the animation says nothing about progress, health or acceptance. A one-shot (hit, defeat)
 * reports completion once, by timer when animated and at once when static.
 */
export function AnimatedMinion({ minionType, animation, animate, spriteReady, defeated = false, facing = 'left', requestId = 0, onAnimationComplete }: AnimatedMinionProps) {
  const completion = useRef(onAnimationComplete);
  completion.current = onAnimationComplete;
  const oneShot = animation === 'hit' || animation === 'defeat';

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
  return (
    <span key={`${animation}:${requestId}`} className={classes.join(' ')} data-minion={minionType} data-facing={facing} aria-hidden="true">
      {spriteReady ? <span className="sa-minion__art" /> : minionType === 'patchbrute' ? <EnemyObjectiveSvg title="" decorative className="sa-minion__fallback" /> : <EnemyTaskSvg title="" decorative className="sa-minion__fallback" />}
      {animation === 'hit' && <HitEffect minionType={minionType} />}
      {animation === 'defeat' && <DefeatEffect minionType={minionType} />}
    </span>
  );
}
