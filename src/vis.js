// ─────────────────────────────────────────────────────────────────────────────
// vis.js — line of sight, the 360° visibility polygon, and the fog that hides
// everything outside it.
//
// You only see inside a polygon cast from the player: rays are fired at every
// nearby wall corner (plus a coarse fan) and clipped to the nearest wall, so
// doorways, pillars and corners occlude naturally. game.js caches the result on
// g.visPoly / g.visBox each frame; render code and enemy AI both read it back
// through litAt().
//
// Pure geometry — reads g.world / g.player / g.params, writes nothing, calls
// nothing back into game.js.
// ─────────────────────────────────────────────────────────────────────────────

import { TAU, hexA } from './draw.js';
import { TILE, BIOMES } from './worldgen.js';

// parametric ray/segment intersection: distance along the ray to the hit, or
// Infinity. u-tolerance lets a ray graze a shared corner without slipping through.
export function raySeg(px, py, dx, dy, ax, ay, bx, by) {
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
export function gatherSegments(g, px, py, R) {
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

export function circlePoly(px, py, R, n) {
  const poly = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    poly.push(px + Math.cos(a) * R, py + Math.sin(a) * R);
  }
  return poly;
}

// 360° visibility polygon: cast rays at every wall-corner (plus a fan) and keep
// the nearest hit. Doorways, pillars and corners occlude naturally.
export function computeVisPoly(g, R) {
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

export function inPoly(x, y, poly) {
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

export function polyBox(poly) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    if (poly[i] < x0) x0 = poly[i];
    if (poly[i] > x1) x1 = poly[i];
    if (poly[i + 1] < y0) y0 = poly[i + 1];
    if (poly[i + 1] > y1) y1 = poly[i + 1];
  }
  return [x0, y0, x1, y1];
}

// is world point (x,y) currently visible to the player? near points are always
// lit; otherwise it's a bbox-reject then a point-in-polygon test against the
// cached g.visPoly / g.visBox.
export function litAt(g, x, y) {
  const p = g.player;
  const dx = x - p.x;
  const dy = y - p.y;
  if (dx * dx + dy * dy < 6400) return true;
  if (!g.visPoly) return false;
  const bb = g.visBox;
  if (bb && (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3])) return false;
  return inPoly(x, y, g.visPoly);
}

// the unlit area beyond line of sight, tinted toward the current biome so a
// temple fades to warm shadow and a hive to violet murk
export function fogRGB(g) {
  const pal = BIOMES[(g.params && g.params.biome) || 'ruins'] || BIOMES.ruins;
  const hex = (pal.fog || '#030409').replace('#', '');
  const n = parseInt(hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function isOutdoor(g) {
  const pal = BIOMES[(g.params && g.params.biome) || 'ruins'];
  return !!(pal && pal.outdoor);
}

export function drawFog(ctx, g, R) {
  const p = g.player;
  const poly = g.visPoly;
  if (!poly || poly.length < 6) return;
  const rgb = fogRGB(g);
  // outdoors under open sky: the unseen area is dusk-dim, not pitch black
  const out = isOutdoor(g);
  const outerA = out ? 0.8 : 0.95;
  const edgeA = out ? 0.66 : 0.92;
  const pad = 2600;
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x - pad, p.y - pad, pad * 2, pad * 2);
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(${rgb},${outerA})`;
  ctx.fill('evenodd');

  ctx.beginPath();
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
  ctx.clip();
  const grd = ctx.createRadialGradient(p.x, p.y, R * 0.32, p.x, p.y, R * 1.02);
  grd.addColorStop(0, `rgba(${rgb},0)`);
  grd.addColorStop(1, `rgba(${rgb},${edgeA})`);
  ctx.fillStyle = grd;
  ctx.fillRect(p.x - R - 4, p.y - R - 4, R * 2 + 8, R * 2 + 8);
  // a faint sky-light wash lifts the lit ground on surface worlds
  if (out) {
    const amb = (BIOMES[g.params.biome] && BIOMES[g.params.biome].ambient) || '#dfe8f0';
    ctx.globalCompositeOperation = 'lighter';
    const sg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    sg.addColorStop(0, hexA(amb, 0.06));
    sg.addColorStop(1, hexA(amb, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}
