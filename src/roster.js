// SGC roster + base upgrades — pure data + fold helpers.
//
// The game owns `save`. Rescued SG teams land in `save.roster` (array of team
// ids); purchased base upgrades in `save.base` (array of upgrade ids). These
// helpers only read those. Spending / persistence is the caller's job.

// Each rescued team is a permanent passive. Names match SG_NAMES in game.js so
// a rescue event can map its captive's name straight to a team id.
export const SG_TEAMS = [
  { id: 'SG-2', name: 'SG-2', role: 'Recon', bonus: 'moveSpeedMul', mag: 1.05,
    blurb: 'Forward scouts. +5% move speed.' },
  { id: 'SG-3', name: 'SG-3', role: 'Marines', bonus: 'weaponDmgMul', mag: 1.06,
    blurb: 'Heavy weapons team. +6% weapon damage.' },
  { id: 'SG-5', name: 'SG-5', role: 'Search & Rescue', bonus: 'reviveHpFrac', add: 0.15,
    blurb: 'Medics on call. Revives restore +15% HP.' },
  { id: 'SG-9', name: 'SG-9', role: 'Diplomatic', bonus: 'intelMul', mag: 1.12,
    blurb: 'Debriefs pay off. +12% intel yield.' },
  { id: 'SG-11', name: 'SG-11', role: 'Engineers', bonus: 'salvageMul', mag: 1.15,
    blurb: 'Field strip everything. +15% salvage.' },
  { id: 'SG-12', name: 'SG-12', role: 'Assault', bonus: 'critChance', add: 0.04,
    blurb: 'Aggressive doctrine. +4% crit chance.' },
  { id: 'SG-15', name: 'SG-15', role: 'Ordnance', bonus: 'grenadeDmgMul', mag: 1.2,
    blurb: 'Demolition experts. +20% grenade damage.' },
  { id: 'SG-16', name: 'SG-16', role: 'Survey', bonus: 'naquadahMul', mag: 1.1,
    blurb: 'Mineral assay. +10% naquadah yield.' },
];

const TEAM_BY = new Map(SG_TEAMS.map((t) => [t.id, t]));
export function teamById(id) {
  return TEAM_BY.get(id) || null;
}
// map a captive display name ("SG-9") to a team id; unknown -> a stable pick
export function teamForName(name, ownedIds) {
  if (TEAM_BY.has(name)) return name;
  const free = SG_TEAMS.map((t) => t.id).filter((id) => !(ownedIds || []).includes(id));
  return free[0] || SG_TEAMS[0].id;
}

// fold the roster's passives onto a tech-effects-shaped object (call after
// techEffects so it stacks on top). mutates + returns `e`.
export function applyRoster(e, rosterIds) {
  for (const id of rosterIds || []) {
    const t = TEAM_BY.get(id);
    if (!t) continue;
    if (t.mag != null) e[t.bonus] = (e[t.bonus] == null ? 1 : e[t.bonus]) * t.mag;
    else if (t.add != null) e[t.bonus] = (e[t.bonus] || 0) + t.add;
  }
  return e;
}

// ---------------------------------------------------------------- base upgrades
//
// A naquadah sink for once the tech tree is deep. Bought once, permanent.
export const BASE_UPGRADES = [
  { id: 'infirmary_1', name: 'Infirmary Wing', cost: { naquadah: 400 },
    effect: 'homeHeal', blurb: 'Return to the SGC at full HP, always.' },
  { id: 'training_1', name: 'Training Range', cost: { naquadah: 600 },
    effect: 'passiveXp', mag: 30, blurb: 'Idle weapons earn +30 mastery XP per sortie.' },
  { id: 'crew_1', name: 'Extra Research Staff', cost: { naquadah: 700, intel: 8 },
    effect: 'researchDiscount', mag: 0.85, blurb: 'All research costs -15%.' },
  { id: 'stores_1', name: 'Base Stores', cost: { naquadah: 350 },
    effect: 'stashSlots', mag: 20, blurb: 'Unlock a 20-slot storage chest at the SGC.' },
  { id: 'defense_1', name: 'Gate Shield Retrofit', cost: { naquadah: 800, intel: 10 },
    effect: 'heatSoften', mag: 0.85, blurb: 'The hunt builds 15% slower on every world.' },
  { id: 'foundry_1', name: 'Salvage Foundry', cost: { naquadah: 900, intel: 6, salvage: 60 },
    effect: 'modDiscount', mag: 0.8, blurb: 'Weapon mods & upgrades cost -20% salvage.' },
  { id: 'archive_1', name: 'Xeno Archive', cost: { naquadah: 1100, intel: 16 },
    effect: 'bestiaryDmgMul', mag: 1.1, blurb: '+10% damage vs any enemy in your bestiary.' },
  { id: 'quarters_1', name: 'Officer Quarters', cost: { naquadah: 500 },
    effect: 'rosterSlots', mag: 2, blurb: 'Deploy with 2 more SG teams than your rank allows.' },
];

const UPG_BY = new Map(BASE_UPGRADES.map((u) => [u.id, u]));
export function upgradeById(id) {
  return UPG_BY.get(id) || null;
}
export function hasBase(save, effect) {
  const owned = (save && save.base) || [];
  return BASE_UPGRADES.some((u) => u.effect === effect && owned.includes(u.id));
}
export function baseMag(save, effect, dflt) {
  const owned = (save && save.base) || [];
  const u = BASE_UPGRADES.find((x) => x.effect === effect && owned.includes(x.id));
  return u && u.mag != null ? u.mag : dflt;
}
export function canBuyBase(save, id) {
  const u = UPG_BY.get(id);
  if (!u) return { ok: false, reason: 'unknown' };
  if ((save.base || []).includes(id)) return { ok: false, reason: 'owned' };
  const c = u.cost;
  if ((save.naquadah || 0) < (c.naquadah || 0)) return { ok: false, reason: 'naquadah' };
  if ((save.intel || 0) < (c.intel || 0)) return { ok: false, reason: 'intel' };
  if ((save.salvage || 0) < (c.salvage || 0)) return { ok: false, reason: 'salvage' };
  return { ok: true };
}
// mutates save: spends and records. caller persists.
export function buyBase(save, id) {
  const chk = canBuyBase(save, id);
  if (!chk.ok) return chk;
  const c = UPG_BY.get(id).cost;
  save.naquadah -= c.naquadah || 0;
  save.intel -= c.intel || 0;
  save.salvage -= c.salvage || 0;
  if (!Array.isArray(save.base)) save.base = [];
  save.base.push(id);
  return { ok: true };
}
