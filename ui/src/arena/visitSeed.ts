/** A fresh 32-bit seed for one visit to the page. Heroes are placed from it. It is never stored or sent anywhere. */
export function newVisitSeed(source: Pick<Crypto, 'getRandomValues'> | null = globalThis.crypto ?? null, now: () => number = Date.now): number {
  if (source === null) return now() >>> 0;
  return source.getRandomValues(new Uint32Array(1))[0] ?? now() >>> 0;
}
