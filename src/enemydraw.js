// ──────────────────────────────────────────────────────────────────────────────
// enemydraw.js — the figure/shadow render cluster split out of game.js: the
// shared ground-shadow primitive, the top-down humanoid wrapper, and the
// player + enemy sprites. One-way: game.js imports these; this file imports
// only leaf render helpers. `Math.random()` here is cosmetic jitter, never
// worldgen — this file is nowhere near the seed stream.
// ──────────────────────────────────────────────────────────────────────────────
import { TAU, clamp, glowCircle, hexA, shade, figure, spider, critter, LIGHT_DIR as LIGHT } from './draw.js';
import { WEAPONS } from './weapons.js';
import { activeWeaponId } from './inventory.js';
import { RARITY_COLOR, normRarity, rarityTierOf } from './icons.js';

// highest worn rarity tints the whole kit — a local copy of game.js's stackRarity
function stackRarity(stack) {
  if (!stack) return 'common';
  return stack.rarity ? normRarity(stack.rarity) : rarityTierOf(stack.id);
}

// ---- shared ground shadow --------------------------------------------------
let shadowBlob = null;
function shadowSprite() {
  if (shadowBlob) return shadowBlob;
  try {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const c = cv.getContext('2d');
    const grd = c.createRadialGradient(32, 32, 1, 32, 32, 31);
    grd.addColorStop(0, 'rgba(0,0,0,0.8)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
    shadowBlob = cv;
  } catch (e) {
    /* headless */
  }
  return shadowBlob;
}

// soft ground shadow offset along the light vector. z lifts the caster: the
// shadow slides away, shrinks and fades as it climbs.
function drawShadow(ctx, x, y, r, z, alpha) {
  const sp = shadowSprite();
  if (!sp) return;
  const h = z || 0;
  const k = 1 / (1 + h / 40);
  const rx = r * 1.3 * k;
  const ry = r * 0.66 * k;
  const cx = x + LIGHT.x * (r * 0.45 + h * 0.6);
  const cy = y + LIGHT.y * (r * 0.45 + h * 0.6);
  const a0 = ctx.globalAlpha == null ? 1 : ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = a0 * (alpha == null ? 1 : alpha) * (0.4 + 0.6 * k);
  ctx.drawImage(sp, cx - rx, cy - ry, rx * 2, ry * 2);
  ctx.restore();
}


// top-down figure: skeleton, gait and gear all live in draw.js `figure`. this
// keeps the legacy signature + o keys and adds the ground shadow.
function drawHumanoid(ctx, x, y, ang, s, body, head, o) {
  o = o || {};
  const bulk = (o.build && o.build.bulk) || 1;
  if (o.shadow !== false) drawShadow(ctx, x, y + 2.5 * s, 6.6 * s * (0.78 + 0.22 * bulk), o.z || 0);
  figure(ctx, x, y, ang, s, body, head, o);
}

// rank a rarity tier so the best worn piece can tint the whole kit
function rarityRank(r) {
  return r === 'legendary' ? 3 : r === 'epic' ? 2 : r === 'good' || r === 'uncommon' ? 1 : 0;
}

function drawPlayer(ctx, p, t, g) {
  const hub = g && g.state === 'hub';
  // always-on locator so you never lose yourself in a busy frame
  ctx.save();
  const rg = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r + 16);
  rg.addColorStop(0, 'rgba(110,220,255,0.20)');
  rg.addColorStop(1, 'rgba(110,220,255,0)');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 16, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,235,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 6, 0, TAU);
  ctx.stroke();
  // facing wedge
  ctx.fillStyle = 'rgba(180,240,255,0.8)';
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(p.aim) * (p.r + 5), p.y + Math.sin(p.aim) * (p.r + 5));
  ctx.lineTo(p.x + Math.cos(p.aim + 0.35) * (p.r + 13), p.y + Math.sin(p.aim + 0.35) * (p.r + 13));
  ctx.lineTo(p.x + Math.cos(p.aim - 0.35) * (p.r + 13), p.y + Math.sin(p.aim - 0.35) * (p.r + 13));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  let body = '#7fe6ff';
  let head = '#e6faff';
  if (p.flash > 0) {
    body = '#ffffff';
    head = '#ffffff';
  } else if (p.iframe > 0 && Math.floor(t * 30) % 2) {
    body = 'rgba(140,235,255,0.5)';
    head = 'rgba(200,245,255,0.6)';
  }

  // gear read: equipped armour becomes plating, tinted by its rarity; the
  // equipped gun picks the weapon silhouette
  const inv = g && g.inv;
  const eq = inv ? inv.equip : null;
  const hs = eq ? eq.head : null;
  const ts = eq ? eq.torso : null;
  const ls = eq ? eq.legs : null;
  const fs = eq ? eq.feet : null;
  let tier = 'common';
  if (hs && rarityRank(stackRarity(hs)) > rarityRank(tier)) tier = stackRarity(hs);
  if (ts && rarityRank(stackRarity(ts)) > rarityRank(tier)) tier = stackRarity(ts);
  if (ls && rarityRank(stackRarity(ls)) > rarityRank(tier)) tier = stackRarity(ls);
  if (fs && rarityRank(stackRarity(fs)) > rarityRank(tier)) tier = stackRarity(fs);
  const geared = !!(hs || ts || ls || fs);
  const wid = inv ? activeWeaponId(inv) : 'p90';
  const wdef = WEAPONS[wid];

  // one persistent build/opts pair — this runs every frame, allocate nothing
  const B = drawPlayer.B || (drawPlayer.B = {});
  const O = drawPlayer.O || (drawPlayer.O = { build: B, muzzle: { x: 0, y: 0 } });
  B.bulk = ts ? 1.14 : 1.04;
  B.vest = true;
  B.glove = '#2e4a58';
  B.helm = hs ? (hs.id === 'a_helm' ? 'dome' : 'cap') : 'cap';
  B.visor = hs && hs.id === 'a_visor' ? '#9fe6ff' : false;
  B.plate = ts ? (ts.id === 'a_plate' ? 'heavy' : 'front') : false;
  B.greaves = !!ls;
  B.boots = !!fs;
  // team teal by default, rarity tint once anything is worn
  B.trim = geared ? RARITY_COLOR[tier] || '#6fd6e6' : '#6fd6e6';

  // pose from player state
  let pose = null;
  if (p.alive === false) pose = 'dead';
  else if (p.dodge > 0) pose = 'dodge';
  else if (p.flash > 0) pose = 'hit';
  else if (p.reloading || p.reloadT > 0) pose = 'reload';
  O.pose = pose;
  O.t = t;
  O.phase = 0;
  O.vx = p.vx;
  O.vy = p.vy;
  O.gait = clamp(Math.hypot(p.vx || 0, p.vy || 0) / (p.speed || 232), 0, 1);
  O.hurt = p.flash > 0 ? clamp(p.flash / 0.12, 0, 1) : 0;
  O.hitDir = p.kx || p.ky ? Math.atan2(p.ky, p.kx) : p.aim + Math.PI;
  O.recoil = p.cool > 0 ? clamp(p.cool / 0.16, 0, 1) : 0;
  O.reload =
    p.reloadT > 0 && p.reloadDur > 0
      ? clamp(Math.sin((1 - p.reloadT / p.reloadDur) * Math.PI) * 1.7, 0.3, 1)
      : 1;
  O.deathDir = p.aim + Math.PI;
  O.weapon = true;
  O.weaponKind = wid;
  O.weaponLen = null;
  O.weaponColor = p.flash > 0 ? '#fff' : (wdef && wdef.color) || '#f4faff';
  O.head = 3.1;
  O.blur = 14;
  O.glow = '#7fe6ff';
  O.z = 0;
  drawHumanoid(ctx, p.x, p.y, p.aim, 1.12, body, head, O);

  // top-tier kit gets a faint rim glow so an upgrade reads on the body
  if (geared && (tier === 'epic' || tier === 'legendary')) {
    glowCircle(ctx, p.x, p.y, p.r + 1, hexA(RARITY_COLOR[tier] || '#b06cff', 0.12), 16);
  }
  if (p.dodge > 0) glowCircle(ctx, p.x, p.y, p.r + 4, 'rgba(120,230,255,0.28)', 18);
  if (p.stun > 0) {
    ctx.strokeStyle = 'rgba(255,220,120,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 8, 0, TAU);
    ctx.stroke();
  }
  if (!hub && p.stimT > 0) glowCircle(ctx, p.x, p.y, p.r + 2, 'rgba(255,213,74,0.22)', 14);
}



