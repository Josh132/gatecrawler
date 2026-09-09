// Stargate Command — the walkable home base you return to between runs.
// Six hand-authored rooms on Level 28, wired together by doorways and dressed
// with the stuff a real mountain base would have. Compatible with the play
// renderer: same grid/rooms/gateRoom contract, no combat, no fog.
import { TILE, WALL_H } from './worldgen.js';

export const HUB_W = 49; // tiles
export const HUB_H = 28;

const TAU = Math.PI * 2;
// tile -> pixel (centre of the tile)
const T = (n) => n * TILE + TILE / 2;
const P = (n) => n * TILE;

// the base plan. x0/y0..x1/y1 are inclusive floor tiles; the tiles between two
// rooms stay solid except where DOORS carves through.
export const ROOMS = [
  { kind: 'embark', name: 'EMBARKATION ROOM', sign: 'EMBARKATION', gx: 1, gy: 0, x0: 16, y0: 2, x1: 32, y1: 14 },
  { kind: 'control', name: 'CONTROL ROOM', sign: 'CONTROL', gx: 1, gy: 1, x0: 16, y0: 16, x1: 32, y1: 25 },
  { kind: 'ready', name: 'READY ROOM', sign: 'READY ROOM  ·  ARMOURY', gx: 0, gy: 0, x0: 2, y0: 2, x1: 14, y1: 12 },
  { kind: 'trophy', name: 'MEMORIAL HALL', sign: 'MEMORIAL HALL', gx: 0, gy: 1, x0: 2, y0: 14, x1: 14, y1: 25 },
  { kind: 'infirm', name: 'INFIRMARY', sign: 'INFIRMARY', gx: 2, gy: 0, x0: 34, y0: 2, x1: 46, y1: 12 },
  { kind: 'brief', name: 'BRIEFING ROOM', sign: 'BRIEFING', gx: 2, gy: 1, x0: 34, y0: 14, x1: 46, y1: 25 },
];

// doorways: inclusive tile spans carved out of the dividing walls
const DOORS = [
  { x0: 15, y0: 7, x1: 15, y1: 8, dir: 'v' }, // ready  <-> embarkation
  { x0: 33, y0: 7, x1: 33, y1: 8, dir: 'v' }, // embark <-> infirmary
  { x0: 7, y0: 13, x1: 8, y1: 13, dir: 'h' }, // ready  <-> memorial
  { x0: 39, y0: 13, x1: 40, y1: 13, dir: 'h' }, // infirm <-> briefing
  { x0: 19, y0: 15, x1: 20, y1: 15, dir: 'h' }, // embark <-> control (the stairs)
  { x0: 15, y0: 20, x1: 15, y1: 21, dir: 'v' }, // memorial <-> control
  { x0: 33, y0: 20, x1: 33, y1: 21, dir: 'v' }, // control <-> briefing
];

const GATE_T = { x: 24, y: 4 }; // the gate's tile in the embarkation room
const DIALER_T = { x: 18, y: 20 }; // dialling console in the control room

// three consoles: the Armory covers loadout AND drawing unlocked weapons
// (the old separate Requisitions console folded into it).
export const STATIONS = [
  { kind: 'armory', tx: 6, ty: 9, label: 'ARMOURY', hint: 'loadout · requisition · gear', room: 'ready' },
  { kind: 'research', tx: 29, ty: 21, label: 'RESEARCH', hint: 'tech tree', room: 'control' },
  { kind: 'infirmary', tx: 44, ty: 9, label: 'INFIRMARY', hint: 'restock supplies', room: 'infirm' },
];

export function buildHub() {
  const W = HUB_W;
  const H = HUB_H;
  const grid = new Uint8Array(W * H).fill(1);
  const at = (x, y) => y * W + x;

  const rooms = ROOMS.map((r) => {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) grid[at(x, y)] = 0;
    }
    const rectPx = { x: P(r.x0), y: P(r.y0), w: (r.x1 - r.x0 + 1) * TILE, h: (r.y1 - r.y0 + 1) * TILE };
    return {
      ...r,
      ox: r.x0,
      oy: r.y0,
      rectPx,
      centerPx: { x: rectPx.x + rectPx.w / 2, y: rectPx.y + rectPx.h / 2 },
      populated: true,
      cleared: true,
      everSeen: true,
    };
  });

  for (const d of DOORS) {
    for (let y = d.y0; y <= d.y1; y++) {
      for (let x = d.x0; x <= d.x1; x++) grid[at(x, y)] = 0;
    }
  }

  const gateCenter = { x: T(GATE_T.x), y: T(GATE_T.y) };
  const embark = rooms.find((r) => r.kind === 'embark');

  // the play renderer draws the gate at gateRoom.centerPx and hangs a light
  // there — point it at the ramp, not the middle of the floor.
  const gateRoom = {
    kind: 'gate',
    gx: embark.gx,
    gy: embark.gy,
    ox: embark.ox,
    oy: embark.oy,
    rectPx: embark.rectPx,
    centerPx: gateCenter,
    populated: true,
    cleared: true,
    everSeen: true,
  };
  // there is no DHD down here. A degenerate off-map room keeps every
  // `g.world.dhdRoom.…` read alive while drawArenaFloor's everSeen guard and
  // drawDHD both land harmlessly outside the world.
  const dhdRoom = {
    kind: 'none',
    gx: 0,
    gy: 0,
    ox: -999,
    oy: -999,
    rectPx: { x: -9999, y: -9999, w: 0, h: 0 },
    centerPx: { x: -9999, y: -9999 },
    populated: true,
    cleared: true,
    everSeen: false,
  };

  const stations = STATIONS.map((s) => ({ ...s, x: T(s.tx), y: T(s.ty) }));

  return {
    grid,
    W,
    H,
    rooms,
    gateRoom,
    dhdRoom,
    gateCenter,
    dialer: { x: T(DIALER_T.x), y: T(DIALER_T.y) },
    stations,
    isHub: true,
    // 'ruins' is worldgen's poured-concrete-and-steel set — the SGC look
    params: { biome: 'ruins', seedStr: 'sgc', address: 'SGC', threat: 0 },
  };
}

// which room contains a point (null in a doorway or a wall)
export function roomAt(world, x, y) {
  for (const r of world.rooms) {
    const R = r.rectPx;
    if (x >= R.x && x <= R.x + R.w && y >= R.y && y <= R.y + R.h) return r;
  }
  return null;
}

// ---------------------------------------------------------------- small paint helpers

function canv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

// a lit box: dark body, top highlight, thin outline
function box(c, x, y, w, h, body, edge, radius) {
  c.save();
  rr(c, x, y, w, h, radius == null ? 3 : radius);
  c.fillStyle = body;
  c.fill();
  c.strokeStyle = edge;
  c.lineWidth = 1.4;
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.07)';
  c.fillRect(x + 2, y + 2, w - 4, Math.min(4, h * 0.25));
  c.restore();
}

// a soft light pool — steep falloff so it reads as light, not fog
function pool(c, x, y, r, color, a) {
  const g = c.createRadialGradient(x, y, r * 0.04, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.32, rgba(color, a * 0.42));
  g.addColorStop(0.66, rgba(color, a * 0.12));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// diagonal hazard striping clipped to a rect
function hazard(c, x, y, w, h, a, step) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.strokeStyle = `rgba(232,163,60,${a})`;
  c.lineWidth = (step || 12) * 0.5;
  const s = step || 12;
  for (let i = -h; i < w + h; i += s) {
    c.beginPath();
    c.moveTo(x + i, y + h);
    c.lineTo(x + i + h, y);
    c.stroke();
  }
  c.restore();
}

// painted floor / wall lettering
function stencil(c, txt, x, y, size, color, a, align, rot) {
  c.save();
  c.translate(x, y);
  if (rot) c.rotate(rot);
  c.globalAlpha = a;
  c.fillStyle = color;
  c.font = `bold ${size}px monospace`;
  c.textAlign = align || 'center';
  c.textBaseline = 'middle';
  c.fillText(txt, 0, 0);
  c.restore();
}

// a run of conduit along a wall with a bracket every so often
function pipes(c, x0, y0, x1, y1, lanes, col) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  c.save();
  c.lineCap = 'round';
  for (let i = 0; i < lanes; i++) {
    const o = (i - (lanes - 1) / 2) * 4.5;
    c.strokeStyle = i % 2 ? 'rgba(120,140,160,0.30)' : rgba(col || '#5a6775', 0.4);
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(x0 + nx * o, y0 + ny * o);
    c.lineTo(x1 + nx * o, y1 + ny * o);
    c.stroke();
  }
  c.strokeStyle = 'rgba(20,26,34,0.7)';
  c.lineWidth = 2;
  const span = lanes * 4.6;
  for (let d = 26; d < len - 10; d += 62) {
    const px = x0 + (dx / len) * d;
    const py = y0 + (dy / len) * d;
    c.beginPath();
    c.moveTo(px + nx * span, py + ny * span);
    c.lineTo(px - nx * span, py - ny * span);
    c.stroke();
  }
  c.restore();
}

