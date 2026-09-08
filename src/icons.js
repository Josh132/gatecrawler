// Vector item pictograms — pure canvas 2D. Neon-geometric: thin glowing
// strokes / simple filled shapes on dark, drawn in each item's own colour.
//
//   drawItemIcon(ctx, id, cx, cy, size)  — centred in a size x size box
//   rarityOf(id)                         — 'common' | 'uncommon' | 'rare'
//   RARITY_COLOR                         — ring tints per rarity

import { ITEMS } from './items.js';

export const RARITY_COLOR = { common: '#8aa0b8', uncommon: '#79d17a', rare: '#c98bff' };

const NEUTRAL = '#8aa0b8';

// --- tiny helpers -------------------------------------------------------------
function poly(ctx, pts, close) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i], pts[i + 1]);
    else ctx.lineTo(pts[i], pts[i + 1]);
  }
  if (close) ctx.closePath();
}
function strokePoly(ctx, pts, close) {
  poly(ctx, pts, close);
  ctx.stroke();
}
function fillPoly(ctx, pts) {
  poly(ctx, pts, true);
  ctx.fill();
}

// --- main -------------------------------------------------------------------
export function drawItemIcon(ctx, id, cx, cy, size) {
  const it = ITEMS[id];
  const color = it ? it.color : NEUTRAL;
  const u = size / 2; // half-extent; shapes are authored in +/- u space

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(3, size * 0.18);
  ctx.lineWidth = Math.max(1.4, size * 0.09);
  ctx.lineCap = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!it) {
    drawUnknown(ctx, cx, cy, u);
  } else if (it.type === 'consumable') {
    if (id === 'medkit') drawMedkit(ctx, cx, cy, u);
    else if (id === 'bandage') drawBandage(ctx, cx, cy, u);
    else if (id === 'stim' || it.use === 'stim') drawStim(ctx, cx, cy, u);
    else drawShieldCell(ctx, cx, cy, u); // shieldcell / any 'shield'
  } else if (it.type === 'grenade') {
    drawFrag(ctx, cx, cy, u);
  } else if (it.type === 'armor') {
    if (it.region === 'head') id === 'a_visor' ? drawVisor(ctx, cx, cy, u) : drawHelm(ctx, cx, cy, u);
    else if (it.region === 'torso') drawVest(ctx, cx, cy, u);
    else if (it.region === 'legs') drawGreaves(ctx, cx, cy, u);
    else drawBoots(ctx, cx, cy, u); // feet
  } else if (it.type === 'weapon') {
    const w = it.weapon;
    if (w === 'shotgun') drawShotgun(ctx, cx, cy, u);
    else if (w === 'staff') drawStaff(ctx, cx, cy, u);
    else if (w === 'zat') drawZat(ctx, cx, cy, u);
    else if (w === 'launcher') drawLauncher(ctx, cx, cy, u);
    else if (w === 'beam') drawBeam(ctx, cx, cy, u);
    else drawRifle(ctx, cx, cy, u); // p90 / burst / fallback
  } else {
    drawUnknown(ctx, cx, cy, u);
  }

  ctx.restore();
}

// --- consumables ----------------------------------------------------------
function drawMedkit(ctx, x, y, u) {
  const w = u * 1.5, h = u * 1.3;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, u * 0.28);
  ctx.stroke();
  const a = u * 0.62, t = u * 0.24;
  ctx.fillRect(x - t, y - a, t * 2, a * 2);
  ctx.fillRect(x - a, y - t, a * 2, t * 2);
}
function drawBandage(ctx, x, y, u) {
  const w = u * 1.6, h = u * 0.7;
  ctx.save();
  ctx.lineWidth = Math.max(1, u * 0.14);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.stroke();
  ctx.restore();
  const s = u * 0.34;
  strokePoly(ctx, [x - s, y, x + s, y], false);
  strokePoly(ctx, [x, y - s, x, y + s], false);
}
function drawStim(ctx, x, y, u) {
  fillPoly(ctx, [
    x - u * 0.15, y - u,
    x + u * 0.55, y - u * 0.15,
    x + u * 0.08, y - u * 0.05,
    x + u * 0.2, y + u,
    x - u * 0.55, y + u * 0.05,
    x - u * 0.02, y - u * 0.08,
  ]);
}
function drawShieldCell(ctx, x, y, u) {
  strokePoly(ctx, [x, y - u, x + u * 0.8, y, x, y + u, x - u * 0.8, y], true);
  strokePoly(ctx, [x, y - u * 0.5, x + u * 0.4, y, x, y + u * 0.5, x - u * 0.4, y], true);
}

// --- grenade ------------------------------------------------------------
function drawFrag(ctx, x, y, u) {
  ctx.beginPath();
  ctx.arc(x, y + u * 0.12, u * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  strokePoly(ctx, [x - u * 0.2, y - u * 0.5, x + u * 0.2, y - u * 0.5], false); // fuse cap
  strokePoly(ctx, [x, y - u * 0.5, x, y - u], false);
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * 2.2;
    strokePoly(ctx, [
      x + Math.cos(a) * u * 0.62, y + u * 0.12 + Math.sin(a) * u * 0.62,
      x + Math.cos(a) * u * 1.0, y + u * 0.12 + Math.sin(a) * u * 1.0,
    ], false);
  }
}

