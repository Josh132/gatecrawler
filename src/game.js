import { keys, mouse, pressed, endFrameInput } from './input.js';
import { WEAPONS } from './weapons.js';
import { sfx } from './audio.js';
import { TAU, clamp, glowCircle } from './draw.js';
import { makeRng, rngHelpers } from './rng.js';
import { HOME, neighbors, worldParams } from './address.js';
import { buildWorld, bakeWorld, TILE, tileAt } from './worldgen.js';
import { makeFlowField } from './pathfind.js';
import { Player, Enemy, Bullet, Pickup, Grenade, Block, Particle, Decal, Hazard, circleVsGrid } from './entities.js';
import { ITEMS, EQUIP_SLOTS } from './items.js';
import { buildHub, drawStation } from './hub.js';
import {
  createInventory,
  reviveInventory,
  invAdd,
  invHasSpace,
  moveStack,
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

const SAVE_KEY = 'gatecrawler.save.v1';
const rr = (a, b) => a + Math.random() * (b - a);

function defaultSave() {
  return { naquadah: 0, intel: 0, tech: [], maxHpBonus: 0, deepestThreat: 0, runs: 0, known: [HOME], inv: null };
}

// merged tech-tree effects — replaced by tech.js's techEffects() once that lands
function techEffectsFallback() {
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
let techEffects = techEffectsFallback;
let TECH = [];
let canResearch = () => false;
let nodeById = () => null;
let researchCost = (id) => ({ naquadah: 0 });
let drawItemIcon = null;
let rarityOf = () => 'common';
let RARITY_COLOR = { common: '#8aa0b8', uncommon: '#79d17a', rare: '#c98bff' };
try {
  const mod = await import('./tech.js');
  if (typeof mod.techEffects === 'function') techEffects = mod.techEffects;
  if (Array.isArray(mod.TECH)) TECH = mod.TECH;
  if (typeof mod.canResearch === 'function') canResearch = mod.canResearch;
  if (typeof mod.nodeById === 'function') nodeById = mod.nodeById;
  if (typeof mod.researchCost === 'function') researchCost = mod.researchCost;
} catch (e) {
  /* tech.js not present yet — use the fallback */
}
try {
  const ic = await import('./icons.js');
  if (typeof ic.drawItemIcon === 'function') drawItemIcon = ic.drawItemIcon;
  if (typeof ic.rarityOf === 'function') rarityOf = ic.rarityOf;
  if (ic.RARITY_COLOR) RARITY_COLOR = ic.RARITY_COLOR;
} catch (e) {
  /* icons.js not present yet */
}
function fx(g) {
  return techEffects(g.save.tech || []);
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return Object.assign(defaultSave(), JSON.parse(raw));
  } catch (e) {
    /* ignore */
  }
  return defaultSave();
}
function persist(s) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch (e) {
    /* ignore */
  }
}

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
    station: null, // open station panel in the hub: 'research' | 'infirmary' | 'requisitions'
    launching: false, // gate map is picking the FIRST destination of a new run
    runIntel: 0,
    wheel: 0,
    inv: null,
    panelOpen: false,
    drag: null, // { from:{kind,i,key}, id, count }
    pmouse: { x: 0, y: 0 },
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
    mapNodes: [],
    deadInfo: null,
    visPoly: null,
    visEnabled: true,
    fps: 0,
    _facc: 0,
    _fcount: 0,
  };

  g.inv = reviveInventory(g.save.inv);
  g.save.inv = g.inv; // keep the persisted blob pointed at the live inventory

  g.message = (txt) => {
    g.messages.push({ txt, t: 3 });
    while (g.messages.length > 4) g.messages.shift();
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

// ---------------------------------------------------------------- run lifecycle

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
  g.flow = makeFlowField(w.grid, w.W, w.H);
  g.params = { address: 'SGC', threat: 0, faction: 'sgc', primary: 'sgc', mods: [], hop: 0, seedStr: 'sgc' };
  g.enemies = [];
  g.bullets = [];
  g.grenades = [];
  g.blocks = [];
  g.hazards = [];
  g.decals = [];
  g.pickups = [];
  g.particles = [];
  g.hub = true;
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
  g.curRoom = w.rooms[0];
  g.state = 'hub';
  persist(g.save);
  g.message('Stargate Command — SG-1');
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
  g.hub = false;
  g.launching = false;
  g.runNaq = 0;
  g.runIntel = 0;
  g.heat = 0;
  g._firstWorld = true;
  const hop = e.startHop || 0;
  startWorld(g, addr || g.save.lastAddress || HOME, hop);
}

function startWorld(g, addr, hop) {
  g.params = worldParams(addr, hop);
  g.world = buildWorld(g.params);
  g.worldCanvas = bakeWorld(g.world);
  g.flow = makeFlowField(g.world.grid, g.world.W, g.world.H);
  g.enemies = [];
  g.bullets = [];
  g.grenades = [];
  g.blocks = [];
  g.hazards = [];
  g.decals = [];
  g.pickups = [];
  g.particles = [];
  g.killStreak = 0;
  g.killStreakT = 0;
  g.panelOpen = false;
  g.drag = null;
  g.hunterSpawned = false;
  g.hub = false;
  if (hop > 0 && !g._firstWorld) g.heat += 0.35 * fx(g).heatMul; // the hunt intensifies the deeper you push
  g._firstWorld = false;
  g.save.lastAddress = worldParams(addr, hop).address;
  g.hop = hop;
  g.dhdActive = false;
  g.emp = false;
  g.empT = 10;
  g.flowT = 0;
  g.time = 0;

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

  g.save.known = Array.from(new Set([...g.save.known, g.params.address]));
  g.save.deepestThreat = Math.max(g.save.deepestThreat, g.params.threat);
  persist(g.save);

  g.flow.compute(
    clamp(Math.floor(p.x / TILE), 0, g.world.W - 1),
    clamp(Math.floor(p.y / TILE), 0, g.world.H - 1)
  );

  kawoosh(g, c.x, c.y);
  sfx.kawoosh();
  g.message('Arrived: ' + g.params.address + (g.params.mods.length ? '  [' + g.params.mods.join(', ') + ']' : ''));
}

function dialHome(g) {
  g.save.naquadah += g.runNaq;
  g.save.intel = (g.save.intel || 0) + g.runIntel;
  g.save.runs += 1;
  if (g.params) g.save.deepestThreat = Math.max(g.save.deepestThreat, g.params.threat);
  g.runNaq = 0;
  g.runIntel = 0;
  enterHub(g);
  g.message('Returned to SGC. Naquadah & intel banked.');
}

function onDeath(g) {
  const p = g.player;
  const e = fx(g);
  if (e.freeRevive && !g._revived) {
    g._revived = true;
    p.hp = Math.max(1, Math.round(p.maxHp * 0.5));
    p.iframe = 1.6;
    g.shake = 22;
    g.message('MEDICAL OVERRIDE — revive spent');
    return;
  }
  p.alive = false;
  const keptN = Math.floor(g.runNaq * (e.deathKeepFrac != null ? e.deathKeepFrac : 0.5));
  g.save.naquadah += keptN;
  g.save.intel = (g.save.intel || 0) + g.runIntel; // intel is knowledge — recovered in full
  g.save.runs += 1;
  // the backpack is lost; equipped gear, hotbar and the SGC stash survive
  const lost = g.inv.grid.filter(Boolean).length;
  g.inv.grid = g.inv.grid.map(() => null);
  saveInv(g);
  g.deadInfo = { naq: keptN, intel: g.runIntel, depth: g.hop, addr: g.params ? g.params.address : '', lost };
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
    invAdd(g.inv, g.drag.id, g.drag.count);
    g.drag = null;
  }
  if (!g.panelOpen) {
    saveInv(g);
    mouse.down = false;
  }
}

function saveInv(g) {
  g.save.inv = g.inv;
  persist(g.save);
}

// ---------------------------------------------------------------- update

function update(g, dt) {
  g.time += dt;
  for (const m of g.messages) m.t -= dt;
  if (g.messages.length && g.messages[0].t <= 0) g.messages = g.messages.filter((m) => m.t > 0);

  if (g.state === 'play') {
    if (pressed('Tab') || pressed('KeyI')) togglePanel(g);
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
    if (g.launching && pressed('Escape')) {
      g.launching = false;
      enterHub(g);
    }
  } else if (g.state === 'dead') {
    if (pressed('Enter')) enterHub(g);
  } else if (g.state === 'menu') {
    if (pressed('Enter')) enterHub(g);
  }

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
  arr[sel.i].count -= 1;
  if (arr[sel.i].count <= 0) arr[sel.i] = null;
  const amt = ITEMS[id].amount;
  p.hp = Math.min(p.maxHp, p.hp + amt);
  g.message('+' + amt + ' HP  (' + ITEMS[id].name + ')');
  sfx.pickup();
  for (let k = 0; k < 8; k++) {
    g.particles.push(new Particle(p.x, p.y, rr(-70, 70), rr(-70, 70), 0.4, '#7ef77e', 2));
  }
  saveInv(g);
}

function medCount(g) {
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
  if (pressed('Tab') || pressed('KeyI')) {
    togglePanel(g);
    return;
  }
  if (pressed('KeyQ')) quickHeal(g);

  g.mouse.wx = mouse.x - g.view.w / 2 + g.cam.x;
  g.mouse.wy = mouse.y - g.view.h / 2 + g.cam.y;
  let ix = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let iy = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
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
  g._atGate = (w.gateCenter.x - p.x) ** 2 + (w.gateCenter.y - p.y) ** 2 < 62 * 62;

  if (pressed('KeyE')) {
    if (near) {
      if (near.kind === 'armory') g.panelOpen = true;
      else g.station = near.kind;
    } else if (g._atGate) {
      g.launching = true;
      buildGateMap(g);
      g.state = 'gatemap';
    }
  }

  g.cam.x += (p.x - g.cam.x) * Math.min(1, 6 * dt);
  g.cam.y += (p.y - g.cam.y) * Math.min(1, 6 * dt);
  clampCam(g);
}

