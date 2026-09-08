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
  // world modifiers stack — deeper worlds roll more of them
  const modPool = ['eclipse', 'naquadah-rich', 'ion-storm', 'intel-rich', 'power-siphon', 'black-fog'];
  const mods = [];
  // 0..3 mods: base chance climbs with threat, each extra roll is rarer
  const modRolls = [c, d, h()];
  let modChance = 40 + threat * 8; // percent
  for (let k = 0; k < 3 && modChance > 0; k++) {
    const rr = modRolls[k];
    if (rr % 100 < modChance) {
      const pick = modPool[Math.floor(rr / 128) % modPool.length];
      // eclipse and black-fog are both vision cuts — don't stack them
      const clash = (pick === 'eclipse' && mods.includes('black-fog')) || (pick === 'black-fog' && mods.includes('eclipse'));
      if (!mods.includes(pick) && !clash) mods.push(pick);
    }
    modChance -= 30;
  }
  const roomCount = 4 + (e % 3) + Math.min(2, Math.floor(threat / 2)); // 4..8
  // biome loosely follows the faction, with a coin-flip between two looks
  const biomePools = {
    jaffa: ['ruins', 'foundry'],
    wraith: ['hive', 'ice'],
    replicator: ['foundry', 'ice'],
  };
  const bp = biomePools[primary] || ['ruins', 'foundry'];
  const biome = bp[h() % bp.length];
  return {
    address: normalize(addr),
    hop,
    threat,
    faction: primary,
    primary, // kept for back-compat
    secondary: null,
    mods,
    roomCount,
    biome,
    seedStr: normalize(addr),
  };
}
