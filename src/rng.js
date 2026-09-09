// xmur3 string hash -> function returning successive 32-bit values
export function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// mulberry32 PRNG -> function returning float in [0,1)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(str) {
  const seed = hashStr(String(str));
  return mulberry32(seed());
}

// Unseeded random in [a, b). The cosmetic cousin of rngHelpers().range — use it
// for anything purely visual (particle jitter, casing spin, screen-shake) that
// must NOT touch the deterministic worldgen seed stream. Never use it in
// worldgen or anywhere the test harness checks for determinism.
export const rr = (a, b) => a + Math.random() * (b - a);

export function rngHelpers(rand) {
  return {
    rand,
    range: (a, b) => a + (b - a) * rand(),
    int: (a, b) => Math.floor(a + (b - a + 1) * rand()),
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    chance: (p) => rand() < p,
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}
