import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '../contracts/types';
import type { ExchangeSnapshot } from './exchangePlanner';
import { HERO_COMBAT, STRIKE_RGB, strikeColorOf } from './heroCombat';
import { STRIKE_FROM_LIFT_PX, STRIKE_TO_LIFT_PX, StrikeLayer, strikeShotsOf } from './StrikeLayer';

const geometry = { from: { x: 0.1, y: 0.9 }, to: { x: 0.5, y: 0.1 }, stageWidth: 1000, stageHeight: 500 };

describe('StrikeLayer', () => {
  it('draws one hidden strike per shot, landing at the hero impact time, with the end offset in pixels', () => {
    const { container } = render(<StrikeLayer shots={[{ key: 'a:1', heroId: 'vell', kind: 'attack', geometry }, { key: 'b:2', heroId: 'bur', kind: 'cast', geometry }]} />);
    const layer = container.firstElementChild as HTMLElement;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    const [attack, cast] = [...layer.querySelectorAll<HTMLElement>('.sa-strike')];
    expect(attack?.className).toContain('sa-strike--attack');
    expect(attack?.getAttribute('data-strike')).toBe('vell');
    expect(attack?.style.getPropertyValue('--sa-strike-ms')).toBe(`${HERO_COMBAT.vell.attackImpact}ms`);
    expect(attack?.style.getPropertyValue('--sa-sx')).toBe('400.0px');
    expect(attack?.style.getPropertyValue('--sa-sy')).toBe(`${(-0.8 * 500 - (STRIKE_TO_LIFT_PX - STRIKE_FROM_LIFT_PX)).toFixed(1)}px`);
    expect(attack?.style.left).toBe('10%');
    expect(attack?.style.getPropertyValue('--sa-strike-color')).toBe(STRIKE_RGB.vell);
    expect(cast?.className).toContain('sa-strike--cast');
    expect(cast?.style.getPropertyValue('--sa-strike-ms')).toBe(`${HERO_COMBAT.bur.castImpact}ms`);
    expect(attack?.querySelectorAll('i')).toHaveLength(2);
  });

  it('draws nothing for no shots or for a hero with no combat timing', () => {
    expect(render(<StrikeLayer shots={[]} />).container.querySelectorAll('.sa-strike')).toHaveLength(0);
    expect(render(<StrikeLayer shots={[{ key: 'x', heroId: 'newcomer', kind: 'attack', geometry }]} />).container.querySelectorAll('.sa-strike')).toHaveLength(0);
  });

  it('has a colour for every hero and a fallback for an unknown one', () => {
    for (const id of HERO_IDS) expect(strikeColorOf(id)).toBe(STRIKE_RGB[id]);
    expect(strikeColorOf('newcomer')).toBe('rgb(255, 208, 128)');
  });
});

describe('strikeShotsOf', () => {
  const snapshot: ExchangeSnapshot = {
    heroes: new Map([
      ['a', { exchangeId: 1, kind: 'attack', workId: 'w1' }],
      ['b', { exchangeId: 2, kind: 'cast', workId: 'w2' }],
      ['c', { exchangeId: 3, kind: 'attack', workId: 'w1' }],
      ['d', { exchangeId: 4, kind: 'attack', workId: 'w9' }],
    ]),
    enemies: new Map(),
    layers: 4,
  };

  it('keeps only shots whose hero id and both positions are known', () => {
    const shots = strikeShotsOf(
      snapshot,
      (id) => (id === 'c' ? null : 'vell'),
      (id) => (id === 'b' ? undefined : { x: 0.1, y: 0.9 }),
      (id) => (id === 'w9' ? undefined : { x: 0.5, y: 0.1 }),
      { width: 1000, height: 500 },
    );
    expect(shots.map((shot) => shot.key)).toEqual(['a:1']);
    expect(shots[0]?.geometry).toEqual({ from: { x: 0.1, y: 0.9 }, to: { x: 0.5, y: 0.1 }, stageWidth: 1000, stageHeight: 500 });
  });
});
