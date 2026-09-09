// The Incursion — Gate Crawler's overarching campaign. Pure data + pure
// functions; the game owns `save` and calls in. No DOM, no Math.random, no
// imports except ./address.js.
//
// ─── save.campaign shape (owned by game.js defaultSave) ──────────────────
//   { op: <opId|'finale'|null>, progress: { [objId]: number },
//     completed: [opId...], milestone: 0, won: false }
//   milestone rises by 1 per completed Operation (1..N); the finale grants N+1.
//   `progress` counts only toward the ACTIVE operation and is wiped on claim.
//
// ─── event shapes recordEvents(save, events) understands ────────────────
//   { t:'kill',       kind, faction, threat }      // one enemy died     -> killEnemy
//   { t:'bossKill',   faction, threat, mods:[] }   // a DHD/faction boss died -> boss death
//   { t:'worldClear', faction, threat, mods:[] }   // every room on a world cleared -> last room-cleared
//   { t:'depth',      threat, hop }                // arrived on a world (tracks the max) -> startWorld
//   { t:'recover' }                               // recovered a data core -> special-room pickup
//   { t:'rescue' }                                // an SG team reached home alive -> special-room pickup / dialHome
//   { t:'dialHome',   roomsCleared, died }        // a run ended at the home gate -> dialHome
//   { t:'runStart' }                             // a fresh run began -> launchRun
//   unknown or mismatched events are ignored. events is an array.
//
// ─── objective shape ───────────────────────────────────────────────────
//   { id, type, faction?, kind?, count, minThreat?, minHop?, mod?, desc }
//   types: kills | bossKills | clearWorlds | reachDepth | recoverItems
//          | rescue | surviveRun

import { GLYPHS, HOME } from './address.js';

// a fixed deep address, built deterministically from the glyph table — the
// serpent-bearer chain: Draco, Ophiuchus, Hercules, Scorpius, Lynx, Ursa Minor.
export const FINALE_ADDRESS = [
  GLYPHS[20], GLYPHS[19], GLYPHS[18], GLYPHS[7], GLYPHS[34], GLYPHS[35],
].join('-');

