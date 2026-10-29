// ── Screen share ─────────────────────────────────────────────────────────────
// Discord asks for a screen with getDisplayMedia. Driftcord answers it with its
// own one-screen picker: live thumbnails of every screen and window, quality,
// frame rate, optimization and audio, then Go Live. Capture happens natively in
// Driftcord (see src-tauri/src/capture.rs) and frames arrive here through
// WebView2 shared memory, so no browser dialog ever opens.
//
// If native capture isn't available (or you pick "Use Windows picker"), the
// browser's own picker is used instead.

const SHARE_MODES = {
  motion:   { short: 'Smooth', label: 'Smooth motion', hint: 'motion',
              desc: 'Games and video: keeps motion fluid.' },
  balanced: { short: 'Balanced', label: 'Balanced', hint: '',
              desc: 'A good default for most things.' },
  detail:   { short: 'Sharp', label: 'Sharp text', hint: 'detail',
              desc: 'Code, docs and slides: keeps text crisp.' },
};

const SHARE_RES = {
  '720p':  { label: '720p',  w: 1280, h: 720 },
  '1080p': { label: '1080p', w: 1920, h: 1080 },
  '1440p': { label: '1440p', w: 2560, h: 1440 },
  source:  { label: 'Source', w: 7680, h: 4320 },
};
const SHARE_FPS = [15, 30, 60];

// WebView2's messaging object. Grab it now, before any page code runs.
const WV = window.chrome && window.chrome.webview;