// riveted deck plate
function plate(c, x, y, w, h, a) {
  c.save();
  c.fillStyle = `rgba(70,82,96,${a == null ? 0.22 : a})`;
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(12,16,22,0.55)';
  c.lineWidth = 1.2;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.fillStyle = 'rgba(180,205,230,0.16)';
  for (const [rx, ry] of [[4, 4], [w - 5, 4], [4, h - 5], [w - 5, h - 5]]) {
    c.beginPath();
    c.arc(x + rx, y + ry, 1.4, 0, TAU);
    c.fill();
  }
  c.restore();
}

// steel floor grating
function grate(c, x, y, w, h) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.fillStyle = 'rgba(16,20,27,0.5)';
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(150,175,200,0.16)';
  c.lineWidth = 1;
  for (let i = 0; i <= w; i += 7) {
    c.beginPath();
    c.moveTo(x + i, y);
    c.lineTo(x + i, y + h);
    c.stroke();
  }
  c.strokeStyle = 'rgba(150,175,200,0.09)';
  for (let i = 0; i <= h; i += 14) {
    c.beginPath();
    c.moveTo(x, y + i);
    c.lineTo(x + w, y + i);
    c.stroke();
  }
  c.restore();
}

// a wall-mounted screen: bezel + glow + scan rows
function screen(c, x, y, w, h, tint) {
  box(c, x, y, w, h, 'rgba(10,16,24,0.92)', 'rgba(140,180,220,0.5)', 2);
  c.save();
  c.beginPath();
  c.rect(x + 3, y + 3, w - 6, h - 6);
  c.clip();
  c.fillStyle = rgba(tint || '#4fa8d8', 0.16);
  c.fillRect(x + 3, y + 3, w - 6, h - 6);
  c.strokeStyle = rgba(tint || '#4fa8d8', 0.14);
  c.lineWidth = 1;
  for (let i = y + 5; i < y + h - 3; i += 4) {
    c.beginPath();
    c.moveTo(x + 4, i);
    c.lineTo(x + w - 4, i);
    c.stroke();
  }
  c.restore();
}

function chair(c, x, y, ang, s) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = 'rgba(44,54,68,0.95)';
  c.strokeStyle = 'rgba(150,180,210,0.45)';
  c.lineWidth = 1.2;
  rr(c, -6 * s, -6 * s, 12 * s, 12 * s, 3);
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(74,90,110,0.95)';
  rr(c, -7 * s, -9.5 * s, 14 * s, 5 * s, 2);
  c.fill();
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- static decor bake
// Everything that never changes is painted once into an offscreen canvas the
// size of the world; renderHub blits it over the baked walls each frame.

export function buildHubDecor(world, save) {
  const off = WALL_H + 6;
  const cv = canv(world.W * TILE, world.H * TILE + off);
  cv.offsetY = off;
  const c = cv.getContext('2d');
  c.translate(0, off);
  const room = (k) => world.rooms.find((r) => r.kind === k);

  corridorsAndSigns(c, world);
  embarkDecor(c, room('embark'), world);
  controlDecor(c, room('control'), world);
  readyDecor(c, room('ready'));
  trophyDecor(c, room('trophy'), save);
  infirmDecor(c, room('infirm'));
  briefDecor(c, room('brief'));
  return cv;
}

// door frames, thresholds, overhead signage and the conduit that ties the base
// together — drawn for every room edge so the complex reads as one building
function corridorsAndSigns(c, world) {
  for (const d of DOORS) {
    const x = P(d.x0);
    const y = P(d.y0);
    const w = (d.x1 - d.x0 + 1) * TILE;
    const h = (d.y1 - d.y0 + 1) * TILE;
    // threshold plate + hazard edging on the two open sides
    plate(c, x, y, w, h, 0.16);
    if (d.dir === 'v') {
      hazard(c, x - 3, y, 4, h, 0.3, 10);
      hazard(c, x + w - 1, y, 4, h, 0.3, 10);
      pool(c, x + w / 2, y + h / 2, 46, '#8fc0e0', 0.1);
    } else {
      hazard(c, x, y - 3, w, 4, 0.3, 10);
      hazard(c, x, y + h - 1, w, 4, 0.3, 10);
      pool(c, x + w / 2, y + h / 2, 46, '#8fc0e0', 0.1);
    }
  }

  // room name stencilled on the inside of each room's north wall
  for (const r of world.rooms) {
    const R = r.rectPx;
    stencil(c, r.sign, R.x + R.w / 2, R.y - 9, 13, '#9fc4e0', 0.34);
    // painted floor border so every room has an edge
    c.save();
    c.strokeStyle = 'rgba(150,190,230,0.10)';
    c.lineWidth = 2;
    c.setLineDash([18, 12]);
    c.strokeRect(R.x + 10, R.y + 10, R.w - 20, R.h - 20);
    c.setLineDash([]);
    c.restore();
  }

  // level marker, repeated where a corridor eye would catch it
  stencil(c, 'LEVEL 28', P(16) + 8, P(2) - 9, 11, '#c9a227', 0.32, 'left');
  stencil(c, 'LEVEL 28', P(46) - 4, P(25) + 26, 11, '#c9a227', 0.22, 'right');
  stencil(c, 'NO SMOKING', P(3), P(13) + 24, 10, '#c9a227', 0.2, 'left');
  stencil(c, 'AUTHORISED PERSONNEL ONLY', P(24), P(26) - 8, 11, '#8fc0e0', 0.18);
}

