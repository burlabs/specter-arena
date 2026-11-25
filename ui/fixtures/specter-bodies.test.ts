// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { beforeEach, describe, expect, it } from 'vitest';
import roster from '../../backend/specter_arena/specters/heroes.json';
import { HERO_IDS } from '../src/contracts/types.ts';
import { SCENARIO_NAMES } from './monitoring-bodies.ts';
import {
  FIXTURE_BOT_COUNT,
  FIXTURE_UNASSIGNED_COUNT,
  SPECTER_SCENARIO_NAMES,
  activeSpecterScenario,
  displayNameOf,
  installPortraitArt,
  pngSize,
  resetSpecterFixtures,
  setSpecterScenario,
  solidPng,
  specterResponse,
} from './specter-bodies.ts';
import type { SpecterScenarioName } from './specter-bodies.ts';

const schemasDir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
const ajv = new Ajv({ strict: true });
for (const name of readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`${schemasDir}${name}`, 'utf8')) as object);
}
const validator = (name: string, version = 1) => {
  const validate = ajv.getSchema(`urn:specter-arena:contract:${name}:v${version}`);
  if (validate === undefined) throw new Error(`no schema ${name}`);
  return validate;
};

const PREFIX = '/apps/specter-arena/api';
const bindingOf = (n: number) => `bnd_${'a'.repeat(20)}${n.toString(16).padStart(4, '0')}`;
const NAMES = ['Vell', 'Stitch', 'Reeve', 'Rattle', 'Ember', 'Shard', 'Poly', 'Tide', 'Lume', 'Moss', 'bur'];

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const [pathname = '', query] = path.split('?');
  const response = await specterResponse(`${PREFIX}${pathname}`, method, body, query === undefined ? '' : `?${query}`);
  if (response === null) throw new Error(`not a specter route: ${path}`);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => resetSpecterFixtures());

describe('scenario names', () => {
  it('are unique, none is a monitoring scenario, and the retired ones are gone', () => {
    expect(new Set(SPECTER_SCENARIO_NAMES).size).toBe(SPECTER_SCENARIO_NAMES.length);
    for (const name of SPECTER_SCENARIO_NAMES) expect((SCENARIO_NAMES as readonly string[]).includes(name)).toBe(false);
    for (const retired of ['specters-empty', 'summon-failure', 'long-names']) expect(SPECTER_SCENARIO_NAMES as readonly string[]).not.toContain(retired);
  });

  it('defaults to specters-none and follows the override', () => {
    expect(activeSpecterScenario()).toBe('specters-none');
    setSpecterScenario('specters');
    expect(activeSpecterScenario()).toBe('specters');
  });

  it('serves nothing for paths that are not Specter routes, including the removed ones', () => {
    expect(specterResponse(`${PREFIX}/roster`, 'GET')).toBeNull();
    expect(specterResponse(`${PREFIX}/probe/run`, 'POST', {})).toBeNull();
    for (const [path, method] of [
      [`/specters/${bindingOf(1)}/summonings`, 'POST'],
      [`/specters/${bindingOf(1)}/manual`, 'POST'],
      [`/specters/${bindingOf(1)}/name`, 'POST'],
      [`/specters/${bindingOf(1)}/archive`, 'POST'],
      ['/summonings/req_1', 'GET'],
      ['/summonings/req_1/accept', 'POST'],
    ] as const) {
      expect(specterResponse(`${PREFIX}${path}`, method, {})).toBeNull();
    }
  });

  it('refuses the wrong method on a Specter route', async () => {
    expect((await call('POST', '/specters', {})).status).toBe(405);
  });
});

describe('the roster', () => {
  it('pins the eleven names and ids, and HERO_IDS equals the roster file', () => {
    expect(roster.heroes.map((hero) => hero.name)).toEqual(NAMES);
    expect(roster.heroes.map((hero) => hero.id)).toEqual([...HERO_IDS]);
  });

  it('composes display names the way the backend does', () => {
    expect(displayNameOf('Vell', 1)).toBe('Vell');
    expect(displayNameOf('Vell', 2)).toBe('Vell II');
    expect(displayNameOf('bur', 3)).toBe('bur III');
    expect(displayNameOf('Vell', 4)).toBe('Vell IV');
    expect(displayNameOf('Vell', 3999)).toBe('Vell MMMCMXCIX');
    expect(displayNameOf('Vell', 4000)).toBe('Vell 4000');
  });
});