const SHARE_CSS = `
.share-scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .5); display: grid; place-items: center;
  z-index: 2147483647; animation: fadeIn .14s ease; font: 14px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
@keyframes fadeIn { from { opacity: 0; } }
.picker { width: min(900px, calc(100vw - 32px)); height: min(640px, calc(100vh - 48px)); display: flex; flex-direction: column;
  background: var(--d-bg); color: var(--d-text); border: 1px solid var(--d-line); border-radius: 18px;
  box-shadow: 0 28px 70px rgb(0 0 0 / .55); overflow: hidden; animation: sheetIn .18s cubic-bezier(.2,.8,.2,1); }
@keyframes sheetIn { from { opacity: 0; transform: translateY(10px) scale(.985); } }
.picker header { display: flex; align-items: center; gap: 12px; padding: 16px 18px 12px; }
.picker h3 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.picker .tabs { display: flex; gap: 4px; margin-left: 8px; }
.picker .tabs button { background: none; border: 0; color: var(--d-muted); font: inherit; font-weight: 600; font-size: 13px;
  padding: 6px 12px; border-radius: 99px; cursor: pointer; }
.picker .tabs button:hover { color: var(--d-text); background: var(--d-hover); }
.picker .tabs button[aria-selected="true"] { color: var(--d-text); background: var(--d-hover); }
.picker .tabs .n { color: var(--d-muted); font-weight: 500; margin-left: 4px; }
.picker .icon { margin-left: auto; background: none; border: 0; color: var(--d-muted); width: 32px; height: 32px; border-radius: 8px;
  cursor: pointer; font-size: 18px; display: grid; place-items: center; }
.picker .icon + .icon { margin-left: 0; }
.picker .icon:hover { background: var(--d-hover); color: var(--d-text); }
.picker .grid { flex: 1; overflow-y: auto; padding: 4px 18px 18px; display: grid; gap: 12px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); scrollbar-width: thin; }
.src { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 12px;
  outline: none; }
.src .shot { aspect-ratio: 16 / 9; border-radius: 10px; background: var(--d-card); border: 2px solid transparent;
  display: grid; place-items: center; overflow: hidden; position: relative; transition: border-color .12s; }
.src .shot img { width: 100%; height: 100%; object-fit: contain; display: block; }
.src .shot .ph { color: var(--d-muted); font-size: 22px; font-weight: 650; }
.src .shot .badge { position: absolute; left: 8px; top: 8px; font-size: 11px; font-weight: 650; background: rgb(0 0 0 / .6);
  color: #fff; padding: 2px 7px; border-radius: 99px; }
.src:hover .shot { border-color: color-mix(in srgb, var(--d-accent) 45%, transparent); }
.src:focus-visible .shot { border-color: color-mix(in srgb, var(--d-accent) 70%, transparent); }
.src[aria-pressed="true"] .shot { border-color: var(--d-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--d-accent) 25%, transparent); }
.src .t { font-weight: 600; font-size: 13px; margin-top: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.src .d { color: var(--d-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skel .shot { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .55; } }
.picker .empty { grid-column: 1 / -1; color: var(--d-muted); text-align: center; padding: 48px 0; }

.picker footer { border-top: 1px solid var(--d-line); padding: 12px 18px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.picker .opt { display: flex; align-items: center; gap: 8px; }
.picker .opt > span { color: var(--d-muted); font-size: 12px; font-weight: 600; }
.picker .seg button { padding: 5px 10px; font-size: 12.5px; }
.picker .aud { display: flex; align-items: center; gap: 8px; color: var(--d-muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.picker .grow { flex: 1; }
.picker .link { background: none; border: 0; color: var(--d-muted); font: inherit; font-size: 12.5px; cursor: pointer; padding: 6px 4px; }
.picker .link:hover { color: var(--d-text); text-decoration: underline; }
.picker .go { padding: 9px 18px; font-weight: 650; display: flex; align-items: center; gap: 8px; }
.picker .go i { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
.picker .err { color: #ff8a8a; font-size: 12.5px; width: 100%; }

.live { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2147483646;
  display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 12px; border-radius: 99px;
  background: color-mix(in srgb, var(--d-bg) 88%, transparent); color: var(--d-text);
  border: 1px solid var(--d-line); box-shadow: 0 10px 30px rgb(0 0 0 / .4);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  font: 13px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; animation: liveIn .25s cubic-bezier(.2,.8,.2,1);
  user-select: none; }
@keyframes liveIn { from { opacity: 0; transform: translate(-50%, -8px); } }
.live .rec { display: flex; align-items: center; gap: 7px; font-weight: 700; letter-spacing: .04em; font-size: 11.5px; }
.live .rec i { width: 8px; height: 8px; border-radius: 50%; background: #f04848; box-shadow: 0 0 0 0 rgb(240 72 72 / .6);
  animation: ping 1.8s infinite; }
@keyframes ping { 70% { box-shadow: 0 0 0 7px rgb(240 72 72 / 0); } 100% { box-shadow: 0 0 0 0 rgb(240 72 72 / 0); } }
.live .what { color: var(--d-muted); white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.live .time { font-variant-numeric: tabular-nums; font-weight: 600; }
.live .seg { padding: 2px; border-radius: 99px; }
.live .seg button { padding: 5px 10px; border-radius: 99px; font-size: 12px; }
.live .stop { background: #e5484d; color: #fff; border: 0; border-radius: 99px; padding: 7px 14px; font: inherit;
  font-weight: 650; cursor: pointer; }
.live .stop:hover { background: #d13a3f; }
.live .min { background: none; border: 0; color: var(--d-muted); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 14px; }
.live .min:hover { background: var(--d-hover); color: var(--d-text); }
.live.small .what, .live.small .seg, .live.small .time { display: none; }
@media (prefers-reduced-motion: reduce) { .share-scrim, .picker, .live, .live .rec i, .skel .shot { animation: none; } }
`;

let shareStylesAdded = false;
function shareLayer() {
  const p = ui();
  if (!p) return null;
  if (!shareStylesAdded) { p.addStyles(SHARE_CSS); shareStylesAdded = true; }
  return p.layer;
}

const cancelled = () => new DOMException('Screen share was cancelled', 'NotAllowedError');

// ── Native capture: receiving frames ─────────────────────────────────────────

let native = null; // the active native share

function onSharedBuffer(e) {
  let buf, meta;
  try { buf = e.getBuffer(); meta = e.additionalData || {}; } catch (_) { return; }
  const s = native;
  try {
    if (s && meta.k === 'v') s.pushVideo(buf, meta);
    else if (s && meta.k === 'a') s.pushAudio(buf, meta);
  } catch (err) {
    console.warn('[Driftcord] frame dropped', err);
  } finally {
    try { WV.releaseBuffer(buf); } catch (_) {}
    if (meta.id != null) bridge.invoke('capture_ack', { id: meta.id }).catch(() => {});
  }
}
if (WV && WV.addEventListener) WV.addEventListener('sharedbufferreceived', onSharedBuffer);

