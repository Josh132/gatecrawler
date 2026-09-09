// procedural texture primitives for the world bake. Everything here is pure
// canvas + a passed rand() so a world's material is deterministic, and nothing
// loads an external asset (the app runs under a no-network CSP).
//
// the usual shape is: build a small seamless tile canvas once per bake, then
// createPattern it over the whole floor / wall mass. per-pixel work is confined
// to those small tiles; anything map-wide is plain canvas geometry.

// a repeating fill for `tile`, or a flat fallback where patterns aren't
// available (the headless harness's mock 2d context)
export function pattern(c, tile, fallback) {
  return c.createPattern ? c.createPattern(tile, 'repeat') : fallback;
}

export function canv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---- colour ----------------------------------------------------------------

export function hexRgb(h) {
  const s = String(h).replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a, b, t) {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  const v = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return '#' + [v(0), v(1), v(2)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function rgba(h, a) {
  const c = hexRgb(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// 256-entry colour lookup built from [t, hex] stops — keeps per-pixel work cheap
export function ramp(stops) {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && stops[k + 1][0] < t) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[Math.min(k + 1, stops.length - 1)];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    const a = hexRgb(c0);
    const b = hexRgb(c1);
    lut[i * 3] = a[0] + (b[0] - a[0]) * f;
    lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
    lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
  }
  return lut;
}

// stable per-tile variation — order-independent, unlike pulling from an rng
export function hash2(x, y, salt) {
  let n = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) >>> 0;
  n = Math.imul(n ^ (n >>> 15), 2246822507);
  n = Math.imul(n ^ (n >>> 13), 3266489909);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ---- fields ----------------------------------------------------------------

const sm = (t) => t * t * (3 - 2 * t);

// seamless fractal value noise, 0..1, wrapping on both axes so the tile repeats
export function fbm(w, h, rand, o) {
  o = o || {};
  const oct = o.octaves || 4;
  const gain = o.gain == null ? 0.5 : o.gain;
  const out = new Float32Array(w * h);
  let cells = o.cells || 4;
  let amp = 1;
  let tot = 0;
  for (let k = 0; k < oct; k++) {
    const n = cells;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lat[i] = rand();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * n;
      const yi = Math.floor(fy);
      const y0 = yi % n;
      const y1 = (y0 + 1) % n;
      const ty = sm(fy - yi);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * n;
        const xi = Math.floor(fx);
        const x0 = xi % n;
        const x1 = (x0 + 1) % n;
        const tx = sm(fx - xi);
        const a = lat[y0 * n + x0];
        const b = lat[y0 * n + x1];
        const cc = lat[y1 * n + x0];
        const d = lat[y1 * n + x1];
        const u = a + (b - a) * tx;
        out[y * w + x] += amp * (u + (cc + (d - cc) * tx - u) * ty);
      }
    }
    tot += amp;
    amp *= gain;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// per-pixel composer — fn(x, y, o) writes r,g,b(,a) into the 4-slot array o
export function pixels(cv, fn) {
  const c = cv.getContext('2d');
  // the headless test harness mocks 2d with a no-op context — skip quietly
  if (!c.createImageData || !c.putImageData) return cv;
  const img = c.createImageData(cv.width, cv.height);
  const d = img.data;
  const o = [0, 0, 0, 255];
  for (let y = 0, i = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++, i += 4) {
      o[3] = 255;
      fn(x, y, o);
      d[i] = o[0];
      d[i + 1] = o[1];
      d[i + 2] = o[2];
      d[i + 3] = o[3];
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

// sample a ramp LUT into o
export function lut(l, t, o) {
  const k = (t < 0 ? 0 : t > 1 ? 255 : (t * 255) | 0) * 3;
  o[0] = l[k];
  o[1] = l[k + 1];
  o[2] = l[k + 2];
}

// ---- wrapped drawing -------------------------------------------------------

// call draw(x, y) for every wrapped copy a mark of radius r needs, so blobs and
// speckles laid on a pattern tile don't cut off at its seam
export function wrapAt(w, h, x, y, r, draw) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const px = x + dx * w;
      const py = y + dy * h;
      if (px + r < 0 || py + r < 0 || px - r > w || py - r > h) continue;
      draw(px, py);
    }
  }
}

// ---- material geometry -----------------------------------------------------

// rows of blocks with mortar gaps and per-block tone jitter. Rows always start
// and end on a joint so the tile stays seamless; `h` should divide by course.
export function ashlar(c, w, h, rand, o) {
  o = o || {};
  const course = o.course || 17;
  const minW = o.minW || 22;
  const maxW = o.maxW || 44;
  const gap = o.gap == null ? 2 : o.gap;
  const jitter = o.jitter == null ? 0.09 : o.jitter;
  const light = o.light || '#ffffff';
  const dark = o.dark || '#000000';
  const joint = o.joint || rgba(dark, 0.45);
  c.save();
  for (let y = 0; y < h; y += course) {
    // pick block widths that sum to exactly w so the seam lands on a joint
    const widths = [];
    let left = w;
    while (left > 0) {
      let bw = Math.round(minW + rand() * (maxW - minW));
      if (left - bw < minW) bw = left;
      widths.push(bw);
      left -= bw;
    }
    c.fillStyle = joint;
    c.fillRect(0, y, w, gap);
    let x = 0;
    for (const bw of widths) {
      c.fillStyle = joint;
      c.fillRect(x, y, gap, course);
      const t = (rand() - 0.5) * 2 * jitter;
      c.fillStyle = rgba(t > 0 ? light : dark, Math.abs(t));
      c.fillRect(x + gap, y + gap, bw - gap, course - gap);
      if (o.bevel) {
        c.fillStyle = rgba(light, o.bevel);
        c.fillRect(x + gap, y + gap, bw - gap, 1);
        c.fillStyle = rgba(dark, o.bevel * 1.4);
        c.fillRect(x + gap, y + course - 1, bw - gap, 1);
      }
      x += bw;
    }
  }
  c.restore();
}

// horizontal sedimentary bands — thin strata of shifting tone
export function strata(c, w, h, rand, o) {
  o = o || {};
  const light = o.light || '#ffffff';
  const dark = o.dark || '#000000';
  let y = 0;
  while (y < h) {
    const bh = Math.max(1, Math.round((o.min || 2) + rand() * ((o.max || 7) - (o.min || 2))));
    const t = (rand() - 0.5) * 2 * (o.jitter || 0.12);
    c.fillStyle = rgba(t > 0 ? light : dark, Math.abs(t));
    c.fillRect(0, y, w, Math.min(bh, h - y));
    if (rand() < (o.seam || 0.25)) {
      c.fillStyle = rgba(dark, 0.16);
      c.fillRect(0, y, w, 1);
    }
    y += bh;
  }
}

// straight seams on a fixed pitch — deck plates, panels, planks
export function seams(c, w, h, o) {
  o = o || {};
  const px = o.px || 0;
  const py = o.py || 0;
  c.fillStyle = o.dark || 'rgba(0,0,0,0.35)';
  if (px) for (let x = 0; x < w; x += px) c.fillRect(x, 0, o.wide || 2, h);
  if (py) for (let y = 0; y < h; y += py) c.fillRect(0, y, w, o.wide || 2);
  if (!o.light) return;
  c.fillStyle = o.light;
  if (px) for (let x = 0; x < w; x += px) c.fillRect(x + (o.wide || 2), 0, 1, h);
  if (py) for (let y = 0; y < h; y += py) c.fillRect(0, y + (o.wide || 2), w, 1);
}

// meandering hairline cracks with the odd fork
export function cracks(c, w, h, rand, o) {
  o = o || {};
  const n = o.count || 6;
  c.save();
  c.strokeStyle = o.color || 'rgba(0,0,0,0.4)';
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = rand() * w;
    let y = rand() * h;
    let a = rand() * Math.PI * 2;
    const segs = 4 + ((rand() * (o.segs || 8)) | 0);
    c.lineWidth = o.width || 1;
    c.beginPath();
    c.moveTo(x, y);
    for (let s = 0; s < segs; s++) {
      a += (rand() - 0.5) * (o.wander || 1.1);
      x += Math.cos(a) * (o.step || 7);
      y += Math.sin(a) * (o.step || 7);
      c.lineTo(x, y);
      if (rand() < 0.18) {
        const ba = a + (rand() - 0.5) * 2;
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(ba) * 6, y + Math.sin(ba) * 6);
        c.moveTo(x, y);
      }
    }
    c.stroke();
  }
  c.restore();
}

