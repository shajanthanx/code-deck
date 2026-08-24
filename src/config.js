'use strict';
// Tiny JSON-file config store (window position, shortcut, statusline backup, etc.)
// Lives in Electron's per-user userData dir. No external dependency.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'widget-config.json');
}

function load() {
  if (cache) return cache;
  try {
    let txt = fs.readFileSync(file(), 'utf8');
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1); // tolerate a BOM
    cache = JSON.parse(txt);
  } catch {
    cache = {};
  }
  return cache;
}

function save(patch) {
  const c = load();
  if (patch) Object.assign(c, patch);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(c, null, 2));
  } catch (e) {
    /* best effort */
  }
  return c;
}

module.exports = { load, save, file };
