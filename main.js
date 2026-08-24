'use strict';
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const { CLAUDE_DIR, PROJECTS_DIR, SETTINGS, LIVE_CACHE } = require('./src/paths');
const config = require('./src/config');
const { trayIconDataUrl } = require('./src/icon');
const { UsageStore } = require('./src/data/parser');
const { readLive } = require('./src/data/ratelimits');
const { readSessions } = require('./src/data/sessions');
const { readStats } = require('./src/data/stats');
const { readAccount } = require('./src/data/account');
const { compute } = require('./src/metrics');
const updater = require('./src/updater');

const SIZES = { full: { w: 384, h: 324 }, compact: { w: 320, h: 132 }, pro: { w: 604, h: 516 } };
// view cycle order for the header button: Standard → Pro → Compact → Standard
const MODES = ['full', 'pro', 'compact'];
function validMode(m) { return MODES.indexOf(m) !== -1 ? m : 'full'; }
function nextMode(m) { const i = MODES.indexOf(m); return MODES[(i + 1) % MODES.length]; }
const SHORTCUTS = ['Control+Shift+Space', 'Control+Alt+C', 'Control+Shift+F12'];

let win = null;
let tray = null;
const store = new UsageStore();
const state = { peakBurn: 0 };
let account = null;
let statsCache = null;
let statsAt = 0;
let lastSnapshot = null;
let activeShortcut = null;
let desiredPos = null;        // where we intend the window to sit
let suppressSaveUntil = 0;    // ignore OS-driven 'moved' events until this time
let mode = 'full';            // 'full' (standard) | 'pro' (dashboard) | 'compact'
let pinned = false;           // always-on-top when true
let updateState = { state: 'idle' }; // latest auto-update status (for the tray)

// ---------------------------------------------------------------- statusline
// Point Claude Code's statusLine at our capture script (backing up the original
// so the tray can restore it). This is the one system change, approved by the user.
// Point Claude Code's statusLine at our capture script. Runs on launch, on manual
// refresh, and periodically (self-heal if another tool overwrites it). Creates
// ~/.claude and settings.json if missing so a fresh machine is wired up on first
// run. Returns true if our command is in place afterwards.
function patchStatusLine() {
  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    // Copy the capture script to a STABLE path in ~/.claude and point the
    // statusline there — location-independent, so it survives a portable exe
    // (which extracts to a fresh temp dir each launch) or an installed build.
    const bundled = path.join(__dirname, 'statusline', 'cc-usage-capture.ps1');
    const stable = path.join(CLAUDE_DIR, 'cc-speedometer-capture.ps1');
    try { fs.copyFileSync(bundled, stable); } catch { /* keep any existing copy */ }
    const desired = `powershell -NoProfile -ExecutionPolicy Bypass -File "${stable}"`;

    let s = {};
    if (fs.existsSync(SETTINGS)) {
      try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) || {}; }
      catch { return false; } // don't clobber a settings file we can't parse
    }
    const cur = s.statusLine && s.statusLine.command;
    if (cur === desired) return true; // already patched
    const cfg = config.load();
    const isOurs = cur && (cur.indexOf('cc-speedometer-capture') !== -1 || cur.indexOf('cc-usage-capture') !== -1);
    if (!cfg.originalStatusLine && cur && !isOurs) {
      config.save({ originalStatusLine: s.statusLine });
    }
    s.statusLine = { type: 'command', command: desired };
    fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
    return true;
  } catch (e) {
    return false; // never fatal
  }
}

