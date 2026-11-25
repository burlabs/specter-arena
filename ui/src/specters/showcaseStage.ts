import { MINION_BASE_PX } from '../arena/minionSize';

/**
 * The showcase stage, in sprite units (one unit is the 44 px hero sprite before zoom; the origin is the sprite's top left).
 * `EFFECT_EXTENT` is the largest box any hero's attack or cast effect reached, measured in Chromium by sampling every frame
 * of the FP-21 keyframes for all 11 heroes (`research/effect-extents.md` in the FP-24 planning folder): Ember's attack reaches
 * furthest right (5.10), Shard's cast furthest left (-1.46) and up (-1.72), and Shard's cast lowest (2.21). The stage is sized
 * from that box plus a margin, so nothing an effect draws is clipped.
 */
export const EFFECT_EXTENT = { left: -1.46, right: 5.11, top: -1.73, bottom: 2.21 } as const;
export const STAGE_MARGIN = 0.25;
/** Room under the drawing for the practice target's caption. */
export const CAPTION_UNITS = 0.55;
export const SPRITE_PX = 44;
/** The width used before the stage has been measured (and in jsdom, which has no ResizeObserver). */
export const STAGE_DEFAULT_WIDTH = 600;
/** The practice target's left edge, in sprite units from the hero's left: inside the reach of every hero's attack, and placed so the caption centred under the 36.4 px target stays inside the stage at 390 px. */
export const TARGET_X = 3.0;

export const STAGE_UNITS = {
  width: EFFECT_EXTENT.right - EFFECT_EXTENT.left + 2 * STAGE_MARGIN,
  height: EFFECT_EXTENT.bottom - EFFECT_EXTENT.top + 2 * STAGE_MARGIN + CAPTION_UNITS,
} as const;

export interface StageLayout {
  /** The zoom applied to the hero and the target. */
  zoom: number;
  heightPx: number;
  hero: { left: number; top: number };
  target: { left: number; top: number };
}

/** Where the hero and the practice target stand on a stage `widthPx` wide. Pure. */
export function stageLayout(widthPx: number): StageLayout {
  const unit = Math.max(1, widthPx) / STAGE_UNITS.width;
  const originX = (STAGE_MARGIN - EFFECT_EXTENT.left) * unit;
  const originY = (STAGE_MARGIN - EFFECT_EXTENT.top) * unit;
  return {
    zoom: unit / SPRITE_PX,
    heightPx: STAGE_UNITS.height * unit,
    hero: { left: originX, top: originY },
    // The target stands on the hero's baseline: its bottom (a 36.4 px sprite) meets the hero sprite's bottom.
    target: { left: originX + TARGET_X * unit, top: originY + (1 - MINION_BASE_PX / SPRITE_PX) * unit },
  };
}
