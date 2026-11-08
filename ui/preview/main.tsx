// SPECTER-FIXTURE-ONLY: preview harness entry; built into ui/preview-dist, never ui/dist.
import { FIXTURE_BANNER_TEXT, installHostModules } from '../fixtures/host-modules.ts';
import { mount } from '../src/mount.tsx';

const banner = document.getElementById('fixture-banner');
if (banner) banner.textContent = FIXTURE_BANNER_TEXT;

installHostModules();
const container = document.getElementById('app');
if (container) mount(container);
