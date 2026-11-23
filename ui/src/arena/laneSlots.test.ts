import { describe, expect, it } from 'vitest';
import { ARENA_INTRINSIC } from './mapLayout';
import { HERO_BOX_PX, MIN_SLOT_GAP_PX, TASK_BOX_PX, REGIONS, fanDirection, fanPoints, laneSlots } from './laneSlots';

const px = (point: { x: number; y: number }) => ({ x: point.x * ARENA_INTRINSIC.width, y: point.y * ARENA_INTRINSIC.height });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(px(a).x - px(b).x, px(a).y - px(b).y);

type Box = { left: number; right: number; top: number; bottom: number };

describe('laneSlots', () => {
  it('is cached, stays on the map, and covers all four regions with 3 jungle sites', () => {
    const slots = laneSlots();
    expect(laneSlots()).toBe(slots);
    expect(new Set(slots.map((slot) => slot.region))).toEqual(new Set(REGIONS));
    expect(slots.filter((slot) => slot.region === 'clearings')).toHaveLength(3);
    for (const region of ['path-1', 'path-2', 'path-3'] as const) expect(slots.filter((slot) => slot.region === region).length).toBeGreaterThanOrEqual(3);
    for (const slot of slots) {
      expect(slot.point.x).toBeGreaterThan(0.03);
      expect(slot.point.x).toBeLessThan(0.97);
      expect(slot.point.y).toBeGreaterThan(0.03);
      expect(slot.point.y).toBeLessThan(0.97);
      expect(Math.hypot(slot.toward.x, slot.toward.y)).toBeCloseTo(1, 6);
    }
  });

  it('keeps every pair of slots at least MIN_SLOT_GAP_PX art pixels apart', () => {
    const slots = laneSlots();
    for (let i = 0; i < slots.length; i += 1) for (let j = i + 1; j < slots.length; j += 1) expect(distance((slots[i] as { point: { x: number; y: number } }).point, (slots[j] as { point: { x: number; y: number } }).point)).toBeGreaterThanOrEqual(MIN_SLOT_GAP_PX);
  });

  it('fans tasks toward the enemy side, with every token box clear of the hero and of each other, and at least 8 seats per slot', () => {
    const apart = (a: Box, ax: number, ay: number, b: Box, bx: number, by: number) => ax + a.right <= bx + b.left || bx + b.right <= ax + a.left || ay + a.bottom <= by + b.top || by + b.bottom <= ay + a.top;
    for (const slot of laneSlots()) {
      const fan = fanPoints(slot.point, slot.toward);
      expect(fan.length).toBeGreaterThanOrEqual(8);
      expect(fanPoints(slot.point, fanDirection(slot.point))).toEqual(fan);
      const offsets = fan.map((point) => ({ x: px(point).x - px(slot.point).x, y: px(point).y - px(slot.point).y }));
      for (const o of offsets) expect(apart(HERO_BOX_PX, 0, 0, TASK_BOX_PX, o.x, o.y)).toBe(true);
      for (let i = 0; i < offsets.length; i += 1) for (let j = i + 1; j < offsets.length; j += 1) expect(apart(TASK_BOX_PX, offsets[i]!.x, offsets[i]!.y, TASK_BOX_PX, offsets[j]!.x, offsets[j]!.y)).toBe(true);
      const first = offsets[0]!;
      expect(Math.hypot(first.x, first.y)).toBeLessThan(160);
    }
  });

  it('drops fan points that would leave the map and falls back toward the far base off the slot list', () => {
    expect(fanPoints({ x: 0.03, y: 0.03 }, { x: -1, y: 0 })).toEqual([]);
    const off = { x: 0.5, y: 0.5 };
    const dir = fanDirection(off);
    expect(dir.x).toBeGreaterThan(0);
    expect(dir.y).toBeLessThan(0);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 6);
  });
});
