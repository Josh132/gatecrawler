// Stargate Command — the walkable home base you return to between runs.
// A hand-authored single room compatible with the play renderer: the gate sits
// on a ramp at the north wall, stations line the floor. No combat, no fog.
import { TILE } from './worldgen.js';

export const HUB_W = 34; // tiles
export const HUB_H = 22;

// station positions are in pixels, resolved from a tile anchor
const T = (n) => n * TILE + TILE / 2;

// three consoles: the Armory now covers loadout AND drawing unlocked weapons
// (the old separate Requisitions console folded into it).
export const STATIONS = [
  { kind: 'armory', tx: 6, ty: 14, label: 'ARMORY', hint: 'loadout · requisition · gear' },
  { kind: 'research', tx: 27, ty: 10, label: 'RESEARCH LAB', hint: 'tech tree' },
  { kind: 'infirmary', tx: 7, ty: 7, label: 'INFIRMARY', hint: 'restock supplies' },
];

export function buildHub() {
  const W = HUB_W;
  const H = HUB_H;
  const grid = new Uint8Array(W * H).fill(1);
  const at = (x, y) => y * W + x;
  // carve the interior
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) grid[at(x, y)] = 0;
  }
  // a couple of pillars for visual interest (kept away from the ramp + stations)
  for (const [px, py] of [
    [12, 12],
    [22, 12],
    [17, 16],
  ]) {
    grid[at(px, py)] = 1;
  }

  // a recessed alcove for the gate at the north wall
  for (let x = (W >> 1) - 3; x <= (W >> 1) + 3; x++) grid[at(x, 1)] = 0;

  const gateCenter = { x: T(W >> 1), y: T(4) };
  const rectPx = { x: 2 * TILE, y: 2 * TILE, w: (W - 4) * TILE, h: (H - 4) * TILE };
  const room = {
    kind: 'hub',
    gx: 0,
    gy: 0,
    ox: 0,
    oy: 0,
    centerPx: { x: T(W >> 1), y: T(H >> 1) },
    rectPx,
    populated: true,
    cleared: true,
    everSeen: true,
  };
  const stations = STATIONS.map((s) => ({ ...s, x: T(s.tx), y: T(s.ty) }));

  return {
    grid,
    W,
    H,
    rooms: [room],
    gateRoom: room,
    dhdRoom: room,
    gateCenter,
    stations,
    isHub: true,
  };
}

// draw one station console + its floor pad + label
export function drawStation(ctx, s, t, near) {
  const col = near ? '#8fe8ff' : '#5a86a8';
  ctx.save();
  ctx.translate(s.x, s.y);
  // floor pad
  ctx.strokeStyle = near ? 'rgba(140,230,255,0.5)' : 'rgba(90,140,180,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-26, -20, 52, 40);
  // console body
  ctx.shadowBlur = near ? 14 : 6;
  ctx.shadowColor = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-16, 10);
  ctx.lineTo(-16, -6);
  ctx.lineTo(-8, -14);
  ctx.lineTo(8, -14);
  ctx.lineTo(16, -6);
  ctx.lineTo(16, 10);
  ctx.stroke();
  // screen glow
  ctx.fillStyle = near ? 'rgba(140,230,255,0.28)' : 'rgba(90,140,180,0.14)';
  ctx.fillRect(-11, -12, 22, 12 + Math.sin(t * 3 + s.tx) * 1.5);
  ctx.restore();
  // label
  ctx.fillStyle = near ? '#cdeeff' : '#7fa8c4';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(s.label, s.x, s.y - 28);
  if (near) {
    ctx.fillStyle = '#8ef';
    ctx.font = '10px monospace';
    ctx.fillText('E  ·  ' + s.hint, s.x, s.y + 34);
  }
}