window.__driftcordCaptureEnded = () => { if (native) native.end(true); };

/** Builds the MediaStream Discord receives, fed by native frames. */
function createNativeShare(source, opts) {
  const hasGenerator = typeof window.MediaStreamTrackGenerator === 'function' && typeof window.VideoFrame === 'function';
  if (!hasGenerator) throw new Error('This WebView2 version can\'t create native streams');

  const video = new MediaStreamTrackGenerator({ kind: 'video' });
  const vWriter = video.writable.getWriter();
  let audio = null, aWriter = null;
  if (opts.audio && typeof window.AudioData === 'function') {
    audio = new MediaStreamTrackGenerator({ kind: 'audio' });
    aWriter = audio.writable.getWriter();
  }
  try { video.contentHint = (SHARE_MODES[opts.mode] || SHARE_MODES.balanced).hint; } catch (_) {}

  let size = { w: source.width, h: source.height };
  const surface = source.kind === 'screen' ? 'monitor' : 'window';

  // Report sensible track settings (generators report almost nothing).
  const baseSettings = video.getSettings.bind(video);
  video.getSettings = () => ({ ...baseSettings(), width: size.w, height: size.h, frameRate: opts.fps,
    displaySurface: surface, deviceId: 'driftcord:' + source.id, cursor: 'always' });

  const share = {
    source, opts, video, audio, ended: false,
    stream: new MediaStream(audio ? [video, audio] : [video]),

    pushVideo(buf, m) {
      if (share.ended || vWriter.desiredSize <= 0) return;
      const frame = new VideoFrame(buf, {
        format: 'BGRX', codedWidth: m.w, codedHeight: m.h, timestamp: m.t,
        layout: [{ offset: 0, stride: m.stride }],
      });
      size = { w: m.w, h: m.h };
      vWriter.write(frame).catch(() => frame.close());
    },

    pushAudio(buf, m) {
      if (share.ended || !aWriter || aWriter.desiredSize <= 0) return;
      const data = new AudioData({ format: 'f32', sampleRate: 48000, numberOfChannels: 2,
        numberOfFrames: m.n, timestamp: m.t, data: new Float32Array(buf, 0, m.n * 2) });
      aWriter.write(data).catch(() => data.close());
    },

    /** Stop capturing. `external` = ended by the OS (e.g. window closed). */
    end(external) {
      if (share.ended) return;
      share.ended = true;
      if (native === share) native = null;
      bridge.invoke('capture_stop').catch(() => {});
      for (const w of [vWriter, aWriter]) if (w) w.close().catch(() => {});
      for (const t of share.stream.getTracks()) {
        realStop.call(t);
        if (external) t.dispatchEvent(new Event('ended'));
      }
    },
  };

  // Discord calls stop() when you end the stream; make that stop capture too.
  const realStop = MediaStreamTrack.prototype.stop;
  for (const t of share.stream.getTracks()) t.stop = () => share.end(false);

  return share;
}

async function startNativeShare(source, opts) {
  if (native) native.end(false);
  const share = createNativeShare(source, opts);
  native = share; // receive frames as soon as they arrive
  const res = SHARE_RES[opts.res] || SHARE_RES['1080p'];
  try {
    await bridge.invoke('capture_start', { req: {
      source: source.id, maxWidth: res.w, maxHeight: res.h, fps: opts.fps, audio: !!opts.audio && !!share.audio,
    } });
  } catch (e) {
    share.end(false);
    throw e;
  }
  return share.stream;
}

// ── The picker ───────────────────────────────────────────────────────────────

let nativeSupported = null;
async function canShareNatively() {
  if (!store.get('screenshare.native') || !bridge.available() || !WV) return false;
  if (typeof window.MediaStreamTrackGenerator !== 'function') return false;
  if (nativeSupported == null) {
    try { nativeSupported = !!(await bridge.invoke('get_info')).nativeCapture; } catch (_) { nativeSupported = false; }
  }
  return nativeSupported;
}

