// ──────────────────────────────────────────────────────────────────────────
// touch controls — on-screen twin-stick + action buttons for phones / tablets
//
// This module owns NO game state. It translates gestures into the exact same
// `keys` / `mouse` primitives the keyboard+mouse path already writes, plus
// `injectPress()` for one-frame button taps — so game.js needs no changes.
//
//   left  half  -> movement stick   -> latches WASD in `keys`
//   right half  -> aim stick        -> parks a synthetic cursor + holds fire
//   edge buttons-> injectPress(code) -> dodge / reload / heal / nade / swap /
//                                       interact / inventory / pause
//
// While a menu / panel / debrief is up the overlay hides itself and taps on the
// canvas are forwarded as synthetic mouse events, which drive every existing
// click / panelPick / panelDrop / pmouse listener in game.js unchanged.
// ──────────────────────────────────────────────────────────────────────────
import { keys, mouse, injectPress } from './input.js';

const MOVE_ON = 0.30; // stick magnitude that latches a direction key
const STICK_R = 62; // px travel that = full deflection
const AIM_DIR = { x: 1, y: 0 }; // last aim direction (kept after release)

let game = null;
let canvas = null;
let root = null; // the #touch overlay container
let active = false; // is the overlay currently shown / capturing?
const btnEls = {}; // code -> element
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

// live pointer bookkeeping (multi-touch): identifier -> role record
const pointers = new Map();

