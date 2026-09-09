export const keys = new Set();
export const mouse = { x: 0, y: 0, down: false };
const justPressed = new Set();

let inputCanvas = null;

// key-rebinding capture: game.js arms this from the rebind screen; the very next
// keydown is swallowed (not fed to keys / justPressed) and handed to the callback.
let captureCb = null;
export function captureNextKey(cb) {
  captureCb = cb;
}

export function initInput(canvas) {
  inputCanvas = canvas;
  addEventListener('keydown', (e) => {
    if (captureCb) {
      const cb = captureCb;
      captureCb = null;
      if (e.preventDefault) e.preventDefault();
      cb(e.code);
      return;
    }
    if (!e.repeat) justPressed.add(e.code);
    keys.add(e.code);
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));

  const setPos = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    padAimHeld = false; // a real mouse move takes aim back from the stick
  };
  canvas.addEventListener('mousemove', setPos);
  canvas.addEventListener('mousedown', (e) => {
    setPos(e);
    if (e.button === 0) mouse.down = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
  });
  addEventListener('blur', () => {
    keys.clear();
    mouse.down = false;
    padKeys.clear();
    padMouseDown = false;
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
}

export function pressed(code) {
  return justPressed.has(code);
}

// inject a code as "just pressed" for exactly one frame — bridges gamepad
// buttons to the existing pressed() checks in game.js
export function injectPress(code) {
  justPressed.add(code);
}

export function endFrameInput() {
  justPressed.clear();
  pollGamepad();
}

// ---------------------------------------------------------------- gamepad
// polled once per frame from endFrameInput. bridges to the keyboard/mouse
// path so game.js needs no changes: left stick writes WASD, right stick
// writes a synthetic cursor, trigger writes mouse.down, buttons inject keys.
export const gamepad = {
  connected: false,
  moveX: 0, moveY: 0,
  aimX: 0, aimY: 0,
  aiming: false,
};

const DEAD = 0.25;
const MOVE_ON = 0.35; // post-deadzone magnitude that latches a WASD key

// gamepad aim-assist: game.js feeds a fresh list of on-screen enemy points (in
// canvas pixels) each frame while the setting is on, and null / [] when it is
// off. the pad-aim path nudges the synthetic cursor toward the nearest one that
// falls inside a cone of the stick's direction.
let aaTargets = null;
export function setAimAssistTargets(list) {
  aaTargets = list && list.length ? list : null;
}
const padKeys = new Set(); // movement codes we are currently holding
let padMouseDown = false; // did we force mouse.down this poll?
let padAimHeld = false; // is the synthetic cursor currently ours to steer?
const padHeld = new Map(); // button index -> down last poll (rising-edge detect)

// face / shoulder / menu buttons -> synthetic one-frame key press
const PAD_BTN = {
  0: 'Space', // A -> dodge
  2: 'KeyR', // X -> reload
  3: 'KeyQ', // Y -> heal
  1: 'KeyE', // B -> interact
  9: 'Tab', // start -> inventory
  8: 'Tab', // select -> inventory
};

function applyDead(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return (((a - DEAD) / (1 - DEAD)) * (v < 0 ? -1 : 1));
}

function setPadKey(code, want) {
  if (want) {
    keys.add(code);
    padKeys.add(code);
  } else if (padKeys.has(code)) {
    keys.delete(code);
    padKeys.delete(code);
  }
}

function releasePad() {
  if (padKeys.size) {
    for (const c of padKeys) keys.delete(c);
    padKeys.clear();
  }
  if (padMouseDown) {
    mouse.down = false;
    padMouseDown = false;
  }
  padHeld.clear();
  gamepad.moveX = gamepad.moveY = gamepad.aimX = gamepad.aimY = 0;
  gamepad.aiming = false;
}

export function pollGamepad() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  let pads;
  try {
    pads = navigator.getGamepads();
  } catch (e) {
    return;
  }
  let gp = null;
  for (let i = 0; pads && i < pads.length; i++) {
    if (pads[i] && pads[i].connected) {
      gp = pads[i];
      break;
    }
  }
  gamepad.connected = !!gp;
  if (!gp) {
    if (padKeys.size || padMouseDown || gamepad.aiming) releasePad();
    return;
  }

  const ax = gp.axes || [];
  const lx = applyDead(ax[0] || 0);
  const ly = applyDead(ax[1] || 0);
  const rx = applyDead(ax[2] || 0);
  const ry = applyDead(ax[3] || 0);
  const btn = gp.buttons || [];
  const down = (i) => !!(btn[i] && (btn[i].pressed || btn[i].value > 0.5));

  // left stick (+ dpad) -> WASD so the existing movement code just works
  gamepad.moveX = lx;
  gamepad.moveY = ly;
  setPadKey('KeyW', ly < -MOVE_ON || down(12));
  setPadKey('KeyS', ly > MOVE_ON || down(13));
  setPadKey('KeyA', lx < -MOVE_ON || down(14));
  setPadKey('KeyD', lx > MOVE_ON || down(15));

  // right stick -> aim: park a synthetic cursor offset from screen centre,
  // which game.js already turns into p.aim. only while the stick is pushed.
  const rmag = Math.hypot(rx, ry);
  if (rmag > 0.02) {
    gamepad.aimX = rx;
    gamepad.aimY = ry;
    gamepad.aiming = true;
    padAimHeld = true;
  } else {
    gamepad.aimX = gamepad.aimY = 0;
    gamepad.aiming = false;
  }
  if (padAimHeld && gamepad.aiming) {
    const cw = (typeof innerWidth === 'number' && innerWidth) || (inputCanvas && inputCanvas.clientWidth) || 960;
    const ch = (typeof innerHeight === 'number' && innerHeight) || (inputCanvas && inputCanvas.clientHeight) || 600;
    const reach = Math.min(cw, ch) * 0.42;
    mouse.x = cw / 2 + rx * reach;
    mouse.y = ch / 2 + ry * reach;
    if (aaTargets) {
      const aimAng = Math.atan2(ry, rx);
      let best = null;
      let bestScore = Infinity;
      for (const t of aaTargets) {
        const ang = Math.atan2(t.y - ch / 2, t.x - cw / 2);
        const off = Math.abs(((ang - aimAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (off > 0.45) continue; // ~26deg acquisition cone
        const score = off * 240 + Math.hypot(t.x - mouse.x, t.y - mouse.y);
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best) {
        mouse.x += (best.x - mouse.x) * 0.5;
        mouse.y += (best.y - mouse.y) * 0.5;
      }
    }
  }

  // right trigger / R1 -> fire
  const fireDown = down(7) || down(5);
  if (fireDown) {
    mouse.down = true;
    padMouseDown = true;
  } else if (padMouseDown) {
    mouse.down = false;
    padMouseDown = false;
  }

  // rising-edge face/menu buttons -> one-frame synthetic key
  for (const k in PAD_BTN) {
    const i = +k;
    const d = down(i);
    if (d && !padHeld.get(i)) injectPress(PAD_BTN[k]);
    padHeld.set(i, d);
  }
}
