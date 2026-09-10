import { initInput } from './input.js';
import { initAudio, music } from './audio.js';
import { startLoop } from './loop.js';
import { createGame } from './game.js';
import { initTouch } from './touch.js';

const canvas = document.getElementById('game');
window.DEBUG = new URLSearchParams(location.search).has('debug');

const game = createGame(canvas);
initInput(canvas);
initTouch(canvas, game);

// the WebGL colour-grade is a real per-frame cost on phones (a full-canvas
// texture upload + four passes) and has shown GPU artifacts in fullscreen on
// some mobile drivers — skip it on coarse-pointer devices; the plain 2D frame
// is crisp. `?fx` in the URL forces it back on for testing.
try {
  const coarse = matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (coarse && !new URLSearchParams(location.search).has('fx')) game.g.postfx = false;
} catch (e) {
  /* no matchMedia — leave the grade on */
}

// audio contexts need a user gesture to start — run once, then unbind so the
// handler doesn't re-fire for the life of the page
let woke = false;
const wake = () => {
  if (woke) return;
  woke = true;
  removeEventListener('pointerdown', wake);
  removeEventListener('keydown', wake);
  initAudio();
  music.start();
};
addEventListener('pointerdown', wake);
addEventListener('keydown', wake);

// expose the ambient bed so it can be crossfaded for combat
// TODO: gameplay can crossfade this during combat, e.g. music.setIntensity(threat / 20)
window.music = music;

startLoop(game.update, game.render);
