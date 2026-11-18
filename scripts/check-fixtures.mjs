import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIXTURE_MARKER = 'SPECTER-FIXTURE-ONLY';
export const DIAGNOSTIC_MARKER = 'SPECTER-DIAGNOSTIC-ONLY';
export const OWN_API_ENTRY = '/apps/specter-arena/api/*';
export const AGENTS_API_ENTRY = '/api/agents';
export const CHAT_API_ENTRY = '/api/chat';
export const RELEASE_API_ENTRIES = [OWN_API_ENTRY, AGENTS_API_ENTRY, CHAT_API_ENTRY];
export const RELEASE_AGENTS = ['agents/specter-summoner.json'];
export const RELEASE_EVENTS = ['slots:user'];
export const DEFAULT_BUNDLE_DIR = 'ui/dist';
export const DEFAULT_DIAGNOSTIC_DIR = 'ui/diagnostic-dist';
export const DEFAULT_BACKEND_DIR = 'backend';
export const DEFAULT_MANIFEST = 'app.json';
export const DEFAULT_RELEASE_ROOTS = ['.', 'ui', 'backend'];

const HOST_MODULES_ASSIGNMENT = /__kirocrew_modules\s*(?:\.[\w$]+|\[[^\]]*\])?\s*=(?![=>])/;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * @param {string} text
 * @returns {string[]} reasons the text is fixture-contaminated
 */
export function findFixtureContent(text) {
  /** @type {string[]} */
  const reasons = [];
  if (text.includes(FIXTURE_MARKER)) reasons.push(`contains ${FIXTURE_MARKER}`);
  if (text.includes(DIAGNOSTIC_MARKER)) reasons.push(`contains ${DIAGNOSTIC_MARKER}`);
  if (HOST_MODULES_ASSIGNMENT.test(text)) reasons.push('assigns __kirocrew_modules');
  return reasons;
}

/**
 * @param {string} dir production bundle directory
 * @returns {{ file: string, reason: string }[]}
 */
export function scanBundle(dir) {
  return listFiles(dir).flatMap((path) =>
    findFixtureContent(readFileSync(path, 'utf8')).map((reason) => ({ file: relative(dir, path), reason })),
  );
}

const TEST_OR_FIXTURE_IMPORT = /^\s*(?:from\s+\S*\b(?:tests?|fixtures?)\b\S*\s+import|import\s+\S*\b(?:tests?|fixtures?)\b)/m;

/**
 * @param {string} text Python source
 * @returns {boolean} whether the module imports from a tests or fixtures module
 */
export function importsTestCode(text) {
  return TEST_OR_FIXTURE_IMPORT.test(text);
}

/**
 * The backend files Crew runs: `app.py` and the runtime package, never `tests/`.
 * @param {string} dir backend directory
 * @returns {string[]} paths relative to `dir`
 */
export function backendRuntimeFiles(dir) {
  const app = join(dir, 'app.py');
  const runtime = join(dir, 'specter_arena');
  return [
    ...(existsSync(app) ? [app] : []),
    ...(existsSync(runtime) ? listFiles(runtime) : []),
  ]
    .filter((path) => path.endsWith('.py'))
    .map((path) => relative(dir, path));
}

/**
 * @param {string} dir backend directory
 * @returns {{ file: string, reason: string }[]}
 */
export function scanBackend(dir) {
  return backendRuntimeFiles(dir)
    .filter((file) => importsTestCode(readFileSync(join(dir, file), 'utf8')))
    .map((file) => ({ file, reason: 'imports from a tests or fixtures module' }));
}

/**
 * @param {string} file
 * @param {string} key permissions key, for the message
 * @param {unknown} entries
 * @param {string[]} allowed
 * @returns {{ file: string, reason: string }[]}
 */
function scanEntries(file, key, entries, allowed) {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) return [{ file, reason: `release manifest permissions.${key} is not an array` }];
  /** @type {{ file: string, reason: string }[]} */
  const findings = [];
  entries.forEach((entry, index) => {
    if (!allowed.includes(entry) || entries.indexOf(entry) !== index) {
      findings.push({
        file,
        reason: `release manifest permissions.${key} entry ${JSON.stringify(entry)} is not allowed; only ${allowed.join(', ')}, each once (probe permissions belong in probe/manifest-overlay.json)`,
      });
    }
  });
  return findings;
}

/**
 * @param {string} file
 * @param {unknown} permissions
 * @returns {{ file: string, reason: string }[]}
 */
function scanPermissions(file, permissions) {
  if (permissions === undefined) return [];
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    return [{ file, reason: 'release manifest permissions is not an object' }];
  }
  const { api, events, ...others } = /** @type {Record<string, unknown>} */ (permissions);
  return [
    ...Object.keys(others).map((key) => ({
      file,
      reason: `release manifest declares permissions.${key} (probe permissions belong in probe/manifest-overlay.json)`,
    })),
    ...scanEntries(file, 'api', api, RELEASE_API_ENTRIES),
    ...scanEntries(file, 'events', events, RELEASE_EVENTS),
  ];
}

/**
 * The release manifest names exactly one app agent, and that agent has no tools, no MCP servers and no
 * `.mcp.json`: the summoner reads user-typed text and must not gain rights from it (FP-06-AC05).
 * @param {string} manifestPath app.json
 * @param {unknown} agents manifest `agents`
 * @returns {{ file: string, reason: string }[]}
 */
