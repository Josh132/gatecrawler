// Headless test harness for Gate Crawler.
// Mocks just enough of the browser to run the real game modules under Node,
// then drives the game with a scripted "bot" and asserts invariants.

import { mulberry32 } from '../src/rng.js';

// ---------------------------------------------------------------- deterministic RNG
const SEED = (parseInt(process.env.SEED || '', 10) || 0xc0ffee) >>> 0;
const seededRand = mulberry32(SEED);
Math.random = () => seededRand();
console.log('harness seed: 0x' + SEED.toString(16));

// ---------------------------------------------------------------- DOM / browser mocks
const listeners = new Map();
function rec(map, type, fn) {
  if (!map.has(type)) map.set(type, []);
  map.get(type).push(fn);
}
export function fire(map, type, ev) {
  for (const fn of map.get(type) || []) fn(ev);
}

class Ctx2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.shadowBlur = 0;
    this.shadowColor = '#000';
    this.font = '10px monospace';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
  }
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  setTransform() {}
  clearRect() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  arcTo() {}
  ellipse() {}
  rect() {}
  roundRect() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  clip() {}
  setLineDash() {}
  fill() {}
  stroke() {}
  drawImage() {}
  fillText() {}
  measureText() {
    return { width: 10 };
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
  createLinearGradient() {
    return { addColorStop() {} };
  }
}

class MockCanvas {
  constructor() {
    this.width = 960;
    this.height = 600;
    this.style = {};
    this._l = new Map();
    this._ctx = new Ctx2D(this);
  }
  getContext() {
    return this._ctx;
  }
  addEventListener(t, fn) {
    rec(this._l, t, fn);
  }
  removeEventListener() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
}

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const dbgEl = { textContent: '' };
const gameCanvas = new MockCanvas();

const documentMock = {
  getElementById: (id) => (id === 'game' ? gameCanvas : id === 'dbg' ? dbgEl : null),
  createElement: () => new MockCanvas(),
  addEventListener: (t, fn) => rec(listeners, t, fn),
};

globalThis.window = globalThis;
globalThis.document = documentMock;
globalThis.localStorage = localStorage;
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 960;
globalThis.innerHeight = 600;
globalThis.location = { search: '' };
globalThis.addEventListener = (t, fn) => rec(listeners, t, fn);
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.AudioContext = class {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  resume() {}
  createBuffer() {
    return { getChannelData: () => new Float32Array(8) };
  }
  createBufferSource() {
    return { buffer: null, connect: () => ({ connect: () => ({ connect() {} }) }), start() {}, stop() {} };
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect: () => ({ connect: () => ({ connect() {} }) }) };
  }
  createOscillator() {
    return { type: 'sine', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => ({ connect() {} }) }), start() {}, stop() {} };
  }
  createBiquadFilter() {
    return { type: 'lowpass', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect: () => ({ connect: () => ({ connect() {} }) }) };
  }
};

// ---------------------------------------------------------------- load game
const { createGame } = await import('../src/game.js');
const input = await import('../src/input.js');
const { initInput } = input;
const { TILE, tileAt } = await import('../src/worldgen.js');
const { makeFlowField } = await import('../src/pathfind.js');
const { worldParams, neighbors, HOME } = await import('../src/address.js');
const { buildWorld } = await import('../src/worldgen.js');
const inv = await import('../src/inventory.js');
const { ITEMS } = await import('../src/items.js');
const tech = await import('../src/tech.js');
const icons = await import('../src/icons.js');

// ---------------------------------------------------------------- assertions
let failures = 0;
let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  }
}
function section(name) {
  console.log('\n=== ' + name + ' ===');
}

// ---------------------------------------------------------------- helpers
function keyDown(code) {
  fire(listeners, 'keydown', { code, repeat: false, preventDefault() {} });
}
function keyUp(code) {
  fire(listeners, 'keyup', { code });
}
function setKeys(set) {
  for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    if (set.has(c)) input.keys.add(c);
    else input.keys.delete(c);
  }
}
function clickAt(x, y) {
  fire(gameCanvas._l, 'click', { clientX: x, clientY: y });
}

const STEP = 1 / 60;

function findRoomDbg(g, x, y) {
  for (const r of g.world.rooms) {
    const R = r.rectPx;
    if (x >= R.x && x <= R.x + R.w && y >= R.y && y <= R.y + R.h) return r;
  }
  return null;
}

