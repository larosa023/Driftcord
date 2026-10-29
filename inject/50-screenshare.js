// ── Screen share ─────────────────────────────────────────────────────────────
// Wraps the browser's getDisplayMedia so every share gets:
//   • a share sheet (optional): pick Smooth / Balanced / Sharp and audio first
//   • modern picker options: system audio, "share this tab instead" switching,
//     and Driftcord's own window hidden from the list
//   • a floating Live bar: timer, live mode switching and a Stop button
// Quality and frame-rate limits stay whatever Discord gives your account; the
// mode sets the encoder's content hint (keep motion fluid vs. keep text crisp).

const SHARE_MODES = {
  motion:   { short: 'Smooth', label: 'Smooth motion', hint: 'motion',
              desc: 'Best for games and video: holds frame rate, softens detail when needed.' },
  balanced: { short: 'Balanced', label: 'Balanced', hint: '',
              desc: 'A good default for most things.' },
  detail:   { short: 'Sharp text', label: 'Sharp text', hint: 'detail',
              desc: 'Best for code, docs and slides: keeps text crisp, may drop frames.' },
};

const SHARE_CSS = `
.share-scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .45); display: grid; place-items: center;
  z-index: 2147483647; animation: fadeIn .15s ease; font: 14px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
@keyframes fadeIn { from { opacity: 0; } }
.sheet { width: min(460px, calc(100vw - 32px)); background: var(--d-bg); color: var(--d-text); border: 1px solid var(--d-line);
  border-radius: 18px; box-shadow: 0 24px 64px rgb(0 0 0 / .5); padding: 22px; animation: sheetIn .2s cubic-bezier(.2,.8,.2,1); }
@keyframes sheetIn { from { opacity: 0; transform: translateY(10px) scale(.98); } }
.sheet h3 { margin: 0 0 4px; font-size: 18px; font-weight: 650; letter-spacing: -.01em; }
.sheet .lead { color: var(--d-muted); margin: 0 0 16px; font-size: 13px; }
.modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.mode { background: var(--d-card); color: inherit; font: inherit; text-align: left; border: 1px solid var(--d-line);
  border-radius: 12px; padding: 12px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
.mode:hover { border-color: color-mix(in srgb, var(--d-accent) 50%, var(--d-line)); }
.mode[aria-pressed="true"] { border-color: var(--d-accent); box-shadow: 0 0 0 1px var(--d-accent);
  background: color-mix(in srgb, var(--d-accent) 10%, var(--d-card)); }
.mode svg { width: 22px; height: 22px; color: var(--d-accent); }
.mode .t { font-weight: 600; font-size: 13px; }
.mode .s { color: var(--d-muted); font-size: 11.5px; line-height: 1.35; }
.sheet .row { border: 0; padding: 12px 0 0; }
.sheet .actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 18px; }
.sheet .actions .skip { margin-right: auto; color: var(--d-muted); font-size: 12.5px; display: flex; gap: 6px; align-items: center; cursor: pointer; }
.sheet .actions .skip input { accent-color: var(--d-accent); }
.sheet .go { padding: 9px 16px; }

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
  animation: pulse 1.8s infinite; }
@keyframes pulse { 70% { box-shadow: 0 0 0 7px rgb(240 72 72 / 0); } 100% { box-shadow: 0 0 0 0 rgb(240 72 72 / 0); } }
.live .what { color: var(--d-muted); white-space: nowrap; }
.live .time { font-variant-numeric: tabular-nums; font-weight: 600; }
.live .seg { padding: 2px; border-radius: 99px; }
.live .seg button { padding: 5px 10px; border-radius: 99px; font-size: 12px; }
.live .stop { background: #e5484d; color: #fff; border: 0; border-radius: 99px; padding: 7px 14px; font: inherit;
  font-weight: 650; cursor: pointer; }
.live .stop:hover { background: #d13a3f; }
.live .min { background: none; border: 0; color: var(--d-muted); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 14px; }
.live .min:hover { background: var(--d-hover); color: var(--d-text); }
.live.small .what, .live.small .seg, .live.small .time { display: none; }
@media (prefers-reduced-motion: reduce) { .share-scrim, .sheet, .live, .live .rec i { animation: none; } }
`;

const MODE_ICONS = {
  motion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h3M2 8h5M4 16h3"/><path d="M10 6l9 6-9 6z"/></svg>',
  balanced: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  detail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>',
};

let shareStylesAdded = false;
function shareLayer() {
  const p = ui();
  if (!p) return null;
  if (!shareStylesAdded) { p.addStyles(SHARE_CSS); shareStylesAdded = true; }
  return p.layer;
}

const cancelled = () => new DOMException('Screen share was cancelled', 'NotAllowedError');

