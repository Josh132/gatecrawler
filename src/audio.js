let ctx = null;
let sfxBus = null; // master gain for all one-shot sfx (music has its own master)
let sfxVol = 0.9;
let muted = false;
const VOL_KEY = 'gatecrawler.audio.v1';

// every sfx voice routes here instead of straight to the speakers
function busOut() {
  return sfxBus || (ctx ? ctx.destination : null);
}

function applyVol() {
  if (sfxBus && ctx) sfxBus.gain.setTargetAtTime(muted ? 0 : sfxVol, ctx.currentTime, 0.02);
}

function loadVolPrefs() {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.vol === 'number') sfxVol = Math.max(0, Math.min(1, p.vol));
      if (typeof p.muted === 'boolean') muted = p.muted;
      if (typeof p.mvol === 'number') mVol = Math.max(0, Math.min(1, p.mvol));
    }
  } catch (e) {
    /* ignore */
  }
}
function saveVolPrefs() {
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify({ vol: sfxVol, muted, mvol: mVol }));
  } catch (e) {
    /* ignore */
  }
}

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    loadVolPrefs();
    sfxBus = ctx.createGain();
    sfxBus.gain.value = muted ? 0 : sfxVol;
    sfxBus.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// master sfx controls (persisted). music.setVolume covers the ambient bed.
export function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  applyVol();
  saveVolPrefs();
  return sfxVol;
}
export function getSfxVolume() {
  return sfxVol;
}
export function isMuted() {
  return muted;
}
export function toggleMute() {
  muted = !muted;
  applyVol();
  saveVolPrefs();
  return muted;
}
export function setMuted(m) {
  muted = !!m;
  applyVol();
  saveVolPrefs();
  return muted;
}

function env(gain, t, attack, decay, peak) {
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noiseBuffer(dur) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const arr = b.getChannelData(0);
  for (let i = 0; i < n; i++) arr[i] = Math.random() * 2 - 1;
  return b;
}

// --- tiny voice builders in the env()/noiseBuffer() idiom -------------------
// A filtered noise grain: buffer -> biquad (optional freq sweep) -> env'd gain.
function noiseVoice(t, dur, type, f0, f1, Q, attack, decay, peak, pad) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const bq = ctx.createBiquadFilter();
  bq.type = type;
  bq.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  if (Q != null) bq.Q.value = Q;
  const g = ctx.createGain();
  env(g, t, attack, decay, peak);
  src.connect(bq).connect(g).connect(busOut());
  src.start(t);
  src.stop(t + attack + decay + (pad || 0.02));
  return { src, bq, g };
}

// A single oscillator grain: osc (optional freq glide) -> env'd gain.
function toneVoice(t, type, f0, f1, glide, attack, decay, peak, pad) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + glide);
  const g = ctx.createGain();
  env(g, t, attack, decay, peak);
  o.connect(g).connect(busOut());
  o.start(t);
  o.stop(t + attack + decay + (pad || 0.02));
  return { o, g };
}

// --- per-weapon shot voices ------------------------------------------------
function fireP90(t) {
  // fast, dry, mid crack — the original P90 pop
  noiseVoice(t, 0.08, 'bandpass', 1900, 1900, 0.9, 0.002, 0.06, 0.22, 0.02);
}
function fireStaff(t) {
  // heavy energy discharge: descending square + noise thump + a little sub
  toneVoice(t, 'square', 430, 80, 0.25, 0.003, 0.28, 0.2, 0.07);
  noiseVoice(t, 0.12, 'lowpass', 900, 480, null, 0.001, 0.1, 0.12, 0.03);
  toneVoice(t, 'sine', 74, 42, 0.18, 0.005, 0.16, 0.13, 0.05);
  // meatier low-end thump under the discharge
  toneVoice(t, 'sine', 46, 28, 0.14, 0.004, 0.24, 0.24, 0.07);
  // longer trailing plasma tail — decaying saw + a slow noise hiss
  toneVoice(t + 0.05, 'sawtooth', 190, 58, 0.5, 0.02, 0.52, 0.06, 0.08);
  noiseVoice(t + 0.05, 0.5, 'lowpass', 620, 150, null, 0.02, 0.46, 0.05, 0.07);
}
function fireZat(t) {
  // quick electric zap: high fizz sweeping down + a short squared pitch drop
  noiseVoice(t, 0.1, 'bandpass', 5200, 1300, 9, 0.001, 0.08, 0.17, 0.03);
  toneVoice(t, 'square', 1500, 320, 0.08, 0.001, 0.07, 0.09, 0.03);
}
function fireShotgun(t) {
  // heaviest kinetic: broad noise burst + low sine thump + a short crack
  noiseVoice(t, 0.28, 'lowpass', 2200, 320, null, 0.001, 0.24, 0.22, 0.05);
  toneVoice(t, 'sine', 95, 40, 0.16, 0.002, 0.2, 0.24, 0.06);
  noiseVoice(t, 0.06, 'bandpass', 1400, 1400, 1.0, 0.001, 0.05, 0.12, 0.03);
  // stage 1: a sharp high crack transient sitting on top of the boom
  noiseVoice(t, 0.02, 'highpass', 3600, 3600, 0.7, 0.0005, 0.02, 0.16, 0.01);
  // stage 2: pump-action shell rack — back then forward
  const tr = t + 0.22;
  noiseVoice(tr, 0.05, 'bandpass', 2200, 2000, 3, 0.001, 0.045, 0.1, 0.02);
  toneVoice(tr, 'square', 210, 150, 0.02, 0.001, 0.03, 0.05, 0.02);
  noiseVoice(tr + 0.1, 0.05, 'bandpass', 1700, 1500, 2.5, 0.001, 0.045, 0.13, 0.02);
  toneVoice(tr + 0.1, 'square', 190, 110, 0.02, 0.001, 0.03, 0.06, 0.02);
}
function fireBurst(t) {
  // tight snappy rifle crack — brighter/cleaner than p90, very short
  noiseVoice(t, 0.05, 'bandpass', 2700, 2700, 1.3, 0.001, 0.04, 0.2, 0.02);
  toneVoice(t, 'square', 240, 90, 0.02, 0.001, 0.025, 0.1, 0.02);
}
function fireLauncher(t) {
  // hollow woody thunk of a shell leaving the tube — not the blast
  toneVoice(t, 'triangle', 180, 84, 0.06, 0.001, 0.08, 0.24, 0.03);
  noiseVoice(t, 0.06, 'bandpass', 420, 300, 7, 0.001, 0.05, 0.13, 0.03);
}
function fireBeamHit(t) {
  // short attack transient; the sustain is sfx.beam(true)
  noiseVoice(t, 0.04, 'bandpass', 3200, 3200, 2, 0.001, 0.04, 0.13, 0.02);
  toneVoice(t, 'sawtooth', 900, 380, 0.05, 0.001, 0.05, 0.1, 0.02);
}

