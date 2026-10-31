//! Fetches JSON from a URL using a persistent background WebviewWindow.
//!
//! Why this exists (ported from the Electron implementation):
//! Claude.ai uses Cloudflare protection and blocks plain HTTP clients
//! (wrong TLS fingerprint / headers). By loading the URL in a hidden
//! webview we ride on the shared browser cookie store and a genuine
//! browser network stack, bypassing the bot detection.
//!
//! To prevent process churn, CPU spikes, and memory bloat from creating and
//! destroying OS webview windows for every request, a single persistent
//! background WebviewWindow is kept alive on a cheap claude.ai-origin page
//! (https://claude.ai/robots.txt). API requests are dispatched via
//! same-origin `fetch()` in JavaScript inside that persistent context.
//! Results are reported back to Rust through `report_fetch_result`
//! (allowed for claude.ai remote origins via the `remote-fetch` capability).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::{oneshot, Mutex};

use crate::debug_log;
use crate::state::AppState;

const BLOCKED_SIGNATURES: &[(&str, &str)] = &[
    ("Just a moment", "CloudflareBlocked"),
    ("Enable JavaScript and cookies to continue", "CloudflareChallenge"),
    ("<html", "UnexpectedHTML"),
];

/// A claude.ai-origin page that is cheap to load; used as a home base for the
/// persistent worker webview context so it sits directly on the claude.ai origin.
pub const CLAUDE_COOKIE_PAGE: &str = "https://claude.ai/robots.txt";

/// Window label for the persistent background fetch worker webview.
/// Matches `api-fetch-*` in capabilities/remote-fetch.json.
pub const WORKER_WINDOW_LABEL: &str = "api-fetch-worker";

/// Special label used by the worker initialization script to signal readiness.
pub const WORKER_READY_LABEL: &str = "__worker_ready__";

static WORKER_INIT_LOCK: Mutex<()> = Mutex::const_new(());
static WORKER_IS_READY: AtomicBool = AtomicBool::new(false);

/// Returns true if the background fetch worker has loaded and reported ready.
pub fn is_worker_ready() -> bool {
    WORKER_IS_READY.load(Ordering::SeqCst)
}

/// Sets the readiness flag for the background fetch worker.
pub fn set_worker_ready(ready: bool) {
    WORKER_IS_READY.store(ready, Ordering::SeqCst);
}

/// Destroys the persistent background fetch worker if it exists and marks it not ready.
pub fn destroy_worker_window(app: &AppHandle) {
    set_worker_ready(false);
    if let Some(win) = app.get_webview_window(WORKER_WINDOW_LABEL) {
        let _ = win.destroy();
    }
}

/// Generates the initialization script injected into the worker webview window.
/// Polls for `window.__TAURI_INTERNALS__.invoke` and notifies Rust of readiness.
pub fn build_worker_init_script() -> String {
    r#"(function() {
  var attempts = 0;
  function notifyReady() {
    attempts++;
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      try {
        window.__TAURI_INTERNALS__.invoke('report_fetch_result', {
          label: '__worker_ready__',
          body: 'ready'
        });
        return;
      } catch (e) {}
    }
    if (attempts < 50) {
      setTimeout(notifyReady, 50);
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    notifyReady();
  } else {
    window.addEventListener('DOMContentLoaded', notifyReady);
  }
})();"#.to_string()
}

