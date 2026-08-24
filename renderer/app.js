'use strict';
// Renders the three views from live metric snapshots:
//   • Standard  — clean cream two-bar card
//   • Compact   — slim S/W rows
//   • Pro       — dark futuristic instrument cluster (2 big gauges + burn/fuel/power + telemetry)
// Standard/Compact stay light & minimal; Pro is a dark themed re-presentation of the SAME data.

const el = (id) => document.getElementById(id);
const widget = el('widget');
const SANS = '"Segoe UI", system-ui, -apple-system, sans-serif';

const els = {
  statusBtn: el('statusBtn'), updateBtn: el('updateBtn'), refreshBtn: el('refreshBtn'), infoAction: el('infoAction'),
  pinBtn: el('pinBtn'), modeBtn: el('modeBtn'), hideBtn: el('hideBtn'),
  // standard
  sessionPct: el('sessionPct'), sessionFill: el('sessionFill'), sessionReset: el('sessionReset'),
  weeklyPct: el('weeklyPct'), weeklyFill: el('weeklyFill'), weeklyReset: el('weeklyReset'),
  statusDot: el('statusDot'), statusText: el('statusText'), todayTok: el('todayTok'),
  // compact
  cSessionPct: el('cSessionPct'), cSessionFill: el('cSessionFill'), cSessionReset: el('cSessionReset'),
  cWeeklyPct: el('cWeeklyPct'), cWeeklyFill: el('cWeeklyFill'), cWeeklyReset: el('cWeeklyReset'),
  // pro
  gSession: el('gSession'), gWeekly: el('gWeekly'),
  pSessionPct: el('pSessionPct'), pWeeklyPct: el('pWeeklyPct'),
  pSessionReset: el('pSessionReset'), pWeeklyReset: el('pWeeklyReset'),
  gBurn: el('gBurn'), gPower: el('gPower'), sparkBurn: el('sparkBurn'), wavePower: el('wavePower'),
  pBurnVal: el('pBurnVal'), pPowerVal: el('pPowerVal'), pFuelVal: el('pFuelVal'),
  pFuelMain: el('pFuelMain'), pFuelSub: el('pFuelSub'),
  pDot: el('pDot'), pStatus: el('pStatus'), pActivity: el('pActivity'), pToday: el('pToday'),
};
const pSesResetT = els.pSessionReset ? els.pSessionReset.querySelector('.ic-reset-t') : null;
const pWkResetT = els.pWeeklyReset ? els.pWeeklyReset.querySelector('.ic-reset-t') : null;

// build the 12 fuel segments once
const fuelSegEls = [];
(function buildFuel() {
  const c = el('fuelSegs'); if (!c) return;
  for (let i = 0; i < 12; i++) { const s = document.createElement('div'); s.className = 'seg'; c.appendChild(s); fuelSegEls.push(s); }
})();

const STALE_MS = 120000;

const S = {
  session: { has: false, target: 0, cur: 0, resetAt: null },
  weekly: { has: false, target: 0, cur: 0, resetAt: null },
  active: false, today: 0, capturedAt: null, diag: null,
  update: { state: 'idle', version: null, percent: 0, error: null, manual: false },
  burnPerMin: 0, dialMax: 40000, powerPct: 0, fuelRem: 0, hasLive2: false,
  lastActAge: null, lastResp: 0,
  // spring states (mechanical overshoot) + eased display numbers
  spBurn: { x: 0, v: 0 }, spPower: { x: 0, v: 0 }, spFuel: { x: 0, v: 0 },
  dBurn: 0, dPower: 0, dFuel: 0,
  pinned: false, mode: 'full',
};

// rolling histories (real observed values over time)
const burnBuf = [], powerBuf = [];

// ---- pro palette ----
const PRO = {
  orange: '#ff7a1a', orangeHi: '#ff9d3c', amber: '#ffb020', yellow: '#ffd24a', red: '#e5484d',
  track: '#2b2724', tick: 'rgba(255,255,255,0.34)', tickDim: 'rgba(255,255,255,0.15)', label: '#8b8781',
};

// ---- physics: mildly underdamped spring, sub-stepped for stability ----
const STIFF = 150, DAMP = 17;
function spring(s, target, dt) {
  let t = Math.min(dt, 0.05); const step = 1 / 240;
  for (let acc = 0; acc < t; acc += step) {
    const h = Math.min(step, t - acc);
    const a = -STIFF * (s.x - target) - DAMP * s.v;
    s.v += a * h; s.x += s.v * h;
  }
  return s.x;
}

