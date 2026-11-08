// SPECTER-FIXTURE-ONLY: stands in for the Crew dashboard's shared module registry.
// Never imported from ui/src, so it never reaches the ui/dist production bundle.
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';

export const SPECTER_FIXTURE_MARKER = 'SPECTER-FIXTURE-ONLY';

export const FIXTURE_BANNER_TEXT = `${SPECTER_FIXTURE_MARKER}: FIXTURE, not live Crew data; backend not running in preview`;

type HostWindow = { __kirocrew_modules?: Record<string, unknown> };

/**
 * Registers React under the keys the dashboard uses. The host serves `react-dom` and
 * `react-dom/client` from one `react-dom` entry, so both namespaces are merged here.
 * The SDK, UI kit, query and icon entries are left out until a later slice uses them.
 *
 * @returns teardown that removes the registry
 */
export function installHostModules(): () => void {
  const host = window as unknown as HostWindow;
  host.__kirocrew_modules = {
    react: React,
    'react-dom': { ...ReactDOM, ...ReactDOMClient },
    'react/jsx-runtime': JsxRuntime,
  };
  return () => {
    delete host.__kirocrew_modules;
  };
}
