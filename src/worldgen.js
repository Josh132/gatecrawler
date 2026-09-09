import { makeRng, rngHelpers } from './rng.js';
import * as T from './textures.js';

export const TILE = 34;
export const ROOM_W = 15; // tiles
export const ROOM_H = 11; // tiles

// how tall walls stand in the fake-3d bake. Purely visual: collision still uses
// the flat tile footprint. Wall tops are painted WALL_H px above their tile, so
// the baked canvas is that much taller than the world and is drawn at -WALL_H.
export const WALL_H = 16;

// visual palettes — one per world, chosen from the address hash in worldParams.
// void/floorA/floorB/wall/edge/glow/grid are the keys the renderer contract
// depends on. The rest drive the material bake below:
//   lo/hi      darkest + lightest tone of the floor material ramp
//   accent     the material's signature colour (inlay, bio-light, hazard paint)
//   accent2    secondary accent (torch warmth, water, rust, spirit-light)
//   outline    'neon' hard sci-fi rim | 'rim' soft natural light catch
//   gridLines  keep the old faint tile grid (built environments only)
//   outdoor    open sky rather than an interior
//   ambient/dust/fog  hints for game.js — see the notes in the header comment
export const BIOMES = {
  // poured concrete + steel: SGC-flavoured, and the fallback the hub bakes with
  ruins: {
    void: '#080b11', floorA: '#2b3038', floorB: '#232830', wall: '#1b2028',
    edge: 'rgba(150,200,245,0.42)', glow: '#4f7fa8', grid: 'rgba(120,160,200,0.05)',
    lo: '#161a20', hi: '#3d444f', accent: '#8fc0e0', accent2: '#c9a227',
    outline: 'neon', gridLines: true, ambient: '#7fa8c8', dust: '#9fb8cc', fog: '#03040a',
  },
  // warm sandstone ashlar, gold inlay, hieroglyph friezes, torchlight
  temple: {
    void: '#0a0704', floorA: '#5a4227', floorB: '#43301c', wall: '#4a3620',
    edge: 'rgba(255,206,130,0.5)', glow: '#c98a34', grid: 'rgba(210,170,110,0.05)',
    lo: '#1d1409', hi: '#8a6a3c', accent: '#e8c46a', accent2: '#ff8a3c',
    outline: 'rim', ambient: '#e0b070', dust: '#d8b98a', fog: '#0a0705',
  },
  // overgrown outdoor ruins: cracked flagstone, moss, vines, dappled light
  jungle: {
    void: '#050a05', floorA: '#3d4a30', floorB: '#2c3624', wall: '#3a4432',
    edge: 'rgba(180,245,160,0.4)', glow: '#4e8a3a', grid: 'rgba(140,190,120,0.05)',
    lo: '#141a0f', hi: '#6d8253', accent: '#8fd45a', accent2: '#3f6b8a',
    outline: 'rim', outdoor: true, ambient: '#9fd070', dust: '#b6e08a', fog: '#050c07',
  },
  // open canyon outpost: rippled sand, strata mesas, bleached bone light
  desert: {
    void: '#20180c', floorA: '#7d6440', floorB: '#634e30', wall: '#6b5333',
    edge: 'rgba(255,238,190,0.42)', glow: '#c9a35e', grid: 'rgba(220,190,140,0.05)',
    lo: '#4a3820', hi: '#c8ac7e', accent: '#f0dcae', accent2: '#8a6a3a',
    outline: 'rim', outdoor: true, ambient: '#ffe6b0', dust: '#e8d0a0', fog: '#120c06',
  },
  // glacier cavern: translucent blue ice, deep cracks, snow drift, icicles
  ice: {
    void: '#040910', floorA: '#2b455c', floorB: '#20364a', wall: '#284862',
    edge: 'rgba(190,248,255,0.62)', glow: '#6fd0e8', grid: 'rgba(150,220,240,0.06)',
    lo: '#0d1e2e', hi: '#77b0cb', accent: '#cdf4ff', accent2: '#3fa8c8',
    outline: 'neon', ambient: '#9fe0f0', dust: '#dff4ff', fog: '#03060d',
  },
  // derelict deck: riveted plate, grating, hazard chevrons, oil and rust
  foundry: {
    void: '#08080a', floorA: '#33363c', floorB: '#292c31', wall: '#2e2a24',
    edge: 'rgba(255,175,85,0.5)', glow: '#c07a2c', grid: 'rgba(190,140,90,0.05)',
    lo: '#16181c', hi: '#4e535b', accent: '#e8a33c', accent2: '#7a4b22',
    outline: 'neon', ambient: '#c8ccd4', dust: '#8a8f98', fog: '#050508',
  },
  // wraith hive: chitin ribs, sinew membrane, bioluminescent pods
  hive: {
    void: '#080410', floorA: '#3b2942', floorB: '#2c1e33', wall: '#33223c',
    edge: 'rgba(205,150,255,0.5)', glow: '#9a5fd0', grid: 'rgba(170,120,200,0.05)',
    lo: '#160e1c', hi: '#6b4a72', accent: '#9dff6a', accent2: '#d88ae8',
    outline: 'neon', ambient: '#b07fd0', dust: '#c8a0e0', fog: '#06030c',
  },
  // ancient city: precise blue-grey panels, inlay, recessed light channels
  atlantis: {
    void: '#050910', floorA: '#22384a', floorB: '#1b2c3c', wall: '#1e3145',
    edge: 'rgba(170,230,255,0.6)', glow: '#4fa8d8', grid: 'rgba(130,190,230,0.05)',
    lo: '#0d1926', hi: '#4e7896', accent: '#7fe8e0', accent2: '#cfe8ff',
    outline: 'neon', gridLines: true, ambient: '#8fd4e8', dust: '#cfe8ff', fog: '#03060c',
  },
  // ossuary cut into black rock: bone inlay, grave slabs, cold green gloom
  catacomb: {
    void: '#040404', floorA: '#2a2622', floorB: '#201d1a', wall: '#241f1b',
    edge: 'rgba(170,225,155,0.32)', glow: '#4a7a48', grid: 'rgba(120,150,110,0.04)',
    lo: '#0e0d0b', hi: '#524940', accent: '#d8cfae', accent2: '#7ce08a',
    outline: 'rim', ambient: '#7ac47a', dust: '#a8a08a', fog: '#030503',
  },
};

