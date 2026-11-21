// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCollectorControl, parseDataLifecycle } from '../src/lifecycle/model.ts';
import { DATA_SCENARIO_NAMES, activeDataScenario, dataResponse, previewOf, resetDataFixtures, setDataScenario } from './data-bodies.ts';
import type { DataScenarioName } from './data-bodies.ts';

const PREFIX = '/apps/specter-arena/api';

interface Reply {
  status: number;
  body: any;
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> {
  const response = await dataResponse(`${PREFIX}${path}`, method, body);
  if (response === null) throw new Error(`not a data route: ${path}`);
  return { status: response.status, body: response.status === 404 ? null : await response.json() };
}

const open = (name: DataScenarioName) => setDataScenario(name);

beforeEach(() => resetDataFixtures());

describe('routing', () => {
  it('answers only the Data and collector routes', () => {
    expect(dataResponse(`${PREFIX}/roster`, 'GET')).toBeNull();
    expect(dataResponse(`${PREFIX}/data/other`, 'GET')).toBeNull();
  });

  it('refuses a method the route does not offer with the api-error shape', async () => {
    expect((await call('POST', '/data', {})).status).toBe(405);
    expect((await call('GET', '/data/retention')).status).toBe(405);
    expect((await call('GET', '/data/purge')).status).toBe(405);
  });

  it('defaults to data-none, honours the page URL name and treats `paused` as data-paused', () => {
    expect(activeDataScenario()).toBe('data-none');
    const win = globalThis as unknown as { window?: { location: { search: string } } };
    try {
      win.window = { location: { search: '?scenario=data-full' } };
      expect(activeDataScenario()).toBe('data-full');
      win.window = { location: { search: '?scenario=paused' } };
      expect(activeDataScenario()).toBe('data-paused');
      win.window = { location: { search: '?scenario=arena' } };
      expect(activeDataScenario()).toBe('data-none');
    } finally {
      delete win.window;
    }
  });
});

describe('every scenario seeds a body the UI parser accepts', () => {
  it.each(DATA_SCENARIO_NAMES.filter((name) => !['data-failure', 'data-offline', 'data-unsupported'].includes(name)))('%s', async (name) => {
    open(name);
    const reply = await call('GET', '/data');
    expect(reply.status).toBe(200);
    const data = parseDataLifecycle(reply.body);
    expect(data.uploads.cap).toBe(100);
    expect(data.exports.length).toBeLessThanOrEqual(20);
    expect(data.preview === null).toBe(data.retention.retentionDays === null);
  });

  it('forces the failure scenarios', async () => {
    open('data-failure');
    expect(await call('GET', '/data')).toMatchObject({ status: 503, body: { error: 'store_unavailable' } });
    open('data-unsupported');
    expect((await call('GET', '/data')).status).toBe(404);
    open('data-offline');
    await expect(call('GET', '/data')).rejects.toThrow('Failed to fetch');
  });
});

describe('retention', () => {
  it('saves a window, bumps the revision once and builds the preview from it', async () => {
    open('data-none');
    const saved = await call('POST', '/data/retention', { retentionDays: 30 });
    expect(saved.body.retention).toMatchObject({ retentionDays: 30, revision: 1 });
    expect(saved.body.preview).toEqual(previewOf(30));
    const again = await call('POST', '/data/retention', { retentionDays: 30 });
    expect(again.body.retention.revision).toBe(1);
    const cleared = await call('POST', '/data/retention', { retentionDays: null });
    expect(cleared.body.preview).toBeNull();
  });

  it.each([{}, { retentionDays: 7 }, { retentionDays: '30' }, { retentionDays: 30, extra: 1 }, null, []])('refuses the body %j', async (body) => {
    expect((await call('POST', '/data/retention', body)).body.error).toBe('invalid_body');
  });

  it('is busy while a purge runs', async () => {
    open('data-running');
    expect((await call('POST', '/data/retention', { retentionDays: 90 })).body.error).toBe('lifecycle_busy');
  });
});

describe('purge', () => {
  it('needs a saved window that equals the body and records the horizon', async () => {
    open('data-none');
    expect((await call('POST', '/data/purge', { retentionDays: 30 })).body.error).toBe('retention_not_set');
    await call('POST', '/data/retention', { retentionDays: 90 });
    expect((await call('POST', '/data/purge', { retentionDays: 30 })).body.error).toBe('retention_mismatch');
    expect((await call('POST', '/data/purge', { retentionDays: 7 })).body.error).toBe('invalid_body');
    expect((await call('POST', '/data/purge', {})).body.error).toBe('invalid_body');
    const done = await call('POST', '/data/purge', { retentionDays: 90 });
    expect(done.body.lastPurge).toMatchObject({ kind: 'purge', state: 'completed', cutoffMs: previewOf(90).cutoffMs });
    expect(done.body.lastPurge.deleted.observations).toBe(previewOf(90).observations);
    expect(done.body.horizonMs).toBe(previewOf(90).cutoffMs);
  });

  it('refuses while another run is open', async () => {
    open('data-running');
    expect((await call('POST', '/data/purge', { retentionDays: 30 })).body.error).toBe('lifecycle_busy');
  });
});

describe('export and cleanup', () => {
  it('writes an export newest first, capped at 20, and refuses a body', async () => {
    open('data');
    expect((await call('POST', '/data/export', { x: 1 })).body.error).toBe('invalid_body');
    let reply = await call('POST', '/data/export', {});
    expect(reply.body.lastExport.fileName).toMatch(/^export-v9-\d{8}T\d{12}Z\.db$/);
    expect(reply.body.exports[0].fileName).toBe(reply.body.lastExport.fileName);
    for (let index = 0; index < 25; index += 1) reply = await call('POST', '/data/export', {});
    expect(reply.body.exports).toHaveLength(20);
  });

  it('removes the unused uploads and reports how many', async () => {
    open('data');
    expect((await call('POST', '/data/asset-cleanup', { x: 1 })).body.error).toBe('invalid_body');
    const reply = await call('POST', '/data/asset-cleanup', {});
    expect(reply.body.uploads).toEqual({ stored: 9, cap: 100, unused: 0 });
    expect(reply.body.lastCleanup).toMatchObject({ kind: 'asset-cleanup', deleted: { assets: 3 } });
  });

  it('refuses both while a purge runs', async () => {
    open('data-running');
    expect((await call('POST', '/data/export', {})).body.error).toBe('lifecycle_busy');
    expect((await call('POST', '/data/asset-cleanup', {})).body.error).toBe('lifecycle_busy');
  });

  it.each([
    ['data-busy', 'POST', '/data/purge', { retentionDays: 90 }, 409, 'lifecycle_busy'],
    ['data-busy', 'POST', '/data/retention', { retentionDays: 30 }, 409, 'lifecycle_busy'],
    ['data-backup-failed', 'POST', '/data/purge', { retentionDays: 90 }, 500, 'backup_failed'],
    ['data-backup-failed', 'POST', '/data/asset-cleanup', {}, 500, 'backup_failed'],
    ['data-export-failed', 'POST', '/data/export', {}, 500, 'export_failed'],
  ] as const)('%s answers %s %s with %s %s', async (name, method, path, body, status, error) => {
    open(name);
    expect(await call(method, path, body)).toMatchObject({ status, body: { error } });
  });
});

describe('collector control', () => {
  it('is idempotent and its revision moves only on a change', async () => {
    open('data-none');
    const first = await call('POST', '/collector', { paused: true });
    expect(parseCollectorControl(first.body)).toMatchObject({ paused: true, revision: 1, state: 'paused' });
    const second = await call('POST', '/collector', { paused: true });
    expect(second.body).toEqual(first.body);
    expect((await call('GET', '/data')).body.paused).toBe(true);
    const resumed = await call('POST', '/collector', { paused: false });
    expect(resumed.body).toMatchObject({ paused: false, revision: 2, state: 'running' });
  });

  it.each([{}, { paused: 'yes' }, { paused: true, extra: 1 }, null])('refuses the body %j', async (body) => {
    expect((await call('POST', '/collector', body)).body.error).toBe('invalid_body');
  });

  it('is not blocked by a busy lifecycle', async () => {
    open('data-busy');
    expect((await call('POST', '/collector', { paused: true })).status).toBe(200);
  });
});

describe('fixture bodies validate against the contract schemas', () => {
  const schemasDir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
  const ajv = new Ajv({ strict: true });
  for (const name of readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(`${schemasDir}${name}`, 'utf8')) as object);
  }
  const validator = (name: string) => {
    const validate = ajv.getSchema(`urn:specter-arena:contract:${name}:v1`);
    if (validate === undefined) throw new Error(`no schema ${name}`);
    return validate;
  };
  const lifecycle = validator('data-lifecycle');
  const control = validator('collector-control');
  const valid = (body: unknown, check: typeof lifecycle) => expect(check(body), JSON.stringify(check.errors)).toBe(true);
  const SERVED = DATA_SCENARIO_NAMES.filter((name) => !['data-failure', 'data-offline', 'data-unsupported'].includes(name));

