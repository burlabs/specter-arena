// SPECTER-DIAGNOSTIC-ONLY
// Structure tests: these assert elements, text and ARIA attributes in jsdom. They are not rendered screenshots.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticPage } from './DiagnosticPage';
import { makeAttempt, makeCell, makeEvidence, makeHostFact, makeProvenance, makeSnapshot } from './testData';

afterEach(cleanup);

const populated = (source: 'live' | 'recorded' | 'fixture' = 'fixture', runId = 'run-1') =>
  makeSnapshot({
    provenance: makeProvenance({ source, runId }),
    cells: [makeCell({ key: 'cell.a', question: 'Cell A?' }), makeCell({ key: 'cell.b', question: 'Cell B?' })],
    hostFacts: [makeHostFact({ id: 'fact.a', question: 'Fact A?', status: 'OBSERVED', evidence: [makeEvidence({ credential: 'OWNER-SESSION' })] })],
    attempts: [makeAttempt()],
  });

describe('DiagnosticPage', () => {
  it('has exactly one h1 and the expected section order', () => {
    render(<DiagnosticPage snapshot={populated()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Diagnostic');
    const order = screen.getAllByRole('heading').map((heading) => `${heading.tagName}:${heading.textContent?.split(':')[0]}`);
    expect(order).toEqual(['H1:Diagnostic', 'H2:Capability matrix', 'H2:Host facts (not permissions)', 'H2:Probe attempts', 'H3:BOT TURN fixture-attempt']);
  });

  it('shows a note and no tables when there is no snapshot', () => {
    render(<DiagnosticPage snapshot={null} />);
    expect(screen.getByText('No snapshot loaded.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status', { name: 'Data provenance' }).textContent).toContain('SOURCE: NONE');
  });

  it('shows a load error as an alert', () => {
    render(<DiagnosticPage snapshot={null} loadError="probe routes not enabled" />);
    expect(screen.getByRole('alert').textContent).toContain('probe routes not enabled');
  });

  it('keeps matrix rows and host facts in separate tables', () => {
    render(<DiagnosticPage snapshot={populated()} />);
    const [matrix, facts] = screen.getAllByRole('table');
    expect(matrix.textContent).toContain('Cell A?');
    expect(matrix.textContent).not.toContain('Fact A?');
    expect(facts.textContent).toContain('Fact A?');
    expect(facts.textContent).not.toContain('Cell A?');
  });

  it('shows one source word per rendered instance', () => {
    const live = render(<DiagnosticPage snapshot={populated('live')} />);
    expect(live.container.textContent).toContain('SOURCE: LIVE');
    expect(live.container.textContent).not.toMatch(/SOURCE: (FIXTURE|RECORDED)/);
    cleanup();
    const fixture = render(<DiagnosticPage snapshot={populated('fixture')} />);
    expect(fixture.container.textContent).toContain('SOURCE: FIXTURE');
    expect(fixture.container.textContent).not.toMatch(/SOURCE: (LIVE|RECORDED)/);
  });

  it('keeps the legend closed and covers the three axes', () => {
    const { container } = render(<DiagnosticPage snapshot={null} />);
    const legend = container.querySelector('details');
    expect(legend?.hasAttribute('open')).toBe(false);
    expect(within(legend as HTMLElement).getAllByRole('term').map((term) => term.textContent)).toEqual(['State', 'Credential', 'Source']);
  });

  it('starts with an empty polite update region and announces later changes', () => {
    const view = render(<DiagnosticPage snapshot={populated()} />);
    const region = screen.getByRole('status', { name: 'Snapshot updates' });
    expect(region.textContent).toBe('');

    const changed = populated();
    changed.cells = [makeCell({ key: 'cell.a', question: 'Cell A?', state: 'DENIED' }), makeCell({ key: 'cell.b', question: 'Cell B?', state: 'DENIED' })];
    view.rerender(<DiagnosticPage snapshot={changed} />);
    expect(screen.getByRole('status', { name: 'Snapshot updates' }).textContent).toBe('2 capability cells changed state');

    const withFacts = { ...changed, hostFacts: [makeHostFact({ id: 'fact.a', question: 'Fact A?', status: 'NOT-OBSERVED' })] };
    view.rerender(<DiagnosticPage snapshot={withFacts} />);
    expect(screen.getByRole('status', { name: 'Snapshot updates' }).textContent).toBe('1 host fact changed status');

    view.rerender(<DiagnosticPage snapshot={populated('fixture', 'run-2')} />);
    expect(screen.getByRole('status', { name: 'Snapshot updates' }).textContent).toBe('Snapshot replaced by run run-2');
  });
});
