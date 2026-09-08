// Item catalogue. Weapon items reference an id in weapons.js.
import { weaponBaseDamage } from './weapons.js';

export const ITEMS = {
  // ---- consumables (go in the hotbar or the grid) ----
  bandage: {
    name: 'Field Dressing',
    type: 'consumable',
    use: 'heal',
    amount: 20,
    stack: 8,
    color: '#9df7a0',
    icon: '+',
    blurb: 'Restore 20 HP.',
  },
  medkit: {
    name: 'Medkit',
    type: 'consumable',
    use: 'heal',
    amount: 55,
    stack: 4,
    color: '#7ef77e',
    icon: '✚',
    blurb: 'Restore 55 HP.',
  },
  stim: {
    name: 'Combat Stim',
    type: 'consumable',
    use: 'stim',
    dur: 6,
    stack: 3,
    color: '#ffd54a',
    icon: '⚡',
    blurb: '+35% move speed, +40% fire rate for 6s.',
  },
  shieldcell: {
    name: 'Shield Cell',
    type: 'consumable',
    use: 'shield',
    amount: 45,
    stack: 3,
    color: '#7dd3fc',
    icon: '◈',
    blurb: 'Adds up to 45 points of regenerating overshield.',
  },

  // ---- grenade (grenade slot, thrown with G) ----
  frag: {
    name: 'Frag Grenade',
    type: 'grenade',
    dmg: 65,
    radius: 95,
    stack: 4,
    color: '#ff8a3c',
    icon: '✸',
    blurb: 'Thrown. 65 damage in a 95px blast.',
  },

  // ---- weapons (weapon1 / weapon2 slots) ----
  w_p90: { name: 'P90', type: 'weapon', weapon: 'p90', color: '#cfe8ff', icon: 'P', blurb: 'Full-auto. Generous ammo.' },
  w_staff: {
    name: 'Staff Weapon',
    type: 'weapon',
    weapon: 'staff',
    color: '#ffb347',
    icon: 'S',
    blurb: 'Slow, heavy, big knockback. Jaffa ammo.',
  },
  w_zat: {
    name: "Zat'nik'tel",
    type: 'weapon',
    weapon: 'zat',
    color: '#7dd3fc',
    icon: 'Z',
    blurb: 'Fast energy bolts that briefly stun.',
  },
  w_shotgun: {
    name: 'Assault Shotgun',
    type: 'weapon',
    weapon: 'shotgun',
    color: '#ffd27a',
    icon: 'G',
    blurb: 'Seven-pellet spread, heavy knockback. R to reload.',
  },
  w_burst: {
    name: 'Burst Rifle',
    type: 'weapon',
    weapon: 'burst',
    color: '#dfe8ff',
    icon: 'B',
    blurb: 'Tight three-round bursts per trigger pull. R to reload.',
  },
  w_launcher: {
    name: 'Grenade Launcher',
    type: 'weapon',
    weapon: 'launcher',
    color: '#ff8a3c',
    icon: 'L',
    blurb: 'Slow shells that burst on impact. Scarce. R to reload.',
  },
  w_beam: {
    name: 'Ion Beam',
    type: 'weapon',
    weapon: 'beam',
    color: '#7dd3fc',
    icon: 'I',
    blurb: 'Continuous beam. Drains its cell, then recharges.',
  },

  // ---- armour (region slot: head / torso / legs / feet). dr = fraction of a
  // hit to that region that is absorbed. ----
  a_visor: { name: 'Recon Visor', type: 'armor', region: 'head', dr: 0.3, color: '#9fb8d0', icon: '▢', blurb: 'Head 30% DR.' },
  a_helm: { name: 'Jaffa Helm', type: 'armor', region: 'head', dr: 0.46, color: '#ffcf9a', icon: '▲', blurb: 'Head 46% DR.' },
  a_vest: { name: 'Tac Vest', type: 'armor', region: 'torso', dr: 0.28, color: '#9fb8d0', icon: '▮', blurb: 'Torso 28% DR.' },
  a_plate: {
    name: 'Serpent Plate',
    type: 'armor',
    region: 'torso',
    dr: 0.44,
    color: '#ffcf9a',
    icon: '◆',
    blurb: 'Torso 44% DR.',
  },
  a_greaves: { name: 'Combat Greaves', type: 'armor', region: 'legs', dr: 0.26, color: '#9fb8d0', icon: '╱', blurb: 'Legs 26% DR.' },
  a_boots: { name: 'Assault Boots', type: 'armor', region: 'feet', dr: 0.22, color: '#9fb8d0', icon: '▄', blurb: 'Feet 22% DR.' },
};

