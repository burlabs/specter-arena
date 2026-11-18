// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import type { SceneAssetV1 } from '../src/contracts/types.ts';
import { sceneAssetPath } from '../src/host/paths.ts';
import { SCENE_ASSET_KEYS_SERVED, resetSceneAssetFixtures, sceneAssetResponse, setSceneAssetsFailing } from './scene-bodies.ts';

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
  it('serves the five keys, each valid under scene-asset.v1 with matching dimensions and length', async () => {
    expect(SCENE_ASSET_KEYS_SERVED).toEqual([
      'arena-map',
      'minion-patchling-sprite',
      'minion-patchbrute-sprite',
      'minion-patchling-portrait',
      'minion-patchbrute-portrait',
    ]);
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
