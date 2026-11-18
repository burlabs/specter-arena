// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCENARIO_NAMES, rosterBody } from './monitoring-bodies.ts';
import {
  SPECTER_SCENARIO_NAMES,
  activeSpecterScenario,
  resetSpecterFixtures,
  setSpecterScenario,
  specterResponse,
} from './specter-bodies.ts';
import type { SpecterScenarioName } from './specter-bodies.ts';

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

const PREFIX = '/apps/specter-arena/api';
const ATLAS = rosterBody('default').items[0]?.bindingId ?? '';
const BRINDLE = rosterBody('default').items[1]?.bindingId ?? '';
const REQ = (n: number) => `req_${String(n).padStart(24, '0')}`;

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await specterResponse(`${PREFIX}${path}`, method, body);
  if (response === null) throw new Error(`not a specter route: ${path}`);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => resetSpecterFixtures());

describe('scenario names', () => {
  it('are unique and none is a monitoring scenario', () => {
    expect(new Set(SPECTER_SCENARIO_NAMES).size).toBe(SPECTER_SCENARIO_NAMES.length);
    for (const name of SPECTER_SCENARIO_NAMES) expect((SCENARIO_NAMES as readonly string[]).includes(name)).toBe(false);
  });

  it('defaults to specters-none and follows the override', () => {
    expect(activeSpecterScenario()).toBe('specters-none');
    setSpecterScenario('specters');
    expect(activeSpecterScenario()).toBe('specters');
  });

  it('serves nothing for paths that are not Specter routes', () => {
    expect(specterResponse(`${PREFIX}/roster`, 'GET')).toBeNull();
    expect(specterResponse(`${PREFIX}/probe/run`, 'POST', {})).toBeNull();
  });

  it('refuses the wrong method on a Specter route', async () => {
    expect((await call('POST', '/specters', {})).status).toBe(405);
  });
});

describe.each(SPECTER_SCENARIO_NAMES)('%s bodies validate against the contracts', (scenario: SpecterScenarioName) => {
  it('serves specters.v1, each specter.v1 and the portraits list', async () => {
    setSpecterScenario(scenario);
    const list = await call('GET', '/specters');
    expect(validator('specters')(list.body), JSON.stringify(validator('specters').errors)).toBe(true);
    for (const item of list.body.items) {
      const one = await call('GET', `/specters/${item.bindingId}`);
      expect(validator('specter')(one.body)).toBe(true);
    }
    const portraits = await call('GET', '/portraits');
    expect(portraits.body.items).toHaveLength(3);
    for (const item of portraits.body.items) expect(validator('portrait-asset')(item)).toBe(true);
  });
});

describe('seeds', () => {
  it.each([
    ['specters-none', 0],
    ['specters-empty', 0],
    ['specters', 3],
    ['summon-failure', 1],
    ['asset-failed', 1],
    ['long-names', 2],
  ] as const)('%s lists %i Specters', async (scenario, count) => {
    setSpecterScenario(scenario);
    expect((await call('GET', '/specters')).body.items).toHaveLength(count);
  });

  it('gives the three seeded Specters distinct ids, a portrait, a token and long text', async () => {
    setSpecterScenario('specters');
    const items = (await call('GET', '/specters')).body.items;
    expect(new Set(items.map((item: any) => item.specterId)).size).toBe(3);
    expect(items.filter((item: any) => item.portrait === null)).toHaveLength(1);
    expect(new Set(items.filter((item: any) => item.portrait).map((item: any) => item.portrait.assetId)).size).toBe(2);
    expect(items[2].profile.personality.length).toBeGreaterThan(300);
  });

  it('gives long-names a 40-character unbroken name and a 60-character epithet', async () => {
    setSpecterScenario('long-names');
    const first = (await call('GET', '/specters')).body.items[0];
    expect(first.profile.name).toHaveLength(40);
    expect(first.profile.epithet).toHaveLength(60);
    expect(first.profile.name).not.toMatch(/\s/);
  });

  it('serves distinct bundled PNGs by id, and the asset body validates', async () => {
    const items = (await call('GET', '/portraits')).body.items;
    expect(new Set(items.map((item: any) => item.assetId)).size).toBe(3);
    const datas = new Set<string>();
    for (const item of items) {
      const asset = await call('GET', `/assets/${item.assetId}`);
      expect(validator('portrait-asset')(asset.body)).toBe(true);
      expect(atob(asset.body.dataBase64).startsWith('\u0089PNG')).toBe(true);
      datas.add(asset.body.dataBase64);
    }
    expect(datas.size).toBe(3);
  });

  it('fails every asset in asset-failed', async () => {
    setSpecterScenario('asset-failed');
    const items = (await call('GET', '/portraits')).body.items;
    expect((await call('GET', `/assets/${items[0].assetId}`)).status).toBe(404);
  });

  it('404s an unknown asset, an unknown specter and an unknown request', async () => {
    expect((await call('GET', '/assets/ast_nope')).body.error).toBe('unknown_asset');
    expect((await call('GET', `/specters/${ATLAS}`)).body.error).toBe('no_specter');
    expect((await call('GET', `/summonings/${REQ(1)}`)).body.error).toBe('unknown_request');
  });
});

