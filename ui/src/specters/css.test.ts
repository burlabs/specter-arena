// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS_PATH = fileURLToPath(new URL('./specters.css', import.meta.url));
const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Walk {
  selectors: string[];
  atRules: string[];
  keyframes: string[];
}

function walk(source: string, insideKeyframes = false): Walk {
  const found: Walk = { selectors: [], atRules: [], keyframes: [] };
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

describe('specters.css', () => {
  const { selectors, atRules, keyframes } = walk(css);

  it('has rules', () => {
    expect(selectors.length).toBeGreaterThan(30);
  });

  it('roots every selector at .specter-arena-root', () => {
    expect(selectors.filter((selector) => !selector.startsWith('.specter-arena-root'))).toEqual([]);
  });

  it('prefixes every class below the root with sa-', () => {
    const classes = selectors.flatMap((selector) => [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] ?? ''));
    expect(classes.filter((name) => name !== 'specter-arena-root' && !name.startsWith('sa-'))).toEqual([]);
  });

  it('uses only @media and @keyframes, with sa- keyframe names', () => {
    expect(new Set(atRules)).toEqual(new Set(['@media', '@keyframes']));
    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes.filter((name) => !name.startsWith('sa-'))).toEqual([]);
  });

  it('has no @import, :root, html, body or tailwind', () => {
    expect(css).not.toMatch(/@import|:root|(^|[\s,])(html|body)\b|tailwind/i);
  });

  it('ends with the reduced-motion block, the only place !important appears', () => {
    const marker = '@media (prefers-reduced-motion: reduce)';
    const at = css.lastIndexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(0, at)).not.toContain('!important');
    expect(css.slice(at).match(/@media/g)).toHaveLength(1);
    expect(css.slice(at)).toContain('animation: none !important');
  });

  it('keeps every font size at 12px or more', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(sizes.filter((size) => size < 12)).toEqual([]);
  });
});
