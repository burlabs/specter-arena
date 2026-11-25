import type { RecapSpanV1, RecapV1, TaskItemV1 } from '../contracts/types';
import { MEDIUM_BELOW_MS, SMALL_BELOW_MS } from '../tasks/model';
import type { RecapKind } from './recapPeriods';

/** The playback constants: play length, beat and minimum-stay times, and the shortest stretch that gets its own skip label. */
export const TIMELINE = {
  MIN_PLAY_MS: 30_000,
  MAX_PLAY_MS: 180_000,
  MAX_PLAY_WEEK_MS: 240_000,
  ACTIVE_DIVISOR: 60,
  MIN_VISIBLE_MS: 900,
  NOT_COLLECTED_BEAT_MS: 1_200,
  BEATS_MAX_MS: 6_000,
  SKIP_LABEL_MIN_MS: 60_000,
} as const;

/** `play`: source time plays at the common rate. `skip`: no task ran and the collector was on, so it is cut out. `beat`: not collected with no task, so it plays as a short fixed pause. */
export type SegmentKind = 'play' | 'skip' | 'beat';

export interface PlaySegment {
  kind: SegmentKind;
  srcFromMs: number;
  srcToMs: number;
  playFromMs: number;
  playToMs: number;
  /** The not-collected span this stretch lies in, else null. A `play` segment with one is shown hatched at the normal rate. */
  notCollected: RecapSpanV1 | null;
}

/** Trimmed time shown as "Skipped N min". Stretches under `SKIP_LABEL_MIN_MS` ride along with the next marker. */
export interface SkipMarker {
  playAtMs: number;
  skippedMs: number;
  stretches: number;
}

export interface TimelineTask {
  task: TaskItemV1;
  /** The recorded run inside the period, in source time. */
  srcFromMs: number;
  srcToMs: number;
  /** Where the run starts and ends in play time. */
  playFromMs: number;
  playToMs: number;
  /** When the minion is on screen: from `playFromMs`, and at least `MIN_VISIBLE_MS`. */
  visibleFromMs: number;
  visibleToMs: number;
  /** Credited and ended inside the period: the play time of its defeat. Otherwise null. */
  defeatAtMs: number | null;
  /** False when the task is still running at the end of the period (it never leaves or is defeated). */
  endsInPeriod: boolean;
}

export interface Timeline {
  kind: RecapKind;
  fromMs: number;
  toMs: number;
  /** Play length of the whole recap, beats and the last minion's minimum stay included. */
  totalMs: number;
  /** Source time with at least one task running. */
  activeMs: number;
  /** Source milliseconds per play millisecond at 1x. */
  rate: number;
  collectedMs: number;
  notCollectedMs: number;
  segments: PlaySegment[];
  /** The segments that take play time, in order: what a play time looks up in. */
  playing: PlaySegment[];
  markers: SkipMarker[];
  tasks: TimelineTask[];
  /** Play times where the scene changes or something is announced, ascending, from 0 to `totalMs`. */
  events: number[];
  /** Why nothing plays, or null. */
  empty: 'no-tasks' | 'not-collected' | null;
}

const isNotCollected = (span: RecapSpanV1): boolean => span.state === 'not-collected';

function clipped(task: TaskItemV1, fromMs: number, toMs: number): { from: number; to: number; endsInPeriod: boolean } {
  const from = Math.max(task.startedAtMs, fromMs);
  const endsInPeriod = task.endedAtMs !== null && task.endedAtMs <= toMs;
  const to = Math.max(from, Math.min(task.endedAtMs ?? toMs, toMs));
  return { from, to, endsInPeriod };
}

