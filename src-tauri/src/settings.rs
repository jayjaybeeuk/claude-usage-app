//! Persistent settings backed by tauri-plugin-store (JSON file in app data dir).
//! Key names intentionally match the old electron-store schema.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const STORE_FILE: &str = "settings.json";

pub fn get(app: &AppHandle, key: &str) -> Option<Value> {
    app.store(STORE_FILE).ok().and_then(|s| s.get(key)).filter(|v| !v.is_null())
}

pub fn get_string(app: &AppHandle, key: &str) -> Option<String> {
    get(app, key).and_then(|v| v.as_str().map(String::from))
}

pub fn set(app: &AppHandle, key: &str, value: Value) {
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(key, value);
        let _ = store.save();
    }
}

pub fn delete(app: &AppHandle, key: &str) {
    if let Ok(store) = app.store(STORE_FILE) {
        store.delete(key);
        let _ = store.save();
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Verbose logging gated behind DEBUG_LOG=1, mirroring the Electron debugLog().
pub fn debug_enabled() -> bool {
    std::env::var("DEBUG_LOG").map(|v| v == "1").unwrap_or(false)
}

#[macro_export]
macro_rules! debug_log {
    ($($arg:tt)*) => {
        if $crate::settings::debug_enabled() {
            println!("[Debug] {}", format!($($arg)*));
        }
    };
}
