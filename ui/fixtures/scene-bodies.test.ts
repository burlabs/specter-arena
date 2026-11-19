// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import type { SceneAssetV1 } from '../src/contracts/types.ts';
import { sceneAssetPath } from '../src/host/paths.ts';
import roster from '../../backend/specter_arena/specters/heroes.json';
import { SCENE_ASSET_KEYS_SERVED, installSceneArt, installSceneFixture, resetSceneAssetFixtures, sceneAssetResponse, setSceneAssetsFailing } from './scene-bodies.ts';
import { solidPng } from './specter-bodies.ts';

const schemasDir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
const ajv = new Ajv({ strict: true });
for (const name of readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`${schemasDir}${name}`, 'utf8')) as object);
}
const sceneAsset = ajv.getSchema('urn:specter-arena:contract:scene-asset:v1');
const apiError = ajv.getSchema('urn:specter-arena:contract:api-error:v1');
if (sceneAsset === undefined || apiError === undefined) throw new Error('missing schema');

const get = async (key: string): Promise<Response> => {
  const pending = sceneAssetResponse(sceneAssetPath(key), 'GET');
  if (pending === null) throw new Error('not a scene-asset path');
  return pending;
};

afterEach(resetSceneAssetFixtures);

describe('scene-bodies', () => {
  const BASE_KEYS = ['arena-map', 'minion-patchling-sprite', 'minion-patchbrute-sprite', 'minion-patchling-portrait', 'minion-patchbrute-portrait'];
  const HERO_KEYS = roster.heroes.flatMap((hero) => [hero.spriteKey, hero.thumbnailKey]);

  it('serves 27 keys in the pinned order: the five base keys, then each hero sprite and thumbnail in roster order', () => {
    expect(SCENE_ASSET_KEYS_SERVED).toEqual([...BASE_KEYS, ...HERO_KEYS]);
    expect(SCENE_ASSET_KEYS_SERVED).toHaveLength(27);
  });

  it('serves every key, each valid under scene-asset.v1 with matching dimensions and length', async () => {
    for (const key of SCENE_ASSET_KEYS_SERVED) {
      const response = await get(key);
      expect(response.status).toBe(200);
      const body = (await response.json()) as SceneAssetV1;
      expect(sceneAsset(body), key).toBe(true);
      const bytes = Buffer.from(body.dataBase64, 'base64');
      expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(bytes.readUInt32BE(16)).toBe(body.width);
      expect(bytes.readUInt32BE(20)).toBe(body.height);
      expect(bytes.length).toBe(body.byteLength);
    }
  });

  it('serves the 22 hero keys at 512 px for a sprite and 96 px for a thumbnail', async () => {
    for (const key of HERO_KEYS) {
      const body = (await (await get(key)).json()) as SceneAssetV1;
      const side = key.endsWith('-sprite') ? 512 : 96;
      expect([body.width, body.height], key).toEqual([side, side]);
    }
  });

  it('replaces a key with registered art, reads its size from the PNG header and ignores keys it does not serve', async () => {
    installSceneArt({ 'hero-vell-sprite': `data:image/png;base64,${solidPng(1, 2, 3, 20, 10)}`, 'not-a-key': `data:image/png;base64,${solidPng(1, 2, 3)}` });
    const body = (await (await get('hero-vell-sprite')).json()) as SceneAssetV1;
    expect([body.width, body.height]).toEqual([20, 10]);
    expect((await get('not-a-key')).status).toBe(404);
    expect(sceneAsset(body)).toBe(true);
    const untouched = (await (await get('hero-vell-thumbnail')).json()) as SceneAssetV1;
    expect(untouched.width).toBe(96);
  });

  it('rejects registered art that is not a PNG', () => {
    expect(() => installSceneArt({ 'arena-map': 'data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).toThrow(TypeError);
  });

  it('serves a map-sized fixture of 1000 x 700 under the 4 MiB limit and above the 2,000,000-character guard, until reset', async () => {
    installSceneFixture('arena-map', 1000, 700);
    const body = (await (await get('arena-map')).json()) as SceneAssetV1;
    expect([body.width, body.height]).toEqual([1000, 700]);
    expect(body.byteLength).toBeLessThan(4_194_304);
    expect(body.dataBase64.length).toBeGreaterThan(2_000_000);
    expect(sceneAsset(body)).toBe(true);
    resetSceneAssetFixtures();
    expect(((await (await get('arena-map')).json()) as SceneAssetV1).width).toBe(160);
  });

  it('answers an unknown key 404 unknown_scene_asset, valid under api-error.v1', async () => {
    const response = await get('nope');
    expect(response.status).toBe(404);
    const body: unknown = await response.json();
    expect(body).toEqual({ contractVersion: 1, error: 'unknown_scene_asset' });
    expect(apiError(body)).toBe(true);
  });

  it('answers every key 404 while scene assets are set to fail, until reset', async () => {
    setSceneAssetsFailing(true);
    expect((await get('arena-map')).status).toBe(404);
    resetSceneAssetFixtures();
    expect((await get('arena-map')).status).toBe(200);
  });

  it('refuses a POST with 405 and falls through for any other path', async () => {
    const refused = sceneAssetResponse(sceneAssetPath('arena-map'), 'POST');
    expect((await refused)?.status).toBe(405);
    expect(sceneAssetResponse('/apps/specter-arena/api/portraits', 'GET')).toBeNull();
    expect(sceneAssetResponse('/apps/specter-arena/api/scene-assets', 'GET')).toBeNull();
  });
});