// ---- 1. embarkation room -------------------------------------------------
function embarkDecor(c, r, world) {
  const R = r.rectPx;
  const gc = world.gateCenter;

  // concrete apron under the whole room, a shade lighter than the bake
  c.fillStyle = 'rgba(58,68,82,0.10)';
  c.fillRect(R.x, R.y, R.w, R.h);

  // the ramp: a trapezoid of tread plate running down from the gate
  const top = gc.y + 26;
  const bot = gc.y + 268;
  const tw = 64;
  const bw = 96;
  c.save();
  c.beginPath();
  c.moveTo(gc.x - tw, top);
  c.lineTo(gc.x + tw, top);
  c.lineTo(gc.x + bw, bot);
  c.lineTo(gc.x - bw, bot);
  c.closePath();
  c.fillStyle = 'rgba(52,62,74,0.55)';
  c.fill();
  c.save();
  c.clip();
  // tread bars
  c.strokeStyle = 'rgba(160,190,220,0.13)';
  c.lineWidth = 2;
  for (let y = top + 10; y < bot; y += 15) {
    c.beginPath();
    c.moveTo(gc.x - 110, y);
    c.lineTo(gc.x + 110, y);
    c.stroke();
  }
  hazard(c, gc.x - bw, bot - 26, bw * 2, 26, 0.26, 16);
  hazard(c, gc.x - bw, top, bw * 2, 16, 0.16, 16);
  c.restore();
  c.strokeStyle = 'rgba(232,163,60,0.4)';
  c.lineWidth = 2.5;
  c.stroke();
  c.restore();

  // side rails
  c.save();
  c.strokeStyle = 'rgba(170,200,230,0.4)';
  c.lineWidth = 3;
  c.lineCap = 'round';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(gc.x + s * (tw + 8), top + 6);
    c.lineTo(gc.x + s * (bw + 8), bot - 2);
    c.stroke();
    c.lineWidth = 1.6;
    c.strokeStyle = 'rgba(170,200,230,0.2)';
    for (let t = 0.1; t < 1; t += 0.16) {
      const x = gc.x + s * (tw + 8 + (bw - tw) * t);
      const y = top + 6 + (bot - top - 8) * t;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - s * 9, y + 3);
      c.stroke();
    }
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(170,200,230,0.4)';
  }
  c.restore();

  // painted keep-clear boundary around the ramp
  c.save();
  c.strokeStyle = 'rgba(232,163,60,0.22)';
  c.lineWidth = 3;
  c.setLineDash([22, 14]);
  c.beginPath();
  c.moveTo(gc.x - bw - 40, R.y + 16);
  c.lineTo(gc.x - bw - 40, bot + 8);
  c.lineTo(gc.x + bw + 40, bot + 8);
  c.lineTo(gc.x + bw + 40, R.y + 16);
  c.stroke();
  c.setLineDash([]);
  c.restore();
  stencil(c, 'KEEP CLEAR', gc.x - bw - 40, bot + 24, 9, '#c9a227', 0.35);

  // floor grating either side of the ramp base
  grate(c, R.x + 18, bot - 44, 96, 74);
  grate(c, R.x + R.w - 114, bot - 44, 96, 74);

  // ceiling cameras and a tannoy, watching the room
  for (const [cx2, cy2, a] of [[R.x + 26, R.y + 26, 0.7], [R.x + R.w - 26, R.y + 26, TAU / 2 - 0.7]]) {
    c.save();
    c.translate(cx2, cy2);
    c.rotate(a);
    c.fillStyle = 'rgba(30,38,48,0.95)';
    rr(c, -9, -6, 18, 12, 3);
    c.fill();
    c.strokeStyle = 'rgba(150,185,220,0.45)';
    c.lineWidth = 1.2;
    c.stroke();
    c.fillStyle = 'rgba(140,220,255,0.5)';
    c.beginPath();
    c.arc(8, 0, 2.4, 0, TAU);
    c.fill();
    c.restore();
  }

  // SGC emblem painted on the floor at the foot of the ramp
  emblem(c, gc.x, bot + 66, 44);

  // blast door on the west wall, framing the ready-room doorway
  const dy = P(7);
  c.save();
  c.fillStyle = 'rgba(26,31,38,0.9)';
  c.fillRect(R.x - 6, dy - 22, 10, TILE * 2 + 44);
  hazard(c, R.x - 6, dy - 22, 10, TILE * 2 + 44, 0.5, 9);
  c.strokeStyle = 'rgba(232,163,60,0.5)';
  c.lineWidth = 2;
  c.strokeRect(R.x - 6, dy - 22, 10, TILE * 2 + 44);
  c.restore();
  stencil(c, 'BLAST DOOR', R.x + 12, dy - 32, 10, '#c9a227', 0.4, 'left');

  // the SGC standard on the wall beside the gate
  banner(c, gc.x - 168, R.y - 4);
  banner(c, gc.x + 168, R.y - 4);

  // a MALP parked off the ramp, waiting for its next recon
  malp(c, R.x + 96, bot + 6);
  // equipment carts and cases staged along the east wall
  for (let i = 0; i < 3; i++) {
    const y = R.y + 150 + i * 74;
    box(c, R.x + R.w - 60, y, 40, 30, 'rgba(30,38,30,0.95)', 'rgba(150,175,120,0.35)', 2);
    c.fillStyle = 'rgba(201,162,39,0.25)';
    c.fillRect(R.x + R.w - 56, y + 12, 32, 3);
  }
  // benches for teams waiting on a go
  for (const bx2 of [R.x + 40, R.x + R.w - 116]) {
    box(c, bx2, R.y + 92, 76, 16, 'rgba(34,40,50,0.9)', 'rgba(130,160,190,0.28)', 3);
  }
  // cable trunk clipped down the west wall, running to the control room
  c.save();
  c.strokeStyle = 'rgba(90,110,130,0.3)';
  c.lineWidth = 5;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(R.x + 12, R.y + 130);
  c.lineTo(R.x + 12, R.y + R.h - 6);
  c.stroke();
  c.strokeStyle = 'rgba(160,190,220,0.12)';
  c.lineWidth = 1.6;
  c.stroke();
  c.strokeStyle = 'rgba(30,38,48,0.7)';
  c.lineWidth = 2;
  for (let y = R.y + 150; y < R.y + R.h - 10; y += 54) {
    c.beginPath();
    c.moveTo(R.x + 6, y);
    c.lineTo(R.x + 18, y);
    c.stroke();
  }
  c.restore();

  // conduit along the east wall + ceiling lighting pools down the room
  pipes(c, R.x + R.w - 14, R.y + 20, R.x + R.w - 14, R.y + R.h - 20, 3);
  for (let i = 0; i < 3; i++) {
    pool(c, R.x + 62, R.y + 90 + i * 130, 92, '#dce8f4', 0.10);
    pool(c, R.x + R.w - 62, R.y + 90 + i * 130, 92, '#dce8f4', 0.10);
  }
  pool(c, gc.x, gc.y + 40, 190, '#5aa8ff', 0.10);
  pool(c, gc.x, bot + 40, 150, '#cfe0f0', 0.07);

  // stairs marker down to control
  stencil(c, 'TO CONTROL  ▼', P(19) + TILE, P(15) - 8, 10, '#8fc0e0', 0.45);
  stencil(c, 'SG TEAMS ONLY', R.x + 106, R.y + R.h - 24, 10, '#7fa8c4', 0.26);
}

// the wheeled recon probe that goes through first
function malp(c, x, y) {
  c.save();
  c.translate(x, y);
  box(c, -22, -16, 44, 32, 'rgba(38,46,38,0.95)', 'rgba(160,185,130,0.45)', 3);
  c.fillStyle = 'rgba(20,26,20,0.9)';
  for (const wy of [-14, 0, 14]) {
    c.fillRect(-26, wy - 4, 6, 9);
    c.fillRect(20, wy - 4, 6, 9);
  }
  c.strokeStyle = 'rgba(190,215,240,0.5)';
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(0, -14);
  c.lineTo(0, -26);
  c.stroke();
  c.fillStyle = 'rgba(140,220,255,0.6)';
  c.beginPath();
  c.arc(0, -28, 3, 0, TAU);
  c.fill();
  c.restore();
  stencil(c, 'MALP-4', x, y + 26, 7.5, '#9fc4e0', 0.35);
}

// SGC shoulder-flash: chevron over a stylised gate ring
function banner(c, x, y) {
  c.save();
  c.translate(x, y);
  c.fillStyle = 'rgba(14,22,34,0.85)';
  rr(c, -26, 0, 52, 66, 3);
  c.fill();
  c.strokeStyle = 'rgba(150,185,220,0.4)';
  c.lineWidth = 1.5;
  c.stroke();
  c.strokeStyle = 'rgba(200,225,250,0.5)';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(0, 30, 15, 0, TAU);
  c.stroke();
  c.fillStyle = 'rgba(232,163,60,0.75)';
  c.beginPath();
  c.moveTo(0, 8);
  c.lineTo(9, 22);
  c.lineTo(-9, 22);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(200,225,250,0.55)';
  c.font = 'bold 7px monospace';
  c.textAlign = 'center';
  c.fillText('SGC', 0, 56);
  c.restore();
}

// the floor emblem: ring, chevron, starburst
function emblem(c, x, y, r) {
  c.save();
  c.translate(x, y);
  c.globalAlpha = 0.5;
  c.strokeStyle = '#8fc0e0';
  c.lineWidth = 2.5;
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.stroke();
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(0, 0, r - 7, 0, TAU);
  c.stroke();
  c.globalAlpha = 0.35;
  c.fillStyle = '#c9a227';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU - Math.PI / 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * (r - 7), Math.sin(a) * (r - 7));
    c.lineTo(Math.cos(a + 0.16) * (r - 15), Math.sin(a + 0.16) * (r - 15));
    c.lineTo(Math.cos(a - 0.16) * (r - 15), Math.sin(a - 0.16) * (r - 15));
    c.closePath();
    c.fill();
  }
  c.globalAlpha = 0.4;
  c.fillStyle = '#cfe0f0';
  c.font = 'bold 10px monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('STARGATE', 0, -8);
  c.fillText('COMMAND', 0, 6);
  c.restore();
}