export function buildWorld(params) {
  const R = rngHelpers(makeRng('layout:' + params.seedStr));
  const key = (x, y) => x + ',' + y;

  // place rooms via a random walk that always grows from an existing room
  const gate = { gx: 0, gy: 0, kind: 'gate' };
  const placed = new Map([[key(0, 0), gate]]);
  const order = [gate];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let guard = 0;
  while (placed.size < params.roomCount && guard++ < 800) {
    const from = R.pick(order);
    const [dx, dy] = R.pick(dirs);
    const nx = from.gx + dx;
    const ny = from.gy + dy;
    if (placed.has(key(nx, ny))) continue;
    const room = { gx: nx, gy: ny, kind: 'normal' };
    placed.set(key(nx, ny), room);
    order.push(room);
  }

  // farthest room from the gate becomes the DHD room
  let dhd = null;
  let bestD = -1;
  for (const r of order) {
    if (r.kind === 'gate') continue;
    const d = Math.abs(r.gx) + Math.abs(r.gy);
    if (d > bestD) {
      bestD = d;
      dhd = r;
    }
  }
  if (dhd) dhd.kind = 'dhd';

  // rebase grid coords to 0
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const r of order) {
    minx = Math.min(minx, r.gx);
    miny = Math.min(miny, r.gy);
    maxx = Math.max(maxx, r.gx);
    maxy = Math.max(maxy, r.gy);
  }
  const roomsWide = maxx - minx + 1;
  const roomsHigh = maxy - miny + 1;
  for (const r of order) {
    r.gx -= minx;
    r.gy -= miny;
  }

  const W = roomsWide * ROOM_W;
  const H = roomsHigh * ROOM_H;
  const grid = new Uint8Array(W * H).fill(1);
  const at = (x, y) => y * W + x;

  const rooms = [];
  for (const r of order) {
    const ox = r.gx * ROOM_W;
    const oy = r.gy * ROOM_H;
    for (let y = 1; y < ROOM_H - 1; y++) {
      for (let x = 1; x < ROOM_W - 1; x++) {
        grid[at(ox + x, oy + y)] = 0;
      }
    }
    rooms.push({
      gx: r.gx,
      gy: r.gy,
      kind: r.kind,
      ox,
      oy,
      centerPx: { x: (ox + ROOM_W / 2) * TILE, y: (oy + ROOM_H / 2) * TILE },
      rectPx: { x: ox * TILE, y: oy * TILE, w: ROOM_W * TILE, h: ROOM_H * TILE },
      spawned: false,
      cleared: false,
    });
  }

  // carve doorways between grid-adjacent rooms (the 2-tile shared wall)
  const byKey = new Map(rooms.map((r) => [r.gx + ',' + r.gy, r]));
  for (const r of rooms) {
    const right = byKey.get(r.gx + 1 + ',' + r.gy);
    const down = byKey.get(r.gx + ',' + (r.gy + 1));
    if (right) {
      const y0 = r.oy + (ROOM_H >> 1);
      for (let k = -1; k <= 1; k++) {
        grid[at(r.ox + ROOM_W - 1, y0 + k)] = 0;
        grid[at(r.ox + ROOM_W, y0 + k)] = 0;
      }
    }
    if (down) {
      const x0 = r.ox + (ROOM_W >> 1);
      for (let k = -1; k <= 1; k++) {
        grid[at(x0 + k, r.oy + ROOM_H - 1)] = 0;
        grid[at(x0 + k, r.oy + ROOM_H)] = 0;
      }
    }
  }

  // give each room an interior layout — cover, sightlines and feel vary while
  // the room-graph itself is untouched. Doorway lanes (centre row/col ±1) and
  // the centre prop tile always stay clear.
  for (const r of rooms) {
    if (r.kind === 'gate') continue;
    const cxT = r.ox + (ROOM_W >> 1);
    const cyT = r.oy + (ROOM_H >> 1);
    const clear = (px, py) =>
      (Math.abs(px - cxT) <= 1 && Math.abs(py - cyT) <= 1) || px === cxT || py === cyT;
    const put = (px, py) => {
      if (px > r.ox && px < r.ox + ROOM_W - 1 && py > r.oy && py < r.oy + ROOM_H - 1 && !clear(px, py)) {
        grid[at(px, py)] = 1;
      }
    };
    const shape = r.kind === 'dhd' ? 'open' : R.pick(['open', 'open', 'arena', 'pillars', 'bisected']);
    r.shape = shape;
    if (shape === 'open') {
      const n = R.int(1, 3);
      for (let i = 0; i < n; i++) put(r.ox + R.int(3, ROOM_W - 4), r.oy + R.int(3, ROOM_H - 4));
    } else if (shape === 'arena') {
      // a ring of pillars around the centre + corner blocks
      for (const [dx, dy] of [[-3, -2], [0, -3], [3, -2], [-4, 0], [4, 0], [-3, 2], [0, 3], [3, 2]]) {
        put(cxT + dx, cyT + dy);
      }
      for (const [dx, dy] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) put(cxT + dx, cyT + dy);
    } else if (shape === 'pillars') {
      for (let px = r.ox + 3; px <= r.ox + ROOM_W - 4; px += 2) {
        put(px, cyT - 2);
        put(px, cyT + 2);
      }
    } else if (shape === 'bisected') {
      // a short wall off-centre with a wide gap kept open on the doorway row
      const wx = cxT + (R.chance(0.5) ? 3 : -3);
      for (let py = r.oy + 2; py <= r.oy + ROOM_H - 3; py++) {
        if (Math.abs(py - cyT) > 1) put(wx, py);
      }
    }
  }

  return {
    grid,
    W,
    H,
    rooms,
    gateRoom: rooms.find((r) => r.kind === 'gate'),
    dhdRoom: rooms.find((r) => r.kind === 'dhd'),
    params,
  };
}

export function tileAt(world, px, py) {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return 1;
  return world.grid[ty * world.W + tx];
}

// ---------------------------------------------------------------------------
// materials
//
// each biome supplies a seamless floor tile, a seamless wall tile, a treatment
// for the extruded wall front face and map-level decoration. The two tiles are
// built once per bake and used as canvas patterns, so nothing loops per world
// pixel; the decoration passes are what break the pattern repeat up.
// ---------------------------------------------------------------------------

const FP = TILE * 4; // floor pattern tile — 4 tiles square
const WP = TILE * 2; // wall pattern tile

// fbm colour-ramp base for a material tile; returns the tile's 2d context
function base(cv, rand, stops, o) {
  o = o || {};
  const w = cv.width;
  const h = cv.height;
  const lo = T.fbm(w, h, rand, { cells: o.cells || 4, octaves: o.octaves || 5 });
  const hi = T.fbm(w, h, rand, { cells: o.fine || 16, octaves: 2 });
  const k = o.fineAmt == null ? 0.25 : o.fineAmt;
  const l = T.ramp(stops);
  T.pixels(cv, (x, y, out) => {
    const i = y * w + x;
    T.lut(l, lo[i] * (1 - k) + hi[i] * k, out);
  });
  return cv.getContext('2d');
}

// a masked colour wash: paint `color` wherever the noise field clears `at`
function overlay(c, w, h, rand, color, o) {
  o = o || {};
  const f = T.fbm(w, h, rand, { cells: o.cells || 5, octaves: o.octaves || 4 });
  const at = o.at == null ? 0.55 : o.at;
  const soft = o.soft || 0.14;
  const rgb = T.hexRgb(color);
  const m = T.canv(w, h);
  T.pixels(m, (x, y, out) => {
    const v = f[y * w + x];
    out[0] = rgb[0];
    out[1] = rgb[1];
    out[2] = rgb[2];
    out[3] = v > at ? Math.min(1, (v - at) / soft) * 255 : 0;
  });
  c.save();
  c.globalAlpha = o.alpha == null ? 0.7 : o.alpha;
  c.drawImage(m, 0, 0);
  c.restore();
}

