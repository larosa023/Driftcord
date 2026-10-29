const COMMANDS: &[&str] = &[
    "get_info",
    "set_mod",
    "restart_app",
    "check_update",
    "install_update",
    "mod_fetch",
    "set_lean",
    "set_memory",
    "capture_sources",
    "capture_start",
    "capture_stop",
    "capture_ack",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
