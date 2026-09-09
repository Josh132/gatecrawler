// Weapon mastery + mods + salvage economy — pure data + helpers.
// Consumed by the SGC Weapon Workbench (hub UI) and by the run-time firing
// code in game.js (fireWeapon / fireBeam read weaponStats()).
//
// No game state, no Math.random, deterministic. Only imports the balance
// tables it scales from.
import { WEAPONS } from './weapons.js';
import { RARITY_MULT } from './items.js';

// weapons that feed from a magazine (everything but the P90's belt)
const MAG_WEAPONS = ['staff', 'zat', 'shotgun', 'burst', 'launcher', 'beam'];
// weapons that run on an energy cell — overcharge / lance style mods
const ENERGY_WEAPONS = ['staff', 'zat', 'launcher', 'beam'];
// solid-projectile weapons a bullet-physics mod (ricochet) can hang off
const PROJECTILE_WEAPONS = ['p90', 'staff', 'zat', 'shotgun', 'burst'];

// ---------------------------------------------------------------------------
// 1. MOD CATALOGUE
// each apply(m) mutates the plain modifier object from weaponStats() (#4).
// appliesTo: 'all' | [weaponKey, ...] | 'p90'  (single key for alt mods)
// ---------------------------------------------------------------------------
export const WEAPON_MODS = [
  // ---- optic ----
  {
    id: 'red_dot', name: 'Red Dot Sight', slot: 'optic', tier: 0,
    desc: 'Tighter cone. -20% spread.',
    cost: { salvage: 40 }, appliesTo: 'all',
    apply(m) { m.spreadMul *= 0.8; },
  },
  {
    id: 'scope', name: 'Combat Scope', slot: 'optic', tier: 1,
    desc: '-40% spread, +30% range, but -8% fire rate.',
    cost: { salvage: 95 }, appliesTo: 'all',
    apply(m) { m.spreadMul *= 0.6; m.rangeMul *= 1.3; m.fireRateMul *= 0.92; },
  },

  // ---- mag (magazine weapons only) ----
  {
    id: 'ext_mag', name: 'Extended Mag', slot: 'mag', tier: 0,
    desc: '+50% magazine.',
    cost: { salvage: 50 }, appliesTo: MAG_WEAPONS.slice(),
    apply(m) { m.magMul *= 1.5; },
  },
  {
    id: 'fast_mag', name: 'Quick-Release Mag', slot: 'mag', tier: 0,
    desc: '-30% reload time.',
    cost: { salvage: 55 }, appliesTo: MAG_WEAPONS.slice(),
    apply(m) { m.reloadMul *= 0.7; },
  },
  {
    id: 'drum', name: 'Drum Magazine', slot: 'mag', tier: 1,
    desc: '+120% magazine, but +25% reload time.',
    cost: { salvage: 125 }, appliesTo: MAG_WEAPONS.slice(),
    apply(m) { m.magMul *= 2.2; m.reloadMul *= 1.25; },
  },

  // ---- barrel ----
  {
    id: 'hollow_point', name: 'Hollow-Point Rounds', slot: 'barrel', tier: 0,
    desc: '+18% damage.',
    cost: { salvage: 60 }, appliesTo: 'all',
    apply(m) { m.damageMul *= 1.18; },
  },
  {
    id: 'heavy_barrel', name: 'Heavy Barrel', slot: 'barrel', tier: 1,
    desc: '+30% damage, -20% fire rate.',
    cost: { salvage: 130 }, appliesTo: 'all',
    apply(m) { m.damageMul *= 1.3; m.fireRateMul *= 0.8; },
  },
  {
    id: 'ported', name: 'Ported Barrel', slot: 'barrel', tier: 0,
    desc: '+15% fire rate, -6% damage.',
    cost: { salvage: 70 }, appliesTo: 'all',
    apply(m) { m.fireRateMul *= 1.15; m.damageMul *= 0.94; },
  },
  {
    id: 'piercing', name: 'Sabot Penetrator', slot: 'barrel', tier: 1,
    desc: 'Shots punch through one extra target.',
    cost: { salvage: 110 }, appliesTo: PROJECTILE_WEAPONS.slice(),
    apply(m) { m.pierce += 1; },
  },

  // ---- core ----
  {
    id: 'incendiary', name: 'Incendiary Core', slot: 'core', tier: 1,
    desc: 'Hits leave a small burning hazard.',
    cost: { salvage: 140 }, appliesTo: ['p90', 'staff', 'zat', 'shotgun', 'burst', 'beam'],
    apply(m) { if (!m.onHit.includes('burn')) m.onHit.push('burn'); },
  },
  {
    id: 'shock', name: 'Shock Capacitor', slot: 'core', tier: 1,
    desc: 'Hits stun; +60% stun duration.',
    cost: { salvage: 140 }, appliesTo: ['p90', 'staff', 'zat', 'shotgun', 'burst', 'beam'],
    apply(m) { if (!m.onHit.includes('stun')) m.onHit.push('stun'); m.stunMul *= 1.6; },
  },
  {
    id: 'ricochet', name: 'Ricochet Compensator', slot: 'core', tier: 1,
    desc: 'Shots bounce once off walls.',
    cost: { salvage: 150 }, appliesTo: PROJECTILE_WEAPONS.slice(),
    apply(m) { m.ricochet += 1; },
  },
  {
    id: 'overcharge_cell', name: 'Overcharge Cell', slot: 'core', tier: 1,
    desc: '+25% damage on energy weapons, but the emitter runs hot.',
    cost: { salvage: 160, naquadah: 2 }, appliesTo: ENERGY_WEAPONS.slice(),
    apply(m) { m.damageMul *= 1.25; m.overheat = true; },
  },
  {
    id: 'naquadah_rounds', name: 'Naquadah-Jacketed Rounds', slot: 'core', tier: 2,
    desc: '+12% damage; ignores half of enemy armour.',
    cost: { salvage: 180, naquadah: 3 }, appliesTo: 'all',
    apply(m) { m.damageMul *= 1.12; m.armorPierce = Math.max(m.armorPierce, 0.5); },
  },

  // ---- alt (one per weapon, tier 2, pricey) ----
  {
    id: 'full_auto_dump', name: 'Cyclic Dump', slot: 'alt', tier: 2,
    desc: 'Alt-fire: empties the belt in one roaring burst.',
    cost: { salvage: 200 }, appliesTo: 'p90',
    apply(m) { m.altFire = 'dump'; },
  },
  {
    id: 'charge_bolt', name: 'Charge Bolt', slot: 'alt', tier: 2,
    desc: 'Alt-fire: hold to wind up an oversized staff blast.',
    cost: { salvage: 220 }, appliesTo: 'staff',
    apply(m) { m.altFire = 'charge'; },
  },
  {
    id: 'chain_arc', name: 'Chain Arc', slot: 'alt', tier: 2,
    desc: 'Alt-fire: the bolt forks to nearby targets.',
    cost: { salvage: 220 }, appliesTo: 'zat',
    apply(m) { m.altFire = 'chain'; },
  },
  {
    id: 'slug', name: 'Breaching Slug', slot: 'alt', tier: 2,
    desc: 'Alt-fire: a single heavy slug instead of the spread.',
    cost: { salvage: 200 }, appliesTo: 'shotgun',
    apply(m) { m.altFire = 'slug'; },
  },
  {
    id: 'single_precision', name: 'Precision Mode', slot: 'alt', tier: 2,
    desc: 'Alt-fire: one tight, hard-hitting shot instead of the burst.',
    cost: { salvage: 200 }, appliesTo: 'burst',
    apply(m) { m.altFire = 'single'; },
  },
  {
    id: 'airburst', name: 'Airburst Fuze', slot: 'alt', tier: 2,
    desc: 'Alt-fire: shell detonates at the aim point.',
    cost: { salvage: 240, naquadah: 2 }, appliesTo: 'launcher',
    apply(m) { m.altFire = 'airburst'; },
  },
  {
    id: 'lance', name: 'Focused Lance', slot: 'alt', tier: 2,
    desc: 'Alt-fire: collapses the beam into a long piercing lance.',
    cost: { salvage: 240, naquadah: 2 }, appliesTo: 'beam',
    apply(m) { m.altFire = 'lance'; },
  },
];

