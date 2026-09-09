// Research tree — pure data + helpers. No rendering, no DOM, no side effects.
//
// The game owns the save blob. These helpers only read `save.naquadah`,
// `save.intel`, `save.salvage`, `save.tech` (an array of owned node ids) and
// `save.campaign.milestone` (integer, starts 0, +1 per completed Incursion
// Operation). Spending and persistence are the caller's job:
//     save.naquadah -= researchCost(id).naquadah;
//     save.intel    -= researchCost(id).intel   || 0;
//     save.salvage  -= researchCost(id).salvage || 0;
//     save.tech.push(id); persist();
//
// TECH is laid out in FIVE branches, each stepped by `tier` (0..5) so a UI can
// drop the nodes straight into a grid (tier = column, branch = row, say).
// Costs escalate with tier; tier-2+ nodes also cost `intel`; every `xeno` node
// also costs `salvage` (faction wreckage).
//
//   ops     — Field Ops:    survivability & mobility
//   armory  — Armory:       weapons, crits & gear
//   gate    — Gate Science:  economy & the shape of a run
//   xeno    — Xenotech:      reverse-engineered faction gear — heavy hitters,
//             every tier campaign-locked (milestone 2+)
//   command — SGC Support:   called-in help — airdrops, orbital strikes, kit
//
// Campaign gating: an optional `milestone: n` on a node (default 0 = always
// open) keeps it locked until `save.campaign.milestone >= n`. Rough spread:
// tier 0-2 -> 0, tier 3 -> 2-3, tier 4 -> 5-6, tier 5 -> 8+; the xeno branch
// runs ~2 milestones ahead. `canResearch` enforces it; `milestoneFor(id)` and
// the readable `node.milestone` expose it so a UI can show "LOCKED — Operation N".

