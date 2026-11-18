export const NO_SPECTER = 'No Specter yet';
export const SPECTER_ROW_PREFIX = 'Specter: ';
export const ROW_TOKEN_NOTE = ' (placeholder token, not a portrait)';
export const TOKEN_CAPTION = 'Placeholder token, not a portrait';
export const TOKEN_FAILED_CAPTION = 'Portrait could not be loaded. Showing a placeholder token.';
export const COSMETIC_NOTE = "A Specter is a name and a picture. It never changes this bot's setup, permissions, or work.";
export const PRIVACY_NOTE =
  "Only the bot's display name and the text you type here are sent. Its memory, notes, goals, and chat history are never used.";

export const SOURCE_WORDS = {
  generated: (version: string | null): string => `Generated through Crew${version === null ? '' : `, prompt version ${version}`}`,
  manual: 'Written by you',
} as const;

export const sourceWords = (source: string, promptVersion: string | null): string =>
  source === 'generated' ? SOURCE_WORDS.generated(promptVersion) : source === 'manual' ? SOURCE_WORDS.manual : `Unknown source (${source})`;

export const budgetLine = (left: number, limit: number): string => `${left} of ${limit} left today for this bot`;
export const installBudgetLine = (left: number, limit: number): string => `${left} of ${limit} left today across all bots`;
export const BUDGET_UNKNOWN = 'Daily limits apply. The remaining count shows after your first request.';

export const ACTIONS = {
  summon: 'Summon a Specter',
  reroll: 'Reroll',
  cancel: 'Cancel summoning',
  accept: 'Accept this Specter',
  discard: 'Discard',
  rename: 'Rename',
  portrait: 'Choose portrait',
  manual: 'Write one by hand',
  archive: 'Archive',
  checkAgain: 'Check again',
  tryAgain: 'Try again',
} as const;

export const STATUS_WORDS: Readonly<Record<string, string>> = {
  queued: 'Waiting to start',
  running: 'Summoning in progress',
  ready: 'A candidate is ready to review',
  failed: 'The summoning did not finish',
  cancelled: 'Cancelled',
  accepted: 'Accepted',
  superseded: 'Replaced by a newer candidate',
};

export const statusWords = (status: string): string => STATUS_WORDS[status] ?? `Unknown status (${status})`;

export const LOST_WORDS = {
  timeout: 'Stopped waiting. The summoning may still finish.',
  unreachable: 'Could not reach the app backend. The summoning may still finish.',
} as const;

export const ERROR_WORDS: Readonly<Record<string, string>> = {
  timeout: 'Crew did not answer in time.',
  refused: 'Crew declined to write this one.',
  malformed: 'Crew answered in a form the app could not use.',
  interrupted: 'The app restarted before the summoning finished.',
  unavailable: 'Crew could not be reached for this summoning.',
  generation_unavailable:
    'Summoning is not possible right now. The app may not have been granted chat access in Crew; approve the app update, then retry. Writing by hand and choosing portraits still work.',
  generation_in_flight: 'Another summoning is already running. Wait for it to finish or cancel it.',
  budget_exhausted: 'The daily summoning limit is used up. Try again tomorrow, or write one by hand.',
  version_conflict: 'This Specter changed somewhere else. It was reloaded; review it and try again.',
  not_ready: 'That candidate is no longer ready to accept.',
  unknown_binding: 'This bot is no longer on the roster.',
  unknown_request: 'That summoning is no longer known to the app.',
  unknown_asset: 'That portrait could not be found.',
  no_specter: 'This bot has no Specter yet.',
  invalid_body: 'The app could not use what was sent. Check the fields and try again.',
  body_too_large: 'That request was too large.',
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
export const DUPLICATE_NAME_NOTE = 'Another Specter already has this name. You can still accept it or rename it.';
export const CLIENT_NOT_PNG = 'Only PNG images can be used.';
export const CLIENT_TOO_LARGE = 'That image is larger than 1 MB.';
export const NO_PORTRAIT = 'No portrait (placeholder token)';

export const FIELD_LABELS = {
  name: 'Name',
  epithet: 'Epithet',
  personality: 'Personality',
  appearance: 'Appearance',
  mannerism: 'Mannerism',
  signatureAction: 'Signature action',
  assignmentRationale: 'Why this fits',
  artBrief: 'Art brief',
} as const;

export const MANUAL = {
  heading: 'Write a Specter by hand',
  help: 'Nothing is generated. This saves exactly what you type.',
} as const;

export const SUMMON = {
  heading: 'Summon a Specter',
  rerollHeading: 'Reroll this Specter',
  purpose: 'What is this bot for? (optional)',
  style: 'Style or mood (optional)',
  keepLegend: 'Keep these as they are',
  candidate: 'Candidate',
  promptNote: 'Summoning asks Crew to write a name and a profile. You review the result before anything is saved.',
} as const;

export const RENAME = { heading: 'Rename', name: 'Name', epithet: 'Epithet (optional)', save: 'Save', cancel: 'Cancel' } as const;

export const ARCHIVE = {
  ask: (name: string): string => `Archive ${name}? Its history is kept.`,
  confirm: 'Yes, archive',
  keep: 'Keep it',
} as const;

export const PICKER = {
  heading: 'Choose a portrait',
  gallery: 'Portraits',
  apply: 'Apply',
  cancel: 'Cancel',
  upload: 'Upload a PNG (up to 1 MB)',
  loading: 'Loading portraits…',
  failed: 'Portraits could not be loaded.',
} as const;

export const MANUAL_FORM = { save: 'Save', cancel: 'Cancel', optional: ' (optional)' } as const;

export const LIST = { botsLabel: 'Bots with Specters', detailLabel: 'Specter detail', noBots: 'No bots are on the roster yet', noBotsBody: 'Specters belong to bots. Create or open a bot in Crew, then refresh.' } as const;

export const characterCount = (used: number, max: number): string => `${used} of ${max}`;
