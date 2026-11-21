import { describe, expect, it } from 'vitest';
import { EFFECT_MAP, enemyEffect, progressTextOf, specterStance } from './effectMap';
import type { SceneEnemy } from './sceneModel';

const enemy = (extra: Partial<SceneEnemy> = {}): SceneEnemy => ({
  workId: 'w',
  parentId: null,
  title: 'T',
  size: 'minion',
  state: 'open',
  progress: { kind: 'unknown' },
  parts: null,
  blocked: false,
  engagedBy: [],
  defeated: false,
  committedXp: null,
  ...extra,
});

describe('effect map', () => {
  it('has the sixteen rows, none of which changes any state', () => {
    expect(EFFECT_MAP).toHaveLength(16);
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

  it('shows linked running attempts as engaged, and several as assistance', () => {
    expect(enemyEffect(enemy({ engagedBy: ['a'] }))).toMatchObject({ pose: 'engaged', marker: null });
    expect(enemyEffect(enemy({ engagedBy: ['a', 'b'] }))).toMatchObject({ pose: 'engaged', marker: 'assistance' });
  });

  it('prints milestones as "N of M milestones" and never a percentage', () => {
    expect(progressTextOf({ kind: 'milestones', done: 2, total: 3 })).toBe('2 of 3 milestones');
    expect(progressTextOf({ kind: 'unknown' })).toBe('Progress unknown');
  });

  it('shows blocked with a blocked marker', () => {
    expect(enemyEffect(enemy({ state: 'blocked', blocked: true }))).toMatchObject({ marker: 'blocked', stateText: 'Blocked' });
  });

  it('shows awaiting-review as the evidence marker, in the words of the review, not a Crew approval', () => {
    const effect = enemyEffect(enemy({ state: 'awaiting-review' }));
    expect(effect).toMatchObject({ marker: 'evidence', stateText: 'Awaiting your review' });
  });

  it('shows accepted as a defeated pose with the accepted marker', () => {
    expect(enemyEffect(enemy({ state: 'accepted', defeated: true, engagedBy: ['a'] }))).toMatchObject({ pose: 'defeated', marker: 'outcome-accepted', stateText: 'Defeated' });
  });

  it('shows reopened as an ordinary returning enemy', () => {
    expect(enemyEffect(enemy({ state: 'reopened' }))).toMatchObject({ pose: 'idle', stateText: 'Reopened', marker: null });
  });
});
