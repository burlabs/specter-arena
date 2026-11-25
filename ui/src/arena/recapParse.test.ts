// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECAP_TASK_CAP, parseRecap } from './recapParse';
import { covered, notCollected, notCredited, recapOf, rosterOf, runOf } from './recapTestData';
import { ShapeError } from '../work/model';

const casesDir = fileURLToPath(new URL('../../../contracts/cases/recap/v1/', import.meta.url));
const cases = JSON.parse(readFileSync(`${casesDir}cases.json`, 'utf8')) as Array<{ file: string; valid: boolean }>;
const [bot] = rosterOf(1) as [ReturnType<typeof rosterOf>[number]];
const good = () => recapOf([runOf(1, bot, 5, 20), runOf(2, bot, 30, null, { updatedAtMs: 1 })], 60, [covered(0, 40), notCollected(40, 50, 'purged'), covered(50, 60)]);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const mutate = (change: (body: Record<string, any>) => void): unknown => {
  const body = clone(good()) as unknown as Record<string, any>;
  change(body);
  return body;
};

describe('recap.v1 reader', () => {
  it('accepts a well-formed recap and returns it whole', () => {
    expect(parseRecap(clone(good()))).toEqual(good());
  });

  it.each(cases)('agrees with the shared case $file', ({ file, valid }) => {
    const body = JSON.parse(readFileSync(`${casesDir}${file}`, 'utf8')) as unknown;
    if (valid) expect(parseRecap(body)).toEqual(body);
    else expect(() => parseRecap(body)).toThrow(ShapeError);
  });

  it.each([
    ['a missing key', (body: Record<string, any>) => delete body.taskCap],
    ['an extra key', (body: Record<string, any>) => (body.order = 'asc')],
    ['another contract version', (body: Record<string, any>) => (body.contractVersion = 2)],
    ['a float time', (body: Record<string, any>) => (body.fromMs = 1.5)],
    ['a negative time', (body: Record<string, any>) => (body.fromMs = -1)],
    ['an empty period', (body: Record<string, any>) => (body.toMs = body.fromMs)],
    ['an end after the store clock', (body: Record<string, any>) => (body.asOfMs = body.toMs - 1)],
    ['a wrong task cap', (body: Record<string, any>) => (body.taskCap = 999)],
    ['truncated with nothing omitted', (body: Record<string, any>) => (body.truncated = true)],
    ['omitted without truncated', (body: Record<string, any>) => (body.omittedCount = 3)],
    ['coverage that is not an object', (body: Record<string, any>) => (body.coverage = [])],
    ['coverage with an extra key', (body: Record<string, any>) => (body.coverage.note = 'x')],
    ['a first run that is not a time', (body: Record<string, any>) => (body.coverage.firstRunMs = 'x')],
    ['a horizon that is not a time', (body: Record<string, any>) => (body.coverage.purgeHorizonMs = -3)],
    ['no spans', (body: Record<string, any>) => (body.coverage.spans = [])],
    ['spans that are not a list', (body: Record<string, any>) => (body.coverage.spans = {})],
    ['a span that is not an object', (body: Record<string, any>) => (body.coverage.spans[0] = 4)],
    ['a gap between spans', (body: Record<string, any>) => (body.coverage.spans[1].fromMs += 1)],
    ['spans that overlap', (body: Record<string, any>) => (body.coverage.spans[1].fromMs -= 1)],
    ['a span of no length', (body: Record<string, any>) => (body.coverage.spans[2].toMs = body.coverage.spans[2].fromMs)],
    ['spans that start late', (body: Record<string, any>) => (body.coverage.spans[0].fromMs += 1)],
    ['spans that end early', (body: Record<string, any>) => (body.coverage.spans[2].toMs -= 1)],
    ['a covered span that is not collecting', (body: Record<string, any>) => (body.coverage.spans[0].reason = 'paused')],
    ['a not-collected span that says collecting', (body: Record<string, any>) => (body.coverage.spans[1].reason = 'collecting')],
    ['an unknown reason', (body: Record<string, any>) => (body.coverage.spans[1].reason = 'app-closed')],
    ['an unknown state', (body: Record<string, any>) => (body.coverage.spans[1].state = 'idle')],
    ['a task that is not a task', (body: Record<string, any>) => (body.tasks[0].taskId = 'x')],
    ['tasks that are not a list', (body: Record<string, any>) => (body.tasks = null)],
    ['tasks out of order', (body: Record<string, any>) => body.tasks.reverse()],
    ['a repeated task', (body: Record<string, any>) => body.tasks.push(clone(body.tasks[1]))],
    ['a task that starts at the end of the period', (body: Record<string, any>) => (body.tasks[1].startedAtMs = body.toMs)],
    ['a task that ends before it starts', (body: Record<string, any>) => (body.tasks[0].endedAtMs = body.tasks[0].startedAtMs - 1)],
    ['a task that ended before the period began', (body: Record<string, any>) => Object.assign(body.tasks[0], { startedAtMs: body.fromMs - 20 * 60_000, endedAtMs: body.fromMs - 1 })],
  ])('rejects %s', (_, change) => {
    expect(() => parseRecap(mutate(change))).toThrow(ShapeError);
  });

  it.each([null, [], 'recap', 7])('rejects %j, which is not an object', (body) => {
    expect(() => parseRecap(body)).toThrow(ShapeError);
  });

  it(`rejects more than ${RECAP_TASK_CAP} tasks`, () => {
    const body = clone(good());
    body.tasks = Array.from({ length: RECAP_TASK_CAP + 1 }, (_, index) => runOf(index + 1, bot, 5, 20));
    expect(() => parseRecap(body)).toThrow(ShapeError);
  });

  it('accepts a task that started before the period and one that is not credited', () => {
    const body = recapOf([runOf(1, bot, -10, 20), runOf(2, bot, 30, 40, notCredited)], 60);
    expect(parseRecap(clone(body))).toEqual(body);
  });
});
