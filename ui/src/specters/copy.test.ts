import { describe, expect, it } from 'vitest';
import * as copy from './copy';
import { ACTIONS, COLLECTION, ERROR_WORDS, FIELD_LABELS, HERO_NOTE, HERO_PENDING, PICKER, TOKEN_CAPTION, errorWords } from './copy';

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
    expect(Object.keys(ACTIONS)).toEqual(['avatar', 'checkAgain']);
  });

  it('pins the hero, avatar and token wording', () => {
    expect(HERO_NOTE).toBe('This hero came with the bot when it first appeared. Its name and personality are fixed. You can change the avatar.');
    expect(HERO_PENDING).toContain('has not been given a hero yet');
    expect(ACTIONS.avatar).toBe('Change avatar');
    expect(PICKER.heroDefault).toBe('Use the hero portrait');
    expect(PICKER.heading).toBe('Choose an avatar');
    expect(TOKEN_CAPTION).toBe('Placeholder token, not a portrait');
    expect(Object.values(FIELD_LABELS)).toEqual(['Bot', 'Progression', 'Personality', 'Appearance']);
  });

  it('uses no role, class, lane or tier word', () => {
    expect(allStrings.filter((text) => /\b(class|role|lane|tank|healer|archetype|tier)\b/i.test(text))).toEqual([]);
  });

  it('pins the filter and sort option labels', () => {
    expect(Object.values(COLLECTION.filters)).toEqual(['All', 'Assigned', 'Unassigned', 'Avatar changed']);
    expect(Object.values(COLLECTION.sorts)).toEqual(['Roster order', 'Name', 'Level', 'XP']);
  });

  it('gives every error code words and flags an unknown one', () => {
    for (const code of Object.keys(ERROR_WORDS)) expect(errorWords(code).length).toBeGreaterThan(0);
    expect(errorWords('brand_new_code')).toBe('Something went wrong (brand_new_code).');
  });

  it('covers every error code the seven routes can answer', () => {
    const codes = ['version_conflict', 'unknown_binding', 'unknown_asset', 'invalid_body', 'body_too_large', 'asset_too_large', 'unsupported_media', 'invalid_image', 'store_not_ready', 'store_unavailable'];
    expect(codes.filter((code) => ERROR_WORDS[code] === undefined)).toEqual([]);
  });
});