// ---- 2. control room -----------------------------------------------------
function controlDecor(c, r, world) {
  const R = r.rectPx;
  c.fillStyle = 'rgba(40,52,66,0.14)';
  c.fillRect(R.x, R.y, R.w, R.h);

  // the big angled window looking up into the gate room, along the north wall
  c.save();
  const wy = R.y - 12;
  c.fillStyle = 'rgba(120,190,235,0.10)';
  c.fillRect(R.x + 22, wy, R.w - 44, 16);
  c.strokeStyle = 'rgba(170,215,245,0.5)';
  c.lineWidth = 2;
  c.strokeRect(R.x + 22, wy, R.w - 44, 16);
  // mullions, skewed so the glass reads as raked back
  c.lineWidth = 1.4;
  c.strokeStyle = 'rgba(170,215,245,0.32)';
  for (let x = R.x + 60; x < R.x + R.w - 40; x += 46) {
    c.beginPath();
    c.moveTo(x, wy + 16);
    c.lineTo(x + 7, wy);
    c.stroke();
  }
  // glare across the glass
  const gr = c.createLinearGradient(R.x + 22, wy, R.x + R.w - 22, wy + 16);
  gr.addColorStop(0, 'rgba(190,230,255,0.16)');
  gr.addColorStop(0.4, 'rgba(190,230,255,0.02)');
  gr.addColorStop(1, 'rgba(190,230,255,0.12)');
  c.fillStyle = gr;
  c.fillRect(R.x + 22, wy, R.w - 44, 16);
  c.restore();

  // gate light spilling through the glass onto the control-room floor
  const spill = c.createLinearGradient(0, R.y - 10, 0, R.y + 130);
  spill.addColorStop(0, 'rgba(120,195,255,0.22)');
  spill.addColorStop(0.45, 'rgba(120,195,255,0.07)');
  spill.addColorStop(1, 'rgba(120,195,255,0)');
  c.fillStyle = spill;
  c.fillRect(R.x + 18, R.y - 10, R.w - 36, 140);

  // safety railing along the window ledge
  c.save();
  c.strokeStyle = 'rgba(170,200,230,0.32)';
  c.lineWidth = 2.4;
  c.beginPath();
  c.moveTo(R.x + 26, R.y + 16);
  c.lineTo(R.x + R.w - 26, R.y + 16);
  c.stroke();
  c.lineWidth = 1.3;
  c.strokeStyle = 'rgba(170,200,230,0.18)';
  for (let x = R.x + 40; x < R.x + R.w - 30; x += 40) {
    c.beginPath();
    c.moveTo(x, R.y + 16);
    c.lineTo(x, R.y + 4);
    c.stroke();
  }
  c.restore();

  // a bank of dialling consoles facing the window
  for (let i = 0; i < 5; i++) {
    const x = R.x + 54 + i * 96;
    const y = R.y + 46;
    box(c, x - 34, y - 16, 68, 32, 'rgba(20,27,36,0.95)', 'rgba(130,175,215,0.45)', 3);
    screen(c, x - 28, y - 12, 56, 18, '#4fa8d8');
    // keyboard shelf
    c.fillStyle = 'rgba(70,84,100,0.5)';
    c.fillRect(x - 26, y + 16, 52, 7);
    chair(c, x, y + 44, Math.PI, 1.15);
  }
  stencil(c, 'DIALLING COMPUTER', R.x + R.w / 2, R.y + 82, 10, '#7fa8c4', 0.24);

  // a second, lower bank of analyst desks
  for (let i = 0; i < 2; i++) {
    const x = R.x + 220 + i * 130;
    const y = R.y + 190;
    box(c, x - 40, y - 14, 80, 28, 'rgba(20,27,36,0.92)', 'rgba(130,175,215,0.32)', 3);
    screen(c, x - 22, y - 10, 44, 16, '#4fa8d8');
    chair(c, x, y + 36, Math.PI, 1.15);
    c.fillStyle = 'rgba(200,225,250,0.10)';
    c.fillRect(x - 34, y + 18, 22, 8); // scattered paper
  }

  // cable channel running the length of the floor
  c.save();
  c.fillStyle = 'rgba(12,16,22,0.4)';
  c.fillRect(R.x + 26, R.y + 128, R.w - 52, 10);
  c.strokeStyle = 'rgba(150,180,210,0.14)';
  c.lineWidth = 1;
  c.strokeRect(R.x + 26, R.y + 128, R.w - 52, 10);
  for (let x = R.x + 34; x < R.x + R.w - 30; x += 16) {
    c.beginPath();
    c.moveTo(x, R.y + 128);
    c.lineTo(x, R.y + 138);
    c.stroke();
  }
  c.restore();

  // filing bank and a printer against the south-west wall
  for (let i = 0; i < 3; i++) {
    box(c, R.x + 60 + i * 40, R.y + R.h - 92, 34, 44, 'rgba(24,30,40,0.95)', 'rgba(120,160,200,0.3)', 2);
    c.fillStyle = 'rgba(180,210,235,0.14)';
    c.fillRect(R.x + 66 + i * 40, R.y + R.h - 78, 22, 2);
    c.fillRect(R.x + 66 + i * 40, R.y + R.h - 66, 22, 2);
  }
  box(c, R.x + R.w - 128, R.y + R.h - 92, 60, 40, 'rgba(26,32,42,0.95)', 'rgba(120,160,200,0.3)', 3);
  c.fillStyle = 'rgba(230,240,250,0.16)';
  c.fillRect(R.x + R.w - 118, R.y + R.h - 60, 40, 8);
  stencil(c, 'LOGS', R.x + R.w - 98, R.y + R.h - 100, 8, '#7fa8c4', 0.3);

  // status board on the south wall — the live layer writes on it
  const bx = R.x + R.w / 2 - 170;
  const by = R.y + R.h - 34;
  screen(c, bx, by, 340, 26, '#4fa8d8');

  // side racks of humming equipment
  for (let i = 0; i < 3; i++) {
    box(c, R.x + 14, R.y + 150 + i * 52, 26, 42, 'rgba(18,24,32,0.95)', 'rgba(120,160,200,0.35)', 2);
    box(c, R.x + R.w - 40, R.y + 150 + i * 52, 26, 42, 'rgba(18,24,32,0.95)', 'rgba(120,160,200,0.35)', 2);
  }
  pipes(c, R.x + 8, R.y + 16, R.x + 8, R.y + R.h - 16, 2);
  pool(c, R.x + R.w / 2, R.y + 48, 190, '#7fc8f0', 0.09);
  pool(c, R.x + 220, R.y + 190, 96, '#cfe0f0', 0.06);
  pool(c, R.x + 350, R.y + 190, 96, '#cfe0f0', 0.06);
  pool(c, world.dialer.x, world.dialer.y, 96, '#e8a33c', 0.09);
}

