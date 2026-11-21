import { useState } from 'react';
import { Button } from '../observatory/ui';
import { collectorWords } from '../observatory/copy';
import { COLLECTION } from './copy';

interface Props {
  paused: boolean;
  busy: boolean;
  /** Resolves to an error sentence, or null on success. */
  onSet: (paused: boolean) => Promise<string | null>;
}

export function CollectionSection({ paused, busy, onSet }: Props) {
  const [error, setError] = useState<string | null>(null);
  const words = paused ? collectorWords('paused', null) : COLLECTION.notPaused;

  const press = async () => {
    if (busy) return;
    setError(null);
    setError(await onSet(!paused));
  };

  return (
    <section className="sa-data-section" aria-labelledby="sa-data-collection">
      <h3 id="sa-data-collection">{COLLECTION.heading}</h3>
      <p className="sa-data-state" data-paused={paused ? 'true' : 'false'}>
        {words}
      </p>
      <p className="sa-help">{paused ? COLLECTION.pausedNote : COLLECTION.runningNote}</p>
      <div className="sa-data-actions">
        <Button onClick={press} aria-disabled={busy || undefined}>
          {paused ? COLLECTION.resume : COLLECTION.pause}
        </Button>
      </div>
      {error !== null && (
        <p className="sa-data-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
