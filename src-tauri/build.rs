// Declaring an app manifest makes ALL app commands ACL-gated, so every
// command must be listed here and granted to a window in a capability file.
// This is required so `report_fetch_result` gets a permission that can be
// granted to remote claude.ai pages (see capabilities/remote-fetch.json);
// the rest are granted to the main window in capabilities/default.json.
const COMMANDS: &[&str] = &[
    // Claude credentials + usage
    "get_credentials",
    "save_credentials",
    "delete_credentials",
    "validate_session_key",
    "detect_session_key",
    "fetch_usage_data",
    "get_cached_usage",
    "get_organizations",
    "fetch_usage_for_org",
    // Hidden-window fetch bridge (remote claude.ai pages)
    "report_fetch_result",
    // Codex
    "get_codex_credentials",
    "save_codex_credentials",
    "delete_codex_credentials",
    "detect_codex_token",
    "fetch_codex_usage",
    "get_cached_codex_usage",
    // Window controls
    "minimize_window",
    "close_window",
    "resize_window",
    "get_window_position",
    "set_window_position",
    "open_external",
    "get_platform",
    // Usage history + settings
    "get_usage_history",
    "save_usage_history_entry",
    "clear_usage_history",
    "get_refresh_interval",
    "set_refresh_interval",
    "get_theme",
    "set_theme",
    "get_background_hue",
    "set_background_hue",
    // Auto-start
    "is_auto_start_supported",
    "get_auto_start",
    "set_auto_start",
    // Tray
    "update_tray_usage",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
