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

/* Segmented control */
.seg { display: flex; background: var(--d-card); border: 1px solid var(--d-line); border-radius: 10px; padding: 3px; gap: 3px; }
.seg button { flex: 1; background: none; border: 0; color: var(--d-muted); font: inherit; font-weight: 550; font-size: 13px;
  padding: 7px 6px; border-radius: 7px; cursor: pointer; }
.seg button:hover { color: var(--d-text); }
.seg button[aria-pressed="true"] { background: var(--d-accent); color: #fff; }

/* Choice cards (mods, share modes) */
.choices { display: grid; gap: 8px; }
.choice { display: flex; gap: 12px; align-items: flex-start; text-align: left; background: var(--d-card); color: inherit; font: inherit;
  border: 1px solid var(--d-line); border-radius: 12px; padding: 12px; cursor: pointer; }
.choice:hover { border-color: color-mix(in srgb, var(--d-accent) 50%, var(--d-line)); }
.choice[aria-pressed="true"] { border-color: var(--d-accent); box-shadow: 0 0 0 1px var(--d-accent); }
.choice .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--d-off); flex: none; margin-top: 1px; }
.choice[aria-pressed="true"] .dot { border-color: var(--d-accent); background: radial-gradient(var(--d-accent) 45%, transparent 50%); }
.choice .t { font-weight: 600; }
.choice .s { color: var(--d-muted); font-size: 12.5px; }
.pill-tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 99px; margin-left: 6px;
  background: color-mix(in srgb, var(--d-accent) 20%, transparent); color: var(--d-text); vertical-align: 1px; }
