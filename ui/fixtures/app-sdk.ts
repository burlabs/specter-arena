// SPECTER-FIXTURE-ONLY: stands in for '@kirocrew/app-sdk' in unit tests and the preview
// harness through a bundler alias. The library build leaves the real module external, so
// this file never reaches ui/dist.
import { DECLARED_API, isPathPermitted } from './api-allowlist.ts';

export const FIXTURE_SDK_LABEL = 'SPECTER-FIXTURE-ONLY: fixture app-sdk, not the Crew host';

export interface FixtureApiClient {
  get(path: string, init?: RequestInit): Promise<unknown>;
  post(path: string, body?: unknown, init?: RequestInit): Promise<unknown>;
}

const CANNED_RESPONSE = { ok: true, at: '2000-01-01T00:00:00Z', source: FIXTURE_SDK_LABEL };

export function createFixtureClient(declared: readonly string[]): FixtureApiClient {
  const guard = (path: string) => {
    const { pathname } = new URL(path, 'http://localhost');
    if (!isPathPermitted(declared, pathname)) {
      return Promise.reject(
        new Error(`[app-sdk] App "specter-arena" not permitted to access ${pathname}. Declared: [${declared.join(', ')}]`),
      );
    }
    return Promise.resolve(CANNED_RESPONSE);
  };
  return { get: (path) => guard(path), post: (path) => guard(path) };
}

export { DECLARED_API, isPathPermitted };

const client = createFixtureClient(DECLARED_API);

export function useAppApi(): FixtureApiClient {
  return client;
}
