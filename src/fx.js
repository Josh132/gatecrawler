// ─────────────────────────────────────────────────────────────────────────────
// fx.js — transient eye-candy: particles, screen shake, muzzle/hit flashes and
// the persistent battlefield decals (casings, scorch, blood).
//
// Everything here is a one-way spawn helper: it pushes onto arrays on the game
// object `g` (g.particles / g.flashes / g.decals) and reads a little state, but
// never calls back into game.js. That makes this the safest slice of the old
// monolith to own on its own — visual polish can be tuned here in isolation.
//
// Randomness is `rr` (unseeded) on purpose: none of this may perturb the
// deterministic worldgen seed stream the test harness checks.
// ─────────────────────────────────────────────────────────────────────────────

import { TAU } from './draw.js';
import { rr } from './rng.js';
import { Particle, Decal } from './entities.js';

// ---- particles -------------------------------------------------------------

// a small tight spray — hit sparks, taps, blips
export function spark(g, x, y, color) {
  for (let i = 0; i < 5; i++) {
    g.particles.push(new Particle(x, y, rr(-110, 110), rr(-110, 110), rr(0.15, 0.35), color, rr(1.5, 3)));
  }
}

// an omnidirectional blast of `n` motes — deaths, explosions, impacts
export function burst(g, x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rr(0, TAU);
    const s = rr(40, 260);
    g.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, rr(0.3, 0.7), color, rr(1.5, 3.5)));
  }
}

// the gate's unstable-vortex eruption ring + a hard camera kick
export function kawoosh(g, x, y) {
  for (let i = 0; i < 46; i++) {
    const a = rr(0, TAU);
    const s = rr(120, 420);
    const r0 = rr(6, 22);
    g.particles.push(
      new Particle(x + Math.cos(a) * r0, y + Math.sin(a) * r0, Math.cos(a) * s, Math.sin(a) * s, rr(0.3, 0.6), '#7cc6ff', rr(1.4, 2.8))
    );
  }
  g.shake = 16;
}

// ---- screen shake --------------------------------------------------------

// directional screen shake — mag + a unit-ish (dx,dy) the kick comes from
export function addShake(g, mag, dx, dy) {
  g.shake = Math.min(28, g.shake + mag);
  const l = Math.hypot(dx || 0, dy || 0);
  if (l > 1e-4) {
    g.shakeX = dx / l;
    g.shakeY = dy / l;
  }
}

// ---- muzzle / hit flashes ------------------------------------------------

// short-lived additive light blip; capped so a firefight can't unbound the list
export function addFlash(g, x, y, r, color, life) {
  if (!g.flashes) return;
  g.flashes.push({ x, y, r, color, t: life, max: life });
  if (g.flashes.length > 40) g.flashes.shift();
}

// ---- battlefield decals ------------------------------------------------------

// capped ring buffer, drawn under everything so a cleared room reads as a
// warzone. `casing` skips the local density cap; everything else thins out so
// marks don't pile on one spot.
export function addDecal(g, kind, x, y, r, color, ang) {
  if (g.hub) return;
  if (kind !== 'casing') {
    let near = 0;
    for (let i = g.decals.length - 1; i >= 0 && i > g.decals.length - 40; i--) {
      const o = g.decals[i];
      if (o.kind === kind && (o.x - x) ** 2 + (o.y - y) ** 2 < 15 * 15) near++;
    }
    if (near >= 2) return;
  }
  const d = new Decal(kind, x, y, r, color, ang);
  d.born = g.time;
  g.decals.push(d);
  if (g.decals.length > 500) g.decals.splice(0, g.decals.length - 500);
}

export function scorch(g, x, y, r) {
  addDecal(g, 'scorch', x, y, r, 'rgba(8,6,5,0.42)');
}

export function ejectCasing(g, x, y, aim) {
  const a = aim + Math.PI + rr(-0.9, 0.9);
  addDecal(g, 'casing', x + Math.cos(a) * rr(12, 30), y + Math.sin(a) * rr(12, 30), rr(2.2, 3.4), 'rgba(224,192,120,0.7)', rr(0, TAU));
}

export function splat(g, x, y, color, n) {
  for (let i = 0; i < (n || 3); i++) {
    addDecal(g, 'splat', x + rr(-11, 11), y + rr(-11, 11), rr(3, 6.5), color, rr(0, TAU));
  }
}

export function factionSplatColor(kind) {
  if (kind.startsWith('wraith')) return 'rgba(120,240,150,0.34)';
  if (kind.startsWith('replicator')) return 'rgba(140,230,255,0.28)';
  if (kind === 'boss') return 'rgba(255,160,110,0.34)';
  return 'rgba(255,150,90,0.28)'; // jaffa
}

// ---- per-biome impact debris ----------------------------------------------

// mote colour, floor-mark rgba, hot = throws sparks + a scorch. keyed by
// g.params.biome; ruins is the fallback.
const BIOME_IMPACT = {
  ruins: { spark: '#9fb8cc', mark: 'rgba(58,68,82,0.30)', hot: false },
  temple: { spark: '#d8b98a', mark: 'rgba(120,92,54,0.32)', hot: false },
  jungle: { spark: '#7c5a36', mark: 'rgba(36,30,18,0.36)', hot: false },
  desert: { spark: '#e8d0a0', mark: 'rgba(150,120,74,0.28)', hot: false },
  ice: { spark: '#dff4ff', mark: 'rgba(182,222,242,0.24)', hot: false },
  foundry: { spark: '#ffb066', mark: 'rgba(8,6,5,0.42)', hot: true },
  hive: { spark: '#9dff6a', mark: 'rgba(120,240,150,0.26)', hot: false },
  atlantis: { spark: '#cfe8ff', mark: 'rgba(92,142,182,0.26)', hot: false },
  catacomb: { spark: '#a8a08a', mark: 'rgba(40,44,36,0.32)', hot: false },
};

export function biomeImpact(g) {
  return BIOME_IMPACT[(g.params && g.params.biome) || 'ruins'] || BIOME_IMPACT.ruins;
}

// a few biome-tinted motes at an impact point; returns the palette entry so
// callers can add a scorch on hot biomes. keep n small — this is a hot path.
export function biomeDust(g, x, y, n, spd) {
  const bi = biomeImpact(g);
  for (let i = 0; i < n; i++) {
    g.particles.push(new Particle(x, y, rr(-spd, spd), rr(-spd, spd), rr(0.12, 0.3), bi.spark, rr(1.3, 2.7)));
  }
  return bi;
}
