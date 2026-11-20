import { describe, expect, it } from 'vitest';
import { HERO_IDS } from '../contracts/types';
import type { HeroesItemV1, RosterItemV1, SpecterV2, XpSummaryV1 } from '../contracts/types';
import { botOf } from '../arena/testData';
import { summaryOf } from '../work/testData';
import { DEFAULT_VIEW, buildCollection } from './collection';
import type { Card, CollectionInput, ViewState } from './collection';
import { heroOf } from './testData';

const NAMES = ['Vell', 'Stitch', 'Reeve', 'Rattle', 'Ember', 'Shard', 'Poly', 'Tide', 'Lume', 'Moss', 'bur'];
const heroList = (counts: Readonly<Record<string, number>> = {}): HeroesItemV1[] =>
  HERO_IDS.map((heroId, index) => ({ heroId, name: NAMES[index] ?? heroId, epithet: `Epithet of ${NAMES[index]}`, personality: 'p', assigned: (counts[heroId] ?? 0) > 0, assignedCount: counts[heroId] ?? 0 }));

const bot = (n: number, name: string): RosterItemV1 => botOf(n, { displayName: name });
const specterFor = (item: RosterItemV1, heroIndex: number, extra: Partial<SpecterV2> = {}): SpecterV2 =>
  heroOf({ bindingId: item.bindingId, heroId: HERO_IDS[heroIndex % 11] ?? 'vell', name: NAMES[heroIndex % 11] ?? 'Vell', displayName: NAMES[heroIndex % 11] ?? 'Vell', epithet: `Epithet of ${NAMES[heroIndex % 11]}`, ordinal: Math.floor(heroIndex / 11) + 1, ...extra });
const xpFor = (item: RosterItemV1, level: number, totalXp: number): XpSummaryV1 => summaryOf({ bindingId: item.bindingId, level, totalXp });

const atlas = bot(1, 'Atlas');
const brindle = bot(2, 'Brindle');
const cinder = bot(3, 'Cinder');
const bots = [atlas, brindle, cinder];
const specters = new Map([atlas, brindle, cinder].map((item, index) => [item.bindingId, specterFor(item, index, item === brindle ? { avatarChosen: true } : {})]));

const input = (extra: Partial<CollectionInput> = {}): CollectionInput => ({
  bots,
  specters,
  heroes: heroList({ vell: 1, stitch: 1, reeve: 1 }),
  xp: new Map(),
  xpReady: true,
  ...extra,
});
const view = (extra: Partial<ViewState> = {}): ViewState => ({ ...DEFAULT_VIEW, ...extra });
const labels = (cards: readonly Card[]): string[] => cards.map((card) => (card.kind === 'hero' ? `hero:${card.hero.name}` : card.bot.displayName ?? '?'));

