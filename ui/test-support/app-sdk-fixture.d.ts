// Test-only view of the aliased fixture SDK: the real host module exports only useAppApi.
declare module '@kirocrew/app-sdk' {
  export type ScenarioName = import('../fixtures/monitoring-bodies.ts').ScenarioName;
  export function setFixtureScenario(name: ScenarioName | null): void;
  export function rosterBody(name: ScenarioName): import('../src/contracts/types').RosterV1;
  export function attemptsBody(name: ScenarioName, bindingId: string): import('../src/contracts/types').AttemptsV1 | null;
  export type SpecterScenarioName = import('../fixtures/specter-bodies.ts').SpecterScenarioName;
  export function setSpecterScenario(name: SpecterScenarioName | null): void;
  export type WorkScenarioName = import('../fixtures/work-bodies.ts').WorkScenarioName;
  export function setWorkScenario(name: WorkScenarioName | null): void;
  export function setSceneAssetsFailing(value: boolean): void;
  export type ArenaScenarioName = import('../fixtures/arena-scenarios.ts').ArenaScenarioName;
  export function setArenaScenario(name: ArenaScenarioName | null): void;
  export const fixtureCalls: Array<{ method: 'GET' | 'POST'; path: string }>;
}