// soft stains / patches — wrapped, so they survive being used as a pattern
export function splotch(c, w, h, rand, o) {
  o = o || {};
  const n = o.count || 8;
  const col = o.color || '#000000';
  for (let i = 0; i < n; i++) {
    const r = (o.min || 8) + rand() * ((o.max || 26) - (o.min || 8));
    const x = rand() * w;
    const y = rand() * h;
    const a = (o.alpha || 0.2) * (0.5 + rand() * 0.5);
    wrapAt(w, h, x, y, r, (px, py) => {
      const g = c.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(o.hard || 0.55, rgba(col, a * 0.6));
      g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g;
      c.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
}

// tiny bright dots — frost glitter, mineral flecks, sand grains
export function speckle(c, w, h, rand, o) {
  o = o || {};
  const n = o.count || 200;
  for (let i = 0; i < n; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const s = (o.min || 0.6) + rand() * ((o.max || 1.6) - (o.min || 0.6));
    c.fillStyle = rgba(o.color || '#ffffff', (o.alpha || 0.3) * rand());
    c.fillRect(x, y, s, s);
  }
}

// directional streaks — wind grain, brushed metal, ice refraction
export function grain(c, w, h, rand, o) {
  o = o || {};
  const n = o.count || 90;
  const ang = o.angle || 0;
  c.save();
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = (o.min || 10) + rand() * ((o.max || 40) - (o.min || 10));
    const a = ang + (rand() - 0.5) * (o.spread || 0.15);
    c.strokeStyle = rgba(rand() < 0.5 ? o.light || '#ffffff' : o.dark || '#000000', (o.alpha || 0.06) * rand());
    c.lineWidth = o.width || 1;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }
  c.restore();
}

// scattered pebbles with a contact shadow
export function pebbles(c, w, h, rand, o) {
  o = o || {};
  const n = o.count || 40;
  for (let i = 0; i < n; i++) {
    const r = (o.min || 1.2) + rand() * ((o.max || 3.4) - (o.min || 1.2));
    const x = rand() * w;
    const y = rand() * h;
    wrapAt(w, h, x, y, r + 2, (px, py) => {
      c.fillStyle = rgba(o.shadow || '#000000', 0.28);
      c.beginPath();
      c.ellipse(px + 1, py + 1.2, r * 1.05, r * 0.8, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = rgba(o.color || '#ffffff', o.alpha == null ? 0.5 : o.alpha);
      c.beginPath();
      c.ellipse(px, py, r, r * 0.78, 0, 0, Math.PI * 2);
      c.fill();
    });
  }
}

// bolt / rivet studs at the given points
export function rivets(c, pts, o) {
  o = o || {};
  const r = o.r || 1.6;
  for (const [x, y] of pts) {
    c.fillStyle = o.dark || 'rgba(0,0,0,0.45)';
    c.beginPath();
    c.arc(x, y + 0.7, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = o.light || 'rgba(255,255,255,0.3)';
    c.beginPath();
    c.arc(x, y, r * 0.8, 0, Math.PI * 2);
    c.fill();
  }
}

// yellow/black diagonal warning band
export function hazard(c, x, y, w, h, o) {
  o = o || {};
  const pitch = o.pitch || 12;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.fillStyle = o.base || '#1a1712';
  c.fillRect(x, y, w, h);
  c.fillStyle = o.stripe || '#c9a227';
  c.globalAlpha = o.alpha == null ? 0.85 : o.alpha;
  for (let i = -h; i < w + h; i += pitch * 2) {
    c.beginPath();
    c.moveTo(x + i, y + h);
    c.lineTo(x + i + pitch, y + h);
    c.lineTo(x + i + pitch + h, y);
    c.lineTo(x + i + h, y);
    c.closePath();
    c.fill();
  }
  c.restore();
}

// recursive branching growth — vines, sinew, root systems, veins in ice
export function vein(c, x, y, ang, len, depth, rand, o) {
  o = o || {};
  if (depth <= 0 || len < 2) return;
  const segs = o.segs || 4;
  c.beginPath();
  c.moveTo(x, y);
  let px = x;
  let py = y;
  let a = ang;
  for (let i = 0; i < segs; i++) {
    a += (rand() - 0.5) * (o.wander || 0.7);
    px += Math.cos(a) * (len / segs);
    py += Math.sin(a) * (len / segs);
    c.lineTo(px, py);
  }
  c.lineWidth = Math.max(0.5, depth * (o.width || 0.7));
  c.stroke();
  if (o.node && depth <= (o.nodeAt || 2) && rand() < 0.6) {
    c.save();
    c.fillStyle = o.node;
    c.beginPath();
    c.arc(px, py, (o.nodeR || 2) * (0.6 + rand() * 0.6), 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  const forks = rand() < (o.forkChance == null ? 0.75 : o.forkChance) ? 2 : 1;
  for (let f = 0; f < forks; f++) {
    vein(c, px, py, a + (rand() - 0.5) * (o.spread || 1.3), len * (o.decay || 0.66), depth - 1, rand, o);
  }
}

// a fern / frond silhouette — one arching stem with paired leaflets
export function frond(c, x, y, ang, len, o) {
  o = o || {};
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.strokeStyle = o.color || 'rgba(0,0,0,0.5)';
  c.lineWidth = o.width || 1.2;
  c.lineCap = 'round';
  const bend = o.bend || 0.5;
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(len * 0.5, -len * bend * 0.3, len, -len * bend);
  c.stroke();
  const n = o.leaves || 7;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const bx = len * t;
    const by = -len * bend * t * t;
    const ll = len * 0.24 * (1 - t * 0.6);
    c.lineWidth = (o.width || 1.2) * 0.75;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx + ll * 0.5, by + s * ll);
      c.stroke();
    }
  }
  c.restore();
}

// faceted crystal / ice shard cluster
export function shards(c, x, y, n, size, rand, o) {
  o = o || {};
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * (o.spread || 1.4);
    const l = size * (0.45 + rand() * 0.75);
    const wgt = l * (0.14 + rand() * 0.12);
    const bx = x + (rand() - 0.5) * size;
    const by = y + (rand() - 0.5) * size * 0.35;
    c.beginPath();
    c.moveTo(bx + Math.cos(a) * l, by + Math.sin(a) * l);
    c.lineTo(bx - Math.sin(a) * wgt, by + Math.cos(a) * wgt);
    c.lineTo(bx + Math.sin(a) * wgt, by - Math.cos(a) * wgt);
    c.closePath();
    c.fillStyle = o.fill || 'rgba(200,240,255,0.35)';
    c.fill();
    if (o.edge) {
      c.strokeStyle = o.edge;
      c.lineWidth = o.width || 0.8;
      c.stroke();
    }
  }
}

// a soft light pool on the ground — torches, sun shafts, bioluminescence
export function pool(c, x, y, r, color, alpha) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.45));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

