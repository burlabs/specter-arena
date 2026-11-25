/** FNV-1a over UTF-16 code units, folded to a hue; the same id always gives the same colour. */
export function tokenHue(specterId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < specterId.length; index += 1) {
    hash = Math.imul(hash ^ specterId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash % 360;
}

/** First letters of up to two words, by code point so a surrogate pair is never split; "?" when empty. */
export function tokenInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  const initials = letters.join('').toUpperCase();
  return initials === '' ? '?' : initials;
}

export const lengthOf = (text: string): number => Array.from(text).length;