// ---- canvas setup (DPR aware; returns null when hidden so idle modes cost nothing) ----
function prep(cv) {
  if (!cv) return null;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ---- big performance gauge (Session / Weekly): 270° arc + ticks + orange fill + tip dot ----
function drawBigGauge(cv, pct, has, active) {
  const p = prep(cv); if (!p) return;
  const { ctx, w, h } = p;
  // size the ring from the available height so the full circle (r + outer ring
  // + ticks) always fits vertically; top margin ~5px, room for the arc ends below.
  const outer = 12;
  const cx = w / 2;
  const r = Math.min(w * 0.46, (h - 18) / 1.8);
  const cy = r + outer + 4;
  const START = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
  const frac = clampv(pct, 0, 100) / 100;
  const lw = Math.max(9, r * 0.14);

  // outer metallic ring
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r + 11, START - 0.05, START + SWEEP + 0.05); ctx.stroke();

  // ticks
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = START + SWEEP * (i / N);
    const major = i % 4 === 0;
    const ro = r + 7, ri = ro - (major ? 9 : 5);
    ctx.strokeStyle = major ? PRO.tick : PRO.tickDim; ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
    ctx.lineTo(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro);
    ctx.stroke();
  }

  // inactive track
  ctx.lineWidth = lw; ctx.strokeStyle = PRO.track;
  ctx.beginPath(); ctx.arc(cx, cy, r, START, START + SWEEP); ctx.stroke();

  if (!has) return;

  // active arc (gradient + glow)
  const g = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  g.addColorStop(0, PRO.amber); g.addColorStop(1, PRO.orange);
  ctx.save();
  ctx.strokeStyle = g; ctx.lineWidth = lw; ctx.shadowColor = PRO.orange; ctx.shadowBlur = active ? 16 : 8;
  ctx.beginPath(); ctx.arc(cx, cy, r, START, START + SWEEP * Math.max(frac, 0.001)); ctx.stroke();
  ctx.restore();

  // tip indicator (bulb with a hole)
  const ta = START + SWEEP * frac;
  const tx = cx + Math.cos(ta) * r, ty = cy + Math.sin(ta) * r;
  ctx.save(); ctx.shadowColor = PRO.orange; ctx.shadowBlur = active ? 14 : 7;
  ctx.fillStyle = PRO.orangeHi; ctx.beginPath(); ctx.arc(tx, ty, lw * 0.62, 0, 7); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#1a1613'; ctx.beginPath(); ctx.arc(tx, ty, lw * 0.26, 0, 7); ctx.fill();

  // 0% / 100% labels near arc ends
  ctx.fillStyle = PRO.label; ctx.font = '600 11px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('0%', cx + Math.cos(START) * (r * 0.72), cy + Math.sin(START) * (r * 0.72));
  ctx.fillText('100%', cx + Math.cos(START + SWEEP) * (r * 0.72), cy + Math.sin(START + SWEEP) * (r * 0.72));
}

