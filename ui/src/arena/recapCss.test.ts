// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./recap.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((match) => (match[1] ?? '').split(',').map((selector) => selector.trim()));

describe('recap.css', () => {
  it('has rules, each rooted at .specter-arena-root', () => {
    expect(selectors.length).toBeGreaterThan(10);
    expect(selectors.filter((selector) => !selector.startsWith('.specter-arena-root '))).toEqual([]);
  });

  it('uses no global selector, no at-rule, no Tailwind and no !important', () => {
    expect(css).not.toMatch(/@|:root|(^|[\s,])(html|body)\b|tailwind|!important/i);
    expect(selectors.filter((selector) => /(^|\s)\*(\s|$)/.test(selector))).toEqual([]);
  });
});
