// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('.', import.meta.url));
const ENGINE = ['recapPeriods.ts', 'recapParse.ts', 'recapTimeline.ts', 'recapFrames.ts', 'recapCues.ts'];
const textOf = (file: string): string => readFileSync(`${dir}${file}`, 'utf8');

describe('the recap engine takes its time as an argument (NFR-3)', () => {
  it.each(ENGINE)('%s reads no clock', (file) => {
    expect(textOf(file)).not.toMatch(/Date\.now|performance\.now|new Date\(\s*\)|requestAnimationFrame|setTimeout|setInterval|Math\.random/);
  });

  it.each(ENGINE)('%s does no I/O and reads no storage', (file) => {
    expect(textOf(file)).not.toMatch(/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|useHostApi|postJson/);
  });

  it('leaves the player and the read hook outside that rule: they hold the clocks the engine is given', () => {
    expect(textOf('useRecapPlayer.ts')).toMatch(/performance\.now/);
    expect(textOf('useRecap.ts')).toMatch(/Date\.now/);
  });
});
