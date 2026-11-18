import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../observatory/ui';
import { INSPECTOR } from './copy';

interface Props {
  /** Builds the text when the button is used, so it reflects the evidence on screen at that moment. */
  build: () => string;
}

type Outcome = { kind: 'idle' } | { kind: 'copied' } | { kind: 'refused'; text: string };

/** Copies a bounded, redacted summary. When the browser refuses the clipboard the same text is shown, selected, to copy by hand. */
export function CopySummary({ build }: Props) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const area = useRef<HTMLTextAreaElement>(null);
  const areaId = useId();

  useEffect(() => {
    if (outcome.kind !== 'refused') return;
    area.current?.focus();
    area.current?.select();
  }, [outcome]);

  const copy = async () => {
    const text = build();
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setOutcome({ kind: 'copied' });
    } catch {
      setOutcome({ kind: 'refused', text });
    }
  };

  return (
    <div className="sa-arena-copy">
      <Button onClick={() => void copy()}>{INSPECTOR.copyButton}</Button>
      <p role="status" className="sa-help">
        {outcome.kind === 'copied' ? INSPECTOR.copied : outcome.kind === 'refused' ? INSPECTOR.copyRefused : ''}
      </p>
      {outcome.kind === 'refused' && (
        <>
          <label htmlFor={areaId} className="sa-visually-hidden">
            {INSPECTOR.summaryLabel}
          </label>
          <textarea id={areaId} ref={area} className="sa-arena-copy__text" readOnly rows={8} value={outcome.text} />
        </>
      )}
    </div>
  );
}
