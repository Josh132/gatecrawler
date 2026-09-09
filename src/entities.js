import { TILE } from './worldgen.js';

// resolve a moving circle against wall tiles; returns the corrected position
export function circleVsGrid(world, ent, nx, ny) {
  let x = nx;
  let y = ny;
  const r = ent.r;
  for (let iter = 0; iter < 3; iter++) {
    const minTx = Math.floor((x - r) / TILE);
    const maxTx = Math.floor((x + r) / TILE);
    const minTy = Math.floor((y - r) / TILE);
    const maxTy = Math.floor((y + r) / TILE);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const solid =
          tx < 0 || ty < 0 || tx >= world.W || ty >= world.H || world.grid[ty * world.W + tx] === 1;
        if (!solid) continue;
        const cx = tx * TILE;
        const cy = ty * TILE;
        const closestX = Math.max(cx, Math.min(x, cx + TILE));
        const closestY = Math.max(cy, Math.min(y, cy + TILE));
        const dx = x - closestX;
        const dy = y - closestY;
        const d = Math.hypot(dx, dy);
        if (d === 0) {
          y -= r;
        } else if (d < r) {
          const push = r - d;
          x += (dx / d) * push;
          y += (dy / d) * push;
        }
      }
    }
  }
  return { x, y };
}

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 11;
    this.vx = 0;
    this.vy = 0;
    this.kx = 0;
    this.ky = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.aim = 0;
    this.speed = 232;
    this.ammo = { staff: 0, zat: 0 }; // reserve rounds per weapon id
    this.mag = {}; // loaded rounds per weapon id (lazily filled on first use)
    this.reloadT = 0;
    this.reloadDur = 0;
    this.reloading = false;
    this.reloadWid = null;
    this.burstN = 0; // queued shots left in the current burst
    this.burstT = 0;
    this.burstWid = null;
    this.beam = null; // { on, x1, y1, x2, y2, color } render state for the ion beam
    this.beamTick = 0;
    this.cool = 0;
    this.dodge = 0;
    this.dodgeCd = 0;
    this.ddx = 1;
    this.ddy = 0;
    this.iframe = 0;
    this.stun = 0;
    this.flash = 0;
    this.shield = 0;
    this.shieldMax = 0;
    this.shieldRegenT = 0;
    this.stimT = 0;
    this.alive = true;
  }
}

export const ENEMY_KIND = {
  jaffa: { r: 12, hp: (t) => 38 + t * 6, speed: 96 },
  jaffa_heavy: { r: 16, hp: (t) => 66 + t * 8, speed: 62 },
  jaffa_grenadier: { r: 13, hp: (t) => 42 + t * 6, speed: 84 },
  // fragile long-range lane-holder: anchors on a firing spot (holdX/holdY), spends
  // aimT charging a heavy telegraphed shot, then returns to its anchor. barely moves.
  jaffa_sniper: { r: 11, hp: (t) => 30 + t * 4, speed: 54 },
  wraith: { r: 12, hp: (t) => 26 + t * 4, speed: 240 },
  wraith_drone: { r: 10, hp: (t) => 18 + t * 3, speed: 268 },
  // blinks out (phaseT > 0 == intangible + untargetable) on a cooldown to slip
  // through cover / crossfire and reappear on the player's flank.
  wraith_stalker: { r: 12, hp: (t) => 34 + t * 5, speed: 250 },
  replicator: { r: 9, hp: (t) => 14 + t * 2, speed: 172 },
  replicator_brute: { r: 16, hp: (t) => 54 + t * 6, speed: 116 },
  // support replicator: on weaveCd it extrudes a short-lived wall of Blocks
  // (weaveT counts the active weave down) to sever the player's sightlines.
  replicator_weaver: { r: 10, hp: (t) => 26 + t * 3, speed: 150 },
  // non-hostile ambient critter: wanders, flees the player, never attacks;
  // killing it drops extra naquadah / loot. flagged this.neutral on the Enemy.
  scavenger: { r: 8, hp: (t) => 12, speed: 150 },
  boss: { r: 22, hp: (t) => 240 + t * 22, speed: 120 },
  // campaign finale super-boss — see the (kind === 'nexus') block for the fight
  nexus: { r: 30, hp: (t) => 900 + t * 45, speed: 66 },
};

