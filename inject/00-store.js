// ── Settings store ────────────────────────────────────────────────────────────
// Discord deletes `window.localStorage` once it boots, so grab a reference now
// (this script runs before any of Discord's code).

const LS = window.localStorage;
const STORE_KEY = 'driftcord:settings';
const VERSION = '0.2.2';

const DEFAULTS = {
  theme: 'drift',
  accent: '',            // '' = use the theme's accent
  font: '',              // '' = Discord default
  customCss: '',
  showEdgeTab: true,
  showTopbarButton: true, // Driftcord icon next to Inbox
  privacy: {
    telemetry: true,     // analytics + "science" pings
    crashReports: true,  // Sentry / error reporting
    silentTyping: false, // don't tell others you're typing
  },
  debloat: {},           // filled from DEBLOAT_RULES defaults
  perf: {
    reduceMotion: false,
    noBlur: false,
  },
  screenshare: {
    mode: 'balanced',    // 'motion' | 'balanced' | 'detail'
    audio: true,         // offer system/tab audio
    askEachTime: true,   // show the share sheet before the picker
    pill: true,          // floating "Live" controls while sharing
  },
  updates: {
    auto: true,          // check GitHub for new Driftcord versions
  },
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

const store = (() => {
  let data = structuredClone(DEFAULTS);
  try {
    const raw = LS && LS.getItem(STORE_KEY);
    if (raw) data = deepMerge(data, JSON.parse(raw));
  } catch (e) {
    console.warn('[Driftcord] could not read settings, using defaults', e);
  }

  const listeners = new Set();
  let saveTimer = 0;

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { LS && LS.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) { /* storage full or blocked */ }
    }, 150);
  };

  return {
    get(path) {
      return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
    },
    set(path, value) {
      const keys = path.split('.');
      let o = data;
      for (const k of keys.slice(0, -1)) o = o[k] ??= {};
      o[keys.at(-1)] = value;
      save();
      listeners.forEach((fn) => fn(path, value));
    },
    all: () => data,
    reset() {
      data = structuredClone(DEFAULTS);
      applyDebloatDefaults();
      save();
      listeners.forEach((fn) => fn('*'));
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

// Inject a <style> that we own and can rewrite later.
function ownStyle(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    const mount = () => (document.head || document.documentElement).appendChild(el);
    if (document.documentElement) mount();
    else new MutationObserver((_, obs) => {
      if (document.documentElement) { obs.disconnect(); mount(); }
    }).observe(document, { childList: true });
  }
  return el;
}
