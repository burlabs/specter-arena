import type { CSSProperties } from 'react';
import { useSceneAsset } from '../arena/useSceneAsset';
import { heroThumbnailKey } from './heroes';
import { tokenHue, tokenInitials } from './model';

interface Props {
  heroId: string;
  name: string;
  size: number;
  /** True when a printed name already sits beside the picture. */
  decorative?: boolean;
}

/** A hero's 96 px thumbnail. While it loads, and if it fails, the initials token shows instead. */
export function HeroThumb({ heroId, name, size, decorative = true }: Props) {
  const art = useSceneAsset(heroThumbnailKey(heroId));
  if (art.status !== 'ready') {
    return <span className="sa-portrait__token" style={{ '--sa-hue': tokenHue(heroId) } as CSSProperties} aria-hidden="true" data-initials={tokenInitials(name)} />;
  }
  return <img className="sa-portrait__img" src={art.art.url} width={size} height={size} alt={decorative ? '' : name} />;
}
