import type { RefObject } from 'react';
import type { RosterItemV1, TaskItemV1 } from '../contracts/types';
import { Time } from '../observatory/Time';
import { Button } from '../observatory/ui';
import { KIND_WORDS, SIZE_WORDS, STATE_WORDS, TASK, closeOutWords, runTimeWords, taskTitle } from '../tasks/copy';
import { TaskStateBadge } from '../tasks/TaskStateBadge';
import { botNameOf, shortId } from '../work/model';
import { HandoffRow } from './HandoffRow';
import { INSPECTOR } from './copy';
import { diagnosticSummary } from './diagnosticSummary';
import type { SceneModel } from './sceneModel';
import { useTaskEvidence } from './useTaskEvidence';

interface Props {
  taskId: string;
  headingRef: RefObject<HTMLHeadingElement>;
  list: SceneModel;
  bots: readonly RosterItemV1[];
  /** The arena's own snapshot of this task, used only for a title while the evidence loads. */
  known: TaskItemV1 | undefined;
  onClose: () => void;
}

function Fallback({ headingRef, title, body, onRetry, onClose }: { headingRef: RefObject<HTMLHeadingElement>; title: string; body: string; onRetry?: () => void; onClose: () => void }) {
  return (
    <div className="sa-arena-inspector__body">
      <h2 ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      <p role="status">{body}</p>
      <div className="sa-actions">
        {onRetry !== undefined && <Button onClick={onRetry}>{INSPECTOR.retry}</Button>}
        <Button variant="ghost" onClick={onClose}>
          {INSPECTOR.close}
        </Button>
      </div>
    </div>
  );
}

const xpWords = (task: TaskItemV1): string =>
  task.state === 'credited' && task.xpCredited !== null ? TASK.xpLine(task.xpCredited, task.policyVersion) : task.state === 'open' ? TASK.noXpYet : TASK.noXp;

/** The evidence view of one automatically built task: what was observed, how it was closed, and why. Read only. */
export function TaskInspector({ taskId, headingRef, list, bots, known, onClose }: Props) {
  const { state, refresh } = useTaskEvidence(taskId);

  if (state.status === 'gone') return <Fallback headingRef={headingRef} title={INSPECTOR.goneTitle} body={INSPECTOR.goneBody} onClose={onClose} />;
  if (state.status === 'forbidden') return <Fallback headingRef={headingRef} title={INSPECTOR.forbiddenTitle} body={INSPECTOR.forbiddenBody} onClose={onClose} />;
  if (state.status === 'failed') return <Fallback headingRef={headingRef} title={INSPECTOR.failedTitle} body={INSPECTOR.failedBody} onRetry={refresh} onClose={onClose} />;
  if (state.status !== 'ready') {
    return (
      <div className="sa-arena-inspector__body">
        <h2 ref={headingRef} tabIndex={-1}>
          {known === undefined ? 'Task' : taskTitle(known)}
        </h2>
        <p role="status">{INSPECTOR.loading}</p>
      </div>
    );
  }

  const task = state.item;
  return (
    <div className="sa-arena-inspector__body">
      <h2 ref={headingRef} tabIndex={-1}>
        {taskTitle(task)}
      </h2>
      <p className="sa-arena-inspector__state">
        <TaskStateBadge state={task.state} />
        {task.state === 'credited' && <strong>{INSPECTOR.defeated}</strong>}
        {task.state === 'credited' && task.xpCredited !== null && <span>{INSPECTOR.committedXp(task.xpCredited)}</span>}
      </p>
      <p>{closeOutWords(task)}</p>

      <section className="sa-arena-section" aria-label={TASK.heading}>
        <h3>{TASK.heading}</h3>
        <dl className="sa-work-facts">
          <dt>{TASK.kind}</dt>
          <dd>{KIND_WORDS[task.kind]}</dd>
          <dt>{TASK.bot}</dt>
          <dd>{botNameOf(bots, task.bindingId)}</dd>
          <dt>{TASK.started}</dt>
          <dd>
            <Time ms={task.startedAtMs} />
          </dd>
          <dt>{TASK.ended}</dt>
          <dd>{task.endedAtMs === null ? (task.attemptState === 'unknown' ? TASK.notObserved : TASK.stillRunning) : <Time ms={task.endedAtMs} />}</dd>
          <dt>{TASK.runTime}</dt>
          <dd>{runTimeWords(task.runMs)}</dd>
          <dt>{TASK.sizeClass}</dt>
          <dd>{SIZE_WORDS[task.sizeClass]}</dd>
          <dt>{TASK.closeOut}</dt>
          <dd>{STATE_WORDS[task.state]}</dd>
          <dt>{TASK.attempt}</dt>
          <dd>{shortId(task.attemptId)}</dd>
        </dl>
        <p className="sa-help">{TASK.sizeNote}</p>
        <p className="sa-help">{TASK.evidenceHelp}</p>
      </section>

      <section className="sa-arena-section" aria-label={TASK.rewardHeading}>
        <h3>{TASK.rewardHeading}</h3>
        <dl className="sa-work-facts">
          <dt>{TASK.xp}</dt>
          <dd>{xpWords(task)}</dd>
          <dt>{TASK.policy}</dt>
          <dd>{task.policyVersion}</dd>
        </dl>
        <p className="sa-help">{TASK.invariant}</p>
      </section>

      <HandoffRow buildSummary={() => diagnosticSummary({ selection: { kind: 'work', workId: taskId }, model: list, bot: null, work: task, xp: null })} />
      <div className="sa-actions">
        <Button variant="ghost" onClick={onClose}>
          {INSPECTOR.close}
        </Button>
      </div>
    </div>
  );
}
