import type { HeroId } from '../contracts/types';

export const heroSpriteKey = (heroId: string): string => `hero-${heroId}-sprite`;
export const heroThumbnailKey = (heroId: string): string => `hero-${heroId}-thumbnail`;

/** Where each 512 px sprite stands, as a fraction of its width and height. The export calls these suggested, not runtime verified. */
export const HERO_ANCHORS: Readonly<Record<HeroId, readonly [number, number]>> = {
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

export const CENTER_ANCHOR: readonly [number, number] = [0.5, 0.9];

/** Length of one idle loop in milliseconds. */
export const HERO_IDLE_MS: Readonly<Record<HeroId, number>> = {
  reeve: 1800,
  vell: 2000,
  stitch: 1750,
  poly: 2200,
  rattle: 1850,
  ember: 1450,
  shard: 2400,
  tide: 1900,
  lume: 2100,
  moss: 2000,
  bur: 1800,
};

const DEFAULT_IDLE_MS = 1900;

const anchors: Readonly<Record<string, readonly [number, number]>> = HERO_ANCHORS;
const idleLengths: Readonly<Record<string, number>> = HERO_IDLE_MS;

/** An unknown hero id (a newer backend) stands at the centre of its sprite. */
export const anchorOf = (heroId: string): readonly [number, number] => anchors[heroId] ?? CENTER_ANCHOR;

export const idleMsOf = (heroId: string): number => idleLengths[heroId] ?? DEFAULT_IDLE_MS;
