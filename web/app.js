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
    cropBtn: $('#cropBtn'), cropReset: $('#cropReset'), crop: $('#crop'), cropBox: $('#cropBox'), cropBar: $('#cropBar'),
    cropAspect: $('#cropAspect'), cropCancel: $('#cropCancel'), cropApply: $('#cropApply'),
    soundBox: $('#soundBox'), previewSound: $('#previewSound'), vol: $('#vol'), volOut: $('#volOut'),
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

  // The part of the source that is used: the whole picture, or the user's crop (stored as fractions 0..1).
  const rectOf = (it) => {
    const c = it.crop;
    if (!c) return { sx: 0, sy: 0, sw: it.w, sh: it.h };
    const sx = Math.max(0, Math.min(it.w - 2, Math.round(c.x * it.w))), sy = Math.max(0, Math.min(it.h - 2, Math.round(c.y * it.h)));
    return { sx, sy, sw: Math.max(2, Math.min(it.w - sx, Math.round(c.w * it.w))), sh: Math.max(2, Math.min(it.h - sy, Math.round(c.h * it.h))) };
  };

  // Everything render() needs. `it` (the selected item) turns a look's resolution into a block size.
  const opts = (it, extra = {}) => {
    const look = LOOKS[el.look.value], pal = PALETTES[el.palette.value];
    let size = +el.size.value;
    if (look.grid && !manualSize && it) { const r = rectOf(it); size = blockFor(look.grid, r.sw, r.sh); }
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
    if (it) { const r = rectOf(it); const [gw, gh] = smallSize(r.sw, r.sh, o.size); label += ` · ${gw}×${gh}`; }
    el.sizeOut.textContent = label;
    el.levelsOut.textContent = el.levels.value;
    el.ditherOut.textContent = el.dither.value + '%';
    el.strengthOut.textContent = el.strength.value + '%';
    el.strengthRow.hidden = !look.fx || !Object.keys(look.fx).length;
    el.osdRow.hidden = !(look.fx && look.fx.osd);
    el.levelsRow.hidden = !!pal.colors || pal.levels != null;
    syncItemUI();
    el.swatches.replaceChildren(...(pal.colors || []).map((c) => Object.assign(document.createElement('i'), { style: `background:rgb(${c})` })));
    dirty = true;
  }
  function syncItemUI() {
    const it = items[sel];
    el.cropBtn.disabled = !it || exporting;
    el.cropBtn.textContent = it && it.crop ? 'Edit crop' : 'Crop…';
    el.cropReset.hidden = !(it && it.crop);
    el.soundBox.hidden = !(it && it.kind === 'video');
    el.volOut.textContent = el.vol.value + '%';
  }
  el.look.addEventListener('input', applyLook);
  el.size.addEventListener('input', () => { manualSize = true; syncUI(); });
  for (const k of ['palette', 'levels', 'dither', 'strength', 'osd']) el[k].addEventListener('input', syncUI);
  syncUI();

  // ---------- rendering ----------
  // Draws `src` (w x h) as pixel art into `out` at scale f (1 = full size).
  function render(src, r, out, f, o) {
    const ow = Math.max(1, Math.round(r.sw * f)), oh = Math.max(1, Math.round(r.sh * f));
    const block = Math.max(1, o.size * f);
    const [sw, sh] = smallSize(ow, oh, block);
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = src.tagName === 'VIDEO' ? 'medium' : 'high'; // 'high' costs ~2x per frame
    sctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, sw, sh);
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

  function previewScale(it) { // render at (about) the size it is displayed, so the browser never has to resize the canvas again
    const dpr = window.devicePixelRatio || 1;
    const target = Math.min(PREVIEW_MAX, Math.max(320, el.stage.clientWidth * dpr));
    return { dpr, f: Math.min(1, target / Math.max(it.w, it.h)) };
  }

  // Crop editor backdrop: the whole, un-pixelated picture under the crop box.
  function drawCropBackdrop(it) {
    const { f } = previewScale(it);
    const w = Math.round(it.w * f), h = Math.round(it.h * f);
    if (el.view.width !== w || el.view.height !== h) { el.view.width = w; el.view.height = h; }
    try { const c = el.view.getContext('2d'); c.imageSmoothingEnabled = true; c.drawImage(it.el, 0, 0, w, h); } catch (e) { /* not ready */ }
    el.view.style.imageRendering = 'auto';
    placeCropOverlay();
  }

  function frame() {
    const it = items[sel];
    if (it && !exporting && (dirty || (it.kind === 'video' && !it.el.paused))) {
      const { dpr, f } = previewScale(it);
      const playing = it.kind === 'video' && !it.el.paused;
      if (cropMode) drawCropBackdrop(it);
      else {
        if (playing) tick++;
        try { render(it.el, rectOf(it), el.view, f, opts(it, { t: tick, time: it.kind === 'video' ? it.el.currentTime : 0 })); } catch (e) { /* frame not ready yet */ }
        // Hard pixel edges only when the canvas is enlarged; smooth when it is shrunk to fit.
        const shown = el.view.getBoundingClientRect().width * dpr;
        el.view.style.imageRendering = el.view.width > shown * 1.01 ? 'auto' : 'pixelated';
      }
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- crop editor ----------
  let cropMode = false;
  let cb = { x: 0, y: 0, w: 1, h: 1 }; // crop box, fractions of the picture
  let drag = null;

  const cropRatio = () => { // width/height in source pixels, or null for free
    const it = items[sel], v = el.cropAspect.value;
    if (v === 'free' || !it) return null;
    if (v === 'orig') return it.w / it.h;
    const [a, b] = v.split(':').map(Number);
    return a / b;
  };

  function placeCropOverlay() { // put the overlay exactly over the canvas
    const s = el.stage.getBoundingClientRect(), v = el.view.getBoundingClientRect();
    Object.assign(el.crop.style, { left: v.left - s.left - el.stage.clientLeft + 'px', top: v.top - s.top - el.stage.clientTop + 'px', width: v.width + 'px', height: v.height + 'px' });
  }
  function paintCropBox() {
    Object.assign(el.cropBox.style, { left: cb.x * 100 + '%', top: cb.y * 100 + '%', width: cb.w * 100 + '%', height: cb.h * 100 + '%' });
  }
  function fitRatio(b, ratio) { // largest box of that shape inside b, same center
    const it = items[sel], k = it.w / (ratio * it.h); // height = width * k (both as fractions)
    let w = b.w, h = w * k;
    if (h > b.h) { h = b.h; w = h / k; }
    return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
  }
  function enterCrop() {
    const it = items[sel];
    if (!it || exporting) return;
    cropMode = true;
    cb = it.crop ? { ...it.crop } : { x: 0.06, y: 0.06, w: 0.88, h: 0.88 };
    const r = cropRatio(); if (r) cb = fitRatio(cb, r);
    el.crop.hidden = el.cropBar.hidden = false; el.stage.classList.add('cropping');
    drawCropBackdrop(it); paintCropBox(); dirty = true; // draw now so the overlay is measured before the first drag
  }
  function exitCrop(apply) {
    if (!cropMode) return;
    const it = items[sel];
    if (apply && it) it.crop = cb.w > 0.995 && cb.h > 0.995 ? null : { ...cb };
    cropMode = false; el.crop.hidden = el.cropBar.hidden = true; el.stage.classList.remove('cropping');
    if (apply && it) { const r = rectOf(it); toast(it.crop ? `Cropped to ${r.sw}×${r.sh}` : 'Crop removed'); }
    syncUI();
  }
  function resizeBox(h, b, dx, dy) {
    const min = 0.04, ratio = cropRatio(), it = items[sel];
    let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (h.includes('w')) x1 = cl(b.x + dx, 0, x2 - min);
    if (h.includes('e')) x2 = cl(b.x + b.w + dx, x1 + min, 1);
    if (h.includes('n')) y1 = cl(b.y + dy, 0, y2 - min);
    if (h.includes('s')) y2 = cl(b.y + b.h + dy, y1 + min, 1);
    if (ratio) { // keep the shape; ignore moves that would leave the picture
      const k = it.w / (ratio * it.h);
      let nw = x2 - x1, nh = y2 - y1;
      if (h === 'n' || h === 's') { nw = nh / k; const cx = b.x + b.w / 2; x1 = cx - nw / 2; x2 = cx + nw / 2; }
      else {
        nh = nw * k;
        if (h === 'e' || h === 'w') { const cy = b.y + b.h / 2; y1 = cy - nh / 2; y2 = cy + nh / 2; }
        else if (h.includes('n')) y1 = y2 - nh; else y2 = y1 + nh;
      }
      const e = 1e-6;
      if (x1 < -e || y1 < -e || x2 > 1 + e || y2 > 1 + e || x2 - x1 < min || y2 - y1 < min) return null;
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  el.crop.addEventListener('pointerdown', (e) => {
    const h = e.target.dataset && e.target.dataset.h, onBox = e.target === el.cropBox;
    if (!h && !onBox) return;
    e.preventDefault();
    placeCropOverlay();
    const rect = el.crop.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // not laid out yet: never start a drag on an unmeasured overlay
    try { el.crop.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    drag = { h: h || 'move', x0: e.clientX, y0: e.clientY, r: rect, b0: { ...cb } };
  });
  el.crop.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x0) / drag.r.width, dy = (e.clientY - drag.y0) / drag.r.height, b = drag.b0;
    const nb = drag.h === 'move'
      ? { x: Math.max(0, Math.min(1 - b.w, b.x + dx)), y: Math.max(0, Math.min(1 - b.h, b.y + dy)), w: b.w, h: b.h }
      : resizeBox(drag.h, b, dx, dy);
    if (nb) { cb = nb; paintCropBox(); }
  });
  for (const ev of ['pointerup', 'pointercancel']) el.crop.addEventListener(ev, () => { drag = null; });
  el.cropAspect.addEventListener('input', () => { const r = cropRatio(); if (r) { cb = fitRatio(cb, r); paintCropBox(); } });
  el.cropBtn.onclick = enterCrop;
  el.cropApply.onclick = () => exitCrop(true);
  el.cropCancel.onclick = () => exitCrop(false);
  el.cropReset.onclick = () => { const it = items[sel]; if (it) { it.crop = null; syncUI(); toast('Crop removed'); } };

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
        v.onloadeddata = () => resolve({ file, url, kind: 'video', el: v, w: v.videoWidth, h: v.videoHeight, crop: null });
        v.onerror = () => reject(new Error("Can't decode " + file.name));
      } else {
        const im = new Image();
        im.onload = () => resolve({ file, url, kind: 'image', el: im, w: im.naturalWidth, h: im.naturalHeight, crop: null });
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

  // Preview sound: the element plays with the chosen volume unless the user turned it off (or the
  // browser blocks unmuted autoplay, in which case ticking the box again unmutes it).
  function applySound(it) {
    if (!it || it.kind !== 'video') return;
    it.el.volume = el.vol.value / 100;
    it.el.muted = exporting || !el.previewSound.checked || +el.vol.value === 0;
  }
  function playPreview(it) {
    applySound(it);
    it.el.play().catch(() => {
      it.el.muted = true;
      it.el.play().catch(() => {});
      if (!it.soundHint) { it.soundHint = true; toast('Sound is blocked by the browser: tick "Play sound in preview" to hear it.'); }
    });
  }
  // After an export the element is wired into the recording graph (silent to the speakers); reconnect it.
  function restorePreview(it) {
    if (it.kind !== 'video') return;
    const a = it.audio;
    if (a && !a.toSpeakers) { try { a.src.connect(a.ac.destination); a.toSpeakers = true; a.ac.resume(); } catch (e) { /* ignore */ } }
    it.el.loop = true;
    if (it === items[sel]) playPreview(it); else it.el.pause();
  }
  el.vol.addEventListener('input', () => { applySound(items[sel]); syncItemUI(); });
  el.previewSound.addEventListener('change', () => { const it = items[sel]; if (it && it.kind === 'video') playPreview(it); });

  function select(i, autoSize) {
    exitCrop(false);
    if (items[sel]?.kind === 'video') items[sel].el.pause();
    sel = i;
    const it = items[i];
    if (it.kind === 'video') playPreview(it);
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
    if (i === sel) exitCrop(false);
    const it = items[i];
    if (it.kind === 'video') { it.el.pause(); it.el.removeAttribute('src'); it.el.load(); }
    if (it.audio) it.audio.ac.close().catch(() => {});
    URL.revokeObjectURL(it.url);
    items.splice(i, 1);
    if (!items.length) {
      sel = -1;
      el.view.hidden = true; el.drop.hidden = false; el.stage.classList.remove('has');
      el.save.disabled = el.saveAll.disabled = true;
      renderChips(); syncUI();
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
    render(it.el, rectOf(it), c, 1, o);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await saveBlob(blob, baseName(it.file.name) + '.png');
  }

  async function exportVideo(it, o) {
    if (!window.MediaRecorder) throw new Error('This browser cannot record video. Try Chrome, Edge or the desktop app.');
    const v = it.el, r = rectOf(it);
    const f = Math.min(1, EXPORT_MAX_VIDEO / Math.max(r.sw, r.sh));
    const c = document.createElement('canvas');
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('No supported video recording format.');
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const vol = el.vol.value / 100;

    render(v, r, c, f, o);
    const stream = c.captureStream(30);

    // Sound: route the video element through Web Audio (with a gain for the volume slider) into the recording.
    // The speakers are disconnected meanwhile, so the export is silent to you but not in the file.
    let sound = vol === 0 ? 'off' : 'none';
    v.volume = 1; v.muted = false;
    if (vol > 0) {
      try {
        if (!it.audio) {
          const ac = new (window.AudioContext || window.webkitAudioContext)();
          const src = ac.createMediaElementSource(v), gain = ac.createGain(), dest = ac.createMediaStreamDestination();
          src.connect(gain); gain.connect(dest);
          it.audio = { ac, src, gain, dest, toSpeakers: false };
        }
        const a = it.audio;
        a.gain.gain.value = vol;
        if (a.toSpeakers) { a.src.disconnect(a.ac.destination); a.toSpeakers = false; }
        await Promise.race([a.ac.resume(), new Promise((res) => setTimeout(res, 1500))]);
        a.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        if (stream.getAudioTracks().length) sound = 'graph';
      } catch (e) { console.warn('Web Audio capture failed', e); }
      if (sound === 'none') { // fallback: capture the element's own audio (plays through the speakers)
        try {
          const cs = (v.captureStream || v.mozCaptureStream).call(v);
          v.volume = vol;
          cs.getAudioTracks().forEach((t) => stream.addTrack(t));
          if (stream.getAudioTracks().length) sound = 'element';
        } catch (e) { console.warn('Element capture failed', e); }
      }
    }

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));

    v.pause(); v.loop = false; v.currentTime = 0;
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 500); });
    rec.start(250);
    await v.play();
    // Browsers stop drawing frames in hidden tabs, which would freeze the saved video. Pause the recording
    // while hidden and carry on when the tab is visible again.
    let hiddenPause = false, finished = false;
    const onVis = () => {
      if (document.hidden) { hiddenPause = true; v.pause(); if (rec.state === 'recording') rec.pause(); }
      else if (hiddenPause) { hiddenPause = false; if (rec.state === 'paused') rec.resume(); v.play().catch(() => {}); requestAnimationFrame(step); }
    };
    document.addEventListener('visibilitychange', onVis);
    let step;
    if (document.hidden) onVis(); // started while hidden: wait until visible
    await new Promise((resolve) => {
      const stop = () => { finished = true; resolve(); };
      step = () => {
        if (finished || hiddenPause) return;
        if (v.ended || v.paused) return stop();
        o.t++; o.time = v.currentTime;
        render(v, r, c, f, o);
        setProgress(v.currentTime / v.duration, `Saving ${it.file.name} — ${Math.round(100 * v.currentTime / v.duration)}% (keep this window visible)`);
        requestAnimationFrame(step);
      };
      v.onended = stop; step();
    });
    document.removeEventListener('visibilitychange', onVis);
    rec.stop(); await done;
    v.currentTime = 0;
    if (sound === 'none') toast("Couldn't capture this video's sound in this browser, so it was saved without audio.");
    await saveBlob(new Blob(chunks, { type: mime.split(';')[0] }), baseName(it.file.name) + '.' + ext);
  }

  async function exportItems(list) {
    if (exporting) return;
    exitCrop(false);
    exporting = true; el.save.disabled = el.saveAll.disabled = true; syncItemUI();
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
    for (const it of list) restorePreview(it);
    syncItemUI();
  }

  el.save.onclick = () => items[sel] && exportItems([items[sel]]);
  el.saveAll.onclick = () => exportItems(items.slice());
})();
