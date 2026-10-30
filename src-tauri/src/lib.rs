//! Driftcord: a thin native shell around Discord's web client.
//!
//! All features (voice, video, screen share) come from Discord's own web app.
//! Driftcord adds: telemetry blocking, a debloat layer, a theme engine, a modern
//! screen-share flow and an in-app settings panel (all injected from
//! `../inject/` before Discord loads), plus optional Vencord/Equicord support and
//! self-updating.

mod capture;
mod config;
mod lean;
mod mods;

use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{NewWindowResponse, PermissionKind, PermissionResponse},
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
        include_str!("../../inject/10-privacy.js"),
        include_str!("../../inject/20-debloat.js"),
        include_str!("../../inject/25-memory.js"),
        include_str!("../../inject/30-themes.js"),
        include_str!("../../inject/40-panel.js"),
        include_str!("../../inject/45-topbar.js"),
        include_str!("../../inject/47-changelog.js"),
        include_str!("../../inject/48-titlebar.js"),
        include_str!("../../inject/50-screenshare.js"),
        include_str!("../../inject/55-voice.js"),
        include_str!("../../inject/60-updates.js"),
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
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
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

/// The page is in (or left) a voice/video call.
#[tauri::command]
fn set_in_call(app: AppHandle, on: bool) {
    lean::set_in_call(&app, on);
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
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

#[tauri::command]
async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("no update pending")?;
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
        // A second launch just focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        // Remember size and position, but not the frame: older versions saved
        // "has a Windows title bar", which would bring that bar back.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::DECORATIONS)
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
            capture_sources,
            capture_start,
            capture_stop,
            capture_ack,
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

            let mut builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(DISCORD_URL.parse()?))
                .title("Driftcord")
                // One bar: Discord's top bar is the title bar (with our own
                // controls), like the official app. Shadow keeps Windows 11's
                // rounded corners and border.
                .decorations(cfg.native_titlebar)
                .shadow(true)
                .inner_size(1280.0, 800.0)
                .min_inner_size(940.0, 500.0)
                .background_color(
                    cfg.background.as_deref().and_then(parse_hex).unwrap_or(tauri::webview::Color(0x13, 0x1f, 0x33, 255)),
                )
                .initialization_script(injection_script());
            if let Some(args) = lean::browser_args(lean, cfg.js_optimize_size, cfg.gpu_in_process, cfg.gpu_boost) {
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
                .on_navigation(move |url| {
                    if is_allowed(url) {
                        true
                    } else {
                        open_external(&nav_handle, url);
                        false
                    }
                })
                // Links with target=_blank / window.open: open in the default browser.
                .on_new_window(move |url, _features| {
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

            // Refresh the enabled mod in the background (the new copy loads next
            // start). Wait until Discord has finished loading, and skip it if the
            // cached copy is less than 12 hours old.
            if let Some(id) = loaded_mod {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let fresh = mods::status(&h).iter().any(|m| {
                        m.id == id.as_str() && m.installed && mods::age_secs(m.updated) < 12 * 3600
                    });
                    if !fresh {
                        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_secs(45))).await;
                        let _ = mods::download(&h, &id).await;
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
