import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressLine } from './ProgressLine';
import { StateBadge } from './StateBadge';
import { XpMeter } from './XpMeter';
import { summaryOf } from './testData';

describe('StateBadge (S-1)', () => {
  it.each([
    ['open', 'Open', 'open'],
    ['awaiting-review', 'Awaiting your review', 'review'],
    ['blocked', 'Blocked', 'blocked'],
    ['rejected', 'Rejected', 'rejected'],
    ['cancelled', 'Cancelled', 'cancelled'],
    ['accepted', 'Accepted', 'accepted'],
    ['reopened', 'Reopened', 'open'],
  ])('spells out %s as words with a tone class', (state, label, tone) => {
    const { container } = render(<StateBadge state={state} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(container.querySelector(`.sa-work-badge--${tone}`)).not.toBeNull();
  });

  it('prints an unknown token as unknown', () => {
    render(<StateBadge state="mystery" />);
    expect(screen.getByText('Unknown state (mystery)')).toBeTruthy();
  });
});

describe('ProgressLine (S-2)', () => {
  it('is text only, never a percentage or a bar', () => {
    const { container, rerender } = render(<ProgressLine progress={{ done: 1, total: 3 }} />);
    expect(container.textContent).toBe('1 of 3 milestones done');
    rerender(<ProgressLine progress={null} />);
    expect(container.textContent).toBe('Progress unknown');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
  });
});

describe('XpMeter (S-3)', () => {
  it('draws the bar from the XP fields only and sets no transition inline', () => {
    const { container } = render(<XpMeter summary={summaryOf()} />);
    const bar = screen.getByRole('progressbar', { name: '50 of 150 XP toward level 3' });
    expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuenow')]).toEqual(['0', '150', '50']);
    const fill = container.querySelector('.sa-xp-bar > span') as HTMLElement;
    expect(fill.getAttribute('style')).toBe('width: 33%;');
    expect(fill.style.transition).toBe('');
  });

  it('says the top level is reached and draws no bar there', () => {
    render(<XpMeter summary={summaryOf({ level: 10, nextLevelXp: null, levelFloorXp: 3200, totalXp: 3500 })} />);
    expect(screen.getByText('Top level reached')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('never fills past the bar', () => {
    const { container } = render(<XpMeter summary={summaryOf({ totalXp: 400 })} />);
    expect((container.querySelector('.sa-xp-bar > span') as HTMLElement).style.width).toBe('100%');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('150');
  });
});