// ---- small performance gauge (Burn / AI Power): tach-style needle ----
function drawSmallGauge(cv, frac, opts) {
  const p = prep(cv); if (!p) return;
  const { ctx, w, h } = p;
  const cx = w / 2, cy = h * 0.5;
  const r = Math.min(w * 0.40, h * 0.50);
  const START = Math.PI * 0.85, SWEEP = Math.PI * 1.30;
  frac = clampv(frac, 0, 1);
  const active = opts.active;
  const lw = Math.max(6, r * 0.16);

  // dim scale track
  const gd = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  gd.addColorStop(0, '#6f5211'); gd.addColorStop(0.55, '#8a4a1a'); gd.addColorStop(1, '#6f1c1c');
  ctx.lineCap = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = gd;
  ctx.beginPath(); ctx.arc(cx, cy, r, START, START + SWEEP); ctx.stroke();

  // lit portion (bright yellow→orange→red) up to value
  const gb = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  gb.addColorStop(0, PRO.yellow); gb.addColorStop(0.55, PRO.orange); gb.addColorStop(1, PRO.red);
  ctx.save();
  ctx.strokeStyle = gb; ctx.lineWidth = lw; ctx.shadowColor = PRO.orange; ctx.shadowBlur = active ? 10 : 5;
  ctx.beginPath(); ctx.arc(cx, cy, r, START, START + SWEEP * Math.max(frac, 0.001)); ctx.stroke();
  ctx.restore();

  // ticks + numeric labels
  const labels = opts.labels || [];
  const NT = labels.length ? labels.length - 1 : 4;
  ctx.fillStyle = PRO.label; ctx.font = '700 8.5px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= NT; i++) {
    const a = START + SWEEP * (i / NT);
    const ro = r - lw / 2 - 2, ri = ro - 5;
    ctx.strokeStyle = PRO.tick; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
    ctx.lineTo(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro);
    ctx.stroke();
    if (labels[i] != null) {
      const lr = r - lw - 9;
      ctx.fillText(labels[i], cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
    }
  }

  // needle
  const na = START + SWEEP * frac;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(na);
  ctx.shadowColor = PRO.orange; ctx.shadowBlur = active ? 12 : 6;
  ctx.fillStyle = PRO.orangeHi;
  const nl = r * 0.86, nb = Math.max(3, lw * 0.3);
  ctx.beginPath(); ctx.moveTo(-nb * 0.7, 0); ctx.lineTo(0, -nb); ctx.lineTo(nl, 0); ctx.lineTo(0, nb); ctx.closePath(); ctx.fill();
  ctx.restore();

  // hub
  ctx.fillStyle = '#2a2420'; ctx.beginPath(); ctx.arc(cx, cy, lw * 0.6, 0, 7); ctx.fill();
  ctx.strokeStyle = PRO.orange; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, lw * 0.6, 0, 7); ctx.stroke();
  ctx.fillStyle = PRO.orangeHi; ctx.beginPath(); ctx.arc(cx, cy, lw * 0.22, 0, 7); ctx.fill();
}