export class Enemy {
  constructor(kind, x, y, threat, opts = {}) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.kx = 0;
    this.ky = 0;
    this.facing = 0;
    this.cool = Math.random() * 1.2;
    this.regenT = 0;
    this.wobble = Math.random() * Math.PI * 2;
    this.flash = 0;
    this.stun = 0;
    this._room = null;
    // cover-AI state (jaffa)
    this.mode = 'advance';
    this.modeT = 0;
    this.scanT = Math.random() * 0.5;
    this.cover = null;
    this.aggressive = false;
    this.blindT = 0;
    // idle until it notices the player — no spawn-on-entry pop-in
    this.state = 'idle';
    this.anchorX = x;
    this.anchorY = y;
    this.wanderX = x;
    this.wanderY = y;
    this.wanderT = Math.random() * 2;
    this.alertT = 0;
    this.senseT = Math.random() * 0.25;
    this.returnT = 0;
    this.calmT = 0;
    this.forcedReturn = false;
    // replicators learn to shrug off whatever hit them last
    this.resist = { kinetic: 0, energy: 0 };
    this.hunter = !!opts.hunter;
    this.variant = opts.variant || 'jaffa';
    this._reformed = !!opts.reformed;
    // non-hostile ambient critter — game code treats neutrals specially (flee, loot)
    this.neutral = kind === 'scavenger';

    // ranged lane-holder state (jaffa_sniper) — safe defaults for every kind
    this.aimT = 0; // charge-up accumulator before a heavy shot
    this.holdX = x; // firing anchor it drifts back to
    this.holdY = y;
    // phase-blink state (wraith_stalker) — >0 phaseT means phased / intangible
    this.phaseT = 0;
    this.phaseCd = 0; // time left before it may phase again
    this.nextPhase = 0; // rolled interval between phases
    // block-weave state (replicator_weaver)
    this.weaveCd = 0; // time until the next wall is spun up
    this.weaveT = 0; // remaining life of the current weave

    // squad / smarter-AI state — behaviour lives in game.js, these just reserve
    // the fields so every kind still constructs. safe inert defaults.
    this.squad = null; // id of the squad this unit belongs to
    this.squadRole = null; // 'anchor' | 'flanker' | 'support'
    this.suppressT = 0; // firing a suppression burst while a squadmate repositions
    this.flankDir = 0; // -1 / 0 / +1 — which way this unit is arcing round cover
    this.regroup = false; // fall back toward the squad anchor
    this.lastSeenX = 0; // last known player position, for searching after LOS breaks
    this.lastSeenY = 0;
    this.alertShareT = 0; // throttle on shouting a fresh contact to the squad
    this.peekT = 0; // lean-out-of-cover timer
    this.repathT = 0; // throttle on recomputing a path

    const k = ENEMY_KIND[kind] || ENEMY_KIND.jaffa;
    this.r = k.r;
    this.hp = Math.round(k.hp(threat) * (opts.hpMul || 1));
    this.speed = k.speed * (opts.speedMul || 1);

    if (kind === 'jaffa_sniper') {
      // starts anchored on its spawn tile, holding the lane rather than advancing
      this.mode = 'hold';
      this.holdX = x;
      this.holdY = y;
      this.aimT = 0;
      this.aimDur = 1.3 + Math.random() * 0.4; // seconds to charge the heavy shot
      // stays in support: calls contacts + charges heavy shots, never flanks
      this.squadRole = 'support';
    }
    if (kind === 'wraith_stalker') {
      this.phaseCd = 2.5 + Math.random() * 2;
      this.nextPhase = this.phaseCd;
      this.phaseDur = 0.7; // how long a blink lasts
    }
    if (kind === 'replicator_weaver') {
      this.weaveCd = 3.5 + Math.random() * 3;
      this.weaveLife = 4.5; // seconds a spun wall stands before it crumbles
    }
    if (kind === 'jaffa_heavy') {
      // the wall of the squad — holds ground, rarely arcs round
      this.squadRole = 'anchor';
    }

    if (kind === 'boss') {
      this.shield = this.variant === 'jaffa' ? 90 : this.variant === 'replicator' ? 70 : 0;
      this.shieldT = 0;
      this.charging = 0;
      this.chargeDir = 0;
      this.attackT = 2;
      this.screamT = 5;
      this.immuneType = 'kinetic';
      this.immuneT = 0;
      if (this.variant === 'wraith') this.speed *= 1.25;
    }

