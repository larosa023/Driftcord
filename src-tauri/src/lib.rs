//! Driftcord: a thin native shell around Discord's web client.
//!
//! All features (voice, video, screen share) come from Discord's own web app.
//! Driftcord adds: telemetry blocking, a debloat layer, a theme engine, a modern
//! screen-share flow and an in-app settings panel (all injected from
//! `../inject/` before Discord loads), plus optional Vencord/Equicord support and
//! self-updating.

mod capture;
mod overlay;
mod config;
mod lean;
mod mods;

use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{DownloadEvent, NewWindowResponse, PermissionKind, PermissionResponse},
    AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const MAIN: &str = "main";
const DISCORD_URL: &str = "https://discord.com/app";

/// Hosts the main window is allowed to navigate to. Anything else opens in the
/// user's default browser instead.
const ALLOWED_HOSTS: &[&str] = &["discord.com", "discordapp.com", "discord.gg", "discord.new"];

/// The injected layer, concatenated in load order and wrapped in one closure so
/// the files share scope without leaking globals into Discord's page.
fn injection_script() -> String {
    let parts = [
        include_str!("../../inject/00-store.js"),
        include_str!("../../inject/05-bridge.js"),
        include_str!("../../inject/07-links.js"),
        include_str!("../../inject/10-privacy.js"),
        include_str!("../../inject/20-debloat.js"),
        include_str!("../../inject/25-memory.js"),
        include_str!("../../inject/30-themes.js"),
        include_str!("../../inject/40-panel.js"),
        include_str!("../../inject/45-topbar.js"),
        include_str!("../../inject/47-changelog.js"),
        include_str!("../../inject/48-titlebar.js"),
        include_str!("../../inject/50-screenshare.js"),
        include_str!("../../inject/52-quality.js"),
        include_str!("../../inject/55-voice.js"),
        include_str!("../../inject/56-badge.js"),
        include_str!("../../inject/58-labels.js"),
        include_str!("../../inject/60-updates.js"),
        include_str!("../../inject/62-overlay.js"),
        include_str!("../../inject/65-monitor.js"),
        include_str!("../../inject/99-boot.js"),
    ];
    format!(
        "(function () {{\n'use strict';\nif (window.__driftcordLoaded) return;\nwindow.__driftcordLoaded = true;\n{}\n}})();",
        parts.join("\n\n")
    )
}

fn is_allowed(url: &Url) -> bool {
    match url.scheme() {
        "about" | "blob" | "data" => return true,
        "https" => {}
        _ => return false,
    }
    let host = url.host_str().unwrap_or_default();
    ALLOWED_HOSTS
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = open_url_once(app, url);
    }
}

/// Opens a link in the default browser, unless the same link was opened a
/// moment ago. A click can reach the browser through several routes at once
/// (the page's own request, a pop-up request, our backup); this keeps it to one.
fn open_url_once(app: &AppHandle, url: &Url) -> Result<(), String> {
    static LAST: Mutex<Option<(String, std::time::Instant)>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((u, at)) = last.as_ref() {
            if u == url.as_str() && at.elapsed() < std::time::Duration::from_millis(1500) {
                return Ok(());
            }
        }
        *last = Some((url.as_str().to_string(), std::time::Instant::now()));
    }
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    lean::on_shown(app);
}

// ── Commands (called from the injected layer on discord.com) ─────────────────

#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    version: &'static str,
    /// Mod that will load on next start.
    client_mod: Option<String>,
    /// Mod that is loaded right now.
    loaded_mod: Option<String>,
    mods: Vec<mods::ModStatus>,
    /// Lean mode setting (applies on next start) and whether it's active now.
    lean: bool,
    lean_active: bool,
    native_capture: bool,
    js_optimize_size: bool,
    js_optimize_size_active: bool,
    gpu_in_process: bool,
    gpu_in_process_active: bool,
    gpu_boost: bool,
    gpu_boost_active: bool,
    native_titlebar: bool,
    native_titlebar_active: bool,
    tray_trim: bool,
    idle_trim: bool,
}

struct LoadedMod(Option<String>);