// ---- burn history sparkline ----
function drawSpark(cv, buf, active) {
  const p = prep(cv); if (!p) return;
  const { ctx, w, h } = p;
  if (buf.length < 2) return;
  let max = 1; for (const v of buf) if (v > max) max = v;
  const n = buf.length, pad = 3;
  const X = (i) => pad + (w - 2 * pad) * (i / (n - 1));
  const Y = (v) => h - 2 - (h - 6) * (clampv(v, 0, max) / max);

  // area fill
  ctx.beginPath(); ctx.moveTo(X(0), Y(buf[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(X(i), Y(buf[i]));
  ctx.lineTo(X(n - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(255,122,26,0.30)'); grad.addColorStop(1, 'rgba(255,122,26,0)');
  ctx.fillStyle = grad; ctx.fill();

  // line
  ctx.beginPath(); ctx.moveTo(X(0), Y(buf[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(X(i), Y(buf[i]));
  ctx.strokeStyle = PRO.orange; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
  ctx.save(); ctx.shadowColor = PRO.orange; ctx.shadowBlur = active ? 6 : 2; ctx.stroke(); ctx.restore();

  // end dot
  ctx.fillStyle = PRO.orangeHi; ctx.beginPath(); ctx.arc(X(n - 1), Y(buf[n - 1]), 2.4, 0, 7); ctx.fill();
}

// ---- AI power activity waveform (glowing dots) ----
function drawWave(cv, buf, active) {
  const p = prep(cv); if (!p) return;
  const { ctx, w, h } = p;
  const n = Math.min(buf.length, 28); if (n < 1) return;
  const start = buf.length - n;
  for (let i = 0; i < n; i++) {
    const v = clampv(buf[start + i], 0, 100) / 100;
    const x = 3 + (w - 6) * (i / Math.max(1, n - 1));
    const y = h - 2 - (h - 6) * v;
    const rr = 1.3 + v * 1.9;
    ctx.save();
    ctx.globalAlpha = (active ? 0.3 : 0.16) + v * (active ? 0.65 : 0.35);
    ctx.shadowColor = PRO.orange; ctx.shadowBlur = active ? 4 + v * 8 : 2;
    ctx.fillStyle = v > 0.8 ? PRO.red : PRO.orangeHi;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill();
    ctx.restore();
  }
}

function fuelStatus(rem) {
  if (rem >= 50) return { main: 'Efficient', sub: 'Good usage pace', color: '#3fb950' };
  if (rem >= 20) return { main: 'Steady', sub: 'Moderate pace', color: '#ffb020' };
  return { main: 'Low', sub: 'Running hot', color: '#e5484d' };
}

// ---- data in ----
function applySnapshot(snap) {
  if (!snap) return;
  const live = snap.live;
  const d = snap.derived || {};

  if (live && live.session && live.session.usedPct != null) {
    S.session.has = true; S.session.target = live.session.usedPct; S.session.resetAt = live.session.resetsAt;
  } else { S.session.has = false; S.session.target = 0; S.session.resetAt = null; }

  if (live && live.weekly && live.weekly.usedPct != null) {
    S.weekly.has = true; S.weekly.target = live.weekly.usedPct; S.weekly.resetAt = live.weekly.resetsAt;
  } else { S.weekly.has = false; S.weekly.target = 0; S.weekly.resetAt = null; }

  S.active = !!d.active;
  S.today = d.todayTokens || 0;
  S.capturedAt = live && live.capturedAt ? live.capturedAt : null;
  S.burnPerMin = d.burnRatePerMin || 0;
  S.dialMax = d.dialMax || 40000;
  S.powerPct = d.powerPct || 0;
  S.lastActAge = d.lastActivityAgeMs != null ? d.lastActivityAgeMs : null;
  S.lastResp = d.lastResponseTokens || 0;

  const su = S.session.has ? S.session.target : null;
  const wu = S.weekly.has ? S.weekly.target : null;
  S.hasLive2 = su != null || wu != null;
  S.fuelRem = S.hasLive2 ? clampv(100 - Math.max(su || 0, wu || 0), 0, 100) : 0;

  burnBuf.push(S.burnPerMin); if (burnBuf.length > 48) burnBuf.shift();
  powerBuf.push(S.powerPct); if (powerBuf.length > 48) powerBuf.shift();

  S.diag = snap.diag || null;
  updateStatusIndicator();
}

function applyUiState(st) {
  if (!st) return;
  S.pinned = !!st.pinned;
  S.mode = st.mode === 'compact' ? 'compact' : st.mode === 'pro' ? 'pro' : 'full';
  widget.className = S.mode;
  els.pinBtn.classList.toggle('on', S.pinned);
  els.pinBtn.title = S.pinned ? 'Unpin (currently always on top)' : 'Pin on top';
  closeInfo();
}

// ---- controls ----
els.hideBtn.addEventListener('click', () => window.cc.hide());
els.pinBtn.addEventListener('click', () => window.cc.setPin(!S.pinned));
els.modeBtn.addEventListener('click', () => window.cc.setMode('cycle')); // Standard → Pro → Compact

// ---- section info popovers (how each value is derived) ----
const panelEl = el('panel');
const infoPop = el('infoPop');
const INFO = {
  session: {
    title: 'Session · 5h',
    text: "Claude's rolling 5-hour rate-limit window. Read live from Claude Code's status line (the five_hour used %) — not an estimate. The pill shows when the window resets.",
  },
  weekly: {
    title: 'Weekly · 7d',
    text: "Your 7-day rate-limit window. Read live from Claude Code's status line (the seven_day used %). The pill shows when it resets.",
  },
  burn: {
    title: 'Burn rate',
    text: 'How fast you are spending tokens right now: work tokens (input + output + cache-write, excluding cache reads) over the last 5 minutes ÷ 5 = tokens/min. The dial auto-scales to your recent peak; the line shows the recent trend.',
  },
  fuel: {
    title: 'Fuel tank',
    text: 'Capacity left before you hit a limit: 100% minus the higher of your Session and Weekly usage. A fuller tank means more Claude headroom right now.',
  },
  power: {
    title: 'AI power',
    text: 'Recent activity intensity: your token throughput over the last ~30 seconds versus your recent peak, shown as a percent. It climbs during bursts and eases toward 0 when idle.',
  },
};
let openInfoKey = null;
let popAction = null; // { label, fn } for the popover's action button, or null to hide it
const popTitle = infoPop ? infoPop.querySelector('.info-title') : null;
const popText = infoPop ? infoPop.querySelector('.info-text') : null;

function setPopAction(action) {
  popAction = action || null;
  if (!els.infoAction) return;
  if (popAction) { els.infoAction.textContent = popAction.label; els.infoAction.classList.remove('hidden'); }
  else els.infoAction.classList.add('hidden');
}

function closeInfo() { if (infoPop) infoPop.classList.add('hidden'); openInfoKey = null; popAction = null; }
function positionPop(btn) {
  if (!infoPop || !panelEl) return;
  const pr = panelEl.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const pw = infoPop.offsetWidth, ph = infoPop.offsetHeight;
  let left = b.right - pr.left - pw;                 // right-align to the anchor
  let top = b.bottom - pr.top + 6;
  left = Math.max(6, Math.min(left, pr.width - pw - 6));
  if (top + ph > pr.height - 6) top = (b.top - pr.top) - ph - 6; // flip above if needed
  top = Math.max(6, top);
  infoPop.style.left = left + 'px';
  infoPop.style.top = top + 'px';
}
function openInfo(key, btn) {
  const d = INFO[key]; if (!d || !infoPop) return;
  popTitle.textContent = d.title;
  popText.textContent = d.text;
  setPopAction(null);
  infoPop.classList.remove('hidden');
  positionPop(btn);
  openInfoKey = key;
}
function openDiag() {
  if (!infoPop || !els.statusBtn) return;
  const d = S.diag || { title: 'Live data status', detail: 'Checking…' };
  popTitle.textContent = d.title;
  popText.textContent = d.detail;
  setPopAction({ label: 'Refresh now', fn: () => { window.cc.refresh(); spinRefresh(); } });
  infoPop.classList.remove('hidden');
  positionPop(els.statusBtn);
  openInfoKey = 'diag';
}

// ---- auto-update indicator + popover ----
function updateInfo() {
  const u = S.update || {};
  switch (u.state) {
    case 'checking': return { title: 'Software update', text: 'Checking for updates…', action: null };
    case 'available': return { title: 'Update available', text: `Version ${u.version || ''} is downloading in the background. You can keep working.`.trim(), action: null };
    case 'downloading': return { title: 'Downloading update', text: `Version ${u.version || ''} — ${u.percent || 0}% downloaded. You can keep working; it installs when you choose.`.trim(), action: null };
    case 'ready': return { title: 'Update ready', text: `Version ${u.version || ''} is downloaded and ready. Restart the widget to finish installing — your settings are kept.`.trim(), action: { label: 'Restart to update', fn: () => window.cc.installUpdate() } };
    case 'not-available': return { title: 'Up to date', text: "You're running the latest version.", action: { label: 'Check again', fn: () => window.cc.checkUpdate() } };
    case 'error': return { title: 'Update check failed', text: u.error || 'Could not check for updates right now.', action: { label: 'Try again', fn: () => window.cc.checkUpdate() } };
    case 'dev': return { title: 'Updates disabled', text: 'This is a development build (not packaged), so auto-update is off.', action: null };
    default: return { title: 'Software update', text: 'No updates pending.', action: { label: 'Check for updates', fn: () => window.cc.checkUpdate() } };
  }
}
function openUpdate() {
  if (!infoPop || !els.updateBtn) return;
  const d = updateInfo();
  popTitle.textContent = d.title;
  popText.textContent = d.text;
  setPopAction(d.action);
  infoPop.classList.remove('hidden');
  positionPop(els.updateBtn);
  openInfoKey = 'update';
}

let updateHideTimer = null;
function updateUpdateIndicator() {
  const u = S.update || {};
  const st = u.state;
  // Always worth showing: an update is coming or ready.
  const attention = st === 'available' || st === 'downloading' || st === 'ready';
  // Transient feedback only when the user asked (manual check via tray/popover).
  const feedback = u.manual && (st === 'checking' || st === 'not-available' || st === 'error');
  const visible = attention || feedback;

  els.updateBtn.classList.toggle('hidden', !visible);
  els.updateBtn.classList.toggle('checking', st === 'checking');
  els.updateBtn.classList.toggle('avail', st === 'available' || st === 'downloading');
  els.updateBtn.classList.toggle('downloading', st === 'downloading');
  els.updateBtn.classList.toggle('ready', st === 'ready');
  els.updateBtn.classList.toggle('err', u.manual && st === 'error');

  let tip = 'Update status';
  if (st === 'available') tip = `Update ${u.version || ''} downloading…`;
  else if (st === 'downloading') tip = `Downloading update… ${u.percent || 0}%`;
  else if (st === 'ready') tip = `Update ready — v${u.version || ''}. Click to restart & install`;
  else if (st === 'not-available') tip = 'Up to date';
  else if (st === 'error') tip = 'Update check failed';
  else if (st === 'checking') tip = 'Checking for updates…';
  els.updateBtn.title = tip.trim();

  // keep an open update popover live
  if (openInfoKey === 'update') {
    if (!visible) { closeInfo(); }
    else { const d = updateInfo(); popTitle.textContent = d.title; popText.textContent = d.text; setPopAction(d.action); }
  }

  // auto-dismiss transient manual results after a few seconds
  clearTimeout(updateHideTimer);
  if (feedback && (st === 'not-available' || st === 'error') && openInfoKey !== 'update') {
    updateHideTimer = setTimeout(() => {
      if (S.update) S.update.manual = false;
      updateUpdateIndicator();
    }, 5000);
  }
}
function updateStatusIndicator() {
  const d = S.diag;
  const bad = d && !d.hasLimits; // "failing to work" = no live limits at all
  if (!bad) {
    els.statusBtn.classList.add('hidden');
    if (openInfoKey === 'diag') closeInfo();
    return;
  }
  els.statusBtn.classList.remove('hidden');
  els.statusBtn.classList.toggle('err', d.level === 'error');
  els.statusBtn.title = d.title;
  if (openInfoKey === 'diag') { popTitle.textContent = d.title; popText.textContent = d.detail; }
}

function spinRefresh() {
  els.refreshBtn.classList.add('spinning');
  setTimeout(() => els.refreshBtn.classList.remove('spinning'), 700);
}

document.querySelectorAll('.ic-info').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const key = btn.getAttribute('data-info');
    if (openInfoKey === key) closeInfo(); else openInfo(key, btn);
  });
});
els.statusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (openInfoKey === 'diag') closeInfo(); else openDiag();
});
els.updateBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (openInfoKey === 'update') closeInfo(); else openUpdate();
});
els.refreshBtn.addEventListener('click', () => { window.cc.refresh(); spinRefresh(); });
els.infoAction.addEventListener('click', (e) => { e.stopPropagation(); if (popAction && popAction.fn) popAction.fn(); });
document.addEventListener('click', (e) => {
  if (openInfoKey == null) return;
  if (e.target.closest && (e.target.closest('.ic-info') || e.target.closest('.info-pop') || e.target.closest('#statusBtn') || e.target.closest('#updateBtn'))) return;
  closeInfo();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(); });

