import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { summaryOf } from './testData';
import { XpCards } from './XpCards';
import type { XpView } from './useXp';

const text = (view: XpView) => {
  const { container } = render(<XpCards xp={view} />);
  return container.textContent ?? '';
};

describe('XpCards (XP-1..XP-5)', () => {
  it('says not loaded yet while loading', () => {
    expect(text({ status: 'loading' })).toBe('Tasks creditedNot loaded yetXPNot loaded yetLevelNot loaded yet');
  });

  it('never shows a digit when XP is unsupported or failed', () => {
    const unsupported = text({ status: 'failed', failure: 'unsupported' });
    expect(unsupported).toContain('Not supported by this backend');
    expect(unsupported).not.toMatch(/\d/);
    document.body.innerHTML = '';
    const failed = text({ status: 'failed', failure: 'unavailable' });
    expect(failed).toContain('Could not load. It retries automatically.');
    expect(failed).not.toMatch(/\d/);
  });

  it('shows 0, 0 XP and Level 1 for a bot with no entry, and no next-level figure', () => {
    const result = text({ status: 'ready', summary: null });
    expect(result).toContain('Tasks credited0');
    expect(result).toContain('0 XP');
    expect(result).toContain('Level 1');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the credited-task count, total, level, meter and the level note for a summary', () => {
    const result = text({ status: 'ready', summary: summaryOf() });
    expect(result).toContain('Tasks credited3');
    expect(result).toContain('150 XP');
    expect(result).toContain('Level 2');
    expect(result).toContain('Level follows XP credited automatically for tasks, plus earlier accepted work. It reflects observed activity, not ability, outcome quality or current condition.');
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('never uses a success, health or idle word', () => {
    expect(text({ status: 'ready', summary: summaryOf() })).not.toMatch(/success|health|idle|available/i);
  });
});
