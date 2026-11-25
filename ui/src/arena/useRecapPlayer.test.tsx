import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecapPlayer } from './useRecapPlayer';
import type { PlayerOptions } from './useRecapPlayer';

let clock = 0;
let queued: Array<{ id: number; callback: FrameRequestCallback }> = [];
let nextId = 1;

const frame = (ms: number) => {
  clock += ms;
  const due = queued;
  queued = [];
  act(() => due.forEach(({ callback }) => callback(clock)));
};

beforeEach(() => {
  clock = 1_000;
  queued = [];
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    queued.push({ id: nextId, callback });
    return nextId++;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    queued = queued.filter((item) => item.id !== id);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  onAdvance.mockReset();
});

const EVENTS = [0, 1_000, 5_000, 9_000, 10_000];
const onAdvance = vi.fn();
const start = (extra: Partial<PlayerOptions> = {}) => renderHook((props: PlayerOptions) => useRecapPlayer(props), { initialProps: { totalMs: 10_000, events: EVENTS, allowed: true, onAdvance, ...extra } });

describe('useRecapPlayer', () => {
  it('opens paused at the first frame and moves nothing until Play', () => {
    const { result } = start();
    expect(result.current).toMatchObject({ playMs: 0, playing: false, speed: 1 });
    expect(onAdvance).not.toHaveBeenCalled();
    frame(500);
    expect(result.current.playMs).toBe(0);
    expect(queued).toHaveLength(0);
  });

  it('plays by the browser clock and reports the stretch it walked', () => {
    const { result } = start();
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    frame(100);
    expect(result.current.playMs).toBe(100);
    frame(50);
    expect(result.current.playMs).toBe(150);
    expect(onAdvance.mock.calls).toEqual([
      [0, 100],
      [100, 150],
    ]);
  });

  it.each([0.5, 2, 4] as const)('moves %sx as fast', (speed) => {
    const { result } = start();
    act(() => result.current.setSpeed(speed));
    act(() => result.current.play());
    frame(100);
    expect(result.current.playMs).toBeCloseTo(100 * speed, 6);
  });

  it('pauses at the end, and Play from the end starts over', () => {
    const { result } = start({ totalMs: 300 });
    act(() => result.current.play());
    frame(1_000);
    expect(result.current).toMatchObject({ playMs: 300, playing: false });
    act(() => result.current.play());
    expect(result.current.playMs).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it('pauses on request and keeps the playhead', () => {
    const { result } = start();
    act(() => result.current.play());
    frame(200);
    act(() => result.current.pause());
    expect(result.current).toMatchObject({ playing: false, playMs: 200 });
    frame(200);
    expect(result.current.playMs).toBe(200);
  });

  it('reports no stretch for a seek, a restart, a step or a speed change, and no stretch goes missing', () => {
    const { result } = start();
    act(() => result.current.play());
    frame(100);
    frame(100);
    expect(onAdvance.mock.calls).toEqual([
      [0, 100],
      [100, 200],
    ]);
    onAdvance.mockClear();
    act(() => result.current.seek(4_000));
    act(() => result.current.step(1));
    act(() => result.current.setSpeed(2));
    act(() => result.current.restart());
    expect(onAdvance).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ playMs: 0, playing: false });
    act(() => result.current.seek(4_000));
    act(() => result.current.play());
    frame(100);
    expect(onAdvance).toHaveBeenCalledWith(4_000, 4_200);
  });

  it('keeps a seek inside the recap', () => {
    const { result } = start();
    act(() => result.current.seek(-5));
    expect(result.current.playMs).toBe(0);
    act(() => result.current.seek(99_999));
    expect(result.current.playMs).toBe(10_000);
  });

  it('steps to the next and previous event and pauses', () => {
    const { result } = start();
    act(() => result.current.play());
    act(() => result.current.step(1));
    expect(result.current).toMatchObject({ playMs: 1_000, playing: false });
    act(() => result.current.step(1));
    act(() => result.current.step(1));
    expect(result.current.playMs).toBe(9_000);
    act(() => result.current.step(-1));
    expect(result.current.playMs).toBe(5_000);
    act(() => result.current.seek(10_000));
    act(() => result.current.step(1));
    expect(result.current.playMs).toBe(10_000);
    act(() => result.current.seek(0));
    act(() => result.current.step(-1));
    expect(result.current.playMs).toBe(0);
  });

  it('never plays by itself when motion is not allowed, and Play does nothing', () => {
    const { result } = start({ allowed: false });
    act(() => result.current.play());
    expect(result.current.playing).toBe(false);
    frame(500);
    expect(result.current.playMs).toBe(0);
    act(() => result.current.step(1));
    expect(result.current.playMs).toBe(1_000);
    act(() => result.current.seek(3_000));
    expect(result.current.playMs).toBe(3_000);
  });

  it('pauses when motion stops being allowed (a hidden tab) and does not resume when it returns', () => {
    const { result, rerender } = start();
    act(() => result.current.play());
    frame(100);
    rerender({ totalMs: 10_000, events: EVENTS, allowed: false, onAdvance });
    expect(result.current.playing).toBe(false);
    rerender({ totalMs: 10_000, events: EVENTS, allowed: true, onAdvance });
    expect(result.current.playing).toBe(false);
    frame(100);
    expect(result.current.playMs).toBe(100);
  });

  it('has nothing to play for an empty recap', () => {
    const { result } = start({ totalMs: 0, events: [0] });
    act(() => result.current.play());
    expect(result.current.playing).toBe(false);
  });

  it('starts over when the recap changes', () => {
    const { result, rerender } = start();
    act(() => result.current.seek(5_000));
    rerender({ totalMs: 20_000, events: EVENTS, allowed: true, onAdvance });
    expect(result.current.playMs).toBe(0);
  });

  it('runs one animation-frame loop at a time and stops it on unmount', () => {
    const { result, unmount } = start();
    act(() => result.current.play());
    expect(queued).toHaveLength(1);
    frame(10);
    frame(10);
    expect(queued).toHaveLength(1);
    unmount();
    expect(queued).toHaveLength(0);
  });
});