// Figure out why live limits are / aren't flowing, so the UI can explain it.
let diagCache = null;
let diagAt = 0;
function computeDiag(live) {
  const now = Date.now();
  const claudeExists = fs.existsSync(CLAUDE_DIR);
  let patched = false;
  try {
    if (fs.existsSync(SETTINGS)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
      const cmd = s && s.statusLine && s.statusLine.command;
      patched = !!(cmd && cmd.indexOf('cc-speedometer-capture') !== -1);
    }
  } catch { /* ignore */ }
  const hasLimits = !!(live && (live.session || live.weekly));
  const ageMs = live && live.capturedAt ? now - live.capturedAt : null;
  const liveExists = fs.existsSync(LIVE_CACHE);

  let code, level, title, detail;
  if (!claudeExists) {
    code = 'no_claude'; level = 'error';
    title = 'Claude Code not found on this PC';
    detail = 'There is no .claude folder in your home directory, so there is nothing to read yet. Install and run Claude Code, then click Refresh.';
  } else if (hasLimits && ageMs != null && ageMs <= 120000) {
    code = 'ok'; level = 'ok';
    title = 'Live data connected';
    detail = 'Session and weekly limits are updating from Claude Code’s status line.';
  } else if (hasLimits) {
    code = 'stale'; level = 'warn';
    title = 'Live data is stale';
    detail = 'Limits only refresh when Claude Code redraws its status line. Keep using Claude Code, or click Refresh.';
  } else if (!patched) {
    code = 'not_patched'; level = 'warn';
    title = 'Linking into Claude Code…';
    detail = 'The widget is adding its capture step to Claude Code’s status line. Click Refresh. If it stays here, this machine may not have Claude Code set up for your user.';
  } else {
    code = 'waiting'; level = 'warn';
    title = 'Waiting for Claude Code’s status line';
    detail = 'Linked OK — now Claude Code needs to draw its status line once. Send any message in a Claude Code session and the gauges fill within a second. If a session was already open when you installed this, restart just that session. Note: the live 5h / 7d limits are only sent on Pro, Max and Team plans — API / console accounts don’t send them, so these two gauges stay empty (everything else still works).';
  }
  return { code, level, title, detail, patched, claudeExists, liveExists, hasLimits, ageMs };
}

function restoreStatusLine() {
  try {
    const cfg = config.load();
    if (!cfg.originalStatusLine || !fs.existsSync(SETTINGS)) return;
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    s.statusLine = cfg.originalStatusLine;
    fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
  } catch (e) {
    /* ignore */
  }
}

// ---------------------------------------------------------------- window
function curSize() { return SIZES[mode] || SIZES.full; }

function sendUiState() {
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send('ui-state', { pinned, mode });
}

function defaultPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  const s = curSize();
  return { x: wa.x + wa.width - s.w - 24, y: wa.y + 24 };
}

// A saved position is honoured only if enough of the window would land on some
// display's work area (multi-monitor negative coords are legitimate).
function isVisibleOnSomeDisplay(x, y) {
  const s = curSize();
  for (const d of screen.getAllDisplays()) {
    const wa = d.workArea;
    const ovw = Math.min(x + s.w, wa.x + wa.width) - Math.max(x, wa.x);
    const ovh = Math.min(y + s.h, wa.y + wa.height) - Math.max(y, wa.y);
    if (ovw >= 120 && ovh >= 70) return true;
  }
  return false;
}

// Force the window to desiredPos and suppress the resulting 'moved' save.
function applyDesired() {
  if (!win || win.isDestroyed() || !desiredPos) return;
  const s = curSize();
  suppressSaveUntil = Date.now() + 1000;
  win.setBounds({ x: desiredPos.x, y: desiredPos.y, width: s.w, height: s.h });
}

function setPinned(v) {
  pinned = !!v;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(pinned, 'floating');
  config.save({ pinned });
  refreshTray();
  sendUiState();
}

// Keep a (possibly resized) window fully on the display it currently sits on, so
// growing into the taller Pro view can't push it off the bottom/right edge.
function clampToDisplay(x, y, w, h) {
  const disp = screen.getDisplayMatching({ x, y, width: w, height: h }) || screen.getPrimaryDisplay();
  const wa = disp.workArea;
  let nx = x, ny = y;
  if (nx + w > wa.x + wa.width) nx = wa.x + wa.width - w;
  if (ny + h > wa.y + wa.height) ny = wa.y + wa.height - h;
  if (nx < wa.x) nx = wa.x;
  if (ny < wa.y) ny = wa.y;
  return { x: nx, y: ny };
}

function setMode(m) {
  mode = m === 'cycle' ? nextMode(mode) : validMode(m);
  config.save({ mode });
  if (win && !win.isDestroyed()) {
    const b = win.getBounds();
    const s = curSize();
    const p = clampToDisplay(b.x, b.y, s.w, s.h);
    desiredPos = p;
    suppressSaveUntil = Date.now() + 600;
    win.setBounds({ x: p.x, y: p.y, width: s.w, height: s.h });
  }
  refreshTray();
  sendUiState();
}

// Windows relocates transparent always-on-top windows to the focused monitor on
// show; re-assert the intended position a few times to win that race.
function reassertPosition() {
  applyDesired();
  [90, 250, 550, 950, 1500].forEach((ms) => setTimeout(applyDesired, ms));
}

