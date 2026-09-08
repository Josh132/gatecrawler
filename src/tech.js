// Research tree — pure data + helpers. No rendering, no DOM, no side effects.
//
// The game owns the save blob. These helpers only read `save.naquadah`,
// `save.intel` and `save.tech` (an array of owned node ids). Spending and
// persistence are the caller's job:
//     save.naquadah -= researchCost(id).naquadah;
//     save.intel    -= researchCost(id).intel || 0;
//     save.tech.push(id); persist();
//
// TECH is laid out in three branches, each stepped by `tier` (0..3) so a UI
// can drop the nodes straight into a grid (tier = column, branch = row, say).
// Costs escalate with tier; the tier-2/3 keystones also cost `intel`.
//
//   ops    — Field Ops:   survivability & mobility
//   armory — Armory:      weapons & gear
//   gate   — Gate Science: economy & the shape of a run

export const TECH = [
  // ---------------------------------------------------------------- ops
  { id: 'ops_hp1', name: 'Combat Conditioning', branch: 'ops', tier: 0,
    cost: { naquadah: 40 }, requires: [],
    desc: '+25 maximum HP.' },
  { id: 'ops_dodgecd', name: 'Evasive Footwork', branch: 'ops', tier: 0,
    cost: { naquadah: 55 }, requires: [],
    desc: 'Dodge cooldown -20%.' },
  { id: 'ops_hp2', name: 'Hardened Physiology', branch: 'ops', tier: 1,
    cost: { naquadah: 95 }, requires: ['ops_hp1'],
    desc: '+25 maximum HP.' },
  { id: 'ops_startshield', name: 'Issued Shield Cell', branch: 'ops', tier: 1,
    cost: { naquadah: 90 }, requires: ['ops_hp1'],
    desc: 'Begin every run with one charged shield cell.' },
  { id: 'ops_startarmor', name: 'Issued Kit', branch: 'ops', tier: 1,
    cost: { naquadah: 105 }, requires: ['ops_dodgecd'],
    desc: 'Begin every run wearing a light armour piece.' },
  { id: 'ops_dodge2', name: 'Reflex Booster', branch: 'ops', tier: 2,
    cost: { naquadah: 130, intel: 3 }, requires: ['ops_dodgecd'],
    desc: 'Gain a second dodge charge.' },
  { id: 'ops_hp3', name: 'Symbiote Graft', branch: 'ops', tier: 2,
    cost: { naquadah: 170, intel: 4 }, requires: ['ops_hp2'],
    desc: '+30 maximum HP.' },
  { id: 'ops_revive', name: 'Sarcophagus Protocol', branch: 'ops', tier: 3,
    cost: { naquadah: 240, intel: 9 }, requires: ['ops_hp3', 'ops_dodge2'],
    desc: 'One free self-revive per run.' },

  // ---------------------------------------------------------------- armory
  { id: 'arm_shotgun', name: 'Shotgun Clearance', branch: 'armory', tier: 0,
    cost: { naquadah: 45 }, requires: [],
    desc: 'Unlock the Assault Shotgun for requisition.' },
  { id: 'arm_burst', name: 'Burst Rifle Clearance', branch: 'armory', tier: 0,
    cost: { naquadah: 50 }, requires: [],
    desc: 'Unlock the Burst Rifle for requisition.' },
  { id: 'arm_reload', name: 'Drilled Reloads', branch: 'armory', tier: 0,
    cost: { naquadah: 55 }, requires: [],
    desc: 'Every reload is 20% faster.' },
  { id: 'arm_grenade', name: 'Bandolier', branch: 'armory', tier: 1,
    cost: { naquadah: 95 }, requires: ['arm_reload'],
    desc: '+1 grenade-slot capacity.' },
  { id: 'arm_launcher', name: 'Launcher Clearance', branch: 'armory', tier: 1,
    cost: { naquadah: 130, intel: 3 }, requires: ['arm_shotgun'],
    desc: 'Unlock the Grenade Launcher for requisition.' },
  { id: 'arm_slot3', name: 'Third Holster', branch: 'armory', tier: 2,
    cost: { naquadah: 150, intel: 4 }, requires: ['arm_burst'],
    desc: 'Carry a third weapon.' },
  { id: 'arm_beam', name: 'Ion Beam Clearance', branch: 'armory', tier: 2,
    cost: { naquadah: 200, intel: 6 }, requires: ['arm_launcher', 'arm_burst'],
    desc: 'Unlock the Ion Beam for requisition.' },
  { id: 'arm_modslot', name: 'Field Armourer', branch: 'armory', tier: 3,
    cost: { naquadah: 210, intel: 5 }, requires: ['arm_slot3'],
    desc: 'All weapons deal +15% damage.' },

  // ---------------------------------------------------------------- gate
  { id: 'gate_dial', name: 'Efficient Dialling', branch: 'gate', tier: 0,
    cost: { naquadah: 50 }, requires: [],
    desc: 'Deep-dial cost -20%.' },
  { id: 'gate_look', name: 'Forward Telemetry', branch: 'gate', tier: 0,
    cost: { naquadah: 55 }, requires: [],
    desc: 'See one hop ahead on the gate map.' },
  { id: 'gate_naq', name: 'Ore Assay', branch: 'gate', tier: 1,
    cost: { naquadah: 110 }, requires: ['gate_dial'],
    desc: 'Naquadah yield +25%.' },
  { id: 'gate_intel', name: 'Signal Intercept', branch: 'gate', tier: 1,
    cost: { naquadah: 115 }, requires: ['gate_look'],
    desc: 'Intel yield +25%.' },
  { id: 'gate_heat', name: 'Coolant Loop', branch: 'gate', tier: 2,
    cost: { naquadah: 130, intel: 3 }, requires: ['gate_look'],
    desc: 'Heat builds 20% slower.' },
  { id: 'gate_hop2', name: 'Staging Gate', branch: 'gate', tier: 2,
    cost: { naquadah: 160, intel: 4 }, requires: ['gate_dial'],
    desc: 'Start each run at hop 2.' },
  { id: 'gate_death', name: 'Dead-Drop Cache', branch: 'gate', tier: 3,
    cost: { naquadah: 220, intel: 8 }, requires: ['gate_naq'],
    desc: 'Keep 80% of your naquadah when you die.' },
];

