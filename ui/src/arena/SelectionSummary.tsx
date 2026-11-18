import type { RosterItemV1, WorkItemV1 } from '../contracts/types';
import { ConditionBadge } from '../observatory/ConditionBadge';
import { botCondition } from '../observatory/model';
import { StateBadge } from '../work/StateBadge';
import { ROW } from '../work/copy';
import { botNameOf } from '../work/model';
import { ARENA } from './copy';
import { enemyEffect } from './effectMap';
import type { SceneEnemy, SceneSpecter } from './sceneModel';

interface Props {
  specter: SceneSpecter | null;
  enemy: SceneEnemy | null;
  bots: readonly RosterItemV1[];
  items: ReadonlyMap<string, WorkItemV1>;
  /** True when a selection was made and nothing in the current model matches it any more. */
  gone: boolean;
}

/** Facts already in the model for the current selection. It offers no action; the inspector is a later step. */
export function SelectionSummary({ specter, enemy, bots, items, gone }: Props) {
  if (specter !== null) {
    const bot = bots.find((item) => item.bindingId === specter.bindingId);
    return (
      <div className="sa-arena-selection">
        <h3>{specter.specterName ?? specter.displayName}</h3>
        {specter.specterName !== null && <p>{`for ${specter.displayName}`}</p>}
        {bot !== undefined && <ConditionBadge view={botCondition(bot.condition)} />}
        <p>{`${ARENA.level(specter.level)} · ${ARENA.xpCommitted(specter.xpTotal)} committed`}</p>
        <p>{ARENA.linked(specter.openAttemptIds.length)}</p>
        <p className="sa-help">{ARENA.selectionInspectorNote}</p>
      </div>
    );
  }
  if (enemy !== null) {
    const item = items.get(enemy.workId);
    const effect = enemyEffect(enemy);
    return (
      <div className="sa-arena-selection">
        <h3>{enemy.title}</h3>
        <StateBadge state={enemy.state} />
        <p>{effect.progressText}</p>
        {enemy.parts !== null && <p>{ARENA.partsAccepted(enemy.parts.accepted, enemy.parts.total)}</p>}
        <p>
          {`${ARENA.contributors}: `}
          {item === undefined || item.contributors.length === 0 ? ROW.noBots : item.contributors.map((contributor) => botNameOf(bots, contributor.bindingId)).join(', ')}
        </p>
        {enemy.committedXp !== null && enemy.defeated && <p>{`${ARENA.xpCommitted(enemy.committedXp)} committed`}</p>}
        <p className="sa-help">{ARENA.selectionInspectorNote}</p>
      </div>
    );
  }
  return <p>{gone ? ARENA.gone : ARENA.selectionEmpty}</p>;
}
