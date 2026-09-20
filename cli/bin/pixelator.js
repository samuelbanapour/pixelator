#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

// ---------- ffmpeg ----------
function findFfmpeg() {
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (e) { /* fall through */ }
  return 'ffmpeg'; // system ffmpeg
}
const FFMPEG = findFfmpeg();

// ---------- palettes ----------
const hex = (l) => l.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const PALETTES = {
  original: { label: 'Original colors (just pixelate)', colors: null },
  auto8: { label: 'Auto - 8 colors', auto: 8 },
  auto16: { label: 'Auto - 16 colors', auto: 16 },
  auto32: { label: 'Auto - 32 colors', auto: 32 },
  gameboy: { label: 'Game Boy', colors: hex(['#0f380f', '#306230', '#8bac0f', '#9bbc0f']) },
  pico8: { label: 'PICO-8', colors: hex(['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa']) },
  c64: { label: 'Commodore 64', colors: hex(['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77', '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb']) },
  cga: { label: 'CGA', colors: hex(['#000000', '#55ffff', '#ff55ff', '#ffffff']) },
  mono: { label: 'Black & white', colors: hex(['#000000', '#ffffff']) },
  sunset: { label: 'Sunset', colors: hex(['#1a1423', '#372549', '#774c60', '#b75d69', '#eacdc2', '#ffb400']) },
};

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
function buildFilter(N, palKey, dither, palFile) {
  const down = `scale=w=ceil(iw/${N}):h=ceil(ih/${N}):flags=area`;
  const up = `scale=w=iw*${N}:h=ih*${N}:flags=neighbor,crop=w=trunc(iw/2)*2:h=trunc(ih/2)*2`;
  const d = dither ? 'dither=bayer:bayer_scale=3' : 'dither=none';
  const p = PALETTES[palKey];
  if (p.auto) return { complex: `[0:v]${down},split[a][b];[a]palettegen=max_colors=${p.auto}:stats_mode=single[pal];[b][pal]paletteuse=${d}:new=1,format=rgb24,${up}[out]`, extra: [] };
  if (p.colors) return { complex: `[0:v]${down},format=rgb24[s];[s][1:v]paletteuse=${d},format=rgb24,${up}[out]`, extra: ['-i', palFile] };
  return { complex: `[0:v]${down},format=rgb24,${up}[out]`, extra: [] };
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

  const p = PALETTES[opts.palette];
  const palFile = p.colors ? writePalette(p.colors) : null;
  const { complex, extra } = buildFilter(opts.size, opts.palette, opts.dither, palFile);
  const args = ['-hide_banner', '-y', '-i', input, ...extra, '-filter_complex', complex, '-map', '[out]'];
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
  finally { if (timer) clearInterval(timer); if (tty) process.stdout.write('\r\x1b[2K'); if (palFile) fs.rmSync(palFile, { force: true }); }
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
  const o = { files: [], size: null, palette: null, dither: null, outDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-s' || a === '--size') o.size = parseInt(argv[++i], 10);
    else if (a === '-p' || a === '--palette') o.palette = argv[++i];
    else if (a === '-d' || a === '--dither') o.dither = argv[++i] !== 'none';
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
  -o, --out <dir>       output folder (default: next to the original)
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.palette && !PALETTES[args.palette]) { console.error(`Unknown palette "${args.palette}".${HELP}`); process.exit(2); }

  // Non-interactive
  if (args.files.length) {
    const files = args.files.flatMap(expand);
    if (!files.length) { console.error('No media files found.'); process.exit(1); }
    let failed = 0;
    for (const f of files) {
      try { console.log('✔', await pixelate(f, { size: args.size || 8, palette: args.palette || 'original', dither: args.dither ?? true, outDir: args.outDir })); }
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

    const sz = await select('How chunky should the pixels be?', [
      { label: 'Huge   (32 px blocks)', v: 32 }, { label: 'Chunky (16 px blocks)', v: 16 },
      { label: 'Medium (8 px blocks)', v: 8 }, { label: 'Fine   (4 px blocks)', v: 4 }, { label: 'Custom...', v: 0 },
    ], 2);
    let size = sz.v;
    if (!size) size = Math.max(2, parseInt(await ask('Block size in pixels?', 8), 10) || 8);
    console.log('');
    const palKey = (await select('Pick a palette', Object.entries(PALETTES).map(([k, p]) => ({ label: p.label, v: k })))).v;
    console.log('');
    const dither = (await select('Dithering?', [{ label: 'Bayer dither (retro texture)', v: true }, { label: 'None (flat colors)', v: false }])).v;
    console.log('');

    for (const f of files) {
      try {
        const out = await pixelate(f, { size, palette: palKey, dither });
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