const MAT = {
  // ---- SGC concrete --------------------------------------------------------
  ruins: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.5, p.floorB], [0.8, p.floorA], [1, p.hi]], { cells: 5, fine: 20, fineAmt: 0.3 });
      T.seams(c, FP, FP, { px: TILE * 2, py: TILE * 2, wide: 2, dark: 'rgba(6,9,14,0.5)', light: 'rgba(180,215,255,0.05)' });
      T.speckle(c, FP, FP, rand, { count: 300, color: '#c8d8e8', alpha: 0.1 });
      T.splotch(c, FP, FP, rand, { count: 5, color: '#0a0d13', alpha: 0.14, max: 30 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#0f131a'], [0.55, p.wall], [1, T.mix(p.wall, p.hi, 0.5)]], { cells: 4, fine: 16 });
      T.seams(c, WP, WP, { py: 17, wide: 1, dark: 'rgba(0,0,0,0.35)' });
      return cv;
    },
    face(c, x, fy, tx, ty, p) {
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(x, fy + 6, TILE, 4);
      c.fillStyle = T.rgba(p.accent2, 0.22);
      c.fillRect(x, fy + 11, TILE, 1);
    },
    deco(c, world, rand, p, api) {
      api.hugWalls(10, rand, (x, y) => T.pool(c, x, y, 52, p.accent, 0.07));
    },
  },

  // ---- goa'uld / ancient temple -------------------------------------------
  temple: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.42, p.floorB], [0.7, p.floorA], [1, p.hi]], { cells: 4, fine: 17, fineAmt: 0.28 });
      T.ashlar(c, FP, FP, rand, {
        course: TILE, minW: 30, maxW: 68, gap: 3, jitter: 0.11, bevel: 0.09,
        light: '#ffe6b8', dark: '#0d0803', joint: 'rgba(13,8,3,0.55)',
      });
      T.cracks(c, FP, FP, rand, { count: 4, color: 'rgba(16,10,4,0.32)', step: 6, segs: 6 });
      T.splotch(c, FP, FP, rand, { count: 6, color: '#d9bd8a', alpha: 0.1, max: 34 });
      T.splotch(c, FP, FP, rand, { count: 4, color: '#150c04', alpha: 0.16, max: 28 });
      T.speckle(c, FP, FP, rand, { count: 340, color: '#ffe0a0', alpha: 0.13 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#170f06'], [0.5, p.wall], [1, T.mix(p.wall, p.hi, 0.6)]], { cells: 3, fine: 12, fineAmt: 0.3 });
      T.ashlar(c, WP, WP, rand, {
        course: 17, minW: 20, maxW: 34, gap: 2, jitter: 0.14, bevel: 0.11,
        light: '#ffdfa8', dark: '#0a0603', joint: 'rgba(10,6,3,0.6)',
      });
      T.speckle(c, WP, WP, rand, { count: 90, color: p.accent, alpha: 0.12 });
      return cv;
    },
    // a gold inlay band over a recessed hieroglyph frieze
    face(c, x, fy, tx, ty, p) {
      c.fillStyle = T.rgba(p.accent, 0.42);
      c.fillRect(x, fy + 3, TILE, 1);
      c.fillStyle = 'rgba(0,0,0,0.34)';
      c.fillRect(x, fy + 5, TILE, 8);
      for (let i = 0; i < 4; i++) {
        const h = T.hash2(tx * 4 + i, ty, 11);
        const gx = x + 4 + i * 7;
        c.fillStyle = T.rgba(p.accent, 0.3 + h * 0.34);
        if (h < 0.25) {
          c.fillRect(gx, fy + 6, 3, 6);
          c.fillRect(gx - 1, fy + 6, 5, 1);
        } else if (h < 0.5) {
          c.fillRect(gx + 1, fy + 6, 1, 6);
          c.fillRect(gx - 1, fy + 8, 5, 1);
        } else if (h < 0.74) {
          c.beginPath();
          c.arc(gx + 1.5, fy + 8, 2, 0, Math.PI * 2);
          c.fill();
          c.fillRect(gx + 1, fy + 10, 1, 3);
        } else {
          c.fillRect(gx, fy + 7, 4, 1);
          c.fillRect(gx, fy + 10, 4, 1);
          c.fillRect(gx + 1, fy + 7, 1, 4);
        }
      }
      c.fillStyle = T.rgba(p.accent, 0.24);
      c.fillRect(x, fy + 14, TILE, 1);
    },
    deco(c, world, rand, p, api) {
      // a carved medallion in the middle of every chamber
      for (const r of api.rooms) {
        const cx = r.centerPx.x;
        const cy = r.centerPx.y;
        const rad = Math.min(r.rectPx.w, r.rectPx.h) * 0.3;
        c.save();
        c.strokeStyle = T.rgba(p.accent, 0.15);
        c.lineWidth = 2;
        for (const k of [1, 0.72, 0.4]) {
          c.beginPath();
          c.arc(cx, cy, rad * k, 0, Math.PI * 2);
          c.stroke();
        }
        c.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * rad * 0.42, cy + Math.sin(a) * rad * 0.42);
          c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
          c.stroke();
        }
        c.restore();
      }
      // sand drifted against the stonework, then torches washing it warm
      api.hugWalls(70, rand, (x, y) => T.pool(c, x, y, 26 + rand() * 26, '#dcc294', 0.13));
      api.hugWalls(16, rand, (x, y) => T.pool(c, x, y, 66, p.accent2, 0.11));
      api.spots(26, rand, (x, y) => {
        c.strokeStyle = 'rgba(18,11,4,0.3)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        let a = rand() * 6.28;
        for (let s = 0; s < 6; s++) {
          a += (rand() - 0.5) * 1.2;
          c.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
        }
        c.stroke();
      });
    },
  },

  // ---- overgrown outdoor ruins --------------------------------------------
  jungle: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.4, p.floorB], [0.68, p.floorA], [1, p.hi]], { cells: 3, fine: 14, fineAmt: 0.3 });
      T.ashlar(c, FP, FP, rand, {
        course: TILE, minW: 26, maxW: 48, gap: 5, jitter: 0.15, bevel: 0.07,
        light: '#c2cfa8', dark: '#080c05', joint: 'rgba(8,12,5,0.45)',
      });
      overlay(c, FP, FP, rand, '#5c9638', { cells: 5, at: 0.53, soft: 0.16, alpha: 0.6 });
      overlay(c, FP, FP, rand, '#8fd45a', { cells: 9, at: 0.68, soft: 0.1, alpha: 0.3 });
      T.speckle(c, FP, FP, rand, { count: 260, color: '#cdf08a', alpha: 0.16 });
      T.pebbles(c, FP, FP, rand, { count: 24, color: '#6d7a58', shadow: '#080c05', alpha: 0.45 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#0d1209'], [0.5, '#39412f'], [1, '#78846a']], { cells: 3, fine: 13, fineAmt: 0.32 });
      T.ashlar(c, WP, WP, rand, {
        course: 17, minW: 16, maxW: 30, gap: 3, jitter: 0.17, bevel: 0.1,
        light: '#d2dcc0', dark: '#060903', joint: 'rgba(6,9,3,0.55)',
      });
      overlay(c, WP, WP, rand, '#4d8030', { cells: 4, at: 0.5, soft: 0.2, alpha: 0.55 });
      return cv;
    },
    // vines and roots wrapping the tumbled blocks, with the odd fern
    face(c, x, fy, tx, ty, p) {
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.fillRect(x, fy + 4, TILE, 12);
      const h = T.hash2(tx, ty, 23);
      c.save();
      c.strokeStyle = 'rgba(58,102,40,0.75)';
      c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const vx = x + 5 + ((h * 977 + i * 331) % 24);
        const sw = 1.4 + ((h * 71 + i) % 1) * 1.2;
        c.lineWidth = sw;
        c.beginPath();
        c.moveTo(vx, fy);
        c.quadraticCurveTo(vx + (i % 2 ? 4 : -4), fy + 10, vx + (i % 2 ? -2 : 3), fy + 16 + (h * 9) % 9);
        c.stroke();
        c.fillStyle = 'rgba(120,180,70,0.6)';
        for (let k = 1; k <= 3; k++) {
          c.beginPath();
          c.ellipse(vx + (k % 2 ? 3 : -3), fy + k * 5, 2.2, 1.3, k, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
      if (h > 0.72) T.frond(c, x + 6 + h * 18, fy + 15, -0.5 - h, 14, { color: 'rgba(150,205,95,0.5)', width: 1 });
      c.fillStyle = 'rgba(96,150,58,0.35)';
      c.fillRect(x, fy, TILE, 3);
    },
    deco(c, world, rand, p, api) {
      // dappled canopy light — this reads as sky more than anything else does
      api.spots(90, rand, (x, y) => T.pool(c, x, y, 22 + rand() * 46, '#d8ffa0', 0.07));
      api.spots(22, rand, (x, y) => T.pool(c, x, y, 12 + rand() * 20, '#ffffcc', 0.09));
      // standing water
      api.spots(16, rand, (x, y) => {
        const rw = 12 + rand() * 20;
        const rh = rw * (0.5 + rand() * 0.25);
        c.save();
        c.fillStyle = T.rgba(p.accent2, 0.4);
        c.beginPath();
        c.ellipse(x, y, rw, rh, rand() * 3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(190,230,255,0.2)';
        c.lineWidth = 1;
        c.stroke();
        c.fillStyle = 'rgba(210,245,255,0.22)';
        c.fillRect(x - rw * 0.5, y - rh * 0.35, rw * 0.7, 1.5);
        c.restore();
      });
      // roots creeping out from the walls onto the floor
      c.save();
      c.strokeStyle = 'rgba(46,74,32,0.55)';
      c.lineCap = 'round';
      api.hugWalls(46, rand, (x, y) => T.vein(c, x, y, rand() * 6.28, 16, 3, rand, { width: 0.8, spread: 1.1, decay: 0.7, forkChance: 0.5 }));
      c.restore();
      // leaf litter
      api.spots(150, rand, (x, y) => {
        c.fillStyle = rand() < 0.5 ? 'rgba(150,190,80,0.4)' : 'rgba(120,95,40,0.4)';
        c.beginPath();
        c.ellipse(x, y, 2.4, 1.2, rand() * 3, 0, Math.PI * 2);
        c.fill();
      });
    },
  },

  // ---- canyon outpost ------------------------------------------------------
  desert: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const f = T.fbm(FP, FP, rand, { cells: 3, octaves: 4 });
      const g = T.fbm(FP, FP, rand, { cells: 10, octaves: 3 });
      const l = T.ramp([[0, p.lo], [0.35, p.floorB], [0.68, p.floorA], [1, p.hi]]);
      T.pixels(cv, (x, y, o) => {
        const i = y * FP + x;
        // wind ripples: a wave along the dune direction, warped by the noise
        const rip = Math.sin(y * 0.3696 + f[i] * 22 + x * 0.0924) * 0.5 + 0.5;
        T.lut(l, f[i] * 0.55 + g[i] * 0.17 + rip * 0.28, o);
      });
      const c = cv.getContext('2d');
      T.grain(c, FP, FP, rand, { count: 110, angle: 0.14, min: 20, max: 60, alpha: 0.05, light: '#f4dfae', dark: '#3a2a14' });
      T.pebbles(c, FP, FP, rand, { count: 44, color: '#8f7752', shadow: '#2a1d0c', alpha: 0.55 });
      T.speckle(c, FP, FP, rand, { count: 420, color: '#fff2cc', alpha: 0.17 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#3a2a15'], [0.45, p.wall], [1, T.mix(p.wall, '#e8d2a4', 0.55)]], { cells: 3, fine: 11, fineAmt: 0.22 });
      T.strata(c, WP, WP, rand, { min: 2, max: 8, jitter: 0.14, seam: 0.35, light: '#f0dcb0', dark: '#241708' });
      T.speckle(c, WP, WP, rand, { count: 140, color: '#fff0c8', alpha: 0.12 });
      return cv;
    },
    // wind-cut strata carrying straight on down the mesa face
    face(c, x, fy, tx, ty, p) {
      for (let i = 0; i < 5; i++) {
        const h = T.hash2(tx, ty * 5 + i, 31);
        c.fillStyle = T.rgba(h < 0.5 ? '#2a1c0b' : '#f0dcb0', 0.06 + h * 0.1);
        c.fillRect(x, fy + 2 + i * 3, TILE, 2 + (h > 0.6 ? 1 : 0));
      }
      c.fillStyle = 'rgba(0,0,0,0.22)';
      for (let i = 0; i < 3; i++) {
        const h = T.hash2(tx * 3 + i, ty, 37);
        c.fillRect(x + h * 28, fy + 5 + h * 8, 3 + h * 4, 1.5);
      }
      c.fillStyle = T.rgba('#fff2d0', 0.14);
      c.fillRect(x, fy + 1, TILE, 1);
    },
    deco(c, world, rand, p, api) {
      // rock outcrops shouldering up out of the sand
      api.spots(30, rand, (x, y) => {
        const r = 9 + rand() * 16;
        c.save();
        c.fillStyle = 'rgba(40,28,13,0.34)';
        c.beginPath();
        c.ellipse(x + 3, y + 4, r * 1.05, r * 0.6, 0, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        const n = 6 + ((rand() * 3) | 0);
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = r * (0.65 + rand() * 0.45);
          const px = x + Math.cos(a) * rr;
          const py = y + Math.sin(a) * rr * 0.66;
          i ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.closePath();
        c.fillStyle = 'rgba(102,80,48,0.9)';
        c.fill();
        c.strokeStyle = 'rgba(248,226,178,0.3)';
        c.lineWidth = 1.2;
        c.stroke();
        c.fillStyle = 'rgba(30,20,9,0.35)';
        c.fillRect(x - r * 0.6, y, r * 1.2, 2);
        c.restore();
      });
      // sand banked up along every rock face, and sun bleaching the open ground
      api.hugWalls(90, rand, (x, y) => T.pool(c, x, y, 22 + rand() * 26, '#e8cd9a', 0.16));
      api.spots(40, rand, (x, y) => T.pool(c, x, y, 40 + rand() * 60, '#fff0c0', 0.05));
      // dry scrub
      api.spots(26, rand, (x, y) => {
        c.strokeStyle = 'rgba(96,80,44,0.55)';
        c.lineWidth = 1;
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + (rand() - 0.5) * 2.4;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * (4 + rand() * 6), y + Math.sin(a) * (4 + rand() * 6));
          c.stroke();
        }
      });
    },
  },

  // ---- glacier cavern ------------------------------------------------------
  ice: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.42, p.floorB], [0.7, p.floorA], [1, p.hi]], { cells: 3, fine: 15, fineAmt: 0.22 });
      // refraction: long light streaks running through the ice
      T.grain(c, FP, FP, rand, { count: 90, angle: -0.62, min: 24, max: 80, alpha: 0.09, width: 2, light: '#dff4ff', dark: '#08131f' });
      T.cracks(c, FP, FP, rand, { count: 5, color: 'rgba(200,244,255,0.26)', step: 8, segs: 6, width: 1 });
      overlay(c, FP, FP, rand, '#e8f6ff', { cells: 4, at: 0.6, soft: 0.13, alpha: 0.55 });
      T.speckle(c, FP, FP, rand, { count: 520, color: '#ffffff', alpha: 0.28 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#08131f'], [0.45, p.wall], [1, '#a8dcee']], { cells: 3, fine: 10, fineAmt: 0.2 });
      T.grain(c, WP, WP, rand, { count: 60, angle: 1.35, min: 16, max: 50, alpha: 0.13, width: 2, light: '#eaf9ff', dark: '#061019' });
      T.cracks(c, WP, WP, rand, { count: 6, color: 'rgba(225,250,255,0.3)', step: 7, segs: 5 });
      T.speckle(c, WP, WP, rand, { count: 160, color: '#ffffff', alpha: 0.3 });
      return cv;
    },
    // frosted ice front with an icicle fringe hanging off the lip
    face(c, x, fy, tx, ty, p) {
      const g = c.createLinearGradient(0, fy, 0, fy + WALL_H);
      g.addColorStop(0, 'rgba(205,244,255,0.4)');
      g.addColorStop(1, 'rgba(20,50,74,0.15)');
      c.fillStyle = g;
      c.fillRect(x, fy, TILE, WALL_H);
      for (let i = 0; i < 4; i++) {
        const h = T.hash2(tx * 4 + i, ty, 53);
        const ix = x + 3 + i * 8 + h * 4;
        const len = 5 + h * 13;
        c.beginPath();
        c.moveTo(ix - 1.8, fy + 1);
        c.lineTo(ix + 1.8, fy + 1);
        c.lineTo(ix, fy + 1 + len);
        c.closePath();
        c.fillStyle = 'rgba(214,246,255,0.55)';
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(ix - 0.6, fy + 1, 0.9, len * 0.6);
      }
      c.fillStyle = 'rgba(255,255,255,0.3)';
      c.fillRect(x, fy + WALL_H - 2, TILE, 1);
    },
    deco(c, world, rand, p, api) {
      // snow banked against the ice, then long cracks running through the floor
      api.hugWalls(110, rand, (x, y) => T.pool(c, x, y, 20 + rand() * 26, '#f2fbff', 0.2));
      c.save();
      c.strokeStyle = 'rgba(190,240,255,0.22)';
      c.lineCap = 'round';
      api.spots(26, rand, (x, y) => T.vein(c, x, y, rand() * 6.28, 34, 3, rand, { width: 0.7, spread: 0.9, decay: 0.72, segs: 5 }));
      c.restore();
      api.spots(120, rand, (x, y) => {
        c.fillStyle = 'rgba(255,255,255,' + (0.2 + rand() * 0.4) + ')';
        const s = 0.8 + rand() * 1.6;
        c.fillRect(x, y, s, s);
      });
      api.spots(14, rand, (x, y) => T.pool(c, x, y, 46 + rand() * 40, p.accent2, 0.1));
    },
  },

  // ---- derelict ship deck --------------------------------------------------
  foundry: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.45, p.floorB], [0.75, p.floorA], [1, p.hi]], { cells: 5, fine: 20, fineAmt: 0.32 });
      // deck plates, two tiles square, with a lit lip on the top edge
      T.seams(c, FP, FP, { px: TILE * 2, py: TILE * 2, wide: 2, dark: 'rgba(5,6,8,0.6)', light: 'rgba(190,205,225,0.07)' });
      // diamond tread on half the plates, a grating slot band on another
      for (let py = 0; py < FP; py += TILE * 2) {
        for (let px = 0; px < FP; px += TILE * 2) {
          const h = T.hash2(px, py, 61);
          if (h < 0.45) {
            c.save();
            c.beginPath();
            c.rect(px + 4, py + 4, TILE * 2 - 8, TILE * 2 - 8);
            c.clip();
            for (let y = py; y < py + TILE * 2; y += 7) {
              for (let x = px; x < px + TILE * 2; x += 7) {
                c.fillStyle = 'rgba(210,225,245,0.09)';
                c.fillRect(x + 1, y + 1, 4, 1.4);
                c.fillStyle = 'rgba(0,0,0,0.22)';
                c.fillRect(x + 1, y + 2.4, 4, 1.2);
              }
            }
            c.restore();
          } else if (h < 0.62) {
            for (let y = py + 6; y < py + TILE * 2 - 4; y += 5) {
              c.fillStyle = 'rgba(0,0,0,0.42)';
              c.fillRect(px + 5, y, TILE * 2 - 10, 3);
              c.fillStyle = 'rgba(180,195,215,0.06)';
              c.fillRect(px + 5, y + 3, TILE * 2 - 10, 1);
            }
          }
          const r = [];
          for (const [ox, oy] of [[6, 6], [TILE * 2 - 6, 6], [6, TILE * 2 - 6], [TILE * 2 - 6, TILE * 2 - 6]]) r.push([px + ox, py + oy]);
          T.rivets(c, r, { r: 1.5, light: 'rgba(210,225,245,0.28)', dark: 'rgba(0,0,0,0.5)' });
        }
      }
      T.splotch(c, FP, FP, rand, { count: 6, color: p.accent2, alpha: 0.22, max: 26 });
      T.splotch(c, FP, FP, rand, { count: 5, color: '#000000', alpha: 0.3, max: 22, hard: 0.7 });
      T.speckle(c, FP, FP, rand, { count: 220, color: '#b06a30', alpha: 0.2 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#101214'], [0.5, p.wall], [1, T.mix(p.wall, '#c8cdd6', 0.45)]], { cells: 4, fine: 16, fineAmt: 0.3 });
      T.seams(c, WP, WP, { px: TILE, py: 17, wide: 2, dark: 'rgba(0,0,0,0.5)', light: 'rgba(200,215,235,0.07)' });
      const r = [];
      for (let y = 4; y < WP; y += 17) for (let x = 5; x < WP; x += TILE) r.push([x, y], [x + TILE - 10, y]);
      T.rivets(c, r, { r: 1.5, light: 'rgba(215,228,245,0.3)', dark: 'rgba(0,0,0,0.5)' });
      T.splotch(c, WP, WP, rand, { count: 5, color: p.accent2, alpha: 0.25, max: 20 });
      return cv;
    },
    // conduit runs and a rivet course down the bulkhead face
    face(c, x, fy, tx, ty, p) {
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(x, fy + 3, TILE, 11);
      for (const [oy, col] of [[5, '#6c737d'], [9, '#55341c']]) {
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fillRect(x, fy + oy + 2, TILE, 1);
        c.fillStyle = col;
        c.fillRect(x, fy + oy, TILE, 2.4);
        c.fillStyle = 'rgba(230,240,255,0.16)';
        c.fillRect(x, fy + oy, TILE, 0.8);
      }
      const h = T.hash2(tx, ty, 67);
      if (h > 0.82) {
        c.fillStyle = T.rgba(p.accent, 0.6);
        c.fillRect(x + 14, fy + 12, 5, 2);
        c.fillStyle = T.rgba(p.accent, 0.2);
        c.fillRect(x + 11, fy + 11, 11, 4);
      }
      T.rivets(c, [[x + 4, fy + 14], [x + TILE - 4, fy + 14]], { r: 1.4, light: 'rgba(210,225,245,0.3)', dark: 'rgba(0,0,0,0.55)' });
    },
    deco(c, world, rand, p, api) {
      // hazard chevrons painted across every doorway throat
      api.doors((tx, ty) => {
        T.hazard(c, tx * TILE, ty * TILE, TILE, TILE, { pitch: 9, base: '#15130f', stripe: p.accent, alpha: 0.5 });
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      });
      // spilled oil, rust bloom and stencilled deck markings
      api.spots(24, rand, (x, y) => {
        const r = 10 + rand() * 22;
        c.save();
        c.fillStyle = 'rgba(4,4,6,0.66)';
        c.beginPath();
        c.ellipse(x, y, r, r * 0.62, rand() * 3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(150,170,200,0.1)';
        c.lineWidth = 1;
        c.stroke();
        c.restore();
      });
      api.spots(30, rand, (x, y) => T.pool(c, x, y, 10 + rand() * 22, p.accent2, 0.28));
      api.spots(12, rand, (x, y) => {
        c.save();
        c.strokeStyle = T.rgba(p.accent, 0.22);
        c.lineWidth = 2;
        c.strokeRect(x - 16, y - 10, 32, 20);
        c.restore();
      });
      api.hugWalls(14, rand, (x, y) => T.pool(c, x, y, 54, p.accent, 0.09));
    },
  },

  // ---- wraith hive ---------------------------------------------------------
  hive: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.42, p.floorB], [0.72, p.floorA], [1, p.hi]], { cells: 3, fine: 11, fineAmt: 0.3 });
      overlay(c, FP, FP, rand, '#5c2f66', { cells: 4, at: 0.5, soft: 0.2, alpha: 0.55 });
      // a damp sheen over the membrane
      T.splotch(c, FP, FP, rand, { count: 10, color: '#e0a8f0', alpha: 0.09, max: 30, hard: 0.3 });
      T.splotch(c, FP, FP, rand, { count: 6, color: '#0d0512', alpha: 0.28, max: 26 });
      T.speckle(c, FP, FP, rand, { count: 200, color: '#e8b0ff', alpha: 0.14 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#0e0714'], [0.5, p.wall], [1, T.mix(p.wall, '#c88ad8', 0.5)]], { cells: 3, fine: 9, fineAmt: 0.32 });
      // chitin ribs — vertical swells with a lit crest
      for (let x = 0; x < WP; x += 11) {
        const g = c.createLinearGradient(x, 0, x + 11, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.34)');
        g.addColorStop(0.45, 'rgba(216,160,240,0.16)');
        g.addColorStop(1, 'rgba(0,0,0,0.34)');
        c.fillStyle = g;
        c.fillRect(x, 0, 11, WP);
      }
      overlay(c, WP, WP, rand, '#2a1030', { cells: 5, at: 0.55, soft: 0.18, alpha: 0.5 });
      T.speckle(c, WP, WP, rand, { count: 90, color: p.accent, alpha: 0.16 });
      return cv;
    },
    // ribbed chitin with translucent pods glowing through it
    face(c, x, fy, tx, ty, p) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(x, fy + 2, TILE, 13);
      c.save();
      c.strokeStyle = 'rgba(214,150,238,0.35)';
      c.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        const rx = x + 3 + i * 7;
        c.beginPath();
        c.moveTo(rx, fy + 1);
        c.quadraticCurveTo(rx + 2.5, fy + 8, rx, fy + WALL_H);
        c.stroke();
      }
      c.restore();
      const h = T.hash2(tx, ty, 71);
      if (h > 0.6) {
        const px = x + 6 + h * 20;
        const py = fy + 8;
        T.pool(c, px, py, 9, p.accent, 0.34);
        c.fillStyle = T.rgba(p.accent, 0.62);
        c.beginPath();
        c.ellipse(px, py, 2.6, 3.4, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = T.rgba(p.accent2, 0.22);
      c.fillRect(x, fy, TILE, 2);
    },
    deco(c, world, rand, p, api) {
      // sinew webbing the deck, terminating in luminous nodes
      c.save();
      c.strokeStyle = 'rgba(200,130,220,0.3)';
      c.lineCap = 'round';
      api.spots(46, rand, (x, y) =>
        T.vein(c, x, y, rand() * 6.28, 26, 3, rand, { width: 0.9, spread: 1.2, decay: 0.7, node: T.rgba(p.accent, 0.5), nodeR: 2.4, nodeAt: 2 })
      );
      c.restore();
      api.spots(34, rand, (x, y) => {
        T.pool(c, x, y, 16 + rand() * 20, p.accent, 0.16);
        c.fillStyle = T.rgba(p.accent, 0.45);
        c.beginPath();
        c.arc(x, y, 1.6 + rand() * 1.8, 0, Math.PI * 2);
        c.fill();
      });
      api.hugWalls(50, rand, (x, y) => T.pool(c, x, y, 18 + rand() * 22, '#3a1244', 0.34));
      api.spots(18, rand, (x, y) => T.pool(c, x, y, 40 + rand() * 40, p.accent2, 0.09));
    },
  },

  // ---- ancient city --------------------------------------------------------
  atlantis: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      // polished, so the noise stays very fine
      const c = base(cv, rand, [[0, p.lo], [0.5, p.floorB], [0.82, p.floorA], [1, p.hi]], { cells: 6, fine: 26, fineAmt: 0.18, octaves: 3 });
      const P = TILE * 2;
      T.seams(c, FP, FP, { px: P, py: P, wide: 2, dark: 'rgba(4,10,16,0.55)', light: 'rgba(150,220,255,0.07)' });
      for (let py = 0; py < FP; py += P) {
        for (let px = 0; px < FP; px += P) {
          // a fine inlay border with clipped corners, and a hairline cross
          c.strokeStyle = T.rgba(p.accent, 0.12);
          c.lineWidth = 1;
          const i = 7;
          c.beginPath();
          c.moveTo(px + i + 5, py + i);
          c.lineTo(px + P - i - 5, py + i);
          c.lineTo(px + P - i, py + i + 5);
          c.lineTo(px + P - i, py + P - i - 5);
          c.lineTo(px + P - i - 5, py + P - i);
          c.lineTo(px + i + 5, py + P - i);
          c.lineTo(px + i, py + P - i - 5);
          c.lineTo(px + i, py + i + 5);
          c.closePath();
          c.stroke();
          c.fillStyle = T.rgba(p.accent, 0.09);
          c.fillRect(px + P / 2 - 6, py + P / 2 - 0.5, 12, 1);
          c.fillRect(px + P / 2 - 0.5, py + P / 2 - 6, 1, 12);
        }
      }
      // recessed light channels glowing along the seams
      c.save();
      c.shadowBlur = 6;
      c.shadowColor = T.rgba(p.accent, 0.5);
      c.fillStyle = T.rgba(p.accent, 0.16);
      for (let x = 0; x < FP; x += P) c.fillRect(x + 1, 0, 1, FP);
      for (let y = 0; y < FP; y += P) c.fillRect(0, y + 1, FP, 1);
      c.restore();
      T.speckle(c, FP, FP, rand, { count: 140, color: '#cfe8ff', alpha: 0.07 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#0b1520'], [0.5, p.wall], [1, T.mix(p.wall, '#a8d4ee', 0.5)]], { cells: 5, fine: 22, fineAmt: 0.2, octaves: 3 });
      for (let y = 0; y < WP; y += 17) {
        for (let x = 0; x < WP; x += TILE) {
          c.fillStyle = 'rgba(200,235,255,0.06)';
          c.fillRect(x + 2, y + 2, TILE - 4, 1);
          c.fillStyle = 'rgba(0,0,0,0.4)';
          c.fillRect(x, y, TILE, 2);
          c.fillRect(x, y, 2, 17);
          c.fillStyle = T.rgba(p.accent, 0.1);
          c.fillRect(x + 5, y + 8, TILE - 10, 1);
        }
      }
      return cv;
    },
    // a recessed light channel set into the panelling
    face(c, x, fy, tx, ty, p) {
      c.fillStyle = 'rgba(3,8,14,0.5)';
      c.fillRect(x, fy + 4, TILE, 9);
      c.fillStyle = 'rgba(160,215,245,0.1)';
      c.fillRect(x, fy + 3, TILE, 1);
      c.save();
      c.shadowBlur = 7;
      c.shadowColor = p.accent;
      c.fillStyle = T.rgba(p.accent, 0.5);
      c.fillRect(x + 2, fy + 7, TILE - 4, 2);
      c.restore();
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(x, fy + 13, TILE, 1);
      if (T.hash2(tx, ty, 89) > 0.75) {
        c.fillStyle = T.rgba(p.accent2, 0.28);
        c.fillRect(x + 15, fy + 11, 4, 3);
      }
    },
    deco(c, world, rand, p, api) {
      // a radial inlay set into the centre of every hall
      for (const r of api.rooms) {
        const cx = r.centerPx.x;
        const cy = r.centerPx.y;
        const rad = Math.min(r.rectPx.w, r.rectPx.h) * 0.33;
        c.save();
        c.strokeStyle = T.rgba(p.accent, 0.13);
        c.lineWidth = 1.5;
        for (const k of [1, 0.66, 0.3]) {
          c.beginPath();
          c.arc(cx, cy, rad * k, 0, Math.PI * 2);
          c.stroke();
        }
        c.lineWidth = 1;
        c.strokeStyle = T.rgba(p.accent, 0.09);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * rad * 0.3, cy + Math.sin(a) * rad * 0.3);
          c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
          c.stroke();
        }
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, T.rgba(p.accent, 0.09));
        g.addColorStop(1, T.rgba(p.accent, 0));
        c.fillStyle = g;
        c.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        c.restore();
      }
      // conduits picking out the base of every wall
      api.hugWalls(120, rand, (x, y) => T.pool(c, x, y, 16 + rand() * 14, p.accent, 0.09));
      api.spots(20, rand, (x, y) => T.pool(c, x, y, 40 + rand() * 40, p.accent2, 0.05));
    },
  },

  // ---- ossuary -------------------------------------------------------------
  catacomb: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.45, p.floorB], [0.78, p.floorA], [1, p.hi]], { cells: 4, fine: 16, fineAmt: 0.3 });
      // grave slabs, long and narrow
      T.ashlar(c, FP, FP, rand, {
        course: TILE, minW: 34, maxW: 68, gap: 4, jitter: 0.13, bevel: 0.1,
        light: '#b8ac90', dark: '#050403', joint: 'rgba(4,3,2,0.7)',
      });
      T.cracks(c, FP, FP, rand, { count: 5, color: 'rgba(0,0,0,0.45)', step: 6, segs: 6 });
      T.splotch(c, FP, FP, rand, { count: 7, color: '#000000', alpha: 0.3, max: 32 });
      T.speckle(c, FP, FP, rand, { count: 200, color: p.accent, alpha: 0.08 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#080706'], [0.5, p.wall], [1, T.mix(p.wall, '#8a7f6c', 0.5)]], { cells: 3, fine: 12, fineAmt: 0.34 });
      // chisel marks rather than dressed courses
      T.grain(c, WP, WP, rand, { count: 130, angle: 1.5708, min: 5, max: 14, alpha: 0.12, light: '#9a8f78', dark: '#000000' });
      T.ashlar(c, WP, WP, rand, {
        course: 23, minW: 24, maxW: 44, gap: 2, jitter: 0.1, bevel: 0.07,
        light: '#a89c84', dark: '#000000', joint: 'rgba(0,0,0,0.65)',
      });
      return cv;
    },
    // burial niches cut into the rock, some still occupied
    face(c, x, fy, tx, ty, p) {
      const h = T.hash2(tx, ty, 97);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(x, fy + 2, TILE, 13);
      if (h > 0.42) {
        const nx = x + 8;
        c.fillStyle = 'rgba(0,0,0,0.8)';
        c.beginPath();
        c.moveTo(nx, fy + 14);
        c.lineTo(nx, fy + 7);
        c.quadraticCurveTo(nx + 9, fy + 1, nx + 18, fy + 7);
        c.lineTo(nx + 18, fy + 14);
        c.closePath();
        c.fill();
        c.strokeStyle = T.rgba(p.accent, 0.16);
        c.lineWidth = 1;
        c.stroke();
        if (h > 0.66) {
          // a skull sitting in the niche
          c.fillStyle = T.rgba(p.accent, 0.42);
          c.beginPath();
          c.arc(nx + 9, fy + 9, 3.1, 0, Math.PI * 2);
          c.fill();
          c.fillRect(nx + 7.2, fy + 11, 3.6, 2.2);
          c.fillStyle = 'rgba(0,0,0,0.85)';
          c.fillRect(nx + 7.4, fy + 8.4, 1.5, 1.5);
          c.fillRect(nx + 10.1, fy + 8.4, 1.5, 1.5);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          c.fillStyle = T.rgba(p.accent, 0.1);
          c.fillRect(x + 4 + i * 10, fy + 5, 6, 1);
        }
      }
      c.fillStyle = T.rgba(p.accent2, 0.14);
      c.fillRect(x, fy, TILE, 1.5);
    },
    deco(c, world, rand, p, api) {
      // bones stacked along the walls
      api.hugWalls(56, rand, (x, y) => {
        c.save();
        c.translate(x, y);
        c.rotate(rand() * 6.28);
        for (let i = 0; i < 4; i++) {
          const l = 5 + rand() * 8;
          c.fillStyle = T.rgba(p.accent, 0.2 + rand() * 0.2);
          c.fillRect(-l / 2, i * 2.4 - 4, l, 1.5);
          c.beginPath();
          c.arc(-l / 2, i * 2.4 - 3.3, 1.2, 0, Math.PI * 2);
          c.arc(l / 2, i * 2.4 - 3.3, 1.2, 0, Math.PI * 2);
          c.fill();
        }
        c.restore();
      });
      api.spots(16, rand, (x, y) => {
        c.fillStyle = T.rgba(p.accent, 0.26);
        c.beginPath();
        c.arc(x, y, 3.4, 0, Math.PI * 2);
        c.fill();
        c.fillRect(x - 2, y + 2.4, 4, 2.6);
        c.fillStyle = 'rgba(0,0,0,0.8)';
        c.fillRect(x - 2, y - 0.8, 1.6, 1.6);
        c.fillRect(x + 0.5, y - 0.8, 1.6, 1.6);
      });
      // cold grave-light welling out of the floor
      api.spots(22, rand, (x, y) => T.pool(c, x, y, 34 + rand() * 40, p.accent2, 0.09));
      api.spots(40, rand, (x, y) => T.pool(c, x, y, 20 + rand() * 30, '#000000', 0.3));
      // a sigil scratched into the slabs of each chamber
      for (const r of api.rooms) {
        const cx = r.centerPx.x;
        const cy = r.centerPx.y;
        const rad = Math.min(r.rectPx.w, r.rectPx.h) * 0.24;
        c.save();
        c.strokeStyle = T.rgba(p.accent, 0.12);
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(cx, cy, rad, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 4 * Math.PI * 2) / 5;
          const px = cx + Math.cos(a) * rad;
          const py = cy + Math.sin(a) * rad;
          i ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.closePath();
        c.stroke();
        c.restore();
      }
    },
  },
};

