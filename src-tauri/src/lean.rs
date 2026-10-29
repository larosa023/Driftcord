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
//! * Tray trimming: once the window has been hidden or minimized for a few
//!   minutes, the page is marked invisible (Chromium drops its rendering
//!   memory) and WebView2 is asked to release caches. Both are undone the
//!   moment the window comes back. Scripts keep running, so messages, calls
//!   and notifications are unaffected.

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

/// Window was hidden or minimized: trim after the configured delay.
pub fn on_hidden(app: &AppHandle) {
    let cfg = crate::config::load(app);
    let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if !cfg.tray_trim {
        return;
    }
    let app = app.clone();
    let delay = Duration::from_secs(cfg.tray_trim_minutes.clamp(1, 60) as u64 * 60);
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if GENERATION.load(Ordering::SeqCst) != gen {
            return; // shown again (or hidden again) in the meantime
        }
        if let Some(w) = app.get_webview_window(crate::MAIN) {
            let still_away = !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false);
            if still_away {
                let _ = w.eval("window.__driftcordTrim && window.__driftcordTrim(true)");
                trim(&w, true);
            }
        }
    });
}

/// Window is back: undo any trimming right away.
pub fn on_shown(app: &AppHandle) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(crate::MAIN) {
        trim(&w, false);
        let _ = w.eval("window.__driftcordTrim && window.__driftcordTrim(false)");
    }
}

#[cfg(windows)]
fn trim(window: &WebviewWindow, away: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let _ = window.with_webview(move |pv| unsafe {
        let controller = pv.controller();
        // Invisible pages drop their compositor/raster memory in Chromium.
        let _ = controller.SetIsVisible(!away);
        let level = if away { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        if let Ok(core) = controller.CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let _ = c19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
fn trim(_window: &WebviewWindow, _away: bool) {}
