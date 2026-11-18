import type { SceneEnemy, SceneSpecter } from './sceneModel';
import { PROGRESS_TEXT, STATE_TEXT } from './copy';
import { stateView } from '../work/model';

export type Stance = 'engaging' | 'at-rest' | 'coverage-unknown';
export type MarkerKind = 'blocked' | 'evidence' | 'coverage-unknown' | 'outcome-accepted' | 'assistance';

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
  { fact: 'WorkItem on-field state, leaf', effect: 'Patchling enemy', changes: 'none' },
  { fact: 'WorkItem with children', effect: 'Patchbrute encounter, children grouped around it', changes: 'none' },
  { fact: 'Linked attempt working', effect: 'Engagement line from Specter to enemy; optional decorative hit loop', changes: 'none' },
  { fact: 'Milestones done and total', effect: 'Discrete count "N of M milestones"', changes: 'none' },
  { fact: 'No milestones', effect: 'Indeterminate text "Progress unknown"', changes: 'none' },
  { fact: 'blocked', effect: 'Blocked marker and the decision reason in the inspector', changes: 'none' },
  { fact: 'awaiting-review', effect: 'Evidence marker "Awaiting your review" (in-app review, not a Crew approval)', changes: 'none' },
  { fact: 'accepted, seen live between two visible polls', effect: 'Defeat animation once and the committed XP', changes: 'none' },
  { fact: 'accepted, on load or after a gap', effect: 'Defeated pose without animation and the committed XP', changes: 'none' },
  { fact: 'reopened', effect: 'Enemy returns; the correction shows in the inspector XP history', changes: 'none' },
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
  if (enemy.defeated) return 'outcome-accepted';
  if (enemy.blocked) return 'blocked';
  if (enemy.state === 'awaiting-review') return 'evidence';
  return enemy.engagedBy.length > 1 ? 'assistance' : null;
}

export function enemyEffect(enemy: SceneEnemy): EnemyEffect {
  return {
    pose: enemy.defeated ? 'defeated' : enemy.engagedBy.length > 0 ? 'engaged' : 'idle',
    marker: markerOf(enemy),
    progressText: progressTextOf(enemy.progress),
    stateText: enemy.defeated ? STATE_TEXT.defeated : stateView(enemy.state).label,
  };
}
