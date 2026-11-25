import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { attemptsBody, rosterBody } from '@kirocrew/app-sdk';
import { AttemptsList, AttemptsStatus } from './AttemptsList';
import { TimeFormatContext } from './Time';

const [atlas] = rosterBody('two-concurrent').items;
const items = attemptsBody('two-concurrent', atlas?.bindingId ?? '')?.items ?? [];
const base = { items, hasOlder: false, loadingOlder: false, olderFailed: false, onLoadOlder: vi.fn() };

const view = (props: Partial<Parameters<typeof AttemptsList>[0]> = {}) =>
  render(
    <TimeFormatContext.Provider value={{ locale: 'en-US', timeZone: 'UTC' }}>
      <AttemptsList {...base} {...props} />
    </TimeFormatContext.Provider>,
  );

describe('AttemptsList', () => {
  it('lists both concurrent attempts, each with its own condition and reason', () => {
    view();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Worker');
    expect(rows[0]?.textContent).toContain('Working');
    expect(rows[0]?.textContent).toContain('Crew reports this worker running');
    expect(rows[1]?.textContent).toContain('Unknown');
    expect(rows[1]?.textContent).toContain("This bot's chat has not appeared in updates");
    expect(rows[2]?.textContent).toContain('Bot turn');
    expect(rows[2]?.textContent).toContain('Ended');
    expect(rows[2]?.textContent).toContain('Signal: Row stopped running');
  });

  it('says Still open for an open attempt and shows first seen in the pinned zone', () => {
    view();
    const first = screen.getAllByRole('listitem')[0];
    expect(first?.textContent).toContain('First seen Nov 17, 2026, 11:55 AM');
    expect(first?.textContent).toContain('Still open.');
    expect(first?.textContent).toContain('Signal: Still open');
  });

  it('never calls an ended attempt idle, done, finished or succeeded', () => {
    view();
    expect(document.body.textContent ?? '').not.toMatch(/\b(idle|done|finished|succeeded)\b/i);
  });

  it('explains an empty list without claiming zero work', () => {
    view({ items: [] });
    expect(screen.getByText(/not a count of zero work/)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('offers Load older, disables it while loading, and shows a retry notice after a failure', () => {
    const onLoadOlder = vi.fn();
    const { rerender } = view({ hasOlder: true, onLoadOlder });
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    rerender(<AttemptsList {...base} hasOlder loadingOlder olderFailed onLoadOlder={onLoadOlder} />);
    expect((screen.getByRole('button', { name: 'Load older' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Could not load older attempts. Retry.');
  });
});

describe('AttemptsStatus', () => {
  it('shows loading, gone and a retryable failure', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AttemptsStatus state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toBe('Loading attempts…');
    rerender(<AttemptsStatus state={{ status: 'gone' }} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toBe('This bot is no longer on the roster.');
    rerender(<AttemptsStatus state={{ status: 'failed', failure: 'offline' }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