describe('buildCollection', () => {
  it('shows bot cards and unassigned hero cards in roster order by default', () => {
    const result = buildCollection(input(), view());
    expect(labels(result.cards)).toEqual(['Atlas', 'Brindle', 'Cinder', 'hero:Rattle', 'hero:Ember', 'hero:Shard', 'hero:Poly', 'hero:Tide', 'hero:Lume', 'hero:Moss', 'hero:bur']);
    expect(result.total).toBe(11);
    expect(result.unassignedTotal).toBe(8);
    expect(result.sortHeld).toBe(false);
  });

  it('puts an unassigned hero at its roster index between bot cards', () => {
    const second = bot(4, 'Dune');
    const gap = new Map(specters).set(second.bindingId, specterFor(second, 4));
    const result = buildCollection(input({ bots: [...bots, second], specters: gap, heroes: heroList({ vell: 1, stitch: 1, reeve: 1, ember: 1 }) }), view());
    expect(labels(result.cards).slice(0, 5)).toEqual(['Atlas', 'Brindle', 'Cinder', 'hero:Rattle', 'Dune']);
  });

  it('orders a second lap after the first lap of the same hero, and bots without a Specter last', () => {
    const lapTwo = bot(5, 'Echo');
    const orphan = bot(6, 'Aardvark');
    const map = new Map(specters).set(lapTwo.bindingId, specterFor(lapTwo, 11, { displayName: 'Vell II' }));
    const result = buildCollection(input({ bots: [orphan, lapTwo, ...bots], specters: map, heroes: null }), view());
    expect(labels(result.cards)).toEqual(['Atlas', 'Echo', 'Brindle', 'Cinder', 'Aardvark']);
  });

  it.each([
    ['hero name', 'vell', ['Atlas']],
    ['epithet', 'epithet of stitch', ['Brindle']],
    ['bot name', 'CINDER', ['Cinder']],
    ['a padded query', '  rattle  ', ['hero:Rattle']],
    ['an unassigned hero epithet', 'of tide', ['hero:Tide']],
    ['nothing', 'zzz', []],
  ])('searches by %s', (_name, query, expected) => {
    expect(labels(buildCollection(input(), view({ query })).cards)).toEqual(expected);
  });

  it('does not search the bot name on a hero card or the hero personality', () => {
    expect(buildCollection(input(), view({ query: 'atlas' })).cards).toHaveLength(1);
    expect(buildCollection(input(), view({ query: 'personality' })).cards).toHaveLength(0);
  });

  it.each([
    ['assigned', ['Atlas', 'Brindle', 'Cinder']],
    ['unassigned', ['hero:Rattle', 'hero:Ember', 'hero:Shard', 'hero:Poly', 'hero:Tide', 'hero:Lume', 'hero:Moss', 'hero:bur']],
    ['avatar', ['Brindle']],
  ] as const)('filters %s', (filter, expected) => {
    expect(labels(buildCollection(input(), view({ filter })).cards)).toEqual(expected);
  });

  it('treats a hero as assigned when a listed Specter carries it even if the count is 0', () => {
    const result = buildCollection(input({ heroes: heroList() }), view({ filter: 'unassigned' }));
    expect(labels(result.cards)).not.toContain('hero:Vell');
    expect(result.unassignedTotal).toBe(8);
  });

  it('lists no hero cards while the hero list is missing, and keeps every bot', () => {
    const result = buildCollection(input({ heroes: null }), view());
    expect(labels(result.cards)).toEqual(['Atlas', 'Brindle', 'Cinder']);
    expect(result.total).toBe(3);
  });

  it('says every hero has a bot when the 11 are all counted', () => {
    const all = Object.fromEntries(HERO_IDS.map((id) => [id, 1]));
    const result = buildCollection(input({ heroes: heroList(all) }), view({ filter: 'unassigned' }));
    expect(result.cards).toEqual([]);
    expect(result.unassignedTotal).toBe(0);
  });

  it('sorts by hero display name A to Z, ties by bot name, hero cards in the same order', () => {
    const twin = bot(7, 'Aaron');
    const map = new Map(specters).set(twin.bindingId, specterFor(twin, 1));
    const assigned = buildCollection(input({ bots: [...bots, twin], specters: map }), view({ sort: 'name', filter: 'assigned' }));
    expect(labels(assigned.cards)).toEqual(['Cinder', 'Aaron', 'Brindle', 'Atlas']);
    const all = buildCollection(input(), view({ sort: 'name' }));
    expect(labels(all.cards)).toEqual(['hero:bur', 'hero:Ember', 'hero:Lume', 'hero:Moss', 'hero:Poly', 'hero:Rattle', 'Cinder', 'hero:Shard', 'Brindle', 'hero:Tide', 'Atlas']);
  });

  it('sorts by level then XP, high to low, with ties in roster order and hero cards last', () => {
    const xp = new Map([xpFor(atlas, 2, 100), xpFor(brindle, 3, 300), xpFor(cinder, 2, 100)].map((summary) => [summary.bindingId, summary]));
    expect(labels(buildCollection(input({ xp }), view({ sort: 'level', filter: 'assigned' })).cards)).toEqual(['Brindle', 'Atlas', 'Cinder']);
    const byXp = buildCollection(input({ xp }), view({ sort: 'xp' }));
    expect(labels(byXp.cards).slice(0, 4)).toEqual(['Brindle', 'Atlas', 'Cinder', 'hero:Rattle']);
    expect(byXp.sortHeld).toBe(false);
  });

  it('ranks a bot with no XP entry as level 1 and 0 XP once XP is loaded', () => {
    const xp = new Map([[atlas.bindingId, xpFor(atlas, 1, 0)]]);
    const result = buildCollection(input({ xp: new Map([...xp, [cinder.bindingId, xpFor(cinder, 2, 5)]]) }), view({ sort: 'xp', filter: 'assigned' }));
    expect(labels(result.cards)).toEqual(['Cinder', 'Atlas', 'Brindle']);
  });

  it('keeps roster order and says so while XP is loading or failed, for Level and XP only', () => {
    const xp = new Map([[brindle.bindingId, xpFor(brindle, 9, 9000)]]);
    for (const sort of ['level', 'xp'] as const) {
      const held = buildCollection(input({ xp, xpReady: false }), view({ sort, filter: 'assigned' }));
      expect(labels(held.cards)).toEqual(['Atlas', 'Brindle', 'Cinder']);
      expect(held.sortHeld).toBe(true);
    }
    expect(buildCollection(input({ xpReady: false }), view({ sort: 'name' })).sortHeld).toBe(false);
  });

  it('is pure: it does not reorder or change its inputs', () => {
    const before = JSON.stringify(bots);
    buildCollection(input(), view({ sort: 'name', query: 'a' }));
    expect(JSON.stringify(bots)).toBe(before);
    expect(buildCollection(input(), view()).cards).toEqual(buildCollection(input(), view()).cards);
  });

  it('never gives a hero card a role: it only carries the roster fields', () => {
    const card = buildCollection(input(), view({ filter: 'unassigned' })).cards[0];
    expect(card?.kind).toBe('hero');
    expect(Object.keys(card ?? {}).sort()).toEqual(['hero', 'key', 'kind']);
  });
});
