import { useState } from 'react';
import type { RosterItemV1, WorkItemV1 } from '../contracts/types';
import { ConditionBadge } from '../observatory/ConditionBadge';
import { botCondition } from '../observatory/model';
import { ProgressLine } from '../work/ProgressLine';
import { StateBadge } from '../work/StateBadge';
import { xpChipOf } from '../work/WorkList';
import { ROW } from '../work/copy';
import { botNameOf } from '../work/model';
import { ModeBadge } from './ModeBadge';
import { ARENA, FILTERS } from './copy';
import type { FilterValue } from './copy';
import type { SceneEnemy, SceneModel, SceneSpecter } from './sceneModel';
import { isSelected } from './selection';
import type { ArenaSelection } from './selection';

interface Props {
  /** Built without the scene's enemy cap, so every on-field item has a row. */
  model: SceneModel;
  bots: readonly RosterItemV1[];
  items: ReadonlyMap<string, WorkItemV1>;
  /** Work ids the scene draws; the other rows say they are not drawn. */
  drawn: ReadonlySet<string>;
  selection: ArenaSelection | null;
  onSelect: (selection: ArenaSelection) => void;
}

const specterMatches = (specter: SceneSpecter, filter: FilterValue): boolean =>
  filter === 'all' || (filter === 'working' && specter.condition === 'working') || (filter === 'unknown' && specter.condition === 'unknown');

const enemyMatches = (enemy: SceneEnemy, filter: FilterValue): boolean =>
  filter === 'all' ||
  (filter === 'working' && enemy.engagedBy.length > 0) ||
  (filter === 'blocked' && enemy.blocked) ||
  (filter === 'awaiting-review' && enemy.state === 'awaiting-review') ||
  (filter === 'defeated' && enemy.defeated);

/** The always-available, text-first view of everything the scene draws, and what it does not. */
export function ArenaListView({ model, bots, items, drawn, selection, onSelect }: Props) {
  const [filter, setFilter] = useState<FilterValue>('all');
  const botById = new Map(bots.map((bot) => [bot.bindingId, bot]));
  const specters = model.specters.filter((specter) => specterMatches(specter, filter));
  const enemies = model.enemies.filter((enemy) => enemyMatches(enemy, filter));
  const hidden = model.enemies.filter((enemy) => !drawn.has(enemy.workId)).length;

  return (
    <section className="sa-arena-list" aria-label={ARENA.listLabel}>
      <header className="sa-arena-list__head">
        <h2>{ARENA.listHeading}</h2>
        <ModeBadge mode={model.mode} />
      </header>
      <div className="sa-arena-filters" role="group" aria-label="Filter the list">
        {FILTERS.map((option) => (
          <button key={option.value} type="button" className="sa-chip sa-arena-filter" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      {hidden > 0 && <p className="sa-help">{ARENA.overflow(hidden)}</p>}
      {model.overflow.truncated && <p className="sa-help">{ARENA.truncated}</p>}
      <p className="sa-help">{ARENA.acceptedGap}</p>

      <table className="sa-arena-table">
        <caption>Specters</caption>
        <thead>
          <tr>
            <th scope="col">Specter</th>
            <th scope="col">Condition</th>
            <th scope="col">Open attempts</th>
            <th scope="col">Level and XP</th>
          </tr>
        </thead>
        <tbody>
          {specters.map((specter) => {
            const bot = botById.get(specter.bindingId);
            return (
              <tr key={specter.bindingId}>
                <th scope="row">
                  <button
                    type="button"
                    className="sa-arena-table__select"
                    aria-current={isSelected(selection, 'specter', specter.bindingId) ? 'true' : undefined}
                    onClick={() => onSelect({ kind: 'specter', bindingId: specter.bindingId })}
                  >
                    {specter.displayName}
                  </button>
                  {specter.specterName !== null && <span className="sa-help">{`Specter: ${specter.specterName}`}</span>}
                </th>
                <td>{bot !== undefined && <ConditionBadge view={botCondition(bot.condition)} />}</td>
                <td>{specter.openAttemptIds.length}</td>
                <td>{`${ARENA.level(specter.level)} · ${ARENA.xpCommitted(specter.xpTotal)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="sa-arena-table">
        <caption>Work</caption>
        <thead>
          <tr>
            <th scope="col">Work item</th>
            <th scope="col">State</th>
            <th scope="col">Progress</th>
            <th scope="col">Contributors</th>
            <th scope="col">XP</th>
          </tr>
        </thead>
        <tbody>
          {enemies.map((enemy) => {
            const item = items.get(enemy.workId);
            const parent = enemy.parentId === null ? undefined : items.get(enemy.parentId);
            return (
              <tr key={enemy.workId}>
                <th scope="row">
                  <button
                    type="button"
                    className="sa-arena-table__select"
                    aria-current={isSelected(selection, 'work', enemy.workId) ? 'true' : undefined}
                    onClick={() => onSelect({ kind: 'work', workId: enemy.workId })}
                  >
                    {enemy.title}
                  </button>
                  {parent !== undefined && <span className="sa-help">{`${ARENA.partOf} ${parent.title}`}</span>}
                  {!drawn.has(enemy.workId) && <span className="sa-help">{ARENA.notDrawn}</span>}
                </th>
                <td>
                  <StateBadge state={enemy.state} />
                </td>
                <td>
                  <ProgressLine progress={item?.progress ?? null} />
                  {enemy.parts !== null && <span className="sa-help">{ARENA.partsAccepted(enemy.parts.accepted, enemy.parts.total)}</span>}
                </td>
                <td>
                  {item === undefined || item.contributors.length === 0
                    ? ROW.noBots
                    : item.contributors.map((contributor) => botNameOf(bots, contributor.bindingId)).join(', ')}
                </td>
                <td>{item === undefined ? ARENA.noXp : xpChipOf(item)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
