import { describe, expect, it } from 'vitest';
import roster from '../../../backend/specter_arena/specters/heroes.json';
import { HERO_IDS } from '../contracts/types';
import { CENTER_ANCHOR, HERO_ANCHORS, HERO_IDLE_MS, anchorOf, heroSpriteKey, heroThumbnailKey, idleMsOf } from './heroes';

/** The export's `src/data/assets.ts` suggested anchors at 8 decimals (the export writes poly's y with 9), copied here so a typo in `heroes.ts` fails. */
const EXPORT_ANCHORS: Record<string, [number, number]> = {
  vell: [0.60742188, 0.90039062],
  stitch: [0.51905382, 0.90039062],
  reeve: [0.43519788, 0.90039062],
  rattle: [0.56401708, 0.90039062],
  ember: [0.56244721, 0.90039062],
  shard: [0.59646028, 0.90039062],
  poly: [0.5, 0.90039062],
  tide: [0.55196907, 0.90039062],
  lume: [0.49503801, 0.90039062],
  moss: [0.56576046, 0.90039062],
  bur: [0.5, 0.90039062],
};

/** The export's idle loop lengths in `src/index.css`. */
const EXPORT_IDLE_MS: Record<string, number> = { reeve: 1800, vell: 2000, stitch: 1750, poly: 2200, rattle: 1850, ember: 1450, shard: 2400, tide: 1900, lume: 2100, moss: 2000, bur: 1800 };

describe('heroes', () => {
  it('has an anchor and an idle length for every hero id, and nothing else', () => {
    expect(Object.keys(HERO_ANCHORS).sort()).toEqual([...HERO_IDS].sort());
    expect(Object.keys(HERO_IDLE_MS).sort()).toEqual([...HERO_IDS].sort());
  });

  it('keeps every anchor strictly inside the sprite', () => {
    for (const [x, y] of Object.values(HERO_ANCHORS)) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
  });

  it('writes every anchor with at most 8 decimals', () => {
    for (const [x, y] of Object.values(HERO_ANCHORS)) {
      for (const value of [x, y]) expect(String(value).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(8);
    }
  });

  it('equals the anchors and idle lengths of the export', () => {
    expect(HERO_ANCHORS).toEqual(EXPORT_ANCHORS);
    expect(HERO_IDLE_MS).toEqual(EXPORT_IDLE_MS);
  });

  it('stands an unknown hero at the centre and gives it the default idle length', () => {
    expect(anchorOf('future-hero')).toBe(CENTER_ANCHOR);
    expect(anchorOf('vell')).toEqual(EXPORT_ANCHORS.vell);
    expect(idleMsOf('future-hero')).toBe(1900);
    expect(idleMsOf('ember')).toBe(1450);
  });

  it('builds the scene keys the backend roster names', () => {
    expect(heroSpriteKey('vell')).toBe('hero-vell-sprite');
    expect(heroThumbnailKey('vell')).toBe('hero-vell-thumbnail');
    for (const hero of roster.heroes) {
      expect(heroSpriteKey(hero.id)).toBe(hero.spriteKey);
      expect(heroThumbnailKey(hero.id)).toBe(hero.thumbnailKey);
    }
  });
});