describe.each(SPECTER_SCENARIO_NAMES)('%s bodies validate against the contracts', (scenario: SpecterScenarioName) => {
  it('serves specters.v2, each specter.v2 and the portraits list', async () => {
    setSpecterScenario(scenario);
    const list = await call('GET', '/specters');
    const check = validator('specters', 2);
    expect(check(list.body), JSON.stringify(check.errors)).toBe(true);
    expect(list.body.items).toHaveLength(FIXTURE_BOT_COUNT[scenario]);
    for (const item of list.body.items) {
      const one = await call('GET', `/specters/${item.bindingId}`);
      expect(validator('specter', 2)(one.body), JSON.stringify(validator('specter', 2).errors)).toBe(true);
    }
    const portraits = await call('GET', '/portraits');
    expect(portraits.body.items).toHaveLength(11);
    for (const item of portraits.body.items) expect(validator('portrait-asset')(item)).toBe(true);
  });
});

describe.each(SPECTER_SCENARIO_NAMES)('%s heroes body', (scenario: SpecterScenarioName) => {
  it('validates against heroes.v1 and agrees with the specters the scenario serves', async () => {
    setSpecterScenario(scenario);
    const heroes = await call('GET', '/heroes');
    const check = validator('heroes');
    expect(heroes.status).toBe(200);
    expect(check(heroes.body), JSON.stringify(check.errors)).toBe(true);
    expect(heroes.body.items.map((item: { heroId: string }) => item.heroId)).toEqual([...HERO_IDS]);
    const specters = (await call('GET', '/specters')).body.items as { heroId: string }[];
    for (const item of heroes.body.items as { heroId: string; assigned: boolean; assignedCount: number }[]) {
      expect(item.assignedCount, item.heroId).toBe(specters.filter((specter) => specter.heroId === item.heroId).length);
      expect(item.assigned).toBe(item.assignedCount > 0);
    }
    expect((heroes.body.items as { assignedCount: number }[]).reduce((sum, item) => sum + item.assignedCount, 0)).toBe(FIXTURE_BOT_COUNT[scenario]);
  });
});