    if (kind === 'nexus') {
      // campaign finale. shielded and untouchable until its NexusPylons are down;
      // while shielded it rotates a damage-immunity type (immuneType), so the
      // player must switch weapons to keep chipping. three phases stepped by
      // phaseAt hp fractions: p1 = pylons + beamT bursts, p2 adds a slow rotating
      // sweep beam, p3 enrages (faster timers) and spawns replicator adds.
      this.phase = 1;
      this.phaseAt = [0.66, 0.33]; // hp fractions that trip phase 2 / phase 3
      this.pylons = 3; // live pylons feeding the shield this phase
      this.beamT = 3; // countdown to the next aimed beam burst
      this.sweepT = 6; // countdown to / progress of the phase-2 rotating sweep
      this.spawnT = 4; // countdown to the next phase-3 replicator add wave
      this.immuneType = 'kinetic'; // damage type currently shrugged off
      this.immuneCycleT = 0; // timer that rotates immuneType while shielded
      this.shield = 240; // shield pool, refilled at the top of each phase
      this.enraged = false; // set true in phase 3 — tighter timers, more adds
    }
    this.maxHp = this.hp;
    this.alive = true;
  }
}

export class Bullet {
  constructor(x, y, vx, vy, dmg, from, opt = {}) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.dmg = dmg;
    this.from = from; // 'player' | 'enemy'
    this.r = opt.r || 3;
    this.life = opt.life || 2.2;
    this.color = opt.color || '#fff';
    this.knockback = opt.knockback || 0;
    this.energy = !!opt.energy;
    this.stun = opt.stun || 0;
    this.explode = !!opt.explode; // detonates a radial blast on hit / expiry
    this.blastDmg = opt.blastDmg || 0;
    this.blastRadius = opt.blastRadius || 0;
    this.trail = [];
    this.alive = true;
  }
}

export class Pickup {
  constructor(kind, x, y, amount = 0, item = null) {
    this.kind = kind; // naquadah | staff-ammo | item
    this.x = x;
    this.y = y;
    this.r = 9;
    this.amount = amount;
    this.item = item; // { id, count } when kind === 'item'
    this.bob = Math.random() * Math.PI * 2;
    this.alive = true;
  }
}

export class Grenade {
  constructor(x, y, vx, vy, dmg, radius, from) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.dmg = dmg;
    this.radius = radius;
    this.from = from; // 'player' | 'enemy'
    this.r = 5;
    this.fuse = 0.95;
    this.alive = true;
  }
}

// debris left when a Replicator brute is destroyed — reassembles if enough survive
export class Block {
  constructor(x, y, threat, room) {
    this.x = x;
    this.y = y;
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 120;
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.r = 6;
    this.threat = threat;
    this.room = room;
    this.mergeT = 3.4 + Math.random() * 0.6;
    this.spin = Math.random() * Math.PI;
    this.alive = true;
  }
}

export class Particle {
  constructor(x, y, vx, vy, life, color, size) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.color = color;
    this.size = size;
    this.alive = true;
  }
}

// permanent-ish battlefield marks: casings, scorch, splatter. Not simulated —
// just a capped ring buffer drawn under everything so a cleared room reads as
// a warzone.
export class Decal {
  constructor(kind, x, y, r, color, ang) {
    this.kind = kind; // 'casing' | 'scorch' | 'burn' | 'splat'
    this.x = x;
    this.y = y;
    this.r = r;
    this.color = color;
    this.ang = ang == null ? Math.random() * Math.PI * 2 : ang;
    this.born = 0; // set by the game clock; used only for a brief fade-in
  }
}

// per-biome hazard kinds the renderer / game switch on. 'plasma' is the original
// grenadier-fire behaviour and stays the default so old `new Hazard(x,y,r,life,dps,from)`
// calls are byte-for-byte unchanged.
export const HAZARD_KINDS = ['plasma', 'spore', 'steam', 'thin-ice', 'quicksand'];

