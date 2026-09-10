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
