import { useEffect, useRef, useState } from 'react';
import type { RetentionDaysV1 } from '../contracts/types';
import { Button } from '../observatory/ui';
import { ConfirmPanel } from './ConfirmPanel';
import { PURGE, RETENTION, runWords } from './copy';
import { RETENTION_CHOICES, attemptWords, observationWords, previewTotal, quarantineWords } from './model';
import type { SectionProps } from './sectionTypes';
import { useFormatTime } from './useFormatTime';

type Choice = RetentionDaysV1 | null;

const choiceOf = (value: string): Choice => RETENTION_CHOICES.find((days) => String(days) === value) ?? null;

export function HistorySection({ data, actions, submit }: SectionProps) {
  const time = useFormatTime();
  const saved: Choice = data.retention.retentionDays;
  const [draft, setDraft] = useState<Choice | undefined>(undefined);
  const shown: Choice = draft === undefined ? saved : draft;
  const dirty = shown !== saved;
  const [confirming, setConfirming] = useState<RetentionDaysV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [focusResult, setFocusResult] = useState(0);
  const [focusOpener, setFocusOpener] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const result = useRef<HTMLParagraphElement>(null);

  // The panel belongs to the window it was opened for: if the saved window changes underneath it, it closes.
  const open = confirming !== null && confirming === saved;
  useEffect(() => {
    if (focusResult > 0) result.current?.focus();
  }, [focusResult]);
  // The opener is unmounted while the panel is open, so focus goes back to it only after the render that remounts it.
  useEffect(() => {
    if (focusOpener > 0) opener.current?.focus();
  }, [focusOpener]);

  const blocked = data.running !== null;
  const preview = data.preview;
  const nothing = preview !== null && previewTotal(preview) === 0;
  const canPurge = saved !== null && !dirty && preview !== null && !nothing && !blocked && !actions.busy;

  const save = async () => {
    if (actions.busy) return;
    setError(null);
    const message = await submit(actions.setRetention(shown), RETENTION.saved);
    if (message === null) setDraft(undefined);
    else setError(message);
  };

  const closeConfirm = () => {
    setConfirming(null);
    setConfirmError(null);
    setFocusOpener((count) => count + 1);
  };

  const purge = async () => {
    if (confirming === null) return;
    setConfirmError(null);
    const message = await submit(actions.purge(confirming), PURGE.done);
    if (message !== null) {
      setConfirmError(message);
      return;
    }
    setConfirming(null);
    setFocusResult((count) => count + 1);
  };

  let previewLine: string;
  if (saved === null) previewLine = dirty ? RETENTION.unsavedNote : RETENTION.keepNote;
  else if (dirty) previewLine = RETENTION.unsavedNote;
  else if (preview === null || nothing) previewLine = PURGE.nothing;
  else previewLine = `A purge now would delete history before ${time(preview.cutoffMs)}: ${observationWords(preview.observations)}, ${quarantineWords(preview.quarantine)} and ${attemptWords(preview.attempts)}.`;

  const latest = data.running ?? data.lastPurge;

  return (
    <section className="sa-data-section" aria-labelledby="sa-data-history">
      <h3 id="sa-data-history">{RETENTION.heading}</h3>
      {data.horizonMs !== null && <p className="sa-data-horizon">{PURGE.horizon(time(data.horizonMs))}</p>}
      <div className="sa-data-field">
        <label htmlFor="sa-data-retention">{RETENTION.label}</label>
        <select
          id="sa-data-retention"
          value={shown === null ? '' : String(shown)}
          disabled={blocked || actions.busy || open}
          aria-describedby="sa-data-retention-help"
          onChange={(event) => setDraft(choiceOf(event.target.value))}
        >
          <option value="">{RETENTION.keepEverything}</option>
          {RETENTION_CHOICES.map((days) => (
            <option key={days} value={String(days)}>
              {RETENTION.daysLabel(days)}
            </option>
          ))}
        </select>
        <Button onClick={save} disabled={blocked || !dirty} aria-disabled={actions.busy || undefined}>
          {RETENTION.save}
        </Button>
      </div>
      <p className="sa-help" id="sa-data-retention-help">
        {RETENTION.help}
      </p>
      {error !== null && (
        <p className="sa-data-error" role="alert">
          {error}
        </p>
      )}

      <h4>{PURGE.heading}</h4>
      <p>{previewLine}</p>
      {!open && (
        <div className="sa-data-actions">
          <Button ref={opener} onClick={() => setConfirming(saved)} disabled={!canPurge}>
            {PURGE.open}
          </Button>
        </div>
      )}
      {open && preview !== null && (
        <ConfirmPanel heading={PURGE.confirmHeading} confirmLabel={PURGE.confirm} cancelLabel={PURGE.cancel} busy={actions.busy} error={confirmError} onConfirm={purge} onCancel={closeConfirm}>
          <p>
            This deletes history before {time(preview.cutoffMs)}: {observationWords(preview.observations)}, {quarantineWords(preview.quarantine)} and {attemptWords(preview.attempts)}. It cannot be undone from this page.
          </p>
          <p>{RETENTION.kept}</p>
          <p>{RETENTION.backup}</p>
          <p>{RETENTION.noShrink}</p>
        </ConfirmPanel>
      )}
      {!open && (
        <p className="sa-help">
          {RETENTION.kept} {RETENTION.noShrink}
        </p>
      )}
      <p className="sa-data-result" ref={result} tabIndex={-1}>
        {latest === null ? '' : runWords(latest, time(latest.endedMs ?? latest.startedMs))}
      </p>
    </section>
  );
}
