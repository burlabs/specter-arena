export const REASON_WORDS: Readonly<Record<string, string>> = {
  running: "Crew reports a turn running, and the collector saw this bot's chat recently.",
  'not-running': 'Crew reports no running turn. This is not a health reading.',
  'never-observed': 'The collector has not seen a turn state for this bot yet.',
  'presence-absent': 'Crew no longer lists this bot. Its last known facts are not shown as current.',
  'presence-unknown': 'The collector has not yet confirmed that Crew lists this bot.',
  'no-coverage': 'Nothing is being collected for this bot right now.',
  'heartbeat-stale': 'The collector has not reported for more than 30 seconds, so this state may be out of date.',
  restart: 'The collector restarted. Time between runs is not covered.',
  disconnect: 'The collector lost its connection to Crew and is reconnecting.',
  'auth-stopped': "Crew stopped accepting the collector's access, so collection stopped.",
  'app-disabled': 'The app is disabled in Crew, so nothing is collected.',
  'scope-lost-or-silent': 'Crew stopped sending chat updates or the app lost that access, so collection stopped.',
  overflow: 'The collector fell behind and dropped updates. This period has a gap.',
  'store-unavailable': "The app's own database was unavailable, so updates were not saved.",
  paused: 'Collection was paused. Paused time is a gap, not a quiet period.',
  'source-restart': "Crew's update stream restarted. Updates in between were not collected.",
  'roster-unavailable': "The collector could not read Crew's bot list, so names and presence were not updated.",
  'feed-absent': "This bot's chat has not appeared in updates since the current collection period began.",
  'no-slot-yet': "Collection is running, but this bot's chat has not appeared in an update yet.",
  'unsupported-store-less-bot': 'This bot has no memory store, so Crew gives the app no turn data for it.',
  'unobserved-turns': 'One or more turns happened between two observations and were not seen.',
  'ended-row-idle': "Ended. Crew's row stopped reporting a running turn.",
  'ended-chat-done': "Ended when Crew's turn-complete event arrived.",
  'ended-other': 'Ended. The ending signal is not one this app recognizes.',
  'collector-not-started': 'The backend has not started its collector.',
  shutdown: 'The app was shut down cleanly.',
  'internal-error': 'The collector hit an internal error and stopped.',
};

/** Words for a code. Never returns an empty string. */
export function reasonWords(code: string): string {
  return REASON_WORDS[code] ?? `Reason code: ${code}`;
}


const COLLECTOR_STATE_WORDS: Readonly<Record<string, string>> = {
  starting: 'Collector is starting.',
  running: 'Collector is running.',
  reconnecting: 'Collector is reconnecting to Crew.',
  paused: 'Collection paused. Nothing new is being recorded.',
  stopped: 'Collector stopped.',
  unavailable: 'Collector unavailable.',
};

/** Banner sentence: the state, then the reason when there is one. */
export function collectorWords(state: string, reasonCode: string | null): string {
  const stateWords = COLLECTOR_STATE_WORDS[state] ?? `Collector state: ${state}.`;
  return reasonCode === null ? stateWords : `${stateWords} ${reasonWords(reasonCode)}`;
}

/** A count of 1 reads "1 bot on Crew has"; the store-less note carries the count. */
export function noteWords(code: string, count: number | null): string {
  if (code === 'cron-turns-not-observable') {
    return 'Scheduled (cron) turns are not observable, so a bot can be busy without showing it here.';
  }
  if (code === 'unsupported-store-less-bot' && count !== null) {
    return `${count} ${count === 1 ? 'bot' : 'bots'} on Crew ${count === 1 ? 'has' : 'have'} no memory store and cannot be monitored.`;
  }
  return `Note: ${code}`;
}

export const truncationWords = (loaded: number): string =>
  `Roster truncated: showing the first ${loaded} bots. Search narrows only what was loaded.`;

export const PRESENCE_WORDS: Readonly<Record<string, string>> = {
  present: 'Listed by Crew',
  absent: 'No longer listed by Crew',
  unknown: 'Not confirmed',
};

export const COVERAGE_STATE_WORDS: Readonly<Record<string, string>> = {
  covered: 'Collected',
  gap: 'Gap in collection',
  unknown: 'Not known',
};

export const UNAVAILABLE_TEXT = 'Unavailable until accepted-work tracking ships';

export const LEGEND: ReadonlyArray<{ term: string; meaning: string }> = [
  { term: 'Working', meaning: 'Crew reports a turn running and the collector saw the chat recently.' },
  { term: 'No turn running', meaning: 'Crew reports no running turn. This is not a health reading.' },
  { term: 'Unknown', meaning: 'The collector cannot tell, so the reason says why.' },
  { term: 'Waiting on you', meaning: 'Not observable yet. Crew does not report this to apps, so the app does not guess it.' },
  { term: 'Blocked', meaning: 'Not observable yet. Crew does not report this to apps, so the app does not guess it.' },
];

export const FAILURE_COPY = {
  offline: { title: 'Could not reach the app backend', body: 'Check that the app is enabled in Crew, then retry.' },
  expired: { title: 'Session expired', body: 'Reload the page to sign in to the app again.' },
  'store-not-ready': { title: 'Collector store is not ready yet', body: 'The app is still starting. Retry in a moment.' },
  'store-unavailable': { title: "The app's database is unavailable", body: 'Collection is not saving data. Retry, or restart the app.' },
  unknown: { title: 'Unexpected reply from the app backend', body: 'Retry. If it persists, reload.' },
} as const;
