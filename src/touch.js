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
let STICK_R = 62; // px travel that = full deflection — scaled to the viewport by layout()
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
  return !!(g && g.state === 'hub');
}

// ---------------------------------------------------------------- DOM build
function el(tag, css, txt) {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (txt != null) e.textContent = txt;
  return e;
}

const BTN_CSS =
  'position:fixed;display:none;align-items:center;justify-content:center;box-sizing:border-box;' +
  'border-radius:50%;pointer-events:auto;line-height:1;letter-spacing:.02em;' +
  'font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;' +
  'color:#dff4ff;background:rgba(10,22,30,.5);border:1px solid rgba(94,239,255,.5);' +
  'box-shadow:0 2px 14px rgba(0,0,0,.45);user-select:none;-webkit-user-select:none;' +
  'text-align:center;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);' +
  'transition:background .08s,transform .08s;touch-action:none;';

// [code, label, cluster, slot, onlyPlay]
//   cluster: 'pause' top-left · 'menu' top-right · 'right' right-edge column ·
//            'left' left-edge column  (columns are vertically centred, clear of
//            the bottom corners where stick thumbs rest)
const BUTTONS = [
  ['Escape', '❚❚', 'pause', 0, false],
  ['Tab', 'BAG', 'menu', 0, false],
  ['_alt', 'ALT', 'menu', 1, true], // RMB alt-fire (dump / charge / chain / slug / lance)
  ['Space', 'ROLL', 'right', 0, true],
  ['KeyR', 'RLD', 'right', 1, true],
  ['KeyQ', 'MED', 'right', 2, true],
  ['KeyG', 'NADE', 'left', 0, true],
  ['KeyX', 'SWAP', 'left', 1, true],
  ['KeyE', 'USE', 'left', 2, false],
];