// ---------------------------------------------------------------------------
// bake
// ---------------------------------------------------------------------------

// tile bookkeeping the decoration passes need: open ground, wall-adjacent
// ground and doorway throats, all resolved once
function bakeApi(world, wall) {
  const W = world.W;
  const H = world.H;
  const open = [];
  const edge = [];
  const door = [];
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (wall(tx, ty)) continue;
      open.push(tx, ty);
      const n = wall(tx, ty - 1);
      const s = wall(tx, ty + 1);
      const e = wall(tx + 1, ty);
      const w = wall(tx - 1, ty);
      if (n || s || e || w) edge.push(tx, ty, (e ? 1 : 0) - (w ? 1 : 0), (s ? 1 : 0) - (n ? 1 : 0));
      if ((n && s) || (e && w)) door.push(tx, ty);
    }
  }
  const walk = (n, rand, fn) => {
    if (!open.length) return;
    for (let i = 0; i < n; i++) {
      const k = ((rand() * (open.length / 2)) | 0) * 2;
      fn((open[k] + 0.5) * TILE + (rand() - 0.5) * TILE, (open[k + 1] + 0.5) * TILE + (rand() - 0.5) * TILE);
    }
  };
  // marks banked against a wall: pushed half a tile into it, so the floor clip
  // shears them off along the wall line and they read as drift, not blobs
  const bank = (n, rand, fn) => {
    if (!edge.length) return;
    for (let i = 0; i < n; i++) {
      const k = ((rand() * (edge.length / 4)) | 0) * 4;
      const nx = edge[k + 2];
      const ny = edge[k + 3];
      fn(
        (edge[k] + 0.5) * TILE + nx * TILE * 0.5 + (rand() - 0.5) * TILE * 0.5,
        (edge[k + 1] + 0.5) * TILE + ny * TILE * 0.5 + (rand() - 0.5) * TILE * 0.5,
        nx,
        ny
      );
    }
  };
  return {
    W,
    H,
    wall,
    rooms: world.rooms || [],
    // n marks scattered over open ground / hugging the walls
    spots: (n, rand, fn) => walk(n, rand, fn),
    hugWalls: (n, rand, fn) => bank(n, rand, fn),
    doors: (fn) => {
      for (let i = 0; i < door.length; i += 2) fn(door[i], door[i + 1]);
    },
  };
}

