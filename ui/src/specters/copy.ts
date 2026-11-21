export const NO_SPECTER = 'No Specter yet';
export const SPECTER_ROW_PREFIX = 'Specter: ';
export const TOKEN_CAPTION = 'Placeholder token, not a portrait';
export const TOKEN_FAILED_CAPTION = 'Portrait could not be loaded. Showing a placeholder token.';
export const COSMETIC_NOTE = "A Specter is a name and a picture. It never changes this bot's setup, permissions, or work.";
export const HERO_NOTE = 'This hero came with the bot when it first appeared. Its name and personality are fixed. You can change the avatar.';
export const HERO_PENDING = 'This bot has not been given a hero yet. It appears at the next refresh.';

export const ACTIONS = {
  avatar: 'Change avatar',
  checkAgain: 'Check again',
} as const;

export const ERROR_WORDS: Readonly<Record<string, string>> = {
  version_conflict: 'This avatar changed somewhere else. It was reloaded; review it and try again.',
  unknown_binding: 'This bot is no longer on the roster.',
  unknown_asset: 'That portrait could not be found.',
  invalid_body: 'The app could not use what was sent. Check the choice and try again.',
  body_too_large: 'That request was too large.',
  upload_limit_reached: 'You already have 100 uploaded images. Remove unused uploads on the Data tab, then try again.',
  asset_too_large: 'That image is larger than 1 MB.',
  unsupported_media: 'Only PNG images can be used.',
  invalid_image: 'That file is not a valid PNG image the app can use.',
  store_not_ready: 'The app database is still starting. Try again in a moment.',
  store_unavailable: "The app's database is unavailable. Nothing was changed.",
  offline: 'Could not reach the app backend. Nothing was changed.',
};

export const errorWords = (code: string): string => ERROR_WORDS[code] ?? `Something went wrong (${code}).`;

export const UNSUPPORTED_BACKEND = 'This version of the app backend does not support Specters yet.';
export const LOADING_SPECTERS = 'Loading Specters…';
export const SELECT_A_BOT = 'Select a bot to see its Specter.';
export const BOT_GONE = 'This bot is no longer on the roster.';
export const CLIENT_NOT_PNG = 'Only PNG images can be used.';
export const CLIENT_TOO_LARGE = 'That image is larger than 1 MB.';

export const FIELD_LABELS = {
  bot: 'Bot',
  progression: 'Progression',
  personality: 'Personality',
  appearance: 'Appearance',
} as const;

export const PICKER = {
  heading: 'Choose an avatar',
  heroDefault: 'Use the hero portrait',
  gallery: 'Portraits',
  apply: 'Apply',
  cancel: 'Cancel',
  upload: 'Upload a PNG (up to 1 MB)',
  loading: 'Loading portraits…',
  failed: 'Portraits could not be loaded.',
} as const;

export const LIST = { collectionLabel: 'Specter collection', detailLabel: 'Specter detail', noBots: 'No bots are on the roster yet', noBotsBody: 'Specters belong to bots. Create or open a bot in Crew, then refresh.' } as const;

export const COLLECTION = {
  searchLabel: 'Search Specters',
  searchPlaceholder: 'Search hero, epithet or bot',
  filterLabel: 'Filter',
  sortLabel: 'Sort',
  filters: { all: 'All', assigned: 'Assigned', unassigned: 'Unassigned', avatar: 'Avatar changed' },
  sorts: { roster: 'Roster order', name: 'Name', level: 'Level', xp: 'XP' },
  count: (shown: number, total: number): string => `Showing ${shown} of ${total}`,
  sortHeld: 'Level and XP order wait for XP to load. Showing roster order.',
  noBotYet: 'No bot yet',
  emptyTitle: 'No Specters match',
  emptyBody: 'Try another name or epithet, or clear the search and filters.',
  clear: 'Clear search and filters',
  everyHeroTitle: 'Every hero has a bot',
  everyHeroBody: 'Each of the 11 heroes is already held by a bot.',
  heroesLoading: 'Loading heroes without a bot…',
  heroesFailed: 'Heroes without a bot could not be loaded. Bot cards are not affected.',
  heroesUnsupported: 'This version of the app backend cannot list heroes without a bot yet. Bot cards are not affected.',
  retry: 'Retry',
} as const;