/** Resolves with { source, opts } or { system: true }; rejects if cancelled. */
function sharePicker() {
  const layer = shareLayer();
  if (!layer) return Promise.resolve({ system: true });

  return new Promise((resolve, reject) => {
    const opts = {
      res: store.get('screenshare.res'), fps: store.get('screenshare.fps'),
      mode: store.get('screenshare.mode'), audio: store.get('screenshare.audio'),
    };
    let sources = null, error = '', tab = store.get('screenshare.lastTab') || 'screen';
    let selected = store.get('screenshare.lastSource') || null;
    let refreshTimer = 0, closed = false, busy = false;

    const scrim = h('div', { class: 'share-scrim' });
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    const grid = h('div', { class: 'grid', role: 'listbox', 'aria-label': 'What to share' });
    const footer = h('footer', {});
    const dialog = h('div', { class: 'picker', role: 'dialog', 'aria-label': 'Share your screen' },
      h('header', {}, h('h3', {}, 'Share your screen'), tabsEl,
        h('button', { class: 'icon', title: 'Refresh', 'aria-label': 'Refresh', onclick: () => load(true) }, '⟳'),
        h('button', { class: 'icon', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => done(null) }, '×')),
      grid, footer);

    const visible = () => (sources || []).filter((s) => s.kind === tab);
    const current = () => (sources || []).find((s) => s.id === selected);

    function done(result) {
      if (closed) return;
      closed = true;
      clearInterval(refreshTimer);
      scrim.remove();
      window.removeEventListener('keydown', onKey, true);
      if (result) resolve(result); else reject(cancelled());
    }

    function goLive(src) {
      src = src || current();
      if (!src || busy) return;
      store.set('screenshare.lastSource', src.id);
      store.set('screenshare.lastTab', src.kind);
      done({ source: src, opts: { ...opts } });
    }

    const seg = (items, value, onPick) => h('div', { class: 'seg' }, items.map(([v, label, title]) =>
      h('button', { 'aria-pressed': String(value === v), title: title || '', onclick: () => { onPick(v); drawFooter(); } }, label)));

    function drawTabs() {
      const count = (k) => (sources || []).filter((s) => s.kind === k).length;
      tabsEl.replaceChildren(...[['screen', 'Screens'], ['window', 'Windows']].map(([k, label]) =>
        h('button', { role: 'tab', 'aria-selected': String(tab === k), onclick: () => {
            tab = k;
            const cur = current();
            if (!cur || cur.kind !== k) { const first = visible()[0]; selected = first ? first.id : null; }
            drawTabs(); drawGrid(); drawFooter();
          } },
          label, sources ? h('span', { class: 'n' }, String(count(k))) : '')));
    }

    function drawGrid() {
      if (!sources) {
        grid.replaceChildren(...Array.from({ length: 6 }, () =>
          h('div', { class: 'src skel' }, h('div', { class: 'shot' }), h('div', { class: 't' }, ' '))));
        return;
      }
      const list = visible();
      if (!list.length) {
        grid.replaceChildren(h('div', { class: 'empty' }, error || (tab === 'window' ? 'No windows to share.' : 'No screens found.')));
        return;
      }
      grid.replaceChildren(...list.map((s) => {
        const shot = h('div', { class: 'shot' });
        if (s.thumb) shot.append(h('img', { src: s.thumb, alt: '', draggable: false }));
        else shot.append(h('span', { class: 'ph' }, (s.detail || s.name || '?').slice(0, 1).toUpperCase()));
        if (s.primary) shot.append(h('span', { class: 'badge' }, 'Main'));
        return h('button', { class: 'src', role: 'option', 'aria-pressed': String(s.id === selected), title: s.name,
          onclick: () => { selected = s.id; drawGrid(); drawFooter(); },
          ondblclick: () => { selected = s.id; goLive(s); } },
          shot, h('div', { class: 't' }, s.name), h('div', { class: 'd' }, s.detail || ' '));
      }));
    }

    function drawFooter() {
      const src = current();
      const audioLabel = src && src.kind === 'window' ? 'App audio' : 'Audio';
      const audio = h('input', { type: 'checkbox', role: 'switch', checked: !!opts.audio,
        onchange: (e) => { opts.audio = e.target.checked; store.set('screenshare.audio', opts.audio); } });
      footer.replaceChildren(...[
        h('div', { class: 'opt' }, h('span', {}, 'Quality'),
          seg(Object.entries(SHARE_RES).map(([k, r]) => [k, r.label]), opts.res,
            (v) => { opts.res = v; store.set('screenshare.res', v); })),
        h('div', { class: 'opt' }, h('span', {}, 'FPS'),
          seg(SHARE_FPS.map((f) => [f, String(f)]), opts.fps, (v) => { opts.fps = v; store.set('screenshare.fps', v); })),
        h('div', { class: 'opt' }, h('span', {}, 'For'),
          seg(Object.entries(SHARE_MODES).map(([k, m]) => [k, m.short, m.desc]), opts.mode,
            (v) => { opts.mode = v; store.set('screenshare.mode', v); })),
        h('label', { class: 'aud', title: src && src.kind === 'screen'
            ? 'Everything you hear, except Driftcord itself' : 'Sound from this app only' },
          h('span', { class: 'switch' }, audio), audioLabel),
        h('span', { class: 'grow' }),
        h('button', { class: 'link', onclick: () => done({ system: true }) }, 'Use Windows picker'),
        h('button', { class: 'btn primary go', disabled: !src, onclick: () => goLive() }, h('i'), 'Go Live'),
        error && sources ? h('div', { class: 'err' }, error) : null,
      ].filter(Boolean));
    }

    async function load(withThumbs) {
      try {
        const list = await bridge.invoke('capture_sources', { thumbs: withThumbs });
        if (closed) return;
        // Keep old thumbnails when a refresh couldn't produce one.
        const prev = new Map((sources || []).map((s) => [s.id, s.thumb]));
        sources = list.map((s) => ({ ...s, thumb: s.thumb || prev.get(s.id) || null }));
        error = '';
        if (!sources.some((s) => s.id === selected)) {
          const pick = sources.find((s) => s.kind === tab && s.primary) || sources.find((s) => s.kind === tab) || sources[0];
          selected = pick ? pick.id : null;
        }
        if (!sources.some((s) => s.kind === tab) && sources.length) tab = sources[0].kind;
      } catch (e) {
        error = 'Couldn\'t list screens and windows: ' + errText(e);
        sources = sources || [];
      }
      if (closed) return;
      const scroll = grid.scrollTop;
      drawTabs(); drawGrid(); drawFooter();
      grid.scrollTop = scroll;
    }

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && !e.target.closest?.('button.link')) { e.preventDefault(); e.stopPropagation(); goLive(); }
    };

    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(null); });
    for (const type of ['keydown', 'keyup', 'keypress']) dialog.addEventListener(type, (e) => { if (e.key !== 'Escape' && e.key !== 'Enter') e.stopPropagation(); });
    scrim.append(dialog);
    layer.append(scrim);
    window.addEventListener('keydown', onKey, true);

    drawTabs(); drawGrid(); drawFooter();
    load(true);
    refreshTimer = setInterval(() => { if (!document.hidden) load(true); }, 4000); // keep previews live
  });
}

