import { describe, expect, it } from 'vitest';
import { SUMMARY_MAX_CHARS, diagnosticSummary, scrubSecrets } from './diagnosticSummary';
import { buildSceneModel } from './sceneModel';
import { NOW, botOf, creditedOf, inputsOf, notCreditedOf, taskOf, xpOf } from './testData';

const bot = botOf(1, { displayName: 'Atlas', state: 'working' });
const model = buildSceneModel(inputsOf({ roster: [bot], tasks: [] }));

// Built at run time so no literal credential-shaped string sits in the repository.
const FAKES: ReadonlyArray<[string, string]> = [
  ['bearer header', `Bearer ${'a1b2c3d4'.repeat(4)}`],
  ['url with a query', `https://example.test/path?${'tok'}en=${'z9'.repeat(8)}`],
  ['plain url', 'https://example.test/private/page'],
  ['token assignment', `${'tok'}en=${'q7'.repeat(8)}`],
  ['api key assignment', `${'api'}_${'key'}: ${'k3'.repeat(8)}`],
  ['sk key', `${'sk'}-${'Ab12'.repeat(5)}`],
  ['github token', `${'gh'}p_${'Zy98'.repeat(5)}`],
  ['slack token', `${'xo'}xb-${'1234'.repeat(4)}`],
  ['aws key id', `${'AK'}IA${'ABCDEFGHIJKLMNOP'}`],
  ['jwt', `${'ey'}J${'hbGciOiJIUzI1'}.${'eyJzdWIiOiIxMjM0'}.${'sig12345678'}`],
  ['refresh token assignment', `${'refresh'}_${'tok'}en=${'r8'.repeat(8)}`],
  ['client secret assignment', `${'client'}_${'sec'}ret=${'c5'.repeat(8)}`],
  ['id token with a colon', `${'id'}_${'tok'}en: ${'i2'.repeat(8)}`],
  ['private key assignment', `${'private'}_${'k'}ey=${'p4'.repeat(8)}`],
  ['session id assignment', `${'session'}_${'i'}d=${'s6'.repeat(8)}`],
  ['quoted json value', `{"${'tok'}en":"${'j3'.repeat(8)}"}`],
  ['quoted value with a space', `${'pass'}word="${'two words'} here"`],
  ['basic authorization header', `${'Author'}ization: ${'Ba'}sic ${'dXNlcjpwYXNzd29yZA'}==`],
  ['token authorization header', `${'Author'}ization: ${'Tok'}en ${'t7'.repeat(8)}`],
  ['basic credential on its own', `${'Ba'}sic ${'dXNlcjpwYXNzd29yZA'}==`],
  ['cookie header', `${'Coo'}kie: ${'sid'}=${'k9'.repeat(8)}`],
  ['url with user and password', `${'postgres'}://${'user'}:${'pw'.repeat(4)}@db.example.test/app`],
];

describe('diagnosticSummary', () => {
  it('lists ids, states, ISO times, counts and contract versions for a task selection', () => {
    const task = notCreditedOf(1, bot, 'waiting-at-end', { runMs: 300_000 });
    const text = diagnosticSummary({ selection: { kind: 'work', workId: task.taskId }, model, bot: null, work: task, xp: null });
    expect(text).toContain(`taskId: ${task.taskId}`);
    expect(text).toContain(`attemptId: ${task.attemptId}`);
    expect(text).toContain('kind: worker');
    expect(text).toContain('state: not-credited, closeReason waiting-at-end, attempt ended');
    expect(text).toContain(`startedAt: ${new Date(task.startedAtMs).toISOString()}, endedAt ${new Date(task.endedAtMs ?? 0).toISOString()}`);
    expect(text).toContain('runMs: 300000, sizeClass medium');
    expect(text).toContain('xpCredited: none, policy xp-policy-2');
    expect(text).toContain(`asOf: ${new Date(NOW).toISOString()}`);
    expect(text).toContain('mode: FIXTURE — demo data, not Crew activity');
    expect(text).toContain('contracts: task-item v1');
  });

  it('says what a credited task earned and prints unknown times for an open one', () => {
    const credited = creditedOf(1, bot, { xpCredited: 14 });
    expect(diagnosticSummary({ selection: { kind: 'work', workId: credited.taskId }, model, bot: null, work: credited, xp: null })).toContain('xpCredited: 14, policy xp-policy-2');
    const open = taskOf(2, bot);
    const text = diagnosticSummary({ selection: { kind: 'work', workId: open.taskId }, model, bot: null, work: open, xp: null });
    expect(text).toContain('state: open, closeReason none, attempt working');
    expect(text).toContain('endedAt unknown, closedAt unknown');
  });

  it('describes a Specter selection from the bot and its XP, and leaves out the name', () => {
    const text = diagnosticSummary({ selection: { kind: 'specter', bindingId: bot.bindingId }, model, bot, work: null, xp: xpOf(bot, 150, 2) });
    expect(text).toContain(`bindingId: ${bot.bindingId}`);
    expect(text).toContain('condition: working (running)');
    expect(text).toContain('level: 2, totalXp 150');
    expect(text).toContain('contracts: roster-item v1, xp-summary v2');
    expect(text).not.toContain('Atlas');
  });

  it('reports a minimum when the task read was cut short, and says so for unread contracts', () => {
    const cut = buildSceneModel(inputsOf({ roster: [bot], tasks: [], tasksTruncated: true }));
    const text = diagnosticSummary({ selection: { kind: 'specter', bindingId: bot.bindingId }, model: cut, bot: null, work: null, xp: null });
    expect(text).toContain('counts are a minimum');
    expect(text).toContain('contracts: none read');
  });

  it.each(FAKES)('removes a %s from every free-text field', (_name, fake) => {
    const task = taskOf(2, bot);
    const poisoned = botOf(2, { condition: { ...bot.condition, reasonCode: fake } });
    const text = diagnosticSummary({ selection: { kind: 'work', workId: task.taskId }, model, bot: poisoned, work: task, xp: null });
    expect(text).not.toContain(fake);
    expect(text).toContain('[removed]');
  });

  it('never exceeds 4,000 characters and ends with a truncation line when it had to cut', () => {
    const task = taskOf(4, bot);
    const long = botOf(3, { condition: { ...bot.condition, reasonCode: `${'long '.repeat(900)}` } });
    const text = diagnosticSummary({ selection: { kind: 'work', workId: task.taskId }, model, bot: long, work: task, xp: null });
    expect(text.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(text.endsWith('\n[truncated]')).toBe(true);
  });

  it('prints unknown for a time it cannot place', () => {
    const odd = botOf(5, { lastObservedAtMs: null });
    const text = diagnosticSummary({ selection: { kind: 'specter', bindingId: odd.bindingId }, model, bot: odd, work: null, xp: null });
    expect(text).toContain('lastObservedAt: unknown');
  });
});

describe('scrubSecrets', () => {
  it('leaves ordinary text alone', () => {
    expect(scrubSecrets('state: open, 2 attempts, key results are fine')).toBe('state: open, 2 attempts, key results are fine');
  });

  it.each(['monkey=banana', 'keyboard: yes', 'author: Sam', 'Basic training', 'Basic configuration needed', 'selection: work', 'condition: working (running)'])('keeps %s readable', (text) => {
    expect(scrubSecrets(text)).toBe(text);
  });

  it('removes the whole quoted value, not just its first word', () => {
    expect(scrubSecrets(`${'pass'}word="${'two words'} here" after`)).toBe('[removed] after');
  });
});
