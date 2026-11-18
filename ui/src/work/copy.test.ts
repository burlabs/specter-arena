import { describe, expect, it } from 'vitest';
import * as copy from './copy';
import { STATE_VIEWS } from './model';

const flatten = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(flatten);
  return [];
};

const calls = (): string[] => [
  copy.DETAIL.rewardedWhenAccepted(100, 'xp-policy-1'),
  copy.DETAIL.groupsParts(2),
  copy.DETAIL.groupsParts(1),
  copy.DETAIL.partsAccepted(1, 2),
  copy.DETAIL.partsAccepted(1, 1),
  copy.DETAIL.contributorLine('Atlas', 1, 0),
  copy.DETAIL.contributorLine('Atlas', 2, 50),
  copy.DETAIL.evidenceRow('Bot turn', 'att_1', 'Ended'),
  copy.DETAIL.decisionLine(1, 'Accepted', 'Open', 'Accepted'),
  copy.DETAIL.evidenceRef('abcd1234'),
  copy.PROGRESS.done(1, 3),
  copy.XP.levelWord(2),
  copy.XP.toward(50, 150, 3),
  copy.XP.entryPolicy('xp-policy-1'),
  copy.XP.policy('xp-policy-1', 'levels-1'),
  copy.REVIEW.accept.evidence(2, 'a, b'),
  copy.REVIEW.accept.evidence(1, 'a'),
  copy.REVIEW.accept.groups(2),
  copy.REVIEW.accept.groups(1),
  copy.REVIEW.accept.award(100, 2),
  copy.REVIEW.accept.award(100, 1),
  copy.CREATE.milestoneLabel(2),
  copy.CREATE.removeMilestone(2),
  copy.CREATE.counter(1, 120),
  copy.PICKER.selected(1, 16),
  copy.PICKER.limit(16),
  copy.PICKER.trackedIn('Quarterly close'),
  copy.ANNOUNCE.milestoneOn('One'),
  copy.ANNOUNCE.milestoneOff('One'),
  copy.ROW.awarded(50),
  copy.ROW.pending(100),
];

const allStrings = [...Object.values(copy).flatMap(flatten), ...calls(), ...Object.values(STATE_VIEWS).flatMap((view) => [view.label, view.reason])];

describe('work copy', () => {
  it('never says idle, healthy or available, which the page forbids everywhere (CP-1)', () => {
    expect(allStrings.filter((text) => /\b(idle|healthy|available)\b/i.test(text))).toEqual([]);
  });

  it('never calls an ended attempt a success, a result or a score (CP-1)', () => {
    expect(allStrings.filter((text) => /\b(success\w*|succeeded|complete\w*|defeat\w*|victory|finished|score|rank\w*|tier|grade|class\w*|role|rarity|AI)\b/i.test(text))).toEqual([]);
  });

  it('uses the word done only inside "milestones done" (CP-1)', () => {
    const outside = allStrings.map((text) => text.replace(/milestones done/g, '')).filter((text) => /\bdone\b/i.test(text));
    expect(outside).toEqual([]);
  });

  it('shows no percentage and no average, rate, token or ranking figure (CP-2)', () => {
    expect(allStrings.filter((text) => /%|\b(average|rate|token|tokens|ranking)\b/i.test(text))).toEqual([]);
  });

  it('has the exact sentences the contract names (CP-3)', () => {
    expect(copy.PROGRESS.unknown).toBe('Progress unknown');
    expect(copy.PROGRESS.done(2, 3)).toBe('2 of 3 milestones done');
    expect(copy.LEVEL_NOTE).toBe('Level reflects accepted work, not ability or current condition.');
    expect(copy.ACCEPT_OWNER_LINE).toBe('You are accepting this as the app owner.');
    expect(copy.REVIEW.accept.warning).toContain('You are accepting this as the app owner.');
    expect(copy.XP.unit).toBe('XP from accepted work');
    expect(copy.DETAIL.evidenceHelp).toBe('Ended says only that an attempt closed. It is not a result.');
    expect(copy.REVIEW.accept.evidence(2, 'att_1…, att_2…')).toBe('2 linked attempts: att_1…, att_2…');
  });

  it('gives every error code words and an unknown code a generic sentence (CP-4)', () => {
    const codes = [
      'stale_evidence', 'version_conflict', 'invalid_transition', 'attempts_not_ended', 'no_evidence', 'children_not_accepted', 'attempt_already_linked',
      'attempt_not_eligible', 'unknown_attempt', 'unknown_work', 'unknown_binding', 'parent_locked', 'contributors_frozen', 'request_reused', 'limit_reached',
      'invalid_body', 'invalid_state', 'invalid_cursor', 'invalid_limit', 'body_too_large', 'store_not_ready', 'store_unavailable', 'offline', 'unexpected', 'http_403', 'busy',
    ];
    expect(codes.filter((code) => copy.ERROR_WORDS[code] === undefined)).toEqual([]);
    for (const code of codes) expect(copy.errorWords(code).length).toBeGreaterThan(0);
    expect(copy.errorWords('brand_new_code')).toBe('Something went wrong (brand_new_code).');
  });

  it('words every blocker and every action, and flags unknown tokens (CP-5)', () => {
    for (const token of ['no-evidence', 'attempts-not-ended', 'attempt-missing', 'children-not-accepted', 'wrong-state']) expect(copy.blockerWords(token)).toBe(copy.BLOCKER_WORDS[token]);
    expect(copy.blockerWords('new-blocker')).toBe('Blocked by: new-blocker');
    for (const action of ['submit', 'accept', 'reject', 'block', 'unblock', 'cancel', 'reopen']) {
      expect(copy.actionWords(action)).toBe(copy.ACTION_WORDS[action]);
      expect(copy.ACTION_ANNOUNCE[action]).toBeTruthy();
    }
    expect(copy.actionWords('teleport')).toBe('Unknown action (teleport)');
  });

  it('words entry kinds, attempt kinds and flags unknown ones', () => {
    expect(copy.entryKindWords('award')).toBe('Award');
    expect(copy.entryKindWords('correction')).toBe('Correction (reopened)');
    expect(copy.entryKindWords('reinstatement')).toBe('Reinstated');
    expect(copy.entryKindWords('bonus')).toBe('Unknown entry (bonus)');
    expect(copy.kindWords('bot-turn')).toBe('Bot turn');
    expect(copy.kindWords('worker')).toBe('Worker');
    expect(copy.kindWords('odd')).toBe('odd');
  });

  it('asks for a reload after the codes that mean the item on screen is out of date', () => {
    for (const code of ['version_conflict', 'invalid_transition', 'attempts_not_ended', 'no_evidence', 'children_not_accepted', 'stale_evidence']) {
      expect(copy.REFRESH_CODES).toContain(code);
    }
    expect(copy.REFRESH_CODES).not.toContain('offline');
  });
});
