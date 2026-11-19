import type { CSSProperties } from 'react';
import type { SpecterV2 } from '../contracts/types';
import { TOKEN_CAPTION, TOKEN_FAILED_CAPTION } from './copy';
import { tokenHue, tokenInitials } from './model';
import { useAsset } from './useAsset';
import { useMotionAllowed } from './useMotionAllowed';

export type PortraitSize = 'sm' | 'md' | 'lg';

interface Props {
  specter: SpecterV2;
  size: PortraitSize;
  /** Hides the portrait from assistive technology; the row prints the Specter name as text. */
  decorative?: boolean;
  /** Derived from the bot's roster condition only; drives a CSS ring and nothing else. */
  active?: boolean;
}

export function SpecterPortrait({ specter, size, decorative = false, active = false }: Props) {
  const asset = useAsset(specter.portrait.assetId);
  const motion = useMotionAllowed();
  const name = specter.displayName;
  const showImage = asset.status === 'ready' && asset.src !== null;
  const showToken = asset.status === 'none' || asset.status === 'failed';
  const caption = asset.status === 'failed' ? TOKEN_FAILED_CAPTION : TOKEN_CAPTION;
  const framed = size !== 'sm';
  const classes = ['sa-portrait', `sa-portrait--${size}`];
  if (motion && framed) classes.push('sa-portrait--float');
  if (motion && active) classes.push('sa-portrait--active');
  if (asset.status === 'loading') classes.push('sa-portrait--loading');

  const hidden = decorative || framed;
  const frame = (
    <span className={classes.join(' ')} aria-hidden={decorative ? 'true' : undefined} data-portrait={showImage ? 'image' : showToken ? 'token' : 'loading'}>
      {showImage && <img className="sa-portrait__img" src={asset.src ?? undefined} alt={decorative ? '' : `Portrait of ${name}`} width={SIZES[size]} height={SIZES[size]} />}
      {showToken && (
        <span
          className="sa-portrait__token"
          style={{ '--sa-hue': tokenHue(specter.bindingId) } as CSSProperties}
          role={hidden ? undefined : 'img'}
          aria-label={hidden ? undefined : `${name}: ${caption}`}
          aria-hidden={framed ? 'true' : undefined}
          data-initials={decorative ? tokenInitials(name) : undefined}
        >
          {decorative ? null : tokenInitials(name)}
        </span>
      )}
    </span>
  );
  if (!framed) return frame;
  return (
    <span className="sa-portrait-wrap">
      {frame}
      {showToken && <span className="sa-caption">{caption}</span>}
    </span>
  );
}

const SIZES: Readonly<Record<PortraitSize, number>> = { sm: 32, md: 96, lg: 160 };