// --- looping continuous beam hum -----------------------------------------
let beamNodes = null;
function beamStart() {
  if (beamNodes || !ctx) return;
  const t = ctx.currentTime;
  try {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.05);
    bp.connect(g).connect(busOut());
    const oscs = [];
    for (const f of [440, 443.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(bp);
      o.start(t);
      oscs.push(o);
    }
    // subtle tremolo on the output gain
    const trem = ctx.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = 7.5;
    const tdepth = ctx.createGain();
    tdepth.gain.value = 0.018;
    trem.connect(tdepth).connect(g.gain);
    trem.start(t);
    oscs.push(trem);
    beamNodes = { g, oscs };
  } catch (e) {
    beamNodes = null;
  }
}
function beamStop() {
  if (!beamNodes || !ctx) return;
  const t = ctx.currentTime;
  try {
    beamNodes.g.gain.cancelScheduledValues(t);
    beamNodes.g.gain.setValueAtTime(beamNodes.g.gain.value || 0.06, t);
    beamNodes.g.gain.linearRampToValueAtTime(0.0001, t + 0.08);
    for (const o of beamNodes.oscs) {
      try {
        o.stop(t + 0.12);
      } catch (e) {}
    }
  } catch (e) {}
  beamNodes = null;
}

// --- looping event-horizon shimmer (while a gate stands open) -------------
let ehNodes = null;
function ehStart() {
  if (ehNodes || !ctx) return;
  const t = ctx.currentTime;
  try {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(3);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 680;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.4);
    // slow watery wobble on the cutoff
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.55;
    const ld = ctx.createGain();
    ld.gain.value = 260;
    lfo.connect(ld).connect(bp.frequency);
    // faint low tonal bed so it has a body
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 68;
    const og = ctx.createGain();
    og.gain.value = 0.022;
    src.connect(bp).connect(g).connect(busOut());
    o.connect(og).connect(busOut());
    src.start(t);
    lfo.start(t);
    o.start(t);
    ehNodes = { g, og, oscs: [src, lfo, o] };
  } catch (e) {
    ehNodes = null;
  }
}
function ehStop() {
  if (!ehNodes || !ctx) return;
  const t = ctx.currentTime;
  try {
    ehNodes.g.gain.cancelScheduledValues(t);
    ehNodes.g.gain.setValueAtTime(ehNodes.g.gain.value || 0.05, t);
    ehNodes.g.gain.linearRampToValueAtTime(0.0001, t + 0.35);
    ehNodes.og.gain.linearRampToValueAtTime(0.0001, t + 0.35);
    for (const o of ehNodes.oscs) {
      try {
        o.stop(t + 0.45);
      } catch (e) {}
    }
  } catch (e) {}
  ehNodes = null;
}

// --- looping SGC alert klaxon (two-tone) --------------------------------
let klaxonNodes = null;
function klaxonStart() {
  if (klaxonNodes || !ctx) return;
  const t = ctx.currentTime;
  try {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 760;
    bp.Q.value = 2;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 660;
    // square LFO swaps the pitch 660 <-> 800 — the classic two-tone
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1.5;
    const ld = ctx.createGain();
    ld.gain.value = 140;
    lfo.connect(ld).connect(o.frequency);
    // amplitude throb locked to the same period
    const alfo = ctx.createOscillator();
    alfo.type = 'sine';
    alfo.frequency.value = 1.5;
    const ad = ctx.createGain();
    ad.gain.value = 0.03;
    alfo.connect(ad).connect(g.gain);
    o.connect(bp).connect(g).connect(busOut());
    o.start(t);
    lfo.start(t);
    alfo.start(t);
    klaxonNodes = { g, oscs: [o, lfo, alfo] };
  } catch (e) {
    klaxonNodes = null;
  }
}
function klaxonStop() {
  if (!klaxonNodes || !ctx) return;
  const t = ctx.currentTime;
  try {
    klaxonNodes.g.gain.cancelScheduledValues(t);
    klaxonNodes.g.gain.setValueAtTime(klaxonNodes.g.gain.value || 0.11, t);
    klaxonNodes.g.gain.linearRampToValueAtTime(0.0001, t + 0.2);
    for (const o of klaxonNodes.oscs) {
      try {
        o.stop(t + 0.3);
      } catch (e) {}
    }
  } catch (e) {}
  klaxonNodes = null;
}