function checkInvariants(g, label) {
  const p = g.player;
  assert(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: player pos finite`);
  assert(Number.isFinite(p.hp), `${label}: player hp finite`);
  assert(Number.isFinite(p.kx) && Number.isFinite(p.ky), `${label}: player knockback finite`);
  assert(Number.isFinite(p.aim), `${label}: player aim finite`);
  assert(['menu', 'play', 'gatemap', 'dead'].includes(g.state), `${label}: valid state (${g.state})`);
  assert(g.enemies.length < 4000, `${label}: enemy count bounded (${g.enemies.length})`);
  assert(g.bullets.length < 6000, `${label}: bullet count bounded (${g.bullets.length})`);
  assert(g.particles.length < 20000, `${label}: particle count bounded (${g.particles.length})`);
  if (g.world) {
    const W = g.world.W * TILE;
    const H = g.world.H * TILE;
    assert(p.x >= -2 && p.x <= W + 2 && p.y >= -2 && p.y <= H + 2, `${label}: player in world bounds`);
    // player centre should not be embedded inside a wall tile
    if (g.state === 'play') {
      assert(tileAt(g.world, p.x, p.y) === 0, `${label}: player not inside a wall @ (${p.x | 0},${p.y | 0})`);
    }
    for (const e of g.enemies) {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) {
        assert(false, `${label}: enemy ${e.kind} pos finite`);
        break;
      }
    }
  }
}

let clock = 0;
function tick(gApi, g) {
  clock += STEP;
  try {
    gApi.update(STEP);
    gApi.render(STEP);
  } catch (err) {
    failures++;
    console.error(`  ✗ EXCEPTION @ t=${clock.toFixed(2)} state=${g.state}: ${err && err.stack ? err.stack : err}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- 1. worldgen
section('worldgen: connectivity & structure across many seeds');
{
  const seen = new Set([HOME]);
  const frontier = [HOME];
  const addrs = [];
  while (addrs.length < 240 && frontier.length) {
    const a = frontier.shift();
    addrs.push(a);
    for (const nb of neighbors(a, 5)) {
      if (!seen.has(nb)) {
        seen.add(nb);
        frontier.push(nb);
      }
    }
  }
  let connOk = 0;
  let structOk = 0;
  for (let i = 0; i < addrs.length; i++) {
    const params = worldParams(addrs[i], i % 9);
    const world = buildWorld(params);
    const gate = world.gateRoom;
    const dhd = world.dhdRoom;
    if (gate && dhd && gate !== dhd) structOk++;
    // flood fill from gate centre tile
    const gx = Math.floor(gate.centerPx.x / TILE);
    const gy = Math.floor(gate.centerPx.y / TILE);
    const ff = makeFlowField(world.grid, world.W, world.H);
    ff.compute(gx, gy);
    const dx = Math.floor(dhd.centerPx.x / TILE);
    const dy = Math.floor(dhd.centerPx.y / TILE);
    if (ff.dist[dy * world.W + dx] >= 0) connOk++;
    // spawn tiles must be floor
    assert(tileAt(world, gate.centerPx.x, gate.centerPx.y) === 0, `seed ${i}: gate centre is floor`);
  }
  assert(structOk === addrs.length, `all ${addrs.length} worlds have distinct gate/DHD rooms (${structOk})`);
  assert(connOk === addrs.length, `all ${addrs.length} worlds: DHD reachable from gate (${connOk})`);
}

// ---------------------------------------------------------------- 2. address determinism
section('address: determinism');
{
  const a = worldParams('AUR-CRT-VIR-BOO-CEN-SER', 3);
  const b = worldParams('AUR-CRT-VIR-BOO-CEN-SER', 3);
  assert(JSON.stringify(a) === JSON.stringify(b), 'worldParams is deterministic');
  const n1 = neighbors('AUR-CRT-VIR-BOO-CEN-SER').join(',');
  const n2 = neighbors('AUR-CRT-VIR-BOO-CEN-SER').join(',');
  assert(n1 === n2 && n1.length > 0, 'neighbors deterministic and non-empty');
  const w1 = JSON.stringify(buildWorld(a).grid.length);
  const w2 = JSON.stringify(buildWorld(worldParams('AUR-CRT-VIR-BOO-CEN-SER', 3)).grid.length);
  assert(w1 === w2, 'buildWorld grid size deterministic for a seed');
}

// ---------------------------------------------------------------- 3. full play loop
section('gameplay: menu -> deep run -> gatemap -> death -> menu');
const gApi = createGame(gameCanvas);
const g = gApi.g;
initInput(gameCanvas);
g.visEnabled = false; // cheap circular vis for the long simulated loops
g.skipHub = true; // bypass the walkable SGC hub — deploy straight from HOME

function inPolyFlat(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

assert(g.state === 'menu', 'starts in menu');
tick(gApi, g);
checkInvariants(g, 'menu');

// start a run from the menu with Enter
keyDown('Enter');
tick(gApi, g);
assert(g.state === 'play', 'Enter from menu starts a run');
assert(!!g.world, 'world built on run start');

const MAX_WORLDS = 6;
let worldsVisited = 0;
let reachedGatemap = 0;
let sawDeath = false;
let frames = 0;
let failsafeUsed = 0;
let maxHop = 0;
let bossKills = 0;
let roomsClearedLegit = 0;
const prevCleared = new WeakSet();

function botFlowFor(world) {
  const ff = makeFlowField(world.grid, world.W, world.H);
  const d = world.dhdRoom.centerPx;
  ff.compute(
    Math.max(1, Math.min(world.W - 2, Math.floor(d.x / TILE))),
    Math.max(1, Math.min(world.H - 2, Math.floor(d.y / TILE)))
  );
  return ff;
}
let botFlow = botFlowFor(g.world);
let curWorldRef = g.world;
let stallFrames = 0;
let lastPos = { x: 0, y: 0 };
let stuckFor = 0;
let unstickDir = 0;

for (let i = 0; i < 60 * 240 && worldsVisited < MAX_WORLDS; i++) {
  frames++;

  if (g.state === 'play') {
    if (g.hop > maxHop) maxHop = g.hop;
    if (g.world !== curWorldRef) {
      curWorldRef = g.world;
      botFlow = botFlowFor(g.world);
      stallFrames = 0;
    }
    const p = g.player;
    const tx = Math.max(1, Math.min(g.world.W - 2, Math.floor(p.x / TILE)));
    const ty = Math.max(1, Math.min(g.world.H - 2, Math.floor(p.y / TILE)));
    // Simple, reliable strategy: march toward the DHD, shoot whatever is nearest,
    // lean off-axis a little so shots land on the flank, dodge on cooldown.
    let [mx, my] = botFlow.dir(tx, ty);

    let near = null;
    let nd = Infinity;
    let boss = null;
    for (const e of g.enemies) {
      if (e.kind === 'boss' && e.state === 'active') boss = e;
      const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d2 < nd) {
        nd = d2;
        near = e;
      }
    }
    // when a fight drags, commit to the boss like a real player would
    if (boss && stallFrames > 60 * 6) near = boss;
    const ndist = near ? Math.hypot(near.x - p.x, near.y - p.y) : Infinity;

    if (near && ndist < 90) {
      // don't faceplant into melee: veer around
      const ex = (near.x - p.x) / (ndist || 1);
      const ey = (near.y - p.y) / (ndist || 1);
      mx = mx * 0.3 - ey;
      my = my * 0.3 + ex;
    } else if (near && ndist < 260) {
      // slight sidestep while still advancing
      const ey = (near.y - p.y) / (ndist || 1);
      const ex = (near.x - p.x) / (ndist || 1);
      mx += -ey * 0.5;
      my += ex * 0.5;
    }

    // stuck detector
    if (Math.hypot(p.x - lastPos.x, p.y - lastPos.y) < 0.5) stuckFor++;
    else stuckFor = 0;
    lastPos = { x: p.x, y: p.y };
    if (stuckFor > 30) {
      unstickDir += 1.3;
      mx = Math.cos(unstickDir);
      my = Math.sin(unstickDir);
      if (stuckFor > 120) stuckFor = 0;
    }

    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const kset = new Set();
    if (mx > 0.35) kset.add('KeyD');
    if (mx < -0.35) kset.add('KeyA');
    if (my > 0.35) kset.add('KeyS');
    if (my < -0.35) kset.add('KeyW');
    setKeys(kset);

    const tgt = near || { x: p.x + Math.cos(p.aim) * 100, y: p.y + Math.sin(p.aim) * 100 };
    input.mouse.x = tgt.x - g.cam.x + g.view.w / 2;
    input.mouse.y = tgt.y - g.cam.y + g.view.h / 2;
    input.mouse.down = true;

    if (p.dodgeCd <= 0 && near && ndist < 220) keyDown('Space');
    if (g.dhdActive) keyDown('KeyE');

    const bossBefore = g.enemies.some((e) => e.kind === 'boss');
    if (!tick(gApi, g)) break;
    checkInvariants(g, `play w${worldsVisited}`);
    if (bossBefore && !g.enemies.some((e) => e.kind === 'boss') && g.state === 'play') bossKills++;
    for (const rm of g.world.rooms) {
      if (rm.cleared && !prevCleared.has(rm)) {
        prevCleared.add(rm);
        roomsClearedLegit++;
      }
    }

    // failsafe: only if a world genuinely stalls (~45s), cull so the harness can proceed
    stallFrames++;
    if (stallFrames > 60 * 90 && g.enemies.length) {
      failsafeUsed++;
      const p2 = g.player;
      const dc = g.world.dhdRoom.centerPx;
      const dd = Math.hypot(dc.x - p2.x, dc.y - p2.y).toFixed(0);
      const inDhd = findRoomDbg(g, p2.x, p2.y) === g.world.dhdRoom;
      const byState = {};
      let inCur = 0;
      for (const e of g.enemies) {
        byState[e.state] = (byState[e.state] || 0) + 1;
        if (e._room === g.curRoom) inCur++;
      }
      console.log(
        `    stall#${failsafeUsed}: threat ${g.params.threat} enemies ${g.enemies.length} ` +
          `states ${JSON.stringify(byState)} inCurRoom ${inCur} curRoom=${g.curRoom === g.world.dhdRoom ? 'dhd' : 'other'} ` +
          `distToDHD ${dd} inDhdRoom ${inDhd} dhdActive ${g.dhdActive}`
      );
      for (const e of g.enemies) e.hp = -1;
      stallFrames = 0;
    }
  } else if (g.state === 'gatemap') {
    reachedGatemap++;
    // click the first destination node button
    const node = g.buttons.find((b) => b.w >= 100 && b.h <= 60);
    if (node) {
      clickAt(node.x + node.w / 2, node.y + node.h / 2);
      worldsVisited++;
    } else {
      // dial home button
      const home = g.buttons[g.buttons.length - 1];
      if (home) clickAt(home.x + home.w / 2, home.y + home.h / 2);
    }
    input.mouse.down = false;
    if (!tick(gApi, g)) break;
    checkInvariants(g, 'gatemap');
  } else if (g.state === 'dead') {
    sawDeath = true;
    input.mouse.down = false;
    keyDown('Enter');
    if (!tick(gApi, g)) break;
    // with skipHub the death screen redeploys straight into a fresh run
    assert(g.state === 'play' || g.state === 'menu', 'Enter from dead redeploys');
    if (g.state === 'menu') {
      keyDown('Enter');
      tick(gApi, g);
    }
    if (g.state === 'play') {
      curWorldRef = g.world;
      botFlow = botFlowFor(g.world);
    }
  } else if (g.state === 'menu') {
    keyDown('Enter');
    if (!tick(gApi, g)) break;
  }
}

console.log(
  `  bot: gatemap ${reachedGatemap}x, worlds ${worldsVisited}, legit boss kills ${bossKills}, ` +
    `rooms cleared ${roomsClearedLegit}, max hop ${maxHop}, failsafe used ${failsafeUsed}x, deaths ${sawDeath ? 'yes' : 'no'}`
);
assert(reachedGatemap > 0, `bot reached the DHD / gate map at least once (${reachedGatemap}x)`);
assert(worldsVisited >= 2, `bot dialed through multiple worlds (${worldsVisited})`);
assert(roomsClearedLegit >= 3, `rooms cleared by real combat (${roomsClearedLegit})`);
assert(bossKills >= 1, `boss defeated by real combat at least once (${bossKills})`);
assert(failsafeUsed === 0, `no stall failsafe needed (used ${failsafeUsed}x)`);
assert(g.save.known.length > 1, `save recorded multiple known addresses (${g.save.known.length})`);
checkInvariants(g, 'final');

// ---------------------------------------------------------------- 3b. deep descent
section('gameplay: descend hop 0 -> 14 through the real gate map, invariants each world');
{
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g); // -> play at hop 0
  assert(g.state === 'play', 'deep test: run started');

  let deepThreatSeen = 0;
  const modsSeen = new Set();
  let lastHop = g.hop;

  for (let d = 0; d < 14; d++) {
    // idle in the gate room a moment (no input) — exercises this deep world's
    // generation + render without a firefight
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) input.keys.delete(c);
    input.mouse.down = false;
    for (let f = 0; f < 90; f++) {
      if (!tick(gApi, g)) break;
      checkInvariants(g, `deep hop ${g.hop}`);
    }
    if (g.params) {
      deepThreatSeen = Math.max(deepThreatSeen, g.params.threat);
      for (const m of g.params.mods) modsSeen.add(m);
    }
    // then teleport onto the DHD and dial the next hop
    const dhd = g.world.dhdRoom;
    dhd.spawned = true;
    g.enemies.length = 0;
    g.player.hp = g.player.maxHp;
    g.runNaq = 99999; // afford the deep-dial power cost
    g.dhdActive = true;
    g.player.x = dhd.centerPx.x;
    g.player.y = dhd.centerPx.y;
    for (let k = 0; k < 30 && g.state === 'play'; k++) {
      keyDown('KeyE');
      if (!tick(gApi, g)) break;
    }
    assert(g.state === 'gatemap', `deep hop ${lastHop}: DHD opens the gate map`);
    if (g.state !== 'gatemap') break;
    tick(gApi, g); // render map -> buttons
    const node = g.buttons.find((b) => b.w >= 100 && b.h <= 60);
    assert(!!node, `deep hop ${lastHop}: gate map offers a destination`);
    if (!node) break;
    node.fn(); // descend one hop
    lastHop = g.hop;
    assert(g.state === 'play', `deep hop ${lastHop}: dialing enters the next world`);
    if (g.state !== 'play') break;
  }

  assert(lastHop >= 12, `descended deep through live gate map (hop ${lastHop})`);
  assert(deepThreatSeen >= 10, `deep worlds carry high threat (max ${deepThreatSeen})`);
  assert(modsSeen.size >= 2, `multiple modifier types generated at depth (${[...modsSeen].join(',') || 'none'})`);
  checkInvariants(g, 'deep-final');
}