#[tauri::command]
fn get_info(app: AppHandle, loaded: State<'_, LoadedMod>) -> Info {
    info(&app, &config::load(&app), loaded.0.clone())
}

fn info(app: &AppHandle, cfg: &config::Config, loaded_mod: Option<String>) -> Info {
    Info {
        version: env!("CARGO_PKG_VERSION"),
        client_mod: cfg.client_mod.clone(),
        loaded_mod,
        mods: mods::status(app),
        lean: !cfg.disable_lean,
        lean_active: app.state::<Active>().lean,
        native_capture: capture::supported(),
        js_optimize_size: cfg.js_optimize_size,
        js_optimize_size_active: app.state::<Active>().js_small,
        gpu_in_process: cfg.gpu_in_process,
        gpu_in_process_active: app.state::<Active>().gpu_in_process,
        gpu_boost: cfg.gpu_boost,
        gpu_boost_active: app.state::<Active>().gpu_boost,
        native_titlebar: cfg.native_titlebar,
        native_titlebar_active: app.state::<Active>().native_titlebar,
        tray_trim: cfg.tray_trim,
        idle_trim: cfg.idle_trim,
    }
}

/// Settings that only apply at startup, as they were when the app started.
struct Active {
    lean: bool,
    js_small: bool,
    gpu_in_process: bool,
    gpu_boost: bool,
    native_titlebar: bool,
}

/// In-game voice overlay (see overlay.rs). The page sends the list; this shows it.
/// Async on purpose: creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
async fn overlay_update(app: AppHandle, state: String, show: bool, x: f64, y: f64, scale: f64, rows: u32) -> Result<(), String> {
    overlay::update(&app, state, show, x, y, scale, rows)
}

#[tauri::command]
async fn overlay_close(app: AppHandle) {
    overlay::close(&app);
}

#[tauri::command]
fn free_memory(app: AppHandle) {
    lean::free_now(&app);
}

/// "Start with Windows" (opens quietly in the tray).
#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let m = app.autolaunch();
    if on { m.enable() } else { m.disable() }.map_err(|e| e.to_string())?;
    Ok(m.is_enabled().unwrap_or(on))
}

/// The page reports its theme background so the next launch opens in that
/// color immediately instead of flashing white while Discord loads.
#[tauri::command]
fn set_background(app: AppHandle, color: String) -> Result<(), String> {
    if parse_hex(&color).is_none() {
        return Err("invalid color".into());
    }
    let mut cfg = config::load(&app);
    if cfg.background.as_deref() != Some(color.as_str()) {
        cfg.background = Some(color);
        config::save(&app, &cfg)?;
    }
    Ok(())
}

fn parse_hex(s: &str) -> Option<tauri::webview::Color> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some(tauri::webview::Color((v >> 16) as u8, (v >> 8) as u8, v as u8, 255))
}

#[tauri::command]
fn set_memory(
    app: AppHandle,
    js_optimize_size: Option<bool>,
    gpu_in_process: Option<bool>,
    tray_trim: Option<bool>,
    idle_trim: Option<bool>,
    native_titlebar: Option<bool>,
    gpu_boost: Option<bool>,
) -> Result<Info, String> {
    let mut cfg = config::load(&app);
    if let Some(v) = js_optimize_size {
        cfg.js_optimize_size = v;
    }
    if let Some(v) = gpu_in_process {
        cfg.gpu_in_process = v;
    }
    if let Some(v) = tray_trim {
        cfg.tray_trim = v;
    }
    if let Some(v) = idle_trim {
        cfg.idle_trim = v;
    }
    if let Some(v) = native_titlebar {
        cfg.native_titlebar = v;
    }
    if let Some(v) = gpu_boost {
        cfg.gpu_boost = v;
    }
    config::save(&app, &cfg)?;
    let loaded = app.state::<LoadedMod>().0.clone();
    Ok(info(&app, &cfg, loaded))
}

/// Open a link in the default browser (http, https and mailto only).
#[tauri::command]
fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return Err("unsupported link".into());
    }
    open_url_once(&app, &url)
}

