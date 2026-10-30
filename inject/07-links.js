// ── Links ────────────────────────────────────────────────────────────────────
// Links open in your default browser. Discord handles a click first (so its
// "Leaving Discord" warning still shows); then the link goes straight to the
// app's open_link command instead of through a pop-up window request, which
// WebView2 can drop.

function openLink(href) {
  let u;
  try { u = new URL(String(href), location.href); } catch (_) { return false; }
  if (!/^(https?|mailto):$/.test(u.protocol)) return false;
  bridge.invoke('open_link', { url: u.href }).catch(() => {});
  return true;
}

/** A link that should leave the app: http(s)/mailto, opened in a new tab or
 *  pointing somewhere other than Discord. */
function externalAnchor(e) {
  const t = e.composedPath ? e.composedPath()[0] : e.target;
  const a = t instanceof Element ? t.closest('a[href]') : null;
  if (!a || a.hasAttribute('download')) return null;
  let u;
  try { u = new URL(a.href, location.href); } catch (_) { return null; }
  if (u.protocol === 'mailto:') return a;
  if (!/^https?:$/.test(u.protocol)) return null;
  const discord = /(^|\.)(discord\.com|discordapp\.com|discord\.gg|discord\.new)$/i.test(u.hostname);
  return a.target === '_blank' || !discord ? a : null;
}

if (bridge.available()) {
  // window.open: Discord uses this after its warning (and some embeds do too).
  const realOpen = window.open;
  window.open = function (url) {
    if (url && openLink(url)) return null;
    if (url && String(url) !== 'about:blank') return realOpen.apply(this, arguments);
    // window.open() then w.location = url: hand back a stand-in that forwards it.
    const go = (v) => { openLink(v); };
    return {
      closed: false, opener: null, close() { this.closed = true; }, focus() {}, blur() {},
      document: { write() {}, writeln() {}, open() {}, close() {} },
      get location() { return { assign: go, replace: go, set href(v) { go(v); }, get href() { return 'about:blank'; } }; },
      set location(v) { go(v); },
    };
  };

  // Plain clicks Discord leaves to the browser (it didn't preventDefault).
  // Bubble phase on window, so Discord's own handlers always run first.
  const onClick = (e) => {
    if (e.defaultPrevented || (e.type === 'click' && e.button !== 0) || (e.type === 'auxclick' && e.button !== 1)) return;
    const a = externalAnchor(e);
    if (!a) return;
    e.preventDefault();
    openLink(a.href);
  };
  window.addEventListener('click', onClick);
  window.addEventListener('auxclick', onClick);
}
