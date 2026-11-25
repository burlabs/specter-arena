import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { botOf } from '../arena/testData';
import { RosterKpis } from './RosterKpis';

const value = (label: string) => within(screen.getByRole('group', { name: 'Roster summary' })).getByText(label).nextElementSibling?.textContent;

describe('RosterKpis', () => {
  it('counts tracked bots, bots working now and bots with a collection gap', () => {
    render(
      <RosterKpis
        items={[
          botOf(1, { state: 'working' }),
          botOf(2, { state: 'working', coverage: { state: 'gap', sinceMs: 1, reasonCode: 'gap', openGapCount: 1 } }),
          botOf(3),
          botOf(4, { state: 'unknown' }),
        ]}
      />,
    );
    expect(value('Tracked bots')).toBe('4');
    expect(value('Working now')).toBe('2');
    expect(value('Coverage gaps')).toBe('1');
  });

  it('shows zeros for an empty roster', () => {
    render(<RosterKpis items={[]} />);
    expect([value('Tracked bots'), value('Working now'), value('Coverage gaps')]).toEqual(['0', '0', '0']);
  });
});