export const sfx = {
  // shot sound, distinct per weapon id; unknown id falls back to the p90 voice
  fire(weaponId) {
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (weaponId) {
      case 'staff':
        fireStaff(t);
        break;
      case 'zat':
        fireZat(t);
        break;
      case 'shotgun':
        fireShotgun(t);
        break;
      case 'burst':
        fireBurst(t);
        break;
      case 'launcher':
        fireLauncher(t);
        break;
      case 'beam':
        fireBeamHit(t);
        break;
      case 'p90':
      default:
        fireP90(t);
    }
  },
  // start (on truthy) / stop the looping continuous beam hum; idempotent
  beam(on) {
    if (!ctx) return;
    if (on) beamStart();
    else beamStop();
  },
  // enemy weapon discharge — deliberately duller / lower than the player's guns
  // so incoming fire never sounds like your own. `fam`: 'jaffa'|'wraith'|'boss'.
  enemyFire(fam) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (fam === 'wraith') {
      noiseVoice(t, 0.07, 'bandpass', 1400, 700, 3, 0.002, 0.06, 0.09, 0.02);
      toneVoice(t, 'sawtooth', 600, 260, 0.05, 0.001, 0.05, 0.06, 0.015);
    } else if (fam === 'boss') {
      toneVoice(t, 'square', 300, 70, 0.22, 0.003, 0.22, 0.16, 0.05);
      toneVoice(t, 'sine', 66, 40, 0.16, 0.004, 0.16, 0.11, 0.045);
    } else {
      // jaffa staff — a muffled thud, no bright crack
      noiseVoice(t, 0.09, 'lowpass', 900, 320, 0.7, 0.002, 0.08, 0.07, 0.02);
      toneVoice(t, 'square', 260, 110, 0.09, 0.002, 0.09, 0.06, 0.015);
    }
  },
  // a soft rising tick when a shot is fired at you from outside your vision
  incoming() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'sine', 1500, 2400, 0.06, 0.002, 0.05, 0.05, 0.02);
  },
  // player lobs a grenade — a short airy whuff + a pin-pull tick
  grenadeThrow() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, 0.16, 'bandpass', 500, 1500, 0.9, 0.004, 0.14, 0.09, 0.02);
    toneVoice(t, 'square', 2400, 2400, 0, 0.001, 0.01, 0.04, 0.01);
  },
  // empty chamber: a short mechanical click, quiet
  dryFire() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, 0.02, 'bandpass', 2600, 2600, 2, 0.001, 0.02, 0.1, 0.015);
    toneVoice(t, 'square', 3200, 3000, 0.01, 0.0005, 0.012, 0.05, 0.01);
  },
  // mag-out clack: short noise + a low click
  reloadStart() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, 0.05, 'lowpass', 1300, 700, null, 0.001, 0.045, 0.16, 0.02);
    toneVoice(t, 'square', 380, 190, 0.02, 0.001, 0.02, 0.1, 0.01);
  },
  // mag-seat snap: two clicks (2nd brighter/louder) + a tiny metallic ring
  reloadDone() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, 0.03, 'bandpass', 1500, 1500, 1.5, 0.001, 0.03, 0.14, 0.02);
    const t2 = t + 0.08;
    noiseVoice(t2, 0.03, 'bandpass', 2700, 2700, 1.6, 0.001, 0.03, 0.24, 0.02);
    toneVoice(t2, 'triangle', 3140, 3140, 0, 0.002, 0.14, 0.06, 0.03);
    toneVoice(t2, 'triangle', 4600, 4600, 0, 0.002, 0.11, 0.04, 0.03);
  },
  // bullet-meets-enemy thock; heavy -> deeper/louder with more low end
  impact(heavy) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (heavy) {
      toneVoice(t, 'sine', 170, 54, 0.09, 0.002, 0.11, 0.3, 0.04);
      noiseVoice(t, 0.05, 'lowpass', 900, 400, null, 0.001, 0.05, 0.18, 0.02);
    } else {
      toneVoice(t, 'sine', 240, 90, 0.05, 0.001, 0.06, 0.2, 0.03);
      noiseVoice(t, 0.03, 'lowpass', 1800, 1200, null, 0.001, 0.03, 0.12, 0.02);
    }
  },
  // punchy low boom for grenade / launcher blasts — louder than death()
  explosion() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, 0.55, 'lowpass', 1800, 120, null, 0.005, 0.5, 0.3, 0.06);
    toneVoice(t, 'sine', 120, 36, 0.35, 0.005, 0.42, 0.3, 0.08);
    toneVoice(t, 'triangle', 60, 30, 0.5, 0.01, 0.5, 0.14, 0.08);
  },
  // bright short ping/chime layered on a big hit or a kill reward
  crit() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'triangle', 1760, 1760, 0, 0.001, 0.16, 0.16, 0.04);
    toneVoice(t + 0.02, 'sine', 2637, 2637, 0, 0.001, 0.14, 0.1, 0.04);
    toneVoice(t + 0.04, 'sine', 3520, 3520, 0, 0.001, 0.12, 0.05, 0.04);
  },
  // low brass-ish stab + rising sub — plays when you enter the boss arena
  bossSting(variant) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const root = variant === 'wraith' ? 58 : variant === 'replicator' ? 49 : 55; // A#1 / G1 / A1
    toneVoice(t, 'sawtooth', root, root, 0, 0.02, 1.1, 0.16, 0.2);
    toneVoice(t, 'square', root * 1.5, root * 1.5, 0, 0.03, 0.9, 0.07, 0.2);
    toneVoice(t + 0.06, 'sine', root / 2, root, 0.9, 0.01, 1.0, 0.18, 0.2);
    noiseVoice(t, 0.9, 'lowpass', 600, 90, null, 0.01, 0.8, 0.14, 0.1);
  },
  // tense tick-up that plays while the boss telegraphs its charge
  bossWindup() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'square', 180, 520, 0.5, 0.01, 0.5, 0.09, 0.06);
    noiseVoice(t, 0.5, 'bandpass', 400, 2400, 6, 0.02, 0.46, 0.08, 0.05);
  },
  p90() {
    if (!ctx) return;
    fireP90(ctx.currentTime);
  },
  staff() {
    if (!ctx) return;
    fireStaff(ctx.currentTime);
  },
  hit() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.06);
    const g = ctx.createGain();
    env(g, t, 0.001, 0.05, 0.28);
    src.connect(g).connect(busOut());
    src.start(t);
    src.stop(t + 0.08);
  },
  death() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    const g = ctx.createGain();
    env(g, t, 0.003, 0.3, 0.22);
    o.connect(g).connect(busOut());
    o.start(t);
    o.stop(t + 0.36);
  },
  // slow, ominous heartbeat pulse — played on a timer while HP is critical
  lowHp() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'sine', 90, 55, 0.16, 0.005, 0.16, 0.16, 0.05);
    toneVoice(t + 0.22, 'sine', 78, 48, 0.14, 0.005, 0.14, 0.11, 0.05);
  },
  // mechanical crunch + a small coin-ish chime — an item broken down for naquadah
  scrap() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, 0.14, 'lowpass', 1600, 300, null, 0.001, 0.12, 0.2, 0.03);
    toneVoice(t, 'square', 150, 60, 0.1, 0.002, 0.12, 0.14, 0.04);
    toneVoice(t + 0.08, 'triangle', 880, 1240, 0.09, 0.001, 0.12, 0.09, 0.03);
  },
  pickup() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 784, 1046].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      env(g, t + i * 0.05, 0.002, 0.12, 0.14);
      o.connect(g).connect(busOut());
      o.start(t + i * 0.05);
      o.stop(t + i * 0.05 + 0.16);
    });
  },
  dodge() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.22);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(1700, t + 0.18);
    const g = ctx.createGain();
    env(g, t, 0.005, 0.16, 0.13);
    src.connect(bp).connect(g).connect(busOut());
    src.start(t);
    src.stop(t + 0.24);
  },
  kawoosh() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(1.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(3200, t + 0.25);
    lp.frequency.exponentialRampToValueAtTime(140, t + 1.15);
    const g = ctx.createGain();
    env(g, t, 0.15, 1.0, 0.3);
    src.connect(lp).connect(g).connect(busOut());
    src.start(t);
    src.stop(t + 1.35);
  },

  // --- gate dialling ----------------------------------------------------
  // heavy mechanical ka-CHUNK of a chevron engaging; n 1..7 rises in pitch/tension
  chevronLock(n) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = Math.max(1, Math.min(7, n || 1));
    const p = (k - 1) / 6; // 0..1 tension
    // ring rotation grinding to a halt, then the lock slams home
    toneVoice(t, 'square', 92 + p * 44, 44 + p * 22, 0.09, 0.002, 0.15, 0.26, 0.05);
    noiseVoice(t, 0.12, 'lowpass', 780 + p * 520, 200, null, 0.001, 0.1, 0.2, 0.03);
    const t2 = t + 0.06;
    noiseVoice(t2, 0.09, 'bandpass', 1500 + p * 1500, 1500 + p * 1500, 2 + p * 3, 0.001, 0.08, 0.18, 0.03);
    toneVoice(t2, 'triangle', 300 + p * 320, 300 + p * 320, 0, 0.001, 0.12, 0.08 + p * 0.06, 0.03);
    // a rising sub tone underneath that climbs with each chevron
    toneVoice(t, 'sine', 150 + p * 210, 170 + p * 250, 0.2, 0.02, 0.22, 0.05 + p * 0.04, 0.05);
  },
  // the big cinematic kawoosh: unstable vortex whoomp settling into the horizon
  wormholeOpen() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // the eruption — long noise whoosh whose cutoff blooms then collapses
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(2.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(150, t);
    lp.frequency.exponentialRampToValueAtTime(4400, t + 0.35);
    lp.frequency.exponentialRampToValueAtTime(220, t + 1.95);
    const g = ctx.createGain();
    env(g, t, 0.18, 1.85, 0.42);
    src.connect(lp).connect(g).connect(busOut());
    src.start(t);
    src.stop(t + 2.4);
    // sub whoomp of the unstable vortex punching out
    toneVoice(t, 'sine', 92, 30, 0.6, 0.02, 0.72, 0.32, 0.1);
    toneVoice(t + 0.04, 'triangle', 55, 24, 0.9, 0.03, 0.92, 0.16, 0.1);
    // vortex warble — fast at first, decelerates as it stabilises
    const warb = ctx.createOscillator();
    warb.type = 'sawtooth';
    warb.frequency.setValueAtTime(320, t);
    warb.frequency.exponentialRampToValueAtTime(120, t + 1.6);
    const wlfo = ctx.createOscillator();
    wlfo.type = 'sine';
    wlfo.frequency.setValueAtTime(19, t);
    wlfo.frequency.exponentialRampToValueAtTime(3, t + 1.6);
    const wd = ctx.createGain();
    wd.gain.value = 42;
    const wg = ctx.createGain();
    env(wg, t, 0.1, 1.7, 0.12);
    wlfo.connect(wd).connect(warb.frequency);
    warb.connect(wg).connect(busOut());
    warb.start(t);
    wlfo.start(t);
    warb.stop(t + 2.05);
    wlfo.stop(t + 2.05);
    // tail: the settled event-horizon shimmer swelling in
    noiseVoice(t + 1.35, 0.95, 'bandpass', 1200, 900, 6, 0.32, 0.72, 0.06, 0.1);
  },
  // start (truthy) / stop the looping low watery event-horizon shimmer; idempotent
  eventHorizon(on) {
    if (!ctx) return;
    if (on) ehStart();
    else ehStop();
  },
  // the sad descending "address unreachable" tri-tone + a dead mechanical clunk
  dialFail() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 330, 247].forEach((f, i) => {
      toneVoice(t + i * 0.18, 'triangle', f, f * 0.995, 0.16, 0.006, 0.22, 0.14, 0.05);
      toneVoice(t + i * 0.18, 'sine', f / 2, f / 2, 0, 0.006, 0.2, 0.06, 0.05);
    });
    noiseVoice(t + 0.6, 0.16, 'lowpass', 480, 150, null, 0.002, 0.14, 0.14, 0.03);
  },

  // --- hub / alert stings --------------------------------------------
  // start (truthy) / stop the looping two-tone SGC alert klaxon; idempotent
  klaxon(on) {
    if (!ctx) return;
    if (on) klaxonStart();
    else klaxonStop();
  },
  // short pneumatic blast-door slide + a seating clunk
  doorServo() {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, 0.5, 'bandpass', 1200, 500, 1.2, 0.02, 0.42, 0.12, 0.05); // pneumatic hiss
    toneVoice(t, 'triangle', 60, 44, 0.4, 0.03, 0.4, 0.14, 0.06); // slab rumble
    noiseVoice(t, 0.45, 'lowpass', 240, 120, null, 0.02, 0.4, 0.16, 0.05);
    const t2 = t + 0.46;
    toneVoice(t2, 'square', 120, 60, 0.06, 0.002, 0.1, 0.2, 0.04); // seats home
    noiseVoice(t2, 0.08, 'lowpass', 600, 200, null, 0.001, 0.07, 0.16, 0.03);
  },
  // a very short filtered "bong" to play ahead of a PA line
  pa() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'sine', 587, 587, 0, 0.004, 0.5, 0.12, 0.08); // D5
    toneVoice(t, 'sine', 880, 880, 0, 0.004, 0.42, 0.05, 0.08); // A5
    noiseVoice(t, 0.05, 'bandpass', 900, 900, 1, 0.002, 0.04, 0.03, 0.02); // speaker click
  },

  // --- extra weapon character --------------------------------------
  // sparse brass-on-concrete tings you can trigger after a burst
  p90Tail() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + 0.03 + Math.random() * 0.5;
      const f = 2600 + Math.random() * 2600;
      toneVoice(tt, 'triangle', f, f * 0.93, 0.05, 0.001, 0.06 + Math.random() * 0.05, 0.05 + Math.random() * 0.04, 0.03);
      noiseVoice(tt, 0.03, 'bandpass', f * 1.3, f * 1.1, 6, 0.001, 0.03, 0.02, 0.02);
    }
  },
  // weapon-appropriate mag-in / bolt-forward two-part sound (distinct from reloadStart/Done)
  reloadMag(weaponId) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (weaponId === 'staff') {
      // energy cell seats, then a rising prime whir
      noiseVoice(t, 0.08, 'lowpass', 700, 300, null, 0.002, 0.07, 0.18, 0.03);
      toneVoice(t + 0.05, 'sawtooth', 120, 520, 0.35, 0.01, 0.34, 0.06, 0.05);
    } else if (weaponId === 'shotgun') {
      // shells thumbed in, then the pump forward
      noiseVoice(t, 0.04, 'bandpass', 1200, 1200, 3, 0.001, 0.035, 0.14, 0.02);
      noiseVoice(t + 0.12, 0.04, 'bandpass', 1000, 1000, 3, 0.001, 0.035, 0.14, 0.02);
      const t2 = t + 0.28;
      noiseVoice(t2, 0.06, 'bandpass', 1800, 1400, 2.5, 0.001, 0.05, 0.2, 0.02);
      toneVoice(t2, 'square', 180, 90, 0.03, 0.001, 0.04, 0.1, 0.02);
    } else if (weaponId === 'zat' || weaponId === 'beam') {
      // energy weapons: a soft click then a capacitor whine settling
      toneVoice(t, 'square', 900, 600, 0.03, 0.001, 0.03, 0.1, 0.02);
      toneVoice(t + 0.04, 'sine', 1800, 1200, 0.4, 0.01, 0.4, 0.04, 0.05);
    } else {
      // p90 / burst / launcher: mag rocks in, then charging handle forward
      noiseVoice(t, 0.06, 'lowpass', 1100, 500, null, 0.001, 0.05, 0.18, 0.02);
      toneVoice(t, 'square', 320, 160, 0.03, 0.001, 0.03, 0.1, 0.02);
      const t2 = t + 0.16;
      noiseVoice(t2, 0.05, 'bandpass', 2400, 1600, 2, 0.001, 0.045, 0.22, 0.02);
      toneVoice(t2, 'square', 260, 130, 0.02, 0.001, 0.03, 0.12, 0.02);
      toneVoice(t2 + 0.01, 'triangle', 3000, 3000, 0, 0.002, 0.05, 0.04, 0.02);
    }
  },

  // --- player state cues ------------------------------------------
  // shield collapse: a glassy shatter over a low pitch drop
  shieldBreak() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const tt = t + Math.random() * 0.12;
      const f = 3200 + Math.random() * 3800;
      toneVoice(tt, 'triangle', f, f * 0.8, 0.08, 0.001, 0.09, 0.06, 0.03);
    }
    noiseVoice(t, 0.18, 'highpass', 4000, 2500, 0.7, 0.001, 0.16, 0.14, 0.03);
    toneVoice(t, 'sawtooth', 300, 42, 0.28, 0.004, 0.3, 0.2, 0.06);
    toneVoice(t + 0.02, 'sine', 90, 30, 0.3, 0.005, 0.3, 0.12, 0.06);
  },
  // shield restored: a rising hum that settles onto a soft chord
  shieldRecharge() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'sawtooth', 120, 440, 0.5, 0.05, 0.5, 0.08, 0.08);
    toneVoice(t, 'sine', 240, 880, 0.55, 0.05, 0.55, 0.04, 0.08);
    toneVoice(t + 0.5, 'triangle', 660, 660, 0, 0.02, 0.3, 0.05, 0.05);
    noiseVoice(t, 0.5, 'bandpass', 600, 2600, 4, 0.05, 0.45, 0.03, 0.05);
  },
  // brighter arpeggio than pickup() for good/epic/legendary loot; legendary gets a shimmer tail
  pickupRare(tier) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const scales = {
      good: [659, 988, 1319],
      epic: [659, 988, 1319, 1760],
      legendary: [523, 784, 1046, 1568, 2093],
    };
    const notes = scales[tier] || scales.good;
    notes.forEach((f, i) => {
      toneVoice(t + i * 0.06, 'triangle', f, f, 0, 0.002, 0.16, 0.13, 0.04);
      toneVoice(t + i * 0.06, 'sine', f * 2, f * 2, 0, 0.002, 0.1, 0.04, 0.04);
    });
    if (tier === 'legendary') {
      noiseVoice(t + 0.3, 0.6, 'bandpass', 6000, 3000, 8, 0.02, 0.55, 0.05, 0.08);
      toneVoice(t + 0.32, 'sine', 2637, 2637, 0, 0.01, 0.5, 0.05, 0.08);
      toneVoice(t + 0.4, 'sine', 3520, 3520, 0, 0.01, 0.45, 0.035, 0.08);
    }
  },
  // small heal blip — the quick "+HP" tick
  heal() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'sine', 523, 784, 0.12, 0.01, 0.18, 0.1, 0.04);
    toneVoice(t + 0.06, 'sine', 784, 1046, 0.1, 0.01, 0.16, 0.06, 0.04);
  },
  // big heal — a warm rising pad with a sparkle on top, for a full/large restore
  healBig() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'sine', 261, 523, 0.6, 0.06, 0.6, 0.12, 0.1);
    toneVoice(t, 'triangle', 392, 784, 0.6, 0.06, 0.6, 0.07, 0.1);
    toneVoice(t + 0.08, 'sine', 523, 1046, 0.55, 0.05, 0.55, 0.05, 0.1);
    [1046, 1319, 1568].forEach((f, i) => {
      toneVoice(t + 0.2 + i * 0.08, 'triangle', f, f, 0, 0.003, 0.2, 0.05, 0.04);
    });
    noiseVoice(t, 0.7, 'bandpass', 400, 2000, 3, 0.1, 0.6, 0.03, 0.08);
  },
  // soft UI tick for a button press in any menu / panel
  uiClick() {
    if (!ctx) return;
    const t = ctx.currentTime;
    toneVoice(t, 'square', 660, 660, 0, 0.001, 0.035, 0.035, 0.02);
    toneVoice(t + 0.015, 'sine', 990, 990, 0, 0.001, 0.05, 0.02, 0.02);
  },
  // quieter tick for hover / selection change
  uiHover() {
    if (!ctx) return;
    toneVoice(ctx.currentTime, 'sine', 1180, 1180, 0, 0.001, 0.03, 0.012, 0.01);
  },
  // a dull footfall — call on alternating feet as the player moves
  footstep(hard) {
    if (!ctx) return;
    const t = ctx.currentTime;
    noiseVoice(t, hard ? 0.05 : 0.04, 'lowpass', hard ? 520 : 380, hard ? 180 : 150, null, 0.001, 0.04, hard ? 0.05 : 0.03, 0.01);
    toneVoice(t, 'sine', 90, 55, 0.04, 0.002, 0.05, hard ? 0.05 : 0.03, 0.02);
  },
};

