// ── Debloat: hide clutter with toggleable CSS rules ──────────────────────────
// Discord's class names carry a random suffix (e.g. `upsellBanner__a1b2c`), so
// rules match on stable parts: hrefs, list-item ids, aria-labels and class
// prefixes. If Discord renames something, fix the selector here.
//
// aria-label selectors assume Discord's language is set to English.

const DEBLOAT_RULES = [
  // Sidebar & navigation
  { id: 'nitroTab', group: 'Navigation', label: 'Nitro tab in DMs', on: true,
    css: 'a[href="/store"], [data-list-item-id$="___nitro"]' },
  { id: 'shopTab', group: 'Navigation', label: 'Shop tab in DMs', on: true,
    css: 'a[href="/shop"], [data-list-item-id$="___shop"]' },
  { id: 'questsTab', group: 'Navigation', label: 'Quests tab & promos', on: true,
    css: 'a[href="/quest-home"], [data-list-item-id$="___quests"], [class*="questsEntry"], [class*="questPromo"], [class*="questBar"]' },
  { id: 'discoverButton', group: 'Navigation', label: '"Discover" button in server list', on: false,
    css: '[data-list-item-id="guildsnav___guild-discover-button"]' },
  { id: 'downloadButton', group: 'Navigation', label: '"Download apps" button', on: true,
    css: '[data-list-item-id="guildsnav___app-download-button"]' },

  // Message bar
  { id: 'giftButton', group: 'Message bar', label: 'Gift button', on: true,
    css: '[aria-label="Send a gift"]' },
  { id: 'appsButton', group: 'Message bar', label: 'Apps button', on: true,
    css: '[class*="channelTextArea"] [aria-label="Apps"]' },
  { id: 'stickerButton', group: 'Message bar', label: 'Sticker button', on: false,
    css: '[aria-label="Open sticker picker"]' },

  // Messages & profiles
  { id: 'superReactions', group: 'Messages & profiles', label: 'Super Reaction button', on: true,
    css: '[aria-label="Add Super Reaction"]' },
  { id: 'decorations', group: 'Messages & profiles', label: 'Avatar decorations & profile effects', on: false,
    css: '[class*="avatarDecoration"], [class*="profileEffects"]' },

  // Upsells
  { id: 'upsells', group: 'Upsells', label: 'Nitro upsell banners & nags', on: true,
    // Never hide a box with choices in it (e.g. stream quality options that
    // FakeNitro unlocks sit inside an upsell wrapper).
    css: ['upsellBanner', 'premiumUpsell', 'nitroUpsell', 'premiumTrial']
      .map((c) => `[class*="${c}"]:not(:has([role="radio"], [role="radiogroup"], [role="option"], [role="listbox"], input))`).join(', ') },
  { id: 'activities', group: 'Upsells', label: '"Start an Activity" in voice', on: true,
    css: '[aria-label="Start an Activity"], [aria-label="Choose an Activity"]' },
  { id: 'boostBar', group: 'Upsells', label: 'Server boost goal bar', on: false,
    css: '[class*="guildBoostBar"], [class*="boostProgress"]' },
];

function applyDebloatDefaults() {
  const current = store.get('debloat') || {};
  const filled = { ...current };
  for (const r of DEBLOAT_RULES) if (!(r.id in filled)) filled[r.id] = r.on;
  store.all().debloat = filled;
}
applyDebloatDefaults();

const debloatStyle = ownStyle('driftcord-debloat');

function renderDebloat() {
  const rules = DEBLOAT_RULES
    .filter((r) => store.get('debloat.' + r.id))
    .map((r) => `/* ${r.id} */ ${r.css} { display: none !important; }`);

  if (store.get('perf.reduceMotion')) {
    rules.push(`*, *::before, *::after {
      animation-duration: 0.001ms !important; animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important; scroll-behavior: auto !important; }`);
  }
  if (store.get('perf.noBlur')) {
    rules.push('* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }');
  }
  setCss(debloatStyle, rules.join('\n'));
}
