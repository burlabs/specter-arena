// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(`${root}${dir}`, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : [],
  );
const sources = ['observatory', 'arena', 'work', 'specters', 'lifecycle'].flatMap(files).map((file) => ({ file, text: readFileSync(`${root}${file}`, 'utf8') }));

/** The only files that may name the context reading. Everything else (XP, work, Specters, arena, roster rows, KPIs, sorting) may not. */
const ALLOWED = new Set(['observatory/model.ts', 'observatory/TokenStat.tsx', 'observatory/BotDetail.tsx', 'observatory/copy.ts']);

describe('context reading guards (FD-29)', () => {
  it('reads the source folders', () => {
    expect(sources.length).toBeGreaterThan(80);
  });

  it('names tokenReading only where the Roster detail Activity tab needs it', () => {
    expect(sources.filter(({ file, text }) => /tokenReading/.test(text) && !ALLOWED.has(file)).map(({ file }) => file)).toEqual([]);
  });

  it('never sorts, sums or ranks a reading', () => {
    const offenders = sources.filter(({ text }) => /(used|window|observedAt)\s*[-+<>]|reduce\([^)]*(used|tokenReading)|sort\([^)]*(used|tokenReading)/.test(text) && /tokenReading|readingOf/.test(text));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it('keeps the reading out of every XP, work, Specter and arena file', () => {
    const near = sources.filter(({ file }) => /^(work|specters|arena)\//.test(file) && /readingOf|TokenStat|contextWords/.test(readFileSync(`${root}${file}`, 'utf8')));
    expect(near.map(({ file }) => file)).toEqual([]);
  });

  it('the new observatory files never write to Crew', () => {
    for (const name of ['observatory/TokenStat.tsx', 'observatory/useRoster.ts']) {
      expect(sources.find(({ file }) => file === name)?.text).not.toMatch(/postJson|\.post\(|\bfetch\(/);
    }
  });
});
