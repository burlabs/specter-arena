import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '../observatory/ui';

interface Props {
  heading: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Marks both buttons aria-disabled, and ignores them and Escape, while the request is in flight. A disabled button would drop keyboard focus. */
  busy: boolean;
  error: string | null;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * An inline confirmation, not a modal: nothing behind it is hidden or inert, so it is a labelled group. Focus moves
 * to its heading when it opens (the opener restores focus when it closes) and Escape cancels.
 */
export function ConfirmPanel({ heading, confirmLabel, cancelLabel, busy, error, children, onConfirm, onCancel }: Props) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="sa-data-confirm" role="group" aria-labelledby={headingId} onKeyDown={onKeyDown}>
      <h4 id={headingId} ref={headingRef} tabIndex={-1}>
        {heading}
      </h4>
      {children}
      {error !== null && (
        <p className="sa-data-error" role="alert">
          {error}
        </p>
      )}
      <div className="sa-data-actions">
        <Button onClick={busy ? undefined : onConfirm} aria-disabled={busy || undefined}>
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={busy ? undefined : onCancel} aria-disabled={busy || undefined}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