/// Writes a diagnostic snapshot (About → Stream → "Save diagnostics", and
/// automatically while a stream is up) next to the config file.
#[tauri::command]
fn write_diag(app: AppHandle, text: String) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("stream-diag.txt");
    let mut body = text;
    if body.len() > 200_000 {
        let cut = (0..=200_000).rev().find(|i| body.is_char_boundary(*i)).unwrap_or(0);
        body.truncate(cut);
    }
    let tmp = dir.join("stream-diag.txt.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    Ok(file.to_string_lossy().into_owned())
}

/// When the page's own download last started (so a rescue can tell it worked).
static LAST_DL: Mutex<Option<std::time::Instant>> = Mutex::new(None);

fn note_download_started() {
    *LAST_DL.lock().unwrap_or_else(|e| e.into_inner()) = Some(std::time::Instant::now());
}

/// A file name that is safe to create: no folders, no characters Windows rejects.
fn safe_file_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { "download".into() } else { cleaned.chars().take(150).collect() }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 <= b.len() - 1 {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Creates a new file in `dir` (never overwriting one), marks it as downloaded from the
/// internet so SmartScreen checks it, and returns its path.
fn write_new_file(dir: &std::path::Path, name: &str, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    let p = std::path::Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "download".into());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let reserved = ["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"];
    let stem = if reserved.contains(&stem.to_lowercase().as_str()) { format!("_{stem}") } else { stem };
    for n in 0..1000 {
        let file = if n == 0 { format!("{stem}{ext}") } else { format!("{stem} ({n}){ext}") };
        let target = dir.join(&file);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(mut f) => {
                f.write_all(bytes).map_err(|e| e.to_string())?;
                #[cfg(windows)]
                {
                    let mut z = target.as_os_str().to_owned();
                    z.push(":Zone.Identifier");
                    let _ = std::fs::write(z, "[ZoneTransfer]\r\nZoneId=3\r\n");
                }
                return Ok(target);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("could not pick a file name".into())
}

/// Backup for a download click that did nothing: fetch a Discord attachment
/// ourselves and save it to Downloads. Returns the saved file's name, or an
/// empty string if the page's own download went ahead (nothing to do).
#[tauri::command]
async fn save_url(app: AppHandle, url: String, name: Option<String>) -> Result<String, String> {
    let u = Url::parse(&url).map_err(|e| e.to_string())?;
    let host = u.host_str().unwrap_or_default();
    if u.scheme() != "https" || !(host == "cdn.discordapp.com" || host == "media.discordapp.net") {
        return Err("not a Discord attachment".into());
    }
    let t0 = std::time::Instant::now();
    let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(900))).await;
    if LAST_DL.lock().unwrap_or_else(|e| e.into_inner()).map(|t| t > t0).unwrap_or(false) {
        return Ok(String::new());
    }
    let fallback = u.path_segments().and_then(|mut s| s.next_back()).map(percent_decode).unwrap_or_default();
    let file_name = safe_file_name(&name.filter(|n| !n.trim().is_empty()).unwrap_or(fallback));
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let mut res = mods::client(false)?.get(u).send().await.map_err(|e| format!("download failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("download failed: HTTP {}", res.status()));
    }
    const MAX: u64 = 150 * 1024 * 1024;
    if res.content_length().map(|l| l > MAX).unwrap_or(false) {
        return Err("file too large".into());
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("download failed: {e}"))? {
        if (bytes.len() + chunk.len()) as u64 > MAX {
            return Err("file too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let target = tauri::async_runtime::spawn_blocking({ let n = file_name.clone(); move || write_new_file(&dir, &n, &bytes) })
        .await
        .map_err(|e| e.to_string())??;
    log_event(&app, &format!("rescued download saved: {}", target.display()));
    Ok(target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(file_name))
}

/// The last part of net-events.txt, for "Report a problem".
#[tauri::command]
fn read_net_events(app: AppHandle) -> String {
    let Ok(dir) = app.path().app_config_dir() else { return String::new() };
    let text = std::fs::read_to_string(dir.join("net-events.txt")).unwrap_or_default();
    let start = text.len().saturating_sub(6000);
    let start = (start..text.len()).find(|i| text.is_char_boundary(*i)).unwrap_or(text.len());
    strip_queries(&text[start..])
}

/// Drops everything after a `?` up to the next space, so signed links (attachment
/// tokens, session ids) never reach the log or a problem report.
fn strip_queries(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut skipping = false;
    for c in line.chars() {
        if skipping {
            if c.is_whitespace() { skipping = false; out.push(c); }
        } else if c == '?' {
            skipping = true;
            out.push_str("?…");
        } else {
            out.push(c);
        }
    }
    out
}

/// Appends one line to net-events.txt next to the config (navigation, pop-up and
/// download events, for diagnosing links and downloads). Capped at ~100 KB.
static LOG_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn log_event(app: &AppHandle, line: &str) {
    use std::io::Write;
    let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(dir) = app.path().app_config_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("net-events.txt");
    if std::fs::metadata(&file).map(|m| m.len() > 100_000).unwrap_or(false) {
        let _ = std::fs::rename(&file, dir.join("net-events.old.txt"));
    }
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let short: String = strip_queries(line).chars().take(600).collect();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
        let _ = writeln!(f, "{secs} {short}");
    }
}

#[tauri::command]
fn log_page_event(app: AppHandle, line: String) {
    log_event(&app, &format!("page: {line}"));
}

/// Show a finished download in its folder (the file must be in Downloads).
#[tauri::command]
fn reveal_download(app: AppHandle, name: String) -> Result<(), String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let file = std::path::Path::new(&name).file_name().ok_or("bad name")?;
    let path = dir.join(file);
    if !path.exists() {
        return Err("file not found".into());
    }
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// A free file name in `dir`: "report.txt", then "report (1).txt", …
fn unique_download_path(dir: &std::path::Path, name: &std::ffi::OsStr) -> std::path::PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = std::path::Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "download".into());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..1000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or(first)
}

/// The page is in (or left) a voice/video call.
// Async: it takes the overlay lock, which a window being created on another thread holds
// while it waits for the main thread. A sync command (main thread) would deadlock there.
#[tauri::command]
async fn set_in_call(app: AppHandle, on: bool) {
    if !on {
        overlay::close(&app);
    }
    lean::set_in_call(&app, on);
}

/// Taskbar overlay badge. Empty `rgba` clears it. Windows only.
#[tauri::command]
fn set_badge(app: AppHandle, rgba: Vec<u8>, width: u32, height: u32) {
    #[cfg(windows)]
    if let Some(w) = app.get_webview_window(MAIN) {
        let img = if rgba.is_empty() || width == 0 || height == 0 || width > 256 || height > 256 || rgba.len() as u64 != u64::from(width) * u64::from(height) * 4 {
            None
        } else {
            Some(tauri::image::Image::new_owned(rgba, width, height))
        };
        let _ = w.set_overlay_icon(img);
    }
    #[cfg(not(windows))]
    let _ = (app, rgba, width, height);
}

#[tauri::command]
fn set_lean(app: AppHandle, enabled: bool) -> Result<Info, String> {
    let mut cfg = config::load(&app);
    cfg.disable_lean = !enabled;
    config::save(&app, &cfg)?;
    let loaded = app.state::<LoadedMod>().0.clone();
    Ok(info(&app, &cfg, loaded))
}

// ── Custom title bar ─────────────────────────────────────────────────────────
// The native title bar is off; Discord's own top bar becomes the title bar
// (see inject/48-titlebar.js). These are the only window controls exposed.

fn main_window(app: &AppHandle) -> Option<tauri::Window> {
    app.get_webview_window(MAIN).map(|w| w.as_ref().window())
}

#[tauri::command]
fn win_drag(app: AppHandle) {
    if let Some(w) = main_window(&app) {
        let _ = w.start_dragging();
    }
}

#[tauri::command]
fn win_resize(app: AppHandle, edge: String) {
    use tauri_runtime::ResizeDirection as D;
    let dir = match edge.as_str() {
        "n" => D::North,
        "s" => D::South,
        "e" => D::East,
        "w" => D::West,
        "ne" => D::NorthEast,
        "nw" => D::NorthWest,
        "se" => D::SouthEast,
        "sw" => D::SouthWest,
        _ => return,
    };
    if let Some(w) = main_window(&app) {
        let _ = w.start_resize_dragging(dir);
    }
}

#[tauri::command]
fn win_minimize(app: AppHandle) {
    if let Some(w) = main_window(&app) {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn win_toggle_maximize(app: AppHandle) -> bool {
    let Some(w) = main_window(&app) else { return false };
    let max = w.is_maximized().unwrap_or(false);
    let _ = if max { w.unmaximize() } else { w.maximize() };
    !max
}

#[tauri::command]
fn win_is_maximized(app: AppHandle) -> bool {
    main_window(&app).and_then(|w| w.is_maximized().ok()).unwrap_or(false)
}

/// Close = hide to the tray, same as before.
#[tauri::command]
fn win_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.hide();
        lean::on_hidden(&app);
    }
}

// ── Native screen share ──────────────────────────────────────────────────────

#[tauri::command]
async fn capture_sources(app: AppHandle, thumbs: bool) -> Result<Vec<capture::Source>, String> {
    let list = tauri::async_runtime::spawn_blocking(move || capture::list_sources(thumbs))
        .await
        .map_err(|e| e.to_string())??;
    capture::remember_listed(&app.state::<capture::CaptureState>(), &list);
    Ok(list)
}

#[tauri::command]
async fn capture_start(app: AppHandle, req: capture::StartRequest) -> Result<capture::StartInfo, String> {
    let window = app.get_webview_window(MAIN).ok_or("no window")?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || capture::start(&handle.state::<capture::CaptureState>(), window, req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn capture_stop(app: AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || capture::stop(&app.state::<capture::CaptureState>())).await;
}

/// Discord changed the stream quality while live.
#[tauri::command]
fn capture_configure(state: State<'_, capture::CaptureState>, max_width: u32, max_height: u32, fps: u32) {
    capture::configure(&state, max_width, max_height, fps);
}

/// Batched acks from the page: `[[slotId, seq], …]`. Async so it never runs
/// on the UI thread, which is busy posting frames.
#[tauri::command]
async fn capture_ack(state: State<'_, capture::CaptureState>, acks: Vec<(u32, u64)>) -> Result<(), ()> {
    capture::ack(&state, &acks);
    Ok(())
}

/// Choose which mod loads on next start (`None` turns mods off). Downloads it
/// first if it isn't cached yet.
#[tauri::command]
async fn set_mod(app: AppHandle, id: Option<String>) -> Result<Info, String> {
    if let Some(id) = &id {
        mods::find(id).ok_or("unknown mod")?;
        let installed = mods::status(&app).iter().any(|m| m.id == id.as_str() && m.installed);
        if !installed {
            mods::download(&app, id).await?;
        }
    }
    let mut cfg = config::load(&app);
    cfg.client_mod = id;
    config::save(&app, &cfg)?;
    let loaded = app.state::<LoadedMod>().0.clone();
    Ok(info(&app, &cfg, loaded))
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

#[tauri::command]
async fn check_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = update;
    Ok(info)
}

#[tauri::command]
async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending.0.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("no update pending")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
async fn mod_fetch(req: mods::FetchRequest) -> Result<mods::FetchResponse, String> {
    mods::fetch(req).await
}

// ── App ──────────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        // A second launch just focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        // Remember size and position, but not the frame: older versions saved
        // "has a Windows title bar", which would bring that bar back.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .manage(capture::CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            get_info,
            set_mod,
            restart_app,
            check_update,
            install_update,
            mod_fetch,
            set_lean,
            set_memory,
            set_background,
            set_in_call,
            reveal_download,
            save_url,
            overlay_update,
            overlay_close,
            free_memory,
            get_autostart,
            set_autostart,
            read_net_events,
            log_page_event,
            write_diag,
            set_badge,
            open_link,
            capture_sources,
            capture_start,
            capture_stop,
            capture_ack,
            capture_configure,
            win_drag,
            win_resize,
            win_minimize,
            win_toggle_maximize,
            win_is_maximized,
            win_close
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let nav_handle = handle.clone();
            let popup_handle = handle.clone();

            // Client mod chosen last session (if it's been downloaded).
            let cfg = config::load(&handle);
            let mod_script = cfg.client_mod.as_deref().and_then(|id| mods::startup_script(&handle, id));
            let loaded_mod = mod_script.as_ref().and(cfg.client_mod.clone());
            app.manage(LoadedMod(loaded_mod.clone()));
            let lean = !cfg.disable_lean;
            app.manage(Active {
                lean,
                js_small: cfg.js_optimize_size,
                gpu_in_process: cfg.gpu_in_process,
                gpu_boost: cfg.gpu_boost,
                native_titlebar: cfg.native_titlebar,
            });

            let started_minimized = std::env::args().any(|a| a == "--minimized");
            let mut builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(DISCORD_URL.parse()?))
                .title("Driftcord")
                // One bar: Discord's top bar is the title bar (with our own
                // controls), like the official app. Shadow keeps Windows 11's
                // rounded corners and border.
                .decorations(cfg.native_titlebar)
                .shadow(true)
                .visible(!started_minimized)
                .inner_size(1280.0, 800.0)
                .min_inner_size(940.0, 500.0)
                .background_color(
                    cfg.background.as_deref().and_then(parse_hex).unwrap_or(tauri::webview::Color(0x13, 0x1f, 0x33, 255)),
                )
                .initialization_script(injection_script());
            let browser_args = lean::browser_args(lean, cfg.js_optimize_size, cfg.gpu_in_process, cfg.gpu_boost);
            let _ = overlay::BROWSER_ARGS.set(browser_args.clone());
            if let Some(args) = browser_args {
                builder = builder.additional_browser_args(&args);
            }
            if let Some(script) = mod_script {
                builder = builder.initialization_script(script);
            }

            let load_handle = handle.clone();
            let main = builder
                .on_page_load(move |_w, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        let h = load_handle.clone();
                        std::thread::spawn(move || capture::stop(&h.state::<capture::CaptureState>()));
                    }
                })
                // Keep the main window on Discord; send everything else to the browser.
                // File downloads (attachments, "Download" in the message menu) save to
                // the Downloads folder; the page then says where it went.
                .on_download(|webview, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            note_download_started();
                            log_event(&webview.app_handle(), &format!("download requested: {url} -> {}", destination.display()));
                            if let Ok(dir) = webview.app_handle().path().download_dir() {
                                let name = destination
                                    .file_name()
                                    .map(|n| n.to_os_string())
                                    .unwrap_or_else(|| "download".into());
                                *destination = unique_download_path(&dir, &name);
                            }
                        }
                        DownloadEvent::Finished { url, path, success } => {
                            log_event(&webview.app_handle(), &format!("download finished: {url} ok={success} path={path:?}"));
                            let name = path
                                .as_ref()
                                .and_then(|p| p.file_name())
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_default();
                            let js = format!(
                                "window.__driftcordDownloaded && window.__driftcordDownloaded({}, {});",
                                serde_json::to_string(&name).unwrap_or_else(|_| "\"\"".into()),
                                success
                            );
                            let _ = webview.eval(&js);
                        }
                        _ => {}
                    }
                    true
                })
                .on_navigation(move |url| {
                    log_event(&nav_handle, &format!("navigate: {url} allowed={}", is_allowed(url)));
                    if is_allowed(url) {
                        true
                    } else {
                        open_external(&nav_handle, url);
                        false
                    }
                })
                // Links with target=_blank / window.open: open in the default browser.
                .on_new_window(move |url, _features| {
                    log_event(&popup_handle, &format!("new window: {url}"));
                    // Discord's own pop-outs (stream viewer, video, call) open a blank
                    // window or a discord.com page that Discord then fills in: give them
                    // a real window of their own. Everything else goes to the browser.
                    let discord_popout = url.as_str() == "about:blank"
                        || (url.scheme() == "https" && url.host_str() == Some("discord.com"));
                    if discord_popout {
                        // Let WebView2 open the window itself. Building one of our own from
                        // inside this callback hangs the app on Windows (0.4.47-0.4.49).
                        log_event(&popup_handle, "pop-out: letting WebView2 open it");
                        return NewWindowResponse::Allow;
                    }
                    open_external(&popup_handle, &url);
                    NewWindowResponse::Deny
                })
                // Voice, video, screen share and notifications need these.
                .on_permission_request(|_webview, kind| match kind {
                    PermissionKind::Microphone
                    | PermissionKind::Camera
                    | PermissionKind::DisplayCapture
                    | PermissionKind::Notifications => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                })
                .build()?;
            // Belt and braces: whatever was saved before, the frame follows the setting.
            let _ = main.set_decorations(cfg.native_titlebar);
            // Started by Windows at sign-in: stay in the tray until opened.
            if started_minimized {
                lean::on_hidden(&handle);
            }

            // Refresh the enabled mod in the background (the new copy loads next
            // start). Wait until Discord has finished loading, and skip it if the
            // cached copy is less than 12 hours old.
            if let Some(id) = loaded_mod {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    // First check shortly after Discord loads, then every few hours
                    // while the app stays open. A copy under 12 hours old is left alone.
                    let mut wait = 45u64;
                    loop {
                        let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(std::time::Duration::from_secs(wait))).await;
                        wait = 3 * 3600;
                        // Turned off or switched in the meantime: stop refreshing.
                        if config::load(&h).client_mod.as_deref() != Some(id.as_str()) {
                            break;
                        }
                        let fresh = mods::status(&h).iter().any(|m| {
                            m.id == id.as_str() && m.installed && mods::age_secs(m.updated) < 12 * 3600
                        });
                        if !fresh {
                            let _ = mods::download(&h, &id).await;
                        }
                    }
                });
            }

            // Tray: closing the window hides it here instead of quitting.
            let show = MenuItem::with_id(app, "show", "Show Driftcord", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Driftcord Settings", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
            let lean_label = if lean { "Restart without Lean mode" } else { "Restart in Lean mode" };
            let lean_item = MenuItem::with_id(app, "lean", lean_label, true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &reload, &lean_item, &sep, &quit])?;
            // Escape hatch in case Boosted graphics doesn't agree with a driver.
            if cfg.gpu_boost {
                let gfx = MenuItem::with_id(app, "gpu_standard", "Restart with standard graphics", true, None::<&str>)?;
                menu.insert(&gfx, 4)?;
            }

            let mut tray = TrayIconBuilder::with_id("driftcord-tray")
                .tooltip("Driftcord")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "settings" => {
                        show_main(app);
                        if let Some(w) = app.get_webview_window(MAIN) {
                            let _ = w.eval("window.__driftcordOpen && window.__driftcordOpen()");
                        }
                    }
                    "reload" => {
                        if let Some(w) = app.get_webview_window(MAIN) {
                            let _ = w.eval("location.reload()");
                        }
                    }
                    // Escape hatch that works even if the page can't render.
                    "lean" => {
                        let mut cfg = config::load(app);
                        cfg.disable_lean = !cfg.disable_lean;
                        let _ = config::save(app, &cfg);
                        app.restart();
                    }
                    "gpu_standard" => {
                        let mut cfg = config::load(app);
                        cfg.gpu_boost = false;
                        let _ = config::save(app, &cfg);
                        app.restart();
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN {
                return;
            }
            match event {
                // Close hides to the tray, and lets WebView2 trim memory.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    lean::on_hidden(window.app_handle());
                }
                WindowEvent::Resized(_) => {
                    if window.is_minimized().unwrap_or(false) {
                        lean::on_hidden(window.app_handle());
                    }
                }
                WindowEvent::Focused(true) => lean::on_shown(window.app_handle()),
                WindowEvent::Focused(false) => lean::on_unfocused(window.app_handle()),
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Driftcord");
}

#[cfg(test)]
mod log_tests {
    use super::strip_queries;

    #[test]
    fn signed_links_lose_their_tokens() {
        let l = "page: click anchor href=https://cdn.discordapp.com/attachments/1/2/a.txt?ex=1&hm=secret target=_blank";
        let out = strip_queries(l);
        assert!(!out.contains("secret") && !out.contains("ex=1"));
        assert!(out.contains("a.txt?…") && out.contains("target=_blank"));
        assert_eq!(strip_queries("no links here"), "no links here");
    }
}