/// Generates the JavaScript evaluated in the worker webview to execute an API fetch.
pub fn build_fetch_script(
    url: &str,
    label: &str,
    set_cookie: Option<&str>,
    timeout_ms: u64,
) -> String {
    let cookie_stmt = match set_cookie {
        Some(c) => format!(
            "try {{ document.cookie = {}; }} catch (e) {{}}",
            serde_json::to_string(c).unwrap_or_else(|_| "\"\"".into())
        ),
        None => String::new(),
    };

    format!(
        r#"(function() {{
  {cookie_stmt}
  var LABEL = {label};
  var URL = {url};
  var TIMEOUT = {timeout_ms};
  function report(body) {{
    try {{
      window.__TAURI_INTERNALS__.invoke('report_fetch_result', {{ label: LABEL, body: body }});
    }} catch (e) {{}}
  }}
  try {{
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function() {{
      try {{ controller.abort(); }} catch (e) {{}}
    }}, TIMEOUT) : null;
    window.fetch(URL, {{
      method: 'GET',
      credentials: 'include',
      signal: controller ? controller.signal : undefined,
      headers: {{
        'Accept': 'application/json, text/plain, */*'
      }}
    }}).then(function(res) {{
      if (timer) clearTimeout(timer);
      return res.text();
    }}).then(function(text) {{
      report(text);
    }}).catch(function(err) {{
      if (timer) clearTimeout(timer);
      var msg = (err && (err.name === 'AbortError' || err.message === 'The user aborted a request.'))
        ? 'Request timeout'
        : (err && err.message ? err.message : String(err));
      report('FetchError: ' + msg);
    }});
  }} catch (e) {{
    report('FetchError: ' + (e && e.message ? e.message : String(e)));
  }}
}})();"#,
        cookie_stmt = cookie_stmt,
        label = serde_json::to_string(label).unwrap(),
        url = serde_json::to_string(url).unwrap(),
        timeout_ms = timeout_ms,
    )
}

/// Ensures the persistent background fetch worker window is running, loaded,
/// and ready to process requests. Spawns the window lazily if not yet initialized.
pub async fn ensure_worker_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if is_worker_ready() {
        if let Some(win) = app.get_webview_window(WORKER_WINDOW_LABEL) {
            return Ok(win);
        }
        set_worker_ready(false);
    }

    let _guard = WORKER_INIT_LOCK.lock().await;

    // Double-check after acquiring lock in case another task initialized it
    if is_worker_ready() {
        if let Some(win) = app.get_webview_window(WORKER_WINDOW_LABEL) {
            return Ok(win);
        }
        set_worker_ready(false);
    }

    // Clean up any stale window handle
    if let Some(stale) = app.get_webview_window(WORKER_WINDOW_LABEL) {
        let _ = stale.destroy();
    }

    let state = app.state::<AppState>();
    let (ready_tx, ready_rx) = oneshot::channel::<String>();
    state
        .fetch_pending
        .lock()
        .unwrap()
        .insert(WORKER_READY_LABEL.into(), ready_tx);

    let parsed: tauri::Url = CLAUDE_COOKIE_PAGE
        .parse()
        .map_err(|e| format!("InvalidUrl: {e}"))?;

    let init_script = build_worker_init_script();

    let builder = WebviewWindowBuilder::new(app, WORKER_WINDOW_LABEL, WebviewUrl::External(parsed))
        .title("api-fetch-worker")
        .visible(false)
        .inner_size(800.0, 600.0)
        .skip_taskbar(true)
        .initialization_script(&init_script);

    let window = builder.build().map_err(|e| {
        state.fetch_pending.lock().unwrap().remove(WORKER_READY_LABEL);
        format!("WorkerWindowCreateFailed: {e}")
    })?;

    // Wait for the worker to load robots.txt and signal readiness
    match tokio::time::timeout(Duration::from_millis(15000), ready_rx).await {
        Ok(Ok(_)) => {
            set_worker_ready(true);
            debug_log!("Persistent API fetch worker initialized and ready");
            Ok(window)
        }
        Ok(Err(_)) => {
            let _ = window.destroy();
            state.fetch_pending.lock().unwrap().remove(WORKER_READY_LABEL);
            set_worker_ready(false);
            Err("Worker initialization cancelled".into())
        }
        Err(_) => {
            let _ = window.destroy();
            state.fetch_pending.lock().unwrap().remove(WORKER_READY_LABEL);
            set_worker_ready(false);
            Err("Worker initialization timeout".into())
        }
    }
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Fetch `url` inside a persistent hidden webview window and parse the body as JSON.
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

