import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { XpMeter } from '../work/XpMeter';
import { summaryOf } from '../work/testData';
import { SpecterProgression } from './SpecterProgression';

const bar = () => screen.getByRole('progressbar');

describe('SpecterProgression', () => {
  it('shows the level, the total over the next level and a bar equal to XpMeter for the same summary', () => {
    const summary = summaryOf();
    const { container } = render(<SpecterProgression summary={summary} />);
    expect(screen.getByText('Level 2')).toBeTruthy();
    expect(screen.getByText('150 / 250 XP')).toBeTruthy();
    const progression = { label: bar().getAttribute('aria-label'), now: bar().getAttribute('aria-valuenow'), max: bar().getAttribute('aria-valuemax'), width: bar().querySelector('span')?.style.width };
    container.remove();

    render(<XpMeter summary={summary} />);
    const meter = { label: bar().getAttribute('aria-label'), now: bar().getAttribute('aria-valuenow'), max: bar().getAttribute('aria-valuemax'), width: bar().querySelector('span')?.style.width };
    expect(progression).toEqual(meter);
    expect(progression).toEqual({ label: '50 of 150 XP toward level 3', now: '50', max: '150', width: '33%' });
  });

  it('shows a full bar and no next level at the top level', () => {
    render(<SpecterProgression summary={summaryOf({ level: 10, totalXp: 9000, levelFloorXp: 8000, nextLevelXp: null })} />);
    expect(screen.getByText('Level 10')).toBeTruthy();
    expect(screen.getByText('9000 XP')).toBeTruthy();
    expect(bar().getAttribute('aria-label')).toBe('Top level reached');
    expect(bar().querySelector('span')?.style.width).toBe('100%');
  });

  it('shows level 1 and 0 XP with no bar when the ledger has no entry', () => {
    render(<SpecterProgression summary={undefined} />);
    expect(screen.getByText('Level 1')).toBeTruthy();
    expect(screen.getByText('0 XP')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says so in words, never a zero, when XP is loading or failed', () => {
    const { container, rerender } = render(<SpecterProgression summary={undefined} unavailable="loading" />);
    expect(container.textContent).toBe('Not loaded yet');
    rerender(<SpecterProgression summary={undefined} unavailable="failed" />);
    expect(container.textContent).toBe('Could not load. It retries automatically.');
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('marks the compact variant', () => {
    const { container } = render(<SpecterProgression summary={summaryOf()} compact />);
    expect(container.querySelector('.sa-progression--compact')).not.toBeNull();
  });

  it('draws the compact bar as decoration, with no progressbar role and no block element, so it can sit inside a button', () => {
    const { container } = render(
      <button type="button">
        <SpecterProgression summary={summaryOf()} compact />
      </button>,
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelector('button div')).toBeNull();
    const bar = container.querySelector('.sa-xp-bar');
    expect(bar?.tagName).toBe('SPAN');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect((bar?.firstElementChild as HTMLElement).style.width).toBe('33%');
    expect(screen.getByText('Level 2')).toBeTruthy();
    expect(screen.getByText('150 / 250 XP')).toBeTruthy();
  });

  it('keeps the words-only and loading variants phrasing-only when compact', () => {
    const { container, rerender } = render(<SpecterProgression summary={undefined} compact unavailable="loading" />);
    expect(container.querySelector('div')).toBeNull();
    rerender(<SpecterProgression summary={undefined} compact />);
    expect(container.querySelector('div')).toBeNull();
    expect(container.textContent).toBe('Level 10 XP');
  });
});