// ---------------------------------------------------------------------------
// ambient music bed — a slow-evolving sci-fi drone (no melody, no files).
// A detuned low chord runs through a lowpass whose cutoff is swept by a
// glacial LFO, then into a feedback delay + synthesised-impulse reverb for
// space. A scheduler nudges the root, voicing, cutoff and a high shimmer
// layer every ~15-40s so it never loops audibly. setIntensity(x) lifts the
// cutoff and fades in a combat pulse layer.
// ---------------------------------------------------------------------------

const M_ROOTS = [55, 51.91, 58.27, 49.0, 61.74];
const M_VOICES = [1, 1.498, 2.011, 3.02];

let mNodes = null;
let mTimer = null;
let mIntensity = 0;
let mVol = 1; // ambient-bed volume scalar (persisted alongside sfx prefs)

function mAt(param, v, t) {
  if (param && typeof param.setValueAtTime === 'function') param.setValueAtTime(v, t);
  else if (param) param.value = v;
}

function mRamp(param, v, t, dur) {
  if (param && typeof param.linearRampToValueAtTime === 'function') {
    mAt(param, param.value, t);
    param.linearRampToValueAtTime(v, t + dur);
  } else mAt(param, v, t);
}

function mImpulse(dur, decay) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

function mBuild() {
  const t = ctx.currentTime;
  const stop = [];

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  const bus = ctx.createGain(); // dry chord bus -> master + sends
  bus.connect(master);

  if (ctx.createDelay) {
    const dl = ctx.createDelay(2);
    dl.delayTime.value = 0.43;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    dl.connect(fb).connect(dl);
    dl.connect(wet).connect(master);
    bus.connect(dl);
  }
  if (ctx.createConvolver && ctx.createBuffer) {
    const cv = ctx.createConvolver();
    cv.buffer = mImpulse(2.6, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    cv.connect(wet).connect(master);
    bus.connect(cv);
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  filter.Q.value = 5;
  filter.connect(bus);

  // glacial cutoff LFO
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.032;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 130;
  lfo.connect(lfoDepth).connect(filter.frequency);
  lfo.start(t);
  stop.push(lfo);

  // detuned drone chord
  const voices = [];
  for (let i = 0; i < M_VOICES.length; i++) {
    const o = ctx.createOscillator();
    o.type = i < 2 ? 'sine' : 'triangle';
    o.frequency.value = M_ROOTS[0] * M_VOICES[i] * (1 + (i - 1.5) * 0.004);
    const g = ctx.createGain();
    g.gain.value = 0.22 / (i + 1);
    o.connect(g).connect(filter);
    o.start(t);
    voices.push(o);
    stop.push(o);
  }

  // faint high shimmer (bypasses the lowpass so it stays airy)
  const shimmer = ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.value = M_ROOTS[0] * 12.01;
  const shimGain = ctx.createGain();
  shimGain.gain.value = 0.005;
  const shimLfo = ctx.createOscillator();
  shimLfo.type = 'sine';
  shimLfo.frequency.value = 0.06;
  const shimLfoDepth = ctx.createGain();
  shimLfoDepth.gain.value = 0.004;
  shimLfo.connect(shimLfoDepth).connect(shimGain.gain);
  shimmer.connect(shimGain).connect(bus);
  shimmer.start(t);
  shimLfo.start(t);
  stop.push(shimmer, shimLfo);

  // combat pulse layer, silent until setIntensity lifts it
  const pulse = ctx.createOscillator();
  pulse.type = 'triangle';
  pulse.frequency.value = M_ROOTS[0] * 0.5;
  const pulseGain = ctx.createGain();
  pulseGain.gain.value = 0.0001;
  const pulseLfo = ctx.createOscillator();
  pulseLfo.type = 'square';
  pulseLfo.frequency.value = 2.1;
  const pulseDepth = ctx.createGain();
  pulseDepth.gain.value = 0.0001;
  pulseLfo.connect(pulseDepth).connect(pulseGain.gain);
  pulse.connect(pulseGain).connect(filter);
  pulse.start(t);
  pulseLfo.start(t);
  stop.push(pulse, pulseLfo);

  master.gain.setValueAtTime(0.0001, t);
  master.gain.linearRampToValueAtTime(0.08, t + 5);

  mNodes = { master, filter, lfoDepth, voices, shimmer, pulseDepth, stop, rootIdx: 0, step: 0 };
}

function mEvolve() {
  mTimer = null;
  if (!mNodes || !ctx) return;
  const t = ctx.currentTime;
  const m = mNodes;
  m.step++;
  m.rootIdx = (m.rootIdx + 1 + Math.floor(Math.random() * (M_ROOTS.length - 1))) % M_ROOTS.length;
  const root = M_ROOTS[m.rootIdx];
  const glide = 9 + Math.random() * 12;
  for (let i = 0; i < m.voices.length; i++) {
    mRamp(m.voices[i].frequency, root * M_VOICES[i] * (1 + (i - 1.5) * 0.004), t, glide);
  }
  mRamp(m.shimmer.frequency, root * (m.step % 2 ? 12.01 : 8.005), t, glide);
  mRamp(m.filter.frequency, 240 + Math.random() * 240 + mIntensity * 900, t, glide);
  mRamp(m.lfoDepth.gain, 90 + Math.random() * 110, t, glide);
  mTimer = setTimeout(mEvolve, (15 + Math.random() * 25) * 1000);
}

export const music = {
  start() {
    if (mNodes) return; // idempotent
    if (!ctx) initAudio(); // safe before initAudio()
    if (!ctx) return; // no Web Audio here
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    try {
      mBuild();
    } catch (e) {
      mNodes = null;
      return;
    }
    mTimer = setTimeout(mEvolve, (15 + Math.random() * 25) * 1000);
  },
  stop() {
    if (mTimer) {
      clearTimeout(mTimer);
      mTimer = null;
    }
    if (mNodes && ctx) {
      const t = ctx.currentTime;
      const m = mNodes;
      try {
        m.master.gain.cancelScheduledValues(t);
        mAt(m.master.gain, m.master.gain.value, t);
        m.master.gain.linearRampToValueAtTime(0.0001, t + 1.5);
        for (const o of m.stop) {
          try {
            o.stop(t + 1.7);
          } catch (e) {}
        }
      } catch (e) {}
    }
    mNodes = null;
  },
  setIntensity(x) {
    mIntensity = Math.max(0, Math.min(1, x || 0));
    if (!mNodes || !ctx) return;
    const t = ctx.currentTime;
    const m = mNodes;
    mRamp(m.filter.frequency, 260 + mIntensity * 1100, t, 1.5);
    mRamp(m.pulseDepth.gain, 0.0001 + mIntensity * 0.05, t, 1.2);
    mRamp(m.master.gain, (0.08 + mIntensity * 0.03) * mVol, t, 2);
  },
  setVolume(v) {
    mVol = Math.max(0, Math.min(1, v));
    if (mNodes && ctx) mRamp(mNodes.master.gain, (0.08 + mIntensity * 0.03) * mVol, ctx.currentTime, 0.5);
    ambApplyVol(); // the ambient bed rides the same music-volume scalar
    saveVolPrefs();
    return mVol;
  },
  getVolume() {
    return mVol;
  },
};

// ---------------------------------------------------------------------------
// per-biome ambient bed — a quiet looping environmental texture UNDER the
// music. Its own master gain (not the sfx bus, not the music master) rides
// mVol so the music-volume slider covers it. Each bed = a handful of filtered
// noise + slow LFO'd drones + sparse one-shots on loose setTimeout timers.
// set(biome) crossfades ~1.5s; the same biome is a no-op; stop() fades out.
// ---------------------------------------------------------------------------

const AMB_LEVEL = 0.55; // crossfade target for a bed's own gain (layers are quiet)

let ambMaster = null;
let ambCur = null; // active bed: { biome, gain, oscs:[], timers:[], alive }

function ambApplyVol() {
  if (ambMaster && ctx) ambMaster.gain.setTargetAtTime(mVol, ctx.currentTime, 0.1);
}

// a sustained filtered-noise layer, with an optional slow LFO on gain or cutoff
function ambNoiseLayer(bed, dest, t, type, freq, Q, level, lfoRate, lfoDepth, lfoTarget) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(2.7);
  src.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = type;
  bq.frequency.value = freq;
  if (Q != null) bq.Q.value = Q;
  const g = ctx.createGain();
  g.gain.value = level;
  src.connect(bq).connect(g).connect(dest);
  src.start(t);
  bed.oscs.push(src);
  if (lfoRate) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;
    const d = ctx.createGain();
    d.gain.value = lfoDepth;
    lfo.connect(d).connect(lfoTarget === 'cutoff' ? bq.frequency : g.gain);
    lfo.start(t);
    bed.oscs.push(lfo);
  }
  return { g, bq };
}

