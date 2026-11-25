import type { RecapSpanV1, RecapV1, RosterItemV1, TaskItemV1, TaskSizeClassV1 } from '../contracts/types';
import type { SourceMode } from '../host';
import { MEDIUM_BELOW_MS, SMALL_BELOW_MS, sizeClassOf } from '../tasks/model';
import type { SceneInputs } from './sceneModel';
import type { ArenaSpecter } from './specterShape';
import { lastIndexAtOrBefore, playToSource } from './recapTimeline';
import type { Timeline, TimelineTask } from './recapTimeline';

export interface FrameContext {
  roster: readonly RosterItemV1[];
  specters: readonly ArenaSpecter[];
  mode: SourceMode;
}

export interface RecapFrame {
  /** What `buildSceneModel` takes. The same object for every play time inside one event interval, so the model and the attack plan do not rebuild per animation frame. */
  inputs: SceneInputs;
  /** Changes exactly when the scene can change: a minion appears, grows, leaves or is defeated, or coverage changes. */
  signature: string;
  /** The recorded time the playhead stands on. Unlike `inputs`, it moves with every play time. */
  sourceMs: number;
  /** The not-collected span under the playhead, else null. */
  notCollected: RecapSpanV1 | null;
  /** Tasks on screen whose bot is not in the roster: counted, not drawn. */
  unrostered: number;
}

type StableFrame = Omit<RecapFrame, 'sourceMs'>;

const SIZE_FLOOR_MS: Readonly<Record<TaskSizeClassV1, number>> = { small: 0, medium: SMALL_BELOW_MS, large: MEDIUM_BELOW_MS };
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** The recorded run so far: linear from the start of the task's visible run to its end, so a long task grows as its real time passes. */
function elapsedAt(item: TimelineTask, playMs: number): number {
  const span = item.playToMs - item.playFromMs;
  const at = span > 0 ? item.srcFromMs + (item.srcToMs - item.srcFromMs) * clamp01((playMs - item.playFromMs) / span) : item.srcToMs;
  return Math.max(0, at - item.task.startedAtMs);
}

function openTask(item: TimelineTask, playMs: number): TaskItemV1 {
  const sizeClass = sizeClassOf(elapsedAt(item, playMs));
  return {
    ...item.task,
    state: 'open',
    attemptState: 'working',
    closeReason: null,
    startedAtMs: item.visibleFromMs,
    endedAtMs: null,
    closedAtMs: null,
    updatedAtMs: item.visibleFromMs,
    runMs: SIZE_FLOOR_MS[sizeClass],
    sizeClass,
    xpCredited: null,
  };
}

const defeatedTask = (item: TimelineTask): TaskItemV1 => ({
  ...item.task,
  attemptState: 'ended',
  startedAtMs: item.visibleFromMs,
  endedAtMs: item.visibleToMs,
  closedAtMs: item.visibleToMs,
  updatedAtMs: item.visibleToMs,
});

function rosterAt(roster: readonly RosterItemV1[], working: ReadonlyMap<string, number>, notCollected: RecapSpanV1 | null): RosterItemV1[] {
  return roster.map((bot) => {
    const open = working.get(bot.bindingId) ?? 0;
    const state = open > 0 ? 'working' : notCollected === null ? 'settled' : 'unknown';
    return {
      ...bot,
      condition: { state, reasonCode: 'recorded', basis: null, sourceTimeMs: null, observedAtMs: null, signals: { needsInput: null, hasOptions: null, pendingApproval: null, waitingForInput: null } },
      coverage: notCollected === null ? { state: 'covered', sinceMs: null, reasonCode: null, openGapCount: 0 } : { state: 'unknown', sinceMs: null, reasonCode: notCollected.reason, openGapCount: 0 },
      workers: { running: open, seen: open, unknown: 0 },
    };
  });
}

function stableFrame(recap: RecapV1, timeline: Timeline, context: FrameContext, eventMs: number): StableFrame {
  const sourceMs = playToSource(timeline, eventMs);
  const notCollected = recap.coverage.spans.find((span) => span.state === 'not-collected' && span.fromMs <= sourceMs && (sourceMs < span.toMs || span.toMs === recap.toMs)) ?? null;
  const rostered = new Set(context.roster.map((bot) => bot.bindingId));
  const open: TaskItemV1[] = [];
  const defeated: TaskItemV1[] = [];
  const working = new Map<string, number>();
  let unrostered = 0;
  for (const item of timeline.tasks) {
    if (eventMs < item.visibleFromMs) continue;
    const ended = item.endsInPeriod && eventMs >= item.visibleToMs;
    if (ended && item.defeatAtMs === null) continue;
    if (!rostered.has(item.task.bindingId)) {
      unrostered += 1;
      continue;
    }
    if (ended) defeated.push(defeatedTask(item));
    else {
      open.push(openTask(item, eventMs));
      working.set(item.task.bindingId, (working.get(item.task.bindingId) ?? 0) + 1);
    }
  }
  const inputs: SceneInputs = {
    mode: context.mode,
    nowMs: eventMs,
    roster: rosterAt(context.roster, working, notCollected),
    specters: context.specters,
    xp: [],
    xpStatus: 'loading',
    tasks: [...open, ...defeated],
    tasksTruncated: recap.truncated,
  };
  return { inputs, signature: String(eventMs), notCollected, unrostered };
}

/**
 * The scene at any play time. The scene only changes at the timeline's events, so every play time inside one
 * event interval returns the same `inputs` object and signature. Pure: no clock, no randomness.
 */
export function createFrameSource(recap: RecapV1, timeline: Timeline, context: FrameContext): (playMs: number) => RecapFrame {
  let last: StableFrame | null = null;
  return (playMs) => {
    const clamped = Math.min(timeline.totalMs, Math.max(0, playMs));
    const eventMs = timeline.events[lastIndexAtOrBefore(timeline.events, clamped, (time) => time)] ?? 0;
    if (last === null || last.signature !== String(eventMs)) last = stableFrame(recap, timeline, context, eventMs);
    return { ...last, sourceMs: playToSource(timeline, clamped) };
  };
}

export const frameAt = (recap: RecapV1, timeline: Timeline, playMs: number, context: FrameContext): RecapFrame => createFrameSource(recap, timeline, context)(playMs);
