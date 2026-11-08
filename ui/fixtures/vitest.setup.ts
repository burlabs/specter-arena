// SPECTER-FIXTURE-ONLY: installs the host module stand-in around every UI unit test.
import { afterEach, beforeEach } from 'vitest';
import { installHostModules } from './host-modules.ts';

let teardown: (() => void) | undefined;

beforeEach(() => {
  // Build-output tests run in the node environment, which has no window.
  if (typeof window !== 'undefined') teardown = installHostModules();
});

afterEach(() => {
  teardown?.();
  teardown = undefined;
});
