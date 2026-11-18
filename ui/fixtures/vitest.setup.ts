// SPECTER-FIXTURE-ONLY: installs the host module stand-in around every UI unit test.
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { fixtureNavigations, resetFixtureCalls } from './app-sdk.ts';
import { installHostModules } from './host-modules.ts';
import { setFixtureScenario } from './monitoring-bodies.ts';
import { resetSceneAssetFixtures } from './scene-bodies.ts';
import { resetSpecterFixtures } from './specter-bodies.ts';
import { resetWorkFixtures } from './work-bodies.ts';

let teardown: (() => void) | undefined;

beforeEach(() => {
  // Build-output tests run in the node environment, which has no window.
  if (typeof window !== 'undefined') teardown = installHostModules();
});

afterEach(() => {
  if (typeof window !== 'undefined') {
    cleanup();
    window.localStorage.clear();
  }
  setFixtureScenario(null);
  resetSpecterFixtures();
  resetWorkFixtures();
  resetSceneAssetFixtures();
  resetFixtureCalls();
  fixtureNavigations.length = 0;
  teardown?.();
  teardown = undefined;
});
