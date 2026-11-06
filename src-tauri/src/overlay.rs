//! In-game voice overlay: a small transparent, click-through window that stays on top
//! of borderless/windowed games and lists who is in your voice channel and who is
//! talking. The page (Driftcord's injected script) works out the list and sends it
//! here; this window never touches Discord or the game.

use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "overlay";

/// Latest state from the page, replayed once the overlay page has finished loading.
static LAST: Mutex<String> = Mutex::new(String::new());
/// The browser arguments the main window was created with. WebView2 requires every
/// window sharing the data folder to use identical ones.
pub static BROWSER_ARGS: OnceLock<Option<String>> = OnceLock::new();

fn push_js() -> String {
    let s = LAST.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let lit = serde_json::to_string(&s).unwrap_or_else(|_| "\"\"".into());
    format!("window.__set&&window.__set(JSON.parse({lit}))")
}

fn build(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    let mut b = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Driftcord overlay")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .visible(false)
        .inner_size(260.0, 80.0)
        .on_page_load(|w, p| {
            if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = w.eval(&push_js());
            }
        });
    if let Some(Some(args)) = BROWSER_ARGS.get() {
        b = b.additional_browser_args(args);
    }
    let w = b.build().map_err(|e| e.to_string())?;
    let _ = w.set_ignore_cursor_events(true);
    Ok(w)
}

fn place(app: &AppHandle, w: &tauri::WebviewWindow, corner: &str, scale: f64, rows: u32) {
    let Some(mon) = app.primary_monitor().ok().flatten().or_else(|| w.current_monitor().ok().flatten()) else { return };
    let sf = mon.scale_factor();
    let (mp, ms) = (mon.position(), mon.size());
    let lw = 260.0 * scale;
    let lh = 14.0 + f64::from(rows) * (34.0 * scale + 6.0);
    let (pw, ph) = ((lw * sf).round() as i32, (lh * sf).round() as i32);
    let margin = (18.0 * sf).round() as i32;
    let x = if corner.ends_with("left") { mp.x + margin } else { mp.x + ms.width as i32 - pw - margin };
    let y = if corner.starts_with("top") { mp.y + margin } else { mp.y + ms.height as i32 - ph - margin };
    let _ = w.set_size(PhysicalSize::new(pw as u32, ph as u32));
    let _ = w.set_position(PhysicalPosition::new(x, y));
    crate::log_event(app, &format!("overlay: placed {pw}x{ph} at {x},{y} on {}x{} (scale {sf})", ms.width, ms.height));
}

/// Show (or hide) the overlay with a new state. `rows` sizes the window to the list.
pub fn update(app: &AppHandle, state: String, show: bool, corner: &str, scale: f64, rows: u32) -> Result<(), String> {
    if state.len() > 40_000 {
        return Err("overlay state too large".into());
    }
    if !matches!(corner, "top-left" | "top-right" | "bottom-left" | "bottom-right") {
        return Err("bad corner".into());
    }
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = state;
    let existing = app.get_webview_window(LABEL);
    if !show || rows == 0 {
        if let Some(w) = existing {
            let _ = w.hide();
        }
        return Ok(());
    }
    let scale = scale.clamp(0.7, 1.6);
    let w = match existing {
        Some(w) => w,
        None => match build(app) {
            Ok(w) => {
                crate::log_event(app, "overlay: window created");
                w
            }
            Err(e) => {
                crate::log_event(app, &format!("overlay: could not create window: {e}"));
                return Err(e);
            }
        },
    };
    place(app, &w, corner, scale, rows.min(13));
    let _ = w.eval(&push_js());
    if !w.is_visible().unwrap_or(false) {
        let _ = w.show();
    }
    Ok(())
}

/// Remove the overlay window completely (frees its memory).
pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
}
