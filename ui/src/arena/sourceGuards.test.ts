// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => ({ file, text: readFileSync(`${dir}${file}`, 'utf8') }));

const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ['requestAnimationFrame', /requestAnimationFrame/],
  ['Math.random', /Math\.random/],
  ['postJson', /postJson/],
  ['.post(', /\.post\(/],
  ['fetch(', /\bfetch\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['localStorage', /localStorage/],
  ['sessionStorage', /sessionStorage/],
  ['waiting on you', /waiting on you/i],
  ['tailwind', /tailwind/i],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['!important outside CSS', /!important/],
];

describe('arena source guards', () => {
  it('reads the arena folder', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('contains no %s', (name, pattern) => {
    const hits = sources.filter(({ file, text }) => (name === '!important outside CSS' && file.endsWith('.css') ? false : pattern.test(text))).map(({ file }) => file);
    expect(hits).toEqual([]);
  });

  it('imports nothing from the fixtures and nothing that writes', () => {
    const hits = sources.filter(({ text }) => /from '\.\.\/\.\.\/fixtures|useSummoning|workDecisionsPath|workAttemptsPath|workMilestonesPath|specterPortraitPath/.test(text)).map(({ file }) => file);
    expect(hits).toEqual([]);
  });

  it('reaches the work write hook from one file, the inspector, and only hands it to the reused review panel', () => {
    expect(sources.filter(({ text }) => /useWorkActions/.test(text)).map(({ file }) => file)).toEqual(['WorkInspector.tsx']);
    const inspector = sources.find(({ file }) => file === 'WorkInspector.tsx')?.text ?? '';
    expect(inspector.match(/useWorkActions\(\)/g)).toHaveLength(1);
    expect(inspector).toMatch(/<ReviewPanel[\s\S]*actions=\{actions\}/);
    expect(sources.filter(({ text }) => /\.(?:decide|create|linkAttempt|setMilestone)\(/.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it('navigates only through the host hook and never with a raw location write', () => {
    expect(sources.filter(({ text }) => /window\.location|location\.(?:assign|href|replace)|\bwindow\.open\b/.test(text)).map(({ file }) => file)).toEqual([]);
    expect(sources.filter(({ text }) => /useHostNavigate/.test(text)).map(({ file }) => file)).toEqual(['HandoffRow.tsx']);
  });

  it('never passes the work-decision path or any write path to a request', () => {
    expect(sources.filter(({ text }) => /\bpost\b/i.test(text.replace(/\/\/.*$/gm, ''))).map(({ file }) => file).filter((file) => file !== 'copy.ts')).toEqual([]);
  });
});
