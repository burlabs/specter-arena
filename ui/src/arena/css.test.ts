// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '../contracts/types';

const css = readFileSync(fileURLToPath(new URL('./arena.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Found {
  selectors: string[];
  atRules: string[];
  keyframes: string[];
}

function walk(source: string, insideKeyframes = false): Found {
  const found: Found = { selectors: [], atRules: [], keyframes: [] };
  let index = 0;
  const readBlock = (): string => {
    let depth = 1;
    const start = index;
    while (depth > 0 && index < source.length) {
      const char = source[index++];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
    }
    return source.slice(start, index - 1);
  };
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open === -1) break;
    const prelude = source.slice(index, open).trim();
    index = open + 1;
    const body = readBlock();
    if (prelude.startsWith('@')) {
      const name = prelude.split(/\s|\(/)[0] ?? prelude;
      found.atRules.push(name);
      if (name === '@keyframes') found.keyframes.push(prelude.split(/\s+/)[1] ?? '');
      const inner = walk(body, name === '@keyframes');
      found.selectors.push(...inner.selectors);
      found.atRules.push(...inner.atRules);
      found.keyframes.push(...inner.keyframes);
    } else if (!insideKeyframes) {
      found.selectors.push(...prelude.split(',').map((selector) => selector.trim()));
    }
  }
  return found;
}

describe('arena.css', () => {
  const { selectors, atRules, keyframes } = walk(css);

  it('has rules', () => {
    expect(selectors.length).toBeGreaterThan(60);
  });

  it('roots every selector at .specter-arena-root and uses no global selector', () => {
    expect(selectors.filter((selector) => !selector.startsWith('.specter-arena-root '))).toEqual([]);
    expect(css).not.toMatch(/@import|:root|(^|[\s,])(html|body)\b|tailwind/i);
  });

  it('prefixes every class below the root with sa-', () => {
    const classes = selectors.flatMap((selector) => [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] ?? ''));
    expect(classes.filter((name) => name !== 'specter-arena-root' && !name.startsWith('sa-'))).toEqual([]);
  });

  it('uses only @media and @keyframes with sa- names', () => {
    expect(new Set(atRules)).toEqual(new Set(['@media', '@keyframes']));
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.filter((name) => !name.startsWith('sa-arena-'))).toEqual([]);
  });

  it('ends with the single reduced-motion block, the only place !important appears', () => {
    const marker = '@media (prefers-reduced-motion: reduce)';
    const at = css.lastIndexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(0, at)).not.toContain('!important');
    expect(css.slice(at).match(/@media/g)).toHaveLength(1);
    expect(css.slice(at)).toContain('animation: none !important');
    expect(css.slice(at)).toContain('transition: none !important');
  });

  it('defines an idle keyframe and an animation rule for each of the 11 heroes, and no keyframe without a rule', () => {
    expect(HERO_IDS).toHaveLength(11);
    for (const id of HERO_IDS) {
      expect(keyframes, id).toContain(`sa-arena-${id}-idle`);
      expect(selectors, id).toContain(`.specter-arena-root .sa-hero--${id}.sa-is-animated .sa-hero__img`);
      expect(css, id).toContain(`animation-name: sa-arena-${id}-idle;`);
    }
    expect(keyframes.filter((name) => name.endsWith('-idle'))).toHaveLength(11);
  });

  it('keeps every font size at 12px or more', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((size) => size < 12)).toEqual([]);
  });

  it('carries no hex colour that a custom property already provides, and no hex at all', () => {
    const provided = ['#141020', '#211a33', '#2c2340', '#45375f', '#f7f3ff', '#c5bdd6', '#b49aff', '#ffd080', '#88dde6', '#92dfb8', '#ff9bae'];
    expect(provided.filter((hex) => css.toLowerCase().includes(hex))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
