import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMotionAllowed } from './useMotionAllowed';

function stubMedia(reduce: boolean) {
  const listeners = new Set<() => void>();
  const state = { reduce };
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return state.reduce && query.includes('reduce');
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return { state, listeners };
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setVisibility('visible');
});

describe('useMotionAllowed', () => {
  it('allows motion when matchMedia is missing (jsdom)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result, unmount } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(true);
    unmount();
  });

  it('is false while reduced motion is requested, and follows changes', () => {
    const media = stubMedia(true);
    const { result, unmount } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(false);
    act(() => {
      media.state.reduce = false;
      media.listeners.forEach((fn) => fn());
    });
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('is false while the page is hidden', () => {
    stubMedia(false);
    const { result } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(true);
    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(false);
  });
});
