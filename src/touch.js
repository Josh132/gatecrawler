// ──────────────────────────────────────────────────────────────────────────
// touch controls — on-screen twin-stick + action buttons for phones / tablets
//
// This module owns NO game state. It translates gestures into the exact same
// `keys` / `mouse` primitives the keyboard+mouse path already writes, plus
// `injectPress()` for one-frame button taps — so game.js barely changes.
//
//   left  half  -> movement stick   -> latches WASD in `keys`
//   right half  -> aim stick        -> parks a synthetic cursor + holds fire
//                                      (game.js reads touchFiring() so every
//                                       weapon auto-fires while it's held)
//   edge buttons-> injectPress(code) -> dodge / reload / heal / nade / swap /
//                                       interact / inventory / pause
//
// It also hangs two chrome pieces off the same overlay: a FULLSCREEN button
// (a real <button>, so the tap is a genuine user gesture) and a portrait
// "rotate your device" scrim, since the game is laid out for landscape.
//
// NOTHING is built on a plain mouse-only desktop (no touch, no coarse pointer),
// which is left completely untouched. On a hybrid machine the touch UI hides
// again the moment a real mouse is used, and returns on the next touch.
//
// While a menu / panel / debrief is up the overlay hides itself and taps on the
// canvas are forwarded as synthetic mouse events, which drive every existing
// click / panelPick / panelDrop / pmouse listener in game.js unchanged.
// ──────────────────────────────────────────────────────────────────────────
import { keys, mouse, injectPress } from './input.js';

const MOVE_ON = 0.30; // stick magnitude that latches a direction key
const STICK_R = 62; // px travel that = full deflection
const AIM_DIR = { x: 1, y: 0 }; // last aim direction (kept after release)
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

let game = null;
let canvas = null;
let root = null; // the #touch overlay container (built lazily)
let engaged = false; // has a real touch ever happened?
let active = false; // is the overlay currently shown / capturing?
let aimFiring = false; // an aim finger is down -> hold fire
let mouseMode = false; // a real mouse is in use -> keep the overlay hidden
let synthMouse = false; // set while we dispatch our own mouse events (menu shim)
const btnEls = {};
const pointers = new Map(); // touch identifier -> { role, ... }

// game.js imports this: true while the aim stick is being held
export function touchFiring() {
  return aimFiring;
}

// gameplay = the twin-stick is meaningful (world is driven directly)
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
  'position:fixed;display:none;align-items:center;justify-content:center;' +
  'width:56px;height:56px;border-radius:50%;pointer-events:auto;' +
  'font:600 13px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.03em;' +
  'color:#bfefff;background:rgba(10,22,30,.42);border:1px solid rgba(94,239,255,.42);' +
  'box-shadow:0 0 12px rgba(0,0,0,.35);user-select:none;-webkit-user-select:none;' +
  'text-align:center;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);' +
  'transition:background .08s,transform .08s;touch-action:none;';

// [code, label, side, slot, onlyPlay]
//   side: 'tl' 'tr' top corners · 'rc' right-edge column · 'lc' left-edge column
const BUTTONS = [
  ['Escape', '❚❚', 'tl', 0, false],
  ['Tab', 'BAG', 'tr', 0, false],
  ['Space', 'ROLL', 'rc', 0, true],
  ['KeyR', 'RLD', 'rc', 1, true],
  ['KeyQ', 'MED', 'rc', 2, true],
  ['KeyG', 'NADE', 'lc', 0, true],
  ['KeyX', 'SWAP', 'lc', 1, true],
  ['KeyE', 'USE', 'lc', 2, false],
];

function placeButton(e, side, slot) {
  const m = 12;
  const step = 64;
  e.style.left = e.style.right = e.style.top = e.style.bottom = 'auto';
  if (side === 'tl') {
    e.style.left = m + 'px';
    e.style.top = m + 'px';
  } else if (side === 'tr') {
    e.style.right = m + 'px';
    e.style.top = m + 'px';
  } else if (side === 'rc') {
    // right edge, a column starting a little above vertical centre — clear of
    // where a thumb naturally rests to work the aim stick (bottom-right)
    e.style.right = m + 'px';
    e.style.top = `calc(42% + ${slot * step}px)`;
  } else {
    e.style.left = m + 'px';
    e.style.top = `calc(42% + ${slot * step}px)`;
  }
}