// ambient occlusion strip along one edge of a tile (dir: 0 n, 1 e, 2 s, 3 w)
export function edgeAO(c, x, y, size, dir, depth, color) {
  const d = Math.min(depth, size);
  const pts = [
    [x, y, x, y + d],
    [x + size, y, x + size - d, y],
    [x, y + size, x, y + size - d],
    [x, y, x + d, y],
  ][dir];
  const g = c.createLinearGradient(pts[0], pts[1], pts[2], pts[3]);
  g.addColorStop(0, rgba(color || '#000000', 0.42));
  g.addColorStop(1, rgba(color || '#000000', 0));
  c.fillStyle = g;
  if (dir === 0) c.fillRect(x, y, size, d);
  else if (dir === 1) c.fillRect(x + size - d, y, d, size);
  else if (dir === 2) c.fillRect(x, y + size - d, size, d);
  else c.fillRect(x, y, d, size);
}

// ---- monumental (goa'uld) & natural (outdoor) props ----------------------

// gold-leaf trim: a bright edge line with a soft inward bloom
export function gild(c, x, y, w, h, o) {
  o = o || {};
  const g = o.gold || '#e8c46a';
  const hi = o.hi || '#fff0c0';
  c.save();
  const gr = c.createLinearGradient(x, y, x, y + h);
  gr.addColorStop(0, rgba(hi, 0.9));
  gr.addColorStop(0.5, rgba(g, 0.82));
  gr.addColorStop(1, rgba(g, 0.18));
  c.fillStyle = gr;
  c.fillRect(x, y, w, h);
  c.fillStyle = rgba(hi, 0.95);
  c.fillRect(x, y, w, Math.max(1, h * 0.24));
  c.fillStyle = rgba('#5c3d0c', 0.5);
  c.fillRect(x, y + h - 1, w, 1);
  c.restore();
}

