// ── Settings panel ───────────────────────────────────────────────────────────
// A slide-in drawer rendered in a shadow root, so Discord's styles can't reach it
// and ours can't leak out. Open with Ctrl+Alt+D, the edge tab, or the tray menu.

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .35); opacity: 0; pointer-events: none;
  transition: opacity .18s ease; z-index: 2147483646; }
.drawer { position: fixed; top: 0; right: 0; height: 100vh; width: min(400px, 100vw);
  background: var(--d-bg); color: var(--d-text); border-left: 1px solid var(--d-line);
  box-shadow: -18px 0 40px rgb(0 0 0 / .35); transform: translateX(102%);
  transition: transform .22s cubic-bezier(.2,.8,.2,1); z-index: 2147483647;
  display: flex; flex-direction: column;
  font: 14px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
.open .scrim { opacity: 1; pointer-events: auto; }
.open .drawer { transform: none; }

header { display: flex; align-items: center; gap: 10px; padding: 18px 18px 12px; }
.logo { width: 26px; height: 26px; border-radius: 8px; background: var(--d-accent); display: grid; place-items: center; }
.logo svg { width: 16px; height: 16px; }
h1 { font-size: 16px; font-weight: 650; margin: 0; letter-spacing: -.01em; }
.ver { color: var(--d-muted); font-size: 12px; margin-left: 2px; }
.x { margin-left: auto; background: none; border: 0; color: var(--d-muted); font-size: 20px; width: 32px; height: 32px;
  border-radius: 8px; cursor: pointer; }
.x:hover { background: var(--d-hover); color: var(--d-text); }

nav { display: flex; gap: 4px; padding: 0 14px 10px; border-bottom: 1px solid var(--d-line); }
nav button { flex: 1; background: none; border: 0; color: var(--d-muted); font: inherit; font-weight: 550;
  padding: 7px 0; border-radius: 8px; cursor: pointer; }
nav button:hover { color: var(--d-text); background: var(--d-hover); }
nav button[aria-selected="true"] { color: var(--d-text); background: var(--d-hover); box-shadow: inset 0 -2px 0 var(--d-accent); }

main { overflow-y: auto; padding: 6px 18px 28px; flex: 1; scrollbar-width: thin; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--d-muted); font-weight: 650;
  margin: 20px 0 8px; }
p.hint { color: var(--d-muted); font-size: 12.5px; margin: 6px 0 0; }

.themes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.theme { text-align: left; background: var(--d-card); border: 1px solid var(--d-line); border-radius: 12px;
  padding: 10px; cursor: pointer; color: inherit; font: inherit; }