function buildOverlay() {
  // the container itself never eats input — only its children opt back in
  root = el(
    'div',
    'position:fixed;inset:0;z-index:5;pointer-events:none;touch-action:none;' +
      'overscroll-behavior:none;'
  );
  root.id = 'touch';

  const ringCss =
    'position:fixed;bottom:24px;width:116px;height:116px;border-radius:50%;' +
    'border:1px dashed rgba(120,200,225,.20);pointer-events:none;';
  root.appendChild(el('div', ringCss + 'left:24px;'));
  root.appendChild(el('div', ringCss + 'right:24px;'));

  const knobCss =
    'position:fixed;width:116px;height:116px;margin:-58px 0 0 -58px;border-radius:50%;' +
    'border:1px solid rgba(94,239,255,.38);background:rgba(10,22,30,.26);' +
    'pointer-events:none;display:none;';
  const dotCss =
    'position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;' +
    'border-radius:50%;background:rgba(94,239,255,.26);border:1px solid rgba(94,239,255,.6);';
  root._lStick = el('div', knobCss);
  root._rStick = el('div', knobCss);
  root._lStick._dot = el('div', dotCss);
  root._rStick._dot = el('div', dotCss);
  root._lStick.appendChild(root._lStick._dot);
  root._rStick.appendChild(root._rStick._dot);
  root.appendChild(root._lStick);
  root.appendChild(root._rStick);

  for (const [code, label, side, slot] of BUTTONS) {
    const b = el('div', BTN_CSS, label);
    b.dataset.code = code;
    placeButton(b, side, slot);
    btnEls[code] = b;
    root.appendChild(b);
  }

  root._hint = el(
    'div',
    'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);pointer-events:none;' +
      'display:none;font:500 12px/1.4 ui-monospace,Menlo,monospace;color:#bfefff;' +
      'text-align:center;background:rgba(8,16,22,.6);border:1px solid rgba(94,239,255,.3);' +
      'border-radius:6px;padding:6px 12px;transition:opacity .6s;white-space:nowrap;',
    'left thumb: move   ·   right thumb: aim + auto-fire'
  );
  root.appendChild(root._hint);

  // FULLSCREEN — a real <button> so requestFullscreen() sees a user gesture
  root._fs = el(
    'button',
    'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:22;' +
      'display:none;align-items:center;justify-content:center;pointer-events:auto;' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;' +
      'font:600 13px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;' +
      'color:#bfefff;background:rgba(10,22,30,.66);border:1px solid rgba(94,239,255,.5);' +
      'border-radius:8px;padding:11px 18px;',
    '⛶  FULLSCREEN'
  );
  root._fs.setAttribute('data-ui', '');
  const fsGo = (e) => {
    if (e) e.preventDefault();
    goFullscreen();
  };
  root._fs.addEventListener('click', fsGo);
  root._fs.addEventListener('touchend', fsGo, { passive: false });
  root.appendChild(root._fs);

  // portrait: the whole game is drawn for landscape — ask for a turn
  root._rot = el(
    'div',
    'position:fixed;inset:0;z-index:20;display:none;pointer-events:auto;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:16px;' +
      'background:rgba(4,7,12,.95);color:#cfefff;text-align:center;padding:24px;' +
      'font:600 16px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;'
  );
  root._rot.setAttribute('data-ui', '');
  root._rot.appendChild(
    el('div', 'font-size:60px;line-height:1;transform:rotate(-90deg);opacity:.85;', '📱')
  );
  root._rot.appendChild(el('div', '', 'ROTATE YOUR DEVICE'));
  root._rot.appendChild(
    el('div', 'font-weight:400;opacity:.65;font-size:13px;', 'Gate Crawler plays in landscape')
  );
  root.appendChild(root._rot);

  document.body.appendChild(root);
}