function updatePlay(g, dt) {
  const p = g.player;
  const w = g.world;

  p.dodgeCd = Math.max(0, p.dodgeCd - dt);
  p.iframe = Math.max(0, p.iframe - dt);
  p.flash = Math.max(0, p.flash - dt);
  if (p.dodge > 0) p.dodge -= dt;
  if (p.stun > 0) p.stun -= dt;
  if (p.stimT > 0) p.stimT -= dt;
  if (p.shieldMax > 0) {
    p.shieldRegenT += dt;
    if (p.shieldRegenT > 3 && p.shield < p.shieldMax) p.shield = Math.min(p.shieldMax, p.shield + 12 * dt);
  }
  const stim = p.stimT > 0;

  g.mouse.wx = mouse.x - g.view.w / 2 + g.cam.x;
  g.mouse.wy = mouse.y - g.view.h / 2 + g.cam.y;
  p.aim = Math.atan2(g.mouse.wy - p.y, g.mouse.wx - p.x);

  let ix = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let iy = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
  if (ix || iy) {
    const l = Math.hypot(ix, iy);
    ix /= l;
    iy /= l;
  }

  const spd = p.speed * (stim ? 1.35 : 1);
  if (p.dodge > 0) {
    p.x += p.ddx * 470 * dt;
    p.y += p.ddy * 470 * dt;
  } else if (p.stun <= 0) {
    if (pressed('Space') && p.dodgeCd <= 0 && (ix || iy)) {
      p.dodge = 0.26;
      p.iframe = 0.3;
      p.dodgeCd = 0.8;
      p.ddx = ix;
      p.ddy = iy;
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

  // hotbar consumables / quick-heal / weapon swap / grenade
  for (let i = 0; i < HOTBAR; i++) if (pressed('Digit' + (i + 1))) useHotbar(g, i);
  if (pressed('KeyQ')) quickHeal(g);
  if (pressed('KeyX') || g.wheel) {
    g.wheel = 0;
    cancelReload(p); // swapping weapons aborts a reload in progress
    p.burstN = 0;
    const wid = toggleWeapon(g.inv);
    g.message('Weapon: ' + (ITEMS[weaponItemId(g.inv)] ? ITEMS[weaponItemId(g.inv)].name : wid));
  }
  if (pressed('KeyG')) throwGrenade(g);

  // fire
  p.cool -= dt;
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(p);
  }
  const wid = activeWeaponId(g.inv);
  const wp = WEAPONS[wid];
  const hasMag = wp.mag != null;
  if (wp.ammoMax !== Infinity && p.ammo[wid] == null) p.ammo[wid] = wp.ammoMax; // first pickup grants a full reserve
  if (hasMag && p.mag[wid] == null) p.mag[wid] = Math.min(wp.mag, p.ammo[wid] || 0);

  // manual reload (R)
  if (hasMag && pressed('KeyR') && p.reloadT <= 0 && (p.mag[wid] || 0) < wp.mag && (p.ammo[wid] || 0) > 0) {
    startReload(g, p, wid);
  }

  const coolMul = stim ? 0.6 : 1;

  if (wp.hitscan) {
    fireBeam(g, p, wp, dt);
  } else {
    if (p.beam && p.beam.on) { sfx.beam(false); p.beam.on = false; }
    const mdEdge = mouse.down && !g.mouseWasDown;
    const wantFire = wp.auto ? mouse.down : mdEdge;
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
        p.cool = wp.fireRate * coolMul;
        if (wp.burst > 1) {
          p.burstWid = wid;
          p.burstN = wp.burst - 1;
          p.burstT = wp.burstDelay || 0.06;
        }
        if (hasMag && (p.mag[wid] || 0) <= 0 && (p.ammo[wid] || 0) > 0 && !(wp.burst > 1)) startReload(g, p, wid);
      }
    }
  }

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
  }

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

  // heat: the longer a run goes, the harder the faction hunts you
  g.heat += dt * 0.018 * (fx(g).heatMul || 1);
  if (!g.hunterSpawned && Math.floor(g.heat) >= 3) spawnHunter(g);

  if (g.killStreakT > 0) {
    g.killStreakT -= dt;
    if (g.killStreakT <= 0) g.killStreak = 0;
  }

  // lingering plasma hazards from grenadier shells
  for (const hz of g.hazards) {
    hz.life -= dt;
    hz.phase += dt * 6;
    if (hz.life <= 0) {
      hz.alive = false;
      continue;
    }
    if (hz.from === 'enemy') {
      hz.tick -= dt;
      const pd = Math.hypot(p.x - hz.x, p.y - hz.y);
      if (pd < hz.r && p.iframe <= 0 && p.dodge <= 0 && hz.tick <= 0) {
        hz.tick = 0.2;
        damagePlayer(g, hz.dps * 0.2, p.x - hz.x, p.y - hz.y);
      }
    }
    if (Math.random() < 0.5) {
      const a = rr(0, TAU);
      const d = Math.sqrt(Math.random()) * hz.r;
      g.particles.push(
        new Particle(hz.x + Math.cos(a) * d, hz.y + Math.sin(a) * d, rr(-8, 8), rr(-30, -8), rr(0.3, 0.7), '#ff9a3c', rr(1.5, 3))
      );
    }
  }

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
        g.enemies.push(nb);
        burst(g, bl.x, bl.y, 18, '#b6f0ff');
        g.message('Replicator reassembles');
      } else {
        bl.alive = false;
        spark(g, bl.x, bl.y, '#b6f0ff');
      }
    }
  }

  // enemies
  for (const e of g.enemies) {
    if (!e.alive) continue;
    e.flash = Math.max(0, e.flash - dt);
    if (e.kind === 'jaffa') updateJaffa(g, e, dt);
    else if (e.kind === 'jaffa_heavy') updateJaffaHeavy(g, e, dt);
    else if (e.kind === 'jaffa_grenadier') updateGrenadier(g, e, dt);
    else if (e.kind === 'wraith') updateWraith(g, e, dt);
    else if (e.kind === 'wraith_drone') updateWraithDrone(g, e, dt);
    else if (e.kind === 'replicator') updateReplicator(g, e, dt);
    else if (e.kind === 'replicator_brute') updateReplicator(g, e, dt, true);
    else updateBoss(g, e, dt);
    e.x += e.kx * dt;
    e.y += e.ky * dt;
    e.kx -= e.kx * Math.min(1, 8 * dt);
    e.ky -= e.ky * Math.min(1, 8 * dt);
    ({ x: e.x, y: e.y } = circleVsGrid(w, e, e.x, e.y));
  }

  // cap how many enemies from other rooms can pile onto the player at once —
  // the farthest extras stand down (dormant) until the player comes to them
  const migrants = g.enemies.filter(
    (e) => e.alive && e.state === 'active' && !e.hunter && e._room !== g.curRoom
  );
  const migCap = g.curRoom && g.curRoom.kind === 'dhd' ? 2 : 4;
  if (migrants.length > migCap) {
    migrants.sort((a, b) => Math.hypot(b.x - p.x, b.y - p.y) - Math.hypot(a.x - p.x, a.y - p.y));
    for (let i = 0; i < migrants.length - migCap; i++) {
      migrants[i].state = 'dormant';
      migrants[i].mode = 'advance';
      migrants[i].cover = null;
    }
  }

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

  g.enemies = g.enemies.filter((e) => e.alive);
  g.bullets = g.bullets.filter((b) => b.alive);
  g.grenades = g.grenades.filter((x) => x.alive);
  g.blocks = g.blocks.filter((x) => x.alive);
  g.hazards = g.hazards.filter((x) => x.alive);
  g.pickups = g.pickups.filter((x) => x.alive);
  g.particles = g.particles.filter((x) => x.alive);

  // room-cleared checks
  for (const rm of w.rooms) {
    if (rm.populated && !rm.cleared && !g.enemies.some((e) => e._room === rm)) {
      rm.cleared = true;
      if (rm.kind === 'dhd') {
        g.dhdActive = true;
        g.message('DHD online — approach and press E to dial');
        sfx.pickup();
      } else {
        g.message('Sector clear');
      }
    }
  }

  updateModifiers(g, dt);

  if (g.dhdActive) {
    const c = w.dhdRoom.centerPx;
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 54 * 54 && pressed('KeyE')) {
      buildGateMap(g);
      g.state = 'gatemap';
    }
  }

  if (p.hp <= 0 && p.alive) onDeath(g);

  // camera
  const laX = Math.cos(p.aim) * 55;
  const laY = Math.sin(p.aim) * 55;
  g.cam.x += (p.x + laX - g.cam.x) * Math.min(1, 6 * dt);
  g.cam.y += (p.y + laY - g.cam.y) * Math.min(1, 6 * dt);
  clampCam(g);
  g.shake -= g.shake * Math.min(1, 5 * dt);
  if (g.shake < 0.2) g.shake = 0;
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

// ---------------------------------------------------------------- spawning

function findRoom(g, x, y) {
  for (const r of g.world.rooms) {
    const R = r.rectPx;
    if (x >= R.x && x <= R.x + R.w && y >= R.y && y <= R.y + R.h) return r;
  }
  return null;
}

