import * as sdk from '@kirocrew/app-sdk';
import { useCallback } from 'react';

/** Routes verified on Crew 0.12.2 (docs/compatibility/handoff-routes.json). Nothing else may be navigated to. */
export type HostPath = '/members';

const ALLOWED_PATHS: readonly string[] = ['/members'];

// Read once at load. A named import of a missing export fails the whole app at load on the host, and
// `useNavigate` is verified on 0.12.2 only, so the namespace import is the safe way to look for it.
const useSdkNavigate: (() => (path: string) => void) | null = 'useNavigate' in sdk && typeof sdk.useNavigate === 'function' ? sdk.useNavigate : null;
const useNoNavigate = (): ((path: string) => void) | null => null;

/** The only navigation seam into the Crew dashboard: the host router when present, a page load otherwise. */
export function useHostNavigate(): (path: HostPath) => void {
  const navigate = (useSdkNavigate ?? useNoNavigate)();
  return useCallback(
    (path: HostPath) => {
      if (!ALLOWED_PATHS.includes(path)) return;
      if (navigate !== null) navigate(path);
      else window.location.assign(path);
    },
    [navigate],
  );
}
