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
  StructureAbyssalCitadelSvg,
  StructureJungleCampSvg,
  StructureSanctumSvg,
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
  StructureSanctumSvg,
  StructureAbyssalCitadelSvg,
  StructureJungleCampSvg,
];

describe('scene SVGs', () => {
  it('has twelve drawings', () => {
    expect(ALL).toHaveLength(12);
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

describe('structure drawings', () => {
  it.each([
    [StructureSanctumSvg, '0 0 160 160'],
    [StructureAbyssalCitadelSvg, '0 0 160 160'],
    [StructureJungleCampSvg, '0 0 100 100'],
  ] as const)('draws inside the export view box %#', (Svg, viewBox) => {
    const { container } = render(<Svg title="" decorative />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(viewBox);
  });

  it('keeps each structure gradient reachable by its own unique id', () => {
    const { container } = render(
      <>
        <StructureSanctumSvg title="" decorative />
        <StructureSanctumSvg title="" decorative />
        <StructureAbyssalCitadelSvg title="" decorative />
        <StructureJungleCampSvg title="" decorative />
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient, radialGradient')].map((node) => node.id);
    expect(ids).toHaveLength(2 + 2 + 2 + 1);
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of container.querySelectorAll('svg')) {
      for (const fill of svg.querySelectorAll('[fill^="url(#"]')) {
        const target = /url\(#(.+)\)/.exec(fill.getAttribute('fill') ?? '')?.[1] ?? '';
        expect(svg.querySelector(`[id="${target}"]`), target).not.toBeNull();
      }
    }
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
