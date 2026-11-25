import { useState } from 'react';
import type { RosterItemV1, TaskItemV1 } from '../contracts/types';
import { ConditionBadge } from '../observatory/ConditionBadge';
import { botCondition } from '../observatory/model';
import { Time } from '../observatory/Time';
import { TASK, closeOutWords, taskTitle } from '../tasks/copy';
import { TaskStateBadge } from '../tasks/TaskStateBadge';
import { botNameOf } from '../work/model';
import { ModeBadge } from './ModeBadge';
import { ARENA, FILTERS, INSPECTOR, levelXpText } from './copy';
import type { FilterValue } from './copy';
import type { SceneModel, SceneSpecter } from './sceneModel';
import { isSelected } from './selection';
import type { ArenaSelection } from './selection';

interface Props {
  /** Built without the scene's enemy cap, so every open task has a row. */
  model: SceneModel;
  bots: readonly RosterItemV1[];
  items: ReadonlyMap<string, TaskItemV1>;
  /** Task ids the scene draws; the other rows say they are not drawn. */
  drawn: ReadonlySet<string>;
  selection: ArenaSelection | null;
  onSelect: (selection: ArenaSelection) => void;
}

const specterMatches = (specter: SceneSpecter, filter: FilterValue): boolean =>
  filter === 'all' || (filter === 'working' && specter.condition === 'working') || (filter === 'unknown' && specter.condition === 'unknown');

const taskMatches = (task: TaskItemV1, engaged: boolean, filter: FilterValue): boolean =>
  filter === 'all' ||
  (filter === 'working' && engaged) ||
  (filter === 'credited' && task.state === 'credited') ||
  (filter === 'not-credited' && task.state === 'not-credited') ||
  (filter === 'unknown' && task.state === 'open' && task.attemptState === 'unknown');

const byUpdatedDesc = (a: TaskItemV1, b: TaskItemV1): number => b.updatedAtMs - a.updatedAtMs || (a.taskId < b.taskId ? 1 : a.taskId > b.taskId ? -1 : 0);

/** The always-available, text-first view of everything the scene draws, and what it does not. */
export function ArenaListView({ model, bots, items, drawn, selection, onSelect }: Props) {
  const [filter, setFilter] = useState<FilterValue>('all');
  const botById = new Map(bots.map((bot) => [bot.bindingId, bot]));
  const specters = model.specters.filter((specter) => specterMatches(specter, filter));
  // The field's tasks, then the tasks that closed without credit (they leave the field and stay listed with their reason).
  const rows: Array<{ task: TaskItemV1; engaged: boolean }> = [];
  for (const enemy of model.enemies) {
    const task = items.get(enemy.workId);
    if (task !== undefined) rows.push({ task, engaged: enemy.engagedBy.length > 0 });
  }
  for (const task of [...items.values()].filter((candidate) => candidate.state === 'not-credited').sort(byUpdatedDesc)) rows.push({ task, engaged: false });
  const shown = rows.filter(({ task, engaged }) => taskMatches(task, engaged, filter));
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
      <p className="sa-help">{ARENA.closedNote}</p>

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
                  {specter.specterName !== null && <span className="sa-help">{INSPECTOR.specterIs(specter.specterName)}</span>}
                </th>
                <td>{bot !== undefined && <ConditionBadge view={botCondition(bot.condition)} />}</td>
                <td>{specter.openAttemptIds.length}</td>
                <td>{levelXpText(specter.xpReading, specter.level, specter.xpTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="sa-arena-table">
        <caption>{TASK.listCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{TASK.listColumns.task}</th>
            <th scope="col">{TASK.listColumns.closeOut}</th>
            <th scope="col">{TASK.listColumns.size}</th>
            <th scope="col">{TASK.listColumns.bot}</th>
            <th scope="col">{TASK.listColumns.xp}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ task }) => (
            <tr key={task.taskId}>
              <th scope="row">
                <button
                  type="button"
                  className="sa-arena-table__select"
                  aria-current={isSelected(selection, 'work', task.taskId) ? 'true' : undefined}
                  onClick={() => onSelect({ kind: 'work', workId: task.taskId })}
                >
                  {taskTitle(task)}
                </button>
                <span className="sa-help">
                  {`${TASK.started} `}
                  <Time ms={task.startedAtMs} />
                </span>
                {task.state === 'open' && !drawn.has(task.taskId) && <span className="sa-help">{ARENA.notDrawn}</span>}
              </th>
              <td>
                <TaskStateBadge state={task.state} />
                <span className="sa-help">{closeOutWords(task)}</span>
              </td>
              <td>{TASK.sizeAndRun(task)}</td>
              <td>{botNameOf(bots, task.bindingId)}</td>
              <td>{task.xpCredited === null ? (task.state === 'open' ? TASK.noXpYet : TASK.noXp) : ARENA.xpCommitted(task.xpCredited)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
