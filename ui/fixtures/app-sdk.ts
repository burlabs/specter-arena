// SPECTER-FIXTURE-ONLY: stands in for '@kirocrew/app-sdk' in unit tests and the preview
// harness through a bundler alias. The library build leaves the real module external, so
// this file never reaches ui/dist.

export const FIXTURE_SDK_LABEL = 'SPECTER-FIXTURE-ONLY: fixture app-sdk, not the Crew host';

export interface FixtureApiClient {
  get(path: string, init?: RequestInit): Promise<unknown>;
  post(path: string, body?: unknown, init?: RequestInit): Promise<unknown>;
}

const CANNED_RESPONSE = { ok: true, at: '2000-01-01T00:00:00Z', source: FIXTURE_SDK_LABEL };

const client: FixtureApiClient = {
  get: () => Promise.resolve(CANNED_RESPONSE),
  post: () => Promise.resolve(CANNED_RESPONSE),
};

export function useAppApi(): FixtureApiClient {
  return client;
}
