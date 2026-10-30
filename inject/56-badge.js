// ── Taskbar badge ────────────────────────────────────────────────────────────
// Discord's page title carries the unread state: "(4) Discord" for mentions,
// a leading bullet for plain unreads. Draw it as a red overlay on the taskbar
// icon, like Discord's own app does.

const badge = (() => {
  let last = 0;

  function readTitle() {
    const t = document.title || '';
    const m = /^\s*\((\d+)\)/.exec(t);
    if (m) return Math.min(parseInt(m[1], 10), 999);
    if (/^\s*[•●]/.test(t)) return -1;      // unread, nothing mentioned
    return 0;
  }

  // 32×32 RGBA: red disc, white number (or a small white dot for plain unreads).
  function draw(n) {
    const S = 32, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    if (n === -1) {
      g.fillStyle = '#ed4245';
      g.beginPath(); g.arc(S / 2, S / 2, 9, 0, Math.PI * 2); g.fill();
      return Array.from(g.getImageData(0, 0, S, S).data);
    }
    const text = n > 99 ? '99+' : String(n);
    g.fillStyle = '#ed4245';
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${text.length === 1 ? 22 : text.length === 2 ? 18 : 14}px "gg sans", "Segoe UI", sans-serif`;
    g.fillText(text, S / 2, S / 2 + 1);
    return Array.from(g.getImageData(0, 0, S, S).data);
  }

  function sync() {
    const n = readTitle();
    if (n === last) return;
    last = n;
    if (!bridge.available()) { last = 0; return; }
    bridge.invoke('set_badge', { rgba: n === 0 ? [] : draw(n), width: 32, height: 32 }).catch(() => { last = 0; });
  }

  function start() {
    sync();
    const t = document.querySelector('title');
    if (t) new MutationObserver(sync).observe(t, { childList: true, characterData: true, subtree: true });
    setInterval(() => { if (!document.hidden) sync(); }, 10000);    // <title> gets replaced sometimes
  }
  return { start, readTitle };
})();