// ---------------------------------------------------------------- 3c. line of sight
section('line of sight: polygon bounded, walls occlude, self is lit');
{
  g.visEnabled = true;
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  const bf = botFlowFor(g.world);
  for (let f = 0; f < 60 * 6; f++) {
    const p = g.player;
    const tx = Math.max(1, Math.min(g.world.W - 2, Math.floor(p.x / TILE)));
    const ty = Math.max(1, Math.min(g.world.H - 2, Math.floor(p.y / TILE)));
    const [mx, my] = bf.dir(tx, ty);
    const ks = new Set();
    if (mx > 0.35) ks.add('KeyD');
    if (mx < -0.35) ks.add('KeyA');
    if (my > 0.35) ks.add('KeyS');
    if (my < -0.35) ks.add('KeyW');
    setKeys(ks);
    input.mouse.down = false;
    if (!tick(gApi, g)) break;
    checkInvariants(g, 'los');
    if (g.enemies.length >= 2 && f > 120) break;
  }
  const poly = g.visPoly;
  assert(Array.isArray(poly) && poly.length >= 24, `visibility polygon built (${poly ? poly.length : 0} coords)`);
  const p = g.player;
  let maxr = 0;
  for (let i = 0; i < poly.length; i += 2) maxr = Math.max(maxr, Math.hypot(poly[i] - p.x, poly[i + 1] - p.y));
  assert(maxr <= 800, `polygon never exceeds the view radius (max ${maxr | 0})`);
  assert(inPolyFlat(p.x, p.y, poly), 'player stands inside its own visibility polygon');
  // find a point one tile beyond the first wall east of the player — must be dark
  let beyond = null;
  for (let d = TILE; d < 470; d += TILE * 0.5) {
    if (tileAt(g.world, p.x + d, p.y) === 1) {
      beyond = { x: p.x + d + TILE * 1.5, y: p.y };
      break;
    }
  }
  if (beyond && tileAt(g.world, beyond.x, beyond.y) === 0) {
    assert(!inPolyFlat(beyond.x, beyond.y, poly), 'floor beyond a wall is outside the visibility polygon');
  }
  // a near point with clear line should be lit
  assert(inPolyFlat(p.x + 12, p.y, poly) || tileAt(g.world, p.x + 12, p.y) === 1, 'adjacent clear floor is lit');
  g.visEnabled = false;
}

// ---------------------------------------------------------------- 3d. no spawn pop-in
section('spawning: rooms are populated up front, enemies idle until noticed');
{
  g.state = 'menu';
  keyDown('Enter');
  for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) input.keys.delete(c);
  input.mouse.down = false;
  tick(gApi, g); // -> play at hop 0, before the player has moved
  const p0 = g.player;
  assert(g.state === 'play', 'popin: run started');
  assert(g.enemies.length > 0, `popin: enemies exist at world start (${g.enemies.length})`);
  const nonGateRooms = g.world.rooms.filter((r) => r.kind !== 'gate');
  const roomsWithEnemies = nonGateRooms.filter((r) => g.enemies.some((e) => e._room === r));
  assert(
    roomsWithEnemies.length === nonGateRooms.length,
    `popin: every non-gate room is already populated (${roomsWithEnemies.length}/${nonGateRooms.length})`
  );
  assert(g.enemies.every((e) => e.state === 'idle'), 'popin: all enemies start idle');
  // a far enemy stays idle; step through a few seconds without moving
  const far = g.enemies.reduce((a, b) =>
    Math.hypot(b.x - p0.x, b.y - p0.y) > Math.hypot(a.x - p0.x, a.y - p0.y) ? b : a
  );
  for (let f = 0; f < 60 * 3; f++) tick(gApi, g);
  assert(far.state === 'idle' || !far.alive, 'popin: a distant enemy stays idle while the player holds still');
  // now march the bot toward the DHD and confirm enemies wake as it nears them
  const bf = botFlowFor(g.world);
  let anyWoke = false;
  for (let f = 0; f < 60 * 20 && !anyWoke; f++) {
    const p = g.player;
    const tx = Math.max(1, Math.min(g.world.W - 2, Math.floor(p.x / TILE)));
    const ty = Math.max(1, Math.min(g.world.H - 2, Math.floor(p.y / TILE)));
    const [mx, my] = bf.dir(tx, ty);
    const ks = new Set();
    if (mx > 0.35) ks.add('KeyD');
    if (mx < -0.35) ks.add('KeyA');
    if (my > 0.35) ks.add('KeyS');
    if (my < -0.35) ks.add('KeyW');
    setKeys(ks);
    if (!tick(gApi, g)) break;
    checkInvariants(g, 'popin-march');
    anyWoke = g.enemies.some((e) => e.state === 'active');
  }
  assert(anyWoke, 'popin: enemies wake to active when the player approaches');
  setKeys(new Set());
}

