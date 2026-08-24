'use strict';
// Reads the live rate-limit cache written by the statusline capture script.
// This is the ONLY source of the true /usage percentages + reset times, because
// Claude Code only pipes them to the statusline at render time and never persists
// them itself. Shape of rate_limits is normalised defensively.
const fs = require('fs');
const { LIVE_CACHE } = require('../paths');

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// resets_at may be epoch seconds, epoch ms, or an ISO string.
function normReset(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  const p = Date.parse(v);
  return isNaN(p) ? null : p;
}

function contextRemaining(j) {
  const c = j && j.context_window;
  if (!c) return null;
  if (c.remaining_percentage != null) return num(c.remaining_percentage);
  if (c.used_percentage != null) return 100 - num(c.used_percentage);
  return null;
}

function pick(it, keys) {
  for (const k of keys) if (it[k] != null) return it[k];
  return null;
}

function classify(it) {
  const s = String(it.__key || it.type || it.bar || it.window || it.name || '').toLowerCase();
  const weekly = /(7|seven|day|week)/.test(s);
  const session = /(5|five|hour)/.test(s);
  if (weekly && !/(^|[^0-9])5(?![0-9])|five/.test(s)) return 'weekly';
  if (session && !weekly) return 'session';
  if (weekly) return 'weekly';
  return null;
}

function readLive() {
  let txt;
  try {
    txt = fs.readFileSync(LIVE_CACHE, 'utf8');
  } catch {
    return null;
  }
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    return null;
  }

  const out = {
    capturedAt: j.capturedAt ? Date.parse(j.capturedAt) || null : null,
    session: null,
    weekly: null,
    contextRemainingPct: contextRemaining(j),
  };

  const rl = j.rate_limits;
  if (!rl) return out;

  const items = [];
  if (Array.isArray(rl)) {
    for (const v of rl) if (v && typeof v === 'object') items.push(v);
  } else if (typeof rl === 'object') {
    for (const [k, v] of Object.entries(rl)) {
      if (v && typeof v === 'object') items.push(Object.assign({ __key: k }, v));
      else if (typeof v === 'number') items.push({ __key: k, used_percentage: v });
    }
  }

  for (const it of items) {
    const cls = classify(it);
    if (!cls) continue;
    const rec = {
      usedPct: num(pick(it, ['used_percentage', 'usedPercentage', 'used', 'percent', 'utilization'])),
      resetsAt: normReset(pick(it, ['resets_at', 'resetsAt', 'reset', 'reset_at'])),
    };
    if (cls === 'session' && !out.session) out.session = rec;
    else if (cls === 'weekly' && !out.weekly) out.weekly = rec;
  }
  return out;
}

module.exports = { readLive };