// ---- 5. ready room / armoury --------------------------------------------
function readyDecor(c, r) {
  const R = r.rectPx;
  c.fillStyle = 'rgba(46,54,66,0.12)';
  c.fillRect(R.x, R.y, R.w, R.h);

  // lockers along the north wall
  for (let i = 0; i < 9; i++) {
    const x = R.x + 22 + i * 44;
    box(c, x, R.y + 6, 38, 26, 'rgba(24,32,42,0.95)', 'rgba(130,165,200,0.35)', 2);
    c.fillStyle = 'rgba(150,185,215,0.3)';
    c.fillRect(x + 32, R.y + 16, 3, 7); // handle
    c.fillStyle = 'rgba(200,225,250,0.14)';
    c.fillRect(x + 6, R.y + 10, 26, 2); // vent
    c.fillRect(x + 6, R.y + 14, 26, 2);
  }
  stencil(c, 'SG-1  ·  SG-3  ·  SG-11', R.x + R.w / 2, R.y + 44, 9, '#7fa8c4', 0.24);

  // weapons bench (the armoury console sits on it) with a bench light
  const bx = R.x + 36;
  const by = R.y + 210;
  plate(c, bx - 12, by - 40, 200, 96, 0.2);
  // the lamp itself, so the light on the bench has a source
  c.save();
  c.translate(bx + 42, by - 30);
  c.fillStyle = 'rgba(36,44,54,0.95)';
  rr(c, -14, -5, 28, 10, 3);
  c.fill();
  c.strokeStyle = 'rgba(160,190,220,0.4)';
  c.lineWidth = 1.2;
  c.stroke();
  c.fillStyle = 'rgba(255,238,190,0.55)';
  c.fillRect(-11, 2, 22, 3);
  c.restore();
  pool(c, bx + 42, by - 12, 34, '#ffeebe', 0.11);
  pool(c, bx + 42, by + 16, 26, '#ffeebe', 0.05);

  // kit table: vests, mags and a helmet laid out ready to be picked up
  const kx = R.x + 240;
  const ky = R.y + 170;
  box(c, kx - 56, ky - 30, 112, 60, 'rgba(30,36,44,0.92)', 'rgba(130,160,190,0.3)', 3);
  c.save();
  c.fillStyle = 'rgba(84,100,72,0.8)';
  rr(c, kx - 46, ky - 20, 34, 40, 5);
  c.fill();
  c.fillStyle = 'rgba(150,175,120,0.25)';
  c.fillRect(kx - 40, ky - 10, 22, 4);
  c.fillRect(kx - 40, ky - 2, 22, 4);
  c.fillStyle = 'rgba(60,70,84,0.9)';
  for (let i = 0; i < 6; i++) c.fillRect(kx - 2 + (i % 3) * 9, ky - 18 + ((i / 3) | 0) * 14, 6, 11);
  c.strokeStyle = 'rgba(160,190,215,0.45)';
  c.lineWidth = 1.6;
  c.beginPath();
  c.arc(kx + 36, ky + 2, 11, 0, TAU);
  c.stroke();
  c.restore();
  pool(c, kx, ky, 84, '#dce8f4', 0.06);
  stencil(c, 'PRE-MISSION KIT', kx, ky + 42, 8, '#7fa8c4', 0.3);

  // scuffed boot prints leading toward the gate room door
  c.save();
  c.fillStyle = 'rgba(180,200,220,0.05)';
  for (let i = 0; i < 9; i++) {
    const px2 = R.x + 150 + i * 32;
    const py2 = R.y + 268 - i * 4 + (i % 2) * 11;
    c.beginPath();
    c.ellipse(px2, py2, 4.5, 2.6, 0.2, 0, TAU);
    c.fill();
  }
  c.restore();

  // duffels dumped by the wall
  for (const [dx2, dy2] of [[R.x + 60, R.y + R.h - 44], [R.x + 96, R.y + R.h - 36]]) {
    c.save();
    c.fillStyle = 'rgba(46,52,44,0.92)';
    c.beginPath();
    c.ellipse(dx2, dy2, 19, 11, 0.2, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(140,165,120,0.3)';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  }

  // gear on the west wall: vests and helmets in silhouette
  for (let i = 0; i < 4; i++) {
    const y = R.y + 70 + i * 62;
    c.save();
    c.translate(R.x + 16, y);
    c.fillStyle = 'rgba(46,56,44,0.9)';
    rr(c, -8, -12, 22, 24, 4);
    c.fill();
    c.strokeStyle = 'rgba(140,170,140,0.35)';
    c.lineWidth = 1.2;
    c.stroke();
    c.fillStyle = 'rgba(160,190,160,0.2)';
    c.fillRect(-4, -6, 14, 3);
    c.fillRect(-4, 1, 14, 3);
    c.restore();
  }
  // ammo crates stacked in the corner
  for (const [x, y] of [[R.w - 92, 30], [R.w - 92, 74], [R.w - 46, 52]]) {
    box(c, R.x + x, R.y + y, 38, 30, 'rgba(38,44,32,0.95)', 'rgba(150,175,120,0.35)', 2);
    stencil(c, '5.7', R.x + x + 19, R.y + y + 16, 8, '#c9a227', 0.4);
  }
  // a bench for kitting up
  box(c, R.x + R.w - 120, R.y + R.h - 74, 96, 22, 'rgba(30,36,44,0.9)', 'rgba(130,160,190,0.3)', 3);
  stencil(c, 'KIT UP', R.x + R.w - 72, R.y + R.h - 40, 9, '#7fa8c4', 0.28);
  pipes(c, R.x + 20, R.y + R.h - 12, R.x + R.w - 20, R.y + R.h - 12, 3);
}

// ---- 4. memorabilia / trophy hall ---------------------------------------
// each case is a pedestal with a lit vitrine; TROPHIES drives both the static
// bake and the live "case reacts as you pass" pass.
// `need` is the deepest threat the campaign has to have reached before the
// case is filled — an empty mount is a promise, and the hall fills up as the
// player pushes further out.
export const TROPHIES = [
  { key: 'zat', name: 'ZAT’NIK’TEL', tint: '#7fe8e0', need: 0 },
  { key: 'staff', name: 'STAFF WEAPON', tint: '#ff8a3c', need: 1 },
  { key: 'helm', name: 'JAFFA SERPENT HELM', tint: '#c9a227', need: 2 },
  { key: 'hand', name: 'GOA’ULD HAND DEVICE', tint: '#e8a33c', need: 4 },
  { key: 'dart', name: 'WRAITH DART FRAGMENT', tint: '#9dff6a', need: 6 },
  { key: 'repl', name: 'REPLICATOR BLOCK', tint: '#cfe8ff', need: 8 },
];

export function trophyEarned(t, save) {
  return (save && save.deepestThreat ? save.deepestThreat : 0) >= t.need;
}

// case anchors, filled in by trophyDecor and reused by the live pass
export function trophySpots(r) {
  const R = r.rectPx;
  const out = [];
  for (let i = 0; i < 3; i++) out.push({ x: R.x + 76 + i * 96, y: R.y + 34, t: TROPHIES[i] });
  for (let i = 0; i < 3; i++) out.push({ x: R.x + 76 + i * 96, y: R.y + R.h - 158, t: TROPHIES[i + 3] });
  return out;
}

function trophyDecor(c, r, save) {
  const R = r.rectPx;
  c.fillStyle = 'rgba(30,36,48,0.28)';
  c.fillRect(R.x, R.y, R.w, R.h);
  // a carpet runner down the middle of the hall
  const cy0 = R.y + 92;
  const ch = R.h - 268;
  c.fillStyle = 'rgba(50,30,26,0.42)';
  c.fillRect(R.x + 58, cy0, R.w - 156, ch);
  c.strokeStyle = 'rgba(126,84,54,0.22)';
  c.lineWidth = 6;
  c.strokeRect(R.x + 62, cy0 + 4, R.w - 164, ch - 8);
  c.strokeStyle = 'rgba(201,162,39,0.12)';
  c.lineWidth = 1.2;
  c.strokeRect(R.x + 70, cy0 + 12, R.w - 180, ch - 24);
  c.save();
  c.strokeStyle = 'rgba(150,110,80,0.10)';
  c.lineWidth = 1;
  for (let y = cy0 + 20; y < cy0 + ch - 12; y += 9) {
    c.beginPath();
    c.moveTo(R.x + 72, y);
    c.lineTo(R.x + R.w - 100, y);
    c.stroke();
  }
  c.restore();

  // a scale model of the gate on a plinth, centre of the hall
  const mx = R.x + R.w / 2;
  const my = cy0 + ch / 2;
  c.save();
  c.fillStyle = 'rgba(18,23,31,0.95)';
  rr(c, mx - 34, my - 30, 68, 60, 5);
  c.fill();
  c.strokeStyle = 'rgba(150,185,220,0.4)';
  c.lineWidth = 1.5;
  c.stroke();
  c.strokeStyle = 'rgba(180,215,245,0.6)';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(mx, my - 2, 19, 0, TAU);
  c.stroke();
  c.fillStyle = 'rgba(201,162,39,0.7)';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU - Math.PI / 2;
    c.beginPath();
    c.arc(mx + Math.cos(a) * 19, my - 2 + Math.sin(a) * 19, 1.7, 0, TAU);
    c.fill();
  }
  c.restore();
  pool(c, mx, my, 90, '#cfe0f0', 0.09);
  stencil(c, 'ORIGINAL SURVEY MODEL', mx, my + 40, 7.5, '#9fc4e0', 0.35);

  // memorial name wall on the east side — those who did not come home
  const nx = R.x + R.w - 40;
  c.save();
  c.fillStyle = 'rgba(14,18,24,0.9)';
  c.fillRect(nx - 18, R.y + 96, 32, 200);
  c.strokeStyle = 'rgba(201,162,39,0.35)';
  c.lineWidth = 1.4;
  c.strokeRect(nx - 18, R.y + 96, 32, 200);
  c.fillStyle = 'rgba(210,225,240,0.22)';
  for (let i = 0; i < 22; i++) c.fillRect(nx - 13, R.y + 106 + i * 8.6, 22, 2);
  c.restore();
  stencil(c, 'IN MEMORIAM', nx - 2, R.y + 84, 8, '#c9a227', 0.5);

  for (const s of trophySpots(r)) {
    const got = trophyEarned(s.t, save);
    // pedestal
    box(c, s.x - 30, s.y - 20, 60, 42, 'rgba(16,21,29,0.95)', got ? 'rgba(140,175,210,0.4)' : 'rgba(90,110,130,0.22)', 3);
    if (got) {
      c.save();
      c.globalAlpha = 0.9;
      drawRelic(c, s.t.key, s.x, s.y - 2, s.t.tint);
      c.restore();
    } else {
      // an empty mount waiting on a deeper sortie
      c.save();
      c.strokeStyle = 'rgba(140,170,200,0.18)';
      c.lineWidth = 1.2;
      c.setLineDash([4, 4]);
      c.strokeRect(s.x - 13, s.y - 11, 26, 20);
      c.setLineDash([]);
      c.restore();
    }
    // vitrine glass
    c.strokeStyle = got ? 'rgba(190,225,255,0.16)' : 'rgba(190,225,255,0.07)';
    c.lineWidth = 1;
    c.strokeRect(s.x - 26, s.y - 17, 52, 36);
    if (got) {
      stencil(c, s.t.name, s.x, s.y + 30, 7.5, '#9fc4e0', 0.4);
      pool(c, s.x, s.y - 4, 46, s.t.tint, 0.07);
    } else {
      stencil(c, 'THREAT ' + s.t.need + ' PENDING', s.x, s.y + 30, 7, '#5a86a8', 0.32);
    }
  }

  // framed mission photographs along the west wall — a little gallery
  for (let i = 0; i < 4; i++) {
    const y = R.y + 112 + i * 54;
    box(c, R.x + 6, y, 34, 40, 'rgba(20,16,12,0.95)', 'rgba(201,162,39,0.45)', 1);
    c.fillStyle = 'rgba(226,236,246,0.10)';
    c.fillRect(R.x + 10, y + 4, 26, 32);
    // a team lined up in front of something
    c.fillStyle = 'rgba(150,190,220,0.2)';
    c.fillRect(R.x + 10, y + 4, 26, 13);
    c.fillStyle = 'rgba(210,235,255,0.35)';
    for (let k = 0; k < 4; k++) {
      c.beginPath();
      c.arc(R.x + 15 + k * 5.5, y + 24, 1.8, 0, TAU);
      c.fill();
      c.fillRect(R.x + 13.6 + k * 5.5, y + 26, 2.8, 8);
    }
  }
  stencil(c, 'MISSION RECORD', R.x + 24, R.y + 100, 7, '#9fc4e0', 0.4);
  // the campaign plaque — the live pass writes the numbers onto it
  const px = R.x + R.w / 2;
  const py = R.y + R.h - 46;
  box(c, px - 118, py - 26, 236, 52, 'rgba(14,19,26,0.95)', 'rgba(201,162,39,0.5)', 3);
  c.strokeStyle = 'rgba(201,162,39,0.25)';
  c.lineWidth = 1;
  c.strokeRect(px - 112, py - 20, 224, 40);
  pool(c, px, py, 130, '#c9a227', 0.08);
}

// little procedural relics, all drawn at roughly 34px across
function drawRelic(c, key, x, y, tint) {
  c.save();
  c.translate(x, y);
  c.lineWidth = 1.6;
  c.strokeStyle = tint;
  c.fillStyle = rgba(tint, 0.28);
  if (key === 'hand') {
    // ribbon device: a palm plate with a red gem
    c.beginPath();
    c.moveTo(-11, 7);
    c.lineTo(-7, -8);
    c.lineTo(7, -8);
    c.lineTo(11, 7);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,90,60,0.85)';
    c.beginPath();
    c.arc(0, -1, 4, 0, TAU);
    c.fill();
  } else if (key === 'helm') {
    // serpent guard head in profile
    c.beginPath();
    c.moveTo(-10, 8);
    c.quadraticCurveTo(-12, -8, 2, -9);
    c.quadraticCurveTo(13, -8, 11, 2);
    c.lineTo(4, 8);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,220,120,0.9)';
    c.beginPath();
    c.arc(4, -3, 1.8, 0, TAU);
    c.fill();
  } else if (key === 'dart') {
    // a torn wedge of hull
    c.beginPath();
    c.moveTo(-13, 6);
    c.lineTo(-2, -9);
    c.lineTo(12, -2);
    c.lineTo(4, 8);
    c.closePath();
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(-6, 2);
    c.lineTo(5, 0);
    c.stroke();
  } else if (key === 'repl') {
    // a block of cubes with spider legs
    for (let i = 0; i < 4; i++) {
      const bx = -8 + (i % 2) * 9;
      const by = -8 + ((i / 2) | 0) * 9;
      c.fillRect(bx, by, 8, 8);
      c.strokeRect(bx, by, 8, 8);
    }
    c.beginPath();
    for (const [ax, ay] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
      c.moveTo(ax * 0.4, ay * 0.4);
      c.lineTo(ax, ay);
    }
    c.stroke();
  } else if (key === 'zat') {
    // the folded snake pistol
    c.beginPath();
    c.moveTo(-11, 6);
    c.quadraticCurveTo(0, 6, 4, -3);
    c.quadraticCurveTo(6, -9, 12, -8);
    c.stroke();
    c.lineWidth = 4;
    c.strokeStyle = rgba(tint, 0.4);
    c.beginPath();
    c.moveTo(-10, 5);
    c.lineTo(-2, 4);
    c.stroke();
    c.fillStyle = 'rgba(140,220,255,0.9)';
    c.beginPath();
    c.arc(12, -8, 2.2, 0, TAU);
    c.fill();
  } else {
    // staff weapon on a rack
    c.save();
    c.rotate(-0.35);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-14, 0);
    c.lineTo(9, 0);
    c.stroke();
    c.fillStyle = rgba(tint, 0.5);
    c.beginPath();
    c.moveTo(9, -5);
    c.lineTo(15, 0);
    c.lineTo(9, 5);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    c.strokeStyle = 'rgba(150,180,210,0.4)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(-10, 9);
    c.lineTo(-10, -6);
    c.moveTo(8, 9);
    c.lineTo(8, -6);
    c.stroke();
  }
  c.restore();
}

