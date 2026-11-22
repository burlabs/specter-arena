const PACK_BASE = 'https://github.com/burlabs/specter-arena/blob/main/avatar-packs/packs/';

/** Where a hero's optional Kiro Crew avatar pack lives in the repository. The app links to it and never installs or assigns it. */
export const avatarPackUrl = (heroId: string): string => `${PACK_BASE}specters-${encodeURIComponent(heroId)}.pack.json`;