// area hazard. legacy shape (x,y,r,life,dps,from) is 100% preserved; kind + opts
// are optional trailing args that unlock the biome variants below.
//   plasma    — (default) grenadier fire; damages, ticks life down normally
//   spore     — hive: green cloud, slows (this.slow) + light DoT, room-persistent
//   steam     — foundry: telegraphed vent that pulses on/off (this.on); no damage while off
//   thin-ice  — ice: no damage; standT accrues while the player is on it, game sets
//               this.broken past ~0.8s and decides the payoff (stun / drop)
//   quicksand — desert: no damage; saps move speed to this.slow while inside
// room-persistent kinds set this.everlasting — game.js must NOT tick their life down
// (life/maxLife are still populated so any generic reader keeps working).
export class Hazard {
  constructor(x, y, r, life, dps, from, kind = 'plasma', opts = {}) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.life = life;
    this.maxLife = life;
    this.dps = dps;
    this.from = from; // 'enemy' | 'player'
    this.kind = kind;
    this.tick = 0;
    this.phase = Math.random() * Math.PI * 2;
    // room-persistent unless told otherwise; plasma is the transient exception
    this.everlasting = opts.everlasting != null ? opts.everlasting : kind !== 'plasma';
    // move-speed multiplier applied to anyone standing inside (1 == no slow)
    this.slow =
      opts.slow != null ? opts.slow : kind === 'spore' ? 0.6 : kind === 'quicksand' ? 0.45 : 1;
    // steam pulse: on for onT, off for offT; deals no damage while off. telegraphed.
    this.cycleT = opts.cycleT || 0;
    this.onT = opts.onT != null ? opts.onT : 1.1;
    this.offT = opts.offT != null ? opts.offT : 1.6;
    this.on = opts.on != null ? opts.on : true;
    // thin-ice: seconds the player has stood here; game flips broken past ~0.8s
    this.standT = 0;
    this.broken = false;
    this.alive = true;
  }
}

// temple dart-trap: dormant until the player crosses its trigger line, then it fires.
// the raycast + bolt spawn are game.js's job — this just holds armed / aim / cooldown.
// lifecycle: armed && cd<=0  ->  player within triggerR of the forward axis
//   -> game raycasts along dir up to range, spawns an enemy Bullet, sets armed=false, cd=fireCd
//   -> cd ticks down; at 0 it re-arms. set alive=false to retire a one-shot trap.
export class Trap {
  constructor(x, y, dir, opts = {}) {
    this.x = x;
    this.y = y;
    this.dir = dir; // radians: the way it faces / away from the wall it's mounted on
    this.kind = opts.kind || 'dart-trap';
    this.armed = opts.armed != null ? opts.armed : true;
    this.cd = 0; // seconds until it can fire again
    this.fireCd = opts.fireCd != null ? opts.fireCd : 1.6; // cd value set after a shot
    this.triggerR = opts.triggerR != null ? opts.triggerR : 26; // half-width of the trip line
    this.range = opts.range != null ? opts.range : 360; // how far the bolt reaches
    this.dmg = opts.dmg != null ? opts.dmg : 22;
    this.tick = 0; // free-running clock for the telegraph
    this.phase = Math.random() * Math.PI * 2;
    this.alive = true;
  }
}

// recoverable campaign objective — an Ancient data core sitting on a pedestal.
// game.js flips taken when the player walks over it; bob/glow are render-only.
export class DataCore {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 12;
    this.taken = false;
    this.bob = Math.random() * Math.PI * 2;
    this.glow = 0;
    this.born = 0; // set by the game clock for a spawn-in fade
  }
}

// seals a reward alcove until a room condition is met; openT (0..1) slides it.
export class VaultDoor {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.locked = true;
    this.openT = 0; // slide progress once game.js unlocks it
    this.alive = true;
  }
}

// a captured SG teammate. once freed they follow the player and have to reach
// the gate room alive (atGate). hp/vx/vy/facing are for the follow sim in game.js.
export class Captive {
  constructor(x, y, name) {
    this.x = x;
    this.y = y;
    this.r = 11;
    this.name = name;
    this.freed = false;
    this.atGate = false;
    this.follow = false;
    this.hp = 60;
    this.vx = 0;
    this.vy = 0;
    this.facing = 0;
    this.bob = Math.random() * Math.PI * 2;
  }
}

// mid-run black-market NPC. stock is an array of { id, price, rarity };
// greetT gates a one-off bark, t is a free-running render clock.
export class Vendor {
  constructor(x, y, stock) {
    this.x = x;
    this.y = y;
    this.r = 14;
    this.stock = stock || [];
    this.t = Math.random() * Math.PI * 2;
    this.greetT = 0;
    this.alive = true;
  }
}

// destroy to strip one phase of the nexus boss's shield. flash pulses on a hit.
export class NexusPylon {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 14;
    this.hp = 120;
    this.maxHp = 120;
    this.alive = true;
    this.flash = 0;
    this.phase = Math.random() * Math.PI * 2;
  }
}
