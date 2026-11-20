import type { HeroesItemV1 } from '../contracts/types';
import { COLLECTION } from './copy';
import { HeroThumb } from './HeroThumb';

const CARD_ART_SIZE = 96;

/** A roster hero that no bot holds yet. Not a button: it cannot be selected, and nothing here assigns a hero. */
export function HeroCard({ hero }: { hero: HeroesItemV1 }) {
  return (
    <li className="sa-hero-card" data-hero-id={hero.heroId}>
      <span className="sa-portrait sa-portrait--md" aria-hidden="true">
        <HeroThumb heroId={hero.heroId} name={hero.name} size={CARD_ART_SIZE} />
      </span>
      <span className="sa-hero-card__names">
        <strong>{hero.name}</strong>
        <span className="sa-hero-card__epithet">{hero.epithet}</span>
        <span className="sa-hero-card__state">{COLLECTION.noBotYet}</span>
      </span>
    </li>
  );
}