// weighted floor loot: {id, count}
function rollLoot(R, threat) {
  const roll = R.rand();
  if (roll < 0.34) return { id: R.chance(0.4) ? 'medkit' : 'bandage', count: R.chance(0.3) ? 2 : 1 };
  if (roll < 0.5) return { id: 'stim', count: 1 };
  if (roll < 0.62) return { id: 'shieldcell', count: 1 };
  if (roll < 0.76) return { id: 'frag', count: R.int(1, 2) };
  if (roll < 0.9) {
    const armor = R.chance(0.35 + Math.min(0.3, threat * 0.04))
      ? R.pick(['a_helm', 'a_plate'])
      : R.pick(['a_visor', 'a_vest', 'a_greaves', 'a_boots']);
    return { id: armor, count: 1 };
  }
  // launcher is deliberately scarce; everything else shares the common weapon roll
  const wid = R.chance(0.12) ? 'w_launcher' : R.pick(['w_staff', 'w_zat', 'w_shotgun', 'w_burst', 'w_beam']);
  return { id: wid, count: 1 };
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
  if (fac === 'wraith') return R.chance(0.5) ? 'wraith_drone' : 'wraith';
  if (fac === 'replicator') return slot.brutes < 1 && R.chance(0.2) ? ((slot.brutes++), 'replicator_brute') : 'replicator';
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
  for (const room of g.world.rooms) {
    room.populated = true;
    if (room.kind === 'gate') {
      room.cleared = true;
      continue;
    }
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
    const slot = { heavies: 0, brutes: 0, grenadiers: 0 };

    if (room.kind === 'dhd') {
      const c = room.centerPx;
      const boss = new Enemy('boss', c.x, c.y - 80, p.threat, { variant: fac });
      boss._room = room;
      g.enemies.push(boss);
      const guards = 1 + Math.min(2, Math.floor(p.threat / 2));
      for (let i = 0; i < guards; i++) {
        const q = placeXY();
        const e = new Enemy(guardKind(fac, R, slot), q.x, q.y, p.threat);
        e._room = room;
        e.aggressive = true;
        g.enemies.push(e);
      }
      continue;
    }

    const count = Math.min(7, 3 + Math.floor(p.threat / 2) + R.int(0, 1) + heatTier + (fac === 'replicator' ? 1 : 0));
    for (let i = 0; i < count; i++) {
      const kind = pickEnemyKind(fac, R, slot);
      const q = placeXY();
      const e = new Enemy(kind, q.x, q.y, p.threat);
      e._room = room;
      if (kind === 'jaffa') e.aggressive = R.chance(0.4);
      if (kind === 'jaffa_heavy' || kind === 'replicator_brute') e.aggressive = true;
      g.enemies.push(e);
    }

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
    // intel cache — data recovered from the faction's systems
    if (R.chance(0.45)) {
      const q = placeXY();
      g.pickups.push(new Pickup('intel', q.x, q.y, 3 + R.int(0, 3)));
    }
  }
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
  takeFromHot(g.inv, i);
  if (def.use === 'heal') {
    p.hp = Math.min(p.maxHp, p.hp + def.amount);
    g.message('+' + def.amount + ' HP');
  } else if (def.use === 'stim') {
    p.stimT = Math.max(p.stimT, def.dur);
    g.message('Combat stim');
  } else if (def.use === 'shield') {
    p.shieldMax = Math.max(p.shieldMax, def.amount);
    p.shield = Math.min(p.shieldMax, p.shield + def.amount);
    p.shieldRegenT = 0;
    g.message('Shield up');
  }
  sfx.pickup();
  for (let k = 0; k < 8; k++) {
    g.particles.push(new Particle(p.x, p.y, rr(-70, 70), rr(-70, 70), 0.4, def.color, 2));
  }
  saveInv(g);
}

function throwGrenade(g) {
  const def = takeGrenade(g.inv);
  if (!def) {
    g.message('No grenades — equip one in the grenade slot');
    return;
  }
  const p = g.player;
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
  sfx.dodge();
  saveInv(g);
}

