// @vitest-environment node
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_CACHE_ENTRIES } from './sceneAssetCache';

const SCENE_DIR = fileURLToPath(new URL('../../../backend/specter_arena/specters/scene/', import.meta.url));

describe('scene art cache bound', () => {
  it('holds every key the backend allowlist can serve, so a blob URL is never evicted and leaked', () => {
    const keys = readdirSync(SCENE_DIR).filter((name) => name.endsWith('.png'));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThanOrEqual(MAX_CACHE_ENTRIES);
  });
});
