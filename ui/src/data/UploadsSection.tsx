import { useEffect, useRef, useState } from 'react';
import { Button } from '../observatory/ui';
import { ConfirmPanel } from './ConfirmPanel';
import { UPLOADS, runWords } from './copy';
import type { SectionProps } from './sectionTypes';
import { uploadWords } from './model';
import { useFormatTime } from './useFormatTime';

export function UploadsSection({ data, actions, submit }: SectionProps) {
  const time = useFormatTime();
  const { stored, cap, unused } = data.uploads;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusResult, setFocusResult] = useState(0);
  const [focusOpener, setFocusOpener] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const result = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusResult > 0) result.current?.focus();
  }, [focusResult]);
  // The opener is unmounted while the panel is open, so focus goes back to it only after the render that remounts it.
  useEffect(() => {
    if (focusOpener > 0) opener.current?.focus();
  }, [focusOpener]);
  const blocked = data.running !== null;
  const last = data.lastCleanup;

  const close = () => {
    setOpen(false);
    setError(null);
    setFocusOpener((count) => count + 1);
  };

  const remove = async () => {
    setError(null);
    const message = await submit(actions.cleanupUploads(), UPLOADS.done);
    if (message !== null) {
      setError(message);
      return;
    }
    setOpen(false);
    setFocusResult((count) => count + 1);
  };

  return (
    <section className="sa-data-section" aria-labelledby="sa-data-uploads">
      <h3 id="sa-data-uploads">{UPLOADS.heading}</h3>
      <p>{UPLOADS.usage(stored, cap)}</p>
      {stored >= cap && <p className="sa-data-note">{UPLOADS.atCap}</p>}
      <p>{unused === 0 ? UPLOADS.noneUnused : UPLOADS.unused(unused)}</p>
      <p className="sa-help">{UPLOADS.help}</p>
      {!open && (
        <div className="sa-data-actions">
          <Button ref={opener} onClick={() => setOpen(true)} disabled={blocked || unused === 0}>
            {UPLOADS.open}
          </Button>
        </div>
      )}
      {open && (
        <ConfirmPanel heading={UPLOADS.confirmHeading} confirmLabel={UPLOADS.confirm} cancelLabel="Cancel" busy={actions.busy} error={error} onConfirm={remove} onCancel={close}>
          <p>
            This removes up to {uploadWords(unused)} that no avatar uses. {UPLOADS.help}
          </p>
        </ConfirmPanel>
      )}
      <p className="sa-data-result" ref={result} tabIndex={-1}>
        {last === null ? '' : runWords(last, time(last.endedMs ?? last.startedMs))}
      </p>
    </section>
  );
}
