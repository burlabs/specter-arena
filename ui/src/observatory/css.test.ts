// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS_PATH = fileURLToPath(new URL('./observatory.css', import.meta.url));
const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Walk {
  selectors: string[];
  atRules: string[];
}

function walk(source: string): Walk {
  const found: Walk = { selectors: [], atRules: [] };
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
      found.atRules.push(prelude.split(/\s|\(/)[0] ?? prelude);
      const inner = walk(body);
      found.selectors.push(...inner.selectors);
      found.atRules.push(...inner.atRules);
    } else {
      found.selectors.push(...prelude.split(',').map((selector) => selector.trim()));
    }
  }
  return found;
}

describe('observatory.css', () => {
  const { selectors, atRules } = walk(css);

  it('has rules', () => {
    expect(selectors.length).toBeGreaterThan(50);
  });

  it('roots every selector at .specter-arena-root', () => {
    expect(selectors.filter((selector) => !selector.startsWith('.specter-arena-root'))).toEqual([]);
  });

  it('prefixes every class below the root with sa-', () => {
    const classes = selectors.flatMap((selector) => [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] ?? ''));
    expect(classes.filter((name) => name !== 'specter-arena-root' && !name.startsWith('sa-'))).toEqual([]);
  });

  it('uses only @media at-rules', () => {
    expect(new Set(atRules)).toEqual(new Set(['@media']));
  });

  it('has no @import, @keyframes, :root, html, body or tailwind', () => {
    expect(css).not.toMatch(/@import|@keyframes|:root|(^|[\s,])(html|body)\b|tailwind/i);
  });

  it('uses !important only inside the reduced-motion block', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/, '');
    expect(outside).not.toContain('!important');
  });

  it('keeps every font size at 12px or more', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(sizes.filter((size) => size < 12)).toEqual([]);
  });
});
