export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function glowCircle(ctx, x, y, r, color, blur = 12) {
  ctx.save();
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function glowPoly(ctx, pts, stroke, fill, blur = 10) {
  ctx.save();
  ctx.shadowBlur = blur;
  ctx.shadowColor = stroke;
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

export function ngon(cx, cy, r, n, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

// =================================================================== colour
// tiny cached colour maths. the figure renderer asks for the same handful of
// shades of the same handful of colours every frame, so parse once and keep
// the derived rgba strings around.
const _parsed = new Map();
function parseCol(c) {
  let v = _parsed.get(c);
  if (v) return v;
  v = [255, 255, 255, 1];
  if (typeof c === 'string') {
    if (c.charCodeAt(0) === 35) {
      let h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h, 16);
      if (!isNaN(n)) v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    } else {
      const m = c.match(/-?\d*\.?\d+/g);
      if (m && m.length >= 3) v = [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
    }
  }
  if (_parsed.size > 512) _parsed.clear();
  _parsed.set(c, v);
  return v;
}

// k<1 darkens toward black, k>1 lightens toward white; a scales source alpha
const _shades = new Map();
export function shade(c, k, a) {
  const key = c + '|' + k + '|' + (a == null ? 1 : a);
  let s = _shades.get(key);
  if (s) return s;
  const p = parseCol(c);
  let r, g, b;
  if (k <= 1) {
    r = p[0] * k;
    g = p[1] * k;
    b = p[2] * k;
  } else {
    const u = k - 1 > 1 ? 1 : k - 1;
    r = p[0] + (255 - p[0]) * u;
    g = p[1] + (255 - p[1]) * u;
    b = p[2] + (255 - p[2]) * u;
  }
  const al = p[3] * (a == null ? 1 : a);
  s = 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + (al < 1 ? al.toFixed(3) : '1') + ')';
  if (_shades.size > 1200) _shades.clear();
  _shades.set(key, s);
  return s;
}

// =================================================================== figures
// one fixed key light, matching game.js's shadow pass, so the shading on a
// body agrees with the blob it drops on the floor.
export const LIGHT_DIR = { x: 0.42, y: 0.66 };

const NOB = {};
const _mz = { x: 0, y: 0 }; // scratch muzzle, only used when the caller has none
const INK = 'rgba(6,10,14,0.62)'; // silhouette ink — tiny figures need a contour

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
function ell(ctx, x, y, rx, ry, rot) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx < 0.05 ? 0.05 : rx, ry < 0.05 ? 0.05 : ry, rot || 0, 0, TAU);
  ctx.fill();
}
function bone(ctx, x1, y1, x2, y2, x3, y3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.stroke();
}
function seg(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// silhouette per weapon id. `len` is the muzzle's local x (same units as the
// legacy o.weaponLen), `body` the fraction of that taken up by the receiver.
export const WEAPON_SHAPE = {
  p90: { len: 11, w: 2.9, body: 0.6, mag: 'top', col: '#cfe8ff' },
  burst: { len: 12.5, w: 2.4, body: 0.5, mag: 'box', col: '#c6e2ff' },
  shotgun: { len: 12.5, w: 3.2, body: 0.55, pump: true, col: '#ffd7a0' },
  staff: { len: 16.5, w: 2.2, body: 0.3, tip: 'bulb', tail: 5, col: '#ffcf9a' },
  zat: { len: 8, w: 2.4, body: 0.7, tip: 'curl', col: '#9fe6ff' },
  beam: { len: 13, w: 2.3, body: 0.5, tip: 'ring', col: '#b9f2ff' },
  launcher: { len: 11.5, w: 4, body: 0.7, tube: true, col: '#ffd27a' },
  rifle: { len: 19, w: 2.1, body: 0.38, scope: true, tip: 'bulb', tail: 4.5, col: '#ffd8a8' },
  cannon: { len: 20, w: 3.8, body: 0.4, tip: 'bulb', tail: 6, col: '#ffcf9a' },
  club: { len: 9, w: 3.4, body: 0.9, col: '#cbb9a0' },
};
const GENERIC_W = { len: 12, w: 2.5, body: 0.5, col: '#e8f4ff' };

// the held weapon + both forearms, in the figure's local frame. the gun is a
// dark mass with a bright top edge so it never dissolves into a pale body.
function drawWeapon(ctx, o, wk, tipX, col, sd, recoil, dip, shX, shW, t, ph, gloveCol) {
  const gx = 2.5 - recoil * 1.2;
  const gy = sd * (1.5 + dip * 0.9);
  // muzzle: on the aim line when braced, swung across the body while reloading
  const mx = lerp(tipX - recoil * 1.6, gx + 4.6, dip);
  const my = lerp(sd * 0.5, sd * 4.4, dip);
  let nx = mx - gx;
  let ny = my - gy;
  const L = Math.hypot(nx, ny) || 1;
  nx /= L;
  ny /= L;
  const px = -ny;
  const py = nx;
  const bw = wk.w;
  const be = wk.body;
  const dkCol = shade(col, 0.3);
  const at = (f, s2) => {
    _mz.x = gx + nx * L * f + px * s2;
    _mz.y = gy + ny * L * f + py * s2;
    return _mz;
  };

  // stock behind the grip, then receiver, then barrel — dark body first
  ctx.strokeStyle = dkCol;
  ctx.lineWidth = bw;
  seg(ctx, gx - nx * (wk.tail || 2.4), gy - ny * (wk.tail || 2.4), gx + nx * L * be, gy + ny * L * be);
  ctx.lineWidth = bw * 0.46;
  seg(ctx, gx + nx * L * be * 0.7, gy + ny * L * be * 0.7, mx, my);
  // lit top edge
  ctx.strokeStyle = col;
  ctx.lineWidth = bw * 0.42;
  let a = at(0, -bw * 0.24);
  const ax = a.x;
  const ay = a.y;
  a = at(be, -bw * 0.24);
  seg(ctx, ax, ay, a.x, a.y);

  // fittings
  ctx.lineWidth = bw * 0.45;
  ctx.strokeStyle = shade(col, 0.55);
  if (wk.mag === 'top') {
    const p1 = at(0.16, -bw * 0.32);
    const x1 = p1.x;
    const y1 = p1.y;
    const p2 = at(0.58, -bw * 0.32);
    ctx.lineWidth = bw * 0.5;
    seg(ctx, x1, y1, p2.x, p2.y);
  } else if (wk.mag === 'box') {
    const p1 = at(0.3, 0);
    const x1 = p1.x;
    const y1 = p1.y;
    const p2 = at(0.3, 2.2);
    ctx.lineWidth = bw * 0.7;
    seg(ctx, x1, y1, p2.x, p2.y);
  }
  if (wk.pump) {
    const p1 = at(0.6, -1.6);
    const x1 = p1.x;
    const y1 = p1.y;
    const p2 = at(0.6, 1.6);
    ctx.lineWidth = bw * 0.55;
    seg(ctx, x1, y1, p2.x, p2.y);
  }
  if (wk.scope) {
    const p1 = at(0.2, -1.4);
    const x1 = p1.x;
    const y1 = p1.y;
    const p2 = at(0.46, -1.4);
    ctx.lineWidth = bw * 0.4;
    seg(ctx, x1, y1, p2.x, p2.y);
  }
  if (wk.tube) {
    const p1 = at(0.85, -1.2);
    const x1 = p1.x;
    const y1 = p1.y;
    const p2 = at(0.85, 1.2);
    ctx.lineWidth = bw * 0.35;
    ctx.strokeStyle = shade(col, 1.3);
    seg(ctx, x1, y1, p2.x, p2.y);
  }
  if (wk.tip === 'bulb') {
    ctx.fillStyle = dkCol;
    ell(ctx, mx - nx * 1.2, my - ny * 1.2, 2.2, 1.5, Math.atan2(ny, nx));
    if (o.charge) {
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = o.chargeColor || '#ffb347';
      ctx.fillStyle = shade(o.chargeColor || '#ffb347', 1.5);
      dot(ctx, mx, my, 1 + o.charge * 1.4);
      ctx.restore();
    } else {
      ctx.fillStyle = shade(col, 1.35);
      dot(ctx, mx, my, 0.85);
    }
  } else if (wk.tip === 'ring') {
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = shade(col, 1.4);
    ctx.beginPath();
    ctx.arc(mx, my, 1.6, 0, TAU);
    ctx.stroke();
  } else if (wk.tip === 'curl') {
    ctx.lineWidth = bw * 0.5;
    ctx.strokeStyle = shade(col, 1.2);
    const ta = Math.atan2(ny, nx);
    ctx.beginPath();
    ctx.arc(mx - nx * 0.7, my - ny * 0.7, 1.6, ta - 2.2, ta + 0.4);
    ctx.stroke();
  }

  // forearms: rear hand on the grip, fore hand on the fore-grip (or working
  // the mag well mid-reload)
  const fh = dip > 0.02 ? 0.2 : 0.55;
  let hx2 = gx + nx * L * fh;
  let hy2 = gy + ny * L * fh;
  if (dip > 0.02) {
    hx2 = lerp(hx2, gx + 1.2, dip);
    hy2 = lerp(hy2, gy + sd * (2.6 + Math.sin(t * 19 + ph) * 0.8), dip);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;
  bone(ctx, shX, sd * shW * 0.78, gx - 0.8, gy + sd * 1.2, gx, gy);
  bone(ctx, shX - 0.2, -sd * shW * 0.7, (shX + hx2) * 0.5, -sd * 0.5, hx2, hy2);
  ctx.strokeStyle = gloveCol;
  ctx.lineWidth = 1.5;
  bone(ctx, shX, sd * shW * 0.78, gx - 0.8, gy + sd * 1.2, gx, gy);
  bone(ctx, shX - 0.2, -sd * shW * 0.7, (shX + hx2) * 0.5, -sd * 0.5, hx2, hy2);
  ctx.fillStyle = shade(gloveCol, 1.3);
  dot(ctx, gx, gy, 1);
  dot(ctx, hx2, hy2, 1);

  _mz.x = mx;
  _mz.y = my;
  return _mz;
}

// helm / head furniture, drawn around the head at (hx,hy) with radius hr
function drawHelm(ctx, kind, hx, hy, hr, body, headCol, trim, t, ph, accent) {
  const met = shade(trim || body, 1.05);
  const dk = shade(trim || body, 0.42);
  if (kind === 'cap') {
    ctx.fillStyle = dk;
    ctx.beginPath();
    ctx.arc(hx, hy, hr * 1.02, -2, 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = met;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  } else if (kind === 'dome') {
    ctx.fillStyle = met;
    ell(ctx, hx + hr * 0.12, hy, hr * 1.16, hr * 1.02);
    ctx.fillStyle = dk;
    ctx.beginPath();
    ctx.ellipse(hx + hr * 0.12, hy, hr * 1.16, hr * 1.02, 0, 1.45, -1.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(headCol, 1.15, 0.95);
    ell(ctx, hx + hr * 0.72, hy, hr * 0.34, hr * 0.6);
  } else if (kind === 'serpent') {
    // serpent guard: hooded cowl, flared cheeks, a short forward beak
    ctx.fillStyle = dk;
    ctx.beginPath();
    ctx.moveTo(hx + hr * 1.55, hy);
    ctx.quadraticCurveTo(hx + hr * 0.35, hy - hr * 1.75, hx - hr * 1.05, hy - hr * 1.15);
    ctx.lineTo(hx - hr * 1.05, hy + hr * 1.15);
    ctx.quadraticCurveTo(hx + hr * 0.35, hy + hr * 1.75, hx + hr * 1.55, hy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = met;
    ell(ctx, hx + hr * 0.05, hy, hr * 0.85, hr * 0.45);
    ctx.fillStyle = 'rgba(255,236,205,0.95)';
    dot(ctx, hx + hr * 0.95, hy - hr * 0.4, hr * 0.2);
    dot(ctx, hx + hr * 0.95, hy + hr * 0.4, hr * 0.2);
  } else if (kind === 'mask') {
    ctx.fillStyle = dk;
    ctx.beginPath();
    ctx.moveTo(hx + hr * 1.5, hy);
    ctx.lineTo(hx - hr * 0.25, hy - hr * 1.15);
    ctx.lineTo(hx - hr * 0.75, hy);
    ctx.lineTo(hx - hr * 0.25, hy + hr * 1.15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(headCol, 1.3, 0.9);
    ctx.lineWidth = 0.65;
    seg(ctx, hx + hr * 1, hy - hr * 0.52, hx + hr * 0.1, hy - hr * 0.42);
    seg(ctx, hx + hr * 1, hy + hr * 0.52, hx + hr * 0.1, hy + hr * 0.42);
  } else if (kind === 'hood') {
    ctx.fillStyle = shade(body, 0.4);
    ctx.beginPath();
    ctx.arc(hx - hr * 0.5, hy, hr * 1.5, 1, -1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  } else if (kind === 'crown' || kind === 'tall') {
    ctx.fillStyle = dk;
    ell(ctx, hx + hr * 0.08, hy, hr * 1.2, hr * 0.95);
    ctx.strokeStyle = met;
    ctx.lineWidth = 1;
    const n = kind === 'crown' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      // swept back off the skull so it reads as a mantle, not a sunburst
      const a = Math.PI + (i / (n - 1) - 0.5) * (kind === 'crown' ? 2.6 : 1.8);
      const wob = Math.sin(t * 1.6 + ph + i) * 0.06;
      seg(
        ctx,
        hx + Math.cos(a) * hr * 0.8,
        hy + Math.sin(a) * hr * 0.8,
        hx + Math.cos(a + wob) * hr * (kind === 'crown' ? 2.2 : 2.6),
        hy + Math.sin(a + wob) * hr * (kind === 'crown' ? 2.2 : 2.6)
      );
    }
  } else if (kind === 'optic') {
    ctx.fillStyle = shade(body, 0.4);
    ell(ctx, hx, hy, hr * 1.1, hr * 1.05);
    ctx.fillStyle = shade(trim || '#8fd6ff', 1.15);
    dot(ctx, hx + hr * 0.35, hy, hr * 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    dot(ctx, hx + hr * 0.58, hy - hr * 0.26, hr * 0.2);
  }
}

// -------------------------------------------------------------------------
// a small articulated top-down figure. local +x is the way it faces.
//   o: weapon/weaponColor/weaponLen/weaponKind, head (radius), blur, glow,
//      t, phase, vx/vy | gait | moving, pose, hurt/hitDir, recoil, reload,
//      death/deathDir, build {...}, muzzle (filled in with the barrel tip)
export function figure(ctx, x, y, ang, s, body, head, o) {
  o = o || NOB;
  const B = o.build || NOB;
  const t = o.t != null ? o.t : Date.now() * 0.001;
  const ph = o.phase || 0;
  const bulk = B.bulk || 1;

  // --- locomotion state
  let gait = o.gait;
  if (gait == null) {
    const sp = o.vx != null || o.vy != null ? Math.hypot(o.vx || 0, o.vy || 0) : 0;
    gait = sp > 0 ? clamp(sp / 200, 0, 1) : o.moving ? 0.5 : 0;
  }
  gait = clamp(gait, 0, 1);
  let pose = o.pose;
  if (!pose) pose = gait > 0.08 ? (gait > 0.6 ? 'run' : 'walk') : 'idle';
  if ((pose === 'walk' || pose === 'run') && gait < 0.15) gait = pose === 'run' ? 0.85 : 0.45;
  const die = pose === 'dead' ? clamp(o.death != null ? o.death : 1, 0, 1) : 0;
  const moving = !die && gait > 0.08;
  const hurt = clamp(o.hurt || 0, 0, 1);
  const recoil = clamp(o.recoil != null ? o.recoil : pose === 'fire' ? 1 : 0, 0, 1);
  const dip = pose === 'reload' ? clamp(o.reload != null ? o.reload : 1, 0, 1) : 0;
  const tuck = pose === 'dodge' ? 1 : 0;
  const kneel = B.kneel ? 1 : 0;

  const cyc = t * (5 + 8 * gait) + ph;
  const swing = moving ? Math.sin(cyc) : 0;
  const bob = moving ? Math.abs(Math.sin(cyc)) * (0.5 + 1.5 * gait) : Math.sin(t * 1.5 + ph) * 0.18;
  const breathe = moving ? 0 : Math.sin(t * 1.5 + ph) * 0.05;
  const sway = moving ? 0 : Math.sin(t * 0.42 + ph) * 0.6;
  const lean = (moving ? 0.5 + 1.4 * gait : 0) + tuck * 1.3 - die * 1.6 - kneel * 0.6;

  // --- world placement: hit jerk, death slump, vertical bob
  const hd = o.hitDir != null ? o.hitDir : ang + Math.PI;
  const jerk = hurt * 2.4 * s;
  const dd = o.deathDir != null ? o.deathDir : ang;
  const wx = x + Math.cos(hd) * jerk + Math.cos(dd) * die * 2.2 * s;
  const wy = y + Math.sin(hd) * jerk + Math.sin(dd) * die * 2.2 * s - bob * s;
  const twist = hurt * 0.22 + die * 0.55;

  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(ang + twist);
  ctx.scale(s * (1 - 0.1 * die), s * (1 + 0.16 * die));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 0;

  // key light folded into the local frame so the lit side stays put as it turns
  const ca = Math.cos(-ang);
  const sa = Math.sin(-ang);
  const lx = LIGHT_DIR.x * ca - LIGHT_DIR.y * sa;
  const ly = LIGHT_DIR.x * sa + LIGHT_DIR.y * ca;

  const dark = shade(body, 0.42);
  const mid = shade(body, 0.72);
  const lite = shade(body, 1.3);
  const trim = B.trim || null;

  // torso is a top-down shoulder mass: wider across than deep
  const D = 3.9 * bulk; // half depth, along facing
  const W = 5.6 * bulk; // half width, across
  const hipX = -2.5 * bulk + lean * 0.2;
  const shX = 0.5 + lean * 0.4 - recoil * 0.4;
  const shW = W * 0.9;
  const hr = (o.head || 3) * 0.66 * (B.bighead ? 1.3 : 1);
  const headX = D * 0.5 + lean * 0.5 - tuck * 0.7 - die * 0.8;

  // --- cloak / coat, behind everything
  if (B.cloak) {
    const flap = Math.sin(t * 2.2 + ph) * (0.7 + 1.8 * gait);
    ctx.fillStyle = shade(body, 0.32, 0.95);
    ctx.beginPath();
    ctx.moveTo(0.5, -W * 0.85);
    ctx.quadraticCurveTo(-5, -W * 1.25 + flap, -10 - gait * 2.5, -W * 0.5 + flap * 1.7);
    ctx.lineTo(-10 - gait * 2.5, W * 0.5 + flap * 1.7);
    ctx.quadraticCurveTo(-5, W * 1.25 + flap, 0.5, W * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(B.accent || trim || body, 1.1, 0.5);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  if (B.coatTails) {
    ctx.strokeStyle = shade(body, 0.5, 0.9);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const sd2 = i - 1.5;
      const w0 = Math.sin(t * 2.7 + ph + i * 1.2) * (0.5 + 0.9 * gait);
      ctx.beginPath();
      ctx.moveTo(-2.2, sd2 * 1.5);
      ctx.quadraticCurveTo(-5.5, sd2 * 2.4 + w0, -8.2 - Math.abs(sd2) * 0.7, sd2 * 3 + w0 * 1.8);
      ctx.stroke();
    }
  }

  // --- legs: knees under the hips, feet stepping out behind
  const legW = 2.4 * bulk;
  for (let i = 0; i < 2; i++) {
    const sd2 = i ? 1 : -1;
    const sw = moving ? swing * sd2 * (1.4 + 3.2 * gait) : sway * sd2 * 0.4;
    const splay = die * 2.6;
    const hy = sd2 * 1.5 * bulk;
    const kx = hipX - 1.3 + sw * 0.5 - tuck * 0.8 - kneel * 0.5;
    const ky = sd2 * (2.1 * bulk + splay * 0.5);
    const fx = hipX - 3.4 + sw - tuck * 1.6 - die * 1.2 + kneel * (sd2 > 0 ? 1.6 : -0.4);
    const fy = sd2 * (2.5 * bulk + splay);
    ctx.strokeStyle = INK;
    ctx.lineWidth = legW + 1;
    bone(ctx, hipX, hy, kx, ky, fx, fy);
    ctx.strokeStyle = sd2 * ly < 0 ? mid : dark;
    ctx.lineWidth = legW;
    bone(ctx, hipX, hy, kx, ky, fx, fy);
    if (B.greaves) {
      ctx.strokeStyle = shade(B.accent || trim || lite, 1, 0.7);
      ctx.lineWidth = legW * 0.4;
      seg(ctx, hipX - 0.4, hy, kx, ky);
    }
    const fa = Math.atan2(fy - ky, fx - kx);
    ctx.fillStyle = INK;
    ell(ctx, fx - 0.2, fy, 1.9 * bulk, 1.4 * bulk, fa);
    ctx.fillStyle = B.boots ? shade(trim || body, 0.3) : dark;
    ell(ctx, fx - 0.2, fy, 1.6 * bulk, 1.1 * bulk, fa);
  }

  // --- torso: hips, then the shoulder mass on top
  const bw = 1 + breathe;
  ctx.fillStyle = INK;
  ell(ctx, hipX * 0.62, 0, D * 0.9 + 0.5, W * 0.7 + 0.5);
  ctx.fillStyle = dark;
  ell(ctx, hipX * 0.62, 0, D * 0.9, W * 0.7);
  ctx.fillStyle = INK;
  ell(ctx, lean * 0.25, sway * 0.2, D * bw + 0.5, W * bw + 0.5);
  ctx.fillStyle = mid;
  ell(ctx, lean * 0.25, sway * 0.2, D * bw, W * bw);
  ctx.fillStyle = shade(body, 1.5, 0.32);
  ell(ctx, -lx * D * 0.4 + lean * 0.25, -ly * W * 0.4, D * 0.58, W * 0.58);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ell(ctx, lx * D * 0.55, ly * W * 0.55, D * 0.45, W * 0.42);
  if (B.insectoid) {
    ctx.strokeStyle = shade(body, 0.32, 0.85);
    ctx.lineWidth = 0.7;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(-1, 0, D * (0.55 + i * 0.2), W * (0.6 + i * 0.18), 0, -1.2, 1.2);
      ctx.stroke();
    }
  }

  // vest webbing / harness
  if (B.vest) {
    ctx.strokeStyle = shade(trim || body, 0.34, 0.95);
    ctx.lineWidth = 1.2;
    seg(ctx, shX + 0.6, -W * 0.5, hipX + 0.6, W * 0.45);
    ctx.lineWidth = 0.9;
    seg(ctx, shX + 0.2, W * 0.5, hipX + 0.4, -W * 0.4);
    ctx.fillStyle = shade(B.accent || trim || lite, 1, 0.9);
    ell(ctx, 0.6, -W * 0.4, 1.1, 1.3);
    ell(ctx, 0.6, W * 0.4, 1.1, 1.3);
  }
  // frontal slab of plate — hugs the chest, reads only from the front arc
  if (B.plate) {
    ctx.strokeStyle = shade(B.accent || trim || lite, 0.95, 0.8);
    ctx.lineWidth = (B.plate === 'heavy' ? 2 : 1.2) * bulk;
    ctx.beginPath();
    ctx.ellipse(lean * 0.25, 0, D * 0.82, W * 0.82, 0, -1.15, 1.15);
    ctx.stroke();
    if (B.plate === 'heavy') {
      ctx.strokeStyle = shade(trim || lite, 0.6, 0.8);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(lean * 0.25, 0, D * 0.44, W * 0.46, 0, -1, 1);
      ctx.stroke();
    }
  }
  if (B.pauldrons) {
    const pc = shade(trim || body, 1.05);
    for (let i = -1; i <= 1; i += 2) {
      ctx.fillStyle = INK;
      ell(ctx, shX - 0.4, i * W * 0.88, 2.3 * bulk, 1.9 * bulk, i * 0.4);
      ctx.fillStyle = pc;
      ell(ctx, shX - 0.4, i * W * 0.88, 1.9 * bulk, 1.5 * bulk, i * 0.4);
    }
  } else if (B.spikes) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    seg(ctx, shX - 0.6, -W * 0.78, shX - 3.4, -W * 1.15);
    seg(ctx, shX - 0.6, W * 0.78, shX - 3.4, W * 1.15);
    ctx.strokeStyle = shade(body, 0.55);
    ctx.lineWidth = 1.3;
    seg(ctx, shX - 0.6, -W * 0.78, shX - 3.4, -W * 1.15);
    seg(ctx, shX - 0.6, W * 0.78, shX - 3.4, W * 1.15);
  } else {
    // plain shoulder bar keeps the old readable silhouette
    ctx.strokeStyle = shade(body, 0.5);
    ctx.lineWidth = 2 * bulk;
    seg(ctx, shX - 0.2, -W * 0.9, shX - 0.2, W * 0.9);
  }

  // --- arms + weapon
  const gloveCol = B.glove || shade(body, 0.38);
  if (o.weapon !== false) {
    const wk = WEAPON_SHAPE[o.weaponKind] || GENERIC_W;
    const tipX = o.weaponLen != null ? o.weaponLen : wk.len;
    const col = o.weaponColor || wk.col || '#e8f4ff';
    const sd = o.weaponSide === -1 ? -1 : 1;
    const m = drawWeapon(ctx, o, wk, tipX, col, sd, recoil, dip, shX, shW, t, ph, gloveCol);
    const cs = Math.cos(ang + twist);
    const sn = Math.sin(ang + twist);
    const mwx = wx + (m.x * cs - m.y * sn) * s;
    const mwy = wy + (m.x * sn + m.y * cs) * s;
    if (o.muzzle) {
      o.muzzle.x = mwx;
      o.muzzle.y = mwy;
    } else o.muzzle = { x: mwx, y: mwy };
  } else {
    // free arms swing opposite the legs
    for (let i = 0; i < 2; i++) {
      const sd2 = i ? 1 : -1;
      const sw = moving ? -swing * sd2 * (1 + 2 * gait) : sway * sd2 * 0.3;
      const ex = shX + 2.6 + sw;
      const ey = sd2 * (W * 0.72);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      bone(ctx, shX, sd2 * shW, shX + 1.2 + sw * 0.5, sd2 * W * 0.95, ex, ey);
      ctx.strokeStyle = gloveCol;
      ctx.lineWidth = 1.4;
      bone(ctx, shX, sd2 * shW, shX + 1.2 + sw * 0.5, sd2 * W * 0.95, ex, ey);
      if (B.claws) {
        ctx.lineWidth = 0.85;
        ctx.strokeStyle = shade(body, 1.6, 0.9);
        seg(ctx, ex, ey, ex + 1.8, ey + sd2 * 0.7);
        seg(ctx, ex, ey, ex + 1.6, ey - sd2 * 0.4);
      }
      if (o.handGlow && i === 1) {
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = o.handGlow;
        ctx.fillStyle = o.handGlow;
        dot(ctx, ex + 0.8, ey, 1.4);
        ctx.restore();
      }
    }
  }

  // --- head, seated into the shoulders
  const hy0 = sway * 0.35;
  ctx.fillStyle = INK;
  dot(ctx, headX, hy0, hr + 0.5);
  ctx.fillStyle = head;
  dot(ctx, headX, hy0, hr);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ell(ctx, headX + lx * hr * 0.42, hy0 + ly * hr * 0.42, hr * 0.72, hr * 0.72);
  if (B.helm) drawHelm(ctx, B.helm, headX, sway * 0.35, hr, body, head, trim, t, ph, B.accent);
  if (B.visor) {
    ctx.strokeStyle = shade(B.visor === true ? '#7fe6ff' : B.visor, 1.2, 0.95);
    ctx.lineWidth = 0.9;
    seg(ctx, headX + hr * 0.55, -hr * 0.8, headX + hr * 0.55, hr * 0.8);
  }

  // --- one cheap glow pass keeps the neon read without blurring every stroke
  const blur = o.blur == null ? 10 : o.blur;
  if (blur > 0) {
    ctx.shadowBlur = blur;
    ctx.shadowColor = o.glow || body;
    ctx.strokeStyle = shade(body, 1.7, 0.24);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(lean * 0.25, 0, D * 1.06, W * 1.06, 0, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// -------------------------------------------------------------------------
// replicator: a skittering block-spider. `o`: t, phase, legs, brute, rate,
// eye, emitter (0..1 loom glow), weaveColor
export function spider(ctx, x, y, ang, s, color, o) {
  o = o || NOB;
  const t = o.t != null ? o.t : Date.now() * 0.001;
  const ph = o.phase || 0;
  const n = o.legs || 6;
  const mid = shade(color, 0.9);
  const lt = shade(color, 1.5);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(s, s);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  // legs first: two segments each, tips stepping around the body
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? mid : INK;
    ctx.lineWidth = pass ? 0.9 : 1.9;
    for (let i = 0; i < n; i++) {
      const base = (i / n) * TAU + 0.4;
      const step = Math.sin(t * (o.rate || 9) + ph + i * 2.1);
      const a = base + step * 0.18;
      const r2 = 4.8 + step * 0.6;
      const kx = Math.cos(base) * 2.2;
      const ky = Math.sin(base) * 2.2;
      bone(
        ctx,
        Math.cos(base) * 1.1,
        Math.sin(base) * 1.1,
        kx + Math.cos(a - 0.5) * 1.6,
        ky + Math.sin(a - 0.5) * 1.6,
        Math.cos(a) * r2,
        Math.sin(a) * r2
      );
    }
  }

  // core: a few offset blocks that never quite line up
  const jit = Math.sin(t * 6 + ph) * 0.12;
  const cells = o.brute ? 5 : 3;
  for (let i = 0; i < cells; i++) {
    const a = (i / cells) * TAU + t * 0.6 + ph;
    const rr = i === 0 ? 0 : o.brute ? 2 : 1.5;
    const w = (i === 0 ? 3.1 : 2) * (o.brute ? 1.15 : 1);
    ctx.save();
    ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
    ctx.rotate(a * 0.3 + jit);
    ctx.fillStyle = INK;
    ctx.fillRect(-w - 0.5, -w - 0.5, w * 2 + 1, w * 2 + 1);
    ctx.fillStyle = i === 0 ? shade(color, 0.45) : shade(color, 0.3);
    ctx.fillRect(-w, -w, w * 2, w * 2);
    ctx.strokeStyle = i === 0 ? lt : mid;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-w, -w, w * 2, w * 2);
    ctx.strokeStyle = shade(color, 0.7, 0.7);
    ctx.lineWidth = 0.5;
    seg(ctx, -w, 0, w, 0);
    seg(ctx, 0, -w, 0, w);
    ctx.restore();
  }
  // crystalline shimmer: a travelling highlight across the cluster
  const sh = (t * 0.7 + ph) % 1;
  ctx.strokeStyle = shade(color, 1.9, 0.4);
  ctx.lineWidth = 0.8;
  seg(ctx, -4.5 + sh * 9, -4, -4.5 + sh * 9 - 1.7, 4);

  // forward sensor pips
  ctx.fillStyle = shade(o.eye || '#dff6ff', 1, 0.95);
  dot(ctx, 3.6, -1.1, 0.6);
  dot(ctx, 3.6, 1.1, 0.6);

  // weaver loom arm
  if (o.emitter != null) {
    const e = clamp(o.emitter, 0, 1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    bone(ctx, 1.5, -2.6, 4.2, -4.4, 6.6 + e * 1.2, -3.4);
    ctx.strokeStyle = shade(color, 1.2);
    ctx.lineWidth = 1;
    bone(ctx, 1.5, -2.6, 4.2, -4.4, 6.6 + e * 1.2, -3.4);
    if (e > 0.01) {
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = o.weaveColor || '#9fe8ff';
      ctx.fillStyle = shade(o.weaveColor || '#9fe8ff', 1.4, 0.5 + 0.5 * e);
      dot(ctx, 6.6 + e * 1.2, -3.4, 1 + e * 1.2);
      ctx.restore();
    }
  }
  ctx.restore();
}

// -------------------------------------------------------------------------
// scavenger: a small skittish drone. no weapon, one big optic, all flinch.
export function critter(ctx, x, y, ang, s, color, o) {
  o = o || NOB;
  const t = o.t != null ? o.t : Date.now() * 0.001;
  const ph = o.phase || 0;
  const gait = clamp(o.gait || 0, 0, 1);
  const startle = clamp(o.startle || 0, 0, 1);
  const cyc = t * (7 + 12 * gait) + ph;
  const shiver = startle ? Math.sin(t * 34 + ph) * 0.5 * startle : 0;
  ctx.save();
  ctx.translate(x + shiver, y - Math.abs(Math.sin(cyc)) * gait * 1.3);
  ctx.rotate(ang + shiver * 0.08);
  ctx.scale(s, s);
  ctx.lineCap = 'round';

  // four scuttling legs
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? shade(color, 0.5) : INK;
    ctx.lineWidth = pass ? 1 : 2;
    for (let i = 0; i < 4; i++) {
      const sd = i < 2 ? -1 : 1;
      const fwd = i % 2 ? 1 : -1;
      const st = Math.sin(cyc + i * 1.7) * (0.6 + 2 * gait);
      bone(ctx, fwd * 1.4, sd * 1.6, fwd * 2 + st * 0.4, sd * 3, fwd * 2.3 + st, sd * 4.2);
    }
  }
  // chassis
  ctx.fillStyle = INK;
  ell(ctx, -0.3, 0, 4, 3.3);
  ctx.fillStyle = shade(color, 0.75);
  ell(ctx, -0.3, 0, 3.5, 2.8);
  ctx.fillStyle = shade(color, 1.35, 0.45);
  ell(ctx, -1.1, -0.9, 2, 1.3);
  // hunched cowl + big optic
  ctx.fillStyle = shade(color, 0.4);
  ell(ctx, 2.5, 0, 2.3, 2.1);
  ctx.fillStyle = shade(o.eye || '#bfe8ff', 1.15);
  dot(ctx, 3.1, 0, 1.4);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  dot(ctx, 3.5, -0.45, 0.42);
  // antenna, flicks when spooked
  ctx.strokeStyle = shade(color, 0.55);
  ctx.lineWidth = 0.7;
  seg(ctx, 0.4, -2, -1.6 + shiver, -4.2 - startle * 1.2);
  ctx.restore();
}
