import { ITEMS, EQUIP_SLOTS, slotAccepts, itemStats } from './items.js';

export const GRID_COLS = 6;
export const GRID_ROWS = 5;
export const GRID_SIZE = GRID_COLS * GRID_ROWS;
export const HOTBAR = 4;

export function createInventory() {
  const inv = {
    grid: new Array(GRID_SIZE).fill(null), // {id, count} | null
    equip: { head: null, torso: null, legs: null, feet: null, weapon1: null, weapon2: null, weapon3: null, grenade: null },
    hotbar: new Array(HOTBAR).fill(null), // {id, count} | null
    active: 'weapon1', // which weapon slot is in hand
  };
  inv.equip.weapon1 = { id: 'w_p90', count: 1 };
  inv.hotbar[0] = { id: 'bandage', count: 3 };
  return inv;
}

// migrate / validate a loaded save blob into a usable inventory
export function reviveInventory(raw) {
  const inv = createInventory();
  if (!raw || typeof raw !== 'object') return inv;
  const okStack = (s) => {
    if (!s || !ITEMS[s.id]) return null;
    const st = { id: s.id, count: Math.max(1, s.count | 0 || 1) };
    if (s.rarity) st.rarity = String(s.rarity);
    return st;
  };
  if (Array.isArray(raw.grid)) for (let i = 0; i < GRID_SIZE; i++) inv.grid[i] = okStack(raw.grid[i]);
  if (Array.isArray(raw.hotbar)) for (let i = 0; i < HOTBAR; i++) inv.hotbar[i] = okStack(raw.hotbar[i]);
  if (raw.equip) {
    for (const s of EQUIP_SLOTS) {
      const st = okStack(raw.equip[s]);
      inv.equip[s] = st && slotAccepts(s, st.id) ? st : inv.equip[s];
    }
  }
  if (['weapon1', 'weapon2', 'weapon3'].includes(raw.active)) inv.active = raw.active;
  return inv;
}

export function itemDef(id) {
  return ITEMS[id] || null;
}

const TYPE_ORDER = { weapon: 0, armor: 1, grenade: 2, consumable: 3 };
const RAR_ORDER = { legendary: 0, epic: 1, rare: 1, good: 2, uncommon: 2, common: 3 };

// merge same id+rarity stacks, then order by type/name/rarity and compact to the
// front. mutates `arr` (a grid or stash array of {id,count,rarity}|null) in place.
export function sortGridArray(arr) {
  const items = arr.filter(Boolean);
  const merged = [];
  for (const it of items) {
    const max = (ITEMS[it.id] && ITEMS[it.id].stack) || 1;
    const key = it.id + '|' + (it.rarity || '');
    let slot = merged.find((m) => m._k === key && m.count < max);
    while (it.count > 0) {
      if (!slot || slot.count >= max) {
        slot = { id: it.id, count: 0, _k: key };
        if (it.rarity) slot.rarity = it.rarity;
        merged.push(slot);
      }
      const take = Math.min(max - slot.count, it.count);
      slot.count += take;
      it.count -= take;
    }
  }
  merged.sort((a, b) => {
    const ta = TYPE_ORDER[(ITEMS[a.id] || {}).type] ?? 9;
    const tb = TYPE_ORDER[(ITEMS[b.id] || {}).type] ?? 9;
    if (ta !== tb) return ta - tb;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return (RAR_ORDER[a.rarity] ?? 3) - (RAR_ORDER[b.rarity] ?? 3);
  });
  for (let i = 0; i < arr.length; i++) {
    if (merged[i]) {
      delete merged[i]._k;
      arr[i] = merged[i];
    } else arr[i] = null;
  }
}

export function sortInventory(inv) {
  sortGridArray(inv.grid);
}

// add `count` of item `id`, stacking where possible. returns leftover count.
export function invAdd(inv, id, count = 1, rarity = null) {
  const def = ITEMS[id];
  if (!def) return count;
  const max = def.stack || 1;
  let left = count;
  if (max > 1) {
    for (const cell of inv.grid) {
      if (left <= 0) break;
      // only merge into a stack of the same rarity so buffs don't get diluted
      if (cell && cell.id === id && cell.count < max && (cell.rarity || null) === (rarity || null)) {
        const room = max - cell.count;
        const take = Math.min(room, left);
        cell.count += take;
        left -= take;
      }
    }
  }
  for (let i = 0; i < inv.grid.length && left > 0; i++) {
    if (!inv.grid[i]) {
      const take = Math.min(max, left);
      inv.grid[i] = rarity ? { id, count: take, rarity } : { id, count: take };
      left -= take;
    }
  }
  return left;
}