// ---------------------------------------------------------------- 3e. inventory / gear
section('inventory: add / move / equip / consume / damage-resist / grenade');
{
  const iv = inv.createInventory();
  assert(iv.equip.weapon1 && iv.equip.weapon1.id === 'w_p90', 'inv: starts with P90 in weapon1');
  assert(inv.activeWeaponId(iv) === 'p90', 'inv: active weapon resolves to p90');

  // add stacking
  inv.invAdd(iv, 'bandage', 5);
  let total = iv.grid.reduce((n, c) => n + (c && c.id === 'bandage' ? c.count : 0), 0) +
    (iv.hotbar[0] && iv.hotbar[0].id === 'bandage' ? iv.hotbar[0].count : 0);
  assert(total === 8, `inv: bandages stacked to 8 (got ${total})`);

  // put an armour piece in the grid, equip it to its region
  inv.invAdd(iv, 'a_plate', 1);
  const gi = iv.grid.findIndex((c) => c && c.id === 'a_plate');
  assert(gi >= 0, 'inv: armour landed in the grid');
  const okEquip = inv.moveStack(iv, { kind: 'grid', i: gi }, { kind: 'equip', key: 'torso' });
  assert(okEquip && iv.equip.torso && iv.equip.torso.id === 'a_plate', 'inv: armour equips to torso');
  // reject armour into a weapon slot
  inv.invAdd(iv, 'a_helm', 1);
  const hi = iv.grid.findIndex((c) => c && c.id === 'a_helm');
  const badEquip = inv.moveStack(iv, { kind: 'grid', i: hi }, { kind: 'equip', key: 'weapon2' });
  assert(!badEquip && !iv.equip.weapon2, 'inv: a helmet cannot go in a weapon slot');

  // derived resist
  const dr = inv.regionDR(iv);
  assert(Math.abs(dr.torso - ITEMS.a_plate.dr) < 1e-6, `inv: torso DR reflects Serpent Plate (${dr.torso})`);
  assert(dr.head === 0, 'inv: head DR is 0 with nothing equipped there');

  // hotbar consume
  const before = iv.hotbar[0].count;
  const used = inv.takeFromHot(iv, 0);
  assert(used && used.use === 'heal' && iv.hotbar[0].count === before - 1, 'inv: takeFromHot decrements and returns the def');

  // weapon swap
  inv.invAdd(iv, 'w_staff', 1);
  const si = iv.grid.findIndex((c) => c && c.id === 'w_staff');
  inv.moveStack(iv, { kind: 'grid', i: si }, { kind: 'equip', key: 'weapon2' });
  assert(inv.toggleWeapon(iv) === 'staff', 'inv: Q swaps to the staff in weapon2');
  assert(inv.toggleWeapon(iv) === 'p90', 'inv: Q swaps back to the P90');

  // hit-region distribution is a valid pdf
  const counts = {};
  const rnd = (function () {
    let s = 12345;
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  })();
  for (let i = 0; i < 4000; i++) {
    const reg = inv.rollHitRegion(rnd);
    counts[reg] = (counts[reg] || 0) + 1;
  }
  assert(counts.torso > counts.head && counts.none > 0, `inv: hit regions weighted sensibly (${JSON.stringify(counts)})`);
}

// live: equipped armour actually reduces incoming damage, and a grenade kills
section('inventory (live): armour cuts damage, thrown grenade damages enemies');
{
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  const p = g.player;

  // baseline: strip armour, take a fixed hit
  g.inv.equip.head = g.inv.equip.torso = g.inv.equip.legs = g.inv.equip.feet = null;
  p.hp = 100;
  p.iframe = 0;
  p.dodge = 0;
  // force a torso hit with no DR by calling the exported path indirectly:
  // spawn an enemy bolt right on the player
  const dmgOnce = () => {
    p.hp = 100;
    p.iframe = 0;
    const hp0 = p.hp;
    // simulate: many bolts so region-roll averages out
    let taken = 0;
    for (let k = 0; k < 200; k++) {
      p.iframe = 0;
      p.hp = 100;
      // reach into the module via a bullet hitting the player
      g.bullets.push({
        x: p.x,
        y: p.y,
        vx: 100,
        vy: 0,
        dmg: 20,
        from: 'enemy',
        r: 4,
        life: 1,
        stun: 0,
        trail: [],
        alive: true,
        color: '#f80',
      });
      tick(gApi, g);
      taken += 100 - p.hp;
    }
    return taken / 200;
  };
  const bare = dmgOnce();
  // now full heavy armour
  g.inv.equip.head = { id: 'a_helm', count: 1 };
  g.inv.equip.torso = { id: 'a_plate', count: 1 };
  g.inv.equip.legs = { id: 'a_greaves', count: 1 };
  g.inv.equip.feet = { id: 'a_boots', count: 1 };
  const armoured = dmgOnce();
  assert(armoured < bare * 0.85, `armour reduces average damage taken (${bare.toFixed(1)} -> ${armoured.toFixed(1)})`);

  // grenade: equip frags, drop an enemy next to the player, throw, confirm damage
  g.inv.equip.grenade = { id: 'frag', count: 2 };
  const { Enemy } = await import('../src/entities.js');
  const foe = new Enemy('jaffa', p.x + 130, p.y, 2);
  foe.state = 'idle';
  foe._room = g.curRoom;
  foe.hp = 500; // survive the blast so we can read the delta
  foe.maxHp = 500;
  const foeHp0 = foe.hp;
  g.enemies.push(foe);
  p.aim = 0;
  keyDown('KeyG');
  tick(gApi, g);
  assert(g.grenades.length === 1, 'grenade: one grenade is in flight after G');
  assert(g.inv.equip.grenade.count === 1, 'grenade: throwing consumed one from the grenade slot');
  // steer the live grenade onto the target and let its fuse run out
  g.grenades[0].x = foe.x;
  g.grenades[0].y = foe.y;
  g.grenades[0].vx = 0;
  g.grenades[0].vy = 0;
  g.grenades[0].fuse = 0.01;
  tick(gApi, g);
  tick(gApi, g);
  assert(foe.hp < foeHp0, `grenade: blast damaged the nearby enemy (${foeHp0} -> ${foe.hp | 0})`);
  assert(g.grenades.length === 0, 'grenade: detonated grenade is removed');
}

