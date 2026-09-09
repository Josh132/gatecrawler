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
  // System Lord's hall: gilded ashlar, gold hieroglyph friezes, torch-warm
  temple: {
    void: '#0a0704', floorA: '#6b4e2a', floorB: '#4a3620', wall: '#4f3a21',
    edge: 'rgba(255,214,140,0.6)', glow: '#e0a340', grid: 'rgba(210,170,110,0.05)',
    lo: '#1d1409', hi: '#b58a4c', accent: '#f0d47a', accent2: '#ff8a3c',
    outline: 'rim', ambient: '#e8bc76', dust: '#e6cfa0', fog: '#0a0705',
  },
  // Ra's pyramid interior: deep red-ochre stone, heavy gold banding so the
  // gilt reads hot against a darker ground; sun-disc in every chamber
  pyramid: {
    void: '#080401', floorA: '#5f4320', floorB: '#39280f', wall: '#442f13',
    edge: 'rgba(255,222,150,0.7)', glow: '#f0b64a', grid: 'rgba(230,190,120,0.05)',
    lo: '#150c04', hi: '#a9803e', accent: '#f8dc8c', accent2: '#ff6a22',
    outline: 'rim', ambient: '#eab870', dust: '#e6cc98', fog: '#080402',
  },
  // overgrown outdoor ruins: cracked flagstone, moss, vines, dappled light
  jungle: {
    void: '#0b130a', sky: '#5f7248', floorA: '#44532f', floorB: '#334025', wall: '#3a4432',
    edge: 'rgba(180,245,160,0.4)', glow: '#4e8a3a', grid: 'rgba(140,190,120,0.05)',
    lo: '#1a2412', hi: '#7d9560', accent: '#8fd45a', accent2: '#3f6b8a',
    outline: 'rim', outdoor: true, perimeter: 'treeline',
    foliage: '#2f5626', foliageHi: '#78ad46', rock: '#6b6f5a', rockDark: '#2a2c1e', treeTrunk: '#3c3220',
    ambient: '#bfe894', dust: '#c6ec9a', fog: '#0a140b',
  },
  // open canyon outpost: rippled sand, strata mesas, bleached bone light
  desert: {
    void: '#2a2013', sky: '#e6cf9c', floorA: '#8a6f47', floorB: '#6b5537', wall: '#6b5333',
    edge: 'rgba(255,238,190,0.42)', glow: '#c9a35e', grid: 'rgba(220,190,140,0.05)',
    lo: '#544024', hi: '#d4b884', accent: '#f4e0b2', accent2: '#8a6a3a',
    outline: 'rim', outdoor: true, perimeter: 'cliff',
    foliage: '#6e5f38', foliageHi: '#9a8654', rock: '#9a8058', rockDark: '#3a2a14', treeTrunk: '#5a4a30',
    ambient: '#ffe6b0', dust: '#efd8a8', fog: '#120c06',
  },
  // wide open savannah: dry gold grass, acacia stands, granite kopjes
  savannah: {
    void: '#161307', sky: '#cabb8a', floorA: '#9c8a4c', floorB: '#7a6c3a', wall: '#6f6338',
    edge: 'rgba(255,240,190,0.4)', glow: '#c9b25e', grid: 'rgba(220,200,140,0.05)',
    lo: '#3f3418', hi: '#cdbb7e', accent: '#f0e0a4', accent2: '#c8863a',
    outline: 'rim', outdoor: true, perimeter: 'treeline',
    foliage: '#6f7a3a', foliageHi: '#aab060', rock: '#9a8f7c', rockDark: '#3e372c', treeTrunk: '#4a3c28',
    ambient: '#ffe8b0', dust: '#ecdca0', fog: '#0c0a05',
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

  // a deterministic slice of rooms grow into one unused neighbour cell, turning
  // into a 2x1 hall. Purely additive floor — the room graph, every doorway and
  // the perimeter are untouched, so connectivity can only improve. Runs on its
  // own rng stream so interior layouts downstream aren't shifted by the roll.
  {
    const HR = rngHelpers(makeRng('halls:' + params.seedStr));
    const roomKeys = new Set(rooms.map((r) => r.gx + ',' + r.gy));
    const claimed = new Set();
    const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const r of rooms) {
      if (r.kind !== 'normal' && r.kind !== 'dhd') continue;
      if (!HR.chance(r.kind === 'dhd' ? 0.5 : 0.22)) continue;
      for (const [dx, dy] of HR.shuffle(dirs4)) {
        const nx = r.gx + dx;
        const ny = r.gy + dy;
        if (nx < 0 || ny < 0 || nx >= roomsWide || ny >= roomsHigh) continue;
        const k = nx + ',' + ny;
        if (roomKeys.has(k) || claimed.has(k)) continue;
        claimed.add(k);
        r.big = dx !== 0 ? 'wide' : 'tall';
        const ex = nx * ROOM_W;
        const ey = ny * ROOM_H;
        for (let y = 1; y < ROOM_H - 1; y++) {
          for (let x = 1; x < ROOM_W - 1; x++) grid[at(ex + x, ey + y)] = 0;
        }
        // open the shared divider wall so the two cells read as one room
        if (dx !== 0) {
          const bx = dx > 0 ? r.ox + ROOM_W - 1 : r.ox;
          for (let y = 1; y < ROOM_H - 1; y++) {
            grid[at(bx, r.oy + y)] = 0;
            grid[at(bx + dx, r.oy + y)] = 0;
          }
        } else {
          const by = dy > 0 ? r.oy + ROOM_H - 1 : r.oy;
          for (let x = 1; x < ROOM_W - 1; x++) {
            grid[at(r.ox + x, by)] = 0;
            grid[at(r.ox + x, by + dy)] = 0;
          }
        }
        const rx = Math.min(r.ox, ex);
        const ry = Math.min(r.oy, ey);
        r.rectPx = {
          x: rx * TILE, y: ry * TILE,
          w: (dx !== 0 ? ROOM_W * 2 : ROOM_W) * TILE,
          h: (dy !== 0 ? ROOM_H * 2 : ROOM_H) * TILE,
        };
        break;
      }
    }
  }

  // carve doorways between grid-adjacent rooms (the 2-tile shared wall).
  // outdoor worlds get a wider 5-tile gap so the treeline reads as a path.
  const bdef = BIOMES[params.biome] || BIOMES.ruins;
  const outdoor = !!bdef.outdoor;
  const DW = outdoor ? 2 : 1;
  const byKey = new Map(rooms.map((r) => [r.gx + ',' + r.gy, r]));
  for (const r of rooms) {
    const right = byKey.get(r.gx + 1 + ',' + r.gy);
    const down = byKey.get(r.gx + ',' + (r.gy + 1));
    if (right) {
      const y0 = r.oy + (ROOM_H >> 1);
      for (let k = -DW; k <= DW; k++) {
        grid[at(r.ox + ROOM_W - 1, y0 + k)] = 0;
        grid[at(r.ox + ROOM_W, y0 + k)] = 0;
      }
    }
    if (down) {
      const x0 = r.ox + (ROOM_W >> 1);
      for (let k = -DW; k <= DW; k++) {
        grid[at(x0 + k, r.oy + ROOM_H - 1)] = 0;
        grid[at(x0 + k, r.oy + ROOM_H)] = 0;
      }
    }
  }

  // give each room an interior layout — cover, sightlines and feel vary while
  // the room-graph itself is untouched. Doorway lanes (centre row/col ±1) and
  // the centre prop tile always stay clear.
  // props: tiles that are grid=1 (block sight + shots) but bake as a tree, rock,
  // obelisk or brazier rather than stone. bakeWorld reads room.props.
  const jaffaHall = params.biome === 'temple' || params.biome === 'pyramid';
  for (const r of rooms) {
    r.props = [];
    if (r.kind === 'gate') continue;
    const cxT = r.ox + (ROOM_W >> 1);
    const cyT = r.oy + (ROOM_H >> 1);
    const clear = (px, py) =>
      (Math.abs(px - cxT) <= 1 && Math.abs(py - cyT) <= 1) || px === cxT || py === cyT;
    const inRoom = (px, py) =>
      px > r.ox && px < r.ox + ROOM_W - 1 && py > r.oy && py < r.oy + ROOM_H - 1;
    const put = (px, py) => {
      if (inRoom(px, py) && !clear(px, py)) grid[at(px, py)] = 1;
    };
    const prop = (px, py, kind) => {
      if (inRoom(px, py) && !clear(px, py) && grid[at(px, py)] === 0) {
        grid[at(px, py)] = 1;
        r.props.push({ tx: px, ty: py, kind });
      }
    };
    // stricter guard for the newer built-interior shapes: keeps the whole
    // 3-wide centre cross open, so every DW=1 doorway lane stays clear no
    // matter how the cover is drawn.
    const lane = (px, py) => Math.abs(px - cxT) <= 1 || Math.abs(py - cyT) <= 1;
    const put2 = (px, py) => {
      if (inRoom(px, py) && !lane(px, py)) grid[at(px, py)] = 1;
    };

    if (outdoor) {
      // open-air layouts: scattered trees & boulders that are real cover
      const rockBias = params.biome === 'desert';
      const woody = () => (R.chance(rockBias ? 0.28 : 0.82) ? 'tree' : 'rock');
      const dens = params.biome === 'savannah' ? 0.65 : 1;
      const shape = r.kind === 'dhd'
        ? R.pick(['clearing', 'open'])
        : R.pick(['open', 'grove', 'grove', 'boulders', 'clearing', 'treeline']);
      r.shape = shape;
      if (shape === 'open') {
        const n = Math.round(R.int(2, 4) * dens);
        for (let i = 0; i < n; i++) prop(r.ox + R.int(3, ROOM_W - 4), r.oy + R.int(2, ROOM_H - 3), woody());
      } else if (shape === 'grove') {
        const clusters = Math.max(2, Math.round(R.int(2, 4) * dens));
        for (let k = 0; k < clusters; k++) {
          const ax = r.ox + R.int(3, ROOM_W - 4);
          const ay = r.oy + R.int(2, ROOM_H - 3);
          const m = R.int(3, 5);
          for (let i = 0; i < m; i++) prop(ax + R.int(-1, 1), ay + R.int(-1, 1), R.chance(0.85) ? 'tree' : 'rock');
        }
      } else if (shape === 'boulders') {
        const n = Math.round(R.int(6, 10) * dens);
        for (let i = 0; i < n; i++) prop(r.ox + R.int(2, ROOM_W - 3), r.oy + R.int(2, ROOM_H - 3), R.chance(0.82) ? 'rock' : 'tree');
        const bx = r.ox + R.int(3, ROOM_W - 5);
        const by = r.oy + R.int(3, ROOM_H - 5);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) prop(bx + dx, by + dy, 'rock');
      } else if (shape === 'clearing') {
        for (const ey of [r.oy + 2, r.oy + ROOM_H - 3]) {
          const n = R.int(2, 4);
          for (let i = 0; i < n; i++) prop(r.ox + R.int(2, ROOM_W - 3), ey, woody());
        }
      } else if (shape === 'treeline') {
        const row = cyT + (R.chance(0.5) ? -2 : 2);
        for (let px = r.ox + 2; px <= r.ox + ROOM_W - 3; px++) {
          if (Math.abs(px - cxT) <= 1 || R.chance(0.3)) continue;
          prop(px, row, R.chance(0.82) ? 'tree' : 'rock');
        }
      }
    } else {
      // weighted so ~10 of 12 rooms carry real cover for the Jaffa cover-AI,
      // while doorway lanes + the centre always stay clear.
      const pool = ['open', 'open', 'pillars', 'columns', 'columns', 'rubble',
        'rubble', 'perimeter', 'cross', 'chokepoint', 'arena', 'bisected'];
      const shape = r.kind === 'dhd' ? 'bossArena' : R.pick(pool);
      r.shape = shape;
      if (shape === 'open') {
        const n = R.int(2, 4);
        for (let i = 0; i < n; i++) put(r.ox + R.int(3, ROOM_W - 4), r.oy + R.int(3, ROOM_H - 4));
      } else if (shape === 'arena') {
        // a ring of pillars around the centre + corner blocks
        for (const [dx, dy] of [[-3, -2], [0, -3], [3, -2], [-4, 0], [4, 0], [-3, 2], [0, 3], [3, 2]]) {
          put(cxT + dx, cyT + dy);
        }
        for (const [dx, dy] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) put(cxT + dx, cyT + dy);
      } else if (shape === 'bossArena') {
        // wide fighting pit for the DHD: cover only in the outer ring, so the
        // centre (pedestal + dial range) and every doorway lane stay wide open
        for (const [dx, dy] of [
          [-3, -3], [3, -3], [-3, 3], [3, 3],
          [-5, -2], [5, -2], [-5, 2], [5, 2],
          [-6, -3], [6, -3], [-6, 3], [6, 3],
        ]) put2(cxT + dx, cyT + dy);
      } else if (shape === 'pillars') {
        for (let px = r.ox + 3; px <= r.ox + ROOM_W - 4; px += 2) {
          put(px, cyT - 2);
          put(px, cyT + 2);
        }
      } else if (shape === 'columns') {
        // formal colonnade flanking a processional aisle — Jaffa hall
        const rows = R.chance(0.5) ? [cyT - 3, cyT + 3] : [cyT - 2, cyT + 2];
        for (let px = r.ox + 2; px <= r.ox + ROOM_W - 3; px += 2) {
          for (const py of rows) put2(px, py);
        }
      } else if (shape === 'rubble') {
        // scattered debris — broken cover across the floor, lanes still clear
        const n = R.int(8, 12);
        for (let i = 0; i < n; i++) put2(r.ox + R.int(2, ROOM_W - 3), r.oy + R.int(2, ROOM_H - 3));
      } else if (shape === 'perimeter') {
        // cover hugging the walls, open middle
        for (let px = r.ox + 2; px <= r.ox + ROOM_W - 3; px += 2) {
          put2(px, r.oy + 2);
          put2(px, r.oy + ROOM_H - 3);
        }
        for (let py = r.oy + 3; py <= r.oy + ROOM_H - 4; py += 2) {
          put2(r.ox + 2, py);
          put2(r.ox + ROOM_W - 3, py);
        }
      } else if (shape === 'cross') {
        // an L of cover in each quadrant — a broken plus with corner gaps
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          put2(cxT + sx * 2, cyT + sy * 2);
          put2(cxT + sx * 3, cyT + sy * 2);
          put2(cxT + sx * 2, cyT + sy * 3);
        }
      } else if (shape === 'chokepoint') {
        // one wall dividing the room; the central cross keeps a 3-tile gap
        if (R.chance(0.5)) {
          const wx = cxT + (R.chance(0.5) ? 3 : -3);
          for (let py = r.oy + 1; py < r.oy + ROOM_H - 1; py++) put2(wx, py);
        } else {
          const wy = cyT + (R.chance(0.5) ? 2 : -2);
          for (let px = r.ox + 1; px < r.ox + ROOM_W - 1; px++) put2(px, wy);
        }
      } else if (shape === 'bisected') {
        // a short wall off-centre with a wide gap kept open on the doorway row
        const wx = cxT + (R.chance(0.5) ? 3 : -3);
        for (let py = r.oy + 2; py <= r.oy + ROOM_H - 3; py++) {
          if (Math.abs(py - cyT) > 1) put(wx, py);
        }
      }

      // grand Jaffa furniture: gilt obelisks in the corners, braziers on the
      // walls — solid props that give cover and throw torch light
      if (jaffaHall) {
        const corners = R.shuffle([
          [r.ox + 2, r.oy + 2], [r.ox + ROOM_W - 3, r.oy + 2],
          [r.ox + 2, r.oy + ROOM_H - 3], [r.ox + ROOM_W - 3, r.oy + ROOM_H - 3],
        ]);
        const nOb = r.kind === 'dhd' ? 2 : R.int(0, 2);
        for (let i = 0; i < nOb && i < corners.length; i++) prop(corners[i][0], corners[i][1], 'obelisk');
        const nBr = r.kind === 'dhd' ? 4 : R.int(1, 3);
        for (let i = 0; i < nBr; i++) {
          const s = R.int(0, 3);
          let bx, by;
          if (s === 0) { bx = r.ox + R.int(3, ROOM_W - 4); by = r.oy + 2; }
          else if (s === 1) { bx = r.ox + R.int(3, ROOM_W - 4); by = r.oy + ROOM_H - 3; }
          else if (s === 2) { bx = r.ox + 2; by = r.oy + R.int(3, ROOM_H - 4); }
          else { bx = r.ox + ROOM_W - 3; by = r.oy + R.int(3, ROOM_H - 4); }
          prop(bx, by, 'brazier');
        }
      }
    }
  }

  // --- one special set-piece room per world (game.js populateWorld reads
  // room.special). Deterministic off a dedicated seed stream; only picks the
  // room and, for a vault, carves its alcove — the props are game.js's job.
  {
    const SR = rngHelpers(makeRng('special:' + params.seedStr));
    const grr = rooms.find((r) => r.kind === 'gate');
    const normals = rooms.filter((r) => r.kind === 'normal');
    const pool = normals.filter(
      (r) => !grr || Math.abs(r.gx - grr.gx) + Math.abs(r.gy - grr.gy) > 1
    );
    const list = pool.length ? pool : normals;
    if (list.length) {
      const room = SR.pick(list);
      const roll = SR.rand();
      let kind = null;
      if (params.campaignTarget) {
        // worlds that feed the active op lean toward the objective-shaped rooms
        kind = roll < 0.4 ? 'datacore' : roll < 0.7 ? 'rescue' : roll < 0.85 ? 'vault' : roll < 0.95 ? 'arena' : 'vendor';
      } else {
        kind = roll < 0.24 ? 'vault' : roll < 0.46 ? 'arena' : roll < 0.64 ? 'vendor' : roll < 0.78 ? 'datacore' : roll < 0.86 ? 'rescue' : null;
      }
      room.special = kind;
      if (kind === 'vault') {
        // carve a 3x2 (or 2x3) dead-end pocket into a wall side with no room
        const sides = SR.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        for (const [sx, sy] of sides) {
          if (byKey.get(room.gx + sx + ',' + (room.gy + sy))) continue;
          const cxT = room.ox + (ROOM_W >> 1);
          const cyT = room.oy + (ROOM_H >> 1);
          let ax, ay, aw, ah, mx, my;
          if (sx === 1) { aw = 2; ah = 3; ax = room.ox + ROOM_W; ay = cyT - 1; mx = room.ox + ROOM_W - 1; my = cyT; }
          else if (sx === -1) { aw = 2; ah = 3; ax = room.ox - 2; ay = cyT - 1; mx = room.ox; my = cyT; }
          else if (sy === 1) { aw = 3; ah = 2; ax = cxT - 1; ay = room.oy + ROOM_H; mx = cxT; my = room.oy + ROOM_H - 1; }
          else { aw = 3; ah = 2; ax = cxT - 1; ay = room.oy - 2; mx = cxT; my = room.oy; }
          if (ax < 1 || ay < 1 || ax + aw > W - 1 || ay + ah > H - 1) continue;
          for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) grid[at(ax + x, ay + y)] = 0;
          grid[at(mx, my)] = 0; // mouth into the room interior
          room.alcove = {
            x: ax * TILE, y: ay * TILE, w: aw * TILE, h: ah * TILE,
            cx: (ax + aw / 2) * TILE, cy: (ay + ah / 2) * TILE,
          };
          break;
        }
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

  // ---- goa'uld temple: System Lord's gilded hall ------------------------
  temple: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.4, p.floorB], [0.68, p.floorA], [1, p.hi]], { cells: 4, fine: 18, fineAmt: 0.22 });
      // polished flagstone: tight courses, strong bevel, a warm sheen
      T.ashlar(c, FP, FP, rand, {
        course: TILE, minW: 30, maxW: 60, gap: 2, jitter: 0.07, bevel: 0.13,
        light: '#ffeccb', dark: '#0d0803', joint: 'rgba(18,10,3,0.5)',
      });
      overlay(c, FP, FP, rand, '#ffe6bf', { cells: 5, at: 0.62, soft: 0.16, alpha: 0.28 });
      T.cracks(c, FP, FP, rand, { count: 2, color: 'rgba(16,10,4,0.24)', step: 6, segs: 5 });
      T.splotch(c, FP, FP, rand, { count: 3, color: '#150c04', alpha: 0.12, max: 26 });
      T.speckle(c, FP, FP, rand, { count: 300, color: '#fff0c0', alpha: 0.14 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#1a1006'], [0.5, p.wall], [1, T.mix(p.wall, p.hi, 0.7)]], { cells: 3, fine: 12, fineAmt: 0.26 });
      T.ashlar(c, WP, WP, rand, {
        course: 17, minW: 22, maxW: 34, gap: 2, jitter: 0.1, bevel: 0.14,
        light: '#ffe6b0', dark: '#0a0603', joint: 'rgba(10,6,3,0.6)',
      });
      // gold leaf on the top course + a faint wash below
      T.gild(c, 0, 0, WP, 5, { gold: p.accent, hi: '#fff2cc' });
      c.fillStyle = T.rgba(p.accent, 0.1);
      c.fillRect(0, 5, WP, 12);
      T.speckle(c, WP, WP, rand, { count: 80, color: p.accent, alpha: 0.14 });
      return cv;
    },
    // gilded lintel over a gold hieroglyph frieze; some tiles carry a cartouche
    face(c, x, fy, tx, ty, p) {
      const h = T.hash2(tx, ty, 11);
      T.gild(c, x, fy + 1, TILE, 3, { gold: p.accent, hi: '#fff2cc' });
      if (h > 0.72) T.cartouche(c, x + 3, fy + 5, TILE - 6, 8, tx * 5 + ty, { gold: p.accent, fill: '#140c04', fillA: 0.55 });
      else T.frieze(c, x, fy + 5, TILE, 8, tx * 3 + ty * 7, { gold: p.accent, bg: 'rgba(0,0,0,0.42)' });
      c.fillStyle = T.rgba(p.accent, 0.22);
      c.fillRect(x, fy + 14, TILE, 1);
    },
    deco(c, world, rand, p, api) {
      const dhd = world.dhdRoom;
      for (const r of api.rooms) {
        const cx = r.centerPx.x;
        const cy = r.centerPx.y;
        // great-hall runner down the processional axis (the open centre row)
        const rw = r.rectPx.w * 0.82;
        const rh = r.rectPx.h * 0.22;
        c.fillStyle = T.rgba('#1a0f05', 0.34);
        c.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
        c.strokeStyle = T.rgba(p.accent, 0.5);
        c.lineWidth = 2.5;
        c.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
        c.strokeStyle = T.rgba('#fff2cc', 0.16);
        c.lineWidth = 1;
        c.strokeRect(cx - rw / 2 + 3, cy - rh / 2 + 3, rw - 6, rh - 6);
        // sun-disc medallion — grand in the DHD hall, still clearly gilt elsewhere
        const rad = Math.min(r.rectPx.w, r.rectPx.h) * 0.3;
        if (r === dhd) T.sunDisc(c, cx, cy, rad * 1.2, { gold: p.accent, deep: p.accent2, core: '#ffdd90', coreA: 0.5, rays: 28, line: 0.66, rayA: 0.72 });
        else T.sunDisc(c, cx, cy, rad * 0.94, { gold: p.accent, deep: p.accent2, core: '#ffce80', coreA: 0.34, rays: 20, line: 0.46, rayA: 0.52 });
      }
      // torchlight pooled at the wall bases; palace floors are swept, so only
      // a little drift lingers in the corners
      api.hugWalls(20, rand, (x, y) => T.pool(c, x, y, 60, p.accent2, 0.12));
      api.hugWalls(26, rand, (x, y) => T.pool(c, x, y, 20 + rand() * 20, '#e8cd9a', 0.08));
    },
  },

  // ---- Ra's pyramid: heavier gold, sun-disc in every chamber -------------
  pyramid: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.38, p.floorB], [0.66, p.floorA], [1, p.hi]], { cells: 4, fine: 16, fineAmt: 0.2 });
      T.ashlar(c, FP, FP, rand, {
        course: TILE, minW: 40, maxW: 70, gap: 2, jitter: 0.07, bevel: 0.15,
        light: '#ffe6bf', dark: '#0a0602', joint: 'rgba(12,7,2,0.55)',
      });
      overlay(c, FP, FP, rand, '#e8c078', { cells: 4, at: 0.64, soft: 0.16, alpha: 0.22 });
      T.splotch(c, FP, FP, rand, { count: 5, color: '#140a03', alpha: 0.2, max: 34 });
      T.speckle(c, FP, FP, rand, { count: 220, color: '#ffe6ad', alpha: 0.14 });
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#160c04'], [0.48, p.wall], [1, T.mix(p.wall, p.accent, 0.5)]], { cells: 3, fine: 11, fineAmt: 0.28 });
      T.ashlar(c, WP, WP, rand, {
        course: 17, minW: 26, maxW: 40, gap: 2, jitter: 0.09, bevel: 0.16,
        light: '#ffdfa0', dark: '#080402', joint: 'rgba(8,4,2,0.62)',
      });
      T.gild(c, 0, 0, WP, 6, { gold: p.accent, hi: '#fff4d2' });
      T.gild(c, 0, WP - 3, WP, 3, { gold: p.accent, hi: '#fff4d2' });
      c.fillStyle = T.rgba(p.accent, 0.14);
      c.fillRect(0, 6, WP, WP - 12);
      T.speckle(c, WP, WP, rand, { count: 70, color: '#fff0c8', alpha: 0.18 });
      return cv;
    },
    face(c, x, fy, tx, ty, p) {
      T.gild(c, x, fy + 1, TILE, 3, { gold: p.accent, hi: '#fff4d2' });
      T.frieze(c, x, fy + 4, TILE, 5, tx * 9 + ty, { gold: p.accent, bg: 'rgba(0,0,0,0.4)' });
      T.cartouche(c, x + 4, fy + 9, TILE - 8, 6, tx + ty * 3, { gold: p.accent, fill: '#120a03', fillA: 0.5 });
      c.fillStyle = T.rgba(p.accent2, 0.2);
      c.fillRect(x, fy + WALL_H - 2, TILE, 1);
    },
    deco(c, world, rand, p, api) {
      const dhd = world.dhdRoom;
      for (const r of api.rooms) {
        const cx = r.centerPx.x;
        const cy = r.centerPx.y;
        const rw = r.rectPx.w * 0.84;
        const rh = r.rectPx.h * 0.24;
        // a broad faint gold sun-disc worked into the floor of every chamber
        T.pool(c, cx, cy, Math.min(r.rectPx.w, r.rectPx.h) * 0.62, p.accent, 0.05);
        c.fillStyle = T.rgba('#180d04', 0.4);
        c.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
        c.strokeStyle = T.rgba(p.accent, 0.55);
        c.lineWidth = 2.5;
        c.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
        c.strokeStyle = T.rgba('#fff2cc', 0.2);
        c.lineWidth = 1;
        c.strokeRect(cx - rw / 2 + 3, cy - rh / 2 + 3, rw - 6, rh - 6);
        const rad = Math.min(r.rectPx.w, r.rectPx.h) * 0.32;
        T.sunDisc(c, cx, cy, r === dhd ? rad * 1.3 : rad * 0.9, {
          gold: p.accent, deep: p.accent2, core: '#ffe0a0',
          coreA: r === dhd ? 0.55 : 0.34, rays: r === dhd ? 32 : 22,
          line: r === dhd ? 0.7 : 0.5, rayA: r === dhd ? 0.75 : 0.55,
        });
      }
      api.hugWalls(28, rand, (x, y) => T.pool(c, x, y, 66, p.accent2, 0.14));
      api.hugWalls(22, rand, (x, y) => T.pool(c, x, y, 40, p.accent, 0.07));
    },
  },

  // ---- overgrown outdoor ruins --------------------------------------------
  jungle: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      // forest floor: leaf-mould and soil, with a few broken flags half-buried
      const c = base(cv, rand, [[0, '#141c0d'], [0.34, '#26301a'], [0.6, '#3c4a28'], [0.82, '#556438'], [1, '#7d8a52']],
        { cells: 3, fine: 15, fineAmt: 0.34 });
      T.ashlar(c, FP, FP, rand, {
        course: TILE + 8, minW: 40, maxW: 92, gap: 6, jitter: 0.06, bevel: 0.05,
        light: '#8f9a70', dark: '#0a0e06', joint: 'rgba(8,12,5,0.3)',
      });
      // most of the stone is swallowed by earth + moss
      overlay(c, FP, FP, rand, '#2c3a1c', { cells: 4, at: 0.42, soft: 0.24, alpha: 0.7 });
      overlay(c, FP, FP, rand, '#59853a', { cells: 6, at: 0.6, soft: 0.16, alpha: 0.5 });
      T.splotch(c, FP, FP, rand, { count: 7, color: '#0a1206', alpha: 0.28, max: 40 });
      T.splotch(c, FP, FP, rand, { count: 6, color: '#9fd25e', alpha: 0.16, max: 34, hard: 0.35 });
      T.speckle(c, FP, FP, rand, { count: 220, color: '#d6f28e', alpha: 0.14 });
      T.pebbles(c, FP, FP, rand, { count: 30, color: '#5c6748', shadow: '#080c05', alpha: 0.5 });
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
      // deep canopy shadow pooled across the ground, then bright shafts punching
      // through it — the contrast is what sells "under the trees, outdoors"
      api.spots(38, rand, (x, y) => T.pool(c, x, y, 40 + rand() * 90, '#050a04', 0.16));
      api.spots(80, rand, (x, y) => T.pool(c, x, y, 20 + rand() * 44, '#dcffa4', 0.09));
      api.spots(30, rand, (x, y) => T.pool(c, x, y, 10 + rand() * 22, '#ffffd0', 0.13));
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

  // ---- wide-open savannah: dry grass, acacia stands, granite kopjes ------
  savannah: {
    floor(rand, p) {
      const cv = T.canv(FP, FP);
      const c = base(cv, rand, [[0, p.lo], [0.4, p.floorB], [0.7, p.floorA], [1, p.hi]], { cells: 3, fine: 13, fineAmt: 0.34 });
      overlay(c, FP, FP, rand, '#8f8340', { cells: 4, at: 0.5, soft: 0.2, alpha: 0.5 });
      overlay(c, FP, FP, rand, '#b7ab5e', { cells: 8, at: 0.66, soft: 0.12, alpha: 0.3 });
      T.cracks(c, FP, FP, rand, { count: 4, color: 'rgba(40,30,14,0.26)', step: 7, segs: 6 });
      T.speckle(c, FP, FP, rand, { count: 300, color: '#f0e2a4', alpha: 0.16 });
      T.pebbles(c, FP, FP, rand, { count: 30, color: '#8a7f66', shadow: '#2a2212', alpha: 0.5 });
      // dry grass tufts
      c.save();
      c.strokeStyle = 'rgba(122,120,60,0.4)';
      c.lineWidth = 1;
      for (let i = 0; i < 120; i++) {
        const x = rand() * FP;
        const y = rand() * FP;
        for (let k = 0; k < 4; k++) {
          const a = -Math.PI / 2 + (rand() - 0.5) * 1.4;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * (3 + rand() * 4), y + Math.sin(a) * (3 + rand() * 4));
          c.stroke();
        }
      }
      c.restore();
      return cv;
    },
    wall(rand, p) {
      const cv = T.canv(WP, WP);
      const c = base(cv, rand, [[0, '#241d10'], [0.5, p.wall], [1, T.mix(p.wall, '#d8c890', 0.5)]], { cells: 3, fine: 12, fineAmt: 0.28 });
      T.strata(c, WP, WP, rand, { min: 4, max: 12, jitter: 0.12, seam: 0.4, light: '#e0d0a0', dark: '#1a140a' });
      T.speckle(c, WP, WP, rand, { count: 120, color: '#f0e4bc', alpha: 0.12 });
      return cv;
    },
    // stacked granite boulders (kopje) rather than a dressed face
    face(c, x, fy, tx, ty, p) {
      const h = T.hash2(tx, ty, 43);
      c.fillStyle = 'rgba(24,20,10,0.5)';
      c.fillRect(x, fy + WALL_H * 0.5, TILE, WALL_H * 0.5);
      for (let i = 0; i < 3; i++) {
        const bx = x + 4 + i * 11 + h * 4;
        const br = 7 + T.hash2(tx * 3 + i, ty, 7) * 6;
        const grd = c.createLinearGradient(bx, fy + WALL_H - br, bx, fy + WALL_H);
        grd.addColorStop(0, i % 2 ? '#9a9080' : '#847a66');
        grd.addColorStop(1, '#3a3224');
        c.fillStyle = grd;
        c.beginPath();
        c.ellipse(bx, fy + WALL_H - br * 0.45, br, br * 0.82, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(30,24,14,0.5)';
        c.lineWidth = 1;
        c.stroke();
        c.fillStyle = 'rgba(255,240,200,0.16)';
        c.beginPath();
        c.ellipse(bx - br * 0.3, fy + WALL_H - br * 0.85, br * 0.4, br * 0.3, 0, 0, Math.PI * 2);
        c.fill();
      }
    },
    deco(c, world, rand, p, api) {
      // huge sun-bleached open ground + a little scrub
      api.spots(40, rand, (x, y) => T.pool(c, x, y, 40 + rand() * 70, '#fff0c0', 0.05));
      api.spots(30, rand, (x, y) => {
        c.strokeStyle = 'rgba(110,100,50,0.5)';
        c.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * (4 + rand() * 7), y + Math.sin(a) * (4 + rand() * 7));
          c.stroke();
        }
      });
      // dry litter + dust
      api.spots(90, rand, (x, y) => {
        c.fillStyle = rand() < 0.5 ? 'rgba(150,140,70,0.32)' : 'rgba(120,95,40,0.32)';
        c.beginPath();
        c.ellipse(x, y, 2.2, 1.1, rand() * 3, 0, Math.PI * 2);
        c.fill();
      });
      api.hugWalls(50, rand, (x, y) => T.pool(c, x, y, 20 + rand() * 24, '#d8c088', 0.14));
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
  const outdoor = !!pal.outdoor;
  c.fillStyle = outdoor ? (pal.sky || pal.void) : pal.void;
  c.fillRect(0, -WALL_H, cv.width, cv.height);

  const W = world.W;
  const H = world.H;
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || world.grid[y * W + x] === 1;
  const api = bakeApi(world, wall);
  // prop tiles: grid=1 (block sight/shots) but painted as tree/rock/obelisk/
  // brazier by paintProps — paintWalls skips them so no stone is drawn there
  const propSet = new Set();
  for (const r of world.rooms) {
    for (const pr of r.props || []) propSet.add(pr.ty * W + pr.tx);
  }

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
  if (outdoor) {
    // low god-rays raking across the open ground (clipped to floor)
    const rn = makeRng('ray:' + name + ':' + ((world.params && world.params.seedStr) || 'x'));
    c.save();
    c.globalCompositeOperation = 'lighter';
    const rays = 2 + ((rn() * 2) | 0);
    for (let i = 0; i < rays; i++) {
      const bx = rn() * cv.width;
      const bw = 60 + rn() * 130;
      c.save();
      c.translate(bx, 0);
      c.rotate(0.3 + rn() * 0.14);
      const g = c.createLinearGradient(0, 0, 0, H * TILE * 1.5);
      g.addColorStop(0, T.rgba(pal.ambient || '#ffe8b0', 0.1));
      g.addColorStop(1, T.rgba(pal.ambient || '#ffe8b0', 0));
      c.fillStyle = g;
      c.fillRect(-bw / 2, 0, bw, H * TILE * 1.5);
      c.restore();
    }
    c.restore();
  }
  // the ground sits in shade; wall tops get the light back in paintWalls, and
  // that one stop of separation is what stops the map reading as flat blocks.
  // outdoors under open sky the ground stays lit, so the drop is far gentler.
  c.fillStyle = outdoor ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0.2)';
  c.fillRect(0, 0, cv.width, H * TILE);
  // ambient occlusion where the ground runs into a wall
  const aoK = outdoor ? 0.5 : 1;
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (wall(tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (wall(tx, ty - 1)) T.edgeAO(c, x, y, TILE, 0, 12 * aoK, '#000000');
      if (wall(tx + 1, ty)) T.edgeAO(c, x, y, TILE, 1, 9 * aoK, '#000000');
      if (wall(tx, ty + 1)) T.edgeAO(c, x, y, TILE, 2, 7 * aoK, '#000000');
      if (wall(tx - 1, ty)) T.edgeAO(c, x, y, TILE, 3, 9 * aoK, '#000000');
    }
  }
  c.restore();

  paintWalls(c, world, pal, mat, wallTile, {}, propSet);
  paintProps(c, world, pal, {});

  // a second, transparent copy of the wall mass carrying the lit trim. The
  // renderer paints tile bands of it back over the fog so walls next to ground
  // you can actually see stay lit — and fades them where they'd hide the player.
  const wl = T.canv(cv.width, cv.height);
  const wc = wl.getContext('2d');
  wc.translate(0, WALL_H);
  paintWalls(wc, world, pal, mat, wallTile, { glow: true, shadow: true }, propSet);
  paintProps(wc, world, pal, { glow: true });
  cv.walls = wl;
  return cv;
}

