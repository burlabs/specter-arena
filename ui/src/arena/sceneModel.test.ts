import { describe, expect, it } from 'vitest';
import { DEFEATED_MAX, ENEMY_CAP, buildSceneModel } from './sceneModel';
import { HOUR, NOW, attemptOf, botOf, inputsOf, specterOf, workOf, xpOf } from './testData';

describe('specters', () => {
  it('has one specter per roster binding, sorted by id, never duplicated for several attempts', () => {
    const b2 = botOf(2, { state: 'working' });
    const b1 = botOf(1);
    const work = [workOf(1, { attempts: [attemptOf(b2, 1), attemptOf(b2, 2), attemptOf(b2, 3)] })];
    const model = buildSceneModel(inputsOf({ roster: [b2, b1], work }));
    expect(model.specters.map((s) => s.bindingId)).toEqual([b1.bindingId, b2.bindingId]);
    expect(model.specters[1]?.openAttemptIds).toHaveLength(3);
    expect(model.specters[1]?.engagedWorkIds).toEqual([work[0]?.workId]);
  });

  it('reads names, portrait, level and xp from the specter and the summary only', () => {
    const bot = botOf(1, { displayName: null });
    const model = buildSceneModel(inputsOf({ roster: [bot], specters: [specterOf(bot, 'Vesper', 'ast_1')], xp: [xpOf(bot, 150, 3)] }));
    expect(model.specters[0]).toMatchObject({ displayName: 'Unnamed bot', specterName: 'Vesper', portraitAssetId: 'ast_1', xpTotal: 150, level: 3 });
    const bare = buildSceneModel(inputsOf({ roster: [bot] }));
    expect(bare.specters[0]).toMatchObject({ specterName: null, portraitAssetId: null, xpTotal: 0, level: 1 });
  });

  it('engages only when the roster shows a matching running signal', () => {
    const idle = botOf(1);
    const working = botOf(2, { state: 'working' });
    const worker = botOf(3, { running: 1 });
    const unknownKind = botOf(4, { state: 'working' });
    const work = [
      workOf(1, { attempts: [attemptOf(idle, 1)] }),
      workOf(2, { attempts: [attemptOf(working, 2)] }),
      workOf(3, { attempts: [attemptOf(worker, 3, { kind: 'worker' })] }),
      workOf(4, { attempts: [attemptOf(unknownKind, 4, { kind: 'cron' })] }),
    ];
    const model = buildSceneModel(inputsOf({ roster: [idle, working, worker, unknownKind], work }));
    const bySpecter = Object.fromEntries(model.specters.map((s) => [s.bindingId, s]));
    expect(bySpecter[idle.bindingId]).toMatchObject({ openAttemptIds: [work[0]?.attempts[0]?.attemptId], engagedWorkIds: [] });
    expect(bySpecter[working.bindingId]?.engagedWorkIds).toHaveLength(1);
    expect(bySpecter[worker.bindingId]?.engagedWorkIds).toHaveLength(1);
    expect(bySpecter[unknownKind.bindingId]?.engagedWorkIds).toEqual([]);
    expect(model.enemies.find((e) => e.workId === work[1]?.workId)?.engagedBy).toEqual([working.bindingId]);
  });

  it('ignores ended, absent and off-roster attempts and attempts on accepted items', () => {
    const bot = botOf(1, { state: 'working' });
    const stranger = botOf(9, { state: 'working' });
    const work = [
      workOf(1, { attempts: [attemptOf(bot, 1, { ended: true }), attemptOf(bot, 2, { present: false }), attemptOf(stranger, 3)] }),
      workOf(2, { state: 'accepted', updatedAtMs: NOW, attempts: [attemptOf(bot, 4)] }),
    ];
    const model = buildSceneModel(inputsOf({ roster: [bot], work }));
    expect(model.specters[0]?.openAttemptIds).toEqual([]);
  });

  it('counts coverage gaps and unknown bots', () => {
    const gap = botOf(1, { coverage: { state: 'gap', sinceMs: null, reasonCode: 'paused', openGapCount: 1 } });
    const unknown = botOf(2, { state: 'unknown' });
    const covUnknown = botOf(3, { coverage: { state: 'unknown', sinceMs: null, reasonCode: null, openGapCount: 0 } });
    expect(buildSceneModel(inputsOf({ roster: [gap, unknown, covUnknown, botOf(4)] })).coverage).toEqual({ gaps: 1, unknownBots: 2 });
  });
});