function createWindow() {
  const cfg = config.load();
  mode = validMode(cfg.mode);
  pinned = !!cfg.pinned;
  const s = curSize();
  let pos = defaultPos();
  if (cfg.bounds && typeof cfg.bounds.x === 'number' && isVisibleOnSomeDisplay(cfg.bounds.x, cfg.bounds.y)) {
    pos = { x: cfg.bounds.x, y: cfg.bounds.y };
  }
  // keep the whole window on its display (saved bounds may predate a larger mode size)
  pos = clampToDisplay(pos.x, pos.y, s.w, s.h);
  desiredPos = pos;

  win = new BrowserWindow({
    width: s.w,
    height: s.h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    alwaysOnTop: pinned,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Let the renderer throttle its animation loop when hidden. All monitoring
      // runs in the main process, so hiding the widget costs almost nothing.
      backgroundThrottling: true,
    },
  });

  win.setAlwaysOnTop(pinned, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show(); // visible on launch; not pinned by default, so it drops behind on focus loss
    reassertPosition();
    sendUiState();
  });

  // Persist only genuine user drags: a 'moved' outside the suppression window.
  win.on('moved', () => {
    if (Date.now() < suppressSaveUntil || !win || win.isDestroyed()) return;
    const b = win.getBounds();
    desiredPos = { x: b.x, y: b.y };
    config.save({ bounds: desiredPos });
  });

  // Never actually close; hide instead (tray keeps it alive).
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// Raise-or-hide: hide only when already frontmost; otherwise bring it to the
// front (works even when it has dropped behind other windows because it is unpinned).
function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.focus();
    if (win.moveTop) win.moveTop();
    reassertPosition();
    pushMetrics();
  }
}

// ---------------------------------------------------------------- shortcut
function registerShortcut(preferred) {
  globalShortcut.unregisterAll();
  const order = preferred ? [preferred, ...SHORTCUTS.filter((s) => s !== preferred)] : SHORTCUTS.slice();
  for (const sc of order) {
    try {
      const ok = globalShortcut.register(sc, toggleWindow);
      if (ok) { activeShortcut = sc; config.save({ shortcut: sc }); return sc; }
    } catch { /* try next */ }
  }
  activeShortcut = null;
  return null;
}

// ---------------------------------------------------------------- tray
function updateStatusLabel() {
  switch (updateState.state) {
    case 'checking': return 'Checking for updates…';
    case 'available': return 'Downloading update…';
    case 'downloading': return `Downloading update… ${updateState.percent || 0}%`;
    case 'ready': return `Update ready: v${updateState.version || ''}`;
    case 'not-available': return 'Up to date';
    case 'error': return 'Update check failed — retry';
    case 'dev': return 'Updates disabled (dev build)';
    default: return 'Check for updates';
  }
}
function buildUpdateItems() {
  const items = [];
  if (updateState.state === 'ready') {
    items.push({
      label: `Restart to install update  (v${updateState.version || ''})`,
      click: () => updater.quitAndInstall(),
    });
  }
  const busy = updateState.state === 'checking' || updateState.state === 'downloading' || updateState.state === 'dev';
  items.push({
    label: updateStatusLabel(),
    enabled: !busy,
    click: () => updater.checkForUpdates(true),
  });
  return items;
}