// clip to open ground, merging each row into runs so the path stays small
function clipFloor(c, api) {
  c.beginPath();
  for (let ty = 0; ty < api.H; ty++) {
    let run = -1;
    for (let tx = 0; tx <= api.W; tx++) {
      const open = tx < api.W && !api.wall(tx, ty);
      if (open && run < 0) run = tx;
      else if (!open && run >= 0) {
        c.rect(run * TILE, ty * TILE, (tx - run) * TILE, TILE);
        run = -1;
      }
    }
  }
  c.clip();
}

// pre-render the static floor + walls to an offscreen canvas. The canvas is
// WALL_H taller than the world and translated down by that much, so extruded
// wall tops on the first row aren't clipped; draw it at -cv.offsetY.
export function bakeWorld(world) {
  const name = (world.params && world.params.biome) || 'ruins';
  const pal = BIOMES[name] || BIOMES.ruins;
  const mat = MAT[name] || MAT.ruins;
  const cv = T.canv(world.W * TILE, world.H * TILE + WALL_H);
  cv.offsetY = WALL_H;
  const c = cv.getContext('2d');
  c.translate(0, WALL_H);
  c.fillStyle = pal.void;
  c.fillRect(0, -WALL_H, cv.width, cv.height);

  const W = world.W;
  const H = world.H;
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || world.grid[y * W + x] === 1;
  const api = bakeApi(world, wall);

  // one stream for the whole bake, so an address always mixes the same material
  const rand = makeRng('bake:' + name + ':' + ((world.params && world.params.seedStr) || 'sgc'));
  const floorTile = mat.floor(rand, pal);
  const wallTile = mat.wall(rand, pal);

  // floor: the material pattern under all open ground, per-tile break-up, the
  // biome's decoration, then contact shading where the walls meet the ground
  c.save();
  clipFloor(c, api);
  c.fillStyle = T.pattern(c, floorTile, pal.floorA);
  c.fillRect(0, 0, cv.width, H * TILE);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (wall(tx, ty)) continue;
      const h = T.hash2(tx, ty, 3);
      c.fillStyle = T.rgba(h > 0.5 ? pal.hi : pal.lo, Math.abs(h - 0.5) * 0.16);
      c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  if (pal.gridLines) {
    c.strokeStyle = pal.grid;
    c.lineWidth = 1;
    c.beginPath();
    for (let tx = 0; tx <= W; tx++) {
      c.moveTo(tx * TILE, 0);
      c.lineTo(tx * TILE, H * TILE);
    }
    for (let ty = 0; ty <= H; ty++) {
      c.moveTo(0, ty * TILE);
      c.lineTo(W * TILE, ty * TILE);
    }
    c.stroke();
  }
  if (mat.deco) mat.deco(c, world, rand, pal, api);
  // the ground sits in shade; wall tops get the light back in paintWalls, and
  // that one stop of separation is what stops the map reading as flat blocks
  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.fillRect(0, 0, cv.width, H * TILE);
  // ambient occlusion where the ground runs into a wall
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (wall(tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (wall(tx, ty - 1)) T.edgeAO(c, x, y, TILE, 0, 12, '#000000');
      if (wall(tx + 1, ty)) T.edgeAO(c, x, y, TILE, 1, 9, '#000000');
      if (wall(tx, ty + 1)) T.edgeAO(c, x, y, TILE, 2, 7, '#000000');
      if (wall(tx - 1, ty)) T.edgeAO(c, x, y, TILE, 3, 9, '#000000');
    }
  }
  c.restore();

  paintWalls(c, world, pal, mat, wallTile, {});

  // a second, transparent copy of the wall mass carrying the lit trim. The
  // renderer paints tile bands of it back over the fog so walls next to ground
  // you can actually see stay lit — and fades them where they'd hide the player.
  const wl = T.canv(cv.width, cv.height);
  const wc = wl.getContext('2d');
  wc.translate(0, WALL_H);
  paintWalls(wc, world, pal, mat, wallTile, { glow: true, shadow: true });
  cv.walls = wl;
  return cv;
}

