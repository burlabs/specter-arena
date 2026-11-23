import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedMinion, MINION_DURATIONS_MS } from './AnimatedMinion';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AnimatedMinion', () => {
  it('draws the sprite element when ready and the fallback drawing when not', () => {
    const ready = render(<AnimatedMinion minionType="patchling" animation="idle" animate spriteReady />);
    expect(ready.container.querySelector('.sa-minion__art')).not.toBeNull();
    ready.unmount();
    const patchling = render(<AnimatedMinion minionType="patchling" animation="idle" animate spriteReady={false} />);
    expect(patchling.container.querySelector('svg.sa-minion__fallback')).not.toBeNull();
    patchling.unmount();
    const brute = render(<AnimatedMinion minionType="patchbrute" animation="idle" animate spriteReady={false} />);
    expect(brute.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 160 140');
  });

  it('marks animated and static presentation and the defeated pose', () => {
    const { container, rerender } = render(<AnimatedMinion minionType="patchling" animation="engaged" animate spriteReady />);
    expect(container.firstElementChild?.className).toContain('sa-is-animated');
    expect(container.firstElementChild?.className).toContain('sa-is-engaged');
    rerender(<AnimatedMinion minionType="patchling" animation="idle" animate={false} spriteReady defeated facing="right" />);
    expect(container.firstElementChild?.className).toContain('sa-is-static');
    expect(container.firstElementChild?.className).toContain('sa-is-defeated');
    expect(container.firstElementChild?.getAttribute('data-facing')).toBe('right');
  });

  it('strikes back toward the hero with a lunge direction and reports once after its duration', () => {
    const done = vi.fn();
    const { container } = render(<AnimatedMinion minionType="patchling" animation="attack" animate spriteReady requestId={3} lunge={-1} onAnimationComplete={done} />);
    const minion = container.querySelector<HTMLElement>('.sa-minion');
    expect(minion?.className).toContain('sa-is-attack');
    expect(minion?.style.getPropertyValue('--sa-lunge')).toBe('-1');
    expect(container.querySelector('.sa-minion-impact')).toBeNull();
    act(() => void vi.advanceTimersByTime(MINION_DURATIONS_MS.patchling.attack - 1));
    expect(done).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(done).toHaveBeenCalledWith(3);
  });

  it('reports an attack at once and draws it static when motion is off', () => {
    const done = vi.fn();
    const { container } = render(<AnimatedMinion minionType="patchbrute" animation="attack" animate={false} spriteReady requestId={4} onAnimationComplete={done} />);
    expect(container.querySelector('.sa-minion')?.className).toContain('sa-is-static');
    expect(done).toHaveBeenCalledWith(4);
  });

  it('starts no timer for a looping animation', () => {
    const spy = vi.spyOn(window, 'setTimeout');
    render(<AnimatedMinion minionType="patchbrute" animation="engaged" animate spriteReady />);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports a one-shot once, after its duration, with its effect drawn', () => {
    const done = vi.fn();
    const { container } = render(<AnimatedMinion minionType="patchbrute" animation="hit" animate spriteReady requestId={7} onAnimationComplete={done} />);
    expect(container.querySelector('.sa-minion-impact--patchbrute')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(MINION_DURATIONS_MS.patchbrute.hit - 1));
    expect(done).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(7);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('reports a static one-shot at once without a timer', () => {
    const done = vi.fn();
    const spy = vi.spyOn(window, 'setTimeout');
    const { container } = render(<AnimatedMinion minionType="patchling" animation="defeat" animate={false} spriteReady onAnimationComplete={done} />);
    expect(done).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.sa-minion-collapse--patchling')).not.toBeNull();
  });

  it('cancels the timer when it unmounts', () => {
    const done = vi.fn();
    const { unmount } = render(<AnimatedMinion minionType="patchling" animation="defeat" animate spriteReady onAnimationComplete={done} />);
    unmount();
    act(() => void vi.advanceTimersByTime(5_000));
    expect(done).not.toHaveBeenCalled();
  });

  it('copes with no completion callback', () => {
    render(<AnimatedMinion minionType="patchling" animation="hit" animate={false} spriteReady />);
    render(<AnimatedMinion minionType="patchling" animation="hit" animate spriteReady />);
    act(() => void vi.advanceTimersByTime(1_000));
  });

  it('carries the recoil direction and strength of a hit as custom properties, and nothing for other poses', () => {
    const { container, rerender } = render(<AnimatedMinion minionType="patchbrute" animation="hit" animate spriteReady requestId={4} recoil={-1} strong />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('sa-is-hit');
    expect(root.className).toContain('sa-is-strong');
    expect(root.style.getPropertyValue('--sa-recoil')).toBe('-1');
    expect(root.style.getPropertyValue('--sa-recoil-mag')).toBe('1.8');
    rerender(<AnimatedMinion minionType="patchling" animation="hit" animate spriteReady requestId={5} />);
    const plain = container.firstElementChild as HTMLElement;
    expect(plain.className).not.toContain('sa-is-strong');
    expect(plain.style.getPropertyValue('--sa-recoil')).toBe('1');
    expect(plain.style.getPropertyValue('--sa-recoil-mag')).toBe('1');
    rerender(<AnimatedMinion minionType="patchling" animation="engaged" animate spriteReady />);
    expect((container.firstElementChild as HTMLElement).getAttribute('style')).toBeNull();
  });
});
