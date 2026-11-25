import type { SceneModel } from './sceneModel';

export const MAX_CELEBRATIONS_PER_POLL = 3;

export interface CelebrationContext {
  /** The tab stayed visible from the previous poll to this one. */
  visibleSincePrev: boolean;
  /** Time between the two polls, measured on the browser clock. */
  gapMs: number;
  pollMs: number;
}

/**
 * The work ids whose defeat the user watched happen between two visible polls. Nothing is celebrated on the first
 * model, after the tab was hidden, after a gap of more than two poll intervals, or when the scene clock moved
 * backwards (a restart). The rest of a burst keeps the static defeated pose.
 */
export function nextCelebrations(prev: SceneModel | null, next: SceneModel, ctx: CelebrationContext): string[] {
  if (prev === null || !ctx.visibleSincePrev || ctx.gapMs > 2 * ctx.pollMs || next.asOfMs < prev.asOfMs) return [];
  const wasLive = new Set(prev.enemies.filter((enemy) => !enemy.defeated).map((enemy) => enemy.workId));
  return next.enemies
    .filter((enemy) => enemy.defeated && wasLive.has(enemy.workId))
    .map((enemy) => enemy.workId)
    .sort()
    .slice(0, MAX_CELEBRATIONS_PER_POLL);
}

export const MAX_RISES_PER_POLL = 3;

/**
 * The work ids whose milestone count rose between two visible polls, under the same gating as `nextCelebrations`.
 * A rise is a fact the ledger recorded, so it earns one strong recoil; the first poll, a hidden tab, a long gap or a
 * clock that moved backwards all re-baseline silently. An enemy that was defeated or newly drawn is not a rise.
 */
export function nextMilestoneRises(prev: SceneModel | null, next: SceneModel, ctx: CelebrationContext): string[] {
  if (prev === null || !ctx.visibleSincePrev || ctx.gapMs > 2 * ctx.pollMs || next.asOfMs < prev.asOfMs) return [];
  const before = new Map(prev.enemies.map((enemy) => [enemy.workId, enemy.progress]));
  return next.enemies
    .filter((enemy) => {
      const was = before.get(enemy.workId);
      return !enemy.defeated && enemy.progress.kind === 'milestones' && was?.kind === 'milestones' && enemy.progress.done > was.done;
    })
    .map((enemy) => enemy.workId)
    .sort()
    .slice(0, MAX_RISES_PER_POLL);
}
