//! Fetches JSON from a URL using a hidden WebviewWindow.
//!
//! Why this exists (ported from the Electron implementation):
//! Claude.ai uses Cloudflare protection and blocks plain HTTP clients
//! (wrong TLS fingerprint / headers). By loading the URL in a hidden
//! webview we ride on the shared browser cookie store and a genuine
//! browser network stack, bypassing the bot detection.
//!
//! The page body is read by an initialization script injected into the
//! hidden window, which reports it back through the `report_fetch_result`
//! command (allowed for claude.ai remote origins via the `remote-fetch`
//! capability).

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

use crate::state::AppState;

const BLOCKED_SIGNATURES: &[(&str, &str)] = &[
    ("Just a moment", "CloudflareBlocked"),
    ("Enable JavaScript and cookies to continue", "CloudflareChallenge"),
    ("<html", "UnexpectedHTML"),
];

/// A claude.ai-origin page that is cheap to load; used as a first hop when a
/// cookie has to be planted (document.cookie only works on the target origin).
pub const CLAUDE_COOKIE_PAGE: &str = "https://claude.ai/robots.txt";

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Fetch `url` inside a hidden webview window and parse the body as JSON.
///
/// If `set_cookie` is provided, the window first loads a claude.ai-origin
/// page, sets `document.cookie`, then navigates to `url` — the init script
/// re-runs on the second navigation and reports the body.
pub async fn fetch_via_window(
    app: &AppHandle,
    url: &str,
    set_cookie: Option<&str>,
    timeout_ms: u64,
) -> Result<Value, String> {
    let body = fetch_body_via_window(app, url, set_cookie, timeout_ms).await?;
    parse_fetch_body(&body)
}

/// Detect known block/failure signatures before attempting JSON parse.
fn parse_fetch_body(body: &str) -> Result<Value, String> {
    for (pattern, error) in BLOCKED_SIGNATURES {
        if body.contains(pattern) {
            return Err(format!("{error}: {}", truncate(body, 200)));
        }
    }

    serde_json::from_str::<Value>(body).map_err(|_| format!("InvalidJSON: {}", truncate(body, 200)))
}

/// Same as `fetch_via_window` but returns the raw body text without
/// signature checks or JSON parsing.
pub async fn fetch_body_via_window(
    app: &AppHandle,
    url: &str,
    set_cookie: Option<&str>,
    timeout_ms: u64,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let id = state.fetch_counter.fetch_add(1, Ordering::SeqCst);
    let label = format!("api-fetch-{id}");

    let (tx, rx) = oneshot::channel::<String>();
    state
        .fetch_pending
        .lock()
        .unwrap()
        .insert(label.clone(), tx);

    let needs_cookie_hop = set_cookie.is_some() && url != CLAUDE_COOKIE_PAGE;
    let initial_url = if needs_cookie_hop { CLAUDE_COOKIE_PAGE } else { url };

    let cookie_js = match set_cookie {
        Some(c) => format!(
            "try {{ document.cookie = {}; }} catch (e) {{}}",
            serde_json::to_string(c).unwrap()
        ),
        None => String::new(),
    };

    let script = format!(
        r#"(function() {{
  {cookie_js}
  var TARGET = {target};
  var LABEL = {label};
  var HOP = {hop};
  if (HOP && window.location.href.indexOf('robots.txt') !== -1) {{
    window.location.replace(TARGET);
    return;
  }}
  function report() {{
    var body = '';
    try {{ body = document.body ? (document.body.innerText || document.body.textContent || '') : ''; }} catch (e) {{}}
    try {{ window.__TAURI_INTERNALS__.invoke('report_fetch_result', {{ label: LABEL, body: body }}); }} catch (e) {{}}
  }}
  if (document.readyState === 'complete' || document.readyState === 'interactive') {{ setTimeout(report, 50); }}
  else {{ window.addEventListener('DOMContentLoaded', function() {{ setTimeout(report, 50); }}); }}
}})();"#,
        cookie_js = cookie_js,
        target = serde_json::to_string(url).unwrap(),
        label = serde_json::to_string(&label).unwrap(),
        hop = if needs_cookie_hop { "true" } else { "false" },
    );

    let parsed: tauri::Url = initial_url
        .parse()
        .map_err(|e| format!("InvalidUrl: {e}"))?;

    // Build hidden webview window with security hardening
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title("api-fetch")
        .visible(false)
        .inner_size(800.0, 600.0)
        .skip_taskbar(true)
        .initialization_script(&script);

    // Security hardening for hidden windows
    #[cfg(target_os = "macos")]
    {
        // On macOS, we can use sandbox if needed
        // builder = builder.disable_sandbox(); // Disabled by default in Tauri v2
    }
    #[cfg(windows)]
    {
        // On Windows, ensure webview2 security settings
    }

    let window = builder
        .build()
        .map_err(|e| {
            app.state::<AppState>()
                .fetch_pending
                .lock()
                .unwrap()
                .remove(&label);
            format!("WindowCreateFailed: {e}")
        })?;

    let result = tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await;

    let _ = window.destroy();
    state.fetch_pending.lock().unwrap().remove(&label);

    match result {
        Ok(Ok(body)) => Ok(body),
        Ok(Err(_)) => Err("Request cancelled".into()),
        Err(_) => Err("Request timeout".into()),
    }
}

/// Resolves a pending hidden-window fetch. Invoked by the init script running
/// inside `api-fetch-*` windows (see capabilities/remote-fetch.json).
#[tauri::command]
pub fn report_fetch_result(state: tauri::State<'_, AppState>, label: String, body: String) {
    if let Some(tx) = state.fetch_pending.lock().unwrap().remove(&label) {
        let _ = tx.send(body);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_valid_json_bodies() {
        assert_eq!(parse_fetch_body("{\"a\": 1}").unwrap(), json!({ "a": 1 }));
        assert_eq!(parse_fetch_body("[1, 2]").unwrap(), json!([1, 2]));
        // API error payloads are still valid JSON and pass through
        assert_eq!(
            parse_fetch_body("{\"error\": \"Unauthorized\"}").unwrap(),
            json!({ "error": "Unauthorized" })
        );
    }

    #[test]
    fn detects_cloudflare_block_signatures() {
        let err = parse_fetch_body("Just a moment...").unwrap_err();
        assert!(err.starts_with("CloudflareBlocked:"));

        let err = parse_fetch_body("Enable JavaScript and cookies to continue").unwrap_err();
        assert!(err.starts_with("CloudflareChallenge:"));

        let err = parse_fetch_body("<html><body>nope</body></html>").unwrap_err();
        assert!(err.starts_with("UnexpectedHTML:"));
    }

    #[test]
    fn reports_invalid_json_with_a_truncated_preview() {
        let long_body = "x".repeat(500);
        let err = parse_fetch_body(&long_body).unwrap_err();
        assert!(err.starts_with("InvalidJSON: "));
        assert_eq!(err.len(), "InvalidJSON: ".len() + 200);
    }

    #[test]
    fn truncate_respects_char_boundaries() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello", 2), "he");
        // Multibyte characters are counted as chars, not bytes
        assert_eq!(truncate("héllo", 2), "hé");
    }
}