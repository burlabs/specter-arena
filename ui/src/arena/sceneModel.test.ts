import { describe, expect, it } from 'vitest';
import { DEFEATED_MAX, ENEMY_CAP, buildSceneModel, committedXpOf } from './sceneModel';
import { HOUR, NOW, botOf, creditedOf, inputsOf, notCreditedOf, specterOf, taskOf, xpOf } from './testData';

describe('specters', () => {
  it('has one specter per roster binding, sorted by id, never duplicated for several tasks', () => {
    const b2 = botOf(2, { state: 'working' });
    const b1 = botOf(1);
    const tasks = [taskOf(1, b2), taskOf(2, b2), taskOf(3, b2)];
    const model = buildSceneModel(inputsOf({ roster: [b2, b1], tasks }));
    expect(model.specters.map((s) => s.bindingId)).toEqual([b1.bindingId, b2.bindingId]);
    expect(model.specters[1]?.openAttemptIds).toHaveLength(3);
    expect(model.specters[1]?.engagedWorkIds).toEqual(tasks.map((task) => task.taskId).sort());
  });

  it('reads names, portrait, level and xp from the specter and the summary only', () => {
    const bot = botOf(1, { displayName: null });
    const model = buildSceneModel(inputsOf({ roster: [bot], specters: [specterOf(bot, 'Vesper', 'ast_1')], xp: [xpOf(bot, 150, 3)] }));
    expect(model.specters[0]).toMatchObject({ displayName: 'Unnamed bot', specterName: 'Vesper', portraitAssetId: 'ast_1', xpTotal: 150, level: 3 });
    const bare = buildSceneModel(inputsOf({ roster: [bot] }));
    expect(bare.specters[0]).toMatchObject({ specterName: null, portraitAssetId: null, xpTotal: 0, level: 1 });
  });

  it('engages only a task whose attempt is working; an unobserved task is open but not engaged', () => {
    const bot = botOf(1, { state: 'working' });
    const running = taskOf(1, bot);
    const unobserved = taskOf(2, bot, { attemptState: 'unknown' });
    const awaiting = taskOf(3, bot, { attemptState: 'ended', endedAtMs: NOW - 1_000 });
    const model = buildSceneModel(inputsOf({ roster: [bot], tasks: [running, unobserved, awaiting] }));
    expect(model.specters[0]).toMatchObject({ openAttemptIds: [running.attemptId, unobserved.attemptId].sort(), engagedWorkIds: [running.taskId] });
    expect(model.enemies.find((e) => e.workId === running.taskId)?.engagedBy).toEqual([bot.bindingId]);
    expect(model.enemies.find((e) => e.workId === unobserved.taskId)?.engagedBy).toEqual([]);
    expect(model.enemies.find((e) => e.workId === awaiting.taskId)?.engagedBy).toEqual([]);
  });

  it('keeps a waiting bot as waiting, not unknown', () => {
    const waiting = botOf(1, { state: 'waiting' });
    const odd = botOf(2, { state: 'blocked' });
    const model = buildSceneModel(inputsOf({ roster: [waiting, odd], tasks: [taskOf(1, waiting)] }));
    expect(model.specters.map((s) => s.condition)).toEqual(['waiting', 'unknown']);
    expect(model.coverage.unknownBots).toBe(1);
  });

  it('ignores closed tasks and tasks of bots that are not on the roster', () => {
    const bot = botOf(1, { state: 'working' });
    const stranger = botOf(9, { state: 'working' });
    const tasks = [taskOf(1, stranger), creditedOf(2, bot), notCreditedOf(3, bot)];
    const model = buildSceneModel(inputsOf({ roster: [bot], tasks }));
    expect(model.specters[0]).toMatchObject({ openAttemptIds: [], engagedWorkIds: [] });
    expect(model.enemies.find((e) => e.workId === tasks[0]?.taskId)?.engagedBy).toEqual([]);
  });

  it('counts coverage gaps and unknown bots', () => {
    const gap = botOf(1, { coverage: { state: 'gap', sinceMs: null, reasonCode: 'paused', openGapCount: 1 } });
    const unknown = botOf(2, { state: 'unknown' });
    const covUnknown = botOf(3, { coverage: { state: 'unknown', sinceMs: null, reasonCode: null, openGapCount: 0 } });
    expect(buildSceneModel(inputsOf({ roster: [gap, unknown, covUnknown, botOf(4)] })).coverage).toEqual({ gaps: 1, unknownBots: 2 });
  });
});

