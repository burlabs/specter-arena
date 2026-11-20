import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { RosterItemV1, WorkItemV1, WorkListItemV1 } from '../contracts/types';
import { Button } from '../observatory/ui';
import { lengthOf } from '../specters/model';
import { AttemptPicker } from './AttemptPicker';
import type { PickedAttempt } from './AttemptPicker';
import { CREATE, errorWords } from './copy';
import { LIMITS, isTerminalForLinks } from './model';
import type { WorkActions } from './useWorkActions';

interface Props {
  bots: readonly RosterItemV1[];
  existing: readonly WorkListItemV1[];
  linked: ReadonlyMap<string, string>;
  actions: WorkActions;
  onCreated: (item: WorkItemV1) => void;
  onCancel: () => void;
}

const canTakeParts = (item: WorkListItemV1): boolean => !isTerminalForLinks(item.state) && !item.everAccepted;

export function CreateWorkForm({ bots, existing, linked, actions, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [condition, setCondition] = useState('');
  const [milestones, setMilestones] = useState<string[]>([]);
  const [rewardable, setRewardable] = useState(true);
  const [parentId, setParentId] = useState('');
  const [picked, setPicked] = useState<ReadonlyMap<string, PickedAttempt>>(new Map());
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const toggle = (attempt: PickedAttempt) =>
    setPicked((previous) => {
      const next = new Map(previous);
      if (next.has(attempt.attemptId)) next.delete(attempt.attemptId);
      else if (next.size < LIMITS.attempts) next.set(attempt.attemptId, attempt);
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const labels = milestones.map((label) => label.trim()).filter((label) => label !== '');
    const text = title.trim();
    const accept = condition.trim();
    if (text === '' || accept === '' || lengthOf(text) > LIMITS.title || lengthOf(accept) > LIMITS.condition || labels.some((label) => lengthOf(label) > LIMITS.milestoneLabel)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setError(null);
    const result = await actions.create({
      title: text,
      acceptanceCondition: accept,
      rewardable,
      parentId: parentId === '' ? null : parentId,
      attemptIds: [...picked.keys()],
      milestones: labels,
    });
    if (result.ok) onCreated(result.item);
    else setError(result.code);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="sa-form" aria-label={CREATE.heading} onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown}>
      <h3>{CREATE.heading}</h3>
      <label>
        {CREATE.title}
        <input ref={titleRef} type="text" value={title} aria-invalid={invalid && title.trim() === ''} onChange={(event) => setTitle(event.target.value)} />
        <span className="sa-counter">{CREATE.counter(lengthOf(title), LIMITS.title)}</span>
      </label>
      <label>
        {CREATE.condition}
        <textarea rows={3} value={condition} aria-invalid={invalid && condition.trim() === ''} onChange={(event) => setCondition(event.target.value)} />
        <span className="sa-help">{CREATE.conditionHelp}</span>
        <span className="sa-counter">{CREATE.counter(lengthOf(condition), LIMITS.condition)}</span>
      </label>
      <fieldset>
        <legend>{CREATE.milestones}</legend>
        {milestones.map((label, index) => (
          <div key={index} className="sa-work-milestone-row">
            <label>
              {CREATE.milestoneLabel(index + 1)}
              <input
                type="text"
                value={label}
                onChange={(event) => {
                  const value = event.target.value;
                  setMilestones((previous) => previous.map((current, at) => (at === index ? value : current)));
                }}
              />
            </label>
            <Button variant="ghost" onClick={() => setMilestones((previous) => previous.filter((_, at) => at !== index))}>
              {CREATE.removeMilestone(index + 1)}
            </Button>
          </div>
        ))}
        <div>
          <Button disabled={milestones.length >= LIMITS.milestones} onClick={() => setMilestones((previous) => [...previous, ''])}>
            {CREATE.addMilestone}
          </Button>
        </div>
      </fieldset>
      <label className="sa-work-check">
        <input type="checkbox" checked={rewardable} onChange={(event) => setRewardable(event.currentTarget.checked)} />
        <span>{CREATE.rewardable}</span>
      </label>
      <label>
        {CREATE.parent}
        <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="">{CREATE.noParent}</option>
          {existing.filter(canTakeParts).map((item) => (
            <option key={item.workId} value={item.workId}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <AttemptPicker bots={bots} selected={picked} linked={linked} max={LIMITS.attempts} onToggle={toggle} />
      {picked.size === 0 && <p className="sa-help">{CREATE.noAttempts}</p>}
      {invalid && (
        <p className="sa-error" role="alert">
          {CREATE.invalid}
        </p>
      )}
      {error !== null && (
        <p className="sa-error" role="alert">
          {errorWords(error)}
        </p>
      )}
      <div className="sa-actions">
        <Button type="submit" disabled={actions.busy}>
          {CREATE.submit}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {CREATE.cancel}
        </Button>
      </div>
    </form>
  );
}
