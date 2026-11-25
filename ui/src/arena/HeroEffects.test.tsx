import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '../contracts/types';
import css from './arena.css?raw';
import { AttackEffect, CastEffect } from './HeroEffects';

describe('HeroEffects', () => {
  it.each(HERO_IDS)('draws an attack and a cast layer for %s, hidden from assistive technology, with every class styled', (heroId) => {
    for (const Layer of [AttackEffect, CastEffect]) {
      const { container, unmount } = render(<Layer heroId={heroId} />);
      const root = container.firstElementChild;
      expect(root?.getAttribute('aria-hidden')).toBe('true');
      expect(root?.className).toContain(`sa-fx-${heroId}-`);
      const classes = new Set([...container.querySelectorAll('[class]'), root!].flatMap((element) => element.getAttribute('class')!.split(/\s+/)));
      // Three first-of-a-kind modifiers are unstyled in the export too; the base class carries their style.
      for (const name of classes) if (!/(projectile|ray|drop)--one$/.test(name)) expect(css, `${heroId} ${name}`).toContain(`.${name}`);
      unmount();
    }
  });

  it('draws nothing for a hero id it does not know', () => {
    expect(render(<AttackEffect heroId="newcomer" />).container.innerHTML).toBe('');
    expect(render(<CastEffect heroId="newcomer" />).container.innerHTML).toBe('');
  });
});