describe('enemies', () => {
  const bot = botOf(1);

  it('puts open tasks on the field and credited tasks closed inside 24 hours, newest 12; not-credited tasks are not enemies', () => {
    const tasks = [
      taskOf(1, bot),
      taskOf(2, bot, { attemptState: 'unknown' }),
      notCreditedOf(3, bot),
      creditedOf(4, bot, { closedAtMs: NOW - 25 * HOUR, updatedAtMs: NOW - 25 * HOUR }),
      ...Array.from({ length: 14 }, (_, i) => creditedOf(20 + i, bot, { closedAtMs: NOW - i * 1_000 - 1, updatedAtMs: NOW - i * 1_000 - 1 })),
    ];
    const model = buildSceneModel(inputsOf({ tasks }));
    expect(model.enemies.filter((e) => e.defeated)).toHaveLength(DEFEATED_MAX);
    expect(model.enemies.filter((e) => !e.defeated).map((e) => e.state)).toEqual(['open', 'open']);
    expect(model.enemies.find((e) => e.workId === tasks[2]?.taskId)).toBeUndefined();
    expect(model.enemies.find((e) => e.workId === tasks[3]?.taskId)).toBeUndefined();
    expect(model.enemies.find((e) => e.workId === tasks[18]?.taskId)).toBeUndefined();
  });

  it('caps at 80 keeping the newest updated open tasks and counts the rest as overflow', () => {
    const tasks = [...Array.from({ length: 90 }, (_, i) => taskOf(i + 1, bot, { updatedAtMs: NOW - (i + 1) * 1_000 })), creditedOf(200, bot)];
    const model = buildSceneModel(inputsOf({ tasks, tasksTruncated: true }));
    expect(model.enemies).toHaveLength(ENEMY_CAP);
    expect(model.overflow).toEqual({ enemies: 90 - (ENEMY_CAP - 1), truncated: true });
    expect(model.enemies.some((e) => e.workId === tasks[0]?.taskId)).toBe(true);
    expect(model.enemies.some((e) => e.workId === tasks[89]?.taskId)).toBe(false);
    const all = buildSceneModel(inputsOf({ tasks }), Infinity);
    expect(all.enemies).toHaveLength(91);
    expect(all.overflow).toEqual({ enemies: 0, truncated: false });
  });

  it('keeps the same enemies for the same tasks in any input order, sorted by id', () => {
    const tasks = [taskOf(3, bot), taskOf(1, bot), taskOf(2, bot)];
    const forward = buildSceneModel(inputsOf({ tasks }));
    expect(buildSceneModel(inputsOf({ tasks: [...tasks].reverse() }))).toEqual(forward);
    expect(forward.enemies.map((e) => e.workId)).toEqual(tasks.map((task) => task.taskId).sort());
  });

  it('draws every task as a minion with unknown progress, no parts and nothing blocked', () => {
    const model = buildSceneModel(inputsOf({ tasks: [taskOf(1, bot), creditedOf(2, bot)] }));
    for (const enemy of model.enemies) expect(enemy).toMatchObject({ size: 'minion', parentId: null, parts: null, blocked: false, progress: { kind: 'unknown' } });
  });

  it('gives each enemy its size class and run time from the task, and a title from its kind and run time', () => {
    const tasks = [taskOf(1, bot, { runMs: 90_000, kind: 'bot-turn' }), taskOf(2, bot, { runMs: 120_000 }), taskOf(3, bot, { runMs: 899_999 }), taskOf(4, bot, { runMs: 900_000 })];
    const byId = Object.fromEntries(buildSceneModel(inputsOf({ tasks })).enemies.map((e) => [e.workId, e]));
    expect(byId[tasks[0]?.taskId ?? '']).toMatchObject({ sizeClass: 'small', runMs: 90_000, title: 'Bot turn · 1 min' });
    expect(byId[tasks[1]?.taskId ?? '']).toMatchObject({ sizeClass: 'medium', runMs: 120_000, title: 'Worker task · 2 min' });
    expect(byId[tasks[2]?.taskId ?? '']).toMatchObject({ sizeClass: 'medium', runMs: 899_999 });
    expect(byId[tasks[3]?.taskId ?? '']).toMatchObject({ sizeClass: 'large', runMs: 900_000, title: 'Worker task · 15 min' });
  });

  it('grows a running task from one poll to the next without ever shrinking it', () => {
    const early = buildSceneModel(inputsOf({ tasks: [taskOf(1, bot, { runMs: 100_000 })] })).enemies[0];
    const later = buildSceneModel(inputsOf({ tasks: [taskOf(1, bot, { runMs: 130_000 })] })).enemies[0];
    expect([early?.sizeClass, later?.sizeClass]).toEqual(['small', 'medium']);
    expect(later?.runMs).toBeGreaterThan(early?.runMs ?? Infinity);
  });

  it('takes committed xp from the award a credited task wrote and from nothing else', () => {
    const tasks = [creditedOf(1, bot, { xpCredited: 14 }), creditedOf(2, bot, { xpCredited: 30 }), taskOf(3, bot), notCreditedOf(4, bot)];
    const byId = Object.fromEntries(buildSceneModel(inputsOf({ tasks })).enemies.map((e) => [e.workId, e.committedXp]));
    expect(byId[tasks[0]?.taskId ?? '']).toBe(14);
    expect(byId[tasks[1]?.taskId ?? '']).toBe(30);
    expect(byId[tasks[2]?.taskId ?? '']).toBeNull();
    expect(committedXpOf(tasks[3] ?? taskOf(9, bot))).toBeNull();
  });

  it('flags defeated for a credited task and never blocked', () => {
    const enemies = buildSceneModel(inputsOf({ tasks: [taskOf(1, bot), creditedOf(2, bot)] })).enemies;
    expect(enemies.map((e) => [e.blocked, e.defeated])).toEqual([
      [false, false],
      [false, true],
    ]);
  });

  it('keeps a credited task credited and draws it defeated when its slot runs again', () => {
    const again = creditedOf(1, bot, { attemptState: 'working' });
    const [enemy] = buildSceneModel(inputsOf({ roster: [bot], tasks: [again] })).enemies;
    expect(enemy).toMatchObject({ state: 'credited', defeated: true, committedXp: 12 });
  });
});

