//! Keeping Driftcord light.
//!
//! WebView2 is Chromium, which normally runs a browser process plus separate
//! GPU, network, audio, storage and renderer processes (and spare renderers).
//! Lean mode folds as much as Chromium allows back into the browser process
//! and keeps a single renderer. What remains is the minimum WebView2 needs:
//! the browser process and one renderer.
//!
//! Memory saver adds two things on top:
//! * V8's `--optimize-for-size`, trading a little JavaScript speed for a
//!   smaller heap.
//! * Background trimming. After a couple of minutes in another app, WebView2
//!   is asked to release caches (the page keeps rendering). After a couple of
//!   minutes hidden or minimized, the page is also marked invisible so Chromium
//!   drops its rendering memory. Everything is undone the moment the window
//!   is focused again. Scripts keep running, so messages, calls and
//!   notifications are unaffected.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};

/// Defaults wry normally passes; must be repeated whenever we pass our own args.
const WRY_DEFAULT_FEATURES: &str = "msWebOOUI,msPdfOOUI,msSmartScreenProtection";

const LEAN_DISABLE: &str = concat!(
    // Fewer processes
    "AudioServiceOutOfProcess,SpareRendererForSitePerProcess,IsolateOrigins,site-per-process,",
    // Less memory and background work
    "BackForwardCache,Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,",
    "msEdgeTranslate,msShoppingTrigger,msEdgeShopping",
);

const LEAN_REST: &str = concat!(
    " --enable-features=NetworkServiceInProcess2,NetworkServiceInProcess",
    " --in-process-gpu",
    " --renderer-process-limit=1",
    " --disable-site-isolation-trials",
    " --disable-background-networking",
    " --disable-component-update",
    " --disable-domain-reliability",
    " --disable-breakpad",
    " --no-pings",
);

/// Browser arguments for the current settings, or `None` for wry's defaults.
/// Chromium only honours the *last* `--disable-features` / `--js-flags`, so
/// each appears once.
pub fn browser_args(lean: bool, js_small: bool) -> Option<String> {
    if !lean && !js_small {
        return None;
    }
    let mut args = format!("--disable-features={WRY_DEFAULT_FEATURES}");
    if lean {
        args.push(',');
        args.push_str(LEAN_DISABLE);
        args.push_str(LEAN_REST);
    }
    if js_small {
        args.push_str(" --js-flags=--optimize-for-size");
    }
    Some(args)
}

// ── Tray trimming ────────────────────────────────────────────────────────────

/// Bumped every time the window is shown/hidden, so a pending trim can tell it's stale.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Window was hidden or minimized: full trim after the configured delay.
pub fn on_hidden(app: &AppHandle) {
    let cfg = crate::config::load(app);
    schedule(app, cfg.tray_trim, cfg.tray_trim_minutes);
}

/// Window is open but you're in another app: light trim after a while.
pub fn on_unfocused(app: &AppHandle) {
    let cfg = crate::config::load(app);
    schedule(app, cfg.idle_trim, cfg.tray_trim_minutes);
}

fn schedule(app: &AppHandle, enabled: bool, minutes: u32) {
    let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if !enabled {
        return;
    }
    let app = app.clone();
    let delay = Duration::from_secs(minutes.clamp(1, 60) as u64 * 60);
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if GENERATION.load(Ordering::SeqCst) != gen {
            return; // window state changed in the meantime
        }
        let Some(w) = app.get_webview_window(crate::MAIN) else { return };
        let hidden = !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if hidden {
            let _ = w.eval("window.__driftcordTrim && window.__driftcordTrim(true)");
            trim(&w, Trim::Full);
        } else if !focused {
            // Still on screen: keep rendering, just release caches.
            let _ = w.eval("window.__driftcordTrim && window.__driftcordTrim(true)");
            trim(&w, Trim::Light);
        }
    });
}

/// Window is back: undo any trimming right away.
pub fn on_shown(app: &AppHandle) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(crate::MAIN) {
        trim(&w, Trim::None);
        let _ = w.eval("window.__driftcordTrim && window.__driftcordTrim(false)");
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Trim {
    /// Normal operation.
    None,
    /// Visible but in the background: ask WebView2 to release caches.
    Light,
    /// Hidden/minimized: also stop rendering the page.
    Full,
}

#[cfg(windows)]
fn trim(window: &WebviewWindow, mode: Trim) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let _ = window.with_webview(move |pv| unsafe {
        let controller = pv.controller();
        // Invisible pages drop their compositor/raster memory in Chromium.
        let _ = controller.SetIsVisible(mode != Trim::Full);
        let level = if mode != Trim::None { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        if let Ok(core) = controller.CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let _ = c19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
fn trim(_window: &WebviewWindow, _mode: Trim) {}
