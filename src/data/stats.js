'use strict';
// Reads ~/.claude/stats-cache.json — a periodic rollup used for lifetime totals
// and fallback stats. (costUSD/contextWindow are always 0 here; ignored.)
const fs = require('fs');
const { STATS_CACHE } = require('../paths');

function readStats() {
  let txt;
  try {
    txt = fs.readFileSync(STATS_CACHE, 'utf8');
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
  const models = Object.entries(j.modelUsage || {})
    .map(([m, u]) => ({
      model: m,
      tokens:
        (u.inputTokens || 0) +
        (u.outputTokens || 0) +
        (u.cacheCreationInputTokens || 0) +
        (u.cacheReadInputTokens || 0),
    }))
    .sort((a, b) => b.tokens - a.tokens);

  // busiest hour-of-day from the lifetime histogram (fallback for "most active hour")
  let peakHour = null;
  let peakHourVal = -1;
  for (const [h, v] of Object.entries(j.hourCounts || {})) {
    if (v > peakHourVal) { peakHourVal = v; peakHour = Number(h); }
  }

  return {
    totalSessions: j.totalSessions || 0,
    totalMessages: j.totalMessages || 0,
    topModels: models.slice(0, 4),
    lifetimeTokens: models.reduce((s, m) => s + m.tokens, 0),
    peakHour,
    lastComputedDate: j.lastComputedDate || null,
  };
}

module.exports = { readStats };
