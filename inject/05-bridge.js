// ── Bridge to the native app ─────────────────────────────────────────────────
// Driftcord's commands (mods, updates) are exposed only to discord.com, through
// Tauri's IPC. In a plain browser this is simply unavailable.

const bridge = {
  available: () => !!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke),
  invoke(cmd, args) {
    if (!bridge.available()) return Promise.reject(new Error('Not running inside Driftcord'));
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
  },
};

const errText = (e) => String((e && e.message) || e || 'Unknown error');

// ── Overlays & shortcuts ─────────────────────────────────────────────────────
// Every Driftcord overlay (panel, menus, picker) registers here. One Escape
// closes only the topmost one, and the key never also reaches Discord.
const overlays = [];
function pushOverlay(close) {
  const entry = { close };
  overlays.push(entry);
  return () => { const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); };
}
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !overlays.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  overlays[overlays.length - 1].close();
}, true);

/** Ctrl+Alt+<key>, but not AltGr (which Windows reports as Ctrl+Alt and is
 *  used for typing characters like ś or Đ) and not auto-repeat. */
function isShortcut(e, code) {
  return e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === code && !e.repeat &&
    !(e.getModifierState && e.getModifierState('AltGraph'));
}
