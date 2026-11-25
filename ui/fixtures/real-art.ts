// SPECTER-FIXTURE-ONLY: real bundled art for the preview harness only; never imported by ui/src or unit tests.
import { installSceneArt } from './scene-bodies.ts';
import { installPortraitArt } from './specter-bodies.ts';

const SCENE_GLOB = import.meta.glob('../../backend/specter_arena/specters/scene/*.png', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;
const PORTRAIT_GLOB = import.meta.glob('../../backend/specter_arena/specters/art/*.png', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;

const PORTRAIT_PREFIX = 'portrait-';
const stem = (path: string): string => (path.split('/').pop() ?? path).replace(/\.png$/, '');

/** Scene keys by file stem (arena map, minion art, hero sprites and thumbnails) and `portrait-<slug>` for the bundled portraits. */
export const REAL_ART: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(SCENE_GLOB).map(([path, url]) => [stem(path), url])),
  ...Object.fromEntries(Object.entries(PORTRAIT_GLOB).map(([path, url]) => [`${PORTRAIT_PREFIX}${stem(path)}`, url])),
};

/** Replace the FIXTURE placeholders with real PNG data: scene keys by key, portraits by `portrait-<slug>`. */
export function registerRealArt(art: Readonly<Record<string, string>>): void {
  const isPortrait = ([key]: readonly [string, string]): boolean => key.startsWith(PORTRAIT_PREFIX);
  const entries = Object.entries(art);
  installSceneArt(Object.fromEntries(entries.filter((entry) => !isPortrait(entry))));
  installPortraitArt(Object.fromEntries(entries.filter(isPortrait).map(([key, url]) => [key.slice(PORTRAIT_PREFIX.length), url])));
}