function explode(g, gr) {
  burst(g, gr.x, gr.y, 42, '#ff8a3c');
  for (let i = 0; i < 10; i++) {
    g.particles.push(new Particle(gr.x, gr.y, rr(-260, 260), rr(-260, 260), rr(0.2, 0.5), '#ffd27a', rr(2, 4)));
  }
  scorch(g, gr.x, gr.y, gr.radius * 0.6);
  for (let i = 0; i < 5; i++) {
    const a = rr(0, TAU);
    scorch(g, gr.x + Math.cos(a) * gr.radius * 0.5, gr.y + Math.sin(a) * gr.radius * 0.5, rr(6, 12));
  }
  addShake(g, 14, rr(-1, 1), rr(-1, 1));
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

// ---------------------------------------------------------------- combat

function startReload(g, p, wid) {
  const wp = WEAPONS[wid];
  if (!wp || wp.mag == null) return;
  p.reloadT = wp.reload || 1.1;
  p.reloadDur = p.reloadT;
  p.reloading = true;
  p.reloadWid = wid;
  p.burstN = 0;
  if (p.beam && p.beam.on) { sfx.beam(false); p.beam.on = false; }
  sfx.reloadStart();
}

function finishReload(p) {
  const wid = p.reloadWid;
  p.reloading = false;
  p.reloadT = 0;
  const wp = wid && WEAPONS[wid];
  if (!wp || wp.mag == null) return;
  const cur = p.mag[wid] || 0;
  const take = Math.max(0, Math.min(wp.mag - cur, p.ammo[wid] || 0));
  p.mag[wid] = cur + take;
  p.ammo[wid] = (p.ammo[wid] || 0) - take;
  if (take > 0) sfx.reloadDone();
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
  if (!p.beam.on) sfx.beam(true);
  const dx = Math.cos(p.aim);
  const dy = Math.sin(p.aim);
  const ox = p.x + dx * 16;
  const oy = p.y + dy * 16;
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
    hitEnemy(g, target, {
      x: hx,
      y: hy,
      vx: dx,
      vy: dy,
      dmg: (wp.dps || 40) * 0.09,
      energy: true,
      knockback: 0,
      stun: 0,
      color: wp.color,
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

function fireWeapon(g, p, wp, wid) {
  const muzzle = 18;
  const scatter = wp.pellets > 3;
  for (let i = 0; i < wp.pellets; i++) {
    const a = p.aim + (Math.random() - 0.5) * wp.spread;
    g.bullets.push(
      new Bullet(
        p.x + Math.cos(a) * muzzle,
        p.y + Math.sin(a) * muzzle,
        Math.cos(a) * wp.speed,
        Math.sin(a) * wp.speed,
        wp.damage,
        'player',
        {
          color: wp.color,
          knockback: wp.knockback,
          energy: wp.energy,
          stun: wp.stun || 0,
          r: wp.blastRadius ? 6 : wp.energy ? 5 : 3,
          life: wp.blastRadius ? 2.6 : scatter ? 0.6 : 2.2,
          explode: !!wp.blastRadius,
          blastDmg: wp.blastDmg || 0,
          blastRadius: wp.blastRadius || 0,
          clearShots: !!wp.clearShots,
        }
      )
    );
  }
  const nFlash = scatter ? 10 : 5;
  for (let i = 0; i < nFlash; i++) {
    const a = p.aim + rr(-(scatter ? 0.55 : 0.4), scatter ? 0.55 : 0.4);
    g.particles.push(
      new Particle(
        p.x + Math.cos(p.aim) * muzzle,
        p.y + Math.sin(p.aim) * muzzle,
        Math.cos(a) * rr(60, scatter ? 300 : 220),
        Math.sin(a) * rr(60, scatter ? 300 : 220),
        rr(0.1, 0.25),
        wp.color,
        rr(1.5, 3)
      )
    );
  }
  const recoil = wp.energy ? 120 : scatter ? 90 : 18;
  addShake(g, wp.energy ? 4 : scatter ? 3 : 1.3, Math.cos(p.aim), Math.sin(p.aim));
  p.kx -= Math.cos(p.aim) * recoil;
  p.ky -= Math.sin(p.aim) * recoil;
  if (!wp.energy) ejectCasing(g, p.x, p.y, p.aim);
  sfx.fire(wid || (wp.energy ? 'staff' : 'p90'));
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
        const rad = e.r * 1.15 + b.r;
        if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 <= rad * rad) {
          hitEnemy(g, e, b);
          b.alive = false;
          if (b.explode) bulletExplode(g, b);
          return;
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

  // Jaffa (both) shrug off shots to the front
  if (e.kind === 'jaffa' || e.kind === 'jaffa_heavy') {
    const ang = Math.atan2(b.y - e.y, b.x - e.x);
    if (Math.abs(normAngle(ang - e.facing)) < (e.kind === 'jaffa_heavy' ? 1.0 : 0.9)) {
      dmg *= e.kind === 'jaffa_heavy' ? 0.32 : 0.4;
      spark(g, b.x, b.y, '#8ff');
    }
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
  scorch(g, b.x, b.y, rr(2.5, 4.5));
  splat(g, b.x, b.y, factionSplatColor(e.kind), 2);

  // tactile weight on a solid connect that doesn't kill
  sfx.impact(dmg >= 24);
  if (e.hp > 0 && dmg >= 16) {
    g.hitstop = Math.max(g.hitstop, 1);
    addShake(g, 3, b.vx, b.vy);
    if (dmg >= 34) sfx.crit();
  }
  if (e.hp <= 0) killEnemy(g, e);
}

function damagePlayer(g, amount, vx, vy) {
  const p = g.player;
  if (p.iframe > 0 || p.dodge > 0) return;
  const region = rollHitRegion(Math.random);
  const dr = region === 'none' ? 0 : regionDR(g.inv)[region] || 0;
  let dmg = amount * (1 - dr);
  g.lastHitRegion = region;
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    dmg -= absorbed;
    p.shieldRegenT = 0;
  }
  p.hp -= dmg;
  p.flash = 0.12;
  p.iframe = Math.max(p.iframe, 0.25);
  addShake(g, 5, vx, vy);
  const l = Math.hypot(vx, vy) || 1;
  p.kx += (vx / l) * 140;
  p.ky += (vy / l) * 140;
  sfx.hit();
  for (let i = 0; i < 8; i++) {
    g.particles.push(new Particle(p.x, p.y, rr(-120, 120), rr(-120, 120), 0.3, dr > 0 ? '#8cf' : '#f66', 2));
  }
}

const BOSS_NAME = { jaffa: 'Serpent Guard Prime', wraith: 'The Wraith Queen', replicator: 'Replicator Carrier' };

function killEnemy(g, e) {
  if (!e.alive) return;

  // a fresh Replicator brute shatters into reassembly debris instead of dying
  if (e.kind === 'replicator_brute' && !e._reformed) {
    e.alive = false;
    sfx.death();
    burst(g, e.x, e.y, 20, '#b6f0ff');
    g.hitstop = Math.max(g.hitstop, 2);
    for (let i = 0; i < 4; i++) g.blocks.push(new Block(e.x + rr(-8, 8), e.y + rr(-8, 8), g.params.threat, e._room));
    g.pickups.push(new Pickup('naquadah', e.x, e.y, 5 * (g.params.mods.includes('naquadah-rich') ? 2 : 1)));
    g.message('Replicator scatters — finish the pieces');
    return;
  }

  e.alive = false;
  sfx.death();
  const dead = e.kind === 'boss';
  const elite = e.kind === 'jaffa_heavy' || e.kind === 'replicator_brute' || e.hunter;
  burst(g, e.x, e.y, dead ? 44 : 14, e.kind.startsWith('wraith') ? '#9df7a0' : e.kind.startsWith('replicator') ? '#b6f0ff' : '#ffb347');
  addShake(g, dead ? 16 : 3, e.x - g.player.x, e.y - g.player.y);
  g.hitstop = Math.max(g.hitstop, dead ? 6 : elite ? 3 : 2);
  scorch(g, e.x, e.y, dead ? 34 : e.r + 6);
  splat(g, e.x, e.y, factionSplatColor(e.kind), dead ? 8 : 4);

  // forward pressure is rewarded — a kill tops you up a little and refunds dodge
  const pl = g.player;
  if (pl.alive) {
    pl.hp = Math.min(pl.maxHp, pl.hp + (dead ? 22 : elite ? 6 : 3));
    pl.dodgeCd = Math.max(0, pl.dodgeCd - (dead ? 0.8 : 0.2));
    g.killStreak += 1;
    g.killStreakT = 2.6;
    if (elite || dead) sfx.crit();
  }
  const mult = g.params.mods.includes('naquadah-rich') ? 2 : 1;
  const drop = (id, count, ox, oy) => g.pickups.push(new Pickup('item', e.x + (ox || 0), e.y + (oy || 0), 0, { id, count }));

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
    g.runNaq += Math.round(pk.amount * fx(g).naquadahMul);
  } else if (pk.kind === 'intel') {
    g.runIntel += Math.round(pk.amount * fx(g).intelMul);
    pk.alive = false;
    sfx.pickup();
    for (let i = 0; i < 6; i++) {
      g.particles.push(new Particle(pk.x, pk.y, rr(-60, 60), rr(-60, 60), 0.4, '#b6f0ff', 2));
    }
    g.message('+' + Math.round(pk.amount * fx(g).intelMul) + ' intel');
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
    const left = invAdd(g.inv, pk.item.id, pk.item.count || 1);
    if (left > 0) pk.item.count = left;
    else {
      pk.alive = false;
      g.message('Picked up ' + (def ? def.name : pk.item.id) + (pk.item.count > 1 ? ' ×' + pk.item.count : ''));
    }
    saveInv(g);
    for (let i = 0; i < 6; i++) {
      g.particles.push(new Particle(pk.x, pk.y, rr(-60, 60), rr(-60, 60), 0.4, def ? def.color : '#7ef', 2));
    }
    sfx.pickup();
    return;
  }
  pk.alive = false;
  sfx.pickup();
  for (let i = 0; i < 6; i++) {
    g.particles.push(new Particle(pk.x, pk.y, rr(-60, 60), rr(-60, 60), 0.4, '#7ef', 2));
  }
}

// ---------------------------------------------------------------- enemy AI

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

function checkLeash(g, e, dt) {
  if (!e._room || e.hunter) return false;
  const c = e._room.centerPx;
  if (Math.hypot(e.x - c.x, e.y - c.y) < LEASH_DIST) return false;
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
  sfx.staff();
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
    const ml = Math.hypot(mx, my) || 1;
    e.x += (mx / ml) * e.speed * dt;
    e.y += (my / ml) * e.speed * dt;
    if (e.cool <= 0 && losNow && dist < 500) {
      jaffaShoot(g, e, 0.11);
      e.cool = 1.15 + Math.random() * 0.7;
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
    sfx.p90();
  }
}

// swarm unit (also drives the brute): rush and bite
function updateReplicator(g, e, dt, brute) {
  const p = g.player;
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (e.state === 'idle' && idleTick(g, e, dt, brute ? 300 : 260)) return;
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
  const [fx, fy] = flowDir(g, e);
  const jit = brute ? 0 : Math.sin(e.wobble) * 0.35;
  let mvx = fx + -fy * jit;
  let mvy = fy + fx * jit;
  if (fx === 0 && fy === 0) {
    mvx = dx / dist;
    mvy = dy / dist;
  }
  const l = Math.hypot(mvx, mvy) || 1;
  e.x += (mvx / l) * e.speed * dt;
  e.y += (mvy / l) * e.speed * dt;
  e.cool -= dt;
  if (dist < e.r + p.r + 4 && e.cool <= 0) {
    damagePlayer(g, brute ? 14 : 7, dx, dy);
    if (brute) {
      p.kx += (dx / dist) * 150;
      p.ky += (dy / dist) * 150;
    }
    e.cool = brute ? 1.0 : 0.6;
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
    sfx.fire('launcher');
  }
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
  if (e.shield > 0 || v === 'jaffa' || v === 'replicator') {
    e.shieldT += dt;
    const cap = v === 'replicator' ? 70 : 90;
    if (e.shieldT > 6 && e.shield < cap) e.shield = Math.min(cap, e.shield + 16 * dt);
  }

  if (e.charging > 0) {
    e.charging -= dt;
    e.x += Math.cos(e.chargeDir) * 460 * dt;
    e.y += Math.sin(e.chargeDir) * 460 * dt;
    if (e.charging <= 0) e.attackT = 1.5;
    return;
  }

  e.attackT -= dt;
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
    if (v !== 'wraith' && Math.random() < 0.4 && dist < 400) {
      e.charging = 0.4;
      e.chargeDir = e.facing;
      g.message((BOSS_NAME[v] || 'Boss') + ' charges!');
      g.shake = Math.min(20, g.shake + 8);
    } else if (v === 'replicator') {
      for (let i = 0; i < 2; i++) {
        const r = new Enemy('replicator', e.x + rr(-24, 24), e.y + rr(-24, 24), g.params.threat);
        r._room = e._room;
        r.state = 'active';
        r.mode = 'advance';
        g.enemies.push(r);
      }
      e.attackT = 2.4;
    } else {
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
      sfx.staff();
      e.attackT = v === 'wraith' ? 1.6 : 1.3;
    }
  }
}

// ---------------------------------------------------------------- particles

function spark(g, x, y, color) {
  for (let i = 0; i < 5; i++) {
    g.particles.push(new Particle(x, y, rr(-110, 110), rr(-110, 110), rr(0.15, 0.35), color, rr(1.5, 3)));
  }
}
function burst(g, x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rr(0, TAU);
    const s = rr(40, 260);
    g.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, rr(0.3, 0.7), color, rr(1.5, 3.5)));
  }
}
function kawoosh(g, x, y) {
  for (let i = 0; i < 46; i++) {
    const a = rr(0, TAU);
    const s = rr(120, 420);
    const r0 = rr(6, 22);
    g.particles.push(
      new Particle(x + Math.cos(a) * r0, y + Math.sin(a) * r0, Math.cos(a) * s, Math.sin(a) * s, rr(0.3, 0.6), '#7cc6ff', rr(1.4, 2.8))
    );
  }
  g.shake = 16;
}

// directional screen shake — mag + a unit-ish (dx,dy) the kick comes from
function addShake(g, mag, dx, dy) {
  g.shake = Math.min(28, g.shake + mag);
  const l = Math.hypot(dx || 0, dy || 0);
  if (l > 1e-4) {
    g.shakeX = dx / l;
    g.shakeY = dy / l;
  }
}

// battlefield marks — capped ring buffer, drawn under everything
function addDecal(g, kind, x, y, r, color, ang) {
  if (g.hub) return;
  const d = new Decal(kind, x, y, r, color, ang);
  d.born = g.time;
  g.decals.push(d);
  if (g.decals.length > 520) g.decals.splice(0, g.decals.length - 520);
}
function scorch(g, x, y, r) {
  addDecal(g, 'scorch', x, y, r, 'rgba(8,6,5,0.5)');
}
function ejectCasing(g, x, y, aim) {
  const a = aim + Math.PI + rr(-0.9, 0.9);
  addDecal(g, 'casing', x + Math.cos(a) * rr(12, 30), y + Math.sin(a) * rr(12, 30), rr(2.2, 3.4), 'rgba(224,192,120,0.75)', rr(0, TAU));
}
function splat(g, x, y, color, n) {
  for (let i = 0; i < (n || 3); i++) {
    addDecal(g, 'splat', x + rr(-11, 11), y + rr(-11, 11), rr(3, 7.5), color, rr(0, TAU));
  }
}

function factionSplatColor(kind) {
  if (kind.startsWith('wraith')) return 'rgba(120,240,150,0.5)';
  if (kind.startsWith('replicator')) return 'rgba(140,230,255,0.42)';
  if (kind === 'boss') return 'rgba(255,160,110,0.5)';
  return 'rgba(255,150,90,0.42)'; // jaffa
}

// ---------------------------------------------------------------- camera

function clampCam(g) {
  const wpx = g.world.W * TILE;
  const hpx = g.world.H * TILE;
  const halfW = g.view.w / 2;
  const halfH = g.view.h / 2;
  g.cam.x = wpx > g.view.w ? clamp(g.cam.x, halfW, wpx - halfW) : wpx / 2;
  g.cam.y = hpx > g.view.h ? clamp(g.cam.y, halfH, hpx - halfH) : hpx / 2;
}

