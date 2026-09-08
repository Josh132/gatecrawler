let ctx = null;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
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

export const sfx = {
  p90() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    env(g, t, 0.002, 0.06, 0.22);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.1);
  },
  staff() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(430, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.25);
    const g = ctx.createGain();
    env(g, t, 0.003, 0.28, 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.35);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.12);
    const g2 = ctx.createGain();
    env(g2, t, 0.001, 0.1, 0.12);
    src.connect(g2).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.15);
  },
  hit() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.06);
    const g = ctx.createGain();
    env(g, t, 0.001, 0.05, 0.28);
    src.connect(g).connect(ctx.destination);
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
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.36);
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
      o.connect(g).connect(ctx.destination);
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
    src.connect(bp).connect(g).connect(ctx.destination);
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
    src.connect(lp).connect(g).connect(ctx.destination);
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
    mRamp(m.master.gain, 0.08 + mIntensity * 0.03, t, 2);
  },
};
