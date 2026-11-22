import type { HeroesItemV1 } from '../contracts/types';
import { HeroThumb } from './HeroThumb';
import { ASSIGN } from './copy';

interface Props {
  /** Radio group name; unique per mounted group. */
  name: string;
  label: string;
  heroes: readonly HeroesItemV1[];
  value: string | null;
  onChange: (heroId: string) => void;
  size: number;
  disabled?: boolean;
}

/** The 11 heroes as one radio group of thumbnails: one tab stop, arrow keys to move, "held by N" under each name. */
export function HeroChoice({ name, label, heroes, value, onChange, size, disabled = false }: Props) {
  return (
    <div role="radiogroup" aria-label={label} className="sa-hero-choice">
      {heroes.map((hero) => (
        <label key={hero.heroId} className="sa-hero-choice__item" data-hero-id={hero.heroId}>
          <input type="radio" name={name} value={hero.heroId} checked={hero.heroId === value} disabled={disabled} onChange={() => onChange(hero.heroId)} className="sa-hero-choice__input" />
          <span className="sa-portrait sa-portrait--md" aria-hidden="true">
            <HeroThumb heroId={hero.heroId} name={hero.name} size={size} />
          </span>
          <span className="sa-hero-choice__name">{hero.name}</span>{' '}
          <span className="sa-hero-choice__held">{ASSIGN.held(hero.assignedCount)}</span>
        </label>
      ))}
    </div>
  );
}