// ---------------------------------------------------------------- render

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
  g.buttons = [];
  try {
    const arrow = g.panelOpen || g.station || g.state === 'menu' || g.state === 'gatemap' || g.state === 'dead';
    g.ctx.canvas.style.cursor = arrow ? 'default' : 'none';
  } catch (e) {
    /* headless */
  }

  if (g.state === 'menu') {
    renderMenu(g);
  } else if (g.state === 'gatemap') {
    renderPlay(g, true);
    renderGateMap(g);
  } else if (g.state === 'hub') {
    renderHub(g);
    if (g.panelOpen) renderPanel(g);
    if (g.station) renderStationPanel(g);
  } else {
    renderPlay(g, false);
    if (g.panelOpen) renderPanel(g);
    if (g.state === 'dead') renderDead(g);
  }

  if (window.DEBUG && g.world) {
    const dbg = document.getElementById('dbg');
    if (dbg) {
      dbg.textContent =
        `fps ${g.fps}\nstate ${g.state}\nenemies ${g.enemies.length}\nbullets ${g.bullets.length}\n` +
        `particles ${g.particles.length}\nhop ${g.hop} threat ${g.params ? g.params.threat : '-'}`;
    }
  }
}

// ---------------------------------------------------------------- line of sight

function raySeg(px, py, dx, dy, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const rxs = dx * sy - dy * sx;
  if (rxs > -1e-9 && rxs < 1e-9) return Infinity;
  const qx = ax - px;
  const qy = ay - py;
  const t = (qx * sy - qy * sx) / rxs;
  const u = (qx * dy - qy * dx) / rxs;
  if (t >= 0 && u >= -0.0006 && u <= 1.0006) return t;
  return Infinity;
}

// wall edges facing open ground within R of a point, as a flat [x1,y1,x2,y2,...]
function gatherSegments(g, px, py, R) {
  const w = g.world;
  const t = TILE;
  const segs = [];
  const x0 = Math.max(0, Math.floor((px - R) / t) - 1);
  const x1 = Math.min(w.W - 1, Math.floor((px + R) / t) + 1);
  const y0 = Math.max(0, Math.floor((py - R) / t) - 1);
  const y1 = Math.min(w.H - 1, Math.floor((py + R) / t) + 1);
  const wall = (x, y) => x < 0 || y < 0 || x >= w.W || y >= w.H || w.grid[y * w.W + x] === 1;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (w.grid[ty * w.W + tx] !== 1) continue;
      const X = tx * t;
      const Y = ty * t;
      if (!wall(tx, ty - 1)) segs.push(X, Y, X + t, Y);
      if (!wall(tx, ty + 1)) segs.push(X, Y + t, X + t, Y + t);
      if (!wall(tx - 1, ty)) segs.push(X, Y, X, Y + t);
      if (!wall(tx + 1, ty)) segs.push(X + t, Y, X + t, Y + t);
    }
  }
  return segs;
}

function circlePoly(px, py, R, n) {
  const poly = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    poly.push(px + Math.cos(a) * R, py + Math.sin(a) * R);
  }
  return poly;
}

// 360° visibility polygon: cast rays at every wall-corner (plus a fan) and keep
// the nearest hit. Doorways, pillars and corners occlude naturally.
function computeVisPoly(g, R) {
  const p = g.player;
  if (!g.visEnabled) return circlePoly(p.x, p.y, R, 28);
  const segs = gatherSegments(g, p.x, p.y, R);
  const angs = [];
  for (let i = 0; i < segs.length; i += 4) {
    for (let k = 0; k < 2; k++) {
      const ex = segs[i + k * 2];
      const ey = segs[i + k * 2 + 1];
      const a = Math.atan2(ey - p.y, ex - p.x);
      angs.push(a - 0.0006, a, a + 0.0006);
    }
  }
  for (let i = 0; i < 50; i++) angs.push(-Math.PI + (i / 50) * TAU);
  angs.sort((a, b) => a - b);
  const poly = [];
  for (let j = 0; j < angs.length; j++) {
    const a = angs[j];
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = R;
    for (let i = 0; i < segs.length; i += 4) {
      const tt = raySeg(p.x, p.y, dx, dy, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
      if (tt < best) best = tt;
    }
    poly.push(p.x + dx * best, p.y + dy * best);
  }
  return poly;
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function litAt(g, x, y) {
  const p = g.player;
  const dx = x - p.x;
  const dy = y - p.y;
  if (dx * dx + dy * dy < 6400) return true;
  return !!g.visPoly && inPoly(x, y, g.visPoly);
}

function drawFog(ctx, g, R) {
  const p = g.player;
  const poly = g.visPoly;
  if (!poly || poly.length < 6) return;
  const pad = 2600;
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x - pad, p.y - pad, pad * 2, pad * 2);
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(3,4,9,0.95)';
  ctx.fill('evenodd');

  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.clip();
  const grd = ctx.createRadialGradient(p.x, p.y, R * 0.32, p.x, p.y, R * 1.02);
  grd.addColorStop(0, 'rgba(3,4,9,0)');
  grd.addColorStop(1, 'rgba(3,4,9,0.92)');
  ctx.fillStyle = grd;
  ctx.fillRect(p.x - R - 4, p.y - R - 4, R * 2 + 8, R * 2 + 8);
  ctx.restore();
}

function renderPlay(g, dim) {
  const { ctx, view } = g;
  if (!g.world) return;
  // directional shake: kick along the hit vector + a little omni jitter
  const jit = (Math.random() - 0.5) * g.shake * 0.45;
  const kick = g.shake * (0.4 + 0.5 * Math.random());
  const shx = -(g.shakeX || 0) * kick + jit;
  const shy = -(g.shakeY || 0) * kick + (Math.random() - 0.5) * g.shake * 0.45;
  ctx.save();
  ctx.translate(view.w / 2 - g.cam.x + shx, view.h / 2 - g.cam.y + shy);

  ctx.drawImage(g.worldCanvas, 0, 0);
  drawDecals(ctx, g, dim);
  for (const hz of g.hazards) drawHazard(ctx, hz, g.time);

  const R = g.params && g.params.mods.includes('eclipse') ? 330 : 560;
  g.visPoly = dim ? null : computeVisPoly(g, R);
  const lit = (x, y) => dim || litAt(g, x, y);

  if (lit(g.world.gateRoom.centerPx.x, g.world.gateRoom.centerPx.y)) {
    drawGate(ctx, g.world.gateRoom.centerPx, g.time);
  }
  if (lit(g.world.dhdRoom.centerPx.x, g.world.dhdRoom.centerPx.y)) {
    drawDHD(ctx, g.world.dhdRoom.centerPx, g.time, g.dhdActive);
  }

  for (const pk of g.pickups) if (lit(pk.x, pk.y)) drawPickup(ctx, pk);

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

  for (const gr of g.grenades) drawGrenade(ctx, gr);
  for (const bl of g.blocks) if (lit(bl.x, bl.y)) drawBlock(ctx, bl);
  for (const e of g.enemies) if (lit(e.x, e.y)) drawEnemy(ctx, e, g.time);
  drawPlayer(ctx, g.player, g.time);

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
    renderHotbar(g);
    renderMessages(g);
    if (!g.panelOpen) drawCrosshair(g);
  }
}

function drawGrenade(ctx, gr) {
  const pulse = 0.5 + 0.5 * Math.sin(gr.fuse * 40);
  glowCircle(ctx, gr.x, gr.y, gr.r + pulse * 2, '#ff8a3c', 12);
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

function drawDHD(ctx, c, t, active) {
  ctx.save();
  ctx.translate(c.x, c.y);
  const col = active ? '#5ef' : '#a44';
  ctx.shadowBlur = active ? 18 : 6;
  ctx.shadowColor = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = active ? `rgba(90,240,255,${0.3 + 0.2 * Math.sin(t * 4)})` : 'rgba(160,60,60,0.2)';
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 16, Math.sin(a) * 16, 2, 0, TAU);
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.restore();
}

// vaguely-humanoid top-down figure: legs trailing, torso, shoulder bar, weapon
// arm forward, head toward facing.
function drawHumanoid(ctx, x, y, ang, s, body, head, o) {
  o = o || {};
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = o.blur == null ? 10 : o.blur;
  ctx.shadowColor = body;

  ctx.strokeStyle = body;
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath();
  ctx.moveTo(-1 * s, -2.4 * s);
  ctx.lineTo(-6.5 * s, -3.7 * s);
  ctx.moveTo(-1 * s, 2.4 * s);
  ctx.lineTo(-6.5 * s, 3.7 * s);
  ctx.stroke();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6 * s, 4.4 * s, 0, 0, TAU);
  ctx.fill();

  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(1.4 * s, -5.2 * s);
  ctx.lineTo(1.4 * s, 5.2 * s);
  ctx.stroke();

  if (o.weapon !== false) {
    ctx.lineWidth = 2.4 * s;
    ctx.strokeStyle = o.weaponColor || '#e8f4ff';
    ctx.beginPath();
    ctx.moveTo(2 * s, 2.6 * s);
    ctx.lineTo((o.weaponLen || 12) * s, 3.3 * s);
    ctx.stroke();
  }

  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(3.2 * s, 0, (o.head || 3) * s, 0, TAU);
  ctx.fill();

  ctx.restore();
}

function drawPlayer(ctx, p, t) {
  let body = '#6fdcff';
  let head = '#cdf3ff';
  if (p.flash > 0) {
    body = '#ffffff';
    head = '#ffffff';
  } else if (p.iframe > 0 && Math.floor(t * 30) % 2) {
    body = 'rgba(120,230,255,0.4)';
    head = 'rgba(180,240,255,0.5)';
  }
  drawHumanoid(ctx, p.x, p.y, p.aim, 1, body, head, { weaponColor: '#eef', weaponLen: 13, blur: 12 });
  if (p.dodge > 0) glowCircle(ctx, p.x, p.y, p.r + 4, 'rgba(120,230,255,0.22)', 16);
  if (p.stun > 0) {
    ctx.strokeStyle = 'rgba(255,220,120,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 6, 0, TAU);
    ctx.stroke();
  }
}