// ── Live bar ─────────────────────────────────────────────────────────────────

let live = null; // { stream, bar, timer }

function stopStream(stream) {
  if (native && native.stream === stream) { native.end(true); return; }
  for (const t of stream.getTracks()) {
    t.stop();
    // stop() doesn't fire "ended"; Discord listens for it to end the stream.
    t.dispatchEvent(new Event('ended'));
  }
}

function describeShare(stream) {
  if (native && native.stream === stream) {
    const s = native.source;
    return (s.kind === 'screen' ? s.name : s.detail || s.name) + (native.audio ? ' · with audio' : '');
  }
  const track = stream.getVideoTracks()[0];
  const surface = (track && track.getSettings && track.getSettings().displaySurface) || '';
  return ({ monitor: 'Entire screen', window: 'A window', browser: 'A tab' }[surface] || 'Your screen') +
    (stream.getAudioTracks().length ? ' · with audio' : '');
}

function showLiveBar(stream) {
  const layer = shareLayer();
  if (!layer) return;
  hideLiveBar();

  const started = Date.now();
  const time = h('span', { class: 'time' }, '0:00');
  const what = h('span', { class: 'what' }, describeShare(stream));

  const seg = h('div', { class: 'seg' });
  const drawSeg = () => seg.replaceChildren(...Object.entries(SHARE_MODES).map(([id, m]) =>
    h('button', { 'aria-pressed': String(store.get('screenshare.mode') === id), title: m.desc,
      onclick: () => {
        store.set('screenshare.mode', id);
        for (const t of stream.getVideoTracks()) try { t.contentHint = m.hint; } catch (_) {}
        drawSeg();
      } }, m.short)));
  drawSeg();

  const bar = h('div', { class: 'live', role: 'status', 'aria-label': 'You are sharing your screen' },
    h('span', { class: 'rec' }, h('i'), 'LIVE'), time, what, seg,
    h('button', { class: 'min', title: 'Collapse', onclick: (e) => {
      bar.classList.toggle('small'); e.currentTarget.textContent = bar.classList.contains('small') ? '⌄' : '⌃';
    } }, '⌃'),
    h('button', { class: 'stop', title: 'Stop sharing (Ctrl+Alt+S)', onclick: () => stopStream(stream) }, 'Stop'));
  layer.append(bar);

  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
    time.textContent = hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }, 1000);

  live = { stream, bar, timer };
  const onEnd = () => { if (live && live.stream === stream) hideLiveBar(); };
  for (const t of stream.getTracks()) {
    t.addEventListener('ended', onEnd);
    // Native tracks end through stop(); watch that too.
    const prev = t.stop;
    t.stop = function () { prev.call(this); onEnd(); };
  }
}

