// SPECTER-DIAGNOSTIC-ONLY
// Structure tests: these assert elements, text and ARIA attributes in jsdom. They are not rendered screenshots.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DIAGNOSTIC_MARKER } from '../model';
import { CapabilityStateBadge } from './CapabilityStateBadge';
import { CredentialLabel } from './CredentialLabel';
import { EvidenceDetail } from './EvidenceDetail';
import { ProvenanceBanner } from './ProvenanceBanner';
import { makeEvidence, makeProvenance } from './testData';

afterEach(cleanup);

describe('CapabilityStateBadge', () => {
  it.each(['ALLOWED', 'DENIED', 'UNSUPPORTED', 'UNTESTED'] as const)('renders the word %s', (state) => {
    const { container } = render(<CapabilityStateBadge state={state} />);
    expect(container.textContent).toBe(state);
    expect(container.querySelector(`[data-state="${state}"]`)).not.toBeNull();
    expect(container.querySelector('[aria-hidden]')).toBeNull();
  });

  it('marks INVALID-EVIDENCE with a decorative glyph', () => {
    const { container } = render(<CapabilityStateBadge state="INVALID-EVIDENCE" />);
    const glyph = container.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(container.textContent).toContain('INVALID-EVIDENCE');
    expect(container.querySelector(`[data-specter-diagnostic="${DIAGNOSTIC_MARKER}"]`)).not.toBeNull();
  });
});

describe('CredentialLabel', () => {
  it.each(['APP-TOKEN', 'OWNER-SESSION'] as const)('renders CREDENTIAL: %s', (credential) => {
    const { container } = render(<CredentialLabel credential={credential} />);
    expect(container.textContent).toBe(`CREDENTIAL: ${credential}`);
    expect(container.firstElementChild?.getAttribute('role')).toBeNull();
    expect(container.querySelector(`[data-specter-diagnostic="${DIAGNOSTIC_MARKER}"]`)).not.toBeNull();
  });
});

describe('ProvenanceBanner', () => {
  it.each([
    ['live', 'LIVE'],
    ['recorded', 'RECORDED'],
    ['fixture', 'FIXTURE'],
  ] as const)('states source %s as %s', (source, word) => {
    render(<ProvenanceBanner provenance={makeProvenance({ source, runId: 'run-x', hostVersion: '9.9.9', sanitisation: 'scrubbed' })} />);
    const banner = screen.getByRole('status', { name: 'Data provenance' });
    expect(banner.textContent).toContain('DIAGNOSTIC');
    expect(banner.textContent).toContain(DIAGNOSTIC_MARKER);
    expect(banner.textContent).toContain(`SOURCE: ${word}`);
    expect(banner.textContent).toContain('9.9.9');
    expect(banner.textContent).toContain('run-x');
    expect(banner.textContent).toContain('Sanitisation: scrubbed');
    expect(banner.querySelector('time')?.getAttribute('datetime')).toBe('2026-01-01T00:00:00Z');
    expect(banner.className.includes('border-dashed')).toBe(source !== 'live');
  });

  it('prints SOURCE: NONE without a snapshot', () => {
    render(<ProvenanceBanner provenance={null} />);
    const banner = screen.getByRole('status', { name: 'Data provenance' });
    expect(banner.textContent).toContain('SOURCE: NONE');
    expect(banner.className).toContain('border-dashed');
  });
});

describe('EvidenceDetail', () => {
  it('prints a note and no details element for an empty list', () => {
    const { container } = render(<EvidenceDetail evidence={[]} />);
    expect(container.textContent).toBe('No evidence recorded');
    expect(container.querySelector('details')).toBeNull();
  });

  it('lists each item with its credential, reference and optional status', () => {
    const { container } = render(
      <EvidenceDetail
        evidence={[
          makeEvidence({ credential: 'OWNER-SESSION', ref: 'a.json', status: 403 }),
          makeEvidence({ credential: 'APP-TOKEN', ref: 'b.json', status: 0 }),
          makeEvidence({ credential: 'APP-TOKEN', ref: 'c.json' }),
        ]}
      />,
    );
    expect(container.querySelector('summary')?.textContent).toBe('Evidence (3)');
    expect(container.textContent).toContain('CREDENTIAL: OWNER-SESSION');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('code')?.textContent).toBe('a.json');
    expect(container.textContent).toContain('Status: 403');
    expect(container.textContent).toContain('Status: 0');
    expect(container.textContent?.match(/Status:/g)).toHaveLength(2);
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders captured text as literal text', () => {
    const excerpt = '<img src=x onerror=alert(1)> **bold**';
    const { container } = render(<EvidenceDetail evidence={[makeEvidence({ excerpt })]} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(excerpt);
  });

  it('cuts a long excerpt and says so', () => {
    const { container } = render(<EvidenceDetail evidence={[makeEvidence({ excerpt: 'z'.repeat(2001) })]} />);
    expect(container.querySelector('pre')?.textContent).toHaveLength(2000);
    expect(within(container).getByText('Truncated: showing first 2000 of 2001 characters')).toBeTruthy();
  });
});
