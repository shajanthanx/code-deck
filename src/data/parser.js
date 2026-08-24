'use strict';
// Reads Claude Code session transcripts (~/.claude/projects/**/*.jsonl) and keeps
// an in-memory list of token-usage events for the trailing 7 days.
//
// Key rules established by inspecting the real data:
//  - token usage lives only on `type === "assistant"` lines at message.usage.*
//  - the same API response is logged on multiple consecutive lines -> dedupe by requestId
//  - timestamps are ISO-8601 UTC; we store epoch ms and bucket by LOCAL time later
//  - only tail appended bytes on change; never re-read whole files repeatedly
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PROJECTS_DIR } = require('../paths');

const WINDOW_MS = 7 * 24 * 3600 * 1000;      // keep 7 days of events
const MAXFULL = 30 * 1024 * 1024;            // cap first read of a huge file to last 30MB

class UsageStore {
  constructor() {
    this.events = [];              // {ts,tin,tout,tcc,tcr,total,model,requestId}
    this.seen = new Set();         // requestIds already counted (within window)
    this.fileState = new Map();    // path -> { size, partial }
    this.ready = false;
  }

  async walk(dir, out) {
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of ents) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) await this.walk(fp, out);
      else if (e.name.endsWith('.jsonl')) out.push(fp);
    }
    return out;
  }

  async readRange(fp, start, end) {
    const len = end - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    let fd;
    try {
      fd = await fsp.open(fp, 'r');
      await fd.read(buf, 0, len, start);
    } finally {
      if (fd) await fd.close();
    }
    return buf.toString('utf8');
  }

  parseLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    if (!obj || obj.type !== 'assistant') return;
    const msg = obj.message;
    if (!msg || !msg.usage) return;
    const rid = obj.requestId || msg.id;
    if (!rid || this.seen.has(rid)) return;
    const ts = Date.parse(obj.timestamp);
    if (isNaN(ts)) return;
    const u = msg.usage;
    const tin = u.input_tokens || 0;
    const tout = u.output_tokens || 0;
    const tcc = u.cache_creation_input_tokens || 0;
    const tcr = u.cache_read_input_tokens || 0;
    this.seen.add(rid);
    this.events.push({
      ts,
      tin, tout, tcc, tcr,
      total: tin + tout + tcc + tcr,
      model: msg.model || '?',
      requestId: rid,
    });
  }

  async processFile(fp) {
    let st;
    try {
      st = await fsp.stat(fp);
    } catch {
      return;
    }
    const prev = this.fileState.get(fp) || { size: 0, partial: '' };
    let start = prev.size;
    let partial = prev.partial || '';
    if (st.size < start) { start = 0; partial = ''; }          // truncated / rotated
    if (start === 0 && st.size > MAXFULL) { start = st.size - MAXFULL; partial = ''; }
    if (st.size <= start) { this.fileState.set(fp, { size: st.size, partial }); return; }

    const text = await this.readRange(fp, start, st.size);
    const combined = partial + text;
    const lines = combined.split('\n');
    const newPartial = lines.pop();                            // trailing incomplete line
    for (const ln of lines) if (ln) this.parseLine(ln);        // a broken first fragment just fails JSON.parse safely
    this.fileState.set(fp, { size: st.size, partial: newPartial });
  }

  // First pass: read all recent files fully; register (but skip) old files so
  // later tails only pick up appended bytes.
  async init() {
    const files = await this.walk(PROJECTS_DIR, []);
    const cutoff = Date.now() - WINDOW_MS;
    for (const fp of files) {
      let st;
      try { st = await fsp.stat(fp); } catch { continue; }
      if (st.mtimeMs < cutoff) {
        this.fileState.set(fp, { size: st.size, partial: '' });
      } else {
        await this.processFile(fp);
      }
    }
    this.ready = true;
    this.prune();
  }

  // Incremental: pick up new files and appended bytes.
  async poll() {
    const files = await this.walk(PROJECTS_DIR, []);
    const cutoff = Date.now() - WINDOW_MS;
    for (const fp of files) {
      const prev = this.fileState.get(fp);
      if (!prev) {
        let st;
        try { st = await fsp.stat(fp); } catch { continue; }
        if (st.mtimeMs < cutoff) { this.fileState.set(fp, { size: st.size, partial: '' }); continue; }
        await this.processFile(fp);
      } else {
        let st;
        try { st = await fsp.stat(fp); } catch { continue; }
        if (st.size !== prev.size) await this.processFile(fp);
      }
    }
  }

  prune() {
    const cutoff = Date.now() - WINDOW_MS;
    let changed = false;
    const kept = [];
    for (const e of this.events) {
      if (e.ts >= cutoff) kept.push(e);
      else changed = true;
    }
    if (changed) {
      this.events = kept;
      this.seen = new Set(kept.map((e) => e.requestId));
    }
  }
}

module.exports = { UsageStore, WINDOW_MS };
