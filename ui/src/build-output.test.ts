// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOST_EXTERNALS } from '../host-modules.ts';

const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

let bundle = '';

beforeAll(async () => {
  // Built from the repo root, the way `npm run build` runs, to prove the output does
  // not depend on the working directory.
  // Vitest sets NODE_ENV=test, which would switch the JSX transform to the dev runtime
  // the host does not provide; `npm run build` runs with production semantics.
  const cwd = process.cwd();
  const nodeEnv = process.env.NODE_ENV;
  process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
  process.env.NODE_ENV = 'production';
  try {
    await build({ configFile: CONFIG, mode: 'production', logLevel: 'silent' });
  } finally {
    process.chdir(cwd);
    process.env.NODE_ENV = nodeEnv;
  }
  bundle = readFileSync(`${DIST}/index.mjs`, 'utf8');
}, 60_000);

const importedSpecifiers = () =>
  [...bundle.matchAll(/(?:^|[\s;])import\s*(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g)].map((match) => match[1]);

describe('library build', () => {
  it('writes exactly ui/dist/index.mjs', () => {
    expect(readdirSync(DIST)).toEqual(['index.mjs']);
  });

  it('exports mount', () => {
    expect(bundle).toMatch(/export\s*\{[^}]*\bmount\b[^}]*\}/);
  });

  it('imports host modules as bare specifiers and nothing else', () => {
    const imports = importedSpecifiers();
    expect(imports).toContain('react-dom/client');
    expect(imports).toContain('react/jsx-runtime');
    for (const specifier of imports) expect(HOST_EXTERNALS).toContain(specifier);
  });

  it('does not inline React or embed local paths', () => {
    expect(bundle).not.toMatch(/__CLIENT_INTERNALS|__SECRET_INTERNALS|react\.transitional\.element|jsxDEV/);
    expect(bundle).not.toContain(fileURLToPath(new URL('..', import.meta.url)));
    expect(bundle.length).toBeLessThan(2_000);
  });
});
