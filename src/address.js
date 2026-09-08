import { hashStr } from './rng.js';

// 36 gate glyph tokens; index is the symbol id
export const GLYPHS = [
  'AUR', 'CRT', 'VIR', 'BOO', 'CEN', 'SER', 'NOR', 'SCO', 'CAP', 'SAG', 'AQR', 'PSC',
  'ARI', 'TAU', 'GEM', 'CNC', 'LEO', 'CRU', 'HER', 'OPH', 'DRA', 'PEG', 'AND', 'PER',
  'CAS', 'CEP', 'CYG', 'LYR', 'AQL', 'DEL', 'EQU', 'PYX', 'LAC', 'MON', 'LYN', 'UMI',
];

export const HOME = 'AUR-CRT-VIR-BOO-CEN-SER';

export function normalize(addr) {
  return String(addr).toUpperCase().trim();
}

export function isValid(addr) {
  const parts = normalize(addr).split('-');
  return parts.length === 6 && parts.every((p) => GLYPHS.includes(p));
}

// deterministic neighbour addresses reachable from a gate
export function neighbors(addr, count = 5) {
  const h = hashStr('nbr:' + normalize(addr));
  const base = normalize(addr).split('-');
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < 40) {
    const np = base.slice();
    const muts = 1 + (h() % 2);
    for (let m = 0; m < muts; m++) {
      const pos = h() % 6;
      np[pos] = GLYPHS[h() % GLYPHS.length];
    }
    const joined = np.join('-');
    if (joined !== normalize(addr) && !out.includes(joined)) out.push(joined);
  }
  return out;
}

// world parameters derived purely from address + hop distance from home
export function worldParams(addr, hop) {
  const h = hashStr('world:' + normalize(addr));
  const a = h(), b = h(), c = h(), d = h(), e = h();
  const dangerRoll = a % 3; // 0..2 intrinsic danger
  const threat = hop + dangerRoll;
  // one faction per world — factions never mix. Replicators appear from hop 2.
  const pool = hop < 2 ? ['jaffa', 'wraith'] : ['jaffa', 'wraith', 'replicator'];
  const primary = pool[b % pool.length];
  const modPool = ['eclipse', 'naquadah-rich', 'ion-storm'];
  const mods = [];
  if (c % 100 < 55) mods.push(modPool[d % modPool.length]);
  const roomCount = 4 + (e % 3) + Math.min(2, Math.floor(threat / 2)); // 4..8
  return {
    address: normalize(addr),
    hop,
    threat,
    faction: primary,
    primary, // kept for back-compat
    secondary: null,
    mods,
    roomCount,
    biome: 'desert-ruins',
    seedStr: normalize(addr),
  };
}
