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