function hideLiveBar() {
  if (!live) return;
  clearInterval(live.timer);
  live.bar.remove();
  live = null;
}

// ── getDisplayMedia ──────────────────────────────────────────────────────────

const mediaDevices = navigator.mediaDevices;
if (mediaDevices && mediaDevices.getDisplayMedia) {
  const realGetDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);

  async function systemShare(constraints) {
    const audio = store.get('screenshare.audio');
    const c = { ...constraints };
    c.video = typeof c.video === 'object' && c.video ? { ...c.video } : (c.video ?? true);
    if (audio) {
      // restrictOwnAudio: leave out sound this page plays (your call), so
      // friends don't hear themselves. suppressLocalAudioPlayback stays off so
      // you still hear everything.
      const base = typeof c.audio === 'object' && c.audio ? c.audio : {};
      c.audio = { ...base, restrictOwnAudio: true, suppressLocalAudioPlayback: false };
      c.systemAudio = 'include';
    } else c.audio = false;
    c.selfBrowserSurface ??= 'exclude';
    c.surfaceSwitching ??= 'include';
    c.monitorTypeSurfaces ??= 'include';
    const stream = await realGetDisplayMedia(c);
    const hint = (SHARE_MODES[store.get('screenshare.mode')] || SHARE_MODES.balanced).hint;
    for (const t of stream.getVideoTracks()) try { t.contentHint = hint; } catch (_) {}
    return stream;
  }

  mediaDevices.getDisplayMedia = async function (constraints = {}) {
    let stream;
    if (await canShareNatively()) {
      const pick = await sharePicker();
      if (pick.system) stream = await systemShare(constraints);
      else {
        try {
          stream = await startNativeShare(pick.source, pick.opts);
        } catch (e) {
          toast('Couldn\'t start screen share', { sub: errText(e) });
          throw new DOMException(errText(e), 'NotReadableError');
        }
      }
    } else {
      stream = await systemShare(constraints);
    }
    if (store.get('screenshare.pill')) showLiveBar(stream);
    return stream;
  };
}

// ── Ctrl+Alt+S: start (via Discord's own button) or stop sharing ─────────────

function findShareButton() {
  return [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
    .find((b) => /^share your screen$/i.test(b.getAttribute('aria-label')));
}

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyS')) return;
  e.preventDefault(); e.stopPropagation();
  if (live) { stopStream(live.stream); return; }
  const btn = findShareButton();
  if (btn) btn.click();
  else toast('Join a voice channel to share your screen', { duration: 3500 });
}, true);