// ---- 6. infirmary --------------------------------------------------------
function infirmDecor(c, r) {
  const R = r.rectPx;
  c.fillStyle = 'rgba(200,225,240,0.05)';
  c.fillRect(R.x, R.y, R.w, R.h);
  // clean-room floor: a lighter, tighter tile grid
  c.save();
  c.strokeStyle = 'rgba(190,225,245,0.06)';
  c.lineWidth = 1;
  for (let x = R.x; x <= R.x + R.w; x += 34) {
    c.beginPath();
    c.moveTo(x, R.y);
    c.lineTo(x, R.y + R.h);
    c.stroke();
  }
  for (let y = R.y; y <= R.y + R.h; y += 34) {
    c.beginPath();
    c.moveTo(R.x, y);
    c.lineTo(R.x + R.w, y);
    c.stroke();
  }
  c.restore();

  // four beds down the west side, curtain rails between them
  for (let i = 0; i < 3; i++) {
    const y = R.y + 44 + i * 96;
    const x = R.x + 30;
    box(c, x, y, 46, 76, 'rgba(226,238,246,0.10)', 'rgba(180,215,240,0.4)', 4);
    c.fillStyle = 'rgba(200,230,250,0.14)';
    c.fillRect(x + 6, y + 6, 34, 22); // pillow
    c.strokeStyle = 'rgba(180,215,240,0.22)';
    c.lineWidth = 1;
    c.strokeRect(x + 4, y + 32, 38, 40); // blanket
    // curtain rail
    c.setLineDash([5, 5]);
    c.strokeStyle = 'rgba(190,225,245,0.18)';
    c.beginPath();
    c.moveTo(x - 8, y - 8);
    c.lineTo(x + 74, y - 8);
    c.stroke();
    c.setLineDash([]);
    // vitals monitor at the head of the bed
    screen(c, x + 52, y + 2, 30, 22, '#7fe8e0');
    pool(c, x + 24, y + 34, 70, '#cfe8ff', 0.06);
  }

  // supply cabinet wall (the infirmary console stands in front of it)
  for (let i = 0; i < 4; i++) {
    box(c, R.x + R.w - 40, R.y + 40 + i * 52, 30, 42, 'rgba(224,236,244,0.09)', 'rgba(180,215,240,0.35)', 2);
    c.fillStyle = 'rgba(190,225,245,0.2)';
    c.fillRect(R.x + R.w - 36, R.y + 56 + i * 52, 22, 2);
  }
  // an examination table under a surgical lamp, and a gurney parked by it
  const tx = R.x + 250;
  const ty = R.y + 150;
  box(c, tx - 34, ty - 54, 68, 108, 'rgba(226,238,246,0.12)', 'rgba(180,215,240,0.45)', 6);
  c.strokeStyle = 'rgba(180,215,240,0.25)';
  c.lineWidth = 1;
  c.strokeRect(tx - 26, ty - 44, 52, 88);
  pool(c, tx, ty, 104, '#eaf6ff', 0.13);
  c.save();
  c.strokeStyle = 'rgba(200,235,255,0.35)';
  c.lineWidth = 1.6;
  c.beginPath();
  c.arc(tx, ty, 26, 0, TAU);
  c.stroke();
  c.restore();
  // IV stands
  for (const [sx, sy] of [[tx - 52, ty - 40], [tx + 52, ty + 30]]) {
    c.strokeStyle = 'rgba(190,225,245,0.4)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(sx, sy, 5, 0, TAU);
    c.stroke();
    c.fillStyle = 'rgba(160,220,240,0.35)';
    c.fillRect(sx - 2, sy - 12, 4, 8);
  }
  // duty desk with a chart
  box(c, R.x + 208, R.y + R.h - 84, 88, 30, 'rgba(224,236,244,0.09)', 'rgba(180,215,240,0.35)', 3);
  c.fillStyle = 'rgba(235,245,252,0.18)';
  c.fillRect(R.x + 218, R.y + R.h - 76, 20, 14);
  chair(c, R.x + 252, R.y + R.h - 34, -Math.PI / 2, 1.05);

  // eyewash + sink station in the south-west corner
  const ex = R.x + 24;
  const ey = R.y + R.h - 36;
  box(c, ex, ey, 54, 26, 'rgba(210,232,244,0.10)', 'rgba(180,215,240,0.4)', 2);
  c.strokeStyle = 'rgba(120,220,240,0.5)';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(ex + 14, ey + 13, 6, 0, TAU);
  c.moveTo(ex + 40, ey + 7);
  c.lineTo(ex + 40, ey + 19);
  c.stroke();
  stencil(c, 'EYEWASH', ex + 27, ey + 34, 8, '#7fe8e0', 0.4);
  stencil(c, 'STERILE FIELD', R.x + R.w / 2 + 40, R.y + 24, 9, '#9fd0ee', 0.2);
  pipes(c, R.x + 16, R.y + 8, R.x + R.w - 16, R.y + 8, 2, '#7fe8e0');
}

