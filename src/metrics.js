'use strict';
// Turns the raw usage events + live rate-limit cache + sessions + stats into a
// single snapshot object for the renderer. Everything here is REAL, derived data;
// nothing is invented. The only true limit percentages come from `live`.

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Round a burn-rate dial max up to a friendly value (1/2/5 * 10^n).
function niceCeil(x) {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const f = x / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

function localDayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

const H = 3600 * 1000;

function compute(store, ctx) {
  const now = ctx.now || Date.now();
  const state = ctx.state; // persistent { peakBurn }
  const ev = store.events;

  let r5 = 0, r7 = 0, today = 0;
  const bd = { in: 0, out: 0, cc: 0, cr: 0 };
  const hourly = new Array(24).fill(0);
  const todayKey = localDayKey(now);
  let last30 = 0, last300 = 0, lastTs = 0, lastTotal = 0, count5h = 0;

  // "work" tokens = input + output + cache-write. We deliberately EXCLUDE
  // cache_read here: it is huge (often 100x everything else) and cheap, and it
  // swamps every activity signal. Cache reads are still surfaced in the detail
  // breakdown. All derived activity metrics below use work tokens.
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    const work = e.tin + e.tout + e.tcc;
    const age = now - e.ts;
    if (age <= 7 * 24 * H) r7 += work;
    if (age <= 5 * H) { r5 += work; count5h++; }
    if (age <= 300000) last300 += work;
    if (age <= 30000) last30 += work;
    if (e.ts > lastTs) { lastTs = e.ts; lastTotal = work; }
    if (localDayKey(e.ts) === todayKey) {
      today += work;
      bd.in += e.tin; bd.out += e.tout; bd.cc += e.tcc; bd.cr += e.tcr;
      hourly[new Date(e.ts).getHours()] += work;
    }
  }

  // Burn rate: trailing 5-minute average, tokens/min.
  const burn = last300 / 5;
  state.peakBurn = Math.max(burn, (state.peakBurn || 0) * 0.985);
  const dialMax = niceCeil(Math.max(state.peakBurn * 1.15, 40000));

  // AI power: instantaneous 30s intensity vs the dial, spikes during bursts.
  const power = clamp((last30 * 2) / dialMax * 100, 0, 100);

  const active = now - lastTs < 45000 || (ctx.sessions && ctx.sessions.busy > 0);

  // most active hour today
  let mostActiveHour = null, mostActiveVal = -1;
  for (let h = 0; h < 24; h++) if (hourly[h] > mostActiveVal) { mostActiveVal = hourly[h]; mostActiveHour = h; }
  if (mostActiveVal <= 0) mostActiveHour = null;

  const live = ctx.live || null;
  const stats = ctx.stats || null;
  const sessions = ctx.sessions || { live: 0, busy: 0, active: null };

  return {
    now,
    generatedAt: now,
    ready: store.ready,
    // --- true limit data (from statusline capture) ---
    live: live
      ? {
          capturedAt: live.capturedAt,
          ageMs: live.capturedAt ? now - live.capturedAt : null,
          session: live.session, // {usedPct, resetsAt} | null
          weekly: live.weekly,
          contextRemainingPct: live.contextRemainingPct,
          hasLimits: !!(live.session || live.weekly),
        }
      : null,
    // --- derived from transcripts ---
    derived: {
      rolling5hTokens: r5,
      rolling7dTokens: r7,
      todayTokens: today,
      todayBreakdown: bd,
      burnRatePerMin: burn,
      dialMax,
      powerPct: power,
      hourly,
      currentHour: new Date(now).getHours(),
      mostActiveHour,
      lastActivityAgeMs: lastTs ? now - lastTs : null,
      lastResponseTokens: lastTotal,
      responses5h: count5h,
      active,
    },
    sessions: {
      liveActive: sessions.live,
      busy: sessions.busy,
      activeName: sessions.active ? sessions.active.name : null,
      total: stats ? stats.totalSessions : null,
    },
    account: ctx.account || null,
    lifetime: stats
      ? {
          totalSessions: stats.totalSessions,
          totalMessages: stats.totalMessages,
          topModels: stats.topModels,
          lifetimeTokens: stats.lifetimeTokens,
          peakHour: stats.peakHour,
        }
      : null,
  };
}

module.exports = { compute, niceCeil, clamp };
