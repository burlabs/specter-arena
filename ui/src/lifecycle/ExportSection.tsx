import { useState } from 'react';
import { Button } from '../observatory/ui';
import { EXPORT } from './copy';
import { formatBytes } from './model';
import type { SectionProps } from './sectionTypes';
import { useFormatTime } from './useFormatTime';

export function ExportSection({ data, actions, submit }: SectionProps) {
  const time = useFormatTime();
  const [error, setError] = useState<string | null>(null);
  const last = data.lastExport;
  const blocked = data.running !== null;

  const press = async () => {
    if (actions.busy) return;
    setError(null);
    setError(await submit(actions.exportStore(), 'Export written.'));
  };

  return (
    <section className="sa-data-section" aria-labelledby="sa-data-export">
      <h3 id="sa-data-export">{EXPORT.heading}</h3>
      <p className="sa-help">{EXPORT.help}</p>
      <div className="sa-data-actions">
        <Button onClick={press} disabled={blocked} aria-disabled={actions.busy || undefined}>
          {actions.busy ? EXPORT.working : EXPORT.action}
        </Button>
      </div>
      {error !== null && (
        <p className="sa-data-error" role="alert">
          {error}
        </p>
      )}
      <p>{last === null ? EXPORT.none : EXPORT.saved(last.fileName)}</p>
      {data.exports.length > 0 && (
        <ul className="sa-data-exports" aria-label={EXPORT.listLabel}>
          {data.exports.map((file) => (
            <li key={file.fileName}>
              <code>{file.fileName}</code>
              <span>
                {formatBytes(file.byteLength)} · {time(file.createdMs)}
              </span>
              <span className="sa-data-hash">SHA-256 {file.sha256}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
