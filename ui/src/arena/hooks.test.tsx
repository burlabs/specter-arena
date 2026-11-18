import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKS, mark } from './marks';
import { DEFAULT_VIEWPORT, useElementSize } from './useElementSize';
import { useArenaMotion } from './useArenaMotion';
import { useArenaStyle } from './useArenaStyle';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useArenaStyle', () => {
  it('adds one scoped style element and removes it on unmount', () => {
    const { unmount } = renderHook(() => useArenaStyle());
    const found = document.head.querySelectorAll('style[data-specter-arena-scene]');
    expect(found).toHaveLength(1);
    expect(found[0]?.textContent).toContain('.specter-arena-root');
    expect(document.head.querySelectorAll('style[data-specter-arena]')).toHaveLength(0);
    unmount();
    expect(document.head.querySelectorAll('style[data-specter-arena-scene]')).toHaveLength(0);
  });
});

describe('useArenaMotion', () => {
  it('animates when allowed and stops when paused, then resumes', () => {
    const { result } = renderHook(() => useArenaMotion());
    expect(result.current).toMatchObject({ animate: true, paused: false });
    act(() => result.current.togglePause());
    expect(result.current).toMatchObject({ animate: false, paused: true });
    act(() => result.current.togglePause());
    expect(result.current.animate).toBe(true);
  });

  it('does not animate under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { result } = renderHook(() => useArenaMotion());
    expect(result.current.animate).toBe(false);
  });
});

describe('useElementSize', () => {
  it('keeps the default without ResizeObserver', () => {
    const ref = { current: document.createElement('div') };
    expect(renderHook(() => useElementSize(ref)).result.current).toEqual(DEFAULT_VIEWPORT);
  });

  it('follows the observed box, ignores an empty one and disconnects', () => {
    let callback: ResizeObserverCallback = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const ref = { current: document.createElement('div') };
    const { result, unmount } = renderHook(() => useElementSize(ref));
    const emit = (width: number, height: number) => act(() => callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver));
    emit(500, 300);
    expect(result.current).toEqual({ width: 500, height: 300 });
    emit(0, 0);
    expect(result.current).toEqual({ width: 500, height: 300 });
    const before = result.current;
    emit(500, 300);
    expect(result.current).toBe(before);
    act(() => callback([], {} as ResizeObserver));
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('does nothing without an element', () => {
    expect(renderHook(() => useElementSize({ current: null })).result.current).toEqual(DEFAULT_VIEWPORT);
  });
});

describe('mark', () => {
  it('makes a User Timing mark and survives a missing API', () => {
    const spy = vi.spyOn(performance, 'mark');
    mark(MARKS.dataReady);
    expect(spy).toHaveBeenCalledWith('arena:data-ready');
    vi.stubGlobal('performance', {});
    expect(() => mark(MARKS.updateEnd)).not.toThrow();
    expect(Object.values(MARKS)).toEqual(['arena:data-ready', 'arena:first-render', 'arena:update-start', 'arena:update-end']);
  });
});

describe('copy helpers', () => {
  it('says gaps and unknown bots in the singular and the plural', async () => {
    const { ARENA } = await import('./copy');
    expect(ARENA.coverage(1, 1)).toBe('Coverage: 1 bot has a collection gap, 1 bot is unknown');
    expect(ARENA.coverage(0, 2)).toBe('Coverage: 0 bots have a collection gap, 2 bots are unknown');
    expect(ARENA.linked(1)).toBe('1 open attempt');
    expect(ARENA.overflow(2)).toBe('2 more on-field items are listed below and not drawn in the scene.');
  });
});
