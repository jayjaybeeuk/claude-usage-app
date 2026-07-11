// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude;
mod codex;
mod commands;
mod fetch_via_window;
mod settings;
mod state;
mod tray;

use serde_json::json;
use tauri::{LogicalPosition, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::state::AppState;

fn main() {
    crate::debug_log!("agent-usage starting");
    tauri::Builder::default()
        // Must be registered first: focuses the existing widget when a second
        // instance is launched (Electron's requestSingleInstanceLock).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // Claude credentials + usage
            claude::get_credentials,
            claude::save_credentials,
            claude::delete_credentials,
            claude::validate_session_key,
            claude::detect_session_key,
            claude::fetch_usage_data,
            claude::get_cached_usage,
            claude::get_organizations,
            claude::fetch_usage_for_org,
            // Hidden-window fetch bridge
            fetch_via_window::report_fetch_result,
            // Codex
            codex::get_codex_credentials,
            codex::save_codex_credentials,
            codex::delete_codex_credentials,
            codex::detect_codex_token,
            codex::fetch_codex_usage,
            codex::get_cached_codex_usage,
            // Window controls
            commands::minimize_window,
            commands::close_window,
            commands::resize_window,
            commands::get_window_position,
            commands::set_window_position,
            commands::open_external,
            commands::get_platform,
            // Usage history + settings
            commands::get_usage_history,
            commands::save_usage_history_entry,
            commands::clear_usage_history,
            commands::get_refresh_interval,
            commands::set_refresh_interval,
            commands::get_theme,
            commands::set_theme,
            commands::get_background_hue,
            commands::set_background_hue,
            // Auto-start
            commands::is_auto_start_supported,
            commands::get_auto_start,
            commands::set_auto_start,
            // Tray
            tray::update_tray_usage,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Menu bar widget: no dock icon / app switcher entry on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(win) = app.get_webview_window("main") {
                // Restore saved position before first paint.
                if let Some(pos) = settings::get(&handle, "windowPosition") {
                    if let (Some(x), Some(y)) = (
                        pos.get("x").and_then(|v| v.as_f64()),
                        pos.get("y").and_then(|v| v.as_f64()),
                    ) {
                        let _ = win.set_position(LogicalPosition::new(x, y));
                    }
                }
                let _ = win.show();
            }

            tray::create_tray(&handle)?;
            commands::sync_auto_start(&handle);

            // Re-plant the session cookie from stored credentials, mirroring
            // Electron's on-ready behavior (covers platforms where webview
            // cookie persistence is not guaranteed).
            if let Some(session_key) = settings::get_string(&handle, "sessionKey") {
                let cookie_handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    claude::ensure_session_cookie(&cookie_handle, &session_key).await;
                });
            }

            // Self-test for the hidden-window fetch path (remote IPC from
            // claude.ai pages). Run with TEST_FETCH=1; expects a JSON error
            // from the API since no session cookie is present.
            if std::env::var("TEST_FETCH").map(|v| v == "1").unwrap_or(false) {
                let url = std::env::var("TEST_FETCH_URL")
                    .unwrap_or_else(|_| "https://claude.ai/api/organizations".into());
                let test_handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let result =
                        fetch_via_window::fetch_via_window(&test_handle, &url, None, 30000).await;
                    println!("[TEST_FETCH] {url} => {result:?}");
                });
            }

            Ok(())
        })
        .on_page_load(|webview, payload| {
            crate::debug_log!(
                "page load: window={} event={:?} url={}",
                webview.label(),
                payload.event(),
                payload.url()
            );
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                // Hide to tray instead of quitting (tray Exit calls app.exit).
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Moved(position) => {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let logical = position.to_logical::<f64>(scale);
                    settings::set(
                        window.app_handle(),
                        "windowPosition",
                        json!({ "x": logical.x, "y": logical.y }),
                    );
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
