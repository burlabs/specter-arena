import { describe, expect, it } from 'vitest';
import { EFFECT_EXTENT, STAGE_MARGIN, STAGE_UNITS, TARGET_X, stageLayout } from './showcaseStage';

describe('showcase stage', () => {
  it('holds the measured effect box with a margin, and keeps the target inside the attack reach', () => {
    expect(STAGE_UNITS.width).toBeCloseTo(EFFECT_EXTENT.right - EFFECT_EXTENT.left + 2 * STAGE_MARGIN, 9);
    expect(TARGET_X + 28 / 44).toBeLessThan(EFFECT_EXTENT.right);
    expect(TARGET_X).toBeGreaterThan(1.5);
  });

  it('scales with the stage width and keeps every effect edge inside the stage', () => {
    for (const width of [300, 340, 620]) {
      const layout = stageLayout(width);
      const unit = layout.zoom * 44;
      expect(layout.hero.left + EFFECT_EXTENT.left * unit).toBeGreaterThanOrEqual(0);
      expect(layout.hero.left + EFFECT_EXTENT.right * unit).toBeLessThanOrEqual(width + 1e-9);
      expect(layout.hero.top + EFFECT_EXTENT.top * unit).toBeGreaterThanOrEqual(0);
      expect(layout.hero.top + EFFECT_EXTENT.bottom * unit).toBeLessThanOrEqual(layout.heightPx);
      expect(layout.target.left).toBeGreaterThan(layout.hero.left + unit);
    }
    expect(stageLayout(0).zoom).toBeGreaterThan(0);
  });
});