// --- armour ------------------------------------------------------------
function drawHelm(ctx, x, y, u) {
  ctx.beginPath();
  ctx.arc(x, y + u * 0.1, u * 0.85, Math.PI, 0);
  ctx.stroke();
  strokePoly(ctx, [x - u * 0.85, y + u * 0.1, x + u * 0.85, y + u * 0.1], false);
  strokePoly(ctx, [x - u * 0.55, y + u * 0.5, x + u * 0.55, y + u * 0.5], false); // brow
}
function drawVisor(ctx, x, y, u) {
  const w = u * 1.7, h = u * 0.8;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.stroke();
  strokePoly(ctx, [x - u * 0.55, y, x + u * 0.55, y], false); // slit
}
function drawVest(ctx, x, y, u) {
  strokePoly(ctx, [
    x - u * 0.75, y - u * 0.8,
    x + u * 0.75, y - u * 0.8,
    x + u * 0.85, y + u * 0.35,
    x, y + u,
    x - u * 0.85, y + u * 0.35,
  ], true);
  strokePoly(ctx, [x, y - u * 0.8, x, y + u], false); // seam
}
function drawGreaves(ctx, x, y, u) {
  ctx.beginPath();
  ctx.moveTo(x - u * 0.45, y - u * 0.9);
  ctx.quadraticCurveTo(x + u * 0.7, y, x - u * 0.35, y + u * 0.9);
  ctx.stroke();
  strokePoly(ctx, [x - u * 0.55, y - u * 0.9, x - u * 0.15, y - u * 0.9], false);
  strokePoly(ctx, [x - u * 0.5, y + u * 0.9, x - u * 0.1, y + u * 0.9], false);
}
function drawBoots(ctx, x, y, u) {
  strokePoly(ctx, [
    x - u * 0.5, y - u * 0.9,
    x + u * 0.1, y - u * 0.9,
    x + u * 0.1, y + u * 0.3,
    x + u * 0.9, y + u * 0.3,
    x + u * 0.9, y + u * 0.9,
    x - u * 0.5, y + u * 0.9,
  ], true);
}

// --- weapons -----------------------------------------------------------
function drawRifle(ctx, x, y, u) {
  ctx.beginPath();
  ctx.roundRect(x - u * 0.9, y - u * 0.28, u * 1.5, u * 0.5, u * 0.12);
  ctx.stroke();
  strokePoly(ctx, [x + u * 0.6, y - u * 0.08, x + u * 1.0, y - u * 0.08], false); // barrel
  strokePoly(ctx, [x - u * 0.2, y + u * 0.22, x - u * 0.05, y + u * 0.8], false); // mag
  strokePoly(ctx, [x - u * 0.9, y + u * 0.02, x - u * 1.0, y + u * 0.45], false); // stock
}
function drawShotgun(ctx, x, y, u) {
  ctx.beginPath();
  ctx.roundRect(x - u * 0.9, y - u * 0.3, u * 1.0, u * 0.42, u * 0.1);
  ctx.stroke();
  strokePoly(ctx, [x + u * 0.1, y - u * 0.22, x + u * 1.0, y - u * 0.22], false); // wide barrel
  strokePoly(ctx, [x + u * 0.1, y + u * 0.02, x + u * 0.95, y + u * 0.02], false); // pump
  strokePoly(ctx, [x - u * 0.9, y, x - u * 1.05, y + u * 0.55], false); // stock
}
function drawStaff(ctx, x, y, u) {
  strokePoly(ctx, [x - u * 0.95, y + u * 0.55, x + u * 0.7, y - u * 0.55], false);
  ctx.beginPath();
  ctx.arc(x + u * 0.78, y - u * 0.62, u * 0.28, 0, Math.PI * 2);
  ctx.stroke();
  strokePoly(ctx, [x - u * 0.7, y + u * 0.15, x - u * 0.3, y + u * 0.4], false); // grip
}
function drawZat(ctx, x, y, u) {
  ctx.beginPath();
  ctx.moveTo(x - u * 0.85, y + u * 0.45);
  ctx.quadraticCurveTo(x, y - u * 0.9, x + u * 0.9, y - u * 0.2);
  ctx.stroke();
  strokePoly(ctx, [x - u * 0.55, y + u * 0.2, x - u * 0.25, y + u * 0.75], false); // grip
}
function drawLauncher(ctx, x, y, u) {
  ctx.beginPath();
  ctx.roundRect(x - u * 0.95, y - u * 0.4, u * 1.7, u * 0.72, u * 0.34);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + u * 0.75, y - u * 0.04, u * 0.32, 0, Math.PI * 2); // muzzle ring
  ctx.stroke();
  strokePoly(ctx, [x - u * 0.5, y + u * 0.32, x - u * 0.3, y + u * 0.85], false); // grip
}
function drawBeam(ctx, x, y, u) {
  ctx.beginPath();
  ctx.arc(x + u * 0.2, y, u * 0.7, -Math.PI * 0.6, Math.PI * 0.6); // emitter dish
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - u * 0.1, y, u * 0.22, 0, Math.PI * 2); // core
  ctx.fill();
  strokePoly(ctx, [x - u * 0.85, y - u * 0.25, x - u * 0.85, y + u * 0.25], false); // back plate
  strokePoly(ctx, [x - u * 0.5, y + u * 0.25, x - u * 0.35, y + u * 0.8], false); // grip
}

// --- unknown ---------------------------------------------------------------
function drawUnknown(ctx, x, y, u) {
  ctx.strokeStyle = NEUTRAL;
  ctx.fillStyle = NEUTRAL;
  ctx.shadowColor = NEUTRAL;
  const r = u * 0.9, pts = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  strokePoly(ctx, pts, true);
  ctx.font = `${(u * 1.1) | 0}px monospace`;
  ctx.fillText('?', x, y + u * 0.06);
}

// --- rarity --------------------------------------------------------------
const RARE = new Set(['w_launcher', 'w_beam']);
const UNCOMMON = new Set(['a_helm', 'a_plate', 'w_shotgun', 'w_burst']);

export function rarityOf(id) {
  if (RARE.has(id)) return 'rare';
  if (UNCOMMON.has(id)) return 'uncommon';
  return 'common';
}