// a band of procedural hieroglyphs — gold glyphs on a sunk shadow channel
export function frieze(c, x, y, w, h, seed, o) {
  o = o || {};
  const gold = o.gold || '#e8c46a';
  const bg = o.bg == null ? 'rgba(0,0,0,0.4)' : o.bg;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  if (bg) {
    c.fillStyle = bg;
    c.fillRect(x, y, w, h);
  }
  const cell = o.cell || Math.max(6, h * 0.9);
  let i = 0;
  for (let gx = x + 2; gx < x + w - 2; gx += cell, i++) {
    const s = hash2(i * 13 + 1, seed | 0, 41);
    const s2 = hash2(i * 7 + 5, seed | 0, 97);
    const gy = y + h * 0.1;
    const gh = h * 0.8;
    const gw = cell * 0.62;
    c.fillStyle = rgba(gold, 0.42 + s * 0.42);
    if (s < 0.22) {
      // seated figure / offering
      c.fillRect(gx + gw * 0.4, gy, 2, gh);
      c.fillRect(gx, gy + gh * 0.3, gw, 2);
      c.beginPath();
      c.arc(gx + gw * 0.46, gy + gh * 0.14, gw * 0.26, 0, 7);
      c.fill();
    } else if (s < 0.44) {
      // bird
      c.fillRect(gx, gy + gh * 0.52, gw, 2);
      c.fillRect(gx + gw * 0.12, gy + gh * 0.52, 2, gh * 0.36);
      c.beginPath();
      c.moveTo(gx, gy + gh * 0.52);
      c.lineTo(gx + gw * 0.5, gy + gh * 0.2);
      c.lineTo(gx + gw, gy + gh * 0.52);
      c.fill();
    } else if (s < 0.63) {
      // eye of horus
      c.beginPath();
      c.ellipse(gx + gw * 0.5, gy + gh * 0.44, gw * 0.5, gh * 0.3, 0, 0, 7);
      c.fill();
      c.fillStyle = typeof bg === 'string' ? bg : 'rgba(0,0,0,0.5)';
      c.beginPath();
      c.ellipse(gx + gw * 0.5, gy + gh * 0.44, gw * 0.28, gh * 0.15, 0, 0, 7);
      c.fill();
      c.fillStyle = rgba(gold, 0.7);
      c.fillRect(gx + gw * 0.5, gy + gh * 0.62, gw * 0.42, 2);
    } else if (s < 0.82) {
      // water / n-glyph
      for (let k = 0; k < 3; k++) c.fillRect(gx, gy + gh * (0.2 + k * 0.3), gw, 2);
    } else {
      // was-sceptre / staff
      c.fillRect(gx + gw * 0.42, gy, 2, gh);
      c.fillRect(gx + gw * 0.42 - 2, gy, 6, 3);
      if (s2 > 0.5) c.fillRect(gx + gw * 0.42 - 3, gy + gh - 3, 8, 3);
    }
  }
  c.restore();
}

