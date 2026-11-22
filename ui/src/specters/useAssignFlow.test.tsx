import { rosterBody } from '@kirocrew/app-sdk';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { markOffered, readOffered } from './onboarding';
import { useAssignFlow } from './useAssignFlow';

const bots = rosterBody('default').items;
const ids = bots.map((bot) => bot.bindingId);

const flow = (initial: { ready: boolean; unassigned: string[] }) =>
  renderHook((props: { ready: boolean; unassigned: string[] }) => useAssignFlow({ ready: props.ready, bots, unassigned: props.unassigned }), { initialProps: initial });

describe('useAssignFlow', () => {
  it('stays closed until the roster and the Specters are ready', () => {
    const { result, rerender } = flow({ ready: false, unassigned: [ids[3] ?? ''] });
    expect(result.current.queue).toBeNull();
    rerender({ ready: true, unassigned: [ids[3] ?? ''] });
    expect(result.current.queue).toEqual([ids[3]]);
  });

  it('lists pending bots in roster order and ignores ids that are not on the roster', () => {
    const { result } = flow({ ready: false, unassigned: ['bnd_gone', ids[5] ?? '', ids[2] ?? ''] });
    expect(result.current.pending).toEqual([ids[2], ids[5]]);
  });

  it('opens by itself once, for bots this browser was never offered', () => {
    markOffered([ids[2] ?? '']);
    const { result, rerender } = flow({ ready: true, unassigned: [ids[2] ?? '', ids[3] ?? ''] });
    expect(result.current.queue).toEqual([ids[3]]);
    act(() => result.current.close([ids[3] ?? '']));
    expect(result.current.queue).toBeNull();
    rerender({ ready: true, unassigned: [ids[3] ?? '', ids[4] ?? ''] });
    expect(result.current.queue).toBeNull();
    expect(result.current.pending).toEqual([ids[3], ids[4]]);
  });

  it('does not open when every pending bot was offered, or when none is pending', () => {
    markOffered([ids[2] ?? '']);
    expect(flow({ ready: true, unassigned: [ids[2] ?? ''] }).result.current.queue).toBeNull();
    expect(flow({ ready: true, unassigned: [] }).result.current.queue).toBeNull();
  });

  it('opens on demand for every pending bot, starting at the one asked for', () => {
    markOffered(ids);
    const { result } = flow({ ready: true, unassigned: [ids[1] ?? '', ids[3] ?? '', ids[5] ?? ''] });
    expect(result.current.queue).toBeNull();
    act(() => result.current.open());
    expect(result.current.queue).toEqual([ids[1], ids[3], ids[5]]);
    act(() => result.current.open(ids[5]));
    expect(result.current.queue).toEqual([ids[5], ids[1], ids[3]]);
    act(() => result.current.open('bnd_gone'));
    expect(result.current.queue).toEqual([ids[1], ids[3], ids[5]]);
  });

  it('does nothing on demand when no bot is pending', () => {
    const { result } = flow({ ready: true, unassigned: [] });
    act(() => result.current.open());
    expect(result.current.queue).toBeNull();
  });

  it('records every shown bot as offered when it closes', () => {
    const { result } = flow({ ready: true, unassigned: [ids[3] ?? '', ids[4] ?? ''] });
    act(() => result.current.close(result.current.queue ?? []));
    expect(readOffered()).toEqual([ids[3], ids[4]]);
  });
});