// ---------------------------------------------------------------- lookup
const BY_ID = new Map(TECH.map((n) => [n.id, n]));

export function nodeById(id) {
  return BY_ID.get(id) || null;
}

export function researchCost(id) {
  const n = BY_ID.get(id);
  return n ? { ...n.cost } : null;
}

// ---------------------------------------------------------------- effects
//
// The default effects object, returned by techEffects([]). Every owned node
// folds into this via EFFECT_APPLY[id] below — one entry per node id, kept
// here so the whole data->stat mapping lives in one place.
export function defaultEffects() {
  return {
    maxHpBonus: 0,
    dodgeCharges: 1,
    dodgeCdMul: 1,
    startArmor: null,
    startShield: 0,
    freeRevive: false,
    weaponSlots: 2,
    reloadMul: 1,
    grenadeCap: 4,
    weaponDmgMul: 1,
    weaponModSlots: 0,
    unlockedWeapons: [],
    dialCostMul: 1,
    mapLookahead: 0,
    startHop: 0,
    heatMul: 1,
    naquadahMul: 1,
    intelMul: 1,
    deathKeepFrac: 0.5,
  };
}

const EFFECT_APPLY = {
  // ops
  ops_hp1: (e) => { e.maxHpBonus += 25; },
  ops_hp2: (e) => { e.maxHpBonus += 25; },
  ops_hp3: (e) => { e.maxHpBonus += 30; },
  ops_dodgecd: (e) => { e.dodgeCdMul *= 0.8; },
  ops_dodge2: (e) => { e.dodgeCharges += 1; },
  ops_startshield: (e) => { e.startShield += 1; },
  ops_startarmor: (e) => { e.startArmor = 'a_vest'; },
  ops_revive: (e) => { e.freeRevive = true; },
  // armory
  arm_shotgun: (e) => { e.unlockedWeapons.push('w_shotgun'); },
  arm_burst: (e) => { e.unlockedWeapons.push('w_burst'); },
  arm_launcher: (e) => { e.unlockedWeapons.push('w_launcher'); },
  arm_beam: (e) => { e.unlockedWeapons.push('w_beam'); },
  arm_reload: (e) => { e.reloadMul *= 0.8; },
  arm_grenade: (e) => { e.grenadeCap += 1; },
  arm_slot3: (e) => { e.weaponSlots += 1; },
  arm_modslot: (e) => { e.weaponDmgMul *= 1.15; },
  // gate
  gate_dial: (e) => { e.dialCostMul *= 0.8; },
  gate_look: (e) => { e.mapLookahead += 1; },
  gate_hop2: (e) => { e.startHop = 2; },
  gate_heat: (e) => { e.heatMul *= 0.8; },
  gate_naq: (e) => { e.naquadahMul *= 1.25; },
  gate_intel: (e) => { e.intelMul *= 1.25; },
  gate_death: (e) => { e.deathKeepFrac = 0.8; },
};

// Merge every owned node's contribution onto the defaults. Order-independent
// for every node except the flat setters (startHop / deathKeepFrac / startArmor),
// which just assign, so owning them once or twice is identical.
export function techEffects(ownedIds) {
  const e = defaultEffects();
  for (const id of ownedIds || []) {
    const fn = EFFECT_APPLY[id];
    if (fn) fn(e);
  }
  return e;
}

// ---------------------------------------------------------------- gating
export function canResearch(save, id) {
  const node = BY_ID.get(id);
  if (!node) return false;
  const owned = (save && save.tech) || [];
  if (owned.includes(id)) return false;
  for (const req of node.requires) {
    if (!owned.includes(req)) return false;
  }
  const naq = (save && save.naquadah) || 0;
  const intel = (save && save.intel) || 0;
  if (naq < node.cost.naquadah) return false;
  if (intel < (node.cost.intel || 0)) return false;
  return true;
}