describe('summoning lifecycle', () => {
  const start = (n: number, body: Record<string, unknown> = {}) => call('POST', `/specters/${ATLAS}/summonings`, { requestId: REQ(n), ...body });

  it('advances queued, running, ready by poll count and validates every step', async () => {
    const created = await start(1);
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('queued');
    expect(validator('summoning')(created.body)).toBe(true);
    const running = await call('GET', `/summonings/${REQ(1)}`);
    expect(running.body.status).toBe('running');
    expect(running.body.budget.bindingRemaining).toBe(4);
    const ready = await call('GET', `/summonings/${REQ(1)}`);
    expect(ready.body.status).toBe('ready');
    expect(validator('summoning')(ready.body)).toBe(true);
    expect((await call('GET', `/summonings/${REQ(1)}`)).body.status).toBe('ready');
  });

  it('is idempotent on requestId', async () => {
    await start(1);
    const again = await start(1);
    expect(again.status).toBe(200);
    expect(again.body.requestId).toBe(REQ(1));
  });

  it('allows one request in flight per bot, and a budget of five', async () => {
    await start(1);
    expect((await start(2)).body.error).toBe('generation_in_flight');
    for (let n = 1; n <= 5; n += 1) {
      if (n > 1) await start(n);
      await call('GET', `/summonings/${REQ(n)}`);
      await call('GET', `/summonings/${REQ(n)}`);
    }
    const sixth = await start(6);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('budget_exhausted');
  });

  it('rejects a bad binding and a bad body', async () => {
    expect((await call('POST', '/specters/nope/summonings', { requestId: REQ(1) })).body.error).toBe('unknown_binding');
    expect((await call('POST', `/specters/${ATLAS}/summonings`, { requestId: 'x' })).body.error).toBe('invalid_body');
    expect((await call('POST', `/specters/${ATLAS}/summonings`, null)).body.error).toBe('invalid_body');
  });

  it('fails with a timeout in summon-failure', async () => {
    setSpecterScenario('summon-failure');
    await start(1);
    await call('GET', `/summonings/${REQ(1)}`);
    const failed = await call('GET', `/summonings/${REQ(1)}`);
    expect(failed.body).toMatchObject({ status: 'failed', error: 'timeout' });
    expect(validator('summoning')(failed.body)).toBe(true);
  });

  it('cancels, including a ready candidate, and leaves a finished request alone', async () => {
    await start(1);
    expect((await call('POST', `/summonings/${REQ(1)}/cancel`, {})).body.status).toBe('cancelled');
    expect((await call('GET', `/summonings/${REQ(1)}`)).body.status).toBe('cancelled');
    expect((await call('POST', `/summonings/${REQ(1)}/cancel`, {})).body.status).toBe('cancelled');
    expect((await call('POST', `/summonings/${REQ(9)}/cancel`, {})).body.error).toBe('unknown_request');
  });

  it('accepts with the expected version, rejects stale and not-ready, and supersedes other candidates', async () => {
    await start(1);
    expect((await call('POST', `/summonings/${REQ(1)}/accept`, { expectedVersion: 0 })).body.error).toBe('not_ready');
    await call('GET', `/summonings/${REQ(1)}`);
    await call('GET', `/summonings/${REQ(1)}`);
    expect((await call('POST', `/summonings/${REQ(1)}/accept`, { expectedVersion: 4 })).body.error).toBe('version_conflict');
    expect((await call('POST', `/summonings/${REQ(1)}/accept`, { expectedVersion: -1 })).body.error).toBe('invalid_body');
    const accepted = await call('POST', `/summonings/${REQ(1)}/accept`, { expectedVersion: 0 });
    expect(accepted.status).toBe(200);
    expect(accepted.body.version).toBe(1);
    expect(validator('specter')(accepted.body)).toBe(true);
    expect((await call('GET', `/summonings/${REQ(1)}`)).body.status).toBe('accepted');
    expect((await call('POST', `/summonings/${REQ(9)}/accept`, { expectedVersion: 0 })).body.error).toBe('unknown_request');

    await start(2);
    await call('GET', `/summonings/${REQ(2)}`);
    await call('GET', `/summonings/${REQ(2)}`);
    const reroll = await call('POST', `/summonings/${REQ(2)}/accept`, { expectedVersion: 1 });
    expect(reroll.body.version).toBe(2);
    expect(reroll.body.specterId).toBe(accepted.body.specterId);
  });

  it('applies keep from the current Specter on a reroll', async () => {
    setSpecterScenario('specters');
    await start(1, { keep: ['name', 7] });
    await call('GET', `/summonings/${REQ(1)}`);
    const ready = await call('GET', `/summonings/${REQ(1)}`);
    expect(ready.body.candidate.name).toBe('Vesper');
    expect(validator('summoning')(ready.body)).toBe(true);
  });
});

