'use strict';
// Tray icon generated at runtime: a small coral Anthropic-style spike mark on a
// transparent background. No binary asset to ship.
const zlib = require('zlib');

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// 8-spoke asterisk (four diameters through the centre) in coral.
function draw() {
  const S = 32;
  const buf = Buffer.alloc(S * S * 4);
  const cx = 16, cy = 16, R = 13, hw = 1.8;
  const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
  const cr = [204, 120, 92]; // #cc785c
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > R + 0.6) continue;
      let dmin = 1e9;
      for (const a of angles) {
        const nx = -Math.sin(a), ny = Math.cos(a);
        const dist = Math.abs(dx * nx + dy * ny);
        if (dist < dmin) dmin = dist;
      }
      const stroke = clamp01(hw + 0.5 - dmin);
      const edge = clamp01(R + 0.5 - r);
      const a = Math.round(255 * Math.min(stroke, edge));
      if (a > 0) {
        const i = (y * S + x) * 4;
        if (a > buf[i + 3]) { buf[i] = cr[0]; buf[i + 1] = cr[1]; buf[i + 2] = cr[2]; buf[i + 3] = a; }
      }
    }
  }
  return encodePNG(S, S, buf);
}

let cached = null;
function trayIconDataUrl() {
  if (!cached) cached = 'data:image/png;base64,' + draw().toString('base64');
  return cached;
}

module.exports = { trayIconDataUrl };
