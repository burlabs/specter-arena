// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS_PATH = fileURLToPath(new URL('./work.css', import.meta.url));
const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function selectorsOf(source: string): { selectors: string[]; atRules: string[] } {
  const found = { selectors: [] as string[], atRules: [] as string[] };
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open === -1) break;
    const prelude = source.slice(index, open).trim();
    index = open + 1;
    let depth = 1;
    const start = index;
    while (depth > 0 && index < source.length) {
      const char = source[index++];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
    }
    const body = source.slice(start, index - 1);
    if (prelude.startsWith('@')) {
      found.atRules.push(prelude.split(/\s|\(/)[0] ?? prelude);
      const inner = selectorsOf(body);
      found.selectors.push(...inner.selectors);
      found.atRules.push(...inner.atRules);
    } else {
      found.selectors.push(...prelude.split(',').map((selector) => selector.trim()));
    }
  }
  return found;
}

describe('work.css', () => {
  const { selectors, atRules } = selectorsOf(css);

  it('has rules (CSS-1)', () => {
    expect(selectors.length).toBeGreaterThan(20);
  });

  it('roots every selector at .specter-arena-root and prefixes every class with sa- (CSS-2, CSS-3)', () => {
    expect(selectors.filter((selector) => !selector.startsWith('.specter-arena-root'))).toEqual([]);
    const classes = selectors.flatMap((selector) => [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] ?? ''));
    expect(classes.filter((name) => name !== 'specter-arena-root' && !name.startsWith('sa-'))).toEqual([]);
  });

  it('uses only @media, no keyframes, and none of the page-wide selectors (CSS-4)', () => {
    expect(new Set(atRules)).toEqual(new Set(['@media']));
    expect(css).not.toMatch(/@import|@keyframes|:root|(^|[\s,])(html|body)\b|tailwind/i);
  });

  it('ends with the reduced-motion block, the only place !important appears (CSS-5, RM-1)', () => {
    const marker = '@media (prefers-reduced-motion: reduce)';
    const at = css.lastIndexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(0, at)).not.toContain('!important');
    expect(css.slice(at).match(/@media/g)).toHaveLength(1);
    expect(css.slice(at)).toContain('transition: none !important');
    expect(css.slice(at)).toContain('animation: none !important');
  });

  it('keeps every font size at 12px or more (CSS-6)', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((size) => size < 12)).toEqual([]);
  });

  it('carries no hex colour that a custom property already provides', () => {
    const provided = ['#141020', '#211a33', '#2c2340', '#45375f', '#f7f3ff', '#c5bdd6', '#b49aff', '#ffd080', '#88dde6', '#92dfb8', '#ff9bae'];
    expect(provided.filter((hex) => css.toLowerCase().includes(hex))).toEqual([]);
  });
});
