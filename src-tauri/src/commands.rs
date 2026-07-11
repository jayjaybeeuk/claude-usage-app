//! Window controls, settings, usage history, and auto-start commands,
//! ported from the Electron IPC handlers.

use serde_json::{json, Value};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

use crate::debug_log;
use crate::settings;

pub const WIDGET_WIDTH: f64 = 480.0;

// Keep in sync with src/shared/refresh-interval.ts (used by the renderer).
const MIN_REFRESH_MINUTES: i64 = 1;
const MAX_REFRESH_MINUTES: i64 = 20;
const DEFAULT_REFRESH_MINUTES: i64 = 5;

const VALID_THEMES: [&str; 5] = ["purple", "lilac", "orange", "green", "metallic"];
const VALID_BACKGROUND_HUES: [&str; 6] = ["match", "purple", "lilac", "orange", "green", "metallic"];

fn clamp_refresh_minutes(value: f64) -> i64 {
    if !value.is_finite() {
        return DEFAULT_REFRESH_MINUTES;
    }
    (value.round() as i64).clamp(MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES)
}

// ─── Window controls ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn minimize_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn close_window(app: AppHandle) {
    // Hide to tray on all platforms (X button = minimize to tray).
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn resize_window(app: AppHandle, height: f64) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(LogicalSize::new(WIDGET_WIDTH, height));
    }
}

#[tauri::command]
pub fn get_window_position(app: AppHandle) -> Option<Value> {
    let win = app.get_webview_window("main")?;
    let scale = win.scale_factor().ok()?;
    let pos = win.outer_position().ok()?.to_logical::<f64>(scale);
    let size = win.outer_size().ok()?.to_logical::<f64>(scale);
    Some(json!({ "x": pos.x, "y": pos.y, "width": size.width, "height": size.height }))
}

#[tauri::command]
pub fn set_window_position(app: AppHandle, x: f64, y: f64) -> bool {
    if let Some(win) = app.get_webview_window("main") {
        win.set_position(LogicalPosition::new(x, y)).is_ok()
    } else {
        false
    }
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) {
    let _ = app.opener().open_url(url, None::<&str>);
}

#[tauri::command]
pub fn get_platform() -> &'static str {
    // Node-style platform names, matching what the renderer expects.
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => {
            if other == "linux" {
                "linux"
            } else {
                other
            }
        }
    }
}

// ─── Usage history (30-day retention) ────────────────────────────────────────

#[tauri::command]
pub fn get_usage_history(app: AppHandle) -> Value {
    settings::get(&app, "usageHistory").unwrap_or_else(|| json!([]))
}

#[tauri::command]
pub fn save_usage_history_entry(app: AppHandle, entry: Value) -> bool {
    let mut history = settings::get(&app, "usageHistory")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    history.push(entry);
    // Prune entries older than 30 days.
    let cutoff = settings::now_ms() - 30 * 24 * 60 * 60 * 1000;
    history.retain(|e| {
        e.get("timestamp")
            .and_then(|t| t.as_i64())
            .map(|t| t >= cutoff)
            .unwrap_or(false)
    });
    settings::set(&app, "usageHistory", Value::Array(history));
    true
}

#[tauri::command]
pub fn clear_usage_history(app: AppHandle) -> bool {
    settings::set(&app, "usageHistory", json!([]));
    true
}

// ─── Refresh interval / theme settings ───────────────────────────────────────

#[tauri::command]
pub fn get_refresh_interval(app: AppHandle) -> i64 {
    let saved = settings::get(&app, "refreshIntervalMinutes")
        .and_then(|v| v.as_f64())
        .unwrap_or(DEFAULT_REFRESH_MINUTES as f64);
    clamp_refresh_minutes(saved)
}

#[tauri::command]
pub fn set_refresh_interval(app: AppHandle, minutes: f64) -> i64 {
    let clamped = clamp_refresh_minutes(minutes);
    settings::set(&app, "refreshIntervalMinutes", json!(clamped));
    clamped
}

#[tauri::command]
pub fn get_theme(app: AppHandle) -> String {
    settings::get_string(&app, "theme").unwrap_or_else(|| "purple".into())
}

#[tauri::command]
pub fn set_theme(app: AppHandle, theme: String) -> String {
    let valid = if VALID_THEMES.contains(&theme.as_str()) {
        theme
    } else {
        "purple".into()
    };
    settings::set(&app, "theme", json!(valid));
    valid
}

#[tauri::command]
pub fn get_background_hue(app: AppHandle) -> String {
    settings::get_string(&app, "backgroundHue").unwrap_or_else(|| "match".into())
}

#[tauri::command]
pub fn set_background_hue(app: AppHandle, background_hue: String) -> String {
    let valid = if VALID_BACKGROUND_HUES.contains(&background_hue.as_str()) {
        background_hue
    } else {
        "match".into()
    };
    settings::set(&app, "backgroundHue", json!(valid));
    valid
}

// ─── Auto-start ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn is_auto_start_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

#[tauri::command]
pub fn get_auto_start(app: AppHandle) -> bool {
    if !is_auto_start_supported() {
        return false;
    }
    settings::get(&app, "autoStartEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

#[tauri::command]
pub fn set_auto_start(app: AppHandle, enabled: bool) -> bool {
    if !is_auto_start_supported() {
        return false;
    }
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    match result {
        Ok(()) => {
            settings::set(&app, "autoStartEnabled", json!(enabled));
            enabled
        }
        Err(e) => {
            debug_log!("Failed to set auto-start: {e}");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_refresh_minutes_into_range() {
        assert_eq!(clamp_refresh_minutes(5.0), 5);
        assert_eq!(clamp_refresh_minutes(0.0), 1);
        assert_eq!(clamp_refresh_minutes(-3.0), 1);
        assert_eq!(clamp_refresh_minutes(99.0), 20);
        assert_eq!(clamp_refresh_minutes(7.6), 8);
        assert_eq!(clamp_refresh_minutes(f64::NAN), DEFAULT_REFRESH_MINUTES);
        assert_eq!(clamp_refresh_minutes(f64::INFINITY), DEFAULT_REFRESH_MINUTES);
    }

    #[test]
    fn reports_node_style_platform_names() {
        let platform = get_platform();
        assert!(["darwin", "win32", "linux"].contains(&platform));
        #[cfg(target_os = "macos")]
        assert_eq!(platform, "darwin");
    }

    #[test]
    fn auto_start_support_matches_desktop_platforms() {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        assert!(is_auto_start_supported());
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert!(!is_auto_start_supported());
    }
}

/// Align the OS launch agent with the stored setting on startup, mirroring
/// the Electron sync-on-ready behavior.
pub fn sync_auto_start(app: &AppHandle) {
    if !is_auto_start_supported() {
        return;
    }
    let stored = settings::get(app, "autoStartEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let autolaunch = app.autolaunch();
    let system = autolaunch.is_enabled().unwrap_or(false);
    if stored != system {
        debug_log!("Syncing auto-start setting: {stored} vs system: {system}");
        let result = if stored {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        if let Err(e) = result {
            debug_log!("Failed to sync auto-start setting on startup: {e}");
        }
    }
}
