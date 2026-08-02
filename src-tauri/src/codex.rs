//! Codex (ChatGPT) usage commands, ported from the Electron main process.
//!
//! Unlike Claude.ai, the wham/usage endpoint accepts direct HTTP requests
//! with a bearer token or session cookie, so this uses reqwest instead of
//! the hidden-window fetcher.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::debug_log;
use crate::settings;

const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_LOGIN_URL: &str = "https://chatgpt.com/login";
const CODEX_LOGIN_WINDOW_LABEL: &str = "login-codex";
const CODEX_TOKEN_COOKIES: [&str; 4] = [
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
    "__Secure-authjs.session-token",
    "authjs.session-token",
];
const CODEX_COOKIE_SCAN_URLS: [&str; 3] = [
    "https://chatgpt.com",
    "https://auth.openai.com",
    "https://openai.com",
];

#[cfg(target_os = "macos")]
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
#[cfg(not(target_os = "macos"))]
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCredentials {
    pub access_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectCodexResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cookie_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
enum CodexAuth {
    Bearer,
    Cookie(String),
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client")
    })
}

fn normalize_bearer_token(token: &str) -> String {
    let trimmed = token.trim();
    let lower = trimmed.to_lowercase();
    if lower.starts_with("bearer ") {
        trimmed[6..].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_auth_attempts(preferred_cookie_name: Option<&str>) -> Vec<CodexAuth> {
    let mut attempts = Vec::new();
    if let Some(name) = preferred_cookie_name {
        attempts.push(CodexAuth::Cookie(name.to_string()));
    }
    attempts.push(CodexAuth::Bearer);
    for name in CODEX_TOKEN_COOKIES {
        if Some(name) != preferred_cookie_name {
            attempts.push(CodexAuth::Cookie(name.to_string()));
        }
    }
    attempts
}

/// Try each auth mechanism until one is not rejected with 401/403.
/// Returns the raw JSON body and the auth mechanism that worked.
async fn fetch_codex_usage_response(
    access_token: &str,
    preferred_cookie_name: Option<&str>,
) -> Result<(Value, CodexAuth), String> {
    let token = normalize_bearer_token(access_token);

    for attempt in build_auth_attempts(preferred_cookie_name) {
        let mut req = http_client()
            .get(CODEX_USAGE_URL)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json");

        req = match &attempt {
            CodexAuth::Bearer => req.header("Authorization", format!("Bearer {token}")),
            CodexAuth::Cookie(name) => req.header("Cookie", format!("{name}={token}")),
        };

        let response = req
            .send()
            .await
            .map_err(|e| format!("CodexUsageFetchFailed: {e}"))?;
        let status = response.status().as_u16();
        match &attempt {
            CodexAuth::Bearer => debug_log!("Codex usage fetch attempt bearer => {status}"),
            CodexAuth::Cookie(name) => {
                debug_log!("Codex usage fetch attempt cookie:{name} => {status}")
            }
        }

        if status == 401 || status == 403 {
            continue;
        }

        if !(200..300).contains(&status) {
            return Err(format!("CodexUsageFetchFailed:{status}"));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("CodexUsageFetchFailed: invalid JSON ({e})"))?;
        return Ok((body, attempt));
    }

    Err("CodexSessionExpired".into())
}

fn clamp_percent(v: Option<&Value>) -> Option<f64> {
    let numeric = match v? {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.parse::<f64>().ok()?,
        _ => return None,
    };
    if !numeric.is_finite() {
        return None;
    }
    Some(numeric.clamp(0.0, 100.0))
}

fn ms_to_iso(ms: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn normalize_resets_at(reset_at: Option<&Value>, reset_after_seconds: Option<&Value>) -> Value {
    if let Some(Value::String(s)) = reset_at {
        if !s.is_empty() {
            return json!(s);
        }
    }
    if let Some(Value::Number(n)) = reset_at {
        if let Some(v) = n.as_f64().filter(|f| f.is_finite()) {
            // API usually returns Unix seconds.
            let ms = if v > 1e12 { v } else { v * 1000.0 };
            if let Some(iso) = ms_to_iso(ms as i64) {
                return json!(iso);
            }
        }
    }
    if let Some(Value::Number(n)) = reset_after_seconds {
        if let Some(secs) = n.as_f64().filter(|f| f.is_finite()) {
            if let Some(iso) = ms_to_iso(settings::now_ms() + (secs * 1000.0) as i64) {
                return json!(iso);
            }
        }
    }
    Value::Null
}

fn extract_used_window(window: Option<&Value>) -> Option<Value> {
    let record = window?.as_object()?;
    let used_percent = clamp_percent(record.get("used_percent").or_else(|| record.get("user_percent")))?;
    Some(json!({
        "utilization": used_percent,
        "resets_at": normalize_resets_at(record.get("reset_at"), record.get("reset_after_seconds")),
    }))
}

/// Legacy fallback where utilization appears to represent remaining capacity.
fn to_used_percent(v: Option<&Value>) -> Option<f64> {
    let numeric = match v? {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.parse::<f64>().ok()?,
        _ => return None,
    };
    if !numeric.is_finite() {
        return None;
    }
    let pct = if numeric <= 1.0 { numeric * 100.0 } else { numeric };
    Some((100.0 - pct).clamp(0.0, 100.0))
}

/// Breadth-first search (depth <= 3) for the object holding the usage windows.
fn find_window_root(input: &Value) -> Option<&Value> {
    let mut queue: Vec<(&Value, u32)> = vec![(input, 0)];
    let mut i = 0;
    while i < queue.len() {
        let (value, depth) = queue[i];
        i += 1;
        if depth > 3 {
            continue;
        }
        if let Some(record) = value.as_object() {
            if record.contains_key("primary_window")
                || record.contains_key("secondary_window")
                || record.contains_key("usage_windows")
            {
                return Some(value);
            }
            for child in record.values() {
                if child.is_object() || child.is_array() {
                    queue.push((child, depth + 1));
                }
            }
        } else if let Some(arr) = value.as_array() {
            for child in arr {
                if child.is_object() || child.is_array() {
                    queue.push((child, depth + 1));
                }
            }
        }
    }
    None
}

/// Parse a raw wham/usage response into the CodexUsageData shape
/// ({ five_hour?, seven_day? }).
pub fn parse_codex_usage_response(raw: &Value) -> Value {
    let mut result = json!({});
    let root_value = find_window_root(raw).unwrap_or(raw);
    let root = match root_value.as_object() {
        Some(o) => o,
        None => return result,
    };

    let primary = extract_used_window(root.get("primary_window"));
    let secondary = extract_used_window(root.get("secondary_window"));
    if primary.is_some() || secondary.is_some() {
        if let Some(p) = primary {
            result["five_hour"] = p;
        }
        if let Some(s) = secondary {
            result["seven_day"] = s;
        }
        return result;
    }

    if let Some(windows) = root.get("usage_windows").and_then(|v| v.as_array()) {
        for w in windows.iter().filter_map(|w| w.as_object()) {
            let utilization = clamp_percent(w.get("used_percent").or_else(|| w.get("user_percent")))
                .or_else(|| to_used_percent(w.get("utilization")));
            let resets_at = normalize_resets_at(
                w.get("resets_at").or_else(|| w.get("reset_at")),
                w.get("reset_after_seconds"),
            );
            let entry = json!({ "utilization": utilization, "resets_at": resets_at });
            match w.get("window_type").and_then(|v| v.as_str()) {
                Some("primary") | Some("5h") => result["five_hour"] = entry,
                Some("secondary") | Some("weekly") | Some("7d") => result["seven_day"] = entry,
                _ => {}
            }
        }
    } else {
        // Flat fallback — try common field names.
        let session_util = root
            .get("session_utilization")
            .or_else(|| root.get("five_hour_utilization"));
        let weekly_util = root
            .get("weekly_utilization")
            .or_else(|| root.get("seven_day_utilization"));
        if let Some(session) = to_used_percent(session_util) {
            result["five_hour"] = json!({
                "utilization": session,
                "resets_at": root.get("session_resets_at").cloned().unwrap_or(Value::Null),
            });
        }
        if let Some(weekly) = to_used_percent(weekly_util) {
            result["seven_day"] = json!({
                "utilization": weekly,
                "resets_at": root.get("weekly_resets_at").cloned().unwrap_or(Value::Null),
            });
        }
    }

    result
}

fn extract_access_token_from_auth_json(parsed: &Value) -> Option<String> {
    let direct = parsed
        .get("access_token")
        .or_else(|| parsed.get("accessToken"))
        .and_then(|v| v.as_str());
    if let Some(t) = direct {
        if !t.trim().is_empty() {
            return Some(t.to_string());
        }
    }
    let nested = parsed
        .get("tokens")
        .and_then(|t| t.get("access_token").or_else(|| t.get("accessToken")))
        .and_then(|v| v.as_str());
    nested
        .filter(|t| !t.trim().is_empty())
        .map(String::from)
}

fn is_codex_cookie_domain(domain: Option<&str>) -> bool {
    let Some(domain) = domain else { return false };
    let normalized = domain.trim_start_matches('.').to_lowercase();
    normalized == "chatgpt.com"
        || normalized.ends_with(".chatgpt.com")
        || normalized == "openai.com"
        || normalized.ends_with(".openai.com")
}

#[tauri::command]
pub fn get_codex_credentials(app: AppHandle) -> CodexCredentials {
    CodexCredentials {
        access_token: settings::get_string(&app, "codexAccessToken"),
    }
}

#[tauri::command]
pub fn save_codex_credentials(
    app: AppHandle,
    access_token: String,
    cookie_name: Option<String>,
) -> Result<bool, String> {
    let token = access_token.trim().to_string();
    if token.is_empty() {
        return Err("Missing Codex credentials".into());
    }
    settings::set(&app, "codexAccessToken", json!(token));
    match cookie_name {
        Some(name) => settings::set(&app, "codexCookieName", json!(name)),
        None => settings::delete(&app, "codexCookieName"),
    }
    Ok(true)
}

#[tauri::command]
pub fn delete_codex_credentials(app: AppHandle) -> bool {
    settings::delete(&app, "codexAccessToken");
    settings::delete(&app, "codexCookieName");
    settings::delete(&app, "cachedCodexUsageData");
    settings::delete(&app, "cachedCodexUsageTimestamp");
    true
}

// Auto-detect Codex token: try ~/.codex/auth.json first, then open a
// chatgpt.com login window and capture the web session cookie.
#[tauri::command]
pub async fn detect_codex_token(app: AppHandle) -> DetectCodexResult {
    // 1. Try reading from ~/.codex/auth.json
    if let Some(home) = dirs::home_dir() {
        let auth_path = home.join(".codex").join("auth.json");
        match std::fs::read_to_string(&auth_path) {
            Ok(raw) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
                    if let Some(token) = extract_access_token_from_auth_json(&parsed) {
                        if token.len() > 10 {
                            match fetch_codex_usage_response(&token, None).await {
                                Ok(_) => {
                                    debug_log!("Codex bearer token from ~/.codex/auth.json is valid");
                                    return DetectCodexResult {
                                        success: true,
                                        access_token: Some(token),
                                        cookie_name: None,
                                        error: None,
                                    };
                                }
                                Err(e) => debug_log!(
                                    "Codex token in ~/.codex/auth.json is invalid/expired, falling back to login window: {e}"
                                ),
                            }
                        }
                    }
                }
            }
            Err(e) => debug_log!("Could not read ~/.codex/auth.json: {e}"),
        }
    }

    // 2. Fallback: open chatgpt.com and capture the web session cookie.
    if let Some(existing) = app.get_webview_window(CODEX_LOGIN_WINDOW_LABEL) {
        let _ = existing.destroy();
    }

    let url: tauri::Url = CODEX_LOGIN_URL.parse().unwrap();
    let win = match WebviewWindowBuilder::new(&app, CODEX_LOGIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Log in to ChatGPT (Codex)")
        .inner_size(1000.0, 700.0)
        .build()
    {
        Ok(w) => w,
        Err(e) => {
            return DetectCodexResult {
                success: false,
                access_token: None,
                cookie_name: None,
                error: Some(format!("Failed to open login window: {e}")),
            }
        }
    };

    // Add 10-minute timeout for login
    let login_timeout = Duration::from_secs(600);
    let start_time = std::time::Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(1000)).await;

        // Check timeout
        if start_time.elapsed() >= login_timeout {
            let _ = win.destroy();
            return DetectCodexResult {
                success: false,
                access_token: None,
                cookie_name: None,
                error: Some("Login timeout (10 minutes)".into()),
            };
        }

        if app.get_webview_window(CODEX_LOGIN_WINDOW_LABEL).is_none() {
            return DetectCodexResult {
                success: false,
                access_token: None,
                cookie_name: None,
                error: Some("Login window closed".into()),
            };
        }

        for scan_url in CODEX_COOKIE_SCAN_URLS {
            let parsed: tauri::Url = scan_url.parse().unwrap();
            let Ok(cookies) = win.cookies_for_url(parsed) else {
                continue;
            };
            let found = cookies.iter().find(|c| {
                !c.value().is_empty()
                    && CODEX_TOKEN_COOKIES.contains(&c.name())
                    && is_codex_cookie_domain(c.domain())
            });
            if let Some(cookie) = found {
                let name = cookie.name().to_string();
                let value = cookie.value().to_string();
                debug_log!("Captured Codex session cookie: {name} {:?}", cookie.domain());
                settings::set(&app, "codexCookieName", json!(name));
                let _ = win.destroy();
                return DetectCodexResult {
                    success: true,
                    access_token: Some(value),
                    cookie_name: Some(name),
                    error: None,
                };
            }
        }
    }
}