describe('purity and no health values', () => {
  it('does not mutate frozen inputs and returns equal output for equal input', () => {
    const bot = botOf(1, { state: 'working' });
    const inputs = inputsOf({ roster: [bot], tasks: [taskOf(1, bot)] });
    const frozen = JSON.parse(JSON.stringify(inputs)) as typeof inputs;
    for (const list of [frozen.roster, frozen.tasks, frozen.specters, frozen.xp]) Object.freeze(list);
    expect(() => buildSceneModel(frozen)).not.toThrow();
    expect(buildSceneModel(inputs)).toEqual(buildSceneModel(inputs));
  });

  it('has no key named like a percentage, ratio, health or score', () => {
    const bot = botOf(1, { state: 'working' });
    const model = buildSceneModel(inputsOf({ roster: [bot], tasks: [taskOf(1, bot), notCreditedOf(2, bot)] }));
    const keys: string[] = [];
    JSON.stringify(model, (key, value: unknown) => {
      keys.push(key);
      return value;
    });
    expect(keys.filter((key) => /percent|ratio|health|hp|score/i.test(key))).toEqual([]);
  });
});

describe('FP-21 readings', () => {
  it('marks XP as loading or failed only for a bot with no summary, and ready otherwise', () => {
    const known = botOf(1);
    const unknown = botOf(2);
    const loading = buildSceneModel(inputsOf({ roster: [known, unknown], xp: [xpOf(known, 50, 2)], xpStatus: 'loading' }));
    expect(loading.specters.map((specter) => specter.xpReading)).toEqual(['ready', 'loading']);
    expect(buildSceneModel(inputsOf({ roster: [unknown], xpStatus: 'failed' })).specters[0]?.xpReading).toBe('failed');
    expect(buildSceneModel(inputsOf({ roster: [unknown] })).specters[0]?.xpReading).toBe('ready');
  });

  it('carries the waiting reason only for a waiting bot with a known Crew flag', () => {
    const waiting = (reasonCode: string) => botOf(1, { state: 'waiting', condition: { ...botOf(1).condition, state: 'waiting', reasonCode } });
    const reason = (bot: ReturnType<typeof botOf>) => buildSceneModel(inputsOf({ roster: [bot] })).specters[0]?.waitingReason;
    expect(reason(waiting('approval-pending'))).toBe('approval-pending');
    expect(reason(waiting('question-pending'))).toBe('question-pending');
    expect(reason(waiting('something-new'))).toBeNull();
    expect(reason(botOf(1, { state: 'working' }))).toBeNull();
    expect(reason(botOf(1, { condition: { ...botOf(1).condition, state: 'settled', reasonCode: 'approval-pending' } }))).toBeNull();
  });
});