// ---- 3. briefing room ----------------------------------------------------
function briefDecor(c, r) {
  const R = r.rectPx;
  c.fillStyle = 'rgba(58,46,34,0.14)';
  c.fillRect(R.x, R.y, R.w, R.h);

  // a rug under the table
  c.fillStyle = 'rgba(48,34,28,0.28)';
  c.fillRect(R.x + 56, R.y + R.h / 2 - 150, R.w - 112, 290);

  // the long table — dark walnut with a grain and an inlay edge
  const tx = R.x + R.w / 2;
  const ty = R.y + R.h / 2 - 6;
  c.save();
  c.fillStyle = 'rgba(42,28,18,0.95)';
  rr(c, tx - 62, ty - 108, 124, 216, 40);
  c.fill();
  c.save();
  c.clip();
  c.strokeStyle = 'rgba(96,66,38,0.22)';
  c.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    c.beginPath();
    c.moveTo(tx - 60 + i * 9, ty - 110);
    c.quadraticCurveTo(tx - 56 + i * 9, ty, tx - 60 + i * 9, ty + 110);
    c.stroke();
  }
  const sheen = c.createLinearGradient(tx - 62, ty - 108, tx + 62, ty + 108);
  sheen.addColorStop(0, 'rgba(255,225,170,0.07)');
  sheen.addColorStop(0.5, 'rgba(255,225,170,0.01)');
  sheen.addColorStop(1, 'rgba(255,225,170,0.05)');
  c.fillStyle = sheen;
  c.fillRect(tx - 62, ty - 108, 124, 216);
  c.restore();
  rr(c, tx - 62, ty - 108, 124, 216, 40);
  c.strokeStyle = 'rgba(201,162,39,0.35)';
  c.lineWidth = 2;
  c.stroke();
  c.strokeStyle = 'rgba(255,225,170,0.10)';
  c.lineWidth = 1;
  rr(c, tx - 52, ty - 98, 104, 196, 34);
  c.stroke();
  c.restore();
  // chairs around it
  for (let i = 0; i < 4; i++) {
    chair(c, tx - 84, ty - 66 + i * 46, 0, 1.05);
    chair(c, tx + 84, ty - 66 + i * 46, Math.PI, 1.05);
  }
  chair(c, tx, ty - 128, Math.PI / 2, 1.1);
  chair(c, tx, ty + 128, -Math.PI / 2, 1.1);
  // notepads
  c.fillStyle = 'rgba(230,235,240,0.16)';
  for (let i = 0; i < 4; i++) {
    c.fillRect(tx - 48, ty - 74 + i * 46, 16, 12);
    c.fillRect(tx + 32, ty - 74 + i * 46, 16, 12);
  }

  // wall screen: the gate network diagram
  const sx = R.x + R.w / 2 - 92;
  const sy = R.y + 8;
  screen(c, sx, sy, 184, 44, '#4fa8d8');
  netDiagram(c, sx + 6, sy + 5, 172, 34);

  // the window down into the control room, blinds half drawn — kept clear of
  // the doorway further south
  const wy0 = P(16) + 10;
  const wy1 = P(18) + 10;
  c.save();
  c.fillStyle = 'rgba(150,200,235,0.10)';
  c.fillRect(R.x - 6, wy0, 16, wy1 - wy0);
  c.strokeStyle = 'rgba(180,215,245,0.35)';
  c.lineWidth = 1.6;
  c.strokeRect(R.x - 6, wy0, 16, wy1 - wy0);
  c.strokeStyle = 'rgba(190,220,245,0.22)';
  c.lineWidth = 1.4;
  for (let y = wy0 + 4; y < wy0 + (wy1 - wy0) * 0.55; y += 5) {
    c.beginPath();
    c.moveTo(R.x - 5, y);
    c.lineTo(R.x + 9, y);
    c.stroke();
  }
  c.restore();
  stencil(c, 'CONTROL', R.x + 26, (wy0 + wy1) / 2, 8, '#9fd0ee', 0.3, 'center', Math.PI / 2);

  // a podium at the head of the room and a wall clock
  box(c, R.x + 46, R.y + 108, 30, 22, 'rgba(40,28,18,0.95)', 'rgba(201,162,39,0.35)', 3);
  c.save();
  c.translate(R.x + 44, R.y + 200);
  c.strokeStyle = 'rgba(190,215,240,0.4)';
  c.lineWidth = 1.4;
  c.beginPath();
  c.arc(0, 0, 10, 0, TAU);
  c.stroke();
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(0, -6);
  c.moveTo(0, 0);
  c.lineTo(5, 2);
  c.stroke();
  c.restore();

  // coffee station in the corner
  const cx = R.x + R.w - 56;
  const cy = R.y + R.h - 54;
  box(c, cx, cy, 44, 34, 'rgba(24,30,38,0.95)', 'rgba(140,175,210,0.35)', 3);
  c.fillStyle = 'rgba(60,36,20,0.9)';
  c.fillRect(cx + 6, cy + 8, 14, 18);
  c.strokeStyle = 'rgba(220,235,250,0.4)';
  c.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(cx + 30, cy + 10 + i * 9, 3.2, 0, TAU);
    c.stroke();
  }
  stencil(c, 'COFFEE', cx + 22, cy - 10, 8, '#c9a227', 0.4);

  // a sideboard with unit flags and a framed shot of the first team through
  const sx2 = R.x + 22;
  const sy2 = R.y + R.h - 96;
  box(c, sx2, sy2, 34, 84, 'rgba(34,26,18,0.95)', 'rgba(201,162,39,0.35)', 3);
  for (let i = 0; i < 2; i++) {
    c.save();
    c.translate(sx2 + 12 + i * 12, sy2 + 20 + i * 34);
    c.strokeStyle = 'rgba(190,215,240,0.4)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(0, 14);
    c.stroke();
    c.fillStyle = i ? 'rgba(90,120,180,0.5)' : 'rgba(170,60,55,0.5)';
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(14, -7);
    c.lineTo(0, -2);
    c.closePath();
    c.fill();
    c.restore();
  }
  // a plant, because someone always brings one
  c.save();
  c.translate(R.x + 30, R.y + 44);
  c.fillStyle = 'rgba(62,46,32,0.9)';
  c.fillRect(-7, 2, 14, 11);
  c.fillStyle = 'rgba(54,88,50,0.5)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    c.beginPath();
    c.ellipse(Math.cos(a) * 5, Math.sin(a) * 4 - 3, 4.6, 2.6, a, 0, TAU);
    c.fill();
  }
  c.restore();

  pool(c, tx, ty, 170, '#e8d8a0', 0.07);
  pool(c, R.x + R.w / 2, R.y + 30, 120, '#7fc8f0', 0.05);
  stencil(c, 'MISSION BRIEFING', R.x + R.w / 2, R.y + 70, 9, '#9fc4e0', 0.22);
}

// a small node-and-edge gate network sketch for the briefing screen
function netDiagram(c, x, y, w, h) {
  const nodes = [];
  let s = 1337;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 11; i++) nodes.push({ x: x + 8 + rnd() * (w - 16), y: y + 6 + rnd() * (h - 12) });
  c.save();
  c.strokeStyle = 'rgba(140,200,240,0.28)';
  c.lineWidth = 0.8;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[(i * 7) % nodes.length];
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }
  for (let i = 0; i < nodes.length; i++) {
    c.fillStyle = i === 0 ? 'rgba(232,163,60,0.9)' : 'rgba(190,230,255,0.6)';
    c.beginPath();
    c.arc(nodes[i].x, nodes[i].y, i === 0 ? 3 : 1.9, 0, TAU);
    c.fill();
  }
  c.restore();
}

// ---------------------------------------------------------------- live layer

const GLYPHS = '0123456789ABCDEF◆◇▲△○●∴≡';

