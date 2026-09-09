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
// always yields exactly `count` distinct valid addresses, none equal to the input
export function neighbors(addr, count = 5) {
  const norm = normalize(addr);
  const h = hashStr('nbr:' + norm);
  const base = norm.split('-');
  const out = [];
  // accept a candidate only if it's a fresh, valid, non-self address
  const add = (np) => {
    const joined = np.join('-');
    if (joined !== norm && isValid(joined) && !out.includes(joined)) out.push(joined);
  };
  // phase 1: organic-looking picks driven purely by the h() stream.
  // absolute safety bound scaled to count so it can never spin forever.
  const cap = count * 50 + 500;
  let guard = 0;
  while (out.length < count && guard++ < cap) {
    const np = base.slice();
    const muts = 1 + (h() % 2);
    for (let m = 0; m < muts; m++) {
      const pos = h() % 6;
      np[pos] = GLYPHS[h() % GLYPHS.length];
    }
    add(np);
  }
  // phase 2: deterministic sweep of every single-glyph substitution
  for (let pos = 0; pos < 6 && out.length < count; pos++) {
    for (let gi = 0; gi < GLYPHS.length && out.length < count; gi++) {
      const np = base.slice();
      np[pos] = GLYPHS[gi];
      add(np);
    }
  }
  // phase 3: deterministic sweep of two-glyph substitutions for large counts
  for (let p = 0; p < 6 && out.length < count; p++) {
    for (let q = p + 1; q < 6 && out.length < count; q++) {
      for (let gi = 0; gi < GLYPHS.length && out.length < count; gi++) {
        for (let gj = 0; gj < GLYPHS.length && out.length < count; gj++) {
          const np = base.slice();
          np[p] = GLYPHS[gi];
          np[q] = GLYPHS[gj];
          add(np);
        }
      }
    }
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
  // biome follows the faction — each holds two or three looks, and the roll
  // between them is a plain draw off the address stream so it stays stable
  // jaffa hold grand interiors (temple, pyramid) and open-air worlds (desert,
  // jungle, savannah) in roughly equal measure — a solid fraction are outdoors
  const biomePools = {
    jaffa: ['temple', 'pyramid', 'desert', 'jungle', 'savannah'],
    wraith: ['hive', 'ice'],
    replicator: ['foundry', 'atlantis'],
  };
  const bp = biomePools[primary] || biomePools.jaffa;
  let biome = bp[h() % bp.length];
  // the rarer looks sit out past the shallow worlds: an ancient city or an
  // ossuary cut into the rock, both getting likelier the deeper you push
  const rare = h();
  if (threat >= 4 && rare % 100 < 8 + threat * 3) {
    biome = ['catacomb', 'catacomb', 'atlantis'][(rare >> 9) % 3];
  }
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
