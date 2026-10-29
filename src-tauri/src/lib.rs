//! Driftcord: a thin native shell around Discord's web client.
//!
//! All features (voice, video, screen share) come from Discord's own web app.
//! Driftcord adds: telemetry blocking, a debloat layer, a theme engine, a modern
//! screen-share flow and an in-app settings panel (all injected from
//! `../inject/` before Discord loads), plus optional Vencord/Equicord support and
//! self-updating.

mod config;
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
        include_str!("../../inject/30-themes.js"),
        include_str!("../../inject/40-panel.js"),
        include_str!("../../inject/50-screenshare.js"),
        include_str!("../../inject/60-updates.js"),
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
}

struct LoadedMod(Option<String>);

#[tauri::command]
fn get_info(app: AppHandle, loaded: State<'_, LoadedMod>) -> Info {
    Info {
        version: env!("CARGO_PKG_VERSION"),
        client_mod: config::load(&app).client_mod,
        loaded_mod: loaded.0.clone(),
        mods: mods::status(&app),
    }
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
    Ok(Info {
        version: env!("CARGO_PKG_VERSION"),
        client_mod: cfg.client_mod,
        loaded_mod: loaded,
        mods: mods::status(&app),
    })
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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            get_info,
            set_mod,
            restart_app,
            check_update,
            install_update,
            mod_fetch
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

            let mut builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(DISCORD_URL.parse()?))
                .title("Driftcord")
                .inner_size(1280.0, 800.0)
                .min_inner_size(940.0, 500.0)
                .initialization_script(injection_script());
            if let Some(script) = mod_script {
                builder = builder.initialization_script(script);
            }

            builder
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
                // Voice, video, screen share, notifications and paste need these.
                .on_permission_request(|_webview, kind| match kind {
                    PermissionKind::Microphone
                    | PermissionKind::Camera
                    | PermissionKind::DisplayCapture
                    | PermissionKind::Notifications
                    | PermissionKind::ClipboardRead => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                })
                .build()?;

            // Refresh the enabled mod in the background; the new copy loads next start.
            if let Some(id) = loaded_mod {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = mods::download(&h, &id).await;
                });
            }

            // Tray: closing the window hides it here instead of quitting.
            let show = MenuItem::with_id(app, "show", "Show Driftcord", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Driftcord Settings", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &reload, &sep, &quit])?;

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
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Driftcord");
}
