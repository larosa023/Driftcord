// ── What's new ───────────────────────────────────────────────────────────────
// Release notes, built into the app so they open instantly and work offline.
// Add an entry at the top of CHANGELOG with every release.

const CHANGELOG = [
  {
    version: '0.4.18', date: '2026-10-30', title: 'Faster links',
    items: [
      ['improved', 'Links open right away: instantly when Discord ignores the click, and after about 0.2 s (was 0.45 s) when Discord took it over and did nothing.'],
    ],
  },
  {
    version: '0.4.17', date: '2026-10-30', title: 'Links open when you click them',
    items: [
      ['fix', 'Clicking a link now opens it in your default browser even when Discord or a mod (like Vencord\'s OpenInApp) swallows the click. Discord still gets the first go, including its "Leaving Discord" warning; if nothing has happened a moment later, Driftcord opens the link itself. A link never opens twice.'],
      ['new', 'About → Links shows how many clicks Driftcord saw and rescued, and why if one failed.'],
    ],
  },
  {
    version: '0.4.16', date: '2026-10-30', title: 'Stream quality, done the Vesktop way',
    items: [
      ['fix', 'Your picked stream quality is now written straight into Discord\'s stream connection (what the voice server and your viewers go by) and kept there while you\'re live, the same way Vesktop does it. Earlier fixes only reached the capture, so Discord kept sending 720p/1080p.'],
      ['new', 'About → Stream shows what Driftcord could reach on Discord\'s side and what Discord is sending. If a viewer still sees less, screenshot that card.'],
    ],
  },
  {
    version: '0.4.15', date: '2026-10-30', title: 'Picked 1440p60? Viewers get 1440p60',
    items: [
      ['fix', 'Discord\'s own "default Go Live quality" (720p30 without Nitro) now answers with what you picked in Driftcord, so Discord captures, encodes and reports your quality instead of quietly replacing it. Your own "LIVE" badge should match your pick too.'],
      ['fix', 'Discord sometimes works on a copy of the share; copies are now held to your pick as well.'],
      ['fix', 'The Windows picker path now asks for your picked quality as well.'],
    ],
  },
  {
    version: '0.4.14', date: '2026-10-30', title: 'Your quality, not Discord\'s',
    items: [
      ['fix', 'The quality and frame rate you pick in Driftcord\'s share picker are what you stream. Discord\'s own profile (720p30 and about 2.5 Mbps without Nitro) no longer pulls it back down a few seconds in.'],
      ['improved', 'Asking for more from Discord\'s menu (e.g. Source with Nitro or FakeNitro) still applies live.'],
    ],
  },
  {
    version: '0.4.13', date: '2026-10-30', title: 'Stream quality you can change',
    items: [
      ['fix', 'Changing stream quality from Discord\'s menu while you\'re live now actually changes it (resolution and frame rate), from the next frame, without restarting the stream.'],
      ['fix', 'Works with FakeNitro\'s unlocked qualities. The "Nitro upsells" cleanup never hides a box that has options in it.'],
    ],
  },
  {
    version: '0.4.12', date: '2026-10-29', title: 'Sharp streams, take two',
    items: [
      ['fix', 'The faster stream start now also applies when Discord attaches your screen after setting up the connection (which it usually does).'],
      ['fix', 'Streams stay at full resolution from the start instead of starting small and growing. When bandwidth is short, Sharp and Balanced drop frame rate instead; Smooth keeps frame rate.'],
    ],
  },
  {
    version: '0.4.11', date: '2026-10-29', title: 'Links work',
    items: [
      ['fix', 'Links open in your default browser again: plain clicks, middle-clicks, "Visit site" after Discord\'s warning, and "Open in browser" on images and embeds.'],
    ],
  },
  {
    version: '0.4.10', date: '2026-10-29', title: 'Pinker Noir',
    items: [
      ['improved', 'Pink Noir is now pure black everywhere: server list, channels, chat, menus and popouts. Only the message box keeps a faint lift so you can see it.'],
    ],
  },
  {
    version: '0.4.9', date: '2026-10-29', title: 'Sharp from the start',
    items: [
      ['fix', 'Streams are clear from the first second instead of starting blurry and sharpening over a few seconds. The encoder now starts at the bitrate your chosen quality needs (Discord\'s limit for your account still applies).'],
      ['improved', 'Lighter in the background: fewer wake-ups while Driftcord sits in the tray.'],
    ],
  },
  {
    version: '0.4.8', date: '2026-10-29', title: 'Cleaner streaming',
    items: [
      ['improved', 'The floating "LIVE" bar is gone while you stream, just like Discord. Stop from Discord\'s own controls, or press Ctrl+Alt+S.'],
    ],
  },
  {
    version: '0.4.7', date: '2026-10-29', title: 'Snappier speaking ring',
    items: [
      ['fix', 'The green speaking ring in voice calls switches on and off instantly instead of fading in late.'],
      ['fix', 'While you\'re in a call, Driftcord stays at full speed even when you\'re in another app (the background memory saver waits until the call ends).'],
    ],
  },
  {
    version: '0.4.6', date: '2026-10-29', title: 'Just one bar',
    items: [
      ['fix', 'The Windows title bar no longer comes back after updating from an older version.'],
      ['new', 'Driftcord\'s logo and name sit at the left of the top bar, with Discord\'s back and forward arrows right after.'],
    ],
  },
  {
    version: '0.4.5', date: '2026-10-29', title: 'Boosted graphics',
    items: [
      ['new', 'Boosted graphics (Clean → Performance) for older PCs: uses your graphics card even when Chromium would fall back to slow software drawing, draws the page on the GPU, and picks the faster card on laptops with two.'],
      ['new', 'If About → Performance finds software rendering, it offers to turn Boosted graphics on for you.'],
      ['fix', 'Safety net: the tray menu gets "Restart with standard graphics" while Boosted graphics is on.'],
    ],
  },
  {
    version: '0.4.4', date: '2026-10-29', title: 'One bar & frame rate',
    items: [
      ['new', 'Windows\' title bar is gone: Discord\'s top bar is the title bar, with minimize, maximize and close at its right end, like the official app.'],
      ['new', 'Drag the bar to move the window, double-click it to maximize. Edges resize as usual.'],
      ['new', 'Frame rate setting (Clean → Performance): 60 fps, or 30 fps for very old PCs.'],
      ['new', 'About → Performance now shows which GPU Driftcord is drawing with, and whether you\'re on battery.'],
      ['new', 'Prefer the old look? About → Use Windows title bar.'],
    ],
  },
  {
    version: '0.4.3', date: '2026-10-29', title: 'Smoother streams',
    items: [
      ['fixed', 'Choppy streams: Vencord/Equicord\'s WebScreenShare plugin forced Discord to encode 4K at 120 fps on a tiny bitrate. Driftcord now turns it off, since its own picker handles quality.'],
      ['fixed', 'The 2160p / 120 fps stream options (from that plugin) are gone.'],
      ['fixed', 'Even frame pacing when sharing a high-refresh screen (e.g. 144 Hz at 60 fps), so motion no longer judders.'],
    ],
  },
  {
    version: '0.4.2', date: '2026-10-29', title: 'Full frame rate',
    items: [
      ['fixed', 'Discord could be stuck at 30 fps. Graphics runs in its own process again, so it follows your screen\'s refresh rate.'],
      ['new', '"Lighter graphics" option in Clean → Memory saver if you\'d rather save the memory than the frames.'],
      ['new', 'Smoothness meter in About shows Driftcord\'s current frame rate.'],
    ],
  },
  {
    version: '0.4.1', date: '2026-10-29', title: 'Pink Noir',
    items: [
      ['new', 'Pink Noir theme: true black for OLED screens with hot pink accents.'],
    ],
  },
  {
    version: '0.4.0', date: '2026-10-29', title: 'Polish & hardening',
    items: [
      ['fixed', 'Switching what you share mid-stream could freeze the stream or crash Driftcord.'],
      ['fixed', 'Reloading Discord now always stops an active screen share.'],
      ['fixed', 'If capture or audio stops on its own, you get a message instead of a frozen stream.'],
      ['improved', 'Screen share scales smoothly to any quality setting, using far less CPU when sharing a bigger screen at a lower quality.'],
      ['improved', 'The share picker keeps keyboard focus, refreshes previews without flicker, and never stacks refreshes if an app is frozen.'],
      ['improved', 'Esc closes one panel at a time, and Ctrl+Alt shortcuts no longer trigger when typing with AltGr (ś, Đ…).'],
      ['improved', 'No-autoplay is stricter: only a click on that video plays it, not any recent keypress.'],
      ['improved', 'Fewer background threads and file reads, and less page restyling while you adjust themes.'],
      ['improved', 'The tray tooltip shows when you\'re sharing your screen.'],
      ['fixed', 'Only Discord\'s app pages can use Driftcord\'s features, screen share only accepts sources you picked, and plugin network requests can\'t reach your local network.'],
    ],
  },
  {
    version: '0.3.5', date: '2026-10-29', title: 'No echo when sharing your screen',
    items: [
      ['fixed', 'Sharing your entire screen with audio no longer sends your call back to the people in it.'],
      ['fixed', 'The "Use Windows picker" fallback also leaves your call out of shared audio.'],
    ],
  },
  {
    version: '0.3.4', date: '2026-10-29', title: 'Lighter in the background',
    items: [
      ['new', 'Driftcord now frees memory after 2 minutes in another app, while staying on screen. Click back in and it\'s instantly normal.'],
      ['improved', 'Videos you started yourself keep playing when Driftcord trims memory.'],
      ['new', 'Memory monitor in About: JavaScript memory and page size over the last 30 minutes, to spot leaks.'],
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
  window.removeEventListener('resize', closeChangelog);
  news.pop();
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
  for (const type of ['keydown', 'keyup', 'keypress']) el.addEventListener(type, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  document.addEventListener('mousedown', onDown, true);
  window.addEventListener('resize', closeChangelog);
  news = { el, onDown, pop: pushOverlay(closeChangelog) };

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
