'use strict';
// Reads ONLY the two non-secret plan labels from ~/.claude/.credentials.json
// (subscriptionType, rateLimitTier). Tokens/secrets in that file are never read,
// retained, logged, or transmitted.
const fs = require('fs');
const { CREDENTIALS } = require('../paths');

function readAccount() {
  let txt;
  try {
    txt = fs.readFileSync(CREDENTIALS, 'utf8');
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
  const o = (j && j.claudeAiOauth) || {};
  // extract only the two label strings; drop everything else
  return {
    subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : null,
    rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : null,
  };
}

module.exports = { readAccount };