.btn.primary { background: var(--d-accent); border-color: transparent; color: #fff; }
.btn.primary:hover { background: color-mix(in srgb, var(--d-accent) 85%, black); }
.btn[disabled] { opacity: .55; cursor: default; }
.notice { background: color-mix(in srgb, var(--d-accent) 12%, var(--d-card)); border: 1px solid color-mix(in srgb, var(--d-accent) 35%, transparent);
  border-radius: 10px; padding: 10px 12px; margin-top: 12px; font-size: 13px; display: flex; gap: 10px; align-items: center; }
.notice .grow { flex: 1; }

/* Toasts */
.toasts { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; z-index: 2147483647;
  font: 14px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; pointer-events: none; }
.toast { pointer-events: auto; background: var(--d-bg); color: var(--d-text); border: 1px solid var(--d-line); border-radius: 12px;
  box-shadow: 0 12px 32px rgb(0 0 0 / .4); padding: 12px 14px; min-width: 260px; max-width: 360px;
  animation: toastIn .22s cubic-bezier(.2,.8,.2,1); }
.toast .msg { font-weight: 550; }
.toast .sub { color: var(--d-muted); font-size: 12.5px; margin-top: 2px; }
.toast .btns { margin-top: 10px; }
@keyframes toastIn { from { opacity: 0; transform: translateY(8px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .drawer, .scrim { transition: none; } .toast { animation: none; } }
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

    Clean() {
      const groups = {};
      for (const r of DEBLOAT_RULES) (groups[r.group] ??= []).push(r);
      return [
        ...Object.entries(groups).flatMap(([g, rules]) => [
          h('h2', {}, 'Hide · ' + g),
          h('div', {}, rules.map((r) => toggleRow('debloat.' + r.id, r.label))),
        ]),
        h('h2', {}, 'Privacy'),
        h('div', {},
          toggleRow('privacy.telemetry', 'Block analytics & tracking', 'Usage events Discord sends in the background'),
          toggleRow('privacy.crashReports', 'Block crash reports', 'Error logs sent to Discord\'s crash reporting service'),
          toggleRow('privacy.silentTyping', 'Silent typing', 'Others won\'t see "… is typing"')),
        h('p', { class: 'hint' }, 'Blocked requests are answered locally, so Discord keeps working normally.'),
        h('h2', {}, 'Memory saver'),
        memoryRows(),
        h('h2', {}, 'Performance'),
        h('div', {},
          toggleRow('perf.reduceMotion', 'Reduce motion', 'Turns off UI animations and transitions'),
          toggleRow('perf.noBlur', 'Disable blur effects', 'Cheaper to render on older GPUs')),
      ];
    },

    Share() {
      const segOf = (key, items) => h('div', { class: 'seg', role: 'group' }, items.map(([v, label, title]) =>
        h('button', { 'aria-pressed': String(store.get(key) === v), title: title || '',
          onclick: () => { store.set(key, v); render(); } }, label)));
      return [
        h('p', { class: 'hint', style: 'margin-top:14px' }, 'These are the defaults the share picker opens with. You can change them right in the picker too.'),
        h('h2', {}, 'Quality'), segOf('screenshare.res', Object.entries(SHARE_RES).map(([k, r]) => [k, r.label])),
        h('h2', {}, 'Frame rate'), segOf('screenshare.fps', SHARE_FPS.map((f) => [f, f + ' fps'])),
        h('h2', {}, 'Optimize for'), segOf('screenshare.mode', Object.entries(SHARE_MODES).map(([k, m]) => [k, m.label, m.desc])),
        h('p', { class: 'hint' }, 'Discord may still cap stream quality based on your account. You can switch modes live from the share bar.'),
        h('h2', {}, 'Options'),
        h('div', {},
          toggleRow('screenshare.native', 'Driftcord share picker', 'Pick and go live in one screen. Off = Windows\' own picker'),
          toggleRow('screenshare.audio', 'Share audio', 'App audio for windows; everything except Driftcord for screens'),
          toggleRow('screenshare.pill', 'Live share bar', 'Timer, mode switch and Stop button while you\'re live')),
        h('h2', {}, 'Shortcut'),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Start or stop sharing',
          h('span', { class: 'desc' }, 'While you\'re in a voice channel')), h('kbd', {}, 'Ctrl+Alt+S')),
      ];
    },

    Mods() {
      const box = h('div', {}, h('p', { class: 'hint' }, 'Loading…'));
      renderMods(box);
      return [
        h('h2', {}, 'Client mod'),
        h('p', { class: 'hint', style: 'margin-bottom:10px' },
          'Load a full plugin suite on top of Driftcord. After restarting, manage plugins in Discord\'s User Settings under the mod\'s own section.'),
        box,
        h('p', { class: 'hint', style: 'margin-top:14px' },
          'Vencord and Equicord are separate open-source projects (GPL-3.0). Driftcord downloads their official web builds from GitHub and refreshes them on every launch. Report plugin bugs to those projects.'),
      ];
    },

    About() {
      const status = h('p', { class: 'hint' });
      const upd = h('p', { class: 'hint' });
      const checkBtn = h('button', { class: 'btn', onclick: async () => {
        checkBtn.disabled = true; upd.textContent = 'Checking…';
        const u = await checkForUpdates(true);
        upd.textContent = u ? `Version ${u.version} is available.` : (u === null ? 'You\'re up to date.' : '');
        checkBtn.disabled = false;
      } }, 'Check now');
      return [
        h('h2', {}, 'Updates'),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Driftcord ' + VERSION,
          h('span', { class: 'desc' }, 'Updates download in the background and install on restart')), checkBtn),
        upd,
        toggleRow('updates.auto', 'Check automatically', 'On launch and every few hours'),
        h('h2', {}, 'Shortcuts'),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Open this panel'), h('kbd', {}, 'Ctrl+Alt+D')),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Start or stop screen share'), h('kbd', {}, 'Ctrl+Alt+S')),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Close panels'), h('kbd', {}, 'Esc')),
        h('h2', {}, 'Panel'),
        toggleRow('showTopbarButton', 'Top bar button', 'Driftcord icon next to Discord\'s Inbox, with a quick menu'),
        toggleRow('showNewsButton', 'What\'s new button', 'Release notes, with a dot when there\'s something new'),
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

  // Native settings (they apply before Discord loads, so they live in the app).
  function memoryRows() {
    const box = h('div', {});
    const nativeRow = (label, desc, checked, onChange) => {
      const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, onchange: (e) => onChange(e.target.checked) });
      return h('label', { class: 'row' }, h('span', { class: 'label' }, label, h('span', { class: 'desc' }, desc)),
        h('span', { class: 'switch' }, input));
    };
    const draw = (info, err) => {
      const save = (cmd, args) => bridge.invoke(cmd, args).then((i) => draw(i)).catch((x) => draw(info, errText(x)));
      const restart = info && (info.lean !== info.leanActive || info.jsOptimizeSize !== info.jsOptimizeSizeActive);
      box.replaceChildren(...[
        toggleRow('memory.noAutoplay', 'Don\'t autoplay videos', 'GIF clips and embeds play on hover or click. Calls and streams aren\'t affected'),
        info ? nativeRow('Free memory in the tray', 'After 2 minutes minimized or in the tray. Messages and calls keep working',
          info.trayTrim, (v) => save('set_memory', { trayTrim: v })) : null,
        info ? nativeRow('Leaner JavaScript engine', 'Favors smaller memory over raw speed',
          info.jsOptimizeSize, (v) => save('set_memory', { jsOptimizeSize: v })) : null,
        info ? nativeRow('Lean mode', 'Fewer background processes. Turn off only if something renders wrong',
          info.lean, (v) => save('set_lean', { enabled: v })) : null,
        restart ? h('div', { class: 'notice' }, h('span', { class: 'grow' }, 'Restart Driftcord to apply.'),
          h('button', { class: 'btn primary', onclick: () => bridge.invoke('restart_app') }, 'Restart now')) : null,
        err ? h('p', { class: 'hint' }, err) : null,
      ].filter(Boolean));
    };
    draw(null);
    if (bridge.available()) bridge.invoke('get_info').then((i) => draw(i)).catch(() => {});
    return box;
  }

  // Mods tab body: needs the native side, so it renders asynchronously.
  async function renderMods(box) {
    if (!bridge.available()) {
      box.replaceChildren(h('p', { class: 'hint' }, 'Mods are available in the Driftcord app.'));
      return;
    }
    let info;
    try { info = await bridge.invoke('get_info'); } catch (e) {
      box.replaceChildren(h('p', { class: 'hint' }, 'Couldn\'t load mod info: ' + errText(e)));
      return;
    }
    const draw = (busy, error) => {
      const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
      const options = [
        { id: null, name: 'None', sub: 'Just Driftcord. Fastest and lightest.' },
        ...info.mods.map((m) => ({ id: m.id, name: m.name,
          sub: (m.id === 'vencord' ? 'The original. 100+ well-maintained plugins.' : 'Vencord fork with 300+ extra plugins.') +
            (m.installed ? ` · ${kb(m.size)} downloaded` : ''),
          loaded: info.loadedMod === m.id })),
      ];
      const cards = h('div', { class: 'choices' }, options.map((o) => h('button', {
        class: 'choice', 'aria-pressed': String((info.clientMod ?? null) === o.id), disabled: !!busy,
        onclick: async () => {
          if ((info.clientMod ?? null) === o.id) return;
          draw(o.id ? `Downloading ${o.name}…` : 'Saving…');
          try { info = await bridge.invoke('set_mod', { id: o.id }); draw(); }
          catch (e) { draw(null, errText(e)); }
        } },
        h('span', { class: 'dot' }),
        h('span', {}, h('div', { class: 't' }, o.name, o.loaded ? h('span', { class: 'pill-tag' }, 'Active') : null),
          h('div', { class: 's' }, o.sub)))));

      const needsRestart = (info.clientMod ?? null) !== (info.loadedMod ?? null);
      box.replaceChildren(...[cards,
        busy ? h('div', { class: 'notice' }, h('span', { class: 'grow' }, busy)) : null,
        error ? h('div', { class: 'notice' }, h('span', { class: 'grow' }, 'Couldn\'t switch: ' + error)) : null,
        !busy && needsRestart ? h('div', { class: 'notice' },
          h('span', { class: 'grow' }, 'Restart Driftcord to apply.'),
          h('button', { class: 'btn primary', onclick: () => bridge.invoke('restart_app') }, 'Restart now')) : null,
      ].filter(Boolean));
    };
    draw();
  }

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
        onclick: () => { current = name; main.scrollTop = 0; render(); } }, name)));
    const scroll = main.scrollTop;
    main.replaceChildren(...tabs[current]().flat().filter((x) => x != null && x !== false));
    main.scrollTop = scroll;
  }

  function toggle(force, tab) {
    const open = force ?? !wrap.classList.contains('open');
    if (tab && tabs[tab]) current = tab;
    wrap.classList.toggle('open', open);
    if (open) render();
  }

  // ── Toasts
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  wrap.append(toasts);
  function toast(msg, { sub, actions = [], duration = 6000 } = {}) {
    const el = h('div', { class: 'toast', role: 'status' },
      h('div', { class: 'msg' }, msg), sub ? h('div', { class: 'sub' }, sub) : null);
    const close = () => el.remove();
    if (actions.length) {
      el.append(h('div', { class: 'btns' }, actions.map((a) => h('button', {
        class: 'btn' + (a.primary ? ' primary' : ''),
        onclick: () => { if (!a.keepOpen) close(); a.run && a.run(el); } }, a.label))));
    }
    toasts.append(el);
    if (duration) setTimeout(close, duration);
    return { el, close, update(m, s) { el.querySelector('.msg').textContent = m; if (s != null) { const x = el.querySelector('.sub'); if (x) x.textContent = s; } } };
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
  return {
    host, toggle, toast,
    /** Container that inherits the panel's theme colors, for overlays. */
    layer: wrap,
    addStyles(css) { root.append(h('style', {}, css)); },
  };
}

// Shared helpers for other modules. Mount lazily so they work before <body>.
function ui() { mountPanel(); return panel; }
function toast(msg, opts) { const p = ui(); return p ? p.toast(msg, opts) : null; }