// ─────────────────────────────────────────────────────────────── operations
// ordered, escalating. act 1 = jaffa, shallow. act 2 = wraith + replicator,
// mid depth, first recover/rescue. act 3 = deep, boss-heavy, mods required.
export const OPERATIONS = [
  // ------------------------------------------------------------------ act 1
  {
    id: 'op_sand_viper', name: 'Operation Sand Viper', act: 1,
    brief:
      "A Jaffa patrol network is staging raids one hop off the SGC's doorstep. " +
      'Deploy, thin their ranks, and let the System Lords know Earth dials back. ' +
      'Nothing fancy — go loud and come home.',
    targetHint: 'Jaffa space, any depth',
    objectives: [
      { id: 'kills', type: 'kills', faction: 'jaffa', count: 12,
        desc: 'Kill 12 Jaffa' },
    ],
    reward: { naquadah: 60, milestone: 1 },
  },
  {
    id: 'op_broken_staff', name: 'Operation Broken Staff', act: 1,
    brief:
      'The raiders fall back to fortified garrison worlds with grenadier support. ' +
      'Sweep two of them end to end and put down the displacer crews before they ' +
      'can scatter your fire teams.',
    targetHint: 'Jaffa strongholds, threat 2+',
    objectives: [
      { id: 'clear', type: 'clearWorlds', faction: 'jaffa', count: 2, minThreat: 2,
        desc: 'Fully clear 2 Jaffa worlds (threat 2+)' },
      { id: 'grenadiers', type: 'kills', kind: 'jaffa_grenadier', count: 4,
        desc: 'Kill 4 Jaffa grenadiers' },
    ],
    reward: { naquadah: 90, salvage: 20, tech: 'arm_burst', milestone: 2 },
  },
  {
    id: 'op_serpents_head', name: "Operation Serpent's Head", act: 1,
    brief:
      'Intel places a regional commander holding a gate on a deep garrison world. ' +
      "Cut off the head and the raids stop. Push past the shallow sectors, take the " +
      'DHD room, and end him.',
    targetHint: 'A Jaffa command world with a DHD boss',
    objectives: [
      { id: 'boss', type: 'bossKills', faction: 'jaffa', count: 1,
        desc: 'Defeat 1 Jaffa boss' },
      { id: 'depth', type: 'reachDepth', minThreat: 3,
        desc: 'Reach threat 3 in a single run' },
    ],
    reward: { naquadah: 110, intel: 4, weapon: 'w_staff', milestone: 3 },
  },
  // ------------------------------------------------------------------ act 2
  {
    id: 'op_nightfall', name: 'Operation Nightfall', act: 2,
    brief:
      'A Wraith hive has woken in an adjacent sector and started culling worlds ' +
      'we were about to contact. Hit their feeding grounds hard and clear a hive ' +
      'world before the swarm spreads.',
    targetHint: 'Wraith hive space, threat 3+',
    objectives: [
      { id: 'kills', type: 'kills', faction: 'wraith', count: 16,
        desc: 'Kill 16 Wraith' },
      { id: 'clear', type: 'clearWorlds', faction: 'wraith', count: 1,
        desc: 'Fully clear 1 Wraith world' },
    ],
    reward: { naquadah: 130, intel: 5, tech: 'gate_look', milestone: 4 },
  },
  {
    id: 'op_hollow_men', name: 'Operation Hollow Men', act: 2,
    brief:
      'Two SG teams went dark and the hive is holding the survivors as a larder. ' +
      'Get in, get them to a gate, and get them home breathing. Kill anything ' +
      'wearing Wraith leather on the way out.',
    targetHint: 'Wraith worlds holding captured SG teams',
    objectives: [
      { id: 'rescue', type: 'rescue', count: 2,
        desc: 'Bring 2 captured SG teams home alive' },
      { id: 'kills', type: 'kills', faction: 'wraith', count: 10, minThreat: 4,
        desc: 'Kill 10 Wraith on threat 4+ worlds' },
    ],
    reward: { naquadah: 140, intel: 6, consumable: 'medkit', milestone: 5 },
  },
  {
    id: 'op_cold_harvest', name: 'Operation Cold Harvest', act: 2,
    brief:
      'The hive queen is dug in deep and her drones are shipping Ancient data ' +
      'cores out through the gate. Recover the cores and take the queen off the ' +
      'board.',
    targetHint: 'Deep Wraith hives, threat 5+',
    objectives: [
      { id: 'boss', type: 'bossKills', faction: 'wraith', count: 1, minThreat: 5,
        desc: 'Defeat 1 Wraith boss (threat 5+)' },
      { id: 'cores', type: 'recoverItems', count: 2,
        desc: 'Recover 2 data cores' },
    ],
    reward: { naquadah: 160, intel: 7, tech: 'ops_startshield', milestone: 6 },
  },
  {
    id: 'op_iron_rain', name: 'Operation Iron Rain', act: 2,
    brief:
      'Replicator blocks have seeded a cluster of worlds and are multiplying ' +
      'past containment. There is no negotiating with a machine that eats gates. ' +
      'Break the cluster and clear a seeded world to the walls.',
    targetHint: 'Replicator space, threat 4+',
    objectives: [
      { id: 'kills', type: 'kills', faction: 'replicator', count: 20,
        desc: 'Destroy 20 Replicators' },
      { id: 'clear', type: 'clearWorlds', faction: 'replicator', count: 1, minThreat: 4,
        desc: 'Fully clear 1 Replicator world (threat 4+)' },
    ],
    reward: { naquadah: 170, intel: 8, tech: 'arm_launcher', milestone: 7 },
  },
  {
    id: 'op_unmaking', name: 'Operation Unmaking', act: 2,
    brief:
      'The cluster has a nucleus — a coordinating form the blocks answer to. ' +
      'Dial deep, find the core world, and unmake it before the swarm learns ' +
      'to dial for itself.',
    targetHint: 'A Replicator core world, threat 6+',
    objectives: [
      { id: 'boss', type: 'bossKills', faction: 'replicator', count: 1,
        desc: 'Defeat 1 Replicator boss' },
      { id: 'depth', type: 'reachDepth', minThreat: 6,
        desc: 'Reach threat 6 in a single run' },
    ],
    reward: { naquadah: 190, intel: 10, salvage: 40, milestone: 8 },
  },
  // ------------------------------------------------------------------ act 3
  {
    id: 'op_black_tide', name: 'Operation Black Tide', act: 3,
    brief:
      'Every faction is converging on the same deep sector and something is ' +
      'drawing them. Whatever it is, it is guarded. Hunt the guardians, pull the ' +
      'cores they are protecting, and start mapping the way in.',
    targetHint: 'Any faction, threat 6+, boss worlds',
    objectives: [
      { id: 'boss', type: 'bossKills', count: 3, minThreat: 6,
        desc: 'Defeat 3 bosses on threat 6+ worlds' },
      { id: 'cores', type: 'recoverItems', count: 3,
        desc: 'Recover 3 data cores' },
    ],
    reward: { naquadah: 220, intel: 14, tech: 'ops_hp3', milestone: 9 },
  },
  {
    id: 'op_eclipse_protocol', name: 'Operation Eclipse Protocol', act: 3,
    brief:
      'The approach worlds sit under permanent eclipse and rolling ion storms — ' +
      'the Nexus is bending its own space to keep us out. Fight through the dark ' +
      'and the static. Clear the shrouded worlds; kill what commands them.',
    targetHint: 'Eclipse / ion-storm worlds, threat 7+',
    objectives: [
      { id: 'clear', type: 'clearWorlds', count: 2, minThreat: 7, mod: 'eclipse',
        desc: 'Clear 2 eclipse worlds (threat 7+)' },
      { id: 'boss', type: 'bossKills', count: 2, minThreat: 7, mod: 'ion-storm',
        desc: 'Defeat 2 bosses on ion-storm worlds (threat 7+)' },
    ],
    reward: { naquadah: 250, intel: 18, weapon: 'w_beam', milestone: 10 },
  },
  {
    id: 'op_last_gate', name: 'Operation Last Gate', act: 3,
    brief:
      'One address left between us and the Nexus, and it is the deepest gate ' +
      'anyone from Earth has dialled. Prove the route is survivable, break its ' +
      'defenders, and hold the far side. Then we finish this.',
    targetHint: 'The deep network, threat 8-10',
    objectives: [
      { id: 'survive', type: 'surviveRun', count: 6,
        desc: 'Dial home from a run of 6+ cleared sectors, no deaths' },
      { id: 'boss', type: 'bossKills', count: 4, minThreat: 8,
        desc: 'Defeat 4 bosses on threat 8+ worlds' },
      { id: 'depth', type: 'reachDepth', minThreat: 10,
        desc: 'Reach threat 10 in a single run' },
    ],
    reward: { naquadah: 300, intel: 24, tech: 'ops_revive', milestone: 11 },
  },
];