function isTouchDevice() {
  return (
    (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window
  );
}

// gameplay = twin-stick is meaningful (world is being driven directly)
function gameplayActive() {
  const g = game && game.g;
  if (!g) return false;
  if (g.state !== 'play' && g.state !== 'hub') return false;
  if (g.paused || g.panelOpen || g.station || g.vendorOpen || g.drag) return false;
  if (g.uiStack && g.uiStack.length) return false;
  return true;
}
function inHub() {
  const g = game && game.g;
  return !!(g && (g.state === 'hub' || g.hub));
}

// ---------------------------------------------------------------- DOM build
function el(tag, css, txt) {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (txt != null) e.textContent = txt;
  return e;
}

const BTN_CSS =
  'position:fixed;display:flex;align-items:center;justify-content:center;' +
  'width:58px;height:58px;border-radius:50%;pointer-events:auto;' +
  'font:600 15px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.02em;' +
  'color:#bfefff;background:rgba(10,22,30,.44);border:1px solid rgba(94,239,255,.45);' +
  'box-shadow:0 0 12px rgba(0,0,0,.35);user-select:none;-webkit-user-select:none;' +
  'text-align:center;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);' +
  'transition:background .08s,transform .08s;touch-action:none;';

// [code, label, corner, stackIndex, onlyPlay]
const BUTTONS = [
  ['Escape', '❚❚', 'tl', 0, false],
  ['Tab', 'BAG', 'tr', 0, false],
  ['KeyE', 'USE', 'bl', 0, false],
  ['KeyX', 'SWP', 'bl', 1, true],
  ['KeyG', 'NADE', 'bl', 2, true],
  ['Space', 'ROLL', 'br', 0, true],
  ['KeyR', 'RLD', 'br', 1, true],
  ['KeyQ', 'MED', 'br', 2, true],
];

function placeButton(e, corner, i) {
  const gap = 70;
  const m = 14;
  e.style.left = e.style.right = e.style.top = e.style.bottom = 'auto';
  if (corner === 'tl') {
    e.style.left = m + 'px';
    e.style.top = m + 'px';
  } else if (corner === 'tr') {
    e.style.right = m + 'px';
    e.style.top = m + 'px';
  } else if (corner === 'bl') {
    e.style.left = m + i * gap + 'px';
    e.style.bottom = m + 'px';
  } else {
    e.style.right = m + i * gap + 'px';
    e.style.bottom = m + 'px';
  }
}

function buildOverlay() {
  root = el(
    'div',
    'position:fixed;inset:0;z-index:5;pointer-events:none;touch-action:none;' +
      'display:none;overscroll-behavior:none;'
  );
  root.id = 'touch';

  // faint "home" rings hint where the two sticks live
  const ringCss =
    'position:fixed;bottom:26px;width:118px;height:118px;border-radius:50%;' +
    'border:1px dashed rgba(120,200,225,.22);pointer-events:none;';
  root._lHint = el('div', ringCss + 'left:26px;');
  root._rHint = el('div', ringCss + 'right:26px;');
  root.appendChild(root._lHint);
  root.appendChild(root._rHint);

  // live stick knobs (shown only while a finger drives them)
  const knobCss =
    'position:fixed;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;' +
    'border:1px solid rgba(94,239,255,.4);background:rgba(10,22,30,.28);' +
    'pointer-events:none;display:none;';
  root._lStick = el('div', knobCss);
  root._rStick = el('div', knobCss);
  const dotCss =
    'position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;' +
    'border-radius:50%;background:rgba(94,239,255,.28);border:1px solid rgba(94,239,255,.6);';
  root._lStick._dot = el('div', dotCss);
  root._rStick._dot = el('div', dotCss);
  root._lStick.appendChild(root._lStick._dot);
  root._rStick.appendChild(root._rStick._dot);
  root.appendChild(root._lStick);
  root.appendChild(root._rStick);

  for (const [code, label, corner, i] of BUTTONS) {
    const b = el('div', BTN_CSS, label);
    b.dataset.code = code;
    placeButton(b, corner, i);
    btnEls[code] = b;
    root.appendChild(b);
  }

  root._hint = el(
    'div',
    'position:fixed;left:50%;top:12px;transform:translateX(-50%);pointer-events:none;' +
      'font:500 12px/1.4 ui-monospace,Menlo,monospace;color:#bfefff;text-align:center;' +
      'background:rgba(8,16,22,.6);border:1px solid rgba(94,239,255,.3);border-radius:6px;' +
      'padding:6px 12px;transition:opacity .6s;white-space:nowrap;',
    'left thumb — move    ·    right thumb — aim & fire'
  );
  root.appendChild(root._hint);

  document.body.appendChild(root);
}

// ---------------------------------------------------------------- helpers
function setMoveKeys(vx, vy) {
  const on = Math.hypot(vx, vy) >= MOVE_ON;
  setKey('KeyW', on && vy < -MOVE_ON);
  setKey('KeyS', on && vy > MOVE_ON);
  setKey('KeyA', on && vx < -MOVE_ON);
  setKey('KeyD', on && vx > MOVE_ON);
}
function setKey(code, want) {
  if (want) keys.add(code);
  else keys.delete(code);
}
function releaseAll() {
  for (const k of MOVE_KEYS) keys.delete(k);
  mouse.down = false;
  mouse.right = false;
  for (const c in btnEls) btnEls[c].style.background = 'rgba(10,22,30,.44)';
}

function applyAim() {
  const w = window.innerWidth || 960;
  const h = window.innerHeight || 600;
  const reach = Math.min(w, h) * 0.42;
  mouse.x = w / 2 + AIM_DIR.x * reach;
  mouse.y = h / 2 + AIM_DIR.y * reach;
}

// ---------------------------------------------------------------- gestures
function onStart(ev) {
  if (!active) return;
  for (const t of ev.changedTouches) {
    const bx = t.target && t.target.closest && t.target.closest('[data-code]');
    if (bx) {
      const code = bx.dataset.code;
      pointers.set(t.identifier, { role: 'btn', code });
      bx.style.background = 'rgba(94,239,255,.3)';
      bx.style.transform = 'scale(.92)';
      injectPress(code);
      ev.preventDefault();
      continue;
    }
    const leftSide = t.clientX < window.innerWidth * 0.5;
    // one finger per stick — a second touch on an owned side is ignored
    const owned = [...pointers.values()].some((p) => p.role === (leftSide ? 'move' : 'aim'));
    if (owned) continue;
    const rec = { role: leftSide ? 'move' : 'aim', ox: t.clientX, oy: t.clientY };
    pointers.set(t.identifier, rec);
    const stick = leftSide ? root._lStick : root._rStick;
    stick.style.left = t.clientX + 'px';
    stick.style.top = t.clientY + 'px';
    stick.style.display = 'block';
    stick._dot.style.transform = 'translate(0,0)';
    if (!leftSide) mouse.down = true;
    ev.preventDefault();
  }
  fadeHint();
}

function onMove(ev) {
  if (!active) return;
  let touched = false;
  for (const t of ev.changedTouches) {
    const rec = pointers.get(t.identifier);
    if (!rec || rec.role === 'btn') continue;
    touched = true;
    let dx = t.clientX - rec.ox;
    let dy = t.clientY - rec.oy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, STICK_R);
    const nx = (dx / len) * (cl / STICK_R);
    const ny = (dy / len) * (cl / STICK_R);
    const stick = rec.role === 'move' ? root._lStick : root._rStick;
    stick._dot.style.transform = `translate(${(dx / len) * cl}px,${(dy / len) * cl}px)`;
    if (rec.role === 'move') {
      setMoveKeys(nx, ny);
    } else {
      if (len > 8) {
        AIM_DIR.x = dx / len;
        AIM_DIR.y = dy / len;
      }
      applyAim();
    }
  }
  if (touched) ev.preventDefault();
}

