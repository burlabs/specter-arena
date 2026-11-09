import { StubShell } from './StubShell';

/**
 * Release entry. The Crew dashboard imports this module and renders the default export
 * inside its app provider; it never calls `mount`. Uses only APIs present in both React 18
 * and 19, because the host supplies React and its major version is not pinned here.
 */
export default function SpecterArenaApp() {
  return <StubShell />;
}

import { DIAGNOSTIC_MARKER } from './diagnostic/model';

export const leaked = DIAGNOSTIC_MARKER;
