import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SpecterProfileV1, SpecterV1 } from '../contracts/types';
import { Button } from '../observatory/ui';
import {
  ACTIONS,
  BUDGET_UNKNOWN,
  DUPLICATE_NAME_NOTE,
  FIELD_LABELS,
  LOST_WORDS,
  PRIVACY_NOTE,
  SUMMON,
  budgetLine,
  errorWords,
  installBudgetLine,
  statusWords,
} from './copy';
import { KEEP_FIELDS, lengthOf } from './model';
import type { Summoning } from './useSummoning';

interface Props {
  summoning: Summoning;
  specter: SpecterV1 | null;
  /** True when another bot's Specter already uses this candidate name. Display only, never a gate. */
  nameTaken: (name: string) => boolean;
  onAccept: () => void;
}

const PROMPT_MAX = 300;

function CandidateCard({ candidate, taken }: { candidate: SpecterProfileV1; taken: boolean }) {
  return (
    <div className="sa-candidate">
      <h3>{candidate.name}</h3>
      {candidate.epithet !== null && <p>{candidate.epithet}</p>}
      <dl>
        {(['personality', 'appearance', 'mannerism', 'signatureAction', 'assignmentRationale'] as const).map((field) => {
          const text = candidate[field];
          return text === null ? null : (
            <div key={field} className="sa-field">
              <dt>{FIELD_LABELS[field]}</dt>
              <dd>{text}</dd>
            </div>
          );
        })}
      </dl>
      {taken && <p role="note">{DUPLICATE_NAME_NOTE}</p>}
    </div>
  );
}

export function SummonPanel({ summoning, specter, nameTaken, onAccept }: Props) {
  const { state, budget } = summoning;
  const [purpose, setPurpose] = useState('');
  const [style, setStyle] = useState('');
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());
  const working = state.phase === 'starting' || state.phase === 'active';
  const request = state.phase === 'active' || state.phase === 'done' ? state.request : null;
  const ready = state.phase === 'done' && state.request.status === 'ready' ? state.request : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void summoning.start({ purpose, style, keep: specter === null ? [] : KEEP_FIELDS.filter((field) => keep.has(field)) });
  };
  const toggleKeep = (field: string) =>
    setKeep((previous) => {
      const next = new Set(previous);
      if (!next.delete(field)) next.add(field);
      return next;
    });

  return (
    <section className="sa-form" aria-label={SUMMON.heading}>
      <h3>{specter === null ? SUMMON.heading : SUMMON.rerollHeading}</h3>
      <p className="sa-help">{PRIVACY_NOTE}</p>
      <form onSubmit={submit} className="sa-form">
        <label>
          {SUMMON.purpose}
          <textarea value={purpose} maxLength={PROMPT_MAX} rows={2} onChange={(event) => setPurpose(event.target.value)} />
          <span className="sa-counter">{lengthOf(purpose)} of {PROMPT_MAX}</span>
        </label>
        <label>
          {SUMMON.style}
          <textarea value={style} maxLength={PROMPT_MAX} rows={2} onChange={(event) => setStyle(event.target.value)} />
          <span className="sa-counter">{lengthOf(style)} of {PROMPT_MAX}</span>
        </label>
        {specter !== null && (
          <fieldset>
            <legend>{SUMMON.keepLegend}</legend>
            <div className="sa-keep">
              {KEEP_FIELDS.map((field) => (
                <label key={field}>
                  <input type="checkbox" checked={keep.has(field)} onChange={() => toggleKeep(field)} />
                  {FIELD_LABELS[field]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="sa-actions">
          <Button type="submit" disabled={working}>
            {specter === null ? ACTIONS.summon : ACTIONS.reroll}
          </Button>
          {state.phase === 'active' && <Button onClick={() => void summoning.cancel()}>{ACTIONS.cancel}</Button>}
        </div>
      </form>
      <p className="sa-budget">
        {budget === null ? BUDGET_UNKNOWN : `${budgetLine(budget.bindingRemaining, budget.bindingLimit)}. ${installBudgetLine(budget.installRemaining, budget.installLimit)}.`}
      </p>
      <div role="status" className="sa-status-region">
        {working && <p className="sa-progress">{request === null ? statusWords('queued') : statusWords(request.status)}</p>}
        {state.phase === 'done' && !working && <p className="sa-progress">{statusWords(state.request.status)}</p>}
        {state.phase === 'done' && state.request.status === 'failed' && (
          <p className="sa-error">{errorWords(state.request.error ?? 'unavailable')}</p>
        )}
        {state.phase === 'lost' && (
          <p className="sa-error">
            {LOST_WORDS[state.why]}{' '}
            <Button onClick={() => void summoning.checkAgain()}>{ACTIONS.checkAgain}</Button>
          </p>
        )}
        {state.phase === 'error' && <p className="sa-error">{errorWords(state.code)}</p>}
      </div>
      {ready?.candidate != null && (
        <>
          <CandidateCard candidate={ready.candidate} taken={nameTaken(ready.candidate.name)} />
          <div className="sa-actions">
            <Button onClick={onAccept}>{ACTIONS.accept}</Button>
            <Button
              onClick={() => {
                summoning.discard();
              }}
            >
              {ACTIONS.discard}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
