import { createRoot } from 'react-dom/client';
import { StubShell } from './StubShell';

/**
 * Entry the Crew dashboard calls to render the app page.
 *
 * The host's exact call shape is verified live in FP-01, so any context argument is
 * accepted and ignored. Uses only APIs present in both React 18 and 19, because the
 * host supplies React and its major version is not pinned here.
 *
 * @returns cleanup that unmounts the app from `container`
 */
export function mount(container: HTMLElement, _context?: unknown): () => void {
  const root = createRoot(container);
  root.render(<StubShell />);
  return () => root.unmount();
}
