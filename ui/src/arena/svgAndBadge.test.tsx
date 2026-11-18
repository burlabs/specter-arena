import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModeBadge } from './ModeBadge';
import {
  EnemyObjectiveSvg,
  EnemyTaskSvg,
  MarkerAssistanceSvg,
  MarkerBlockedSvg,
  MarkerCoverageUnknownSvg,
  MarkerEvidenceSvg,
  MarkerOutcomeAcceptedSvg,
  MilestoneClearedSvg,
  MilestoneStandingSvg,
} from './SceneSvgs';

const ALL = [
  MarkerBlockedSvg,
  MarkerEvidenceSvg,
  MarkerCoverageUnknownSvg,
  MarkerOutcomeAcceptedSvg,
  MarkerAssistanceSvg,
  MilestoneStandingSvg,
  MilestoneClearedSvg,
  EnemyTaskSvg,
  EnemyObjectiveSvg,
];

describe('scene SVGs', () => {
  it('has nine drawings', () => {
    expect(ALL).toHaveLength(9);
  });

  it.each(ALL.map((Svg, index) => [index, Svg] as const))('drawing %i takes its name from the caller', (_index, Svg) => {
    render(<Svg title="Name from props" />);
    expect(screen.getByRole('img', { name: 'Name from props' })).toBeTruthy();
  });

  it.each(ALL.map((Svg, index) => [index, Svg] as const))('drawing %i can be decorative', (_index, Svg) => {
    const { container } = render(<Svg title="" decorative className="x" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.querySelector('title')).toBeNull();
  });

  it('gives gradients unique ids per instance so two copies do not share a fill', () => {
    const { container } = render(
      <>
        <MilestoneStandingSvg title="a" />
        <MilestoneStandingSvg title="b" />
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((node) => node.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('ModeBadge', () => {
  it.each([
    ['FIXTURE', 'FIXTURE — demo data, not Crew activity'],
    ['LIVE', 'LIVE'],
    ['RECORDED', 'RECORDED — not live'],
  ] as const)('says %s in words', (mode, text) => {
    render(<ModeBadge mode={mode} />);
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(screen.getByRole('status').getAttribute('data-mode')).toBe(mode);
  });
});
