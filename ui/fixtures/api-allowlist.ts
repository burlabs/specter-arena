// SPECTER-FIXTURE-ONLY: the host SDK's path allowlist, kept apart from the aliased SDK
// module so tests that mock '@kirocrew/app-sdk' can still import it.
import manifest from '../../app.json';

/** The host SDK's matcher: `/x/*` and `/x` cover `/x` and `/x/...`; a trailing `*` is a prefix. */
export function isPathPermitted(declared: readonly string[], path: string): boolean {
  return declared.some((entry) => {
    const pattern = entry.trim();
    if (!pattern) return false;
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      return path === base || path.startsWith(`${base}/`);
    }
    if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
    return path === pattern || path.startsWith(`${pattern}/`);
  });
}

export const DECLARED_API: readonly string[] = (manifest as { permissions?: { api?: string[] } }).permissions?.api ?? [];
