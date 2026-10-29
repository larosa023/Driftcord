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
}
