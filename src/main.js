import { initInput } from './input.js';
import { initAudio } from './audio.js';
import { startLoop } from './loop.js';
import { createGame } from './game.js';

const canvas = document.getElementById('game');
window.DEBUG = new URLSearchParams(location.search).has('debug');

const game = createGame(canvas);
initInput(canvas);

// audio contexts need a user gesture to start
const wake = () => initAudio();
addEventListener('pointerdown', wake);
addEventListener('keydown', wake);

startLoop(game.update, game.render);
