'use strict';
// Reads ~/.claude/sessions/*.json (live process registry) to detect whether
// Claude Code is actively running right now.
const fs = require('fs');
const path = require('path');
const { SESSIONS_DIR } = require('../paths');

function readSessions() {
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return { live: 0, busy: 0, active: null };
  }
  const now = Date.now();
  let busy = 0;
  let live = 0;
  let active = null;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    const upd = Date.parse(j.statusUpdatedAt || j.updatedAt || '') || 0;
    const isBusy = j.status === 'busy';
    const isRecent = now - upd < 60000;
    if (isBusy) busy++;
    if (isBusy || isRecent) {
      live++;
      if (!active || upd > active.upd) active = { name: j.name || null, cwd: j.cwd || null, upd, status: j.status };
    }
  }
  return { live, busy, active };
}

module.exports = { readSessions };
