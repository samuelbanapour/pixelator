#!/usr/bin/env node
// Generates every app icon/splash from one pixel-art invader. No dependencies.
// Run from the repo root:  node tools/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const INVADER = ['  #     #  ', '   #   #   ', '  #######  ', ' ## ### ## ', '###########', '# ####### #', '# #     # #', '   ## ##   '];
const MINT = [95, 240, 208], PINK = [255, 95, 162], YELLOW = [255, 211, 95], BLUE = [125, 107, 255];
const BG_TOP = [58, 42, 107], BG_BOTTOM = [20, 17, 31];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// One sample at (u, v) in 0..1. mode: 'std' | 'round' | 'fg' | 'splash' | 'tile'
function sample(u, v, mode, aspect) {
  let bg = null;
  if (mode === 'fg') bg = null;
  else if (mode === 'splash') bg = BG_BOTTOM.concat(255);
  else if (mode === 'tile') bg = mix(BG_TOP, BG_BOTTOM, v).concat(255);
  else {
    let inside = true;
    if (mode === 'round') inside = (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25;
    else { // rounded square, radius 0.22
      const r = 0.22, x = Math.abs(u - 0.5) - (0.5 - r), y = Math.abs(v - 0.5) - (0.5 - r);
      inside = x <= 0 || y <= 0 ? true : x * x + y * y <= r * r;
    }
    if (inside) bg = mix(BG_TOP, BG_BOTTOM, v).concat(255);
  }
  // Invader, sized as a fraction of the shorter side.
  const frac = mode === 'fg' ? 0.5 : mode === 'splash' ? 0.3 : mode === 'tile' ? 0.56 : 0.62;
  const cw = (frac * Math.min(1, 1 / aspect)) / 11; // cell width in u  (square cells in pixels)
  const ch = (frac * Math.min(1, aspect)) / 11; // cell height in v
  const w = 11 * cw, h = 8 * ch;
  const x0 = (1 - w) / 2, y0 = (1 - h) / 2 - (mode === 'splash' ? 0 : 0.02);
  const cx = Math.floor((u - x0) / cw), cy = Math.floor((v - y0) / ch);
  if (cx >= 0 && cx < 11 && cy >= 0 && cy < 8 && INVADER[cy][cx] === '#') return mix(MINT, [140, 255, 230], cy / 8).concat(255);
  // Drop shadow one cell down-right
  const sx = Math.floor((u - x0 - cw * 0.45) / cw), sy = Math.floor((v - y0 - ch * 0.45) / ch);
  if (mode !== 'splash' && sx >= 0 && sx < 11 && sy >= 0 && sy < 8 && INVADER[sy][sx] === '#') return PINK.concat(mode === 'fg' ? 255 : 255);
  // Logo-colored corner pixels (standard icons only)
  if (mode === 'std' || mode === 'round') {
    const p = 0.045, base = 0.16;
    const dots = [PINK, YELLOW, MINT, BLUE];
    for (let i = 0; i < 4; i++) {
      const dx = base + i * (p + 0.012), dy = 0.13;
      if (u >= dx && u < dx + p && v >= dy && v < dy + p) return dots[i].concat(255);
    }
  }
  return bg || [0, 0, 0, 0];
}

function render(w, h, mode) {
  const buf = Buffer.alloc(w * h * 4);
  const aspect = w / h;
  const S = 3; // supersample
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const s = sample((x + (i + 0.5) / S) / w, (y + (j + 0.5) / S) / h, mode, aspect);
      r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
    }
    const o = (y * w + x) * 4;
    if (a > 0) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; buf[o + 3] = a / (S * S); }
  }
  return buf;
}

function crc32(b) { return zlib.crc32(b) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function write(rel, w, h, mode) {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, png(w, h, render(w, h, mode)));
  console.log('wrote', rel, `${w}x${h}`, mode);
}

// Web
write('web/icon-512.png', 512, 512, 'std');
write('web/icon-192.png', 192, 192, 'std');
write('web/favicon-64.png', 64, 64, 'std');
// Desktop (electron-builder turns build/icon.png into .icns and .ico)
write('desktop/build/icon.png', 1024, 1024, 'std');

// Microsoft Store (AppX/MSIX) tiles, picked up by electron-builder from build/appx
write('desktop/build/appx/StoreLogo.png', 50, 50, 'tile');
write('desktop/build/appx/Square44x44Logo.png', 44, 44, 'tile');
write('desktop/build/appx/Square150x150Logo.png', 150, 150, 'tile');
write('desktop/build/appx/Wide310x150Logo.png', 310, 150, 'tile');

// Android launcher icons
const res = path.join('android', 'android', 'app', 'src', 'main', 'res');
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  write(`${res}/mipmap-${d}/ic_launcher.png`, 48 * k, 48 * k, 'std');
  write(`${res}/mipmap-${d}/ic_launcher_round.png`, 48 * k, 48 * k, 'round');
  write(`${res}/mipmap-${d}/ic_launcher_foreground.png`, 108 * k, 108 * k, 'fg');
}
// Launch splash: same sizes as the existing Capacitor defaults
const resDir = path.join(ROOT, res);
for (const dir of fs.readdirSync(resDir).filter((d) => d.startsWith('drawable') && fs.existsSync(path.join(resDir, d, 'splash.png')))) {
  const b = fs.readFileSync(path.join(resDir, dir, 'splash.png'));
  write(`${res}/${dir}/splash.png`, b.readUInt32BE(16), b.readUInt32BE(20), 'splash');
}
fs.writeFileSync(path.join(resDir, 'values', 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2A1F4A</color>\n</resources>\n');
