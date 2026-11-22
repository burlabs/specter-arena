// SPECTER-FIXTURE-ONLY: installs the host module stand-in around every UI unit test.
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetDataFixtures } from './data-bodies.ts';
import { fixtureNavigations, resetFixtureCalls } from './app-sdk.ts';
import { installHostModules } from './host-modules.ts';
import { setFixtureScenario } from './monitoring-bodies.ts';
import { resetSceneAssetFixtures } from './scene-bodies.ts';
import { resetSpecterFixtures } from './specter-bodies.ts';
import { resetTaskFixtures } from './task-bodies.ts';

// jsdom has HTMLDialogElement but neither showModal nor close: stand-ins that only toggle `open`.
if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

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
  resetTaskFixtures();
  resetDataFixtures();
  resetSceneAssetFixtures();
  resetFixtureCalls();
  fixtureNavigations.length = 0;
  teardown?.();
  teardown = undefined;
});
