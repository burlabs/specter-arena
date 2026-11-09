// @vitest-environment node
// SPECTER-DIAGNOSTIC-ONLY
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOST_EXTERNALS } from '../../host-modules.ts';

const CONFIG = fileURLToPath(new URL('../../vite.diagnostic.config.ts', import.meta.url));
const OUT_DIR = join(tmpdir(), `specter-diagnostic-build-${process.pid}`);

let bundle = '';

beforeAll(async () => {
  // Built into a temp directory so the test never touches ui/diagnostic-dist, which
  // `npm run build:diagnostic` owns. NODE_ENV is production for the same reason as the
  // release build-output test: the host provides only the production JSX runtime.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ configFile: CONFIG, mode: 'production', logLevel: 'silent', build: { outDir: OUT_DIR } });
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
  bundle = readFileSync(join(OUT_DIR, 'index.mjs'), 'utf8');
  return () => rmSync(OUT_DIR, { recursive: true, force: true });
}, 60_000);

const importedSpecifiers = () =>
  [...bundle.matchAll(/(?:^|[\s;])import\s*(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g)].map((match) => match[1]);

describe('diagnostic library build', () => {
  it('writes exactly index.mjs', () => {
    expect(readdirSync(OUT_DIR)).toEqual(['index.mjs']);
  });

  it('carries the diagnostic marker as a runtime string', () => {
    expect(bundle).toContain('SPECTER-DIAGNOSTIC-ONLY');
  });

  it('default-exports the entry component', () => {
    expect(bundle).toMatch(/export\s*\{[^}]*\bas\s+default\b[^}]*\}|export\s+default\b/);
  });

  it('imports only host externals', () => {
    const imports = importedSpecifiers();
    expect(imports).toContain('react/jsx-runtime');
    for (const specifier of imports) expect(HOST_EXTERNALS).toContain(specifier);
  });

  it('does not inline React or embed local paths', () => {
    expect(bundle).not.toMatch(/__CLIENT_INTERNALS|__SECRET_INTERNALS|react\.transitional\.element|jsxDEV/);
    expect(bundle).not.toContain(fileURLToPath(new URL('../..', import.meta.url)));
  });
});
