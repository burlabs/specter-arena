import { describe, expect, it } from 'vitest';
import { avatarPackUrl } from './avatarPack';

describe('avatarPackUrl', () => {
  it('points at the hero pack file on the main branch', () => {
    expect(avatarPackUrl('bur')).toBe('https://github.com/burlabs/specter-arena/blob/main/avatar-packs/packs/specters-bur.pack.json');
    expect(avatarPackUrl('vell')).toBe('https://github.com/burlabs/specter-arena/blob/main/avatar-packs/packs/specters-vell.pack.json');
  });

  it('keeps an odd id inside the packs folder', () => {
    expect(avatarPackUrl('../x')).toBe('https://github.com/burlabs/specter-arena/blob/main/avatar-packs/packs/specters-..%2Fx.pack.json');
  });
});