// everything that has to move: screens, klaxon, gate shimmer, case reactions,
// the plaque numbers. Drawn every frame on top of the decor bake.
export function drawHubLive(ctx, world, t, p, save) {
  const room = (k) => world.rooms.find((r) => r.kind === k);
  const gc = world.gateCenter;

  // --- embarkation: idle wormhole shimmer inside the ring + chevron pulse
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sh = 0.5 + 0.5 * Math.sin(t * 0.9);
  for (let i = 0; i < 3; i++) {
    const rr2 = 16 + i * 13 + Math.sin(t * 1.4 + i) * 3;
    ctx.strokeStyle = `rgba(120,200,255,${0.06 + 0.05 * sh})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(gc.x, gc.y, rr2, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  // klaxon: a red rotating-beacon wash beside the ramp
  const kl = 0.5 + 0.5 * Math.sin(t * 1.6);
  const eR = room('embark').rectPx;
  for (const kx of [eR.x + 34, eR.x + eR.w - 34]) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(210,60,50,${0.05 + 0.16 * kl})`;
    ctx.beginPath();
    ctx.arc(kx, gc.y + 60, 10 + 5 * kl, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = `rgba(255,120,100,${0.35 + 0.5 * kl})`;
    ctx.beginPath();
    ctx.arc(kx, gc.y + 60, 4, 0, TAU);
    ctx.fill();
  }

  // --- control room: scrolling glyph readouts + a live status board
  const cR = room('control').rectPx;
  ctx.save();
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 5; i++) {
    const x = cR.x + 54 + i * 96 - 26;
    const y = cR.y + 46 - 12;
    for (let row = 0; row < 3; row++) {
      const off = Math.floor(t * (9 + i * 3) + row * 7);
      let s = '';
      for (let k = 0; k < 8; k++) s += GLYPHS[(off + k * 5 + i * 3 + row) % GLYPHS.length];
      ctx.fillStyle = `rgba(150,225,255,${row === 0 ? 0.6 : 0.3})`;
      ctx.fillText(s, x + 3, y + 5 + row * 6);
    }
  }
  // status board text
  const bx = cR.x + cR.w / 2;
  const by = cR.y + cR.h - 21;
  ctx.textAlign = 'center';
  ctx.font = 'bold 8px monospace';
  ctx.fillStyle = `rgba(120,255,190,${0.55 + 0.25 * Math.sin(t * 2)})`;
  ctx.fillText('IRIS CLOSED   ·   GATE IDLE   ·   ALL TEAMS ACCOUNTED FOR', bx, by);
  ctx.restore();

  // --- memorial hall: cases brighten as you walk the runner
  const tR = room('trophy');
  ctx.save();
  for (const s of trophySpots(tR)) {
    if (!trophyEarned(s.t, save)) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    const near = Math.max(0, 1 - d / 150);
    if (near <= 0.01) continue;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(s.t.tint, 0.05 + 0.12 * near);
    ctx.beginPath();
    ctx.arc(s.x, s.y - 2, 26 + 8 * near, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (near > 0.45) {
      ctx.fillStyle = `rgba(210,235,255,${(near - 0.45) * 1.6})`;
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(s.t.name, s.x, s.y + 30);
    }
  }
  ctx.restore();

  // the campaign plaque
  const pR = tR.rectPx;
  const px = pR.x + pR.w / 2;
  const py = pR.y + pR.h - 46;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(232,200,110,0.85)';
  ctx.font = 'bold 10px monospace';
  ctx.fillText('IN SERVICE OF THE STARGATE PROGRAMME', px, py - 12);
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(190,220,245,0.7)';
  ctx.fillText(`${save.runs} SORTIES   ·   ${save.known.length} WORLDS MAPPED`, px, py + 2);
  ctx.fillText(`DEEPEST THREAT ${save.deepestThreat}   ·   ${save.naquadah} N   ${save.intel || 0} INTEL`, px, py + 15);
  ctx.restore();

  // --- infirmary: heartbeat traces on the vitals monitors
  const iR = room('infirm').rectPx;
  ctx.save();
  ctx.strokeStyle = 'rgba(140,255,220,0.7)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const x = iR.x + 82;
    const y = iR.y + 44 + i * 96 + 13;
    ctx.beginPath();
    for (let k = 0; k <= 26; k++) {
      const ph = (k / 26 + t * (0.22 + i * 0.04)) % 1;
      const beat = ph < 0.12 ? Math.sin(ph / 0.12 * Math.PI) * 7 : ph < 0.2 ? -2 : 0;
      const yy = y - beat;
      if (k === 0) ctx.moveTo(x + k, yy);
      else ctx.lineTo(x + k, yy);
    }
    ctx.stroke();
  }
  ctx.restore();

  // --- briefing: a pulse travelling the network diagram
  const bR = room('brief').rectPx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const bp = (t * 0.35) % 1;
  ctx.fillStyle = 'rgba(160,225,255,0.8)';
  ctx.beginPath();
  ctx.arc(bR.x + bR.w / 2 - 80 + bp * 160, bR.y + 16 + Math.sin(bp * 6) * 10, 2.2, 0, TAU);
  ctx.fill();
  ctx.restore();

  // --- ready room: the bench lamp flickers very slightly
  const rR = room('ready').rectPx;
  const lx = rR.x + 78;
  const ly = rR.y + 198;
  const flick = 0.05 + 0.02 * Math.sin(t * 7.3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, 40);
  lg.addColorStop(0, `rgba(255,238,190,${flick})`);
  lg.addColorStop(0.4, `rgba(255,238,190,${flick * 0.4})`);
  lg.addColorStop(1, 'rgba(255,238,190,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(lx - 40, ly - 40, 80, 80);
  ctx.restore();
}

// DHD-styled dialling pedestal in the control room
export function drawDialer(ctx, d, t, near) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.fillStyle = 'rgba(22,18,26,0.95)';
  rr(ctx, -24, -18, 48, 36, 8);
  ctx.fill();
  ctx.strokeStyle = near ? 'rgba(160,235,255,0.9)' : 'rgba(150,120,90,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const lit = (Math.floor(t * 2.2) % 12) === i;
    ctx.fillStyle = lit ? 'rgba(255,150,90,0.95)' : 'rgba(150,100,70,0.5)';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 15, Math.sin(a) * 11, 2, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = `rgba(255,90,50,${0.5 + 0.4 * Math.sin(t * 3)})`;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = near ? '#8ef' : 'rgba(170,200,225,0.6)';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('DIALLING CONSOLE', d.x, d.y - 26);
}

// ---------------------------------------------------------------- personnel

// crew routes: each figure patrols a loop of points inside one room, so
// scientists stay near the consoles and marines stay near the ramp.
export function makeCrew(world) {
  const R = (k) => world.rooms.find((r) => r.kind === k).rectPx;
  const e = R('embark');
  const c = R('control');
  const i = R('infirm');
  const b = R('brief');
  const y = R('ready');
  const routes = [
    { role: 'marine', pts: [[e.x + 70, e.y + 300], [e.x + 70, e.y + 380], [e.x + 170, e.y + 380]] },
    { role: 'marine', pts: [[e.x + e.w - 70, e.y + 300], [e.x + e.w - 70, e.y + 390], [e.x + e.w - 180, e.y + 390]] },
    { role: 'marine', pts: [[e.x + 150, e.y + 60], [e.x + 120, e.y + 200], [e.x + 220, e.y + 250]] },
    { role: 'tech', pts: [[c.x + 90, c.y + 92], [c.x + 280, c.y + 92], [c.x + 430, c.y + 92]] },
    { role: 'tech', pts: [[c.x + 200, c.y + 150], [c.x + 200, c.y + 250], [c.x + 380, c.y + 250]] },
    { role: 'sci', pts: [[c.x + 470, c.y + 200], [c.x + 400, c.y + 280], [c.x + 300, c.y + 200]] },
    { role: 'medic', pts: [[i.x + 130, i.y + 80], [i.x + 130, i.y + 280], [i.x + 240, i.y + 200]] },
    { role: 'sci', pts: [[b.x + 60, b.y + 90], [b.x + 60, b.y + 300], [b.x + 340, b.y + 300]] },
    { role: 'marine', pts: [[y.x + 90, y.y + 300], [y.x + 300, y.y + 300], [y.x + 300, y.y + 180]] },
  ];
  return routes.map((r, k) => ({
    role: r.role,
    pts: r.pts,
    i: 0,
    x: r.pts[0][0],
    y: r.pts[0][1],
    a: 0,
    wait: k * 0.4,
    speed: r.role === 'marine' ? 34 : 28,
  }));
}

export const CREW_COLORS = {
  marine: ['rgba(118,142,98,0.95)', 'rgba(178,198,152,1)'],
  tech: ['rgba(104,132,166,0.95)', 'rgba(172,205,232,1)'],
  sci: ['rgba(198,212,222,0.92)', 'rgba(228,240,248,1)'],
  medic: ['rgba(214,228,234,0.95)', 'rgba(240,250,255,1)'],
};

export function updateCrew(crew, dt) {
  for (const cr of crew) {
    if (cr.wait > 0) {
      cr.wait -= dt;
      continue;
    }
    const tg = cr.pts[cr.i];
    const dx = tg[0] - cr.x;
    const dy = tg[1] - cr.y;
    const d = Math.hypot(dx, dy);
    if (d < 6) {
      cr.i = (cr.i + 1) % cr.pts.length;
      cr.wait = 0.6 + Math.random() * 2.2;
      continue;
    }
    cr.a = Math.atan2(dy, dx);
    cr.x += (dx / d) * cr.speed * dt;
    cr.y += (dy / d) * cr.speed * dt;
  }
}

// ---------------------------------------------------------------- stations

// draw one station console + its floor pad + label. Each kind gets its own
// furniture so the room around it reads right.
export function drawStation(ctx, s, t, near) {
  const col = near ? '#8fe8ff' : '#5a86a8';
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.strokeStyle = near ? 'rgba(140,230,255,0.5)' : 'rgba(90,140,180,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-30, -24, 60, 48);
  ctx.shadowBlur = near ? 14 : 6;
  ctx.shadowColor = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  if (s.kind === 'armory') {
    // a weapons bench: a slab with a rack of barrels standing behind it
    ctx.beginPath();
    ctx.moveTo(-22, 12);
    ctx.lineTo(-22, -4);
    ctx.lineTo(22, -4);
    ctx.lineTo(22, 12);
    ctx.stroke();
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 8, -8);
      ctx.lineTo(i * 8, -20);
      ctx.stroke();
    }
    ctx.fillStyle = near ? 'rgba(140,230,255,0.24)' : 'rgba(90,140,180,0.12)';
    ctx.fillRect(-20, -2, 40, 10);
  } else if (s.kind === 'infirmary') {
    // a supply cabinet with a cross on the door
    ctx.strokeRect(-18, -16, 36, 30);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 8);
    ctx.moveTo(-9, -1);
    ctx.lineTo(9, -1);
    ctx.stroke();
  } else {
    // a research console: angled body + screen
    ctx.beginPath();
    ctx.moveTo(-16, 10);
    ctx.lineTo(-16, -6);
    ctx.lineTo(-8, -14);
    ctx.lineTo(8, -14);
    ctx.lineTo(16, -6);
    ctx.lineTo(16, 10);
    ctx.stroke();
    ctx.fillStyle = near ? 'rgba(140,230,255,0.28)' : 'rgba(90,140,180,0.14)';
    ctx.fillRect(-11, -12, 22, 12 + Math.sin(t * 3 + s.tx) * 1.5);
  }
  ctx.restore();
  ctx.fillStyle = near ? '#cdeeff' : '#7fa8c4';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(s.label, s.x, s.y - 32);
  if (near) {
    ctx.fillStyle = '#8ef';
    ctx.font = '10px monospace';
    ctx.fillText('E  ·  ' + s.hint, s.x, s.y + 38);
  }
}