const MOD_BY_ID = {};
for (const md of WEAPON_MODS) MOD_BY_ID[md.id] = md;

export function modById(id) { return MOD_BY_ID[id] || null; }

// does a mod physically fit a given weapon?
export function modFits(mod, weaponKey) {
  if (!mod || !WEAPONS[weaponKey]) return false;
  const a = mod.appliesTo;
  let ok = a === 'all' ? true : Array.isArray(a) ? a.includes(weaponKey) : a === weaponKey;
  if (!ok) return false;
  // mag mods need an actual magazine regardless of the list
  if (mod.slot === 'mag' && WEAPONS[weaponKey].mag == null) return false;
  return true;
}

// the subset of the catalogue that fits a weapon — for the workbench list
export function modsForWeapon(weaponKey) {
  return WEAPON_MODS.filter((md) => modFits(md, weaponKey));
}

// ---------------------------------------------------------------------------
// 2. MASTERY LEVELS + XP
// ---------------------------------------------------------------------------
export const weaponMaxLevel = 6;

// cumulative xp needed to REACH a level. L1 is free.
const LEVEL_XP = [0, 120, 320, 640, 1120, 1800];

export function weaponLevelXp(level) {
  const l = Math.max(1, level | 0);
  if (l <= LEVEL_XP.length) return LEVEL_XP[l - 1];
  // extrapolate past the table with a steady +900 / level
  return LEVEL_XP[LEVEL_XP.length - 1] + (l - LEVEL_XP.length) * 900;
}

