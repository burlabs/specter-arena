import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecapScrubBar } from './RecapScrubBar';
import { buildTimeline } from './recapTimeline';
import { covered, notCollected, recapOf, rosterOf, runOf } from './recapTestData';

const [bot] = rosterOf(1) as [ReturnType<typeof rosterOf>[number]];
const recap = recapOf([runOf(1, bot, 0, 10), runOf(2, bot, 70, 80), runOf(3, bot, 100, 130)], 140, [covered(0, 30), notCollected(30, 40, 'paused'), covered(40, 110), notCollected(110, 120, 'collector-gap'), covered(120, 140)]);
const timeline = buildTimeline(recap, 'today');
const draw = (playMs = 0, onSeek = vi.fn()) => render(<RecapScrubBar recap={recap} timeline={timeline} playMs={playMs} onSeek={onSeek} valueText="Nov 25, 2026, 3:00:00 PM MST" />);

describe('RecapScrubBar', () => {
  it('draws cut time as notches and not-collected time as hatched blocks, two different marks', () => {
    const { container } = draw();
    expect(container.querySelectorAll('.sa-recap-notch').length).toBe(timeline.markers.length);
    expect(timeline.markers.length).toBeGreaterThan(0);
    const hatched = [...container.querySelectorAll('.sa-recap-block--hatched')];
    expect(hatched.length).toBe(2);
    expect(hatched.map((node) => node.getAttribute('title'))).toEqual(['Not collected: collection was paused', 'Not collected: the collector was not running or lost its feed']);
    expect(container.querySelectorAll('.sa-recap-block').length).toBeGreaterThan(hatched.length);
  });

  it('names every cut and not-collected stretch for a reader who cannot see the bar', () => {
    draw();
    const list = screen.getByRole('list', { name: 'Cut and not collected stretches' });
    expect(list.textContent).toMatch(/Skipped 30 min/);
    expect(list.textContent).toContain('Not collected: collection was paused');
  });

  it('has a slider with a name and a text value that follows the playhead and seeks', () => {
    const onSeek = vi.fn();
    const { container } = draw(5_000, onSeek);
    const slider = screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('Nov 25, 2026, 3:00:00 PM MST');
    expect(slider.value).toBe('5000');
    expect(Number(slider.max)).toBe(Math.round(timeline.totalMs));
    fireEvent.change(slider, { target: { value: '7000' } });
    expect(onSeek).toHaveBeenCalledWith(7000);
    const head = container.querySelector('.sa-recap-head') as HTMLElement;
    expect(parseFloat(head.style.left)).toBeCloseTo((5_000 / timeline.totalMs) * 100, 3);
  });

  it('shows the recorded spans when there is nothing to play, and turns the slider off', () => {
    const none = recapOf([], 60, [covered(0, 20), notCollected(20, 40, 'no-collector'), covered(40, 60)]);
    const { container } = render(<RecapScrubBar recap={none} timeline={buildTimeline(none, 'today')} playMs={0} onSeek={vi.fn()} valueText="x" />);
    expect(container.querySelectorAll('.sa-recap-block')).toHaveLength(3);
    expect(container.querySelectorAll('.sa-recap-block--hatched')).toHaveLength(1);
    expect(container.querySelector('.sa-recap-block--hatched')?.getAttribute('title')).toBe('Not collected: the app was not collecting');
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
  });
});
