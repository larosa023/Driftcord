// ── Theme engine ─────────────────────────────────────────────────────────────
// A theme is a small palette. It's mapped onto Discord's CSS variables (both the
// pre-2025 names and the newer "visual refresh" names), so it survives most UI
// updates. Add your own by copying an entry below.

const THEMES = {
  stock: {
    name: 'Stock',
    note: "Discord's own colors",
    palette: null,
  },
  drift: {
    name: 'Drift',
    note: 'Deep navy with a cool blue accent',
    palette: {
      base0: '#0b1220', base1: '#101a2c', base2: '#131f33', surface: '#18263d',
      input: '#1b2a44', text: '#d7e1f0', muted: '#8696b0', header: '#f2f6fc',
      accent: '#4fa3ff',
    },
  },
  midnight: {
    name: 'Midnight',
    note: 'True black for OLED screens',
    palette: {
      base0: '#000000', base1: '#050506', base2: '#08080a', surface: '#111114',
      input: '#131317', text: '#dcdce2', muted: '#85858f', header: '#ffffff',
      accent: '#8b93ff',
    },
  },
  frost: {
    name: 'Frost',
    note: 'Soft slate grays, low contrast',
    palette: {
      base0: '#1c1f24', base1: '#23272e', base2: '#272c34', surface: '#2e343d',
      input: '#323944', text: '#d9dee6', muted: '#949dab', header: '#f4f6f9',
      accent: '#7cc4c9',
    },
  },
  ember: {
    name: 'Ember',
    note: 'Warm charcoal with an orange glow',
    palette: {
      base0: '#141111', base1: '#1b1716', base2: '#1f1a19', surface: '#2a2321',
      input: '#2c2523', text: '#eadfd9', muted: '#a8968e', header: '#fff6f1',
      accent: '#ff8a4c',
    },
  },
  nord: {
    name: 'Nord',
    note: 'Arctic blues and frost',
    palette: {
      base0: '#242933', base1: '#2b303b', base2: '#2e3440', surface: '#3b4252',
      input: '#3b4252', text: '#d8dee9', muted: '#929cb0', header: '#eceff4',
      accent: '#5e81ac',
    },
  },
  dracula: {
    name: 'Dracula',
    note: 'The classic purple night',
    palette: {
      base0: '#1e1f29', base1: '#21222c', base2: '#282a36', surface: '#343746',
      input: '#343746', text: '#f8f8f2', muted: '#a0a6c8', header: '#ffffff',
      accent: '#a77bf3',
    },
  },
  catppuccin: {
    name: 'Catppuccin',
    note: 'Mocha: soft pastel dark',
    palette: {
      base0: '#11111b', base1: '#181825', base2: '#1e1e2e', surface: '#313244',
      input: '#313244', text: '#cdd6f4', muted: '#a6adc8', header: '#eff1f5',
      accent: '#8839ef',
    },
  },
  gruvbox: {
    name: 'Gruvbox',
    note: 'Retro warm earth tones',
    palette: {
      base0: '#1d2021', base1: '#252423', base2: '#282828', surface: '#3c3836',
      input: '#3c3836', text: '#ebdbb2', muted: '#a89984', header: '#fbf1c7',
      accent: '#d65d0e',
    },
  },
  tokyo: {
    name: 'Tokyo Night',
    note: 'Neon-lit city blues',
    palette: {
      base0: '#16161e', base1: '#1a1b26', base2: '#1e2030', surface: '#292e42',
      input: '#24283b', text: '#c0caf5', muted: '#8089b3', header: '#e0e6ff',
      accent: '#5a7ee0',
    },
  },
  rosepine: {
    name: 'Rosé Pine',
    note: 'Muted, cozy and calm',
    palette: {
      base0: '#111019', base1: '#191724', base2: '#1f1d2e', surface: '#26233a',
      input: '#26233a', text: '#e0def4', muted: '#908caa', header: '#ffffff',
      accent: '#b4637a',
    },
  },
  solarized: {
    name: 'Solarized',
    note: 'Low-glare teal dark',
    palette: {
      base0: '#00212b', base1: '#00262f', base2: '#002b36', surface: '#073642',
      input: '#073642', text: '#a3b1b1', muted: '#76878d', header: '#eee8d5',
      accent: '#268bd2',
    },
  },
  forest: {
    name: 'Forest',
    note: 'Deep greens, easy on the eyes',
    palette: {
      base0: '#0f1712', base1: '#131d17', base2: '#16221a', surface: '#1e2d23',
      input: '#203026', text: '#d6e4d9', muted: '#8aa393', header: '#f1f8f2',
      accent: '#3a9a68',
    },
  },
  sakura: {
    name: 'Sakura',
    note: 'Dusky plum with cherry blossom',
    palette: {
      base0: '#1a1216', base1: '#21171c', base2: '#251a20', surface: '#31232a',
      input: '#33242c', text: '#f3e3ea', muted: '#b393a3', header: '#fff4f8',
      accent: '#e05a96',
    },
  },
  graphite: {
    name: 'Graphite',
    note: 'Pure monochrome, no color',
    palette: {
      base0: '#101010', base1: '#161616', base2: '#1a1a1a', surface: '#222222',
      input: '#242424', text: '#e2e2e2', muted: '#8c8c8c', header: '#ffffff',
      accent: '#6e6e6e',
    },
  },
};

