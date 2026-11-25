import { Button } from '../observatory/ui';
import { ModeBadge } from './ModeBadge';
import { RECAP } from './recapCopy';
import { SPEEDS } from './useRecapPlayer';
import type { RecapPlayer } from './useRecapPlayer';

interface Props {
  player: RecapPlayer;
  /** False for reduced motion or a hidden tab: Play is not offered and the steps move the recap by hand. */
  allowed: boolean;
  /** Nothing to play: the controls that move the playhead are off. */
  empty: boolean;
  onExit: () => void;
}

/** Play or pause, restart, the two event steps, speed and Exit to live. All of it is plain buttons, reachable by keyboard. */
export function RecapControls({ player, allowed, empty, onExit }: Props) {
  return (
    <div className="sa-recap-controls" role="toolbar" aria-label={RECAP.controls}>
      <ModeBadge mode="RECORDED" />
      {allowed && (
        <Button onClick={player.playing ? player.pause : player.play} disabled={empty}>
          {player.playing ? RECAP.pause : RECAP.play}
        </Button>
      )}
      <Button onClick={player.restart} disabled={empty}>
        {RECAP.restart}
      </Button>
      <Button onClick={() => player.step(-1)} disabled={empty}>
        {RECAP.previous}
      </Button>
      <Button onClick={() => player.step(1)} disabled={empty}>
        {RECAP.next}
      </Button>
      {allowed && (
        <div role="group" aria-label={RECAP.speed} className="sa-recap-speeds">
          {SPEEDS.map((speed) => (
            <Button key={speed} aria-pressed={player.speed === speed} onClick={() => player.setSpeed(speed)} disabled={empty}>
              {`${speed}x`}
            </Button>
          ))}
        </div>
      )}
      <Button onClick={onExit}>{RECAP.exit}</Button>
    </div>
  );
}
