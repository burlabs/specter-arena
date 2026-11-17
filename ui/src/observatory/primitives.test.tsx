import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RosterItemV1 } from '../contracts/types';
import { ConditionBadge } from './ConditionBadge';
import { Initials } from './Initials';
import { OperationalLegend } from './OperationalLegend';
import { Time, TimeFormatContext } from './Time';
import { botCondition } from './model';
import { Button, EmptyState, ErrorState, Panel } from './ui';
import { rosterBody } from '@kirocrew/app-sdk';

const [atlas] = rosterBody('default').items as [RosterItemV1];

describe('ConditionBadge', () => {
  it.each([
    ['working', 'Working', 'working'],
    ['settled', 'No turn running', 'settled'],
    ['unknown', 'Unknown', 'unknown'],
  ])('shows text and a distinct shape class for %s', (state, label, tone) => {
    const { container } = render(<ConditionBadge view={botCondition({ ...atlas.condition, state })} />);
    expect(container.textContent).toBe(label);
    expect(container.querySelector(`.sa-status--${tone}`)).not.toBeNull();
    expect(container.querySelector('.sa-status__dot')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Initials', () => {
  it('renders the initials hidden from assistive tech', () => {
    const { container } = render(<Initials item={atlas} />);
    expect(container.textContent).toBe('A');
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('OperationalLegend', () => {
  it('expands and collapses, and lists two states as not observable yet', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<OperationalLegend open={false} onToggle={onToggle} />);
    const toggle = screen.getByRole('button', { name: /What the states mean/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Blocked')).toBeNull();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<OperationalLegend open onToggle={onToggle} />);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText(/Not observable yet/)).toHaveLength(2);
    expect(screen.getByText('Waiting on you')).toBeTruthy();
  });
});

describe('Time', () => {
  const ms = Date.UTC(2026, 10, 17, 12, 5);

  it('renders a pinned locale and zone with a machine value and a long title', () => {
    const { container } = render(
      <TimeFormatContext.Provider value={{ locale: 'en-US', timeZone: 'UTC' }}>
        <Time ms={ms} />
      </TimeFormatContext.Provider>,
    );
    const element = container.querySelector('time');
    expect(element?.textContent).toBe('Nov 17, 2026, 12:05 PM');
    expect(element?.getAttribute('dateTime')).toBe('2026-11-17T12:05:00.000Z');
    expect(element?.getAttribute('title')).toContain('UTC');
  });

  it('says Not recorded for null', () => {
    render(<Time ms={null} />);
    expect(screen.getByText('Not recorded')).toBeTruthy();
  });
});

describe('ui primitives', () => {
  it('renders a typed button with its variant, and a labelled panel', () => {
    render(
      <Panel label="Things">
        <Button variant="primary">Go</Button>
      </Panel>,
    );
    expect(screen.getByRole('region', { name: 'Things' })).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('sa-button--primary');
  });

  it('renders the empty state with an action and the error state with retry', () => {
    const retry = vi.fn();
    render(
      <>
        <EmptyState title="Nothing" body="Body" action={<Button>Do</Button>} />
        <ErrorState title="Broken" body="Detail" onRetry={retry} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Do' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('Broken');
  });

  it('omits retry when no handler is given', () => {
    render(<ErrorState title="Broken" body="Detail" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
