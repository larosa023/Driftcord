// ── Top bar button ───────────────────────────────────────────────────────────
// Puts a Driftcord icon next to Discord's Inbox icon. It borrows the Inbox
// button's own classes so it matches Discord's look in every layout, and gets
// re-added whenever Discord re-renders the bar. Clicking opens a quick menu.

const TOPBAR_ID = 'driftcord-topbar-btn';
const TOPBAR_ANCHORS = ['Inbox', 'Help']; // aria-labels to sit next to (English UI)

const QUICK_CSS = `
.quick { position: fixed; z-index: 2147483647; width: 300px; background: var(--d-bg); color: var(--d-text);
  border: 1px solid var(--d-line); border-radius: 14px; box-shadow: 0 16px 40px rgb(0 0 0 / .45); padding: 12px;
  font: 14px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; animation: quickIn .16s cubic-bezier(.2,.8,.2,1); }
@keyframes quickIn { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
.quick .qh { display: flex; align-items: center; gap: 8px; padding: 2px 4px 10px; }
.quick .qh b { font-weight: 650; }
.quick .qh span { color: var(--d-muted); font-size: 12px; margin-left: auto; }
.quick .ql { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--d-muted); font-weight: 650; padding: 2px 4px 8px; }
.quick .sw { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; padding: 0 4px 12px; }
.quick .sw button { aspect-ratio: 1; border-radius: 50%; border: 2px solid transparent; padding: 0; cursor: pointer;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / .12); }
.quick .sw button:hover { transform: scale(1.1); }
.quick .sw button[aria-pressed="true"] { border-color: var(--d-text); }
.quick .tn { color: var(--d-muted); font-size: 12px; padding: 0 4px 10px; margin-top: -4px; }
.quick .items { border-top: 1px solid var(--d-line); padding-top: 6px; display: grid; }
.quick .item { display: flex; align-items: center; gap: 10px; width: 100%; background: none; border: 0; color: inherit; font: inherit;
  padding: 8px; border-radius: 8px; cursor: pointer; text-align: left; }
.quick .item:hover, .quick .item:focus-visible { background: var(--d-hover); outline: none; }
.quick .item svg { width: 18px; height: 18px; color: var(--d-muted); flex: none; }
.quick .item .v { margin-left: auto; color: var(--d-muted); font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .quick { animation: none; } }
`;

