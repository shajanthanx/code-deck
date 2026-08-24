'use strict';
// Shared renderer helpers.

function clampv(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmtTokens(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

function fmtCountdown(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// "2:41pm" (omit ":00" for whole hours -> "9am")
function fmtClock(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12; if (h === 0) h = 12;
  return m === 0 ? `${h}${ap}` : `${h}:${m < 10 ? '0' + m : m}${ap}`;
}

// "Thu 9am"
function fmtDayClock(ts) {
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ts).getDay()];
  return `${wd} ${fmtClock(ts)}`;
}

// "resets 2:41pm · in 2h 6m"  (weekday prefix once the reset is >= 24h away)
function fmtResetLine(resetsAt, now) {
  if (resetsAt == null) return 'waiting for live data';
  const diff = resetsAt - now;
  const when = diff >= 24 * 3600 * 1000 ? fmtDayClock(resetsAt) : fmtClock(resetsAt);
  return `resets ${when} · in ${fmtCountdown(Math.max(0, diff))}`;
}

// "5s ago" / "3m ago" / "2h ago" / "4d ago"
function fmtAge(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// exponential smoothing step toward target; rate in "per second"
function easeTo(cur, target, rate, dt) {
  const k = 1 - Math.exp(-rate * dt);
  return cur + (target - cur) * k;
}