// ---------------------------------------------------------------- 3f. new weapons + reload
section('weapons: shotgun/burst/launcher/beam fire, consume mag, reload from reserve');
{
  const { WEAPONS } = await import('../src/weapons.js');
  const { Enemy } = await import('../src/entities.js');

  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  assert(g.state === 'play', 'weapons: run started');
  const p = g.player;
  p.iframe = 1e6; // this bench is about the guns, not survival
  g.enemies.length = 0;
  g.bullets.length = 0;

  const equip = (wid) => {
    g.inv.equip.weapon1 = { id: 'w_' + wid, count: 1 };
    g.inv.active = 'weapon1';
    assert(inv.activeWeaponId(g.inv) === wid, `weapons: w_${wid} resolves to ${wid}`);
  };
  const resetGun = (wid) => {
    delete p.mag[wid];
    p.ammo[wid] = WEAPONS[wid].ammoMax;
    p.cool = 0;
    p.reloadT = 0;
    p.reloading = false;
    p.burstN = 0;
    p.stun = 0;
    p.dodge = 0;
    p.aim = 0;
    input.mouse.down = false;
    g.mouseWasDown = false;
  };

  // --- fire + mag decrement + manual R reload for the magazine weapons
  for (const wid of ['shotgun', 'burst', 'launcher']) {
    equip(wid);
    const wp = WEAPONS[wid];
    resetGun(wid);
    tick(gApi, g); // lazy-init p.mag[wid]
    assert(p.mag[wid] === wp.mag, `weapons: ${wid} mag lazily inits to ${wp.mag} (got ${p.mag[wid]})`);

    const before = g.bullets.length;
    g.mouseWasDown = false;
    input.mouse.down = true; // trigger down-edge
    tick(gApi, g);
    input.mouse.down = false;
    assert(g.bullets.length > before, `weapons: ${wid} spawned projectiles`);
    for (let f = 0; f < 30; f++) tick(gApi, g); // let a burst finish / cool
    const magAfterFire = p.mag[wid];
    assert(magAfterFire < wp.mag, `weapons: ${wid} firing consumed mag (${wp.mag} -> ${magAfterFire})`);

    // top the reserve back up, then reload with R
    p.ammo[wid] = wp.ammoMax;
    keyDown('KeyR');
    tick(gApi, g);
    keyUp('KeyR');
    assert(p.reloadT > 0 || p.mag[wid] === wp.mag, `weapons: ${wid} R begins a reload`);
    for (let f = 0; f < 150; f++) tick(gApi, g); // > 1.6s reloads finish
    assert(p.mag[wid] === wp.mag, `weapons: ${wid} reload refilled the mag (got ${p.mag[wid]})`);
    assert(
      p.ammo[wid] === wp.ammoMax - (wp.mag - magAfterFire),
      `weapons: ${wid} reload pulled the delta from reserve (reserve ${p.ammo[wid]})`
    );
  }

  // --- burst rifle really queues the extra rounds off one click
  equip('burst');
  resetGun('burst');
  tick(gApi, g);
  const bm0 = p.mag.burst;
  g.mouseWasDown = false;
  input.mouse.down = true;
  tick(gApi, g);
  input.mouse.down = false;
  for (let f = 0; f < 24; f++) tick(gApi, g);
  assert(
    bm0 - p.mag.burst === WEAPONS.burst.burst,
    `weapons: one click fired a ${WEAPONS.burst.burst}-round burst (used ${bm0 - p.mag.burst})`
  );

  // --- launcher blast damages an enemy the shell never directly touches
  equip('launcher');
  resetGun('launcher');
  g.enemies.length = 0;
  g.bullets.length = 0;
  const lfoe = new Enemy('jaffa', p.x + 240, p.y + 60, 3);
  lfoe.state = 'idle';
  lfoe._room = g.curRoom;
  lfoe.hp = lfoe.maxHp = 600;
  g.enemies.push(lfoe);
  tick(gApi, g);
  g.mouseWasDown = false;
  input.mouse.down = true;
  tick(gApi, g);
  input.mouse.down = false;
  const shell = g.bullets[g.bullets.length - 1];
  assert(!!shell && shell.explode, 'weapons: launcher shell is explosive');
  if (shell) {
    shell.x = lfoe.x - 45; // land it beside the foe, not on it
    shell.y = lfoe.y;
    shell.vx = shell.vy = 0;
    shell.life = 0.01;
  }
  const lhp0 = lfoe.hp;
  tick(gApi, g);
  tick(gApi, g);
  assert(lfoe.hp < lhp0, `weapons: launcher blast caught the nearby enemy (${lhp0} -> ${lfoe.hp | 0})`);

  // --- beam: continuous hitscan damages the first enemy on the ray and drains its cell
  equip('beam');
  resetGun('beam');
  g.enemies.length = 0;
  g.bullets.length = 0;
  // aim down an axis that is clear of walls for at least 140px
  let bang = 0;
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    let clear = true;
    for (let d = 20; d <= 140 && clear; d += 10) {
      if (tileAt(g.world, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d) === 1) clear = false;
    }
    if (clear) {
      bang = a;
      break;
    }
  }
  const zfoe = new Enemy('jaffa', p.x + Math.cos(bang) * 110, p.y + Math.sin(bang) * 110, 3);
  zfoe.state = 'idle';
  zfoe._room = g.curRoom;
  zfoe.hp = zfoe.maxHp = 600;
  g.enemies.push(zfoe);
  // updatePlay derives p.aim from the mouse, so steer the mouse onto the foe each frame
  const aimAt = (t) => {
    input.mouse.x = t.x - g.cam.x + g.view.w / 2;
    input.mouse.y = t.y - g.cam.y + g.view.h / 2;
  };
  aimAt(zfoe);
  tick(gApi, g);
  const beamMag0 = p.mag.beam;
  const zhp0 = zfoe.hp;
  input.mouse.down = true;
  for (let f = 0; f < 45; f++) {
    aimAt(zfoe);
    tick(gApi, g);
  }
  input.mouse.down = false;
  assert(zfoe.hp < zhp0, `weapons: beam burned the enemy on the ray (${zhp0} -> ${zfoe.hp | 0})`);
  assert(p.mag.beam < beamMag0, `weapons: beam drained its cell while held (${beamMag0.toFixed(1)} -> ${p.mag.beam.toFixed(1)})`);
  assert(!!g.player.beam && typeof g.player.beam === 'object', 'weapons: beam exposes render state');

  // --- restore a clean slate for the sections that follow
  g.enemies.length = 0;
  g.bullets.length = 0;
  g.inv.equip.weapon1 = { id: 'w_p90', count: 1 };
  g.inv.equip.weapon2 = null;
  g.inv.active = 'weapon1';
  p.iframe = 0;
  p.reloadT = 0;
  p.burstN = 0;
  input.mouse.down = false;
  g.mouseWasDown = false;
}

