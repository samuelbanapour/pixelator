// Pixelator core: palettes, quantization, retro "looks". Runs in browsers and Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pixelate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const hex = (list) => list.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

  // A palette is one of: fixed `colors`, per-channel `levels` (number or [r,g,b]), or neither
  // (then the UI's "colors per channel" slider decides).
  const PALETTES = {
    original: { name: 'Original colors', colors: null },
    gameboy: { name: 'Game Boy', colors: hex(['#0f380f', '#306230', '#8bac0f', '#9bbc0f']) },
    pico8: {
      name: 'PICO-8',
      colors: hex(['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
        '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa']),
    },
    c64: {
      name: 'Commodore 64',
      colors: hex(['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77',
        '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb']),
    },
    cga: { name: 'CGA', colors: hex(['#000000', '#55ffff', '#ff55ff', '#ffffff']) },
    ega: {
      name: 'EGA (16 colors)',
      colors: hex(['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
        '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff']),
    },
    vga332: { name: 'VGA 256 colors (3-3-2)', levels: [8, 8, 4] },
    websafe: { name: 'Windows 95 / web-safe (216)', levels: 6 },
    ps1: { name: 'PlayStation 15-bit', levels: 32 },
    truecolor: { name: 'Full color (no reduction)', levels: 256 },
    mono: { name: 'Black & white', colors: hex(['#000000', '#ffffff']) },
    sunset: { name: 'Sunset', colors: hex(['#1a1423', '#372549', '#774c60', '#b75d69', '#eacdc2', '#ffb400']) },
  };

  // A look = a target resolution (`grid`, pixels along the long side) + palette + dither + effects.
  // `fx` values are scaled by the strength slider; post effects (scan, vignette, tracking, osd)
  // are drawn by the host after upscaling.
  const LOOKS = {
    none: { name: 'Manual (no look)' },
    vhs: {
      group: 'Tape', name: 'VHS tape', grid: 360, palette: 'truecolor', dither: 0,
      fx: {
        soften: [1, 0], chroma: { radius: 5, shift: 2 }, noise: 0.07,
        grade: { contrast: 1.06, saturation: 1.25, brightness: 0.02, blackLift: 14, tint: [1.03, 0.98, 1.06] },
        scan: 0.22, tracking: true, osd: true,
      },
    },
    ps1: {
      group: 'PlayStation', name: 'PlayStation 1 (1994)', grid: 320, palette: 'ps1', dither: 0.9,
      fx: { grade: { contrast: 1.05, saturation: 1.1 }, scan: 0.15 },
    },
    ps2: {
      group: 'PlayStation', name: 'PlayStation 2 (2000)', grid: 640, palette: 'truecolor', dither: 0,
      fx: { soften: [1, 1], bloom: { amount: 0.15, threshold: 190 }, grade: { contrast: 1.1, saturation: 0.95 }, scan: 0.1 },
    },
    xbox: {
      group: 'Xbox', name: 'Xbox (2001)', grid: 640, palette: 'truecolor', dither: 0,
      fx: { bloom: { amount: 0.28, threshold: 180 }, grade: { contrast: 1.15, saturation: 1.15 }, scan: 0.08 },
    },
    x360: {
      group: 'Xbox', name: 'Xbox 360 (2005)', grid: 1280, palette: 'truecolor', dither: 0,
      fx: {
        bloom: { amount: 0.55, threshold: 150 },
        grade: { contrast: 1.2, saturation: 0.8, brightness: -0.03, tint: [1.05, 1.0, 0.92] }, vignette: 0.35,
      },
    },
    dos: { group: 'PC', name: 'DOS VGA (1990)', grid: 320, palette: 'vga332', dither: 0.7, fx: { scan: 0.18 } },
    ega: { group: 'PC', name: 'DOS EGA (1984)', grid: 320, palette: 'ega', dither: 0.6, fx: { scan: 0.18 } },
    win95: { group: 'PC', name: 'Windows 95 (1995)', grid: 640, palette: 'websafe', dither: 0.8, fx: {} },
  };

  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function nearestIndex(r, g, b, pal) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const p = pal[i];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Palette lookups are cached on 6-bit RGB cells (262144 entries), filled lazily.
  const palCache = new WeakMap();
  // Per-channel level tables, one row per Bayer cell, keyed by levels + dither strength.
  const levelCache = new Map();
  function levelTables(lv, dither) {
    const key = lv.join(',') + '|' + dither;
    let t = levelCache.get(key);
    if (t) return t;
    t = lv.map((n) => {
      const tab = new Uint8ClampedArray(16 * 256); // clamped array rounds like the pixel buffer does
      if (n >= 256) return null;
      const step = 255 / (Math.max(2, n) - 1);
      for (let bi = 0; bi < 16; bi++) for (let v = 0; v < 256; v++)
        tab[bi * 256 + v] = clamp(Math.round((v + BAYER4[bi] * dither * step) / step) * step);
      return tab;
    });
    if (levelCache.size > 32) levelCache.clear();
    levelCache.set(key, t);
    return t;
  }

  // In-place. opts: { palette: [[r,g,b]...] | null, levels: n | [r,g,b] (256 = untouched), dither: 0..1 }
  function quantize(data, w, h, opts) {
    const pal = opts.palette || null;
    const lv = Array.isArray(opts.levels) ? opts.levels : [opts.levels || 8, opts.levels || 8, opts.levels || 8];
    const dither = opts.dither || 0;
    if (pal) {
      let cache = palCache.get(pal);
      if (!cache) { cache = new Int16Array(262144).fill(-1); palCache.set(pal, cache); }
      const spread = dither * 64;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 128) continue;
          const t = dither ? BAYER4[(y & 3) * 4 + (x & 3)] * spread : 0;
          const r = clamp(data[i] + t) | 0, g = clamp(data[i + 1] + t) | 0, b = clamp(data[i + 2] + t) | 0;
          const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
          let idx = cache[key];
          if (idx < 0) idx = cache[key] = nearestIndex((r & 252) + 2, (g & 252) + 2, (b & 252) + 2, pal);
          const c = pal[idx];
          data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
        }
      }
      return data;
    }
    if (lv.every((n) => n >= 256)) return data;
    const [tr, tg, tb] = levelTables(lv, dither);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue;
        const o = ((y & 3) * 4 + (x & 3)) * 256;
        if (tr) data[i] = tr[o + data[i]];
        if (tg) data[i + 1] = tg[o + data[i + 1]];
        if (tb) data[i + 2] = tb[o + data[i + 2]];
      }
    }
    return data;
  }

  // ---------- effects (all in place, on the small pre-upscale image) ----------
  function soften(d, w, h, sx, sy) {
    if (sx) {
      for (let y = 0; y < h; y++) {
        let pr = d[y * w * 4], pg = d[y * w * 4 + 1], pb = d[y * w * 4 + 2];
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, n = x + 1 < w ? i + 4 : i;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          d[i] = (pr + 2 * r + d[n]) / 4; d[i + 1] = (pg + 2 * g + d[n + 1]) / 4; d[i + 2] = (pb + 2 * b + d[n + 2]) / 4;
          pr = r; pg = g; pb = b;
        }
      }
    }
    if (sy) {
      const row = new Uint8ClampedArray(w * 4 * 2);
      const prev = row.subarray(0, w * 4);
      prev.set(d.subarray(0, w * 4));
      for (let y = 0; y < h; y++) {
        const cur = row.subarray(w * 4);
        cur.set(d.subarray(y * w * 4, (y + 1) * w * 4));
        const nb = y + 1 < h ? (y + 1) * w * 4 : y * w * 4;
        for (let x = 0; x < w * 4; x++) if ((x & 3) !== 3) d[y * w * 4 + x] = (prev[x] + 2 * cur[x] + d[nb + x]) / 4;
        prev.set(cur);
      }
    }
  }

  function boxBlur(a, w, h, r, tmp) {
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) { // horizontal
      let sum = 0; const o = y * w;
      for (let x = -r; x <= r; x++) sum += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = sum / n;
        sum += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) { // vertical
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / n;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }

  // Analog tape: chroma is lower resolution than luma and offset sideways.
  function chromaBleed(d, w, h, radius, shift) {
    const pb = new Float32Array(w + 1), pr = new Float32Array(w + 1), yy = new Float32Array(w);
    const ob = new Float32Array(w), or = new Float32Array(w);
    const r = Math.max(1, Math.round(radius));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        const Y = 0.299 * R + 0.587 * G + 0.114 * B;
        yy[x] = Y; pb[x + 1] = pb[x] + (B - Y) * 0.564; pr[x + 1] = pr[x] + (R - Y) * 0.713;
      }
      for (let x = 0; x < w; x++) {
        const c = Math.min(w - 1, Math.max(0, x - shift)), lo = Math.max(0, c - r), hi = Math.min(w, c + r + 1), n = hi - lo;
        ob[x] = (pb[hi] - pb[lo]) / n;
        or[x] = (pr[hi] - pr[lo]) / n;
      }
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, Y = yy[x];
        d[i] = clamp(Y + 1.403 * or[x]);
        d[i + 1] = clamp(Y - 0.344 * ob[x] - 0.714 * or[x]);
        d[i + 2] = clamp(Y + 1.773 * ob[x]);
      }
    }
  }

  function grade(d, g, s) {
    const contrast = lerp(1, g.contrast ?? 1, s), sat = lerp(1, g.saturation ?? 1, s);
    const bright = (g.brightness ?? 0) * s * 255, lift = (g.blackLift ?? 0) * s;
    const tint = (g.tint || [1, 1, 1]).map((v) => lerp(1, v, s));
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      for (let k = 0; k < 3; k++) {
        let v = l + (d[i + k] - l) * sat;
        v = (v - 128) * contrast + 128 + bright;
        v = (v * (255 - lift)) / 255 + lift;
        d[i + k] = clamp(v * tint[k]);
      }
    }
  }

  function bloom(d, w, h, amount, threshold) {
    const n = w * h, r = Math.max(2, Math.round(w / 90));
    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], tmp = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const i = p * 4, l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const k = Math.max(0, Math.min(1, (l - threshold) / (255 - threshold)));
      ch[0][p] = d[i] * k; ch[1][p] = d[i + 1] * k; ch[2][p] = d[i + 2] * k;
    }
    for (const c of ch) { boxBlur(c, w, h, r, tmp); boxBlur(c, w, h, r, tmp); }
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      for (let k = 0; k < 3; k++) { const b = Math.min(255, ch[k][p] * amount * 2.2); d[i + k] = 255 - ((255 - d[i + k]) * (255 - b)) / 255; }
    }
  }

  function rng(seed) { // mulberry32
    let a = (seed * 2654435761) >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function noise(d, amount, seed) {
    const rand = rng(seed + 1), amp = amount * 255;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * amp;
      d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n);
    }
  }

  // fx: a LOOKS[...].fx object, s: strength 0..1, t: frame counter (varies noise per frame)
  function applyFx(d, w, h, fx, s, t) {
    if (!fx || !(s > 0)) return d;
    if (fx.soften) soften(d, w, h, fx.soften[0], fx.soften[1]);
    if (fx.chroma) chromaBleed(d, w, h, fx.chroma.radius * s, Math.round(fx.chroma.shift * s));
    if (fx.grade) grade(d, fx.grade, s);
    if (fx.bloom) bloom(d, w, h, fx.bloom.amount * s, fx.bloom.threshold);
    if (fx.noise) noise(d, fx.noise * s, t || 0);
    return d;
  }

  const smallSize = (w, h, block) => [Math.max(1, Math.ceil(w / block)), Math.max(1, Math.ceil(h / block))];
  // Block size (source pixels) that gives `grid` pixels along the long side.
  const blockFor = (grid, w, h) => Math.max(1, Math.max(w, h) / grid);

  return { PALETTES, LOOKS, quantize, applyFx, smallSize, blockFor, rng };
});