describe('writes', () => {
  const hand = (name = 'Hand') => ({
    contractVersion: 1,
    name,
    epithet: null,
    personality: 'p',
    appearance: 'a',
    mannerism: 'm',
    signatureAction: null,
    assignmentRationale: 'r',
    artBrief: 'b',
  });

  it('saves a manual profile as source manual, and checks the profile and the version', async () => {
    const saved = await call('POST', `/specters/${BRINDLE}/manual`, { expectedVersion: 0, profile: hand() });
    expect(saved.body).toMatchObject({ source: 'manual', promptVersion: null, version: 1 });
    expect(validator('specter')(saved.body)).toBe(true);
    expect((await call('POST', `/specters/${BRINDLE}/manual`, { expectedVersion: 0, profile: hand() })).body.error).toBe('version_conflict');
    expect((await call('POST', `/specters/${BRINDLE}/manual`, { expectedVersion: 1, profile: { ...hand(), name: '' } })).body.error).toBe('invalid_body');
    expect((await call('POST', `/specters/${BRINDLE}/manual`, { expectedVersion: 1, profile: { ...hand(), epithet: 'x'.repeat(61) } })).body.error).toBe('invalid_body');
    expect((await call('POST', '/specters/bad/manual', { expectedVersion: 0, profile: hand() })).status).toBe(404);
    expect((await call('POST', `/specters/${BRINDLE}/manual`, 'no')).body.error).toBe('invalid_body');
  });

  it('renames, clears and sets the epithet, and needs a Specter', async () => {
    expect((await call('POST', `/specters/${BRINDLE}/name`, { expectedVersion: 0, name: 'X' })).body.error).toBe('no_specter');
    await call('POST', `/specters/${BRINDLE}/manual`, { expectedVersion: 0, profile: hand() });
    const renamed = await call('POST', `/specters/${BRINDLE}/name`, { expectedVersion: 1, name: 'Renamed', epithet: 'The Second' });
    expect(renamed.body.profile).toMatchObject({ name: 'Renamed', epithet: 'The Second' });
    expect(renamed.body.version).toBe(2);
    const kept = await call('POST', `/specters/${BRINDLE}/name`, { expectedVersion: 2, name: 'Again' });
    expect(kept.body.profile.epithet).toBe('The Second');
    expect((await call('POST', `/specters/${BRINDLE}/name`, { expectedVersion: 3, name: '' })).body.error).toBe('invalid_body');
  });

  it('sets, clears and rejects portraits', async () => {
    await call('POST', `/specters/${BRINDLE}/manual`, { expectedVersion: 0, profile: hand() });
    const first = (await call('GET', '/portraits')).body.items[0];
    const set = await call('POST', `/specters/${BRINDLE}/portrait`, { expectedVersion: 1, assetId: first.assetId });
    expect(set.body.portrait.assetId).toBe(first.assetId);
    expect(set.body.portrait.dataBase64).toBeNull();
    const cleared = await call('POST', `/specters/${BRINDLE}/portrait`, { expectedVersion: 2, assetId: null });
    expect(cleared.body.portrait).toBeNull();
    expect((await call('POST', `/specters/${BRINDLE}/portrait`, { expectedVersion: 3, assetId: 'ast_nope' })).body.error).toBe('unknown_asset');
    expect((await call('POST', `/specters/${BRINDLE}/portrait`, { expectedVersion: 3, assetId: 4 })).body.error).toBe('unknown_asset');
    expect((await call('POST', `/specters/${ATLAS}/portrait`, { expectedVersion: 0, assetId: null })).body.error).toBe('no_specter');
  });

  it('archives with the right version only', async () => {
    expect((await call('POST', `/specters/${BRINDLE}/archive`, { expectedVersion: 0 })).body.error).toBe('no_specter');
    await call('POST', `/specters/${BRINDLE}/manual`, { expectedVersion: 0, profile: hand() });
    expect((await call('POST', `/specters/${BRINDLE}/archive`, { expectedVersion: 9 })).body.error).toBe('version_conflict');
    expect((await call('POST', `/specters/${BRINDLE}/archive`, {})).body.error).toBe('invalid_body');
    expect((await call('POST', '/specters/bad/archive', { expectedVersion: 1 })).status).toBe(404);
    expect((await call('POST', `/specters/${BRINDLE}/archive`, { expectedVersion: 1 })).body).toEqual({ contractVersion: 1, archived: true });
    expect((await call('GET', '/specters')).body.items).toHaveLength(0);
  });

  it('accepts a PNG upload and rejects other media, bad bytes and oversize', async () => {
    const png = btoa('\u0089PNG\r\n\u001a\n-rest');
    const uploaded = await call('POST', '/assets', { mediaType: 'image/png', dataBase64: png, label: 'Mine' });
    expect(uploaded.status).toBe(201);
    expect(validator('portrait-asset')(uploaded.body)).toBe(true);
    expect(uploaded.body.origin).toBe('uploaded');
    expect((await call('GET', `/assets/${uploaded.body.assetId}`)).body.dataBase64).toBe(png);
    expect((await call('GET', '/portraits')).body.items).toHaveLength(4);
    const unnamed = await call('POST', '/assets', { mediaType: 'image/png', dataBase64: png });
    expect(unnamed.body.label).toBe('Uploaded portrait');
    expect((await call('POST', '/assets', { mediaType: 'image/png', dataBase64: btoa('plain text') })).body.error).toBe('invalid_image');
    expect((await call('POST', '/assets', { mediaType: 'image/png', dataBase64: '***' })).body.error).toBe('invalid_image');
    expect((await call('POST', '/assets', { mediaType: 'image/gif', dataBase64: png })).body.error).toBe('unsupported_media');
    expect((await call('POST', '/assets', { mediaType: 'image/png', dataBase64: 'A'.repeat(1_398_105) })).body.error).toBe('asset_too_large');
    expect((await call('POST', '/assets', { mediaType: 'image/png' })).body.error).toBe('invalid_body');
  });
});