export const EQUIP_SLOTS = ['head', 'torso', 'legs', 'feet', 'weapon1', 'weapon2', 'weapon3', 'grenade'];

export function slotAccepts(slot, id) {
  const it = ITEMS[id];
  if (!it) return false;
  if (slot === 'weapon1' || slot === 'weapon2' || slot === 'weapon3') return it.type === 'weapon';
  if (slot === 'grenade') return it.type === 'grenade';
  return it.type === 'armor' && it.region === slot;
}

// -------------------------------------------------------------------------
// rarity — pure helpers, no side effects, no game state. tiers run low -> high.
// the canonical list is also exported from icons.js as RARITIES; it's kept
// local here to avoid an import cycle (icons.js already imports this file).
// -------------------------------------------------------------------------
const RARITY_TIERS = ['common', 'good', 'epic', 'legendary'];

// scalar applied to an item's primary stat (dr / damage / heal amount) per tier
export const RARITY_MULT = { common: 1, good: 1.15, epic: 1.35, legendary: 1.6 };

// fold an old / unknown tier string onto one of RARITY_TIERS
function normTier(rarity) {
  if (RARITY_MULT[rarity]) return rarity;
  if (rarity === 'uncommon') return 'good';
  if (rarity === 'rare') return 'epic';
  return 'common';
}

// roll a tier for a fresh drop. `threat` is the world threat (~0..10+), `rnd`
// is a function returning [0,1); result is deterministic given `rnd`. relative
// weights as a function of threat t (clamped 0..8), normalised internally:
//
//   common     max(6, 80 - 7*t)      80 -> 24
//   good       16 + 2.4*t            16 -> 35
//   epic       max(0, 3.2*(t - 1))    0 until t>1, -> 22
//   legendary  max(0, 2.2*(t - 4))    0 until t>4, -> ~9
//
// so low threat is almost entirely 'common' and 'legendary' only becomes
// plausible from threat ~5 up.
export function rollRarity(threat, rnd) {
  const r = typeof rnd === 'function' ? rnd() : Math.random();
  const t = Math.max(0, Math.min(8, threat || 0));
  const w = [
    Math.max(6, 80 - 7 * t),
    16 + 2.4 * t,
    Math.max(0, 3.2 * (t - 1)),
    Math.max(0, 2.2 * (t - 4)),
  ];
  let pick = r * (w[0] + w[1] + w[2] + w[3]);
  for (let i = 0; i < RARITY_TIERS.length; i++) {
    if (pick < w[i]) return RARITY_TIERS[i];
    pick -= w[i];
  }
  return 'common';
}

// rarity-scaled numbers for an item, WITHOUT mutating ITEMS. shape by type:
//   armor       { dr }          base dr * mult, clamped to <= 0.85
//   weapon      { damageMul }   plus { damage } when the base is known
//   consumable  { amountMul }
//   anything else / unknown id  {}
// unknown id or unknown rarity are treated as common.
export function itemStats(id, rarity) {
  const it = ITEMS[id];
  if (!it) return {};
  const mul = RARITY_MULT[normTier(rarity)];
  if (it.type === 'armor') {
    return { dr: Math.min(0.85, (it.dr || 0) * mul) };
  }
  if (it.type === 'weapon') {
    const out = { damageMul: mul };
    const base = weaponBaseDamage(it.weapon);
    if (base) out.damage = Math.round(base * mul * 100) / 100;
    return out;
  }
  if (it.type === 'consumable') {
    return { amountMul: mul };
  }
  return {};
}

// display name for a rolled item: "Epic Tac Vest" above common, else the plain
// name. unknown id falls back to a generic label.
export function rarityAffixName(id, rarity) {
  const it = ITEMS[id];
  const base = it ? it.name : 'Item';
  const tier = normTier(rarity);
  if (tier === 'common') return base;
  return tier.charAt(0).toUpperCase() + tier.slice(1) + ' ' + base;
}