// The sheet shown before the system picker. Resolves with the chosen options.
function shareSheet(initial) {
  const layer = shareLayer();
  if (!layer) return Promise.resolve(initial);

  return new Promise((resolve, reject) => {
    const state = { ...initial };
    const scrim = h('div', { class: 'share-scrim' });
    const done = (ok) => {
      scrim.remove();
      window.removeEventListener('keydown', onKey, true);
      ok ? resolve(state) : reject(cancelled());
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };

    const modes = h('div', { class: 'modes' });
    const drawModes = () => modes.replaceChildren(...Object.entries(SHARE_MODES).map(([id, m]) => {
      const icon = h('span');
      icon.insertAdjacentHTML('beforeend', MODE_ICONS[id]);
      return h('button', { class: 'mode', 'aria-pressed': String(state.mode === id),
        onclick: () => { state.mode = id; store.set('screenshare.mode', id); drawModes(); } },
        icon, h('span', { class: 't' }, m.label), h('span', { class: 's' }, m.desc));
    }));
    drawModes();

    const audio = h('input', { type: 'checkbox', role: 'switch', checked: !!state.audio,
      onchange: (e) => { state.audio = e.target.checked; store.set('screenshare.audio', state.audio); } });
    const skip = h('input', { type: 'checkbox',
      onchange: (e) => store.set('screenshare.askEachTime', !e.target.checked) });

    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Share your screen' },
      h('h3', {}, 'Share your screen'),
      h('p', { class: 'lead' }, 'Pick what you\'re showing. Next you\'ll choose a screen, window or tab.'),
      modes,
      h('label', { class: 'row' },
        h('span', { class: 'label' }, 'Share audio', h('span', { class: 'desc' }, 'Sound from what you share')),
        h('span', { class: 'switch' }, audio)),
      h('div', { class: 'actions' },
        h('label', { class: 'skip' }, skip, 'Don\'t show this again'),
        h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: 'btn primary go', onclick: () => done(true) }, 'Choose what to share →')));

    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(false); });
    for (const type of ['keydown', 'keyup', 'keypress']) sheet.addEventListener(type, (e) => e.stopPropagation());
    scrim.append(sheet);
    layer.append(scrim);
    window.addEventListener('keydown', onKey, true);
    sheet.querySelector('.go').focus();
  });
}

// ── Live bar
let live = null; // { stream, bar, timer }

function stopStream(stream) {
  for (const t of stream.getTracks()) {
    t.stop();
    // stop() doesn't fire "ended"; Discord listens for it to end the stream.
    t.dispatchEvent(new Event('ended'));
  }
}

function surfaceName(track) {
  const s = (track.getSettings && track.getSettings().displaySurface) || '';
  return { monitor: 'Entire screen', window: 'A window', browser: 'A tab' }[s] || 'Your screen';
}

function showLiveBar(stream) {
  const layer = shareLayer();
  if (!layer) return;
  hideLiveBar();

  const video = stream.getVideoTracks()[0];
  const started = Date.now();
  const time = h('span', { class: 'time' }, '0:00');
  const what = h('span', { class: 'what' }, surfaceName(video) + (stream.getAudioTracks().length ? ' · with audio' : ''));

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
  for (const t of stream.getTracks()) t.addEventListener('ended', onEnd);
}

function hideLiveBar() {
  if (!live) return;
  clearInterval(live.timer);
  live.bar.remove();
  live = null;
}

// ── getDisplayMedia wrapper
const mediaDevices = navigator.mediaDevices;
if (mediaDevices && mediaDevices.getDisplayMedia) {
  const realGetDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);

  mediaDevices.getDisplayMedia = async function (constraints = {}) {
    let opts = { mode: store.get('screenshare.mode'), audio: store.get('screenshare.audio') };
    if (store.get('screenshare.askEachTime')) opts = await shareSheet(opts);

    const c = { ...constraints };
    c.video = typeof c.video === 'object' && c.video ? { ...c.video } : (c.video ?? true);
    if (opts.audio) {
      c.audio = c.audio || true;
      c.systemAudio = 'include';
    } else {
      c.audio = false;
    }
    c.selfBrowserSurface ??= 'exclude';  // don't list Driftcord itself
    c.surfaceSwitching ??= 'include';    // "Share this tab instead" while live
    c.monitorTypeSurfaces ??= 'include';

    const stream = await realGetDisplayMedia(c);
    const hint = (SHARE_MODES[opts.mode] || SHARE_MODES.balanced).hint;
    for (const t of stream.getVideoTracks()) try { t.contentHint = hint; } catch (_) {}
    if (store.get('screenshare.pill')) showLiveBar(stream);
    return stream;
  };
}

// ── Ctrl+Alt+S: start (via Discord's own button) or stop sharing
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
