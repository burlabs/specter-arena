import type { RecapV1 } from '../contracts/types';
import { NOT_COLLECTED_WORDS, RECAP } from './recapCopy';
import type { Timeline } from './recapTimeline';

interface Props {
  recap: RecapV1;
  timeline: Timeline;
  playMs: number;
  onSeek: (playMs: number) => void;
  /** The recorded time under the playhead, in words, as the slider's value text. */
  valueText: string;
}

interface Block {
  key: string;
  left: number;
  width: number;
  hatched: boolean;
  title: string | undefined;
}

const percent = (value: number, total: number): number => (total === 0 ? 0 : (value / total) * 100);

/** The blocks of the bar: play time when there is something to play, else the recorded spans, so a period with no tasks still shows what was collected. */
function blocksOf(recap: RecapV1, timeline: Timeline): Block[] {
  if (timeline.totalMs === 0) {
    const length = recap.toMs - recap.fromMs;
    return recap.coverage.spans.map((span) => ({
      key: `${span.fromMs}`,
      left: percent(span.fromMs - recap.fromMs, length),
      width: percent(span.toMs - span.fromMs, length),
      hatched: span.state === 'not-collected',
      title: span.state === 'not-collected' && span.reason !== 'collecting' ? NOT_COLLECTED_WORDS[span.reason] : undefined,
    }));
  }
  return timeline.playing.map((segment) => ({
    key: `${segment.srcFromMs}`,
    left: percent(segment.playFromMs, timeline.totalMs),
    width: percent(segment.playToMs - segment.playFromMs, timeline.totalMs),
    hatched: segment.notCollected !== null,
    title: segment.notCollected === null || segment.notCollected.reason === 'collecting' ? undefined : NOT_COLLECTED_WORDS[segment.notCollected.reason],
  }));
}

/**
 * The scrub bar: busy stretches, hatched not-collected stretches, and a plain notch for every cut stretch with no task
 * running, so the two kinds of missing time never look alike. The slider is the control; the drawing is decoration.
 */
export function RecapScrubBar({ recap, timeline, playMs, onSeek, valueText }: Props) {
  const blocks = blocksOf(recap, timeline);
  const hatched = blocks.filter((block) => block.hatched && block.title !== undefined);
  return (
    <div className="sa-recap-scrub">
      <div className="sa-recap-track" aria-hidden="true">
        {blocks.map((block) => (
          <span key={block.key} className={`sa-recap-block${block.hatched ? ' sa-recap-block--hatched' : ''}`} style={{ left: `${block.left}%`, width: `${block.width}%` }} title={block.title} />
        ))}
        {timeline.markers.map((marker) => (
          <span key={`${marker.playAtMs}-${marker.skippedMs}`} className="sa-recap-notch" style={{ left: `${percent(marker.playAtMs, timeline.totalMs)}%` }} title={RECAP.skipped(marker.skippedMs)} />
        ))}
        <span className="sa-recap-head" style={{ left: `${percent(playMs, timeline.totalMs)}%` }} />
      </div>
      <input
        className="sa-recap-slider"
        type="range"
        aria-label={RECAP.scrubLabel}
        aria-valuetext={valueText}
        min={0}
        max={Math.max(1, Math.round(timeline.totalMs))}
        step={1}
        value={Math.round(playMs)}
        disabled={timeline.totalMs === 0}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
      />
      <ul className="sa-visually-hidden" aria-label="Cut and not collected stretches">
        {timeline.markers.map((marker) => (
          <li key={`${marker.playAtMs}-${marker.skippedMs}`}>{RECAP.skipped(marker.skippedMs)}</li>
        ))}
        {hatched.map((block) => (
          <li key={block.key}>{block.title}</li>
        ))}
      </ul>
    </div>
  );
}