function scanAgents(manifestPath, agents) {
  if (agents === undefined) return [];
  const allowed = RELEASE_AGENTS.join(', ');
  if (!Array.isArray(agents) || agents.length !== RELEASE_AGENTS.length || agents.some((entry, index) => entry !== RELEASE_AGENTS[index])) {
    return [{ file: manifestPath, reason: `release manifest agents must be exactly [${allowed}]` }];
  }
  const agentPath = join(dirname(manifestPath), RELEASE_AGENTS[0] ?? '');
  if (!existsSync(agentPath)) return [{ file: manifestPath, reason: `release manifest agent file ${RELEASE_AGENTS[0]} not found` }];
  let agent;
  try {
    agent = JSON.parse(readFileSync(agentPath, 'utf8'));
  } catch {
    return [{ file: agentPath, reason: 'is not valid JSON' }];
  }
  /** @type {{ file: string, reason: string }[]} */
  const findings = [];
  if (!Array.isArray(agent?.tools) || agent.tools.length !== 0) findings.push({ file: agentPath, reason: 'agent must declare tools: []' });
  const servers = agent?.mcpServers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers) || Object.keys(servers).length !== 0) {
    findings.push({ file: agentPath, reason: 'agent must declare mcpServers: {}' });
  }
  if (agent?.includeMcpJson !== false) findings.push({ file: agentPath, reason: 'agent must declare includeMcpJson: false' });
  return findings;
}

/**
 * The release manifest may only point at the release bundle and declares only the release grants:
 * the app's own proxy namespace, `/api/agents`, `/api/chat` (summoning, FP-06+07) and the `slots:user` event.
 * Probe grants belong in probe/manifest-overlay.json.
 * @param {string} path app.json
 * @returns {{ file: string, reason: string }[]}
 */
export function scanManifest(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  /** @type {{ file: string, reason: string }[]} */
  const findings = [];
  if (text.includes(DIAGNOSTIC_MARKER)) findings.push({ file: path, reason: `contains ${DIAGNOSTIC_MARKER}` });
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return [...findings, { file: path, reason: 'is not valid JSON' }];
  }
  findings.push(...scanPermissions(path, manifest?.permissions));
  findings.push(...scanAgents(path, manifest?.agents));
  if (manifest?.backend?.hooks !== undefined) findings.push({ file: path, reason: 'release manifest declares backend.hooks' });
  /** @type {unknown[]} */
  const pages = Array.isArray(manifest?.ui?.pages) ? manifest.ui.pages : [];
  const refs = [manifest?.ui?.entry, ...pages.map((page) => /** @type {{ entryPoint?: unknown }} */ (page)?.entryPoint)];
  for (const ref of refs) {
    if (typeof ref !== 'string') continue;
    if (!ref.startsWith('dist/') || /diagnostic/i.test(ref)) findings.push({ file: path, reason: `ui reference ${ref} is not a release dist/ path` });
  }
  return findings;
}

/**
 * The probe switch file is written only into .probe-app/ by probe:stage; it must never be in the release tree.
 * @param {string[]} [roots]
 * @returns {{ file: string, reason: string }[]}
 */
export function scanReleaseTree(roots = DEFAULT_RELEASE_ROOTS) {
  return roots
    .map((root) => join(root, '.probe-enabled'))
    .filter((file) => existsSync(file))
    .map((file) => ({ file, reason: 'probe switch file present in the release tree' }));
}

/**
 * Positive control: the diagnostic build must still carry the marker, or the exclusion scan proves nothing.
 * @param {{ dir?: string, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function runPositiveControl({ dir = DEFAULT_DIAGNOSTIC_DIR, log = console.log } = {}) {
  if (!existsSync(dir)) {
    log(`check:diagnostic: ${dir} not found; run npm run build:diagnostic first`);
    return 1;
  }
  const carriers = listFiles(dir).filter((path) => readFileSync(path, 'utf8').includes(DIAGNOSTIC_MARKER));
  if (carriers.length === 0) {
    log(`check:diagnostic: ${dir} carries no ${DIAGNOSTIC_MARKER}; the exclusion check would be vacuous`);
    return 1;
  }
  log(`check:diagnostic: ${dir} carries ${DIAGNOSTIC_MARKER} in ${carriers.length} file(s)`);
  return 0;
}

/**
 * @param {{ dir?: string, backendDir?: string, manifest?: string, releaseRoots?: string[], log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({
  dir = DEFAULT_BUNDLE_DIR,
  backendDir = DEFAULT_BACKEND_DIR,
  manifest = DEFAULT_MANIFEST,
  releaseRoots = DEFAULT_RELEASE_ROOTS,
  log = console.log,
} = {}) {
  if (!existsSync(dir)) {
    log(`check:fixtures: ${dir} not found; run the production build first`);
    return 1;
  }
  const findings = [
    ...scanBundle(dir).map(({ file, reason }) => `${dir}/${file} ${reason}`),
    ...scanBackend(backendDir).map(({ file, reason }) => `${backendDir}/${file} ${reason}`),
    ...scanManifest(manifest).map(({ file, reason }) => `${file} ${reason}`),
    ...scanReleaseTree(releaseRoots).map(({ file, reason }) => `${file} ${reason}`),
  ];
  for (const finding of findings) log(`check:fixtures: ${finding}`);
  if (findings.length > 0) return 1;
  log(`check:fixtures: ${dir} and ${backendDir} runtime ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode =
    process.argv[2] === '--expect-diagnostic'
      ? runPositiveControl({ dir: process.argv[3] ?? DEFAULT_DIAGNOSTIC_DIR })
      : run({ dir: process.argv[2] ?? DEFAULT_BUNDLE_DIR });
}
