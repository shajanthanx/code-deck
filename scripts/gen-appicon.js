'use strict';
// Generates build/icon.ico (256x256) — a coral rounded-square tile with a cream
// Anthropic-style spike mark. Standalone: its own PNG + ICO encoders.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

let CRC = null;
function crcTable() {
  if (CRC) return CRC;
  CRC = new Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  return CRC;
}
function crc32(buf) { const t = crcTable(); let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function wrapICO(png) {
  const dir = Buffer.alloc(6); dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const ent = Buffer.alloc(16);
  ent[0] = 0; ent[1] = 0;          // 0 => 256
  ent[2] = 0; ent[3] = 0;
  ent.writeUInt16LE(1, 4);         // planes
  ent.writeUInt16LE(32, 6);        // bpp
  ent.writeUInt32LE(png.length, 8);
  ent.writeUInt32LE(6 + 16, 12);   // offset
  return Buffer.concat([dir, ent, png]);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function draw() {
  const S = 256;
  const buf = Buffer.alloc(S * S * 4);
  const cx = 128, cy = 128;
  const half = 128, r = 56;                 // rounded-square corner radius
  const coral = [204, 120, 92];
  const cream = [250, 249, 245];
  const spokes = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
  const spikeR = 82, hw = 8;

  function over(i, col, a) {
    if (a <= 0) return;
    const da = buf[i + 3] / 255, sa = a;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    buf[i] = Math.round((col[0] * sa + buf[i] * da * (1 - sa)) / oa);
    buf[i + 1] = Math.round((col[1] * sa + buf[i + 1] * da * (1 - sa)) / oa);
    buf[i + 2] = Math.round((col[2] * sa + buf[i + 2] * da * (1 - sa)) / oa);
    buf[i + 3] = Math.round(oa * 255);
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // rounded-square coverage
      const qx = Math.abs(x + 0.5 - cx) - (half - r);
      const qy = Math.abs(y + 0.5 - cy) - (half - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const cd = Math.sqrt(ox * ox + oy * oy);
      const tileA = clamp01(r + 0.5 - cd);
      if (tileA > 0) over(i, coral, tileA);

      // spike mark
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const rr = Math.sqrt(dx * dx + dy * dy);
      let dmin = 1e9;
      for (const a of spokes) { const nx = -Math.sin(a), ny = Math.cos(a); const d = Math.abs(dx * nx + dy * ny); if (d < dmin) dmin = d; }
      const spikeA = clamp01(hw + 0.5 - dmin) * clamp01(spikeR + 0.5 - rr) * tileA;
      if (spikeA > 0) over(i, cream, spikeA);
    }
  }
  return encodePNG(S, S, buf);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const ico = wrapICO(draw());
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('wrote build/icon.ico', ico.length, 'bytes');