export function invHasSpace(inv, id) {
  const def = ITEMS[id];
  if (!def) return false;
  const max = def.stack || 1;
  for (const cell of inv.grid) {
    if (!cell) return true;
    if (max > 1 && cell.id === id && cell.count < max) return true;
  }
  return false;
}

function ref(inv, loc) {
  if (loc.kind === 'grid') return inv.grid[loc.i];
  if (loc.kind === 'hot') return inv.hotbar[loc.i];
  if (loc.kind === 'equip') return inv.equip[loc.key];
  return null;
}
function set(inv, loc, stack) {
  if (loc.kind === 'grid') inv.grid[loc.i] = stack;
  else if (loc.kind === 'hot') inv.hotbar[loc.i] = stack;
  else if (loc.kind === 'equip') inv.equip[loc.key] = stack;
}

function locAccepts(loc, id) {
  const def = ITEMS[id];
  if (!def) return false;
  if (loc.kind === 'grid') return true;
  if (loc.kind === 'hot') return def.type === 'consumable';
  if (loc.kind === 'equip') return slotAccepts(loc.key, id);
  return false;
}

// move / swap / merge a stack between two locations. returns true if anything
// changed. `capOverride` (optional) raises the max stack for the destination —
// used by the game to apply the Bandolier tech to the grenade slot.
export function moveStack(inv, from, to, capOverride) {
  const a = ref(inv, from);
  if (!a) return false;
  if (from.kind === to.kind && (from.i === to.i && from.key === to.key)) return false;
  if (!locAccepts(to, a.id)) return false;
  const b = ref(inv, to);
  const def = ITEMS[a.id];
  const max = Math.max(def.stack || 1, capOverride || 0);

  if (b && b.id === a.id && max > 1) {
    const room = max - b.count;
    const take = Math.min(room, a.count);
    b.count += take;
    a.count -= take;
    if (a.count <= 0) set(inv, from, null);
    return take > 0;
  }
  // swap (b must be acceptable back in `from`)
  if (b) {
    if (!locAccepts(from, b.id)) return false;
    set(inv, to, a);
    set(inv, from, b);
    return true;
  }
  set(inv, to, a);
  set(inv, from, null);
  return true;
}

// consume one from a hotbar slot; returns the item def that was used, or null.
export function takeFromHot(inv, i) {
  const s = inv.hotbar[i];
  if (!s) return null;
  const def = ITEMS[s.id];
  s.count -= 1;
  if (s.count <= 0) inv.hotbar[i] = null;
  return def;
}

export function takeGrenade(inv) {
  const s = inv.equip.grenade;
  if (!s || s.count <= 0) return null;
  const def = ITEMS[s.id];
  s.count -= 1;
  if (s.count <= 0) inv.equip.grenade = null;
  return def;
}

export function activeWeaponId(inv) {
  const s = inv.equip[inv.active] || inv.equip.weapon1 || inv.equip.weapon2 || inv.equip.weapon3;
  return s && ITEMS[s.id] ? ITEMS[s.id].weapon : 'p90';
}

// cycle to the next occupied weapon slot; `maxSlots` (2 or 3) is the Third
// Holster gate. `dir` -1 cycles backwards (mouse-wheel up).
export function toggleWeapon(inv, maxSlots, dir) {
  const slots = ['weapon1', 'weapon2', 'weapon3'].slice(0, Math.max(1, Math.min(3, maxSlots || 2)));
  const occ = slots.filter((s) => inv.equip[s]);
  if (occ.length < 2) return activeWeaponId(inv);
  let i = occ.indexOf(inv.active);
  if (i < 0) i = 0;
  i = (i + (dir === -1 ? -1 : 1) + occ.length) % occ.length;
  inv.active = occ[i];
  return activeWeaponId(inv);
}

// derived damage-resist by body region from equipped armour (rarity-scaled)
export function regionDR(inv) {
  const dr = { head: 0, torso: 0, legs: 0, feet: 0 };
  for (const r of ['head', 'torso', 'legs', 'feet']) {
    const s = inv.equip[r];
    if (s && ITEMS[s.id] && ITEMS[s.id].region === r) {
      const scaled = itemStats(s.id, s.rarity);
      dr[r] = scaled && scaled.dr != null ? scaled.dr : ITEMS[s.id].dr;
    }
  }
  return dr;
}

const REGION_ROLL = [
  ['torso', 0.44],
  ['legs', 0.22],
  ['head', 0.12],
  ['feet', 0.1],
  ['none', 0.12],
];
export function rollHitRegion(rand) {
  let r = (rand || Math.random)();
  for (const [name, w] of REGION_ROLL) {
    if (r < w) return name;
    r -= w;
  }
  return 'none';
}