// current adaptive metrics — recomputed by layout() on every viewport change
const LM = { S: 56, gap: 66, m: 12, font: 13, stickPx: 116, dotPx: 44 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// size + place every control from the live viewport. small landscape phones get
// smaller, tighter controls; tablets get bigger ones. called on build + resize.
function layout() {
  if (!root) return;
  const w = window.innerWidth || 960;
  const h = window.innerHeight || 600;
  const mn = Math.min(w, h);

  const S = Math.round(clamp(mn * 0.145, 44, 68)); // button diameter (>=44 tap target)
  const gap = Math.round(S + clamp(mn * 0.022, 5, 14)); // centre-to-centre in a column
  const m = Math.round(clamp(mn * 0.03, 8, 18)); // edge margin
  const font = Math.round(clamp(S * 0.26, 9.5, 15));
  LM.S = S; LM.gap = gap; LM.m = m; LM.font = font;
  LM.stickPx = Math.round(clamp(mn * 0.30, 84, 150)); // stick ring visual
  LM.dotPx = Math.round(LM.stickPx * 0.38);
  STICK_R = Math.round(clamp(mn * 0.16, 38, 74)); // deflection travel

  // edge columns sit in a safe vertical band — below the corner buttons, above
  // the bottom edge — and spread evenly, tightening on short screens
  const topSafeR = m + 2 * (S + 8) + 8; // clear of BAG + ALT (top-right)
  const topSafeL = m + S + 12; // clear of ❚❚ (top-left)
  const botSafe = h - m - S;
  for (const [code, , cluster, slot] of BUTTONS) {
    const b = btnEls[code];
    if (!b) continue;
    b.style.width = b.style.height = S + 'px';
    b.style.fontSize = font + 'px';
    b.style.left = b.style.right = b.style.top = b.style.bottom = 'auto';
    if (cluster === 'pause') {
      b.style.left = m + 'px';
      b.style.top = m + 'px';
    } else if (cluster === 'menu') {
      b.style.right = m + 'px';
      b.style.top = m + slot * (S + 8) + 'px';
    } else {
      const topSafe = cluster === 'right' ? topSafeR : topSafeL;
      const span = Math.max(S, botSafe - topSafe);
      const g3 = Math.min(gap, span / 2); // 3 buttons in the column -> 2 gaps
      const yc = topSafe + span / 2 + (slot - 1) * g3 - S / 2;
      b.style.top = clamp(yc, topSafe, botSafe) + 'px';
      b.style[cluster === 'right' ? 'right' : 'left'] = m + 'px';
    }
  }

  // stick knob + dot + home-ring visuals
  for (const st of [root._lStick, root._rStick]) {
    st.style.width = st.style.height = LM.stickPx + 'px';
    st.style.margin = `${-LM.stickPx / 2}px 0 0 ${-LM.stickPx / 2}px`;
    st._dot.style.width = st._dot.style.height = LM.dotPx + 'px';
    st._dot.style.margin = `${-LM.dotPx / 2}px 0 0 ${-LM.dotPx / 2}px`;
  }
  const ringD = Math.round(LM.stickPx * 0.94);
  for (const hr of root._hints2) {
    hr.style.width = hr.style.height = ringD + 'px';
    hr.style.bottom = Math.round(m * 1.6) + 'px';
    hr.style[hr._side] = Math.round(m * 1.6) + 'px';
  }
  root._hint.style.bottom = Math.round(h * 0.32) + 'px';
  root._hint.style.fontSize = clamp(font - 1, 10, 13) + 'px';

  // FULLSCREEN button
  root._fs.style.top = m + 'px';
  root._fs.style.fontSize = clamp(font, 11, 14) + 'px';
  root._fs.style.padding = `${Math.round(S * 0.22)}px ${Math.round(S * 0.42)}px`;
  // SKIP TIPS pill — bottom-right, just above the aim stick's rest zone
  root._skip.style.bottom = Math.round(h * 0.30) + 'px';
  root._skip.style.right = m + 'px';
  root._skip.style.fontSize = clamp(font - 2, 9, 12) + 'px';
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
    'position:fixed;border-radius:50%;border:1px dashed rgba(120,200,225,.20);pointer-events:none;';
  root._hints2 = [el('div', ringCss), el('div', ringCss)];
  root._hints2[0]._side = 'left';
  root._hints2[1]._side = 'right';
  root._hints2.forEach((r) => root.appendChild(r));

  const knobCss =
    'position:fixed;border-radius:50%;' +
    'border:1px solid rgba(94,239,255,.42);background:rgba(10,22,30,.3);' +
    'pointer-events:none;display:none;';
  const dotCss =
    'position:absolute;left:50%;top:50%;' +
    'border-radius:50%;background:rgba(94,239,255,.3);border:1px solid rgba(94,239,255,.65);';
  root._lStick = el('div', knobCss);
  root._rStick = el('div', knobCss);
  root._lStick._dot = el('div', dotCss);
  root._rStick._dot = el('div', dotCss);
  root._lStick.appendChild(root._lStick._dot);
  root._rStick.appendChild(root._rStick._dot);
  root.appendChild(root._lStick);
  root.appendChild(root._rStick);

  for (const [code, label] of BUTTONS) {
    const b = el('div', BTN_CSS, label);
    b.dataset.code = code;
    btnEls[code] = b;
    root.appendChild(b);
  }

  root._hint = el(
    'div',
    'position:fixed;left:50%;transform:translateX(-50%);pointer-events:none;' +
      'display:none;font:500 12px/1.4 ui-monospace,Menlo,monospace;color:#bfefff;' +
      'text-align:center;background:rgba(8,16,22,.66);border:1px solid rgba(94,239,255,.3);' +
      'border-radius:6px;padding:6px 12px;transition:opacity .6s;white-space:nowrap;',
    'left thumb: move   ·   right thumb: aim + fire'
  );
  root.appendChild(root._hint);

  // FULLSCREEN — a real <button> so requestFullscreen() sees a user gesture.
  // touchend fires it directly (a definite activation); click covers desktop.
  root._fs = el(
    'button',
    'position:fixed;left:50%;transform:translateX(-50%);z-index:22;' +
      'display:none;align-items:center;justify-content:center;pointer-events:auto;' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;' +
      'font:700 13px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;' +
      'color:#dff4ff;background:rgba(10,22,30,.78);border:1px solid rgba(94,239,255,.6);' +
      'box-shadow:0 2px 16px rgba(0,0,0,.5);border-radius:9px;min-height:44px;',
    '⛶  FULLSCREEN'
  );
  root._fs.setAttribute('data-ui', '');
  root._fs.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    goFullscreen();
  }, { passive: false });
  root._fs.addEventListener('click', goFullscreen);
  root.appendChild(root._fs);

  // SKIP TIPS — shown only while the first-run tutorial queue is up (the tip
  // card itself isn't tappable on mobile because the sticks own the screen)
  root._skip = el(
    'button',
    'position:fixed;right:12px;z-index:22;display:none;pointer-events:auto;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent;touch-action:manipulation;' +
      'font:700 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;' +
      'color:#cdd;background:rgba(10,22,30,.8);border:1px solid rgba(150,170,190,.5);' +
      'border-radius:8px;padding:9px 12px;',
    'SKIP TIPS ✕'
  );
  root._skip.setAttribute('data-ui', '');
  const doSkip = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const g = game && game.g;
    if (g) g._skipTips = true;
  };
  root._skip.addEventListener('touchend', doSkip, { passive: false });
  root._skip.addEventListener('click', doSkip);
  root.appendChild(root._skip);

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
  layout();
}