.theme:hover { border-color: color-mix(in srgb, var(--d-accent) 50%, var(--d-line)); }
.theme[aria-pressed="true"] { border-color: var(--d-accent); box-shadow: 0 0 0 1px var(--d-accent); }
.swatch { height: 38px; border-radius: 8px; display: flex; overflow: hidden; margin-bottom: 8px; }
.swatch span { flex: 1; }
.swatch .stock { flex: 1; background: linear-gradient(135deg, #1e1f22, #313338 60%, #5865f2); }
.tname { font-weight: 600; font-size: 13px; }
.tnote { color: var(--d-muted); font-size: 11.5px; }

.row { display: flex; align-items: center; gap: 12px; padding: 9px 0; }
.row + .row { border-top: 1px solid var(--d-line); }
.row .label { flex: 1; }
.row .desc { display: block; color: var(--d-muted); font-size: 12px; }

.switch { position: relative; width: 38px; height: 22px; flex: none; }
.switch input { appearance: none; margin: 0; width: 100%; height: 100%; border-radius: 99px; background: var(--d-off);
  cursor: pointer; transition: background .15s; }
.switch input:checked { background: var(--d-accent); }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; pointer-events: none; transition: transform .15s; }
.switch:has(input:checked)::after { transform: translateX(16px); }

input[type=text], textarea { width: 100%; background: var(--d-card); color: var(--d-text); border: 1px solid var(--d-line);
  border-radius: 8px; padding: 8px 10px; font: inherit; outline: none; }
input[type=text]:focus, textarea:focus { border-color: var(--d-accent); }
textarea { min-height: 180px; resize: vertical; font: 12.5px/1.5 "Cascadia Code", Consolas, monospace; tab-size: 2; }
input[type=color] { width: 38px; height: 30px; border: 1px solid var(--d-line); border-radius: 8px; background: none; padding: 2px; cursor: pointer; }

.btn { background: var(--d-card); color: var(--d-text); border: 1px solid var(--d-line); border-radius: 8px;
  padding: 7px 12px; font: inherit; font-weight: 550; cursor: pointer; }
.btn:hover { background: var(--d-hover); }
.btn.danger { color: #ff7b7b; }
.btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
kbd { background: var(--d-card); border: 1px solid var(--d-line); border-bottom-width: 2px; border-radius: 5px;
  padding: 1px 6px; font: 12px Consolas, monospace; }

.edge { position: fixed; right: 0; top: 50%; width: 6px; height: 64px; transform: translateY(-50%);
  background: var(--d-accent); opacity: .35; border-radius: 6px 0 0 6px; cursor: pointer; z-index: 2147483645;
  transition: width .15s, opacity .15s; border: 0; padding: 0; }
.edge:hover { width: 12px; opacity: .9; }
.edge[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .drawer, .scrim { transition: none; } }
`;

const LOGO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 13c3-3 6 3 9 0s6 3 9 0M3 18c3-3 6 3 9 0s6 3 9 0"/></svg>';

function createPanel() {
  const host = h('div', { id: 'driftcord-root' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, PANEL_CSS));

  const wrap = h('div', {});
  const scrim = h('div', { class: 'scrim', onclick: () => toggle(false) });
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Driftcord settings' });
  const edge = h('button', { class: 'edge', title: 'Driftcord settings (Ctrl+Alt+D)', onclick: () => toggle(true) });
  wrap.append(scrim, drawer, edge);
  root.append(wrap);

  // Panel colors follow the active theme.
  function syncColors() {
    const p = (THEMES[store.get('theme')] || {}).palette || THEMES.drift.palette;
    const accent = store.get('accent') || p.accent;
    Object.entries({
      '--d-bg': p.base1, '--d-card': p.base2, '--d-text': p.text, '--d-muted': p.muted, '--d-accent': accent,
      '--d-line': `color-mix(in srgb, ${p.text} 10%, transparent)`,
      '--d-hover': `color-mix(in srgb, ${p.text} 7%, transparent)`,
      '--d-off': `color-mix(in srgb, ${p.text} 22%, transparent)`,
    }).forEach(([k, v]) => wrap.style.setProperty(k, v));
    edge.hidden = !store.get('showEdgeTab');
  }

  // ── Controls
  const toggleRow = (path, label, desc) => {
    const input = h('input', { type: 'checkbox', role: 'switch', checked: !!store.get(path),
      onchange: (e) => store.set(path, e.target.checked) });
    return h('label', { class: 'row' },
      h('span', { class: 'label' }, label, desc ? h('span', { class: 'desc' }, desc) : null),
      h('span', { class: 'switch' }, input));
  };

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ── Tabs
  const tabs = {
    Look() {
      const grid = h('div', { class: 'themes' }, Object.entries(THEMES).map(([id, t]) => {
        const sw = t.palette
          ? h('div', { class: 'swatch' }, [t.palette.base0, t.palette.base1, t.palette.base2, t.palette.accent]
              .map((c) => { const s = h('span'); s.style.background = c; return s; }))
          : h('div', { class: 'swatch' }, h('span', { class: 'stock' }));
        return h('button', { class: 'theme', 'aria-pressed': String(store.get('theme') === id),
          onclick: () => { store.set('theme', id); render(); } },
          sw, h('div', { class: 'tname' }, t.name), h('div', { class: 'tnote' }, t.note));
      }));

      const color = h('input', { type: 'color',
        value: store.get('accent') || ((THEMES[store.get('theme')] || {}).palette || THEMES.drift.palette).accent,
        oninput: debounce((e) => store.set('accent', e.target.value), 60) });

      const font = h('input', { type: 'text', placeholder: 'e.g. Inter, Segoe UI Variable', value: store.get('font') || '',
        oninput: debounce((e) => store.set('font', e.target.value.trim()), 300) });

      const css = h('textarea', { spellcheck: false, placeholder: '/* Your CSS here. Applied live. */\n',
        oninput: debounce((e) => store.set('customCss', e.target.value), 250),
        onkeydown: (e) => { // Tab inserts indentation instead of leaving the box
          if (e.key !== 'Tab') return;
          e.preventDefault();
          const ta = e.target, s = ta.selectionStart;
          ta.setRangeText('  ', s, ta.selectionEnd, 'end');
          ta.dispatchEvent(new Event('input'));
        } });
      css.value = store.get('customCss') || '';

      return [
        h('h2', {}, 'Theme'), grid,
        h('h2', {}, 'Accent color'),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Accent',
          h('span', { class: 'desc' }, 'Buttons, links, mentions and toggles')), color,
          h('button', { class: 'btn', onclick: () => { store.set('accent', ''); render(); } }, 'Reset')),
        h('h2', {}, 'Font'), font,
        h('p', { class: 'hint' }, 'Any font installed on your PC. Leave empty for Discord\'s default.'),
        h('h2', {}, 'Custom CSS'), css,
        h('p', { class: 'hint' }, 'Paste a community theme here. Remote @import lines may be blocked by Discord.'),
      ];
    },

    Declutter() {
      const groups = {};
      for (const r of DEBLOAT_RULES) (groups[r.group] ??= []).push(r);
      return [
        ...Object.entries(groups).flatMap(([g, rules]) => [
          h('h2', {}, 'Hide · ' + g),
          h('div', {}, rules.map((r) => toggleRow('debloat.' + r.id, r.label))),
        ]),
        h('h2', {}, 'Performance'),
        h('div', {},
          toggleRow('perf.reduceMotion', 'Reduce motion', 'Turns off UI animations and transitions'),
          toggleRow('perf.noBlur', 'Disable blur effects', 'Cheaper to render on older GPUs')),
      ];
    },

    Privacy() {
      return [
        h('h2', {}, 'Block'),
        h('div', {},
          toggleRow('privacy.telemetry', 'Analytics & tracking', 'Usage events Discord sends in the background'),
          toggleRow('privacy.crashReports', 'Crash reports', 'Error logs sent to Discord\'s crash reporting service'),
          toggleRow('privacy.silentTyping', 'Silent typing', 'Others won\'t see "… is typing"')),
        h('p', { class: 'hint' }, 'Blocked requests are answered locally, so Discord keeps working normally.'),
      ];
    },

    About() {
      const status = h('p', { class: 'hint' });
      return [
        h('h2', {}, 'Shortcuts'),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Open this panel'), h('kbd', {}, 'Ctrl+Alt+D')),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Close it'), h('kbd', {}, 'Esc')),
        h('h2', {}, 'Panel'),
        toggleRow('showEdgeTab', 'Show edge tab', 'The slim tab on the right edge of the window'),
        h('h2', {}, 'Settings'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn', onclick: async () => {
            await navigator.clipboard.writeText(JSON.stringify(store.all(), null, 2));
            status.textContent = 'Settings copied to clipboard.';
          } }, 'Export'),
          h('button', { class: 'btn', onclick: async () => {
            try {
              const parsed = JSON.parse(await navigator.clipboard.readText());
              for (const [k, v] of Object.entries(parsed)) if (k in DEFAULTS) store.set(k, v);
              status.textContent = 'Settings imported.'; render();
            } catch (_) { status.textContent = 'Clipboard doesn\'t contain Driftcord settings.'; }
          } }, 'Import from clipboard'),
          h('button', { class: 'btn danger', onclick: () => {
            if (confirm('Reset all Driftcord settings?')) { store.reset(); render(); }
          } }, 'Reset all')),
        status,
        h('h2', {}, 'About'),
        h('p', { class: 'hint' }, `Driftcord ${VERSION}. A lightweight shell around Discord's web app. ` +
          'Not affiliated with Discord. Using modified clients is against Discord\'s Terms of Service.'),
      ];
    },
  };

  let current = 'Look';
  const header = h('header', {});
  const logo = h('div', { class: 'logo' });
  logo.insertAdjacentHTML('beforeend', LOGO_SVG);
  header.append(logo, h('h1', {}, 'Driftcord'), h('span', { class: 'ver' }, 'v' + VERSION),
    h('button', { class: 'x', title: 'Close', 'aria-label': 'Close', onclick: () => toggle(false) }, '×'));
  const nav = h('nav', { role: 'tablist' });
  const main = h('main', {});
  drawer.append(header, nav, main);

  function render() {
    syncColors();
    nav.replaceChildren(...Object.keys(tabs).map((name) =>
      h('button', { role: 'tab', 'aria-selected': String(name === current),
        onclick: () => { current = name; render(); } }, name)));
    const scroll = main.scrollTop;
    main.replaceChildren(...tabs[current]());
    main.scrollTop = scroll;
  }

  function toggle(force) {
    const open = force ?? !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    if (open) render();
  }

  store.onChange((path) => {
    if (path === 'theme' || path === 'accent' || path === 'showEdgeTab' || path === '*') syncColors();
  });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyD') {
      e.preventDefault(); e.stopPropagation(); toggle();
    } else if (e.key === 'Escape' && wrap.classList.contains('open')) {
      e.preventDefault(); e.stopPropagation(); toggle(false);
    }
  }, true);

  // Keep keystrokes typed in the panel from reaching Discord's global hotkeys.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    drawer.addEventListener(type, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  }

  syncColors();
  return { host, toggle };
}
