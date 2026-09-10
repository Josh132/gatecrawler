// ─────────────────────────────────────────────────────────────────────────────
// stationpanels.js — the between-runs SGC console screens, lifted out of
// game.js: roster (recovered SG teams), base ops (naquadah-sink upgrades),
// research (the 69-node tech tree), infirmary, operations (the Incursion
// campaign + war map) and the weapon workbench. renderStationPanel in game.js
// still routes g.station to these. game.js <-> this file is a deliberate import
// cycle: every name below is only *called* at render time, never at module eval,
// so ES live bindings resolve it cleanly.
// ─────────────────────────────────────────────────────────────────────────────
import { TAU, clamp, textReset, wrapLines, wrapText } from './draw.js';
import { WEAPONS } from './weapons.js';
import { ITEMS } from './items.js';
import { drawItemIcon } from './icons.js';
import { invAdd } from './inventory.js';
import { canResearch, nodeById, milestoneFor, keystoneSibling, TECH } from './tech.js';
import {
  activeOperation, operationProgress, claimActiveOperation, campaignStatus,
  objectiveLabel, ensureCampaign, OPERATIONS, FINALE,
} from './campaign.js';
import { SG_TEAMS, BASE_UPGRADES, canBuyBase, buyBase } from './roster.js';
import {
  modsForWeapon, weaponStats, MOD_SLOTS, weaponMaxLevel, weaponLevelXp, levelForXp,
  upgradeCost, installCost, uninstallRefund, salvageValue, canInstall, canUpgrade, modById,
} from './weaponmods.js';
import {
  button, panelFrame, fx, markEffDirty, persist, showUnlock, medCount,
  researchCostMul, stackRarity, saveInv,
} from './game.js';

