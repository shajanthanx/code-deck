'use strict';
// Central location of every Claude Code file the widget reads.
const os = require('os');
const path = require('path');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

module.exports = {
  CLAUDE_DIR,
  PROJECTS_DIR: path.join(CLAUDE_DIR, 'projects'),
  SESSIONS_DIR: path.join(CLAUDE_DIR, 'sessions'),
  STATS_CACHE: path.join(CLAUDE_DIR, 'stats-cache.json'),
  LIVE_CACHE: path.join(CLAUDE_DIR, 'cc-speedometer-live.json'),
  SETTINGS: path.join(CLAUDE_DIR, 'settings.json'),
  CREDENTIALS: path.join(CLAUDE_DIR, '.credentials.json'),
};