// ─────────────────────────────────────────────────────────────────── finale
export const FINALE = {
  id: 'finale', name: 'The Incursion Nexus', act: 99,
  brief:
    'The Nexus is a gate that dials gates — the hub every incursion has been ' +
    'staged from. It is awake, it is defended by a construct wearing all three ' +
    'factions at once, and it knows Earth is coming. Walk through. End it.',
  address: FINALE_ADDRESS,
  superBoss: { kind: 'nexus', threat: 10 },
  targetHint: 'Fixed address ' + FINALE_ADDRESS + ', threat 10',
  objectives: [
    { id: 'nexus', type: 'bossKills', faction: 'nexus', count: 1,
      desc: 'Destroy the Incursion Nexus core' },
  ],
  reward: { naquadah: 500, intel: 30, salvage: 100, tech: 'arm_modslot', milestone: OPERATIONS.length + 1 },
  unlockAfter: OPERATIONS.length,
};

// ─────────────────────────────────────────────────────────────────── lookup
const OP_BY_ID = new Map(OPERATIONS.map((o) => [o.id, o]));

export function opById(id) {
  if (id === 'finale') return FINALE;
  return OP_BY_ID.get(id) || null;
}

function nextOp(id) {
  const i = OPERATIONS.findIndex((o) => o.id === id);
  if (i < 0 || i + 1 >= OPERATIONS.length) return null;
  return OPERATIONS[i + 1];
}

function allOpsComplete(completed) {
  const done = completed || [];
  return OPERATIONS.every((o) => done.includes(o.id));
}

// how much an objective needs; reachDepth measures a threshold, not a count
export function objectiveNeed(obj) {
  if (!obj) return 1;
  if (obj.type === 'reachDepth') return obj.minHop || obj.minThreat || 1;
  return obj.count || 1;
}

// a short label for war-map lists — the authored desc, or a built fallback
export function objectiveLabel(obj) {
  if (!obj) return '';
  if (obj.desc) return obj.desc;
  const need = objectiveNeed(obj);
  const who = obj.kind || obj.faction || 'targets';
  switch (obj.type) {
    case 'kills': return 'kill ' + need + ' ' + who;
    case 'bossKills': return 'defeat ' + need + ' bosses';
    case 'clearWorlds': return 'clear ' + need + ' worlds';
    case 'reachDepth': return 'reach ' + (obj.minHop ? 'hop ' : 'threat ') + need;
    case 'recoverItems': return 'recover ' + need + ' data cores';
    case 'rescue': return 'rescue ' + need + ' SG teams';
    case 'surviveRun': return 'survive a run of ' + need + ' sectors';
    default: return obj.type;
  }
}