function drawBlock(ctx, bl) {
  ctx.save();
  ctx.translate(bl.x, bl.y);
  ctx.rotate(bl.spin);
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#7fe0ff';
  ctx.strokeStyle = bl.mergeT < 1 ? '#dff6ff' : '#7fe0ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(-bl.r, -bl.r, bl.r * 2, bl.r * 2);
  ctx.restore();
}

function drawEnemy(ctx, e, t) {
  const flash = e.flash > 0;
  const dormant = e.state === 'idle' || e.state === 'dormant';
  const idle = dormant;
  if (dormant) ctx.globalAlpha = 0.78;
  const hunter = e.hunter;

  if (e.kind === 'jaffa' || e.kind === 'jaffa_heavy' || e.kind === 'jaffa_grenadier') {
    const heavy = e.kind === 'jaffa_heavy';
    const nade = e.kind === 'jaffa_grenadier';
    drawHumanoid(ctx, e.x, e.y, e.facing, heavy ? 1.5 : nade ? 1.1 : 1.05, flash ? '#fff' : hunter ? '#ff6a4a' : nade ? '#ff9f5c' : '#ffb347', flash ? '#fff' : '#ffd9a0', {
      weaponColor: flash ? '#fff' : '#ffcf9a',
      weaponLen: heavy ? 17 : nade ? 9 : 15,
      head: heavy ? 4 : 3.4,
      blur: heavy ? 12 : 10,
    });
    ctx.save();
    ctx.strokeStyle = flash ? '#fff' : heavy ? '#ffd27a' : '#ffe0b0';
    ctx.lineWidth = heavy ? 4 : 2.6;
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#fb3';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 1, e.facing - (heavy ? 1.0 : 0.7), e.facing + (heavy ? 1.0 : 0.7));
    ctx.stroke();
    ctx.restore();
    if (nade) {
      // a lit shell held at the hip — distinct silhouette
      const hx = e.x + Math.cos(e.facing - 1.4) * 10;
      const hy = e.y + Math.sin(e.facing - 1.4) * 10;
      glowCircle(ctx, hx, hy, 4, flash ? '#fff' : '#ff8a3c', 10);
    }
  } else if (e.kind === 'wraith' || e.kind === 'wraith_drone') {
    const drone = e.kind === 'wraith_drone';
    const jx = (Math.random() - 0.5) * (drone ? 3.5 : 2.5);
    const jy = (Math.random() - 0.5) * (drone ? 3.5 : 2.5);
    drawHumanoid(ctx, e.x + jx, e.y + jy, e.facing, drone ? 0.8 : 1, flash ? '#fff' : hunter ? '#ff6a4a' : drone ? '#bff8bf' : '#9df7a0', flash ? '#fff' : '#d7ffda', {
      weapon: drone,
      weaponColor: '#cffccf',
      weaponLen: 10,
      head: drone ? 2.2 : 2.6,
      blur: 12,
    });
    if (!drone) {
      ctx.save();
      ctx.translate(e.x + jx, e.y + jy);
      ctx.rotate(e.facing);
      ctx.strokeStyle = flash ? '#fff' : '#bff8c2';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(3, -4);
      ctx.lineTo(9, -6);
      ctx.moveTo(3, 4);
      ctx.lineTo(9, 6);
      ctx.stroke();
      ctx.restore();
    }
  } else if (e.kind === 'replicator' || e.kind === 'replicator_brute') {
    const brute = e.kind === 'replicator_brute';
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.wobble * 0.3);
    ctx.shadowBlur = brute ? 14 : 8;
    ctx.shadowColor = '#7fe0ff';
    ctx.strokeStyle = flash ? '#fff' : hunter ? '#ff6a4a' : '#8fe4ff';
    ctx.fillStyle = flash ? '#fff' : 'rgba(40,90,120,0.55)';
    ctx.lineWidth = 2;
    const s = e.r;
    ctx.beginPath();
    ctx.rect(-s, -s, s * 2, s * 2);
    ctx.fill();
    ctx.stroke();
    if (brute) {
      ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
    }
    ctx.restore();
    // adapt readout: little type pips
    if ((e.resist.kinetic > 0.05 || e.resist.energy > 0.05) && !idle) {
      ctx.fillStyle = 'rgba(180,240,255,0.7)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        (e.resist.kinetic > 0.05 ? 'K' : '') + (e.resist.energy > 0.05 ? 'E' : ''),
        e.x,
        e.y - e.r - 12
      );
    }
  } else {
    // boss
    const bc = e.variant === 'wraith' ? '#9df7a0' : e.variant === 'replicator' ? '#8fe4ff' : '#ffb347';
    drawHumanoid(ctx, e.x, e.y, e.facing, 1.95, flash ? '#fff' : bc, flash ? '#fff' : '#ffe9c8', {
      weaponColor: '#ffcf9a',
      weaponLen: 13,
      head: 3.3,
      blur: 16,
    });
    if (e.shield > 0) {
      const cap = e.variant === 'replicator' ? 70 : 90;
      ctx.save();
      ctx.strokeStyle = `rgba(125,211,252,${0.3 + 0.4 * (e.shield / cap)})`;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 8, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (e.variant === 'replicator') {
      ctx.fillStyle = e.immuneType === 'kinetic' ? 'rgba(255,150,120,0.8)' : 'rgba(150,200,255,0.8)';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(e.immuneType === 'kinetic' ? 'KINETIC-IMMUNE' : 'ENERGY-IMMUNE', e.x, e.y - e.r - 16);
    }
    if (e.charging > 0) glowCircle(ctx, e.x, e.y, e.r + 4, 'rgba(255,120,40,0.3)', 20);
  }

  if (hunter && !idle) glowCircle(ctx, e.x, e.y, e.r + 5, 'rgba(255,90,60,0.25)', 18);

  if (e.mode === 'tuck' && e.kind === 'jaffa' && !flash && !idle) {
    ctx.fillStyle = 'rgba(255,180,90,0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▼', e.x, e.y - e.r - 14);
  }
  if (dormant && !flash) {
    ctx.fillStyle = 'rgba(150,170,190,0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(e.state === 'dormant' ? '·' : 'z', e.x + 2, e.y - e.r - 12);
  }
  if (e.hp < e.maxHp && e.alive && !idle) {
    const w = e.kind === 'boss' ? 60 : e.kind === 'jaffa_heavy' || e.kind === 'replicator_brute' ? 30 : 22;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, 4);
    ctx.fillStyle = e.kind.startsWith('wraith') ? '#7ef77e' : e.kind.startsWith('replicator') ? '#7fe0ff' : '#ff9a3c';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
  ctx.globalAlpha = 1;
}

function drawBullet(ctx, b) {
  // threat tiering: the harder a shot hits, the brighter/fatter it reads
  const heavy = b.from === 'enemy' && b.dmg >= 12;
  const big = b.dmg >= 24;
  ctx.save();
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.r * (heavy ? 1.4 : 1);
  ctx.lineCap = 'round';
  ctx.shadowBlur = heavy ? 18 : big ? 14 : 10;
  ctx.shadowColor = b.color;
  ctx.beginPath();
  const t0 = b.trail[0] || b;
  ctx.moveTo(t0.x, t0.y);
  for (const p of b.trail) ctx.lineTo(p.x, p.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r * (heavy ? 0.95 : 0.7), 0, TAU);
  ctx.fill();
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

function drawPickup(ctx, pk) {
  const y = pk.y + Math.sin(pk.bob) * 3;
  const cmap = { naquadah: '#8ef', 'staff-ammo': '#ffb347', health: '#7ef77e', 'weapon-staff': '#ffd54a' };
  const lmap = { naquadah: 'N', 'staff-ammo': 'A', health: '+', 'weapon-staff': 'W' };
  const c = cmap[pk.kind] || '#fff';
  glowCircle(ctx, pk.x, y, pk.r, c, 12);
  ctx.fillStyle = '#02121a';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(lmap[pk.kind] || '?', pk.x, y + 3);
}

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
  else if (wp.mag != null) ammoStr = `${Math.ceil(p.mag[wid] != null ? p.mag[wid] : wp.mag)} / ${p.ammo[wid] || 0}`;
  else ammoStr = `${p.ammo[wid] || 0}`;
  ctx.fillText(
    `${witem ? witem.name : wp.name}  ${ammoStr}${g.inv.equip.weapon2 ? '   [Q]' : ''}`,
    bx,
    wLineY
  );
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

  ctx.fillStyle = p.dodgeCd > 0 ? 'rgba(120,230,255,0.25)' : '#7fe8ff';
  ctx.fillRect(bx + bw + 10, by, 14, bh);
  if (p.stimT > 0) {
    ctx.fillStyle = '#ffd54a';
    ctx.font = '10px monospace';
    ctx.fillText('STIM ' + p.stimT.toFixed(1) + 's', bx + bw + 30, by + 12);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = '#8ef';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`NAQUADAH  ${g.runNaq}   (banked ${g.save.naquadah})`, view.w - 20, view.h - 24);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#9cf';
  ctx.font = '12px monospace';
  ctx.fillText(g.params.address, 20, 24);
  ctx.fillStyle = '#f9a';
  const heatTier = Math.floor(g.heat);
  const heatBar = '▮'.repeat(Math.min(5, heatTier)) + '▯'.repeat(Math.max(0, 5 - heatTier));
  ctx.fillText(
    `SECTOR DEPTH ${g.hop}    THREAT ${g.params.threat}    ${(g.params.faction || g.params.primary).toUpperCase()}`,
    20,
    42
  );
  ctx.fillStyle = heatTier >= 3 ? '#f77' : '#fb8';
  ctx.fillText(`HEAT ${heatBar}${heatTier >= 3 ? '  HUNTED' : ''}`, 20, 60);
  if (g.params.mods.length) {
    ctx.fillStyle = '#fd6';
    ctx.fillText('[ ' + g.params.mods.join('   ') + ' ]', 20, 78);
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
    const def = ITEMS[stack.id];
    ctx.fillStyle = def.color;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon || '?', x + s / 2, y + s / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    if (stack.count > 1) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
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
function panelLayout(g) {
  const { view } = g;
  const S = 44;
  const gap = 6;
  const gridW = GRID_COLS * S + (GRID_COLS - 1) * gap;
  const gridH = GRID_ROWS * S + (GRID_ROWS - 1) * gap;
  const panelW = 360 + gridW;
  const panelH = Math.max(gridH + 80, 360);
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
    ['grenade', dollX + 2 * (S + gap), dollY + 3 * (S + gap)],
  ];
  for (const [key, x, y] of eq) cells.push({ loc: { kind: 'equip', key }, x, y, w: S, h: S });

  // hotbar row under the doll
  const hbY = dollY + 4 * (S + gap) + 24;
  for (let i = 0; i < HOTBAR; i++) {
    cells.push({ loc: { kind: 'hot', i }, x: dollX + i * (S + gap), y: hbY, w: S, h: S });
  }

  // inventory grid on the right
  const gx = px + panelW - gridW - 40;
  const gy = py + 70;
  for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
    const cx = gx + (i % GRID_COLS) * (S + gap);
    const cy = gy + Math.floor(i / GRID_COLS) * (S + gap);
    cells.push({ loc: { kind: 'grid', i }, x: cx, y: cy, w: S, h: S });
  }

  return { px, py, panelW, panelH, S, cells, dollX, dollY, hbY, gx, gy };
}

