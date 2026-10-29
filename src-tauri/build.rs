const COMMANDS: &[&str] = &[
    "get_info",
    "set_mod",
    "restart_app",
    "check_update",
    "install_update",
    "mod_fetch",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