// a sustained oscillator drone with an optional slow gain LFO
function ambDrone(bed, dest, t, type, freq, level, lfoRate, lfoDepth) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = level;
  o.connect(g).connect(dest);
  o.start(t);
  bed.oscs.push(o);
  if (lfoRate) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;
    const d = ctx.createGain();
    d.gain.value = lfoDepth;
    lfo.connect(d).connect(g.gain);
    lfo.start(t);
    bed.oscs.push(lfo);
  }
  return g;
}

// one-shot noise grain routed to the bed (NOT the sfx bus)
function ambGrain(dest, t, type, f0, f1, Q, attack, decay, peak) {
  const dur = attack + decay + 0.05;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const bq = ctx.createBiquadFilter();
  bq.type = type;
  bq.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  if (Q != null) bq.Q.value = Q;
  const g = ctx.createGain();
  env(g, t, attack, decay, peak);
  src.connect(bq).connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur);
}

// one-shot tone grain routed to the bed
function ambPing(dest, t, type, f0, f1, glide, attack, decay, peak) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + glide);
  const g = ctx.createGain();
  env(g, t, attack, decay, peak);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

// run fn on a loose random interval for as long as the bed stays alive
function ambEvery(bed, minS, maxS, fn) {
  const tick = () => {
    if (!bed.alive || !ctx) return;
    try {
      fn(ctx.currentTime);
    } catch (e) {}
    bed.timers.push(setTimeout(tick, (minS + Math.random() * (maxS - minS)) * 1000));
  };
  bed.timers.push(setTimeout(tick, (minS + Math.random() * (maxS - minS)) * 1000));
}