// given total xp, the level it buys (capped at weaponMaxLevel)
export function levelForXp(xp) {
  let l = 1;
  while (l < weaponMaxLevel && (xp | 0) >= weaponLevelXp(l + 1)) l++;
  return l;
}

const BASE_KILL_XP = 10;
// per-enemy-kind multiplier; unknown kinds score as a plain grunt
const KIND_XP_MUL = {
  grunt: 1, jaffa: 1, drone: 1, rifleman: 1,
  heavy: 2.4, turret: 1.4, summoner: 2, mini: 4,
  elite: 3.2, boss: 12,
};
// slow, heavy-hitting weapons earn a touch more per trigger pull
const WEAPON_XP_MUL = { p90: 0.95, beam: 0.9, staff: 1.1, launcher: 1.15 };

export function xpForKill(weaponKey, enemyKind, threat) {
  const k = KIND_XP_MUL[enemyKind] != null ? KIND_XP_MUL[enemyKind] : 1;
  const w = WEAPON_XP_MUL[weaponKey] != null ? WEAPON_XP_MUL[weaponKey] : 1;
  const t = 1 + 0.08 * Math.max(0, threat || 0);
  return Math.round(BASE_KILL_XP * k * w * t);
}

// ---------------------------------------------------------------------------
// 3. MOD SLOTS
// 1 slot at L2, 2 at L4, 3 at L6. `bonus` folds in tech's weaponModSlots.
// ---------------------------------------------------------------------------
export function MOD_SLOTS(weaponKey, level, bonus) {
  const l = Math.max(1, level | 0);
  let n = 0;
  if (l >= 2) n = 1;
  if (l >= 4) n = 2;
  if (l >= 6) n = 3;
  if (l > 6) n += Math.floor((l - 6) / 2); // +1 slot per 2 levels past cap
  return n + Math.max(0, bonus | 0);
}

// how many slots a saved weapon state is currently using
export function modSlotsUsed(state) {
  return state && Array.isArray(state.mods) ? state.mods.length : 0;
}

// ---------------------------------------------------------------------------
// 4. weaponStats — the core. Returns a PLAIN modifier object the firing code
// multiplies its shot by. state = save.weapons[key] || {level:1,xp:0,mods:[]}.
// techMul = fx(g).weaponDmgMul (optional global damage scalar).
// ---------------------------------------------------------------------------
function freshMod() {
  return {
    damageMul: 1,
    fireRateMul: 1, // >1 = faster; firing code divides the cooldown by this
    magMul: 1,
    reloadMul: 1, // <1 = faster reload
    spreadMul: 1,
    rangeMul: 1,
    speedMul: 1,
    pierce: 0, // extra targets a shot passes through
    ricochet: 0, // wall bounces
    stunMul: 1,
    armorPierce: 0, // 0..1 fraction of enemy armour ignored
    altFire: null, // string tag or null
    onHit: [], // e.g. ['burn','stun']
    overheat: false, // energy weapon runs hot
  };
}

export function weaponStats(weaponKey, state, techMul) {
  const m = freshMod();
  const st = state && typeof state === 'object' ? state : { level: 1, xp: 0, mods: [] };
  const lv = Math.max(1, st.level | 0 || 1);
  const over = lv - 1;

  // per-level flat bumps
  m.damageMul *= 1 + 0.05 * over; // +5% damage / level
  m.spreadMul *= Math.max(0.5, 1 - 0.02 * over); // -2% spread / level
  m.reloadMul *= Math.max(0.5, 1 - 0.03 * over); // +3% reload speed / level
  m.fireRateMul *= 1 + 0.01 * over; // +1% fire rate / level

  // installed mods, in catalogue order for determinism
  const ids = Array.isArray(st.mods) ? st.mods : [];
  for (const md of WEAPON_MODS) {
    if (ids.indexOf(md.id) === -1) continue;
    if (!modFits(md, weaponKey)) continue;
    md.apply(m);
  }

  // global tech damage scalar
  if (typeof techMul === 'number' && techMul > 0) m.damageMul *= techMul;

  // tidy
  m.damageMul = round4(m.damageMul);
  m.fireRateMul = round4(m.fireRateMul);
  m.magMul = round4(m.magMul);
  m.reloadMul = round4(m.reloadMul);
  m.spreadMul = round4(m.spreadMul);
  m.rangeMul = round4(m.rangeMul);
  m.speedMul = round4(m.speedMul);
  m.stunMul = round4(m.stunMul);
  return m;
}