describe('heroes body counts', () => {
  it('leaves four heroes unassigned with seven bots (the screenshot scenario) and none with 13', async () => {
    setSpecterScenario('specters');
    const seven = (await call('GET', '/heroes')).body.items as { heroId: string; assigned: boolean }[];
    expect(seven.filter((item) => !item.assigned).map((item) => item.heroId)).toEqual(['tide', 'lume', 'moss', 'bur']);
    setSpecterScenario('heroes-wrapped');
    const wrapped = (await call('GET', '/heroes')).body.items as { heroId: string; assignedCount: number }[];
    expect(wrapped.map((item) => item.assignedCount)).toEqual([2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('keeps every count after an avatar choice, because the hero never changes', async () => {
    setSpecterScenario('specters');
    const before = (await call('GET', '/heroes')).body;
    const bot = (await call('GET', '/specters')).body.items[0] as { bindingId: string };
    const portraits = (await call('GET', '/portraits')).body.items as { assetId: string }[];
    expect((await call('POST', `/specters/${bot.bindingId}/portrait`, { expectedVersion: 0, assetId: portraits[10]?.assetId })).status).toBe(200);
    expect((await call('GET', '/heroes')).body).toEqual(before);
  });

  it('refuses a write on the route and serves it with no bots as eleven zeros', async () => {
    expect((await call('POST', '/heroes', {})).status).toBe(405);
    setSpecterScenario('specters-none');
    const none = (await call('GET', '/heroes')).body.items as { assigned: boolean; assignedCount: number }[];
    expect(none).toHaveLength(11);
    expect(none.every((item) => !item.assigned && item.assignedCount === 0)).toBe(true);
  });
});

describe('assignment', () => {
  it('gives binding n hero (n-1) mod 11 at ordinal (n-1) div 11 + 1', async () => {
    setSpecterScenario('arena-perf-specters');
    const items = (await call('GET', '/specters')).body.items;
    expect(items.slice(0, 11).map((item: any) => item.name)).toEqual(NAMES);
    expect(items[11].displayName).toBe('Vell II');
    expect(items[11].ordinal).toBe(2);
    expect(items[19].displayName).toBe('Lume II');
    expect(items[0].bindingId).toBe(bindingOf(1));
    expect(items[10].displayName).toBe('bur');
  });

  it('gives the heroes-wrapped scenario a thirteenth bot named Stitch II', async () => {
    setSpecterScenario('heroes-wrapped');
    const items = (await call('GET', '/specters')).body.items;
    expect(items).toHaveLength(13);
    expect(items[12].displayName).toBe('Stitch II');
  });

  it('starts every hero on version 0 with its own portrait, except bot 2 in specters', async () => {
    setSpecterScenario('specters');
    const items = (await call('GET', '/specters')).body.items;
    expect(items).toHaveLength(7);
    expect(items.filter((item: any) => item.avatarChosen).map((item: any) => item.bindingId)).toEqual([bindingOf(2)]);
    expect(items[1].version).toBe(1);
    expect(items[0].version).toBe(0);
    expect(new Set(items.filter((item: any) => !item.avatarChosen).map((item: any) => item.portrait.assetId)).size).toBe(6);
  });

  it('keeps the bot counts the roster fixture expects', () => {
    expect(FIXTURE_BOT_COUNT['arena-perf-specters']).toBe(20);
    expect(FIXTURE_BOT_COUNT['specters-none']).toBe(0);
  });
});

describe('assets', () => {
  it('serves distinct bundled PNGs by id, and the asset body validates', async () => {
    const items = (await call('GET', '/portraits')).body.items;
    expect(new Set(items.map((item: any) => item.assetId)).size).toBe(11);
    const datas = new Set<string>();
    for (const item of items) {
      const asset = await call('GET', `/assets/${item.assetId}`);
      expect(validator('portrait-asset')(asset.body)).toBe(true);
      expect(atob(asset.body.dataBase64).startsWith('\u0089PNG')).toBe(true);
      datas.add(asset.body.dataBase64);
    }
    expect(datas.size).toBe(11);
  });

  it('fails every asset in asset-failed', async () => {
    setSpecterScenario('asset-failed');
    const items = (await call('GET', '/portraits')).body.items;
    expect((await call('GET', `/assets/${items[0].assetId}`)).status).toBe(404);
  });

  it('404s an unknown asset and an unknown binding', async () => {
    expect((await call('GET', '/assets/ast_nope')).body.error).toBe('unknown_asset');
    expect((await call('GET', `/specters/${bindingOf(1)}`)).body.error).toBe('unknown_binding');
  });

  it('rejects an upload that is not a PNG, is not base64, or is too large', async () => {
    expect((await call('POST', '/assets', { mediaType: 'image/jpeg', dataBase64: 'AAAA' })).status).toBe(415);
    expect((await call('POST', '/assets', { mediaType: 'image/png', dataBase64: '***' })).status).toBe(422);
    expect((await call('POST', '/assets', { mediaType: 'image/png', dataBase64: btoa('not a png!!') })).status).toBe(422);
    expect((await call('POST', '/assets', { mediaType: 'image/png', dataBase64: 'A'.repeat(1_398_105) })).status).toBe(413);
    expect((await call('POST', '/assets', { mediaType: 'image/png' })).status).toBe(400);
  });
});

describe('avatar', () => {
  const portraitPath = (n: number) => `/specters/${bindingOf(n)}/portrait`;

  async function upload(): Promise<string> {
    const portraits = (await call('GET', '/portraits')).body.items;
    const first = (await call('GET', `/assets/${portraits[3].assetId}`)).body;
    const response = await call('POST', '/assets', { mediaType: 'image/png', dataBase64: first.dataBase64, label: 'Mine' });
    return response.body.assetId;
  }

  it('choosing an asset bumps the version and sets avatarChosen', async () => {
    setSpecterScenario('specters');
    const portraits = (await call('GET', '/portraits')).body.items;
    const chosen = await call('POST', portraitPath(1), { expectedVersion: 0, assetId: portraits[5].assetId });
    expect(chosen.status).toBe(200);
    expect(chosen.body).toMatchObject({ version: 1, avatarChosen: true, name: 'Vell' });
    expect(chosen.body.portrait.assetId).toBe(portraits[5].assetId);
    expect(validator('specter', 2)(chosen.body)).toBe(true);
  });

  it('reset returns the hero portrait, never null, and avatarChosen false', async () => {
    setSpecterScenario('specters');
    const portraits = (await call('GET', '/portraits')).body.items;
    const reset = await call('POST', portraitPath(2), { expectedVersion: 1, assetId: null });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ version: 2, avatarChosen: false });
    expect(reset.body.portrait.assetId).toBe(portraits[1].assetId);
  });

  it('a same-avatar write is a no-op that does not bump the version', async () => {
    setSpecterScenario('specters');
    const same = await call('POST', portraitPath(1), { expectedVersion: 0, assetId: null });
    expect(same.body.version).toBe(0);
    const uploaded = await upload();
    await call('POST', portraitPath(1), { expectedVersion: 0, assetId: uploaded });
    const again = await call('POST', portraitPath(1), { expectedVersion: 1, assetId: uploaded });
    expect(again.body.version).toBe(1);
  });

  it('answers 409, 404 and 400 the way the backend does', async () => {
    setSpecterScenario('specters');
    expect((await call('POST', portraitPath(1), { expectedVersion: 4, assetId: null })).body.error).toBe('version_conflict');
    expect((await call('POST', portraitPath(1), { expectedVersion: 0, assetId: 'ast_' + '0'.repeat(24) })).body.error).toBe('unknown_asset');
    expect((await call('POST', portraitPath(99), { expectedVersion: 0, assetId: null })).body.error).toBe('unknown_binding');
    expect((await call('POST', '/specters/nope/portrait', { expectedVersion: 0, assetId: null })).body.error).toBe('unknown_binding');
    for (const body of [{}, { expectedVersion: 0 }, { expectedVersion: -1, assetId: null }, { expectedVersion: 0, assetId: 5 }, { expectedVersion: 0, assetId: null, x: 1 }]) {
      expect((await call('POST', portraitPath(1), body)).body.error, JSON.stringify(body)).toBe('invalid_body');
    }
  });
});

interface DecodedPng {
  width: number;
  height: number;
  colourType: number;
  blocks: Array<{ final: boolean; length: number }>;
  raw: Buffer;
  blocksEndAtTrailer: boolean;
}

function decodeStoredPng(base64: string): DecodedPng {
  const bytes = Buffer.from(base64, 'base64');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colourType = bytes.readUInt8(25);
  const idatLength = bytes.readUInt32BE(33);
  const idat = bytes.subarray(41, 41 + idatLength);
  const blocks: DecodedPng['blocks'] = [];
  let at = 2;
  while (at < idat.length - 4) {
    const length = idat.readUInt16LE(at + 1);
    expect(idat.readUInt16LE(at + 3)).toBe(~length & 0xffff);
    blocks.push({ final: (idat[at] ?? 0) === 1, length });
    at += 5 + length;
  }
  const raw = inflateSync(idat);
  return { width, height, colourType, blocks, raw, blocksEndAtTrailer: at === idat.length - 4 };
}

describe('solidPng', () => {
  it('keeps a small image in one final block, as before', () => {
    const png = decodeStoredPng(solidPng(10, 20, 30));
    expect([png.width, png.height, png.colourType]).toEqual([8, 8, 6]);
    expect(png.blocks).toEqual([{ final: true, length: 8 * 33 }]);
  });

  it.each([
    { width: 96, height: 96, blocks: 1 },
    { width: 512, height: 512, blocks: 17 },
    { width: 1000, height: 700, blocks: 43 },
  ])('builds $width x $height RGBA in $blocks stored blocks that inflate to every pixel', ({ width, height, blocks }) => {
    const encoded = solidPng(10, 20, 30, width, height);
    const png = decodeStoredPng(encoded);
    expect([png.width, png.height, png.colourType]).toEqual([width, height, 6]);
    expect(png.blocks).toHaveLength(blocks);
    expect(png.blocks.map((block) => block.final)).toEqual(png.blocks.map((_, index) => index === blocks - 1));
    expect(png.blocks.every((block) => block.length <= 0xffff)).toBe(true);
    expect(png.blocksEndAtTrailer).toBe(true);
    expect(png.raw.length).toBe((width * 4 + 1) * height);
    expect([...png.raw.subarray(0, 5)]).toEqual([0, 10, 20, 30, 255]);
    expect(pngSize(encoded)).toEqual({ width, height });
  });

  it('makes the 1000 x 700 map image fit the 4 MiB scene limit and exceed the 2,000,000-character guard', () => {
    const encoded = solidPng(24, 32, 48, 1000, 700);
    expect(Buffer.from(encoded, 'base64').length).toBeLessThan(4_194_304);
    expect(encoded.length).toBeGreaterThan(2_000_000);
  });

  it('refuses an image with no pixels', () => {
    expect(() => solidPng(0, 0, 0, 0, 4)).toThrow(RangeError);
    expect(() => solidPng(0, 0, 0, 4, 0)).toThrow(RangeError);
  });
});

describe('pngSize', () => {
  it('refuses data that is not a PNG', () => {
    expect(() => pngSize('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(TypeError);
  });
});

describe('installPortraitArt', () => {
  it('swaps a hero stand-in for real PNG data, reads its size, and is undone by reset', async () => {
    const before = await call('GET', '/portraits');
    installPortraitArt({ vell: `data:image/png;base64,${solidPng(9, 9, 9, 16, 16)}` });
    const after = await call('GET', '/portraits');
    expect(after.body.items).toHaveLength(11);
    expect(after.body.items[0].assetId).not.toBe(before.body.items[0].assetId);
    expect([after.body.items[0].width, after.body.items[0].height]).toEqual([16, 16]);
    expect(after.body.items[1].assetId).toBe(before.body.items[1].assetId);
    resetSpecterFixtures();
    expect((await call('GET', '/portraits')).body.items[0].assetId).toBe(before.body.items[0].assetId);
  });
});

describe('the assignment view', () => {
  const hero = (bindingId: string, heroId: string | null, expectedVersion = 0) => call('POST', `/specters/${bindingId}/hero`, { expectedVersion, heroId });
  // The v3 schemas ship with the backend change; when they are in contracts/schemas the bodies are checked against them too.
  const checkV3 = (name: 'specters' | 'specter', body: unknown) => {
    const validate = ajv.getSchema(`urn:specter-arena:contract:${name}:v3`);
    if (validate !== undefined) expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  };

  it('serves specters.v3 with the unassigned ids, oldest binding first, in a list of their own', async () => {
    setSpecterScenario('specters-unassigned');
    const list = await call('GET', '/specters?view=assignment');
    expect(list.status).toBe(200);
    checkV3('specters', list.body);
    expect(list.body.contractVersion).toBe(3);
    expect(list.body.items.map((item: any) => item.displayName)).toEqual(['Vell', 'Stitch', 'Reeve']);
    expect(list.body.items.every((item: any) => item.contractVersion === 3 && item.assignedBy === 'auto')).toBe(true);
    expect(list.body.unassignedBindingIds).toEqual([4, 5, 6, 7].map(bindingOf));
    expect(FIXTURE_UNASSIGNED_COUNT['specters-unassigned']).toBe(4);
    expect(FIXTURE_BOT_COUNT['specters-unassigned'] + FIXTURE_UNASSIGNED_COUNT['specters-unassigned']).toBe(7);
  });

  it('keeps the plain routes on v2 bodies and refuses another view', async () => {
    setSpecterScenario('specters-unassigned');
    const v2 = await call('GET', '/specters');
    expect(v2.body.contractVersion).toBe(2);
    expect(v2.body.items).toHaveLength(3);
    expect(v2.body.items[0]).not.toHaveProperty('assignedBy');
    expect((await call('GET', '/specters?view=other')).body).toEqual({ contractVersion: 1, error: 'invalid_view' });
    expect((await call('GET', `/specters/${bindingOf(1)}?view=other`)).status).toBe(400);
  });

  it('serves every other scenario with an empty unassigned list', async () => {
    for (const scenario of SPECTER_SCENARIO_NAMES.filter((name) => FIXTURE_UNASSIGNED_COUNT[name] === 0)) {
      setSpecterScenario(scenario);
      const list = await call('GET', '/specters?view=assignment');
      expect(list.body.unassignedBindingIds, scenario).toEqual([]);
      expect(list.body.items, scenario).toHaveLength(FIXTURE_BOT_COUNT[scenario]);
    }
  });

  it('reads one binding as v3, and says no_hero for an unassigned one and unknown_binding for a stranger', async () => {
    setSpecterScenario('specters-unassigned');
    const one = await call('GET', `/specters/${bindingOf(1)}?view=assignment`);
    checkV3('specter', one.body);
    expect(one.body).toMatchObject({ contractVersion: 3, assignedBy: 'auto', name: 'Vell' });
    expect(await call('GET', `/specters/${bindingOf(4)}?view=assignment`)).toMatchObject({ status: 404, body: { error: 'no_hero' } });
    expect(await call('GET', `/specters/${bindingOf(4)}`)).toMatchObject({ status: 404, body: { error: 'unknown_binding' } });
    expect(await call('GET', `/specters/${bindingOf(9)}?view=assignment`)).toMatchObject({ status: 404, body: { error: 'unknown_binding' } });
  });

  it('assigns the hero asked for once, then replays the same request as the same Specter', async () => {
    setSpecterScenario('specters-unassigned');
    const first = await hero(bindingOf(4), 'tide');
    expect(first.status).toBe(200);
    checkV3('specter', first.body);
    expect(first.body).toMatchObject({ contractVersion: 3, heroId: 'tide', ordinal: 1, displayName: 'Tide', version: 0, assignedBy: 'picked', avatarChosen: false });
    const replay = await hero(bindingOf(4), 'tide', 3);
    expect(replay).toEqual(first);
    const list = await call('GET', '/specters?view=assignment');
    expect(list.body.items).toHaveLength(4);
    expect(list.body.unassignedBindingIds).toEqual([5, 6, 7].map(bindingOf));
  });

  it('answers 409 with no state for a different hero or a random request on an assigned bot, and 409 for a stale version', async () => {
    setSpecterScenario('specters-unassigned');
    expect(await hero(bindingOf(1), 'tide')).toEqual({ status: 409, body: { contractVersion: 1, error: 'version_conflict' } });
    expect((await hero(bindingOf(1), null)).status).toBe(409);
    expect((await hero(bindingOf(4), 'tide', 2)).status).toBe(409);
    expect((await hero(bindingOf(1), 'vell')).status).toBe(200);
  });

  it('picks the least held hero for random, and gives a second holder the next ordinal', async () => {
    setSpecterScenario('specters-all-unassigned');
    const names: string[] = [];
    for (let n = 1; n <= 7; n += 1) {
      const result = await hero(bindingOf(n), null);
      expect(result.body.assignedBy).toBe('random');
      names.push(result.body.name);
    }
    expect(names).toEqual(NAMES.slice(0, 7));
    setSpecterScenario('specters-unassigned');
    const second = await hero(bindingOf(4), 'vell');
    expect(second.body).toMatchObject({ ordinal: 2, displayName: 'Vell II' });
    const heroes = (await call('GET', '/heroes')).body.items as { heroId: string; assignedCount: number }[];
    expect(heroes.find((item) => item.heroId === 'vell')?.assignedCount).toBe(2);
  });

  it('refuses malformed bodies, unknown heroes and strangers', async () => {
    setSpecterScenario('specters-unassigned');
    const bad = (body: unknown) => call('POST', `/specters/${bindingOf(4)}/hero`, body);
    for (const body of [null, [], {}, { heroId: 'vell' }, { expectedVersion: 0 }, { expectedVersion: 0, heroId: 'vell', extra: 1 }, { expectedVersion: -1, heroId: 'vell' }, { expectedVersion: 0, heroId: 'nobody' }, { expectedVersion: 0, heroId: 7 }]) {
      expect((await bad(body)).body, JSON.stringify(body)).toEqual({ contractVersion: 1, error: 'invalid_body' });
    }
    expect((await call('POST', `/specters/${bindingOf(9)}/hero`, { expectedVersion: 0, heroId: null })).body.error).toBe('unknown_binding');
    expect((await call('POST', '/specters/not-a-binding/hero', { expectedVersion: 0, heroId: null })).body.error).toBe('unknown_binding');
    expect((await call('GET', `/specters/${bindingOf(4)}/hero`)).status).toBe(405);
  });

  it('fails every assignment with 503 in specters-assign-fail and leaves the bots unassigned', async () => {
    setSpecterScenario('specters-assign-fail');
    expect(await hero(bindingOf(4), 'vell')).toEqual({ status: 503, body: { contractVersion: 1, error: 'store_unavailable' } });
    expect((await call('GET', '/specters?view=assignment')).body.unassignedBindingIds).toHaveLength(4);
  });

  it('answers the avatar route with no_hero for an unassigned bot, and keeps its v2 body for an assigned one', async () => {
    setSpecterScenario('specters-unassigned');
    expect((await call('POST', `/specters/${bindingOf(4)}/portrait`, { expectedVersion: 0, assetId: null })).body.error).toBe('no_hero');
    const portraits = (await call('GET', '/portraits')).body.items as { assetId: string }[];
    const changed = await call('POST', `/specters/${bindingOf(1)}/portrait`, { expectedVersion: 0, assetId: portraits[5]?.assetId });
    expect(changed.body.contractVersion).toBe(2);
    expect(changed.body).not.toHaveProperty('assignedBy');
    const v3 = (await call('GET', `/specters/${bindingOf(1)}?view=assignment`)).body;
    expect(v3).toMatchObject({ contractVersion: 3, version: 1, avatarChosen: true, assignedBy: 'auto' });
  });
});