// --- the beds ----------------------------------------------------------
function bedTemple(bed, g, t) {
  ambNoiseLayer(bed, g, t, 'lowpass', 220, 0.5, 0.05, 0.03, 0.02, 'gain'); // stone-room air
  ambNoiseLayer(bed, g, t, 'bandpass', 480, 0.8, 0.018, 0.05, 260, 'cutoff'); // dry wind seam
  ambDrone(bed, g, t, 'sine', 47, 0.03, 0.05, 0.012); // sub room tone
  ambEvery(bed, 6, 16, (tt) => {
    // a distant drip
    ambPing(g, tt, 'sine', 1400 + Math.random() * 900, 700, 0.05, 0.001, 0.12, 0.05);
    ambGrain(g, tt + 0.01, 'bandpass', 2600, 1600, 8, 0.001, 0.04, 0.02);
  });
}
function bedJungle(bed, g, t) {
  ambNoiseLayer(bed, g, t, 'bandpass', 6800, 14, 0.02, 6.3, 0.012, 'gain'); // insect shimmer hi
  ambNoiseLayer(bed, g, t, 'bandpass', 4200, 10, 0.016, 4.1, 0.01, 'gain'); // insect shimmer lo
  ambNoiseLayer(bed, g, t, 'lowpass', 300, 0.6, 0.035, 0.04, 0.02, 'gain'); // humid air
  ambDrone(bed, g, t, 'triangle', 52, 0.02, 0.07, 0.01); // low forest hum
  ambEvery(bed, 3, 9, (tt) => {
    // far bird call — a couple of chirps
    const base = 1800 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      ambPing(g, tt + i * 0.09, 'sine', base * (1 + Math.random() * 0.1), base * 1.4, 0.06, 0.004, 0.07, 0.03);
    }
  });
  ambEvery(bed, 4, 11, (tt) => {
    // frog croak
    ambPing(g, tt, 'sawtooth', 150, 90, 0.12, 0.01, 0.14, 0.035);
    ambGrain(g, tt, 'bandpass', 400, 240, 6, 0.005, 0.12, 0.02);
  });
  ambEvery(bed, 2.5, 7, (tt) => {
    // wet drip
    ambPing(g, tt, 'sine', 1600 + Math.random() * 700, 800, 0.04, 0.001, 0.09, 0.04);
  });
}
function bedDesert(bed, g, t) {
  const wind = ambNoiseLayer(bed, g, t, 'bandpass', 700, 0.6, 0.05, 0.05, 420, 'cutoff'); // broadband wind
  ambNoiseLayer(bed, g, t, 'highpass', 5200, 0.7, 0.01, 0.09, 0.006, 'gain'); // grit hiss
  const gust = ctx.createOscillator(); // slow gusts swell the wind
  gust.type = 'sine';
  gust.frequency.value = 0.06;
  const gd = ctx.createGain();
  gd.gain.value = 0.03;
  gust.connect(gd).connect(wind.g.gain);
  gust.start(t);
  bed.oscs.push(gust);
  ambDrone(bed, g, t, 'sine', 44, 0.018, 0.02, 0.01); // faint low bed
  ambEvery(bed, 10, 24, (tt) => {
    // a lonely low moan
    ambPing(g, tt, 'sine', 120, 180, 1.4, 0.6, 1.6, 0.03);
  });
}
function bedIce(bed, g, t) {
  ambDrone(bed, g, t, 'sine', 38, 0.05, 0.02, 0.03); // glacier sub groan
  ambDrone(bed, g, t, 'triangle', 76.3, 0.02, 0.037, 0.012); // beating overtone
  ambNoiseLayer(bed, g, t, 'bandpass', 8200, 16, 0.012, 0.08, 0.008, 'gain'); // glassy shimmer
  ambNoiseLayer(bed, g, t, 'bandpass', 900, 0.7, 0.02, 0.06, 300, 'cutoff'); // thin wind
  ambEvery(bed, 8, 20, (tt) => {
    // ice groan swell
    ambPing(g, tt, 'sawtooth', 55, 41, 2.2, 0.8, 2.4, 0.035);
  });
  ambEvery(bed, 1.5, 5, (tt) => {
    // a cluster of crackle ticks
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      ambGrain(g, tt + Math.random() * 0.25, 'highpass', 5000 + Math.random() * 3000, 4000, 0.6, 0.0005, 0.02, 0.03);
    }
  });
}
function bedFoundry(bed, g, t) {
  ambDrone(bed, g, t, 'sawtooth', 50, 0.035, 0, 0); // mains hum
  ambDrone(bed, g, t, 'sawtooth', 100, 0.014, 0, 0); // octave buzz
  ambDrone(bed, g, t, 'sine', 150, 0.008, 0.11, 0.004); // 3rd-harmonic flicker
  ambNoiseLayer(bed, g, t, 'bandpass', 2400, 6, 0.012, 0.05, 0.006, 'gain'); // metallic room tone
  ambNoiseLayer(bed, g, t, 'lowpass', 180, 0.6, 0.03, 0.04, 0.015, 'gain'); // machine-floor rumble
  ambEvery(bed, 5, 14, (tt) => {
    // distant clank with a ring-out
    ambPing(g, tt, 'square', 220 + Math.random() * 160, 90, 0.02, 0.001, 0.16, 0.04);
    ambGrain(g, tt, 'bandpass', 1800, 900, 5, 0.001, 0.18, 0.03);
    ambPing(g, tt + 0.005, 'triangle', 1200 + Math.random() * 600, 1200, 0, 0.002, 0.3, 0.02);
  });
  ambEvery(bed, 7, 18, (tt) => {
    // steam hiss
    ambGrain(g, tt, 'highpass', 3000, 5200, 0.7, 0.03, 0.5, 0.04);
  });
}
function bedHive(bed, g, t) {
  ambDrone(bed, g, t, 'sine', 40, 0.03, 0.09, 0.02); // low organic bed
  ambNoiseLayer(bed, g, t, 'lowpass', 500, 0.7, 0.03, 0.13, 0.02, 'gain'); // breath-like swell
  ambNoiseLayer(bed, g, t, 'bandpass', 1700, 3, 0.01, 0.2, 0.006, 'gain'); // wet sheen
  ambEvery(bed, 1.6, 2.6, (tt) => {
    // wet heartbeat-ish double pulse
    ambPing(g, tt, 'sine', 66, 40, 0.12, 0.004, 0.14, 0.06);
    ambPing(g, tt + 0.2, 'sine', 60, 36, 0.12, 0.004, 0.12, 0.045);
    ambGrain(g, tt, 'lowpass', 300, 140, 3, 0.002, 0.1, 0.03);
  });
  ambEvery(bed, 3, 9, (tt) => {
    // faint chittering
    const n = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      ambGrain(g, tt + i * 0.04 + Math.random() * 0.02, 'bandpass', 3200 + Math.random() * 2600, 2800, 12, 0.001, 0.02, 0.02);
    }
  });
}
function bedAtlantis(bed, g, t) {
  ambDrone(bed, g, t, 'sine', 110, 0.03, 0.05, 0.008); // clean tonal hum (A2)
  ambDrone(bed, g, t, 'sine', 165, 0.016, 0.06, 0.006); // a fifth above
  ambDrone(bed, g, t, 'triangle', 220, 0.01, 0.04, 0.004); // octave pad
  ambNoiseLayer(bed, g, t, 'bandpass', 7000, 8, 0.006, 0.05, 0.004, 'gain'); // airy sheen
  ambEvery(bed, 7, 18, (tt) => {
    // a gentle chime — two notes of a bright arpeggio
    const notes = [440, 554, 659, 880];
    const s = Math.floor(Math.random() * 2);
    for (let i = 0; i < 2; i++) {
      ambPing(g, tt + i * 0.14, 'sine', notes[s + i], notes[s + i], 0, 0.004, 0.6, 0.03);
    }
  });
}
function bedCatacomb(bed, g, t) {
  ambDrone(bed, g, t, 'sine', 36, 0.045, 0.015, 0.02); // very low drone
  ambNoiseLayer(bed, g, t, 'lowpass', 160, 0.5, 0.03, 0.02, 0.012, 'gain'); // dead-air room tone
  ambNoiseLayer(bed, g, t, 'bandpass', 1100, 1.5, 0.006, 0.11, 400, 'cutoff'); // faint whisper-noise
  ambEvery(bed, 12, 30, (tt) => {
    // rare far-off settling-stone knock + aftershock
    ambPing(g, tt, 'sine', 90, 55, 0.08, 0.002, 0.2, 0.05);
    ambGrain(g, tt, 'lowpass', 700, 200, 3, 0.001, 0.14, 0.035);
    ambPing(g, tt + 0.14, 'sine', 78, 50, 0.1, 0.003, 0.16, 0.02);
  });
}
function bedSgc(bed, g, t) {
  ambDrone(bed, g, t, 'sawtooth', 120, 0.02, 0, 0); // fluorescent-ballast hum
  ambDrone(bed, g, t, 'sine', 60, 0.014, 0, 0); // mains fundamental
  ambNoiseLayer(bed, g, t, 'lowpass', 320, 0.6, 0.045, 0.05, 0.02, 'gain'); // HVAC air
  ambNoiseLayer(bed, g, t, 'highpass', 4000, 0.7, 0.008, 0.12, 0.005, 'gain'); // vent hiss
  ambEvery(bed, 10, 26, (tt) => {
    // distant muffled PA murmur
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      ambPing(g, tt + i * 0.22, 'sawtooth', 180 + Math.random() * 120, 160 + Math.random() * 120, 0.18, 0.03, 0.2, 0.012);
    }
  });
  ambEvery(bed, 2.5, 8, (tt) => {
    // the odd keyboard clack
    const n = 1 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      ambGrain(g, tt + i * (0.06 + Math.random() * 0.05), 'bandpass', 2200 + Math.random() * 1200, 1600, 4, 0.0005, 0.015, 0.03);
    }
  });
  ambEvery(bed, 15, 40, (tt) => {
    // a distant door thunk
    ambPing(g, tt, 'sine', 80, 48, 0.09, 0.003, 0.22, 0.045);
    ambGrain(g, tt, 'lowpass', 500, 160, 2, 0.001, 0.16, 0.03);
  });
}

