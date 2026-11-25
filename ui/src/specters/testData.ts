import type { HeroId, PortraitAssetV1, SpecterV3 } from '../contracts/types';

export const BINDING = `bnd_${'a'.repeat(20)}0001`;

export const portraitOf = (assetId = `ast_${'3'.repeat(24)}`, extra: Partial<PortraitAssetV1> = {}): PortraitAssetV1 => ({
  contractVersion: 1,
  assetId,
  mediaType: 'image/png',
  width: 256,
  height: 256,
  byteLength: 1000,
  origin: 'bundled',
  label: 'Vell (A01 roster art)',
  dataBase64: null,
  ...extra,
});

export const heroOf = (extra: Partial<SpecterV3> = {}): SpecterV3 => ({
  contractVersion: 3,
  bindingId: BINDING,
  version: 0,
  heroId: 'vell' satisfies HeroId,
  ordinal: 1,
  displayName: 'Vell',
  name: 'Vell',
  epithet: 'The caped one with the golden clasp',
  personality: 'Calm and a little formal.',
  appearance: 'Pale lavender, rounded ghost with a deep purple cape.',
  portrait: portraitOf(),
  avatarChosen: false,
  assignedBy: 'auto',
  source: 'roster',
  createdAtMs: 1,
  updatedAtMs: 1,
  ...extra,
});
