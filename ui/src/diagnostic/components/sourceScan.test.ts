// @vitest-environment node
// SPECTER-DIAGNOSTIC-ONLY
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_MARKER } from '../model';

const dir = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name));
const isTest = (name: string) => /\.test\.(ts|tsx)$/.test(name);
const sources = files.filter((name) => !isTest(name));
const read = (name: string) => readFileSync(`${dir}${name}`, 'utf8');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BANNED_PATTERNS: [string, RegExp][] = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['MarkdownRenderer', /MarkdownRenderer/],
  ['createRoot', /createRoot/],
  ['host hook useAppApi', /useAppApi/],
  ['host hook useAppEvents', /useAppEvents/],
  ['@kirocrew/ import', /@kirocrew\//],
  ['react-dom import', /from\s+['"]react-dom/],
  ['React 19 useActionState', /\buseActionState\b/],
  ['React 19 useOptimistic', /\buseOptimistic\b/],
  ['React 19 useFormStatus', /\buseFormStatus\b/],
  ['React 19 use()', /\buse\(/],
];

const BANNED_WORDS: [string, RegExp][] = [
  ['accepted', /\baccepted\b/i],
  ['health', /\bhealth\b/i],
  ['HP', /\bHP\b/],
  ['score', /\bscore\b/i],
  ['XP', /\bXP\b/],
  ['level', /\blevel\b/i],
];

describe('diagnostic components source scan', () => {
  it('finds the component sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)('%s carries the diagnostic marker in a comment', (name) => {
    expect(read(name)).toContain(DIAGNOSTIC_MARKER);
  });

  it.each(sources)('%s uses none of the banned APIs', (name) => {
    const code = stripComments(read(name));
    for (const [label, pattern] of BANNED_PATTERNS) expect(pattern.test(code), `${name} uses ${label}`).toBe(false);
  });

  it.each(sources)('%s uses none of the banned vocabulary', (name) => {
    const code = stripComments(read(name));
    for (const [label, pattern] of BANNED_WORDS) expect(pattern.test(code), `${name} contains "${label}"`).toBe(false);
  });

  it('keeps the shared rule and marker constant in model.ts', () => {
    const labels = read('labels.ts');
    expect(labels).not.toMatch(/DIAGNOSTIC_MARKER\s*=/);
    expect(stripComments(labels)).not.toMatch(/===?\s*'APP-TOKEN'/);
  });

  it('keeps testData out of non-test files', () => {
    for (const name of sources) expect(read(name), `${name} imports testData`).not.toMatch(/from\s+['"]\.\/testData/);
  });

  it('puts the marker attribute on the root element of every rendering component', () => {
    for (const name of sources.filter((file) => file.endsWith('.tsx'))) {
      expect(read(name), `${name} lacks data-specter-diagnostic`).toContain('data-specter-diagnostic={DIAGNOSTIC_MARKER}');
    }
  });
});
