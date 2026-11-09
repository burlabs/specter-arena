// SPECTER-FIXTURE-ONLY: preview harness entry; built into ui/preview-dist, never ui/dist.
import { createRoot } from 'react-dom/client';
import { FIXTURE_BANNER_TEXT, installHostModules } from '../fixtures/host-modules.ts';
import SpecterArenaApp from '../src/mount.tsx';

const banner = document.getElementById('fixture-banner');
if (banner) banner.textContent = FIXTURE_BANNER_TEXT;

installHostModules();
const container = document.getElementById('app');
if (container) createRoot(container).render(<SpecterArenaApp />);