// an oval gold cartouche frame with a few glyph strokes inside
export function cartouche(c, x, y, w, h, seed, o) {
  o = o || {};
  const gold = o.gold || '#e8c46a';
  const r = h / 2;
  if (w < h + 4) return;
  c.save();
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  c.lineTo(x + r, y + h);
  c.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  c.closePath();
  c.fillStyle = rgba(o.fill || '#1c1206', o.fillA == null ? 0.5 : o.fillA);
  c.fill();
  c.strokeStyle = rgba(gold, 0.82);
  c.lineWidth = o.lw || 2;
  c.stroke();
  c.fillStyle = rgba(gold, 0.6);
  const n = Math.max(1, (w / 9) | 0);
  for (let i = 0; i < n; i++) {
    const s = hash2(i * 5 + 2, seed | 0, 61);
    const gx = x + r + 2 + i * ((w - r * 2 - 4) / n);
    if (s < 0.5) c.fillRect(gx, y + h * 0.24, 2, h * 0.52);
    else {
      c.fillRect(gx, y + h * 0.34, 4, 2);
      c.fillRect(gx + 1, y + h * 0.34, 2, h * 0.42);
    }
  }
  c.restore();
}

// rayed sun-disc medallion (Ra): concentric gold rings + radiating rays
export function sunDisc(c, x, y, r, o) {
  o = o || {};
  const gold = o.gold || '#e8c46a';
  const deep = o.deep || '#8a5a1c';
  c.save();
  c.translate(x, y);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(o.core || '#ffdd90', o.coreA == null ? 0.4 : o.coreA));
  g.addColorStop(0.5, rgba(gold, 0.2));
  g.addColorStop(1, rgba(gold, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = rgba(gold, o.line == null ? 0.45 : o.line);
  c.lineWidth = o.lw || 2;
  for (const k of [1, 0.62, 0.32]) {
    c.beginPath();
    c.arc(0, 0, r * k, 0, Math.PI * 2);
    c.stroke();
  }
  c.lineWidth = 1.4;
  const rays = o.rays || 24;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const r0 = r * 0.66;
    const r1 = r * (i % 2 ? 0.99 : 0.88);
    c.strokeStyle = rgba(i % 2 ? gold : deep, 0.42);
    c.beginPath();
    c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    c.stroke();
  }
  c.fillStyle = rgba(o.core || '#ffdd90', 0.26);
  c.beginPath();
  c.arc(0, 0, r * 0.19, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// a standing obelisk drawn into a wall-tile column: tapering gilt-capped shaft
// with a glyph column. (x,y) = tile top-left, w/h = tile size, lift = px the
// pyramidion rises above the tile top.
export function obelisk(c, x, y, w, h, lift, seed, o) {
  o = o || {};
  const stone = o.stone || '#c9a25a';
  const shade = o.shade || '#5c3f18';
  const gold = o.gold || '#f0d182';
  const baseW = w * 0.66;
  const tipW = w * 0.32;
  const cx = x + w / 2;
  const top = y - lift;
  const bot = y + h;
  const capY = top + w * 0.5;
  const halfAt = (yy) => {
    const t = (bot - yy) / (bot - capY);
    return (tipW + (baseW - tipW) * Math.max(0, Math.min(1, 1 - t))) / 2;
  };
  const hb = baseW / 2;
  const ht = tipW / 2;
  c.save();
  // shaft
  c.beginPath();
  c.moveTo(cx - hb, bot);
  c.lineTo(cx - ht, capY);
  c.lineTo(cx + ht, capY);
  c.lineTo(cx + hb, bot);
  c.closePath();
  const g = c.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, rgba(shade, 0.95));
  g.addColorStop(0.42, rgba(mix(stone, '#fff2cc', 0.28), 0.98));
  g.addColorStop(1, rgba(shade, 0.95));
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = rgba(shade, 0.7);
  c.lineWidth = 1;
  c.stroke();
  // pyramidion
  c.beginPath();
  c.moveTo(cx - ht, capY);
  c.lineTo(cx, top);
  c.lineTo(cx + ht, capY);
  c.closePath();
  c.fillStyle = rgba(gold, 0.95);
  c.fill();
  c.fillStyle = rgba('#fff6d8', 0.7);
  c.beginPath();
  c.moveTo(cx, top);
  c.lineTo(cx - 1.5, capY);
  c.lineTo(cx + 1, capY);
  c.fill();
  // glyph column
  c.fillStyle = rgba(shade, 0.5);
  for (let i = 0; capY + 6 + i * 7 < bot - 4; i++) {
    const s = hash2(i, seed | 0, 29);
    const gy = capY + 6 + i * 7;
    if (halfAt(gy) < 3) continue;
    if (s < 0.5) {
      c.fillRect(cx - 2, gy, 4, 2);
      c.fillRect(cx - 1, gy, 2, 5);
    } else {
      c.beginPath();
      c.arc(cx, gy + 2, 2, 0, 7);
      c.fill();
    }
  }
  // gilt base band
  c.fillStyle = rgba(gold, 0.85);
  c.fillRect(cx - hb - 1, bot - 3, hb * 2 + 2, 3);
  c.restore();
}

// a tree for the outdoor prop pass: offset ground shadow, trunk, soft round
// canopy (translucent so a unit under it still reads). v = 0..1 variation.
export function tree(c, x, y, size, v, o) {
  o = o || {};
  const trunk = o.trunk || '#463726';
  const leaf = o.leaf || '#3f6b34';
  const leaf2 = o.leaf2 || '#6a9a44';
  const lift = o.lift || size * 1.3;
  const r = size * (0.72 + v * 0.5);
  c.save();
  c.fillStyle = rgba('#000000', 0.22);
  c.beginPath();
  c.ellipse(x + size * 0.32, y + size * 0.3, r * 0.95, r * 0.46, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = trunk;
  c.fillRect(x - size * 0.11, y - lift * 0.32, size * 0.22, lift * 0.42 + size * 0.36);
  const cy = y - lift;
  const blobs = [
    [0, 0, 1],
    [-r * 0.58, r * 0.24, 0.68],
    [r * 0.54, r * 0.2, 0.7],
    [0, -r * 0.42, 0.58],
  ];
  c.globalAlpha = o.alpha == null ? 0.85 : o.alpha;
  for (const b of blobs) {
    const rr = r * b[2];
    const g = c.createRadialGradient(x + b[0], cy + b[1], rr * 0.2, x + b[0], cy + b[1], rr);
    g.addColorStop(0, mix(leaf2, '#ffffff', 0.12 * (1 - v)));
    g.addColorStop(0.7, leaf);
    g.addColorStop(1, mix(leaf, '#000000', 0.4));
    c.fillStyle = g;
    c.beginPath();
    c.arc(x + b[0], cy + b[1], rr, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = Math.min(1, (o.alpha == null ? 0.85 : o.alpha) * 0.7);
  c.strokeStyle = rgba(mix(leaf2, '#fff2c0', 0.5), 0.5);
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(x - r * 0.2, cy - r * 0.2, r * 0.95, Math.PI * 0.92, Math.PI * 1.7);
  c.stroke();
  c.restore();
}

// a boulder for the outdoor prop pass: layered rounded rock, AO, a top highlight
export function boulder(c, x, y, size, v, o) {
  o = o || {};
  const rock = o.rock || '#8a8378';
  const dark = o.dark || '#3c352c';
  const r = size * (0.8 + v * 0.5);
  const cx = x + size * 0.5 + (v - 0.5) * size * 0.2;
  const cy = y + size * 0.55;
  c.save();
  c.fillStyle = rgba('#000000', 0.28);
  c.beginPath();
  c.ellipse(cx + size * 0.12, cy + size * 0.2, r * 1.02, r * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  const lobes = 4 + ((v * 3) | 0);
  c.beginPath();
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = r * (0.68 + hash2(i, (v * 100) | 0, 17) * 0.5);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr * 0.78 - r * 0.2;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath();
  const g = c.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, mix(rock, '#ffffff', 0.22));
  g.addColorStop(0.55, rock);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = rgba(dark, 0.6);
  c.lineWidth = 1;
  c.stroke();
  c.strokeStyle = rgba(dark, 0.45);
  for (let i = 0; i < 2; i++) {
    const s = hash2(i + 3, (v * 100) | 0, 51);
    c.beginPath();
    c.moveTo(cx - r * 0.5 + s * r, cy - r * 0.8);
    c.lineTo(cx - r * 0.2 + s * r * 0.5, cy + r * 0.5);
    c.stroke();
  }
  c.fillStyle = rgba('#fff2c0', 0.16);
  c.beginPath();
  c.ellipse(cx - r * 0.25, cy - r * 0.5, r * 0.4, r * 0.22, -0.4, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
