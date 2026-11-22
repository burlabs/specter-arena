// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARENA_INTRINSIC } from './mapLayout';
import { MINION_BASE_PX, MINION_FIT, MINION_SCALE, minionBasePx } from './minionSize';
import { ENEMY_CELL, enemySlots } from './sceneLayout';

const css = readFileSync(fileURLToPath(new URL('./arena.css', import.meta.url)), 'utf8');

describe('minion scale', () => {
  it('is 0.8, 1.0 and 1.3 by size class, and nothing else', () => {
    expect(MINION_SCALE).toEqual({ small: 0.8, medium: 1, large: 1.3 });
  });

  it('keeps 28 px wherever a large minion fits one lattice cell, and shrinks below that', () => {
    const fits = (MINION_BASE_PX * MINION_SCALE.large) / (ENEMY_CELL.x * MINION_FIT);
    expect(minionBasePx(fits)).toBeCloseTo(MINION_BASE_PX, 6);
    expect(minionBasePx(fits + 500)).toBe(MINION_BASE_PX);
    expect(minionBasePx(728)).toBeLessThan(MINION_BASE_PX);
    expect(minionBasePx(358)).toBeLessThan(15);
    expect(minionBasePx(358)).toBeGreaterThan(10);
  });

  it('is the same 28 px in the stylesheet fallback', () => {
    expect(css).toContain(`var(--sa-minion-base, ${MINION_BASE_PX}px)`);
    expect(css).toContain('var(--sa-minion-scale, 1)');
  });

  it('never overlaps a lattice neighbour at any map width, for every pair of size classes', () => {
    const points = enemySlots();
    const sizes = Object.values(MINION_SCALE);
    for (const width of [320, 358, 600, 728, 767, 888, 1400, 2000]) {
      const height = (width * ARENA_INTRINSIC.height) / ARENA_INTRINSIC.width;
      const base = minionBasePx(width);
      for (const a of sizes) {
        for (const b of sizes) {
          const sa = base * a;
          const sb = base * b;
          for (let i = 0; i < points.length; i += 1) {
            for (let j = i + 1; j < points.length; j += 1) {
              const p = points[i]!;
              const q = points[j]!;
              // The token is centred on x and stands from 0.8 of its height above the point to 0.2 below it.
              const across = Math.min(p.x * width + sa / 2, q.x * width + sb / 2) - Math.max(p.x * width - sa / 2, q.x * width - sb / 2);
              const down = Math.min(p.y * height + 0.2 * sa, q.y * height + 0.2 * sb) - Math.max(p.y * height - 0.8 * sa, q.y * height - 0.8 * sb);
              expect(across > 1e-6 && down > 1e-6, `${width}px ${a}/${b} ${i}-${j}`).toBe(false);
            }
          }
        }
      }
    }
  });
});