function round4(n) { return Math.round(n * 1e4) / 1e4; }

// ---------------------------------------------------------------------------
// 5. ECONOMY HELPERS
// ---------------------------------------------------------------------------

// base salvage cost of the L1 -> L2 step, per weapon
const UPGRADE_BASE = { p90: 30, staff: 45, zat: 35, shotgun: 40, burst: 38, launcher: 55, beam: 60 };
// base salvage you get for scrapping one weapon instance, per weapon
const SALVAGE_BASE = { p90: 12, staff: 22, zat: 16, shotgun: 18, burst: 17, launcher: 28, beam: 30 };

// cost to reach `toLevel` from the level below it
export function upgradeCost(weaponKey, toLevel) {
  const base = UPGRADE_BASE[weaponKey] || 40;
  const l = Math.max(2, toLevel | 0);
  const salvage = Math.round(base * (l - 1) * (1 + 0.35 * (l - 2)));
  const naquadah = l >= 4 ? l - 3 : 0;
  return { salvage, naquadah };
}

// a mod's install price (fresh object; naquadah always present)
export function installCost(modId) {
  const md = MOD_BY_ID[modId];
  if (!md) return { salvage: 0, naquadah: 0 };
  return { salvage: md.cost.salvage | 0, naquadah: md.cost.naquadah | 0 };
}

// partial salvage back when a mod is pulled off (mods are consumables — 50%)
export function uninstallRefund(modId) {
  const md = MOD_BY_ID[modId];
  if (!md) return { salvage: 0, naquadah: 0 };
  return {
    salvage: Math.round((md.cost.salvage || 0) * 0.5),
    naquadah: Math.floor((md.cost.naquadah || 0) * 0.5),
  };
}

// fold an old/unknown rarity string onto the RARITY_MULT keys
function normRarity(r) {
  if (RARITY_MULT[r]) return r;
  if (r === 'uncommon') return 'good';
  if (r === 'rare') return 'epic';
  return 'common';
}

// salvage granted for scrapping / selling one instance of a weapon
export function salvageValue(weaponKey, rarity) {
  const base = SALVAGE_BASE[weaponKey] || 15;
  return Math.round(base * (RARITY_MULT[normRarity(rarity)] || 1));
}

// ---- gating ----

// can this mod go on this weapon right now?  { ok, reason }
// bonusSlots folds in tech's weaponModSlots (optional).
export function canInstall(save, weaponKey, modId, bonusSlots) {
  const md = MOD_BY_ID[modId];
  if (!md) return { ok: false, reason: 'unknown mod' };
  if (!WEAPONS[weaponKey]) return { ok: false, reason: 'unknown weapon' };
  if (!modFits(md, weaponKey)) return { ok: false, reason: 'not compatible with ' + weaponKey };

  const st = (save && save.weapons && save.weapons[weaponKey]) || { level: 1, xp: 0, mods: [] };
  const mods = Array.isArray(st.mods) ? st.mods : [];
  if (mods.indexOf(modId) !== -1) return { ok: false, reason: 'already installed' };

  // one mod per slot type
  for (const id of mods) {
    const other = MOD_BY_ID[id];
    if (other && other.slot === md.slot) return { ok: false, reason: md.slot + ' slot in use' };
  }
  // total slot budget
  if (mods.length >= MOD_SLOTS(weaponKey, st.level, bonusSlots)) {
    return { ok: false, reason: 'no free mod slots (raise mastery)' };
  }

  const cost = installCost(modId);
  if (cost.salvage > ((save && save.salvage) || 0)) return { ok: false, reason: 'not enough salvage' };
  if (cost.naquadah > ((save && save.naquadah) || 0)) return { ok: false, reason: 'not enough naquadah' };

  return { ok: true, reason: '' };
}

// can this weapon be levelled up right now?  { ok, reason }
export function canUpgrade(save, weaponKey) {
  if (!WEAPONS[weaponKey]) return { ok: false, reason: 'unknown weapon' };
  const st = (save && save.weapons && save.weapons[weaponKey]) || { level: 1, xp: 0, mods: [] };
  const lv = Math.max(1, st.level | 0 || 1);
  if (lv >= weaponMaxLevel) return { ok: false, reason: 'max level' };

  const need = weaponLevelXp(lv + 1);
  if ((st.xp | 0) < need) return { ok: false, reason: 'needs ' + need + ' mastery xp' };

  const cost = upgradeCost(weaponKey, lv + 1);
  if (cost.salvage > ((save && save.salvage) || 0)) return { ok: false, reason: 'not enough salvage' };
  if (cost.naquadah > ((save && save.naquadah) || 0)) return { ok: false, reason: 'not enough naquadah' };

  return { ok: true, reason: '' };
}