// ---------------------------------------------------------------- 4. hub + persistence
section('hub: walkable SGC, station panels, deploy via the gate, persistence');
{
  g.skipHub = false;
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  assert(g.state === 'hub' && g.hub, `Enter from menu enters the hub (state=${g.state})`);
  assert(g.world && g.world.isHub && Array.isArray(g.world.stations) && g.world.stations.length >= 3, 'hub world has stations');

  // open a station panel by teleporting next to it and pressing E
  const research = g.world.stations.find((s) => s.kind === 'research');
  g.player.x = research.x;
  g.player.y = research.y + 8;
  for (let f = 0; f < 4; f++) tick(gApi, g);
  keyDown('KeyE');
  tick(gApi, g);
  assert(g.station === 'research', `E at the research station opens its panel (station=${g.station})`);
  tick(gApi, g); // render -> buttons

  // research the cheapest affordable node and confirm it persists + takes effect
  g.save.naquadah = 500;
  g.save.intel = 40;
  const before = JSON.stringify(g.save.tech || []);
  tick(gApi, g);
  const node = g.buttons.find((b) => b.h === 42);
  assert(!!node, 'research panel offers at least one researchable node');
  if (node) {
    const naq0 = g.save.naquadah;
    clickAt(node.x + node.w / 2, node.y + node.h / 2);
    assert(JSON.stringify(g.save.tech) !== before, 'clicking a node adds it to save.tech');
    assert(g.save.naquadah < naq0, 'research spends naquadah');
    const raw = localStorage.getItem('gatecrawler.save.v1');
    assert(raw && JSON.parse(raw).tech.length === g.save.tech.length, 'tech persisted to localStorage');
  }
  keyDown('Escape');
  tick(gApi, g);
  assert(g.station == null, 'Escape closes the station panel');

  // deploy: walk into the gate, press E -> gate map, pick the first node -> play
  g.player.x = g.world.gateCenter.x;
  g.player.y = g.world.gateCenter.y;
  for (let f = 0; f < 4; f++) tick(gApi, g);
  keyDown('KeyE');
  tick(gApi, g);
  assert(g.state === 'gatemap' && g.launching, `stepping into the gate opens the launch map (state=${g.state})`);
  tick(gApi, g);
  const dest = g.buttons.find((b) => b.w >= 100 && b.h <= 60);
  assert(!!dest, 'launch map offers a destination');
  if (dest) clickAt(dest.x + dest.w / 2, dest.y + dest.h / 2);
  tick(gApi, g);
  assert(g.state === 'play' && !g.hub, `picking a destination deploys into a run (state=${g.state})`);
  checkInvariants(g, 'hub-deploy');
  g.skipHub = true;
}

// quick-heal (Q) uses the best-fit medical item without a hotbar slot
section('quick-heal: Q consumes a heal item and restores HP');
{
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  const p = g.player;
  // clear meds, stock a bandage in the grid (not the hotbar) and a medkit
  for (let i = 0; i < g.inv.grid.length; i++) g.inv.grid[i] = null;
  g.inv.grid[0] = { id: 'bandage', count: 2 };
  g.inv.grid[1] = { id: 'medkit', count: 1 };
  p.hp = p.maxHp - 12; // a scratch — should pull the bandage, not the medkit
  keyDown('KeyQ');
  tick(gApi, g);
  assert(p.hp > p.maxHp - 12, 'Q healed the player');
  const bandLeft = (g.inv.grid[0] && g.inv.grid[0].count) || 0;
  assert(bandLeft === 1, `Q spent the smaller (bandage) heal first (left ${bandLeft})`);
  assert(g.inv.grid[1] && g.inv.grid[1].id === 'medkit', 'the medkit was untouched');
}

// ---------------------------------------------------------------- 5. stress: long idle + spam
section('stress: 90s idle in a fresh world + input spam');
{
  g.skipHub = true;
  keyDown('Enter'); // menu->play (state currently menu after requisition test? ensure)
  if (g.state !== 'play') {
    g.state = 'menu';
    keyDown('Enter');
    tick(gApi, g);
  }
  for (let i = 0; i < 60 * 90; i++) {
    input.mouse.down = i % 2 === 0;
    if (i % 7 === 0) keyDown('Space');
    if (i % 11 === 0) keyDown('KeyQ');
    setKeys(new Set(i % 3 === 0 ? ['KeyW', 'KeyD'] : ['KeyS']));
    if (!tick(gApi, g)) break;
    if (i % 300 === 0) checkInvariants(g, 'stress');
  }
  checkInvariants(g, 'stress-final');
}

// ---------------------------------------------------------------- 6. tech tree
section('tech: tree shape, effects fold, research gating');
{
  const { TECH, techEffects, canResearch, nodeById, researchCost } = tech;
  const BRANCHES = ['ops', 'armory', 'gate', 'xeno', 'command'];

  // -- per-node structural checks
  for (const n of TECH) {
    assert(BRANCHES.includes(n.branch), `tech ${n.id}: branch valid (${n.branch})`);
    assert(Number.isInteger(n.tier) && n.tier >= 0 && n.tier <= 5, `tech ${n.id}: tier 0-5 (${n.tier})`);
    assert(typeof n.cost.naquadah === 'number' && n.cost.naquadah > 0, `tech ${n.id}: cost.naquadah > 0 (${n.cost.naquadah})`);
    if (n.cost.intel !== undefined) assert(n.cost.intel > 0, `tech ${n.id}: cost.intel > 0 when present (${n.cost.intel})`);
    assert(Array.isArray(n.requires), `tech ${n.id}: requires is an array`);
    for (const r of n.requires) {
      assert(!!nodeById(r), `tech ${n.id}: requires '${r}' resolves`);
      assert(r !== n.id, `tech ${n.id}: does not require itself`);
    }
    assert(researchCost(n.id) && researchCost(n.id).naquadah === n.cost.naquadah, `tech ${n.id}: researchCost mirrors cost`);
  }
  assert(nodeById('does_not_exist') === null, 'tech: nodeById of a bogus id is null');
  assert(researchCost('does_not_exist') === null, 'tech: researchCost of a bogus id is null');
  assert(TECH.length >= 55 && TECH.length <= 80, `tech: ~55-70 nodes (${TECH.length})`);
  for (const b of BRANCHES) assert(TECH.some((n) => n.branch === b && n.tier === 0), `tech: branch ${b} has a tier-0 entry`);

  // -- no cycles (DFS with a colour map)
  {
    const WHITE = 0, GREY = 1, BLACK = 2;
    const colour = new Map(TECH.map((n) => [n.id, WHITE]));
    let cycle = false;
    const visit = (id) => {
      colour.set(id, GREY);
      for (const r of nodeById(id).requires) {
        const c = colour.get(r);
        if (c === GREY) cycle = true;
        else if (c === WHITE) visit(r);
      }
      colour.set(id, BLACK);
    };
    for (const n of TECH) if (colour.get(n.id) === WHITE) visit(n.id);
    assert(!cycle, 'tech: requires graph is acyclic');
  }

  // -- techEffects([]) deep-equals the documented defaults
  const DEFAULTS = {
    maxHpBonus: 0, dodgeCharges: 1, dodgeCdMul: 1, startArmor: null, startShield: 0,
    freeRevive: false, weaponSlots: 2, reloadMul: 1, grenadeCap: 4, weaponDmgMul: 1, weaponModSlots: 0,
    unlockedWeapons: [], dialCostMul: 1, mapLookahead: 0, startHop: 0, heatMul: 1,
    naquadahMul: 1, intelMul: 1, deathKeepFrac: 0.5,
    moveSpeedMul: 1, dodgeDistMul: 1, iframeMul: 1, pickupRadiusMul: 1,
    shieldRegenMul: 1, shieldMaxBonus: 0,
    grenadeDmgMul: 1, grenadeRadiusMul: 1, critChance: 0, critMul: 2, armorPierceMul: 1,
    startSalvage: 0, salvageMul: 1, xpMul: 1, bestiaryDmgMul: 1,
    reviveHpFrac: 0.5, startConsumable: null, startModSlots: 0, mapFullReveal: false,
    supportAirdrop: false, supportStrike: false, enemyAccuracyMul: 1, staffChargeUnlock: false,
  };
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert(deepEq(techEffects([]), DEFAULTS), 'tech: techEffects([]) equals the documented defaults');
  assert(deepEq(techEffects(['not_a_node']), DEFAULTS), 'tech: unknown owned ids are ignored');

  // -- a small chain moves exactly the fields it should
  const chain = techEffects(['ops_hp1', 'ops_hp2', 'ops_dodgecd', 'arm_shotgun', 'arm_burst', 'gate_look']);
  assert(chain.maxHpBonus === 50, `tech: two HP nodes -> +50 (${chain.maxHpBonus})`);
  assert(chain.dodgeCdMul === 0.8, `tech: dodge-cd node -> 0.8 (${chain.dodgeCdMul})`);
  assert(deepEq(chain.unlockedWeapons, ['w_shotgun', 'w_burst']), `tech: weapon unlocks accumulate (${chain.unlockedWeapons})`);
  assert(chain.mapLookahead === 1, `tech: forward telemetry -> lookahead 1 (${chain.mapLookahead})`);
  assert(chain.weaponSlots === 2 && chain.reloadMul === 1, 'tech: untouched fields stay default');
  const keystone = techEffects(['ops_hp1', 'ops_dodgecd', 'ops_hp2', 'ops_hp3', 'ops_dodge2', 'ops_revive']);
  assert(keystone.freeRevive === true && keystone.dodgeCharges === 2, 'tech: revive keystone + 2nd dodge charge apply');

  // -- canResearch gating
  const richNoIntel = { naquadah: 999999, intel: 0, tech: [] };
  const rich = { naquadah: 999999, intel: 999, tech: [] };
  const broke = { naquadah: 0, intel: 0, tech: [] };
  assert(canResearch(rich, 'ops_hp1') === true, 'tech: tier-0 node researchable with funds and no prereqs');
  assert(canResearch(rich, 'ops_hp2') === false, 'tech: node with an unmet prereq is not researchable');
  assert(canResearch({ ...rich, tech: ['ops_hp1'] }, 'ops_hp2') === true, 'tech: node becomes researchable once its prereq is owned');
  assert(canResearch({ ...rich, tech: ['ops_hp1'] }, 'ops_hp1') === false, 'tech: an already-owned node is not researchable again');
  assert(canResearch(broke, 'ops_hp1') === false, 'tech: cannot research when broke');
  assert(canResearch({ ...broke, naquadah: 40 }, 'ops_hp1') === true, 'tech: exactly enough naquadah is enough');
  assert(canResearch(richNoIntel, 'ops_dodge2') === false, 'tech: intel-gated keystone blocked with no intel and no prereq');
  assert(canResearch({ ...richNoIntel, tech: ['ops_dodgecd'] }, 'ops_dodge2') === false, 'tech: intel-gated keystone still blocked with prereq but no intel');
  assert(canResearch({ naquadah: 999999, intel: 3, tech: ['ops_dodgecd'] }, 'ops_dodge2') === true, 'tech: intel-gated keystone unlocks with prereq + intel + naquadah');
  assert(canResearch(rich, 'nope') === false, 'tech: canResearch of a bogus id is false');
}

