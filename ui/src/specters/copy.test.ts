import { describe, expect, it } from 'vitest';
import * as copy from './copy';
import {
  ARCHIVE,
  ERROR_WORDS,
  MANUAL,
  MANUAL_FORM,
  PRIVACY_NOTE,
  STATUS_WORDS,
  TOKEN_CAPTION,
  budgetLine,
  characterCount,
  errorWords,
  installBudgetLine,
  sourceWords,
  statusWords,
} from './copy';

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

  it('never names AI in the manual-entry strings', () => {
    expect(flatten(MANUAL).concat(flatten(MANUAL_FORM)).filter((text) => /\bAI\b/i.test(text))).toEqual([]);
  });

  it('has exact budget and token wording', () => {
    expect(budgetLine(3, 5)).toBe('3 of 5 left today for this bot');
    expect(installBudgetLine(19, 20)).toBe('19 of 20 left today across all bots');
    expect(TOKEN_CAPTION).toBe('Placeholder token, not a portrait');
    expect(characterCount(4, 40)).toBe('4 of 40');
    expect(ARCHIVE.ask('Vesper')).toBe('Archive Vesper? Its history is kept.');
  });

  it('gives every error code words, and names the cause of generation_unavailable', () => {
    for (const code of Object.keys(ERROR_WORDS)) expect(errorWords(code).length).toBeGreaterThan(0);
    expect(ERROR_WORDS.generation_unavailable).toMatch(/granted chat access in Crew/);
    expect(errorWords('brand_new_code')).toBe('Something went wrong (brand_new_code).');
  });

  it('covers every error code of the routes and the generator', () => {
    const codes = [
      'timeout', 'refused', 'malformed', 'interrupted', 'unavailable', 'generation_unavailable', 'generation_in_flight', 'budget_exhausted',
      'version_conflict', 'not_ready', 'unknown_binding', 'unknown_request', 'unknown_asset', 'no_specter', 'invalid_body', 'body_too_large',
      'asset_too_large', 'unsupported_media', 'invalid_image', 'store_not_ready', 'store_unavailable',
    ];
    expect(codes.filter((code) => ERROR_WORDS[code] === undefined)).toEqual([]);
  });

  it('words every status and flags an unknown one with its code', () => {
    for (const status of Object.keys(STATUS_WORDS)) expect(statusWords(status)).toBe(STATUS_WORDS[status]);
    expect(statusWords('mystery')).toBe('Unknown status (mystery)');
  });

  it('discloses that Crew keeps a record of the one-off summoning chat', () => {
    expect(PRIVACY_NOTE).toContain('Crew keeps a record');
  });

  it('words the source of a profile and an unknown source', () => {
    expect(sourceWords('generated', 'summon-1')).toBe('Generated through Crew, prompt version summon-1');
    expect(sourceWords('generated', null)).toBe('Generated through Crew');
    expect(sourceWords('manual', null)).toBe('Written by you');
    expect(sourceWords('mystery', null)).toBe('Unknown source (mystery)');
  });
});