// ─────────────────────────────────────────────────────────── active operation
// current OPERATION object, or FINALE when every op is done and !won, or null
// once won.
export function activeOperation(save) {
  const c = (save && save.campaign) || {};
  if (c.won) return null;
  const completed = c.completed || [];
  if (allOpsComplete(completed)) return FINALE;
  if (c.op && c.op !== 'finale') {
    const o = OP_BY_ID.get(c.op);
    if (o && !completed.includes(o.id)) return o;
  }
  for (const o of OPERATIONS) if (!completed.includes(o.id)) return o;
  return FINALE;
}

// ─────────────────────────────────────────────────────────────── progress read
export function operationProgress(save) {
  const op = activeOperation(save);
  if (!op) {
    return { op: null, objectives: [], allDone: true, rewardPreview: null };
  }
  const prog = (save && save.campaign && save.campaign.progress) || {};
  const objectives = (op.objectives || []).map((obj) => {
    const need = objectiveNeed(obj);
    const raw = prog[obj.id] || 0;
    return { ...obj, have: Math.min(raw, need), need, done: raw >= need };
  });
  const allDone = objectives.every((o) => o.done);
  return { op, objectives, allDone, rewardPreview: op.reward || null };
}

// ─────────────────────────────────────────────────────────── event recording
// fold one event into one objective's counter. returns true if it moved.
function applyEvent(obj, ev, prog) {
  const key = obj.id;
  const cur = prog[key] || 0;
  const need = objectiveNeed(obj);
  let next = cur;
  switch (obj.type) {
    case 'kills':
      if (ev.t !== 'kill') return false;
      if (obj.faction && ev.faction !== obj.faction) return false;
      if (obj.kind && ev.kind !== obj.kind) return false;
      if (obj.minThreat && (ev.threat || 0) < obj.minThreat) return false;
      next = Math.min(need, cur + 1);
      break;
    case 'bossKills':
      if (ev.t !== 'bossKill') return false;
      if (obj.faction && ev.faction !== obj.faction) return false;
      if (obj.minThreat && (ev.threat || 0) < obj.minThreat) return false;
      if (obj.mod && !(ev.mods || []).includes(obj.mod)) return false;
      next = Math.min(need, cur + 1);
      break;
    case 'clearWorlds':
      if (ev.t !== 'worldClear') return false;
      if (obj.faction && ev.faction !== obj.faction) return false;
      if (obj.minThreat && (ev.threat || 0) < obj.minThreat) return false;
      if (obj.mod && !(ev.mods || []).includes(obj.mod)) return false;
      next = Math.min(need, cur + 1);
      break;
    case 'reachDepth': {
      if (ev.t !== 'depth') return false;
      const metric = obj.minHop ? (ev.hop || 0) : (ev.threat || 0);
      next = Math.min(need, Math.max(cur, metric));
      break;
    }
    case 'recoverItems':
      if (ev.t !== 'recover') return false;
      next = Math.min(need, cur + 1);
      break;
    case 'rescue':
      if (ev.t !== 'rescue') return false;
      next = Math.min(need, cur + 1);
      break;
    case 'surviveRun':
      if (ev.t !== 'dialHome' || ev.died) return false;
      next = Math.min(need, Math.max(cur, ev.roomsCleared || 0));
      break;
    default:
      return false;
  }
  if (next !== cur) {
    prog[key] = next;
    return true;
  }
  return false;
}

// mutates save.campaign.progress. counts events toward the ACTIVE op only.
export function recordEvents(save, events) {
  ensureCampaign(save);
  let changed = false;
  const op = activeOperation(save);
  if (!op || !op.objectives) return { changed };
  const c = save.campaign;
  const prog = c.progress || (c.progress = {});
  for (const ev of events || []) {
    if (!ev || !ev.t) continue;
    for (const obj of op.objectives) {
      if (applyEvent(obj, ev, prog)) changed = true;
    }
  }
  return { changed };
}

