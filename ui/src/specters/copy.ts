export const NO_SPECTER = 'No Specter yet';
export const SPECTER_ROW_PREFIX = 'Specter: ';
export const TOKEN_CAPTION = 'Placeholder token, not a portrait';
export const TOKEN_FAILED_CAPTION = 'Portrait could not be loaded. Showing a placeholder token.';
export const COSMETIC_NOTE = "A Specter is a name and a picture. It never changes this bot's setup, permissions, or work.";
export const HERO_NOTE = 'This hero was assigned to the bot. Its name and personality are fixed. You can change the avatar.';
export const HERO_PENDING = 'This bot has not been given a hero yet. It appears at the next refresh.';

export const ACTIONS = {
  avatar: 'Change avatar',
  checkAgain: 'Check again',
  assign: 'Assign a Specter',
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
  no_hero: 'This bot has no Specter yet.',
  invalid_response: 'The app backend sent an answer this version cannot read. Nothing was changed.',
};

export const errorWords = (code: string): string => ERROR_WORDS[code] ?? `Something went wrong (${code}).`;

export const UNSUPPORTED_BACKEND = 'This version of the app backend does not support Specters yet.';
export const LOADING_SPECTERS = 'Loading Specters…';
export const CLIENT_NOT_PNG = 'Only PNG images can be used.';
export const CLIENT_TOO_LARGE = 'That image is larger than 1 MB.';

export const FIELD_LABELS = {
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

export const ASSIGN = {
  dialogLabel: 'Assign Specters',
  title: (bot: string): string => `Choose a Specter for ${bot}`,
  note: 'A bot keeps its Specter once assigned.',
  step: (index: number, total: number): string => `Step ${index} of ${total}`,
  heroesLabel: 'Heroes',
  held: (count: number): string => (count === 0 ? 'not held yet' : `held by ${count}`),
  assign: (hero: string): string => `Assign ${hero}`,
  assigning: 'Assigning…',
  skip: 'Skip for now',
  randomize: 'Randomize all unassigned',
  progress: (done: number, total: number): string => `Assigning ${done} of ${total}…`,
  close: 'Close',
  done: 'Done',
  summaryTitle: 'Specters assigned',
  summary: (assigned: number, skipped: number, failed: number): string => `${assigned} assigned, ${skipped} skipped${failed > 0 ? `, ${failed} could not be assigned` : ''}`,
  skippedHint: 'Skipped bots can be assigned later from the Specters tab or the Roster.',
  heroesLoading: 'Loading heroes…',
  heroesFailed: 'The heroes could not be loaded. You can still randomize.',
  botGone: 'This bot is no longer on the roster.',
  detailHelp: 'Pick one of the 11 heroes, or let the app pick. A bot keeps its Specter once assigned.',
} as const;

export const SHOWCASE = {
  label: 'Specter showcase',
  heading: 'Specters',
  intro: 'The 11 heroes. Their names and personalities are fixed.',
  assignButton: (count: number): string => `Assign Specters (${count})`,
  stageLabel: (name: string): string => `${name} and a practice target, large preview`,
  practiceTarget: 'Practice target, for show',
  attack: 'Attack',
  cast: 'Cast',
  motionOff: 'Attack and Cast are off because reduced motion is requested.',
  previewNote: 'These are previews. They do not show any bot’s work. The practice target is not a task and earns no XP.',
  holders: (count: number): string => `Bots with this Specter (${count})`,
  noHolders: (name: string): string => `No bot holds ${name} yet.`,
  showInRoster: 'Show in the Roster',
  heroesLoading: 'Loading heroes…',
  heroesFailed: 'The heroes could not be loaded.',
  heroesUnsupported: 'This version of the app backend cannot list the heroes yet.',
  retry: 'Retry',
  avatarPackLine: 'Use this Specter as your Crew avatar: download its avatar pack, then in Crew open Avatar → Customize → Library → Import.',
  avatarPackLink: (name: string): string => `Download ${name}’s avatar pack`,
  avatarPackCopy: 'If the link does not open, copy this address:',
} as const;

export const ROSTER = { assign: 'Assign' } as const;