/// Fetches raw response body using the persistent background webview worker context.
/// If the worker is closed or needs a restart, it is revived automatically.
pub async fn fetch_body_via_window(
    app: &AppHandle,
    url: &str,
    set_cookie: Option<&str>,
    timeout_ms: u64,
) -> Result<String, String> {
    let _parsed: tauri::Url = url
        .parse()
        .map_err(|e| format!("InvalidUrl: {e}"))?;

    let state = app.state::<AppState>();
    let id = state.fetch_counter.fetch_add(1, Ordering::SeqCst);
    let label = format!("api-fetch-{id}");

    let (tx, rx) = oneshot::channel::<String>();
    state
        .fetch_pending
        .lock()
        .unwrap()
        .insert(label.clone(), tx);

    let window = match ensure_worker_window(app).await {
        Ok(w) => w,
        Err(e) => {
            state.fetch_pending.lock().unwrap().remove(&label);
            return Err(e);
        }
    };

    let script = build_fetch_script(url, &label, set_cookie, timeout_ms);

    if let Err(e) = window.eval(&script) {
        debug_log!("Worker eval failed, restarting worker: {e}");
        destroy_worker_window(app);
        let fresh_window = ensure_worker_window(app).await.map_err(|e2| {
            state.fetch_pending.lock().unwrap().remove(&label);
            format!("WorkerReinitFailed: {e2} (original eval error: {e})")
        })?;
        if let Err(e3) = fresh_window.eval(&script) {
            state.fetch_pending.lock().unwrap().remove(&label);
            return Err(format!("WorkerEvalFailed: {e3}"));
        }
    }

    let result = tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await;
    state.fetch_pending.lock().unwrap().remove(&label);

    match result {
        Ok(Ok(body)) => {
            if let Some(err_msg) = body.strip_prefix("FetchError: ") {
                Err(err_msg.to_string())
            } else {
                Ok(body)
            }
        }
        Ok(Err(_)) => Err("Request cancelled".into()),
        Err(_) => Err("Request timeout".into()),
    }
}

/// Resolves a pending hidden-window fetch or worker readiness event.
/// Invoked by scripts running inside `api-fetch-*` windows
/// (see capabilities/remote-fetch.json).
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

    #[test]
    fn worker_ready_state_toggles() {
        set_worker_ready(false);
        assert!(!is_worker_ready());
        set_worker_ready(true);
        assert!(is_worker_ready());
        set_worker_ready(false);
        assert!(!is_worker_ready());
    }

    #[test]
    fn builds_worker_init_script_with_invoke_call() {
        let script = build_worker_init_script();
        assert!(script.contains("__worker_ready__"));
        assert!(script.contains("report_fetch_result"));
        assert!(script.contains("window.__TAURI_INTERNALS__"));
    }

    #[test]
    fn builds_fetch_script_without_cookie() {
        let script = build_fetch_script("https://claude.ai/api/test", "api-fetch-42", None, 30000);
        assert!(script.contains("var LABEL = \"api-fetch-42\";"));
        assert!(script.contains("var URL = \"https://claude.ai/api/test\";"));
        assert!(script.contains("var TIMEOUT = 30000;"));
        assert!(!script.contains("document.cookie ="));
        assert!(script.contains("window.fetch"));
        assert!(script.contains("AbortController"));
    }

    #[test]
    fn builds_fetch_script_with_cookie() {
        let script = build_fetch_script(
            "https://claude.ai/api/test",
            "api-fetch-43",
            Some("sessionKey=sk-ant-test; domain=.claude.ai"),
            15000,
        );
        assert!(script.contains("var LABEL = \"api-fetch-43\";"));
        assert!(script.contains("document.cookie = \"sessionKey=sk-ant-test; domain=.claude.ai\""));
        assert!(script.contains("var TIMEOUT = 15000;"));
    }
}
