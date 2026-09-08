import { makeRng, rngHelpers } from './rng.js';

export const TILE = 34;
export const ROOM_W = 15; // tiles
export const ROOM_H = 11; // tiles

// how tall walls stand in the fake-3d bake. Purely visual: collision still uses
// the flat tile footprint. Wall tops are painted WALL_H px above their tile, so
// the baked canvas is that much taller than the world and is drawn at -WALL_H.
export const WALL_H = 16;

// visual palettes — one per world, chosen from the address hash in worldParams
export const BIOMES = {
  ruins: { void: '#0b0f16', floorA: '#141c28', floorB: '#111823', wall: '#0c1017', edge: 'rgba(130,195,255,0.55)', glow: '#3f7fb5', grid: 'rgba(90,140,190,0.05)' },
  ice: { void: '#080e14', floorA: '#152430', floorB: '#111e28', wall: '#0a1218', edge: 'rgba(150,225,240,0.6)', glow: '#5fb8cc', grid: 'rgba(120,190,210,0.06)' },
  foundry: { void: '#100b08', floorA: '#1c1611', floorB: '#16110d', wall: '#0f0a07', edge: 'rgba(255,180,110,0.5)', glow: '#b5713f', grid: 'rgba(190,130,80,0.05)' },
  hive: { void: '#0d0812', floorA: '#1a1222', floorB: '#150e1c', wall: '#0e0812', edge: 'rgba(210,150,255,0.5)', glow: '#8f4fb5', grid: 'rgba(160,110,190,0.05)' },
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

// blend two hex colours — lit caps and shaded side faces derive from the palette
function mixHex(a, b, t) {
  const rgb = (h) => {
    const s = h.replace('#', '');
    const n = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const ca = rgb(a);
  const cb = rgb(b);
  return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`;
}

// pre-render the static floor + walls to an offscreen canvas. The canvas is
// WALL_H taller than the world and translated down by that much, so extruded
// wall tops on the first row aren't clipped; draw it at -cv.offsetY.
export function bakeWorld(world) {
  const pal = BIOMES[(world.params && world.params.biome) || 'ruins'] || BIOMES.ruins;
  const cv = document.createElement('canvas');
  cv.width = world.W * TILE;
  cv.height = world.H * TILE + WALL_H;
  cv.offsetY = WALL_H;
  const c = cv.getContext('2d');
  c.translate(0, WALL_H);
  c.fillStyle = pal.void;
  c.fillRect(0, -WALL_H, cv.width, cv.height);

  const W = world.W;
  const H = world.H;
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || world.grid[y * W + x] === 1;

  // floor: subtle checker only under open ground
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (wall(tx, ty)) continue;
      c.fillStyle = (tx + ty) & 1 ? pal.floorA : pal.floorB;
      c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }

  // faint grid, clipped to the open ground so walls stay clean
  c.save();
  c.beginPath();
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!wall(tx, ty)) c.rect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  c.clip();
  c.strokeStyle = pal.grid;
  c.lineWidth = 1;
  for (let tx = 0; tx <= W; tx++) {
    c.beginPath();
    c.moveTo(tx * TILE, 0);
    c.lineTo(tx * TILE, cv.height);
    c.stroke();
  }
  for (let ty = 0; ty <= H; ty++) {
    c.beginPath();
    c.moveTo(0, ty * TILE);
    c.lineTo(cv.width, ty * TILE);
    c.stroke();
  }
  c.restore();

  paintWalls(c, world, pal, {});

  // a second, transparent copy of the wall mass carrying the lit trim. The
  // renderer paints tile bands of it back over the fog so walls next to ground
  // you can actually see stay lit — and fades them where they'd hide the player.
  const wl = document.createElement('canvas');
  wl.width = cv.width;
  wl.height = cv.height;
  const wc = wl.getContext('2d');
  wc.translate(0, WALL_H);
  paintWalls(wc, world, pal, { glow: true, shadow: true });
  cv.walls = wl;
  return cv;
}

// extruded wall mass: tile tops lifted WALL_H, a lit front face wherever open
// floor lies to the south, and thin shaded faces on exposed east/west edges
function paintWalls(c, world, pal, opt) {
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
  const side = mixHex(pal.wall, pal.void, 0.5);
  const cap = mixHex(pal.glow, '#ffffff', 0.3);
  const faceTop = mixHex(pal.wall, pal.glow, 0.55);
  const faceBot = mixHex(pal.wall, pal.void, 0.9);

  // tops — also filled one tile deep behind a lit tile so the lift leaves no gap.
  // per-tile jitter keeps a long wall run from reading as one flat slab.
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!wall(tx, ty)) continue;
      if (!touches(tx, ty) && !touches(tx, ty - 1)) continue;
      const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
      c.fillStyle = mixHex(pal.wall, pal.glow, 0.13 * (0.55 + (n % 23) / 23));
      c.fillRect(tx * TILE, ty * TILE - WALL_H, TILE, TILE);
    }
  }

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
      c.fillStyle = cap;
      c.fillRect(x, fy, TILE, 2);
      if (opt.shadow) {
        // contact shadow the wall drops onto the floor it stands on
        const sh = c.createLinearGradient(0, fy + WALL_H, 0, fy + WALL_H + 11);
        sh.addColorStop(0, 'rgba(0,0,0,0.5)');
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = sh;
        c.fillRect(x, fy + WALL_H, TILE, 11);
      }
    }
  }

  if (!opt.glow) return;

  // glowing outline along the lifted silhouette
  c.save();
  c.strokeStyle = pal.edge;
  c.lineWidth = 2;
  c.lineCap = 'round';
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
  c.restore();
}
