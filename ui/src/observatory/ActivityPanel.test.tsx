import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { attemptsBody, rosterBody } from '@kirocrew/app-sdk';
import type { ScenarioName } from '@kirocrew/app-sdk';
import { ActivityPanel } from './ActivityPanel';
import { TimeFormatContext } from './Time';

const activityOf = (scenario: ScenarioName) => {
  const [bot] = rosterBody(scenario).items;
  const body = attemptsBody(scenario, bot?.bindingId ?? '');
  if (body === null) throw new Error('fixture');
  return body.activity;
};

const view = (scenario: ScenarioName) =>
  render(
    <TimeFormatContext.Provider value={{ locale: 'en-US', timeZone: 'UTC' }}>
      <ActivityPanel activity={activityOf(scenario)} />
    </TimeFormatContext.Provider>,
  );

describe('ActivityPanel', () => {
  it('shows both windows with the coverage sentence and the sample size', () => {
    view('two-concurrent');
    const day = screen.getByRole('region', { name: 'Last 24 hours' });
    expect(day.textContent).toContain('Collector covered 1 h 43 m of the 1 h 53 m since this bot was first seen (1 gap)');
    expect(day.textContent).toContain('From Nov 16, 2026, 12:00 PM to Nov 17, 2026, 12:00 PM');
    expect(day.querySelector('dd')?.textContent).toBe('3');
    expect(screen.getByRole('region', { name: 'Last 7 days' })).toBeTruthy();
  });

  it.each<ScenarioName>(['default', 'two-concurrent', 'all-reasons', 'paused', 'reconnecting'])(
    'shows counts that add up to the sample size in %s',
    (scenario) => {
      const { container, unmount } = view(scenario);
      for (const card of container.querySelectorAll('.sa-card')) {
        const values = [...card.querySelectorAll('dd')].map((cell) => Number(cell.textContent));
        if (values.length === 0) continue;
        const [sample, turns, workers, working, ended, unknown] = values;
        expect(turns! + workers!).toBe(sample);
        expect(working! + ended! + unknown!).toBe(sample);
      }
      unmount();
    },
  );

  it('says Not collected and shows no counts when nothing was collected or sampled', () => {
    view('not-collected');
    expect(screen.getAllByText('Not collected')).toHaveLength(2);
    expect(screen.getAllByText('No collected time in this window, so there are no counts.')).toHaveLength(2);
    for (const region of screen.getAllByRole('region')) expect(region.textContent).not.toContain('Sample size');
  });

  it('explains the denominators in a glossary and invents no rate', () => {
    view('two-concurrent');
    expect(screen.getByText('How these counts work')).toBeTruthy();
    const glossary = screen.getByText('How these counts work').closest('details') as HTMLElement;
    expect(glossary.textContent).toContain('Every count below is out of this number');
    expect(document.body.textContent ?? '').not.toMatch(/%|per hour|average|rate|rank/i);
  });
});