// ---------------------------------------------------------------- 7. item icons
section('icons: every item draws without throwing, rarity is well-formed');
{
  const ctx = gameCanvas.getContext('2d');
  const ids = [...Object.keys(ITEMS), 'totally_bogus_id'];
  let drew = 0;
  for (const id of ids) {
    let ok = true;
    try {
      icons.drawItemIcon(ctx, id, 0, 0, 32);
      icons.drawItemIcon(ctx, id, 120, 80, 14); // odd size / offset centre
    } catch (err) {
      ok = false;
      console.error('    icon threw for ' + id + ': ' + (err && err.stack ? err.stack : err));
    }
    assert(ok, `icons: drawItemIcon('${id}') runs against the mock ctx`);
    if (ok) drew++;
  }
  assert(drew === ids.length, `icons: all ${ids.length} icon draws completed`);
  for (const id of Object.keys(ITEMS)) {
    assert(['common', 'uncommon', 'rare'].includes(icons.rarityOf(id)), `icons: rarityOf('${id}') is one of the three tiers`);
  }
  assert(icons.rarityOf('totally_bogus_id') === 'common', 'icons: unknown id falls back to common rarity');
  assert(icons.rarityOf('w_launcher') === 'rare' && icons.rarityOf('w_beam') === 'rare', 'icons: launcher & beam are rare');
  assert(icons.rarityOf('a_helm') === 'uncommon' && icons.rarityOf('a_plate') === 'uncommon', 'icons: heavy armour is uncommon');
  assert(icons.rarityOf('bandage') === 'common' && icons.rarityOf('a_boots') === 'common', 'icons: consumables & light armour are common');
  const rc = icons.RARITY_COLOR;
  assert(rc && rc.common && rc.uncommon && rc.rare, 'icons: RARITY_COLOR has all three tints');
}

// ---------------------------------------------------------------- juice & roster
section('feedback: decals accumulate, hazards hurt, kills reward, shotgun clears fire');
{
  g.skipHub = true;
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  const p = g.player;

  // fire a bunch — casings + muzzle work should leave decals
  const decals0 = g.decals.length;
  input.mouse.down = true;
  input.mouse.x = g.view.w / 2 + 200;
  input.mouse.y = g.view.h / 2;
  for (let f = 0; f < 60; f++) tick(gApi, g);
  input.mouse.down = false;
  assert(g.decals.length > decals0, `feedback: gunfire leaves battlefield decals (${decals0} -> ${g.decals.length})`);
  assert(g.decals.length <= 520, 'feedback: decal buffer is capped');

  // a kill tops the player up and adds a scorch
  const { Enemy } = await import('../src/entities.js');
  // isolate the foe: clear the live world's wanderers so the synthetic shot
  // can only land on our test target, not a passing enemy that happens to overlap
  g.enemies.length = 0;
  const foe = new Enemy('jaffa', p.x + 60, p.y, 2);
  foe.state = 'active';
  foe.facing = Math.PI; // face away so the frontal-armour rule doesn't apply
  foe._room = g.curRoom;
  g.enemies.push(foe);
  p.hp = 50;
  p.iframe = 5;
  const d1 = g.decals.length;
  const hpBefore = p.hp;
  g.bullets.push({
    x: foe.x,
    y: foe.y,
    vx: 300,
    vy: 0,
    dmg: 60,
    from: 'player',
    r: 3,
    life: 1,
    stun: 0,
    knockback: 0,
    energy: false,
    trail: [],
    alive: true,
    color: '#fff',
  });
  tick(gApi, g);
  tick(gApi, g);
  assert(!foe.alive, 'feedback: test foe died to the shot');
  assert(p.hp > hpBefore, `feedback: a kill restores some HP (aggression reward) (${hpBefore} -> ${p.hp | 0})`);
  assert(g.decals.length > d1, 'feedback: a kill scorches the ground');

  // an enemy plasma hazard ticks damage while you stand in it
  g.hazards.length = 0;
  const { Hazard } = await import('../src/entities.js');
  g.hazards.push(new Hazard(p.x, p.y, 60, 3, 40, 'enemy'));
  p.hp = 100;
  p.iframe = 0;
  const hp0 = p.hp;
  for (let f = 0; f < 60; f++) {
    p.iframe = 0; // stand and burn
    tick(gApi, g);
  }
  assert(p.hp < hp0, `feedback: standing in a plasma hazard drains HP (${hp0} -> ${p.hp | 0})`);

  // shotgun pellets delete an incoming enemy bolt
  const enemyBolt = {
    x: p.x + 40,
    y: p.y,
    vx: -300,
    vy: 0,
    dmg: 9,
    from: 'enemy',
    r: 4,
    life: 2,
    stun: 0,
    trail: [],
    alive: true,
    color: '#ffc27a',
  };
  g.bullets.push(enemyBolt);
  g.bullets.push({
    x: p.x + 20,
    y: p.y,
    vx: 400,
    vy: 0,
    dmg: 6,
    from: 'player',
    r: 3,
    life: 1,
    stun: 0,
    trail: [],
    alive: true,
    color: '#ffd27a',
    clearShots: true,
  });
  for (let f = 0; f < 8; f++) tick(gApi, g);
  assert(!enemyBolt.alive, 'feedback: a clearShots pellet swats an enemy bolt out of the air');
}

