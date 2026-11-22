import { describe, expect, it } from 'vitest';
import { EFFECT_MAP, enemyEffect, progressTextOf, specterStance } from './effectMap';
import type { SceneEnemy } from './sceneModel';

const enemy = (extra: Partial<SceneEnemy> = {}): SceneEnemy => ({
  workId: 'w',
  parentId: null,
  title: 'T',
  size: 'minion',
  state: 'open',
  sizeClass: 'medium',
  runMs: 300_000,
  progress: { kind: 'unknown' },
  parts: null,
  blocked: false,
  engagedBy: [],
  defeated: false,
  committedXp: null,
  ...extra,
});

describe('effect map', () => {
  it('has the ten rows, none of which changes any state', () => {
    expect(EFFECT_MAP).toHaveLength(10);
    expect(EFFECT_MAP.every((row) => row.changes === 'none')).toBe(true);
  });

  it('never says waiting on you', () => {
    expect(JSON.stringify(EFFECT_MAP).toLowerCase()).not.toContain('waiting on you');
  });

  it('maps a roster condition to a stance', () => {
    expect(specterStance({ condition: 'working' })).toBe('engaging');
    expect(specterStance({ condition: 'settled' })).toBe('at-rest');
    expect(specterStance({ condition: 'unknown' })).toBe('coverage-unknown');
  });

  it('shows an open leaf as an idle patchling with no marker', () => {
    expect(enemyEffect(enemy())).toEqual({ pose: 'idle', marker: null, progressText: 'Progress unknown', stateText: 'Open' });
  });

  it('prints milestones as "N of M milestones" and never a percentage', () => {
    expect(progressTextOf({ kind: 'milestones', done: 2, total: 3 })).toBe('2 of 3 milestones');
    expect(progressTextOf({ kind: 'unknown' })).toBe('Progress unknown');
  });

  it('shows an open task as a plain open minion, and an engaged one as running', () => {
    expect(enemyEffect(enemy())).toMatchObject({ pose: 'idle', marker: null, stateText: 'Open', progressText: 'Progress unknown' });
    expect(enemyEffect(enemy({ engagedBy: ['a'] }))).toMatchObject({ pose: 'engaged', marker: null, stateText: 'Running' });
  });

  it('shows a credited task as a defeated pose with the outcome marker, however it is engaged', () => {
    expect(enemyEffect(enemy({ state: 'credited', defeated: true, engagedBy: ['a'] }))).toMatchObject({ pose: 'defeated', marker: 'outcome-accepted', stateText: 'Defeated' });
  });

  it('words a task that closed without credit as not credited, with no marker', () => {
    expect(enemyEffect(enemy({ state: 'not-credited' }))).toMatchObject({ pose: 'idle', marker: null, stateText: 'Not credited' });
  });

  it('never lets size change the pose, marker or words', () => {
    const small = enemyEffect(enemy({ sizeClass: 'small', runMs: 1_000 }));
    const large = enemyEffect(enemy({ sizeClass: 'large', runMs: 5_000_000 }));
    expect(large).toEqual(small);
  });
});
