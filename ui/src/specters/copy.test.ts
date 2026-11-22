import { describe, expect, it } from 'vitest';
import * as copy from './copy';
import { ACTIONS, ASSIGN, ERROR_WORDS, FIELD_LABELS, HERO_NOTE, HERO_PENDING, PICKER, SHOWCASE, TOKEN_CAPTION, errorWords } from './copy';

const flatten = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(flatten);
  return [];
};

const allStrings = Object.values(copy).flatMap(flatten);

describe('specter copy', () => {
  it('never says idle, healthy or available, which the roster forbids on the whole page', () => {
    expect(allStrings.filter((text) => /\b(idle|healthy|available)\b/i.test(text))).toEqual([]);
  });

  it('has no summoning, generation, rename, manual-entry or archive wording left', () => {
    expect(allStrings.filter((text) => /summon|generat|reroll|rename|manual|archive|prompt|budget|Crew keeps/i.test(text))).toEqual([]);
    expect(Object.keys(ACTIONS)).toEqual(['avatar', 'checkAgain', 'assign']);
  });

  it('pins the hero, avatar and token wording', () => {
    expect(HERO_NOTE).toBe('This hero was assigned to the bot. Its name and personality are fixed. You can change the avatar.');
    expect(HERO_PENDING).toContain('has not been given a hero yet');
    expect(ACTIONS.avatar).toBe('Change avatar');
    expect(PICKER.heroDefault).toBe('Use the hero portrait');
    expect(PICKER.heading).toBe('Choose an avatar');
    expect(TOKEN_CAPTION).toBe('Placeholder token, not a portrait');
    expect(Object.values(FIELD_LABELS)).toEqual(['Progression', 'Personality', 'Appearance']);
  });

  it('uses no role, class, lane or tier word', () => {
    expect(allStrings.filter((text) => /\b(class|role|lane|tank|healer|archetype|tier)\b/i.test(text))).toEqual([]);
  });

  it('pins the walkthrough and showcase wording', () => {
    expect(ASSIGN.note).toBe('A bot keeps its Specter once assigned.');
    expect(ASSIGN.title('Atlas')).toBe('Choose a Specter for Atlas');
    expect(ASSIGN.step(2, 4)).toBe('Step 2 of 4');
    expect(ASSIGN.held(0)).toBe('not held yet');
    expect(ASSIGN.held(2)).toBe('held by 2');
    expect(ASSIGN.assign('Vell')).toBe('Assign Vell');
    expect(ASSIGN.randomize).toBe('Randomize all unassigned');
    expect(ASSIGN.skip).toBe('Skip for now');
    expect(ASSIGN.progress(1, 3)).toBe('Assigning 1 of 3…');
    expect(ASSIGN.summary(3, 1, 0)).toBe('3 assigned, 1 skipped');
    expect(ASSIGN.summary(3, 0, 2)).toBe('3 assigned, 0 skipped, 2 could not be assigned');
    expect(SHOWCASE.assignButton(4)).toBe('Assign Specters (4)');
    expect(SHOWCASE.holders(2)).toBe('Bots with this Specter (2)');
    expect(SHOWCASE.stageLabel('Vell')).toBe('Vell, large preview');
    expect(SHOWCASE.noHolders('Vell')).toBe('No bot holds Vell yet.');
    expect(SHOWCASE.showInRoster('Atlas')).toBe('Show Atlas in the Roster');
    expect([SHOWCASE.attack, SHOWCASE.cast]).toEqual(['Attack', 'Cast']);
  });

  it('gives every error code words and flags an unknown one', () => {
    for (const code of Object.keys(ERROR_WORDS)) expect(errorWords(code).length).toBeGreaterThan(0);
    expect(errorWords('brand_new_code')).toBe('Something went wrong (brand_new_code).');
  });

  it('covers every error code the seven routes can answer', () => {
    const codes = ['version_conflict', 'unknown_binding', 'unknown_asset', 'invalid_body', 'body_too_large', 'asset_too_large', 'unsupported_media', 'invalid_image', 'upload_limit_reached', 'store_not_ready', 'store_unavailable', 'no_hero', 'invalid_response'];
    expect(codes.filter((code) => ERROR_WORDS[code] === undefined)).toEqual([]);
  });
});