section('roster: the Jaffa grenadier displacer exists and appears in worlds');
{
  const { Enemy } = await import('../src/entities.js');
  const gr = new Enemy('jaffa_grenadier', 100, 100, 3);
  assert(gr.kind === 'jaffa_grenadier' && gr.hp > 0 && gr.speed > 0, 'roster: grenadier constructs with stats');
  // scan a spread of jaffa worlds for at least one grenadier
  let seen = 0;
  for (let i = 0; i < 60 && !seen; i++) {
    const params = worldParams('AUR-CRT-VIR-BOO-CEN-SER'.split('-').map((s, k) => (k === i % 6 ? 'TAU' : s)).join('-'), 3);
    if (params.faction !== 'jaffa') continue;
    const w = buildWorld(params);
    // emulate populateWorld's kind roll by constructing the game's picker via a fresh run
  }
  // simpler: drive a few real jaffa worlds and look at g.enemies
  g.skipHub = true;
  for (let attempt = 0; attempt < 40 && !seen; attempt++) {
    g.state = 'menu';
    keyDown('Enter');
    tick(gApi, g);
    if ((g.params.faction || g.params.primary) === 'jaffa') {
      if (g.enemies.some((e) => e.kind === 'jaffa_grenadier')) seen++;
    }
    // dial onward to see more worlds
    g.enemies.length = 0;
    g.dhdActive = true;
    g.player.x = g.world.dhdRoom.centerPx.x;
    g.player.y = g.world.dhdRoom.centerPx.y;
    for (let k = 0; k < 20 && g.state === 'play'; k++) {
      keyDown('KeyE');
      tick(gApi, g);
    }
    if (g.state === 'gatemap') {
      tick(gApi, g);
      const dest = g.buttons.find((b) => b.w >= 100 && b.h <= 60);
      if (dest) dest.fn();
      tick(gApi, g);
    }
  }
  assert(seen > 0, `roster: a Jaffa grenadier spawned in at least one world across the scan (${seen})`);
}

section('rarity: tiers scale item stats, loot is tagged, scrap pays out');
{
  const items = await import('../src/items.js');
  const icons = await import('../src/icons.js');
  const { regionDR, createInventory } = await import('../src/inventory.js');

  // itemStats scales with the tier
  const drC = items.itemStats('a_plate', 'common').dr;
  const drL = items.itemStats('a_plate', 'legendary').dr;
  assert(drL > drC && drL <= 0.85, `rarity: legendary armour DR beats common but is capped (${drC.toFixed(2)} -> ${drL.toFixed(2)})`);
  assert(items.itemStats('w_staff', 'epic').damageMul > 1, 'rarity: epic weapon has a damage multiplier');

  // regionDR honours an equipped stack's rarity
  const inv = createInventory();
  inv.equip.torso = { id: 'a_vest', count: 1, rarity: 'legendary' };
  const baseVest = ITEMS.a_vest.dr;
  assert(regionDR(inv).torso > baseVest, `rarity: equipped legendary vest raises torso DR above base (${baseVest} -> ${regionDR(inv).torso.toFixed(3)})`);

  // rollRarity only hands out legendary once threat is high
  let lowLegend = 0;
  const seq = [0.01, 0.2, 0.45, 0.7, 0.9, 0.99];
  let si = 0;
  const rnd = () => seq[si++ % seq.length];
  for (let k = 0; k < 300; k++) if (items.rollRarity(0, rnd) === 'legendary') lowLegend++;
  assert(lowLegend === 0, `rarity: no legendary drops at threat 0 (${lowLegend})`);

  // a real run: floor loot carries a rarity field on gear
  g.skipHub = true;
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  const gearOnFloor = g.pickups.filter((pk) => pk.kind === 'item' && pk.item && ITEMS[pk.item.id] && (ITEMS[pk.item.id].type === 'weapon' || ITEMS[pk.item.id].type === 'armor'));
  assert(gearOnFloor.every((pk) => typeof pk.item.rarity === 'string'), `rarity: every gear pickup is tagged with a tier (${gearOnFloor.length} checked)`);

  // a rarer stack survives a save round-trip
  const { reviveInventory } = await import('../src/inventory.js');
  const revived = reviveInventory({ grid: [{ id: 'a_helm', count: 1, rarity: 'epic' }], equip: {}, hotbar: [] });
  assert(revived.grid[0] && revived.grid[0].rarity === 'epic', 'rarity: an item tier persists through reviveInventory');

  assert(icons.RARITY_COLOR.legendary && icons.RARITY_LABEL.legendary === 'LEGENDARY', 'rarity: legendary colour + label are defined');
}

section('finale: nexus is shielded until its pylons fall, then dies through 3 phases');
{
  const { Enemy, NexusPylon } = await import('../src/entities.js');
  g.skipHub = true;
  g.state = 'menu';
  keyDown('Enter');
  tick(gApi, g);
  assert(g.state === 'play', 'finale: run started');
  const p = g.player;
  p.iframe = 1e6;
  g.enemies.length = 0;
  g.bullets.length = 0;
  g.pylons.length = 0;
  g._events = [];

  const c = g.curRoom.centerPx;
  const nx = new Enemy('nexus', c.x, c.y - 40, 10);
  nx.state = 'active';
  nx._room = g.curRoom;
  g.enemies.push(nx);
  for (let i = 0; i < 3; i++) {
    const py = new NexusPylon(c.x + (i - 1) * 40, c.y + 40);
    py._room = g.curRoom;
    g.pylons.push(py);
  }
  const hp0 = nx.hp;

  const shot = (tx, ty, dmg) =>
    g.bullets.push({ x: tx, y: ty, vx: 1, vy: 0, dmg, from: 'player', r: 3, life: 1, stun: 0,
      knockback: 0, energy: false, trail: [], alive: true, color: '#fff' });

  // hammer the core while the pylons stand — shield eats all of it
  for (let f = 0; f < 30; f++) {
    shot(nx.x, nx.y, 200);
    tick(gApi, g);
    checkInvariants(g, 'finale-shielded');
  }
  assert(Math.abs(nx.hp - hp0) < 1e-6, `finale: nexus takes no core damage while shielded (${hp0} -> ${nx.hp | 0})`);
  assert(nx.shieldUp === true, 'finale: nexus reports shieldUp while pylons live');

  // drop the three pylons
  for (const py of g.pylons) {
    for (let k = 0; k < 20 && py.alive; k++) {
      shot(py.x, py.y, 40);
      tick(gApi, g);
    }
    assert(!py.alive, 'finale: a pylon dies under fire');
  }
  for (let f = 0; f < 3; f++) tick(gApi, g);
  assert(nx.shieldUp === false, 'finale: shield drops once every pylon is down');

  // now bring it down — feed damage and run the fight out
  let died = false;
  for (let f = 0; f < 60 * 20 && !died; f++) {
    if (nx.alive) shot(nx.x, nx.y, 40);
    if (!tick(gApi, g)) break;
    checkInvariants(g, 'finale-fight');
    died = !nx.alive;
  }
  assert(died, 'finale: the nexus can be killed once exposed');
  assert(nx.phase >= 2, `finale: the fight escalated past phase 1 (reached ${nx.phase})`);
  assert(
    g._events.some((e) => e.t === 'bossKill' && e.faction === 'nexus'),
    'finale: killing the nexus emits a nexus bossKill event for the campaign'
  );
  g.pylons.length = 0;
  g.enemies.length = 0;
  g.bullets.length = 0;
  p.iframe = 0;
}

// ---------------------------------------------------------------- report
console.log('\n----------------------------------------');
console.log(`checks: ${checks}   failures: ${failures}   frames simulated: ${frames}`);
if (failures) {
  console.error('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('RESULT: PASS');
}
