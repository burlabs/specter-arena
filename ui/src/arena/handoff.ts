import type { HostPath } from '../host';

export interface CrewHandoff {
  id: string;
  label: string;
  /** Where the route was verified on the installed Crew host. */
  evidencePath: string;
  buildHref: () => HostPath;
}

/**
 * Only routes recorded as allowed in docs/compatibility/handoff-routes.json. The Bots page is the one route the
 * installed Crew 0.12.2 offers that an app can reach without a Crew session or slot id.
 */
export const CREW_HANDOFFS: readonly CrewHandoff[] = [
  { id: 'open-bots', label: 'Open Bots in Crew', evidencePath: 'docs/compatibility/handoff-routes.md#open-bots', buildHref: () => '/members' },
];

export const HANDOFF_LIMIT_NOTE = "Opens the Bots page in Crew. It cannot open this bot's chat or approvals directly.";
