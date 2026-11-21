import type { HeroId } from '../contracts/types';

/** Length of each one-shot and the moment it lands, in milliseconds. Presentation only: it never reaches the backend. */
export interface HeroCombatTiming {
  attack: number;
  cast: number;
  attackImpact: number;
  castImpact: number;
}

/** Durations and impact times from the Figma Make export (`motion/specterAnimation.ts`), one row per hero. */
export const HERO_COMBAT: Readonly<Record<HeroId, HeroCombatTiming>> = {
  reeve: { attack: 620, cast: 900, attackImpact: 320, castImpact: 560 },
  vell: { attack: 560, cast: 950, attackImpact: 300, castImpact: 610 },
  stitch: { attack: 650, cast: 1_050, attackImpact: 360, castImpact: 680 },
  poly: { attack: 600, cast: 1_000, attackImpact: 350, castImpact: 640 },
  rattle: { attack: 620, cast: 1_000, attackImpact: 340, castImpact: 650 },
  ember: { attack: 520, cast: 950, attackImpact: 290, castImpact: 590 },
  shard: { attack: 650, cast: 1_100, attackImpact: 390, castImpact: 710 },
  tide: { attack: 580, cast: 1_050, attackImpact: 330, castImpact: 680 },
  lume: { attack: 600, cast: 1_100, attackImpact: 340, castImpact: 700 },
  moss: { attack: 600, cast: 1_150, attackImpact: 340, castImpact: 720 },
  bur: { attack: 680, cast: 1_200, attackImpact: 390, castImpact: 760 },
};

/** A hero id a newer backend adds has no timing row, so it never attacks. */
export const combatTimingOf = (heroId: string): HeroCombatTiming | null => (Object.hasOwn(HERO_COMBAT, heroId) ? HERO_COMBAT[heroId as HeroId] : null);

/** The colour of each hero's travelling strike, taken from the glow of that hero's own effect layer. */
export const STRIKE_RGB: Readonly<Record<HeroId, string>> = {
  reeve: 'rgb(203, 185, 255)',
  vell: 'rgb(225, 212, 255)',
  stitch: 'rgb(255, 208, 128)',
  poly: 'rgb(136, 221, 230)',
  rattle: 'rgb(237, 232, 214)',
  ember: 'rgb(255, 150, 70)',
  shard: 'rgb(150, 230, 255)',
  tide: 'rgb(112, 188, 232)',
  lume: 'rgb(200, 255, 240)',
  moss: 'rgb(146, 223, 184)',
  bur: 'rgb(200, 235, 255)',
};

export const strikeColorOf = (heroId: string): string => (Object.hasOwn(STRIKE_RGB, heroId) ? STRIKE_RGB[heroId as HeroId] : 'rgb(255, 208, 128)');

/** A recoil with no hero behind it (a milestone seen with nobody engaged) lands after this delay. */
export const RECOIL_ONLY_IMPACT_MS = 280;

/** The effect points toward the target and never more than this far off horizontal, as in the export. */
export const MAX_EFFECT_ANGLE_DEG = 35;

/**
 * Degrees from the hero toward the enemy, clamped. `dx` is taken as its absolute value because a hero whose enemy
 * stands to the left mirrors its effect layer instead of turning it over.
 */
export function effectAngle(dx: number, dy: number): number {
  const angle = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
  return Math.max(-MAX_EFFECT_ANGLE_DEG, Math.min(MAX_EFFECT_ANGLE_DEG, angle));
}