// ---------------------------------------------------------------- fullscreen
function fsEl() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
function fsSupported() {
  const d = document.documentElement;
  return !!(document.fullscreenEnabled || d.requestFullscreen || d.webkitRequestFullscreen);
}
function goFullscreen() {
  if (fsEl()) return;
  const d = document.documentElement;
  const req = d.requestFullscreen || d.webkitRequestFullscreen || d.mozRequestFullScreen;
  if (!req) return;
  try {
    const r = req.call(d);
    if (r && r.then) r.then(lockLandscape, () => {});
    else lockLandscape();
  } catch (e) {
    /* user-gesture / not-supported — nothing to do */
  }
}
function lockLandscape() {
  try {
    const o = screen.orientation;
    if (o && o.lock) o.lock('landscape').catch(() => {});
  } catch (e) {
    /* orientation lock unsupported (iOS, desktop) */
  }
  setTimeout(() => dispatchEvent(new Event('resize')), 120);
}
function isPortrait() {
  return (window.innerHeight || 0) > (window.innerWidth || 0) + 1;
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
  aimFiring = false;
  for (const c in btnEls) {
    btnEls[c].style.background = 'rgba(10,22,30,.42)';
    btnEls[c].style.transform = 'scale(1)';
  }
}
function applyAim() {
  const w = window.innerWidth || 960;
  const h = window.innerHeight || 600;
  const reach = Math.min(w, h) * 0.42;
  mouse.x = w / 2 + AIM_DIR.x * reach;
  mouse.y = h / 2 + AIM_DIR.y * reach;
}
function anyAim() {
  for (const p of pointers.values()) if (p.role === 'aim') return true;
  return false;
}

// ---------------------------------------------------------------- gestures
function ensureEngaged() {
  if (engaged) return;
  engaged = true;
  buildOverlay();
  requestAnimationFrame(refresh);
}

function onTouchStart(ev) {
  mouseMode = false;
  ensureEngaged();
  syncActive(); // flip the overlay on *now*, not one rAF later, so this very
  //              first touch already lands on a stick
  if (!active) {
    // a menu / panel is up — the canvas shim turns this tap into a mouse event
    return;
  }
  if (!ev.changedTouches) return;
  for (const t of ev.changedTouches) {
    const tgt = t.target;
    const bx = tgt && tgt.closest && tgt.closest('[data-code]');
    if (bx) {
      pointers.set(t.identifier, { role: 'btn', code: bx.dataset.code });
      bx.style.background = 'rgba(94,239,255,.3)';
      bx.style.transform = 'scale(.92)';
      injectPress(bx.dataset.code);
      ev.preventDefault();
      continue;
    }
    // fullscreen button / rotate scrim carry their own handlers — not a stick
    if (tgt && tgt.closest && tgt.closest('[data-ui]')) continue;
    const leftSide = t.clientX < window.innerWidth * 0.5;
    const role = leftSide ? 'move' : 'aim';
    let owned = false;
    for (const p of pointers.values()) if (p.role === role) owned = true;
    if (owned) continue;
    pointers.set(t.identifier, { role, ox: t.clientX, oy: t.clientY });
    const stick = leftSide ? root._lStick : root._rStick;
    stick.style.left = t.clientX + 'px';
    stick.style.top = t.clientY + 'px';
    stick.style.display = 'block';
    stick._dot.style.transform = 'translate(0,0)';
    if (!leftSide) {
      aimFiring = true;
      mouse.down = true;
      applyAim();
    }
    ev.preventDefault();
  }
  fadeHint();
}

function onTouchMove(ev) {
  if (!active) return;
  if (!ev.changedTouches) return;
  let touched = false;
  for (const t of ev.changedTouches) {
    const rec = pointers.get(t.identifier);
    if (!rec || rec.role === 'btn') continue;
    touched = true;
    const dx = t.clientX - rec.ox;
    const dy = t.clientY - rec.oy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, STICK_R);
    const stick = rec.role === 'move' ? root._lStick : root._rStick;
    stick._dot.style.transform = `translate(${(dx / len) * cl}px,${(dy / len) * cl}px)`;
    if (rec.role === 'move') {
      setMoveKeys((dx / len) * (cl / STICK_R), (dy / len) * (cl / STICK_R));
    } else {
      if (len > 8) {
        AIM_DIR.x = dx / len;
        AIM_DIR.y = dy / len;
      }
      aimFiring = true;
      mouse.down = true;
      applyAim();
    }
  }
  if (touched) ev.preventDefault();
}