  it.each(SERVED)('GET /api/data in %s', async (name) => {
    open(name);
    valid((await call('GET', '/data')).body, lifecycle);
  });

  it.each(SERVED)('every write reply in %s that succeeds', async (name) => {
    open(name);
    const writes: Array<[string, unknown]> = [
      ['/data/retention', { retentionDays: 30 }],
      ['/data/retention', { retentionDays: null }],
      ['/data/retention', { retentionDays: 365 }],
      ['/data/purge', { retentionDays: 365 }],
      ['/data/export', {}],
      ['/data/export', {}],
      ['/data/asset-cleanup', {}],
    ];
    for (const [path, body] of writes) {
      const reply = await call('POST', path, body);
      if (reply.status === 200) valid(reply.body, lifecycle);
      else expect(reply.body).toMatchObject({ contractVersion: 1 });
    }
  });

  it.each(SERVED)('POST /api/collector in %s, pause then resume then repeat', async (name) => {
    open(name);
    for (const paused of [true, true, false, false]) valid((await call('POST', '/collector', { paused })).body, control);
  });

  it('a purge, a cleanup, a running and an interrupted run validate', async () => {
    open('data-none');
    await call('POST', '/data/retention', { retentionDays: 90 });
    valid((await call('POST', '/data/purge', { retentionDays: 90 })).body, lifecycle);
    for (const name of ['data-running', 'data-interrupted', 'data-full'] as const) {
      open(name);
      valid((await call('GET', '/data')).body, lifecycle);
    }
  });
});
