import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONCURRENT_CUE_GROUPS, MAX_DECORATIVE_PARTICLES, PresentationCueLayer, createPresentationCueScheduler } from './PresentationCueLayer';
import type { PresentationCue } from './PresentationCueLayer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const cue = (n: number, extra: Partial<PresentationCue> = {}): PresentationCue => ({ id: `c${n}`, workId: `w${n}`, title: `Task ${n}`, committedXp: 100, durationMs: 1_800, ...extra });

describe('PresentationCueLayer', () => {
  it('renders nothing visible and stays hidden from assistive technology', () => {
    const { container } = render(<PresentationCueLayer cues={[]} onComplete={vi.fn()} />);
    expect(container.querySelectorAll('[data-cue]')).toHaveLength(0);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the committed XP from the cue and a data-cue marker per card', () => {
    const { container } = render(<PresentationCueLayer cues={[cue(1), cue(2, { committedXp: null })]} onComplete={vi.fn()} />);
    const cards = [...container.querySelectorAll('[data-cue]')];
    expect(cards.map((c) => c.getAttribute('data-cue'))).toEqual(['w1', 'w2']);
    expect(cards[0]?.textContent).toContain('+100 XP');
    expect(cards[1]?.textContent).not.toContain('XP');
    expect(cards[0]?.textContent).toContain('Task credited');
  });

  it('caps concurrent cards at four and particles at 24 in total', () => {
    const { container } = render(<PresentationCueLayer cues={Array.from({ length: 9 }, (_, i) => cue(i))} onComplete={vi.fn()} />);
    expect(container.querySelectorAll('[data-cue]')).toHaveLength(MAX_CONCURRENT_CUE_GROUPS);
    expect(container.querySelectorAll('.sa-cue__particles i').length).toBeLessThanOrEqual(MAX_DECORATIVE_PARTICLES);
  });

  it('completes a cue once after its duration and cancels on unmount', () => {
    const onComplete = vi.fn();
    const { unmount } = render(<PresentationCueLayer cues={[cue(1)]} onComplete={onComplete} />);
    act(() => void vi.advanceTimersByTime(1_799));
    expect(onComplete).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledWith('c1');
    const later = vi.fn();
    const second = render(<PresentationCueLayer cues={[cue(2)]} onComplete={later} />);
    second.unmount();
    unmount();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(later).not.toHaveBeenCalled();
  });
});

describe('scheduler', () => {
  it('replaces a timer scheduled twice for one id and counts pending', () => {
    const scheduler = createPresentationCueScheduler();
    const first = vi.fn();
    const second = vi.fn();
    scheduler.schedule('a', 100, first);
    scheduler.schedule('a', 100, second);
    expect(scheduler.pendingCount()).toBe(1);
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('cancels everything', () => {
    const scheduler = createPresentationCueScheduler();
    const run = vi.fn();
    scheduler.schedule('a', 10, run);
    scheduler.schedule('b', 10, run);
    scheduler.cancelAll();
    vi.advanceTimersByTime(100);
    expect(run).not.toHaveBeenCalled();
  });
});