export const TECH = [
  // ---------------------------------------------------------------- ops
  { id: 'ops_hp1', name: 'Combat Conditioning', branch: 'ops', tier: 0,
    cost: { naquadah: 40 }, requires: [],
    desc: '+25 maximum HP.' },
  { id: 'ops_dodgecd', name: 'Evasive Footwork', branch: 'ops', tier: 0,
    cost: { naquadah: 55 }, requires: [],
    desc: 'Dodge cooldown -20%.' },
  { id: 'ops_move1', name: 'Route March', branch: 'ops', tier: 0,
    cost: { naquadah: 50 }, requires: [],
    desc: '+6% move speed.' },
  { id: 'ops_hp2', name: 'Hardened Physiology', branch: 'ops', tier: 1,
    cost: { naquadah: 95 }, requires: ['ops_hp1'],
    desc: '+25 maximum HP.' },
  { id: 'ops_startshield', name: 'Issued Shield Cell', branch: 'ops', tier: 1,
    cost: { naquadah: 90 }, requires: ['ops_hp1'],
    desc: 'Begin every run with one charged shield cell.' },
  { id: 'ops_startarmor', name: 'Issued Kit', branch: 'ops', tier: 1,
    cost: { naquadah: 105 }, requires: ['ops_dodgecd'],
    desc: 'Begin every run wearing a light armour piece.' },
  { id: 'ops_dodgedist', name: 'Combat Roll', branch: 'ops', tier: 1,
    cost: { naquadah: 110 }, requires: ['ops_move1'],
    desc: 'Dodge covers +15% distance.' },
  { id: 'ops_dodge2', name: 'Reflex Booster', branch: 'ops', tier: 2,
    cost: { naquadah: 130, intel: 3 }, requires: ['ops_dodgecd'],
    desc: 'Gain a second dodge charge.' },
  { id: 'ops_hp3', name: 'Symbiote Graft', branch: 'ops', tier: 2,
    cost: { naquadah: 170, intel: 4 }, requires: ['ops_hp2'],
    desc: '+30 maximum HP.' },
  { id: 'ops_iframe', name: 'Phase Timing', branch: 'ops', tier: 2,
    cost: { naquadah: 165, intel: 3 }, requires: ['ops_dodgedist'],
    desc: 'Dodge i-frames last 25% longer.' },
  { id: 'ops_shieldregen', name: 'Cell Conditioner', branch: 'ops', tier: 2,
    cost: { naquadah: 175, intel: 4 }, requires: ['ops_startshield'],
    desc: 'Shields recharge 40% faster.' },
  { id: 'ops_revive', name: 'Sarcophagus Protocol', branch: 'ops', tier: 3,
    cost: { naquadah: 240, intel: 9 }, requires: ['ops_hp3', 'ops_dodge2'], milestone: 2,
    desc: 'One free self-revive per run.' },
  { id: 'ops_evade', name: 'Broken Silhouette', branch: 'ops', tier: 3,
    cost: { naquadah: 245, intel: 8 }, requires: ['ops_iframe'], milestone: 3,
    desc: 'Enemies are 10% less accurate against you.' },
  { id: 'ops_hp4', name: 'Ascended Vigour', branch: 'ops', tier: 4,
    cost: { naquadah: 320, intel: 14 }, requires: ['ops_revive'], milestone: 5,
    desc: '+40 maximum HP.' },
  { id: 'ops_dodge3', name: 'Kinetic Overclock', branch: 'ops', tier: 5,
    cost: { naquadah: 420, intel: 22 }, requires: ['ops_evade', 'ops_hp4'], milestone: 8,
    desc: 'Gain a third dodge charge.' },

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
  { id: 'arm_crit1', name: 'Marksman Doctrine', branch: 'armory', tier: 1,
    cost: { naquadah: 110 }, requires: ['arm_burst'],
    desc: '+5% critical-hit chance.' },
  { id: 'arm_slot3', name: 'Third Holster', branch: 'armory', tier: 2,
    cost: { naquadah: 150, intel: 4 }, requires: ['arm_burst'],
    desc: 'Carry a third weapon.' },
  { id: 'arm_beam', name: 'Ion Beam Clearance', branch: 'armory', tier: 2,
    cost: { naquadah: 200, intel: 6 }, requires: ['arm_launcher', 'arm_burst'],
    desc: 'Unlock the Ion Beam for requisition.' },
  { id: 'arm_grenadedmg', name: 'Comp-B Fill', branch: 'armory', tier: 2,
    cost: { naquadah: 160, intel: 3 }, requires: ['arm_grenade'],
    desc: 'Grenades deal +30% damage.' },
  { id: 'arm_critmul', name: 'Called Shots', branch: 'armory', tier: 2,
    cost: { naquadah: 175, intel: 4 }, requires: ['arm_crit1'],
    desc: 'Critical hits deal +30%.' },
  { id: 'arm_modslot', name: 'Field Armourer', branch: 'armory', tier: 3,
    cost: { naquadah: 210, intel: 5 }, requires: ['arm_slot3'], milestone: 2,
    desc: 'All weapons deal +15% damage.' },
  { id: 'arm_startmod', name: 'Prepped Loadout', branch: 'armory', tier: 3,
    cost: { naquadah: 235, intel: 7 }, requires: ['arm_modslot'], milestone: 3,
    desc: 'Start each run with 2 free weapon mod slots.' },
  { id: 'arm_grenaderad', name: 'Frag Sleeve', branch: 'armory', tier: 3,
    cost: { naquadah: 240, intel: 8 }, requires: ['arm_grenadedmg'], milestone: 3,
    desc: 'Grenade blast radius +25%.' },
  { id: 'arm_dmg2', name: 'Refined Ballistics', branch: 'armory', tier: 4,
    cost: { naquadah: 330, intel: 15 }, requires: ['arm_startmod'], milestone: 5,
    desc: 'All weapons deal a further +15% damage.' },
  { id: 'arm_overcharge', name: 'Weapon Overcharge', branch: 'armory', tier: 5,
    cost: { naquadah: 430, intel: 22 }, requires: ['arm_dmg2', 'arm_critmul'], milestone: 9,
    desc: '+20% weapon damage and +25% crit multiplier.' },

  // ---------------------------------------------------------------- gate
  { id: 'gate_dial', name: 'Efficient Dialling', branch: 'gate', tier: 0,
    cost: { naquadah: 50 }, requires: [],
    desc: 'Deep-dial cost -20%.' },
  { id: 'gate_look', name: 'Forward Telemetry', branch: 'gate', tier: 0,
    cost: { naquadah: 55 }, requires: [],
    desc: 'See one hop ahead on the gate map.' },
  { id: 'gate_pickup', name: 'Field Magnet', branch: 'gate', tier: 0,
    cost: { naquadah: 50 }, requires: [],
    desc: 'Pickup radius +25%.' },
  { id: 'gate_naq', name: 'Ore Assay', branch: 'gate', tier: 1,
    cost: { naquadah: 110 }, requires: ['gate_dial'],
    desc: 'Naquadah yield +25%.' },
  { id: 'gate_intel', name: 'Signal Intercept', branch: 'gate', tier: 1,
    cost: { naquadah: 115 }, requires: ['gate_look'],
    desc: 'Intel yield +25%.' },
  { id: 'gate_xp', name: 'Live-Fire Analytics', branch: 'gate', tier: 1,
    cost: { naquadah: 105 }, requires: ['gate_pickup'],
    desc: 'Weapon mastery accrues 30% faster.' },
  { id: 'gate_heat', name: 'Coolant Loop', branch: 'gate', tier: 2,
    cost: { naquadah: 130, intel: 3 }, requires: ['gate_look'],
    desc: 'Heat builds 20% slower.' },
  { id: 'gate_hop2', name: 'Staging Gate', branch: 'gate', tier: 2,
    cost: { naquadah: 160, intel: 4 }, requires: ['gate_dial'],
    desc: 'Start each run at hop 2.' },
  { id: 'gate_naq2', name: 'Deep Seam Survey', branch: 'gate', tier: 2,
    cost: { naquadah: 165, intel: 4 }, requires: ['gate_naq'],
    desc: 'Naquadah yield +25% more.' },
  { id: 'gate_death', name: 'Dead-Drop Cache', branch: 'gate', tier: 3,
    cost: { naquadah: 220, intel: 8 }, requires: ['gate_naq'], milestone: 2,
    desc: 'Keep 80% of your naquadah when you die.' },
  { id: 'gate_reveal', name: 'Long-Range Sensors', branch: 'gate', tier: 3,
    cost: { naquadah: 245, intel: 7 }, requires: ['gate_heat', 'gate_look'], milestone: 3,
    desc: 'The whole gate map is revealed each run.' },
  { id: 'gate_startconsum', name: 'Standing Requisition', branch: 'gate', tier: 3,
    cost: { naquadah: 230, intel: 8 }, requires: ['gate_xp'], milestone: 3,
    desc: 'Begin every run with a free medkit.' },
  { id: 'gate_intel2', name: 'Cryptanalysis Suite', branch: 'gate', tier: 4,
    cost: { naquadah: 320, intel: 16 }, requires: ['gate_reveal'], milestone: 5,
    desc: 'Intel yield +40%.' },
  { id: 'gate_hop3', name: 'Forward Firebase', branch: 'gate', tier: 4,
    cost: { naquadah: 315, intel: 14 }, requires: ['gate_hop2'], milestone: 6,
    desc: 'Start each run at hop 3.' },
  { id: 'gate_death2', name: 'Contingency Vault', branch: 'gate', tier: 5,
    cost: { naquadah: 410, intel: 20 }, requires: ['gate_death', 'gate_intel2'], milestone: 9,
    desc: 'Keep 95% of your naquadah on death; +20% yield.' },

  // ---------------------------------------------------------------- xeno
  { id: 'xeno_scan', name: 'Threat Cataloguing', branch: 'xeno', tier: 0,
    cost: { naquadah: 60, intel: 2, salvage: 12 }, requires: [], milestone: 2,
    desc: '+15% damage against scanned foes.' },
  { id: 'xeno_naquadah', name: 'Naquadah Refinement', branch: 'xeno', tier: 0,
    cost: { naquadah: 65, intel: 2, salvage: 12 }, requires: [], milestone: 2,
    desc: 'Salvage yield +30%.' },
  { id: 'xeno_shield', name: 'Personal Cloak Emitter', branch: 'xeno', tier: 1,
    cost: { naquadah: 120, intel: 4, salvage: 18 }, requires: ['xeno_scan'], milestone: 3,
    desc: '+1 maximum shield.' },
  { id: 'xeno_startsalv', name: 'Cached Alloys', branch: 'xeno', tier: 1,
    cost: { naquadah: 115, intel: 4, salvage: 16 }, requires: ['xeno_naquadah'], milestone: 3,
    desc: 'Start each run with 15 salvage.' },
  { id: 'xeno_pierce', name: 'Phase Rounds', branch: 'xeno', tier: 2,
    cost: { naquadah: 180, intel: 6, salvage: 26 }, requires: ['xeno_scan'], milestone: 4,
    desc: 'Shots pierce 50% more armour.' },
  { id: 'xeno_bestiary2', name: 'Vivisection Notes', branch: 'xeno', tier: 2,
    cost: { naquadah: 190, intel: 6, salvage: 26 }, requires: ['xeno_shield'], milestone: 4,
    desc: '+25% more damage against scanned foes.' },
  { id: 'xeno_staff', name: 'Staff Weapon Mastery', branch: 'xeno', tier: 3,
    cost: { naquadah: 260, intel: 10, salvage: 34 }, requires: ['xeno_pierce'], milestone: 5,
    desc: 'Unlock a charged alt-fire on energy weapons.' },
  { id: 'xeno_heal', name: "Goa'uld Healing Device", branch: 'xeno', tier: 3,
    cost: { naquadah: 250, intel: 9, salvage: 34 }, requires: ['xeno_startsalv'], milestone: 5,
    desc: 'Self-revive restores 75% HP; shields recharge 30% faster.' },
  { id: 'xeno_crit', name: 'Precision Targeting Matrix', branch: 'xeno', tier: 4,
    cost: { naquadah: 340, intel: 16, salvage: 44 }, requires: ['xeno_staff'], milestone: 7,
    desc: '+10% crit chance and +30% crit multiplier.' },
  { id: 'xeno_grav', name: 'Inertial Dampeners', branch: 'xeno', tier: 4,
    cost: { naquadah: 330, intel: 15, salvage: 44 }, requires: ['xeno_bestiary2'], milestone: 7,
    desc: '+12% move speed and +20% dodge distance.' },
  { id: 'xeno_ancient', name: 'Ancient Repository', branch: 'xeno', tier: 5,
    cost: { naquadah: 430, intel: 24, salvage: 60 }, requires: ['xeno_crit', 'arm_beam'], milestone: 9,
    desc: '+25% weapon damage and +30% more against scanned foes.' },
  { id: 'xeno_asc', name: 'Partial Ascension', branch: 'xeno', tier: 5,
    cost: { naquadah: 440, intel: 24, salvage: 62 }, requires: ['xeno_grav', 'xeno_heal'], milestone: 9,
    desc: '+50 maximum HP and +30% dodge i-frames.' },

  // ---------------------------------------------------------------- command
  { id: 'cmd_rations', name: 'Field Rations', branch: 'command', tier: 0,
    cost: { naquadah: 45 }, requires: [],
    desc: '+15 maximum HP.' },
  { id: 'cmd_intel', name: 'SGC Liaison', branch: 'command', tier: 0,
    cost: { naquadah: 55 }, requires: [],
    desc: 'Intel yield +15%.' },
  { id: 'cmd_kit', name: 'Petty Cash', branch: 'command', tier: 0,
    cost: { naquadah: 50 }, requires: [],
    desc: 'Start each run with 8 salvage.' },
  { id: 'cmd_medic', name: 'Trauma Team', branch: 'command', tier: 1,
    cost: { naquadah: 100 }, requires: ['cmd_rations'],
    desc: '+20 maximum HP.' },
  { id: 'cmd_airdrop', name: 'Resupply Beacon', branch: 'command', tier: 1,
    cost: { naquadah: 130, intel: 3 }, requires: ['cmd_kit'],
    desc: 'Call one airdrop per run.' },
  { id: 'cmd_uav', name: 'Overwatch UAV', branch: 'command', tier: 2,
    cost: { naquadah: 150, intel: 4 }, requires: ['cmd_intel'],
    desc: '+1 map lookahead and +15% pickup radius.' },
  { id: 'cmd_airdrop2', name: 'Deep Stores', branch: 'command', tier: 2,
    cost: { naquadah: 175, intel: 5 }, requires: ['cmd_airdrop'],
    desc: 'Airdrops also carry a free weapon mod slot.' },
  { id: 'cmd_strike', name: 'Orbital Strike Authorisation', branch: 'command', tier: 3,
    cost: { naquadah: 250, intel: 9 }, requires: ['cmd_airdrop2'], milestone: 3,
    desc: 'Call one orbital strike per run.' },
  { id: 'cmd_evac', name: 'Emergency Evac', branch: 'command', tier: 3,
    cost: { naquadah: 235, intel: 8 }, requires: ['cmd_uav'], milestone: 3,
    desc: 'Keep 75% of your naquadah when you die.' },
  { id: 'cmd_strike2', name: 'Danger Close Doctrine', branch: 'command', tier: 4,
    cost: { naquadah: 330, intel: 15 }, requires: ['cmd_strike'], milestone: 6,
    desc: '+40% grenade damage; enemies 8% less accurate.' },
  { id: 'cmd_reinforce', name: 'SG Team Rotation', branch: 'command', tier: 4,
    cost: { naquadah: 320, intel: 14 }, requires: ['cmd_evac', 'cmd_medic'], milestone: 6,
    desc: '+35 maximum HP and start with a shield cell.' },
  { id: 'cmd_prometheus', name: 'Prometheus On Station', branch: 'command', tier: 5,
    cost: { naquadah: 440, intel: 24 }, requires: ['cmd_strike2', 'cmd_reinforce', 'gate_reveal'], milestone: 8,
    desc: 'Orbital strike recharges once; +15% weapon damage, +8% move speed.' },
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

// Campaign milestone a node needs before it can be researched (0 = always open).
// Null for an unknown id.
export function milestoneFor(id) {
  const n = BY_ID.get(id);
  return n ? n.milestone || 0 : null;
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
    // mobility / evasion
    moveSpeedMul: 1,
    dodgeDistMul: 1,
    iframeMul: 1,
    pickupRadiusMul: 1,
    // shields
    shieldRegenMul: 1,
    shieldMaxBonus: 0,
    // grenades / crits / penetration
    grenadeDmgMul: 1,
    grenadeRadiusMul: 1,
    critChance: 0,
    critMul: 2,
    armorPierceMul: 1,
    // economy / progression
    startSalvage: 0,
    salvageMul: 1,
    xpMul: 1,
    bestiaryDmgMul: 1,
    // revive / free kit
    reviveHpFrac: 0.5,
    startConsumable: null,
    startModSlots: 0,
    mapFullReveal: false,
    // SGC support
    supportAirdrop: false,
    supportStrike: false,
    enemyAccuracyMul: 1,
    staffChargeUnlock: false,
  };
}