function unionOf(intervals: ReadonlyArray<{ from: number; to: number }>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const { from, to } of [...intervals].filter((item) => item.to > item.from).sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

const within = (list: ReadonlyArray<readonly [number, number]>, from: number, to: number): boolean => list.some(([start, end]) => start <= from && to <= end);

interface RawSegment {
  kind: SegmentKind;
  srcFromMs: number;
  srcToMs: number;
  notCollected: RecapSpanV1 | null;
}

/** Cuts the period at every task edge and span edge, then merges neighbours that read the same. */
function rawSegments(recap: RecapV1, busy: ReadonlyArray<readonly [number, number]>): RawSegment[] {
  const cuts = new Set<number>([recap.fromMs, recap.toMs]);
  for (const [from, to] of busy) {
    cuts.add(from);
    cuts.add(to);
  }
  for (const span of recap.coverage.spans) {
    cuts.add(span.fromMs);
    cuts.add(span.toMs);
  }
  const points = [...cuts].filter((point) => point >= recap.fromMs && point <= recap.toMs).sort((a, b) => a - b);
  const spans = recap.coverage.spans;
  const out: RawSegment[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index] as number;
    const to = points[index + 1] as number;
    const span = spans.find((candidate) => candidate.fromMs <= from && to <= candidate.toMs);
    const notCollected = span !== undefined && isNotCollected(span) ? span : null;
    const kind: SegmentKind = within(busy, from, to) ? 'play' : notCollected === null ? 'skip' : 'beat';
    const last = out[out.length - 1];
    const mergeable = last !== undefined && last.kind === kind && (kind !== 'play' || last.notCollected === notCollected);
    if (last === undefined || !mergeable) {
      out.push({ kind, srcFromMs: from, srcToMs: to, notCollected });
      continue;
    }
    last.srcToMs = to;
    const longer = (a: RecapSpanV1 | null, b: RecapSpanV1 | null): boolean => a !== null && (b === null || a.toMs - a.fromMs > b.toMs - b.fromMs);
    if (kind === 'beat' && longer(notCollected, last.notCollected)) last.notCollected = notCollected;
  }
  return out;
}

function mapSourceToPlay(segments: readonly PlaySegment[], fromMs: number, toMs: number, endPlayMs: number, srcMs: number): number {
  if (srcMs <= fromMs) return 0;
  if (srcMs >= toMs) return endPlayMs;
  const segment = segments[lastIndexAtOrBefore(segments, srcMs, (item) => item.srcFromMs)] as PlaySegment;
  const span = segment.srcToMs - segment.srcFromMs;
  return segment.playFromMs + (span === 0 ? 0 : ((srcMs - segment.srcFromMs) / span) * (segment.playToMs - segment.playFromMs));
}