function invRef(g, loc) {
  if (loc.kind === 'grid') return g.inv.grid[loc.i];
  if (loc.kind === 'hot') return g.inv.hotbar[loc.i];
  if (loc.kind === 'equip') return g.inv.equip[loc.key];
  return null;
}
function invSet(g, loc, stack) {
  if (loc.kind === 'grid') g.inv.grid[loc.i] = stack;
  else if (loc.kind === 'hot') g.inv.hotbar[loc.i] = stack;
  else if (loc.kind === 'equip') g.inv.equip[loc.key] = stack;
}

function panelPick(g) {
  if (g.drag) return;
  const lay = panelLayout(g);
  for (const c of lay.cells) {
    if (
      g.pmouse.x >= c.x &&
      g.pmouse.x <= c.x + c.w &&
      g.pmouse.y >= c.y &&
      g.pmouse.y <= c.y + c.h
    ) {
      const st = invRef(g, c.loc);
      if (!st) return;
      g.drag = { from: c.loc, id: st.id, count: st.count };
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
  let target = null;
  for (const c of lay.cells) {
    if (
      g.pmouse.x >= c.x &&
      g.pmouse.x <= c.x + c.w &&
      g.pmouse.y >= c.y &&
      g.pmouse.y <= c.y + c.h
    ) {
      target = c.loc;
      break;
    }
  }
  // temporarily place the held stack back at origin, then use moveStack
  invSet(g, d.from, { id: d.id, count: d.count });
  if (target) {
    if (!moveStack(g.inv, d.from, target)) {
      // invalid target — item stays at origin (already restored)
    }
  }
  // ensure a valid active weapon slot
  if (!g.inv.equip[g.inv.active]) {
    g.inv.active = g.inv.equip.weapon1 ? 'weapon1' : g.inv.equip.weapon2 ? 'weapon2' : 'weapon1';
  }
  saveInv(g);
}

function renderPanel(g) {
  const { ctx, view } = g;
  ctx.fillStyle = 'rgba(4,6,12,0.82)';
  ctx.fillRect(0, 0, view.w, view.h);

  const lay = panelLayout(g);
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

  // derived resistance readout
  const dr = regionDR(g.inv);
  ctx.fillStyle = '#8cf';
  ctx.font = '11px monospace';
  ctx.fillText(
    `DR  head ${(dr.head * 100) | 0}%   torso ${(dr.torso * 100) | 0}%   legs ${(dr.legs * 100) | 0}%   feet ${(dr.feet * 100) | 0}%`,
    lay.dollX,
    lay.hbY + lay.S + 22
  );

  const labels = {
    head: 'HEAD',
    torso: 'BODY',
    legs: 'LEGS',
    feet: 'FEET',
    weapon1: 'WPN1',
    weapon2: 'WPN2',
    grenade: 'GRND',
  };
  for (const c of lay.cells) {
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
    const hover = g.pmouse.x >= c.x && g.pmouse.x <= c.x + c.w && g.pmouse.y >= c.y && g.pmouse.y <= c.y + c.h;
    drawSlot(ctx, c.x, c.y, c.w, st, { label, border: hover ? '#cfe8ff' : border });
  }

  // tooltip for hovered item
  for (const c of lay.cells) {
    const hover = g.pmouse.x >= c.x && g.pmouse.x <= c.x + c.w && g.pmouse.y >= c.y && g.pmouse.y <= c.y + c.h;
    if (!hover) continue;
    const st = invRef(g, c.loc);
    if (!st || !ITEMS[st.id]) break;
    const def = ITEMS[st.id];
    const tw = 210;
    const tx = Math.min(c.x + c.w + 8, view.w - tw - 8);
    const ty = c.y;
    ctx.fillStyle = 'rgba(6,10,16,0.96)';
    ctx.fillRect(tx, ty, tw, 54);
    ctx.strokeStyle = def.color;
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 53);
    ctx.fillStyle = def.color;
    ctx.font = 'bold 12px monospace';
    ctx.fillText(def.name, tx + 8, ty + 18);
    ctx.fillStyle = '#bcd';
    ctx.font = '10px monospace';
    ctx.fillText(def.blurb || def.type, tx + 8, ty + 36);
    ctx.fillStyle = '#678';
    ctx.fillText(
      def.type === 'consumable' ? 'hotbar slot · use with 1-4' : def.type === 'armor' ? 'equip to ' + def.region : def.type,
      tx + 8,
      ty + 48
    );
    break;
  }

  // dragged item follows the cursor
  if (g.drag && ITEMS[g.drag.id]) {
    const def = ITEMS[g.drag.id];
    ctx.globalAlpha = 0.9;
    drawSlot(ctx, g.pmouse.x - lay.S / 2, g.pmouse.y - lay.S / 2, lay.S, { id: g.drag.id, count: g.drag.count }, {
      bg: 'rgba(30,40,55,0.9)',
      border: def.color,
    });
    ctx.globalAlpha = 1;
  }
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
  const oy = 24;
  for (const r of g.world.rooms) {
    const x = ox + r.gx * cell;
    const y = oy + r.gy * cell;
    let col = r.cleared ? '#3a6a4a' : r === g.curRoom || r.everSeen ? '#6a3a3a' : '#2a3a4a';
    if (r.kind === 'gate') col = '#3a5a8a';
    if (r.kind === 'dhd') col = r.cleared ? '#55ddee' : '#8a5a2a';
    ctx.fillStyle = col;
    ctx.fillRect(x, y, cell - pad, cell - pad);
    if (g.curRoom === r) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 0.5, y - 0.5, cell - pad + 1, cell - pad + 1);
    }
  }
}

function renderMessages(g) {
  const { ctx, view } = g;
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  g.messages.forEach((m, i) => {
    ctx.globalAlpha = clamp(m.t, 0, 1);
    ctx.fillStyle = '#cfe8ff';
    ctx.fillText(m.txt, view.w / 2, 84 + i * 18);
  });
  ctx.globalAlpha = 1;
}

function button(g, label, x, y, w, h, fn, enabled = true) {
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
  if (enabled) g.buttons.push({ x, y, w, h, fn });
}

function renderMenu(g) {
  const { ctx, view } = g;
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, view.w, view.h);
  const cx = view.w / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8cf';
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#39f';
  ctx.font = 'bold 52px monospace';
  ctx.fillText('GATE  CRAWLER', cx, view.h * 0.26);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#7a9';
  ctx.font = '14px monospace';
  ctx.fillText('procedural top-down SG-1 roguelite — vertical slice', cx, view.h * 0.26 + 32);
  ctx.fillStyle = '#9cf';
  ctx.font = '13px monospace';
  ctx.fillText(
    `banked naquadah ${g.save.naquadah}     deepest threat ${g.save.deepestThreat}     sorties ${g.save.runs}     worlds mapped ${g.save.known.length}`,
    cx,
    view.h * 0.26 + 60
  );

  button(g, 'ENTER  STARGATE  COMMAND   (Enter)', cx - 190, view.h * 0.44, 380, 48, () => enterHub(g));

  ctx.fillStyle = '#678';
  ctx.font = '12px monospace';
  ctx.fillText(
    'WASD move   ·   mouse aim   ·   LMB fire   ·   SPACE dodge   ·   Q heal   ·   X / wheel swap weapon   ·   G grenade   ·   R reload   ·   TAB gear',
    cx,
    view.h * 0.44 + 150
  );
  ctx.fillText(
    'at the SGC: visit the Armory, Research Lab and Infirmary, then walk into the gate to deploy.',
    cx,
    view.h * 0.44 + 170
  );
}

// ---- the SGC hub -------------------------------------------------------------

