// ── What's new ───────────────────────────────────────────────────────────────
// Release notes, built into the app so they open instantly and work offline.
// Add an entry at the top of CHANGELOG with every release.

const CHANGELOG = [
  {
    version: '0.3.4', date: '2026-10-29', title: 'Lighter in the background',
    items: [
      ['new', 'Driftcord now frees memory after 2 minutes in another app, while staying on screen. Click back in and it\'s instantly normal.'],
      ['improved', 'Videos you started yourself keep playing when Driftcord trims memory.'],
    ],
  },
  {
    version: '0.3.3', date: '2026-10-29', title: 'Faster & lighter',
    items: [
      ['improved', 'Opens straight into your theme\'s color instead of a white flash while Discord loads.'],
      ['improved', 'Driftcord no longer watches Discord\'s whole page for changes, so busy chats cost less CPU.'],
      ['improved', 'Mod updates wait until Discord has finished loading, and run at most twice a day.'],
      ['improved', 'Screen share frame scaling runs on fully optimized code.'],
    ],
  },
  {
    version: '0.3.2', date: '2026-10-29', title: 'What\'s new',
    items: [
      ['new', 'A What\'s new button in the top bar, with a dot when there\'s something you haven\'t read.'],
    ],
  },
  {
    version: '0.3.1', date: '2026-10-29', title: 'Memory saver',
    items: [
      ['new', 'Videos and GIF clips wait for hover or click instead of autoplaying. Calls and streams aren\'t affected.'],
      ['new', 'Leaner JavaScript engine that favors smaller memory over raw speed.'],
      ['new', 'After 2 minutes minimized or in the tray, Driftcord frees memory. Messages and calls keep working.'],
      ['improved', 'All memory options now live together in Clean → Memory saver.'],
    ],
  },
  {
    version: '0.3.0', date: '2026-10-29', title: 'Native screen share & Lean mode',
    items: [
      ['new', 'Driftcord\'s own share picker: live previews, quality, FPS, mode and audio on one screen. No more Windows popup.'],
      ['new', 'Screen capture runs inside Driftcord. Windows share their app\'s audio; screens share everything except Driftcord.'],
      ['new', 'Lean mode: graphics, network and audio folded into one process with a single renderer.'],
      ['new', 'Tray option to restart without Lean mode, just in case.'],
      ['fixed', 'Stray "null" text under the mod list.'],
    ],
  },
  {
    version: '0.2.2', date: '2026-10-29', title: 'Top bar button',
    items: [
      ['new', 'Driftcord icon next to Inbox with a quick menu: one-click themes, mods, screen share and settings.'],
    ],
  },
  {
    version: '0.2.1', date: '2026-10-29', title: 'Mod fixes',
    items: [
      ['fixed', 'Vencord and Equicord settings showing huge, unstyled switches and icons.'],
    ],
  },
  {
    version: '0.2.0', date: '2026-10-29', title: 'Mods, themes & updates',
    items: [
      ['new', 'One-click Vencord or Equicord, kept up to date automatically.'],
      ['new', '10 new themes: Nord, Dracula, Catppuccin, Gruvbox, Tokyo Night, Rosé Pine, Solarized, Forest, Sakura, Graphite.'],
      ['new', 'Share sheet and floating Live bar with timer and Stop. Ctrl+Alt+S starts or stops sharing.'],
      ['new', 'Driftcord now updates itself.'],
    ],
  },
  {
    version: '0.1.0', date: '2026-10-29', title: 'First release',
    items: [
      ['new', 'Discord in a light native window: tray, single instance, remembers its size.'],
      ['new', 'Hide Nitro, Shop, Quests, gift buttons, upsells and more.'],
      ['new', 'Blocks Discord\'s analytics and crash reporting.'],
      ['new', 'Five themes, custom accent, any font and custom CSS.'],
    ],
  },
];

const NEWS_CSS = `
.news { position: fixed; z-index: 2147483647; width: 380px; max-height: min(560px, calc(100vh - 80px)); display: flex; flex-direction: column;
  background: var(--d-bg); color: var(--d-text); border: 1px solid var(--d-line); border-radius: 16px;
  box-shadow: 0 18px 46px rgb(0 0 0 / .48); overflow: hidden;
  font: 14px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; animation: quickIn .16s cubic-bezier(.2,.8,.2,1); }
.news .nh { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--d-line); }
.news .nh b { font-size: 15px; font-weight: 650; }
.news .nh .cur { color: var(--d-muted); font-size: 12px; }
.news .nh button { margin-left: auto; background: none; border: 0; color: var(--d-muted); width: 28px; height: 28px; border-radius: 7px;
  cursor: pointer; font-size: 17px; }
.news .nh button:hover { background: var(--d-hover); color: var(--d-text); }
.news .nb { overflow-y: auto; padding: 6px 16px 16px; scrollbar-width: thin; }
.news .rel { padding: 14px 0 4px; }
.news .rel + .rel { border-top: 1px solid var(--d-line); }
.news .rt { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.news .rt .v { font-weight: 700; font-size: 13px; }
.news .rt .ti { font-weight: 600; font-size: 13px; color: var(--d-text); }
.news .rt .dt { margin-left: auto; color: var(--d-muted); font-size: 11.5px; white-space: nowrap; }
.news .tag { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 1px 6px; border-radius: 5px;
  margin-left: 2px; background: color-mix(in srgb, var(--d-accent) 22%, transparent); color: var(--d-text); }
.news ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.news li { display: grid; grid-template-columns: 58px 1fr; gap: 8px; font-size: 13px; color: var(--d-text); }
.news li .k { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding-top: 2px; }
.news li .k.new { color: var(--d-accent); }
.news li .k.improved { color: #6cc58a; }
.news li .k.fixed { color: #e0a85c; }
.news .rel.old li { color: var(--d-muted); }
`;

