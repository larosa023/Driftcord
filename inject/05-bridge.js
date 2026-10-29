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