function renderHub(g) {
  const { ctx, view } = g;
  if (!g.world) return;
  ctx.save();
  ctx.translate(view.w / 2 - g.cam.x, view.h / 2 - g.cam.y);
  ctx.drawImage(g.worldCanvas, 0, 0);

  const gc = g.world.gateCenter;
  // ramp with hazard striping
  ctx.save();
  ctx.beginPath();
  ctx.rect(gc.x - 58, gc.y + 6, 116, 78);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,180,90,0.16)';
  ctx.lineWidth = 8;
  for (let i = -8; i < 16; i++) {
    ctx.beginPath();
    ctx.moveTo(gc.x - 70 + i * 14, gc.y + 90);
    ctx.lineTo(gc.x - 70 + i * 14 + 40, gc.y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,180,90,0.32)';
  ctx.lineWidth = 2;
  ctx.strokeRect(gc.x - 58, gc.y + 6, 116, 78);
  drawGate(ctx, gc, g.time);

  for (const s of g.world.stations) drawStation(ctx, s, g.time, g._nearStation === s);

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

  drawPlayer(ctx, g.player, g.time);

  if (g._atGate) {
    ctx.fillStyle = '#8ef';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('E  ·  DIAL OUT', gc.x, gc.y + 96);
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
  ctx.fillText('walk to a station and press E   ·   step into the gate to deploy   ·   TAB gear   ·   Q heal', 20, 66);

  renderMessages(g);
  if (!g.station) drawCrosshair(g);
}

function panelFrame(g, title, sub) {
  const { ctx, view } = g;
  ctx.fillStyle = 'rgba(4,6,12,0.82)';
  ctx.fillRect(0, 0, view.w, view.h);
  const w = Math.min(760, view.w - 80);
  const h = Math.min(520, view.h - 80);
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
  ctx.fillText(`naquadah ${g.save.naquadah}   ·   intel ${g.save.intel || 0}`, x + w - 24, y + 34);
  return { x, y, w, h };
}

function renderStationPanel(g) {
  if (g.station === 'research') renderResearchPanel(g);
  else if (g.station === 'infirmary') renderInfirmaryPanel(g);
  else if (g.station === 'requisitions') renderRequisitionsPanel(g);
  else g.station = null;
}

function renderResearchPanel(g) {
  const { ctx } = g;
  const fr = panelFrame(g, 'RESEARCH LAB', 'spend naquadah + intel — permanent, carries across every run.  ESC to close');
  if (!TECH.length) {
    ctx.fillStyle = '#9ab';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('research database offline', fr.x + fr.w / 2, fr.y + fr.h / 2);
    return;
  }
  const branches = ['ops', 'armory', 'gate'];
  const bname = { ops: 'FIELD OPS', armory: 'ARMORY', gate: 'GATE SCIENCE' };
  const colW = (fr.w - 48) / 3;
  const owned = new Set(g.save.tech || []);
  branches.forEach((br, bi) => {
    const bx = fr.x + 24 + bi * colW;
    ctx.fillStyle = '#9cf';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(bname[br], bx + colW / 2, fr.y + 78);
    const nodes = TECH.filter((n) => n.branch === br).sort((a, b) => a.tier - b.tier);
    nodes.forEach((n, ni) => {
      const ny = fr.y + 96 + ni * 48;
      const nw = colW - 16;
      const nx = bx + 8;
      const have = owned.has(n.id);
      const ok = !have && canResearch(g.save, n.id);
      ctx.fillStyle = have ? 'rgba(80,200,120,0.18)' : ok ? 'rgba(40,90,140,0.35)' : 'rgba(40,44,54,0.4)';
      ctx.fillRect(nx, ny, nw, 42);
      ctx.strokeStyle = have ? '#5ec87a' : ok ? '#6cf' : '#455';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(nx, ny, nw, 42);
      ctx.fillStyle = have ? '#bfe' : ok ? '#dff' : '#889';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(n.name, nx + 8, ny + 15);
      ctx.fillStyle = '#8ab';
      ctx.font = '9px monospace';
      const maxc = Math.max(20, Math.floor((nw - 16) / 5.4));
      ctx.fillText(n.desc.length > maxc ? n.desc.slice(0, maxc - 1) + '…' : n.desc, nx + 8, ny + 27);
      ctx.fillStyle = have ? '#7c9' : '#9ab';
      ctx.fillText(
        have ? 'RESEARCHED' : `${n.cost.naquadah} N${n.cost.intel ? '  ' + n.cost.intel + ' I' : ''}`,
        nx + 8,
        ny + 38
      );
      if (ok) {
        g.buttons.push({
          x: nx,
          y: ny,
          w: nw,
          h: 42,
          fn: () => {
            if (!canResearch(g.save, n.id)) return;
            g.save.naquadah -= n.cost.naquadah;
            g.save.intel = (g.save.intel || 0) - (n.cost.intel || 0);
            g.save.tech = [...(g.save.tech || []), n.id];
            // apply immediately where it matters for the current session
            const e = fx(g);
            g.player.maxHp = 100 + g.save.maxHpBonus + e.maxHpBonus;
            g.player.hp = Math.min(g.player.maxHp, g.player.hp);
            persist(g.save);
            g.message('Researched: ' + n.name);
          },
        });
      }
    });
  });
}

const SHOP = [
  ['bandage', 6, 5],
  ['medkit', 24, 2],
  ['stim', 20, 1],
  ['shieldcell', 24, 1],
  ['frag', 14, 2],
];

function renderInfirmaryPanel(g) {
  const { ctx } = g;
  const fr = panelFrame(g, 'INFIRMARY & QUARTERMASTER', 'restock supplies before you deploy.  ESC to close');
  ctx.fillStyle = '#9ab';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Q uses your best-fit medical item in the field — no slot needed.', fr.x + 24, fr.y + 74);
  ctx.fillText(`carrying ${medCount(g)} points of healing`, fr.x + 24, fr.y + 90);

  SHOP.forEach(([id, price, qty], i) => {
    const def = ITEMS[id];
    const ry = fr.y + 116 + i * 52;
    const rx = fr.x + 24;
    ctx.fillStyle = 'rgba(20,28,40,0.7)';
    ctx.fillRect(rx, ry, fr.w - 48, 44);
    ctx.strokeStyle = 'rgba(120,160,210,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, fr.w - 48, 44);
    if (drawItemIcon) drawItemIcon(ctx, id, rx + 24, ry + 22, 28);
    ctx.fillStyle = def.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${def.name}  ×${qty}`, rx + 48, ry + 18);
    ctx.fillStyle = '#8ab';
    ctx.font = '9px monospace';
    ctx.fillText(def.blurb || '', rx + 48, ry + 32);
    const afford = g.save.naquadah >= price;
    button(g, `BUY  ${price} N`, rx + fr.w - 48 - 128, ry + 6, 120, 32, () => {
      if (g.save.naquadah < price) return;
      g.save.naquadah -= price;
      invAdd(g.inv, id, qty);
      saveInv(g);
      g.message('Bought ' + def.name + ' ×' + qty);
    }, afford);
  });
}

function renderRequisitionsPanel(g) {
  const { ctx } = g;
  const fr = panelFrame(g, 'REQUISITIONS', 'take one of each weapon you have unlocked in Research.  ESC to close');
  const unlocked = fx(g).unlockedWeapons || [];
  if (!unlocked.length) {
    ctx.fillStyle = '#9ab';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('no weapons unlocked yet — research the Armory branch', fr.x + fr.w / 2, fr.y + fr.h / 2);
    return;
  }
  unlocked.forEach((id, i) => {
    const def = ITEMS[id];
    if (!def) return;
    const ry = fr.y + 78 + i * 52;
    const rx = fr.x + 24;
    ctx.fillStyle = 'rgba(20,28,40,0.7)';
    ctx.fillRect(rx, ry, fr.w - 48, 44);
    ctx.strokeStyle = RARITY_COLOR[rarityOf(id)] || 'rgba(120,160,210,0.3)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, fr.w - 48, 44);
    if (drawItemIcon) drawItemIcon(ctx, id, rx + 24, ry + 22, 30);
    ctx.fillStyle = def.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(def.name, rx + 50, ry + 18);
    ctx.fillStyle = '#8ab';
    ctx.font = '9px monospace';
    ctx.fillText(def.blurb || '', rx + 50, ry + 32);
    const has = invHasSpace(g.inv, id) || true;
    button(g, 'REQUISITION', rx + fr.w - 48 - 148, ry + 6, 140, 32, () => {
      invAdd(g.inv, id, 1);
      saveInv(g);
      g.message('Requisitioned ' + def.name);
    }, has);
  });
}

function renderGateMap(g) {
  const { ctx, view } = g;
  const cx = view.w / 2;
  const cy = view.h / 2 - 10;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8cf';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(g.launching ? 'DIAL OUT — CHOOSE FIRST DESTINATION' : 'GATE NETWORK — SELECT DESTINATION', cx, 56);

  glowCircle(ctx, cx, cy, 10, '#6cf', 14);
  ctx.fillStyle = '#9cf';
  ctx.font = '11px monospace';
  ctx.fillText((g.launching ? 'SGC' : g.params.address) + '  (here)', cx, cy + 26);

  const n = g.mapNodes.length || 1;
  const R = Math.min(view.w, view.h) * 0.3;
  g.mapNodes.forEach((node, i) => {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    ctx.strokeStyle = 'rgba(120,180,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    const pr = node.prev;
    const col = pr.primary === 'wraith' ? '#9df7a0' : '#ffb347';
    glowCircle(ctx, x, y, 14, col, 12);
    ctx.fillStyle = '#cde';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(node.addr, x, y - 24);
    ctx.fillStyle = '#9ab';
    ctx.font = '10px monospace';
    ctx.fillText(
      `threat ~${pr.threat}  ${pr.primary}${pr.mods.length ? '  [' + pr.mods.join(',') + ']' : ''}`,
      x,
      y + 32
    );
    g.buttons.push({
      x: x - 62,
      y: y - 20,
      w: 124,
      h: 44,
      fn: () => (g.launching ? launchRun(g, node.addr) : startWorld(g, node.addr, g.hop + 1)),
    });
  });

  if (g.launching) {
    button(g, 'CANCEL  (Esc)', cx - 90, view.h - 68, 180, 40, () => {
      g.launching = false;
      enterHub(g);
    });
  } else {
    button(g, `DIAL HOME  —  bank ${g.runNaq} naquadah`, cx - 170, view.h - 68, 340, 40, () => dialHome(g));
  }
}

function renderDead(g) {
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