const EFFECT_APPLY = {
  // ops
  ops_hp1: (e) => { e.maxHpBonus += 25; },
  ops_hp2: (e) => { e.maxHpBonus += 25; },
  ops_hp3: (e) => { e.maxHpBonus += 30; },
  ops_hp4: (e) => { e.maxHpBonus += 40; },
  ops_dodgecd: (e) => { e.dodgeCdMul *= 0.8; },
  ops_dodge2: (e) => { e.dodgeCharges += 1; },
  ops_dodge3: (e) => { e.dodgeCharges += 1; },
  ops_move1: (e) => { e.moveSpeedMul *= 1.06; },
  ops_dodgedist: (e) => { e.dodgeDistMul *= 1.15; },
  ops_iframe: (e) => { e.iframeMul *= 1.25; },
  ops_shieldregen: (e) => { e.shieldRegenMul *= 1.4; },
  ops_evade: (e) => { e.enemyAccuracyMul *= 0.9; },
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
  arm_dmg2: (e) => { e.weaponDmgMul *= 1.15; },
  arm_crit1: (e) => { e.critChance += 0.05; },
  arm_critmul: (e) => { e.critMul *= 1.3; },
  arm_grenadedmg: (e) => { e.grenadeDmgMul *= 1.3; },
  arm_grenaderad: (e) => { e.grenadeRadiusMul *= 1.25; },
  arm_startmod: (e) => { e.startModSlots += 2; },
  arm_overcharge: (e) => { e.weaponDmgMul *= 1.2; e.critMul *= 1.25; },
  // gate
  gate_dial: (e) => { e.dialCostMul *= 0.8; },
  gate_look: (e) => { e.mapLookahead += 1; },
  gate_pickup: (e) => { e.pickupRadiusMul *= 1.25; },
  gate_hop2: (e) => { e.startHop = 2; },
  gate_hop3: (e) => { e.startHop = 3; },
  gate_heat: (e) => { e.heatMul *= 0.8; },
  gate_naq: (e) => { e.naquadahMul *= 1.25; },
  gate_naq2: (e) => { e.naquadahMul *= 1.25; },
  gate_intel: (e) => { e.intelMul *= 1.25; },
  gate_intel2: (e) => { e.intelMul *= 1.4; },
  gate_xp: (e) => { e.xpMul *= 1.3; },
  gate_reveal: (e) => { e.mapFullReveal = true; },
  gate_startconsum: (e) => { e.startConsumable = 'c_medkit'; },
  gate_death: (e) => { e.deathKeepFrac = 0.8; },
  gate_death2: (e) => { e.deathKeepFrac = 0.95; e.naquadahMul *= 1.2; },
  // xeno
  xeno_scan: (e) => { e.bestiaryDmgMul *= 1.15; },
  xeno_naquadah: (e) => { e.salvageMul *= 1.3; },
  xeno_shield: (e) => { e.shieldMaxBonus += 1; },
  xeno_startsalv: (e) => { e.startSalvage += 15; },
  xeno_pierce: (e) => { e.armorPierceMul *= 1.5; },
  xeno_bestiary2: (e) => { e.bestiaryDmgMul *= 1.25; },
  xeno_staff: (e) => { e.staffChargeUnlock = true; },
  xeno_heal: (e) => { e.reviveHpFrac = 0.75; e.shieldRegenMul *= 1.3; },
  xeno_crit: (e) => { e.critChance += 0.1; e.critMul *= 1.3; },
  xeno_grav: (e) => { e.moveSpeedMul *= 1.12; e.dodgeDistMul *= 1.2; },
  xeno_ancient: (e) => { e.weaponDmgMul *= 1.25; e.bestiaryDmgMul *= 1.3; },
  xeno_asc: (e) => { e.maxHpBonus += 50; e.iframeMul *= 1.3; },
  // command
  cmd_rations: (e) => { e.maxHpBonus += 15; },
  cmd_intel: (e) => { e.intelMul *= 1.15; },
  cmd_kit: (e) => { e.startSalvage += 8; },
  cmd_medic: (e) => { e.maxHpBonus += 20; },
  cmd_airdrop: (e) => { e.supportAirdrop = true; },
  cmd_uav: (e) => { e.mapLookahead += 1; e.pickupRadiusMul *= 1.15; },
  cmd_airdrop2: (e) => { e.startModSlots += 1; },
  cmd_strike: (e) => { e.supportStrike = true; },
  cmd_evac: (e) => { e.deathKeepFrac = 0.75; },
  cmd_strike2: (e) => { e.grenadeDmgMul *= 1.4; e.enemyAccuracyMul *= 0.92; },
  cmd_reinforce: (e) => { e.maxHpBonus += 35; e.startShield += 1; },
  cmd_prometheus: (e) => { e.supportStrike = true; e.weaponDmgMul *= 1.15; e.moveSpeedMul *= 1.08; },
};

// Merge every owned node's contribution onto the defaults. Order-independent
// for every node except the flat setters (startHop / startArmor / deathKeepFrac
// / startConsumable / reviveHpFrac / mapFullReveal / the support booleans),
// which just assign, so owning them once or in any order lands the same place.
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
  const milestone = (save && save.campaign && save.campaign.milestone) || 0;
  if (milestone < (node.milestone || 0)) return false;
  const naq = (save && save.naquadah) || 0;
  const intel = (save && save.intel) || 0;
  const salvage = (save && save.salvage) || 0;
  if (naq < node.cost.naquadah) return false;
  if (intel < (node.cost.intel || 0)) return false;
  if (salvage < (node.cost.salvage || 0)) return false;
  return true;
}