function buildTrayMenu() {
  const cfg = config.load();
  const shortcutItems = SHORTCUTS.map((sc) => ({
    label: sc.replace('Control', 'Ctrl'),
    type: 'radio',
    checked: activeShortcut === sc,
    click: () => { registerShortcut(sc); refreshTray(); },
  }));
  return Menu.buildFromTemplate([
    { label: `Claude Code Usage  v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Show / Hide', click: toggleWindow },
    { type: 'separator' },
    { label: 'Pin on top', type: 'checkbox', checked: pinned, click: (mi) => setPinned(mi.checked) },
    {
      label: 'View',
      submenu: [
        { label: 'Standard', type: 'radio', checked: mode === 'full', click: () => setMode('full') },
        { label: 'Pro dashboard', type: 'radio', checked: mode === 'pro', click: () => setMode('pro') },
        { label: 'Compact', type: 'radio', checked: mode === 'compact', click: () => setMode('compact') },
      ],
    },
    { type: 'separator' },
    { label: 'Toggle shortcut', submenu: shortcutItems },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: !!cfg.autostart,
      click: (mi) => {
        config.save({ autostart: mi.checked });
        try { app.setLoginItemSettings({ openAtLogin: mi.checked }); } catch {}
      },
    },
    {
      label: 'Reset position',
      click: () => {
        if (!win) return;
        desiredPos = defaultPos();
        config.save({ bounds: desiredPos });
        win.show(); win.focus();
        reassertPosition();
      },
    },
    { label: 'Restore original statusline', click: () => { restoreStatusLine(); } },
    { type: 'separator' },
    ...buildUpdateItems(),
    { type: 'separator' },
    {
      label: activeShortcut ? `Shortcut: ${activeShortcut.replace('Control', 'Ctrl')}` : 'Shortcut: (none free)',
      enabled: false,
    },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const img = nativeImage.createFromDataURL(trayIconDataUrl());
  tray = new Tray(img);
  tray.setToolTip('Claude Code Usage v' + app.getVersion());
  refreshTray();
  tray.on('click', toggleWindow);
  tray.on('double-click', toggleWindow);
}

// ---------------------------------------------------------------- metrics loop
function getStats() {
  const now = Date.now();
  if (!statsCache || now - statsAt > 30000) {
    statsCache = readStats();
    statsAt = now;
  }
  return statsCache;
}

function pushMetrics() {
  try {
    const live = readLive();
    const snap = compute(store, {
      now: Date.now(),
      state,
      live,
      sessions: readSessions(),
      stats: getStats(),
      account,
    });
    if (!diagCache || Date.now() - diagAt > 3000) { diagCache = computeDiag(live); diagAt = Date.now(); }
    snap.diag = diagCache;
    lastSnapshot = snap;
    if (win && !win.isDestroyed() && win.webContents) win.webContents.send('metrics', snap);
  } catch (e) {
    /* keep the loop alive */
  }
}

let tick = 0;
function startIntervals() {
  // metrics push: every 1s when visible, ~every 8s when hidden
  setInterval(() => {
    tick++;
    const visible = win && win.isVisible();
    if (visible || tick % 8 === 0) pushMetrics();
  }, 1000);

  // file poll (pick up appended usage) every 4s
  setInterval(() => { store.poll().catch(() => {}); }, 4000);

  // prune old events every 60s
  setInterval(() => { store.prune(); }, 60000);

  // re-assert the statusline link every 30s (self-heal if another tool overwrites
  // it, e.g. a second usage app fighting over settings.json). Idempotent.
  setInterval(() => { patchStatusLine(); }, 30000);
}

function setupWatchers() {
  // instant nudge on transcript writes
  let t1 = null;
  try {
    fs.watch(PROJECTS_DIR, { recursive: true }, () => {
      clearTimeout(t1);
      t1 = setTimeout(() => store.poll().then(pushMetrics).catch(() => {}), 700);
    });
  } catch { /* fall back to polling */ }

  // instant nudge when the live rate-limit cache updates
  let t2 = null;
  try {
    fs.watch(CLAUDE_DIR, (ev, fn) => {
      if (fn && fn.indexOf('cc-speedometer-live') !== -1) {
        clearTimeout(t2);
        t2 = setTimeout(pushMetrics, 200);
      }
    });
  } catch { /* ignore */ }
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('get-snapshot', () => lastSnapshot);
ipcMain.on('hide-widget', () => { if (win) win.hide(); });
ipcMain.on('set-pin', (_e, v) => setPinned(v));
ipcMain.on('set-mode', (_e, m) => setMode(m));
ipcMain.on('refresh', () => {
  // self-heal the statusline link, invalidate the cached diagnosis, re-read
  // everything, and push a fresh snapshot immediately.
  patchStatusLine();
  diagCache = null;
  store.poll().then(pushMetrics).catch(pushMetrics);
});
ipcMain.on('check-update', () => updater.checkForUpdates(true));
ipcMain.on('install-update', () => updater.quitAndInstall());
ipcMain.on('renderer-ready', () => {
  if (!win) return;
  if (lastSnapshot) win.webContents.send('metrics', lastSnapshot);
  win.webContents.send('update-status', updater.getState());
  sendUiState();
});

// ---------------------------------------------------------------- lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

  app.whenReady().then(async () => {
    patchStatusLine();
    account = readAccount();
    createWindow();
    createTray();
    const cfg = config.load();
    registerShortcut(cfg.shortcut);
    refreshTray();
    try { app.setLoginItemSettings({ openAtLogin: !!cfg.autostart }); } catch {}

    await store.init();
    pushMetrics();
    startIntervals();
    setupWatchers();

    // Auto-update (packaged builds only; a no-op in dev). onBeforeQuit flips the
    // app into real-quit mode so quitAndInstall isn't swallowed by the window's
    // close→hide interceptor; onChange keeps the tray label in sync.
    updater.initUpdater(win, {
      onBeforeQuit: () => { app.isQuitting = true; },
      onChange: (st) => { updateState = st; refreshTray(); },
    });
  });

  app.on('window-all-closed', (e) => { /* keep running in tray */ });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); });
}