// tree / rock / obelisk / brazier props. Everything varies off hash2(tx,ty)
// (never the bake rng) so the base pass and the walls-layer pass draw the
// same thing. In the walls layer canopies are drawn faint so a unit under a
// tree still reads once game.js re-blits that band over the fog.
function paintProps(c, world, pal, opt) {
  const glow = !!opt.glow;
  for (const r of world.rooms) {
    for (const pr of r.props || []) {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      const v = T.hash2(pr.tx, pr.ty, 19);
      const v2 = T.hash2(pr.tx, pr.ty, 71);
      if (!glow && (pr.kind === 'tree' || pr.kind === 'rock')) {
        // patch of ground so the prop tile isn't a hole in the sky
        c.fillStyle = T.rgba(pal.floorB || '#333', 0.9);
        c.fillRect(x, y, TILE, TILE);
      }
      if (pr.kind === 'tree') {
        T.tree(c, x + TILE * 0.5, y + TILE * 0.72, TILE * (0.6 + v * 0.28), v2, {
          trunk: pal.treeTrunk || '#463726',
          leaf: pal.foliage || '#3f6b34',
          leaf2: pal.foliageHi || '#6a9a44',
          lift: TILE * (1.05 + v * 0.7),
          alpha: glow ? 0.4 : 0.86,
        });
      } else if (pr.kind === 'rock') {
        T.boulder(c, x, y, TILE * (0.78 + v * 0.28), v2, {
          rock: pal.rock || '#8a8378',
          dark: pal.rockDark || '#3c352c',
        });
      } else if (pr.kind === 'obelisk') {
        T.obelisk(c, x, y, TILE, TILE, WALL_H, pr.tx * 7 + pr.ty, {
          stone: pal.hi || '#c9a25a',
          shade: pal.lo || '#5c3f18',
          gold: pal.accent || '#f0d182',
        });
      } else if (pr.kind === 'brazier') {
        const cx = x + TILE * 0.5;
        const cy = y + TILE * 0.55;
        c.save();
        c.fillStyle = 'rgba(0,0,0,0.26)';
        c.beginPath();
        c.ellipse(cx, y + TILE * 0.82, TILE * 0.34, TILE * 0.15, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = pal.lo || '#3a2a15';
        c.fillRect(cx - 2.5, cy, 5, TILE * 0.32);
        c.fillStyle = T.mix(pal.wall || '#4a3620', '#000000', 0.2);
        c.beginPath();
        c.ellipse(cx, cy, TILE * 0.3, TILE * 0.15, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = T.rgba(pal.accent2 || '#ff8a3c', 0.9);
        c.beginPath();
        c.ellipse(cx, cy - 1, TILE * 0.21, TILE * 0.1, 0, 0, Math.PI * 2);
        c.fill();
        T.pool(c, cx, cy - 2, TILE * (glow ? 1.1 : 1.9), pal.accent2 || '#ff8a3c', glow ? 0.13 : 0.28);
        c.fillStyle = 'rgba(255,210,122,0.8)';
        for (let i = -1; i <= 1; i++) {
          const fx = cx + i * TILE * 0.12;
          const fh = TILE * (0.28 + T.hash2(pr.tx + i, pr.ty, 5) * 0.24);
          c.beginPath();
          c.moveTo(fx - 2, cy - 1);
          c.quadraticCurveTo(fx, cy - fh, fx + 2, cy - 1);
          c.fill();
        }
        c.restore();
      }
    }
  }
}

// extruded wall mass: tile tops lifted WALL_H, a lit front face wherever open
// floor lies to the south, and thin shaded faces on exposed east/west edges.
// Everything a tile draws must stay inside its own column and within
// [ty*TILE - WALL_H, ty*TILE + TILE + 11] — game.js re-blits exactly that band.
function paintWalls(c, world, pal, mat, wallTile, opt, skip) {
  const W = world.W;
  const H = world.H;
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || world.grid[y * W + x] === 1;
  // a wall tile we actually paint stone for: real wall, not a prop tile
  const drawn = (x, y) => wall(x, y) && !(skip && skip.has(y * W + x));
  const treeline = pal.outdoor && pal.perimeter === 'treeline';
  const touches = (tx, ty) => {
    if (!wall(tx, ty)) return false;
    for (let k = 0; k < 8; k++) {
      const ox = [1, -1, 0, 0, 1, 1, -1, -1][k];
      const oy = [0, 0, 1, -1, 1, -1, 1, -1][k];
      if (!wall(tx + ox, ty + oy)) return true;
    }
    return false;
  };
  let side = T.mix(pal.wall, pal.void, 0.5);
  let cap = T.mix(pal.glow, '#ffffff', 0.3);
  let faceTop = T.mix(pal.wall, pal.glow, pal.outline === 'rim' ? 0.28 : 0.55);
  let faceBot = T.mix(pal.wall, pal.void, 0.9);
  if (treeline) {
    // the perimeter reads as a wall of forest: understory, not a stone panel
    const fol = pal.foliage || '#3f6b34';
    const folHi = T.mix(fol, pal.foliageHi || '#ffe9a0', 0.4);
    side = T.mix(fol, '#000000', 0.5);
    cap = folHi;
    faceTop = T.mix(fol, folHi, 0.45);
    faceBot = T.mix(fol, '#000000', 0.62);
  }

  // tops — also filled one tile deep behind a lit tile so the lift leaves no
  // gap. The material pattern is world-aligned, so it runs on across tiles.
  c.save();
  c.beginPath();
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!drawn(tx, ty)) continue;
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
      if (!drawn(tx, ty)) continue;
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
      if (!drawn(tx, ty)) continue;
      const y = ty * TILE - WALL_H;
      if (!wall(tx - 1, ty)) c.fillRect(tx * TILE, y, 5, TILE);
      if (!wall(tx + 1, ty)) c.fillRect((tx + 1) * TILE - 5, y, 5, TILE);
    }
  }

  // front faces: the wall's south side, standing on the floor tile below it
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (!drawn(tx, ty) || wall(tx, ty + 1)) continue;
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

  // treeline crown: soft canopy scallops bulging off every exposed top edge, so
  // the lifted mass reads as forest rather than a slab. Base pass only — the
  // walls-layer re-blit must not drop opaque canopy over the player.
  if (treeline && !opt.glow) {
    const fol = pal.foliage || '#3f6b34';
    const folHi = T.mix(fol, pal.foliageHi || '#9fd070', 0.5);
    const dk = T.mix(fol, '#000000', 0.5);
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (!drawn(tx, ty) || wall(tx, ty - 1)) continue;
        const cx = tx * TILE + TILE / 2;
        const topY = ty * TILE - WALL_H;
        // a dark understory bank first so the crown has something to sit on
        c.fillStyle = T.rgba(dk, 0.85);
        c.fillRect(tx * TILE - 1, topY + 2, TILE + 2, WALL_H);
        for (let k = 0; k < 4; k++) {
          const hh = T.hash2(tx * 4 + k, ty, 45);
          const bx = cx + (k - 1.5) * TILE * 0.3;
          const br = TILE * (0.42 + hh * 0.3);
          const by = topY + 4 - hh * 8;
          const g = c.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.15, bx, by, br);
          g.addColorStop(0, T.rgba(folHi, 0.55));
          g.addColorStop(0.5, T.rgba(fol, 0.95));
          g.addColorStop(1, T.rgba(dk, 0.95));
          c.fillStyle = g;
          c.beginPath();
          c.arc(bx, by, br, 0, Math.PI * 2);
          c.fill();
        }
        // sun catch on the upper-left of the crown
        c.strokeStyle = T.rgba(folHi, 0.45);
        c.lineWidth = 1.6;
        c.beginPath();
        c.arc(cx - 4, topY, TILE * 0.5, Math.PI * 0.95, Math.PI * 1.62);
        c.stroke();
      }
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
        if (!drawn(tx, ty) || wall(tx, ty - 1)) continue;
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
        if (world.grid[ty * W + tx] !== 1 || (skip && skip.has(ty * W + tx))) continue;
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