// ─────────────────────────────────────────────────────────────── claim reward
// mutates save. applies the active op's reward when its objectives are all
// met, banks the completion, advances to the next op / finale / null.
export function claimActiveOperation(save) {
  ensureCampaign(save);
  const prog = operationProgress(save);
  const op = prog.op;
  if (!op || !prog.allDone) return { ok: false };
  const c = save.campaign;
  if (op.id !== 'finale' && (c.completed || []).includes(op.id)) return { ok: false };

  const reward = op.reward || {};
  const grants = [];
  if (reward.naquadah) save.naquadah = (save.naquadah || 0) + reward.naquadah;
  if (reward.intel) save.intel = (save.intel || 0) + reward.intel;
  if (reward.salvage) save.salvage = (save.salvage || 0) + reward.salvage;
  if (reward.tech) {
    if (!Array.isArray(save.tech)) save.tech = [];
    if (!save.tech.includes(reward.tech)) save.tech.push(reward.tech);
  }
  if (reward.weapon) grants.push({ type: 'weapon', id: reward.weapon });
  if (reward.consumable) grants.push({ type: 'consumable', id: reward.consumable });
  if (typeof reward.milestone === 'number') c.milestone = reward.milestone;

  if (op.id === 'finale') {
    c.won = true;
    c.op = null;
  } else {
    c.completed = Array.from(new Set([...(c.completed || []), op.id]));
    if (allOpsComplete(c.completed)) c.op = 'finale';
    else {
      const n = nextOp(op.id);
      c.op = n ? n.id : 'finale';
    }
  }
  c.progress = {};
  return { ok: true, reward, grants };
}

// ─────────────────────────────────────────────────────────────── war-map view
export function campaignStatus(save) {
  const c = (save && save.campaign) || {};
  const op = activeOperation(save);
  const completed = c.completed || [];
  const opsDone = OPERATIONS.filter((o) => completed.includes(o.id)).length;
  return {
    act: op ? op.act : 99,
    milestone: c.milestone || 0,
    opsDone,
    opsTotal: OPERATIONS.length,
    won: !!c.won,
    finaleUnlocked: opsDone >= FINALE.unlockAfter,
    activeName: op ? op.name : 'The Incursion — complete',
    activeBrief: op
      ? op.brief
      : 'The Incursion Nexus is dark. The staging hub is gone and the raids have stopped. Earth endures.',
  };
}

// ─────────────────────────────────────────────────── gate-map targeting hint
function factionOfKind(kind) {
  if (!kind) return null;
  if (kind.indexOf('jaffa') === 0) return 'jaffa';
  if (kind.indexOf('wraith') === 0) return 'wraith';
  if (kind.indexOf('replicator') === 0) return 'replicator';
  return null;
}

// does an unmet objective care about a world with these worldParams?
function objectiveWorldMatch(obj, params) {
  const wantFaction = obj.faction || factionOfKind(obj.kind);
  const threatOk = !obj.minThreat || (params.threat || 0) >= obj.minThreat;
  const modOk = !obj.mod || (params.mods || []).includes(obj.mod);
  switch (obj.type) {
    case 'kills':
    case 'bossKills':
    case 'clearWorlds':
      if (wantFaction && params.faction !== wantFaction) return false;
      return threatOk && modOk;
    case 'reachDepth': {
      const metric = obj.minHop ? (params.hop || 0) : (params.threat || 0);
      return metric >= objectiveNeed(obj);
    }
    default:
      // recover / rescue / surviveRun aren't world-faction targeted
      return false;
  }
}

// bool: does a world with these worldParams advance the active op?
export function worldAdvancesActive(save, params) {
  const op = activeOperation(save);
  if (!op || !params) return false;
  if (op.id === 'finale') return params.address === FINALE.address;
  const prog = operationProgress(save);
  for (const o of prog.objectives) {
    if (o.done) continue;
    if (objectiveWorldMatch(o, params)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────── hub-entry setup
// mutates save. safe to call on every hub entry.
export function ensureCampaign(save) {
  if (!save.campaign) {
    save.campaign = { op: null, progress: {}, completed: [], milestone: 0, won: false };
  }
  const c = save.campaign;
  if (!c.progress || typeof c.progress !== 'object') c.progress = {};
  if (!Array.isArray(c.completed)) c.completed = [];
  if (typeof c.milestone !== 'number') c.milestone = 0;
  if (typeof c.won !== 'boolean') c.won = false;
  if (c.op == null && !c.won) {
    c.op = allOpsComplete(c.completed) ? 'finale' : OPERATIONS[0].id;
  }
  return c;
}

// keep HOME referenced so a future re-address of the finale can't collide silently
export const NOT_HOME = FINALE_ADDRESS !== HOME;
