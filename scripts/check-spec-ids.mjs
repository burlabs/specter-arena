import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REGISTRY_FILE = 'spec/ids.md';
export const SPECS_DIR = '.kiro/specs';
/** A spec id: FP01-REQ-01, FP0203-WL-2, or an acceptance criterion such as FP-02-AC04. */
export const SPEC_ID = /\b(?:FP\d{2,4}-(?:REQ|DEL|CI|WL)-\d+|FP-\d{2}-AC\d{2})\b/g;
const DEFINITION_ROW = /^\|\s*`?((?:FP\d{2,4}-(?:REQ|DEL|CI|WL)-\d+))`?\s*\|/;
const DEFINITION_BULLET = /^-\s+\*\*((?:FP-\d{2}-AC\d{2})):\*\*/;
const REGISTRY_ROW = /^\|\s*`([A-Z0-9-]+)`\s*\|[^|]*\|[^|]*\|\s*(\d+)-(\d+)\s*\|\s*(\w+)\s*\|/;

/**
 * @param {string} id
 * @returns {{ prefix: string, number: number }}
 */
export function splitId(id) {
  const match = /^(.*?)-?(\d+)$/.exec(id);
  return { prefix: match?.[1] ?? id, number: Number(match?.[2] ?? 0) };
}

/**
 * @param {string} markdown spec/ids.md
 * @returns {{ rows: Map<string, { min: number, max: number }>, problems: string[] }}
 */
export function parseRegistry(markdown) {
  /** @type {Map<string, { min: number, max: number }>} */
  const rows = new Map();
  /** @type {string[]} */
  const problems = [];
  for (const line of markdown.split('\n')) {
    const match = REGISTRY_ROW.exec(line);
    if (!match) continue;
    const [, prefix = '', min = '0', max = '0'] = match;
    if (rows.has(prefix)) problems.push(`${REGISTRY_FILE}: prefix ${prefix} is registered twice`);
    if (Number(min) > Number(max)) problems.push(`${REGISTRY_FILE}: prefix ${prefix} has an empty range ${min}-${max}`);
    rows.set(prefix, { min: Number(min), max: Number(max) });
  }
  return { rows, problems };
}

/**
 * Definitions are the first cell of a requirements table row or an acceptance-criterion bullet in a
 * requirements.md; every other occurrence of an id is a reference and must resolve to a definition.
 * @param {{ file: string, text: string }[]} documents all markdown under .kiro/specs
 * @param {Map<string, { min: number, max: number }>} registry
 * @returns {string[]} problems
 */
export function idProblems(documents, registry) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} */
  const defined = new Map();
  for (const { file, text } of documents) {
    if (!file.endsWith('/requirements.md')) continue;
    text.split('\n').forEach((line, index) => {
      const id = DEFINITION_ROW.exec(line)?.[1] ?? DEFINITION_BULLET.exec(line)?.[1];
      if (id === undefined) return;
      const where = `${file}:${index + 1}`;
      const earlier = defined.get(id);
      if (earlier !== undefined) problems.push(`${where}: ${id} is already defined at ${earlier}`);
      else defined.set(id, where);
      const { prefix, number } = splitId(id);
      const range = registry.get(prefix);
      if (range === undefined) problems.push(`${where}: prefix ${prefix} of ${id} is not registered in ${REGISTRY_FILE}`);
      else if (number < range.min || number > range.max) problems.push(`${where}: ${id} is outside the reserved range ${range.min}-${range.max}`);
    });
  }
  for (const { file, text } of documents) {
    const defines = file.endsWith('/requirements.md');
    text.split('\n').forEach((line, index) => {
      if (defines && (DEFINITION_ROW.test(line) || DEFINITION_BULLET.test(line))) return;
      for (const id of line.match(SPEC_ID) ?? []) {
        if (!defined.has(id)) problems.push(`${file}:${index + 1}: ${id} is referenced but defined in no requirements.md`);
      }
    });
  }
  return problems;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

/**
 * @param {{ root?: string, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ root = '.', log = console.log } = {}) {
  const registryPath = join(root, REGISTRY_FILE);
  if (!existsSync(registryPath)) {
    log(`check:spec-ids: ${REGISTRY_FILE} not found`);
    return 1;
  }
  const { rows, problems } = parseRegistry(readFileSync(registryPath, 'utf8'));
  const documents = markdownFiles(join(root, SPECS_DIR)).map((file) => ({ file: relative(root, file), text: readFileSync(file, 'utf8') }));
  problems.push(...idProblems(documents, rows));
  for (const problem of problems) log(`check:spec-ids: ${problem}`);
  if (problems.length > 0) return 1;
  log(`check:spec-ids: ${rows.size} prefix(es), ${documents.length} spec document(s) ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