const ICONS = {
  look: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8z"/><circle cx="7.5" cy="10.5" r="1.2"/><circle cx="11" cy="7" r="1.2"/><circle cx="15.5" cy="8" r="1.2"/>',
  mods: '<path d="M14 4h6v6M20 4l-7 7M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  share: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M12 13V8M9.5 10.5 12 8l2.5 2.5"/>',
  clean: '<path d="M4 20l7-7M14 4l6 6-7 7-6-6z"/>',
  update: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const svgIcon = (name) => {
  const s = h('span', { style: 'display:contents' });
  s.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`);
  return s.firstChild;
};

// ── Quick menu
let quick = null;
let quickStyles = false;

function closeQuick() {
  if (!quick) return;
  quick.el.remove();
  document.removeEventListener('mousedown', quick.onDown, true);
  window.removeEventListener('keydown', quick.onKey, true);
  window.removeEventListener('resize', closeQuick);
  quick = null;
}

function openQuick(anchor) {
  const p = ui();
  if (!p) return;
  if (!quickStyles) { p.addStyles(QUICK_CSS); quickStyles = true; }
  closeQuick();

  const el = h('div', { class: 'quick', role: 'menu', 'aria-label': 'Driftcord' });
  const go = (tab) => () => { closeQuick(); p.toggle(true, tab); };

  const draw = () => {
    const cur = THEMES[store.get('theme')] || THEMES.stock;
    const sw = h('div', { class: 'sw' }, Object.entries(THEMES).map(([id, t]) => {
      const b = h('button', { title: t.name, 'aria-label': t.name + ' theme', 'aria-pressed': String(store.get('theme') === id),
        onclick: () => { store.set('theme', id); draw(); } });
      b.style.background = t.palette
        ? `linear-gradient(135deg, ${t.palette.base1} 0 50%, ${t.palette.accent} 50% 100%)`
        : 'linear-gradient(135deg, #313338 0 50%, #5865f2 50% 100%)';
      return b;
    }));

    const modItem = h('button', { class: 'item', role: 'menuitem', onclick: go('Mods') },
      svgIcon('mods'), 'Mods & plugins', h('span', { class: 'v' }, '…'));
    if (bridge.available()) {
      bridge.invoke('get_info').then((info) => {
        const m = info.mods.find((x) => x.id === info.loadedMod);
        modItem.querySelector('.v').textContent = m ? m.name : 'Off';
      }).catch(() => { modItem.querySelector('.v').textContent = ''; });
    } else modItem.querySelector('.v').textContent = '';

    el.replaceChildren(
      h('div', { class: 'qh' }, h('b', {}, 'Driftcord'), h('span', {}, 'v' + VERSION)),
      h('div', { class: 'ql' }, 'Theme'),
      sw,
      h('div', { class: 'tn' }, cur.name + ' · ' + cur.note),
      h('div', { class: 'items' },
        h('button', { class: 'item', role: 'menuitem', onclick: go('Look') }, svgIcon('look'), 'Themes & appearance'),
        modItem,
        h('button', { class: 'item', role: 'menuitem', onclick: go('Share') }, svgIcon('share'), 'Screen share',
          h('span', { class: 'v' }, (SHARE_MODES[store.get('screenshare.mode')] || SHARE_MODES.balanced).short)),
        h('button', { class: 'item', role: 'menuitem', onclick: go('Clean') }, svgIcon('clean'), 'Clean up & privacy'),
        h('button', { class: 'item', role: 'menuitem', onclick: () => { closeQuick(); checkForUpdates(true); } },
          svgIcon('update'), 'Check for updates'),
        h('button', { class: 'item', role: 'menuitem', onclick: go() }, svgIcon('settings'), 'All settings',
          h('span', { class: 'v' }, 'Ctrl+Alt+D'))),
    );
  };
  draw();

  // Position under the button, kept inside the window.
  const r = anchor.getBoundingClientRect();
  el.style.top = Math.round(r.bottom + 8) + 'px';
  el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - 308, r.right - 300))) + 'px';
  p.layer.append(el);

  const onDown = (e) => {
    const path = e.composedPath();
    if (!path.includes(el) && !path.includes(anchor)) closeQuick();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQuick(); } };
  for (const type of ['keydown', 'keyup', 'keypress']) el.addEventListener(type, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  document.addEventListener('mousedown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeQuick);
  quick = { el, onDown, onKey };
  el.querySelector('.item').focus({ preventScroll: true });
}

// ── The button itself
function findTopbarAnchor() {
  for (const label of TOPBAR_ANCHORS) {
    const el = document.querySelector(`[aria-label="${label}"][role="button"], button[aria-label="${label}"]`);
    if (el && !el.dataset.driftcord) return el;
  }
  return null;
}

const WAVE_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 13c3-3 6 3 9 0s6 3 9 0M3 18c3-3 6 3 9 0s6 3 9 0"/></svg>';
const NEWS_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3l1.9 4.6L19 9.5l-4.1 3.1L16.2 18 12 15.3 7.8 18l1.3-5.4L5 9.5l5.1-1.9z"/></svg>';

/** A button that borrows the Inbox button's own classes so it matches Discord. */
function buildTopbarButton(anchor, spec) {
  const btn = document.createElement(anchor.tagName === 'BUTTON' ? 'button' : 'div');
  btn.id = spec.id;
  btn.dataset.driftcord = '1';
  btn.className = anchor.className;
  btn.style.position = 'relative';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.setAttribute('aria-label', spec.label);
  btn.title = spec.title;

  const anchorSvg = anchor.querySelector('svg');
  btn.insertAdjacentHTML('beforeend', spec.svg);
  const svg = btn.querySelector('svg');
  if (anchorSvg) {
    const cls = anchorSvg.getAttribute('class');
    if (cls) svg.setAttribute('class', cls);
    for (const a of ['width', 'height']) if (anchorSvg.getAttribute(a)) svg.setAttribute(a, anchorSvg.getAttribute(a));
  }

  const activate = (e) => { e.preventDefault(); e.stopPropagation(); spec.onActivate(btn); };
  btn.addEventListener('click', activate);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activate(e); });
  return btn;
}

const TOPBAR_BUTTONS = [
  { id: 'driftcord-news-btn', label: 'What\'s new in Driftcord', title: 'What\'s new in Driftcord', svg: NEWS_SVG,
    setting: 'showNewsButton', onActivate: (btn) => toggleChangelog(btn), decorate: (btn) => markNewsButton(btn) },
  { id: TOPBAR_ID, label: 'Driftcord', title: 'Driftcord: themes, mods & settings', svg: WAVE_SVG,
    setting: 'showTopbarButton', onActivate: (btn) => (quick ? closeQuick() : openQuick(btn)) },
];
const topbarEls = new Map(); // id -> element

function ensureTopbarButton() {
  const anchor = findTopbarAnchor();
  // Buttons sit in order, immediately before the anchor: [news][driftcord][Inbox]
  let next = anchor;
  for (const spec of [...TOPBAR_BUTTONS].reverse()) {
    let el = topbarEls.get(spec.id);
    if (!store.get(spec.setting)) {
      if (el) { el.remove(); topbarEls.delete(spec.id); }
      continue;
    }
    if (!anchor) continue;
    if (!el || el.className !== anchor.className) {
      if (el) el.remove();
      el = buildTopbarButton(anchor, spec);
      topbarEls.set(spec.id, el);
    }
    if (spec.decorate) spec.decorate(el);
    if (!(el.isConnected && el.nextElementSibling === next)) next.parentElement.insertBefore(el, next);
    next = el;
  }
}

// Discord's DOM changes constantly; batch checks to at most a few per second.
let topbarPending = 0;
function scheduleTopbarCheck() {
  if (topbarPending) return;
  topbarPending = setTimeout(() => { topbarPending = 0; ensureTopbarButton(); }, 300);
}

function startTopbar() {
  ensureTopbarButton();
  new MutationObserver(scheduleTopbarCheck).observe(document.body, { childList: true, subtree: true });
  store.onChange((path) => {
    if (['showTopbarButton', 'showNewsButton', 'news.seen', '*'].includes(path)) ensureTopbarButton();
  });
}
