'use strict';
// Auto-update, isolated from the rest of main.js.
//
// Distribution model: the app reads its update feed from a PUBLIC GitHub repo
// (code-deck-releases) — see build.publish in package.json — so no credentials
// are ever embedded in the shipped app. Downloads are anonymous.
//
// Everything here is defensive: a failed check / download / offline machine must
// NEVER stop the widget from running. All updater work is skipped entirely in dev
// (electron-updater throws when the app is not packaged), where we report a
// harmless 'dev' state instead.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let autoUpdater = null;
let win = null;
let hooks = { onBeforeQuit: null, onChange: null };

// Re-check cadence: shortly after launch, then every few hours while running.
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// state.state ∈ idle | dev | checking | available | downloading | ready | not-available | error
let state = { state: 'idle', version: null, percent: 0, error: null, manual: false };

// ---------------------------------------------------------------- logging
// A tiny file logger so update behaviour is inspectable in the field (and so the
// v1.0.0 → v1.0.1 flow can be validated headlessly by reading the log).
let logFile = null;
function logPath() {
  if (logFile) return logFile;
  try { logFile = path.join(app.getPath('userData'), 'updater.log'); } catch { logFile = null; }
  return logFile;
}
function write(level, args) {
  try {
    const p = logPath(); if (!p) return;
    const line = `[${new Date().toISOString()}] ${level} ${args.map(String).join(' ')}\n`;
    fs.appendFileSync(p, line);
  } catch { /* logging must never throw */ }
}
const logger = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  debug: (...a) => write('DEBUG', a),
};

// ---------------------------------------------------------------- state plumbing
function send() {
  if (win && !win.isDestroyed() && win.webContents) {
    try { win.webContents.send('update-status', state); } catch { /* ignore */ }
  }
}
function setState(patch) {
  state = Object.assign({}, state, patch);
  send();
  if (typeof hooks.onChange === 'function') { try { hooks.onChange(state); } catch { /* ignore */ } }
}
function getState() { return state; }

// ---------------------------------------------------------------- init
function initUpdater(browserWindow, opts) {
  win = browserWindow;
  hooks = Object.assign({ onBeforeQuit: null, onChange: null }, opts || {});

  // Dev / unpackaged: electron-updater refuses to run. Report and bail cleanly.
  if (!app.isPackaged) {
    write('INFO', ['dev mode — auto-update disabled (app not packaged)']);
    setState({ state: 'dev' });
    return;
  }

  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    write('ERROR', ['electron-updater failed to load', e && e.message]);
    setState({ state: 'error', error: 'Updater unavailable' });
    return;
  }

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;            // pull the update in the background
  autoUpdater.autoInstallOnAppQuit = true;    // and fold it in on the next quit
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => setState({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (info) =>
    setState({ state: 'available', version: info && info.version, percent: 0, error: null }));
  autoUpdater.on('update-not-available', (info) =>
    setState({ state: 'not-available', version: info && info.version, error: null }));
  autoUpdater.on('download-progress', (p) =>
    setState({ state: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p && p.percent || 0))) }));
  autoUpdater.on('update-downloaded', (info) => {
    setState({ state: 'ready', version: info && info.version, percent: 100, error: null });
    notifyReady(info && info.version);
  });
  autoUpdater.on('error', (err) => {
    write('ERROR', ['update error', err && (err.stack || err.message || err)]);
    // Keep the app calm: surface the error state, but the renderer only shows it
    // to the user for a manual check. Auto-check failures stay quiet.
    setState({ state: 'error', error: humanError(err) });
  });

  setTimeout(() => check(false), FIRST_CHECK_DELAY_MS);
  setInterval(() => check(false), CHECK_INTERVAL_MS);
}

function humanError(err) {
  const m = String((err && err.message) || err || 'Update check failed');
  if (/net::|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|getaddrinfo/i.test(m)) {
    return 'Could not reach the update server (offline?).';
  }
  if (/404|Not Found|latest\.yml/i.test(m)) return 'No published release found yet.';
  return m;
}

// A quiet system notification when an update is staged and ready.
function notifyReady(version) {
  try {
    const { Notification } = require('electron');
    if (Notification && Notification.isSupported()) {
      const n = new Notification({
        title: 'Claude Code Usage — update ready',
        body: `Version ${version || ''} is downloaded. It installs next time you restart the widget.`.trim(),
        silent: true,
      });
      n.show();
    }
  } catch { /* notifications are best-effort */ }
}

// ---------------------------------------------------------------- actions
function check(manual) {
  state.manual = !!manual;
  if (!autoUpdater) {
    // dev or load failure — reflect that back so a manual check gives feedback
    setState({ state: app.isPackaged ? 'error' : 'dev', manual: !!manual });
    return;
  }
  try {
    autoUpdater.checkForUpdates().catch((err) => {
      write('ERROR', ['checkForUpdates rejected', err && err.message]);
      setState({ state: 'error', error: humanError(err), manual: !!manual });
    });
  } catch (err) {
    write('ERROR', ['checkForUpdates threw', err && err.message]);
    setState({ state: 'error', error: humanError(err), manual: !!manual });
  }
}

// Install the staged update and relaunch. The caller's onBeforeQuit must flip the
// app into "really quitting" mode, otherwise main.js's close→hide interceptor
// would swallow the quit and the update would never install.
function quitAndInstall() {
  if (!autoUpdater || state.state !== 'ready') return;
  try {
    if (typeof hooks.onBeforeQuit === 'function') hooks.onBeforeQuit();
    write('INFO', ['quitAndInstall']);
    // isSilent=true (per-user, no UAC), isForceRunAfter=true (relaunch after install)
    autoUpdater.quitAndInstall(true, true);
  } catch (e) {
    write('ERROR', ['quitAndInstall failed', e && e.message]);
  }
}

module.exports = { initUpdater, checkForUpdates: check, quitAndInstall, getState };