// Compare "0.3.1" style versions.
function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

const hasUnreadNews = () => cmpVersion(VERSION, store.get('news.seen')) > 0;

function markNewsButton(btn) {
  let dot = btn.querySelector('.driftcord-dot');
  if (hasUnreadNews()) {
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'driftcord-dot';
      dot.style.cssText = 'position:absolute;top:3px;right:3px;width:8px;height:8px;border-radius:50%;' +
        'background:var(--status-danger,#f23f43);box-shadow:0 0 0 2px var(--background-base-lowest,var(--background-tertiary,#111));pointer-events:none';
      btn.append(dot);
    }
  } else if (dot) dot.remove();
}

let news = null;
let newsStyles = false;

function closeChangelog() {
  if (!news) return;
  news.el.remove();
  document.removeEventListener('mousedown', news.onDown, true);
  window.removeEventListener('keydown', news.onKey, true);
  window.removeEventListener('resize', closeChangelog);
  news = null;
}

function toggleChangelog(anchor) {
  if (news) { closeChangelog(); return; }
  const p = ui();
  if (!p) return;
  if (typeof closeQuick === 'function') closeQuick();
  if (!newsStyles) { p.addStyles(NEWS_CSS); newsStyles = true; }

  const lastSeen = store.get('news.seen');
  const el = h('div', { class: 'news', role: 'dialog', 'aria-label': 'What\'s new in Driftcord' },
    h('div', { class: 'nh' }, h('b', {}, 'What\'s new'), h('span', { class: 'cur' }, 'You\'re on v' + VERSION),
      h('button', { title: 'Close (Esc)', 'aria-label': 'Close', onclick: closeChangelog }, '×')),
    h('div', { class: 'nb' }, CHANGELOG.filter((r) => cmpVersion(r.version, VERSION) <= 0).map((r) => {
      const unread = cmpVersion(r.version, lastSeen) > 0;
      const date = new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return h('section', { class: 'rel' + (unread ? '' : ' old') },
        h('div', { class: 'rt' }, h('span', { class: 'v' }, 'v' + r.version), h('span', { class: 'ti' }, r.title),
          unread ? h('span', { class: 'tag' }, 'New') : null, h('span', { class: 'dt' }, date)),
        h('ul', {}, r.items.map(([kind, text]) =>
          h('li', {}, h('span', { class: 'k ' + kind }, kind), h('span', {}, text)))));
    })));

  const r = anchor.getBoundingClientRect();
  el.style.top = Math.round(r.bottom + 8) + 'px';
  el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - 388, r.right - 380))) + 'px';
  p.layer.append(el);

  const onDown = (e) => { const path = e.composedPath(); if (!path.includes(el) && !path.includes(anchor)) closeChangelog(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChangelog(); } };
  for (const type of ['keydown', 'keyup', 'keypress']) el.addEventListener(type, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  document.addEventListener('mousedown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeChangelog);
  news = { el, onDown, onKey };

  // Opening it counts as reading it.
  if (hasUnreadNews()) store.set('news.seen', VERSION);
}

// After an update, point people at the notes once.
function announceUpdate() {
  const seen = store.get('news.seen');
  if (!seen) {
    // First install: nothing to announce. Existing users from before release
    // notes existed last saw 0.3.1.
    store.set('news.seen', HAD_SETTINGS ? '0.3.1' : VERSION);
    if (!HAD_SETTINGS) return;
  }
  const seenNow = store.get('news.seen');
  if (cmpVersion(VERSION, seenNow) <= 0 || store.get('news.toasted') === VERSION) return;
  store.set('news.toasted', VERSION);
  const latest = CHANGELOG.find((r) => r.version === VERSION);
  setTimeout(() => toast(`Updated to Driftcord ${VERSION}`, {
    sub: latest ? latest.title : undefined, duration: 9000,
    actions: [{ label: 'See what\'s new', primary: true, run: () => {
      const btn = document.getElementById('driftcord-news-btn');
      if (btn) toggleChangelog(btn); else { ui() && ui().toggle(true, 'About'); }
    } }],
  }), 4000);
}
