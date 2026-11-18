import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSourceMode } from './useSourceMode';

describe('useSourceMode', () => {
  it('reads FIXTURE from the aliased fixture client', () => {
    expect(renderHook(() => useSourceMode()).result.current).toBe('FIXTURE');
  });
});
