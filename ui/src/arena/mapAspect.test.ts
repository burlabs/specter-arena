// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARENA_INTRINSIC } from './mapLayout';

describe('arena map', () => {
  it('has the aspect the layout coordinates were read from, within 1 %', () => {
    const png = readFileSync(fileURLToPath(new URL('../../../backend/specter_arena/specters/scene/arena-map.png', import.meta.url)));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(Math.abs(width / height / (ARENA_INTRINSIC.width / ARENA_INTRINSIC.height) - 1)).toBeLessThan(0.01);
  });
});
