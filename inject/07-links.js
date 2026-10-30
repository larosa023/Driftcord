// ── Links ────────────────────────────────────────────────────────────────────
// Clicking a link must open it in your default browser. Discord (and mods like
// Vencord's OpenInApp, which rewrites Discord's link handler) decide what a
// click does, and that can end with nothing happening. So this watches clicks
// from the very start of the event (before anyone can stop it), lets Discord
// do its thing (its "Leaving Discord" warning included), and if nothing has
// opened or been asked a moment later, opens the link itself. The app ignores
// a link it already opened, so a click never opens twice.

const linkStats = { clicks: 0, opened: 0, rescued: 0, failed: 0, last: '' };
const realWindowOpen = window.open;
let lastOpened = { url: '', t: -1e9 };

const DISCORD_HOST = /(^|\.)(discord\.com|discordapp\.com|discordapp\.net|discord\.gg|discord\.new|discord\.media)$/i;
const SHORTLINK_HOST = /(^|\.)(spotify\.link|s\.team)$/i; // mods resolve these themselves

function parseLink(href) { try { return new URL(String(href), location.href); } catch (_) { return null; } }

/** Hand a link to the app. Returns false when it isn't something we open. */
function openExternal(href) {
  const u = parseLink(href);
  if (!u || !/^(https?|mailto):$/.test(u.protocol) || !bridge.available()) return false;
  const now = performance.now();
  if (lastOpened.url === u.href && now - lastOpened.t < 800) return true; // double-click, or two routes
  lastOpened = { url: u.href, t: now };
  bridge.invoke('open_link', { url: u.href }).then(() => { linkStats.opened++; }).catch((e) => {
    linkStats.failed++; linkStats.last = errText(e);
    // Backup route: the pop-up request, the same one right-click → Open link uses.
    try { realWindowOpen.call(window, u.href, '_blank'); } catch (_) { /* nothing more to try */ }
    toast('Couldn\'t open the link directly', { sub: errText(e), duration: 6000 });
  });
  return true;
}

// window.open: Discord uses it after its warning, and Vencord's right-click
// "Open Link" does too. Open in the browser and hand back a stand-in window.
window.open = function (url) {
  if (url && String(url) !== 'about:blank') {
    const u = parseLink(url);
    if (u && /^(https?|mailto):$/.test(u.protocol) && openExternal(u.href)) return standInWindow();
    return realWindowOpen.apply(this, arguments);
  }
  return standInWindow(); // window.open() then w.location = url
};

function standInWindow() {
  const go = (v) => { openExternal(v); };
  return {
    closed: false, opener: null, close() { this.closed = true; }, focus() {}, blur() {},
    document: { write() {}, writeln() {}, open() {}, close() {} },
    get location() { return { assign: go, replace: go, set href(v) { go(v); }, get href() { return 'about:blank'; } }; },
    set location(v) { go(v); },
  };
}

const dialogCount = () => document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length;

/** The external link a click landed on, or null (in-app links, downloads,
 *  media you open inside Discord, and our own panel are left alone). */
function externalLinkOf(e) {
  const path = e.composedPath ? e.composedPath() : [];
  if (path.some((n) => n && n.id === 'driftcord-root')) return null;
  const t = path[0] || e.target;
  const a = t instanceof Element ? t.closest('a[href]') : null;
  if (!a || a.hasAttribute('download')) return null;
  const u = parseLink(a.href);
  if (!u) return null;
  if (u.protocol !== 'mailto:' && !/^https?:$/.test(u.protocol)) return null;
  if (DISCORD_HOST.test(u.hostname) || SHORTLINK_HOST.test(u.hostname)) return null;
  // A picture or video that opens inside Discord (even when it links out).
  if (a.querySelector('img, video, canvas') ||
      a.closest('[class*="imageWrapper"], [class*="embedMedia"], [class*="embedVideo"], [class*="mosaic"], [class*="lazyImg"]')) return null;
  return u;
}

function watchClick(e) {
  if (e.type === 'click' ? e.button !== 0 : e.button !== 1) return;
  const u = externalLinkOf(e);
  if (!u) return;
  linkStats.clicks++;
  const t0 = performance.now(), dialogsBefore = dialogCount();
  // After the whole click has been handled (Discord's own code, mods): did
  // anything open the link, or ask first?
  const check = () => {
    if (lastOpened.t >= t0) return;                // an open already went through
    if (dialogCount() > dialogsBefore) return;     // Discord is asking first
    linkStats.rescued++;
    openExternal(u.href);                          // the app skips it if the browser route also fired
  };
  // Nobody took the click over → open now. Discord did take it over → give it
  // a moment to open the link or show its warning first.
  setTimeout(() => { if (e.defaultPrevented) setTimeout(check, 180); else check(); }, 0);
}
// Capture phase on window: first in line, so nothing can swallow the click.
window.addEventListener('click', watchClick, true);
window.addEventListener('auxclick', watchClick, true);

/** About → Links: what Driftcord saw. */
function linkDebugCard() {
  const box = h('div', {});
  const draw = () => {
    box.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Link clicks',
        h('span', { class: 'desc' }, `${linkStats.opened} opened by Driftcord · ${linkStats.rescued} of them rescued after Discord did nothing`)),
        h('b', {}, String(linkStats.clicks))),
      linkStats.failed ? h('p', { class: 'hint' }, `Couldn't open ${linkStats.failed}: ${linkStats.last}`) : null,
    );
  };
  draw();
  const timer = setInterval(() => { if (!box.isConnected) clearInterval(timer); else draw(); }, 2000);
  return box;
}
