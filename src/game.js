import { keys, mouse, pressed, endFrameInput, captureNextKey, setAimAssistTargets } from './input.js';
import { touchFiring } from './touch.js';
import { WEAPONS } from './weapons.js';
import { sfx, music, ambient, setSfxVolume, getSfxVolume, toggleMute, isMuted } from './audio.js';
import { TAU, clamp, glowCircle, figure, spider, critter, hexA, textReset, wrapLines, wrapText } from './draw.js';
import { drawShadow, drawHumanoid, drawPlayer, drawEnemy } from './enemydraw.js';
import { VERSION, BUILD, versionLine } from './version.js';
import {
  renderRosterPanel, renderBasePanel, renderResearchPanel, renderInfirmaryPanel,
  renderOperationsPanel, renderWorkbenchPanel,
} from './stationpanels.js';
import { makeRng, rngHelpers, rr } from './rng.js';
import {
  spark, burst, kawoosh, addShake, addFlash, scorch, ejectCasing, splat,
  factionSplatColor, biomeDust,
} from './fx.js';
import { computeVisPoly, polyBox, litAt, drawFog } from './vis.js';
import { techEffects, TECH, canResearch, nodeById, milestoneFor } from './tech.js';
import {
  drawItemIcon, rarityOf, rarityTierOf, normRarity, RARITY_COLOR, RARITY_LABEL,
} from './icons.js';
import { HOME, neighbors, worldParams } from './address.js';
import { buildWorld, bakeWorld, BIOMES, TILE, WALL_H, tileAt } from './worldgen.js';
import { makeFlowField } from './pathfind.js';
import { Player, Enemy, Bullet, Pickup, Grenade, Block, Particle, Hazard, Trap, circleVsGrid, DataCore, VaultDoor, Captive, Vendor, NexusPylon } from './entities.js';
import { ITEMS, EQUIP_SLOTS, RARITY_MULT, rollRarity, rarityAffixName } from './items.js';
import {
  buildHub,
  buildHubDecor,
  drawStation,
  drawHubLive,
  drawDialer,
  makeCrew,
  updateCrew,
  roomAt,
  CREW_COLORS,
} from './hub.js';
import { createPostFX } from './postfx.js';
import {
  createInventory,
  reviveInventory,
  invAdd,
  invHasSpace,
  moveStack,
  sortInventory,
  takeFromHot,
  takeGrenade,
  activeWeaponId,
  toggleWeapon,
  regionDR,
  rollHitRegion,
  GRID_COLS,
  GRID_ROWS,
  HOTBAR,
} from './inventory.js';
import {
  ensureCampaign,
  activeOperation,
  operationProgress,
  claimActiveOperation,
  campaignStatus,
  objectiveLabel,
  recordEvents,
  worldAdvancesActive,
  OPERATIONS,
  FINALE,
  FINALE_ADDRESS,
} from './campaign.js';
import {
  SG_TEAMS,
  teamById,
  teamForName,
  applyRoster,
  BASE_UPGRADES,
  hasBase,
  baseMag,
  canBuyBase,
  buyBase,
} from './roster.js';
import {
  modsForWeapon,
  weaponStats,
  MOD_SLOTS,
  weaponMaxLevel,
  weaponLevelXp,
  levelForXp,
  xpForKill,
  upgradeCost,
  installCost,
  uninstallRefund,
  salvageValue,
  canInstall,
  canUpgrade,
  modById,
} from './weaponmods.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  game.js — the core loop, the state machine, and every gameplay + UI system.
//
//  Big file, but sectioned. Jump with your editor by searching the ▸ markers
//  below (each matches a "// ▸ SECTION" banner further down). Anything that could
//  be lifted out cleanly already has been — see the sibling modules in the map.
//
//  ── MAP OF THE CODEBASE ────────────────────────────────────────────────────
//    address.js     glyphs, seed hashing, gate-network neighbours, worldParams
//    worldgen.js    worldParams → room graph → tile map; offscreen bake; BIOMES
//    pathfind.js    BFS flow field used by enemy pathing
//    entities.js    Player / Enemy / Bullet / Pickup / … classes + circleVsGrid
//    weapons.js     the weapon stat table
//    weaponmods.js  per-weapon mastery + mod maths (weaponStats, costs, XP)
//    items.js       gear/consumable catalogue + rarity multipliers
//    inventory.js   grid / equipment / hotbar state + pure move/equip/derive
//    tech.js        the 69-node research tree: data, effects fold, gating
//    campaign.js    the Incursion: OPERATIONS, FINALE, progress tracking
//    roster.js      recoverable SG teams + purchasable SGC base upgrades
//    hub.js         the walkable SGC: layout, decor bake, station consoles, crew
//    icons.js       procedural item icons + rarity colour/label tables
//    draw.js        low-level canvas toolkit (shapes, figures, text/colour utils)
//    textures.js    procedural wall/floor/prop textures for the world bake
//    enemydraw.js   drawShadow / drawHumanoid / drawPlayer / drawEnemy
//    stationpanels.js  the between-runs SGC console screens (game.js routes them)
//    fx.js          particles, screen shake, flashes, battlefield decals
//    vis.js         line of sight, the 360° visibility polygon, fog
//    audio.js       synth sfx + ambient beds + the music bed
//    postfx.js      optional WebGL colour-grade pass over the 2D canvas
//    input.js  rng.js  loop.js  main.js   plumbing
//
//  ── SECTIONS IN THIS FILE (search "// ▸ <name>") ─────────────────────────────
//    ▸ save               defaultSave / normalizeSave / load / persist
//    ▸ effects            fx(g) — folded tech + roster + base-upgrade effects
//    ▸ createGame         the game object `g`, its shape, the public API
//    ▸ run lifecycle      enterHub / launchRun / startWorld / dialHome / onDeath
//    ▸ update             the top-level tick + updateHub + updatePlay
//                         (updatePlay is a thin sequence of update* sub-fns)
//    ▸ spawning           worldgen population: rooms, enemies, loot, hazards
//    ▸ special rooms      data cores, vaults, arenas, vendors, captive escort
//    ▸ combat             firing, bullets, alt-fires, hitEnemy, damagePlayer, kills
//    ▸ enemy AI           idle/leash, per-kind behaviour, bosses
//    ▸ new enemy kinds    sniper / stalker / weaver / scavenger behaviour
//    ▸ squad AI           per-frame Jaffa squad coordination
//    ▸ traps              dart traps + the nexus beam
//    ▸ camera             clampCam
//    ▸ render             render(g) orchestrator, renderPlay, the world draw pass
//    ▸ fake-3d light      the fixed key light + ground shadows
//    ▸ lights             coloured floor light sprites
//    ▸ HUD                crosshair, health/ammo, minimap, messages, boss intro
//    ▸ loadout panel      the grid, drag/drop, gear slots, stash chest
//    ▸ pause + settings   pause overlay, settings, key rebinding
//    ▸ front-of-house UI  main menu, codex, tutorial tips, starfield
//    ▸ roster / base ops / operations / workbench   the SGC station panels
//    ▸ debrief            floating combat text, boss bar, unlock cards, run debrief
//
//  ── RULES (do not break — the harness enforces the first two) ─────────────
//   • g.state ∈ {menu, play, hub, gatemap, dead} ONLY ('hub' = walkable SGC,
//     no enemies). Every other screen (pause, debrief, roster, research…) is a
//     SUB-MODE: a flag on `g` read inside an existing state — add no more states.
//   • Worldgen is seeded + deterministic. Never use Math.random() (or fx.js's
//     `rr`) in worldgen — use the address hash stream.
//   • ctx.textAlign / textBaseline leak between frames; render() resets them —
//     any fn that sets them must reset before returning (see textReset).
//   • New save key ⇒ add a default in BOTH defaultSave() and normalizeSave(),
//     and mirror it in the harness DEFAULTS.
// ═══════════════════════════════════════════════════════════════════════════════

const SAVE_KEY = 'gatecrawler.save.v1';
const SAVE_SCHEMA = 1; // bump when a real data migration is needed; normalizeSave stamps it

// world-render zoom — how close the camera sits to the character. Everything in
// world space is drawn through this; screen-space HUD is drawn after the reset.
const ZOOM = 1.4;

// ──────────────────────────────────────────────────────────────────────────
// ▸ save — defaultSave / normalizeSave / load / persist
// ──────────────────────────────────────────────────────────────────────────

export function defaultSave() {
  return {
    schema: SAVE_SCHEMA,
    naquadah: 0,
    intel: 0,
    salvage: 0, // workbench currency from scrapping weapons; kept in full on death
    tech: [],
    // recovered SG teams — permanent passives, folded in fx() via applyRoster
    roster: [],
    // purchased SGC base upgrades (naquadah sink) — see BASE_UPGRADES
    base: [],
    // between-runs storage chest — { id, count, rarity } | null slots
    stash: [],
    maxHpBonus: 0,
    deepestThreat: 0,
    runs: 0,
    known: [HOME],
    inv: null,
    // per-weapon mastery + mods: { [weaponId]: { level: 1, xp: 0, mods: [] } }
    weapons: {},
    // the Incursion campaign: { op, progress: {}, completed: [], milestone: 0, won: false }
    campaign: { op: null, progress: {}, completed: [], milestone: 0, won: false },
    // { [enemyKind]: { seen: n, killed: n } }
    bestiary: {},
    // contextual first-encounter field notes already shown: { [hintId]: true }
    hints: {},
    // key rebinds + a couple of toggles; audio volume persists separately
    settings: {
      binds: {}, // { action: KeyboardEvent.code }
      shake: 1, // screen-shake scale 0..1.5
      gamma: 1, // screen brightness multiply/screen 0.7..1.4
      reduceFlash: false, // damp muzzle/hit flashes + skip the webgl grade
      cbPalette: false, // colour-blind faction tagging (HUD legend note — see TODO)
      aimAssist: false, // gamepad: snap pad-aim toward the nearest enemy
      seenTutorial: false, // first-run corner tips have been shown
      difficulty: 'normal', // 'story' | 'normal' | 'hard' — combat/HP tuning only, never worldgen
    },
  };
}

// one level of shape repair: keep the default's keys, take the save's value for
// each only when it's present and type-compatible; recurse into nested plain
// objects. a `null` default means "type unknown — pass whatever's there".
function isPlainObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}
function mergeShape(def, src) {
  if (!isPlainObj(src)) return Object.assign({}, def);
  const out = Object.assign({}, def);
  for (const k of Object.keys(def)) {
    const dv = def[k];
    const sv = src[k];
    if (sv == null) continue;
    if (dv === null) out[k] = sv; // type unknown — pass whatever's there
    else if (Array.isArray(dv)) {
      if (Array.isArray(sv)) out[k] = sv;
    } else if (isPlainObj(dv)) {
      // an EMPTY default object is an open-ended map (progress, …) — keep the
      // save's contents wholesale; a non-empty one has a known sub-shape to repair
      out[k] = Object.keys(dv).length === 0 ? (isPlainObj(sv) ? sv : {}) : mergeShape(dv, sv);
    } else if (typeof sv === typeof dv) out[k] = sv;
  }
  return out;
}

// repair a save blob of any shape (older version, partial, hand-edited, hostile)
// into the current schema so downstream code never hits a wrong-typed branch.
export function normalizeSave(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  const d = defaultSave();
  for (const k of Object.keys(d)) {
    const dv = d[k];
    const sv = s[k];
    if (sv == null) s[k] = dv;
    else if (dv === null) continue; // default type unknown (inv) — accept as-is
    else if (Array.isArray(dv)) {
      if (!Array.isArray(sv)) s[k] = dv;
    } else if (isPlainObj(dv)) {
      // empty default = open-ended map (weapons, bestiary, hints): keep the
      // save's data if it's an object, else reset. non-empty = repair sub-shape.
      s[k] = Object.keys(dv).length === 0 ? (isPlainObj(sv) ? sv : {}) : mergeShape(dv, sv);
    } else if (typeof sv !== typeof dv) s[k] = dv; // e.g. tech saved as a string
  }
  // structural guarantees downstream code relies on, after the generic pass
  if (!s.campaign.progress || typeof s.campaign.progress !== 'object') s.campaign.progress = {};
  if (!Array.isArray(s.campaign.completed)) s.campaign.completed = [];
  if (!Array.isArray(s.tech)) s.tech = [];
  if (!Array.isArray(s.roster)) s.roster = [];
  if (!Array.isArray(s.base)) s.base = [];
  if (!Array.isArray(s.stash)) s.stash = [];
  if (!Array.isArray(s.known) || !s.known.length) s.known = [HOME];
  if (!s.weapons || typeof s.weapons !== 'object' || Array.isArray(s.weapons)) s.weapons = {};
  if (!s.bestiary || typeof s.bestiary !== 'object' || Array.isArray(s.bestiary)) s.bestiary = {};
  s.schema = SAVE_SCHEMA;
  return s;
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ effects — fx(g): folded tech + roster + base-upgrade stats
// ──────────────────────────────────────────────────────────────────────────

// folded tech + roster + base-upgrade effects. Pure w.r.t. g.save.tech/roster/
// base, which only change at the station panels — so cache it and rebuild only
// when a purchase marks it dirty (markEffDirty). Called 6–12x/frame otherwise.
export function fx(g) {
  if (g._eff && !g._effDirty) return g._eff;
  const e = techEffects(g.save.tech || []);
  // rescued SG teams stack their passives on top of the tech tree
  applyRoster(e, g.save.roster || []);
  // base upgrades that map straight onto effect keys — the rest are read via
  // the helpers below (researchCostMul / modCostMul / stashCap / ...)
  if (hasBase(g.save, 'heatSoften')) {
    e.heatMul = (e.heatMul == null ? 1 : e.heatMul) * baseMag(g.save, 'heatSoften', 1);
  }
  if (hasBase(g.save, 'bestiaryDmgMul')) {
    e.bestiaryDmgMul = (e.bestiaryDmgMul == null ? 1 : e.bestiaryDmgMul) * baseMag(g.save, 'bestiaryDmgMul', 1);
  }
  e.modCostMul = hasBase(g.save, 'modDiscount') ? baseMag(g.save, 'modDiscount', 1) : 1;
  e.researchCostMul = hasBase(g.save, 'researchDiscount') ? baseMag(g.save, 'researchDiscount', 1) : 1;
  g._eff = e;
  g._effDirty = false;
  return e;
}

// player-facing difficulty knob (Settings). combat/HP tuning ONLY — never touches
// worldgen or any seeded stream. 'normal' is all-1s so it's a no-op by default.
const DIFF = {
  story: { taken: 0.7, dealt: 1.15, heat: 0.85 },
  normal: { taken: 1, dealt: 1, heat: 1 },
  hard: { taken: 1.25, dealt: 0.9, heat: 1.18 },
};
function diffMul(g, which) {
  const d = (g.save && g.save.settings && g.save.settings.difficulty) || 'normal';
  return (DIFF[d] || DIFF.normal)[which];
}
// call after any tech / roster / base-upgrade purchase (or campaign reset)
export function markEffDirty(g) {
  g._effDirty = true;
}
// base-upgrade effects that aren't folded into the effects object
export function researchCostMul(g) {
  return hasBase(g.save, 'researchDiscount') ? baseMag(g.save, 'researchDiscount', 1) : 1;
}
// mod discount (Salvage Foundry) — folded into fx(g).modCostMul and applied
// by stationpanels.js's workbench install/upgrade handlers via salv()
function modCostMul(g) {
  return hasBase(g.save, 'modDiscount') ? baseMag(g.save, 'modDiscount', 1) : 1;
}
function stashCap(g) {
  return hasBase(g.save, 'stashSlots') ? (baseMag(g.save, 'stashSlots', 0) | 0) : 0;
}
function homeHealFull(g) {
  return hasBase(g.save, 'homeHeal');
}
function passiveXpPerSortie(g) {
  return hasBase(g.save, 'passiveXp') ? (baseMag(g.save, 'passiveXp', 0) | 0) : 0;
}
// passive mastery XP goes to the *equipped* weapon only — spreading it across
// every weapon ever touched punished the experimentation it was meant to reward
function grantPassiveXp(g, amount) {
  try {
    if (!g.save.weapons || typeof g.save.weapons !== 'object') g.save.weapons = {};
    const wk = g.inv ? activeWeaponId(g.inv) : null;
    if (!wk) return;
    const ws = g.save.weapons[wk] || (g.save.weapons[wk] = { level: 1, xp: 0, mods: [] });
    ws.xp = (ws.xp || 0) + Math.max(1, Math.round(amount));
    ws.level = Math.min(weaponMaxLevel, Math.max(ws.level || 1, levelForXp(ws.xp)));
  } catch (e) {
    /* odd save.weapons shape — skip the grant */
  }
}

// the effective rarity of an inventory stack — an explicit roll if it has one,
// otherwise the item id's baseline tier
export function stackRarity(stack) {
  if (!stack) return 'common';
  return stack.rarity ? normRarity(stack.rarity) : rarityTierOf(stack.id);
}
function rarityMul(stack) {
  return RARITY_MULT[stackRarity(stack)] || 1;
}

// world-modifier metadata + folded effect factors for the current world
const MOD_INFO = {
  eclipse: { label: 'ECLIPSE', blurb: 'perpetual dark — line of sight is short' },
  'black-fog': { label: 'BLACK FOG', blurb: 'choking haze — sight cut hard, but the dead left more behind' },
  'naquadah-rich': { label: 'NAQUADAH-RICH', blurb: 'veins run heavy — double naquadah' },
  'intel-rich': { label: 'INTEL CACHE', blurb: 'their network is exposed — double intel' },
  'ion-storm': { label: 'ION STORM', blurb: 'rolling EMP fronts knock energy weapons offline' },
  'power-siphon': { label: 'POWER SIPHON', blurb: 'the gate drinks deep — dialling out costs far more, hunt builds faster' },
};

function modLabels(mods) {
  return (mods || []).map((m) => (MOD_INFO[m] ? MOD_INFO[m].label : m.toUpperCase()));
}

function worldMods(g) {
  const m = (g.params && g.params.mods) || [];
  return {
    visionR: m.includes('black-fog') ? 330 : m.includes('eclipse') ? 470 : 780,
    naqMul: m.includes('naquadah-rich') ? 2 : 1,
    intelMul: m.includes('intel-rich') ? 2 : 1,
    lootMul: m.includes('black-fog') ? 1.4 : 1,
    dialMul: m.includes('power-siphon') ? 1.6 : 1,
    heatMul: m.includes('power-siphon') ? 1.25 : 1,
  };
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return normalizeSave(JSON.parse(raw));
  } catch (e) {
    /* ignore */
  }
  return defaultSave();
}
export function persist(s) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch (e) {
    /* ignore */
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ createGame — builds the game object `g` and the public API
// ──────────────────────────────────────────────────────────────────────────

export function createGame(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 960, h: 600, dpr: 1 };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.dpr = dpr;
    view.w = window.innerWidth || 960;
    view.h = window.innerHeight || 600;
    canvas.width = Math.floor(view.w * dpr);
    canvas.height = Math.floor(view.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize);
  resize();

  const g = {
    state: 'menu',
    save: loadSave(),
    time: 0,
    view,
    ctx,
    player: new Player(0, 0),
    world: null,
    worldCanvas: null,
    flow: null,
    params: null,
    enemies: [],
    bullets: [],
    grenades: [],
    blocks: [],
    hazards: [],
    traps: [], // startWorld re-inits; declared here so a pre-first-world render can't trip
    flashes: [], // transient light pops (muzzle, blast) — render only
    decals: [],
    pickups: [],
    particles: [],
    shakeX: 1,
    shakeY: 0,
    killStreak: 0,
    killStreakT: 0,
    heat: 0,
    hunterSpawned: false,
    hitstop: 0,
    hub: false,
    station: null, // open station panel in the hub: 'research' | 'infirmary' (armory opens the loadout panel)
    launching: false, // gate map is picking the FIRST destination of a new run
    runIntel: 0,
    wheel: 0,
    inv: null,
    panelOpen: false,
    drag: null, // { from:{kind,i,key}, id, count }
    pmouse: { x: 0, y: 0 },
    uiXform: null, // active full-screen-panel scale transform on small viewports
    panelHit: [], // [{x,y,w,h, loc}]
    cam: { x: 0, y: 0 },
    shake: 0,
    hop: 0,
    runNaq: 0,
    flowT: 0,
    emp: false,
    empT: 10,
    dhdActive: false,
    curRoom: null,
    messages: [],
    mouseWasDown: false,
    mouse: { wx: 0, wy: 0 },
    buttons: [],
    // front-of-house UI: main-menu selection + a breadcrumb stack of sub-screens
    // ('settings' | 'rebind' | 'codex') that overlay either the menu or the pause
    // overlay. g.state stays 'menu' / 'play' / 'hub' the whole time.
    menuSel: 0,
    uiStack: [],
    uiRoot: 'menu',
    codexScroll: 0,
    settingsScroll: 0,
    _resetArm: 0, // >0 while RESET CAMPAIGN is waiting for the confirm click
    _rebinding: null, // action id currently listening for a key
    tips: null, // { list:[{txt,check?}], i, t } — first-run tutorial prompts
    mapNodes: [],
    deadInfo: null,
    debrief: null, // built by dialHome / onDeath, consumed by renderDebrief
    runStats: null,
    floats: [], // {x,y,vy,t,txt,color,size} damage / reward ticks
    unlockCard: null, // {title,sub,t} sliding card, top-centre
    visPoly: null,
    visEnabled: true,
    fps: 0,
    _facc: 0,
    _fcount: 0,
  };

  g.inv = reviveInventory(g.save.inv);
  g.save.inv = g.inv; // keep the persisted blob pointed at the live inventory

  g.log = []; // persistent scrollback (bottom-left)
  g.message = (txt) => {
    const last = g.messages[g.messages.length - 1];
    if (last && last.txt === txt) {
      last.t = 3.2; // de-dupe: just refresh
      return;
    }
    g.messages.push({ txt, t: 3.2 });
    while (g.messages.length > 1) g.messages.shift(); // only the newest is the toast
    g.log.push(txt);
    while (g.log.length > 6) g.log.shift();
  };

  const mpos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('click', (e) => {
    if (g.panelOpen) return;
    const { x: mx, y: my } = mpos(e);
    for (const b of g.buttons) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        b.fn();
        return;
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    g.pmouse = mpos(e);
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!g.panelOpen || e.button !== 0) return;
    g.pmouse = mpos(e);
    panelPick(g);
  });
  addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !g.drag) return;
    panelDrop(g);
  });
  canvas.addEventListener('wheel', (e) => {
    if (g.state === 'play' && !g.panelOpen) {
      g.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }
  });

  return {
    g,
    update: (dt) => update(g, dt),
    render: (dt) => render(g, dt),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ run lifecycle
// ──────────────────────────────────────────────────────────────────────────

// ---- the walkable home base ----------------------------------------------

function enterHub(g) {
  if (g.skipHub) {
    // test harness fast-path: bypass the walkable hub, deploy straight from HOME
    launchRun(g, HOME);
    return;
  }
  const w = buildHub();
  g.world = w;
  g.worldCanvas = bakeWorld(w);
  g._hubDecor = buildHubDecor(w, g.save); // static dressing, baked once per visit
  g._crew = makeCrew(w);
  g._hubRoom = null;
  g.flow = makeFlowField(w.grid, w.W, w.H);
  g.params = { address: 'SGC', threat: 0, faction: 'sgc', primary: 'sgc', mods: [], hop: 0, seedStr: 'sgc' };
  g.enemies = [];
  g.pylons = [];
  g.bullets = [];
  g.grenades = [];
  g.blocks = [];
  g.hazards = [];
  g.flashes = [];
  g.decals = [];
  g.pickups = [];
  g.particles = [];
  g.station = null;
  g.launching = false;
  g.panelOpen = false;
  g.drag = null;
  g.dhdActive = false;
  g.heat = 0;
  g.emp = false;
  g.hitstop = 0;
  g._revived = false;

  const p = g.player;
  p.x = w.gateCenter.x;
  p.y = w.gateCenter.y + 74;
  p.kx = p.ky = p.vx = p.vy = 0;
  p.stun = 0;
  p.dodge = 0;
  p.iframe = 0;
  p.alive = true;
  p.maxHp = 100 + g.save.maxHpBonus + fx(g).maxHpBonus;
  p.hp = p.maxHp;

  g.cam.x = p.x;
  g.cam.y = p.y;
  g.curRoom = roomAt(w, p.x, p.y) || w.rooms[0];
  g._hubRoom = g.curRoom;
  g.state = 'hub';
  g.log = [];
  if (ambient && ambient.set) ambient.set('hub');
  ensureCampaign(g.save); // the Incursion: seed / repair save.campaign every hub entry
  if (!Array.isArray(g.save.roster)) g.save.roster = [];
  if (!Array.isArray(g.save.base)) g.save.base = [];
  if (!Array.isArray(g.save.stash)) g.save.stash = [];
  g.stashView = false;
  // Infirmary Wing base upgrade: always dock at full health
  if (homeHealFull(g)) p.hp = p.maxHp;
  // Training Range base upgrade: idle weapons earn mastery XP once per sortie
  const pxp = passiveXpPerSortie(g);
  if (pxp > 0 && g.save.runs > 0 && g._xpRuns !== g.save.runs) {
    g._xpRuns = g.save.runs;
    grantPassiveXp(g, pxp);
  }
  persist(g.save);
  queueTips(g, HUB_TIPS, 'hub', false); // first-run tutorial: hub orientation prompt
  if ((g.save.runs || 0) === 0)
    hint(g, 'run101', 'This is the SGC. Gear up at the consoles (walk over, press E), then step into the gate. A run is: fight room to room, clear the DHD, then dial DEEPER for reward or HOME to bank it. Naquadah buys research and base upgrades; intel unlocks deeper tech; salvage (from scrapped weapons) buys weapon mods.');
  g.message(g.save.runs > 0 ? 'Welcome back to Stargate Command — Level 28' : 'Stargate Command — Level 28');
}

function launchRun(g, addr) {
  const e = fx(g);
  g.player = new Player(0, 0);
  const pl = g.player;
  pl.maxHp = 100 + g.save.maxHpBonus + e.maxHpBonus;
  pl.hp = pl.maxHp;
  pl.dodgeMax = e.dodgeCharges || 1;
  pl.dodgeCharge = pl.dodgeMax;
  if (e.startShield > 0) {
    pl.shieldMax = e.startShield;
    pl.shield = e.startShield;
  }
  // starting armour perk fills any empty matching slot
  if (e.startArmor && ITEMS[e.startArmor]) {
    const reg = ITEMS[e.startArmor].region;
    if (reg && !g.inv.equip[reg]) g.inv.equip[reg] = { id: e.startArmor, count: 1 };
  }
  g.launching = false;
  g._hubDecor = null; // drop the baked SGC dressing canvas for the run
  g.runNaq = 0;
  g.runIntel = 0;
  g.heat = 0;
  g._firstWorld = true;
  g._tipMoved = false; // first-run tutorial: reset the "player has moved" latch
  g._tipSpawn = null;
  // per-run campaign event buffer + bookkeeping — flushed in dialHome / onDeath
  g._events = [{ t: 'runStart' }];
  g._seenKinds = new Set(); // bestiary: kinds that have gone active this run
  g._runRoomsCleared = 0; // sectors cleared this run (for surviveRun objective)
  g._escortSafe = false;

  // per-run tally — folded into the debrief on dialHome / onDeath. counters only.
  g.runStats = {
    kills: {}, killsTotal: 0, bosses: 0, dmgTaken: 0, shots: 0, hits: 0, crits: 0,
    streak: 0, bestStreak: 0,
    naqStart: g.save.naquadah, intelStart: g.save.intel || 0, salvStart: g.save.salvage || 0,
    t0: g.time, itemsFound: 0, wpnXp: {}, newBestiary: [], deepestThreat: 0, special: [],
  };
  // snapshot the active op so the debrief can show before -> after per objective
  try { g._opSnapshot = operationProgress(g.save); } catch (err) { g._opSnapshot = null; }
  g.debrief = null;
  g.floats = g.floats || [];
  g.floats.length = 0;

  const hop = e.startHop || 0;
  startWorld(g, addr || g.save.lastAddress || HOME, hop);
}

function startWorld(g, addr, hop) {
  g.params = worldParams(addr, hop);
  // hint for worldgen: does this world help the active op? steers special-room weights
  try {
    g.params.campaignTarget = worldAdvancesActive(g.save, g.params);
  } catch (e) {
    g.params.campaignTarget = false;
  }
  g.world = buildWorld(g.params);
  g.worldCanvas = bakeWorld(g.world);
  if (ambient && ambient.set) ambient.set(g.params.biome);
  if (sfx.wormholeOpen) sfx.wormholeOpen();
  g.flow = makeFlowField(g.world.grid, g.world.W, g.world.H);
  g.enemies = [];
  g.pylons = [];
  g.bullets = [];
  g.grenades = [];
  g.blocks = [];
  g.hazards = [];
  g.traps = [];
  g.flashes = [];
  g.decals = [];
  g.pickups = [];
  g.particles = [];
  g.killStreak = 0;
  g.killStreakT = 0;
  g.panelOpen = false;
  g.drag = null;
  g.hunterSpawned = false;
  g._siege = null; // DHD siege reinforcement state — per world
  g._dhdKind = null;
  // arriving on a fresh world vents most of the accumulated hunt, so a run gets
  // a sawtooth intensity curve instead of pinning at SWARM from world 2 on.
  // world 1 has heat 0 already; a deep-dial then re-adds a bump (gate-map handler).
  g.heat *= 0.4;
  g._firstWorld = false;
  g.save.lastAddress = worldParams(addr, hop).address;
  g.hop = hop;
  g.dhdActive = false;
  g.bossIntroT = 0;
  g.bossIntroSeen = false;
  g.emp = false;
  g.empT = 10;
  g.flowT = 0;
  g.time = 0;
  g._worldClearFired = false;

  // per-world special-room state (populateWorld fills these)
  g.dataCores = [];
  g.vaultDoors = [];
  g.vendors = [];
  g.captives = [];
  g.arenaRooms = [];
  g.vendorOpen = null;

  // arrived on this world — depth event toward the active op
  if (!g._events) g._events = [];
  g._events.push({ t: 'depth', threat: g.params.threat, hop: hop });

  const gr = g.world.gateRoom;
  gr.populated = true;
  gr.cleared = true;

  const c = gr.centerPx;
  const p = g.player;
  p.x = c.x;
  p.y = c.y + 30;
  p.kx = p.ky = p.vx = p.vy = 0;
  p.stun = 0;
  p.iframe = 1.0;
  p.dodge = 0;
  p.dodgeCd = 0;
  p.alive = true;

  populateWorld(g);

  g.cam.x = p.x;
  g.cam.y = p.y;
  g.curRoom = gr;
  g.state = 'play';
  if (hop === 0) queueTips(g, FIELD_TIPS, 'field', true); // first-run tutorial: field prompts

  g.save.known = Array.from(new Set([...g.save.known, g.params.address]));
  g.save.deepestThreat = Math.max(g.save.deepestThreat, g.params.threat);
  persist(g.save);

  g.flow.compute(
    clamp(Math.floor(p.x / TILE), 0, g.world.W - 1),
    clamp(Math.floor(p.y / TILE), 0, g.world.H - 1)
  );

  kawoosh(g, c.x, c.y);
  sfx.kawoosh();
  g.message('Arrived: ' + g.params.address + (g.params.mods.length ? '  [' + modLabels(g.params.mods).join(', ') + ']' : ''));
}

// fold the run's buffered events into the campaign, then persist. resilient to a
// malformed save.campaign — ensureCampaign repairs it first.
function flushEvents(g) {
  try {
    ensureCampaign(g.save);
    recordEvents(g.save, g._events || []);
  } catch (e) {
    /* campaign shape was broken beyond repair — drop this batch, keep playing */
  }
  g._events = [];
  persist(g.save);
}

function dialHome(g) {
  g.save.naquadah += g.runNaq;
  g.save.intel = (g.save.intel || 0) + g.runIntel;
  g.save.runs += 1;
  if (g.params) g.save.deepestThreat = Math.max(g.save.deepestThreat, g.params.threat);
  // a freed captive standing in the gate room when the dial fires is home safe
  if (g.captives) {
    for (let i = 0; i < g.captives.length; i++) {
      const cap = g.captives[i];
      if (cap.freed && cap.atGate && cap.hp > 0 && !cap._banked) {
        cap._banked = true;
        if (!g._events) g._events = [];
        g._events.push({ t: 'rescue' });
        g.message(cap.name + ' — extracted');
        if (g.runStats) g.runStats.special.push(cap.name + ' extracted to the SGC');
        // a recovered captive brings an SG team back into the fight — a
        // permanent passive shown in the Memorial Hall roster
        if (!Array.isArray(g.save.roster)) g.save.roster = [];
        const tid = teamForName(cap.name, g.save.roster);
        if (tid && !g.save.roster.includes(tid)) {
          g.save.roster.push(tid);
          markEffDirty(g);
          const tm = teamById(tid);
          if (tm) showUnlock(g, 'SG TEAM RECOVERED', tm.name + ' — ' + tm.role);
        }
      }
    }
  }
  if (!g._events) g._events = [];
  g._events.push({ t: 'dialHome', roomsCleared: g._runRoomsCleared || 0, died: false });
  flushEvents(g);
  g.runNaq = 0;
  g.runIntel = 0;
  // hold at the debrief instead of dropping straight into the hub.
  // NOTE: the shared post-run state string stays 'dead' (save + test-harness
  // compatibility — the harness only knows menu/play/gatemap/dead); the debrief
  // reads outcome off g.debrief, and renderDead delegates to renderDebrief.
  buildDebrief(g, 'EXTRACTED');
  g.state = 'dead';
}

function onDeath(g, abandon) {
  const p = g.player;
  const e = fx(g);
  if (!abandon && e.freeRevive && !g._revived) {
    g._revived = true;
    p.hp = Math.max(1, Math.round(p.maxHp * 0.5));
    p.iframe = 1.6;
    g.shake = 22;
    g.message('MEDICAL OVERRIDE — revive spent');
    return;
  }
  p.alive = false;
  if (!g._events) g._events = [];
  g._events.push({ t: 'dialHome', roomsCleared: g._runRoomsCleared || 0, died: true });
  flushEvents(g);
  const keptN = Math.floor(g.runNaq * (e.deathKeepFrac != null ? e.deathKeepFrac : 0.5));
  g.save.naquadah += keptN;
  g.save.intel = (g.save.intel || 0) + g.runIntel; // intel is knowledge — recovered in full
  g.save.runs += 1;
  // the backpack is lost; equipped gear, hotbar and the SGC stash survive
  const lost = g.inv.grid.filter(Boolean).length;
  g.inv.grid = g.inv.grid.map(() => null);
  saveInv(g);
  g.deadInfo = { naq: keptN, intel: g.runIntel, depth: g.hop, addr: g.params ? g.params.address : '', lost };
  // KIA keeps the 'dead' state string (save / harness compatibility) but renders
  // the full debrief; renderDead delegates to renderDebrief when g.debrief is set.
  buildDebrief(g, 'KIA');
  g.state = 'dead';
}

function buildGateMap(g) {
  if (g.launching) {
    const start = g.save.lastAddress || HOME;
    const list = Array.from(new Set([start, ...neighbors(start, 4)]));
    const hop = fx(g).startHop || 0;
    g.mapNodes = list.map((addr, i) => ({ addr, prev: worldParams(addr, hop), i }));
    return;
  }
  const list = neighbors(g.params.address, 5);
  g.mapNodes = list.map((addr, i) => ({ addr, prev: worldParams(addr, g.hop + 1), i }));
}

function togglePanel(g) {
  g.panelOpen = !g.panelOpen;
  if (!g.panelOpen && g.drag) {
    // return a held item to the grid on close
    invAdd(g.inv, g.drag.id, g.drag.count, g.drag.rarity || null);
    g.drag = null;
  }
  if (!g.panelOpen) {
    saveInv(g);
    mouse.down = false;
  }
}

export function saveInv(g) {
  g.save.inv = g.inv;
  persist(g.save);
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ update
// ──────────────────────────────────────────────────────────────────────────

function update(g, dt) {
  g.time += dt;
  for (const m of g.messages) m.t -= dt;
  if (g.messages.length && g.messages[0].t <= 0) g.messages = g.messages.filter((m) => m.t > 0);

  // global audio keys — work in any state
  if (pressed('KeyM')) g.message(toggleMute() ? 'Audio muted' : 'Audio on');
  if (pressed('BracketLeft')) g.message('Volume ' + Math.round(setSfxVolume(getSfxVolume() - 0.1) * 100) + '%');
  if (pressed('BracketRight')) g.message('Volume ' + Math.round(setSfxVolume(getSfxVolume() + 0.1) * 100) + '%');

  // pause overlay — works in play or hub, freezes the world. an open sub-screen
  // (settings / codex / rebind) eats Esc so it backs out rather than un-pausing.
  if (
    (g.state === 'play' || g.state === 'hub') &&
    !g.panelOpen && !g.station && !g.vendorOpen && !g.uiStack.length && pressed('Escape')
  ) {
    g.paused = !g.paused;
  }
  if (g.paused) {
    updatePauseMenu(g);
    g.mouseWasDown = mouse.down;
    g.wheel = 0;
    endFrameInput();
    return;
  }

  if (g.state === 'play') {
    if (pressed('Tab') || pressed('KeyI') || pressed(boundKey(g, 'inventory', 'Tab'))) togglePanel(g);
    if (g.panelOpen) {
      if (pressed('Escape')) togglePanel(g);
    } else if (g.hitstop > 0) {
      g.hitstop--; // brief freeze-frame on kills / big hits
    } else {
      updatePlay(g, dt);
    }
  } else if (g.state === 'hub') {
    updateHub(g, dt);
  } else if (g.state === 'gatemap') {
    if (pressed('Escape')) {
      if (g.launching) {
        // backing out of the pre-run destination pick drops you back in the SGC
        g.launching = false;
        enterHub(g);
      } else {
        // changed your mind at the DHD mid-run — just go back to the floor
        g.state = 'play';
      }
    }
  } else if (g.state === 'dead') {
    // covers both the KIA screen and the EXTRACTED debrief (see dialHome note)
    if (pressed('Enter')) debriefContinue(g);
  } else if (g.state === 'menu') {
    updateMenu(g);
  }

  if ((g.state === 'play' || g.state === 'hub') && !g.panelOpen && !g.station) updateTips(g, dt);
  updateHint(g, dt);
  feedAimAssist(g);

  g.mouseWasDown = mouse.down;
  g.wheel = 0;
  endFrameInput();
}

function quickHeal(g) {
  const p = g.player;
  if (p.hp >= p.maxHp) {
    g.message('Already at full HP');
    return;
  }
  const isHeal = (id) => ITEMS[id] && ITEMS[id].type === 'consumable' && ITEMS[id].use === 'heal';
  const need = p.maxHp - p.hp;
  let pick = null; // { where:'grid'|'hot', i }
  let pickAmt = Infinity;
  let fallback = null;
  let fbAmt = 0;
  const scan = (arr, where) => {
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (!c || !isHeal(c.id)) continue;
      const a = ITEMS[c.id].amount;
      if (a >= need && a < pickAmt) {
        pickAmt = a;
        pick = { where, i };
      }
      if (a > fbAmt) {
        fbAmt = a;
        fallback = { where, i };
      }
    }
  };
  scan(g.inv.grid, 'grid');
  scan(g.inv.hotbar, 'hot');
  const sel = pick || fallback;
  if (!sel) {
    g.message('No medical supplies');
    return;
  }
  const arr = sel.where === 'grid' ? g.inv.grid : g.inv.hotbar;
  const id = arr[sel.i].id;
  const amt = Math.round(ITEMS[id].amount * rarityMul(arr[sel.i]));
  arr[sel.i].count -= 1;
  if (arr[sel.i].count <= 0) arr[sel.i] = null;
  p.hp = Math.min(p.maxHp, p.hp + amt);
  g.message('+' + amt + ' HP  (' + ITEMS[id].name + ')');
  sfx.pickup();
  for (let k = 0; k < 8; k++) {
    g.particles.push(new Particle(p.x, p.y, rr(-70, 70), rr(-70, 70), 0.4, '#7ef77e', 2));
  }
  saveInv(g);
}

export function medCount(g) {
  let n = 0;
  const add = (arr) => {
    for (const c of arr) if (c && ITEMS[c.id] && ITEMS[c.id].use === 'heal') n += c.count;
  };
  add(g.inv.grid);
  add(g.inv.hotbar);
  return n;
}

function updateHub(g, dt) {
  const p = g.player;
  const w = g.world;
  g.time += 0; // (time already advanced in update)

  if (g.panelOpen) {
    if (pressed('Escape') || pressed('Tab')) togglePanel(g);
    return;
  }
  if (g.station) {
    if (pressed('Escape') || pressed('Tab')) g.station = null;
    return;
  }
  if (pressed('Tab') || pressed('KeyI') || pressed(boundKey(g, 'inventory', 'Tab'))) {
    togglePanel(g);
    return;
  }
  if (keyHit(g, 'heal', 'KeyQ')) quickHeal(g);

  g.mouse.wx = (mouse.x - g.view.w / 2) / ZOOM + g.cam.x;
  g.mouse.wy = (mouse.y - g.view.h / 2) / ZOOM + g.cam.y;
  let ix = (keyHeld(g, 'right', 'KeyD') ? 1 : 0) - (keyHeld(g, 'left', 'KeyA') ? 1 : 0);
  let iy = (keyHeld(g, 'down', 'KeyS') ? 1 : 0) - (keyHeld(g, 'up', 'KeyW') ? 1 : 0);
  if (ix || iy) {
    const l = Math.hypot(ix, iy);
    ix /= l;
    iy /= l;
    p.aim = Math.atan2(iy, ix);
  } else {
    p.aim = Math.atan2(g.mouse.wy - p.y, g.mouse.wx - p.x);
  }
  p.x += ix * p.speed * dt;
  p.y += iy * p.speed * dt;
  ({ x: p.x, y: p.y } = circleVsGrid(w, p, p.x, p.y));

  // footsteps on the SGC deck plate — hard, alternating
  if (ix || iy) {
    g._stepT = (g._stepT || 0) + dt;
    if (g._stepT >= 0.34) {
      g._stepT -= 0.34;
      g._stepFoot = !g._stepFoot;
      sfx.footstep(true);
    }
  } else {
    g._stepT = 0;
  }

  let near = null;
  let nd = 60 * 60;
  for (const s of w.stations) {
    const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
    if (d < nd) {
      nd = d;
      near = s;
    }
  }
  g._nearStation = near;
  // two ways to dial: step onto the gate ramp, or work the control-room console
  g._atGate = (w.gateCenter.x - p.x) ** 2 + (w.gateCenter.y - p.y) ** 2 < 62 * 62;
  g._atDialer = !!w.dialer && (w.dialer.x - p.x) ** 2 + (w.dialer.y - p.y) ** 2 < 54 * 54;

  if (keyHit(g, 'interact', 'KeyE')) {
    if (near) {
      // armory opens the loadout panel; research / infirmary / workbench /
      // operations each open their own station panel (renderStationPanel routes)
      if (near.kind === 'armory') g.panelOpen = true;
      else g.station = near.kind;
      if (near.kind === 'workbench') hint(g, 'workbench', 'The Workbench spends SALVAGE to raise weapon mastery and fit mods. Salvage comes from scrapping duplicate weapons in the Armory loadout screen. A tier-2 mod unlocks that weapon\u2019s alt-fire (right-click / the ALT button on touch).');
      if (near.kind === 'research') hint(g, 'research', 'Research is permanent and shared across every run. Tier gates open as you complete campaign Operations \u2014 check the Briefing Room for the current objective.');
    } else if (g._atGate || g._atDialer) {
      g.launching = true;
      buildGateMap(g);
      g.state = 'gatemap';
    }
  }

  // a soft "you are entering…" toast as the player crosses a doorway
  const rNow = roomAt(w, p.x, p.y);
  if (rNow && rNow !== g._hubRoom) {
    g._hubRoom = rNow;
    g.curRoom = rNow;
    g.message(rNow.name);
  }
  if (g._crew) updateCrew(g._crew, dt);

  g.cam.x += (p.x - g.cam.x) * Math.min(1, 6 * dt);
  g.cam.y += (p.y - g.cam.y) * Math.min(1, 6 * dt);
  clampCam(g);
}

function updatePlay(g, dt) {
  const eff = fx(g);
  updatePlayerMovement(g, dt, eff);
  updatePlayerCombat(g, dt, eff);
  updateFlowAndRoom(g, dt);
  updateGrenades(g, dt);
  updateHeatAndStreak(g, dt);
  updateFieldHazards(g, dt);
  updateReformDebris(g, dt);
  updateEnemyTick(g, dt);
  updateProjectilesAndPickups(g, dt);
  compactPlayEntities(g, dt);
  updateRoomClears(g, dt);
  updatePlayCamera(g, dt);
  updateCombatAudio(g, dt);
}

function updatePlayerMovement(g, dt, eff) {
  const p = g.player;
  const w = g.world;
  // charge-based dodge: dodgeMax charges (tech), one refills every dodgeGap secs
  if (p.dodgeMax == null) p.dodgeMax = eff.dodgeCharges || 1;
  if (p.dodgeCharge == null) p.dodgeCharge = p.dodgeMax;
  const dodgeGap = 1.15 * (eff.dodgeCdMul || 1);
  p.dodgeCd = Math.max(0, p.dodgeCd - dt); // small min gap between rolls
  if (p._nadeCd > 0) p._nadeCd -= dt; // throw cooldown, keeps grenade count bounded
  if (p.dodgeCharge < p.dodgeMax) {
    p.dodgeRegenT = (p.dodgeRegenT || 0) + dt;
    if (p.dodgeRegenT >= dodgeGap) {
      p.dodgeRegenT -= dodgeGap;
      p.dodgeCharge = Math.min(p.dodgeMax, p.dodgeCharge + 1);
    }
  }
  p.iframe = Math.max(0, p.iframe - dt);
  p.flash = Math.max(0, p.flash - dt);
  if (p.dodge > 0) p.dodge -= dt;
  if (p.stun > 0) p.stun -= dt;
  if (p.stimT > 0) p.stimT -= dt;
  if (p.shieldMax > 0) {
    p.shieldRegenT += dt;
    if (p.shieldRegenT > 3 && p.shield < p.shieldMax) {
      const was = p.shield;
      p.shield = Math.min(p.shieldMax, p.shield + 12 * dt);
      if (was <= 0.01 && p.shield > 0.01 && sfx.shieldRecharge) sfx.shieldRecharge();
    }
  }
  const stim = p.stimT > 0;

  g.mouse.wx = (mouse.x - g.view.w / 2) / ZOOM + g.cam.x;
  g.mouse.wy = (mouse.y - g.view.h / 2) / ZOOM + g.cam.y;
  p.aim = Math.atan2(g.mouse.wy - p.y, g.mouse.wx - p.x);

  let ix = (keyHeld(g, 'right', 'KeyD') ? 1 : 0) - (keyHeld(g, 'left', 'KeyA') ? 1 : 0);
  let iy = (keyHeld(g, 'down', 'KeyS') ? 1 : 0) - (keyHeld(g, 'up', 'KeyW') ? 1 : 0);
  if (ix || iy) {
    const l = Math.hypot(ix, iy);
    ix /= l;
    iy /= l;
  }

  const spd =
    p.speed *
    (stim ? 1.35 : 1) *
    (p._slow || 1) *
    (fx(g).moveSpeedMul || 1) *
    (1 - Math.min(0.22, armourWeight(g.inv)));
  if (p.dodge > 0) {
    p.x += p.ddx * 470 * dt;
    p.y += p.ddy * 470 * dt;
  } else if (p.stun <= 0) {
    if (keyHit(g, 'dodge', 'Space') && p.dodgeCd <= 0 && p.dodgeCharge >= 1) {
      // dodge toward movement input, or toward aim from a standstill
      let ddx = ix;
      let ddy = iy;
      if (!ddx && !ddy) {
        ddx = Math.cos(p.aim);
        ddy = Math.sin(p.aim);
      }
      p.dodge = 0.26;
      p.iframe = 0.3;
      p.dodgeCd = 0.3;
      p.dodgeCharge -= 1;
      if (p.dodgeCharge === p.dodgeMax - 1) p.dodgeRegenT = 0;
      p.ddx = ddx;
      p.ddy = ddy;
      sfx.dodge();
    } else {
      p.x += ix * spd * dt;
      p.y += iy * spd * dt;
    }
  }

  p.x += p.kx * dt;
  p.y += p.ky * dt;
  p.kx -= p.kx * Math.min(1, 7 * dt);
  p.ky -= p.ky * Math.min(1, 7 * dt);

  ({ x: p.x, y: p.y } = circleVsGrid(w, p, p.x, p.y));

  // footsteps — a soft alternating tick while walking (not while dodging/stunned)
  if ((ix || iy) && p.dodge <= 0 && p.stun <= 0) {
    g._stepT = (g._stepT || 0) + dt;
    if (g._stepT >= 0.32) {
      g._stepT -= 0.32;
      g._stepFoot = !g._stepFoot;
      sfx.footstep(!!g._stepFoot);
    }
  } else {
    g._stepT = 0;
  }
}

function updatePlayerCombat(g, dt, eff) {
  const p = g.player;
  const w = g.world;
  const stim = p.stimT > 0; // recomputed from the (unchanged) timer set in updatePlayerMovement
  // hotbar consumables / quick-heal / weapon swap / grenade
  for (let i = 0; i < HOTBAR; i++) if (pressed('Digit' + (i + 1))) useHotbar(g, i);
  if (keyHit(g, 'heal', 'KeyQ')) quickHeal(g);
  const swapHit = keyHit(g, 'swap', 'KeyX');
  if (swapHit || g.wheel) {
    const dir = g.wheel < 0 ? -1 : 1;
    g.wheel = 0;
    if (p.beam && p.beam.on) {
      sfx.beam(false);
      p.beam.on = false;
    }
    cancelReload(p); // swapping weapons aborts a reload in progress
    p.burstN = 0;
    const wid = toggleWeapon(g.inv, eff.weaponSlots, swapHit ? 1 : dir);
    g.message('Weapon: ' + (ITEMS[weaponItemId(g.inv)] ? ITEMS[weaponItemId(g.inv)].name : wid));
  }
  if (keyHit(g, 'grenade', 'KeyG')) throwGrenade(g);

  // fire
  p.cool -= dt;
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(g, p);
  }
  const wid = activeWeaponId(g.inv);
  const wp = WEAPONS[wid];
  const hasMag = wp.mag != null;
  if (wp.ammoMax !== Infinity && p.ammo[wid] == null) p.ammo[wid] = wp.ammoMax; // first pickup grants a full reserve
  if (hasMag && p.mag[wid] == null) p.mag[wid] = Math.min(magCap(g, wid), p.ammo[wid] || 0);

  // manual reload (R)
  if (hasMag && keyHit(g, 'reload', 'KeyR') && p.reloadT <= 0 && (p.mag[wid] || 0) < magCap(g, wid) && (p.ammo[wid] || 0) > 0) {
    startReload(g, p, wid);
  }

  const coolMul = stim ? 0.6 : 1;

  // alt-fire (right mouse) — a mod-unlocked special shot per weapon
  if (p._altCd > 0) p._altCd -= dt;
  if (p._chargeT != null) {
    // staff charge-bolt: hold to charge, release to fire
    if (mouse.right) p._chargeT = Math.min(1, p._chargeT + dt);
    else {
      altFireCharge(g, p, wp, wid, p._chargeT);
      p._chargeT = null;
    }
  } else if (mouse.rightEdge && p._altCd <= 0 && p.reloadT <= 0 && p.stun <= 0 && p.dodge <= 0) {
    const mode = wsFor(g, wid).altFire;
    if (mode) doAltFire(g, p, wp, wid, mode);
  }

  if (wp.hitscan) {
    fireBeam(g, p, wp, dt);
  } else {
    if (p.beam && p.beam.on) { sfx.beam(false); p.beam.on = false; }
    const mdEdge = mouse.down && !g.mouseWasDown;
    // the touch aim-stick has no separate trigger — holding it fires every weapon
    const wantFire = wp.auto || touchFiring() ? mouse.down : mdEdge;
    const blocked = g.emp && wp.energy;
    const canAct = p.cool <= 0 && p.dodge <= 0 && p.stun <= 0 && p.reloadT <= 0;
    const ammoOK = hasMag ? (p.mag[wid] || 0) > 0 : wp.ammoMax === Infinity || (p.ammo[wid] || 0) > 0;

    // keep an in-progress burst rolling, independent of the trigger
    if (p.burstN > 0 && p.burstWid === wid) {
      if (p.dodge > 0 || p.stun > 0 || p.reloadT > 0) {
        p.burstN = 0;
      } else {
        p.burstT -= dt;
        while (p.burstN > 0 && p.burstT <= 0) {
          if (hasMag && (p.mag[wid] || 0) <= 0) {
            p.burstN = 0;
            break;
          }
          fireWeapon(g, p, wp, wid);
          if (hasMag) p.mag[wid]--;
          else if (wp.ammoMax !== Infinity) p.ammo[wid]--;
          p.burstN--;
          p.burstT += wp.burstDelay || 0.06;
        }
        if (p.burstN <= 0 && hasMag && (p.mag[wid] || 0) <= 0 && (p.ammo[wid] || 0) > 0) startReload(g, p, wid);
      }
    }

    if (wantFire && canAct && p.burstN <= 0) {
      if (blocked || !ammoOK) {
        if (mdEdge) sfx.dryFire();
        p.cool = 0.12;
        if (!blocked && hasMag && (p.mag[wid] || 0) <= 0 && (p.ammo[wid] || 0) > 0) startReload(g, p, wid);
      } else {
        fireWeapon(g, p, wp, wid);
        if (hasMag) p.mag[wid]--;
        else if (wp.ammoMax !== Infinity) p.ammo[wid]--;
        p.cool = (wp.fireRate * coolMul) / (wsFor(g, wid).fireRateMul || 1);
        if (wp.burst > 1) {
          p.burstWid = wid;
          p.burstN = wp.burst - 1;
          p.burstT = wp.burstDelay || 0.06;
        }
        if (hasMag && (p.mag[wid] || 0) <= 0 && (p.ammo[wid] || 0) > 0 && !(wp.burst > 1)) startReload(g, p, wid);
      }
    }
  }
}

function updateFlowAndRoom(g, dt) {
  const p = g.player;
  const w = g.world;
  // flow field toward player
  g.flowT -= dt;
  if (g.flowT <= 0) {
    g.flow.compute(
      clamp(Math.floor(p.x / TILE), 0, w.W - 1),
      clamp(Math.floor(p.y / TILE), 0, w.H - 1)
    );
    g.flowT = 0.18;
  }

  const rNow = findRoom(g, p.x, p.y);
  if (rNow) {
    g.curRoom = rNow;
    rNow.everSeen = true;
    if (rNow === g.world.dhdRoom && !g.bossIntroSeen) {
      g.bossIntroSeen = true;
      g.bossIntroT = 3.4;
      addShake(g, 14, 0, 1);
      sfx.bossSting(g.params.faction || g.params.primary);
      if (g._dhdKind === 'siege') {
        g.message('DHD SIEGE — reinforcements inbound until you dial');
        hint(g, 'dhd_siege', 'A siege at the DHD: guards keep arriving from the gate until you dial out. Kill the commander and its garrison to bring the DHD online, then leave — don’t linger.');
      } else if (g._dhdKind === 'vanguard') {
        g.message('DHD VANGUARD — the champion is already moving');
        hint(g, 'dhd_vanguard', 'A vanguard: the DHD champion is buffed and pushes you from the start, with a heavier guard. Use cover and the room’s pillars.');
      }
    }
  }
  if (g.bossIntroT > 0) g.bossIntroT -= dt;
}

function updateGrenades(g, dt) {
  const p = g.player;
  // grenades
  for (const gr of g.grenades) {
    gr.fuse -= dt;
    const ox = gr.x;
    const oy = gr.y;
    gr.x += gr.vx * dt;
    gr.y += gr.vy * dt;
    if (tileAt(g.world, gr.x, gr.y) === 1) {
      gr.x = ox;
      gr.y = oy;
      gr.vx *= -0.35;
      gr.vy *= -0.35;
    }
    gr.vx -= gr.vx * Math.min(1, 2.4 * dt);
    gr.vy -= gr.vy * Math.min(1, 2.4 * dt);
    if (gr.fuse <= 0) {
      explode(g, gr);
      if (gr.hazard) g.hazards.push(new Hazard(gr.x, gr.y, gr.hazard, 4.0, 13, 'enemy'));
      gr.alive = false;
    }
  }
}

function updateHeatAndStreak(g, dt) {
  const p = g.player;
  // heat: the longer a run goes, the harder the faction hunts you
  g.heat += dt * 0.048 * (fx(g).heatMul || 1) * worldMods(g).heatMul * diffMul(g, 'heat');
  if (g.heat >= 0.8 && !(g.save.hints && g.save.hints.heat))
    hint(g, 'heat', 'The faction has noticed you. The hunt only grows while a run goes on — at SWARM a Hunter starts tracking you across the whole map. Clear fast, or dial out.');
  if (!g.hunterSpawned && g.heat >= 2) spawnHunter(g);

  if (g.killStreakT > 0) {
    g.killStreakT -= dt;
    if (g.killStreakT <= 0) g.killStreak = 0;
  }
}

function updateFieldHazards(g, dt) {
  const p = g.player;
  // area hazards: grenadier plasma pools + the per-biome field hazards.
  // p._slow is rebuilt here every frame; player/enemy movement reads it next tick.
  p._slow = 1;
  for (const hz of g.hazards) {
    hz.phase += dt * 6;
    if (!hz.everlasting) {
      hz.life -= dt;
      if (hz.life <= 0) {
        hz.alive = false;
        continue;
      }
    }
    const pd = Math.hypot(p.x - hz.x, p.y - hz.y);
    const inside = pd < hz.r;
    const safe = p.iframe <= 0 && p.dodge <= 0;
    const k = hz.kind;
    if (k === 'spore') {
      if (inside) {
        p._slow = Math.min(p._slow, hz.slow);
        hz.tick -= dt;
        if (hz.tick <= 0 && safe) {
          hz.tick = 0.25;
          damagePlayer(g, 1.4, p.x - hz.x, p.y - hz.y);
        }
      }
    } else if (k === 'quicksand') {
      if (inside) p._slow = Math.min(p._slow, hz.slow);
    } else if (k === 'steam') {
      hz.cycleT -= dt;
      if (hz.cycleT <= 0) {
        hz.on = !hz.on;
        hz.cycleT = hz.on ? hz.onT : hz.offT;
      }
      if (hz.on && inside && safe) {
        hz.tick -= dt;
        if (hz.tick <= 0) {
          hz.tick = 0.25;
          damagePlayer(g, 4, p.x - hz.x, p.y - hz.y);
        }
      }
    } else if (k === 'thin-ice') {
      if (inside) {
        hz.standT += dt;
        if (hz.standT > 0.8 && !hz.broken) {
          hz.broken = true;
          p.stun = Math.max(p.stun, 0.34);
          addShake(g, 8, 0, 1);
          if (sfx.hit) sfx.hit();
          hz.alive = false;
        }
      } else {
        hz.standT = Math.max(0, hz.standT - dt * 0.5);
      }
    } else {
      // plasma (legacy grenadier fire) — unchanged
      if (hz.from === 'enemy') {
        hz.tick -= dt;
        if (inside && safe && hz.tick <= 0) {
          hz.tick = 0.2;
          damagePlayer(g, hz.dps * 0.2, p.x - hz.x, p.y - hz.y);
        }
      }
    }
    if (Math.random() < 0.4) {
      const a = rr(0, TAU);
      const d = Math.sqrt(Math.random()) * hz.r;
      const col =
        k === 'spore' ? '#8fe06a' : k === 'steam' ? (hz.on ? '#e8eef2' : '#5a6470') :
        k === 'thin-ice' ? '#bfe8ff' : k === 'quicksand' ? '#c9a86a' : '#ff9a3c';
      g.particles.push(
        new Particle(hz.x + Math.cos(a) * d, hz.y + Math.sin(a) * d, rr(-8, 8), rr(-30, -8), rr(0.3, 0.7), col, rr(1.5, 3))
      );
    }
  }
  updateTraps(g, dt);
}

function updateReformDebris(g, dt) {
  const p = g.player;
  // reassembly debris from Replicator brutes
  for (const bl of g.blocks) {
    bl.mergeT -= dt;
    bl.spin += dt * 6;
    bl.x += bl.vx * dt;
    bl.y += bl.vy * dt;
    bl.vx -= bl.vx * Math.min(1, 3 * dt);
    bl.vy -= bl.vy * Math.min(1, 3 * dt);
    if (tileAt(g.world, bl.x, bl.y) === 1) {
      bl.x -= bl.vx * dt;
      bl.y -= bl.vy * dt;
      bl.vx *= -0.4;
      bl.vy *= -0.4;
    }
    if (bl.mergeT <= 0) {
      const near = g.blocks.filter((o) => o.alive && (o.x - bl.x) ** 2 + (o.y - bl.y) ** 2 < 130 * 130);
      if (near.length >= 3) {
        for (let i = 0; i < Math.min(4, near.length); i++) near[i].alive = false;
        const nb = new Enemy('replicator_brute', bl.x, bl.y, bl.threat, { hpMul: 0.55, reformed: true });
        nb._room = bl.room;
        nb.state = 'active';
        nb.mode = 'advance';
        nb.aggressive = true;
        nb.lungeCd = 0.6; // reforms already lunging
        g.enemies.push(nb);
        burst(g, bl.x, bl.y, 18, '#b6f0ff');
        g.message('Replicator reassembles');
      } else {
        bl.alive = false;
        spark(g, bl.x, bl.y, '#b6f0ff');
      }
    }
  }
}

function updateEnemyTick(g, dt) {
  const p = g.player;
  const w = g.world;
  // squad coordination: rebuilt once per frame, drives per-enemy modifiers
  updateSquads(g, dt);

  // enemies
  for (const e of g.enemies) {
    if (!e.alive) continue;
    e.flash = Math.max(0, e.flash - dt);
    // routing guards (boss dead): flee the player, then vanish through the gate
    if (e.rout > 0) {
      e.rout -= dt;
      const rdx = e.x - g.player.x;
      const rdy = e.y - g.player.y;
      const rl = Math.hypot(rdx, rdy) || 1;
      e.facing = Math.atan2(rdy, rdx);
      const nx = e.x + (rdx / rl) * e.speed * 1.25 * dt;
      const ny = e.y + (rdy / rl) * e.speed * 1.25 * dt;
      if (tileAt(g.world, nx, e.y) === 0) e.x = nx;
      if (tileAt(g.world, e.x, ny) === 0) e.y = ny;
      if (e.rout <= 0) {
        e.alive = false;
        spark(g, e.x, e.y, '#ffb347');
      }
      continue;
    }
    if (e.kind === 'jaffa') updateJaffa(g, e, dt);
    else if (e.kind === 'jaffa_heavy') updateJaffaHeavy(g, e, dt);
    else if (e.kind === 'jaffa_grenadier') updateGrenadier(g, e, dt);
    else if (e.kind === 'jaffa_sniper') updateSniper(g, e, dt);
    else if (e.kind === 'wraith') updateWraith(g, e, dt);
    else if (e.kind === 'wraith_drone') updateWraithDrone(g, e, dt);
    else if (e.kind === 'wraith_stalker') updateStalker(g, e, dt);
    else if (e.kind === 'replicator') updateReplicator(g, e, dt);
    else if (e.kind === 'replicator_brute') updateReplicator(g, e, dt, true);
    else if (e.kind === 'replicator_weaver') updateWeaver(g, e, dt);
    else if (e.kind === 'scavenger') updateScavenger(g, e, dt);
    else if (e.kind === 'nexus') updateNexus(g, e, dt);
    else if (e.kind === 'boss') updateBoss(g, e, dt);
    // else: unknown kind — no-op (no fall-through into the boss AI)
    e.x += e.kx * dt;
    e.y += e.ky * dt;
    e.kx -= e.kx * Math.min(1, 8 * dt);
    e.ky -= e.ky * Math.min(1, 8 * dt);
    ({ x: e.x, y: e.y } = circleVsGrid(w, e, e.x, e.y));
    keepOutOfGateRoom(g, e);
  }

  // nexus shield pylons — spin, decay their hit-flash, cull the dead
  if (g.pylons && g.pylons.length) {
    for (const py of g.pylons) {
      if (!py.alive) continue;
      py.phase += dt * 1.6;
      if (py.flash > 0) py.flash -= dt * 3;
      if (Math.random() < 0.4 * dt) g.particles.push(new Particle(py.x, py.y - 8, rr(-12, 12), rr(-30, -8), rr(0.3, 0.7), '#8fe4ff', rr(1.5, 3)));
    }
    if (g.pylons.some((py) => !py.alive)) g.pylons = g.pylons.filter((py) => py.alive);
  }

  // cap how many enemies from other rooms can pile onto the player at once —
  // the farthest extras stand down (dormant) until the player comes to them
  const migrants = g.enemies.filter(
    (e) => e.alive && e.state === 'active' && !e.hunter && e._room !== g.curRoom
  );
  const migCap = g.curRoom && g.curRoom.kind === 'dhd' ? 3 : 4;
  if (migrants.length > migCap) {
    migrants.sort((a, b) => Math.hypot(b.x - p.x, b.y - p.y) - Math.hypot(a.x - p.x, a.y - p.y));
    for (let i = 0; i < migrants.length - migCap; i++) {
      migrants[i].state = 'dormant';
      migrants[i].mode = 'advance';
      migrants[i].cover = null;
    }
  }
}

function updateProjectilesAndPickups(g, dt) {
  const p = g.player;
  for (const b of g.bullets) updateBullet(g, b, dt);

  for (const pk of g.pickups) {
    if (!pk.alive) continue;
    pk.bob += dt * 4;
    if ((pk.x - p.x) ** 2 + (pk.y - p.y) ** 2 < (pk.r + p.r + 6) ** 2) collectPickup(g, pk);
  }

  for (const pt of g.particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx -= pt.vx * Math.min(1, 2 * dt);
    pt.vy -= pt.vy * Math.min(1, 2 * dt);
    if (pt.life <= 0) pt.alive = false;
  }
  // hard cap — many simultaneous blasts (grenade spam, a brute shattering in a
  // crowd) can otherwise spike this into the tens of thousands. keep the newest.
  if (g.particles.length > 3000) g.particles.splice(0, g.particles.length - 3000);
}

function compactPlayEntities(g, dt) {
  const p = g.player;
  updateSpecials(g, dt);

  g.enemies = g.enemies.filter((e) => e.alive);
  g.bullets = g.bullets.filter((b) => b.alive);
  g.grenades = g.grenades.filter((x) => x.alive);
  if (g.grenades.length > 40) g.grenades.splice(0, g.grenades.length - 40);
  g.blocks = g.blocks.filter((x) => x.alive);
  g.hazards = g.hazards.filter((x) => x.alive);
  g.traps = g.traps.filter((x) => x.alive);
  g.pickups = g.pickups.filter((x) => x.alive);
  g.particles = g.particles.filter((x) => x.alive);
  for (const f of g.flashes) f.t -= dt;
  g.flashes = g.flashes.filter((f) => f.t > 0);
}

function updateRoomClears(g, dt) {
  const p = g.player;
  const w = g.world;
  // room-cleared checks
  for (const rm of w.rooms) {
    if (rm.populated && !rm.cleared && !g.enemies.some((e) => e._room === rm)) {
      rm.cleared = true;
      if (rm.kind !== 'gate') g._runRoomsCleared = (g._runRoomsCleared || 0) + 1;
      if (rm.kind === 'dhd') {
        g.dhdActive = true;
        g.message('DHD online — approach and press E to dial');
        hint(g, 'dhd', 'At the DHD, press E to open the gate map. Dial DEEPER for higher threat, better loot and more heat — or HOME to bank your naquadah and end the run. Death only costs half your unbanked naquadah; equipped gear is safe.');
        sfx.pickup();
      } else {
        g.message('Sector clear');
      }
      // last un-cleared room on the world just flipped -> world clear event
      if (!g._worldClearFired && w.rooms.every((r2) => r2.cleared)) {
        g._worldClearFired = true;
        if (!g._events) g._events = [];
        g._events.push({
          t: 'worldClear',
          faction: g.params.faction || g.params.primary,
          threat: g.params.threat,
          mods: g.params.mods || [],
        });
      }
    }
  }

  updateModifiers(g, dt);

  if (g.dhdActive) {
    const c = w.dhdRoom.centerPx;
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 54 * 54 && keyHit(g, 'interact', 'KeyE')) {
      buildGateMap(g);
      g.state = 'gatemap';
    }
  }

  if (p.hp <= 0 && p.alive) onDeath(g);
}

function updatePlayCamera(g, dt) {
  const p = g.player;
  // camera look-ahead: blend where you're aiming with where you're moving so
  // the view leads the action without snapping around every time you flick aim
  const camSpd = Math.hypot(p.vx || 0, p.vy || 0);
  const velX = camSpd > 1 ? (p.vx / camSpd) * 42 : 0;
  const velY = camSpd > 1 ? (p.vy / camSpd) * 42 : 0;
  const laX = Math.cos(p.aim) * 34 + velX;
  const laY = Math.sin(p.aim) * 34 + velY;
  g.cam.x += (p.x + laX - g.cam.x) * Math.min(1, 6 * dt);
  g.cam.y += (p.y + laY - g.cam.y) * Math.min(1, 6 * dt);
  clampCam(g);
  g.shake -= g.shake * Math.min(1, 5 * dt);
  if (g.shake < 0.2) g.shake = 0;

  updateFloats(g, dt); // rising damage / reward ticks
}

function updateCombatAudio(g, dt) {
  const p = g.player;
  const w = g.world;
  // audio: ambient bed tracks the threat, plus a low-HP heartbeat.
  // inputs: heat, whether we're actively fighting, nearby active enemy count,
  // a live boss (floors intensity), and standing on an un-dialled DHD.
  let fighting = false;
  let bossAlive = false;
  let nearActive = 0;
  for (const e of g.enemies) {
    if (!e.alive) continue;
    if (e.kind === 'boss' || e.kind === 'nexus') bossAlive = true;
    if (e.state === 'active' && !e.hunter) {
      fighting = true;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy < 560 * 560) nearActive++;
    }
  }
  let musTarget =
    g.heat / 3.5 +
    (fighting ? 0.2 : 0) +
    Math.min(0.4, nearActive * 0.09) +
    (g.dhdActive === false && g.curRoom === w.dhdRoom ? 0.35 : 0);
  if (bossAlive) musTarget = Math.max(musTarget, 0.7);
  musTarget = Math.min(1, musTarget);
  // smooth toward the target every frame so it never jumps
  g._musInt = g._musInt == null ? musTarget : g._musInt + (musTarget - g._musInt) * Math.min(1, 2.2 * dt);
  g._musIntT = (g._musIntT || 0) - dt;
  if (g._musIntT <= 0) {
    g._musIntT = 0.5;
    if (music && music.setIntensity) music.setIntensity(g._musInt);
  }
  const hpFrac = p.hp / p.maxHp;
  g._lowHpT = (g._lowHpT || 0) - dt;
  if (hpFrac > 0 && hpFrac < 0.3 && p.alive && g._lowHpT <= 0) {
    g._lowHpT = 0.55 + hpFrac; // faster beat the lower you are
    sfx.lowHp();
  }
}

function updateModifiers(g, dt) {
  if (!g.params.mods.includes('ion-storm')) return;
  g.empT -= dt;
  if (g.empT <= 0) {
    g.emp = !g.emp;
    g.empT = g.emp ? 2.4 : 11 + Math.random() * 5;
    if (g.emp) g.message('ION STORM — energy weapons offline');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ spawning
// ──────────────────────────────────────────────────────────────────────────

function findRoom(g, x, y) {
  for (const r of g.world.rooms) {
    const R = r.rectPx;
    if (x >= R.x && x <= R.x + R.w && y >= R.y && y <= R.y + R.h) return r;
  }
  return null;
}

// weighted floor loot: {id, count, rarity}. Gear rolls a rarity tier that
// scales its numbers (see itemStats); plain field dressings stay common.
function rollLoot(R, threat) {
  const roll = R.rand();
  let out;
  if (roll < 0.34) out = { id: R.chance(0.4) ? 'medkit' : 'bandage', count: R.chance(0.3) ? 2 : 1 };
  else if (roll < 0.5) out = { id: 'stim', count: 1 };
  else if (roll < 0.62) out = { id: 'shieldcell', count: 1 };
  else if (roll < 0.76) out = { id: 'frag', count: R.int(1, 2) };
  else if (roll < 0.9) {
    const armor = R.chance(0.35 + Math.min(0.3, threat * 0.04))
      ? R.pick(['a_helm', 'a_plate'])
      : R.pick(['a_visor', 'a_vest', 'a_greaves', 'a_boots']);
    out = { id: armor, count: 1 };
  } else {
    // launcher is deliberately scarce; everything else shares the common weapon roll
    const wid = R.chance(0.12) ? 'w_launcher' : R.pick(['w_staff', 'w_zat', 'w_shotgun', 'w_burst', 'w_beam']);
    out = { id: wid, count: 1 };
  }
  if (out.id !== 'bandage') out.rarity = rollRarity(threat, () => R.rand());
  return out;
}

// a weapon drop for the kill tables — launcher stays rare here too
function rollWeaponItem() {
  if (Math.random() < 0.1) return 'w_launcher';
  const t = ['w_staff', 'w_zat', 'w_shotgun', 'w_burst', 'w_beam'];
  return t[Math.floor(Math.random() * t.length)];
}

// faction rosters — factions never mix within a world.
// `slot` lets a room cap its number of heavies/brutes.
function pickEnemyKind(fac, R, slot) {
  if (fac === 'wraith') {
    if (slot.stalkers < 1 && R.chance(0.25)) return (slot.stalkers++), 'wraith_stalker';
    return R.chance(0.5) ? 'wraith_drone' : 'wraith';
  }
  if (fac === 'replicator') {
    if (slot.weavers < 2 && R.chance(0.28)) return (slot.weavers++), 'replicator_weaver';
    return slot.brutes < (slot.bruteCap || 1) && R.chance(0.32) ? ((slot.brutes++), 'replicator_brute') : 'replicator';
  }
  // jaffa: a lone lane-holding sniper turns up in ~1 room in 3
  if (slot.snipers < 1 && R.chance(0.36)) return (slot.snipers++), 'jaffa_sniper';
  if (slot.heavies < 1 && R.chance(0.36)) return (slot.heavies++), 'jaffa_heavy';
  if (slot.grenadiers < 1 && R.chance(0.3)) return (slot.grenadiers++), 'jaffa_grenadier';
  return 'jaffa';
}
function guardKind(fac, R, slot) {
  if (fac === 'wraith') return R.chance(0.4) ? 'wraith_drone' : 'wraith';
  if (fac === 'replicator') return 'replicator';
  return slot.heavies < 1 && R.chance(0.5) ? ((slot.heavies++), 'jaffa_heavy') : 'jaffa';
}

function spawnHunter(g) {
  // don't pile a hunter onto the boss fight — you're already committed there
  if (g.curRoom === g.world.dhdRoom || g.dhdActive) return;
  g.hunterSpawned = true;
  const fac = g.params.faction || g.params.primary;
  const kind = fac === 'wraith' ? 'wraith' : fac === 'replicator' ? 'replicator_brute' : 'jaffa';
  // spawn in the room farthest from the player so it has to hunt across the map
  let far = null;
  let fd = -1;
  for (const r of g.world.rooms) {
    if (r.kind === 'gate') continue;
    const d = Math.hypot(r.centerPx.x - g.player.x, r.centerPx.y - g.player.y);
    if (d > fd) {
      fd = d;
      far = r;
    }
  }
  const c = (far || g.world.dhdRoom).centerPx;
  const h = new Enemy(kind, c.x, c.y, g.params.threat + 2, { hpMul: 1.6, speedMul: 1.35, hunter: true });
  h._room = far;
  h.aggressive = true;
  h.state = 'active';
  h.mode = 'advance';
  g.enemies.push(h);
  g.message('A hunter has your scent');
}

// build every room's occupants + loot up front — no spawn-on-entry pop-in.
// Enemies start idle and only react when they notice the player.
function populateWorld(g) {
  const p = g.params;
  const wm = worldMods(g);
  const gr = g.world.gateRoom;
  for (const room of g.world.rooms) {
    room.populated = true;
    if (room.kind === 'gate') {
      room.cleared = true;
      continue;
    }
    // rooms touching the gate: their guards don't come looking straight away,
    // so stepping through the gate isn't an instant firefight
    const nearGate = gr && Math.abs(room.gx - gr.gx) + Math.abs(room.gy - gr.gy) <= 1;
    const R = rngHelpers(makeRng('enc:' + p.seedStr + ':' + room.gx + ':' + room.gy));
    const rect = room.rectPx;
    const placeXY = () => {
      let x = room.centerPx.x;
      let y = room.centerPx.y;
      for (let tries = 0; tries < 40; tries++) {
        x = rect.x + R.range(46, rect.w - 46);
        y = rect.y + R.range(46, rect.h - 46);
        if (tileAt(g.world, x, y) === 0) break;
      }
      return { x, y };
    };

    const fac = p.faction || p.primary;
    const heatTier = Math.min(3, Math.floor(g.heat));
    const slot = { heavies: 0, brutes: 0, grenadiers: 0, snipers: 0, weavers: 0, stalkers: 0 };

    // special set-piece room (tagged in worldgen). Places its own occupants +
    // set-piece and skips the normal fill / scatter.
    if (room.special) {
      placeSpecial(g, room, R, fac, p.threat, placeXY);
      continue;
    }

    if (room.kind === 'dhd') {
      const c = room.centerPx;
      const isFinale = g.params.address === FINALE_ADDRESS;
      // deterministic DHD encounter type (never the finale): standard 60% /
      // siege 20% (reinforcements arrive until you dial) / vanguard 20% (a
      // buffed, already-advancing boss + a bigger guard). every type still has
      // ONE boss so a clean run kills exactly one boss per world.
      const dhdKind = isFinale ? 'finale' : R.pick(['standard', 'standard', 'standard', 'siege', 'vanguard']);
      g._dhdKind = dhdKind;
      const vanguard = dhdKind === 'vanguard';
      const bossOpt = isFinale ? {} : vanguard ? { variant: fac, hpMul: 1.25 } : { variant: fac };
      const boss = new Enemy(isFinale ? 'nexus' : 'boss', c.x, c.y - 80, p.threat, bossOpt);
      boss._room = room;
      if (vanguard) {
        boss.aggressive = true;
        boss.state = 'active';
        boss.mode = 'advance';
      }
      g.enemies.push(boss);
      if (isFinale) {
        // three shield pylons ringing the core — down them to open a damage window
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
          let px = c.x + Math.cos(a) * 150;
          let py = c.y - 80 + Math.sin(a) * 120;
          if (tileAt(g.world, px, py) !== 0) {
            px = c.x + Math.cos(a) * 90;
            py = c.y - 80 + Math.sin(a) * 80;
          }
          const py2 = new NexusPylon(px, py);
          py2._room = room;
          g.pylons.push(py2);
        }
      }
      let guards = 1 + Math.min(2, Math.floor(p.threat / 2)) + (fac === 'replicator' ? 3 : 0);
      if (dhdKind === 'vanguard') guards += 2;
      for (let i = 0; i < guards; i++) {
        const q = placeXY();
        const e = new Enemy(guardKind(fac, R, slot), q.x, q.y, p.threat);
        e._room = room;
        e.aggressive = true;
        g.enemies.push(e);
      }
      if (dhdKind === 'siege') {
        // reinforcements keep arriving from the gate every ~14s until the DHD is
        // dialed. They are NOT room-bound (like the hunter / scavenger) so they
        // can't gate the room-clear that unlocks the dial.
        g._siege = { t: 0, next: 12, cap: 5, spawn: (g.world.gateRoom || room).centerPx };
      }
      continue;
    }

    // Replicators come as an overwhelming tide — many weak units, more brutes
    const swarm = fac === 'replicator';
    if (swarm) slot.bruteCap = p.threat >= 5 ? 3 : 2;
    let count = swarm
      ? Math.min(17, 8 + Math.floor(p.threat / 2) + R.int(1, 3) + heatTier * 2)
      : Math.min(7, 3 + Math.floor(p.threat / 2) + R.int(0, 1) + heatTier);
    if (nearGate) count = Math.max(swarm ? 5 : 2, count - (swarm ? 3 : 2)); // lighter garrison by the gate
    for (let i = 0; i < count; i++) {
      const kind = pickEnemyKind(fac, R, slot);
      const q = placeXY();
      const e = new Enemy(kind, q.x, q.y, p.threat);
      e._room = room;
      if (kind === 'jaffa') e.aggressive = R.chance(nearGate ? 0.1 : Math.min(0.5, 0.28 + g.hop * 0.03));
      if (kind === 'jaffa_heavy' || kind === 'replicator_brute') e.aggressive = !nearGate;
      // a swarm presses in hard — every replicator rushes, none hang back
      if (kind === 'replicator') e.aggressive = !nearGate;
      if (nearGate) e.calmT = 3.5 + R.range(0, 2); // hold post, ignore the player by sight for a beat
      g.enemies.push(e);
    }

    // ambient scavenger — additive, never room-bound so it can't gate a clear
    if (!nearGate && R.chance(0.08)) {
      const q = placeXY();
      const sc = new Enemy('scavenger', q.x, q.y, p.threat);
      sc._room = null;
      g.enemies.push(sc);
    }

    // per-biome field hazards / traps — deterministic off this room's R.
    // ~45% of non-gate rooms get one, hive/foundry/ice can get a second.
    placeHazards(g, room, R, rect, nearGate, placeXY);

    // scatter supplies: a medical item in most rooms, sometimes an extra
    if (R.chance(0.62)) {
      const q = placeXY();
      g.pickups.push(
        new Pickup('item', q.x, q.y, 0, { id: R.chance(0.4) ? 'medkit' : 'bandage', count: R.chance(0.3) ? 2 : 1 })
      );
    }
    if (R.chance(0.4)) {
      const q = placeXY();
      g.pickups.push(new Pickup('item', q.x, q.y, 0, rollLoot(R, p.threat)));
    }
    // BLACK FOG leaves extra caches behind — the compensation for going blind
    if (wm.lootMul > 1 && R.chance(0.45)) {
      const q = placeXY();
      g.pickups.push(new Pickup('item', q.x, q.y, 0, rollLoot(R, p.threat)));
    }
    // intel cache — data recovered from the faction's systems
    if (R.chance(0.45)) {
      const q = placeXY();
      g.pickups.push(new Pickup('intel', q.x, q.y, 3 + R.int(0, 3)));
    }
    if (wm.intelMul > 1 && R.chance(0.4)) {
      const q = placeXY();
      g.pickups.push(new Pickup('intel', q.x, q.y, 3 + R.int(0, 3)));
    }
  }
}

// per-biome field hazards, seeded off the room's own RNG so a world is stable.
// temple/jungle -> dart traps; ice -> thin ice; foundry -> steam vents;
// hive/jungle -> spore clouds; desert -> quicksand. Non-plasma hazards are
// everlasting (Hazard defaults handle that) and do modest, telegraphed damage.
function placeHazards(g, room, R, rect, nearGate, placeXY) {
  if (nearGate || !R.chance(0.45)) return;
  const biome = g.params.biome;
  const spore = () => {
    const q = placeXY();
    g.hazards.push(new Hazard(q.x, q.y, 52 + R.range(0, 12), 999, 6, 'world', 'spore', { everlasting: true }));
  };
  const dart = () => {
    const c = room.centerPx;
    const m = 12;
    const side = R.int(0, 3);
    let tx;
    let ty;
    let dir;
    if (side === 0) { tx = rect.x + m; ty = c.y; dir = 0; }
    else if (side === 1) { tx = rect.x + rect.w - m; ty = c.y; dir = Math.PI; }
    else if (side === 2) { tx = c.x; ty = rect.y + m; dir = Math.PI / 2; }
    else { tx = c.x; ty = rect.y + rect.h - m; dir = -Math.PI / 2; }
    if (tileAt(g.world, tx + Math.cos(dir) * 24, ty + Math.sin(dir) * 24) === 1) return;
    g.traps.push(new Trap(tx, ty, dir, { dmg: 18, fireCd: 2.2, range: 340, triggerR: 24 }));
  };
  if (biome === 'temple') dart();
  else if (biome === 'ice') {
    const q = placeXY();
    g.hazards.push(new Hazard(q.x, q.y, 46, 999, 0, 'world', 'thin-ice', { everlasting: true }));
  } else if (biome === 'foundry') {
    const q = placeXY();
    g.hazards.push(new Hazard(q.x, q.y, 40, 999, 0, 'world', 'steam', { everlasting: true, cycleT: R.range(0, 1.8), onT: 1.1, offT: 1.8, on: R.chance(0.5) }));
  } else if (biome === 'hive') spore();
  else if (biome === 'desert') {
    const q = placeXY();
    g.hazards.push(new Hazard(q.x, q.y, 54 + R.range(0, 10), 999, 0, 'world', 'quicksand', { everlasting: true }));
  } else if (biome === 'jungle') {
    if (R.chance(0.5)) dart();
    else spore();
  } else return;

  // bigger enclosed biomes can carry a second hazard
  if ((biome === 'hive' || biome === 'foundry' || biome === 'ice') && R.chance(0.3)) {
    const q = placeXY();
    const kind = biome === 'hive' ? 'spore' : biome === 'foundry' ? 'steam' : 'thin-ice';
    g.hazards.push(
      new Hazard(q.x, q.y, kind === 'spore' ? 44 : 38, 999, kind === 'spore' ? 6 : 0, 'world', kind, {
        everlasting: true,
        cycleT: R.range(0, 1.8),
        on: R.chance(0.5),
      })
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ special rooms
// ──────────────────────────────────────────────────────────────────────────
// worldgen tags one normal room per world with room.special; here we drop the
// set-piece + its guards. All guards start idle like any other room.

const SG_NAMES = ['Cpt. Reyes', 'Lt. Okafor', 'Sgt. Duval', 'Dr. Halvorsen', 'Cpl. Tran', 'Lt. Marsh'];

function factionOfKind(kind) {
  if (kind.indexOf('wraith') === 0) return 'wraith';
  if (kind.indexOf('replicator') === 0) return 'replicator';
  return 'jaffa';
}

function placeSpecial(g, room, R, fac, threat, placeXY) {
  const kind = room.special;
  const c = room.centerPx;
  const gslot = { heavies: 0, brutes: 0, grenadiers: 0 };
  const guard = (n, tBump) => {
    for (let i = 0; i < n; i++) {
      const q = placeXY();
      const e = new Enemy(guardKind(fac, R, gslot), q.x, q.y, threat + (tBump || 0));
      e._room = room;
      g.enemies.push(e);
    }
  };

  if (kind === 'datacore') {
    const dc = new DataCore(c.x, c.y);
    dc._room = room;
    dc.born = g.time;
    g.dataCores.push(dc);
    guard(4 + Math.min(3, Math.floor(threat / 2)), 1); // above-average pack
  } else if (kind === 'vault') {
    const al = room.alcove;
    const vd = al
      ? new VaultDoor(al.x, al.y, al.w, al.h)
      : new VaultDoor(c.x - 34, room.rectPx.y + 20, 68, 18);
    vd._room = room;
    vd.lootX = al ? al.cx : c.x;
    vd.lootY = al ? al.cy : room.rectPx.y + 44;
    g.vaultDoors.push(vd);
    guard(2 + Math.floor(threat / 3));
  } else if (kind === 'arena') {
    room._arena = { wave: 0, waves: 3, locked: false, done: false, t: 0 };
    g.arenaRooms.push(room);
    spawnArenaWave(g, room, fac, threat, 1, false); // wave 1 pre-placed, idle
  } else if (kind === 'vendor') {
    const v = new Vendor(c.x, c.y, rollVendorStock(R, threat));
    v._room = room;
    g.vendors.push(v);
    guard(2);
  } else if (kind === 'rescue') {
    const q = placeXY();
    const cap = new Captive(q.x, q.y, R.pick(SG_NAMES));
    cap._room = room;
    g.captives.push(cap);
    guard(4 + Math.min(3, Math.floor(threat / 2)));
  }
}

function spawnArenaWave(g, room, fac, threat, waveNum, active) {
  const R = rngHelpers(makeRng('arena:' + g.params.seedStr + ':' + room.gx + ':' + room.gy + ':' + waveNum));
  const rect = room.rectPx;
  const gslot = { heavies: 0, brutes: 0, grenadiers: 0 };
  const put = () => {
    for (let t = 0; t < 40; t++) {
      const x = rect.x + R.range(46, rect.w - 46);
      const y = rect.y + R.range(46, rect.h - 46);
      if (tileAt(g.world, x, y) === 0) return { x, y };
    }
    return { x: room.centerPx.x, y: room.centerPx.y };
  };
  const wake = (e) => {
    e._room = room;
    if (active) {
      e.state = 'active';
      e.aggressive = true;
      e.mode = 'advance';
    }
    g.enemies.push(e);
  };
  const n = 3 + waveNum;
  for (let i = 0; i < n; i++) {
    const q = put();
    wake(new Enemy(guardKind(fac, R, gslot), q.x, q.y, threat));
  }
  if (waveNum >= 3) {
    const q = put();
    const elite = fac === 'wraith' ? 'wraith' : fac === 'replicator' ? 'replicator_brute' : 'jaffa_heavy';
    wake(new Enemy(elite, q.x, q.y, threat + 2, { hpMul: 1.5, hunter: true }));
  }
}

function spawnArenaReward(g, room, bailed) {
  const c = room.centerPx;
  const R = rngHelpers(makeRng('arenaReward:' + g.params.seedStr + ':' + room.gx + ':' + room.gy));
  const armour = R.chance(0.5);
  const id = armour
    ? R.pick(['a_plate', 'a_helm', 'a_greaves'])
    : R.chance(0.35)
    ? 'w_launcher'
    : R.pick(['w_staff', 'w_beam', 'w_burst', 'w_shotgun']);
  // a clean clear pays an epic; the 40s bail-out failsafe pays a lot less
  const rarity = bailed ? 'good' : 'epic';
  g.pickups.push(new Pickup('item', c.x, c.y, 0, { id, count: 1, rarity }));
  g.pickups.push(new Pickup('naquadah', c.x + 16, c.y, (bailed ? 10 : 30) * worldMods(g).naqMul));
  burst(g, c.x, c.y, 24, '#ffd27a');
  if (sfx.crit) sfx.crit();
}

function spawnVaultLoot(g, vd) {
  const ax = vd.lootX;
  const ay = vd.lootY;
  const R = rngHelpers(makeRng('vault:' + g.params.seedStr + ':' + (vd._room ? vd._room.gx + ':' + vd._room.gy : '0')));
  const threat = (g.params.threat || 0) + 3;
  const wid = R.chance(0.4) ? 'w_launcher' : R.pick(['w_staff', 'w_zat', 'w_shotgun', 'w_burst', 'w_beam']);
  g.pickups.push(new Pickup('item', ax - 14, ay, 0, { id: wid, count: 1, rarity: 'epic' })); // guaranteed rare+
  const extra = 1 + R.int(1, 2);
  for (let i = 0; i < extra; i++) {
    g.pickups.push(new Pickup('item', ax + R.range(-16, 16), ay + R.range(-10, 14), 0, rollLoot(R, threat)));
  }
  g.pickups.push(new Pickup('naquadah', ax + 12, ay - 6, 40 * worldMods(g).naqMul));
  burst(g, ax, ay, 22, '#7fe8e0');
  if (sfx.pickup) sfx.pickup();
}

function rollVendorStock(R, threat) {
  const n = 3 + R.int(0, 1);
  const pool = [
    'w_staff', 'w_zat', 'w_shotgun', 'w_burst', 'w_beam', 'w_launcher',
    'a_plate', 'a_helm', 'a_greaves', 'medkit', 'stim', 'shieldcell', 'frag',
  ];
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = R.pick(pool);
    const rarity = rollRarity(threat + 2, R.rand);
    const def = ITEMS[id];
    const base = def && def.type === 'weapon' ? 90 : def && def.type === 'armor' ? 70 : 24;
    const rmul = RARITY_MULT[normRarity(rarity)] || 1;
    out.push({ id, price: Math.round(base * rmul * (1 + threat * 0.12)), rarity });
  }
  return out;
}

function buyFromVendor(g, v, i) {
  const it = v.stock[i];
  if (!it || it.sold || g.runNaq < it.price) return;
  if (!invHasSpace(g.inv, it.id)) {
    g.message('Inventory full');
    return;
  }
  g.runNaq -= it.price;
  invAdd(g.inv, it.id, 1, it.rarity || null);
  it.sold = true;
  saveInv(g);
  if (sfx.pickup) sfx.pickup();
  g.message('Bought ' + ((ITEMS[it.id] && ITEMS[it.id].name) || it.id));
}

// runs from updatePlay each frame — allocation-free hot path.
function updateSpecials(g, dt) {
  if (!g.world || g.state === 'hub' || !g.dataCores) return;
  const p = g.player;
  const w = g.world;

  // bestiary: first time each kind goes active this run
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    if (!e.alive || e.state !== 'active') continue;
    if (g._seenKinds.has(e.kind)) continue;
    g._seenKinds.add(e.kind);
    const b = g.save.bestiary || (g.save.bestiary = {});
    const rec = b[e.kind] || (b[e.kind] = { seen: 0, killed: 0 });
    rec.seen++;
  }

  // ---- data cores ----
  for (let i = 0; i < g.dataCores.length; i++) {
    const dc = g.dataCores[i];
    if (dc.taken) continue;
    dc.bob += dt * 3;
    dc.glow = 0.5 + 0.5 * Math.sin(g.time * 4);
    if ((dc.x - p.x) ** 2 + (dc.y - p.y) ** 2 < (dc.r + p.r + 10) ** 2) {
      dc.taken = true;
      if (!g._events) g._events = [];
      g._events.push({ t: 'recover' });
      g.message('Ancient data core recovered');
      if (sfx.pickup) sfx.pickup();
      burst(g, dc.x, dc.y, 20, '#7fe8e0');
    }
  }

  // ---- vault doors ----
  for (let i = 0; i < g.vaultDoors.length; i++) {
    const vd = g.vaultDoors[i];
    if (vd.locked) {
      const rp = vd._room && vd._room.rectPx;
      if (rp && p.x >= rp.x && p.x <= rp.x + rp.w && p.y >= rp.y && p.y <= rp.y + rp.h) vd._seen = true;
      let clear = true;
      for (let k = 0; k < g.enemies.length; k++) {
        const e = g.enemies[k];
        if (e.alive && e._room === vd._room) {
          clear = false;
          break;
        }
      }
      // the seal only engages once you've actually reached the vault room — no
      // more idling elsewhere on the map to pop it on a spawn-time timer
      if (vd._seen) vd._t = (vd._t || 0) + dt;
      if (vd._seen && (clear || vd._t > 45)) {
        // failsafe: force the seal after 45s in-room so a stalled fight can't lock the vault
        vd.locked = false;
        g.message('Vault seal released');
        if (sfx.pickup) sfx.pickup();
      }
    } else if (vd.openT < 1) {
      vd.openT = Math.min(1, vd.openT + dt); // ~1s slide
      if (vd.openT >= 1 && !vd._looted) {
        vd._looted = true;
        spawnVaultLoot(g, vd);
      }
    }
  }

  // ---- arenas ----
  for (let i = 0; i < g.arenaRooms.length; i++) {
    const rm = g.arenaRooms[i];
    const a = rm._arena;
    if (!a || a.done) continue;
    const rp = rm.rectPx;
    const inside = p.x >= rp.x && p.x <= rp.x + rp.w && p.y >= rp.y && p.y <= rp.y + rp.h;
    if (!a.locked && a.wave === 0 && inside) {
      a.locked = true;
      a.wave = 1;
      hint(g, 'special', 'Some rooms are set-pieces: an arena locks you in until you survive its waves (then drops a cache), a vault has a timed seal, a vendor sells gear for naquadah. Clear-room rewards beat waiting one out.');
      a.t = 0;
      for (let k = 0; k < g.enemies.length; k++) {
        const e = g.enemies[k];
        if (e.alive && e._room === rm) {
          e.state = 'active';
          e.aggressive = true;
          e.mode = 'advance';
        }
      }
      g.message('Containment field — survive ' + a.waves + ' waves');
      if (sfx.bossSting) sfx.bossSting(g.params.faction || g.params.primary);
    }
    if (!a.locked) continue;
    if (inside) a.t += dt; // only the wave clock runs while you're actually in it
    let live = 0;
    for (let k = 0; k < g.enemies.length; k++) {
      const e = g.enemies[k];
      if (e.alive && e._room === rm) live++;
    }
    if (a.t > 40) {
      // failsafe: a real player finishes 3 waves inside 40s; the bot might not,
      // so cut it loose rather than trap the run — but the cache is downgraded,
      // no free epic for a fight that didn't actually resolve
      for (let k = 0; k < g.enemies.length; k++) {
        const e = g.enemies[k];
        if (e.alive && e._room === rm) {
          e.alive = false;
          spark(g, e.x, e.y, '#ffd27a');
        }
      }
      a.done = true;
      a.locked = false;
      spawnArenaReward(g, rm, true);
    } else if (live === 0 && a.wave < a.waves) {
      a.wave++;
      spawnArenaWave(g, rm, g.params.faction || g.params.primary, g.params.threat, a.wave, true);
      g.message('Wave ' + a.wave + ' / ' + a.waves);
    } else if (live === 0 && a.wave >= a.waves) {
      a.done = true;
      a.locked = false;
      spawnArenaReward(g, rm);
      g.message('Containment cleared');
    }
  }

  // ---- DHD siege: reinforcements until the dial is live ----
  if (g._siege && !g.dhdActive && g.curRoom === w.dhdRoom) {
    const S = g._siege;
    S.t += dt;
    if (S.t >= S.next) {
      S.t = 0;
      let live = 0;
      for (let k = 0; k < g.enemies.length; k++) if (g.enemies[k].alive && g.enemies[k]._siege) live++;
      if (live < S.cap) {
        const fac = g.params.faction || g.params.primary;
        const kindOf = fac === 'wraith' ? 'wraith' : fac === 'replicator' ? 'replicator' : 'jaffa';
        for (let n = 0; n < 2 && live + n < S.cap; n++) {
          const e = new Enemy(kindOf, S.spawn.x + rr(-24, 24), S.spawn.y + rr(-24, 24), g.params.threat, { speedMul: 1.15 });
          e._room = null; // not room-bound — can't block the DHD-room clear
          e._siege = true;
          e.aggressive = true;
          e.state = 'active';
          e.mode = 'advance';
          g.enemies.push(e);
        }
        if (sfx.wormholeOpen) sfx.wormholeOpen();
      }
    }
  } else if (g._siege && g.dhdActive) {
    g._siege = null; // dial is live — stop the tide
  }

  // ---- vendors ----
  let anyVendorNear = false;
  for (let i = 0; i < g.vendors.length; i++) {
    const v = g.vendors[i];
    if (!v.alive) continue;
    v.t += dt;
    const near = (v.x - p.x) ** 2 + (v.y - p.y) ** 2 < 60 * 60;
    if (near) anyVendorNear = true;
    if (near && !g.vendorOpen && keyHit(g, 'interact', 'KeyE')) g.vendorOpen = v;
    if (g.vendorOpen === v && !near) g.vendorOpen = null;
  }
  if (g.vendorOpen && (pressed('Escape') || !anyVendorNear)) g.vendorOpen = null;

  // ---- captive escort ----
  for (let i = 0; i < g.captives.length; i++) {
    const cap = g.captives[i];
    if (cap.hp <= 0) continue;
    if (!cap.freed) {
      let guards = 0;
      for (let k = 0; k < g.enemies.length; k++) {
        const e = g.enemies[k];
        if (e.alive && e._room === cap._room) guards++;
      }
      if (guards === 0) {
        cap.freed = true;
        cap.follow = true;
        g.message(cap.name + ' — on your six');
        hint(g, 'captive', 'Escort this operative to the gate room alive and dial out — you permanently recover their SG team as a passive bonus. They can take fire, so keep them behind you.');
        if (sfx.pickup) sfx.pickup();
      }
      continue;
    }
    cap.bob += dt * 6;
    const dx = p.x - cap.x;
    const dy = p.y - cap.y;
    const d = Math.hypot(dx, dy) || 1;
    cap.facing = Math.atan2(dy, dx);
    if (d > 44) {
      const sp = d > 220 ? 260 : 150;
      const r = circleVsGrid(w, cap, cap.x + (dx / d) * sp * dt, cap.y + (dy / d) * sp * dt);
      cap.x = r.x;
      cap.y = r.y;
    }
    for (let k = 0; k < g.bullets.length; k++) {
      const b = g.bullets[k];
      if (!b.alive || b.from !== 'enemy') continue;
      if ((b.x - cap.x) ** 2 + (b.y - cap.y) ** 2 < (cap.r + b.r + 2) ** 2) {
        cap.hp -= b.dmg;
        b.alive = false;
        if (cap.hp <= 0) {
          g.message(cap.name + ' is down');
          burst(g, cap.x, cap.y, 16, '#ff6a4a');
        }
      }
    }
    const gr = w.gateRoom;
    const grp = gr && gr.rectPx;
    cap.atGate = !!grp && cap.x >= grp.x && cap.x <= grp.x + grp.w && cap.y >= grp.y && cap.y <= grp.y + grp.h;
  }
}

// world-space draw, called from renderPlay's lit pass. keep it cheap.
function drawSpecials(ctx, g) {
  const t = g.time;
  if (!g.dataCores) return;

  for (let i = 0; i < g.dataCores.length; i++) {
    const dc = g.dataCores[i];
    if (dc.taken) continue;
    const yb = dc.y + Math.sin(dc.bob) * 3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4 + 0.25 * Math.sin(t * 4);
    ctx.fillStyle = '#7fe8e0';
    ctx.beginPath();
    ctx.moveTo(dc.x - 4, dc.y + 6);
    ctx.lineTo(dc.x + 4, dc.y + 6);
    ctx.lineTo(dc.x + 2, dc.y - 130);
    ctx.lineTo(dc.x - 2, dc.y - 130);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    glowCircle(ctx, dc.x, yb - 10, dc.r, '#7fe8e0', 16);
    ctx.fillStyle = '#08201e';
    ctx.fillRect(dc.x - 6, yb - 16, 12, 12);
    ctx.strokeStyle = '#7fe8e0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dc.x - 6, yb - 16, 12, 12);
  }

  for (let i = 0; i < g.vaultDoors.length; i++) {
    const vd = g.vaultDoors[i];
    const slide = vd.openT * (vd.h * 0.92);
    ctx.save();
    ctx.fillStyle = vd.locked ? '#3a4450' : '#252c34';
    ctx.fillRect(vd.x, vd.y - slide, vd.w, vd.h);
    ctx.strokeStyle = vd.locked ? '#ffb347' : '#7fe8e0';
    ctx.lineWidth = 2;
    ctx.strokeRect(vd.x + 1, vd.y - slide + 1, vd.w - 2, vd.h - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    for (let k = 0; k * 12 < vd.h - 8; k++) ctx.fillRect(vd.x + 3, vd.y - slide + 5 + k * 12, vd.w - 6, 3);
    ctx.restore();
    if (vd.locked) {
      ctx.fillStyle = '#ffb347';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SEALED', vd.x + vd.w / 2, vd.y - 4);
    }
  }

  for (let i = 0; i < g.vendors.length; i++) {
    const v = g.vendors[i];
    if (!v.alive) continue;
    glowCircle(ctx, v.x, v.y - 6, 15, '#ffd27a', 10);
    drawHumanoid(ctx, v.x, v.y, Math.sin(t) * 0.3, 1.05, '#6b5a3a', '#e8c46a', {});
    ctx.fillStyle = '#ffd27a';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TRADE  [E]', v.x, v.y - 24);
  }

  for (let i = 0; i < g.captives.length; i++) {
    const cap = g.captives[i];
    if (cap.hp <= 0) continue;
    drawHumanoid(ctx, cap.x, cap.y + Math.sin(cap.bob) * 1.5, cap.facing, 1.0, cap.freed ? '#8fd45a' : '#c8d6e4', '#eaf4ff', {});
    if (!cap.freed) {
      ctx.strokeStyle = 'rgba(255,150,90,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cap.x - 14, cap.y - 20, 28, 34);
    }
  }
}

function renderVendorPanel(g) {
  const v = g.vendorOpen;
  if (!v) return;
  const { ctx, view } = g;
  const rows = v.stock.length;
  const w = 384;
  const h = 40 + rows * 34 + 24;
  const x = (view.w - w) / 2;
  const y = view.h - h - 20;
  ctx.fillStyle = 'rgba(10,12,18,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,210,122,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd27a';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('BLACK MARKET', x + 14, y + 23);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8ef';
  ctx.font = '11px monospace';
  ctx.fillText(g.runNaq + ' naq', x + w - 14, y + 23);
  for (let i = 0; i < rows; i++) {
    const it = v.stock[i];
    const ry = y + 34 + i * 34;
    const def = ITEMS[it.id];
    const afford = !it.sold && g.runNaq >= it.price;
    ctx.fillStyle = it.sold ? 'rgba(28,28,32,0.7)' : afford ? 'rgba(40,52,40,0.7)' : 'rgba(34,30,30,0.7)';
    ctx.fillRect(x + 10, ry, w - 20, 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = it.sold ? '#666' : '#dbe';
    ctx.font = '11px monospace';
    ctx.fillText((it.sold ? '[SOLD] ' : '') + (def ? def.name : it.id) + '  ·  ' + (it.rarity || 'common'), x + 18, ry + 19);
    ctx.textAlign = 'right';
    ctx.fillStyle = afford ? '#8ef' : '#a66';
    ctx.fillText(String(it.price), x + w - 18, ry + 19);
    if (afford) g.buttons.push({ x: x + 10, y: ry, w: w - 20, h: 30, fn: () => buyFromVendor(g, v, i) });
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#678';
  ctx.font = '10px monospace';
  ctx.fillText('click to buy   ·   ESC / walk away to close', x + w / 2, y + h - 9);
}

function weaponItemId(inv) {
  const s = inv.equip[inv.active] || inv.equip.weapon1 || inv.equip.weapon2;
  return s ? s.id : 'w_p90';
}

function useHotbar(g, i) {
  const p = g.player;
  const s = g.inv.hotbar[i];
  if (!s) return;
  const def = ITEMS[s.id];
  if (!def || def.type !== 'consumable') return;
  if (def.use === 'heal' && p.hp >= p.maxHp) {
    g.message('Already at full HP');
    return;
  }
  const rMul = rarityMul(s);
  takeFromHot(g.inv, i);
  if (def.use === 'heal') {
    const amt = Math.round(def.amount * rMul);
    p.hp = Math.min(p.maxHp, p.hp + amt);
    g.message('+' + amt + ' HP');
  } else if (def.use === 'stim') {
    p.stimT = Math.max(p.stimT, def.dur * rMul);
    g.message('Combat stim');
  } else if (def.use === 'shield') {
    const amt = Math.round(def.amount * rMul);
    p.shieldMax = Math.max(p.shieldMax, amt);
    p.shield = Math.min(p.shieldMax, p.shield + amt);
    p.shieldRegenT = 0;
    g.message('Shield up');
  }
  if (def.use === 'heal' && (def.amount || 0) >= 40 && sfx.healBig) sfx.healBig();
  else if (sfx.heal) sfx.heal();
  else sfx.pickup();
  for (let k = 0; k < 8; k++) {
    g.particles.push(new Particle(p.x, p.y, rr(-70, 70), rr(-70, 70), 0.4, def.color, 2));
  }
  saveInv(g);
}

function throwGrenade(g) {
  const p = g.player;
  if (p._nadeCd > 0) return; // rate-limit so a held key can't flood g.grenades
  const def = takeGrenade(g.inv);
  if (!def) {
    g.message('No grenades — equip one in the grenade slot');
    return;
  }
  p._nadeCd = 0.4;
  const sp = 380;
  g.grenades.push(
    new Grenade(
      p.x + Math.cos(p.aim) * 20,
      p.y + Math.sin(p.aim) * 20,
      Math.cos(p.aim) * sp,
      Math.sin(p.aim) * sp,
      def.dmg,
      def.radius,
      'player'
    )
  );
  sfx.grenadeThrow();
  saveInv(g);
}

function explode(g, gr) {
  burst(g, gr.x, gr.y, 42, '#ff8a3c');
  addFlash(g, gr.x, gr.y, gr.radius * 3.2, '#ffb066', 0.3);
  for (let i = 0; i < 10; i++) {
    g.particles.push(new Particle(gr.x, gr.y, rr(-260, 260), rr(-260, 260), rr(0.2, 0.5), '#ffd27a', rr(2, 4)));
  }
  // white core pop over the warm bloom + a scorched blast ring
  addFlash(g, gr.x, gr.y, gr.radius * 2.4, '#ffffff', 0.08);
  scorch(g, gr.x, gr.y, gr.radius * 0.6);
  for (let i = 0; i < 5; i++) {
    const a = rr(0, TAU);
    scorch(g, gr.x + Math.cos(a) * gr.radius * 0.5, gr.y + Math.sin(a) * gr.radius * 0.5, rr(6, 12));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    scorch(g, gr.x + Math.cos(a) * gr.radius * 0.82, gr.y + Math.sin(a) * gr.radius * 0.82, rr(5, 9));
  }
  addShake(g, 18, rr(-1, 1), rr(-1, 1));
  g.hitstop = Math.max(g.hitstop, 1);
  sfx.explosion();
  for (const e of g.enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - gr.x, e.y - gr.y);
    if (d >= gr.radius) continue;
    const f = 1 - d / gr.radius;
    e.state = 'active';
    const dmg = gr.dmg * f;
    if (e.kind === 'boss' && e.shield > 0) {
      e.shield -= dmg;
      if (e.shield < 0) {
        e.hp += e.shield;
        e.shield = 0;
      }
    } else {
      e.hp -= dmg;
    }
    e.flash = 0.1;
    const kb = 260 * f;
    const l = d || 1;
    e.kx += ((e.x - gr.x) / l) * kb;
    e.ky += ((e.y - gr.y) / l) * kb;
    if (e.hp <= 0) killEnemy(g, e);
  }
  if (gr.from === 'player') alertNearby(g, gr.x, gr.y, gr.radius + 120);
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ combat
// ──────────────────────────────────────────────────────────────────────────

function startReload(g, p, wid) {
  const wp = WEAPONS[wid];
  if (!wp || wp.mag == null) return;
  p.reloadT = (wp.reload || 1.1) * (fx(g).reloadMul || 1) * (wsFor(g, wid).reloadMul || 1);
  p.reloadDur = p.reloadT;
  p.reloading = true;
  p.reloadWid = wid;
  p.burstN = 0;
  if (p.beam && p.beam.on) { sfx.beam(false); p.beam.on = false; }
  sfx.reloadStart();
}

function finishReload(g, p) {
  const wid = p.reloadWid;
  p.reloading = false;
  p.reloadT = 0;
  const wp = wid && WEAPONS[wid];
  if (!wp || wp.mag == null) return;
  const cur = p.mag[wid] || 0;
  const take = Math.max(0, Math.min(magCap(g, wid) - cur, p.ammo[wid] || 0));
  p.mag[wid] = cur + take;
  p.ammo[wid] = (p.ammo[wid] || 0) - take;
  if (take > 0) {
    if (sfx.reloadMag) sfx.reloadMag(wid);
    else sfx.reloadDone();
  }
}

function cancelReload(p) {
  p.reloading = false;
  p.reloadT = 0;
  p.reloadWid = null;
}

// continuous hitscan beam: rays out to the first wall/enemy, ticks damage,
// drains the loaded cell, and forces a recharge when the cell runs dry.
function fireBeam(g, p, wp, dt) {
  const wid = 'beam';
  if (!p.beam) p.beam = { on: false };
  const blocked = g.emp && wp.energy;
  const held = mouse.down;
  const dry = (p.mag[wid] || 0) <= 0;
  if (!held || p.reloadT > 0 || p.stun > 0 || p.dodge > 0 || blocked || dry) {
    if (p.beam.on) sfx.beam(false);
    p.beam.on = false;
    if (held && !blocked && dry && p.reloadT <= 0 && (p.ammo[wid] || 0) > 0) startReload(g, p, wid);
    return;
  }
  const dx = Math.cos(p.aim);
  const dy = Math.sin(p.aim);
  const ox = p.x + dx * 16;
  const oy = p.y + dy * 16;
  if (!p.beam.on) {
    // thin cyan spit as the emitter spins up
    sfx.beam(true);
    addFlash(g, ox, oy, MUZZLE.beam.fr, MUZZLE.beam.fc, MUZZLE.beam.fl);
    for (let i = 0; i < 2; i++) {
      const a = p.aim + rr(-0.22, 0.22);
      g.particles.push(new Particle(ox, oy, Math.cos(a) * rr(80, 220), Math.sin(a) * rr(80, 220), rr(0.08, 0.2), MUZZLE.beam.fc, rr(1.4, 2.6)));
    }
    p.kx -= dx * 40;
    p.ky -= dy * 40;
  }
  const range = wp.range || 460;
  let hx = ox + dx * range;
  let hy = oy + dy * range;
  let target = null;
  const step = 7;
  for (let d = 0; d <= range; d += step) {
    const x = ox + dx * d;
    const y = oy + dy * d;
    if (tileAt(g.world, x, y) === 1) {
      hx = x;
      hy = y;
      break;
    }
    let found = null;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const rr2 = (e.r + 5) ** 2;
      if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr2) {
        found = e;
        break;
      }
    }
    if (found) {
      target = found;
      hx = found.x;
      hy = found.y;
      break;
    }
  }
  p.beam = { on: true, x1: ox, y1: oy, x2: hx, y2: hy, color: wp.color };
  p.mag[wid] = Math.max(0, (p.mag[wid] || 0) - (wp.drain || 20) * dt);
  p.beamTick -= dt;
  if (target && p.beamTick <= 0) {
    p.beamTick = 0.09;
    const bws = wsFor(g, wid);
    hitEnemy(g, target, {
      x: hx,
      y: hy,
      vx: dx,
      vy: dy,
      dmg: (wp.dps || 40) * 0.09 * bws.damageMul * activeWeaponRarityMul(g),
      energy: true,
      knockback: 0,
      stun: 0,
      color: wp.color,
      _ap: bws.armorPierce || 0,
      _onHit: bws.onHit && bws.onHit.length ? bws.onHit : null,
    });
  }
  g.shake = Math.min(14, g.shake + 0.5);
  for (let i = 0; i < 2; i++) {
    g.particles.push(new Particle(hx, hy, rr(-90, 90), rr(-90, 90), rr(0.1, 0.24), wp.color, rr(1.5, 3)));
  }
}

// radial blast from a bullet's terminal point (grenade launcher shells)
function bulletExplode(g, b) {
  explode(g, { x: b.x, y: b.y, dmg: b.blastDmg, radius: b.blastRadius, from: b.from });
}

function activeWeaponRarityMul(g) {
  const inv = g.inv;
  const st = inv.equip[inv.active] || inv.equip.weapon1 || inv.equip.weapon2 || inv.equip.weapon3;
  return rarityMul(st);
}

// equipped-armour drag: heavier plate slows you (still worth it for the DR)
function armourWeight(inv) {
  let w = 0;
  for (const k of ['head', 'torso', 'legs', 'feet']) {
    const s = inv.equip[k];
    const dr = s && ITEMS[s.id] ? ITEMS[s.id].dr || 0 : 0;
    w += dr >= 0.4 ? 0.09 : dr >= 0.25 ? 0.04 : 0;
  }
  return w;
}

// folded mastery-level + installed-mod modifiers for a weapon key
function wsFor(g, wid) {
  const st = (g.save.weapons && g.save.weapons[wid]) || { level: 1, xp: 0, mods: [] };
  return weaponStats(wid, st, fx(g).weaponDmgMul || 1);
}
// magazine capacity after the ext_mag / drum mods
function magCap(g, wid) {
  const wp = WEAPONS[wid];
  if (!wp || wp.mag == null) return 0;
  return Math.max(1, Math.round(wp.mag * (wsFor(g, wid).magMul || 1)));
}

// per-weapon muzzle character: flash [radius, colour, life], spark count,
// backward recoil into p.kx/p.ky, camera shake, and ejected shell count.
const MUZZLE = {
  p90: { fr: 60, fc: '#fff3c8', fl: 0.05, sparks: 2, recoil: 14, shake: 1.1, shells: 1 },
  staff: { fr: 150, fc: '#ffb04a', fl: 0.1, sparks: 5, recoil: 150, shake: 5.5, shells: 0 },
  zat: { fr: 92, fc: '#7dd3fc', fl: 0.08, sparks: 4, recoil: 70, shake: 2.4, shells: 0 },
  shotgun: { fr: 116, fc: '#ffe0a0', fl: 0.09, sparks: 8, recoil: 150, shake: 5.5, shells: 3 },
  burst: { fr: 66, fc: '#e8f0ff', fl: 0.05, sparks: 2, recoil: 26, shake: 1.4, shells: 1 },
  launcher: { fr: 90, fc: '#c98a4a', fl: 0.09, sparks: 3, recoil: 150, shake: 4.5, shells: 1 },
  beam: { fr: 74, fc: '#8ff4ff', fl: 0.06, sparks: 2, recoil: 22, shake: 1, shells: 0 },
};

// ---- weapon alt-fires (right mouse, mod-unlocked) --------------------------
function altBolt(g, p, a, spd, dmg, opt) {
  g.bullets.push(
    new Bullet(p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, Math.cos(a) * spd, Math.sin(a) * spd, dmg, 'player', opt || {})
  );
}
function altFireCharge(g, p, wp, wid, chg) {
  const c = Math.max(0.15, chg || 0);
  const dmg = wp.damage * (2 + c * 5) * activeWeaponRarityMul(g);
  altBolt(g, p, p.aim, wp.speed * 1.1, dmg, { color: '#ffd27a', energy: true, r: 8, life: 2.4, knockback: 220, stun: 0.3 });
  addShake(g, 6, Math.cos(p.aim), Math.sin(p.aim));
  p.kx -= Math.cos(p.aim) * 160;
  p.ky -= Math.sin(p.aim) * 160;
  sfx.fire('staff');
  p._altCd = 3;
  if ((p.mag[wid] || 0) > 0) p.mag[wid] = Math.max(0, p.mag[wid] - 3);
}
function doAltFire(g, p, wp, wid, mode) {
  const rar = activeWeaponRarityMul(g);
  const near = (n, ex) => {
    let best = null,
      bd = 1e9;
    for (const e of g.enemies) {
      if (!e.alive || e === ex || (ex && ex._hit && ex._hit.has(e))) continue;
      const d = (e.x - (ex ? ex.x : p.x)) ** 2 + (e.y - (ex ? ex.y : p.y)) ** 2;
      if (d < bd && d < 340 * 340) {
        bd = d;
        best = e;
      }
    }
    return best;
  };
  if (mode === 'dump') {
    const n = Math.min(p.mag[wid] || 6, 8);
    for (let i = 0; i < n; i++) {
      const a = p.aim + rr(-0.5, 0.5);
      altBolt(g, p, a, wp.speed, wp.damage * rar, { color: wp.color, r: 3, life: 1 });
    }
    p.mag[wid] = 0;
    addShake(g, 4, Math.cos(p.aim), Math.sin(p.aim));
    sfx.fire('p90');
    p._altCd = 3.5;
    startReload(g, p, wid);
  } else if (mode === 'charge') {
    p._chargeT = 0;
  } else if (mode === 'chain') {
    let tgt = near();
    let dmg = wp.damage * 1.4 * rar;
    const hit = new Set();
    for (let i = 0; i < 3 && tgt; i++) {
      hitEnemy(g, tgt, { x: tgt.x, y: tgt.y, vx: 0, vy: 0, dmg, energy: true, stun: 1, color: '#7dd3fc' });
      hit.add(tgt);
      spark(g, tgt.x, tgt.y, '#7dd3fc');
      dmg *= 0.6;
      const nx = { x: tgt.x, y: tgt.y, _hit: hit };
      tgt = near(null, nx);
    }
    sfx.fire('zat');
    p._altCd = 3;
  } else if (mode === 'slug') {
    altBolt(g, p, p.aim, wp.speed * 1.3, wp.damage * (wp.pellets || 6) * 0.7 * rar, {
      color: '#ffe0a0',
      r: 6,
      life: 1.6,
      knockback: 400,
      clearShots: true,
    });
    addShake(g, 6, Math.cos(p.aim), Math.sin(p.aim));
    p.kx -= Math.cos(p.aim) * 200;
    p.ky -= Math.sin(p.aim) * 200;
    sfx.fire('shotgun');
    if ((p.mag[wid] || 0) > 0) p.mag[wid]--;
    p._altCd = 2.5;
  } else if (mode === 'single') {
    altBolt(g, p, p.aim, wp.speed * 1.6, wp.damage * 3 * rar, { color: '#e8f0ff', r: 4, life: 3, pierce: 1 });
    sfx.fire('burst');
    if ((p.mag[wid] || 0) > 0) p.mag[wid]--;
    p._altCd = 2.5;
  } else if (mode === 'airburst') {
    const d = Math.min(Math.hypot(g.mouse.wx - p.x, g.mouse.wy - p.y), 420);
    const bx = p.x + Math.cos(p.aim) * d;
    const by = p.y + Math.sin(p.aim) * d;
    explode(g, { x: bx, y: by, dmg: (wp.blastDmg || 60) * 1.2 * rar, radius: (wp.blastRadius || 90) * 1.3, from: 'player' });
    if ((p.ammo[wid] || 0) > 0) p.ammo[wid]--;
    p._altCd = 4;
  } else if (mode === 'lance') {
    // a short piercing overcharged beam sweep
    const a = p.aim;
    for (let s = 20; s < 520; s += 26) {
      const x = p.x + Math.cos(a) * s;
      const y = p.y + Math.sin(a) * s;
      for (const e of g.enemies) {
        if (e.alive && (e.x - x) ** 2 + (e.y - y) ** 2 < (e.r + 10) ** 2) {
          hitEnemy(g, e, { x, y, vx: Math.cos(a), vy: Math.sin(a), dmg: 14 * rar, energy: true, color: '#8ff4ff' });
        }
      }
      g.particles.push(new Particle(x, y, 0, 0, 0.18, '#8ff4ff', 3));
    }
    addFlash(g, p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40, 90, '#8ff4ff', 0.12);
    sfx.fire('beam');
    p._altCd = 4;
  }
}

function fireWeapon(g, p, wp, wid) {
  const muzzle = 18;
  const scatter = wp.pellets > 3;
  const ws = wsFor(g, wid);
  // ws.damageMul already folds the tech weaponDmgMul (passed as techMul)
  const dmgMul = ws.damageMul * activeWeaponRarityMul(g);
  const sprMul = ws.spreadMul || 1;
  for (let i = 0; i < wp.pellets; i++) {
    const a = p.aim + (Math.random() - 0.5) * wp.spread * sprMul;
    const b = new Bullet(
      p.x + Math.cos(a) * muzzle,
      p.y + Math.sin(a) * muzzle,
      Math.cos(a) * wp.speed * (ws.speedMul || 1),
      Math.sin(a) * wp.speed * (ws.speedMul || 1),
      wp.damage * dmgMul,
      'player',
      {
        color: wp.color,
        knockback: wp.knockback,
        energy: wp.energy,
        stun: (wp.stun || 0) * (ws.stunMul || 1),
        r: wp.blastRadius ? 6 : wp.energy ? 5 : 3,
        life: (wp.blastRadius ? 2.6 : scatter ? 0.6 : 2.2) * (ws.rangeMul || 1),
        explode: !!wp.blastRadius,
        blastDmg: wp.blastDmg || 0,
        blastRadius: wp.blastRadius || 0,
        clearShots: !!wp.clearShots,
      }
    );
    b.pierce = ws.pierce || 0;
    b.ricochet = ws.ricochet || 0;
    b._ap = ws.armorPierce || 0;
    b._falloff = wp.falloff || null; // per-weapon range damage falloff (P90)
    b._onHit = ws.onHit && ws.onHit.length ? ws.onHit : null;
    g.bullets.push(b);
  }
  const mz = MUZZLE[wid] || (wp.energy ? MUZZLE.staff : MUZZLE.p90);
  const ca = Math.cos(p.aim);
  const sa = Math.sin(p.aim);
  // prefer a muzzle point stashed by the figure rig, else the computed tip
  const mx = (p._muzzle && p._muzzle.x) || p.x + ca * muzzle;
  const my = (p._muzzle && p._muzzle.y) || p.y + sa * muzzle;
  const spread = scatter ? 0.55 : 0.32;
  for (let i = 0; i < mz.sparks; i++) {
    const a = p.aim + rr(-spread, spread);
    const s = rr(70, scatter ? 320 : 230);
    g.particles.push(new Particle(mx, my, Math.cos(a) * s, Math.sin(a) * s, rr(0.08, 0.22), i & 1 ? mz.fc : wp.color, rr(1.4, 3)));
  }
  addFlash(g, mx, my, mz.fr, mz.fc, mz.fl);
  // recoil: shove the player backward along -aim + a sharp camera kick
  p.kx -= ca * mz.recoil;
  p.ky -= sa * mz.recoil;
  addShake(g, mz.shake, ca, sa);
  for (let i = 0; i < mz.shells; i++) ejectCasing(g, p.x, p.y, p.aim);
  sfx.fire(wid || (wp.energy ? 'staff' : 'p90'));
  // dry-tail rattle on the last round of a burst
  if (wid === 'burst' && p.burstN === 1 && sfx.p90Tail) sfx.p90Tail();
}

function normAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function updateBullet(g, b, dt) {
  b.life -= dt;
  if (b.life <= 0) {
    b.alive = false;
    if (b.explode) bulletExplode(g, b);
    return;
  }
  b.trail.push({ x: b.x, y: b.y });
  if (b.trail.length > 7) b.trail.shift();
  const sub = 3;
  for (let s = 0; s < sub && b.alive; s++) {
    b.x += (b.vx * dt) / sub;
    b.y += (b.vy * dt) / sub;
    if (tileAt(g.world, b.x, b.y) === 1) {
      // ricochet mod: bounce off the wall once per charge instead of dying
      if (b.ricochet > 0 && b.from === 'player' && !b.explode) {
        b.ricochet--;
        b.x -= (b.vx * dt) / sub;
        b.y -= (b.vy * dt) / sub;
        if (tileAt(g.world, b.x + (b.vx * dt) / sub, b.y) === 1) b.vx = -b.vx;
        else b.vy = -b.vy;
        spark(g, b.x, b.y, b.color);
        continue;
      }
      b.alive = false;
      if (b.explode) bulletExplode(g, b);
      else {
        spark(g, b.x, b.y, b.color);
        if (b.from === 'enemy') scorch(g, b.x, b.y, rr(4, 7));
      }
      return;
    }
    if (b.from === 'player') {
      // enemy hitboxes are slightly generous — no phantom misses on edge hits
      for (const e of g.enemies) {
        if (!e.alive) continue;
        if (b._hit && b._hit.has(e)) continue;
        const rad = (e.kind === 'boss' || e.kind === 'nexus' ? e.r * 1.32 : e.r * 1.15) + b.r;
        if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 <= rad * rad) {
          hitEnemy(g, e, b);
          if (b.pierce > 0) {
            b.pierce--;
            (b._hit || (b._hit = new Set())).add(e);
          } else {
            b.alive = false;
            if (b.explode) bulletExplode(g, b);
            return;
          }
        }
      }
      if (g.pylons) {
        for (const py of g.pylons) {
          if (!py.alive) continue;
          const rad = py.r + b.r + 3;
          if ((b.x - py.x) ** 2 + (b.y - py.y) ** 2 <= rad * rad) {
            py.hp -= b.dmg;
            py.flash = 1;
            spark(g, b.x, b.y, '#8fe4ff');
            if (py.hp <= 0) {
              py.alive = false;
              burst(g, py.x, py.y, 22, '#8fe4ff');
              addShake(g, 8, 0, 1);
              const left = g.pylons.filter((q) => q.alive).length;
              g.message(left ? `Shield pylon down — ${left} to go` : 'NEXUS SHIELD COLLAPSES — HIT THE CORE');
            }
            if (b.pierce > 0) {
              b.pierce--;
              (b._hit || (b._hit = new Set())).add(py);
            } else {
              b.alive = false;
              if (b.explode) bulletExplode(g, b);
              return;
            }
          }
        }
      }
      for (const bl of g.blocks) {
        if (!bl.alive) continue;
        const rad = bl.r + b.r;
        if ((b.x - bl.x) ** 2 + (b.y - bl.y) ** 2 <= rad * rad) {
          bl.alive = false;
          spark(g, bl.x, bl.y, '#b6f0ff');
          b.alive = false;
          if (b.explode) bulletExplode(g, b);
          return;
        }
      }
      // shotgun pellets swat incoming enemy fire out of the air
      if (b.clearShots) {
        for (const o of g.bullets) {
          if (!o.alive || o.from !== 'enemy') continue;
          const rad = b.r + o.r + 5;
          if ((b.x - o.x) ** 2 + (b.y - o.y) ** 2 <= rad * rad) {
            o.alive = false;
            spark(g, o.x, o.y, '#ffd27a');
          }
        }
      }
    } else {
      const p = g.player;
      if (p.iframe <= 0 && p.dodge <= 0) {
        // player hurtbox is a touch tighter than the sprite
        const rad = p.r * 0.82 + b.r;
        if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 <= rad * rad) {
          damagePlayer(g, b.dmg, b.vx, b.vy);
          if (b.stun) p.stun = Math.max(p.stun, b.stun);
          b.alive = false;
          return;
        }
      }
    }
  }
}

function hitEnemy(g, e, b) {
  let dmg = b.dmg;
  const dtype = b.energy ? 'energy' : 'kinetic';

  // per-weapon range falloff (P90): full damage close, tapering to minMul far out
  if (b._falloff && b.sx != null) {
    const fo = b._falloff;
    const d = Math.hypot(b.x - b.sx, b.y - b.sy);
    if (d > fo.near) {
      const t = Math.min(1, (d - fo.near) / (fo.far - fo.near));
      dmg *= 1 + (fo.minMul - 1) * t;
    }
  }

  const ap = b._ap || 0; // armour-piercing mod: cuts into the frontal shrug-off
  // Jaffa (both) shrug off shots to the front — a real cut, not a brick wall
  if (e.kind === 'jaffa' || e.kind === 'jaffa_heavy') {
    const ang = Math.atan2(b.y - e.y, b.x - e.x);
    if (Math.abs(normAngle(ang - e.facing)) < (e.kind === 'jaffa_heavy' ? 1.0 : 0.9)) {
      const cut = (e.kind === 'jaffa_heavy' ? 0.5 : 0.55);
      dmg *= cut + (1 - cut) * ap;
      spark(g, b.x, b.y, '#8ff');
    }
  }
  // on-hit mod effects
  if (b._onHit) {
    if (b._onHit.indexOf('burn') >= 0) g.hazards.push(new Hazard(e.x, e.y, 26, 2.2, 7, 'player', 'plasma'));
    if (b._onHit.indexOf('stun') >= 0) e.stun = Math.max(e.stun || 0, 0.5);
  }

  // Replicators adapt to whatever damage type keeps hitting them
  if (e.kind === 'replicator' || e.kind === 'replicator_brute') {
    dmg *= 1 - (e.resist[dtype] || 0);
    e.resist[dtype] = Math.min(0.7, (e.resist[dtype] || 0) + 0.06);
  }

  // Replicator boss rotates which damage type it is immune to
  if (e.kind === 'boss' && e.variant === 'replicator' && e.immuneType === dtype) {
    spark(g, b.x, b.y, '#b6f0ff');
    e.flash = 0.05;
    return;
  }

  // Nexus: fully shielded while its pylons stand, and shrugs the rotating type
  if (e.kind === 'nexus' && e.shieldUp) {
    spark(g, b.x, b.y, '#8fe4ff');
    e.flash = 0.05;
    if (b.from === 'player') pushFloat(g, e.x + rr(-6, 6), e.y - e.r - 4, 'SHIELDED', '#8fe4ff', 9);
    return;
  }
  dmg *= diffMul(g, 'dealt'); // difficulty knob: story hits harder, hard hits softer
  if (e.kind === 'boss' && e.shield > 0) {
    e.shield -= dmg;
    e.shieldT = 0;
    spark(g, b.x, b.y, '#7dd3fc');
    if (e.shield < 0) {
      e.hp += e.shield;
      e.shield = 0;
    }
  } else {
    e.hp -= dmg;
  }
  // debrief tally + floating damage number (player bullets only). no crit flag
  // exists on the bullet, so a heavy connect just reads bigger + gold.
  if (b.from === 'player') {
    if (g.runStats) g.runStats.hits++;
    const d = Math.max(1, Math.round(dmg));
    // roll rapid consecutive hits on one enemy into a single running tick so a
    // busy fight doesn't stack unreadable columns of "11 11 11"
    if (e._dmgFloat && e._dmgFloat.t > 0.12) {
      const f = e._dmgFloat;
      f.sum += d;
      f.big = f.big || dmg >= 34;
      f.txt = String(f.sum);
      f.color = f.big ? '#ffd24a' : '#ffffff';
      f.size = f.big ? 15 : 11;
      f.t = 0.75;
    } else {
      const big = dmg >= 34;
      const f = pushFloat(
        g, e.x + rr(-4, 4), e.y - e.r - 4, String(d),
        big ? '#ffd24a' : dmg < 6 ? '#ff8a7a' : '#ffffff', big ? 15 : dmg < 6 ? 9 : 11
      );
      if (f) {
        f.sum = d;
        f.big = big;
        e._dmgFloat = f;
      }
    }
  }
  if (e.kind === 'wraith') e.regenT = 0;
  if (e.state === 'idle' || e.state === 'dormant') {
    const wasIdle = e.state === 'idle';
    e.state = 'active';
    e.mode = 'advance';
    if (wasIdle) alertRoom(g, e);
  }
  e.flash = 0.08;
  const bl = Math.hypot(b.vx, b.vy) || 1;
  e.kx += (b.vx / bl) * b.knockback;
  e.ky += (b.vy / bl) * b.knockback;
  if (b.stun) e.stun = Math.max(e.stun, b.stun);
  spark(g, b.x, b.y, b.color);
  // biome-tinted debris on any solid connect — a P90 chip stays quiet
  if (dmg >= 6) {
    const bi = biomeDust(g, b.x, b.y, dmg >= 20 ? 3 : 2, 95);
    if (bi.hot && dmg >= 10 && Math.random() < 0.4) scorch(g, b.x, b.y, rr(2, 4));
  }
  // only meaningful hits leave a mark on the floor — no mud from a P90 stream
  if (dmg >= 8 && Math.random() < 0.5) scorch(g, b.x, b.y, rr(2, 3.5));
  if (dmg >= 20) splat(g, b.x, b.y, factionSplatColor(e.kind), 1);

  // tactile weight on a solid connect that doesn't kill
  sfx.impact(dmg >= 24);
  if (e.hp > 0 && dmg >= 12) {
    // hit-stop scales with weight; elites soak a touch harder
    const elite = e.kind === 'boss' || e.kind === 'jaffa_heavy' || e.kind === 'replicator_brute' || e.hunter;
    const wt = dmg >= 40 ? 3 : dmg >= 24 ? 2 : dmg >= 16 ? 1 : 0;
    if (wt) g.hitstop = Math.max(g.hitstop, elite ? Math.min(3, wt + 1) : wt);
    addShake(g, dmg >= 24 ? 4 : 3, b.vx, b.vy);
    if (dmg >= 34) sfx.crit();
  }
  if (e.hp <= 0) killEnemy(g, e);
}

function damagePlayer(g, amount, vx, vy) {
  const p = g.player;
  if (p.iframe > 0 || p.dodge > 0) return;
  const region = rollHitRegion(Math.random);
  const dr = region === 'none' ? 0 : regionDR(g.inv)[region] || 0;
  let dmg = amount * (1 - dr) * diffMul(g, 'taken');
  g.lastHitRegion = region;
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    dmg -= absorbed;
    p.shieldRegenT = 0;
    if (p.shield <= 0 && sfx.shieldBreak) sfx.shieldBreak();
  }
  p.hp -= dmg;
  if (g.runStats && dmg > 0) {
    g.runStats.dmgTaken += dmg;
    g.runStats.streak = 0;
  }
  p.flash = 0.12;
  p.iframe = Math.max(p.iframe, 0.25);
  addShake(g, 5, vx, vy);
  const l = Math.hypot(vx, vy) || 1;
  p.kx += (vx / l) * 140;
  p.ky += (vy / l) * 140;
  sfx.hit();
  // a solid connect washes the floor red; a genuinely heavy one also stops the frame
  if (dmg >= 12) addFlash(g, p.x, p.y, 96, '#ff5a5a', 0.09);
  if (dmg >= 28) g.hitstop = Math.max(g.hitstop, 1);
  for (let i = 0; i < 8; i++) {
    g.particles.push(new Particle(p.x, p.y, rr(-120, 120), rr(-120, 120), 0.3, dr > 0 ? '#8cf' : '#f66', 2));
  }
  biomeDust(g, p.x, p.y, 3, 110);
}

const BOSS_NAME = { jaffa: 'Serpent Guard Prime', wraith: 'The Wraith Queen', replicator: 'Replicator Carrier' };
const BOSS_SUB = {
  jaffa: 'First Prime of the System Lord',
  wraith: 'Hive Matriarch',
  replicator: 'Assimilation Nexus',
};
const BOSS_TINT = { jaffa: '#ffb347', wraith: '#9df7a0', replicator: '#8fe4ff' };

// every real enemy death: bestiary tally, active-weapon mastery xp, and the
// campaign kill / bossKill events. Cheap; called from killEnemy.
function recordKill(g, e) {
  const threat = (g.params && g.params.threat) || 0;

  const bst = g.save.bestiary || (g.save.bestiary = {});
  const rec = bst[e.kind] || (bst[e.kind] = { seen: 0, killed: 0 });
  rec.killed++;

  try {
    const wkey = activeWeaponId(g.inv);
    const ws = g.save.weapons[wkey] || (g.save.weapons[wkey] = { level: 1, xp: 0, mods: [] });
    const xpKind =
      e.kind === 'boss' || e.kind === 'nexus'
        ? 'boss'
        : e.kind === 'jaffa_heavy' || e.kind === 'replicator_brute'
        ? 'heavy'
        : e.hunter
        ? 'elite'
        : 'grunt';
    ws.xp = (ws.xp || 0) + Math.round(xpForKill(wkey, xpKind, threat) * (fx(g).xpMul || 1));
    ws.level = Math.min(weaponMaxLevel, Math.max(ws.level || 1, levelForXp(ws.xp)));
  } catch (err) {
    /* odd save.weapons shape — skip mastery for this kill */
  }

  if (!g._events) g._events = [];
  g._events.push({ t: 'kill', kind: e.kind, faction: factionOfKind(e.kind), threat });
  if (e.kind === 'boss' || e.kind === 'nexus') {
    g._events.push({
      t: 'bossKill',
      faction: e.kind === 'nexus' ? 'nexus' : (g.params && (g.params.faction || g.params.primary)) || 'jaffa',
      threat,
      mods: (g.params && g.params.mods) || [],
    });
  }
}

function killEnemy(g, e) {
  if (!e.alive) return;

  // a fresh Replicator brute shatters into reassembly debris instead of dying
  if (e.kind === 'replicator_brute' && !e._reformed) {
    e.alive = false;
    sfx.death();
    burst(g, e.x, e.y, 20, '#b6f0ff');
    g.hitstop = Math.max(g.hitstop, 2);
    for (let i = 0; i < 5; i++) g.blocks.push(new Block(e.x + rr(-8, 8), e.y + rr(-8, 8), g.params.threat, e._room));
    g.pickups.push(new Pickup('naquadah', e.x, e.y, 5 * worldMods(g).naqMul));
    g.message('Replicator scatters — finish the pieces');
    return;
  }

  e.alive = false;
  sfx.death();
  // debrief tally: snapshot bestiary + active-weapon mastery around recordKill
  let _wk = null, _lvl0 = 0, _kill0 = 0;
  if (g.runStats) {
    _wk = activeWeaponId(g.inv);
    try { _lvl0 = (g.save.weapons[_wk] || {}).level || 1; } catch (err) { _lvl0 = 1; }
    _kill0 = (g.save.bestiary && g.save.bestiary[e.kind] && g.save.bestiary[e.kind].killed) || 0;
  }
  recordKill(g, e); // campaign events + weapon mastery xp + bestiary
  if (g.runStats) {
    const rs = g.runStats;
    rs.kills[e.kind] = (rs.kills[e.kind] || 0) + 1;
    rs.killsTotal++;
    if (e.kind === 'boss' || e.kind === 'nexus') rs.bosses++;
    rs.streak++;
    if (rs.streak > rs.bestStreak) rs.bestStreak = rs.streak;
    const th = (g.params && g.params.threat) || 0;
    if (th > rs.deepestThreat) rs.deepestThreat = th;
    if (_kill0 === 0) rs.newBestiary.push(kindLabel(e.kind));
    try {
      const lvl1 = (g.save.weapons[_wk] || {}).level || 1;
      if (lvl1 > _lvl0) {
        const wn = (ITEMS[weaponItemId(g.inv)] || {}).name || _wk;
        showUnlock(g, 'WEAPON MASTERY  L' + lvl1, wn);
        rs.special.push(wn + ' reached mastery L' + lvl1);
      }
    } catch (err) { /* odd save.weapons shape */ }
  }
  const dead = e.kind === 'boss' || e.kind === 'nexus';
  const elite = e.kind === 'jaffa_heavy' || e.kind === 'replicator_brute' || e.hunter;
  if (e.kind === 'nexus') {
    for (let i = 0; i < 5; i++) {
      const a = rr(0, TAU);
      explode(g, { x: e.x + Math.cos(a) * rr(0, 60), y: e.y + Math.sin(a) * rr(0, 60), dmg: 0, radius: 70, from: 'enemy' });
    }
    addFlash(g, e.x, e.y, 260, '#8fe4ff', 0.5);
    addShake(g, 30, 0, 1);
    g.hitstop = Math.max(g.hitstop, 14);
    g.message('THE INCURSION NEXUS IS BROKEN');
  }
  burst(g, e.x, e.y, dead ? 44 : 14, e.kind.startsWith('wraith') ? '#9df7a0' : e.kind.startsWith('replicator') || e.kind === 'nexus' ? '#b6f0ff' : '#ffb347');
  // radial kick from the corpse toward the player + biome debris fan
  addShake(g, dead ? 16 : 3, e.x - g.player.x, e.y - g.player.y);
  g.hitstop = Math.max(g.hitstop, dead ? 8 : elite ? 4 : 3);
  scorch(g, e.x, e.y, dead ? 34 : e.r + 6);
  splat(g, e.x, e.y, factionSplatColor(e.kind), dead ? 8 : 4);
  const kbi = biomeDust(g, e.x, e.y, dead ? 10 : 4, dead ? 200 : 150);
  if (kbi.hot) scorch(g, e.x + rr(-6, 6), e.y + rr(-6, 6), rr(4, 8));

  // forward pressure is rewarded — a kill tops you up a little and refunds dodge
  const pl = g.player;
  if (pl.alive) {
    const hpGain = dead ? 22 : elite ? 6 : 3;
    const room = pl.maxHp - pl.hp;
    pl.hp = Math.min(pl.maxHp, pl.hp + hpGain);
    pl.dodgeCd = Math.max(0, pl.dodgeCd - (dead ? 0.8 : 0.2));
    g.killStreak += 1;
    g.killStreakT = 2.6;
    if (elite || dead) sfx.crit();
    if (room > 0) pushFloat(g, pl.x + 10, pl.y - 18, '+' + Math.min(hpGain, room | 0 || hpGain) + 'HP', '#7ef77e', 11);
    if (dead) pushFloat(g, pl.x - 10, pl.y - 30, '+DODGE', '#7fe8ff', 11);
  }
  const mult = worldMods(g).naqMul;
  // gear drops roll a rarity tier off world threat; the boss dips into a
  // deeper table so its haul actually feels like a reward
  const dropThreat = (g.params.threat || 0) + (dead ? 3 : elite ? 1 : 0);
  const drop = (id, count, ox, oy) => {
    const st = { id, count };
    const def = ITEMS[id];
    if (def && (def.type === 'weapon' || def.type === 'armor')) st.rarity = rollRarity(dropThreat, Math.random);
    g.pickups.push(new Pickup('item', e.x + (ox || 0), e.y + (oy || 0), 0, st));
  };

  if (dead) {
    drop('w_staff', 1, -18, -6);
    drop(rollWeaponItem(), 1, -18, 12);
    drop(Math.random() < 0.5 ? 'a_plate' : 'a_helm', 1, 18, -6);
    drop('medkit', 2, 0, 16);
    drop('frag', 2, -16, 16);
    g.pickups.push(new Pickup('intel', e.x + 14, e.y + 14, 8 + Math.floor(Math.random() * 5)));
    for (let i = 0; i < 6; i++) {
      g.pickups.push(new Pickup('naquadah', e.x + rr(-40, 40), e.y + rr(-40, 40), 16 * mult));
    }
    g.message((BOSS_NAME[e.variant] || 'Boss') + ' down');
    // morale break: the commander is dead, surviving guards rout for the gate.
    // Drop their room tag so the DHD lights up immediately; they flee then despawn.
    let broke = 0;
    for (const g2 of g.enemies) {
      if (g2.alive && g2 !== e && g2._room === e._room) {
        g2._room = null;
        g2.rout = 3.5;
        g2.state = 'active';
        broke++;
      }
    }
    if (broke) g.message('The guards break and run');
  } else if (e.kind === 'jaffa' || e.kind === 'jaffa_heavy' || e.kind === 'jaffa_grenadier') {
    const heavy = e.kind === 'jaffa_heavy';
    g.pickups.push(new Pickup('naquadah', e.x, e.y, (heavy ? 12 : 6) * mult));
    if (Math.random() < 0.4) g.pickups.push(new Pickup('staff-ammo', e.x + 12, e.y, 6));
    const r = Math.random();
    if (r < (heavy ? 0.4 : 0.16)) drop(heavy ? 'a_plate' : 'bandage', 1, 0, 12);
    else if (r < 0.28) drop('frag', 1, 0, 12);
    else if (r < 0.35) drop(rollArmor(), 1, 0, 12);
    else if (r < 0.38) drop(rollWeaponItem(), 1, 0, 12);
  } else if (e.kind.startsWith('replicator')) {
    g.pickups.push(new Pickup('naquadah', e.x, e.y, (e._reformed ? 8 : 4) * mult));
    const r = Math.random();
    if (r < 0.14) drop('shieldcell', 1, 0, 10);
    else if (r < 0.22) drop('bandage', 1, 0, 10);
    else if (e._reformed && r < 0.3) drop(rollWeaponItem(), 1, 0, 10);
  } else {
    // wraith / wraith_drone
    g.pickups.push(new Pickup('naquadah', e.x, e.y, 4 * mult));
    const r = Math.random();
    if (r < 0.18) drop('bandage', 1, 0, 10);
    else if (r < 0.3) drop('stim', 1, 0, 10);
  }
}

function rollArmor() {
  const t = ['a_visor', 'a_vest', 'a_greaves', 'a_boots', 'a_helm', 'a_plate'];
  return t[Math.floor(Math.random() * t.length)];
}

function collectPickup(g, pk) {
  const p = g.player;
  if (pk.kind === 'naquadah') {
    g.runNaq += Math.round(pk.amount * fx(g).naquadahMul * worldMods(g).naqMul);
  } else if (pk.kind === 'intel') {
    const got = Math.round(pk.amount * fx(g).intelMul * worldMods(g).intelMul);
    g.runIntel += got;
    pk.alive = false;
    sfx.pickup();
    for (let i = 0; i < 6; i++) {
      g.particles.push(new Particle(pk.x, pk.y, rr(-60, 60), rr(-60, 60), 0.4, '#b6f0ff', 2));
    }
    g.message('+' + got + ' intel');
    return;
  } else if (pk.kind === 'staff-ammo') {
    p.ammo.staff = (p.ammo.staff || 0) + pk.amount;
  } else if (pk.kind === 'item' && pk.item) {
    const def = ITEMS[pk.item.id];
    if (!invHasSpace(g.inv, pk.item.id)) {
      if (!pk._warned) {
        g.message('Inventory full — ' + (def ? def.name : 'item') + ' left behind');
        pk._warned = true;
      }
      return; // leave it on the ground
    }
    const left = invAdd(g.inv, pk.item.id, pk.item.count || 1, pk.item.rarity || null);
    if (left > 0) pk.item.count = left;
    else {
      pk.alive = false;
      if (g.runStats) g.runStats.itemsFound += pk.item.count || 1;
      const rar = pk.item.rarity ? normRarity(pk.item.rarity) : 'common';
      const nm = rar !== 'common' ? rarityAffixName(pk.item.id, rar) : def ? def.name : pk.item.id;
      g.message('Picked up ' + nm + (pk.item.count > 1 ? ' ×' + pk.item.count : ''));
    }
    saveInv(g);
    for (let i = 0; i < 6; i++) {
      g.particles.push(new Particle(pk.x, pk.y, rr(-60, 60), rr(-60, 60), 0.4, def ? def.color : '#7ef', 2));
    }
    const tier = pk.item.rarity ? normRarity(pk.item.rarity) : 'common';
    if (tier !== 'common' && sfx.pickupRare) sfx.pickupRare(tier);
    else sfx.pickup();
    return;
  }
  pk.alive = false;
  sfx.pickup();
  for (let i = 0; i < 6; i++) {
    g.particles.push(new Particle(pk.x, pk.y, rr(-60, 60), rr(-60, 60), 0.4, '#7ef', 2));
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ enemy AI
// ──────────────────────────────────────────────────────────────────────────

function lineBlocked(g, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (TILE * 0.45)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (tileAt(g.world, x0 + dx * t, y0 + dy * t) === 1) return true;
  }
  return false;
}

// Enemies chase within their own room and a doorway's worth beyond it. Chase the
// player more than ~1 room away and they lose the trail: they stand down in
// place ('dormant') and only wake again if shot or if the player walks right
// into them — never from line of sight. Keeps each room's fight contained
// without the whole level conga-lining into the DHD room.
const LEASH_DIST = 380;

// the gate room is a soft threshold, not a safe zone: guards still on post
// ('idle') hold at the doorway so stepping through the gate isn't an instant
// firefight — but once an enemy is engaged ('active') it will follow the player
// anywhere, gate room included. Routing enemies flee through it freely.
function keepOutOfGateRoom(g, e) {
  const gr = g.world.gateRoom;
  if (!gr || e._room === gr || e.rout > 0 || e.state === 'active') return;
  const r = gr.rectPx;
  const m = 6;
  if (e.x < r.x - m || e.x > r.x + r.w + m || e.y < r.y - m || e.y > r.y + r.h + m) return;
  // shove back out along the nearest edge
  const dl = e.x - (r.x - m);
  const dr = r.x + r.w + m - e.x;
  const du = e.y - (r.y - m);
  const dd = r.y + r.h + m - e.y;
  const min = Math.min(dl, dr, du, dd);
  if (min === dl) e.x = r.x - m;
  else if (min === dr) e.x = r.x + r.w + m;
  else if (min === du) e.y = r.y - m;
  else e.y = r.y + r.h + m;
}

function checkLeash(g, e, dt) {
  if (!e._room || e.hunter) return false;
  const c = e._room.centerPx;
  // replicators are relentless — they'll chase a room or two beyond their nest
  const leash = e.kind && e.kind.indexOf('replicator') === 0 ? LEASH_DIST * 2.4 : LEASH_DIST;
  if (Math.hypot(e.x - c.x, e.y - c.y) < leash) return false;
  if (Math.hypot(e.x - g.player.x, e.y - g.player.y) < 130) return false; // player is right here — keep fighting
  e.state = 'dormant';
  e.mode = 'advance';
  e.cover = null;
  return true;
}

function dormantTick(g, e, dt) {
  const p = g.player;
  if (e.hp < e.maxHp || Math.hypot(p.x - e.x, p.y - e.y) < 95) {
    e.state = 'active';
    e.mode = 'advance';
    e.cool = Math.min(e.cool, 0.4);
  }
}

// wake idle allies in the same room shortly after one of them engages
function alertRoom(g, e) {
  for (const o of g.enemies) {
    if (o.alive && o !== e && o.state === 'idle' && o._room === e._room) {
      o.alertT = Math.max(o.alertT, 0.4 + Math.random() * 0.8);
    }
  }
}
function alertNearby(g, x, y, radius) {
  for (const o of g.enemies) {
    if (o.alive && o.state === 'idle' && (o.x - x) ** 2 + (o.y - y) ** 2 < radius * radius) {
      o.alertT = Math.max(o.alertT, 0.2 + Math.random() * 0.6);
    }
  }
}

// idle wander + notice checks. returns true while still idle (caller should return).
function idleTick(g, e, dt, sightRange) {
  const p = g.player;
  e.alertT = Math.max(0, e.alertT - dt);
  e.wanderT -= dt;
  if (e.wanderT <= 0) {
    e.wanderT = 1.6 + Math.random() * 2.4;
    for (let tries = 0; tries < 8; tries++) {
      const wx = e.anchorX + rr(-38, 38);
      const wy = e.anchorY + rr(-38, 38);
      if (tileAt(g.world, wx, wy) === 0) {
        e.wanderX = wx;
        e.wanderY = wy;
        break;
      }
    }
  }
  const tx = e.wanderX - e.x;
  const ty = e.wanderY - e.y;
  const td = Math.hypot(tx, ty);
  if (td > 4) {
    e.facing = Math.atan2(ty, tx);
    e.x += (tx / td) * e.speed * 0.28 * dt;
    e.y += (ty / td) * e.speed * 0.28 * dt;
  }

  if (e.calmT > 0) e.calmT -= dt;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.hypot(dx, dy);
  // a guard just sent back to its post ignores the player by sight for a beat,
  // but still reacts to being shot or to the player getting right on top of it
  let notice = e.hp < e.maxHp || (e.calmT <= 0 && (d < 110 || e.alertT > 0));
  // replicators hunt — they track prey by motion/EM, not just clean line of
  // sight, and they wake the instant you share a room with them
  const repl = e.kind && e.kind.indexOf('replicator') === 0;
  if (repl && e.calmT <= 0) {
    if (d < 240 || (e._room && e._room === g.curRoom) || d < sightRange * 0.7) notice = true;
  }
  if (!notice && e.calmT <= 0 && d < sightRange) {
    e.senseT -= dt;
    if (e.senseT <= 0) {
      e.senseT = 0.2 + Math.random() * 0.15;
      notice = !lineBlocked(g, e.x, e.y, p.x, p.y);
    }
  }
  if (notice) {
    e.state = 'active';
    e.mode = 'advance';
    e.cool = Math.min(e.cool, 0.4 + Math.random() * 0.4);
    alertRoom(g, e);
    return false;
  }
  return true;
}

function jaffaShoot(g, e, spread) {
  const p = g.player;
  const a = Math.atan2(p.y - e.y, p.x - e.x) + (Math.random() - 0.5) * (spread || 0.09);
  g.bullets.push(
    new Bullet(e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, Math.cos(a) * 330, Math.sin(a) * 330, 9, 'enemy', {
      color: '#ffc27a',
      energy: true,
      r: 4,
      knockback: 90,
      life: 2,
    })
  );
  addFlash(g, e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, 86, '#ffc27a', 0.07);
  enemyShotSound(g, e, 'jaffa');
}

// enemy weapon voice + an "incoming" tick if fired from outside your vision
function enemyShotSound(g, e, fam) {
  sfx.enemyFire(fam);
  if (g.visPoly && !litAt(g, e.x, e.y)) sfx.incoming();
}

// look for a floor tile nearby that breaks LOS to the player (a "tuck" spot) but
// has an adjacent step that re-opens it (a "peek" spot)
function findCover(g, e) {
  const p = g.player;
  const t = TILE;
  const etx = Math.floor(e.x / t);
  const ety = Math.floor(e.y / t);
  let best = null;
  let bestScore = Infinity;
  const RANGE = 5;
  for (let oy = -RANGE; oy <= RANGE; oy++) {
    for (let ox = -RANGE; ox <= RANGE; ox++) {
      const tx = etx + ox;
      const ty = ety + oy;
      if (tx < 1 || ty < 1 || tx >= g.world.W - 1 || ty >= g.world.H - 1) continue;
      if (g.world.grid[ty * g.world.W + tx] === 1) continue;
      const cx = tx * t + t / 2;
      const cy = ty * t + t / 2;
      const dToP = Math.hypot(p.x - cx, p.y - cy);
      if (dToP < 135 || dToP > 470) continue;
      if (!lineBlocked(g, cx, cy, p.x, p.y)) continue; // tuck spot must be shielded
      const nx = -(p.y - cy) / dToP;
      const ny = (p.x - cx) / dToP;
      let peekX = 0;
      let peekY = 0;
      let canPeek = false;
      for (const s of [1, -1]) {
        const qx = cx + nx * s * 27;
        const qy = cy + ny * s * 27;
        if (tileAt(g.world, qx, qy) === 1) continue;
        if (!lineBlocked(g, qx, qy, p.x, p.y)) {
          canPeek = true;
          peekX = qx;
          peekY = qy;
          break;
        }
      }
      if (!canPeek) continue;
      const walk = Math.hypot(cx - e.x, cy - e.y);
      const score = walk * 0.6 + Math.abs(dToP - 280) * 0.5 + Math.random() * 24;
      if (score < bestScore) {
        bestScore = score;
        best = { cx, cy, peekX, peekY };
      }
    }
  }
  return best;
}

function updateJaffa(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 320)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.cool -= dt;
  e.modeT -= dt;
  e.scanT -= dt;
  const losNow = !lineBlocked(g, e.x, e.y, p.x, p.y);

  // squad: a routed unit stops pushing and fights from cover
  if (e.regroup) e.aggressive = false;
  const sqFlank = e.squadRole === 'flanker' && !e.regroup && dist > 150 && dist < 460 ? e.flankDir : 0;

  // aggressive guards: press the attack, strafe in a firing band, no turtling
  if (e.aggressive) {
    const [afx, afy] = g.flow.dir(
      clamp(Math.floor(e.x / TILE), 0, g.world.W - 1),
      clamp(Math.floor(e.y / TILE), 0, g.world.H - 1)
    );
    let mx;
    let my;
    if (dist > 250) {
      mx = afx;
      my = afy;
    } else if (dist < 150) {
      mx = -dx / dist;
      my = -dy / dist;
    } else {
      mx = (-dy / dist) * 0.7 + afx * 0.3;
      my = (dx / dist) * 0.7 + afy * 0.3;
    }
    if (sqFlank) {
      mx += (-dy / dist) * sqFlank * 0.6;
      my += (dx / dist) * sqFlank * 0.6;
    }
    const ml = Math.hypot(mx, my) || 1;
    e.x += (mx / ml) * e.speed * dt;
    e.y += (my / ml) * e.speed * dt;
    if (e.cool <= 0 && losNow && dist < 400) {
      jaffaShoot(g, e, 0.11);
      e.cool = 1.3 + Math.random() * 0.7;
    }
    return;
  }

  // track how long this guard has been unable to see the player
  if (losNow) e.blindT = 0;
  else e.blindT = (e.blindT || 0) + dt;

  // player has closed the distance — cover is blown, fight it out in the open
  if (dist < 170) {
    e.mode = 'open';
    e.cover = null;
  } else if (e.mode === 'open' && dist > 240) {
    e.mode = 'advance';
    e.scanT = Math.min(e.scanT, 0.2);
  }

  // acquire cover from the advance state, occasionally
  if (e.mode === 'advance' && e.scanT <= 0) {
    e.scanT = 1.1 + Math.random() * 0.6;
    const c = findCover(g, e);
    if (c) {
      e.cover = c;
      e.mode = 'tuck';
      e.modeT = 0.2 + Math.random() * 0.3;
    }
  }

  // if stuck blind behind cover too long, or cover became invalid, re-advance
  if (e.cover && (e.blindT > 3 || !lineBlocked(g, e.cover.cx, e.cover.cy, p.x, p.y))) {
    e.mode = 'advance';
    e.cover = null;
    e.scanT = 0.8 + Math.random() * 0.6;
  }

  let mvx = 0;
  let mvy = 0;

  if (e.mode === 'open' || e.mode === 'advance' || !e.cover) {
    const [fx, fy] = g.flow.dir(
      clamp(Math.floor(e.x / TILE), 0, g.world.W - 1),
      clamp(Math.floor(e.y / TILE), 0, g.world.H - 1)
    );
    if (e.mode === 'open') {
      // trade shots: strafe around the player, don't run
      if (dist < 130) {
        mvx = -dx / dist + -dy / dist * 0.6;
        mvy = -dy / dist + dx / dist * 0.6;
      } else {
        mvx = (-dy / dist) * 0.9 + fx * 0.2;
        mvy = (dx / dist) * 0.9 + fy * 0.2;
      }
      if (e.cool <= 0 && losNow) {
        jaffaShoot(g, e, 0.13);
        e.cool = 1.0 + Math.random() * 0.6;
      }
    } else {
      if (dist > 400) {
        mvx = fx;
        mvy = fy;
      } else {
        mvx = fx * 0.6 + (-dy / dist) * 0.45;
        mvy = fy * 0.6 + (dx / dist) * 0.45;
      }
      if (e.cool <= 0 && losNow && dist < 470) {
        jaffaShoot(g, e, 0.12);
        e.cool = 1.7 + Math.random() * 0.9;
      }
    }
  } else if (e.mode === 'tuck') {
    const tx = e.cover.cx - e.x;
    const ty = e.cover.cy - e.y;
    const d = Math.hypot(tx, ty) || 1;
    if (d > 7) {
      mvx = tx / d;
      mvy = ty / d;
    } else if (e.modeT <= 0) {
      e.mode = 'peek';
      e.modeT = 0.7 + Math.random() * 0.5;
    }
    e.facing = Math.atan2(e.cover.peekY - e.y, e.cover.peekX - e.x);
  } else if (e.mode === 'peek') {
    const tx = e.cover.peekX - e.x;
    const ty = e.cover.peekY - e.y;
    const d = Math.hypot(tx, ty) || 1;
    if (d > 5) {
      mvx = tx / d;
      mvy = ty / d;
    }
    if (e.cool <= 0 && !lineBlocked(g, e.x, e.y, p.x, p.y)) {
      jaffaShoot(g, e, 0.08);
      e.cool = 0.8 + Math.random() * 0.4;
    }
    if (e.modeT <= 0) {
      e.mode = 'tuck';
      e.modeT = 0.5 + Math.random() * 0.5;
      if (Math.random() < 0.25) {
        // shift to a fresh nearby cover so the guard isn't perfectly predictable
        e.mode = 'advance';
        e.cover = null;
        e.scanT = 0.15;
      }
    }
  }

  // squad: flankers arc off-axis before closing; a routed unit gives ground
  if (sqFlank) {
    mvx += (-dy / dist) * sqFlank * 0.7;
    mvy += (dx / dist) * sqFlank * 0.7;
  }
  if (e.regroup && dist < 240) {
    mvx -= (dx / dist) * 0.8;
    mvy -= (dy / dist) * 0.8;
  }

  const l = Math.hypot(mvx, mvy);
  if (l > 0.01) {
    e.x += (mvx / l) * e.speed * dt;
    e.y += (mvy / l) * e.speed * dt;
  }
}

function updateWraith(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 300)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.wobble += dt * 7;
  let [fx, fy] = g.flow.dir(
    clamp(Math.floor(e.x / TILE), 0, g.world.W - 1),
    clamp(Math.floor(e.y / TILE), 0, g.world.H - 1)
  );
  if (fx === 0 && fy === 0) {
    fx = dx / dist;
    fy = dy / dist;
  }
  const wob = Math.sin(e.wobble) * 0.55;
  let mvx = fx + -fy * wob;
  let mvy = fy + fx * wob;
  // squad: flankers peel off-axis; a routed unit backs off
  if (e.squadRole === 'flanker' && !e.regroup && dist > 140) {
    mvx += (-dy / dist) * e.flankDir * 0.6;
    mvy += (dx / dist) * e.flankDir * 0.6;
  } else if (e.regroup && dist < 220) {
    mvx -= (dx / dist) * 0.7;
    mvy -= (dy / dist) * 0.7;
  }
  const l = Math.hypot(mvx, mvy) || 1;
  mvx /= l;
  mvy /= l;
  e.x += mvx * e.speed * dt;
  e.y += mvy * e.speed * dt;
  e.regenT += dt;
  if (e.regenT > 3 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + 7 * dt);
  e.cool -= dt;
  if (dist < e.r + p.r + 5 && e.cool <= 0) {
    damagePlayer(g, 12, dx, dy);
    p.stun = Math.max(p.stun, 0.14);
    e.cool = 0.85;
  }
}

function flowDir(g, e) {
  return g.flow.dir(
    clamp(Math.floor(e.x / TILE), 0, g.world.W - 1),
    clamp(Math.floor(e.y / TILE), 0, g.world.H - 1)
  );
}

// heavy shock-troop: slow, relentless, near-immune from the front, melee slam
function updateJaffaHeavy(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt * 0.5; // shrugs off stun fast
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 300)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.cool -= dt;
  const [fx, fy] = flowDir(g, e);
  e.x += (dist > 150 ? fx : dx / dist) * e.speed * dt;
  e.y += (dist > 150 ? fy : dy / dist) * e.speed * dt;
  if (dist < e.r + p.r + 8 && e.cool <= 0) {
    damagePlayer(g, 20, dx, dy);
    p.kx += (dx / dist) * 220;
    p.ky += (dy / dist) * 220;
    e.cool = 1.3;
    g.shake = Math.min(24, g.shake + 6);
  } else if (e.cool <= 0 && dist < 420 && !lineBlocked(g, e.x, e.y, p.x, p.y)) {
    jaffaShoot(g, e, 0.13);
    e.cool = 1.6 + Math.random() * 0.6;
  }
}

// fast harasser: never commits, keeps mid range, spits weak bolts
function updateWraithDrone(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 320)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.wobble += dt * 9;
  const want = 210;
  let mvx;
  let mvy;
  if (dist > want + 40) {
    mvx = dx / dist;
    mvy = dy / dist;
  } else if (dist < want - 40) {
    mvx = -dx / dist;
    mvy = -dy / dist;
  } else {
    mvx = -dy / dist;
    mvy = dx / dist;
  }
  const wob = Math.sin(e.wobble) * 0.7;
  mvx += -dy / dist * wob * 0.4;
  mvy += dx / dist * wob * 0.4;
  const l = Math.hypot(mvx, mvy) || 1;
  e.x += (mvx / l) * e.speed * dt;
  e.y += (mvy / l) * e.speed * dt;
  e.cool -= dt;
  if (e.cool <= 0 && dist < 430 && !lineBlocked(g, e.x, e.y, p.x, p.y)) {
    const a = e.facing + (Math.random() - 0.5) * 0.16;
    g.bullets.push(
      new Bullet(e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, Math.cos(a) * 430, Math.sin(a) * 430, 6, 'enemy', {
        color: '#b6f8bf',
        r: 3,
        knockback: 30,
        life: 1.6,
      })
    );
    e.cool = 0.7 + Math.random() * 0.5;
    enemyShotSound(g, e, 'wraith');
  }
}

// swarm unit (also drives the brute): rush, pounce and bite. regular replicators
// pounce a short dash to close the last gap; brutes telegraph a long lunging
// charge that knocks the player flying.
function updateReplicator(g, e, dt, brute) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, brute ? 620 : 700)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.wobble += dt * 12;
  e.cool -= dt;
  e.lungeCd -= dt;
  const los = !lineBlocked(g, e.x, e.y, p.x, p.y);

  // --- brute charge: windup (rooted, flashing) -> long straight lunge ---------
  if (brute) {
    if (e.windT > 0) {
      e.windT -= dt;
      if (Math.random() < 0.5) spark(g, e.x + rr(-14, 14), e.y + rr(-14, 14), '#b6f0ff');
      if (e.windT <= 0) {
        e.lungeT = 0.5;
        e.lungeDir = Math.atan2(dy, dx);
        sfx.bossWindup && sfx.bossWindup();
      }
      return;
    }
    if (e.lungeT > 0) {
      e.lungeT -= dt;
      const cx = Math.cos(e.lungeDir);
      const cy = Math.sin(e.lungeDir);
      const nn = circleVsGrid(g.world, e, e.x + cx * e.speed * 2.5 * dt, e.y + cy * e.speed * 2.5 * dt);
      if (Math.abs(nn.x - e.x) < 0.5 && Math.abs(nn.y - e.y) < 0.5) e.lungeT = 0; // hit a wall
      e.x = nn.x;
      e.y = nn.y;
      if (dist < e.r + p.r + 8 && e.cool <= 0) {
        damagePlayer(g, 24, dx, dy);
        p.kx += (dx / dist) * 340;
        p.ky += (dy / dist) * 340;
        e.cool = 1.1;
        e.lungeT = 0;
      }
      return;
    }
    if (e.lungeCd <= 0 && los && dist > 120 && dist < 380) {
      e.windT = 0.42;
      e.lungeCd = 3.4 + Math.random() * 1.6;
      return;
    }
  }

  // --- regular replicator pounce --------------------------------------------
  if (!brute) {
    if (e.lungeT > 0) e.lungeT -= dt;
    else if (e.lungeCd <= 0 && los && dist > 70 && dist < 230) {
      e.lungeT = 0.3;
      e.lungeDir = Math.atan2(dy, dx);
      e.lungeCd = 1.8 + Math.random() * 1.4;
    }
  }

  const [fx, fy] = flowDir(g, e);
  let mvx;
  let mvy;
  if (e.lungeT > 0 && !brute) {
    // committed dash straight at where the player was when it leapt
    mvx = Math.cos(e.lungeDir);
    mvy = Math.sin(e.lungeDir);
  } else {
    const jit = brute ? 0 : Math.sin(e.wobble) * 0.35;
    mvx = fx + -fy * jit;
    mvy = fy + fx * jit;
    if (fx === 0 && fy === 0) {
      mvx = dx / dist;
      mvy = dy / dist;
    }
  }
  const l = Math.hypot(mvx, mvy) || 1;
  const spd = e.speed * (e.lungeT > 0 && !brute ? 2.5 : 1);
  const nn = circleVsGrid(g.world, e, e.x + (mvx / l) * spd * dt, e.y + (mvy / l) * spd * dt);
  e.x = nn.x;
  e.y = nn.y;
  if (dist < e.r + p.r + 4 && e.cool <= 0) {
    damagePlayer(g, brute ? 14 : 7, dx, dy);
    if (brute) {
      p.kx += (dx / dist) * 150;
      p.ky += (dy / dist) * 150;
    }
    e.cool = brute ? 1.0 : 0.55;
  }
}

// displacer — lobs plasma shells that leave a lingering burn zone, forcing the
// player off whatever spot they're holding
function updateGrenadier(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 320)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.cool -= dt;
  const [ffx, ffy] = flowDir(g, e);
  const want = 280;
  let mvx;
  let mvy;
  if (dist > want + 60) {
    mvx = ffx;
    mvy = ffy;
  } else if (dist < want - 90) {
    mvx = -dx / dist;
    mvy = -dy / dist;
  } else {
    mvx = (-dy / dist) * 0.7 + ffx * 0.2;
    mvy = (dx / dist) * 0.7 + ffy * 0.2;
  }
  const ml = Math.hypot(mvx, mvy) || 1;
  e.x += (mvx / ml) * e.speed * dt;
  e.y += (mvy / ml) * e.speed * dt;
  if (e.cool <= 0 && dist > 90 && dist < 470 && !lineBlocked(g, e.x, e.y, p.x, p.y)) {
    const nx = dx / dist;
    const ny = dy / dist;
    const gr = new Grenade(e.x + nx * 20, e.y + ny * 20, nx * 330, ny * 330, 12, 78, 'enemy');
    gr.fuse = 0.9;
    gr.hazard = 46; // radius of the plasma pool it leaves
    g.grenades.push(gr);
    e.cool = 2.5 + Math.random() * 0.8;
    enemyShotSound(g, e, 'jaffa');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ new enemy kinds
// ──────────────────────────────────────────────────────────────────────────

// small fx when a stalker blinks in / out
function blinkFx(g, x, y) {
  burst(g, x, y, 9, '#9fffe0');
  addFlash(g, x, y, 70, '#7fe0c8', 0.12);
}

// covering fire toward the squad's last-known player position (no perfect LOS)
function suppressBurst(g, e) {
  const tx = e.lastSeenX || g.player.x;
  const ty = e.lastSeenY || g.player.y;
  const base = Math.atan2(ty - e.y, tx - e.x);
  const n = 2 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = base + (Math.random() - 0.5) * 0.4;
    g.bullets.push(
      new Bullet(e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, Math.cos(a) * 320, Math.sin(a) * 320, 6, 'enemy', {
        color: '#ffc27a', energy: true, r: 3, knockback: 60, life: 1.9,
      })
    );
  }
  addFlash(g, e.x + Math.cos(base) * 20, e.y + Math.sin(base) * 20, 80, '#ffc27a', 0.07);
  enemyShotSound(g, e, 'jaffa');
}

// grenadier flush lob straight at a point (used by updateSquads)
function lobGrenade(g, e, tx, ty) {
  const nx = tx - e.x;
  const ny = ty - e.y;
  const d = Math.hypot(nx, ny) || 1;
  const gr = new Grenade(e.x + (nx / d) * 20, e.y + (ny / d) * 20, (nx / d) * 330, (ny / d) * 330, 12, 78, 'enemy');
  gr.fuse = 0.9;
  gr.hazard = 46;
  g.grenades.push(gr);
  enemyShotSound(g, e, 'jaffa');
}

// fragile long-range lane-holder. anchors on holdX/holdY, charges a heavy
// telegraphed bolt, slides to a fresh hold when LOS breaks. never flanks.
function updateSniper(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 460)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.cool -= dt;
  const los = !lineBlocked(g, e.x, e.y, p.x, p.y);

  // LOS lost mid-hold: pick a fresh nearby anchor that re-opens the lane
  if (!los && e.aimT <= 0) {
    e._reHold = (e._reHold || 0) - dt;
    if (e._reHold <= 0) {
      e._reHold = 0.7;
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * TAU;
        const rad = 40 + Math.random() * 100;
        const hx = e.x + Math.cos(a) * rad;
        const hy = e.y + Math.sin(a) * rad;
        if (tileAt(g.world, hx, hy) === 0 && !lineBlocked(g, hx, hy, p.x, p.y)) {
          e.holdX = hx;
          e.holdY = hy;
          break;
        }
      }
    }
  }

  // drift back onto the anchor — barely moves, and freezes while charging
  const hx = e.holdX - e.x;
  const hy = e.holdY - e.y;
  const hd = Math.hypot(hx, hy);
  if (hd > 6) {
    const sp = e.speed * (e.aimT > 0 ? 0.12 : 0.55);
    e.x += (hx / hd) * sp * dt;
    e.y += (hy / hd) * sp * dt;
  }

  if (e.aimT > 0) {
    e.aimT -= dt;
    e.facing = Math.atan2(p.y - e.y, p.x - e.x); // track through the tell
    if (e.aimT <= 0) {
      const a = e.facing;
      g.bullets.push(
        new Bullet(e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18, Math.cos(a) * 540, Math.sin(a) * 540, 20, 'enemy', {
          color: '#ff5a3c', energy: true, r: 5, knockback: 170, life: 2.4,
        })
      );
      addFlash(g, e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18, 130, '#ff7a3c', 0.13);
      enemyShotSound(g, e, 'jaffa');
      e.cool = 1.7 + Math.random() * 0.9;
    }
    return;
  }

  if (los && e.cool <= 0 && dist > 120 && dist < 660) {
    e.aimT = e.aimDur || 1.4;
    if (sfx.incoming) sfx.incoming();
  }
}

// phase-blink flanker. while phaseT>0 it is intangible (_untarget) and slips to
// a flank; otherwise it rushes, melees, and blinks straight after the hit.
function updateStalker(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 340)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.wobble += dt * 8;
  e.cool -= dt;
  e.regenT += dt;

  if (e.phaseT > 0) {
    e.phaseT -= dt;
    e._untarget = true;
    const side = e.flankDir || (e.wobble % 2 < 1 ? 1 : -1);
    let mvx = (-dy / dist) * side * 1.1 + (dx / dist) * 0.3;
    let mvy = (dx / dist) * side * 1.1 + (dy / dist) * 0.3;
    const l = Math.hypot(mvx, mvy) || 1;
    e.x += (mvx / l) * e.speed * dt;
    e.y += (mvy / l) * e.speed * dt;
    if (e.phaseT <= 0) {
      e._untarget = false;
      blinkFx(g, e.x, e.y);
    }
    return;
  }
  e._untarget = false;

  e.phaseCd -= dt;
  if (e.phaseCd <= 0 && dist > 44) {
    e.phaseT = e.phaseDur || 0.7;
    e.nextPhase = 4 + Math.random() * 3;
    e.phaseCd = e.nextPhase;
    blinkFx(g, e.x, e.y);
  }

  const [fx, fy] = flowDir(g, e);
  let mvx = dist > 180 ? fx : dx / dist;
  let mvy = dist > 180 ? fy : dy / dist;
  if (fx === 0 && fy === 0) {
    mvx = dx / dist;
    mvy = dy / dist;
  }
  const l = Math.hypot(mvx, mvy) || 1;
  e.x += (mvx / l) * e.speed * dt;
  e.y += (mvy / l) * e.speed * dt;

  if (dist < e.r + p.r + 6 && e.cool <= 0) {
    damagePlayer(g, 14, dx, dy);
    p.stun = Math.max(p.stun, 0.12);
    e.cool = 0.9;
    e.phaseCd = Math.min(e.phaseCd, 0.05); // blink out right after the hit
  }
}

// support replicator: keeps its distance and, on cooldown, extrudes a short
// wall of Blocks across the player's sightline. retreats while on cooldown.
function updateWeaver(g, e, dt) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, 560)) return;
  if (e.state === 'dormant') {
    dormantTick(g, e, dt);
    return;
  }
  if (checkLeash(g, e, dt)) {
    dormantTick(g, e, dt);
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  e.wobble += dt * 10;
  e.weaveCd -= dt;
  const [fx, fy] = flowDir(g, e);
  const want = 200;
  const onCd = e.weaveCd > 0;

  if (e.weaveT > 0) {
    // planted through the wind-up, then spits the wall
    e.weaveT -= dt;
    if (e.weaveT <= 0) {
      const nx = -dy / dist;
      const ny = dx / dist;
      const mx = (e.x + p.x) / 2;
      const my = (e.y + p.y) / 2;
      for (let i = -1; i <= 1; i++) {
        const bx = mx + nx * i * 140;
        const by = my + ny * i * 140;
        if (tileAt(g.world, bx, by) === 1) continue;
        const bl = new Block(bx, by, g.params.threat, e._room);
        bl.vx = 0;
        bl.vy = 0;
        bl.mergeT = 2.2 + Math.random() * 0.6; // short-lived; spaced so they never re-merge
        g.blocks.push(bl);
      }
      e.weaveCd = (e.weaveLife || 4.5) + 1.5;
      spark(g, e.x, e.y, '#9fe8ff');
    }
    return;
  }

  let mvx;
  let mvy;
  if (dist > want + 40 && !onCd) {
    mvx = fx || dx / dist;
    mvy = fy || dy / dist;
  } else if (dist < want - 40 || onCd) {
    mvx = -dx / dist;
    mvy = -dy / dist;
  } else {
    mvx = -dy / dist;
    mvy = dx / dist;
  }
  const l = Math.hypot(mvx, mvy) || 1;
  e.x += (mvx / l) * e.speed * dt;
  e.y += (mvy / l) * e.speed * dt;

  if (e.weaveCd <= 0 && dist < 460 && !lineBlocked(g, e.x, e.y, p.x, p.y)) {
    e.weaveT = 0.6;
  }
}

// ambient neutral critter. wanders until the player is close, then bolts around
// walls at full tilt. never shoots, never alerts, despawns once well clear so it
// can never gate a sector clear.
function updateScavenger(g, e, dt) {
  const p = g.player;
  e.neutral = true;
  e.state = 'idle'; // a stray hit can flip this; keep it inert
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (dist > 600) {
    e.alive = false;
    return;
  }
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  e.wobble += dt * (dist < 180 ? 18 : 6);
  if (dist < 180) {
    e.facing = Math.atan2(-dy, -dx);
    const nx = e.x - (dx / dist) * e.speed * dt;
    const ny = e.y - (dy / dist) * e.speed * dt;
    ({ x: e.x, y: e.y } = circleVsGrid(g.world, e, nx, ny));
  } else {
    e.wanderT -= dt;
    if (e.wanderT <= 0) {
      e.wanderT = 1.6 + Math.random() * 2.4;
      for (let i = 0; i < 8; i++) {
        const wx = e.anchorX + rr(-40, 40);
        const wy = e.anchorY + rr(-40, 40);
        if (tileAt(g.world, wx, wy) === 0) {
          e.wanderX = wx;
          e.wanderY = wy;
          break;
        }
      }
    }
    const tx = e.wanderX - e.x;
    const ty = e.wanderY - e.y;
    const td = Math.hypot(tx, ty);
    if (td > 4) {
      e.facing = Math.atan2(ty, tx);
      e.x += (tx / td) * e.speed * 0.3 * dt;
      e.y += (ty / td) * e.speed * 0.3 * dt;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ squad AI
// ──────────────────────────────────────────────────────────────────────────
// Rebuilt once per frame: group active, non-neutral jaffa + wraith by their
// room into squads (cap 4) and set per-enemy modifier fields the individual AI
// fns already read (squadRole / flankDir / regroup / lastSeen* / suppressT).
function updateSquads(g, dt) {
  const p = g.player;
  const map = g._squadMap || (g._squadMap = new Map());
  map.clear();
  for (const e of g.enemies) {
    if (!e.alive || e.neutral || e.hunter || e.state !== 'active' || !e._room) continue;
    const k = e.kind;
    if (k[0] !== 'j' && k[0] !== 'w') continue; // jaffa* / wraith* only
    let arr = map.get(e._room);
    if (!arr) map.set(e._room, (arr = []));
    if (arr.length < 4) {
      arr.push(e);
      e.squad = e._room;
    }
  }

  // shared "player has gone static" detector for grenade flushes
  const pmoved = Math.hypot(p.x - (g._sqPX != null ? g._sqPX : p.x), p.y - (g._sqPY != null ? g._sqPY : p.y));
  g._sqPX = p.x;
  g._sqPY = p.y;
  g._sqStuckT = pmoved < 0.7 ? (g._sqStuckT || 0) + dt : 0;
  const stuck = g._sqStuckT > 1.4;

  for (const [room, arr] of map) {
    room._sqPeak = Math.max(room._sqPeak || 0, arr.length);

    // who currently has a clean line to the player
    let seer = null;
    for (const e of arr) {
      if (!lineBlocked(g, e.x, e.y, p.x, p.y)) {
        seer = e;
        break;
      }
    }

    // contact share: broadcast the sighting, wake idlers (throttled)
    room._sqShareT = Math.max(0, (room._sqShareT || 0) - dt);
    if (seer && room._sqShareT <= 0) {
      room._sqShareT = 0.5;
      for (const e of arr) {
        e.lastSeenX = p.x;
        e.lastSeenY = p.y;
      }
      for (const o of g.enemies) {
        if (o.alive && o.state === 'idle' && o._room === room) {
          o.alertT = Math.max(o.alertT, 0.3 + Math.random() * 0.5);
        }
      }
    }

    // lone survivor of a real squad falls back and fights defensive
    if (arr.length === 1) {
      arr[0].regroup = room._sqPeak >= 2;
      if (arr[0].regroup) arr[0].squadRole = 'support';
      else arr[0].squadRole = null;
      arr[0].flankDir = 0;
      continue;
    }

    // roles: a heavy anchors, else the unit nearest the player; two flankers
    // arc round; grenadier / sniper / weaver hang back as support
    let anchor = null;
    let aBest = Infinity;
    for (const e of arr) {
      if (e.kind === 'jaffa_heavy') {
        anchor = e;
        break;
      }
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < aBest) {
        aBest = d;
        anchor = e;
      }
    }
    let flankers = 0;
    let fdir = 1;
    for (const e of arr) {
      e.regroup = false;
      if (e === anchor) {
        e.squadRole = 'anchor';
        e.flankDir = 0;
        continue;
      }
      if (e.kind === 'jaffa_grenadier' || e.kind === 'jaffa_sniper') {
        e.squadRole = 'support';
        e.flankDir = 0;
        continue;
      }
      if (flankers < 2) {
        e.squadRole = 'flanker';
        e.flankDir = fdir;
        fdir = -fdir;
        flankers++;
      } else {
        e.squadRole = 'support';
        e.flankDir = 0;
      }
    }

    // anchor lays down suppression toward the last sighting when nobody has a
    // clean shot — gated so it's covering fire, not a firehose
    anchor.suppressT = Math.max(0, (anchor.suppressT || 0) - dt);
    if (
      !seer &&
      anchor.kind[0] === 'j' &&
      anchor.suppressT <= 0 &&
      (anchor.lastSeenX || anchor.lastSeenY) &&
      !lineBlocked(g, anchor.x, anchor.y, anchor.lastSeenX, anchor.lastSeenY)
    ) {
      anchor.suppressT = 1.8 + Math.random() * 0.9;
      suppressBurst(g, anchor);
    }

    // grenade flush when the player has planted somewhere
    if (stuck && seer) {
      for (const e of arr) {
        if (e.kind === 'jaffa_grenadier' && (e._flushCd || 0) <= 0) {
          lobGrenade(g, e, p.x, p.y);
          e._flushCd = 4;
          e.cool = Math.max(e.cool, 2.4);
        }
      }
    }
    for (const e of arr) if (e._flushCd > 0) e._flushCd -= dt;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ traps
// ──────────────────────────────────────────────────────────────────────────
function updateTraps(g, dt) {
  const p = g.player;
  for (const tp of g.traps) {
    if (!tp.alive) continue;
    tp.tick += dt;
    if (tp._fx > 0) tp._fx -= dt;
    if (tp.cd > 0) {
      tp.cd -= dt;
      if (tp.cd <= 0) tp.armed = true;
      continue;
    }
    if (!tp.armed) continue;
    const fx = Math.cos(tp.dir);
    const fy = Math.sin(tp.dir);
    const dx = p.x - tp.x;
    const dy = p.y - tp.y;
    const along = dx * fx + dy * fy;
    if (along < 10 || along > tp.range) continue;
    if (Math.abs(dx * -fy + dy * fx) > tp.triggerR) continue;
    // wall between the trap and the player shields them
    let clear = true;
    for (let d = 12; d < along; d += 10) {
      if (tileAt(g.world, tp.x + fx * d, tp.y + fy * d) === 1) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    g.bullets.push(
      new Bullet(tp.x + fx * 12, tp.y + fy * 12, fx * 520, fy * 520, tp.dmg, 'enemy', {
        color: '#ffe6a0', r: 3, knockback: 70, life: tp.range / 520 + 0.3,
      })
    );
    addFlash(g, tp.x + fx * 12, tp.y + fy * 12, 64, '#ffe6a0', 0.09);
    if (sfx.enemyFire) sfx.enemyFire('jaffa');
    tp.armed = false;
    tp.cd = tp.fireCd;
    tp._fx = 0.22;
  }
}

// campaign finale. three phases. shielded + damage-immune while its pylons
// stand, so the player clears the ring first; then a straight escalation —
// aimed beam bursts, a rotating sweep beam from phase 2, replicator adds at
// phase 3. see entities.js (kind === 'nexus') for the field layout.
function nexusBeam(g, e, ang, dmg, speed) {
  g.bullets.push(
    new Bullet(e.x + Math.cos(ang) * 30, e.y + Math.sin(ang) * 30, Math.cos(ang) * speed, Math.sin(ang) * speed, dmg, 'enemy', {
      color: '#8fe4ff', energy: true, r: 7, knockback: 120, life: 2.4,
    })
  );
}
function updateNexus(g, e, dt) {
  const p = g.player;
  if (e.state === 'idle' && idleTick(g, e, dt, 420)) return;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  const live = g.pylons ? g.pylons.filter((py) => py.alive).length : 0;
  e.shieldUp = live > 0;
  e.shield = e.shieldUp ? (240 * live) / 3 : 0; // drives the boss-bar shield pip

  if (e.shieldUp) {
    // rotate the shrugged-off damage type so the player has to swap weapons
    e.immuneCycleT += dt;
    if (e.immuneCycleT > 2.6) {
      e.immuneCycleT = 0;
      e.immuneType = e.immuneType === 'kinetic' ? 'energy' : 'kinetic';
      g.message('Nexus shield rephases — ' + e.immuneType + ' fire deflects');
    }
    // hold near its spawn, turning to face the player, and lob the odd beam
    e.x += (e._room.centerPx.x - e.x) * 0.6 * dt;
    e.y += (e._room.centerPx.y - 80 - e.y) * 0.6 * dt;
    e.beamT -= dt;
    if (e.beamT <= 0) {
      e.beamT = 2.4;
      for (let i = -1; i <= 1; i++) nexusBeam(g, e, e.facing + i * 0.12, 12, 360);
      enemyShotSound(g, e, 'boss');
    }
    return;
  }

  // shield is down for good — escalate by HP fraction
  const frac = e.hp / e.maxHp;
  if (e.phase < 2 && frac < e.phaseAt[0]) {
    e.phase = 2;
    burst(g, e.x, e.y, 34, '#8fe4ff');
    addShake(g, 16, 0, 1);
    sfx.bossSting('replicator');
    g.message('THE INCURSION NEXUS — SECOND STAGE');
  }
  if (e.phase < 3 && frac < e.phaseAt[1]) {
    e.phase = 3;
    e.enraged = true;
    burst(g, e.x, e.y, 40, '#b6f0ff');
    addShake(g, 20, 0, 1);
    sfx.bossSting('replicator');
    g.message('THE INCURSION NEXUS — FINAL STAGE');
  }
  const rush = e.enraged ? 1.35 : 1;

  // rotating sweep beam (phase 2+): a line of beams that arcs across the room
  if (e.phase >= 2) {
    if (!e.sweep && (e.sweepT -= dt) <= 0) {
      e.sweep = { ang: e.facing - 0.9, t: 0 };
      g.message('Sweep beam charging');
    }
    if (e.sweep) {
      e.sweep.ang += dt * 1.5 * rush;
      e.sweep.t += dt;
      for (let s = 34; s < 460; s += 46) {
        g.particles.push(new Particle(e.x + Math.cos(e.sweep.ang) * s, e.y + Math.sin(e.sweep.ang) * s, 0, 0, 0.12, '#8fe4ff', 3));
      }
      if (Math.random() < 12 * dt) nexusBeam(g, e, e.sweep.ang, 14, 420);
      if (e.sweep.t > 1.8) {
        e.sweep = null;
        e.sweepT = e.enraged ? 4.5 : 7;
      }
    }
  }

  // phase 3: periodic replicator adds
  if (e.phase >= 3 && (e.spawnT -= dt) <= 0) {
    e.spawnT = 5;
    for (let i = 0; i < 2; i++) {
      const r = new Enemy('replicator', e.x + rr(-30, 30), e.y + rr(-30, 30), g.params.threat);
      r._room = e._room;
      r.state = 'active';
      r.mode = 'advance';
      g.enemies.push(r);
    }
    burst(g, e.x, e.y, 16, '#b6f0ff');
  }

  // close the gap, then hold at mid range and fire aimed bursts
  const [ffx, ffy] = flowDir(g, e);
  let mvx = ffx;
  let mvy = ffy;
  if (dist < 220) {
    mvx = -dx / dist;
    mvy = -dy / dist;
  }
  e.x += mvx * e.speed * rush * dt;
  e.y += mvy * e.speed * rush * dt;

  if ((e.beamT -= dt) <= 0) {
    e.beamT = (e.enraged ? 1.1 : 1.8);
    const n = e.phase >= 3 ? 5 : 3;
    for (let i = 0; i < n; i++) nexusBeam(g, e, e.facing + (i - (n - 1) / 2) * 0.14, 15, 400);
    enemyShotSound(g, e, 'boss');
  }
  if (dist < e.r + p.r + 6) damagePlayer(g, 18, dx, dy);
}

function updateBoss(g, e, dt) {
  const p = g.player;
  if (e.state === 'idle' && idleTick(g, e, dt, 360)) return;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.facing = Math.atan2(dy, dx);
  const v = e.variant;

  // replicator boss: rotate which damage type bounces off it
  if (v === 'replicator') {
    e.immuneT += dt;
    if (e.immuneT > 3) {
      e.immuneT = 0;
      e.immuneType = e.immuneType === 'kinetic' ? 'energy' : 'kinetic';
      g.message('Carrier shifts phase — ' + e.immuneType + ' fire deflects');
    }
  }
  if (!e.phase2 && (e.shield > 0 || v === 'jaffa' || v === 'replicator')) {
    e.shieldT += dt;
    const cap = v === 'replicator' ? 70 : 90;
    if (e.shieldT > 6 && e.shield < cap) e.shield = Math.min(cap, e.shield + 16 * dt);
  }

  // phase two: past 40% HP the boss enrages — faster and hits sooner, but
  // drops its shield and stops regenerating it (reckless, not tankier)
  if (!e.phase2 && e.hp < e.maxHp * 0.4) {
    e.phase2 = true;
    e.shield = 0;
    e.speed *= 1.32;
    e.attackT = Math.min(e.attackT, 0.4);
    burst(g, e.x, e.y, 30, v === 'wraith' ? '#9df7a0' : v === 'replicator' ? '#8fe4ff' : '#ffb347');
    addShake(g, 16, 0, 1);
    sfx.bossSting(v);
    g.message((BOSS_NAME[v] || 'Boss') + ' — ENRAGED');
  }

  // charge attack: a fixed telegraph (e.windup) then the dash (e.charging)
  if (e.windup > 0) {
    e.windup -= dt;
    // keep tracking the player slowly during the tell so it's dodgeable but real
    e.chargeDir += Math.atan2(Math.sin(e.facing - e.chargeDir), Math.cos(e.facing - e.chargeDir)) * Math.min(1, 3 * dt);
    if (e.windup <= 0) {
      e.charging = e.phase2 ? 0.5 : 0.42;
      addShake(g, 10, Math.cos(e.chargeDir), Math.sin(e.chargeDir));
    }
    return;
  }
  if (e.charging > 0) {
    e.charging -= dt;
    const nx = e.x + Math.cos(e.chargeDir) * 460 * dt;
    const ny = e.y + Math.sin(e.chargeDir) * 460 * dt;
    // stop the dash on wall contact so the boss never tunnels out of the arena
    if (tileAt(g.world, nx, e.y) === 0) e.x = nx;
    else e.charging = 0;
    if (tileAt(g.world, e.x, ny) === 0) e.y = ny;
    else e.charging = 0;
    if (e.charging <= 0) {
      e.attackT = e.phase2 ? 1.0 : 1.5;
      e.chargeCd = e.phase2 ? 3 : 4.5; // enforce a stationary, shootable gap between charges
    }
    return;
  }

  e.attackT -= dt;
  if (e.chargeCd > 0) e.chargeCd -= dt;
  // planting to fire a volley — the boss holds still and is an easy target for
  // that window, the trade-off for its own burst
  if (e.plantT > 0) {
    e.plantT -= dt;
    return;
  }
  const [fx, fy] = flowDir(g, e);
  const closeAt = v === 'wraith' ? 90 : 240;
  let mvx = fx;
  let mvy = fy;
  if (dist < closeAt) {
    mvx = -dx / dist;
    mvy = -dy / dist;
  }
  e.x += mvx * e.speed * dt;
  e.y += mvy * e.speed * dt;

  // wraith queen: shriek in reinforcements + drain on contact
  if (v === 'wraith') {
    e.screamT -= dt;
    if (e.screamT <= 0) {
      e.screamT = 7 + Math.random() * 3;
      for (let i = 0; i < 2; i++) {
        const d = new Enemy('wraith_drone', e.x + rr(-30, 30), e.y + rr(-30, 30), g.params.threat);
        d._room = e._room;
        d.state = 'active';
        d.mode = 'advance';
        g.enemies.push(d);
      }
      burst(g, e.x, e.y, 24, '#9df7a0');
      g.message('The Queen shrieks — drones inbound');
    }
    if (dist < e.r + p.r + 6 && e.attackT <= 0) {
      damagePlayer(g, 16, dx, dy);
      e.hp = Math.min(e.maxHp, e.hp + 5);
      e.attackT = 0.9;
      return;
    }
  }

  if (e.attackT <= 0) {
    if (v !== 'wraith' && (e.chargeCd || 0) <= 0 && Math.random() < (e.phase2 ? 0.5 : 0.4) && dist < 400) {
      e.windup = e.phase2 ? 0.45 : 0.6; // visible tell before the dash
      e.chargeDir = e.facing;
      e.attackT = 1;
      e.chargeCd = e.phase2 ? 3 : 4.5;
      sfx.bossWindup();
    } else if (v === 'replicator') {
      for (let i = 0; i < 2; i++) {
        const r = new Enemy('replicator', e.x + rr(-24, 24), e.y + rr(-24, 24), g.params.threat);
        r._room = e._room;
        r.state = 'active';
        r.mode = 'advance';
        g.enemies.push(r);
      }
      e.attackT = e.phase2 ? 1.7 : 2.4;
    } else if (v === 'wraith') {
      bossVolley(g, e, v);
    } else {
      // plant and fire — the boss stops moving for a beat, wide open to fire
      e.plantT = e.phase2 ? 0.55 : 0.8;
      bossVolley(g, e, v);
    }
  }
}

function bossVolley(g, e, v) {
  const spread = v === 'wraith' ? 5 : 3;
  for (let i = 0; i < spread; i++) {
    const a = e.facing + (i - (spread - 1) / 2) * 0.16;
    g.bullets.push(
      new Bullet(e.x + Math.cos(a) * 28, e.y + Math.sin(a) * 28, Math.cos(a) * 380, Math.sin(a) * 380, 14, 'enemy', {
        color: v === 'wraith' ? '#7df0b0' : '#ff5a3c', // hot = high threat
        energy: v !== 'wraith',
        r: 7,
        knockback: 140,
        life: 2.2,
      })
    );
  }
  enemyShotSound(g, e, 'boss');
  e.attackT = (v === 'wraith' ? 1.6 : 1.3) * (e.phase2 ? 0.66 : 1);
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ camera
// ──────────────────────────────────────────────────────────────────────────

function clampCam(g) {
  const wpx = g.world.W * TILE;
  const hpx = g.world.H * TILE;
  const halfW = g.view.w / 2 / ZOOM;
  const halfH = g.view.h / 2 / ZOOM;
  // let the camera overscan the world edge so the player stays near centre at
  // the map border instead of pinned to the screen edge (the void past the
  // wall shows briefly, which reads fine)
  const ovX = halfW * 0.5;
  const ovY = halfH * 0.5;
  g.cam.x = wpx > (halfW - ovX) * 2 ? clamp(g.cam.x, halfW - ovX, wpx - halfW + ovX) : wpx / 2;
  g.cam.y = hpx > (halfH - ovY) * 2 ? clamp(g.cam.y, halfH - ovY, hpx - halfH + ovY) : hpx / 2;
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ render
// ──────────────────────────────────────────────────────────────────────────

function render(g, dt) {
  const { ctx, view } = g;
  g._fcount++;
  g._facc += dt || 0;
  if (g._facc >= 0.5) {
    g.fps = Math.round(g._fcount / g._facc);
    g._fcount = 0;
    g._facc = 0;
  }

  ctx.clearRect(0, 0, view.w, view.h);
  ctx.beginPath(); // never inherit a stray sub-path across frames
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic'; // never inherit a stray alignment across frames
  g.buttons = [];
  const cbTags = !!(g.save && g.save.settings && g.save.settings.cbPalette);
  try {
    const arrow = g.paused || g.panelOpen || g.station || g.state === 'menu' || g.state === 'gatemap' || g.state === 'dead';
    g.ctx.canvas.style.cursor = arrow ? 'default' : 'none';
  } catch (e) {
    /* headless */
  }

  if (g.state === 'menu') {
    if (g.uiStack.length && g.uiRoot === 'menu') renderUiScreen(g);
    else renderMenu(g);
  } else if (g.state === 'gatemap') {
    // dialling out of the hub (g.launching) keeps SGC behind the launch overlay;
    // the in-run DHD map dims the world instead
    if (g.launching) {
      renderHub(g);
      ctx.fillStyle = 'rgba(4,6,12,0.72)';
      ctx.fillRect(0, 0, view.w, view.h);
    } else {
      renderPlay(g, true, cbTags);
    }
    renderGateMap(g);
  } else if (g.state === 'hub') {
    renderHub(g);
    if (g.panelOpen) renderPanel(g);
    if (g.station) renderStationPanel(g);
  } else {
    renderPlay(g, false, cbTags);
    if (g.panelOpen) renderPanel(g);
    if (g.state === 'dead') renderDead(g);
  }
  drawUnlockCard(g, dt); // sliding reward card — above everything but postfx
  if (
    (g.state === 'play' || g.state === 'hub') &&
    !g.paused && !g.panelOpen && !g.station && !(g.uiStack && g.uiStack.length)
  )
    renderTips(g, dt);
  if (!g.paused && !g.panelOpen && !g.station && !g.uiStack.length && g.state !== 'gatemap') renderHint(g);
  if (g.paused) renderPause(g);

  // final grade — bloom, filmic tone, vignette, grain — on a stacked gl canvas.
  // createPostFX returns null wherever webgl isn't available; the 2d frame stands.
  // "reduce flash" also opts out of the grade (it's the biggest bloom source).
  if (g.postfx !== false && !(g.save.settings && g.save.settings.reduceFlash)) {
    if (g._fx === undefined) g._fx = createPostFX(ctx.canvas);
    if (g._fx) g._fx.draw(g.time);
  }

  applyGamma(g); // screen brightness — one composite fillRect over the finished frame

  if (window.DEBUG && g.world) {
    const dbg = document.getElementById('dbg');
    if (dbg) {
      dbg.textContent =
        `fps ${g.fps}\nstate ${g.state}\nenemies ${g.enemies.length}\nbullets ${g.bullets.length}\n` +
        `particles ${g.particles.length}\nhop ${g.hop} threat ${g.params ? g.params.threat : '-'}`;
    }
  }
}

function renderPlay(g, dim, cbTags) {
  const { ctx, view } = g;
  if (!g.world) return;
  // directional shake: kick along the hit vector + a little omni jitter.
  // clamp the render read so a stacked firefight can't turn to mush.
  const sh = (g.shake > 22 ? 22 : g.shake)
    * ((g.save && g.save.settings && g.save.settings.shake != null) ? g.save.settings.shake : 1)
    * (reduceFlash(g) ? 0.5 : 1); // accessibility: halve shake with reduceFlash
  const jit = (Math.random() - 0.5) * sh * 0.4;
  const kick = sh * (0.35 + 0.45 * Math.random());
  const shx = -(g.shakeX || 0) * kick + jit;
  const shy = -(g.shakeY || 0) * kick + (Math.random() - 0.5) * sh * 0.4;
  ctx.save();
  ctx.translate(view.w / 2 + shx, view.h / 2 + shy);
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-g.cam.x, -g.cam.y);

  // the bake is taller than the world — wall tops overhang the first row
  ctx.drawImage(g.worldCanvas, 0, -(g.worldCanvas.offsetY || 0));
  drawDecals(ctx, g, dim);
  if (g.world.dhdRoom && g.world.dhdRoom.everSeen) drawArenaFloor(ctx, g);
  for (const hz of g.hazards) drawHazard(ctx, hz, g.time);
  for (const tp of g.traps) drawTrap(ctx, tp, g.time);

  const R = worldMods(g).visionR;
  g.visPoly = dim ? null : computeVisPoly(g, R);
  g.visBox = g.visPoly ? polyBox(g.visPoly) : null;
  const lit = (x, y) => dim || litAt(g, x, y);
  drawLights(ctx, g, dim);

  if (lit(g.world.gateRoom.centerPx.x, g.world.gateRoom.centerPx.y)) {
    drawGate(ctx, g.world.gateRoom.centerPx, g.time);
  }
  if (lit(g.world.dhdRoom.centerPx.x, g.world.dhdRoom.centerPx.y)) {
    drawDHD(ctx, g.world.dhdRoom.centerPx, g.time, g.dhdActive);
  }

  // one y-sorted pass — everything that stands on the floor is painted
  // back-to-front, so a tall figure covers whatever is behind it. Flat things
  // sort on their own y; tall ones on y + a height bias.
  const sorted = [];
  for (const pk of g.pickups)
    if (lit(pk.x, pk.y)) sorted.push({ y: pk.y, k: 'pickup', o: pk });
  for (const gr of g.grenades) sorted.push({ y: gr.y, k: 'grenade', o: gr });
  for (const bl of g.blocks) if (lit(bl.x, bl.y)) sorted.push({ y: bl.y, k: 'block', o: bl });
  if (g.pylons) for (const py of g.pylons) if (py.alive && lit(py.x, py.y)) sorted.push({ y: py.y + 14, k: 'pylon', o: py });
  for (const e of g.enemies) if (lit(e.x, e.y)) sorted.push({ y: e.y + e.r * 0.6, k: 'enemy', o: e });
  sorted.push({ y: g.player.y + g.player.r * 0.6, k: 'player', o: g.player });
  sorted.sort((a, b) => a.y - b.y);
  for (const d of sorted) {
    if (d.k === 'pickup') drawPickup(ctx, d.o, (d.o.x - g.player.x) ** 2 + (d.o.y - g.player.y) ** 2 < 80 * 80);
    else if (d.k === 'grenade') drawGrenade(ctx, d.o);
    else if (d.k === 'block') drawBlock(ctx, d.o);
    else if (d.k === 'pylon') drawPylon(ctx, d.o, g.time);
    else if (d.k === 'enemy') drawEnemy(ctx, d.o, g.time, cbTags);
    else drawPlayer(ctx, d.o, g.time, g);
  }

  drawSpecials(ctx, g); // data cores / vault doors / vendor / captive

  // energy on top of the sort: bullets, beams and sparks read as light
  ctx.globalCompositeOperation = 'lighter';
  for (const pt of g.particles) {
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const b of g.bullets) drawBullet(ctx, b);
  if (g.player.beam && g.player.beam.on) drawBeam(ctx, g.player.beam, g.time);
  ctx.globalCompositeOperation = 'source-over';

  if (!dim) drawFloatText(g); // world-space damage / reward ticks

  if (g.dhdActive) {
    const c = g.world.dhdRoom.centerPx;
    const p = g.player;
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 54 * 54) {
      ctx.fillStyle = '#8ef';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PRESS  E  TO DIAL', c.x, c.y - 34);
    }
  }

  if (!dim) drawFog(ctx, g, R);
  drawWallTops(ctx, g, R, dim);

  ctx.restore();

  if (g.emp && Math.random() < 0.4) {
    ctx.fillStyle = 'rgba(120,160,255,0.06)';
    ctx.fillRect(0, 0, view.w, view.h);
  }

  if (dim) {
    ctx.fillStyle = 'rgba(4,6,12,0.72)';
    ctx.fillRect(0, 0, view.w, view.h);
  } else {
    renderHUD(g);
    drawBossBar(g);
    renderHotbar(g);
    renderMessages(g);
    if (g.vendorOpen) renderVendorPanel(g);
    if (g.bossIntroT > 0) drawBossIntro(g);
    if (!g.panelOpen) drawCrosshair(g);
  }
}

// Re-light the walls the player can actually see. A wall's front face lives
// *inside* the wall tile, just outside the visibility polygon, so the fog would
// otherwise black out exactly the surfaces that sell the height. Bands are one
// tile wide and never overlap; a band that would cover the player drops to 40%.
function drawWallTops(ctx, g, R, dim) {
  const src = g.worldCanvas && g.worldCanvas.walls;
  if (!src) return;
  const off = g.worldCanvas.offsetY || 0;
  const w = g.world;
  const p = g.player;
  const halfW = g.view.w / 2 / ZOOM + TILE * 2;
  const halfH = g.view.h / 2 / ZOOM + TILE * 2;
  const x0 = Math.max(0, Math.floor((g.cam.x - halfW) / TILE));
  const x1 = Math.min(w.W - 1, Math.ceil((g.cam.x + halfW) / TILE));
  const y0 = Math.max(0, Math.floor((g.cam.y - halfH) / TILE));
  const y1 = Math.min(w.H - 1, Math.ceil((g.cam.y + halfH) / TILE));
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= w.W || ty >= w.H || w.grid[ty * w.W + tx] === 1;
  const NB = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!solid(tx, ty)) continue;
      let sx = 0;
      let sy = 0;
      let open = false;
      for (const [ox, oy] of NB) {
        if (!solid(tx + ox, ty + oy)) {
          sx = (tx + ox + 0.5) * TILE;
          sy = (ty + oy + 0.5) * TILE;
          open = true;
          break;
        }
      }
      if (!open) continue;
      let a = 1;
      if (!dim) {
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d > R || !litAt(g, sx, sy)) continue;
        a = clamp(1 - 0.92 * clamp((d - R * 0.32) / (R * 0.7), 0, 1), 0, 1);
      }
      const face = !solid(tx, ty + 1);
      const by = ty * TILE - WALL_H;
      const bh = face ? TILE + WALL_H + 11 : TILE;
      // coarse overlap with the player's silhouette — never hide them completely
      if (Math.abs(p.x - (tx + 0.5) * TILE) < TILE / 2 + 16 && p.y - 26 < by + bh && p.y + 12 > by) {
        a *= 0.4;
      }
      ctx.globalAlpha = a;
      ctx.drawImage(src, tx * TILE, by + off, TILE, bh, tx * TILE, by, TILE, bh);
    }
  }
  ctx.globalAlpha = 1;
}

function drawGrenade(ctx, gr) {
  const pulse = 0.5 + 0.5 * Math.sin(gr.fuse * 40);
  // visual-only arc: up out of the hand, back down onto the floor as it cooks
  const z = 30 * Math.sin(Math.PI * clamp(1 - gr.fuse / 0.95, 0, 1));
  drawShadow(ctx, gr.x, gr.y, gr.r * 1.1, z);
  ctx.save();
  ctx.translate(0, -z);
  glowCircle(ctx, gr.x, gr.y, gr.r + pulse * 2, '#ff8a3c', 12);
  ctx.restore();
  // the blast ring belongs on the ground, not up with the shell
  ctx.strokeStyle = `rgba(255,180,120,${0.25 + 0.25 * pulse})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(gr.x, gr.y, gr.radius, 0, TAU);
  ctx.stroke();
}

function drawGate(ctx, c, t) {
  ctx.save();
  ctx.translate(c.x, c.y);
  const grd = ctx.createRadialGradient(0, 0, 4, 0, 0, 52);
  grd.addColorStop(0, 'rgba(150,225,255,0.55)');
  grd.addColorStop(0.7, 'rgba(60,130,220,0.26)');
  grd.addColorStop(1, 'rgba(20,40,90,0.04)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(0, 0, 50 + Math.sin(t * 2) * 2, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 16;
  ctx.shadowColor = '#6cf';
  ctx.strokeStyle = '#9cf';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, TAU);
  ctx.stroke();
  ctx.shadowBlur = 6;
  for (let i = 0; i < 9; i++) {
    const a = t * 0.15 + (i / 9) * TAU;
    ctx.fillStyle = i === 0 ? '#f83' : '#8ab';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 58, Math.sin(a) * 58, 3.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// a faint boundary ring + tinted floor wash under the DHD room so the boss
// fight reads as a named arena rather than just another room
function drawArenaFloor(ctx, g) {
  const r = g.world.dhdRoom;
  const c = r.centerPx;
  const rect = r.rectPx;
  const v = g.params.faction || g.params.primary;
  const tint = BOSS_TINT[v] || '#ffb347';
  const rad = Math.min(rect.w, rect.h) * 0.42;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x + 6, rect.y + 6, rect.w - 12, rect.h - 12);
  ctx.clip();
  const grad = ctx.createRadialGradient(c.x, c.y, rad * 0.2, c.x, c.y, rad);
  grad.addColorStop(0, hexA(tint, 0.05));
  grad.addColorStop(1, hexA(tint, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = hexA(tint, 0.22 + 0.06 * Math.sin(g.time * 2));
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 10]);
  ctx.lineDashOffset = -g.time * 12;
  ctx.beginPath();
  ctx.arc(c.x, c.y, rad, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // corner ticks
  ctx.strokeStyle = hexA(tint, 0.3);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = c.x + sx * rad * 0.96;
    const y = c.y + sy * rad * 0.96;
    ctx.beginPath();
    ctx.moveTo(x - sx * 10, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - sy * 10);
    ctx.stroke();
  }
  ctx.restore();
}

// the canonical Milky Way DHD: a squat mushroom pedestal, a sloped console face
// ringed with two rows of glyph keys, and a domed red command crystal at the
// centre. Drawn in the world's fake-3d top-down: everything is an ellipse.
function drawDHD(ctx, c, t, active) {
  ctx.save();
  ctx.translate(c.x, c.y);
  const glow = active ? '#5eefff' : '#c8532e';
  const key = active ? '#7ff0ff' : '#e08a3c';
  const keyDim = active ? 'rgba(120,220,240,0.28)' : 'rgba(150,86,44,0.4)';
  const pulse = 0.5 + 0.5 * Math.sin(t * (active ? 5 : 2));

  // ground shadow + squat pedestal stem
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(3, 7, 26, 15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a2622';
  ctx.beginPath();
  ctx.ellipse(0, 3, 15, 9, 0, 0, TAU);
  ctx.fill();

  // console slab — dark cast body with a lit rim
  const grd = ctx.createLinearGradient(0, -18, 0, 14);
  grd.addColorStop(0, '#4a4038');
  grd.addColorStop(1, '#211d1a');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(0, -3, 23, 15, 0, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = active ? 'rgba(94,239,255,0.75)' : 'rgba(120,70,44,0.7)';
  ctx.shadowBlur = active ? 14 : 5;
  ctx.shadowColor = glow;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // two rings of glyph keys on the sloped face (squashed on Y for perspective)
  for (const ring of [{ rx: 18, ry: 11, n: 13, s: 1.9 }, { rx: 11, ry: 6.6, n: 8, s: 1.6 }]) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * TAU + t * 0.05;
      const lit = (Math.floor(t * 3) % ring.n) === i;
      ctx.fillStyle = lit ? key : keyDim;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * ring.rx, Math.sin(a) * ring.ry - 2, ring.s, ring.s * 0.62, 0, 0, TAU);
      ctx.fill();
    }
  }

  // central command crystal — a red dome that lifts and brightens when live
  ctx.shadowBlur = active ? 20 : 8;
  ctx.shadowColor = active ? '#5eefff' : '#ff5a3a';
  const cg = ctx.createRadialGradient(-2, -6, 1, 0, -4, 9);
  cg.addColorStop(0, active ? '#dffbff' : '#ffb59a');
  cg.addColorStop(0.5, active ? '#5eefff' : '#ff5a3a');
  cg.addColorStop(1, active ? 'rgba(40,120,140,0.6)' : 'rgba(120,30,20,0.7)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.ellipse(0, -4, 6.5, 5.2 + pulse * 1.2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ lights
// ──────────────────────────────────────────────────────────────────────────

// one cached radial sprite per colour, composited additively onto the floor
const lightCache = new Map();
function lightSprite(color) {
  if (lightCache.has(color)) return lightCache.get(color);
  let sp = null;
  try {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 128;
    const c = cv.getContext('2d');
    const grd = c.createRadialGradient(64, 64, 0, 64, 64, 63);
    grd.addColorStop(0, hexA(color, 0.7));
    grd.addColorStop(0.35, hexA(color, 0.24));
    grd.addColorStop(1, hexA(color, 0));
    c.fillStyle = grd;
    c.fillRect(0, 0, 128, 128);
    sp = cv;
  } catch (e) {
    /* headless, or a colour hexA can't parse */
  }
  lightCache.set(color, sp);
  return sp;
}

// every emitter in the world spills coloured light on the floor it stands on,
// clipped to the visibility polygon so nothing leaks through a wall
function drawLights(ctx, g, dim) {
  ctx.save();
  const poly = g.visPoly;
  if (!dim && poly && poly.length >= 6) {
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
    ctx.closePath();
    ctx.clip();
  }
  ctx.globalCompositeOperation = 'lighter';
  const add = (x, y, r, color, a) => {
    const sp = lightSprite(color);
    if (!sp) return;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
  };
  add(g.world.gateRoom.centerPx.x, g.world.gateRoom.centerPx.y, 150, '#5aa8ff', 0.5);
  const dc = g.world.dhdRoom.centerPx;
  add(dc.x, dc.y, 96, g.dhdActive ? '#5eefff' : '#b04a4a', g.dhdActive ? 0.5 : 0.28);
  for (const hz of g.hazards) add(hz.x, hz.y, hz.r * 2.1, '#ff8a3c', 0.34 * clamp(hz.life / hz.maxLife, 0, 1));
  for (const gr of g.grenades) add(gr.x, gr.y, 62, '#ff8a3c', 0.3);
  for (const b of g.bullets) add(b.x, b.y, b.energy ? 54 : 30, b.color, b.energy ? 0.28 : 0.13);
  for (const f of g.flashes) add(f.x, f.y, f.r, f.color, 0.6 * clamp(f.t / f.max, 0, 1));
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// replicator debris: a tumbling shard of the block that made it
function drawBlock(ctx, bl) {
  drawShadow(ctx, bl.x, bl.y + 2, bl.r * 0.8, 0, 0.6);
  ctx.save();
  ctx.translate(bl.x, bl.y);
  ctx.rotate(bl.spin);
  const hot = bl.mergeT < 1;
  ctx.fillStyle = hot ? 'rgba(190,240,255,0.5)' : 'rgba(40,90,120,0.55)';
  ctx.fillRect(-bl.r, -bl.r, bl.r * 2, bl.r * 2);
  ctx.strokeStyle = hot ? '#dff6ff' : '#7fe0ff';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-bl.r, -bl.r, bl.r * 2, bl.r * 2);
  // inner cells — a block is a lattice, not a plate
  ctx.strokeStyle = hot ? 'rgba(255,255,255,0.7)' : 'rgba(140,225,255,0.45)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-bl.r, 0);
  ctx.lineTo(bl.r, 0);
  ctx.moveTo(0, -bl.r);
  ctx.lineTo(0, bl.r);
  ctx.stroke();
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#7fe0ff';
  ctx.strokeStyle = hot ? '#eaffff' : 'rgba(160,230,255,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-bl.r * 0.55, -bl.r * 0.55, bl.r * 1.1, bl.r * 1.1);
  ctx.restore();
}

// nexus shield pylon — a spinning tri-prong emitter with a hit-flash
function drawPylon(ctx, py, t) {
  drawShadow(ctx, py.x, py.y + 4, 12, 0, 0.6);
  ctx.save();
  ctx.translate(py.x, py.y);
  // base
  ctx.fillStyle = '#1b2a3a';
  ctx.strokeStyle = '#4d7fa0';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.rotate(py.phase);
  ctx.strokeStyle = py.flash > 0 ? '#ffffff' : '#8fe4ff';
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#8fe4ff';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
    ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.rotate(-py.phase);
  // core glow pulses with charge state
  const pulse = 0.5 + 0.5 * Math.sin(t * 6 + py.phase);
  ctx.fillStyle = `rgba(143,228,255,${0.4 + 0.4 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, 0, 4 + pulse * 2, 0, TAU);
  ctx.fill();
  // hp ring
  const f = Math.max(0, py.hp / py.maxHp);
  ctx.strokeStyle = '#8fe4ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + f * TAU);
  ctx.stroke();
  ctx.restore();
}

function drawBullet(ctx, b) {
  // threat tiering: player bolts read as crisp tracers, heavy enemy fire
  // carries a danger ring, boss-grade bolts burn hottest
  const mine = b.from === 'player';
  const heavy = !mine && b.dmg >= 12;
  const boss = !mine && b.dmg >= 18;
  const big = b.dmg >= 24;
  const kinetic = !b.energy;
  // rounds fly at chest height: the sprite rides up, the shadow stays down
  const z = b.z == null ? 8 : b.z;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  drawShadow(ctx, b.x, b.y, b.r * 1.1, z, mine ? 0.3 : 0.45);
  ctx.restore();
  ctx.save();
  ctx.translate(0, -z);
  ctx.lineCap = 'round';
  const t0 = b.trail[0] || b;
  // faint travel streak under the core so fast bolts leave a wake
  if (b.trail.length > 1) {
    ctx.globalAlpha = mine ? 0.16 : 0.22;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.r * (mine ? 2.2 : 3.2);
    ctx.beginPath();
    ctx.moveTo(t0.x, t0.y);
    for (const p of b.trail) ctx.lineTo(p.x, p.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // core tracer — thin + low-glow for player kinetics, fat + hot for threats
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.r * (heavy ? 1.4 : mine ? 0.9 : 1);
  ctx.shadowBlur = boss ? 20 : heavy ? 16 : big ? 14 : mine && kinetic ? 6 : 10;
  ctx.shadowColor = b.color;
  ctx.beginPath();
  ctx.moveTo(t0.x, t0.y);
  for (const p of b.trail) ctx.lineTo(p.x, p.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r * (heavy ? 0.95 : mine ? 0.62 : 0.7), 0, TAU);
  ctx.fill();
  if (boss) {
    // hot bloom around boss-grade fire
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 1.7, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (heavy) {
    // pulsing danger ring on incoming heavy fire
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(b.life * 30);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 3, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawDecals(ctx, g, dim) {
  ctx.save();
  for (const d of g.decals) {
    if (!dim && g.visPoly && !litAt(g, d.x, d.y)) continue;
    const age = g.time - d.born;
    const a = age < 0.3 ? age / 0.3 : 1;
    if (d.kind === 'casing') {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.ang);
      ctx.fillStyle = d.color;
      ctx.globalAlpha = a * 0.9;
      ctx.fillRect(-d.r, -d.r * 0.45, d.r * 2, d.r * 0.9);
      ctx.restore();
    } else if (d.kind === 'scorch') {
      ctx.fillStyle = d.color;
      ctx.globalAlpha = a * 0.55;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    } else {
      // splat — a small irregular blob
      ctx.fillStyle = d.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r, d.r * 0.7, d.ang, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawHazard(ctx, hz, t) {
  const k = hz.kind;
  if (k === 'spore' || k === 'steam' || k === 'thin-ice' || k === 'quicksand') return drawFieldHazard(ctx, hz, t);
  const f = clamp(hz.life / hz.maxLife, 0, 1);
  const wob = 1 + Math.sin(hz.phase) * 0.06;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grd = ctx.createRadialGradient(hz.x, hz.y, hz.r * 0.2, hz.x, hz.y, hz.r * wob);
  grd.addColorStop(0, `rgba(255,180,90,${0.32 * f})`);
  grd.addColorStop(0.6, `rgba(255,110,50,${0.22 * f})`);
  grd.addColorStop(1, 'rgba(255,90,40,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(hz.x, hz.y, hz.r * wob, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = `rgba(255,150,80,${0.5 * f})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hz.x, hz.y, hz.r * wob, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// per-biome field hazards: spore cloud / steam vent / thin ice / quicksand
function drawFieldHazard(ctx, hz, t) {
  const wob = 1 + Math.sin(hz.phase) * 0.05;
  const r = hz.r * wob;
  ctx.save();
  if (hz.kind === 'spore') {
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createRadialGradient(hz.x, hz.y, r * 0.15, hz.x, hz.y, r);
    grd.addColorStop(0, 'rgba(150,230,110,0.26)');
    grd.addColorStop(0.65, 'rgba(110,190,90,0.16)');
    grd.addColorStop(1, 'rgba(90,160,80,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(hz.x, hz.y, r, 0, TAU);
    ctx.fill();
  } else if (hz.kind === 'steam') {
    const a = hz.on ? 0.32 : 0.08;
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createRadialGradient(hz.x, hz.y, r * 0.1, hz.x, hz.y, r * (hz.on ? 1 : 0.5));
    grd.addColorStop(0, `rgba(235,240,245,${a})`);
    grd.addColorStop(1, 'rgba(200,210,220,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(hz.x, hz.y, r * (hz.on ? 1 : 0.5), 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hz.on ? 'rgba(255,210,150,0.5)' : 'rgba(150,160,170,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hz.x, hz.y, hz.r * 0.5, 0, TAU); // the grate
    ctx.stroke();
  } else if (hz.kind === 'thin-ice') {
    const s = clamp(hz.standT / 0.8, 0, 1);
    ctx.fillStyle = `rgba(150,220,255,${0.1 + 0.14 * s})`;
    ctx.beginPath();
    ctx.arc(hz.x, hz.y, hz.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(210,245,255,${0.4 + 0.5 * s})`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      const a = hz.phase * 0.2 + i * 1.4;
      ctx.beginPath();
      ctx.moveTo(hz.x, hz.y);
      ctx.lineTo(hz.x + Math.cos(a) * hz.r * (0.4 + 0.6 * s), hz.y + Math.sin(a) * hz.r * (0.4 + 0.6 * s));
      ctx.stroke();
    }
  } else {
    // quicksand
    ctx.fillStyle = 'rgba(120,95,55,0.4)';
    ctx.beginPath();
    ctx.arc(hz.x, hz.y, hz.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,70,45,0.55)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.r * (i / 3.5) * (1 + Math.sin(hz.phase + i) * 0.05), 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// wall-mounted dart trap: fixture + faint aim line while armed + puff on fire
function drawTrap(ctx, tp, t) {
  const fx = Math.cos(tp.dir);
  const fy = Math.sin(tp.dir);
  ctx.save();
  ctx.translate(tp.x, tp.y);
  ctx.rotate(tp.dir);
  ctx.fillStyle = '#5a5048';
  ctx.fillRect(-5, -6, 8, 12);
  ctx.fillStyle = tp.armed ? '#2a2420' : '#1a1614';
  ctx.fillRect(2, -3, 4, 6);
  ctx.restore();
  if (tp.armed && tp.cd <= 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,140,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(tp.x + fx * 8, tp.y + fy * 8);
    ctx.lineTo(tp.x + fx * tp.range, tp.y + fy * tp.range);
    ctx.stroke();
    ctx.restore();
  }
  if (tp._fx > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(tp._fx / 0.22, 0, 1);
    ctx.fillStyle = '#ffe6a0';
    ctx.beginPath();
    ctx.arc(tp.x + fx * 12, tp.y + fy * 12, 6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawBeam(ctx, bm, t) {
  const col = bm.color || '#7dd3fc';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowBlur = 16;
  ctx.shadowColor = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 4 + Math.sin((t || 0) * 40) * 0.8;
  ctx.beginPath();
  ctx.moveTo(bm.x1, bm.y1);
  ctx.lineTo(bm.x2, bm.y2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(bm.x1, bm.y1);
  ctx.lineTo(bm.x2, bm.y2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(bm.x2, bm.y2, 4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawPickup(ctx, pk, playerNear) {
  const y = pk.y + Math.sin(pk.bob) * 3;
  // the shadow stays pinned to the ground while the item bobs above it
  drawShadow(ctx, pk.x, pk.y + 3, pk.r * 0.8, 3 - Math.sin(pk.bob) * 3);

  if (pk.kind === 'item' && pk.item && ITEMS[pk.item.id]) {
    const def = ITEMS[pk.item.id];
    const rar = pk.item.rarity ? normRarity(pk.item.rarity) : rarityTierOf(pk.item.id);
    const ring = RARITY_COLOR[rar] || '#8aa0b8';
    // a light column so it reads through the fog at a distance
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createLinearGradient(pk.x, y - 40, pk.x, y + 4);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, hexA(ring, 0.22));
    ctx.fillStyle = grd;
    ctx.fillRect(pk.x - 5, y - 40, 10, 44);
    ctx.restore();
    // rarity ring + icon
    ctx.strokeStyle = ring;
    ctx.lineWidth = rar === 'common' ? 1.5 : 2.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = ring;
    ctx.beginPath();
    ctx.arc(pk.x, y, pk.r + 3, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (drawItemIcon) drawItemIcon(ctx, pk.item.id, pk.x, y, 16);
    else {
      ctx.fillStyle = def.color;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon || '?', pk.x, y);
      ctx.textBaseline = 'alphabetic';
    }
    if (playerNear) {
      ctx.fillStyle = ring;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      const nm = rar !== 'common' ? rarityAffixName(pk.item.id, rar) : def.name;
      ctx.fillText(nm + (pk.item.count > 1 ? ' ×' + pk.item.count : ''), pk.x, y - pk.r - 12);
    }
    return;
  }

  const cmap = { naquadah: '#8ef', intel: '#b6f0ff', 'staff-ammo': '#ffb347' };
  const lmap = { naquadah: 'N', intel: 'i', 'staff-ammo': 'A' };
  const c = cmap[pk.kind] || '#fff';
  glowCircle(ctx, pk.x, y, pk.r, c, 12);
  ctx.fillStyle = '#02121a';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(lmap[pk.kind] || '?', pk.x, y + 3);
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ HUD — crosshair, health/ammo, minimap, messages, boss intro
// ──────────────────────────────────────────────────────────────────────────

function drawCrosshair(g) {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = 'rgba(180,240,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mouse.x, mouse.y, 7, 0, TAU);
  ctx.moveTo(mouse.x - 12, mouse.y);
  ctx.lineTo(mouse.x - 4, mouse.y);
  ctx.moveTo(mouse.x + 4, mouse.y);
  ctx.lineTo(mouse.x + 12, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 12);
  ctx.lineTo(mouse.x, mouse.y - 4);
  ctx.moveTo(mouse.x, mouse.y + 4);
  ctx.lineTo(mouse.x, mouse.y + 12);
  ctx.stroke();
  ctx.restore();
}

function renderHUD(g) {
  const { ctx, view } = g;
  const p = g.player;
  const eff = fx(g);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const bx = 20;
  const by = view.h - 58;
  const bw = 220;
  const bh = 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(bx, by, bw, bh);
  const hpf = clamp(p.hp / p.maxHp, 0, 1);
  ctx.fillStyle = hpf > 0.5 ? '#4de08a' : hpf > 0.25 ? '#e8c14d' : '#e8564d';
  ctx.fillRect(bx, by, bw * hpf, bh);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = '#fff';
  ctx.font = '11px monospace';
  ctx.fillText(`${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`, bx + 6, by + 12);

  // overshield bar
  if (p.shieldMax > 0) {
    const sf = clamp(p.shield / p.shieldMax, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, by - 8, bw, 5);
    ctx.fillStyle = '#7dd3fc';
    ctx.fillRect(bx, by - 8, bw * sf, 5);
  }

  const wid = activeWeaponId(g.inv);
  const wp = WEAPONS[wid];
  const witem = ITEMS[weaponItemId(g.inv)];
  ctx.fillStyle = wp.color;
  ctx.font = 'bold 13px monospace';
  const wLineY = by - (p.shieldMax > 0 ? 16 : 8);
  let ammoStr;
  if (wp.ammoMax === Infinity) ammoStr = '∞';
  else if (wp.mag != null) ammoStr = `${Math.ceil(p.mag[wid] != null ? p.mag[wid] : magCap(g, wid))} / ${p.ammo[wid] || 0}`;
  else ammoStr = `${p.ammo[wid] || 0}`;
  ctx.fillText(
    `${witem ? witem.name : wp.name}  ${ammoStr}${g.inv.equip.weapon2 ? '   [Q]' : ''}`,
    bx,
    wLineY
  );
  // alt-fire ready pip — only shows once a weapon has its alt mod unlocked
  if (wsFor(g, wid).altFire) {
    const chg = p._chargeT;
    const rdy = (p._altCd || 0) <= 0;
    ctx.font = '9px monospace';
    ctx.fillStyle = chg != null ? '#ffd27a' : rdy ? '#8ff4ff' : 'rgba(143,244,255,0.3)';
    ctx.fillText(chg != null ? `ALT ${Math.round(chg * 100)}%` : rdy ? 'ALT ▸RMB' : 'ALT …', bx, wLineY + 13);
  }
  if (p.reloadT > 0 && p.reloadWid === wid) {
    const rf = clamp(1 - p.reloadT / (p.reloadDur || 1), 0, 1);
    ctx.fillStyle = '#ffd54a';
    ctx.font = '10px monospace';
    ctx.fillText('RELOADING', bx + 150, wLineY);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx + 150, wLineY + 3, 62, 4);
    ctx.fillStyle = '#ffd54a';
    ctx.fillRect(bx + 150, wLineY + 3, 62 * rf, 4);
  }

  // dodge charges — one pip per charge, dim while regenerating
  const dmax = p.dodgeMax || 1;
  for (let i = 0; i < dmax; i++) {
    const ready = i < (p.dodgeCharge || 0);
    ctx.fillStyle = ready ? '#7fe8ff' : 'rgba(120,230,255,0.2)';
    ctx.fillRect(bx + bw + 10 + i * 10, by, 7, bh);
  }
  if (dmax > 0 && (p.dodgeCharge || 0) < dmax) {
    const rf = clamp((p.dodgeRegenT || 0) / (1.15 * (eff.dodgeCdMul || 1)), 0, 1);
    ctx.fillStyle = 'rgba(127,232,255,0.5)';
    ctx.fillRect(bx + bw + 10 + Math.floor(p.dodgeCharge || 0) * 10, by + bh - 2, 7 * rf, 2);
  }
  if (p.stimT > 0) {
    ctx.fillStyle = '#ffd54a';
    ctx.font = '10px monospace';
    ctx.fillText('STIM ' + p.stimT.toFixed(1) + 's', bx + bw + 10 + dmax * 10 + 8, by + 12);
  }

  ctx.textAlign = 'right';
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#8ef';
  ctx.fillText(`NAQUADAH  ${g.runNaq}   (banked ${g.save.naquadah})`, view.w - 20, view.h - 40);
  ctx.fillStyle = '#b6f0ff';
  ctx.fillText(`INTEL  ${g.runIntel}   (banked ${g.save.intel || 0})`, view.w - 20, view.h - 22);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#9cf';
  ctx.font = '12px monospace';
  ctx.fillText(g.params.address, 20, 24);
  ctx.fillStyle = '#f9a';
  ctx.fillText(
    `SECTOR DEPTH ${g.hop}    THREAT ${g.params.threat}    ${(g.params.faction || g.params.primary).toUpperCase()}`,
    20,
    42
  );
  // heat as a real meter with a state word
  const hf = clamp(g.heat / 4, 0, 1);
  const hunted = g.hunterSpawned || g.heat >= 2;
  const hName = g.heat >= 3 ? 'SWARM' : g.heat >= 2 ? 'HUNTED' : g.heat >= 0.8 ? 'NOTICED' : 'CALM';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(20, 51, 120, 9);
  ctx.fillStyle = hunted ? `rgba(255,90,70,${0.7 + 0.3 * Math.sin(g.time * 8)})` : '#e88';
  ctx.fillRect(20, 51, 120 * hf, 9);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(20, 51, 120, 9);
  ctx.fillStyle = hunted ? '#f77' : '#fb8';
  ctx.font = '10px monospace';
  ctx.fillText('HEAT · ' + hName, 148, 60);
  if (g.params.mods.length) {
    ctx.fillStyle = '#fd6';
    ctx.font = '12px monospace';
    ctx.fillText('[ ' + modLabels(g.params.mods).join('   ') + ' ]', 20, 80);
  }
  ctx.fillStyle = '#567';
  ctx.font = '10px monospace';
  ctx.fillText('TAB  inventory & gear', 20, g.params.mods.length ? 96 : 78);

  drawMinimap(g);
}

const ITEM_FONT = '13px system-ui, sans-serif';

function drawSlot(ctx, x, y, s, stack, opts) {
  opts = opts || {};
  ctx.fillStyle = opts.bg || 'rgba(20,28,40,0.85)';
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = opts.border || 'rgba(120,160,210,0.35)';
  ctx.lineWidth = opts.hot ? 2 : 1;
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  if (opts.label) {
    ctx.fillStyle = 'rgba(150,180,220,0.35)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(opts.label, x + 3, y + 9);
  }
  if (stack && ITEMS[stack.id]) {
    // rarity tint on the slot edge — brighter/thicker the higher the tier
    const tier = stackRarity(stack);
    const rc = RARITY_COLOR[tier];
    if (rc && tier !== 'common' && !opts.hot) {
      ctx.strokeStyle = rc;
      ctx.lineWidth = tier === 'legendary' ? 2.5 : tier === 'epic' ? 2 : 1.5;
      ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
      if (tier === 'legendary' || tier === 'epic') {
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = rc;
        ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
        ctx.restore();
      }
    }
    if (drawItemIcon) {
      drawItemIcon(ctx, stack.id, x + s / 2, y + s / 2, s - 12);
    } else {
      const def = ITEMS[stack.id];
      ctx.fillStyle = def.color;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon || '?', x + s / 2, y + s / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }
    if (stack.count > 1) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(stack.count), x + s - 3, y + s - 3);
    }
  }
}

function renderHotbar(g) {
  const { ctx, view } = g;
  const s = 40;
  const gap = 6;
  const totalW = HOTBAR * s + (HOTBAR - 1) * gap;
  const x0 = view.w / 2 - totalW / 2;
  const y = view.h - s - 12;
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < HOTBAR; i++) {
    const x = x0 + i * (s + gap);
    drawSlot(ctx, x, y, s, g.inv.hotbar[i], { hot: true, label: String(i + 1) });
  }
  // grenade indicator to the right
  const gx = x0 + totalW + 14;
  drawSlot(ctx, gx, y, s, g.inv.equip.grenade, { label: 'G', border: 'rgba(255,150,90,0.5)' });
}

// shared geometry for the inventory panel — used by both render and hit-testing
// ──────────────────────────────────────────────────────────────────────────
// ▸ loadout panel — the grid, drag/drop, gear slots, stash
// ──────────────────────────────────────────────────────────────────────────

function panelLayout(g) {
  const { view } = g;
  const S = 50;
  const gap = 7;
  const gridW = GRID_COLS * S + (GRID_COLS - 1) * gap;
  const gridH = GRID_ROWS * S + (GRID_ROWS - 1) * gap;
  const panelW = 470 + gridW; // left region: doll + requisition strip + stats
  const panelH = Math.max(gridH + 190, 468);
  const px = (view.w - panelW) / 2;
  const py = (view.h - panelH) / 2;

  const cells = [];
  // equipment doll on the left
  const dollX = px + 40;
  const dollY = py + 70;
  const eq = [
    ['head', dollX + S + gap, dollY],
    ['torso', dollX + S + gap, dollY + S + gap],
    ['legs', dollX + S + gap, dollY + 2 * (S + gap)],
    ['feet', dollX + S + gap, dollY + 3 * (S + gap)],
    ['weapon1', dollX, dollY + S + gap],
    ['weapon2', dollX + 2 * (S + gap), dollY + S + gap],
    ['weapon3', dollX, dollY + 2 * (S + gap)],
    ['grenade', dollX + 2 * (S + gap), dollY + 3 * (S + gap)],
  ];
  for (const [key, x, y] of eq) cells.push({ loc: { kind: 'equip', key }, x, y, w: S, h: S });

  // hotbar row under the doll
  const hbY = dollY + 4 * (S + gap) + 24;
  for (let i = 0; i < HOTBAR; i++) {
    cells.push({ loc: { kind: 'hot', i }, x: dollX + i * (S + gap), y: hbY, w: S, h: S });
  }

  // inventory grid on the right — swaps to the between-runs STASH chest at the
  // SGC once Base Stores is built and the player toggles it
  const gx = px + panelW - gridW - 40;
  const gy = py + 70;
  const sCap = stashCap(g);
  const stashOn = g.state === 'hub' && !!g.stashView && sCap > 0;
  const rightKind = stashOn ? 'stash' : 'grid';
  const rightN = stashOn ? sCap : GRID_COLS * GRID_ROWS;
  for (let i = 0; i < rightN; i++) {
    const cx = gx + (i % GRID_COLS) * (S + gap);
    const cy = gy + Math.floor(i / GRID_COLS) * (S + gap);
    cells.push({ loc: { kind: rightKind, i }, x: cx, y: cy, w: S, h: S });
  }
  // BACKPACK <-> STASH toggle — only in the SGC, only once Base Stores is built
  const stashToggle = g.state === 'hub' && sCap > 0 ? { x: gx, y: py + 16, w: 150, h: 22 } : null;

  // requisition strip in the middle gap — draw one of each weapon unlocked in
  // Research (folded in from the old Requisitions console)
  const reqX = dollX + 3 * (S + gap) + 12;
  const reqW = gx - reqX - 14;
  const reqCells = [];
  const unlocked = (fx(g).unlockedWeapons || []).filter((id) => ITEMS[id]);
  unlocked.forEach((id, i) => {
    reqCells.push({ id, x: reqX, y: dollY + 20 + i * 46, w: reqW, h: 40 });
  });

  // scrap bar under the backpack — drag anything here to break it down for naquadah
  const scrap = { x: gx, y: gy + gridH + 10, w: gridW, h: 30 };
  cells.push({ loc: { kind: 'scrap' }, x: scrap.x, y: scrap.y, w: scrap.w, h: scrap.h });

  // uniform shrink so the whole window fits a small (mobile landscape) viewport
  const k = Math.min(1, (view.w - 12) / (panelW + 24), (view.h - 12) / (panelH + 24));

  return { px, py, panelW, panelH, S, cells, dollX, dollY, hbY, gx, gy, reqX, reqW, reqCells, scrap, stashToggle, stashOn, k };
}

function invRef(g, loc) {
  if (loc.kind === 'grid') return g.inv.grid[loc.i];
  if (loc.kind === 'hot') return g.inv.hotbar[loc.i];
  if (loc.kind === 'equip') return g.inv.equip[loc.key];
  if (loc.kind === 'stash') return (g.save.stash || [])[loc.i] || null;
  return null;
}
function invSet(g, loc, stack) {
  if (loc.kind === 'grid') g.inv.grid[loc.i] = stack;
  else if (loc.kind === 'hot') g.inv.hotbar[loc.i] = stack;
  else if (loc.kind === 'equip') g.inv.equip[loc.key] = stack;
  else if (loc.kind === 'stash') {
    if (!Array.isArray(g.save.stash)) g.save.stash = [];
    g.save.stash[loc.i] = stack || null;
    persist(g.save);
  }
}
// move/swap a held stack when the STASH chest is one end of the drag — plain
// swap, no merge; equip slots stay out of the stash path (bounce to origin)
function stashMove(g, from, to) {
  const ok = (k) => k === 'stash' || k === 'grid' || k === 'hot';
  if (!ok(from.kind) || !ok(to.kind)) return;
  const held = invRef(g, from); // panelDrop already parked the held stack here
  const dst = invRef(g, to);
  invSet(g, to, held || null);
  invSet(g, from, dst || null);
}

// naquadah returned for breaking a stack down at the SCRAP bar
const RARITY_SCRAP = { common: 1, good: 1.4, epic: 2, legendary: 3 };
function scrapValue(stack) {
  const def = ITEMS[stack.id];
  if (!def) return 1;
  let per = 4;
  if (def.type === 'weapon') per = 22;
  else if (def.type === 'armor') per = 16;
  else if (def.type === 'grenade') per = 7;
  else if (def.type === 'consumable') per = Math.max(3, Math.round((def.amount || def.dur * 4 || 12) * 0.22));
  const rMul = RARITY_SCRAP[stack.rarity] || 1;
  return Math.max(1, Math.round(per * rMul) * (stack.count || 1));
}

// screen -> natural mouse under the loadout panel's fit-scale (lay.k). uiXform
// is only live during render, so panelPick/panelDrop derive it from lay.k.
function panelPm(g, k) {
  if (!k || k >= 1) return g.pmouse;
  const { view } = g;
  return {
    x: view.w / 2 + (g.pmouse.x - view.w / 2) / k,
    y: view.h / 2 + (g.pmouse.y - view.h / 2) / k,
  };
}

function panelPick(g) {
  if (g.drag) return;
  // the panel eats the DOM `click` event (it drives drag/drop off mousedown), so
  // any button() drawn by renderPanel — the AUTO-SORT chip — has to be picked here.
  for (const b of g.buttons) {
    if (g.pmouse.x >= b.x && g.pmouse.x <= b.x + b.w && g.pmouse.y >= b.y && g.pmouse.y <= b.y + b.h) {
      b.fn();
      return;
    }
  }
  const lay = panelLayout(g);
  const pm = panelPm(g, lay.k);
  // BACKPACK <-> STASH toggle
  if (lay.stashToggle) {
    const b = lay.stashToggle;
    if (pm.x >= b.x && pm.x <= b.x + b.w && pm.y >= b.y && pm.y <= b.y + b.h) {
      g.stashView = !g.stashView;
      return;
    }
  }
  // requisition strip: click a chip to draw one of that unlocked weapon
  for (const rc of lay.reqCells) {
    if (pm.x >= rc.x && pm.x <= rc.x + rc.w && pm.y >= rc.y && pm.y <= rc.y + rc.h) {
      const left = invAdd(g.inv, rc.id, 1);
      if (left) g.message('No room in your pack');
      else {
        saveInv(g);
        g.message('Requisitioned ' + (ITEMS[rc.id] ? ITEMS[rc.id].name : rc.id));
      }
      return;
    }
  }
  for (const c of lay.cells) {
    if (
      pm.x >= c.x &&
      pm.x <= c.x + c.w &&
      pm.y >= c.y &&
      pm.y <= c.y + c.h
    ) {
      const st = invRef(g, c.loc);
      if (!st) return;
      g.drag = { from: c.loc, id: st.id, count: st.count, rarity: st.rarity };
      invSet(g, c.loc, null);
      return;
    }
  }
}

function panelDrop(g) {
  const d = g.drag;
  g.drag = null;
  if (!d) return;
  const lay = panelLayout(g);
  const pm = panelPm(g, lay.k);
  let target = null;
  for (const c of lay.cells) {
    if (
      pm.x >= c.x &&
      pm.x <= c.x + c.w &&
      pm.y >= c.y &&
      pm.y <= c.y + c.h
    ) {
      target = c.loc;
      break;
    }
  }
  // scrap: break the held stack down for naquadah — the item is gone for good
  if (target && target.kind === 'scrap') {
    const gain = scrapValue({ id: d.id, count: d.count, rarity: d.rarity });
    if (g.state === 'hub') g.save.naquadah += gain;
    else g.runNaq = (g.runNaq || 0) + gain;
    sfx.scrap ? sfx.scrap() : sfx.pickup();
    g.message('Scrapped ' + (ITEMS[d.id] ? ITEMS[d.id].name : d.id) + (d.count > 1 ? ' ×' + d.count : '') + '  →  +' + gain + ' naquadah');
    if (!g.inv.equip[g.inv.active]) {
      g.inv.active = ['weapon1', 'weapon2', 'weapon3'].find((s) => g.inv.equip[s]) || 'weapon1';
    }
    saveInv(g);
    if (g.save) persist(g.save);
    return;
  }
  // temporarily place the held stack back at origin, then use moveStack
  invSet(g, d.from, d.rarity ? { id: d.id, count: d.count, rarity: d.rarity } : { id: d.id, count: d.count });
  if (target && !(target.kind === 'equip' && target.key === 'weapon3' && (fx(g).weaponSlots || 2) < 3)) {
    if (d.from.kind === 'stash' || target.kind === 'stash') {
      stashMove(g, d.from, target); // moveStack only knows g.inv locations
    } else {
      const cap = target.kind === 'equip' && target.key === 'grenade' ? fx(g).grenadeCap : 0;
      moveStack(g.inv, d.from, target, cap);
    }
  }
  // ensure a valid active weapon slot
  if (!g.inv.equip[g.inv.active]) {
    const slots = ['weapon1', 'weapon2', 'weapon3'];
    g.inv.active = slots.find((s) => g.inv.equip[s]) || 'weapon1';
  }
  saveInv(g);
}

function renderPanel(g) {
  const { ctx, view } = g;
  ctx.fillStyle = 'rgba(4,6,12,0.93)';
  ctx.fillRect(0, 0, view.w, view.h);

  const lay = panelLayout(g);
  ctx.save();
  if (lay.k < 1) {
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(lay.k, lay.k);
    ctx.translate(-view.w / 2, -view.h / 2);
    g.uiXform = { k: lay.k, cx: view.w / 2, cy: view.h / 2 };
  }
  const pm = uiUnmap(g, g.pmouse.x, g.pmouse.y);
  ctx.fillStyle = 'rgba(12,17,26,0.96)';
  ctx.fillRect(lay.px, lay.py, lay.panelW, lay.panelH);
  ctx.strokeStyle = 'rgba(120,170,220,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(lay.px, lay.py, lay.panelW, lay.panelH);

  ctx.fillStyle = '#9cf';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('LOADOUT', lay.px + 24, lay.py + 34);
  ctx.fillStyle = '#678';
  ctx.font = '11px monospace';
  ctx.fillText('drag items between the grid, your gear slots and the hotbar   ·   TAB / ESC to close', lay.px + 24, lay.py + 52);
  button(g, 'AUTO-SORT', lay.px + lay.panelW - 178, lay.py + 16, 104, 26, () => {
    sortInventory(g.inv);
    saveInv(g);
    g.message('Backpack sorted');
  });
  button(g, '✕', lay.px + lay.panelW - 44, lay.py + 12, 32, 28, () => { g.panelOpen = false; });

  // STASH: the between-runs chest, unlocked by the Base Stores upgrade
  if (g.state === 'hub') {
    ctx.textAlign = 'left';
    if (stashCap(g) > 0) {
      const tg = lay.stashToggle;
      if (tg) {
        const over = pm.x >= tg.x && pm.x <= tg.x + tg.w && pm.y >= tg.y && pm.y <= tg.y + tg.h;
        ctx.fillStyle = over ? 'rgba(40,90,140,0.5)' : 'rgba(20,28,40,0.7)';
        ctx.fillRect(tg.x, tg.y, tg.w, tg.h);
        ctx.strokeStyle = '#6cf';
        ctx.lineWidth = 1;
        ctx.strokeRect(tg.x + 0.5, tg.y + 0.5, tg.w - 1, tg.h - 1);
        ctx.fillStyle = '#dff';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(lay.stashOn ? 'VIEW BACKPACK' : 'VIEW STASH', tg.x + 8, tg.y + 15);
      }
      if (lay.stashOn) {
        const used = (g.save.stash || []).filter(Boolean).length;
        ctx.fillStyle = '#8cf';
        ctx.font = '9px monospace';
        ctx.fillText('STASH  ·  ' + used + ' / ' + stashCap(g) + ' slots  ·  survives death', lay.gx, lay.gy - 8);
      }
    } else {
      ctx.fillStyle = '#567';
      ctx.font = '9px monospace';
      ctx.fillText('Base Stores upgrade unlocks a storage chest', lay.gx, lay.gy - 7);
    }
  }

  // derived resistance readout
  const dr = regionDR(g.inv);
  ctx.fillStyle = '#8cf';
  ctx.font = '11px monospace';
  ctx.fillText(
    `DR  head ${(dr.head * 100) | 0}%   torso ${(dr.torso * 100) | 0}%   legs ${(dr.legs * 100) | 0}%   feet ${(dr.feet * 100) | 0}%`,
    lay.dollX,
    lay.hbY + lay.S + 22
  );

  // --- character stats — a strip along the bottom of the panel ---
  {
    const p = g.player;
    const eff = fx(g);
    const sx = lay.px + 24;
    const sy0 = lay.gy + lay.S * GRID_ROWS + (GRID_ROWS - 1) * 7 + 66;
    ctx.fillStyle = '#8ef';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('STATS', sx, sy0);
    ctx.font = '10px monospace';
    const pairs = [
      ['HP', `${Math.ceil(p ? p.hp : 100)}/${p ? p.maxHp : 100}`],
      ['Move', `${Math.round(100 * (eff.moveSpeedMul || 1))}%`],
      ['Dodge', `${p ? p.dodgeMax || 1 : eff.dodgeCharges || 1}x`],
      ['Crit', `${Math.round(100 * (eff.critChance || 0))}%`],
      ['Wpn dmg', `x${(eff.weaponDmgMul || 1).toFixed(2)}`],
      ['DR torso', `${(regionDR(g.inv).torso * 100) | 0}%`],
      ['Naquadah', g.save.naquadah | 0],
      ['Intel', g.save.intel | 0],
      ['Salvage', g.save.salvage | 0],
    ];
    pairs.forEach(([k, v], i) => {
      const col = i % 5;
      const rowN = (i / 5) | 0;
      const bx = sx + 70 + col * 128;
      const byy = sy0 + rowN * 15;
      ctx.fillStyle = '#9ab';
      ctx.fillText(k, bx, byy);
      ctx.fillStyle = '#dff';
      ctx.fillText(String(v), bx + 62, byy);
    });
  }

  const labels = {
    head: 'HEAD',
    torso: 'BODY',
    legs: 'LEGS',
    feet: 'FEET',
    weapon1: 'WPN1',
    weapon2: 'WPN2',
    weapon3: 'WPN3',
    grenade: 'GRND',
  };
  const slots3 = (fx(g).weaponSlots || 2) >= 3;
  for (const c of lay.cells) {
    if (c.loc.kind === 'scrap') continue; // drawn as a wide bar below
    // the third weapon slot is inert until the Third Holster tech is researched
    if (c.loc.kind === 'equip' && c.loc.key === 'weapon3' && !slots3) {
      drawSlot(ctx, c.x, c.y, c.w, null, { label: 'WPN3', border: 'rgba(70,80,95,0.5)', bg: 'rgba(20,24,32,0.5)' });
      continue;
    }
    const st = invRef(g, c.loc);
    let label = null;
    let border = 'rgba(120,160,210,0.35)';
    if (c.loc.kind === 'equip') {
      label = labels[c.loc.key];
      border = 'rgba(150,190,240,0.55)';
      if (c.loc.key === g.inv.active) border = '#7fe8ff';
    } else if (c.loc.kind === 'hot') {
      label = String(c.loc.i + 1);
      border = 'rgba(255,220,120,0.4)';
    }
    const hover = pm.x >= c.x && pm.x <= c.x + c.w && pm.y >= c.y && pm.y <= c.y + c.h;
    drawSlot(ctx, c.x, c.y, c.w, st, { label, border: hover ? '#cfe8ff' : border });
  }

  // requisition strip — click to draw one of each Research-unlocked weapon
  ctx.fillStyle = '#8cf';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('REQUISITION', lay.reqX, lay.dollY + 10);
  if (!lay.reqCells.length) {
    ctx.fillStyle = '#567';
    ctx.font = '9px monospace';
    ctx.fillText('research the Armory', lay.reqX, lay.dollY + 28);
    ctx.fillText('branch to unlock', lay.reqX, lay.dollY + 40);
  }
  for (const rc of lay.reqCells) {
    const def = ITEMS[rc.id];
    const hover = pm.x >= rc.x && pm.x <= rc.x + rc.w && pm.y >= rc.y && pm.y <= rc.y + rc.h;
    ctx.fillStyle = hover ? 'rgba(40,90,140,0.5)' : 'rgba(20,28,40,0.7)';
    ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
    ctx.strokeStyle = (RARITY_COLOR && RARITY_COLOR[rarityOf(rc.id)]) || 'rgba(120,160,210,0.4)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1);
    if (drawItemIcon) drawItemIcon(ctx, rc.id, rc.x + 18, rc.y + rc.h / 2, 24);
    ctx.fillStyle = def.color;
    ctx.font = 'bold 10px monospace';
    ctx.fillText(def.name, rc.x + 34, rc.y + 16);
    ctx.fillStyle = hover ? '#cfe' : '#789';
    ctx.font = '8px monospace';
    ctx.fillText(hover ? 'click — add to pack' : 'unlocked', rc.x + 34, rc.y + 30);
  }

  // scrap bar — drag any item here to break it down for naquadah
  {
    const sc = lay.scrap;
    const over = pm.x >= sc.x && pm.x <= sc.x + sc.w && pm.y >= sc.y && pm.y <= sc.y + sc.h;
    const armed = !!g.drag && over;
    ctx.fillStyle = armed ? 'rgba(120,60,40,0.55)' : over ? 'rgba(50,40,36,0.7)' : 'rgba(28,24,22,0.6)';
    ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
    ctx.strokeStyle = armed ? '#ff8a4c' : 'rgba(200,120,80,0.4)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeRect(sc.x + 0.5, sc.y + 0.5, sc.w - 1, sc.h - 1);
    ctx.setLineDash([]);
    ctx.fillStyle = armed ? '#ffd9c2' : '#c89a86';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    const msg = g.drag
      ? 'release to SCRAP  →  +' + scrapValue({ id: g.drag.id, count: g.drag.count, rarity: g.drag.rarity }) + ' naquadah'
      : 'SCRAP  ·  drag junk here to break it down for naquadah';
    ctx.fillText(msg, sc.x + sc.w / 2, sc.y + sc.h / 2 + 3);
  }

  // tooltip for hovered item
  textReset(ctx); // the scrap bar above left textAlign on 'center'
  for (const c of lay.cells) {
    if (c.loc.kind === 'scrap') continue;
    const hover = pm.x >= c.x && pm.x <= c.x + c.w && pm.y >= c.y && pm.y <= c.y + c.h;
    if (!hover) continue;
    const st = invRef(g, c.loc);
    if (!st || !ITEMS[st.id]) break;
    const def = ITEMS[st.id];
    const tier = stackRarity(st);
    const tw = 230;
    const tx = clamp(c.x + c.w + 8, 8, view.w - tw - 8);
    const inW = tw - 16;
    // measure the content first, then size the box to it
    ctx.font = '10px monospace';
    const blLines = wrapLines(ctx, def.blurb || def.type, inW);
    const sub = def.type === 'consumable' ? 'hotbar slot · use with 1-4' : def.type === 'armor' ? 'equip to ' + def.region : def.type;
    const rarLine = tier !== 'common' ? (RARITY_LABEL[tier] || tier.toUpperCase()) + '  ·  +' + Math.round((RARITY_MULT[tier] - 1) * 100) + '% effect' : null;
    const th = 24 + blLines.length * 13 + 14 + (rarLine ? 14 : 0);
    const ty = clamp(c.y, 8, view.h - th - 8);
    ctx.fillStyle = 'rgba(6,10,16,0.96)';
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = tier !== 'common' ? RARITY_COLOR[tier] : def.color;
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
    let yy = ty + 17;
    ctx.fillStyle = tier !== 'common' ? RARITY_COLOR[tier] : def.color;
    ctx.font = 'bold 12px monospace';
    ctx.fillText(tier !== 'common' ? rarityAffixName(st.id, tier) : def.name, tx + 8, yy);
    yy += 16;
    ctx.fillStyle = '#bcd';
    ctx.font = '10px monospace';
    for (const l of blLines) { ctx.fillText(l, tx + 8, yy); yy += 13; }
    ctx.fillStyle = '#678';
    ctx.fillText(sub, tx + 8, yy + 1);
    if (rarLine) {
      ctx.fillStyle = RARITY_COLOR[tier];
      ctx.fillText(rarLine, tx + 8, yy + 15);
    }
    break;
  }

  // dragged item follows the cursor
  if (g.drag && ITEMS[g.drag.id]) {
    const def = ITEMS[g.drag.id];
    ctx.globalAlpha = 0.9;
    drawSlot(ctx, pm.x - lay.S / 2, pm.y - lay.S / 2, lay.S, { id: g.drag.id, count: g.drag.count, rarity: g.drag.rarity }, {
      bg: 'rgba(30,40,55,0.9)',
      border: def.color,
    });
    ctx.globalAlpha = 1;
  }
  ctx.restore(); // matches the ctx.save() at the top (scaled or not)
  g.uiXform = null;
}

function drawMinimap(g) {
  const { ctx, view } = g;
  const cell = 14;
  const pad = 3;
  let mgx = 0;
  let mgy = 0;
  for (const r of g.world.rooms) {
    mgx = Math.max(mgx, r.gx);
    mgy = Math.max(mgy, r.gy);
  }
  const w = (mgx + 1) * cell;
  const ox = view.w - 20 - w;
  const oy = 30;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '9px monospace';
  ctx.fillStyle = '#8ab';
  ctx.fillText('MAP', view.w - 20, oy - 6);

  for (const r of g.world.rooms) {
    const x = ox + r.gx * cell;
    const y = oy + r.gy * cell;
    let col = r.cleared ? '#3a6a4a' : r === g.curRoom || r.everSeen ? '#6a3a3a' : '#2a3a4a';
    if (r.kind === 'gate') col = '#3a5a8a';
    if (r.kind === 'dhd') col = r.cleared ? '#55ddee' : '#8a5a2a';
    ctx.fillStyle = col;
    ctx.fillRect(x, y, cell - pad, cell - pad);
    if (r.kind === 'dhd') {
      ctx.strokeStyle = g.dhdActive ? '#8ef' : '#c96';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, y - 1, cell - pad + 2, cell - pad + 2);
    }
    if (g.curRoom === r) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 0.5, y - 0.5, cell - pad + 1, cell - pad + 1);
    }
  }

  // objective arrow: at screen edge-ish, pointing player -> DHD room
  const dhd = g.world.dhdRoom;
  if (dhd && dhd !== g.curRoom && !dhd.cleared) {
    const p = g.player;
    const a = Math.atan2(dhd.centerPx.y - p.y, dhd.centerPx.x - p.x);
    ctx.save();
    ctx.translate(view.w / 2 + Math.cos(a) * 46, view.h / 2 + Math.sin(a) * 46);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(140,220,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // one-line legend
  ctx.textAlign = 'right';
  ctx.font = '8px monospace';
  const ly = oy + (mgy + 1) * cell + 8;
  ctx.fillStyle = '#4a6a9a';
  ctx.fillText('gate', view.w - 84, ly);
  ctx.fillStyle = '#4a8a6a';
  ctx.fillText('clear', view.w - 52, ly);
  ctx.fillStyle = '#b07a3a';
  ctx.fillText('DHD', view.w - 20, ly);
}

function renderMessages(g) {
  const { ctx, view } = g;
  ctx.textBaseline = 'alphabetic';

  // one toast — the newest message, centred near the top
  const m = g.messages[g.messages.length - 1];
  if (m && m.t > 0) {
    const a = clamp(m.t / 1.2, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = '#dff0ff';
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.fillText(m.txt, view.w / 2, 92 - (1 - a) * 8);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // small scrollback, bottom-left above the HP bar
  const log = g.log || [];
  ctx.textAlign = 'left';
  ctx.font = '10px monospace';
  for (let i = 0; i < log.length; i++) {
    ctx.globalAlpha = 0.22 + 0.5 * (i / Math.max(1, log.length - 1));
    ctx.fillStyle = '#9fb8cc';
    ctx.fillText(log[i], 20, view.h - 96 - (log.length - 1 - i) * 13);
  }
  ctx.globalAlpha = 1;
}

// boss arena name plate — slides in, holds, fades over g.bossIntroT (starts 3.4)
function drawBossIntro(g) {
  const { ctx, view } = g;
  const v = g.params.faction || g.params.primary;
  const T = g.bossIntroT;
  // 3.4..2.8 slide in, 2.8..1.0 hold, 1.0..0 fade
  const inP = clamp((3.4 - T) / 0.6, 0, 1);
  const out = clamp(T / 1.0, 0, 1);
  const a = Math.min(inP, out);
  const cy = view.h * 0.32;
  const tint = BOSS_TINT[v] || '#ffb347';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // banner bars
  ctx.globalAlpha = a * 0.9;
  ctx.fillStyle = 'rgba(6,8,12,0.72)';
  const bw = view.w * (0.3 + 0.5 * inP);
  ctx.fillRect(view.w / 2 - bw / 2, cy - 34, bw, 68);
  ctx.strokeStyle = tint;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(view.w / 2 - bw / 2, cy - 34);
  ctx.lineTo(view.w / 2 + bw / 2, cy - 34);
  ctx.moveTo(view.w / 2 - bw / 2, cy + 34);
  ctx.lineTo(view.w / 2 + bw / 2, cy + 34);
  ctx.stroke();
  // text
  ctx.globalAlpha = a;
  ctx.shadowBlur = 16;
  ctx.shadowColor = tint;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px monospace';
  ctx.fillText((BOSS_NAME[v] || 'Boss').toUpperCase(), view.w / 2, cy + 2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = tint;
  ctx.font = '12px monospace';
  ctx.fillText((BOSS_SUB[v] || '').toUpperCase(), view.w / 2, cy + 22);
  ctx.restore();
}

// ---- adaptive UI scaling ------------------------------------------------
// full-screen panels are laid out at a fixed "natural" size for desktop. On a
// smaller viewport (mobile landscape) the whole panel is drawn through a uniform
// scale transform so nothing is clipped. g.uiXform carries the active transform
// so button() can store screen-space hit rects and the mouse can be un-mapped.
function applyUiScale(g, natW, natH) {
  const { ctx, view } = g;
  // full-screen dim, UNscaled, so the corners are always covered
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,12,0.9)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.restore();
  const k = Math.min(1, (view.w - 12) / natW, (view.h - 12) / natH);
  g.uiXform = { k, cx: view.w / 2, cy: view.h / 2 };
  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(k, k);
  ctx.translate(-view.w / 2, -view.h / 2);
  return k;
}
function endUiScale(g) {
  if (!g.uiXform) return;
  g.ctx.restore();
  g.uiXform = null;
}
// screen point -> natural (panel) point under the active UI scale
function uiUnmap(g, sx, sy) {
  const t = g.uiXform;
  if (!t) return { x: sx, y: sy };
  return { x: t.cx + (sx - t.cx) / t.k, y: t.cy + (sy - t.cy) / t.k };
}

export function button(g, label, x, y, w, h, fn, enabled = true) {
  const { ctx } = g;
  ctx.save();
  ctx.fillStyle = enabled ? 'rgba(40,90,140,0.35)' : 'rgba(60,60,60,0.25)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = enabled ? '#6cf' : '#555';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = enabled ? '#dff' : '#888';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
  if (enabled) {
    // store a SCREEN-space hit rect so the plain click handler + panelPick work
    // whether or not a UI scale transform is active
    const t = g.uiXform;
    const hr = t
      ? { x: t.cx + (x - t.cx) * t.k, y: t.cy + (y - t.cy) * t.k, w: w * t.k, h: h * t.k }
      : { x, y, w, h };
    g.buttons.push({
      x: hr.x, y: hr.y, w: hr.w, h: hr.h,
      fn: () => {
        try {
          if (sfx.uiClick) sfx.uiClick();
        } catch (e) {
          /* headless / audio not ready */
        }
        fn();
      },
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ pause + settings
// ──────────────────────────────────────────────────────────────────────────

const CONTROLS = [
  ['Move', 'W A S D'],
  ['Aim', 'Mouse'],
  ['Fire', 'Left mouse'],
  ['Dodge roll', 'Space'],
  ['Reload', 'R'],
  ['Grenade', 'G'],
  ['Swap weapon', 'X  /  mouse wheel'],
  ['Quick heal', 'Q'],
  ['Inventory & stats', 'Tab  /  I'],
  ['Interact / dial', 'E'],
  ['Mute audio', 'M'],
  ['Volume', '[  ]'],
  ['Pause / settings', 'Esc'],
];

function updatePauseMenu(g) {
  // a sub-screen open over the pause overlay eats Esc (back out one level) plus
  // the wheel (codex / settings scroll). the top-level Esc toggle in update() is
  // already suppressed while g.uiStack has entries.
  if (g.uiStack.length) {
    if (pressed('Escape')) uiPop(g);
    if (g.wheel) uiScroll(g, g.wheel);
    return;
  }
}

function settingsShake(g) {
  if (!g.save.settings) g.save.settings = { binds: {} };
  if (g.save.settings.shake == null) g.save.settings.shake = 1;
  return g.save.settings.shake;
}

// live controls list for the pause overlay — reflects the player's rebinds
function controlsList(g) {
  const kn = (a, d) => keyName(boundKey(g, a, d));
  return [
    ['Move', `${kn('up', 'KeyW')} ${kn('left', 'KeyA')} ${kn('down', 'KeyS')} ${kn('right', 'KeyD')}`],
    ['Aim / Fire', 'Mouse / Left mouse'],
    ['Dodge roll', kn('dodge', 'Space')],
    ['Reload', kn('reload', 'KeyR')],
    ['Grenade', kn('grenade', 'KeyG')],
    ['Swap weapon', `${kn('swap', 'KeyX')}  /  wheel`],
    ['Quick heal', kn('heal', 'KeyQ')],
    ['Inventory', `${keyName(boundKey(g, 'inventory', 'Tab'))}  /  I`],
    ['Interact / dial', kn('interact', 'KeyE')],
    ['Mute · Volume', 'M · [  ]'],
    ['Pause', 'Esc'],
  ];
}

function renderPause(g) {
  const { ctx, view } = g;
  if (g.uiStack.length && g.uiRoot === 'pause') {
    renderUiScreen(g);
    return;
  }
  applyUiScale(g, 740, 480);
  textReset(ctx);
  ctx.fillStyle = 'rgba(4,6,12,0.82)';
  ctx.fillRect(0, 0, view.w, view.h);
  const w = 720;
  const h = 460;
  const x = (view.w - w) / 2;
  const y = (view.h - h) / 2;
  ctx.fillStyle = 'rgba(12,17,26,0.98)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(120,170,220,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#9cf';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('PAUSED', x + 28, y + 38);
  ctx.fillStyle = '#567';
  ctx.font = '10px monospace';
  ctx.fillText('the world is frozen while paused', x + 108, y + 38);

  // --- menu column (left) ---
  const sx = x + 28;
  let sy = y + 74;
  button(g, 'RESUME   (Esc)', sx, sy, 240, 38, () => {
    g.paused = false;
  });
  sy += 48;
  button(g, 'SETTINGS', sx, sy, 240, 38, () => uiPush(g, 'settings'));
  sy += 48;
  button(g, 'CODEX', sx, sy, 240, 38, () => uiPush(g, 'codex'));
  sy += 48;
  button(g, 'KEY BINDINGS', sx, sy, 240, 38, () => uiPush(g, 'rebind'));
  sy += 48;
  button(g, isMuted() ? 'UNMUTE ALL' : 'MUTE ALL', sx, sy, 240, 38, () => toggleMute());
  sy += 48;
  if (g.state === 'play') {
    button(g, 'ABANDON RUN → SGC', sx, sy, 240, 38, () => {
      g.paused = false;
      onDeath(g, true);
    });
  }

  // --- controls column (right) ---
  const cx = x + w / 2 + 24;
  let cy = y + 74;
  ctx.fillStyle = '#8ef';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('CONTROLS', cx, cy);
  cy += 20;
  ctx.font = '11px monospace';
  for (const [k, v] of controlsList(g)) {
    ctx.fillStyle = '#9ab';
    ctx.fillText(k, cx, cy);
    ctx.fillStyle = '#dff';
    ctx.fillText(v, cx + 140, cy);
    cy += 18;
  }
  endUiScale(g);
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ front-of-house UI
// ──────────────────────────────────────────────────────────────────────────
// main menu, the shared Settings / Key-bindings / Codex sub-screens, and the
// first-run tutorial. everything here overlays g.state 'menu' (uiRoot 'menu') or
// the pause overlay (uiRoot 'pause'); g.state itself is never a new string.

const MENU_ITEMS = [
  { key: 'DEPLOY', hint: 'gear up at the SGC, then step through the gate', fn: (g) => enterHub(g) },
  { key: 'LOADOUT', hint: 'the Armory — weapons, armour, mods', fn: (g) => { enterHub(g); g.message('Armory is off the gate room — walk over and press E'); } },
  { key: 'RESEARCH', hint: 'the Research Lab — spend naquadah & intel on tech', fn: (g) => { enterHub(g); g.message('Research Lab console is in the SGC — press E at it'); } },
  { key: 'OPERATIONS', hint: 'the Briefing Room — your current Incursion order', fn: (g) => { enterHub(g); g.message('Briefing Room holds the active Operation'); } },
  { key: 'CODEX', hint: 'field intelligence — enemies, worlds, factions', fn: (g) => uiPush(g, 'codex') },
  { key: 'SETTINGS', hint: 'audio, video, accessibility, key bindings', fn: (g) => uiPush(g, 'settings') },
];

function uiPush(g, screen) {
  g.uiRoot = g.paused ? 'pause' : 'menu';
  g.uiStack.push(screen);
  g.codexScroll = 0;
  g.settingsScroll = 0;
  g._rebinding = null;
  g._resetArm = 0;
}
function uiPop(g) {
  g.uiStack.pop();
  g._rebinding = null;
  g._resetArm = 0;
}
function uiScroll(g, d) {
  const top = g.uiStack[g.uiStack.length - 1];
  if (top === 'codex') g.codexScroll = Math.max(0, g.codexScroll + d * 40);
  else if (top === 'settings') g.settingsScroll = Math.max(0, g.settingsScroll + d * 40);
}
function renderUiScreen(g) {
  const top = g.uiStack[g.uiStack.length - 1];
  applyUiScale(g, 800, 580);
  if (top === 'settings') renderSettings(g);
  else if (top === 'rebind') renderRebind(g);
  else if (top === 'codex') renderCodex(g);
  else uiPop(g);
  endUiScale(g);
}

function updateMenu(g) {
  if (g.uiStack.length) {
    if (pressed('Escape')) uiPop(g);
    if (g.wheel) uiScroll(g, g.wheel);
    return;
  }
  const n = MENU_ITEMS.length;
  if (pressed('ArrowDown') || pressed('KeyS')) {
    g.menuSel = (g.menuSel + 1) % n;
    try { sfx.uiHover && sfx.uiHover(); } catch (e) {}
  }
  if (pressed('ArrowUp') || pressed('KeyW')) {
    g.menuSel = (g.menuSel + n - 1) % n;
    try { sfx.uiHover && sfx.uiHover(); } catch (e) {}
  }
  if (pressed('Enter') || pressed('NumpadEnter') || pressed('Space')) {
    try { sfx.uiClick && sfx.uiClick(); } catch (e) {}
    (MENU_ITEMS[g.menuSel] || MENU_ITEMS[0]).fn(g);
  }
}

function uiFrame(g, title, sub) {
  const { ctx, view } = g;
  textReset(ctx);
  ctx.fillStyle = 'rgba(4,6,12,0.94)';
  ctx.fillRect(0, 0, view.w, view.h);
  starfield(g);
  const w = 760;
  const h = 560;
  const x = (view.w - w) / 2;
  const y = (view.h - h) / 2;
  ctx.fillStyle = 'rgba(10,14,22,0.96)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(120,170,220,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#9cf';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(title, x + 26, y + 34);
  if (sub) {
    ctx.fillStyle = '#678';
    ctx.font = '11px monospace';
    ctx.fillText(sub, x + 26, y + 50);
  }
  button(g, '✕', x + w - 42, y + 12, 30, 26, () => uiPop(g));
  return { x, y, w, h };
}

// ---- shared Settings ------------------------------------------------------
function renderSettings(g) {
  const { ctx } = g;
  const st = g.save.settings;
  const F = uiFrame(g, 'SETTINGS', g.uiRoot === 'pause' ? 'run paused' : '');
  const sx = F.x + 30;
  let sy = F.y + 70 - g.settingsScroll;
  const clampv = (v) => Math.max(0, Math.min(1, Math.round(v * 20) / 20));
  const row = (label) => {
    ctx.fillStyle = '#bcd';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, sx, sy + 4);
  };
  const stepper = (label, val, dec, inc) => {
    if (sy > F.y + 40 && sy < F.y + F.h - 60) {
      row(label);
      button(g, '–', sx + 250, sy - 12, 26, 22, dec);
      ctx.fillStyle = '#dff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(val, sx + 312, sy + 4);
      ctx.textAlign = 'left';
      button(g, '+', sx + 344, sy - 12, 26, 22, inc);
    }
    sy += 34;
  };
  const toggle = (label, on, fn) => {
    if (sy > F.y + 40 && sy < F.y + F.h - 60) {
      row(label);
      button(g, on ? 'ON' : 'OFF', sx + 250, sy - 12, 120, 22, fn);
    }
    sy += 34;
  };

  stepper(
    'SFX volume', Math.round(getSfxVolume() * 100) + '%',
    () => setSfxVolume(clampv(getSfxVolume() - 0.1)),
    () => setSfxVolume(clampv(getSfxVolume() + 0.1))
  );
  const mv = music && music.getVolume ? music.getVolume() : 1;
  stepper(
    'Music volume', Math.round(mv * 100) + '%',
    () => music && music.setVolume && music.setVolume(clampv((music.getVolume ? music.getVolume() : 1) - 0.1)),
    () => music && music.setVolume && music.setVolume(clampv((music.getVolume ? music.getVolume() : 1) + 0.1))
  );
  toggle('Master mute', isMuted(), () => toggleMute());
  stepper(
    'Screen shake', Math.round(settingsShake(g) * 100) + '%',
    () => { st.shake = Math.max(0, Math.round((settingsShake(g) - 0.25) * 100) / 100); persist(g.save); },
    () => { st.shake = Math.min(1.5, Math.round((settingsShake(g) + 0.25) * 100) / 100); persist(g.save); }
  );
  stepper(
    'Screen brightness', Math.round((st.gamma || 1) * 100) + '%',
    () => { st.gamma = Math.max(0.7, Math.round(((st.gamma || 1) - 0.1) * 10) / 10); persist(g.save); },
    () => { st.gamma = Math.min(1.4, Math.round(((st.gamma || 1) + 0.1) * 10) / 10); persist(g.save); }
  );
  toggle('Reduce flash', !!st.reduceFlash, () => { st.reduceFlash = !st.reduceFlash; persist(g.save); });
  toggle('Colour-blind faction tags', !!st.cbPalette, () => { st.cbPalette = !st.cbPalette; persist(g.save); });
  toggle('Gamepad aim-assist', !!st.aimAssist, () => { st.aimAssist = !st.aimAssist; persist(g.save); });

  const DIFFS = ['story', 'normal', 'hard'];
  if (sy > F.y + 40 && sy < F.y + F.h - 60) {
    const cur = st.difficulty || 'normal';
    row('Difficulty');
    button(g, cur.toUpperCase(), sx + 250, sy - 12, 120, 22, () => {
      st.difficulty = DIFFS[(DIFFS.indexOf(cur) + 1) % DIFFS.length];
      persist(g.save);
      g.message(
        'Difficulty: ' +
          (st.difficulty === 'story' ? 'STORY — you take less, hit harder'
            : st.difficulty === 'hard' ? 'HARD — enemies hit harder, the hunt builds faster'
            : 'NORMAL')
      );
    });
  }
  sy += 34;

  sy += 6;
  if (sy > F.y + 40 && sy < F.y + F.h - 60) {
    button(g, 'KEY BINDINGS →', sx, sy - 14, 200, 28, () => uiPush(g, 'rebind'));
    button(g, 'REPLAY TUTORIAL', sx + 220, sy - 14, 200, 28, () => {
      st.seenTutorial = false;
      g.tips = null;
      g._tipsQueued = null;
      persist(g.save);
      g.message('Tutorial tips will show on your next deployment');
    });
  }
  sy += 44;
  if (sy > F.y + 40 && sy < F.y + F.h - 60) {
    if (g._resetArm > 0) {
      button(g, 'CONFIRM — WIPE CAMPAIGN', sx, sy - 14, 300, 28, () => { resetCampaign(g); g._resetArm = 0; });
      button(g, 'CANCEL', sx + 316, sy - 14, 90, 28, () => { g._resetArm = 0; });
    } else {
      button(g, 'RESET CAMPAIGN…', sx, sy - 14, 300, 28, () => { g._resetArm = 1; });
    }
  }
  sy += 34;
  if (sy > F.y + 40 && sy < F.y + F.h - 46) {
    ctx.fillStyle = '#566';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('colour-blind tags: stored — draws a shaped faction mark on the gate-map legend  (TODO: full enemy recolour)', sx, sy);
    ctx.fillText('aim-assist: on for gamepad — snaps pad-aim to the nearest enemy in a cone', sx, sy + 14);
  }

  button(g, g.uiRoot === 'pause' ? 'BACK   (Esc)' : 'CLOSE   (Esc)', F.x + 26, F.y + F.h - 42, 200, 30, () => uiPop(g));
}

// ---- key rebinding ------------------------------------------------------
const REBINDS = [
  ['up', 'Move up', 'KeyW'],
  ['down', 'Move down', 'KeyS'],
  ['left', 'Move left', 'KeyA'],
  ['right', 'Move right', 'KeyD'],
  ['dodge', 'Dodge roll', 'Space'],
  ['reload', 'Reload', 'KeyR'],
  ['grenade', 'Grenade', 'KeyG'],
  ['swap', 'Swap weapon', 'KeyX'],
  ['heal', 'Quick heal', 'KeyQ'],
  ['interact', 'Interact / dial', 'KeyE'],
  ['inventory', 'Inventory', 'Tab'],
];

function boundKey(g, action, dflt) {
  const b = g.save && g.save.settings && g.save.settings.binds;
  return (b && b[action]) || dflt;
}
// true if a bound OR the hard default code is down — keeps the gamepad bridge
// (which always writes WASD) working no matter how the player has remapped.
function keyHeld(g, action, dflt) {
  return keys.has(dflt) || keys.has(boundKey(g, action, dflt));
}
function keyHit(g, action, dflt) {
  return pressed(dflt) || pressed(boundKey(g, action, dflt));
}
function keyName(code) {
  if (!code) return '—';
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '')
    .replace('Numpad', 'Num');
}

function renderRebind(g) {
  const { ctx } = g;
  const F = uiFrame(g, 'KEY BINDINGS', 'click a row, then press a key');
  let sy = F.y + 76;
  const binds = (g.save.settings.binds = g.save.settings.binds || {});
  for (const [act, label, dflt] of REBINDS) {
    ctx.fillStyle = '#bcd';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, F.x + 34, sy + 4);
    const cur = binds[act] || dflt;
    const listening = g._rebinding === act;
    button(g, listening ? 'press a key…' : keyName(cur), F.x + 240, sy - 14, 160, 26, () => {
      g._rebinding = act;
      captureNextKey((code) => {
        g._rebinding = null;
        if (code === 'Escape') return; // cancel
        if (code === 'Delete' || code === 'Backspace') { delete binds[act]; persist(g.save); return; }
        binds[act] = code;
        persist(g.save);
      });
    });
    if (binds[act] && binds[act] !== dflt) {
      ctx.fillStyle = '#567';
      ctx.font = '10px monospace';
      ctx.fillText('default ' + keyName(dflt), F.x + 412, sy + 3);
    }
    sy += 30;
  }
  sy += 8;
  button(g, 'RESET TO DEFAULTS', F.x + 34, sy, 220, 30, () => {
    g.save.settings.binds = {};
    persist(g.save);
  });
  ctx.fillStyle = '#566';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Esc while listening cancels · Del clears a binding · gamepad WASD keeps working regardless', F.x + 34, sy + 48);
  button(g, 'BACK   (Esc)', F.x + 26, F.y + F.h - 42, 200, 30, () => uiPop(g));
}

// ---- codex / bestiary --------------------------------------------------
const CODEX = {
  jaffa: 'Rank-and-file warriors of the System Lords, staff weapon and armour issued, courage enforced by the symbiote in their pouch.',
  jaffa_heavy: 'Elite guard in reinforced plate — slow, brutally durable, and unbothered by the first several hits you land.',
  jaffa_grenadier: 'Line-breakers who lob plasma charges over cover to flush you into the open.',
  jaffa_sniper: 'A lane-holder anchored on a firing spot, charging one heavy telegraphed bolt at a time from long range.',
  wraith: 'Life-draining hunters of the Pegasus galaxy — fast, relentless, and hard to pin down in the open.',
  wraith_drone: 'Expendable hive soldiers thrown forward in swarms to overwhelm by sheer number.',
  wraith_stalker: 'A blink-hunter that phases out of phase to slip through crossfire and reappear on your flank.',
  replicator: 'Self-replicating Asgard-tech blocks that scuttle and assemble; ignore them and the room fills up.',
  replicator_brute: 'A heavy assembly of blocks that shrugs off whatever damage type hit it last — vary your fire.',
  replicator_weaver: 'Support unit that extrudes short-lived walls to sever your sightlines mid-fight.',
  scavenger: 'Non-hostile off-world critter picking through the ruins; killing one spills extra naquadah and salvage.',
  boss: 'A System Lord champion, hive queen or replicator core — shielded, multi-phase, and the gatekeeper of the sector.',
  nexus: 'The Incursion Nexus: the staging intelligence behind the raids on Earth. Kill it and the war ends.',
};
const BIOME_LORE = {
  ruins: 'Poured-concrete SGC-pattern facilities — the fallback world dressing.',
  temple: "System Lord's gilded hall: ashlar, gold friezes, torchlight.",
  pyramid: "Ra's pyramid interior — red-ochre stone and heavy gold banding.",
  jungle: 'Overgrown outdoor ruins under open sky — cracked flagstone and vines.',
  desert: 'Open canyon outpost — rippled sand, strata mesas, bone-bleached light.',
  savannah: 'Wide dry grassland — acacia stands and granite kopjes.',
  ice: 'Glacier cavern — translucent blue ice, deep cracks, drifting snow.',
  foundry: 'Derelict deck — riveted plate, grating, hazard chevrons, oil and rust.',
  hive: 'Wraith hive — chitin ribs, sinew membrane, bioluminescent pods.',
  atlantis: 'Ancient outpost — blue-grey alloy, stained glass, clean geometry.',
  catacomb: 'Buried ossuary tunnels — close, dark, and full of dead ends.',
};
const FACTION_LORE = {
  Jaffa: 'The System Lords’ armies — disciplined infantry that use cover, suppress, and flank as squads.',
  Wraith: 'Pegasus hive-fleets — fast, aggressive swarms that close distance and drain the living.',
  Replicators: 'Runaway self-replicating machines — no morale, no retreat, only spread and adapt.',
};

function renderCodex(g) {
  const { ctx } = g;
  const F = uiFrame(g, 'CODEX', 'field intelligence — enemies, worlds, factions');
  const clipY = F.y + 66;
  const clipH = F.y + F.h - 96 - clipY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(F.x + 2, clipY, F.w - 4, clipH);
  ctx.clip();
  let y = clipY + 8 - g.codexScroll;
  const bst = g.save.bestiary || {};
  const line = (s, col, fnt) => {
    if (y > clipY - 20 && y < clipY + clipH + 20) {
      ctx.fillStyle = col;
      ctx.font = fnt || '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(s, F.x + 78, y);
    }
  };

  ctx.textAlign = 'left';
  for (const kind of Object.keys(CODEX)) {
    const rec = bst[kind];
    const seen = rec && rec.seen > 0;
    const rowY = y;
    if (rowY > clipY - 40 && rowY < clipY + clipH + 20) {
      if (seen) {
        drawCodexFigure(ctx, kind, F.x + 40, rowY + 6, g.time);
        ctx.fillStyle = '#dff';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(codexName(kind), F.x + 78, rowY);
        ctx.fillStyle = '#8fb';
        ctx.font = '10px monospace';
        ctx.fillText('killed ' + ((rec && rec.killed) || 0), F.x + 78 + 220, rowY);
        ctx.fillStyle = '#9ab';
        ctx.font = '10px monospace';
        ctx.fillText(CODEX[kind], F.x + 78, rowY + 15);
      } else {
        ctx.fillStyle = '#556';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('?', F.x + 34, rowY + 10);
        ctx.fillStyle = '#667';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('??? — UNIDENTIFIED', F.x + 78, rowY);
        ctx.fillStyle = '#556';
        ctx.font = '10px monospace';
        ctx.fillText('no field contact logged', F.x + 78, rowY + 15);
      }
    }
    y += 40;
  }
  y += 8;
  line('WORLDS', '#8ef', 'bold 12px monospace');
  y += 18;
  for (const b of Object.keys(BIOME_LORE)) {
    ctx.textAlign = 'left';
    if (y > clipY - 20 && y < clipY + clipH + 20) {
      ctx.fillStyle = '#cde';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(b.toUpperCase(), F.x + 40, y);
      ctx.fillStyle = '#9ab';
      ctx.font = '10px monospace';
      ctx.fillText(BIOME_LORE[b], F.x + 150, y);
    }
    y += 18;
  }
  y += 12;
  line('FACTIONS', '#8ef', 'bold 12px monospace');
  y += 18;
  for (const f of Object.keys(FACTION_LORE)) {
    if (y > clipY - 20 && y < clipY + clipH + 20) {
      ctx.fillStyle = '#cde';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(f.toUpperCase(), F.x + 40, y);
      ctx.fillStyle = '#9ab';
      ctx.font = '10px monospace';
      wrapText(ctx, FACTION_LORE[f], F.x + 150, y, F.w - 190, 13);
    }
    y += 34;
  }
  g._codexMax = (y + g.codexScroll) - clipY - clipH + 40;
  ctx.restore();

  if ((g._codexMax || 0) > 0) {
    button(g, 'SCROLL ▲', F.x + F.w - 220, F.y + F.h - 42, 90, 30, () => uiScroll(g, -3));
    button(g, 'SCROLL ▼', F.x + F.w - 120, F.y + F.h - 42, 90, 30, () => uiScroll(g, 3));
  }
  if (g.codexScroll > (g._codexMax || 0) && g._codexMax != null && g._codexMax > 0) g.codexScroll = g._codexMax;
  button(g, g.uiRoot === 'pause' ? 'BACK   (Esc)' : 'CLOSE   (Esc)', F.x + 26, F.y + F.h - 42, 200, 30, () => uiPop(g));
}

function codexName(kind) {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
// cheap silhouette for the codex — reuse the vector primitives from draw.js
function drawCodexFigure(ctx, kind, x, y, t) {
  ctx.save();
  const o = { t, gait: 0 };
  if (kind.indexOf('replicator') === 0) spider(ctx, x, y, t * 0.6, 1.5, '#9ad0ff', o);
  else if (kind === 'scavenger') critter(ctx, x, y, 0.4, 1.4, '#b9a', o);
  else if (kind.indexOf('wraith') === 0) figure(ctx, x, y, 0.5, 0.85, '#6b4a72', '#d7ffda', o);
  else if (kind === 'nexus') spider(ctx, x, y, t * 0.3, 2.2, '#f0b64a', o);
  else if (kind === 'boss') figure(ctx, x, y, 0.5, 1.15, '#7a2b2b', '#ffe6c8', o);
  else figure(ctx, x, y, 0.5, 0.95, '#5a4a2a', '#ffe6c8', o); // jaffa family
  ctx.restore();
}

// ---- screen brightness ------------------------------------------------
function applyGamma(g) {
  const gm = g.save && g.save.settings && g.save.settings.gamma;
  if (!gm || gm === 1) return;
  const { ctx, view } = g;
  ctx.save();
  if (gm < 1) {
    ctx.globalCompositeOperation = 'multiply';
    const v = Math.round(255 * gm);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
  } else {
    ctx.globalCompositeOperation = 'screen';
    const v = Math.round(255 * Math.min(0.6, gm - 1));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
  }
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.restore();
}

// ---- gamepad aim-assist feed ----------------------------------------
function feedAimAssist(g) {
  if (g.state !== 'play' || !g.save.settings || !g.save.settings.aimAssist || !g.enemies) {
    setAimAssistTargets(null);
    return;
  }
  const pts = [];
  for (const e of g.enemies) {
    if (!e.alive || e.state !== 'active' || e.neutral) continue;
    pts.push({
      x: (e.x - g.cam.x) * ZOOM + g.view.w / 2,
      y: (e.y - g.cam.y) * ZOOM + g.view.h / 2,
    });
  }
  setAimAssistTargets(pts);
}

// ---- first-run tutorial --------------------------------------------
const HUB_TIPS = [
  { txt: 'Walk into the gate to deploy · visit the consoles to spend what you earn · the Briefing Room holds your current Operation' },
];
const FIELD_TIPS = [
  { txt: 'WASD to move · mouse to aim · click to fire', check: (g) => g._tipMoved },
  { txt: 'SPACE dodges — you are invulnerable mid-roll', check: (g) => (g.player && g.player.dodge > 0) },
  { txt: 'Clear the sectors, reach the DHD, then press E to dial deeper or home' },
  { txt: 'You can only see what is in your line of sight' },
];

function queueTips(g, list, tag, final) {
  if (g.save.settings.seenTutorial) return;
  if (g._tipsQueued === tag) return;
  g._tipsQueued = tag;
  g.tips = { list: list.map((t) => ({ ...t })), i: 0, t: 0, final: !!final };
}

function updateTips(g, dt) {
  if (g.state === 'play' && g.player) {
    if (g._tipSpawn == null) g._tipSpawn = { x: g.player.x, y: g.player.y };
    if (Math.hypot(g.player.x - g._tipSpawn.x, g.player.y - g._tipSpawn.y) > 40) g._tipMoved = true;
  }
  const T = g.tips;
  if (!T || T.i >= T.list.length) return;
  // an explicit skip (X button / mobile SKIP TIPS) clears the whole queue
  if (g._skipTips) {
    g._skipTips = false;
    T.i = T.list.length;
    g.save.settings.seenTutorial = true;
    persist(g.save);
    return;
  }
  T.t += dt;
  const tip = T.list[T.i];
  const dismissed =
    pressed('Space') || pressed('Enter') || pressed('Escape') ||
    keyHit(g, 'up', 'KeyW') || keyHit(g, 'down', 'KeyS') ||
    keyHit(g, 'left', 'KeyA') || keyHit(g, 'right', 'KeyD') ||
    keyHit(g, 'interact', 'KeyE') || g._tipTap || (mouse.down && !g.mouseWasDown);
  g._tipTap = false;
  const auto = tip.check && tip.check(g) && T.t > 1.4;
  if (T.t > 4 || auto || (dismissed && T.t > 0.3)) {
    T.i++;
    T.t = 0;
    if (T.i >= T.list.length && T.final) {
      g.save.settings.seenTutorial = true;
      persist(g.save);
    }
  }
}

function renderTips(g, dt) {
  const T = g.tips;
  if (!T || T.i >= T.list.length) return;
  const { ctx, view } = g;
  textReset(ctx);
  const tip = T.list[T.i];
  ctx.font = '12px monospace';
  const tw = Math.min(view.w - 80, ctx.measureText(tip.txt).width + 40);
  const bw = Math.max(260, tw);
  const bh = 52;
  const bx = (view.w - bw) / 2;
  const by = view.h - 132;
  ctx.fillStyle = 'rgba(8,12,20,0.92)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(120,200,255,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = '#8ef';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`TIP ${T.i + 1}/${T.list.length}`, bx + 12, by + 15);
  ctx.fillStyle = '#dff';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(tip.txt, view.w / 2, by + 33);
  ctx.fillStyle = '#567';
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('tap / any key  →', bx + bw - 34, by + bh - 8);
  ctx.textAlign = 'left';
  // tap the card to advance; the ✕ skips the rest
  g.buttons.push({ x: bx, y: by, w: bw - 34, h: bh, fn: () => { g._tipTap = true; } });
  button(g, '✕', bx + bw - 30, by + bh / 2 - 13, 26, 26, () => { g._skipTips = true; });
}

// ---- contextual field notes ----------------------------------------
// one-shot prompts fired the first time the player meets a system. Keyed by id
// on g.save.hints so each shows exactly once, ever — independent of the
// seenTutorial one-shot gate above.
function hint(g, id, txt) {
  if (!g.save.hints || typeof g.save.hints !== 'object') g.save.hints = {};
  if (g.save.hints[id]) return;
  g.save.hints[id] = true;
  persist(g.save);
  g.hintCard = { txt, t: 9 };
}
function updateHint(g, dt) {
  if (!g.hintCard) return;
  g.hintCard.t -= dt;
  if (g.hintCard.t <= 0 || pressed('Escape') || pressed('Enter')) g.hintCard = null;
}
function renderHint(g) {
  const c = g.hintCard;
  if (!c) return;
  const { ctx, view } = g;
  textReset(ctx);
  ctx.font = '12px monospace';
  const bw = Math.min(560, view.w - 60);
  const lines = wrapLines(ctx, c.txt, bw - 28);
  const bh = 30 + lines.length * 16;
  const bx = (view.w - bw) / 2;
  const by = 70;
  ctx.globalAlpha = Math.max(0, Math.min(1, c.t) * Math.min(1, (9 - c.t) * 3));
  ctx.fillStyle = 'rgba(8,14,22,0.95)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(255,200,110,0.75)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = '#fd9';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FIELD NOTE', bx + 12, by + 15);
  ctx.fillStyle = '#eef';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  lines.forEach((ln, i) => ctx.fillText(ln, view.w / 2, by + 30 + i * 16));
  ctx.globalAlpha = 1;
  textReset(ctx);
}

// ---- reset campaign ---------------------------------------------------
function resetCampaign(g) {
  const d = defaultSave();
  g.save.campaign = d.campaign;
  g.save.tech = [];
  markEffDirty(g);
  g.save.weapons = {};
  g.save.bestiary = {};
  g.save.known = [HOME];
  g.save.naquadah = 0;
  g.save.intel = 0;
  g.save.salvage = 0;
  g.save.deepestThreat = 0;
  g.save.runs = 0;
  try { ensureCampaign(g.save); } catch (e) {}
  persist(g.save);
  g.message('Campaign wiped — the Incursion begins again');
}

function starfield(g) {
  const { ctx, view } = g;
  if (!g._stars) {
    const rnd = makeRng('stars');
    g._stars = [];
    for (let i = 0; i < 140; i++) {
      g._stars.push({ x: rnd(), y: rnd(), z: 0.3 + rnd() * 0.7, tw: rnd() * TAU });
    }
  }
  for (const s of g._stars) {
    const a = 0.2 + 0.6 * s.z * (0.6 + 0.4 * Math.sin(g.time * 1.5 + s.tw));
    ctx.fillStyle = `rgba(180,210,255,${a})`;
    const sz = s.z * 1.8;
    ctx.fillRect(s.x * view.w, s.y * view.h, sz, sz);
  }
}

function renderMenu(g) {
  const { ctx, view } = g;
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, view.w, view.h);
  const cx = view.w / 2;

  starfield(g);

  // the gate, drifting slowly behind the title
  ctx.save();
  ctx.globalAlpha = 0.6;
  drawGate(ctx, { x: cx, y: view.h * 0.28 + Math.sin(g.time * 0.4) * 6 }, g.time * 0.6);
  ctx.restore();
  // a faint SGC ramp silhouette across the base
  ctx.fillStyle = 'rgba(20,26,36,0.9)';
  ctx.beginPath();
  ctx.moveTo(0, view.h);
  ctx.lineTo(0, view.h - 60);
  ctx.lineTo(cx - 120, view.h - 60);
  ctx.lineTo(cx - 60, view.h - 130);
  ctx.lineTo(cx + 60, view.h - 130);
  ctx.lineTo(cx + 120, view.h - 60);
  ctx.lineTo(view.w, view.h - 60);
  ctx.lineTo(view.w, view.h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,180,90,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // everything from here is the interactive block — authored for a fixed
  // ~780×560 natural box and drawn through applyUiScale so it never clips a
  // small phone (k=1 on any desktop ≥ ~960×600).
  const NW = 780;
  const NH = 560;
  applyUiScale(g, NW, NH);
  const topY = view.h / 2 - NH / 2;
  const titleY = topY + 150;
  ctx.textAlign = 'center';

  // gate-iris motif behind the wordmark: three concentric chevron rings, turning
  ctx.save();
  ctx.translate(cx, titleY - 6);
  ctx.lineWidth = 2;
  for (let r = 0; r < 3; r++) {
    const rad = 118 - r * 26;
    ctx.strokeStyle = `rgba(120,200,255,${0.06 + r * 0.03})`;
    for (let k = 0; k < 9; k++) {
      const a0 = (k / 9) * TAU + g.time * 0.08 + (r % 2 ? 0.16 : 0);
      ctx.beginPath();
      ctx.arc(0, 0, rad, a0 + 0.05, a0 + TAU / 9 - 0.05);
      ctx.stroke();
    }
  }
  ctx.beginPath(); // don't leave the last arc dangling in the path
  ctx.restore();

  // wordmark — heavy serif for contrast against the all-monospace UI, tracked
  // wide. font shrinks to fit the natural box so it never clips to "ATE CRAWLE".
  ctx.save();
  ctx.shadowBlur = 26;
  ctx.shadowColor = '#39f';
  ctx.fillStyle = '#cfeaff';
  const word = 'GATE CRAWLER';
  const track = 6;
  let fontPx = 52;
  ctx.font = '900 ' + fontPx + 'px Georgia, "Times New Roman", serif';
  while (fontPx > 26 && ctx.measureText(word).width + track * (word.length - 1) > NW - 40) {
    fontPx -= 2;
    ctx.font = '900 ' + fontPx + 'px Georgia, "Times New Roman", serif';
  }
  const tw = ctx.measureText(word).width;
  let lx = cx - (tw + track * (word.length - 1)) / 2;
  ctx.textAlign = 'left';
  for (const ch of word) {
    ctx.fillText(ch, lx, titleY);
    lx += ctx.measureText(ch).width + track;
  }
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#7a9';
  ctx.font = '12px monospace';
  ctx.fillText('P R O C E D U R A L   S G - 1   R O G U E L I T E', cx, titleY + 24);
  ctx.fillStyle = '#6cf';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('v' + VERSION + '   ·   build ' + BUILD, cx, titleY + 42);

  // one-line campaign hook straight off the active Operation
  let hook = 'The System Lords are massing. Hold the line.';
  try {
    const cs = campaignStatus(g.save);
    if (cs) {
      hook = cs.won
        ? 'The Incursion Nexus is dark. Earth endures — deploy anyway.'
        : `${String(cs.activeName || 'The Incursion').toUpperCase()}  ·  ${cs.opsDone}/${cs.opsTotal} operations complete`;
    }
  } catch (e) {}
  ctx.fillStyle = '#e9b96a';
  ctx.font = '12px monospace';
  ctx.fillText(hook, cx, titleY + 62);

  // --- vertical menu ---
  const mBtnW = 300;
  const mBtnH = 40;
  const gap = 8;
  const startY = titleY + 90;
  ctx.textAlign = 'center';
  MENU_ITEMS.forEach((it, i) => {
    const by = startY + i * (mBtnH + gap);
    const sel = i === g.menuSel;
    if (sel) {
      ctx.fillStyle = '#9cf';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('▸', cx - mBtnW / 2 - 16, by + mBtnH / 2 + 6);
    }
    button(g, it.key, cx - mBtnW / 2, by, mBtnW, mBtnH, () => it.fn(g));
  });
  const hintY = startY + MENU_ITEMS.length * (mBtnH + gap) + 10;
  ctx.fillStyle = '#8ad';
  ctx.font = '11px monospace';
  ctx.fillText((MENU_ITEMS[g.menuSel] || MENU_ITEMS[0]).hint, cx, hintY);

  // controls hint + career stats along the bottom of the natural box
  const footY = topY + NH - 22;
  ctx.fillStyle = '#678';
  ctx.font = '11px monospace';
  ctx.fillText('↑↓ / mouse to choose · Enter to select · full controls & rebinding under Settings', cx, footY);
  ctx.fillStyle = '#567';
  ctx.font = '10px monospace';
  ctx.fillText(
    `banked ${g.save.naquadah} N · ${g.save.intel || 0} intel  ·  deepest threat ${g.save.deepestThreat}  ·  sorties ${g.save.runs}  ·  worlds mapped ${g.save.known.length}`,
    cx,
    footY + 16
  );
  endUiScale(g);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#5a7690';
  ctx.font = '10px monospace';
  ctx.fillText(versionLine(), view.w - 10, view.h - 10);
  textReset(ctx);
}

// ---- the SGC hub -------------------------------------------------------------

function renderHub(g) {
  const { ctx, view } = g;
  if (!g.world) return;
  const w = g.world;
  const p = g.player;
  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-g.cam.x, -g.cam.y);
  const woff = g.worldCanvas.offsetY || 0;
  ctx.drawImage(g.worldCanvas, 0, -woff);
  // no fog down here, so the lit wall layer goes straight on
  if (g.worldCanvas.walls) ctx.drawImage(g.worldCanvas.walls, 0, -woff);
  // every static fitting of the base — one blit
  if (g._hubDecor) ctx.drawImage(g._hubDecor, 0, -(g._hubDecor.offsetY || 0));

  const gc = w.gateCenter;
  drawGate(ctx, gc, g.time);
  // the animated layer: screens, klaxon, shimmer, trophy cases, plaque
  drawHubLive(ctx, w, g.time, p, g.save);
  if (w.dialer) drawDialer(ctx, w.dialer, g.time, g._atDialer);

  for (const s of w.stations) drawStation(ctx, s, g.time, g._nearStation === s);

  ctx.globalCompositeOperation = 'lighter';
  for (const pt of g.particles) {
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // personnel + player in one y-sorted pass so nobody stands on anyone
  const cast = [];
  if (g._crew) for (const cr of g._crew) cast.push({ y: cr.y, cr });
  cast.push({ y: p.y, cr: null });
  cast.sort((a, b) => a.y - b.y);
  for (const d of cast) {
    if (!d.cr) {
      drawPlayer(ctx, p, g.time, g);
      continue;
    }
    const col = CREW_COLORS[d.cr.role] || CREW_COLORS.tech;
    drawHumanoid(ctx, d.cr.x, d.cr.y, d.cr.a, 0.95, col[0], col[1], {
      weapon: d.cr.role === 'marine',
      weaponLen: 10,
      weaponColor: 'rgba(200,220,240,0.7)',
      blur: 4,
    });
  }

  ctx.textAlign = 'center';
  if (g._atGate) {
    ctx.fillStyle = '#8ef';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('E  ·  DIAL OUT', gc.x, gc.y + 104);
  }
  if (g._atDialer) {
    ctx.fillStyle = '#8ef';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('E  ·  DIAL THE GATE', w.dialer.x, w.dialer.y + 42);
  }
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#9cf';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('STARGATE COMMAND', 20, 28);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#8ef';
  ctx.fillText(
    `naquadah ${g.save.naquadah}     intel ${g.save.intel || 0}     sorties ${g.save.runs}     deepest threat ${g.save.deepestThreat}`,
    20,
    48
  );
  ctx.fillStyle = '#567';
  ctx.fillText(
    (g._hubRoom ? g._hubRoom.name.toLowerCase() + '   ·   ' : '') +
      'E at a station   ·   dial from the gate or the control room   ·   TAB gear   ·   Q heal',
    20,
    66
  );

  renderMessages(g);
  if (!g.station) drawCrosshair(g);
}

export function panelFrame(g, title, sub) {
  const { ctx, view } = g;
  ctx.fillStyle = 'rgba(4,6,12,0.93)';
  ctx.fillRect(0, 0, view.w, view.h);
  const w = 760;
  const h = 520;
  const x = (view.w - w) / 2;
  const y = (view.h - h) / 2;
  ctx.fillStyle = 'rgba(12,17,26,0.97)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(120,170,220,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#9cf';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, x + 24, y + 34);
  if (sub) {
    ctx.fillStyle = '#678';
    ctx.font = '11px monospace';
    ctx.fillText(sub, x + 24, y + 52);
  }
  ctx.fillStyle = '#8ef';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`naquadah ${g.save.naquadah}   ·   intel ${g.save.intel || 0}`, x + w - 48, y + 34);
  ctx.textAlign = 'left';
  button(g, '✕', x + w - 40, y + 10, 30, 26, () => { g.station = null; });
  return { x, y, w, h };
}

function renderStationPanel(g) {
  if (!g.station || g.station === 'armory') { g.station = null; return; }
  applyUiScale(g, 800, 560); // shrink the whole panel to fit a small viewport
  if (g.station === 'research') renderResearchPanel(g);
  else if (g.station === 'infirmary') renderInfirmaryPanel(g);
  else if (g.station === 'workbench') renderWorkbenchPanel(g);
  else if (g.station === 'operations') renderOperationsPanel(g);
  else if (g.station === 'roster') renderRosterPanel(g);
  else if (g.station === 'base') renderBasePanel(g);
  endUiScale(g);
}

function renderGateMap(g) {
  const { ctx, view } = g;
  // drawn through applyUiScale for a fixed 920×560 natural box — its unscaled
  // 0.9 dim also covers the "PRESS E TO DIAL" / ghost text bleeding through from
  // the dimmed world behind
  const NW = 920;
  const NH = 560;
  applyUiScale(g, NW, NH);
  const top = view.h / 2 - NH / 2;
  const cx = view.w / 2;
  const cy = top + NH / 2 + 6;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8cf';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(g.launching ? 'DIAL OUT — CHOOSE FIRST DESTINATION' : 'GATE NETWORK — SELECT DESTINATION', cx, top + 32);

  glowCircle(ctx, cx, cy, 10, '#6cf', 14);
  ctx.fillStyle = '#9cf';
  ctx.font = '11px monospace';
  ctx.fillText((g.launching ? 'SGC' : g.params.address) + '  (here)', cx, cy + 24);

  const eff = fx(g);
  const wm = worldMods(g);
  const targetHop = g.launching ? eff.startHop || 0 : g.hop + 1;
  // the first step out of the world you arrived in is always free — you can't be
  // stranded. Cost (and the power-siphon tax) only bites when pushing deeper.
  const dialCost = g.launching || g.hop === 0 ? 0 : Math.floor(18 * targetHop * (eff.dialCostMul || 1) * wm.dialMul);
  const canSee = g.launching || (eff.mapLookahead || 0) >= 1;

  if (!g.launching) {
    ctx.fillStyle = dialCost > g.runNaq ? '#f77' : '#8ef';
    ctx.font = '11px monospace';
    ctx.fillText(
      dialCost > 0 ? `powering the gate: ${dialCost} naquadah  (you have ${g.runNaq})` : 'dial is free',
      cx,
      cy + 40
    );
  }

  const n = g.mapNodes.length || 1;
  const R = 196; // fixed natural radius — applyUiScale handles the fit
  g.mapNodes.forEach((node, i) => {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    const pr = node.prev;
    const afford = dialCost <= g.runNaq;
    ctx.strokeStyle = afford ? 'rgba(120,180,255,0.25)' : 'rgba(120,120,130,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    // faction colour + a coarse danger band are always legible off a passive
    // scan; Forward Telemetry only sharpens it to an exact readout + modifiers
    const col =
      pr.faction === 'wraith' ? '#9df7a0' : pr.faction === 'replicator' ? '#8fe4ff' : '#ffb347';
    glowCircle(ctx, x, y, 14, afford ? col : '#556', afford ? 12 : 4);
    ctx.fillStyle = afford ? '#cde' : '#889';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(node.addr, x, y - 22);
    ctx.fillStyle = '#9ab';
    ctx.font = '10px monospace';
    if (canSee) {
      const loot = pr.threat >= 6 ? 'rich' : pr.threat >= 3 ? 'good' : 'light';
      ctx.fillText(clip(`threat ${pr.threat} · ${pr.faction} · loot ${loot}`, 26), x, y + 28);
      if (pr.mods.length) {
        ctx.fillStyle = '#fd6';
        ctx.fillText(clip('[ ' + modLabels(pr.mods).join(' ') + ' ]', 26), x, y + 40);
      }
    } else {
      const band = pr.threat >= 7 ? 'high threat' : pr.threat >= 4 ? 'moderate threat' : 'low threat';
      ctx.fillText(clip(`${pr.faction} · ${band}`, 26), x, y + 28);
      ctx.fillStyle = '#678';
      ctx.fillText('research Forward Telemetry', x, y + 40);
    }
    // campaign markers: an amber flag on worlds that feed the active op, and a
    // red capstone for the fixed finale address once it's unlocked
    let advances = false;
    try {
      advances = worldAdvancesActive(g.save, pr);
    } catch (e) {
      advances = false;
    }
    if (advances) {
      ctx.fillStyle = '#fd6';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('⚑ ADVANCES OP', x, y - 36);
    }
    let finaleReady = false;
    try {
      finaleReady = campaignStatus(g.save).finaleUnlocked;
    } catch (e) {
      finaleReady = false;
    }
    if (node.addr === FINALE_ADDRESS && finaleReady) {
      glowCircle(ctx, x, y, 19, '#ff5a4a', 18);
      ctx.fillStyle = '#ff9a8a';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('THE INCURSION NEXUS', x, y - 36);
    }
    if (afford) {
      const fn = () => {
        if (g.launching) {
          launchRun(g, node.addr);
        } else {
          g.runNaq = Math.max(0, g.runNaq - dialCost);
          g.heat += 0.6 * (eff.heatMul || 1) * wm.heatMul; // pushing deeper stokes the hunt
          startWorld(g, node.addr, targetHop);
        }
      };
      // hit rect must be screen-space while applyUiScale is active (mirrors button())
      const t = g.uiXform;
      const bx = x - 62;
      const by = y - 20;
      g.buttons.push(
        t
          ? { x: t.cx + (bx - t.cx) * t.k, y: t.cy + (by - t.cy) * t.k, w: 124 * t.k, h: 44 * t.k, _node: true, fn }
          : { x: bx, y: by, w: 124, h: 44, _node: true, fn }
      );
    }
  });

  if (g.launching) {
    button(g, 'CANCEL  (Esc)', cx - 90, top + NH - 58, 180, 40, () => {
      g.launching = false;
      enterHub(g);
    });
  } else {
    // an out — the DHD is not a commitment; sits under the title, not over it
    button(g, '‹ STAY ON THIS FLOOR  (Esc)', cx - 130, top + 46, 260, 26, () => {
      g.state = 'play';
    });
    // the decision, spelled out
    ctx.textAlign = 'center';
    ctx.font = '11px monospace';
    ctx.fillStyle = '#9ab';
    const nextThreat = canSee && g.mapNodes[0] ? g.mapNodes[0].prev.threat : null;
    const threatTxt = nextThreat != null ? `threat ${nextThreat}` : `threat unknown`;
    const costTxt = dialCost > 0 ? `pay ${dialCost} naquadah, ` : ``;
    ctx.fillText(
      `DESCEND — ${costTxt}heat rises, ${threatTxt}, better loot` +
        `      ·      DIAL HOME — keep it all, run ends`,
      cx,
      top + NH - 74
    );
    button(g, `DIAL HOME  —  bank ${g.runNaq} naquadah  +  ${g.runIntel} intel`, cx - 210, top + NH - 58, 420, 40, () =>
      dialHome(g)
    );
  }
  textReset(ctx);
  endUiScale(g);
}

// nicer names for the debrief bestiary / kill breakdown; falls back to prettify
const KIND_LABEL = {
  jaffa: 'Jaffa Warrior', jaffa_heavy: 'Jaffa Heavy', jaffa_grenadier: 'Jaffa Grenadier',
  wraith: 'Wraith', wraith_drone: 'Wraith Drone', replicator: 'Replicator',
  replicator_brute: 'Replicator Brute', stalker: 'Stalker', weaver: 'Weaver',
  sniper: 'Sniper', scavenger: 'Scavenger', boss: 'Boss', nexus: 'Incursion Nexus',
};
function kindLabel(k) {
  if (KIND_LABEL[k]) return KIND_LABEL[k];
  return String(k || '?').split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function fmtMMSS(s) {
  s = Math.max(0, s | 0);
  return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0');
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ debrief — floating combat text, boss bar, unlock cards, run debrief
// ──────────────────────────────────────────────────────────────────────────
function reduceFlash(g) {
  return !!(g.save && g.save.settings && g.save.settings.reduceFlash);
}
// push a rising, fading tick at world (x,y). suppressed entirely by reduceFlash.
function pushFloat(g, x, y, txt, color, size) {
  if (!g.floats || reduceFlash(g)) return null;
  if (g.floats.length > 40) g.floats.shift();
  const o = { x, y, vy: -34, t: 0.75, txt, color: color || '#fff', size: size || 11 };
  g.floats.push(o);
  return o;
}
function updateFloats(g, dt) {
  const f = g.floats;
  if (!f || !f.length) return;
  for (let i = f.length - 1; i >= 0; i--) {
    const o = f[i];
    o.t -= dt;
    o.y += o.vy * dt;
    o.vy += 26 * dt; // ease the rise
    if (o.t <= 0) f.splice(i, 1);
  }
}
// world-space draw from renderPlay's UI layer (inside the camera transform)
function drawFloatText(g) {
  const f = g.floats;
  if (!f || !f.length) return;
  const { ctx } = g;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < f.length; i++) {
    const o = f[i];
    ctx.globalAlpha = clamp(o.t / 0.4, 0, 1);
    ctx.fillStyle = o.color;
    ctx.font = 'bold ' + o.size + 'px monospace';
    ctx.fillText(o.txt, o.x, o.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  textReset(ctx);
}

// ---- boss / nexus health bar ---------------------------------------------
function drawBossBar(g) {
  if (!g.world || g.state === 'hub') return;
  let e = null;
  for (const en of g.enemies) {
    if (en.alive && (en.kind === 'boss' || en.kind === 'nexus') && en.state !== 'idle') { e = en; break; }
  }
  if (!e) return;
  const { ctx, view } = g;
  const nexus = e.kind === 'nexus';
  const v = e.variant || (g.params && (g.params.faction || g.params.primary)) || 'jaffa';
  const name = nexus ? 'THE INCURSION NEXUS' : (BOSS_NAME[v] || 'BOSS').toUpperCase();
  const sub = nexus ? 'ASSIMILATION CORE' : (BOSS_SUB[v] || '').toUpperCase();
  const tint = nexus ? '#8fe4ff' : (BOSS_TINT[v] || '#ffb347');
  // compact on a small (mobile landscape) viewport — thinner, higher, no subtitle
  const compact = Math.min(view.w, view.h) < 460;
  const barH = compact ? 5 : 8;
  const w = compact ? Math.min(320, view.w - 44) : Math.min(560, view.w - 120);
  const x = (view.w - w) / 2;
  const y = compact ? 18 : 54;
  const hf = clamp(e.hp / (e.maxHp || 1), 0, 1);
  ctx.save();
  textReset(ctx);
  ctx.textAlign = 'center';
  ctx.fillStyle = compact ? 'rgba(6,8,12,0.5)' : 'rgba(6,8,12,0.66)';
  ctx.fillRect(x - 6, y - (compact ? 12 : 16), w + 12, compact ? 22 : 34);
  const segs = 24;
  const sw = w / segs;
  for (let i = 0; i < segs; i++) {
    ctx.fillStyle = i / segs < hf ? tint : 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + i * sw + 1, y, sw - 2, barH);
  }
  ctx.strokeStyle = hexA(tint, 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, barH);
  if (e.shield > 0) {
    const smax = nexus ? 240 : (v === 'jaffa' ? 90 : 70);
    ctx.fillStyle = 'rgba(125,211,252,0.85)';
    ctx.fillRect(x, y - 3, w * clamp(e.shield / smax, 0, 1), 3);
  }
  ctx.fillStyle = '#fff';
  ctx.font = compact ? 'bold 9px monospace' : 'bold 12px monospace';
  const imm = (nexus || v === 'replicator') && e.immuneType && (e.shield > 0 || !nexus)
    ? (e.immuneType === 'kinetic' ? '  ·  KINETIC-IMMUNE' : '  ·  ENERGY-IMMUNE') : '';
  ctx.fillText(name + (compact ? imm : ''), view.w / 2, y - 4);
  if (sub && !compact) {
    ctx.fillStyle = hexA(tint, 0.85);
    ctx.font = '9px monospace';
    ctx.fillText(sub, view.w / 2, y + 17);
  }
  const phases = nexus ? 3 : 2;
  const cur = nexus ? (e.phase || 1) : (e.phase2 ? 2 : 1);
  for (let i = 0; i < phases; i++) {
    ctx.fillStyle = i < cur ? tint : 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x + w + 9 + i * 8, y + barH / 2, compact ? 2.4 : 3, 0, TAU);
    ctx.fill();
  }
  if (imm && !compact) {
    ctx.fillStyle = e.immuneType === 'kinetic' ? '#ff9678' : '#96c8ff';
    ctx.font = '9px monospace';
    ctx.fillText(imm.replace('  ·  ', ''), view.w / 2, y + 28);
  }
  ctx.restore();
  textReset(ctx);
}

// ---- unlock card --------------------------------------------------------
// exported so stationpanels.js's research / operations handlers can raise it
export function showUnlock(g, title, sub) {
  g.unlockCard = { title, sub: sub || '', t: 3.0 };
}
function drawUnlockCard(g, dt) {
  const c = g.unlockCard;
  if (!c) return;
  c.t -= dt || 0;
  if (c.t <= 0) { g.unlockCard = null; return; }
  const { ctx, view } = g;
  const inP = clamp((3.0 - c.t) / 0.3, 0, 1);
  const a = Math.min(inP, clamp(c.t / 0.4, 0, 1));
  const cw = 320, ch = 46;
  const cx0 = (view.w - cw) / 2;
  const cy0 = 84 - (1 - inP) * 20;
  ctx.save();
  textReset(ctx);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(8,12,20,0.92)';
  ctx.fillRect(cx0, cy0, cw, ch);
  ctx.strokeStyle = '#ffd24a';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cw - 1, ch - 1);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd24a';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(c.title, view.w / 2, cy0 + 19);
  if (c.sub) {
    ctx.fillStyle = '#cde';
    ctx.font = '10px monospace';
    ctx.fillText(c.sub, view.w / 2, cy0 + 35);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  textReset(ctx);
}

// ---- run debrief ---------------------------------------------------------
function buildDebrief(g, outcome) {
  const rs = g.runStats || {
    kills: {}, killsTotal: 0, bosses: 0, dmgTaken: 0, hits: 0, bestStreak: 0,
    naqStart: g.save.naquadah, intelStart: g.save.intel || 0, salvStart: g.save.salvage || 0,
    t0: g.time, itemsFound: 0, newBestiary: [], deepestThreat: 0, special: [],
  };
  const topKinds = Object.keys(rs.kills)
    .sort((a, b) => rs.kills[b] - rs.kills[a])
    .slice(0, 3)
    .map((k) => ({ name: kindLabel(k), n: rs.kills[k] }));

  let opNow = null;
  try { opNow = operationProgress(g.save); } catch (err) { opNow = null; }
  const snap = g._opSnapshot;
  const opDeltas = [];
  let opJustCompleted = false;
  if (opNow && opNow.op) {
    for (const o of opNow.objectives) {
      const s0 = snap && snap.objectives ? snap.objectives.find((x) => x.id === o.id) : null;
      opDeltas.push({ label: objectiveLabel(o), before: s0 ? s0.have : 0, after: o.have, need: o.need, done: o.done });
    }
    opJustCompleted = !!opNow.allDone && !(snap && snap.allDone);
  }

  const depth = rs.deepestThreat || (g.params && g.params.threat) || (g.deadInfo && g.deadInfo.depth) || 0;
  g.debrief = {
    outcome,
    addr: (g.params && g.params.address) || (g.deadInfo && g.deadInfo.addr) || '',
    threat: depth,
    time: Math.max(0, g.time - rs.t0),
    killsTotal: rs.killsTotal,
    topKinds,
    bosses: rs.bosses,
    dmgTaken: Math.round(rs.dmgTaken),
    hits: rs.hits,
    bestStreak: rs.bestStreak,
    naqGain: g.save.naquadah - rs.naqStart,
    intelGain: (g.save.intel || 0) - rs.intelStart,
    salvGain: (g.save.salvage || 0) - rs.salvStart,
    itemsFound: rs.itemsFound,
    bankedBefore: rs.naqStart,
    bankedAfter: g.save.naquadah,
    opName: opNow && opNow.op ? (opNow.op.name || opNow.op.title || opNow.op.id) : null,
    opDeltas,
    opJustCompleted,
    newBestiary: (rs.newBestiary || []).slice(0, 8),
    special: (rs.special || []).slice(0, 6),
    lost: g.deadInfo ? g.deadInfo.lost : 0,
  };
}

function debriefContinue(g) {
  g.debrief = null;
  enterHub(g);
}

function renderDebrief(g) {
  const { ctx, view } = g;
  const d = g.debrief;
  if (!d) return renderDead(g);
  textReset(ctx);
  ctx.fillStyle = 'rgba(6,8,14,0.86)';
  ctx.fillRect(0, 0, view.w, view.h);

  const kia = d.outcome === 'KIA';
  const w = Math.min(900, view.w - 60);
  const h = Math.min(612, view.h - 60);
  const x = (view.w - w) / 2;
  const y = (view.h - h) / 2;
  ctx.fillStyle = 'rgba(10,14,22,0.97)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = kia ? 'rgba(232,86,77,0.6)' : 'rgba(94,200,106,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pad = 28;
  const ix = x + pad;
  const iw = w - pad * 2;
  let hy = y + 46;
  ctx.textAlign = 'left';
  ctx.fillStyle = kia ? '#e8564d' : '#5ec86a';
  ctx.shadowBlur = 14;
  ctx.shadowColor = kia ? '#900' : '#063';
  ctx.font = 'bold 30px monospace';
  ctx.fillText(kia ? 'K I A' : 'EXTRACTED', ix, hy);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9cf';
  ctx.font = '12px monospace';
  ctx.fillText(d.addr || '—', x + w - pad, hy - 14);
  ctx.fillStyle = '#8ab';
  ctx.fillText('deepest threat ' + d.threat + '     run time ' + fmtMMSS(d.time), x + w - pad, hy + 4);
  ctx.textAlign = 'left';
  hy += 22;

  if (d.opJustCompleted) {
    ctx.fillStyle = 'rgba(94,200,106,0.16)';
    ctx.fillRect(ix, hy, iw, 24);
    ctx.fillStyle = '#7fe0a0';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('OPERATION ' + String(d.opName || '').toUpperCase() + ' — OBJECTIVES MET  ·  CLAIM AT THE SGC', ix + 8, hy + 16);
    hy += 34;
  } else {
    hy += 8;
  }

  const colGap = 22;
  const colW = (iw - colGap * 2) / 3;
  const colX = [ix, ix + colW + colGap, ix + (colW + colGap) * 2];
  const colTop = hy;
  const lh = 16;

  const heading = (cx0, txt) => {
    ctx.fillStyle = '#9cf';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(txt, cx0, colTop);
  };
  const rows = (cx0, list) => {
    let ry = colTop + 22;
    const maxY = y + h - 66;
    ctx.font = '11px monospace';
    for (const ln of list) {
      for (const seg of wrapLines(ctx, ln.t, colW)) {
        if (ry > maxY) return ry;
        ctx.fillStyle = ln.c || '#cde';
        ctx.fillText(seg, cx0, ry);
        ry += lh;
      }
    }
    return ry;
  };

  heading(colX[0], 'COMBAT');
  const combat = [{ t: 'Kills  ' + d.killsTotal }];
  for (const k of d.topKinds) combat.push({ t: '  ' + k.name + ' x' + k.n, c: '#9ab' });
  combat.push({ t: 'Bosses down  ' + d.bosses });
  combat.push({ t: 'Damage taken  ' + d.dmgTaken });
  combat.push({ t: 'Shots on target  ' + d.hits });
  combat.push({ t: 'Best kill streak  ' + d.bestStreak });
  rows(colX[0], combat);

  heading(colX[1], 'RECOVERED');
  const rec = [
    { t: 'Naquadah  +' + d.naqGain, c: '#8ef' },
    { t: 'Intel  +' + d.intelGain, c: '#b6f0ff' },
  ];
  if (d.salvGain) rec.push({ t: 'Salvage  +' + d.salvGain, c: '#dca' });
  rec.push({ t: 'Items carried out  ' + d.itemsFound });
  if (kia && d.lost) rec.push({ t: 'Backpack lost  ' + d.lost + ' items', c: '#e88' });
  rec.push({ t: 'Banked naquadah', c: '#9ab' });
  rec.push({ t: '  ' + d.bankedBefore + '  ->  ' + d.bankedAfter, c: '#8ef' });
  rows(colX[1], rec);

  heading(colX[2], 'THE INCURSION');
  const inc = [];
  if (d.opName) inc.push({ t: d.opName, c: '#9cf' });
  if (d.opDeltas.length) {
    for (const o of d.opDeltas) {
      inc.push({ t: (o.done ? '[x] ' : '[ ] ') + o.label, c: o.done ? '#7fe0a0' : '#cde' });
      inc.push({ t: '     ' + o.before + ' -> ' + o.after + ' / ' + o.need, c: '#9ab' });
    }
  } else {
    inc.push({ t: 'No active operation.', c: '#9ab' });
  }
  if (d.opJustCompleted) inc.push({ t: 'Claim the reward at the SGC Operations desk.', c: '#7fe0a0' });
  if (d.newBestiary.length) {
    inc.push({ t: 'New in the codex:', c: '#cda' });
    inc.push({ t: '  ' + d.newBestiary.join(', '), c: '#9ab' });
  }
  for (const s of d.special) inc.push({ t: '- ' + s, c: '#bda' });
  rows(colX[2], inc);

  const bw = 300;
  button(g, 'CONTINUE   (Enter)', view.w / 2 - bw / 2, y + h - 52, bw, 38, () => debriefContinue(g));
  textReset(ctx);
}

function renderDead(g) {
  if (g.debrief) return renderDebrief(g);
  const { ctx, view } = g;
  ctx.fillStyle = 'rgba(10,4,8,0.75)';
  ctx.fillRect(0, 0, view.w, view.h);
  const cx = view.w / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f77';
  ctx.shadowBlur = 16;
  ctx.shadowColor = '#900';
  ctx.font = 'bold 42px monospace';
  ctx.fillText('MISSION LOST', cx, view.h * 0.38);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#dbe';
  ctx.font = '15px monospace';
  const info = g.deadInfo || { naq: 0, intel: 0, depth: 0, addr: '', lost: 0 };
  ctx.fillText(`KIA at ${info.addr}   —   sector depth ${info.depth}`, cx, view.h * 0.38 + 40);
  ctx.fillText(
    `MALP recovered ${info.naq} naquadah  ·  ${info.intel} intel${info.lost ? `  ·  backpack lost (${info.lost} items)` : ''}`,
    cx,
    view.h * 0.38 + 64
  );
  ctx.fillStyle = '#9ab';
  ctx.font = '12px monospace';
  ctx.fillText('equipped gear, hotbar and the SGC stash were retained', cx, view.h * 0.38 + 84);
  button(g, 'RETURN TO SGC   (Enter)', cx - 150, view.h * 0.38 + 108, 300, 44, () => enterHub(g));
}
