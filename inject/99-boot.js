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

function onReady() {
  // One failing start-up step must not stop the rest.
  const step = (fn) => { try { fn(); } catch (e) { console.warn('[Driftcord] start-up step failed', e); } };
  step(mountPanel);
  step(startTopbar);
  step(startTitlebar);
  step(() => badge.start());
  step(() => labels.start());
  step(() => reportBackground(((THEMES[store.get('theme')] || {}).palette || {}).base1 || '#2b2d31'));
  step(announceUpdate);
  step(announceRetiredShareMods);
  step(startMonitor);
  step(startUpdateChecks);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
else onReady();

// Discord re-renders <body> children aggressively; re-attach if we get removed.
setInterval(() => {
  if (panel && !panel.host.isConnected && document.body) document.body.appendChild(panel.host);
}, 3000);

const BOOT_MS = performance.now() - BOOT_T0;
console.log('%c Driftcord ' + VERSION + ' loaded (' + BOOT_MS.toFixed(1) + ' ms) ', 'background:#4fa3ff;color:#fff;border-radius:4px;padding:2px 4px');

window.__driftcordBootMs = BOOT_MS;
