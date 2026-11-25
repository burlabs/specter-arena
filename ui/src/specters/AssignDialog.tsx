import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { HeroId, RosterItemV1 } from '../contracts/types';
import { nameOf } from '../observatory/model';
import { Button } from '../observatory/ui';
import { HeroChoice } from './HeroChoice';
import { ASSIGN, errorWords } from './copy';
import { heroesByHeld } from './heroes';
import type { HeroesState } from './useHeroes';
import type { SpectersState } from './useSpecters';

interface Props {
  bots: readonly RosterItemV1[];
  /** The unassigned bindings to walk through, in order. A snapshot: it does not change while the dialog is open. */
  queue: readonly string[];
  specters: SpectersState;
  heroes: HeroesState;
  /** Called with every binding the dialog showed, so the page can remember they were offered. */
  onClose: (shown: readonly string[]) => void;
}

/** The assignment walkthrough: one step per unassigned bot, then a summary. Assignments are final, and nothing here edits a hero. */
export function AssignDialog({ bots, queue, specters, heroes, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const titleId = useId();
  const noteId = useId();
  const groupName = useId();
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const id = queue[index];
  const onSummary = id === undefined;
  const bot = bots.find((entry) => entry.bindingId === id);
  const order = heroes.items === null ? [] : heroesByHeld(heroes.items);
  const value = picked ?? order[0]?.heroId ?? null;
  const chosen = order.find((hero) => hero.heroId === value);
  const busy = writing || running !== null;

  // A bot that gained a Specter (this write, a reload after a 409, another window) moves the walkthrough on by itself.
  useEffect(() => {
    if (busy || id === undefined || !specters.byBinding.has(id)) return;
    setPicked(null);
    setError(null);
    // Idempotent: a second run for the same step (a poll landing in between) must not step over the next bot.
    setIndex((current) => (queue[current] === id ? current + 1 : current));
  }, [busy, id, queue, specters.byBinding]);

  useEffect(() => {
    if (onSummary) doneButton.current?.focus();
    else heading.current?.focus();
  }, [index, onSummary]);

  const finish = () => onClose(queue);

  const assign = async () => {
    if (id === undefined || value === null) return;
    setWriting(true);
    setError(null);
    const result = await specters.assign(id, value as HeroId);
    if (!live.current) return;
    setWriting(false);
    if (result.kind === 'failed') setError(result.code);
    else heroes.refresh();
  };

  const skip = () => {
    setPicked(null);
    setError(null);
    setIndex((current) => current + 1);
  };

  const randomizeAll = async () => {
    const todo = queue.filter((entry) => !specters.byBinding.has(entry));
    const bad = new Set<string>();
    setRunning({ done: 0, total: todo.length });
    setError(null);
    for (const [position, entry] of todo.entries()) {
      const result = await specters.assign(entry, null);
      if (result.kind === 'failed') bad.add(entry);
      if (!live.current) return;
      setRunning({ done: position + 1, total: todo.length });
    }
    heroes.refresh();
    specters.refresh();
    setFailed(bad);
    setRunning(null);
    setPicked(null);
    setIndex(queue.length);
  };

  const assigned = queue.filter((entry) => specters.byBinding.has(entry)).length;
  const failedCount = queue.filter((entry) => !specters.byBinding.has(entry) && failed.has(entry)).length;
  const left = queue.length - assigned - failedCount;
  const rosterBot = bot === undefined ? null : nameOf(bot);

  return (
    <dialog
      ref={dialog}
      className="sa-assign-dialog"
      aria-labelledby={titleId}
      aria-describedby={noteId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) finish();
      }}
    >
      {onSummary ? (
        <div className="sa-assign-dialog__body">
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {ASSIGN.summaryTitle}
          </h2>
          <p id={noteId} role="status">
            {ASSIGN.summary(assigned, left, failedCount)}
          </p>
          {left + failedCount > 0 && <p className="sa-help">{ASSIGN.skippedHint}</p>}
          <div className="sa-actions">
            <Button ref={doneButton} onClick={finish}>
              {ASSIGN.done}
            </Button>
          </div>
        </div>
      ) : (
        <div className="sa-assign-dialog__body">
          <p className="sa-assign-dialog__step">{ASSIGN.step(index + 1, queue.length)}</p>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {rosterBot === null ? ASSIGN.botGone : ASSIGN.title(rosterBot)}
          </h2>
          <p id={noteId} className="sa-help">
            {ASSIGN.note}
          </p>
          {rosterBot !== null &&
            (heroes.items !== null ? (
              <HeroChoice name={groupName} label={ASSIGN.heroesLabel} heroes={order} value={value} onChange={setPicked} size={96} disabled={busy} />
            ) : (
              <p className="sa-help" role={heroes.status === 'failed' ? 'alert' : 'status'}>
                {heroes.status === 'failed' ? ASSIGN.heroesFailed : ASSIGN.heroesLoading}
              </p>
            ))}
          {error !== null && (
            <p className="sa-error" role="alert">
              {errorWords(error)}
            </p>
          )}
          {running !== null && (
            <p className="sa-help" role="status">
              {ASSIGN.progress(running.done, running.total)}
            </p>
          )}
          <div className="sa-actions">
            {rosterBot !== null && (
              <Button disabled={busy || chosen === undefined} onClick={() => void assign()}>
                {writing ? ASSIGN.assigning : ASSIGN.assign(chosen?.name ?? '')}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={skip}>
              {ASSIGN.skip}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void randomizeAll()}>
              {ASSIGN.randomize}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={finish}>
              {ASSIGN.close}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
