//! Keeping Driftcord light.
//!
//! WebView2 is Chromium, which normally runs a browser process plus separate
//! GPU, network, audio, storage and renderer processes (and spare renderers).
//! Lean mode folds as much as Chromium allows back into the browser process
//! and keeps a single renderer. What remains is the minimum WebView2 needs:
//! the browser process, one renderer and Microsoft's crash reporter.
//!
//! On top of that, whenever the window is minimized or hidden to the tray,
//! WebView2 is asked to drop caches and trim memory.

/// Browser arguments for lean mode. Chromium only honours the *last*
/// `--disable-features` / `--enable-features`, so each appears once, and the
/// defaults wry normally passes (`msWebOOUI`, `msPdfOOUI`,
/// `msSmartScreenProtection`) are included.
pub const LEAN_ARGS: &str = concat!(
    "--disable-features=",
    "msWebOOUI,msPdfOOUI,msSmartScreenProtection,",
    // Fewer processes
    "AudioServiceOutOfProcess,SpareRendererForSitePerProcess,IsolateOrigins,site-per-process,",
    // Less memory and background work
    "BackForwardCache,Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,",
    "msEdgeTranslate,msShoppingTrigger,msEdgeShopping",
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

#[cfg(windows)]
pub fn set_memory_low(window: &tauri::WebviewWindow, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let _ = window.with_webview(move |pv| unsafe {
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        if let Ok(core) = pv.controller().CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let _ = c19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
pub fn set_memory_low(_window: &tauri::WebviewWindow, _low: bool) {}
