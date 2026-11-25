import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BotsOnField } from './BotsOnField';
import { botOf, specterOf } from './testData';

const atlas = botOf(1, { displayName: 'Atlas', state: 'working' });
const brindle = botOf(2, { displayName: 'Brindle' });
const dune = botOf(3, { displayName: 'Dune', state: 'unknown' });
const bots = [atlas, brindle, dune];
const specters = new Map([
  [atlas.bindingId, specterOf(atlas, 'Vell')],
  [brindle.bindingId, specterOf(brindle, 'Stitch')],
]);

const POSITION_WORDS = /\b(top|mid|middle|bottom|jungle|support|lane|lanes|role|roles|position|positions)\b/i;

describe('BotsOnField', () => {
  it('is collapsed by default and opens from its summary', () => {
    const { container } = render(<BotsOnField bots={bots} specters={specters} />);
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(within(screen.getByRole('region', { name: 'Bots on the field' })).getByText('Bots on the field', { selector: 'summary' })).toBeTruthy();
    fireEvent.click(screen.getByText('Bots on the field', { selector: 'summary' }));
    expect(details?.hasAttribute('open') || details?.open).toBeTruthy();
  });

  it('lists every bot by its bot name, the hero name on a second line, and condition, and a bot without a hero by its own name', () => {
    render(<BotsOnField bots={bots} specters={specters} />);
    const items = screen.getAllByRole('listitem', { hidden: true });
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('Atlas');
    expect(items[0]?.textContent).toContain('Specter: Vell');
    expect(items[0]?.textContent).toContain('Working');
    expect(items[1]?.textContent).toContain('Brindle');
    expect(items[1]?.textContent).toContain('Specter: Stitch');
    expect(items[1]?.textContent).toContain('No turn running');
    expect(items[2]?.textContent).toContain('Dune');
    expect(items[2]?.textContent).toContain('Unknown');
    expect(items[2]?.textContent).not.toContain('Specter:');
  });

  it('has no select, no input and no position word', () => {
    const { container } = render(<BotsOnField bots={bots} specters={specters} />);
    expect(container.querySelectorAll('select, input, textarea, button')).toHaveLength(0);
    expect(container.textContent).not.toMatch(POSITION_WORDS);
  });

  it('says so when there are no bots', () => {
    render(<BotsOnField bots={[]} specters={new Map()} />);
    expect(screen.getByText('No bots are on the field.')).toBeTruthy();
  });
});
