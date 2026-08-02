//! Persistent settings backed by tauri-plugin-store (JSON file in app data dir).
//! Sensitive credentials are stored in OS keyring via keyring crate.
//! Key names intentionally match the old electron-store schema for non-sensitive data.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use keyring::Entry;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const STORE_FILE: &str = "settings.json";

// Keyring service name
const KEYRING_SERVICE: &str = "com.claudeusage.widget";

// Keys stored in keyring (encrypted)
const KEYRING_KEYS: &[&str] = &[
    "sessionKey",
    "organizationId",
    "codexAccessToken",
    "codexCookieName",
];

/// Check if a key should be stored in keyring (encrypted)
fn is_keyring_key(key: &str) -> bool {
    KEYRING_KEYS.contains(&key)
}

/// Get value from keyring (decrypted)
fn get_from_keyring(app: &AppHandle, key: &str) -> Option<String> {
    if !is_keyring_key(key) {
        return None;
    }
    
    let entry = match Entry::new(KEYRING_SERVICE, &format!("{}-{}", app.config().identifier, key)) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Failed to create keyring entry for {}: {}", key, e);
            return None;
        }
    };
    
    match entry.get_password() {
        Ok(password) => Some(password),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            eprintln!("Failed to get keyring password for {}: {}", key, e);
            None
        }
    }
}

/// Set value in keyring (encrypted)
fn set_in_keyring(app: &AppHandle, key: &str, value: &str) {
    if !is_keyring_key(key) {
        return;
    }
    
    let entry = match Entry::new(KEYRING_SERVICE, &format!("{}-{}", app.config().identifier, key)) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Failed to create keyring entry for {}: {}", key, e);
            return;
        }
    };
    
    if let Err(e) = entry.set_password(value) {
        eprintln!("Failed to set keyring password for {}: {}", key, e);
    }
}

/// Delete value from keyring
fn delete_from_keyring(app: &AppHandle, key: &str) {
    if !is_keyring_key(key) {
        return;
    }
    
    let entry = match Entry::new(KEYRING_SERVICE, &format!("{}-{}", app.config().identifier, key)) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Failed to create keyring entry for {}: {}", key, e);
            return;
        }
    };
    
    if let Err(e) = entry.delete_credential() {
        // Ignore "no entry" errors
        if !matches!(e, keyring::Error::NoEntry) {
            eprintln!("Failed to delete keyring credential for {}: {}", key, e);
        }
    }
}

pub fn get(app: &AppHandle, key: &str) -> Option<Value> {
    // Try keyring first for sensitive keys
    if is_keyring_key(key) {
        if let Some(val) = get_from_keyring(app, key) {
            return Some(serde_json::json!(val));
        }
    }
    
    // Fall back to store for non-sensitive keys
    app.store(STORE_FILE).ok().and_then(|s| s.get(key)).filter(|v| !v.is_null())
}

pub fn get_string(app: &AppHandle, key: &str) -> Option<String> {
    get(app, key).and_then(|v| v.as_str().map(String::from))
}

pub fn set(app: &AppHandle, key: &str, value: Value) {
    // Store sensitive keys in keyring
    if is_keyring_key(key) {
        if let Some(s) = value.as_str() {
            set_in_keyring(app, key, s);
            return;
        }
    }
    
    // Store non-sensitive keys in regular store
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(key, value);
        let _ = store.save();
    }
}

pub fn delete(app: &AppHandle, key: &str) {
    // Delete from keyring if sensitive
    if is_keyring_key(key) {
        delete_from_keyring(app, key);
    }
    
    // Also delete from store
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

/// Sanitize debug output - redact sensitive fields
pub fn sanitize_for_debug(value: &Value) -> Value {
    let mut sanitized = value.clone();
    if let Some(obj) = sanitized.as_object_mut() {
        for key in KEYRING_KEYS {
            if obj.contains_key(key) {
                obj.insert(key.to_string(), serde_json::json!("[REDACTED]"));
            }
        }
        // Also redact common sensitive field names
        for key in ["access_token", "accessToken", "token", "cookie", "password", "secret", "authorization"] {
            if obj.contains_key(key) {
                obj.insert(key.to_string(), serde_json::json!("[REDACTED]"));
            }
        }
    }
    sanitized
}

#[macro_export]
macro_rules! debug_log {
    ($($arg:tt)*) => {
        if $crate::settings::debug_enabled() {
            let msg = format!($($arg)*);
            // Try to parse as JSON and sanitize if it looks like structured data
            if msg.starts_with('{') || msg.starts_with('[') {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&msg) {
                    let sanitized = $crate::settings::sanitize_for_debug(&val);
                    println!("[Debug] {}", serde_json::to_string(&sanitized).unwrap_or_else(|_| "[REDACTED]".to_string()));
                } else {
                    println!("[Debug] {}", msg);
                }
            } else {
                println!("[Debug] {}", msg);
            }
        }
    };
}