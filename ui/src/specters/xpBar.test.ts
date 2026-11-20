import { describe, expect, it } from 'vitest';
import { summaryOf } from '../work/testData';
import { xpBarOf } from './xpBar';

describe('xpBarOf', () => {
  it('measures progress inside the current level', () => {
    expect(xpBarOf(summaryOf())).toEqual({ label: '50 of 150 XP toward level 3', percent: 33, valueMax: 150, valueNow: 50, top: false });
  });

  it('never fills past the bar', () => {
    expect(xpBarOf(summaryOf({ totalXp: 400 }))).toMatchObject({ percent: 100, valueNow: 150 });
  });

  it('reports the top level with a full bar and no next level', () => {
    expect(xpBarOf(summaryOf({ level: 10, nextLevelXp: null, levelFloorXp: 3200, totalXp: 3500 }))).toEqual({ label: 'Top level reached', percent: 100, valueMax: 1, valueNow: 1, top: true });
  });

  it('treats a level with no width as the top level', () => {
    expect(xpBarOf(summaryOf({ levelFloorXp: 250, nextLevelXp: 250, totalXp: 250 })).top).toBe(true);
  });
});