const FACTION_TINT = {
  jaffa: '#ffb347',
  wraith: '#8bf0a0',
  replicator: '#8fe4ff',
  scav: '#9fb8c8',
  boss: '#ffd27a',
};

// per-kind silhouette descriptors — static, shared, never mutated per frame
function enemyBuilds() {
  return (
    drawEnemy.B ||
    (drawEnemy.B = {
      jaffa: { bulk: 1.14, pauldrons: true, helm: 'serpent', plate: 'front', boots: true, trim: '#f2d5a2', glove: '#4a3320' },
      jaffa_heavy: { bulk: 1.5, pauldrons: true, helm: 'dome', plate: 'heavy', boots: true, greaves: true, trim: '#ffdca0', glove: '#4a3320' },
      jaffa_grenadier: { bulk: 1.02, pauldrons: true, helm: 'dome', boots: true, trim: '#ffe3ac', glove: '#4a3320' },
      jaffa_sniper: { bulk: 0.94, helm: 'serpent', kneel: true, boots: true, greaves: true, trim: '#e8c896', glove: '#4a3320' },
      wraith: { bulk: 0.96, coatTails: true, helm: 'hood', spikes: true, claws: true, glove: '#4d6b4d' },
      wraith_drone: { bulk: 0.82, insectoid: true, helm: 'mask', spikes: true, claws: true, glove: '#4d6b4d' },
      wraith_stalker: { bulk: 0.94, coatTails: true, helm: 'mask', spikes: true, claws: true, glove: '#4d6b4d' },
      boss_jaffa: { bulk: 1.28, cloak: true, pauldrons: true, helm: 'serpent', plate: 'heavy', boots: true, greaves: true, bighead: true, trim: '#ffdca0', glove: '#4a3320' },
      boss_wraith: { bulk: 1.16, cloak: true, coatTails: true, helm: 'crown', spikes: true, claws: true, bighead: true, trim: '#cfffd6', glove: '#4d6b4d' },
      generic: { bulk: 1, boots: true },
    })
  );
}

