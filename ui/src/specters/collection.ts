import { HERO_IDS } from '../contracts/types';
import type { HeroesItemV1, RosterItemV1, SpecterV2, XpSummaryV1 } from '../contracts/types';
import { nameOf } from '../observatory/model';

export const FILTERS = ['all', 'assigned', 'unassigned', 'avatar'] as const;
export const SORTS = ['roster', 'name', 'level', 'xp'] as const;
export type Filter = (typeof FILTERS)[number];
export type Sort = (typeof SORTS)[number];

/** View state only: nothing here is sent to the backend. */
export interface ViewState {
  query: string;
  filter: Filter;
  sort: Sort;
}

export const DEFAULT_VIEW: ViewState = { query: '', filter: 'all', sort: 'roster' };

export type Card = { kind: 'bot'; key: string; bot: RosterItemV1; specter: SpecterV2 | undefined } | { kind: 'hero'; key: string; hero: HeroesItemV1 };

export interface CollectionInput {
  bots: readonly RosterItemV1[];
  specters: ReadonlyMap<string, SpecterV2>;
  /** `null` while the hero list is loading or failed: no hero cards are built. */
  heroes: readonly HeroesItemV1[] | null;
  xp: ReadonlyMap<string, XpSummaryV1>;
  /** False while the XP ledger is loading or failed. */
  xpReady: boolean;
}

export interface Collection {
  cards: readonly Card[];
  /** Every bot card plus every unassigned hero card, before search and filter. */
  total: number;
  /** Level or XP was asked for but XP is not loaded, so the cards are in roster order. */
  sortHeld: boolean;
  /** Hero cards that exist before search and filter; 0 with a loaded hero list means every hero has a bot. */
  unassignedTotal: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const compareText = (left: string, right: string): number => collator.compare(left, right);

const heroIndex = (heroId: string): number => {
  const index = HERO_IDS.findIndex((id) => id === heroId);
  return index === -1 ? HERO_IDS.length : index;
};

/** A bot whose hero has not been listed yet sits after every hero. */
const NO_HERO_INDEX = HERO_IDS.length + 1;

interface Ranked {
  card: Card;
  /** Display name for the Name sort. */
  title: string;
  /** Bot name, or '' for a hero card. */
  botName: string;
  heroAt: number;
  ordinal: number;
  level: number;
  xp: number;
}

function rankOf(card: Card, xp: ReadonlyMap<string, XpSummaryV1>): Ranked {
  if (card.kind === 'hero') return { card, title: card.hero.name, botName: '', heroAt: heroIndex(card.hero.heroId), ordinal: 0, level: 0, xp: 0 };
  const botName = nameOf(card.bot);
  const summary = xp.get(card.bot.bindingId);
  return {
    card,
    title: card.specter?.displayName ?? botName,
    botName,
    heroAt: card.specter === undefined ? NO_HERO_INDEX : heroIndex(card.specter.heroId),
    ordinal: card.specter?.ordinal ?? 0,
    level: summary?.level ?? 1,
    xp: summary?.totalXp ?? 0,
  };
}

const byRoster = (left: Ranked, right: Ranked): number =>
  left.heroAt - right.heroAt || left.ordinal - right.ordinal || compareText(left.botName, right.botName) || compareText(left.card.key, right.card.key);

const isBot = (ranked: Ranked): number => (ranked.card.kind === 'bot' ? 0 : 1);

const COMPARATORS: Readonly<Record<Sort, (left: Ranked, right: Ranked) => number>> = {
  roster: byRoster,
  name: (left, right) => compareText(left.title, right.title) || compareText(left.botName, right.botName) || byRoster(left, right),
  level: (left, right) => isBot(left) - isBot(right) || right.level - left.level || byRoster(left, right),
  xp: (left, right) => isBot(left) - isBot(right) || right.xp - left.xp || byRoster(left, right),
};

/**
 * Search, filter and sort the Specter cards. Pure: the same input gives the same cards, and nothing is written anywhere.
 * Search is trimmed and case-insensitive over hero name, epithet and bot name. A hero is "unassigned" when the backend
 * counts no assignment for it and no listed Specter already carries it.
 */
export function buildCollection(input: CollectionInput, view: ViewState): Collection {
  const bound = new Set([...input.specters.values()].map((specter) => specter.heroId));
  const unassigned = (input.heroes ?? []).filter((hero) => hero.assignedCount === 0 && !bound.has(hero.heroId));
  const bots: Card[] = input.bots.map((bot) => ({ kind: 'bot', key: bot.bindingId, bot, specter: input.specters.get(bot.bindingId) }));
  const heroes: Card[] = unassigned.map((hero) => ({ kind: 'hero', key: `hero:${hero.heroId}`, hero }));

  const needle = view.query.trim().toLocaleLowerCase();
  const hit = (...texts: readonly (string | undefined)[]): boolean => needle === '' || texts.some((text) => text !== undefined && text.toLocaleLowerCase().includes(needle));
  const keep = (card: Card): boolean => {
    if (card.kind === 'hero') return view.filter !== 'assigned' && view.filter !== 'avatar' && hit(card.hero.name, card.hero.epithet);
    if (view.filter === 'unassigned') return false;
    if (view.filter === 'avatar' && card.specter?.avatarChosen !== true) return false;
    return hit(nameOf(card.bot), card.specter?.displayName, card.specter?.name, card.specter?.epithet);
  };

  const sortHeld = (view.sort === 'level' || view.sort === 'xp') && !input.xpReady;
  const compare = COMPARATORS[sortHeld ? 'roster' : view.sort];
  const cards = [...bots, ...heroes]
    .filter(keep)
    .map((card) => rankOf(card, input.xp))
    .sort(compare)
    .map((ranked) => ranked.card);
  return { cards, total: bots.length + heroes.length, sortHeld, unassignedTotal: heroes.length };
}
