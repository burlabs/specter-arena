// SPECTER-FIXTURE-ONLY: stands in for '@kirocrew/app-sdk' in unit tests and the preview
// harness through a bundler alias. The library build leaves the real module external, so
// this file never reaches ui/dist.
import { DECLARED_API, isPathPermitted } from '../test-support/api-allowlist.ts';
import { isArenaScenario } from './arena-scenarios.ts';
import type { ArenaScenarioName } from './arena-scenarios.ts';
import { dataResponse, setDataScenario } from './data-bodies.ts';
import { attemptsBody, monitoringResponse, rosterBody, setFixtureScenario } from './monitoring-bodies.ts';
import { sceneAssetResponse, setSceneAssetsFailing } from './scene-bodies.ts';
import { setSpecterScenario, specterResponse } from './specter-bodies.ts';
import { setWorkScenario, workResponse } from './work-bodies.ts';

export const FIXTURE_SDK_LABEL = 'SPECTER-FIXTURE-ONLY: fixture app-sdk, not the Crew host';

export interface FixtureApiClient {
  /** The seam signal the release UI reads through `useHostApi().mode`. The installed host client has no such property. */
  readonly sourceMode: 'FIXTURE';
  get(path: string, init?: RequestInit): Promise<unknown>;
  post(path: string, body?: unknown, init?: RequestInit): Promise<unknown>;
  put(path: string, body?: unknown, init?: RequestInit): Promise<unknown>;
}

export interface FixtureCall {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
}

/** Every request the fixture client received, newest last. The preview harness reads it as window.__specterFixtureCalls. */
export const fixtureCalls: FixtureCall[] = [];

function recordCall(method: 'GET' | 'POST' | 'PUT', pathname: string, search: string): void {
  fixtureCalls.push({ method, path: `${pathname}${search}` });
  if (typeof window !== 'undefined') (window as unknown as { __specterFixtureCalls?: FixtureCall[] }).__specterFixtureCalls = fixtureCalls;
}

export function resetFixtureCalls(): void {
  fixtureCalls.length = 0;
}

const CANNED_RESPONSE = { ok: true, at: '2000-01-01T00:00:00Z', source: FIXTURE_SDK_LABEL };

export function createFixtureClient(declared: readonly string[]): FixtureApiClient {
  const guard = (path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) => {
    const { pathname, search } = new URL(path, 'http://localhost');
    recordCall(method, pathname, search);
    if (!isPathPermitted(declared, pathname)) {
      return Promise.reject(
        new Error(`[app-sdk] App "specter-arena" not permitted to access ${pathname}. Declared: [${declared.join(', ')}]`),
      );
    }
    // PUT exists only on the Data routes; every other fixture module answers GET and POST.
    if (method === 'PUT') return dataResponse(pathname, method, body) ?? Promise.resolve(CANNED_RESPONSE);
    return (
      dataResponse(pathname, method, body) ??
      monitoringResponse(pathname) ??
      specterResponse(pathname, method, body) ??
      workResponse(pathname, method, body, search) ??
      sceneAssetResponse(pathname, method) ??
      Promise.resolve(CANNED_RESPONSE)
    );
  };
  return { sourceMode: 'FIXTURE', get: (path) => guard(path, 'GET'), post: (path, body) => guard(path, 'POST', body), put: (path, body) => guard(path, 'PUT', body) };
}

/** Unit-test seam for the arena scenarios: points the roster, work and Specter fixtures at one named scenario (null clears all three). */
export function setArenaScenario(name: ArenaScenarioName | null): void {
  if (name !== null && !isArenaScenario(name)) throw new Error(`Unknown arena scenario ${name}`);
  const routing = {
    arena: ['default', 'work', 'specters'],
    'arena-no-art': ['default', 'work', 'specters'],
    'arena-perf-1': ['arena-perf-roster', 'arena-perf-work', 'arena-perf-specters'],
    'arena-stale': ['arena-stale-roster', 'arena-stale-work', 'specters'],
    'arena-empty': ['empty', 'work-none', 'specters-none'],
  } as const;
  const [roster, work, specters] = name === null ? [null, null, null] : routing[name];
  setFixtureScenario(roster);
  setWorkScenario(work);
  setSpecterScenario(specters);
  setSceneAssetsFailing(name === 'arena-no-art');
}

export { DECLARED_API, isPathPermitted };
export { attemptsBody, rosterBody, setFixtureScenario };
export type { ScenarioName } from './monitoring-bodies.ts';
export { setSceneAssetsFailing, setSpecterScenario };
export type { SpecterScenarioName } from './specter-bodies.ts';
export { setDataScenario, setWorkScenario };
export type { WorkScenarioName } from './work-bodies.ts';
export type { DataScenarioName } from './data-bodies.ts';

const client = createFixtureClient(DECLARED_API);

export function useAppApi(): FixtureApiClient {
  return client;
}

/** Paths the app asked the host to navigate to, newest last. The preview harness reads it as window.__specterFixtureNavigations. */
export const fixtureNavigations: string[] = [];

export function useNavigate(): (path: string) => void {
  return (path) => {
    fixtureNavigations.push(path);
    if (typeof window !== 'undefined') (window as unknown as { __specterFixtureNavigations?: string[] }).__specterFixtureNavigations = fixtureNavigations;
  };
}
