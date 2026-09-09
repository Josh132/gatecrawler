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
    saveVolPrefs();
    return mVol;
  },
  getVolume() {
    return mVol;
  },
};
