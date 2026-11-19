import type { CSSProperties } from 'react';
import { anchorOf, heroSpriteKey, idleMsOf } from '../specters/heroes';
import { useSceneAsset } from './useSceneAsset';

interface Props {
  heroId: string;
  /** False when motion is reduced, the page is hidden or the user paused: no loop runs. */
  animate: boolean;
  initials: string;
}

const SPRITE_SIZE = 44;

/** Decorative only: the idle motion says nothing about progress, health or acceptance. */
export function AnimatedSpecter({ heroId, animate, initials }: Props) {
  const sprite = useSceneAsset(heroSpriteKey(heroId));
  if (sprite.status !== 'ready') return <span className="sa-token__placeholder" aria-hidden="true" data-initials={initials} />;
  const [anchorX, anchorY] = anchorOf(heroId);
  const style = { '--sa-ax': anchorX, '--sa-idle-ms': `${idleMsOf(heroId)}ms`, transformOrigin: `${(anchorX * 100).toFixed(2)}% ${(anchorY * 100).toFixed(2)}%` } as CSSProperties;
  return (
    <span className={`sa-hero sa-hero--${heroId} sa-is-idle ${animate ? 'sa-is-animated' : 'sa-is-static'}`} aria-hidden="true" data-hero={heroId} style={style}>
      <img className="sa-hero__img" src={sprite.art.url} alt="" width={SPRITE_SIZE} height={SPRITE_SIZE} draggable={false} />
    </span>
  );
}
