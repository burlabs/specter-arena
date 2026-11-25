import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, clamp, createSceneTransform, displayToNormalized, normalizedToDisplay, visibleNormalizedRect } from './geometry';
import { ARENA_INTRINSIC } from './mapLayout';

const viewport = { width: 800, height: 450 };

describe('scene transform', () => {
  it('fits the map and centres it', () => {
    const t = createSceneTransform(viewport, ARENA_INTRINSIC);
    expect(t.zoom).toBe(1);
    expect(t.displayed.width).toBeLessThanOrEqual(800);
    expect(t.displayed.height).toBeLessThanOrEqual(450);
    expect(t.offset.x * 2 + t.displayed.width).toBeCloseTo(800);
  });

  it('bounds zoom to 1..2.5', () => {
    expect(createSceneTransform(viewport, ARENA_INTRINSIC, 0.2).zoom).toBe(1);
    expect(createSceneTransform(viewport, ARENA_INTRINSIC, 9).zoom).toBe(MAX_ZOOM);
  });

  it('cannot pan off the map and cannot pan at all when it fits', () => {
    expect(createSceneTransform(viewport, ARENA_INTRINSIC, 1, { x: 500, y: 500 }).pan).toEqual({ x: 0, y: 0 });
    const zoomed = createSceneTransform(viewport, ARENA_INTRINSIC, 2, { x: 9999, y: -9999 });
    expect(zoomed.pan.x).toBeCloseTo((zoomed.displayed.width - 800) / 2);
    expect(zoomed.pan.y).toBeLessThan(0);
  });

  it('round-trips a point between map and display coordinates', () => {
    const t = createSceneTransform(viewport, ARENA_INTRINSIC, 1.5, { x: 40, y: -10 });
    const back = displayToNormalized(normalizedToDisplay({ x: 0.3, y: 0.7 }, t), t);
    expect(back.x).toBeCloseTo(0.3);
    expect(back.y).toBeCloseTo(0.7);
  });

  it('reports the visible part of the map, all of it when fitted', () => {
    const fitted = visibleNormalizedRect(createSceneTransform(viewport, ARENA_INTRINSIC));
    expect(fitted).toMatchObject({ x: 0, y: 0 });
    expect(fitted.width).toBeCloseTo(1);
    const zoomed = visibleNormalizedRect(createSceneTransform(viewport, ARENA_INTRINSIC, 2));
    expect(zoomed.width).toBeLessThan(0.6);
  });

  it('refuses a zero or non-finite size', () => {
    expect(() => createSceneTransform({ width: 0, height: 10 }, ARENA_INTRINSIC)).toThrow();
    expect(() => createSceneTransform(viewport, { width: Number.NaN, height: 1 })).toThrow();
  });

  it('clamps', () => {
    expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]);
  });
});