// ──────────────────────────────────────────────────────────────────────────
// ▸ roster
// ──────────────────────────────────────────────────────────────────────────
// The recovered SG teams — one permanent passive each, freed from the holding
// cells that show up on some worlds. Purely informational; the passive is
// automatic (folded in fx via applyRoster).
function renderRosterPanel(g) {
  const { ctx } = g;
  const owned = new Set(g.save.roster || []);
  const fr = panelFrame(g, 'SG-1 ROSTER', owned.size + ' / ' + SG_TEAMS.length + ' teams recovered   ·   ESC to close');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#9ab';
  ctx.font = '10px monospace';
  wrapText(
    ctx,
    'Rescue SG teams from the holding cells that appear on some worlds — walk them to the gate and dial home. Each recovered team advises from the SGC as a permanent passive.',
    fr.x + 24,
    fr.y + 74,
    fr.w - 48,
    13
  );
  const cols = 2;
  const cw = (fr.w - 48 - 12) / cols;
  const chh = 84;
  SG_TEAMS.forEach((tm, i) => {
    const cx = fr.x + 24 + (i % cols) * (cw + 12);
    const cy = fr.y + 104 + Math.floor(i / cols) * (chh + 10);
    const have = owned.has(tm.id);
    ctx.fillStyle = have ? 'rgba(45,100,150,0.34)' : 'rgba(30,34,44,0.5)';
    ctx.fillRect(cx, cy, cw, chh);
    ctx.strokeStyle = have ? '#6cf' : '#455';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, chh - 1);
    ctx.fillStyle = have ? '#dff' : '#778';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(tm.name + '  ·  ' + tm.role, cx + 12, cy + 20);
    ctx.font = '10px monospace';
    if (have) {
      ctx.fillStyle = '#8fd8a8';
      wrapText(ctx, tm.blurb, cx + 12, cy + 38, cw - 24, 13);
      ctx.fillStyle = '#7c9';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('ACTIVE', cx + 12, cy + chh - 12);
    } else {
      ctx.fillStyle = '#667';
      wrapText(ctx, 'MIA — recover from a Wraith holding cell.', cx + 12, cy + 38, cw - 24, 13);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ base ops
// ──────────────────────────────────────────────────────────────────────────
// A naquadah sink: permanent SGC upgrades bought once.
function renderBasePanel(g) {
  const { ctx } = g;
  const s = g.save;
  const fr = panelFrame(
    g,
    'SGC UPGRADES',
    `naquadah ${s.naquadah | 0} · intel ${s.intel | 0} · salvage ${s.salvage | 0}   ·   permanent   ·   ESC to close`
  );
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const owned = new Set(s.base || []);
  const rowH = 44;
  BASE_UPGRADES.forEach((u, i) => {
    const rx = fr.x + 24;
    const ry = fr.y + 70 + i * (rowH + 5);
    const has = owned.has(u.id);
    ctx.fillStyle = has ? 'rgba(45,110,80,0.28)' : 'rgba(20,28,40,0.7)';
    ctx.fillRect(rx, ry, fr.w - 48, rowH);
    ctx.strokeStyle = has ? '#5ec87a' : 'rgba(120,160,210,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, fr.w - 49, rowH - 1);
    ctx.fillStyle = has ? '#cfe' : '#cfe8ff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(u.name, rx + 12, ry + 17);
    ctx.fillStyle = '#8ab';
    ctx.font = '9px monospace';
    ctx.fillText(u.blurb, rx + 12, ry + 32);
    const c = u.cost;
    const costStr = [c.naquadah ? c.naquadah + ' N' : '', c.intel ? c.intel + ' I' : '', c.salvage ? c.salvage + ' S' : '']
      .filter(Boolean)
      .join('  ·  ');
    if (has) {
      ctx.fillStyle = '#7c9';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('OPERATIONAL', rx + fr.w - 48 - 12, ry + rowH / 2 + 3);
      ctx.textAlign = 'left';
    } else {
      const chk = canBuyBase(s, u.id);
      ctx.fillStyle = chk.ok ? '#9cd' : '#966';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(costStr, rx + fr.w - 48 - 140, ry + rowH / 2 + 3);
      ctx.textAlign = 'left';
      button(
        g,
        'BUILD',
        rx + fr.w - 48 - 128,
        ry + 6,
        116,
        rowH - 12,
        () => {
          const r = buyBase(s, u.id);
          if (!r || !r.ok) return;
          markEffDirty(g);
          persist(s);
          showUnlock(g, 'SGC UPGRADED', u.name);
          g.message('SGC upgraded — ' + u.name);
        },
        chk.ok
      );
    }
  });
}

const TECH_BRANCHES = ['ops', 'armory', 'gate', 'xeno', 'command'];
const TECH_BNAME = { ops: 'FIELD OPS', armory: 'ARMORY', gate: 'GATE SCI', xeno: 'XENOTECH', command: 'SGC CMD' };

function renderResearchPanel(g) {
  const { ctx } = g;
  ensureCampaign(g.save);
  const curMs = (g.save.campaign && g.save.campaign.milestone) || 0;
  const fr = panelFrame(
    g,
    'RESEARCH LAB',
    `naquadah · intel · salvage ${g.save.salvage || 0} — permanent.   milestone ${curMs}   ·   branch tabs below   ·   ESC to close`
  );
  if (!TECH.length) {
    ctx.fillStyle = '#9ab';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('research database offline', fr.x + fr.w / 2, fr.y + fr.h / 2);
    return;
  }
  const owned = new Set(g.save.tech || []);
  if (!TECH_BRANCHES.includes(g._techTab)) g._techTab = 'ops';

  // ---- branch tabs -------------------------------------------------------
  const tabW = (fr.w - 48) / TECH_BRANCHES.length;
  const tabY = fr.y + 60;
  TECH_BRANCHES.forEach((br, i) => {
    const tx = fr.x + 24 + i * tabW;
    const on = br === g._techTab;
    ctx.fillStyle = on ? 'rgba(45,100,150,0.55)' : 'rgba(24,32,44,0.7)';
    ctx.fillRect(tx, tabY, tabW - 4, 22);
    ctx.strokeStyle = on ? '#6cf' : 'rgba(120,160,210,0.3)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tx + 0.5, tabY + 0.5, tabW - 5, 21);
    ctx.fillStyle = on ? '#dff' : '#89a';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(TECH_BNAME[br], tx + (tabW - 4) / 2, tabY + 15);
    g.buttons.push({ x: tx, y: tabY, w: tabW - 4, h: 22, fn: () => { g._techTab = br; } });
  });

  // ---- one branch, tier-row grid --------------------------------------
  const list = TECH.filter((n) => n.branch === g._techTab).sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  const tagW = 32;
  const gridX = fr.x + 24 + tagW;
  const gridW = fr.w - 48 - tagW;
  const cols = 4;
  const gap = 8;
  const cardW = (gridW - gap * (cols - 1)) / cols;
  const cardH = 42;
  const rowGap = 12;

  const rect = {};
  const tiers = [];
  for (const n of list) if (!tiers.includes(n.tier)) tiers.push(n.tier);
  let y = fr.y + 94;
  const tierY = {};
  for (const tier of tiers) {
    tierY[tier] = y;
    const nodes = list.filter((n) => n.tier === tier);
    nodes.forEach((n, i) => {
      rect[n.id] = { x: gridX + (i % cols) * (cardW + gap), y: y + Math.floor(i / cols) * (cardH + gap), w: cardW, h: cardH };
    });
    const rows = Math.ceil(nodes.length / cols);
    y += rows * (cardH + gap) + rowGap;
  }

  // tier tags down the left gutter
  ctx.textAlign = 'left';
  ctx.font = 'bold 9px monospace';
  for (const tier of tiers) {
    ctx.fillStyle = '#567';
    ctx.fillText('T' + tier, fr.x + 24, tierY[tier] + 22);
  }

  // dependency elbows (same branch only) under the cards
  ctx.lineWidth = 1.25;
  for (const n of list) {
    const to = rect[n.id];
    if (!to) continue;
    for (const req of n.requires) {
      const from = rect[req];
      if (!from) continue;
      const gutter = to.x - 4;
      ctx.strokeStyle = owned.has(req) ? 'rgba(120,220,150,0.45)' : 'rgba(120,170,220,0.28)';
      ctx.beginPath();
      ctx.moveTo(from.x + from.w / 2, from.y + from.h);
      ctx.lineTo(from.x + from.w / 2, from.y + from.h + 4);
      ctx.lineTo(gutter, from.y + from.h + 4);
      ctx.lineTo(gutter, to.y + to.h / 2);
      ctx.lineTo(to.x, to.y + to.h / 2);
      ctx.stroke();
    }
  }

  // cards
  let hoverNode = null;
  for (const n of list) {
    const rc = rect[n.id];
    if (!rc) continue;
    const have = owned.has(n.id);
    const ok = !have && canResearch(g.save, n.id);
    const ms = milestoneFor(n.id) || 0;
    const msLocked = !have && !ok && ms > curMs;
    const locked = !have && !ok;
    const hover = g.pmouse.x >= rc.x && g.pmouse.x <= rc.x + rc.w && g.pmouse.y >= rc.y && g.pmouse.y <= rc.y + rc.h;
    if (hover) hoverNode = n;
    ctx.fillStyle = have ? 'rgba(70,190,110,0.2)' : ok ? 'rgba(45,100,150,0.4)' : 'rgba(38,42,52,0.5)';
    ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
    ctx.strokeStyle = hover && ok ? '#cfe8ff' : have ? '#5ec87a' : ok ? '#6cf' : msLocked ? '#7a6a3a' : '#455';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rc.x, rc.y, rc.w, rc.h);
    ctx.fillStyle = have ? '#cfe' : ok ? '#eff' : '#889';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    const nm = (n.keystone ? '◈ ' : '') + n.name;
    const maxc = Math.floor((rc.w - 14) / 6);
    ctx.fillText(nm.length > maxc ? nm.slice(0, maxc - 1) + '…' : nm, rc.x + 7, rc.y + 15);
    ctx.font = '9px monospace';
    const ksSib = !have ? keystoneSibling(g.save, n.id) : null;
    if (have) {
      ctx.fillStyle = '#7c9';
      ctx.fillText('✓ researched', rc.x + 7, rc.y + 30);
    } else if (ksSib) {
      ctx.fillStyle = '#c9a24a';
      const on = '◈ chose ' + ksSib.name;
      ctx.fillText(on.length > maxc ? on.slice(0, maxc - 1) + '…' : on, rc.x + 7, rc.y + 30);
    } else if (msLocked) {
      ctx.fillStyle = '#c9a24a';
      ctx.fillText('LOCKED · Op ' + ms, rc.x + 7, rc.y + 30);
    } else {
      ctx.fillStyle = locked ? '#667' : '#9cd';
      const c = n.cost;
      const rcm = researchCostMul(g); // Extra Research Staff base upgrade
      let s = `${Math.round((c.naquadah || 0) * rcm)} N`;
      if (c.intel) s += '  ·  ' + c.intel + ' I';
      if (c.salvage) s += '  ·  ' + c.salvage + ' S';
      if (rcm < 1) s += '  (-' + Math.round((1 - rcm) * 100) + '%)';
      ctx.fillText(s, rc.x + 7, rc.y + 30);
    }
    if (ok) {
      g.buttons.push({
        x: rc.x,
        y: rc.y,
        w: rc.w,
        h: cardH,
        fn: () => {
          if (!canResearch(g.save, n.id)) return;
          g.save.naquadah -= Math.round((n.cost.naquadah || 0) * researchCostMul(g));
          g.save.intel = (g.save.intel || 0) - (n.cost.intel || 0);
          g.save.salvage = (g.save.salvage || 0) - (n.cost.salvage || 0);
          g.save.tech = [...(g.save.tech || []), n.id];
          markEffDirty(g);
          const e = fx(g);
          g.player.maxHp = 100 + g.save.maxHpBonus + e.maxHpBonus;
          g.player.hp = Math.min(g.player.maxHp, g.player.hp);
          persist(g.save);
          g.message('Researched: ' + n.name);
          showUnlock(g, 'RESEARCHED', n.name);
        },
      });
    }
  }

  // legend
  ctx.textAlign = 'left';
  ctx.font = '9px monospace';
  const ly = fr.y + fr.h - 12;
  ctx.fillStyle = '#5ec87a';
  ctx.fillText('■ researched', fr.x + 24, ly);
  ctx.fillStyle = '#6cf';
  ctx.fillText('■ available', fr.x + 118, ly);
  ctx.fillStyle = '#c9a24a';
  ctx.fillText('■ campaign-locked', fr.x + 208, ly);
  ctx.fillStyle = '#667';
  ctx.fillText('■ needs prereq / funds', fr.x + 348, ly);

  // hover tooltip — full description, wrapped to the box
  if (hoverNode) {
    textReset(ctx);
    const tw = 264;
    const inW = tw - 16;
    const ms = milestoneFor(hoverNode.id) || 0;
    const msLine = !owned.has(hoverNode.id) && ms > curMs ? 'locked — needs Operation ' + ms + ' complete' : null;
    const needsStr = hoverNode.requires.length
      ? 'needs: ' + hoverNode.requires.map((r) => (nodeById(r) || {}).name || r).join(', ')
      : null;
    ctx.font = '10px monospace';
    const descLines = wrapLines(ctx, hoverNode.desc, inW);
    ctx.font = '9px monospace';
    const msLines = msLine ? wrapLines(ctx, msLine, inW) : [];
    const needsLines = needsStr ? wrapLines(ctx, needsStr, inW) : [];
    const th =
      26 + descLines.length * 13 + (msLines.length ? 4 + msLines.length * 12 : 0) + (needsLines.length ? 4 + needsLines.length * 12 : 0);
    const tx = clamp(g.pmouse.x + 12, fr.x, fr.x + fr.w - tw - 4);
    const ty = clamp(g.pmouse.y + 12, fr.y, fr.y + fr.h - th - 4);
    ctx.fillStyle = 'rgba(6,10,16,0.97)';
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = '#6cf';
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
    ctx.fillStyle = '#dff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(hoverNode.name, tx + 8, ty + 17);
    ctx.fillStyle = '#bcd';
    ctx.font = '10px monospace';
    let yy = ty + 33;
    for (const l of descLines) { ctx.fillText(l, tx + 8, yy); yy += 13; }
    if (msLines.length) {
      ctx.fillStyle = '#c9a24a';
      ctx.font = '9px monospace';
      yy += 3;
      for (const l of msLines) { ctx.fillText(l, tx + 8, yy); yy += 12; }
    }
    if (needsLines.length) {
      ctx.fillStyle = '#89a';
      ctx.font = '9px monospace';
      yy += 3;
      for (const l of needsLines) { ctx.fillText(l, tx + 8, yy); yy += 12; }
    }
  }
}

const SHOP = [
  ['bandage', 6, 5],
  ['medkit', 24, 2],
  ['stim', 20, 1],
  ['shieldcell', 24, 1],
  ['frag', 14, 2],
];

function renderInfirmaryPanel(g) {
  const { ctx } = g;
  const fr = panelFrame(g, 'INFIRMARY & QUARTERMASTER', 'restock supplies before you deploy.  ESC to close');
  ctx.fillStyle = '#9ab';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Q uses your best-fit medical item in the field — no slot needed.', fr.x + 24, fr.y + 74);
  ctx.fillText(`carrying ${medCount(g)} points of healing`, fr.x + 24, fr.y + 90);

  SHOP.forEach(([id, price, qty], i) => {
    const def = ITEMS[id];
    const ry = fr.y + 116 + i * 52;
    const rx = fr.x + 24;
    ctx.fillStyle = 'rgba(20,28,40,0.7)';
    ctx.fillRect(rx, ry, fr.w - 48, 44);
    ctx.strokeStyle = 'rgba(120,160,210,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, fr.w - 48, 44);
    if (drawItemIcon) drawItemIcon(ctx, id, rx + 24, ry + 22, 28);
    ctx.fillStyle = def.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${def.name}  ×${qty}`, rx + 48, ry + 18);
    ctx.fillStyle = '#8ab';
    ctx.font = '9px monospace';
    ctx.fillText(def.blurb || '', rx + 48, ry + 32);
    const afford = g.save.naquadah >= price;
    button(g, `BUY  ${price} N`, rx + fr.w - 48 - 128, ry + 6, 120, 32, () => {
      if (g.save.naquadah < price) return;
      g.save.naquadah -= price;
      invAdd(g.inv, id, qty);
      saveInv(g);
      g.message('Bought ' + def.name + ' ×' + qty);
    }, afford);
  });
}

// (the standalone Requisitions console was folded into the Armory loadout
// panel — see the requisition strip in renderPanel / panelPick.)

// ──────────────────────────────────────────────────────────────────────────
// ▸ operations
// ──────────────────────────────────────────────────────────────────────────
// The Incursion war-room: active operation, objectives, reward, war-map.
function renderOperationsPanel(g) {
  const { ctx } = g;
  ensureCampaign(g.save);
  const cs = campaignStatus(g.save);
  const fr = panelFrame(
    g,
    'OPERATIONS — THE INCURSION',
    `${cs.won ? 'campaign complete' : 'act ' + cs.act}   ·   milestone ${cs.milestone}   ·   ${cs.opsDone}/${cs.opsTotal} operations   ·   ESC to close`
  );
  const prog = operationProgress(g.save);
  const x0 = fr.x + 24;
  const innerW = fr.w - 48;
  let y = fr.y + 82;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (cs.won) {
    ctx.fillStyle = '#b06cff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('THE INCURSION IS BROKEN', x0, y + 8);
    y += 32;
    ctx.fillStyle = '#9ab';
    ctx.font = '11px monospace';
    y = wrapText(ctx, cs.activeBrief, x0, y + 4, innerW, 14) + 8;
    ctx.fillStyle = '#7c9';
    ctx.font = '10px monospace';
    ctx.fillText('FINALE — ' + FINALE.name + '   ·   complete', x0, y);
  } else if (prog.op) {
    const op = prog.op;
    ctx.fillStyle = '#cfe8ff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(op.name, x0, y);
    y += 16;
    ctx.fillStyle = '#9ab';
    ctx.font = '11px monospace';
    y = wrapText(ctx, op.brief, x0, y + 4, innerW, 14) + 6;
    ctx.fillStyle = '#7c9';
    ctx.font = '10px monospace';
    ctx.fillText('TARGET:  ' + (op.targetHint || '—'), x0, y);
    y += 20;

    for (const o of prog.objectives) {
      ctx.textAlign = 'left';
      ctx.fillStyle = o.done ? '#7ee08a' : '#bcd';
      ctx.font = '10px monospace';
      const label = objectiveLabel(o);
      const maxc = Math.floor((innerW - 240) / 6);
      ctx.fillText((o.done ? '✓ ' : '• ') + (label.length > maxc ? label.slice(0, maxc - 1) + '…' : label), x0, y);
      const bw = 150;
      const bx = fr.x + fr.w - 24 - bw;
      const by = y - 9;
      const frac = o.need ? Math.max(0, Math.min(1, o.have / o.need)) : o.done ? 1 : 0;
      ctx.fillStyle = 'rgba(20,28,40,0.9)';
      ctx.fillRect(bx, by, bw, 10);
      ctx.fillStyle = o.done ? '#4ec86a' : '#4a90d0';
      ctx.fillRect(bx, by, bw * frac, 10);
      ctx.strokeStyle = 'rgba(120,160,210,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 9);
      ctx.fillStyle = '#9ab';
      ctx.textAlign = 'right';
      ctx.fillText(o.have + ' / ' + o.need, bx - 8, y);
      y += 20;
    }

    ctx.textAlign = 'left';
    y += 4;
    const rp = prog.rewardPreview || {};
    const bits = [];
    if (rp.naquadah) bits.push(rp.naquadah + ' naquadah');
    if (rp.intel) bits.push(rp.intel + ' intel');
    if (rp.salvage) bits.push(rp.salvage + ' salvage');
    if (rp.tech) bits.push('tech: ' + ((nodeById(rp.tech) || {}).name || rp.tech));
    if (rp.weapon) bits.push('weapon: ' + ((ITEMS[rp.weapon] || {}).name || rp.weapon));
    if (rp.consumable) bits.push('kit: ' + ((ITEMS[rp.consumable] || {}).name || rp.consumable));
    ctx.fillStyle = '#8ab';
    ctx.font = '10px monospace';
    y = wrapText(ctx, 'REWARD:  ' + (bits.join('   ·   ') || '—'), x0, y, innerW, 13) + 6;

    if (prog.allDone) {
      button(g, 'CLAIM & ADVANCE', x0, y, 230, 34, () => {
        const res = claimActiveOperation(g.save);
        if (!res || !res.ok) return;
        for (const grant of res.grants || []) invAdd(g.inv, grant.id, 1);
        saveInv(g);
        persist(g.save);
        const r = res.reward || {};
        const sum = [];
        if (r.naquadah) sum.push('+' + r.naquadah + ' naq');
        if (r.intel) sum.push('+' + r.intel + ' intel');
        if (r.salvage) sum.push('+' + r.salvage + ' salvage');
        if (r.tech) sum.push((nodeById(r.tech) || {}).name || r.tech);
        for (const grant of res.grants || []) sum.push((ITEMS[grant.id] || {}).name || grant.id);
        const e = fx(g);
        g.player.maxHp = 100 + g.save.maxHpBonus + e.maxHpBonus;
        g.message('Operation complete — ' + (sum.join(', ') || 'logged'));
        showUnlock(g, 'OPERATION COMPLETE', op.name);
      }, true);
    } else {
      ctx.fillStyle = '#678';
      ctx.font = '10px monospace';
      ctx.fillText('objectives accrue while deployed — come back when the board is green', x0, y + 14);
    }
  }

  drawWarMap(g, fr, fr.y + fr.h - 50);
}

// a horizontal pip-line of every Operation + a finale capstone
function drawWarMap(g, fr, y) {
  const { ctx } = g;
  const c = g.save.campaign || {};
  const completed = new Set(c.completed || []);
  const active = c.won ? null : activeOperation(g.save);
  const n = OPERATIONS.length;
  const x0 = fr.x + 34;
  const span = fr.w - 100;
  const step = span / n;

  ctx.strokeStyle = 'rgba(120,160,210,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x0 + span, y);
  ctx.stroke();

  ctx.textAlign = 'center';
  let lastAct = -1;
  OPERATIONS.forEach((op, i) => {
    const px = x0 + i * step + step / 2;
    const done = completed.has(op.id);
    const cur = active && active.id === op.id;
    if (op.act !== lastAct) {
      lastAct = op.act;
      ctx.fillStyle = '#5a6b80';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('ACT ' + op.act, px - step / 2 + 3, y - 16);
      ctx.textAlign = 'center';
    }
    if (cur) {
      const pr = 8 + 3 * Math.sin(g.time * 4);
      ctx.strokeStyle = `rgba(255,210,74,${0.45 + 0.3 * Math.sin(g.time * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, y, pr, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(px, y, 6, 0, TAU);
    ctx.fillStyle = done ? '#4ec86a' : cur ? '#ffd24a' : 'rgba(40,52,66,0.95)';
    ctx.fill();
    ctx.strokeStyle = done ? '#7ee08a' : cur ? '#ffe' : 'rgba(120,160,210,0.5)';
    ctx.lineWidth = cur ? 2 : 1;
    ctx.stroke();
  });

  // finale capstone — a diamond past the end of the line
  const fxx = x0 + span;
  const won = !!c.won;
  const unlocked = completed.size >= FINALE.unlockAfter;
  ctx.save();
  ctx.translate(fxx, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = won ? '#b06cff' : unlocked ? '#ffd24a' : 'rgba(40,52,66,0.95)';
  ctx.fillRect(-7, -7, 14, 14);
  ctx.strokeStyle = won ? '#d0a8ff' : unlocked ? '#ffe' : 'rgba(120,160,210,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-7, -7, 14, 14);
  ctx.restore();
  ctx.fillStyle = won ? '#c9a8ff' : '#89a';
  ctx.font = 'bold 8px monospace';
  ctx.fillText('NEXUS', fxx, y + 18);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ──────────────────────────────────────────────────────────────────────────
// ▸ workbench
// ──────────────────────────────────────────────────────────────────────────
// Weapon mastery, mods and the salvage counter.
function renderWorkbenchPanel(g) {
  const { ctx } = g;
  const fr = panelFrame(
    g,
    'WEAPON WORKBENCH',
    'salvage: ' + (g.save.salvage || 0) + '   ·   naquadah: ' + (g.save.naquadah || 0) + '   ·   ESC to close'
  );
  const eff = fx(g);
  const bonusSlots = eff.weaponModSlots || 0;
  // Salvage Foundry base upgrade: -20% salvage on mods & upgrades (modCostMul)
  const salv = (c) => Math.ceil((c.salvage || 0) * (eff.modCostMul || 1));
  if (!g.save.weapons || typeof g.save.weapons !== 'object') g.save.weapons = {};

  // every weapon the player holds: equipped slots + w_* stacks in the grid
  const entries = [];
  for (const sk of ['weapon1', 'weapon2', 'weapon3']) {
    const st = g.inv.equip[sk];
    if (st && ITEMS[st.id] && ITEMS[st.id].weapon) entries.push({ key: ITEMS[st.id].weapon, id: st.id, grid: false });
  }
  g.inv.grid.forEach((st) => {
    if (st && ITEMS[st.id] && ITEMS[st.id].weapon) entries.push({ key: ITEMS[st.id].weapon, id: st.id, grid: true });
  });

  if (!entries.length) {
    ctx.fillStyle = '#9ab';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('no weapons on hand — requisition one at the Armoury', fr.x + fr.w / 2, fr.y + fr.h / 2);
    return;
  }
  const keys = [];
  for (const e of entries) if (!keys.includes(e.key)) keys.push(e.key);
  if (!keys.includes(g._wbSel)) g._wbSel = keys[0];

  // ---- left: the weapon list ------------------------------------------
  const listX = fr.x + 20;
  const listW = 196;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#89a';
  ctx.font = '10px monospace';
  ctx.fillText('YOUR WEAPONS', listX, fr.y + 74);
  let ly = fr.y + 82;
  for (const key of keys) {
    const id = (entries.find((e) => e.key === key) || {}).id || 'w_' + key;
    const st = g.save.weapons[key] || { level: 1, xp: 0, mods: [] };
    const lvl = Math.max(1, st.level | 0 || 1);
    const spare = entries.filter((e) => e.key === key && e.grid).length;
    const sel = key === g._wbSel;
    const rh = 32;
    ctx.fillStyle = sel ? 'rgba(45,100,150,0.5)' : 'rgba(20,28,40,0.7)';
    ctx.fillRect(listX, ly, listW, rh);
    ctx.strokeStyle = sel ? '#6cf' : 'rgba(120,160,210,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(listX + 0.5, ly + 0.5, listW - 1, rh - 1);
    if (drawItemIcon) drawItemIcon(ctx, id, listX + 17, ly + rh / 2, 22);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = sel ? '#dff' : '#bcd';
    ctx.font = 'bold 10px monospace';
    const nm = (ITEMS[id] || {}).name || key;
    ctx.fillText(nm.length > 20 ? nm.slice(0, 19) + '…' : nm, listX + 34, ly + 13);
    ctx.fillStyle = '#8ab';
    ctx.font = '9px monospace';
    ctx.fillText('L' + lvl + '  ·  ' + (st.mods ? st.mods.length : 0) + ' mods' + (spare ? '  ·  ' + spare + ' spare' : ''), listX + 34, ly + 25);
    g.buttons.push({ x: listX, y: ly, w: listW, h: rh, fn: () => { g._wbSel = key; } });
    ly += rh + 4;
  }

  // ---- right: the selected weapon ------------------------------------
  const key = g._wbSel;
  const selId = (entries.find((e) => e.key === key) || {}).id || 'w_' + key;
  const state = g.save.weapons[key] || (g.save.weapons[key] = { level: 1, xp: 0, mods: [] });
  if (!Array.isArray(state.mods)) state.mods = [];
  const lvl = Math.max(1, state.level | 0 || 1);
  const rx = fr.x + 20 + listW + 22;
  const rw = fr.x + fr.w - 20 - rx;
  let ry = fr.y + 76;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#cfe8ff';
  ctx.font = 'bold 13px monospace';
  ctx.fillText((ITEMS[selId] || {}).name || key, rx, ry);
  ry += 8;

  // upgrade button, top-right of the detail column
  const maxed = lvl >= weaponMaxLevel;
  const up = canUpgrade(g.save, key);
  const ucost = upgradeCost(key, lvl + 1);
  const ubw = 168;
  const ubx = rx + rw - ubw;
  if (maxed) {
    ctx.fillStyle = '#7ee08a';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('✓ MASTERED', rx + rw, fr.y + 74);
    ctx.textAlign = 'left';
  } else {
    button(g, `UPGRADE  L${lvl + 1}`, ubx, fr.y + 64, ubw, 24, () => {
      if (!canUpgrade(g.save, key).ok) return;
      const c = upgradeCost(key, lvl + 1);
      g.save.salvage = (g.save.salvage || 0) - salv(c);
      g.save.naquadah = (g.save.naquadah || 0) - (c.naquadah || 0);
      state.level = lvl + 1;
      persist(g.save);
      g.message(((ITEMS[selId] || {}).name || key) + ' — mastery L' + state.level);
    }, up.ok);
  }

  // mastery xp bar
  const xpLo = weaponLevelXp(lvl);
  const xpHi = weaponLevelXp(lvl + 1);
  const xp = state.xp | 0;
  const xpFrac = maxed ? 1 : Math.max(0, Math.min(1, (xp - xpLo) / Math.max(1, xpHi - xpLo)));
  ry += 14;
  ctx.fillStyle = '#89a';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('MASTERY  ·  effective L' + levelForXp(xp), rx, ry);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8ab';
  ctx.font = '8px monospace';
  ctx.fillText(maxed ? 'max' : xp + ' / ' + xpHi + ' xp', rx + rw, ry);
  ctx.textAlign = 'left';
  ry += 6;
  ctx.fillStyle = 'rgba(20,28,40,0.9)';
  ctx.fillRect(rx, ry, rw, 10);
  ctx.fillStyle = '#c9a24a';
  ctx.fillRect(rx, ry, rw * xpFrac, 10);
  ctx.strokeStyle = 'rgba(120,160,210,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, 9);
  ry += 18;
  if (!maxed) {
    ctx.fillStyle = up.ok ? '#9cd' : '#778';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      up.ok
        ? `L${lvl + 1}:  ${salv(ucost)} salvage${ucost.naquadah ? ' + ' + ucost.naquadah + ' naquadah' : ''}`
        : `L${lvl + 1} locked — ${up.reason}`,
      rx,
      ry
    );
    ry += 12;
  }

  // live stat multipliers
  const ws = weaponStats(key, state, eff.weaponDmgMul);
  ctx.fillStyle = '#9cd';
  ctx.font = '9px monospace';
  ctx.fillText(
    `dmg x${ws.damageMul}   ·   rate x${ws.fireRateMul}   ·   mag x${ws.magMul}   ·   reload x${ws.reloadMul}`,
    rx,
    ry
  );
  ry += 16;

  // scrap a spare (grid, not equipped)
  const spareIdx = g.inv.grid.findIndex((st) => st && ITEMS[st.id] && ITEMS[st.id].weapon === key);
  if (spareIdx >= 0) {
    const sval = salvageValue(key, stackRarity(g.inv.grid[spareIdx]));
    button(g, `SCRAP SPARE  +${sval} salvage`, rx, ry, 220, 22, () => {
      const idx = g.inv.grid.findIndex((st) => st && ITEMS[st.id] && ITEMS[st.id].weapon === key);
      if (idx < 0) return;
      const st = g.inv.grid[idx];
      const v = salvageValue(key, stackRarity(st));
      if (st.count > 1) st.count -= 1;
      else g.inv.grid[idx] = null;
      g.save.salvage = (g.save.salvage || 0) + v;
      saveInv(g);
      g.message('Scrapped ' + ((ITEMS[st.id] || {}).name || key) + '  (+' + v + ' salvage)');
    }, true);
    ry += 30;
  } else {
    ry += 6;
  }

  // mod slots
  const slots = MOD_SLOTS(key, lvl, bonusSlots);
  ctx.fillStyle = '#89a';
  ctx.font = '9px monospace';
  ctx.fillText('MOD SLOTS  ' + state.mods.length + ' / ' + slots + (bonusSlots ? '  (+' + bonusSlots + ' tech)' : ''), rx, ry);
  ry += 8;
  const bs = 26;
  for (let i = 0; i < Math.max(slots, state.mods.length); i++) {
    const sx = rx + i * (bs + 8);
    const mid = state.mods[i];
    const md = mid ? modById(mid) : null;
    ctx.fillStyle = md ? 'rgba(45,100,150,0.5)' : i < slots ? 'rgba(20,28,40,0.8)' : 'rgba(50,30,30,0.5)';
    ctx.fillRect(sx, ry, bs, bs);
    ctx.strokeStyle = md ? '#6cf' : i < slots ? 'rgba(120,160,210,0.35)' : 'rgba(150,90,90,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, ry + 0.5, bs - 1, bs - 1);
    if (md) {
      ctx.fillStyle = '#cfe';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(md.slot.slice(0, 3).toUpperCase(), sx + bs / 2, ry + bs / 2 + 4);
      ctx.textAlign = 'left';
      g.buttons.push({
        x: sx, y: ry, w: bs, h: bs,
        fn: () => {
          const k = state.mods.indexOf(mid);
          if (k < 0) return;
          state.mods.splice(k, 1);
          const ref = uninstallRefund(mid);
          g.save.salvage = (g.save.salvage || 0) + (ref.salvage || 0);
          g.save.naquadah = (g.save.naquadah || 0) + (ref.naquadah || 0);
          persist(g.save);
          g.message('Removed ' + md.name + '  (+' + (ref.salvage || 0) + ' salvage)');
        },
      });
    }
  }
  ry += bs + 10;

  // fitting mods, buyable
  ctx.fillStyle = '#89a';
  ctx.font = '9px monospace';
  ctx.fillText('COMPATIBLE MODS  (click a filled slot to remove)', rx, ry);
  ry += 8;
  const fitting = modsForWeapon(key).filter((m) => state.mods.indexOf(m.id) === -1);
  const rowH = 40;
  const roomRows = Math.floor((fr.y + fr.h - 16 - ry) / rowH);
  const show = fitting.slice(0, Math.max(0, roomRows));
  for (const m of show) {
    const ci = canInstall(g.save, key, m.id, bonusSlots);
    const c = installCost(m.id);
    const install = () => {
      if (!canInstall(g.save, key, m.id, bonusSlots).ok) return;
      const cost = installCost(m.id);
      g.save.salvage = (g.save.salvage || 0) - salv(cost);
      g.save.naquadah = (g.save.naquadah || 0) - (cost.naquadah || 0);
      state.mods = [...state.mods, m.id];
      persist(g.save);
      g.message('Installed ' + m.name);
    };
    // the whole row is the tap target — the small FIT chip alone was sub-40px
    button(g, '', rx, ry, rw, rowH - 4, install, ci.ok);
    ctx.textAlign = 'left';
    ctx.fillStyle = ci.ok ? '#dff' : '#9ab';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`[${m.slot}] ${m.name}`, rx + 8, ry + 15);
    ctx.fillStyle = '#89a';
    ctx.font = '8px monospace';
    const dm = Math.floor((rw - 150) / 4.6);
    ctx.fillText(m.desc.length > dm ? m.desc.slice(0, dm - 1) + '…' : m.desc, rx + 8, ry + 27);
    const cstr = `${salv(c)}s${c.naquadah ? ' +' + c.naquadah + 'n' : ''}`;
    ctx.textAlign = 'right';
    ctx.font = '9px monospace';
    ctx.fillStyle = ci.ok ? '#9cd' : '#778';
    ctx.fillText(cstr, rx + rw - 54, ry + 14);
    ctx.fillStyle = ci.ok ? '#8fdcff' : '#667';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(ci.ok ? 'FIT ▸' : 'LOCKED', rx + rw - 12, ry + 28);
    ctx.textAlign = 'left';
    ry += rowH;
  }
  if (fitting.length > show.length) {
    ctx.fillStyle = '#667';
    ctx.font = '8px monospace';
    ctx.fillText('… ' + (fitting.length - show.length) + ' more — install one or raise mastery for room', rx, ry + 8);
  }
}

export {
  renderRosterPanel, renderBasePanel, renderResearchPanel, renderInfirmaryPanel,
  renderOperationsPanel, renderWorkbenchPanel,
};
