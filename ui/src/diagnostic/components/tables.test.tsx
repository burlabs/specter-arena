// SPECTER-DIAGNOSTIC-ONLY
// Structure tests: these assert elements, text and ARIA attributes in jsdom. They are not rendered screenshots.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityMatrix } from './CapabilityMatrix';
import { HostFacts } from './HostFacts';
import { ProbeAttemptTimeline } from './ProbeAttemptTimeline';
import { makeAttempt, makeCell, makeEvidence, makeHostFact, makeProvenance } from './testData';

afterEach(cleanup);

describe('CapabilityMatrix', () => {
  const provenance = makeProvenance({ source: 'fixture' });

  it('exposes a named table with column headers, row headers and a focusable scroll region', () => {
    render(<CapabilityMatrix provenance={provenance} cells={[makeCell({ key: 'k1' }), makeCell({ key: 'k2' })]} />);
    expect(screen.getByRole('table', { name: /FIXTURE/ })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Question',
      'Scope',
      'State',
      'Credential',
      'Evidence',
    ]);
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('SOURCE: FIXTURE');
    const region = screen.getByRole('region', { name: 'Capability matrix table, scrollable' });
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('lists all five state counts including zeros', () => {
    render(<CapabilityMatrix provenance={provenance} cells={[makeCell({ state: 'DENIED' })]} />);
    const items = within(screen.getByRole('list', { name: 'Cells by state' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'ALLOWED: 0',
      'DENIED: 1',
      'UNSUPPORTED: 0',
      'UNTESTED: 0',
      'INVALID-EVIDENCE: 0',
    ]);
  });

  it('renders INVALID-EVIDENCE instead of ALLOWED when no APP-TOKEN evidence backs the cell', () => {
    const cell = makeCell({ key: 'bad', scope: 'bot', state: 'ALLOWED', evidence: [makeEvidence({ credential: 'OWNER-SESSION' })] });
    render(<CapabilityMatrix provenance={provenance} cells={[cell]} />);
    const row = screen.getAllByRole('row')[1];
    expect(row.querySelector('[data-state="INVALID-EVIDENCE"]')).not.toBeNull();
    expect(row.querySelector('[data-state="ALLOWED"]')).toBeNull();
    expect(row.textContent).toContain('Recorded as ALLOWED but no APP-TOKEN evidence.');
  });

  it('keeps ALLOWED with APP-TOKEN evidence and lists APP-TOKEN first', () => {
    const cell = makeCell({
      state: 'ALLOWED',
      evidence: [makeEvidence({ credential: 'OWNER-SESSION' }), makeEvidence({ credential: 'APP-TOKEN' })],
    });
    render(<CapabilityMatrix provenance={provenance} cells={[cell]} />);
    const row = screen.getAllByRole('row')[1];
    expect(row.querySelector('[data-state="ALLOWED"]')).not.toBeNull();
    const cells = row.querySelectorAll('td');
    const labels = Array.from(cells[2].querySelectorAll('[data-specter-diagnostic]')).map((node) => node.textContent);
    expect(labels).toEqual(['CREDENTIAL: APP-TOKEN', 'CREDENTIAL: OWNER-SESSION']);
  });

  it('shows none and a note for a cell without evidence', () => {
    render(<CapabilityMatrix provenance={provenance} cells={[makeCell({ state: 'DENIED' })]} />);
    const row = screen.getAllByRole('row')[1];
    expect(row.querySelectorAll('td')[2].textContent).toBe('none');
    expect(row.textContent).toContain('No evidence recorded');
  });

  it.each([
    ['app-owned', 'app-owned'],
    ['user-owned', 'user-owned'],
    ['other-app', 'other-app'],
    ['bot', 'bot'],
    ['external-cli', 'external CLI'],
  ] as const)('prints scope %s', (scope, text) => {
    render(<CapabilityMatrix provenance={provenance} cells={[makeCell({ scope })]} />);
    expect(screen.getAllByRole('row')[1].querySelectorAll('td')[0].textContent).toBe(text);
  });

  it('prints a note and no table for empty cells', () => {
    render(<CapabilityMatrix provenance={provenance} cells={[]} />);
    expect(screen.getByText('No capability cells in this snapshot.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('HostFacts', () => {
  it.each([
    ['live', 'LIVE'],
    ['recorded', 'RECORDED'],
    ['fixture', 'FIXTURE'],
  ] as const)('titles the section for source %s', (source, word) => {
    render(<HostFacts provenance={makeProvenance({ source })} facts={[makeHostFact()]} />);
    const section = screen.getByRole('region', { name: `Host facts (not permissions): SOURCE: ${word}` });
    expect(within(section).getByRole('heading', { level: 2 })).toBeTruthy();
    expect(section.textContent).toContain('not permission grants');
    expect(section.className).toContain('border-dashed');
  });

  it('renders each status as FACT: and never uses permission vocabulary', () => {
    const facts = [
      makeHostFact({ id: 'f1', status: 'OBSERVED', evidence: [makeEvidence({ credential: 'OWNER-SESSION' })] }),
      makeHostFact({ id: 'f2', status: 'NOT-OBSERVED' }),
      makeHostFact({ id: 'f3', status: 'UNTESTED', notes: 'needs a live run' }),
    ];
    render(<HostFacts provenance={makeProvenance()} facts={facts} />);
    const section = screen.getByRole('region', { name: /^Host facts \(not permissions\)/ });
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Fact', 'Status', 'Credential', 'Evidence']);
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
    for (const status of ['OBSERVED', 'NOT-OBSERVED', 'UNTESTED']) expect(section.textContent).toContain(`FACT: ${status}`);
    for (const word of ['ALLOWED', 'DENIED', 'UNSUPPORTED', 'INVALID-EVIDENCE']) expect(section.textContent).not.toContain(word);
    expect(section.textContent).toContain('CREDENTIAL: OWNER-SESSION');
    expect(section.textContent).toContain('needs a live run');
    expect(screen.getByRole('region', { name: 'Host facts table, scrollable' }).getAttribute('tabindex')).toBe('0');
  });

  it('lists APP-TOKEN first, shows none without evidence, and omits absent notes', () => {
    const facts = [
      makeHostFact({
        id: 'f1',
        status: 'OBSERVED',
        evidence: [makeEvidence({ credential: 'OWNER-SESSION' }), makeEvidence({ credential: 'APP-TOKEN' })],
      }),
      makeHostFact({ id: 'f2' }),
    ];
    render(<HostFacts provenance={makeProvenance()} facts={facts} />);
    const rows = screen.getAllByRole('row');
    const labels = Array.from(rows[1].querySelectorAll('td')[1].querySelectorAll('[data-specter-diagnostic]')).map((n) => n.textContent);
    expect(labels).toEqual(['CREDENTIAL: APP-TOKEN', 'CREDENTIAL: OWNER-SESSION']);
    expect(rows[2].querySelectorAll('td')[1].textContent).toBe('none');
    expect(rows[2].textContent).toContain('No evidence recorded');
    expect(rows[2].querySelector('th p')).toBeNull();
    expect(rows[1].querySelector('summary')?.textContent).toBe('Evidence (2)');
  });

  it('counts the three statuses and handles an empty list', () => {
    render(<HostFacts provenance={makeProvenance()} facts={[]} />);
    const items = within(screen.getByRole('list', { name: 'Host facts by status' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['OBSERVED: 0', 'NOT-OBSERVED: 0', 'UNTESTED: 0']);
    expect(screen.getByText('No host facts in this snapshot.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('ProbeAttemptTimeline', () => {
  const provenance = makeProvenance({ source: 'recorded' });

  it('follows the supplied order and labels the kind and source', () => {
    const attempts = [
      makeAttempt({ id: 'first', kind: 'bot-turn' }),
      makeAttempt({ id: 'second', kind: 'worker-session' }),
      makeAttempt({ id: 'third', kind: 'external-cli' }),
      makeAttempt({ id: 'fourth', kind: 'app-session' }),
    ];
    render(<ProbeAttemptTimeline provenance={provenance} attempts={attempts} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('SOURCE: RECORDED');
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'BOT TURN first',
      'WORKER SESSION second',
      'EXTERNAL CLI third',
      'APP SESSION fourth',
    ]);
    expect(screen.getByText('A turn or session ending is a signal, not an outcome.')).toBeTruthy();
  });

  it('prints bot reference, signals and outcome evidence', () => {
    const attempt = makeAttempt({
      botRef: 'h:abc',
      signals: [{ kind: 'turn-ended', at: '2026-01-01T00:00:05Z' }],
      outcomeEvidence: 'reply text',
    });
    const { container } = render(<ProbeAttemptTimeline provenance={provenance} attempts={[attempt]} />);
    expect(container.textContent).toContain('Bot reference: h:abc');
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-01-01T00:00:05Z');
    expect(container.textContent).toContain('turn-ended');
    expect(container.textContent).toContain('Outcome evidence: reply text');
    expect(container.textContent).not.toMatch(/accept|success|done/i);
  });

  it.each([null, '', '   '])('prints unknown for outcome evidence %j and notes absent data', (outcomeEvidence) => {
    const { container } = render(<ProbeAttemptTimeline provenance={provenance} attempts={[makeAttempt({ outcomeEvidence })]} />);
    expect(container.textContent).toContain('Outcome evidence: unknown');
    expect(container.textContent).toContain('Bot reference: none');
    expect(container.textContent).toContain('No signals recorded');
  });

  it('prints a note for an empty list', () => {
    render(<ProbeAttemptTimeline provenance={provenance} attempts={[]} />);
    expect(screen.getByText('No attempts recorded in this snapshot.')).toBeTruthy();
  });
});
