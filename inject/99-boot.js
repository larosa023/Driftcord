// ── Boot ─────────────────────────────────────────────────────────────────────
// Styles go in immediately so the theme is there on first paint; the panel waits
// for <body>.

renderDebloat();
renderTheme();

store.onChange((path) => {
  if (path === '*' || path.startsWith('debloat') || path.startsWith('perf')) renderDebloat();
  if (path === '*' || ['theme', 'accent', 'font', 'customCss'].includes(path)) renderTheme();
});

let panel = null;
function mountPanel() {
  if (panel || !document.body) return;
  panel = createPanel();
  document.body.appendChild(panel.host);
}

// Used by the tray menu's "Driftcord Settings" item.
window.__driftcordOpen = () => { mountPanel(); panel && panel.toggle(true); };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
else mountPanel();

// Discord re-renders <body> children aggressively; re-attach if we get removed.
new MutationObserver(() => {
  if (panel && !panel.host.isConnected && document.body) document.body.appendChild(panel.host);
}).observe(document.documentElement, { childList: true, subtree: false });
setInterval(() => {
  if (panel && !panel.host.isConnected && document.body) document.body.appendChild(panel.host);
}, 3000);

console.log('%c Driftcord ' + VERSION + ' loaded ', 'background:#4fa3ff;color:#fff;border-radius:4px;padding:2px 4px');
