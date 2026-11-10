//! Small native-side config (things that must be known before the window opens).

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Which client mod to load: "vencord", "equicord" or none.
    pub client_mod: Option<String>,
    /// Lean mode (fewer WebView2 processes) is on unless this is set.
    pub disable_lean: bool,
    /// Ask V8 to favour memory over speed (applies on restart).
    pub js_optimize_size: bool,
    /// Release memory after the window has been hidden/minimized a while.
    pub tray_trim: bool,
    pub tray_trim_minutes: u32,
    /// Light trim while visible but unfocused.
    pub idle_trim: bool,
    /// Run graphics inside the browser process (lighter, can cap FPS).
    pub gpu_in_process: bool,
    /// Boosted graphics for older PCs: use the GPU even if Chromium has it on
    /// its blocklist, rasterize on the GPU, and prefer the faster GPU.
    pub gpu_boost: bool,
    /// Use Windows' own title bar instead of Discord's bar.
    pub native_titlebar: bool,
    /// Theme background (hex) so the window opens in the right color, not white.
    pub background: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            client_mod: None,
            disable_lean: false,
            js_optimize_size: true,
            tray_trim: true,
            tray_trim_minutes: 2,
            idle_trim: true,
            gpu_in_process: false,
            gpu_boost: false,
            native_titlebar: false,
            background: None,
        }
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("driftcord.json"))
}

static CACHE: std::sync::RwLock<Option<Config>> = std::sync::RwLock::new(None);

/// Current config (read from disk once, then kept in memory).
pub fn load(app: &AppHandle) -> Config {
    if let Some(c) = CACHE.read().unwrap_or_else(|e| e.into_inner()).as_ref() {
        return c.clone();
    }
    let raw = match path(app).map(fs::read_to_string) {
        Some(Ok(s)) => Some(s),
        Some(Err(e)) if e.kind() != std::io::ErrorKind::NotFound => {
            // Locked or unreadable right now (antivirus, say): use defaults for this
            // call but don't remember them, so a later save can't wipe the real file.
            return Config::default();
        }
        _ => None,
    };
    let cfg: Config = match raw.as_deref().map(serde_json::from_str::<Config>) {
        Some(Ok(c)) => c,
        Some(Err(_)) => {
            // Unreadable settings: keep a copy instead of silently overwriting them.
            if let Some(p) = path(app) {
                let _ = fs::copy(&p, p.with_extension("json.bad"));
            }
            Config::default()
        }
        None => Config::default(),
    };
    *CACHE.write().unwrap_or_else(|e| e.into_inner()) = Some(cfg.clone());
    cfg
}

static SAVE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = path(app).ok_or("no config directory")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    *CACHE.write().unwrap_or_else(|e| e.into_inner()) = Some(cfg.clone());
    Ok(())
}