function paletteToCss(p, accentOverride) {
  const accent = accentOverride || p.accent;
  const v = {
    // Backgrounds: server list → channel list → chat
    '--background-tertiary': p.base0,
    '--background-base-lowest': p.base0,
    '--background-secondary-alt': p.base0,
    '--background-secondary': p.base1,
    '--background-base-low': p.base1,
    '--background-primary': p.base2,
    '--background-base-lower': p.base2,
    '--chat-background-default': p.base2,
    // Popouts, menus, modals
    '--background-floating': p.surface,
    '--background-surface-high': p.surface,
    '--background-surface-higher': p.surface,
    '--background-surface-highest': p.input,
    '--modal-background': p.surface,
    '--modal-footer-background': p.base1,
    // Inputs
    '--channeltextarea-background': p.input,
    '--input-background': p.input,
    '--bg-overlay-chat': p.input,
    // Hover / selected states derived from text color
    '--background-modifier-hover': `color-mix(in srgb, ${p.text} 7%, transparent)`,
    '--background-modifier-active': `color-mix(in srgb, ${p.text} 11%, transparent)`,
    '--background-modifier-selected': `color-mix(in srgb, ${p.text} 13%, transparent)`,
    '--background-modifier-accent': `color-mix(in srgb, ${p.text} 9%, transparent)`,
    '--border-subtle': `color-mix(in srgb, ${p.text} 8%, transparent)`,
    '--border-faint': `color-mix(in srgb, ${p.text} 5%, transparent)`,
    // Text
    '--text-normal': p.text,
    '--text-default': p.text,
    '--text-muted': p.muted,
    '--text-secondary': p.muted,
    '--channels-default': p.muted,
    '--interactive-normal': p.muted,
    '--interactive-hover': p.header,
    '--interactive-active': p.header,
    '--header-primary': p.header,
    '--header-secondary': p.muted,
    '--text-strong': p.header,
  };
  Object.assign(v, accentVars(accent));
  return Object.entries(v).map(([k, val]) => `  ${k}: ${val} !important;`).join('\n');
}

function accentVars(accent) {
  return {
    '--brand-500': accent,
    '--brand-560': `color-mix(in srgb, ${accent} 85%, black)`,
    '--brand-600': `color-mix(in srgb, ${accent} 75%, black)`,
    '--brand-experiment': accent,
    '--brand-experiment-560': `color-mix(in srgb, ${accent} 85%, black)`,
    '--text-link': accent,
    '--control-brand-foreground': accent,
    '--control-brand-foreground-new': accent,
    '--button-filled-brand-background': accent,
    '--button-filled-brand-background-hover': `color-mix(in srgb, ${accent} 85%, black)`,
    '--mention-foreground': accent,
    '--mention-background': `color-mix(in srgb, ${accent} 18%, transparent)`,
  };
}

// Selectors Discord puts its variables on. Doubled classes beat Discord's own
// specificity; !important handles the rest.
const THEME_SCOPE = ':root:root, .theme-dark.theme-dark, .theme-darker.theme-darker, .theme-midnight.theme-midnight, .theme-light.theme-light, .visual-refresh.visual-refresh';

const themeStyle = ownStyle('driftcord-theme');
const customStyle = ownStyle('driftcord-custom');

function renderTheme() {
  const theme = THEMES[store.get('theme')] || THEMES.stock;
  const accent = store.get('accent');
  const font = store.get('font');
  const blocks = [];

  if (theme.palette) {
    blocks.push(`${THEME_SCOPE} {\n${paletteToCss(theme.palette, accent)}\n}`);
  } else if (accent) {
    const vars = Object.entries(accentVars(accent)).map(([k, v]) => `  ${k}: ${v} !important;`).join('\n');
    blocks.push(`${THEME_SCOPE} {\n${vars}\n}`);
  }

  if (font) {
    const stack = `"${font.replace(/"/g, '')}", "gg sans", "Segoe UI", sans-serif`;
    blocks.push(`${THEME_SCOPE} { --font-primary: ${stack} !important; --font-display: ${stack} !important; --font-headline: ${stack} !important; }`);
  }

  themeStyle.textContent = blocks.join('\n\n');
  customStyle.textContent = store.get('customCss') || '';
  reportBackground(theme.palette ? theme.palette.base1 : '#2b2d31');
}

let lastBg = null;
function reportBackground(color) {
  if (color === lastBg || !bridge.available()) return;
  lastBg = color;
  bridge.invoke('set_background', { color }).catch(() => {});
}