// ---------------------------------------------------------------- fullscreen
function fsEl() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
function reqFsOn(el) {
  return el && (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen);
}
function fsSupported() {
  // element fullscreen — NOT iPhone Safari (there it's video-only, so this is false
  // and the button hides; Add-to-Home-Screen is the route there)
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled || reqFsOn(document.documentElement));
}
let _fsTried = 0;
let _fsAuto = false; // have we auto-attempted fullscreen on the first gameplay touch?
function goFullscreen(silent) {
  if (fsEl()) return;
  _fsTried = Date.now();
  // try <html>, then <body> — some Android browsers only honour one
  for (const target of [document.documentElement, document.body]) {
    const req = reqFsOn(target);
    if (!req) continue;
    try {
      const r = req.call(target);
      if (r && r.then) r.then(afterFs, () => {});
      else afterFs();
      break;
    } catch (e) {
      /* fall through to the next target */
    }
  }
  // if nothing took hold, tell the user how to do it manually (unless auto-tried)
  if (!silent) {
    setTimeout(() => {
      if (!fsEl() && Date.now() - _fsTried < 2500) fsToast();
    }, 900);
  }
}
function afterFs() {
  try {
    const o = screen.orientation;
    if (o && o.lock) o.lock('landscape').catch(() => {});
  } catch (e) {
    /* orientation lock unsupported (iOS, desktop) — harmless */
  }
  // the viewport takes a beat to settle after entering fullscreen; re-fit a few times
  for (const d of [40, 180, 450]) setTimeout(() => { dispatchEvent(new Event('resize')); layout(); }, d);
}
function fsToast() {
  if (!root) return;
  let t = root._fsToast;
  if (!t) {
    t = root._fsToast = el(
      'div',
      'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:23;pointer-events:none;' +
        'max-width:80vw;font:500 12px/1.4 ui-monospace,Menlo,monospace;color:#ffe;text-align:center;' +
        'background:rgba(8,14,22,.92);border:1px solid rgba(255,200,110,.5);border-radius:7px;padding:8px 14px;' +
        'transition:opacity .5s;'
    );
    root.appendChild(t);
  }
  t.textContent =
    "Fullscreen isn't available in this browser — use its ⋮ menu, or Add to Home Screen for a chrome-free window.";
  t.style.opacity = '1';
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.opacity = '0'), 5000);
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
  if (engaged || root) return;
  // build first — if buildOverlay throws, `engaged` must stay false so the
  // refresh() rAF loop below never runs against a half-built overlay
  buildOverlay();
  engaged = true;
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
  // first time the player drives the world, quietly bid for fullscreen (this is
  // a real user gesture); the menu FULLSCREEN button covers the explicit case
  if (!_fsAuto && fsSupported() && !fsEl()) {
    _fsAuto = true;
    goFullscreen(true);
  }
  if (!ev.changedTouches) return;
  for (const t of ev.changedTouches) {
    const tgt = t.target;
    const bx = tgt && tgt.closest && tgt.closest('[data-code]');
    if (bx) {
      const code = bx.dataset.code;
      pointers.set(t.identifier, { role: 'btn', code });
      bx.style.background = 'rgba(94,239,255,.3)';
      bx.style.transform = 'scale(.92)';
      if (code === '_alt') {
        mouse.right = true; // held: drives charge weapons
        mouse.rightEdge = true; // one-frame: triggers the alt shot (cleared by endFrameInput)
      } else {
        injectPress(code);
      }
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
  let handled = false;
  for (const t of ev.changedTouches) {
    const rec = pointers.get(t.identifier);
    if (!rec) continue;
    handled = true;
    pointers.delete(t.identifier);
    if (rec.role === 'btn') {
      const b = btnEls[rec.code];
      if (b) {
        b.style.background = 'rgba(10,22,30,.42)';
        b.style.transform = 'scale(1)';
      }
      if (rec.code === '_alt') mouse.right = false;
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
  if (handled && ev.cancelable) ev.preventDefault(); // leave [data-ui] taps for their own click handlers
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
// syncActive runs every rAF — only write .style when the value actually changes.
// (the two stick knobs are driven straight from the gesture handlers, not here.)
const _disp = new Map();
function show(elm, val) {
  if (!elm || _disp.get(elm) === val) return;
  _disp.set(elm, val);
  elm.style.display = val;
}

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
  const hub = active && inHub();
  for (const [code, , , , onlyPlay] of BUTTONS) {
    show(btnEls[code], active && !(onlyPlay && hub) ? 'flex' : 'none');
  }
  show(root._hint, active ? 'block' : 'none');
  show(root._rot, !mouseMode && portrait ? 'flex' : 'none');
  show(root._fs, !mouseMode && fsSupported() && !fsEl() ? 'inline-flex' : 'none');
  const g = game && game.g;
  const tipsUp = !!(g && g.tips && g.tips.i < g.tips.list.length);
  show(root._skip, active && tipsUp ? 'inline-flex' : 'none');
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
  if (canvas) return; // idempotent — a second call must not double every listener
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

  // re-fit the controls to the viewport whenever it changes size
  addEventListener('resize', () => { if (engaged) layout(); });

  // entering / leaving fullscreen resizes the viewport and changes the button
  const onFs = () => {
    if (engaged) layout();
    syncActive();
    for (const d of [60, 240, 600]) setTimeout(() => { dispatchEvent(new Event('resize')); if (engaged) layout(); }, d);
  };
  addEventListener('fullscreenchange', onFs);
  addEventListener('webkitfullscreenchange', onFs);

  // keep the 2D canvas fitted when the mobile URL bar shows / hides / rotates
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      dispatchEvent(new Event('resize'));
      if (engaged) layout();
    });
  }
  addEventListener('orientationchange', () => {
    syncActive();
    setTimeout(() => {
      dispatchEvent(new Event('resize'));
      if (engaged) layout();
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