#[tauri::command]
pub async fn fetch_codex_usage(app: AppHandle) -> Result<Value, String> {
    let access_token = settings::get_string(&app, "codexAccessToken")
        .ok_or_else(|| "Missing Codex credentials".to_string())?;
    let preferred_cookie_name = settings::get_string(&app, "codexCookieName");

    match fetch_codex_usage_response(&access_token, preferred_cookie_name.as_deref()).await {
        Ok((raw, auth)) => {
            if let CodexAuth::Cookie(name) = &auth {
                settings::set(&app, "codexCookieName", json!(name));
            }

            if settings::debug_enabled() {
                println!(
                    "[Debug] Raw Codex usage API response: {}",
                    serde_json::to_string_pretty(&raw).unwrap_or_default()
                );
                let _ = app.emit(
                    "debug-log",
                    json!({ "label": "Raw Codex usage API response:", "data": raw }),
                );
            }

            let data = parse_codex_usage_response(&raw);
            settings::set(&app, "cachedCodexUsageData", data.clone());
            settings::set(&app, "cachedCodexUsageTimestamp", json!(settings::now_ms()));
            Ok(data)
        }
        Err(e) => {
            if e == "CodexSessionExpired" {
                settings::delete(&app, "codexAccessToken");
                settings::delete(&app, "codexCookieName");
                let _ = app.emit("codex-session-expired", ());
            } else {
                eprintln!("Codex usage fetch failed: {e}");
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub fn get_cached_codex_usage(app: AppHandle) -> Option<Value> {
    let data = settings::get(&app, "cachedCodexUsageData")?;
    let timestamp = settings::get(&app, "cachedCodexUsageTimestamp")?;
    Some(json!({ "data": data, "timestamp": timestamp }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_bearer_prefixes() {
        assert_eq!(normalize_bearer_token("abc"), "abc");
        assert_eq!(normalize_bearer_token("  Bearer abc  "), "abc");
        assert_eq!(normalize_bearer_token("bearer abc"), "abc");
        assert_eq!(normalize_bearer_token("BEARER  abc"), "abc");
    }

    #[test]
    fn auth_attempts_prefer_the_known_cookie() {
        let attempts = build_auth_attempts(Some("next-auth.session-token"));
        assert!(matches!(&attempts[0], CodexAuth::Cookie(name) if name == "next-auth.session-token"));
        assert!(matches!(attempts[1], CodexAuth::Bearer));
        // preferred cookie is not repeated later
        let cookie_count = attempts
            .iter()
            .filter(|a| matches!(a, CodexAuth::Cookie(n) if n == "next-auth.session-token"))
            .count();
        assert_eq!(cookie_count, 1);
        assert_eq!(attempts.len(), 1 + CODEX_TOKEN_COOKIES.len());

        let attempts = build_auth_attempts(None);
        assert!(matches!(attempts[0], CodexAuth::Bearer));
        assert_eq!(attempts.len(), 1 + CODEX_TOKEN_COOKIES.len());
    }

    #[test]
    fn recognizes_codex_cookie_domains() {
        assert!(is_codex_cookie_domain(Some(".chatgpt.com")));
        assert!(is_codex_cookie_domain(Some("chatgpt.com")));
        assert!(is_codex_cookie_domain(Some("auth.openai.com")));
        assert!(!is_codex_cookie_domain(Some("evil-chatgpt.com.attacker.io")));
        assert!(!is_codex_cookie_domain(Some("example.com")));
        assert!(!is_codex_cookie_domain(None));
    }

    #[test]
    fn extracts_access_token_from_auth_json_shapes() {
        let direct = json!({ "access_token": "tok-1" });
        assert_eq!(extract_access_token_from_auth_json(&direct).as_deref(), Some("tok-1"));
        let camel = json!({ "accessToken": "tok-2" });
        assert_eq!(extract_access_token_from_auth_json(&camel).as_deref(), Some("tok-2"));
        let nested = json!({ "tokens": { "access_token": "tok-3" } });
        assert_eq!(extract_access_token_from_auth_json(&nested).as_deref(), Some("tok-3"));
        let empty = json!({ "access_token": "   " });
        assert_eq!(extract_access_token_from_auth_json(&empty), None);
        assert_eq!(extract_access_token_from_auth_json(&json!({})), None);
    }

    #[test]
    fn parses_primary_and_secondary_windows() {
        let raw = json!({
            "primary_window": { "used_percent": 42.5, "reset_at": 1_700_000_000 },
            "secondary_window": { "used_percent": 150, "reset_after_seconds": 3600 }
        });
        let parsed = parse_codex_usage_response(&raw);
        assert_eq!(parsed["five_hour"]["utilization"], json!(42.5));
        assert!(parsed["five_hour"]["resets_at"]
            .as_str()
            .unwrap()
            .starts_with("2023-11-14T"));
        // over-100 values are clamped
        assert_eq!(parsed["seven_day"]["utilization"], json!(100.0));
        assert!(parsed["seven_day"]["resets_at"].is_string());
    }

    #[test]
    fn parses_windows_nested_deeper_in_the_response() {
        let raw = json!({ "data": { "usage": { "primary_window": { "used_percent": 10 } } } });
        let parsed = parse_codex_usage_response(&raw);
        assert_eq!(parsed["five_hour"]["utilization"], json!(10.0));
    }

    #[test]
    fn parses_usage_windows_array_shape() {
        let raw = json!({
            "usage_windows": [
                { "window_type": "primary", "used_percent": 12, "resets_at": "2026-01-01T00:00:00Z" },
                { "window_type": "weekly", "utilization": 0.25, "reset_after_seconds": 60 }
            ]
        });
        let parsed = parse_codex_usage_response(&raw);
        assert_eq!(parsed["five_hour"]["utilization"], json!(12.0));
        assert_eq!(parsed["five_hour"]["resets_at"], json!("2026-01-01T00:00:00Z"));
        // legacy utilization 0.25 → 25% remaining → 75% used
        assert_eq!(parsed["seven_day"]["utilization"], json!(75.0));
    }

    #[test]
    fn parses_flat_fallback_fields() {
        let raw = json!({
            "session_utilization": 0.9,
            "weekly_utilization": 40,
            "session_resets_at": "2026-02-02T00:00:00Z"
        });
        let parsed = parse_codex_usage_response(&raw);
        // 0.9 → 90% remaining → 10% used; 40 → 60% used
        assert_eq!(parsed["five_hour"]["utilization"], json!(10.0));
        assert_eq!(parsed["five_hour"]["resets_at"], json!("2026-02-02T00:00:00Z"));
        assert_eq!(parsed["seven_day"]["utilization"], json!(60.0));
    }

    #[test]
    fn returns_empty_object_for_unrecognized_shapes() {
        assert_eq!(parse_codex_usage_response(&json!({ "hello": "world" })), json!({}));
        assert_eq!(parse_codex_usage_response(&json!(null)), json!({}));
        assert_eq!(parse_codex_usage_response(&json!([1, 2, 3])), json!({}));
    }

    #[test]
    fn clamp_percent_handles_numbers_and_strings() {
        assert_eq!(clamp_percent(Some(&json!(42))), Some(42.0));
        assert_eq!(clamp_percent(Some(&json!("55.5"))), Some(55.5));
        assert_eq!(clamp_percent(Some(&json!(-5))), Some(0.0));
        assert_eq!(clamp_percent(Some(&json!(120))), Some(100.0));
        assert_eq!(clamp_percent(Some(&json!("nope"))), None);
        assert_eq!(clamp_percent(Some(&json!(null))), None);
        assert_eq!(clamp_percent(None), None);
    }

    #[test]
    fn find_window_root_gives_up_below_depth_three() {
        let shallow = json!({ "a": { "b": { "c": { "primary_window": { "used_percent": 5 } } } } });
        assert_eq!(parse_codex_usage_response(&shallow)["five_hour"]["utilization"], json!(5.0));

        let deep = json!({ "a": { "b": { "c": { "d": { "primary_window": { "used_percent": 5 } } } } } });
        assert_eq!(parse_codex_usage_response(&deep), json!({}));
    }

    #[test]
    fn windows_use_the_user_percent_alias_and_skip_invalid_entries() {
        let raw = json!({
            "primary_window": { "user_percent": "17.5" },
            "secondary_window": { "used_percent": "not-a-number" }
        });
        let parsed = parse_codex_usage_response(&raw);
        assert_eq!(parsed["five_hour"]["utilization"], json!(17.5));
        // Invalid secondary window is dropped rather than defaulting to 0
        assert!(parsed.get("seven_day").is_none());
    }

    #[test]
    fn to_used_percent_inverts_remaining_capacity() {
        // Fractions (<= 1.0) are scaled to percent before inverting
        assert_eq!(to_used_percent(Some(&json!(1.0))), Some(0.0));
        assert_eq!(to_used_percent(Some(&json!(0.0))), Some(100.0));
        // Values above 1.0 are treated as percentages
        assert_eq!(to_used_percent(Some(&json!(30))), Some(70.0));
        assert_eq!(to_used_percent(Some(&json!("25"))), Some(75.0));
        // Out-of-range results clamp to 0-100
        assert_eq!(to_used_percent(Some(&json!(150))), Some(0.0));
        assert_eq!(to_used_percent(Some(&json!(-50))), Some(100.0));
        assert_eq!(to_used_percent(Some(&json!("abc"))), None);
        assert_eq!(to_used_percent(None), None);
    }

    #[test]
    fn normalize_resets_at_prefers_strings_then_numbers_then_offsets() {
        assert_eq!(
            normalize_resets_at(Some(&json!("2026-01-01T00:00:00Z")), None),
            json!("2026-01-01T00:00:00Z")
        );
        // Unix seconds
        let from_secs = normalize_resets_at(Some(&json!(1_700_000_000)), None);
        assert!(from_secs.as_str().unwrap().starts_with("2023-11-14T"));
        // Unix millis pass through unscaled
        let from_ms = normalize_resets_at(Some(&json!(1_700_000_000_000_i64)), None);
        assert!(from_ms.as_str().unwrap().starts_with("2023-11-14T"));
        // reset_after_seconds fallback produces a future ISO timestamp
        let relative = normalize_resets_at(None, Some(&json!(60)));
        assert!(relative.is_string());
        assert_eq!(normalize_resets_at(None, None), Value::Null);
        // An empty reset_at string falls through to the relative offset
        let fallback = normalize_resets_at(Some(&json!("")), Some(&json!(60)));
        assert!(fallback.is_string());
        // Non-finite / non-numeric reset values resolve to null
        assert_eq!(normalize_resets_at(Some(&json!(true)), None), Value::Null);
    }
}
