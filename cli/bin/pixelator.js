#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

// ---------- ffmpeg ----------
function findFfmpeg() {
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (e) { /* fall through */ }
  return 'ffmpeg'; // system ffmpeg
}
const FFMPEG = findFfmpeg();

// ---------- palettes & looks (shared with the web app: web/pixelate.js -> lib/pixelate.js) ----------
const shared = require('../lib/pixelate.js');
const LOOKS = shared.LOOKS;
const PALETTES = {
  original: { label: 'Original colors (just pixelate)' },
  auto8: { label: 'Auto - 8 colors', auto: 8 },
  auto16: { label: 'Auto - 16 colors', auto: 16 },
  auto32: { label: 'Auto - 32 colors', auto: 32 },
  ...Object.fromEntries(Object.entries(shared.PALETTES).filter(([k]) => k !== 'original')
    .map(([k, p]) => [k, { label: p.name, colors: p.colors, levels: p.levels }])),
};

// Every color a levels-based palette can produce, when that fits in a 256-color palette image.
function paletteColors(p) {
  if (p.colors) return p.colors;
  if (p.levels == null) return null;
  const lv = Array.isArray(p.levels) ? p.levels : [p.levels, p.levels, p.levels];
  if (lv[0] * lv[1] * lv[2] > 256) return null;
  const out = [];
  for (let r = 0; r < lv[0]; r++) for (let g = 0; g < lv[1]; g++) for (let b = 0; b < lv[2]; b++)
    out.push([r * 255 / (lv[0] - 1), g * 255 / (lv[1] - 1), b * 255 / (lv[2] - 1)].map(Math.round));
  return out;
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.jxl', '.ico', '.tga', '.ppm', '.pgm', '.pnm', '.psd', '.exr', '.svg']);
const ANIM_EXT = new Set(['.gif', '.apng']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts', '.mts', '.m2ts', '.vob']);
const kindOf = (f) => { const e = path.extname(f).toLowerCase(); return IMAGE_EXT.has(e) ? 'image' : ANIM_EXT.has(e) ? 'anim' : VIDEO_EXT.has(e) ? 'video' : null; };

// ---------- ASCII art ----------
const C = (r, g, b, s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const GLYPHS = {
  P: ['####', '#  #', '####', '#   ', '#   '], I: ['###', ' # ', ' # ', ' # ', '###'],
  X: ['#   #', ' # # ', '  #  ', ' # # ', '#   #'], E: ['####', '#   ', '### ', '#   ', '####'],
  L: ['#   ', '#   ', '#   ', '#   ', '####'], A: [' ## ', '#  #', '####', '#  #', '#  #'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '], O: ['####', '#  #', '#  #', '#  #', '####'],
  R: ['### ', '#  #', '### ', '# # ', '#  #'],
};
const INVADER = ['  #     #  ', '   #   #   ', '  #######  ', ' ## ### ## ', '###########', '# ####### #', '# #     # #', '   ## ##   '];

function banner() {
  const word = 'PIXELATOR';
  const rows = ['', '', '', '', ''];
  for (const ch of word) GLYPHS[ch].forEach((r, i) => (rows[i] += r.replace(/#/g, '█').replace(/ /g, ' ') + '  '));
  const w = rows[0].length;
  const grad = (x) => { const t = x / w; return [Math.round(255 - 160 * t), Math.round(95 + 145 * t), Math.round(162 + 46 * t)]; };
  const paint = (line) => [...line].map((c, x) => (c === ' ' ? ' ' : C(...grad(x), c))).join('');
  const inv = INVADER.map((r) => C(95, 240, 208, r.replace(/#/g, '██').replace(/ /g, '  ')));
  console.log('');
  inv.forEach((l) => console.log('  ' + l));
  console.log('');
  rows.forEach((r) => console.log('  ' + paint(r)));
  console.log('\n  ' + dim('Turn any photo or video into pixel art.  ') + C(255, 211, 95, '▀▄▀▄▀▄') + '\n');
}

// ---------- prompts ----------
function ask(q, def) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${C(95, 240, 208, '?')} ${q}${def != null ? dim(` (${def})`) : ''} `, (a) => { rl.close(); res(a.trim() || (def != null ? String(def) : '')); });
  });
}

function select(title, options, start = 0) {
  return new Promise((resolve) => {
    let i = start;
    const draw = (first) => {
      if (!first) process.stdout.write(`\x1b[${options.length}A`);
      options.forEach((o, n) => process.stdout.write(`\x1b[2K   ${n === i ? C(255, 95, 162, '❯ ' + o.label) : '  ' + dim(o.label)}\n`));
    };
    console.log(`  ${C(95, 240, 208, '?')} ${title} ${dim('(↑/↓ then Enter)')}`);
    if (!process.stdin.isTTY) { console.log('   (non-interactive: using first option)'); return resolve(options[start]); }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdout.write('\x1b[?25l');
    draw(true);
    const onKey = (_, k) => {
      if (!k) return;
      if (k.ctrl && k.name === 'c') { process.stdout.write('\x1b[?25h\n'); process.exit(130); }
      if (k.name === 'up') i = (i + options.length - 1) % options.length;
      else if (k.name === 'down') i = (i + 1) % options.length;
      else if (k.name === 'return') {
        process.stdin.removeListener('keypress', onKey);
        process.stdin.setRawMode(false); process.stdin.pause();
        process.stdout.write('\x1b[?25h');
        return resolve(options[i]);
      }
      draw(false);
    };
    process.stdin.on('keypress', onKey);
  });
}

// ---------- ffmpeg pipeline ----------
// Builds: downscale to the pixel grid -> look effects -> color reduction -> nearest-neighbour upscale -> CRT post.
// The look effects are ffmpeg approximations of what the web app does per pixel.
function buildGraph({ crop, W, H, OW, OH, palKey, dither, look, strength, palFile }) {
  const segs = [];
  let cur = '0:v', n = 0;
  const add = (f) => { const o = `t${n++}`; segs.push(`[${cur}]${f}[${o}]`); cur = o; };
  const s = strength;
  const fx = (look && look.fx) || {};
  const q = (v) => Math.round(v * 1000) / 1000;

  if (crop) add(`crop=w=${crop.w}:h=${crop.h}:x=${crop.x}:y=${crop.y}`);
  add(`scale=w=${W}:h=${H}:flags=area`);
  if (fx.soften) add(`gblur=sigma=${q(0.5 + 0.3 * s)}:steps=1`);
  if (fx.chroma) add(`format=yuv444p,gblur=sigma=${q(fx.chroma.radius * 0.5 * s + 0.01)}:planes=6,chromashift=crh=${Math.round(fx.chroma.shift * s)}:cbh=${Math.round(fx.chroma.shift * s)}`);
  add('format=rgb24');
  if (fx.grade) {
    const g = fx.grade, mix = (v) => q(1 + ((v ?? 1) - 1) * s);
    add(`eq=contrast=${mix(g.contrast)}:saturation=${mix(g.saturation)}:brightness=${q((g.brightness || 0) * s)}`);
    if (g.tint) add(`colorchannelmixer=rr=${mix(g.tint[0])}:gg=${mix(g.tint[1])}:bb=${mix(g.tint[2])}`);
    if (g.blackLift) { const l = q(g.blackLift * s); add(`lutrgb=r='val*${q((255 - l) / 255)}+${l}':g='val*${q((255 - l) / 255)}+${l}':b='val*${q((255 - l) / 255)}+${l}'`); }
  }
  if (fx.bloom) { // ffmpeg has no threshold-blur, so this is a soft glow (screen-blended blur)
    const a = q(Math.min(1, fx.bloom.amount * s * 1.6));
    segs.push(`[${cur}]split[bA${n}][bB${n}]`);
    segs.push(`[bB${n}]gblur=sigma=${Math.max(2, Math.round(W / 60))}:steps=2[bC${n}]`);
    segs.push(`[bA${n}][bC${n}]blend=all_mode=screen:all_opacity=${a}[t${n}]`);
    cur = `t${n++}`;
  }
  if (fx.noise) add(`noise=alls=${Math.round(fx.noise * 190 * s)}:allf=t`);

  // Color reduction
  const pal = PALETTES[palKey];
  const d = dither ? 'dither=bayer:bayer_scale=3' : 'dither=none';
  const extra = [];
  const colors = paletteColors(pal);
  if (pal.auto) {
    segs.push(`[${cur}]split[pa${n}][pb${n}]`);
    segs.push(`[pa${n}]palettegen=max_colors=${pal.auto}:stats_mode=single[pl${n}]`);
    segs.push(`[pb${n}][pl${n}]paletteuse=${d}:new=1[t${n}]`);
    cur = `t${n++}`; add('format=rgb24');
  } else if (colors) {
    extra.push('-i', palFile);
    segs.push(`[${cur}][1:v]paletteuse=${d}[t${n}]`);
    cur = `t${n++}`; add('format=rgb24');
  } else if (pal.levels != null) { // e.g. 15-bit: 32 levels per channel, with a little static noise standing in for the dither
    const lv = Array.isArray(pal.levels) ? pal.levels : [pal.levels, pal.levels, pal.levels];
    if (dither && lv[0] < 256) add(`noise=alls=${Math.round(255 / lv[0])}:allf=u`);
    const ch = (c, k) => (lv[k] >= 256 ? 'val' : `round(val*${lv[k] - 1}/255)*255/${lv[k] - 1}`);
    add(`lutrgb=r='${ch('r', 0)}':g='${ch('g', 1)}':b='${ch('b', 2)}'`);
  }

  // Upscale back to the original size with hard edges, then CRT post effects at output resolution.
  add(`scale=w=${OW}:h=${OH}:flags=neighbor`);
  const cell = OH / H;
  if (fx.scan && cell >= 2) {
    const th = Math.max(1, Math.round(cell * 0.4));
    add(`drawgrid=y=${Math.round(cell - th)}:w=0:h=${q(cell)}:t=${th}:c=black@${q(fx.scan * s)}`);
  }
  if (fx.vignette) add(`vignette=angle=${q(0.55 * s + 0.05)}`);
  add('crop=w=trunc(iw/2)*2:h=trunc(ih/2)*2');
  segs[segs.length - 1] = segs[segs.length - 1].replace(/\[t\d+\]$/, '[out]');
  return { complex: segs.join(';'), extra };
}

// ffmpeg cannot open some photo formats (HEIC/HEIF from iPhones, sometimes AVIF). For those we
// convert to PNG with a tool the system already has, then carry on with the PNG.
function convertWithSystemTool(input) {
  const base = path.join(os.tmpdir(), `pixelator-conv-${process.pid}-${Date.now()}`);
  const tries = [];
  if (process.platform === 'darwin') tries.push({ cmd: 'sips', out: base + '.png', args: ['-s', 'format', 'png', input, '--out', base + '.png'] });
  tries.push({ cmd: 'magick', out: base + '.png', args: [input + '[0]', base + '.png'] });
  tries.push({ cmd: 'heif-convert', out: base + '.jpg', args: [input, base + '.jpg'] });
  tries.push({ cmd: 'convert', out: base + '.png', args: [input + '[0]', base + '.png'] });
  for (const t of tries) {
    const r = spawnSync(t.cmd, t.args, { stdio: 'ignore', timeout: 120000 });
    if (!r.error && r.status === 0 && fs.existsSync(t.out) && fs.statSync(t.out).size > 0) return t.out;
    fs.rmSync(t.out, { force: true });
  }
  return null;
}

// --crop 16:9 (largest centered box of that shape) or --crop x,y,w,h (pixels).
function parseCrop(str, W, H) {
  let m;
  if ((m = /^(\d+):(\d+)$/.exec(str))) {
    const a = +m[1], b = +m[2];
    if (!a || !b) throw new Error(`Bad crop shape "${str}".`);
    let w = W, h = Math.round((W * b) / a);
    if (h > H) { h = H; w = Math.round((H * a) / b); }
    return { w, h, x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2) };
  }
  if ((m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(str))) {
    const [x, y, w, h] = m.slice(1).map(Number);
    if (w < 2 || h < 2 || x + w > W || y + h > H) throw new Error(`Crop ${str} does not fit inside the ${W}x${H} picture.`);
    return { x, y, w, h };
  }
  throw new Error(`Bad crop "${str}". Use a shape like 1:1 or 16:9 (centered), or x,y,w,h in pixels.`);
}

// Video size as ffmpeg will hand it to the filters (honours rotation metadata).
function probeSize(file) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let e = '';
    p.stderr.on('data', (b) => (e += b));
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const m = /Stream #\d+:\d+[^\n]*Video:[^\n]*?[, ](\d{2,5})x(\d{2,5})/.exec(e);
      if (!m) return resolve(null);
      let w = +m[1], h = +m[2];
      const r = /rotation of (-?\d+)/.exec(e);
      if (r && Math.abs(+r[1]) % 180 === 90) [w, h] = [h, w];
      resolve([w, h]);
    });
  });
}

function writePalette(colors) {
  const f = path.join(os.tmpdir(), `pixelator-pal-${process.pid}-${Date.now()}.ppm`);
  const padded = Array.from({ length: 256 }, (_, i) => colors[Math.min(i, colors.length - 1)]); // paletteuse wants 16x16
  fs.writeFileSync(f, Buffer.concat([Buffer.from('P6\n16 16\n255\n'), Buffer.from(padded.flat())]));
  return f;
}

const secs = (h, m, s) => +h * 3600 + +m * 60 + +s;

function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let dur = 0, err = '';
    p.stderr.on('data', (b) => {
      const s = b.toString(); err = (err + s).slice(-4000);
      const d = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(s); if (d) dur = secs(d[1], d[2], d[3]);
      const t = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(s);
      if (t && dur) onProgress(Math.min(1, secs(t[1], t[2], t[3]) / dur));
    });
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'ffmpeg not found. Run "npm install" in the cli folder or install ffmpeg.' : e.message)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed:\n' + err.split('\n').slice(-8).join('\n')))));
  });
}

async function pixelate(input, opts) {
  const kind = kindOf(input) || 'video';
  const ext = kind === 'image' ? '.png' : kind === 'anim' ? '.gif' : '.mp4';
  const dir = opts.outDir || path.dirname(input);
  fs.mkdirSync(dir, { recursive: true });
  let out = path.join(dir, path.basename(input, path.extname(input)) + '_pixel' + ext);
  for (let n = 2; fs.existsSync(out); n++) out = path.join(dir, `${path.basename(input, path.extname(input))}_pixel${n}${ext}`);

  let source = input, converted = null;
  let dims = await probeSize(source);
  if (!dims) { // ffmpeg can't open it: try converting with a system tool (sips, ImageMagick, heif-convert)
    converted = convertWithSystemTool(input);
    if (converted) { source = converted; dims = await probeSize(source); }
  }
  if (!dims) {
    const heic = /\.(heic|heif|avif)$/i.test(input);
    throw new Error(heic
      ? "Couldn't open this HEIC/HEIF/AVIF photo. On macOS this works out of the box; on Windows/Linux install ImageMagick (magick) or libheif (heif-convert), or export the photo as JPG first."
      : "Couldn't read the picture size. Is this an image or video file?");
  }
  let [OW, OH] = dims;
  const crop = opts.crop ? parseCrop(opts.crop, OW, OH) : null;
  if (crop) { OW = crop.w; OH = crop.h; }
  const look = opts.look && opts.look !== 'none' ? LOOKS[opts.look] : null;
  const palKey = look ? look.palette : opts.palette;
  const dither = look ? look.dither > 0 : opts.dither;
  let W, H;
  if (look && look.grid) { const k = Math.min(1, look.grid / Math.max(OW, OH)); W = Math.max(1, Math.round(OW * k)); H = Math.max(1, Math.round(OH * k)); }
  else { W = Math.max(1, Math.ceil(OW / opts.size)); H = Math.max(1, Math.ceil(OH / opts.size)); }
  const colors = paletteColors(PALETTES[palKey]);
  const palFile = colors ? writePalette(colors) : null;
  const { complex, extra } = buildGraph({ crop, W, H, OW, OH, palKey, dither, look, strength: (opts.strength ?? 100) / 100, palFile });
  const args = ['-hide_banner', '-y', '-i', source, ...extra, '-filter_complex', complex, '-map', '[out]'];
  if (kind === 'image') args.push('-frames:v', '1', '-update', '1');
  else if (kind === 'video') args.push('-map', '0:a?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium', '-c:a', 'aac', '-movflags', '+faststart');
  args.push(out);

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let f = 0, pct = 0;
  const tty = process.stdout.isTTY;
  const timer = tty ? setInterval(() => {
    const filled = Math.round(pct * 24);
    process.stdout.write(`\r  ${C(255, 211, 95, frames[f++ % 10])} Pixelating ${path.basename(input)} ${C(95, 240, 208, '█'.repeat(filled))}${dim('░'.repeat(24 - filled))} ${Math.round(pct * 100)}%  `);
  }, 90) : null;
  try { await runFfmpeg(args, (v) => (pct = v)); }
  finally { if (timer) clearInterval(timer); if (tty) process.stdout.write('\r\x1b[2K'); if (palFile) fs.rmSync(palFile, { force: true }); if (converted) fs.rmSync(converted, { force: true }); }
  return out;
}

// ---------- terminal preview ----------
function preview(file) {
  return new Promise((resolve) => {
    const W = Math.max(20, Math.min((process.stdout.columns || 80) - 6, 72));
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${W}:-2:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const bufs = [];
    p.stdout.on('data', (b) => bufs.push(b));
    p.on('error', () => resolve());
    p.on('close', () => {
      const buf = Buffer.concat(bufs);
      const H = Math.floor(buf.length / (W * 3));
      if (H < 2) return resolve();
      const px = (x, y) => { const i = (y * W + x) * 3; return `${buf[i]};${buf[i + 1]};${buf[i + 2]}`; };
      const lines = [];
      for (let y = 0; y + 1 < H; y += 2) {
        let line = '  ';
        for (let x = 0; x < W; x++) line += `\x1b[38;2;${px(x, y)}m\x1b[48;2;${px(x, y + 1)}m▀`;
        lines.push(line + '\x1b[0m');
      }
      console.log(lines.join('\n'));
      resolve();
    });
  });
}

// ---------- input handling ----------
function cleanPath(s) {
  s = s.trim().replace(/^['"]|['"]$/g, '').replace(/\\(.)/g, '$1'); // drag & drop quoting/escapes
  if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
  return path.resolve(s);
}
function splitPaths(s) { // several dropped files arrive as space-separated, quoted or backslash-escaped
  const out = []; const re = /"([^"]+)"|'([^']+)'|((?:\\ |[^\s])+)/g; let m;
  while ((m = re.exec(s))) out.push(m[1] || m[2] || m[3]);
  return out;
}
function expand(p) {
  const abs = cleanPath(p);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).filter((f) => !f.startsWith('.') && kindOf(f)).sort().map((f) => path.join(abs, f));
  return [abs];
}

function parseArgs(argv) {
  const o = { files: [], size: null, palette: null, dither: null, look: null, strength: null, crop: null, outDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-s' || a === '--size') o.size = parseInt(argv[++i], 10);
    else if (a === '-p' || a === '--palette') o.palette = argv[++i];
    else if (a === '-d' || a === '--dither') o.dither = argv[++i] !== 'none';
    else if (a === '-l' || a === '--look') o.look = argv[++i];
    else if (a === '--crop') o.crop = argv[++i];
    else if (a === '--strength') o.strength = Math.max(0, Math.min(100, parseInt(argv[++i], 10)));
    else if (a === '-o' || a === '--out') o.outDir = path.resolve(argv[++i]);
    else o.files.push(a);
  }
  return o;
}

const HELP = `
Usage: pixelator [files or folders...] [options]
  No files  -> interactive mode
  -s, --size <px>       pixel block size (default 8)
  -p, --palette <name>  ${Object.keys(PALETTES).join(' | ')}
  -d, --dither <mode>   bayer | none   (default bayer)
  -l, --look <name>     ${Object.keys(LOOKS).filter((k) => k !== 'none').join(' | ')}
                        (a look sets the resolution, palette and effects; -s/-p/-d are ignored)
      --strength <0-100>  how strong the look's effects are (default 100)
      --crop <shape|x,y,w,h>  crop first: 1:1 or 16:9 (centered), or x,y,w,h in pixels
  -o, --out <dir>       output folder (default: next to the original)
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.look && !LOOKS[args.look]) { console.error(`Unknown look "${args.look}".${HELP}`); process.exit(2); }
  if (args.palette && !PALETTES[args.palette]) { console.error(`Unknown palette "${args.palette}".${HELP}`); process.exit(2); }

  // Non-interactive
  if (args.files.length) {
    const files = args.files.flatMap(expand);
    if (!files.length) { console.error('No media files found.'); process.exit(1); }
    let failed = 0;
    for (const f of files) {
      try { console.log('✔', await pixelate(f, { size: args.size || 8, palette: args.palette || 'original', dither: args.dither ?? true, look: args.look, strength: args.strength ?? 100, crop: args.crop, outDir: args.outDir })); }
      catch (e) { failed++; console.error('✖', f, '-', e.message); }
    }
    process.exit(failed ? 1 : 0);
  }

  banner();
  for (;;) {
    const raw = await ask('Drag a photo/video/folder here (or type a path, "q" to quit):');
    if (!raw || /^q(uit)?$/i.test(raw)) break;
    const files = splitPaths(raw).flatMap(expand);
    if (!files.length) { console.log(C(255, 95, 95, '  ✖ Nothing found at that path.\n')); continue; }
    console.log(dim(`  Found ${files.length} file${files.length > 1 ? 's' : ''}.\n`));

    const lookOpts = [{ label: 'Custom - I will pick the pixel size and palette', v: 'none' },
      ...Object.entries(LOOKS).filter(([k]) => k !== 'none').map(([k, l]) => ({ label: `${l.group.padEnd(11)} ${l.name}`, v: k }))];
    const lookKey = (await select('Choose a look', lookOpts)).v;
    console.log('');
    let size = 8, palKey = 'original', dither = true;
    if (lookKey === 'none') {
      const sz = await select('How chunky should the pixels be?', [
        { label: 'Huge   (32 px blocks)', v: 32 }, { label: 'Chunky (16 px blocks)', v: 16 },
        { label: 'Medium (8 px blocks)', v: 8 }, { label: 'Fine   (4 px blocks)', v: 4 }, { label: 'Custom...', v: 0 },
      ], 2);
      size = sz.v;
      if (!size) size = Math.max(2, parseInt(await ask('Block size in pixels?', 8), 10) || 8);
      console.log('');
      palKey = (await select('Pick a palette', Object.entries(PALETTES).map(([k, p]) => ({ label: p.label, v: k })))).v;
      console.log('');
      dither = (await select('Dithering?', [{ label: 'Bayer dither (retro texture)', v: true }, { label: 'None (flat colors)', v: false }])).v;
      console.log('');
    }

    const cropStr = await ask('Crop? (Enter to skip; a shape like 1:1 or 16:9 is centered, or give x,y,w,h in pixels)');
    console.log('');

    for (const f of files) {
      try {
        const out = await pixelate(f, { size, palette: palKey, dither, look: lookKey, strength: 100, crop: cropStr || null });
        console.log(`  ${C(95, 240, 208, '✔')} ${bold(path.basename(out))}  ${dim(path.dirname(out))}\n`);
        await preview(out);
        console.log('');
      } catch (e) { console.log(C(255, 95, 95, `  ✖ ${path.basename(f)}: ${e.message}\n`)); }
    }
    const again = await ask('Pixelate another? (y/n)', 'y');
    if (!/^y/i.test(again)) break;
    console.log('');
  }
  console.log(dim('\n  Stay pixelated. ') + C(255, 95, 162, '♥') + '\n');
}

main().catch((e) => { process.stdout.write('\x1b[?25h'); console.error(e); process.exit(1); });