function onTouchEnd(ev) {
  if (!ev.changedTouches) return;
  for (const t of ev.changedTouches) {
    const rec = pointers.get(t.identifier);
    if (!rec) continue;
    pointers.delete(t.identifier);
    if (rec.role === 'btn') {
      const b = btnEls[rec.code];
      if (b) {
        b.style.background = 'rgba(10,22,30,.42)';
        b.style.transform = 'scale(1)';
      }
    } else if (rec.role === 'move') {
      for (const k of MOVE_KEYS) keys.delete(k);
      if (root) root._lStick.style.display = 'none';
    } else {
      if (root) root._rStick.style.display = 'none';
      if (!anyAim()) {
        aimFiring = false;
        mouse.down = false;
      }
    }
  }
  if (ev.cancelable) ev.preventDefault();
}

// ---------------------------------------------------------------- menu shim
// while the overlay is not capturing, forward canvas taps as synthetic mouse
// events so every existing click / panelPick / panelDrop / pmouse path works.
let shimId = null;
let lastShimY = 0;
function dispatchMouse(type, x, y) {
  synthMouse = true;
  canvas.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })
  );
  synthMouse = false;
}
function shimStart(e) {
  mouseMode = false;
  ensureEngaged();
  syncActive();
  if (active) return; // overlay owns the screen
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
// decide whether the overlay is shown / capturing. safe to call synchronously
// from a gesture handler as well as from the rAF poll.
function syncActive() {
  if (!engaged) return;
  const portrait = isPortrait();
  // on a hybrid device a real mouse takes the screen back from touch; portrait
  // parks the sticks behind the rotate scrim
  const want = !mouseMode && !portrait && gameplayActive();
  if (want !== active) {
    active = want;
    if (!want) {
      pointers.clear();
      root._lStick.style.display = root._rStick.style.display = 'none';
      releaseAll();
    }
  }
  if (active) {
    const hub = inHub();
    for (const [code, , , , onlyPlay] of BUTTONS) {
      btnEls[code].style.display = onlyPlay && hub ? 'none' : 'flex';
    }
  } else {
    for (const c in btnEls) btnEls[c].style.display = 'none';
  }
  root._hint.style.display = active ? 'block' : 'none';
  root._rot.style.display = !mouseMode && portrait ? 'flex' : 'none';
  root._fs.style.display = !mouseMode && fsSupported() && !fsEl() ? 'inline-flex' : 'none';
}

// the game's state changes on its own (a run ends, a panel opens) with no
// gesture to react to, so poll once per frame too.
function refresh() {
  if (!engaged) return;
  syncActive();
  requestAnimationFrame(refresh);
}

function fadeHint() {
  if (!root._hint || root._hint._done) return;
  root._hint._done = true;
  setTimeout(() => {
    if (root._hint) root._hint.style.opacity = '0';
  }, 3500);
}

export function initTouch(cnv, gameApi) {
  canvas = cnv;
  game = gameApi;

  const opt = { passive: false };
  addEventListener('touchstart', onTouchStart, opt);
  addEventListener('touchmove', onTouchMove, opt);
  addEventListener('touchend', onTouchEnd, opt);
  addEventListener('touchcancel', onTouchEnd, opt);

  canvas.addEventListener('touchstart', shimStart, opt);
  canvas.addEventListener('touchmove', shimMove, opt);
  canvas.addEventListener('touchend', shimEnd, opt);
  canvas.addEventListener('touchcancel', shimEnd, opt);

  // a genuine mouse (not one we synthesised) means "this is a mouse now" — the
  // touch UI hides until the next real touch. only matters on hybrid 2-in-1s.
  const sawMouse = () => {
    if (synthMouse || !engaged || mouseMode) return;
    mouseMode = true;
    syncActive(); // don't wait for the next poll
  };
  addEventListener('mousemove', sawMouse, true);
  addEventListener('mousedown', sawMouse, true);

  // entering / leaving fullscreen resizes the viewport and changes the button
  const onFs = () => {
    syncActive();
    setTimeout(() => dispatchEvent(new Event('resize')), 60);
  };
  addEventListener('fullscreenchange', onFs);
  addEventListener('webkitfullscreenchange', onFs);

  // keep the 2D canvas fitted when the mobile URL bar shows / hides / rotates
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => dispatchEvent(new Event('resize')));
  }
  addEventListener('orientationchange', () => {
    syncActive();
    setTimeout(() => {
      dispatchEvent(new Event('resize'));
      syncActive();
    }, 120);
  });

  // a touch device (phone / tablet) gets the overlay up front, so FULLSCREEN
  // and the rotate hint are there on the start screen — no first tap needed
  if (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches) {
    ensureEngaged();
    syncActive();
  }
}
