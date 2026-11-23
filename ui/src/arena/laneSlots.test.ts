import { describe, expect, it } from 'vitest';
import { ARENA_INTRINSIC } from './mapLayout';
import { FAN_BOX_PX, MIN_SLOT_GAP_PX, REGIONS, fanDirection, fanPoints, laneSlots, towardFarBase } from './laneSlots';

const px = (point: { x: number; y: number }) => ({ x: point.x * ARENA_INTRINSIC.width, y: point.y * ARENA_INTRINSIC.height });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(px(a).x - px(b).x, px(a).y - px(b).y);

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

  it('fans tasks toward the enemy side, a box apart from each other and from the hero, with at least 8 seats per slot', () => {
    const boxApart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(px(a).x - px(b).x) >= FAN_BOX_PX - 1e-6 || Math.abs(px(a).y - px(b).y) >= FAN_BOX_PX - 1e-6;
    for (const slot of laneSlots()) {
      const fan = fanPoints(slot.point, slot.toward);
      expect(fan.length).toBeGreaterThanOrEqual(8);
      expect(fanPoints(slot.point, fanDirection(slot.point))).toEqual(fan);
      for (const point of fan) expect(boxApart(point, slot.point)).toBe(true);
      for (let i = 0; i < fan.length; i += 1) for (let j = i + 1; j < fan.length; j += 1) expect(boxApart(fan[i] as { x: number; y: number }, fan[j] as { x: number; y: number })).toBe(true);
      const first = fan[0] as { x: number; y: number };
      expect(distance(first, slot.point)).toBeLessThan(140);
      const toward = { x: (first.x - slot.point.x) * ARENA_INTRINSIC.width, y: (first.y - slot.point.y) * ARENA_INTRINSIC.height };
      expect(toward.x * slot.toward.x + toward.y * slot.toward.y).toBeGreaterThan(0);
    }
  });

  it('drops fan points that would leave the map and falls back toward the far base off the slot list', () => {
    expect(fanPoints({ x: 0.03, y: 0.03 }, { x: -1, y: 0 })).toEqual([]);
    const off = { x: 0.5, y: 0.5 };
    const dir = towardFarBase(off);
    expect(dir.x).toBeGreaterThan(0);
    expect(dir.y).toBeLessThan(0);
    expect(fanDirection(off)).toEqual(dir);
  });
});