describe('enemies', () => {
  it('puts only on-field states on the field and accepted items inside 24 hours, newest 12', () => {
    const work = [
      workOf(1, { state: 'open' }),
      workOf(2, { state: 'awaiting-review' }),
      workOf(3, { state: 'blocked' }),
      workOf(4, { state: 'reopened' }),
      workOf(5, { state: 'rejected' }),
      workOf(6, { state: 'cancelled' }),
      workOf(7, { state: 'mystery' }),
      workOf(8, { state: 'accepted', updatedAtMs: NOW - 25 * HOUR }),
      ...Array.from({ length: 14 }, (_, i) => workOf(20 + i, { state: 'accepted', updatedAtMs: NOW - i * 1_000 })),
    ];
    const model = buildSceneModel(inputsOf({ work }));
    const states = model.enemies.map((e) => e.state);
    expect(states.filter((s) => s === 'accepted')).toHaveLength(DEFEATED_MAX);
    expect(model.enemies.filter((e) => !e.defeated)).toHaveLength(4);
    expect(states).not.toContain('rejected');
    expect(states).not.toContain('mystery');
    expect(model.enemies.find((e) => e.workId === work[7]?.workId)).toBeUndefined();
    expect(model.enemies.find((e) => e.workId === work[20]?.workId)).toBeUndefined();
    expect(model.enemies.filter((e) => e.defeated).every((e) => e.state === 'accepted')).toBe(true);
  });

  it('caps at 80 with blocked kept first and counts the rest as overflow', () => {
    const work = [
      ...Array.from({ length: 90 }, (_, i) => workOf(i + 1, { state: 'open' })),
      workOf(200, { state: 'blocked', createdAtMs: 1 }),
      workOf(201, { state: 'accepted', updatedAtMs: NOW }),
    ];
    const model = buildSceneModel(inputsOf({ work, workTruncated: true }));
    expect(model.enemies).toHaveLength(ENEMY_CAP);
    expect(model.overflow).toEqual({ enemies: 91 - 79, truncated: true });
    expect(model.enemies.some((e) => e.workId === work[90]?.workId)).toBe(true);
    const all = buildSceneModel(inputsOf({ work }), Infinity);
    expect(all.enemies).toHaveLength(92);
    expect(all.overflow.enemies).toBe(0);
    expect(all.overflow.truncated).toBe(false);
  });

  it('orders equal priority by newest then id', () => {
    const work = [workOf(1, { createdAtMs: 5 }), workOf(2, { createdAtMs: 5 }), workOf(3, { createdAtMs: 9 })];
    const model = buildSceneModel(inputsOf({ work }), 2);
    expect(model.enemies.map((e) => e.workId)).toEqual([work[2]?.workId, work[0]?.workId].sort());
  });

  it('shows milestones as counts, unknown otherwise, and containers as encounters with parts', () => {
    const work = [
      workOf(1, { progress: { done: 1, total: 3 } }),
      workOf(2, { progress: { done: 0, total: 0 } }),
      workOf(3),
      workOf(4, { childCount: 4, childrenAccepted: 1 }),
    ];
    const byId = Object.fromEntries(buildSceneModel(inputsOf({ work })).enemies.map((e) => [e.workId, e]));
    expect(byId[work[0]?.workId ?? '']?.progress).toEqual({ kind: 'milestones', done: 1, total: 3 });
    expect(byId[work[1]?.workId ?? '']?.progress).toEqual({ kind: 'unknown' });
    expect(byId[work[2]?.workId ?? '']).toMatchObject({ progress: { kind: 'unknown' }, size: 'minion', parts: null });
    expect(byId[work[3]?.workId ?? '']).toMatchObject({ size: 'encounter', parts: { accepted: 1, total: 4 }, committedXp: null });
  });

  it('takes committed xp from the recorded net, including a correction and a non-rewardable item', () => {
    const bot = botOf(1);
    const contributors = (net: number) => [{ bindingId: bot.bindingId, attemptCount: 1, xpNet: net }];
    const work = [
      workOf(1, { state: 'accepted', updatedAtMs: NOW, contributors: contributors(60) }),
      workOf(2, { state: 'accepted', updatedAtMs: NOW, contributors: [...contributors(100), { bindingId: 'x', attemptCount: 1, xpNet: -40 }] }),
      workOf(3, { state: 'accepted', updatedAtMs: NOW, rewardable: false, contributors: contributors(50) }),
    ];
    const xp = buildSceneModel(inputsOf({ roster: [bot], work })).enemies.map((e) => e.committedXp);
    expect(xp).toEqual([60, 60, null]);
  });

  it('flags blocked and defeated and is the only place defeated comes from', () => {
    const work = [workOf(1, { state: 'blocked' }), workOf(2, { state: 'accepted', updatedAtMs: NOW }), workOf(3, { state: 'awaiting-review' })];
    const enemies = buildSceneModel(inputsOf({ work })).enemies;
    expect(enemies.map((e) => [e.blocked, e.defeated])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
  });
});

describe('purity and no health values', () => {
  it('does not mutate frozen inputs and returns equal output for equal input', () => {
    const bot = botOf(1, { state: 'working' });
    const inputs = inputsOf({ roster: [bot], work: [workOf(1, { attempts: [attemptOf(bot, 1)] })] });
    const frozen = JSON.parse(JSON.stringify(inputs)) as typeof inputs;
    for (const list of [frozen.roster, frozen.work, frozen.specters, frozen.xp]) Object.freeze(list);
    expect(() => buildSceneModel(frozen)).not.toThrow();
    expect(buildSceneModel(inputs)).toEqual(buildSceneModel(inputs));
  });

  it('has no key named like a percentage, ratio, health or score', () => {
    const bot = botOf(1, { state: 'working' });
    const model = buildSceneModel(inputsOf({ roster: [bot], work: [workOf(1, { progress: { done: 1, total: 2 }, childCount: 2 })] }));
    const keys: string[] = [];
    JSON.stringify(model, (key, value: unknown) => {
      keys.push(key);
      return value;
    });
    expect(keys.filter((key) => /percent|ratio|health|hp|score/i.test(key))).toEqual([]);
  });
});
