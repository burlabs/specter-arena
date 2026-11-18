import { useState } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { Time } from '../observatory/Time';
import { Button } from '../observatory/ui';
import { nameOf } from '../observatory/model';
import { useAttempts } from '../observatory/useAttempts';
import { DETAIL, PICKER, kindWords } from './copy';
import { botNameOf, shortId } from './model';

export interface PickedAttempt {
  attemptId: string;
  bindingId: string;
  kind: string;
  startedMs: number;
  endedMs: number | null;
}

interface Props {
  bots: readonly RosterItemV1[];
  selected: ReadonlyMap<string, PickedAttempt>;
  /** attemptId to the title of the work item that already tracks it. */
  linked: ReadonlyMap<string, string>;
  max: number;
  /** One choice at a time; the parent replaces the selection. */
  single?: boolean;
  onToggle: (attempt: PickedAttempt) => void;
}

export function AttemptPicker({ bots, selected, linked, max, single = false, onToggle }: Props) {
  const [botId, setBotId] = useState('');
  const attempts = useAttempts(botId === '' ? null : botId);
  const { state } = attempts;
  const atLimit = !single && selected.size >= max;

  let list = null;
  if (botId !== '') {
    if (state.status === 'loading' || state.status === 'idle') list = <p role="status">{PICKER.loading}</p>;
    else if (state.status === 'gone') list = <p role="status">{PICKER.gone}</p>;
    else if (state.status === 'failed') {
      list = (
        <p className="sa-error" role="alert">
          {PICKER.failed}
        </p>
      );
    } else if (state.items.length === 0) list = <p>{PICKER.empty}</p>;
    else {
      list = (
        <fieldset className="sa-work-picker">
          <legend>{PICKER.label}</legend>
          {state.items.map((attempt) => {
            const checked = selected.has(attempt.attemptId);
            const holder = linked.get(attempt.attemptId);
            const ended = attempt.endedMs !== null;
            return (
              <label key={attempt.attemptId} className="sa-work-pick">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={holder !== undefined || (atLimit && !checked)}
                  onChange={() =>
                    onToggle({ attemptId: attempt.attemptId, bindingId: botId, kind: attempt.kind, startedMs: attempt.startedMs, endedMs: attempt.endedMs })
                  }
                />
                <span>{DETAIL.evidenceRow(kindWords(attempt.kind), shortId(attempt.attemptId), ended ? DETAIL.ended : DETAIL.stillOpen)}</span>
                <span className="sa-help">
                  <Time ms={attempt.startedMs} />
                </span>
                {holder !== undefined && <span className="sa-help">{PICKER.trackedIn(holder)}</span>}
              </label>
            );
          })}
          {state.olderFailed && (
            <p className="sa-error" role="alert">
              {PICKER.olderFailed}
            </p>
          )}
          {state.hasOlder && (
            <Button disabled={state.loadingOlder} onClick={attempts.loadOlder}>
              {state.loadingOlder ? PICKER.loadingOlder : PICKER.loadOlder}
            </Button>
          )}
        </fieldset>
      );
    }
  }

  return (
    <div className="sa-work-attempts">
      <label>
        {PICKER.bot}
        <select value={botId} onChange={(event) => setBotId(event.target.value)}>
          <option value="">{PICKER.chooseBot}</option>
          {bots.map((bot) => (
            <option key={bot.bindingId} value={bot.bindingId}>
              {nameOf(bot)}
            </option>
          ))}
        </select>
      </label>
      {list}
      {single ? <p className="sa-help">{PICKER.singleChoice}</p> : <p className="sa-help">{PICKER.selected(selected.size, max)}</p>}
      {atLimit && <p className="sa-help">{PICKER.limit(max)}</p>}
      {selected.size === 0 ? (
        <p className="sa-help">{PICKER.noSelection}</p>
      ) : (
        <ul className="sa-work-plain" aria-label={PICKER.selectedLabel}>
          {[...selected.values()].map((attempt) => (
            <li key={attempt.attemptId}>
              {botNameOf(bots, attempt.bindingId)} · {kindWords(attempt.kind)} · {shortId(attempt.attemptId)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
