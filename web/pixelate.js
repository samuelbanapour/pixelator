// Pixelator core: palette quantization + ordered dithering. Runs in browsers and Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pixelate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const hex = (list) => list.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

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
    mono: { name: 'Black & white', colors: hex(['#000000', '#ffffff']) },
    sunset: { name: 'Sunset', colors: hex(['#1a1423', '#372549', '#774c60', '#b75d69', '#eacdc2', '#ffb400']) },
  };

  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

  function nearest(r, g, b, pal) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const p = pal[i];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return pal[best];
  }

  // In-place. opts: { palette: [[r,g,b]...] | null, levels: 2..16 per channel, dither: 0..1 }
  function quantize(data, w, h, opts) {
    const pal = opts.palette || null;
    const levels = Math.max(2, opts.levels || 8);
    const dither = opts.dither || 0;
    const step = 255 / (levels - 1);
    const spread = pal ? 64 : step;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue;
        const t = dither ? BAYER4[(y & 3) * 4 + (x & 3)] * dither * spread : 0;
        const r = data[i] + t, g = data[i + 1] + t, b = data[i + 2] + t;
        if (pal) {
          const c = nearest(r, g, b, pal);
          data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
        } else {
          data[i] = Math.max(0, Math.min(255, Math.round(r / step) * step));
          data[i + 1] = Math.max(0, Math.min(255, Math.round(g / step) * step));
          data[i + 2] = Math.max(0, Math.min(255, Math.round(b / step) * step));
        }
      }
    }
    return data;
  }

  const smallSize = (w, h, block) => [Math.max(1, Math.ceil(w / block)), Math.max(1, Math.ceil(h / block))];

  return { PALETTES, quantize, smallSize };
});
