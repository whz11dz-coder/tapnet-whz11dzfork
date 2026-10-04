// Motion Explorer: renders point tracks exported by export_motion.py.
// Licensed under the Apache License, Version 2.0.
// Markup contract: one .motion-explorer element whose controls carry the
// me-* ids used below (see index.html).
(() => {
  'use strict';

  // Bump after every change to this component, together with the ?v= of the
  // tags that load motion-explorer.css and motion-explorer.js. Data files carry
  // their own version.
  const APP_VERSION = '3';
  const ROOT = document.querySelector('.motion-explorer');
  // Where manifest.json lives, relative to the page; set with data-root.
  const DATA_ROOT = (ROOT && ROOT.dataset.root) || 'data/';

  const I18N = {
    pl: {
      title: 'Tory ruchu',
      lede: 'Każdy punkt to fragment obrazu śledzony przez model TAPNext++. Przełącz widok na „W przestrzeni”, żeby odjąć ruch kamery i zobaczyć, którędy naprawdę przemieszczał się obiekt.',
      loading: 'Wczytywanie danych…',
      loadingFrames: (n, t) => `Wczytywanie klatek: ${n} z ${t}`,
      loadError: (url) => `Nie udało się wczytać ${url}. Jeśli otwierasz plik prosto z dysku, uruchom w katalogu web/ serwer: python3 -m http.server, a potem wejdź na http://localhost:8000.`,
      clip: 'Klip',
      view: 'Widok',
      modeScreen: 'Na ekranie',
      modeSpace: 'W przestrzeni',
      noteScreen: 'Tak to widzi kamera. Smuga pokazuje ostatnie położenia punktu. Tło też się przesuwa, bo kamera się porusza.',
      noteSpace: 'Ruch kamery jest odjęty. Smuga pozostaje tam, gdzie punkt naprawdę był, a tło stoi w miejscu jako blade kropki. Widać wyłącznie ruch samego obiektu.',
      hueTop: 'wyżej',
      hueBottom: 'niżej',
      tail: 'Długość smugi',
      tailOut: (n) => `${n} kl.`,
      fgThresh: 'Granica obiekt/tło',
      fgNote: 'Punkt należy do obiektu, gdy ruch kamery wyjaśnia jego położenie w mniej niż podanym odsetku klatek. Im wyższa wartość, tym więcej punktów trafia do obiektu.',
      showBg: 'Pokaż punkty tła',
      brush: 'Pędzel zaznaczania',
      brushOut: (n) => `${n} px`,
      selNone: 'Przeciągnij palcem lub myszą po obrazie, żeby zaznaczyć punkty i zobaczyć ich cały tor, także przyszły (linia przerywana).',
      sel: (n, a, b) => `Zaznaczono <strong>${n}</strong> ${plural(n, 'punkt', 'punkty', 'punktów')}, widoczne w klatkach ${a}–${b}.`,
      additive: 'Dodawaj do zaznaczenia',
      clear: 'Wyczyść zaznaczenie',
      data: 'Dane klipu',
      sFrames: 'klatki',
      sSize: 'rozmiar',
      sTracks: 'śledzone punkty',
      sFg: 'na obiekcie',
      sGrid: 'rozstaw siatki',
      sRansac: 'próg RANSAC',
      play: 'Odtwórz',
      pause: 'Wstrzymaj',
      credits: `Śledzenie punktów: TAPNext++ (Google DeepMind, licencja Apache 2.0). Odejmowanie ruchu kamery: homografie liczone metodą z notatnika TAPIR „rainbow”. Wersja strony ${APP_VERSION}.`,
      clipCredit: 'Nagranie',
      fps: 'kl./s',
      frame: 'kl.',
    },
    en: {
      title: 'Motion paths',
      lede: 'Every dot is a patch of the image tracked by the TAPNext++ model. Switch to “In space” to remove camera motion and see the path the object actually took.',
      loading: 'Loading data…',
      loadingFrames: (n, t) => `Loading frames: ${n} of ${t}`,
      loadError: (url) => `Could not load ${url}. If you opened the file straight from disk, start a server in the web/ folder with python3 -m http.server and open http://localhost:8000.`,
      clip: 'Clip',
      view: 'View',
      modeScreen: 'On screen',
      modeSpace: 'In space',
      noteScreen: 'This is what the camera sees. Each trail shows a point’s recent positions. The background moves too, because the camera moves.',
      noteSpace: 'Camera motion is removed. Trails stay where the point really was, and the background holds still as faint dots. What remains is the object’s own motion.',
      hueTop: 'higher',
      hueBottom: 'lower',
      tail: 'Trail length',
      tailOut: (n) => `${n} fr.`,
      fgThresh: 'Object/background split',
      fgNote: 'A point belongs to the object when camera motion explains its position in fewer than this share of frames. Higher value = more points count as the object.',
      showBg: 'Show background points',
      brush: 'Selection brush',
      brushOut: (n) => `${n} px`,
      selNone: 'Drag across the image to select points and see their whole path, including where they go next (dashed line).',
      sel: (n, a, b) => `Selected <strong>${n}</strong> ${n === 1 ? 'point' : 'points'}, visible in frames ${a}–${b}.`,
      additive: 'Add to selection',
      clear: 'Clear selection',
      data: 'Clip data',
      sFrames: 'frames',
      sSize: 'size',
      sTracks: 'tracked points',
      sFg: 'on the object',
      sGrid: 'grid spacing',
      sRansac: 'RANSAC threshold',
      play: 'Play',
      pause: 'Pause',
      credits: `Point tracking: TAPNext++ (Google DeepMind, Apache 2.0 licence). Camera motion removal: homographies estimated with the method from the TAPIR “rainbow” notebook. Page version ${APP_VERSION}.`,
      clipCredit: 'Footage',
      fps: 'fps',
      frame: 'fr.',
    },
  };

  function plural(n, one, few, many) {
    if (n === 1) return one;
    const d = n % 10, dd = n % 100;
    return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  }

  const $ = (id) => document.getElementById(`me-${id}`);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const statusBox = $('status');

  const S = {
    lang: 'pl',
    clip: null,
    frame: 0,
    playing: false,
    speed: 1,
    mode: 'space',
    tail: 16,
    fgThresh: 0.6,
    showBg: true,
    brush: 22,
    additive: false,
    selection: new Set(),
    pointer: null, // {x, y} in video pixels while hovering the canvas
    painting: false,
  };

  // data-lang on the component fixes the language; otherwise use the saved one.
  const fixedLang = ROOT && ROOT.dataset.lang;
  if (fixedLang === 'pl' || fixedLang === 'en') {
    S.lang = fixedLang;
  } else {
    try {
      const saved = localStorage.getItem('motion-explorer-lang');
      if (saved === 'pl' || saved === 'en') S.lang = saved;
    } catch (e) { /* storage unavailable */ }
  }

  const t = (key, ...args) => {
    const v = I18N[S.lang][key];
    return typeof v === 'function' ? v(...args) : v;
  };
  const num = (x, digits = 0) =>
    x.toLocaleString(S.lang === 'pl' ? 'pl-PL' : 'en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // ---------------------------------------------------------------- data

  function bytesFromB64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [
      A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
    ];
  }

  function mul3(m, n) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        r[i * 3 + j] = m[i * 3] * n[j] + m[i * 3 + 1] * n[3 + j] + m[i * 3 + 2] * n[6 + j];
    return r;
  }

  const HUE_BINS = 48;

  function decodeClip(m, base, version) {
    const T = m.numFrames, Q = m.numTracks;
    const raw = bytesFromB64(m.tracks);
    const tracks = new Int16Array(raw.buffer, raw.byteOffset, Q * T * 2);
    const visible = bytesFromB64(m.visible);
    const queryFrame = (() => { const b = bytesFromB64(m.queryFrame); return new Uint16Array(b.buffer, b.byteOffset, Q); })();
    const bgRatio = bytesFromB64(m.backgroundRatio);
    const canonB = bytesFromB64(m.canonical);
    const canonical = new Float32Array(canonB.buffer, canonB.byteOffset, Q * 2);

    const bin = new Uint8Array(Q);
    const binColor = Array.from({ length: HUE_BINS }, (_, b) => `hsl(${Math.round((b / (HUE_BINS - 1)) * 330)} 92% 60%)`);

    // First and last visible frame per track.
    const first = new Int16Array(Q), last = new Int16Array(Q);
    for (let q = 0; q < Q; q++) {
      let f = -1, l = -1;
      for (let j = 0; j < T; j++) if (visible[q * T + j]) { if (f < 0) f = j; l = j; }
      first[q] = f; last[q] = l;
    }

    const H = m.homographies;
    const Hinv = H.map(invert3);
    return {
      meta: m, base, version, T, Q, w: m.width, h: m.height, fps: m.fps || 10,
      tracks, visible, queryFrame, bgRatio, canonical, bin, binColor, first, last, H, Hinv,
      images: new Array(T),
    };
  }

  // Colour by height in the canonical frame, as the rainbow demo suggests.
  // Object and background get separate ramps, so the full spectrum spans the
  // object whatever its size.
  function recolor(c) {
    const groups = [[], []];
    for (let q = 0; q < c.Q; q++) groups[isFg(c, q) ? 0 : 1].push(q);
    for (const g of groups) {
      g.sort((a, b) => c.canonical[a * 2 + 1] - c.canonical[b * 2 + 1]);
      g.forEach((q, rank) => { c.bin[q] = Math.min(HUE_BINS - 1, Math.floor((rank / g.length) * HUE_BINS)); });
    }
  }

  function loadImages(clip, onProgress) {
    let done = 0;
    return Promise.all(Array.from({ length: clip.T }, (_, i) => new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { clip.images[i] = img; onProgress(++done); resolve(); };
      img.onerror = () => reject(new Error(img.src));
      const name = clip.meta.framePattern.replace('{t:05d}', String(i).padStart(5, '0'));
      img.src = `${clip.base}${name}?v=${clip.version}`;
    })));
  }

  async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  let manifest = null;

  async function boot() {
    showStatus(t('loading'));
    const url = `${DATA_ROOT}manifest.json?v=${APP_VERSION}`;
    try {
      manifest = await fetchJson(url, { cache: 'no-cache' });
    } catch (e) {
      showStatus(t('loadError', `${DATA_ROOT}manifest.json`));
      return;
    }
    const sel = $('clip');
    sel.innerHTML = '';
    manifest.clips.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = c.title;
      sel.appendChild(o);
    });
    $('clip-group').hidden = manifest.clips.length < 2;
    await openClip(0);
  }

  async function openClip(index) {
    pause();
    const entry = manifest.clips[index];
    const base = `${DATA_ROOT}${entry.path}`;
    showStatus(t('loading'));
    let clip;
    try {
      const m = await fetchJson(`${base}motion.json?v=${entry.version}`);
      clip = decodeClip(m, base, entry.version);
      await loadImages(clip, (n) => showStatus(t('loadingFrames', n, clip.T)));
    } catch (e) {
      showStatus(t('loadError', e.message || base));
      return;
    }
    S.clip = clip;
    recolor(clip);
    S.frame = 0;
    S.selection.clear();
    $('screen').style.aspectRatio = `${clip.w} / ${clip.h}`;
    $('scrub').max = String(clip.T - 1);
    $('tail').max = String(clip.T);
    S.tail = Math.min(S.tail, clip.T);
    $('tail').value = String(S.tail);
    statusBox.hidden = true;
    resizeCanvas();
    refreshText();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) play();
  }

  function showStatus(msg) {
    statusBox.hidden = false;
    statusBox.firstElementChild.textContent = msg;
  }

  // ---------------------------------------------------------------- geometry

  const isFg = (c, q) => c.bgRatio[q] / 255 <= S.fgThresh;
  const visAt = (c, q, j) => c.visible[q * c.T + j] === 1;

  // Matrices that carry frame j into frame i: inv(H[i]) @ H[j].
  function mapsInto(c, i) {
    const out = new Array(c.T);
    for (let j = 0; j < c.T; j++) out[j] = mul3(c.Hinv[i], c.H[j]);
    return out;
  }

  function makePos(c, maps) {
    const tr = c.tracks, T = c.T;
    if (!maps) {
      return (q, j, o) => { const k = (q * T + j) * 2; o[0] = tr[k] / 4; o[1] = tr[k + 1] / 4; return o; };
    }
    return (q, j, o) => {
      const k = (q * T + j) * 2, x = tr[k] / 4, y = tr[k + 1] / 4, M = maps[j];
      const z = M[6] * x + M[7] * y + M[8];
      const s = Math.abs(z) < 1e-12 ? 1e12 : 1 / z;
      o[0] = (M[0] * x + M[1] * y + M[2]) * s;
      o[1] = (M[3] * x + M[4] * y + M[5]) * s;
      return o;
    };
  }

  // ---------------------------------------------------------------- render

  let dpr = 1;

  function resizeCanvas() {
    if (!S.clip) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    render();
  }

  const AGE_ALPHA = [1, 0.55, 0.25];

  function render() {
    const c = S.clip;
    if (!c) return;
    const i = S.frame;
    const scale = canvas.width / c.w;
    const unit = c.w / Math.max(1, canvas.clientWidth); // video px per CSS px
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(c.images[i], 0, 0, canvas.width, canvas.height);
    const hasSel = S.selection.size > 0;
    ctx.fillStyle = `rgba(5, 6, 9, ${hasSel ? 0.45 : S.mode === 'space' ? 0.3 : 0.18})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const maps = S.mode === 'space' ? mapsInto(c, i) : null;
    const pos = makePos(c, maps);
    const a = [0, 0], b = [0, 0];

    // Bucket the tracks that are visible now by hue bin.
    const tailBins = Array.from({ length: HUE_BINS }, () => []);
    const bgDots = [];
    for (let q = 0; q < c.Q; q++) {
      if (!visAt(c, q, i) || S.selection.has(q)) continue;
      const fg = isFg(c, q);
      if (!fg && !S.showBg) continue;
      if (!fg && S.mode === 'space') { bgDots.push(q); continue; }
      tailBins[c.bin[q]].push(q);
    }
    const dim = hasSel ? 0.22 : 1;

    if (bgDots.length) {
      ctx.globalAlpha = 0.35 * dim;
      ctx.fillStyle = '#d8dbe4';
      ctx.beginPath();
      const r = 1.4 * unit;
      for (const q of bgDots) { pos(q, i, a); ctx.moveTo(a[0] + r, a[1]); ctx.arc(a[0], a[1], r, 0, Math.PI * 2); }
      ctx.fill();
    }

    const L = S.tail;
    if (L > 0) {
      ctx.lineWidth = 1.5 * unit;
      for (let bucket = 0; bucket < 3; bucket++) {
        // Segments (j-1 -> j) whose age i-j falls in this third of the tail.
        const jHi = i - Math.ceil((bucket * L) / 3);
        const jLo = Math.max(1, i - Math.ceil(((bucket + 1) * L) / 3) + 1);
        if (jHi < jLo) continue;
        ctx.globalAlpha = AGE_ALPHA[bucket] * dim;
        for (let bn = 0; bn < HUE_BINS; bn++) {
          const list = tailBins[bn];
          if (!list.length) continue;
          ctx.strokeStyle = c.binColor[bn];
          ctx.beginPath();
          for (const q of list) {
            for (let j = jLo; j <= jHi; j++) {
              if (!visAt(c, q, j - 1) || !visAt(c, q, j)) continue;
              pos(q, j - 1, a); pos(q, j, b);
              ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
            }
          }
          ctx.stroke();
        }
      }
    }

    ctx.globalAlpha = dim;
    const r = 2.2 * unit;
    for (let bn = 0; bn < HUE_BINS; bn++) {
      const list = tailBins[bn];
      if (!list.length) continue;
      ctx.fillStyle = c.binColor[bn];
      ctx.beginPath();
      for (const q of list) { pos(q, i, a); ctx.moveTo(a[0] + r, a[1]); ctx.arc(a[0], a[1], r, 0, Math.PI * 2); }
      ctx.fill();
    }

    if (hasSel) drawSelection(c, i, pos, unit);

    if (S.pointer) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2 * unit;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(S.pointer.x, S.pointer.y, S.brush * unit, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawSelection(c, i, pos, unit) {
    const a = [0, 0], b = [0, 0];
    const byBin = new Map();
    for (const q of S.selection) {
      if (!byBin.has(c.bin[q])) byBin.set(c.bin[q], []);
      byBin.get(c.bin[q]).push(q);
    }
    for (const [bn, list] of byBin) {
      ctx.strokeStyle = c.binColor[bn];
      // Past: solid. Future: dashed.
      for (const future of [false, true]) {
        ctx.globalAlpha = future ? 0.7 : 1;
        ctx.lineWidth = (future ? 1.4 : 2) * unit;
        ctx.setLineDash(future ? [4 * unit, 4 * unit] : []);
        ctx.beginPath();
        for (const q of list) {
          const j0 = future ? Math.max(i + 1, c.first[q] + 1) : c.first[q] + 1;
          const j1 = future ? c.last[q] : Math.min(i, c.last[q]);
          for (let j = j0; j <= j1; j++) {
            if (!visAt(c, q, j - 1) || !visAt(c, q, j)) continue;
            pos(q, j - 1, a); pos(q, j, b);
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          }
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const r = 3.2 * unit;
    for (const [bn, list] of byBin) {
      ctx.fillStyle = c.binColor[bn];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2 * unit;
      ctx.beginPath();
      for (const q of list) {
        if (!visAt(c, q, i)) continue;
        pos(q, i, a); ctx.moveTo(a[0] + r, a[1]); ctx.arc(a[0], a[1], r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- selection

  function toVideo(ev) {
    const rect = canvas.getBoundingClientRect();
    const c = S.clip;
    return { x: ((ev.clientX - rect.left) / rect.width) * c.w, y: ((ev.clientY - rect.top) / rect.height) * c.h };
  }

  function paintAt(p) {
    const c = S.clip, i = S.frame, T = c.T;
    const R = S.brush * (c.w / Math.max(1, canvas.clientWidth));
    const R2 = R * R;
    let added = 0;
    for (let q = 0; q < c.Q; q++) {
      if (!visAt(c, q, i) || S.selection.has(q)) continue;
      if (!isFg(c, q) && !S.showBg) continue;
      const k = (q * T + i) * 2;
      const dx = c.tracks[k] / 4 - p.x, dy = c.tracks[k + 1] / 4 - p.y;
      if (dx * dx + dy * dy <= R2) { S.selection.add(q); added++; }
    }
    return added;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!S.clip) return;
    canvas.setPointerCapture(ev.pointerId);
    S.painting = true;
    pause();
    if (!(S.additive || ev.shiftKey)) S.selection.clear();
    const p = toVideo(ev);
    S.pointer = ev.pointerType === 'mouse' ? p : null;
    paintAt(p);
    refreshSelection();
    render();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!S.clip) return;
    const p = toVideo(ev);
    S.pointer = ev.pointerType === 'mouse' ? p : null;
    if (S.painting && paintAt(p)) refreshSelection();
    if (!S.playing) render();
  });
  const endPaint = () => { S.painting = false; };
  canvas.addEventListener('pointerup', endPaint);
  canvas.addEventListener('pointercancel', endPaint);
  canvas.addEventListener('pointerleave', () => { S.pointer = null; if (!S.playing) render(); });

  function refreshSelection() {
    const c = S.clip;
    const n = S.selection.size;
    $('clear').disabled = n === 0;
    if (!c || n === 0) { $('selinfo').textContent = t('selNone'); return; }
    let a = Infinity, b = -Infinity;
    for (const q of S.selection) { a = Math.min(a, c.first[q]); b = Math.max(b, c.last[q]); }
    $('selinfo').innerHTML = t('sel', n, a + 1, b + 1);
  }

  // ---------------------------------------------------------------- playback

  let lastTs = 0, acc = 0;

  function tick(ts) {
    if (!S.playing) return;
    const c = S.clip;
    const dt = Math.min(250, ts - (lastTs || ts));
    lastTs = ts;
    acc += dt;
    const step = 1000 / (c.fps * S.speed);
    if (acc >= step) {
      acc %= step;
      setFrame((S.frame + 1) % c.T);
    }
    requestAnimationFrame(tick);
  }

  function play() {
    if (!S.clip || S.playing) return;
    S.playing = true;
    lastTs = 0; acc = 0;
    syncPlayButton();
    requestAnimationFrame(tick);
  }

  function pause() {
    S.playing = false;
    syncPlayButton();
  }

  function syncPlayButton() {
    $('icon-play').hidden = S.playing;
    $('icon-pause').hidden = !S.playing;
    $('play').setAttribute('aria-label', t(S.playing ? 'pause' : 'play'));
  }

  function setFrame(f) {
    S.frame = f;
    $('scrub').value = String(f);
    refreshClock();
    render();
  }

  function refreshClock() {
    const c = S.clip;
    if (!c) { $('clock').textContent = ''; return; }
    const secs = S.frame / c.fps;
    $('clock').innerHTML = `${t('frame')} <b>${S.frame + 1}</b>/${c.T} · ${num(secs, 1)} s`;
  }

  // ---------------------------------------------------------------- controls

  $('play').addEventListener('click', () => (S.playing ? pause() : play()));
  $('prev').addEventListener('click', () => { pause(); if (S.clip) setFrame((S.frame - 1 + S.clip.T) % S.clip.T); });
  $('next').addEventListener('click', () => { pause(); if (S.clip) setFrame((S.frame + 1) % S.clip.T); });
  $('scrub').addEventListener('input', (e) => { pause(); setFrame(Number(e.target.value)); });
  $('speed').addEventListener('change', (e) => { S.speed = Number(e.target.value); });
  $('clip').addEventListener('change', (e) => openClip(Number(e.target.value)));

  document.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
    S.mode = btn.dataset.mode;
    refreshText();
    render();
  }));
  $('tail').addEventListener('input', (e) => { S.tail = Number(e.target.value); refreshOutputs(); render(); });
  $('fg').addEventListener('input', (e) => {
    S.fgThresh = Number(e.target.value);
    if (S.clip) recolor(S.clip);
    refreshOutputs(); refreshStats(); render();
  });
  $('showbg').addEventListener('change', (e) => { S.showBg = e.target.checked; render(); });
  $('brush').addEventListener('input', (e) => { S.brush = Number(e.target.value); refreshOutputs(); render(); });
  $('additive').addEventListener('change', (e) => { S.additive = e.target.checked; });
  $('clear').addEventListener('click', () => { S.selection.clear(); refreshSelection(); render(); });

  document.querySelectorAll('[data-lang]').forEach((btn) => btn.addEventListener('click', () => {
    S.lang = btn.dataset.lang;
    try { localStorage.setItem('motion-explorer-lang', S.lang); } catch (e) { /* ignore */ }
    refreshText();
  }));

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (!S.clip || ['input', 'select', 'textarea', 'button'].includes(tag)) return;
    if (e.key === ' ') { e.preventDefault(); S.playing ? pause() : play(); }
    else if (e.key === 'ArrowRight') { pause(); setFrame((S.frame + 1) % S.clip.T); }
    else if (e.key === 'ArrowLeft') { pause(); setFrame((S.frame - 1 + S.clip.T) % S.clip.T); }
  });

  new ResizeObserver(() => resizeCanvas()).observe(canvas);

  // ---------------------------------------------------------------- text

  function refreshOutputs() {
    $('tail-out').textContent = t('tailOut', S.tail);
    $('fg-out').textContent = `${Math.round(S.fgThresh * 100)}%`;
    $('brush-out').textContent = t('brushOut', S.brush);
  }

  function refreshStats() {
    const c = S.clip;
    const dl = $('stats');
    if (!c) { dl.innerHTML = ''; return; }
    let fg = 0;
    for (let q = 0; q < c.Q; q++) if (isFg(c, q)) fg++;
    const p = c.meta.params || {};
    const rows = [
      [t('sFrames'), `${c.T} · ${num(c.fps, 0)} ${t('fps')}`],
      [t('sSize'), `${c.w}×${c.h} px`],
      [t('sTracks'), num(c.Q)],
      [t('sFg'), num(fg)],
      [t('sGrid'), `${p.stride ?? '–'} px`],
      [t('sRansac'), p.ransacInlierThreshold != null ? num(p.ransacInlierThreshold, 2) : '–'],
    ];
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      dl.append(dt, dd);
    }
  }

  function refreshText() {
    document.documentElement.lang = S.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = t(el.dataset.i18n);
      if (typeof v === 'string') el.textContent = v;
    });
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    $('mode-note').textContent = t(S.mode === 'space' ? 'noteSpace' : 'noteScreen');
    $('credits').textContent = t('credits');
    const credit = S.clip && S.clip.meta.credit;
    $('clip-credit').hidden = !credit;
    $('clip-credit').textContent = credit ? `${t('clipCredit')}: ${credit}` : '';
    if (!S.clip) statusBox.firstElementChild.textContent = t('loading');
    refreshOutputs();
    refreshSelection();
    refreshStats();
    refreshClock();
    syncPlayButton();
  }

  refreshText();
  boot();
})();
