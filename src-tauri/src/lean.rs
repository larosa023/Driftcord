//! Keeping Driftcord light.
//!
//! WebView2 is Chromium, which normally runs a browser process plus separate
//! GPU, network, audio, storage and renderer processes (and spare renderers).
//! Lean mode folds network and audio back into the browser process and keeps
//! a single renderer. Graphics stays in its own process unless "Lighter
//! graphics" is on, because running it in-process can halve the frame rate. What remains is the minimum WebView2 needs:
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
    " --renderer-process-limit=1",
    " --disable-site-isolation-trials",
    " --disable-background-networking",
    " --disable-component-update",
    " --disable-domain-reliability",
    " --disable-breakpad",
    " --no-pings",
);

/// "Boosted graphics" for older PCs. Chromium falls back to slow software
/// drawing on GPUs/drivers it has blocklisted, which is the usual reason an
/// older PC is stuck near 30 fps. This uses the GPU anyway, draws page content
/// on it, skips a copy when uploading images, and on laptops with two GPUs
/// picks the faster one. If a driver really can't cope, Chromium still falls
/// back by itself, and the tray has "Restart with standard graphics".
const GPU_BOOST: &str = concat!(
    " --ignore-gpu-blocklist",
    " --enable-gpu-rasterization",
    " --enable-zero-copy",
    " --force_high_performance_gpu",
);

/// Browser arguments for the current settings, or `None` for wry's defaults.
/// Chromium only honours the *last* `--disable-features` / `--js-flags`, so
/// each appears once.
pub fn browser_args(lean: bool, js_small: bool, gpu_in_process: bool, gpu_boost: bool) -> Option<String> {
    let mut args = format!("--disable-features={WRY_DEFAULT_FEATURES}");
    if lean {
        args.push(',');
        args.push_str(LEAN_DISABLE);
        args.push_str(LEAN_REST);
        // Graphics in the browser process saves a process and some memory, but
        // on some PCs it halves the frame rate, so it's opt-in ("Lighter graphics").
        if gpu_in_process && !gpu_boost {
            args.push_str(" --in-process-gpu");
        }
    }
    if js_small {
        args.push_str(" --js-flags=--optimize-for-size");
    }
    if gpu_boost {
        args.push_str(GPU_BOOST);
    }
    // Live (not 20-minute-cached) numbers for the About → Memory monitor.
    args.push_str(" --enable-precise-memory-info");
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
    // Hiding to the tray also unfocuses; don't let that replace the full trim.
    if let Some(w) = app.get_webview_window(crate::MAIN) {
        if !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false) {
            return;
        }
    }
    let cfg = crate::config::load(app);
    schedule(app, cfg.idle_trim, cfg.tray_trim_minutes);
}

/// One worker thread handles all pending trims; new events replace the
/// pending one instead of spawning a thread per focus change.
fn schedule(app: &AppHandle, enabled: bool, minutes: u32) {
    use std::sync::{mpsc, OnceLock};
    static WORKER: OnceLock<std::sync::Mutex<mpsc::Sender<(u64, std::time::Instant, AppHandle)>>> = OnceLock::new();

    let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if !enabled {
        return;
    }
    let due = std::time::Instant::now() + Duration::from_secs(minutes.clamp(1, 60) as u64 * 60);
    let tx = WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<(u64, std::time::Instant, AppHandle)>();
        std::thread::Builder::new()
            .name("driftcord-trim".into())
            .spawn(move || {
                let mut pending: Option<(u64, std::time::Instant, AppHandle)> = None;
                loop {
                    let msg = match &pending {
                        Some((_, due, _)) => rx.recv_timeout(due.saturating_duration_since(std::time::Instant::now())),
                        None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
                    };
                    match msg {
                        Ok(next) => pending = Some(next),
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if let Some((gen, _, app)) = pending.take() {
                                if GENERATION.load(Ordering::SeqCst) == gen {
                                    run_trim(&app);
                                }
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
            })
            .ok();
        std::sync::Mutex::new(tx)
    });
    let _ = tx.lock().unwrap_or_else(|e| e.into_inner()).send((gen, due, app.clone()));
}

fn run_trim(app: &AppHandle) {
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

#[cfg(test)]
mod tests {
    use super::browser_args;

    #[test]
    fn boost_adds_gpu_flags_and_keeps_gpu_out_of_process() {
        let a = browser_args(true, true, true, true).unwrap();
        for f in ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy", "--force_high_performance_gpu"] {
            assert!(a.contains(f), "{f} missing: {a}");
        }
        assert!(!a.contains("--in-process-gpu"));
        assert_eq!(a.matches("--disable-features=").count(), 1);
        assert_eq!(a.matches("--enable-features=").count(), 1);
    }

    #[test]
    fn standard_graphics_has_no_boost_flags() {
        let a = browser_args(true, false, true, false).unwrap();
        assert!(a.contains("--in-process-gpu"));
        assert!(!a.contains("--ignore-gpu-blocklist"));
        assert!(!browser_args(false, false, false, false).unwrap().contains("--enable-features="));
    }
}
