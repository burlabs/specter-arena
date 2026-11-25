import type { SceneEnemy, SceneSpecter } from './sceneModel';
import { PROGRESS_TEXT, STATE_TEXT } from './copy';

export type Stance = 'engaging' | 'at-rest' | 'coverage-unknown';
export type MarkerKind = 'blocked' | 'evidence' | 'coverage-unknown' | 'outcome-accepted' | 'assistance' | 'awaiting-approval';

export interface EnemyEffect {
  pose: 'idle' | 'engaged' | 'defeated';
  marker: MarkerKind | null;
  progressText: string;
  stateText: string;
}

/** Every row of the event-to-effect map. No effect changes any state anywhere. */
export const EFFECT_MAP: ReadonlyArray<{ fact: string; effect: string; changes: 'none' }> = [
  { fact: 'Bot binding with an active Specter (specters)', effect: 'Specter portrait at a staging position', changes: 'none' },
  { fact: 'Bot binding without a Specter', effect: 'Placeholder token "Placeholder token, not a portrait"', changes: 'none' },
  { fact: 'Roster condition working, settled or unknown', effect: 'Specter stance: engaging, at rest or a coverage-unknown marker', changes: 'none' },
  { fact: 'Open task (a bot turn or a worker the bot started)', effect: 'Patchling minion; its size class follows the task\'s observed run time and never means progress, health or effort', changes: 'none' },
  { fact: 'Task attempt working, bot working', effect: 'Engagement line from Specter to minion; the hero attacks its minion every 2.5 to 4 s and the minion recoils (live activity, not progress)', changes: 'none' },
  { fact: 'Bot waiting, Crew flag approval-pending', effect: 'Waiting marker on the Specter; it does not attack, and the inspector gives the reason', changes: 'none' },
  { fact: 'Collection paused', effect: 'No attacks or casts; a "Collection paused" plate over the field', changes: 'none' },
  { fact: 'Task credited, seen live between two visible polls', effect: 'Defeat animation once and the XP the task wrote', changes: 'none' },
  { fact: 'Task credited, on load or after a gap', effect: 'Defeated pose without animation and the XP the task wrote', changes: 'none' },
  { fact: 'Task not credited', effect: 'Leaves the field; the list view and the inspector show it with the reason', changes: 'none' },
];

/** The stance follows the bot's roster condition. A bot with no running turn is "at rest", never idle or healthy. */
export function specterStance(specter: Pick<SceneSpecter, 'condition'>): Stance {
  if (specter.condition === 'unknown') return 'coverage-unknown';
  return specter.condition === 'working' ? 'engaging' : 'at-rest';
}

export function progressTextOf(progress: SceneEnemy['progress']): string {
  return progress.kind === 'milestones' ? PROGRESS_TEXT.milestones(progress.done, progress.total) : PROGRESS_TEXT.unknown;
}

function markerOf(enemy: SceneEnemy): MarkerKind | null {
  return enemy.defeated ? 'outcome-accepted' : null;
}

export function enemyEffect(enemy: SceneEnemy): EnemyEffect {
  return {
    pose: enemy.defeated ? 'defeated' : enemy.engagedBy.length > 0 ? 'engaged' : 'idle',
    marker: markerOf(enemy),
    progressText: progressTextOf(enemy.progress),
    stateText: enemy.defeated ? STATE_TEXT.defeated : enemy.state === 'not-credited' ? STATE_TEXT.notCredited : enemy.engagedBy.length > 0 ? STATE_TEXT.running : STATE_TEXT.open,
  };
}
