import { describe, expect, it } from 'vitest';
import type { TaskItemV1 } from '../contracts/types';
import { ShapeError } from '../work/model';
import { MEDIUM_BELOW_MS, SMALL_BELOW_MS, isOnField, isTaskItem, newestTask, parseTaskItem, parseTasksPage, sizeClassOf } from './model';

const credited: TaskItemV1 = {
  contractVersion: 1,
  taskId: 'tsk_0a1b2c3d4e5f60718293a4b5',
  bindingId: 'bnd_0a1b2c3d4e5f60718293a4b5',
  attemptId: 'att_0a1b2c3d4e5f60718293a4b5',
  kind: 'worker',
  state: 'credited',
  attemptState: 'ended',
  closeReason: 'clean-end',
  startedAtMs: 1_760_000_000_000,
  endedAtMs: 1_760_000_300_000,
  closedAtMs: 1_760_000_300_000,
  updatedAtMs: 1_760_000_300_000,
  runMs: 300_000,
  sizeClass: 'medium',
  xpCredited: 12,
  policyVersion: 'xp-policy-2',
};

const open: TaskItemV1 = {
  ...credited,
  state: 'open',
  attemptState: 'working',
  closeReason: null,
  endedAtMs: null,
  closedAtMs: null,
  runMs: 90_000,
  sizeClass: 'small',
  xpCredited: null,
};

const notCredited: TaskItemV1 = { ...credited, state: 'not-credited', closeReason: 'coverage-gap', xpCredited: null };

describe('sizeClassOf', () => {
  it('uses the shared thresholds: small below 2 min, medium below 15 min, large from 15 min', () => {
    expect(SMALL_BELOW_MS).toBe(120_000);
    expect(MEDIUM_BELOW_MS).toBe(900_000);
    expect(sizeClassOf(0)).toBe('small');
    expect(sizeClassOf(119_999)).toBe('small');
    expect(sizeClassOf(120_000)).toBe('medium');
    expect(sizeClassOf(899_999)).toBe('medium');
    expect(sizeClassOf(900_000)).toBe('large');
  });
});

describe('isTaskItem', () => {
  it('accepts open, credited and not-credited tasks', () => {
    expect(isTaskItem(credited)).toBe(true);
    expect(isTaskItem(open)).toBe(true);
    expect(isTaskItem(notCredited)).toBe(true);
  });

  it.each([
    ['not an object', null],
    ['an array', [credited]],
    ['an unknown member', { ...credited, health: 1 }],
    ['another version', { ...credited, contractVersion: 2 }],
    ['a bad task id', { ...credited, taskId: 'tsk_x' }],
    ['an unknown kind', { ...credited, kind: 'chat' }],
    ['a negative time', { ...credited, startedAtMs: -1 }],
    ['a fractional run time', { ...credited, runMs: 1.5 }],
    ['an award above the cap', { ...credited, xpCredited: 31 }],
    ['credited without clean-end', { ...credited, closeReason: 'coverage-gap' }],
    ['credited without an award', { ...credited, xpCredited: null }],
    ['an award on a not-credited task', { ...notCredited, xpCredited: 5 }],
    ['an open task with a reason', { ...open, closeReason: 'unknown-terminal' }],
    ['a closed task with no reason', { ...notCredited, closeReason: null }],
    ['a size class that disagrees with runMs', { ...credited, sizeClass: 'large' }],
  ])('refuses %s', (_label, body) => {
    expect(isTaskItem(body)).toBe(false);
  });
});

describe('parseTaskItem', () => {
  it('returns a valid task and throws a ShapeError otherwise', () => {
    expect(parseTaskItem(credited)).toBe(credited);
    expect(() => parseTaskItem({ ...credited, state: 'accepted' })).toThrow(ShapeError);
  });
});

describe('parseTasksPage', () => {
  const page = { contractVersion: 1, items: [credited, open], nextCursor: 'abc_1', asOfMs: 1_760_000_400_000 };

  it('returns the page members', () => {
    expect(parseTasksPage(page)).toEqual(page);
    expect(parseTasksPage({ ...page, nextCursor: null }).nextCursor).toBeNull();
  });

  it.each([
    ['not an object', 'tasks'],
    ['another version', { ...page, contractVersion: 2 }],
    ['items not an array', { ...page, items: {} }],
    ['more than 25 items', { ...page, items: Array.from({ length: 26 }, () => credited) }],
    ['a malformed item', { ...page, items: [{ ...credited, kind: 'chat' }] }],
    ['a numeric cursor', { ...page, nextCursor: 3 }],
    ['a missing asOfMs', { ...page, asOfMs: undefined }],
  ])('fails closed on %s', (_label, body) => {
    expect(() => parseTasksPage(body)).toThrow(ShapeError);
  });
});

describe('newestTask and isOnField', () => {
  it('keeps the newest update and the first on a tie', () => {
    const later = { ...open, updatedAtMs: credited.updatedAtMs + 1 };
    expect(newestTask(credited, later)).toBe(later);
    expect(newestTask(credited, { ...open, updatedAtMs: credited.updatedAtMs })).toBe(credited);
    expect(newestTask(null, undefined)).toBeNull();
  });

  it('puts only open tasks on the field', () => {
    expect(isOnField(open)).toBe(true);
    expect(isOnField(credited)).toBe(false);
    expect(isOnField(notCredited)).toBe(false);
  });
});
