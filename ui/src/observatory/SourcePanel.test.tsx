import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { attemptsBody, rosterBody } from '@kirocrew/app-sdk';
import { SourcePanel } from './SourcePanel';
import { TimeFormatContext } from './Time';

const [atlas] = rosterBody('default').items;
if (atlas === undefined) throw new Error('fixture');
const collector = { state: 'running', reasonCode: null, sinceMs: 1_794_910_000_000 };

const view = (item: object, attempts = attemptsBody('default', atlas.bindingId)) =>
  render(
    <TimeFormatContext.Provider value={{ locale: 'en-US', timeZone: 'UTC' }}>
      <SourcePanel item={item as typeof atlas} collector={collector} rosterRevision={4} attempts={attempts} />
    </TimeFormatContext.Provider>,
  );

describe('SourcePanel', () => {
  it('never renders a key outside the allowlist', () => {
    view({ ...atlas, prompt: 'SECRET-PROMPT', slotKey: 'SLOT-1', memory_store: 'STORE-1', tokens: 4242 });
    const text = document.body.textContent ?? '';
    for (const leak of ['SECRET-PROMPT', 'SLOT-1', 'STORE-1', '4242', 'prompt', 'slotKey', 'memory_store', 'tokens']) expect(text).not.toContain(leak);
  });

  it('labels the raw signals as unverified and prints Yes, No and Not seen', () => {
    view({ ...atlas, condition: { ...atlas.condition, signals: { needsInput: true, hasOptions: false, pendingApproval: null, waitingForInput: false } } });
    expect(screen.getByRole('heading', { name: 'Raw signals from Crew (unverified, not used for the condition)' })).toBeTruthy();
    const section = screen.getByRole('heading', { name: /Raw signals/ }).parentElement as HTMLElement;
    expect(section.textContent).toContain('Needs inputYes');
    expect(section.textContent).toContain('Has optionsNo');
    expect(section.textContent).toContain('Pending approvalNot seen');
  });

  it('shows absolute times with a zone and the window bounds when attempts are loaded', () => {
    view(atlas);
    expect(screen.getByText('Last observed').nextElementSibling?.textContent).toBe('Nov 17, 2026, 11:59:01 AM UTC');
    expect(screen.getByText('24 h window from')).toBeTruthy();
    expect(screen.getByText('Roster revision').nextElementSibling?.textContent).toBe('4');
  });

  it('omits the window rows before attempts load, and prints None for an absent value', () => {
    view(atlas, null);
    expect(screen.queryByText('24 h window from')).toBeNull();
    expect(screen.getByText('Coverage reason code').nextElementSibling?.textContent).toBe('None');
  });
});