// ---- animation / live-tick loop ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = Date.now();

  const dataAge = S.capturedAt != null ? t - S.capturedAt : null;
  const hasLive = S.session.has || S.weekly.has;
  const stale = !hasLive || dataAge == null || dataAge > STALE_MS;

  for (const key of ['session', 'weekly']) {
    const g = S[key];
    g.cur = easeTo(g.cur, g.has ? g.target : 0, 9, dt);
    const pctText = g.has ? Math.round(g.cur) + '%' : '—';
    const w = clampv(g.cur, 0, 100).toFixed(1) + '%';
    const color = g.cur >= 90 ? 'var(--coral-active)' : 'var(--coral)';
    const elapsed = g.has && g.resetAt != null && g.resetAt <= t;

    let reset;
    if (!g.has) reset = 'waiting for live data';
    else if (elapsed) reset = 'reset passed · awaiting refresh';
    else reset = fmtResetLine(g.resetAt, t);
    const short = !g.has ? '—' : elapsed ? 'due' : (g.resetAt != null ? fmtCountdown(g.resetAt - t) : '—');
    let proReset;
    if (!g.has) proReset = 'waiting…';
    else if (elapsed) proReset = 'reset due';
    else proReset = fmtClock(g.resetAt) + ' · ' + fmtCountdown(g.resetAt - t) + ' left';

    const P = key === 'session' ? els.sessionPct : els.weeklyPct;
    const F = key === 'session' ? els.sessionFill : els.weeklyFill;
    const R = key === 'session' ? els.sessionReset : els.weeklyReset;
    const cP = key === 'session' ? els.cSessionPct : els.cWeeklyPct;
    const cF = key === 'session' ? els.cSessionFill : els.cWeeklyFill;
    const cR = key === 'session' ? els.cSessionReset : els.cWeeklyReset;
    const pP = key === 'session' ? els.pSessionPct : els.pWeeklyPct;
    const pRT = key === 'session' ? pSesResetT : pWkResetT;
    const pRC = key === 'session' ? els.pSessionReset : els.pWeeklyReset;

    P.textContent = pctText; F.style.width = w; F.style.background = color; R.textContent = reset;
    cP.textContent = pctText; cF.style.width = w; cF.style.background = color; cR.textContent = short;
    pP.textContent = pctText; if (pRT) pRT.textContent = proReset;

    const dim = stale && g.has;
    P.classList.toggle('stale', dim); F.classList.toggle('stale', dim); R.classList.toggle('stale', dim);
    cP.classList.toggle('stale', dim); cF.classList.toggle('stale', dim); cR.classList.toggle('stale', dim);
    pP.classList.toggle('stale', dim); if (pRC) pRC.classList.toggle('stale', dim);
  }

  // pro big gauges (eased position; clean count on the number)
  drawBigGauge(els.gSession, S.session.cur, S.session.has, S.active);
  drawBigGauge(els.gWeekly, S.weekly.cur, S.weekly.has, S.active);

  // pro small gauges + meters (spring for mechanical overshoot)
  const burnFrac = S.dialMax > 0 ? clampv(S.burnPerMin / S.dialMax, 0, 1) : 0;
  spring(S.spBurn, burnFrac, dt);
  spring(S.spPower, clampv(S.powerPct / 100, 0, 1), dt);
  spring(S.spFuel, clampv(S.fuelRem / 100, 0, 1), dt);
  S.dBurn = easeTo(S.dBurn, S.burnPerMin, 6, dt);
  S.dPower = easeTo(S.dPower, S.powerPct, 6, dt);
  S.dFuel = easeTo(S.dFuel, S.fuelRem, 6, dt);

  const bl = [0, S.dialMax * 0.25, S.dialMax * 0.5, S.dialMax * 0.75, S.dialMax].map(fmtTokens);
  drawSmallGauge(els.gBurn, S.spBurn.x, { labels: bl, active: S.active });
  drawSmallGauge(els.gPower, S.spPower.x, { labels: ['0', '25', '50', '75', '100'], active: S.active });
  drawSpark(els.sparkBurn, burnBuf, S.active);
  drawWave(els.wavePower, powerBuf, S.active);

  els.pBurnVal.textContent = fmtTokens(Math.round(S.dBurn));
  els.pPowerVal.textContent = Math.round(S.dPower) + '%';

  // fuel tank
  const onCount = S.hasLive2 ? Math.round(clampv(S.spFuel.x, 0, 1) * 12) : 0;
  for (let i = 0; i < 12; i++) fuelSegEls[i].classList.toggle('on', i < onCount);
  if (S.hasLive2) {
    els.pFuelVal.textContent = Math.round(S.dFuel) + '%';
    const st = fuelStatus(S.dFuel);
    els.pFuelMain.textContent = st.main; els.pFuelMain.style.color = st.color; els.pFuelSub.textContent = st.sub;
  } else {
    els.pFuelVal.textContent = '—';
    els.pFuelMain.textContent = 'Waiting'; els.pFuelMain.style.color = '#8b8781'; els.pFuelSub.textContent = 'no live data';
  }

  // footers (standard + pro telemetry)
  const dotClass = 'dot' + (!hasLive ? '' : stale ? ' warn' : ' on');
  const statusMsg = !hasLive ? 'no live data yet' : (stale ? 'stale · ' + fmtAge(dataAge) : 'updated ' + fmtAge(dataAge));
  const todayMsg = fmtTokens(S.today) + ' today';

  els.statusDot.className = dotClass;
  els.statusText.textContent = statusMsg;
  els.todayTok.textContent = todayMsg;

  els.pDot.className = dotClass;
  els.pStatus.textContent = statusMsg;
  els.pActivity.textContent = S.lastActAge == null
    ? 'no activity yet'
    : 'Active ' + fmtAge(S.lastActAge) + ' · ' + Math.round(S.lastResp).toLocaleString('en-US') + ' tokens';
  els.pToday.textContent = todayMsg;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- wire up ----
window.cc.onMetrics(applySnapshot);
window.cc.onUiState(applyUiState);
window.cc.onUpdateStatus((u) => { if (u) { S.update = u; updateUpdateIndicator(); } });
window.cc.getSnapshot().then((s) => { if (s) applySnapshot(s); });
window.cc.ready();