function drawEnemy(ctx, e, t, cbTags) {
  const flash = e.flash > 0;
  const dormant = e.state === 'idle' || e.state === 'dormant';
  const idle = dormant;
  if (dormant) ctx.globalAlpha = 0.7;
  const hunter = e.hunter;
  const kind = e.kind;
  const fam = kind.startsWith('wraith')
    ? 'wraith'
    : kind.startsWith('replicator')
      ? 'replicator'
      : kind === 'boss'
        ? 'boss'
        : kind === 'scavenger'
          ? 'scav'
          : 'jaffa';

  // engaged enemies get a thin faction ring so awake reads instantly vs asleep
  if (!dormant && !flash) {
    ctx.strokeStyle = hexA(hunter ? '#ff6a4a' : FACTION_TINT[fam], 0.4 + 0.15 * Math.sin(t * 6 + e.wobble));
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 5, 0, TAU);
    ctx.stroke();
  }

  // shared animation state
  const BU = enemyBuilds();
  const sp = Math.hypot(e.vx || 0, e.vy || 0);
  const dying = e.hp <= 0;
  const hurt = flash ? clamp(e.flash / 0.1, 0, 1) : 0;
  const hitDir = e.kx || e.ky ? Math.atan2(e.ky, e.kx) : e.facing + Math.PI;
  const pose = dying ? 'dead' : dormant ? 'idle' : flash ? 'hit' : sp > 10 ? 'walk' : 'idle';
  const gait = clamp(sp / (e.speed || 120), 0, 1);
  const O = drawEnemy.O || (drawEnemy.O = { build: null, muzzle: { x: 0, y: 0 } });
  O.t = t;
  O.phase = e.wobble;
  O.pose = pose;
  O.gait = gait;
  O.vx = e.vx;
  O.vy = e.vy;
  O.hurt = hurt;
  O.hitDir = hitDir;
  O.deathDir = hitDir;
  O.death = 1;
  O.recoil = 0;
  O.reload = 0;
  O.charge = 0;
  O.chargeColor = null;
  O.handGlow = null;
  O.weapon = true;
  O.weaponSide = 1;
  O.weaponKind = null;
  O.weaponLen = null;
  O.weaponColor = null;
  O.head = 3;
  O.blur = 10;
  O.glow = null;
  O.z = 0;
  O.shadow = true;

  if (kind === 'jaffa' || kind === 'jaffa_heavy' || kind === 'jaffa_grenadier' || kind === 'jaffa_sniper') {
    const heavy = kind === 'jaffa_heavy';
    const nade = kind === 'jaffa_grenadier';
    const snip = kind === 'jaffa_sniper';
    // pull the Jaffa types apart by hue as well as shape
    const jc = flash ? '#fff' : hunter ? '#ff6a4a' : heavy ? '#d97636' : nade ? '#ffd45c' : snip ? '#e0a45c' : '#ffb347';
    const wind = nade && !dormant && e.cool < 0.45;
    O.build = BU[kind] || BU.jaffa;
    O.weaponKind = heavy ? 'staff' : nade ? 'launcher' : snip ? 'rifle' : 'staff';
    O.weaponLen = heavy ? 18 : null;
    O.weaponColor = flash ? '#fff' : '#ffcf9a';
    O.head = heavy ? 3.8 : snip ? 3.1 : 3.3;
    O.blur = heavy ? 12 : 10;
    O.recoil = nade && wind ? 1 : e.cool < 0.14 && !dormant ? 1 - e.cool / 0.14 : 0;
    if (snip && e.aimT > 0) {
      O.charge = clamp(e.aimT / (e.aimDur || 1.3), 0, 1);
      O.chargeColor = '#ffcf6a';
      O.pose = 'fire';
    }
    if (nade && wind) O.pose = 'fire';
    const fscale = heavy ? 1.5 : nade ? 1.1 : snip ? 1.02 : 1.06;
    drawHumanoid(ctx, e.x, e.y, e.facing, fscale, jc, flash ? '#fff' : '#ffe6c8', O);
    // frontal armour cut: the arc the game's damage rule actually models,
    // sitting right on the chest rather than floating off the body
    const bodyR = 6 * (O.build.bulk || 1) * fscale + 1.4;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowBlur = heavy ? 8 : 5;
    ctx.shadowColor = '#fb3';
    ctx.strokeStyle = flash ? '#fff' : hexA(heavy ? '#ffdca0' : '#ffe0b0', 0.85);
    ctx.lineWidth = heavy ? 3 : 1.8;
    ctx.beginPath();
    ctx.arc(e.x, e.y, bodyR, e.facing - (heavy ? 1.15 : 0.8), e.facing + (heavy ? 1.15 : 0.8));
    ctx.stroke();
    ctx.restore();
    if (nade) {
      // a lit shell: at the hip, raised overhead while winding up a lob
      const a = wind ? e.facing - 0.35 : e.facing - 1.4;
      const d = wind ? 13 : 10;
      const hx = e.x + Math.cos(a) * d;
      const hy = e.y + Math.sin(a) * d - (wind ? 4 : 0);
      glowCircle(ctx, hx, hy, wind ? 4.6 : 4, flash ? '#fff' : '#ff8a3c', wind ? 14 : 10);
    }
    if (snip && e.aimT > 0 && !dormant) {
      // charge bloom on the barrel tip
      const m = O.muzzle;
      glowCircle(ctx, m.x, m.y, 1.6 + 2.6 * O.charge, hexA('#ffd27a', 0.35 + 0.35 * O.charge), 16);
    }
  } else if (kind === 'wraith' || kind === 'wraith_drone' || kind === 'wraith_stalker') {
    const drone = kind === 'wraith_drone';
    const stalk = kind === 'wraith_stalker';
    const phased = stalk && e.phaseT > 0;
    const jx = (Math.random() - 0.5) * (drone ? 3.5 : 2.5);
    const jy = (Math.random() - 0.5) * (drone ? 3.5 : 2.5);
    const wc = flash ? '#fff' : hunter ? '#ff6a4a' : drone ? '#bff8bf' : stalk ? '#7fe0c8' : '#9df7a0';
    O.build = BU[kind] || BU.wraith;
    O.weapon = drone;
    O.weaponKind = 'zat';
    O.weaponColor = '#cffccf';
    O.weaponLen = 10;
    O.head = drone ? 2.4 : 2.8;
    O.blur = 12;
    // the feeding hand lights up as it closes for a drain
    if (!drone && !dormant && e.cool < 0.5) O.handGlow = flash ? '#fff' : '#d6ffe0';
    const s = drone ? 0.82 : 1;
    if (phased) {
      // intangible: a translucent, chromatically-split after-image
      const pa = 0.1 + 0.09 * Math.sin(t * 22 + e.wobble);
      const a0 = ctx.globalAlpha;
      const off = 1.6 + Math.sin(t * 9 + e.wobble) * 0.8;
      O.blur = 0;
      O.shadow = false;
      ctx.globalAlpha = a0 * pa;
      drawHumanoid(ctx, e.x + jx - off, e.y + jy, e.facing, s, '#7fd8ff', '#cfefff', O);
      drawHumanoid(ctx, e.x + jx + off, e.y + jy, e.facing, s, '#ff8fd0', '#ffd7ee', O);
      ctx.globalAlpha = a0 * (pa + 0.1);
      drawHumanoid(ctx, e.x + jx, e.y + jy, e.facing, s, wc, '#d7ffda', O);
      ctx.globalAlpha = a0;
    } else {
      drawHumanoid(ctx, e.x + jx, e.y + jy, e.facing, s, wc, flash ? '#fff' : '#d7ffda', O);
      // just-materialised flash
      if (stalk && e.nextPhase > 0 && e.phaseCd > e.nextPhase - 0.3) {
        glowCircle(ctx, e.x, e.y, e.r + 4, 'rgba(150,255,220,0.3)', 20);
      }
    }
    if (!drone && !phased) {
      // trailing tendrils off the shoulders
      ctx.save();
      ctx.translate(e.x + jx, e.y + jy);
      ctx.rotate(e.facing);
      ctx.strokeStyle = flash ? '#fff' : '#bff8c2';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i += 2) {
        const w = Math.sin(t * 3.4 + e.wobble + i) * 1.5;
        ctx.beginPath();
        ctx.moveTo(2, i * 4);
        ctx.quadraticCurveTo(6, i * 5 + w, 9.5, i * 6.5 + w * 1.4);
        ctx.stroke();
      }
      ctx.restore();
    }
  } else if (kind === 'replicator' || kind === 'replicator_brute' || kind === 'replicator_weaver') {
    const brute = kind === 'replicator_brute';
    const weav = kind === 'replicator_weaver';
    drawShadow(ctx, e.x, e.y + 3, e.r * 0.95, 0);
    const rc = flash ? '#fff' : hunter ? '#ff6a4a' : brute ? '#7fd0ff' : '#8fe4ff';
    const RO = drawEnemy.RO || (drawEnemy.RO = {});
    RO.t = t;
    RO.phase = e.wobble;
    RO.legs = brute ? 8 : 6;
    RO.brute = brute;
    RO.rate = dormant ? 1.6 : 7 + 9 * gait;
    RO.eye = hunter ? '#ffb4a4' : '#dff6ff';
    RO.emitter = weav ? clamp((e.weaveT || 0) / (e.weaveLife || 4.5), 0, 1) : null;
    RO.weaveColor = '#9fe8ff';
    spider(ctx, e.x, e.y + (dying ? 2 : 0), e.facing, (e.r / 5.2) * (dying ? 1.15 : 1), rc, RO);
    // adapt readout: little type pips
    if ((e.resist.kinetic > 0.05 || e.resist.energy > 0.05) && !idle) {
      ctx.fillStyle = 'rgba(180,240,255,0.7)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        (e.resist.kinetic > 0.05 ? 'K' : '') + (e.resist.energy > 0.05 ? 'E' : ''),
        e.x,
        e.y - e.r - 12
      );
    }
  } else if (kind === 'scavenger') {
    drawShadow(ctx, e.x, e.y + 3, e.r * 0.8, 0);
    const CO = drawEnemy.CO || (drawEnemy.CO = {});
    CO.t = t;
    CO.phase = e.wobble;
    CO.gait = gait;
    CO.startle = flash ? 1 : sp > e.speed * 0.7 ? 0.4 : 0;
    CO.eye = flash ? '#fff' : '#bfe8ff';
    critter(ctx, e.x, e.y, e.facing, e.r / 4.2, flash ? '#fff' : '#9fb8c8', CO);
  } else if (kind === 'boss') {
    const v = e.variant;
    const bc = flash ? '#fff' : v === 'wraith' ? '#9df7a0' : v === 'replicator' ? '#8fe4ff' : '#ffb347';
    if (v === 'replicator') {
      // a towering carrier cluster rather than a body
      const RO = drawEnemy.RO || (drawEnemy.RO = {});
      RO.t = t;
      RO.phase = e.wobble;
      RO.legs = 8;
      RO.brute = true;
      RO.rate = 5 + 6 * gait;
      RO.eye = '#dff6ff';
      RO.emitter = null;
      drawShadow(ctx, e.x, e.y + 4, e.r * 1.05, 0);
      spider(ctx, e.x, e.y, e.facing, e.r / 5.6, bc, RO);
      // a second, smaller cluster riding on top sells the height
      spider(ctx, e.x - Math.cos(e.facing) * 2, e.y - 6, e.facing + 0.6, e.r / 8.5, shade(bc, 1.25), RO);
    } else {
      O.build = v === 'wraith' ? BU.boss_wraith : BU.boss_jaffa;
      O.weaponKind = v === 'wraith' ? null : 'cannon';
      O.weapon = v !== 'wraith';
      O.weaponColor = '#ffcf9a';
      O.head = 3.4;
      O.blur = 16;
      O.recoil = e.attackT != null && e.attackT < 0.2 ? 1 : 0;
      if (v === 'wraith' && !dormant) O.handGlow = '#d6ffe0';
      if (e.phase2) O.glow = '#ff7a4a';
      drawHumanoid(ctx, e.x, e.y, e.facing, 1.95, bc, flash ? '#fff' : v === 'wraith' ? '#d7ffda' : '#ffe9c8', O);
    }
    // phase two: the enrage reads as a hot pulsing rim
    if (e.phase2 && !flash) {
      ctx.strokeStyle = `rgba(255,110,60,${0.25 + 0.2 * Math.sin(t * 9)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 3, 0, TAU);
      ctx.stroke();
    }
    if (e.shield > 0) {
      const cap = e.variant === 'replicator' ? 70 : 90;
      ctx.save();
      ctx.strokeStyle = `rgba(125,211,252,${0.3 + 0.4 * (e.shield / cap)})`;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 8, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (e.variant === 'replicator') {
      ctx.fillStyle = e.immuneType === 'kinetic' ? 'rgba(255,150,120,0.8)' : 'rgba(150,200,255,0.8)';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(e.immuneType === 'kinetic' ? 'KINETIC-IMMUNE' : 'ENERGY-IMMUNE', e.x, e.y - e.r - 16);
    }
    if (e.plantT > 0) {
      // plant tell: it roots and braces before a heavy swing
      ctx.strokeStyle = `rgba(255,180,90,${0.25 + 0.3 * Math.sin(t * 24)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 12, 0, TAU);
      ctx.stroke();
    }
    if (e.windup > 0) {
      // charge telegraph: a lance of light on the floor along the dash line
      const reach = 340;
      const grow = clamp(1 - e.windup / 0.6, 0, 1);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.chargeDir);
      const grad = ctx.createLinearGradient(0, 0, reach, 0);
      grad.addColorStop(0, `rgba(255,90,40,${0.32 + 0.25 * grow})`);
      grad.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -e.r - 4);
      ctx.lineTo(reach * (0.4 + 0.6 * grow), -e.r - 4 - 10 * grow);
      ctx.lineTo(reach * (0.4 + 0.6 * grow), e.r + 4 + 10 * grow);
      ctx.lineTo(0, e.r + 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      glowCircle(ctx, e.x, e.y, e.r + 5 + 6 * Math.sin(t * 30), 'rgba(255,120,40,0.5)', 24);
    }
    if (e.charging > 0) glowCircle(ctx, e.x, e.y, e.r + 4, 'rgba(255,120,40,0.35)', 22);
  } else {
    // unknown kind: a safe generic trooper, never the boss
    O.build = BU.generic;
    O.weaponKind = 'p90';
    O.weaponColor = flash ? '#fff' : '#dfe9f4';
    O.head = 3;
    drawHumanoid(ctx, e.x, e.y, e.facing, 1.05, flash ? '#fff' : hunter ? '#ff6a4a' : '#c8d6e4', flash ? '#fff' : '#eaf4ff', O);
  }

  if (hunter && !idle) glowCircle(ctx, e.x, e.y, e.r + 5, 'rgba(255,90,60,0.25)', 18);

  if (e.mode === 'tuck' && e.kind === 'jaffa' && !flash && !idle) {
    ctx.fillStyle = 'rgba(255,180,90,0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▼', e.x, e.y - e.r - 14);
  }
  if (dormant && !flash) {
    ctx.fillStyle = 'rgba(150,170,190,0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(e.state === 'dormant' ? '·' : 'z', e.x + 2, e.y - e.r - 12);
  }
  if (e.hp < e.maxHp && e.alive && !idle) {
    const w = e.kind === 'boss' ? 60 : e.kind === 'jaffa_heavy' || e.kind === 'replicator_brute' ? 30 : 22;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, 4);
    ctx.fillStyle = e.kind.startsWith('wraith') ? '#7ef77e' : e.kind.startsWith('replicator') ? '#7fe0ff' : '#ff9a3c';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
  // colour-blind faction tag: shape + letter above the head, palette-independent
  if (cbTags && !idle) {
    const boss = kind === 'boss' || kind === 'nexus';
    const tag = boss ? '★B' : fam === 'wraith' ? '●W' : fam === 'replicator' ? '■R' : '▲J';
    ctx.fillStyle = boss ? '#ffd166' : fam === 'wraith' ? '#8bf0a0' : fam === 'replicator' ? '#8fe4ff' : '#ffb347';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(tag, e.x, e.y - e.r - 16);
  }
  ctx.globalAlpha = 1;
}

export { drawShadow, drawHumanoid, drawPlayer, drawEnemy };
