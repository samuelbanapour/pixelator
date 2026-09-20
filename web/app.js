(() => {
  const $ = (s) => document.querySelector(s);
  const { PALETTES, LOOKS, quantize, applyFx, smallSize, blockFor, rng } = Pixelate;
  const PREVIEW_MAX = 2400;
  const EXPORT_MAX_VIDEO = 1920;

  const el = {
    stage: $('#stage'), drop: $('#drop'), view: $('#view'), file: $('#file'), files: $('#files'),
    look: $('#look'), strength: $('#strength'), strengthOut: $('#strengthOut'), strengthRow: $('#strengthRow'),
    osd: $('#osd'), osdRow: $('#osdRow'),
    size: $('#size'), sizeOut: $('#sizeOut'), palette: $('#palette'), swatches: $('#swatches'),
    levels: $('#levels'), levelsOut: $('#levelsOut'), levelsRow: $('#levelsRow'),
    dither: $('#dither'), ditherOut: $('#ditherOut'), save: $('#save'), saveAll: $('#saveAll'),
    progress: $('#progress'), bar: $('#bar'), ptext: $('#ptext'), toast: $('#toast'),
  };

  const items = [];
  let sel = -1;
  let dirty = true;
  let exporting = false;
  const small = document.createElement('canvas');

  // ---------- settings ----------
  for (const [key, p] of Object.entries(PALETTES)) el.palette.add(new Option(p.name, key));
  {
    const groups = {};
    for (const [key, l] of Object.entries(LOOKS)) {
      const parent = l.group ? (groups[l.group] ||= el.look.appendChild(Object.assign(document.createElement('optgroup'), { label: l.group }))) : el.look;
      parent.appendChild(new Option(l.name, key));
    }
  }
  let manualSize = false; // true once the user drags Pixel size, overriding the look's resolution
  let tick = 0; // frame counter: varies tape noise from frame to frame

  // Everything render() needs. `it` (the selected item) turns a look's resolution into a block size.
  const opts = (it, extra = {}) => {
    const look = LOOKS[el.look.value], pal = PALETTES[el.palette.value];
    let size = +el.size.value;
    if (look.grid && !manualSize && it) size = blockFor(look.grid, it.w, it.h);
    return {
      size, palette: pal.colors, levels: pal.levels ?? +el.levels.value, dither: +el.dither.value / 100,
      fx: look.fx || null, strength: +el.strength.value / 100, osd: el.osd.checked, t: 0, time: 0, ...extra,
    };
  };

  function applyLook() { // copy the look's palette + dither into the controls
    const look = LOOKS[el.look.value];
    manualSize = false;
    if (look.palette) el.palette.value = look.palette;
    if (look.dither != null) el.dither.value = Math.round(look.dither * 100);
    syncUI();
  }

  function syncUI() {
    const it = items[sel], look = LOOKS[el.look.value], pal = PALETTES[el.palette.value];
    const o = opts(it);
    if (look.grid && !manualSize) el.size.value = Math.min(+el.size.max, Math.max(1, Math.round(o.size)));
    let label = (Math.round(o.size * 10) / 10) + ' px';
    if (it) { const [gw, gh] = smallSize(it.w, it.h, o.size); label += ` · ${gw}×${gh}`; }
    el.sizeOut.textContent = label;
    el.levelsOut.textContent = el.levels.value;
    el.ditherOut.textContent = el.dither.value + '%';
    el.strengthOut.textContent = el.strength.value + '%';
    el.strengthRow.hidden = !look.fx || !Object.keys(look.fx).length;
    el.osdRow.hidden = !(look.fx && look.fx.osd);
    el.levelsRow.hidden = !!pal.colors || pal.levels != null;
    el.swatches.replaceChildren(...(pal.colors || []).map((c) => Object.assign(document.createElement('i'), { style: `background:rgb(${c})` })));
    dirty = true;
  }
  el.look.addEventListener('input', applyLook);
  el.size.addEventListener('input', () => { manualSize = true; syncUI(); });
  for (const k of ['palette', 'levels', 'dither', 'strength', 'osd']) el[k].addEventListener('input', syncUI);
  syncUI();

  // ---------- rendering ----------
  // Draws `src` (w x h) as pixel art into `out` at scale f (1 = full size).
  function render(src, w, h, out, f, o) {
    const ow = Math.max(1, Math.round(w * f)), oh = Math.max(1, Math.round(h * f));
    const block = Math.max(1, o.size * f);
    const [sw, sh] = smallSize(ow, oh, block);
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = src.tagName === 'VIDEO' ? 'medium' : 'high'; // 'high' costs ~2x per frame
    sctx.drawImage(src, 0, 0, sw, sh);
    const img = sctx.getImageData(0, 0, sw, sh);
    applyFx(img.data, sw, sh, o.fx, o.strength, o.t);
    quantize(img.data, sw, sh, o);
    sctx.putImageData(img, 0, 0);
    if (out.width !== ow || out.height !== oh) { out.width = ow; out.height = oh; }
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(small, 0, 0, sw, sh, 0, 0, sw * block, sh * block);
    if (o.fx) post(octx, out.width, out.height, block, o);
  }

  // Effects that only make sense at output resolution: scanlines, vignette, tape glitches, OSD text.
  function post(ctx, W, H, block, o) {
    const fx = o.fx, s = o.strength;
    if (!(s > 0)) return;
    if (fx.scan && block >= 2) {
      const th = Math.max(1, Math.round(block * 0.4));
      ctx.fillStyle = `rgba(0,0,0,${fx.scan * s})`;
      for (let y = 0; y < H; y += block) ctx.fillRect(0, Math.round(y + block - th), W, th);
    }
    if (fx.vignette) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${fx.vignette * s})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (fx.tracking) {
      const rand = rng(o.t + 7);
      const bands = [{ y: H * 0.93, h: H * 0.05, amp: 5 }];
      if (o.t % 120 < 8) bands.push({ y: H * (0.2 + 0.5 * rand()), h: H * 0.03, amp: 3 }); // now and then, a glitch mid-frame
      for (const b of bands) {
        const y = Math.floor(b.y), bh = Math.max(2, Math.floor(b.h)), dx = Math.round((rand() - 0.3) * b.amp * block * s);
        ctx.drawImage(ctx.canvas, 0, y, W, bh, dx, y, W, bh);
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.5 * rand()})`;
          ctx.fillRect(rand() * W, y + rand() * bh, block * (2 + rand() * 10), Math.max(1, block * 0.5));
        }
      }
    }
    if (fx.osd && o.osd) {
      const sz = Math.round(Math.max(12, H * 0.06)), m = Math.round(sz * 0.9);
      ctx.save();
      ctx.font = `bold ${sz}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = 'top';
      const glow = Math.max(1, Math.round(sz * 0.07)); // a bluish offset copy under the text (shadowBlur is far too slow on old devices)
      const drawAll = (dx, fill) => {
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.moveTo(m + dx, m); ctx.lineTo(m + dx, m + sz * 0.8); ctx.lineTo(m + dx + sz * 0.7, m + sz * 0.4); ctx.closePath(); ctx.fill();
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('PLAY', m + sz * 0.95 + dx, m);
        const secs = Math.floor(o.time || 0), tc = `SP ${Math.floor(secs / 3600)}:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
        ctx.textAlign = 'right'; ctx.fillText(tc, W - m + dx, m);
        const d = new Date(), mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${mon}. ${String(d.getDate()).padStart(2, ' ')} ${d.getFullYear()}`, m + dx, H - m);
      };
      drawAll(glow, 'rgba(90,120,255,.85)');
      drawAll(0, '#f4f4f4');
      ctx.restore();
    }
  }

  function frame() {
    const it = items[sel];
    if (it && !exporting && (dirty || (it.kind === 'video' && !it.el.paused))) {
      // Render at (about) the size it is displayed, so the browser never has to resize the canvas again.
      const dpr = window.devicePixelRatio || 1;
      const target = Math.min(PREVIEW_MAX, Math.max(320, el.stage.clientWidth * dpr));
      const f = Math.min(1, target / Math.max(it.w, it.h));
      const playing = it.kind === 'video' && !it.el.paused;
      if (playing) tick++;
      try { render(it.el, it.w, it.h, el.view, f, opts(it, { t: tick, time: it.kind === 'video' ? it.el.currentTime : 0 })); } catch (e) { /* frame not ready yet */ }
      // Hard pixel edges only when the canvas is enlarged; smooth when it is shrunk to fit.
      const shown = el.view.getBoundingClientRect().width * dpr;
      el.view.style.imageRendering = el.view.width > shown * 1.01 ? 'auto' : 'pixelated';
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- loading files ----------
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.toast.classList.remove('show'), 3500);
  }

  // HEIC/HEIF (iPhone photos) is not decodable by Chrome/Edge/Electron/Android WebView. Convert with a
  // bundled decoder, loaded on first use. Browsers that can decode it natively never get here.
  let heicLib;
  function loadHeicLib() {
    return (heicLib ||= new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/heic2any.min.js';
      sc.onload = () => res(window.heic2any);
      sc.onerror = () => { heicLib = null; rej(new Error('Could not load the HEIC decoder.')); };
      document.head.appendChild(sc);
    }));
  }
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blobToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  async function heicToJpeg(file) {
    toast('Converting ' + file.name + '…');
    const jpgName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    // Android app: use the platform decoder (fast and correct; the JS decoder returns garbage on old WebViews).
    const nat = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.HeicConverter;
    if (nat) {
      try {
        const r = await nat.toJpeg({ data: await blobToB64(file) });
        return new File([b64ToBytes(r.data)], jpgName, { type: 'image/jpeg' });
      } catch (e) { /* older Android without HEIC support: fall back to the JS decoder */ }
    }
    let out = await (await loadHeicLib())({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    if (Array.isArray(out)) out = out[0]; // multi-image HEIC: first frame
    return new File([out], jpgName, { type: 'image/jpeg' });
  }

  function load(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i.test(file.name);
      const isHeic = /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/.test(file.type);
      if (isVideo) {
        const v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        v.onloadeddata = () => { v.play().catch(() => {}); resolve({ file, url, kind: 'video', el: v, w: v.videoWidth, h: v.videoHeight }); };
        v.onerror = () => reject(new Error("Can't decode " + file.name));
      } else {
        const im = new Image();
        im.onload = () => resolve({ file, url, kind: 'image', el: im, w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = async () => {
          URL.revokeObjectURL(url);
          if (!isHeic) return reject(new Error("Can't decode " + file.name + ' (format not supported by this browser)'));
          try { const it = await load(await heicToJpeg(file)); it.file = file; resolve(it); } // keep the original name for the chip and the saved file
          catch (e) { reject(new Error("Can't open " + file.name + ': ' + (e.message || 'HEIC conversion failed'))); }
        };
        im.src = url;
      }
    });
  }

  async function addFiles(list) {
    for (const f of list) {
      try { items.push(await load(f)); } catch (e) { toast(e.message); }
    }
    if (sel < 0 && items.length) select(0, true);
    else renderChips();
  }

  function select(i, autoSize) {
    if (items[sel]?.kind === 'video') items[sel].el.pause();
    sel = i;
    const it = items[i];
    if (it.kind === 'video') it.el.play().catch(() => {});
    if (autoSize) {
      const max = Math.max(4, Math.round(Math.max(it.w, it.h) / 8));
      el.size.max = max;
      if (!LOOKS[el.look.value].grid) el.size.value = Math.max(2, Math.min(max, Math.round(Math.max(it.w, it.h) / 80)));
      syncUI();
    }
    el.drop.hidden = true; el.view.hidden = false; el.stage.classList.add('has');
    el.save.disabled = el.saveAll.disabled = false;
    dirty = true;
    renderChips();
  }

  function removeItem(i) {
    if (exporting) return toast('Wait for the export to finish first.');
    const it = items[i];
    if (it.kind === 'video') { it.el.pause(); it.el.removeAttribute('src'); it.el.load(); }
    if (it.audio) it.audio.ac.close().catch(() => {});
    URL.revokeObjectURL(it.url);
    items.splice(i, 1);
    if (!items.length) {
      sel = -1;
      el.view.hidden = true; el.drop.hidden = false; el.stage.classList.remove('has');
      el.save.disabled = el.saveAll.disabled = true;
      renderChips();
    } else if (i === sel) {
      sel = -1; // the removed item is already paused/released
      select(Math.min(i, items.length - 1), true);
    } else {
      if (i < sel) sel--;
      renderChips();
    }
  }

  function renderChips() {
    el.files.replaceChildren(...items.map((it, i) => {
      const c = document.createElement('div');
      c.className = 'chip' + (i === sel ? ' sel' : '');
      c.innerHTML = '<b>' + (it.kind === 'video' ? '▶' : '▣') + '</b><span></span><button class="x" type="button">×</button>';
      c.querySelector('span').textContent = it.file.name;
      const x = c.querySelector('.x');
      x.setAttribute('aria-label', 'Remove ' + it.file.name);
      x.title = 'Remove';
      x.onclick = (e) => { e.stopPropagation(); removeItem(i); };
      c.onclick = () => select(i, true);
      return c;
    }));
  }

  el.file.addEventListener('change', () => { addFiles([...el.file.files]); el.file.value = ''; });
  for (const ev of ['dragenter', 'dragover']) el.stage.addEventListener(ev, (e) => { e.preventDefault(); el.stage.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) el.stage.addEventListener(ev, (e) => { e.preventDefault(); el.stage.classList.remove('over'); });
  el.stage.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (!el.stage.contains(e.target)) addFiles([...e.dataTransfer.files]); });
  el.stage.addEventListener('click', (e) => { if (el.view.hidden && !e.target.closest('label')) el.file.click(); });

  // ---------- saving ----------
  const baseName = (n) => n.replace(/\.[^.]+$/, '') + '_pixel';

  async function saveBlob(blob, name) {
    const cap = window.Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.Filesystem && cap.Plugins?.Share) {
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
      const { uri } = await cap.Plugins.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
      await cap.Plugins.Share.share({ title: name, url: uri });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function setProgress(p, text) {
    el.progress.hidden = p == null;
    if (p != null) { el.bar.style.width = (p * 100) + '%'; el.ptext.textContent = text; }
  }

  async function exportImage(it, o) {
    const c = document.createElement('canvas');
    render(it.el, it.w, it.h, c, 1, o);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await saveBlob(blob, baseName(it.file.name) + '.png');
  }

  async function exportVideo(it, o) {
    if (!window.MediaRecorder) throw new Error('This browser cannot record video. Try Chrome, Edge or the desktop app.');
    const v = it.el;
    const f = Math.min(1, EXPORT_MAX_VIDEO / Math.max(it.w, it.h));
    const c = document.createElement('canvas');
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('No supported video recording format.');
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';

    render(v, it.w, it.h, c, f, o);
    const stream = c.captureStream(30);
    try {
      if (!it.audio) {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ac.createMediaStreamDestination();
        ac.createMediaElementSource(v).connect(dest);
        it.audio = { ac, dest };
      }
      await it.audio.ac.resume();
      it.audio.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (e) { /* no audio track: export silent */ }

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));

    v.pause(); v.loop = false; v.muted = false; v.currentTime = 0;
    await new Promise((r) => { v.onseeked = r; setTimeout(r, 500); });
    rec.start(250);
    await v.play();
    let finished = false;
    await new Promise((resolve) => {
      const stop = () => { finished = true; resolve(); };
      const tick = () => {
        if (finished) return;
        if (v.ended || v.paused) return stop();
        o.t++; o.time = v.currentTime;
        render(v, it.w, it.h, c, f, o);
        setProgress(v.currentTime / v.duration, `Rendering ${it.file.name} — ${Math.round(100 * v.currentTime / v.duration)}%`);
        requestAnimationFrame(tick);
      };
      v.onended = stop; tick();
    });
    rec.stop(); await done;
    v.muted = true; v.loop = true; v.currentTime = 0; v.play().catch(() => {});
    await saveBlob(new Blob(chunks, { type: mime.split(';')[0] }), baseName(it.file.name) + '.' + ext);
  }

  async function exportItems(list) {
    if (exporting) return;
    exporting = true; el.save.disabled = el.saveAll.disabled = true;
    try {
      for (const it of list) {
        const o = opts(it);
        setProgress(0, 'Rendering ' + it.file.name);
        // Preview slider is tuned for the preview; export at full size uses the same block size in source pixels.
        if (it.kind === 'video') await exportVideo(it, o); else await exportImage(it, o);
      }
      toast('Saved!');
    } catch (e) { toast(e.message || String(e)); }
    setProgress(null);
    exporting = false; el.save.disabled = el.saveAll.disabled = false; dirty = true;
  }

  el.save.onclick = () => items[sel] && exportItems([items[sel]]);
  el.saveAll.onclick = () => exportItems(items.slice());
})();
