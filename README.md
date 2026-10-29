# Driftcord

A lightweight, debloated, themeable desktop shell for Discord, built with [Tauri](https://tauri.app).

Driftcord loads Discord's own web app inside a small native window, so **every feature keeps working** (voice, video, screen share, stages, everything) while it strips out the clutter and adds real customization on top.

- **Tiny install.** A ~10 MB installer instead of a few hundred MB. Uses the WebView2 runtime that ships with Windows 10/11 instead of bundling Chromium.
- **Debloat.** Toggle off the Nitro and Shop tabs, Quests, gift and Apps buttons, Super Reactions, Activities, upsell banners and more.
- **Privacy.** Blocks Discord's analytics/"science" pings and crash reporting. Optional silent typing.
- **Themes.** 15 built-in themes (Drift, Midnight, Frost, Ember, Nord, Dracula, Catppuccin, Gruvbox, Tokyo Night, Rosé Pine, Solarized, Forest, Sakura, Graphite, plus Stock), a custom accent color, any installed font, and a live custom CSS box for community themes.
- **Modern screen share.** A share sheet (Smooth motion / Balanced / Sharp text, system audio), a floating Live bar with timer, live mode switching and Stop, "share this tab instead" switching, and a `Ctrl+Alt+S` shortcut.
- **Vencord & Equicord.** Turn on either client mod with one click to get their full plugin libraries. Driftcord downloads the official web build and keeps it updated.
- **Auto-updates.** The installed app checks for new Driftcord releases and updates itself in place.
- **Desktop niceties.** Tray icon, close-to-tray, single instance, remembers window size and position, external links open in your browser.

> ⚠️ Using a modified Discord client is against Discord's Terms of Service. Enforcement against client mods has historically been rare, but use Driftcord at your own risk. Driftcord is not affiliated with Discord.

## Download

Grab the latest build from the [Releases page](https://github.com/larosa023/Driftcord/releases/latest):

- `Driftcord_x.y.z_x64-setup.exe`: installer (Start menu shortcut, uninstaller)
- `Driftcord-portable.exe`: single file, no install

Windows may show a SmartScreen warning because the app isn't code-signed. Click **More info → Run anyway**.

## Building from source (Windows)

You'll need:

1. **Rust**: install from <https://rustup.rs> (accept the defaults; it will also set up the Visual Studio C++ Build Tools if missing).
2. **Node.js 20+**: <https://nodejs.org>
3. **WebView2**: already included in Windows 10/11.

Then:

```bash
git clone https://github.com/<you>/driftcord.git
cd driftcord
npm install
npm run dev      # run with hot rebuild of the Rust side
npm run build    # make an installer in src-tauri/target/release/bundle/nsis/
```

The first build takes a few minutes while Rust compiles dependencies; later builds are fast.

## Using it

| Action | How |
| --- | --- |
| Quick menu (themes, mods, share) | The Driftcord icon next to Discord's Inbox icon |
| Open Driftcord settings | `Ctrl+Alt+D`, the slim tab on the right edge, or tray → *Driftcord Settings* |
| Start / stop screen share | `Ctrl+Alt+S` (while in a voice channel) |
| Turn on Vencord or Equicord | Settings → **Mods**, pick one, *Restart now*. Plugins then live in Discord's User Settings. |
| Close the panel | `Esc` |
| Quit for real | Tray icon → *Quit* (closing the window just hides it to the tray) |

Settings are saved locally and survive restarts and Discord updates.

## Project layout

```
driftcord/
├── inject/                 # Everything that runs inside Discord's page
│   ├── 00-store.js         # Settings store (saved to local storage)
│   ├── 10-privacy.js       # Telemetry / crash report / typing blocking
│   ├── 20-debloat.js       # Hide-clutter rules (edit selectors here)
│   ├── 30-themes.js        # Theme palettes → Discord CSS variables
│   ├── 05-bridge.js        # Calls into the native app (mods, updates)
│   ├── 40-panel.js         # The settings drawer UI and toasts
│   ├── 45-topbar.js        # Top bar icon and quick menu
│   ├── 50-screenshare.js   # Share sheet, Live bar, Ctrl+Alt+S
│   ├── 60-updates.js       # Update checks and the update prompt
│   ├── 99-boot.js          # Wires it all together
│   └── mod-shim.js         # Userscript APIs for Vencord/Equicord
├── src-tauri/src/
│   ├── lib.rs              # Window, tray, commands, updater
│   ├── mods.rs             # Mod download/cache and cross-origin fetch
│   └── config.rs           # Native-side settings
├── src-tauri/
│   ├── capabilities/       # Which commands discord.com may call
│   ├── tauri.conf.json     # App name, bundle and installer settings
│   └── icons/
└── .github/workflows/      # Builds a Windows installer on tagged releases
```

The `inject/` files are concatenated at compile time (see `injection_script()` in `lib.rs`) and run before any of Discord's code.

## Customizing

**Add a theme:** copy an entry in `inject/30-themes.js` and change the nine colors. It shows up in the panel automatically.

**Add a debloat rule:** add an entry to `DEBLOAT_RULES` in `inject/20-debloat.js` with a CSS selector. To find a selector, run `npm run dev`, right-click the element → *Inspect* (dev builds have DevTools), and match on something stable: an `href`, `aria-label`, `data-list-item-id`, or the readable start of a class name (`[class*="upsellBanner"]`), never the random suffix.

**If something stops being hidden** after a Discord update, it's almost always a renamed class. Update the selector in `20-debloat.js`.

## Known limitations

- Debloat rules match English `aria-label`s, so a few toggles won't work if Discord's language is set to something else.
- RAM use is similar to running Discord in a browser tab, because it *is* Discord's web app. The savings are in install size, startup, background activity and clutter.
- Remote `@import` lines in custom CSS may be blocked by Discord's content security policy. Paste the theme's full CSS instead.
- Windows is the primary target. macOS and Linux should build but haven't been tested.

## Updates

The installer version checks `latest.json` on this repo's latest release, verifies the update's signature against the public key in `tauri.conf.json`, and installs it quietly. The portable exe doesn't self-update; download the new one or switch to the installer.

Releases are signed with a private key stored in the repo secret `TAURI_SIGNING_PRIVATE_KEY`. Keep that key safe: if it's lost, existing installs can't verify new updates.

## Releasing

Every push to `main` builds the Windows installer and portable exe and publishes them to the GitHub Release for the current version (created automatically as tag `v<version>`). To ship a new version, bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and `inject/00-store.js`, then push.

## License

MIT
