import { fixtureNavigations } from '@kirocrew/app-sdk';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHostNavigate } from './useHostNavigate';

afterEach(() => {
  vi.doUnmock('@kirocrew/app-sdk');
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('useHostNavigate', () => {
  it('hands /members to the host function', () => {
    const { result } = renderHook(() => useHostNavigate());
    result.current('/members');
    expect(fixtureNavigations).toEqual(['/members']);
  });

  it('refuses a path outside the allowlist even if the type is bypassed', () => {
    const { result } = renderHook(() => useHostNavigate());
    // @ts-expect-error the hook accepts only the literal '/members'
    result.current('/chat?sid=abc');
    expect(fixtureNavigations).toEqual([]);
  });

  it('falls back to a page load when the host module has no useNavigate', async () => {
    vi.resetModules();
    vi.doMock('@kirocrew/app-sdk', () => ({ useAppApi: () => ({}) }));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fresh = await import('./useHostNavigate');
    const { result } = renderHook(() => fresh.useHostNavigate());
    result.current('/members');
    expect(assign).toHaveBeenCalledExactlyOnceWith('/members');
  });
});