function onEnd(ev) {
  for (const t of ev.changedTouches) {
    const rec = pointers.get(t.identifier);
    if (!rec) continue;
    pointers.delete(t.identifier);
    if (rec.role === 'btn') {
      const b = btnEls[rec.code];
      if (b) {
        b.style.background = 'rgba(10,22,30,.44)';
        b.style.transform = 'scale(1)';
      }
      continue;
    }
    if (rec.role === 'move') {
      for (const k of MOVE_KEYS) keys.delete(k);
      root._lStick.style.display = 'none';
    } else {
      root._rStick.style.display = 'none';
      // fire stays down only while some aim finger remains
      if (![...pointers.values()].some((p) => p.role === 'aim')) mouse.down = false;
    }
  }
  if (ev.cancelable) ev.preventDefault();
}

// ---------------------------------------------------------------- menu shim
// while the overlay is hidden, forward canvas taps as synthetic mouse events
let shimId = null;
let lastShimY = 0;
function dispatchMouse(type, x, y) {
  canvas.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })
  );
}
function shimStart(e) {
  if (active || gameplayActive()) return;
  const t = e.changedTouches[0];
  if (!t) return;
  shimId = t.identifier;
  lastShimY = t.clientY;
  dispatchMouse('mousemove', t.clientX, t.clientY);
  dispatchMouse('mousedown', t.clientX, t.clientY);
  e.preventDefault();
}
function shimMove(e) {
  if (shimId == null) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== shimId) continue;
    dispatchMouse('mousemove', t.clientX, t.clientY);
    const g = game && game.g;
    if (g && !g.drag) {
      const dy = t.clientY - lastShimY;
      if (Math.abs(dy) >= 44) {
        g.wheel += dy < 0 ? -1 : 1;
        lastShimY = t.clientY;
      }
    }
    e.preventDefault();
  }
}
function shimEnd(e) {
  if (shimId == null) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== shimId) continue;
    dispatchMouse('mousemove', t.clientX, t.clientY);
    dispatchMouse('mouseup', t.clientX, t.clientY);
    dispatchMouse('click', t.clientX, t.clientY);
    shimId = null;
    if (e.cancelable) e.preventDefault();
  }
}

// ---------------------------------------------------------------- lifecycle
function refresh() {
  const want = gameplayActive();
  if (want !== active) {
    active = want;
    root.style.display = want ? 'block' : 'none';
    root.style.pointerEvents = want ? 'auto' : 'none';
    if (!want) {
      for (const id of [...pointers.keys()]) pointers.delete(id);
      root._lStick.style.display = root._rStick.style.display = 'none';
      releaseAll();
    }
  }
  if (active) {
    const hub = inHub();
    for (const [code, , , , onlyPlay] of BUTTONS) {
      btnEls[code].style.display = onlyPlay && hub ? 'none' : 'flex';
    }
  }
  requestAnimationFrame(refresh);
}

function fadeHint() {
  if (!root._hint || root._hint._done) return;
  root._hint._done = true;
  setTimeout(() => {
    root._hint.style.opacity = '0';
  }, 3500);
}

export function initTouch(cnv, gameApi) {
  canvas = cnv;
  game = gameApi;
  if (!isTouchDevice()) {
    // still arm a one-shot: a hybrid device may touch later
    const arm = () => {
      removeEventListener('touchstart', arm);
      startTouch();
    };
    addEventListener('touchstart', arm, { passive: true });
    return;
  }
  startTouch();
}

let started = false;
function startTouch() {
  if (started) return;
  started = true;
  buildOverlay();

  const opt = { passive: false };
  root.addEventListener('touchstart', onStart, opt);
  root.addEventListener('touchmove', onMove, opt);
  root.addEventListener('touchend', onEnd, opt);
  root.addEventListener('touchcancel', onEnd, opt);

  canvas.addEventListener('touchstart', shimStart, opt);
  canvas.addEventListener('touchmove', shimMove, opt);
  canvas.addEventListener('touchend', shimEnd, opt);
  canvas.addEventListener('touchcancel', shimEnd, opt);

  // keep the 2D canvas fitted when the mobile URL bar shows / hides
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => dispatchEvent(new Event('resize')));
  }
  addEventListener('orientationchange', () => setTimeout(() => dispatchEvent(new Event('resize')), 120));

  requestAnimationFrame(refresh);
}
