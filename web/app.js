(() => {
  const $ = (s) => document.querySelector(s);
  const { PALETTES, quantize, smallSize } = Pixelate;
  const PREVIEW_MAX = 2400;
  const EXPORT_MAX_VIDEO = 1920;

  const el = {
    stage: $('#stage'), drop: $('#drop'), view: $('#view'), file: $('#file'), files: $('#files'),
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

  const opts = () => ({
    size: +el.size.value,
    palette: PALETTES[el.palette.value].colors,
    levels: +el.levels.value,
    dither: +el.dither.value / 100,
  });

  function syncUI() {
    el.sizeOut.textContent = el.size.value + ' px';
    el.levelsOut.textContent = el.levels.value;
    el.ditherOut.textContent = el.dither.value + '%';
    const pal = PALETTES[el.palette.value].colors;
    el.levelsRow.hidden = !!pal;
    el.swatches.replaceChildren(...(pal || []).map((c) => Object.assign(document.createElement('i'), { style: `background:rgb(${c})` })));
    dirty = true;
  }
  for (const k of ['size', 'palette', 'levels', 'dither']) el[k].addEventListener('input', syncUI);
  syncUI();

  // ---------- rendering ----------
  // Draws `src` (w x h) as pixel art into `out` at scale f (1 = full size).
  function render(src, w, h, out, f, o) {
    const ow = Math.max(1, Math.round(w * f)), oh = Math.max(1, Math.round(h * f));
    const block = Math.max(1, o.size * f);
    const [sw, sh] = smallSize(ow, oh, block);
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, sw, sh);
    const img = sctx.getImageData(0, 0, sw, sh);
    quantize(img.data, sw, sh, o);
    sctx.putImageData(img, 0, 0);
    if (out.width !== ow || out.height !== oh) { out.width = ow; out.height = oh; }
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(small, 0, 0, sw, sh, 0, 0, sw * block, sh * block);
  }

  function frame() {
    const it = items[sel];
    if (it && !exporting && (dirty || (it.kind === 'video' && !it.el.paused))) {
      // Render at (about) the size it is displayed, so the browser never has to resize the canvas again.
      const dpr = window.devicePixelRatio || 1;
      const target = Math.min(PREVIEW_MAX, Math.max(320, el.stage.clientWidth * dpr));
      const f = Math.min(1, target / Math.max(it.w, it.h));
      try { render(it.el, it.w, it.h, el.view, f, opts()); } catch (e) { /* frame not ready yet */ }
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

  function load(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i.test(file.name);
      if (isVideo) {
        const v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        v.onloadeddata = () => { v.play().catch(() => {}); resolve({ file, url, kind: 'video', el: v, w: v.videoWidth, h: v.videoHeight }); };
        v.onerror = () => reject(new Error("Can't decode " + file.name));
      } else {
        const im = new Image();
        im.onload = () => resolve({ file, url, kind: 'image', el: im, w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => reject(new Error("Can't decode " + file.name + ' (format not supported by this browser)'));
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
      el.size.value = Math.max(2, Math.min(max, Math.round(Math.max(it.w, it.h) / 80)));
      syncUI();
    }
    el.drop.hidden = true; el.view.hidden = false; el.stage.classList.add('has');
    el.save.disabled = el.saveAll.disabled = false;
    dirty = true;
    renderChips();
  }

  function renderChips() {
    el.files.replaceChildren(...items.map((it, i) => {
      const c = document.createElement('div');
      c.className = 'chip' + (i === sel ? ' sel' : '');
      c.innerHTML = '<b>' + (it.kind === 'video' ? '▶' : '▣') + '</b><span></span>';
      c.querySelector('span').textContent = it.file.name;
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
    const o = opts();
    try {
      for (const it of list) {
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