/** The index of the last item whose key is at or before `value`, or 0 when none is. Keys ascend. */
export function lastIndexAtOrBefore<T>(list: readonly T[], value: number, key: (item: T) => number): number {
  let low = 0;
  let high = list.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (key(list[middle] as T) <= value) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/**
 * The play-time shape of a recap, with the numbers in `TIMELINE`. Length follows active time, source time with a
 * task running. Every stretch with no task running is cut out, and each covered one becomes a skip marker. A not-collected
 * stretch with no task is never cut: it plays as a short beat. Inside a running task, time plays at the common rate whether
 * collected or not. Pure: no clock.
 */
export function buildTimeline(recap: RecapV1, kind: RecapKind): Timeline {
  const runs = recap.tasks.map((task) => ({ task, ...clipped(task, recap.fromMs, recap.toMs) }));
  const busy = unionOf(runs.map((run) => ({ from: run.from, to: run.to })));
  const raw = rawSegments(recap, busy);
  const playable = recap.tasks.length > 0;
  const activeMs = busy.reduce((sum, [from, to]) => sum + (to - from), 0);
  const maxPlay = kind === 'week' ? TIMELINE.MAX_PLAY_WEEK_MS : TIMELINE.MAX_PLAY_MS;
  const lengthMs = !playable || activeMs === 0 ? 0 : Math.min(maxPlay, Math.max(TIMELINE.MIN_PLAY_MS, activeMs / TIMELINE.ACTIVE_DIVISOR));
  const rate = lengthMs === 0 ? 1 : activeMs / lengthMs;
  const beatCount = raw.filter((segment) => segment.kind === 'beat').length;
  const beatMs = playable && beatCount > 0 ? Math.min(TIMELINE.NOT_COLLECTED_BEAT_MS, TIMELINE.BEATS_MAX_MS / beatCount) : 0;

  let cursor = 0;
  const segments: PlaySegment[] = raw.map((segment) => {
    const length = segment.kind === 'play' ? (playable ? (segment.srcToMs - segment.srcFromMs) / rate : 0) : segment.kind === 'beat' ? beatMs : 0;
    const placed: PlaySegment = { ...segment, playFromMs: cursor, playToMs: cursor + length };
    cursor += length;
    return placed;
  });
  const toPlay = (srcMs: number): number => mapSourceToPlay(segments, recap.fromMs, recap.toMs, cursor, srcMs);

  const tasks: TimelineTask[] = runs.map((run) => {
    const playFromMs = toPlay(run.from);
    const playToMs = toPlay(run.to);
    const visibleToMs = run.endsInPeriod ? Math.max(playToMs, playFromMs + TIMELINE.MIN_VISIBLE_MS) : Number.POSITIVE_INFINITY;
    return { task: run.task, srcFromMs: run.from, srcToMs: run.to, playFromMs, playToMs, visibleFromMs: playFromMs, visibleToMs, defeatAtMs: run.endsInPeriod && run.task.state === 'credited' ? visibleToMs : null, endsInPeriod: run.endsInPeriod };
  });
  const totalMs = playable ? Math.max(cursor, ...tasks.filter((item) => item.endsInPeriod).map((item) => item.visibleToMs)) : 0;
  for (const item of tasks) if (!item.endsInPeriod) item.visibleToMs = totalMs;

  const markers: SkipMarker[] = [];
  let carried = { skippedMs: 0, stretches: 0 };
  const skips = playable ? segments.filter((item) => item.kind === 'skip') : [];
  for (const segment of skips) {
    carried = { skippedMs: carried.skippedMs + (segment.srcToMs - segment.srcFromMs), stretches: carried.stretches + 1 };
    if (carried.skippedMs >= TIMELINE.SKIP_LABEL_MIN_MS) {
      markers.push({ playAtMs: segment.playFromMs, ...carried });
      carried = { skippedMs: 0, stretches: 0 };
    }
  }
  const lastSkip = skips[skips.length - 1];
  if (carried.stretches > 0 && lastSkip !== undefined) markers.push({ playAtMs: lastSkip.playFromMs, ...carried });

  const eventTimes = new Set<number>([0, totalMs]);
  for (const segment of segments) {
    eventTimes.add(segment.playFromMs);
    eventTimes.add(segment.playToMs);
  }
  for (const item of tasks) {
    eventTimes.add(item.visibleFromMs);
    if (item.endsInPeriod) eventTimes.add(item.visibleToMs);
    for (const threshold of [SMALL_BELOW_MS, MEDIUM_BELOW_MS]) {
      const at = item.task.startedAtMs + threshold;
      if (at > item.srcFromMs && at < item.srcToMs) eventTimes.add(toPlay(at));
    }
  }
  const events = [...eventTimes].filter((time) => time >= 0 && time <= totalMs).sort((a, b) => a - b);

  const notCollectedMs = recap.coverage.spans.filter(isNotCollected).reduce((sum, span) => sum + (span.toMs - span.fromMs), 0);
  const empty = !playable ? (recap.coverage.spans.every(isNotCollected) ? 'not-collected' : 'no-tasks') : null;

  return {
    kind,
    fromMs: recap.fromMs,
    toMs: recap.toMs,
    totalMs,
    activeMs,
    rate,
    collectedMs: recap.toMs - recap.fromMs - notCollectedMs,
    notCollectedMs,
    segments,
    playing: segments.filter((segment) => segment.playToMs > segment.playFromMs),
    markers,
    tasks,
    events,
    empty,
  };
}

/** Source time at a play time. Time cut out is jumped over: at a boundary the later stretch wins. */
export function playToSource(timeline: Timeline, playMs: number): number {
  if (playMs <= 0) return timeline.playing[0]?.srcFromMs ?? timeline.fromMs;
  if (playMs >= timeline.totalMs) return timeline.toMs;
  const segment = timeline.playing[lastIndexAtOrBefore(timeline.playing, playMs, (item) => item.playFromMs)];
  if (segment === undefined || playMs >= segment.playToMs) return timeline.toMs;
  return segment.srcFromMs + ((playMs - segment.playFromMs) / (segment.playToMs - segment.playFromMs)) * (segment.srcToMs - segment.srcFromMs);
}

/** Play time at a source time; time that was cut out maps to the point where it was cut. */
export const sourceToPlay = (timeline: Timeline, srcMs: number): number => mapSourceToPlay(timeline.segments, timeline.fromMs, timeline.toMs, timeline.totalMs, srcMs);

/** The skip marker announced at a play time (shown for one second), or null. */
export const markerAt = (timeline: Timeline, playMs: number, windowMs = 1_000): SkipMarker | null =>
  timeline.markers.find((marker) => playMs >= marker.playAtMs && playMs < marker.playAtMs + windowMs) ?? null;
