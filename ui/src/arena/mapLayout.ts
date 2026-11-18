import type { NormalizedPoint } from './geometry';

export interface MapPoint extends NormalizedPoint {
  id: string;
  label: string;
}

export interface MapPath {
  id: string;
  points: readonly NormalizedPoint[];
}

export const ARENA_INTRINSIC = { width: 1672, height: 941 } as const;

/**
 * Anchors read off the supplied 1672 x 941 painting, in 0..1 coordinates with the origin at the top left.
 * They select baked-in features of the art; none of them names a role, a team or a lane.
 */
export const ARENA_LAYOUT = {
  alliedBase: { id: 'allied-base', x: 0.16208133971291866, y: 0.711996, label: 'Allied base' },
  farBase: { id: 'far-base', x: 0.8205741626794258, y: 0.1594048884165781, label: 'Far base' },
  paths: [
    {
      id: 'path-1',
      points: [
        { x: 0.24043062200956938, y: 0.6354941551540914 },
        { x: 0.17763157894736842, y: 0.5217853347502657 },
        { x: 0.2326555023923445, y: 0.38575982996811903 },
        { x: 0.42105263157894735, y: 0.27948990435706694 },
        { x: 0.5927033492822966, y: 0.16046758767268862 },
        { x: 0.7440191387559809, y: 0.18703506907545164 },
      ],
    },
    {
      id: 'path-2',
      points: [
        { x: 0.24043062200956938, y: 0.6354941551540914 },
        { x: 0.3576555023923445, y: 0.5429968119022317 },
        { x: 0.520933014354067, y: 0.4197662061636557 },
        { x: 0.6441387559808612, y: 0.3007438894792774 },
        { x: 0.7440191387559809, y: 0.18703506907545164 },
      ],
    },
    {
      id: 'path-3',
      points: [
        { x: 0.24043062200956938, y: 0.6354941551540914 },
        { x: 0.4216507177033493, y: 0.7481402763018066 },
        { x: 0.6046650717703349, y: 0.5589798087141339 },
        { x: 0.7488038277511961, y: 0.5111583421891605 },
        { x: 0.7864832535885168, y: 0.32201912858660997 },
        { x: 0.7440191387559809, y: 0.18703506907545164 },
      ],
    },
  ] satisfies readonly MapPath[],
  clearings: [
    { id: 'west-clearing', x: 0.32954545454545453, y: 0.4208289054197662, label: 'West clearing' },
    { id: 'east-clearing', x: 0.6644736842105263, y: 0.4570669500531349, label: 'East clearing' },
    { id: 'south-grove', x: 0.48086124401913877, y: 0.6365568544102019, label: 'South grove' },
  ] satisfies readonly MapPoint[],
  crossings: [
    { id: 'upper-bridge', x: 0.42105263157894735, y: 0.27948990435706694, label: 'Upper bridge' },
    { id: 'central-bridge', x: 0.520933014354067, y: 0.4197662061636557, label: 'Central bridge' },
    { id: 'lower-bridge', x: 0.6046650717703349, y: 0.5589798087141339, label: 'Lower bridge' },
  ] satisfies readonly MapPoint[],
} as const;
