import { describe, expect, it } from 'vitest';
import { SUMMARY_MAX_CHARS, diagnosticSummary, scrubSecrets } from './diagnosticSummary';
import { buildSceneModel } from './sceneModel';
import { NOW, attemptOf, botOf, inputsOf, workOf, xpOf } from './testData';

const bot = botOf(1, { displayName: 'Atlas', state: 'working' });
const model = buildSceneModel(inputsOf({ roster: [bot], work: [] }));

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
  it('lists ids, states, ISO times, counts and contract versions for a work selection', () => {
    const work = workOf(1, {
      state: 'blocked',
      attempts: [attemptOf(bot, 1)],
      contributors: [{ bindingId: bot.bindingId, attemptCount: 1, xpNet: 0 }],
      decisions: [{ decisionId: 'dec_1', seq: 1, action: 'block', fromState: 'open', toState: 'blocked', actor: 'app-owner', atMs: NOW, note: 'private words', evidenceRevision: null }],
      progress: { done: 1, total: 3 },
    });
    const text = diagnosticSummary({ selection: { kind: 'work', workId: work.workId }, model, bot: null, work, xp: null });
    expect(text).toContain(`workId: ${work.workId}`);
    expect(text).toContain('state: blocked');
    expect(text).toContain('progress: 1 of 3 milestones');
    expect(text).toContain(`evidenceRevision: ${work.evidenceRevision}`);
    expect(text).toContain(`asOf: ${new Date(NOW).toISOString()}`);
    expect(text).toContain(`decision 1: block open>blocked at ${new Date(NOW).toISOString()}`);
    expect(text).toContain('mode: FIXTURE — demo data, not Crew activity');
    expect(text).toContain('contracts: work-item v1');
    expect(text).not.toContain('private words');
    expect(text).not.toContain(work.acceptanceCondition);
  });

  it('describes a Specter selection from the bot and its XP, and leaves out the name', () => {
    const text = diagnosticSummary({ selection: { kind: 'specter', bindingId: bot.bindingId }, model, bot, work: null, xp: xpOf(bot, 150, 2) });
    expect(text).toContain(`bindingId: ${bot.bindingId}`);
    expect(text).toContain('condition: working (running)');
    expect(text).toContain('level: 2, totalXp 150');
    expect(text).toContain('contracts: roster-item v1, xp-summary v1');
    expect(text).not.toContain('Atlas');
  });

  it('reports a minimum when the work read was cut short, and says so for unread contracts', () => {
    const cut = buildSceneModel(inputsOf({ roster: [bot], work: [], workTruncated: true }));
    const text = diagnosticSummary({ selection: { kind: 'specter', bindingId: bot.bindingId }, model: cut, bot: null, work: null, xp: null });
    expect(text).toContain('counts are a minimum');
    expect(text).toContain('contracts: none read');
  });

  it.each(FAKES)('removes a %s from every free-text field', (_name, fake) => {
    const hostile = workOf(2, {
      title: `Fix ${fake} now`,
      state: 'blocked',
      decisions: [{ decisionId: 'dec_2', seq: 1, action: 'block', fromState: 'open', toState: 'blocked', actor: 'app-owner', atMs: NOW, note: fake, evidenceRevision: null }],
      review: { canAccept: false, blockers: [fake] },
    });
    const poisoned = botOf(2, { condition: { ...bot.condition, reasonCode: fake } });
    const text = diagnosticSummary({ selection: { kind: 'work', workId: hostile.workId }, model, bot: poisoned, work: hostile, xp: null });
    expect(text).not.toContain(fake);
    expect(text).toContain('[removed]');
  });

  it('cuts a long title at 120 characters and flattens line breaks', () => {
    const work = workOf(3, { title: `${'long '.repeat(60)}\nsecond line` });
    const text = diagnosticSummary({ selection: { kind: 'work', workId: work.workId }, model, bot: null, work, xp: null });
    const line = text.split('\n').find((candidate) => candidate.startsWith('title: ')) ?? '';
    expect(line.length).toBeLessThanOrEqual('title: '.length + 120);
    expect(line.endsWith('…')).toBe(true);
    expect(text).not.toContain('second line');
  });

  it('never exceeds 4,000 characters and ends with a truncation line when it had to cut', () => {
    const many = workOf(4, {
      attempts: Array.from({ length: 300 }, (_, index) => attemptOf(bot, index + 1)),
    });
    const text = diagnosticSummary({ selection: { kind: 'work', workId: many.workId }, model, bot: null, work: many, xp: null });
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
