// ── Title bar ────────────────────────────────────────────────────────────────
// The window has no native title bar. Discord's own top bar takes its place,
// like the official app: drag it to move the window, double-click to
// maximize, and minimize / maximize / close sit at its right end in the
// theme's colors. Thin invisible edges handle resizing. Screens without
// Discord's bar (login, loading) get a slim strip with the same controls.

const WIN_CSS = `
#dc-winctl { display: flex; align-self: stretch; align-items: stretch; margin-left: 8px; flex: none; }
#dc-winctl button { all: unset; width: 46px; display: grid; place-items: center; cursor: default;
  color: var(--interactive-normal, #b5bac1); }
#dc-winctl button:hover { background: var(--background-modifier-hover, rgb(255 255 255 / .08)); color: var(--interactive-hover, #fff); }
#dc-winctl button.close:hover { background: #e81123; color: #fff; }
#dc-winctl svg { width: 10px; height: 10px; }
`;
const WIN_LAYER_CSS = `
.edge-r { position: fixed; z-index: 2147483640; }
.edge-r.n { top: 0; left: 10px; right: 10px; height: 4px; cursor: n-resize; }
.edge-r.s { bottom: 0; left: 10px; right: 10px; height: 5px; cursor: s-resize; }
.edge-r.e { right: 0; top: 10px; bottom: 10px; width: 5px; cursor: e-resize; }
.edge-r.w { left: 0; top: 10px; bottom: 10px; width: 5px; cursor: w-resize; }
.edge-r.ne { top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize; }
.edge-r.nw { top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize; }
.edge-r.se { bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize; }
.edge-r.sw { bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize; }
.winstrip { position: fixed; top: 0; left: 0; right: 0; height: 32px; z-index: 2147483639; display: flex; justify-content: flex-end;
  background: var(--d-bg); color: var(--d-muted); }
.winstrip button { all: unset; width: 46px; display: grid; place-items: center; }
.winstrip button:hover { background: var(--d-hover); color: var(--d-text); }
.winstrip button.close:hover { background: #e81123; color: #fff; }
.winstrip svg { width: 10px; height: 10px; }
.hidden { display: none !important; }
`;

const WIN_ICONS = {
  min: '<svg viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>',
  max: '<svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  restore: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V.5h7v7h-2"/></svg>',
  close: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>',
};

let winMaximized = false;
const winButtons = new Set(); // every maximize button, to swap its icon

function winControls(tag) {
  const make = (cls, title, icon, run) => {
    const b = document.createElement('button');
    b.className = cls; b.title = title; b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); run(b); });
    return b;
  };
  const box = document.createElement(tag);
  const max = make('max', 'Maximize', WIN_ICONS.max, () => bridge.invoke('win_toggle_maximize').then(setMaximized).catch(() => {}));
  winButtons.add(max);
  box.append(
    make('min', 'Minimize', WIN_ICONS.min, () => bridge.invoke('win_minimize').catch(() => {})),
    max,
    make('close close', 'Close to tray', WIN_ICONS.close, () => bridge.invoke('win_close').catch(() => {})),
  );
  return box;
}

function setMaximized(max) {
  winMaximized = !!max;
  for (const b of winButtons) {
    if (!b.isConnected) { winButtons.delete(b); continue; }
    b.innerHTML = winMaximized ? WIN_ICONS.restore : WIN_ICONS.max;
    b.title = winMaximized ? 'Restore' : 'Maximize';
  }
  if (winEdges) winEdges.forEach((el) => el.classList.toggle('hidden', winMaximized || !!document.fullscreenElement));
}

// Things in the bar you click rather than drag.
const INTERACTIVE = 'button, a, input, textarea, select, [role="button"], [role="tab"], [role="link"], [role="textbox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function wireDrag(el) {
  // Once a drag starts Windows owns the mouse, so a double-click shows up as
  // a second mousedown (detail 2) rather than a dblclick event.
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const t = e.composedPath()[0];
    if (!(t instanceof Element) || t.closest(INTERACTIVE) || t.closest('#dc-winctl')) return;
    e.preventDefault();
    if (e.detail === 2) bridge.invoke('win_toggle_maximize').then(setMaximized).catch(() => {});
    else if (e.detail === 1) bridge.invoke('win_drag').catch(() => {});
  });
}

/** Discord's top bar: the full-width strip at the very top that holds Inbox. */
function findDiscordBar() {
  const anchor = findTopbarAnchor();
  if (!anchor) return null;
  const minWidth = window.innerWidth * 0.6;
  for (let n = anchor.parentElement, depth = 0; n && n !== document.body && depth < 8; n = n.parentElement, depth++) {
    const r = n.getBoundingClientRect();
    if (r.top <= 2 && r.width >= minWidth && r.height >= 24 && r.height <= 72) return n;
  }
  return null;
}

let winBar = null;     // Discord's bar we've taken over
let winStrip = null;   // fallback strip in our layer
let winEdges = null;

function ensureTitlebar() {
  const fs = !!document.fullscreenElement;
  // Fast path: our controls are still in the same, still-attached bar.
  if (winBar && winBar.isConnected && winBar.lastElementChild && winBar.lastElementChild.id === 'dc-winctl') {
    if (winStrip) winStrip.classList.add('hidden');
    return;
  }
  const bar = findDiscordBar();
  if (bar) {
    if (bar !== winBar) { winBar = bar; wireDrag(bar); }
    const ctl = document.getElementById('dc-winctl') || winControls('div');
    ctl.id = 'dc-winctl';
    bar.append(ctl);
    if (winStrip) winStrip.classList.add('hidden');
    return;
  }
  // No Discord bar on this screen: show the slim strip instead.
  const p = ui();
  if (!p) return;
  if (!winStrip) {
    winStrip = winControls('div');
    winStrip.className = 'winstrip';
    wireDrag(winStrip);
    p.layer.append(winStrip);
  }
  winStrip.classList.toggle('hidden', fs);
}

function startTitlebar() {
  if (!bridge.available()) return;
  bridge.invoke('get_info').then((info) => {
    if (info.nativeTitlebar) return; // using Windows' own title bar
    ownStyle('driftcord-winctl').textContent = WIN_CSS;
    const p = ui();
    if (p) {
      p.addStyles(WIN_LAYER_CSS);
      winEdges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((edge) => {
        const el = h('div', { class: 'edge-r ' + edge });
        el.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          bridge.invoke('win_resize', { edge }).catch(() => {});
        });
        p.layer.append(el);
        return el;
      });
    }
    ensureTitlebar();
    bridge.invoke('win_is_maximized').then(setMaximized).catch(() => {});
    // Discord re-renders its bar; re-attach cheaply (no DOM observers).
    setInterval(() => { if (!document.hidden) ensureTitlebar(); }, 700);
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => bridge.invoke('win_is_maximized').then(setMaximized).catch(() => {}), 150);
    });
    document.addEventListener('fullscreenchange', () => { setMaximized(winMaximized); ensureTitlebar(); });
  }).catch(() => {});
}