const AMB_BEDS = {
  temple: bedTemple,
  pyramid: bedTemple, // gilded stone hall — same dry stone air as the temple
  jungle: bedJungle,
  desert: bedDesert,
  savannah: bedDesert, // open dry grassland — reuse the wind bed
  ice: bedIce,
  foundry: bedFoundry,
  hive: bedHive,
  atlantis: bedAtlantis,
  catacomb: bedCatacomb,
  sgc: bedSgc,
  hub: bedSgc,
};

function ambKill(bed, fadeMs) {
  if (!bed) return;
  bed.alive = false;
  for (const id of bed.timers) clearTimeout(id);
  bed.timers.length = 0;
  if (!ctx) return;
  const t = ctx.currentTime;
  const f = (fadeMs || 1500) / 1000;
  try {
    bed.gain.gain.cancelScheduledValues(t);
    bed.gain.gain.setValueAtTime(bed.gain.gain.value || 0.0001, t);
    bed.gain.gain.linearRampToValueAtTime(0.0001, t + f);
    for (const o of bed.oscs) {
      try {
        o.stop(t + f + 0.2);
      } catch (e) {}
    }
  } catch (e) {}
}

export const ambient = {
  // crossfade (~1.5s) to the bed for `biome`; the same biome is a no-op.
  // 'hub' is an alias of 'sgc'; unknown biome names are ignored.
  set(biome) {
    if (!ctx) return;
    const key = biome === 'hub' ? 'sgc' : biome;
    const build = AMB_BEDS[key];
    if (!build) return;
    if (ambCur && ambCur.biome === key) return; // already playing this bed
    if (!ambMaster) {
      ambMaster = ctx.createGain();
      ambMaster.gain.value = mVol;
      ambMaster.connect(ctx.destination);
    }
    const t = ctx.currentTime;
    const prev = ambCur;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ambMaster);
    const bed = { biome: key, gain, oscs: [], timers: [], alive: true };
    try {
      build(bed, gain, t);
    } catch (e) {
      ambKill(bed, 0);
      return;
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(AMB_LEVEL, t + 1.5);
    ambCur = bed;
    if (prev) ambKill(prev, 1500);
  },
  // fade the current bed out
  stop() {
    ambKill(ambCur, 1200);
    ambCur = null;
  },
  // the biome key of the bed currently playing, or null
  current() {
    return ambCur ? ambCur.biome : null;
  },
};