// extruded wall mass: tile tops lifted WALL_H, a lit front face wherever open
// floor lies to the south, and thin shaded faces on exposed east/west edges.
// Everything a tile draws must stay inside its own column and within
// [ty*TILE - WALL_H, ty*TILE + TILE + 11] — game.js re-blits exactly that band.
function paintWalls(c, world, pal, mat, wallTile, opt) {
  const W = world.W;
  const H = world.H;
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || world.grid[y * W + x] === 1;
  const touches = (tx, ty) => {
    if (!wall(tx, ty)) return false;
    for (let k = 0; k < 8; k++) {
      const ox = [1, -1, 0, 0, 1, 1, -1, -1][k];
      const oy = [0, 0, 1, -1, 1, -1, 1, -1][k];
      if (!wall(tx + ox, ty + oy)) return true;
    }
    return false;
  };
  const side = T.mix(pal.wall, pal.void, 0.5);
  const cap = T.mix(pal.glow, '#ffffff', 0.3);
  const faceTop = T.mix(pal.wall, pal.glow, pal.outline === 'rim' ? 0.28 : 0.55);
  const faceBot = T.mix(pal.wall, pal.void, 0.9);

  // tops — also filled one tile deep behind a lit tile so the lift leaves no
  // gap. The material pattern is world-aligned, so it runs on across tiles.
  c.save();
  c.beginPath();
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!wall(tx, ty)) continue;
      if (!touches(tx, ty) && !touches(tx, ty - 1)) continue;
      c.rect(tx * TILE, ty * TILE - WALL_H, TILE, TILE);
    }
  }
  c.clip();
  c.fillStyle = T.pattern(c, wallTile, pal.wall);
  c.fillRect(0, -WALL_H, W * TILE, H * TILE + WALL_H);
  // tops are the surfaces facing the light — lift them clear of the floor
  c.fillStyle = T.rgba(T.mix(pal.hi, '#ffffff', 0.35), 0.17);
  c.fillRect(0, -WALL_H, W * TILE, H * TILE + WALL_H);
  // per-tile tone jitter keeps a long run from reading as one flat slab
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!wall(tx, ty)) continue;
      const h = T.hash2(tx, ty, 7);
      c.fillStyle = T.rgba(h > 0.5 ? pal.hi : '#000000', Math.abs(h - 0.5) * 0.2);
      c.fillRect(tx * TILE, ty * TILE - WALL_H, TILE, TILE);
      // the top lip catches light where the mass ends
      if (!wall(tx, ty - 1)) {
        c.fillStyle = T.rgba(pal.hi, 0.14);
        c.fillRect(tx * TILE, ty * TILE - WALL_H, TILE, 2);
      }
      if (wall(tx, ty + 1) && !wall(tx, ty + 2)) {
        c.fillStyle = 'rgba(0,0,0,0.16)';
        c.fillRect(tx * TILE, ty * TILE - WALL_H, TILE, TILE);
      }
    }
  }
  c.restore();

  // side faces on east/west exposures — a sliver of shade that reads as depth
  c.fillStyle = side;
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!wall(tx, ty)) continue;
      const y = ty * TILE - WALL_H;
      if (!wall(tx - 1, ty)) c.fillRect(tx * TILE, y, 5, TILE);
      if (!wall(tx + 1, ty)) c.fillRect((tx + 1) * TILE - 5, y, 5, TILE);
    }
  }

  // front faces: the wall's south side, standing on the floor tile below it
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!wall(tx, ty) || wall(tx, ty + 1)) continue;
      const x = tx * TILE;
      const fy = (ty + 1) * TILE - WALL_H;
      const grd = c.createLinearGradient(0, fy, 0, fy + WALL_H);
      grd.addColorStop(0, faceTop);
      grd.addColorStop(1, faceBot);
      c.fillStyle = grd;
      c.fillRect(x, fy, TILE, WALL_H);
      if (opt.shadow) {
        // contact shadow the wall drops onto the floor it stands on
        const sh = c.createLinearGradient(0, fy + WALL_H, 0, fy + WALL_H + 11);
        sh.addColorStop(0, 'rgba(0,0,0,0.5)');
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = sh;
        c.fillRect(x, fy + WALL_H, TILE, 11);
      }
      // the biome's own treatment. Clipped to this tile's own column and no
      // lower than the band game.js re-blits, so nothing is ever half-drawn
      if (mat.face) {
        c.save();
        c.beginPath();
        c.rect(x, fy - 1, TILE, WALL_H + 10);
        c.clip();
        mat.face(c, x, fy, tx, ty, pal);
        c.restore();
      }
      c.fillStyle = cap;
      c.fillRect(x, fy, TILE, 2);
    }
  }

  if (!opt.glow) return;

  // the lifted silhouette: a hard neon rim for built worlds, a soft light
  // catch along the top edge for the ones that are meant to read as natural
  c.save();
  c.strokeStyle = pal.edge;
  c.lineCap = 'round';
  if (pal.outline === 'rim') {
    c.lineWidth = 1.5;
    c.globalAlpha = 0.8;
    c.beginPath();
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (!wall(tx, ty) || wall(tx, ty - 1)) continue;
        c.moveTo(tx * TILE, ty * TILE - WALL_H + 0.5);
        c.lineTo((tx + 1) * TILE, ty * TILE - WALL_H + 0.5);
      }
    }
    c.stroke();
  } else {
    c.lineWidth = 2;
    c.shadowBlur = 8;
    c.shadowColor = pal.glow;
    c.beginPath();
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (world.grid[ty * W + tx] !== 1) continue;
        const x = tx * TILE;
        const y = ty * TILE - WALL_H;
        if (!wall(tx, ty - 1)) {
          c.moveTo(x, y);
          c.lineTo(x + TILE, y);
        }
        if (!wall(tx, ty + 1)) {
          // the base of the front face, down on the floor
          c.moveTo(x, y + TILE + WALL_H);
          c.lineTo(x + TILE, y + TILE + WALL_H);
        }
        if (!wall(tx - 1, ty)) {
          c.moveTo(x, y);
          c.lineTo(x, y + TILE + (wall(tx, ty + 1) ? 0 : WALL_H));
        }
        if (!wall(tx + 1, ty)) {
          c.moveTo(x + TILE, y);
          c.lineTo(x + TILE, y + TILE + (wall(tx, ty + 1) ? 0 : WALL_H));
        }
      }
    }
    c.stroke();
  }
  c.restore();
}
