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
            background: None,
        }
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("driftcord.json"))
}

pub fn load(app: &AppHandle) -> Config {
    path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let p = path(app).ok_or("no config directory")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}
