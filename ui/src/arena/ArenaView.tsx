import { useCallback, useState } from 'react';
import { ArenaLive } from './ArenaLive';
import type { ArenaProps } from './ArenaLive';
import { ArenaRecapView } from './ArenaRecapView';
import { RecapModeBar } from './RecapModeBar';
import type { ArenaMode } from './recapCopy';

/**
 * The Arena tab: `Live | Today | Yesterday | This week`. Live is where it opens and is not remembered. Choosing a recap
 * unmounts the live arena and with it its poll; choosing Live mounts a fresh one, which starts from a new baseline and
 * celebrates nothing it did not watch happen.
 */
export function ArenaView(props: ArenaProps) {
  const [mode, setMode] = useState<ArenaMode>('live');
  const [unsupported, setUnsupported] = useState(false);
  const exit = useCallback(() => setMode('live'), []);
  const noRecaps = useCallback(() => {
    setUnsupported(true);
    setMode('live');
  }, []);
  return (
    <>
      <RecapModeBar value={mode} onChange={setMode} unsupported={unsupported} />
      {mode === 'live' ? <ArenaLive {...props} /> : <ArenaRecapView {...props} kind={mode} onExit={exit} onUnsupported={noRecaps} />}
    </>
  );
}
