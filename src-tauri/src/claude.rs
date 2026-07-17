//! Claude.ai credential and usage-data commands, ported from the Electron
//! main process (main.ts).

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::debug_log;
use crate::fetch_via_window::{fetch_body_via_window, fetch_via_window, CLAUDE_COOKIE_PAGE};
use crate::settings;

const LOGIN_WINDOW_LABEL: &str = "login-claude";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub session_key: Option<String>,
    pub organization_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrgInfo {
    pub id: String,
    pub name: Option<String>,
    pub raven_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectSessionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Parse the /api/organizations response into the org identifiers the widget
/// cares about. Accounts can belong to several orgs (e.g. an enterprise and a
/// team org) and usage is tracked per org.
fn extract_org_infos(value: &Value) -> Vec<OrgInfo> {
    let Some(orgs) = value.as_array() else {
        return Vec::new();
    };
    orgs.iter()
        .filter_map(|org| {
            let id = org
                .get("uuid")
                .or_else(|| org.get("id"))
                .and_then(|v| v.as_str())?
                .to_string();
            Some(OrgInfo {
                id,
                name: org.get("name").and_then(|v| v.as_str()).map(String::from),
                raven_type: org
                    .get("raven_type")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            })
        })
        .collect()
}

fn store_organizations(app: &AppHandle, orgs: &[OrgInfo]) {
    if !orgs.is_empty() {
        if let Ok(value) = serde_json::to_value(orgs) {
            settings::set(app, "organizations", value);
        }
    }
}

fn session_cookie_string(session_key: &str) -> String {
    // HttpOnly cannot be set from JS; the server does not require it on
    // inbound requests, so a JS-set cookie authenticates fine.
    format!("sessionKey={session_key}; domain=.claude.ai; path=/; secure; max-age=31536000")
}

/// Plant the sessionKey cookie into the shared webview cookie store by
/// loading a cheap claude.ai-origin page and setting document.cookie there.
/// Equivalent to Electron's session.defaultSession.cookies.set().
pub async fn ensure_session_cookie(app: &AppHandle, session_key: &str) {
    let cookie = session_cookie_string(session_key);
    // Body is robots.txt content, not JSON — the resulting InvalidJSON error
    // is expected and ignored; the cookie is set at document start regardless.
    let _ = fetch_body_via_window(app, CLAUDE_COOKIE_PAGE, Some(&cookie), 15000).await;
    debug_log!("sessionKey cookie planted in webview session");
}

/// Best-effort removal of stale claude.ai session state. The webview cookie
/// store has no per-cookie delete API, so browsing data is cleared wholesale.
/// (The renderer keeps no localStorage and Codex auth is header-based from
/// the Rust side, so nothing else depends on webview storage.)
pub fn clear_webview_session(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if let Err(e) = win.clear_all_browsing_data() {
            debug_log!("clear_all_browsing_data failed: {e}");
        }
    }
}

#[tauri::command]
pub fn get_credentials(app: AppHandle) -> Credentials {
    debug_log!("get_credentials called from renderer");
    Credentials {
        session_key: settings::get_string(&app, "sessionKey"),
        organization_id: settings::get_string(&app, "organizationId"),
    }
}

#[tauri::command]
pub async fn save_credentials(
    app: AppHandle,
    session_key: String,
    organization_id: Option<String>,
) -> Result<bool, String> {
    settings::set(&app, "sessionKey", json!(session_key));
    if let Some(org) = organization_id {
        settings::set(&app, "organizationId", json!(org));
    }
    ensure_session_cookie(&app, &session_key).await;
    Ok(true)
}

#[tauri::command]
pub fn delete_credentials(app: AppHandle) -> bool {
    settings::delete(&app, "sessionKey");
    settings::delete(&app, "organizationId");
    settings::delete(&app, "organizations");
    clear_webview_session(&app);
    true
}

/// All organizations the logged-in session can access. Served from the
/// settings cache when present; otherwise fetched live and cached, which also
/// upgrades installs that logged in before multi-org support existed.
#[tauri::command]
pub async fn get_organizations(app: AppHandle) -> Result<Vec<OrgInfo>, String> {
    if let Some(cached) = settings::get(&app, "organizations") {
        if let Ok(orgs) = serde_json::from_value::<Vec<OrgInfo>>(cached) {
            if !orgs.is_empty() {
                return Ok(orgs);
            }
        }
    }

    let data = fetch_via_window(&app, "https://claude.ai/api/organizations", None, 30000).await?;
    let orgs = extract_org_infos(&data);
    store_organizations(&app, &orgs);
    Ok(orgs)
}

/// Usage for a single (secondary) organization. Errors are returned as-is;
/// the renderer treats a failing secondary org as "hide that section" rather
/// than a session problem.
#[tauri::command]
pub async fn fetch_usage_for_org(app: AppHandle, organization_id: String) -> Result<Value, String> {
    let url = format!("https://claude.ai/api/organizations/{organization_id}/usage");
    fetch_via_window(&app, &url, None, 30000).await
}

/// Validate a sessionKey by planting it as a cookie and fetching the
/// organizations list through a hidden webview window.
#[tauri::command]
pub async fn validate_session_key(app: AppHandle, session_key: String) -> ValidationResult {
    debug_log!(
        "Validating session key: {}...",
        session_key.chars().take(20).collect::<String>()
    );
    let cookie = session_cookie_string(&session_key);
    match fetch_via_window(
        &app,
        "https://claude.ai/api/organizations",
        Some(&cookie),
        30000,
    )
    .await
    {
        Ok(value @ Value::Array(_)) => {
            let orgs = extract_org_infos(&value);
            // Remember every org the session can access; the renderer shows
            // usage for all of them (primary first).
            store_organizations(&app, &orgs);
            match orgs.first() {
                Some(first) => {
                    let id = first.id.clone();
                    debug_log!("Session key validated, {} org(s), primary: {id}", orgs.len());
                    ValidationResult {
                        success: true,
                        organization_id: Some(id),
                        error: None,
                    }
                }
                None => ValidationResult {
                    success: false,
                    organization_id: None,
                    error: Some("No organization found".into()),
                },
            }
        }
        Ok(other) => {
            let error = other
                .get("error")
                .map(|e| match e {
                    Value::String(s) => s.clone(),
                    _ => e
                        .get("message")
                        .and_then(|m| m.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| e.to_string()),
                })
                .unwrap_or_else(|| "No organization found".into());
            ValidationResult {
                success: false,
                organization_id: None,
                error: Some(error),
            }
        }
        Err(e) => {
            eprintln!("Session key validation failed: {e}");
            ValidationResult {
                success: false,
                organization_id: None,
                error: Some(e),
            }
        }
    }
}

// Open a visible window for the user to log in to Claude.ai.
//
// Why login is not embedded in the app UI:
// Claude.ai (via Cloudflare) blocks logins from non-browser contexts.
// A standalone webview window lets the user authenticate normally; the
// sessionKey cookie is then captured from the shared cookie store.
#[tauri::command]
pub async fn detect_session_key(app: AppHandle) -> DetectSessionResult {
    // Clear any leftover session so we capture a fresh login rather than a
    // stale (possibly server-invalidated) cookie.
    clear_webview_session(&app);

    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = existing.destroy();
    }

    let url: tauri::Url = "https://claude.ai/login".parse().unwrap();
    let win = match WebviewWindowBuilder::new(&app, LOGIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Log in to Claude")
        .inner_size(1000.0, 700.0)
        .build()
    {
        Ok(w) => w,
        Err(e) => {
            return DetectSessionResult {
                success: false,
                session_key: None,
                error: Some(format!("Failed to open login window: {e}")),
            }
        }
    };

    let check_url: tauri::Url = "https://claude.ai".parse().unwrap();
    loop {
        tokio::time::sleep(Duration::from_millis(1000)).await;

        if app.get_webview_window(LOGIN_WINDOW_LABEL).is_none() {
            return DetectSessionResult {
                success: false,
                session_key: None,
                error: Some("Login window closed".into()),
            };
        }

        if let Ok(cookies) = win.cookies_for_url(check_url.clone()) {
            if let Some(cookie) = cookies
                .iter()
                .find(|c| c.name() == "sessionKey" && !c.value().is_empty())
            {
                let value = cookie.value().to_string();
                let _ = win.destroy();
                return DetectSessionResult {
                    success: true,
                    session_key: Some(value),
                    error: None,
                };
            }
        }
    }
}

fn to_number(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
        Value::String(s) => s.parse::<f64>().ok().filter(|f| f.is_finite()),
        _ => None,
    }
}

/// First non-null value among the given keys (JS `a ?? b ?? c` semantics).
fn first_field<'a>(src: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|k| src.get(*k))
        .find(|v| !v.is_null())
}

fn normalize_extra_usage(source: Option<&Value>) -> Option<Value> {
    let src = source?.as_object()?;
    let limit = to_number(first_field(
        src,
        &[
            "monthly_limit",
            "monthly_credit_limit",
            "spend_limit_amount_cents",
            "limit_cents",
        ],
    ));
    let used = to_number(first_field(
        src,
        &["used_credits", "used_credit", "used_cents", "balance_cents"],
    ));
    let utilization = to_number(src.get("utilization"));
    let enabled = match src.get("is_enabled") {
        Some(v) if !v.is_null() => v.as_bool().unwrap_or(false) || v.as_f64().map(|f| f != 0.0).unwrap_or(false),
        _ => limit.is_some(),
    };

    let (limit, used) = match (limit, used) {
        (Some(l), Some(u)) if enabled && l > 0.0 && u >= 0.0 => (l, u),
        _ => return None,
    };

    Some(json!({
        "utilization": utilization.unwrap_or((used / limit) * 100.0),
        "resets_at": null,
        "used_cents": used,
        "limit_cents": limit,
    }))
}

fn merge_into_extra_usage(data: &mut Value, patch: &Value) {
    let extra = data
        .as_object_mut()
        .expect("usage data is an object")
        .entry("extra_usage")
        .or_insert_with(|| json!({}));
    if !extra.is_object() {
        *extra = json!({});
    }
    if let (Some(target), Some(src)) = (extra.as_object_mut(), patch.as_object()) {
        for (k, v) in src {
            target.insert(k.clone(), v.clone());
        }
    }
}

fn debug_log_to_renderer(app: &AppHandle, label: &str, data: &Value) {
    if !settings::debug_enabled() {
        return;
    }
    println!(
        "[Debug] {label} {}",
        serde_json::to_string_pretty(data).unwrap_or_default()
    );
    let _ = app.emit("debug-log", json!({ "label": label, "data": data }));
}

#[tauri::command]
pub async fn fetch_usage_data(app: AppHandle) -> Result<Value, String> {
    let _session_key =
        settings::get_string(&app, "sessionKey").ok_or_else(|| "Missing credentials".to_string())?;
    let organization_id = settings::get_string(&app, "organizationId")
        .ok_or_else(|| "Missing credentials".to_string())?;

    let usage_url = format!("https://claude.ai/api/organizations/{organization_id}/usage");
    let overage_url =
        format!("https://claude.ai/api/organizations/{organization_id}/overage_spend_limit");
    let prepaid_url =
        format!("https://claude.ai/api/organizations/{organization_id}/prepaid/credits");

    // Fetch all endpoints in parallel. Usage is required; overage and prepaid
    // are optional.
    let (usage_result, overage_result, prepaid_result) = tokio::join!(
        fetch_via_window(&app, &usage_url, None, 30000),
        fetch_via_window(&app, &overage_url, None, 30000),
        fetch_via_window(&app, &prepaid_url, None, 30000),
    );

    let mut data = match usage_result {
        Ok(v) => v,
        Err(e) => {
            debug_log!("API request failed: {e}");
            let is_blocked = e.starts_with("CloudflareBlocked")
                || e.starts_with("CloudflareChallenge")
                || e.starts_with("UnexpectedHTML");
            if is_blocked {
                settings::delete(&app, "sessionKey");
                settings::delete(&app, "organizationId");
                let _ = app.emit("session-expired", ());
                return Err("SessionExpired".into());
            }
            return Err(e);
        }
    };

    if !data.is_object() {
        return Err(format!("InvalidJSON: {}", data));
    }

    debug_log_to_renderer(&app, "Raw usage API response:", &data);

    // Prefer spending values already present in the primary usage response.
    let normalized_from_usage = normalize_extra_usage(data.get("extra_usage"));
    if let Some(patch) = normalized_from_usage {
        merge_into_extra_usage(&mut data, &patch);
    }

    // Merge overage spending data (only if usage lacked spending fields).
    match overage_result {
        Ok(overage) => {
            debug_log_to_renderer(&app, "Raw overage API response:", &overage);
            let has_usage_spending = data
                .get("extra_usage")
                .map(|e| {
                    e.get("used_cents").map(|v| !v.is_null()).unwrap_or(false)
                        && e.get("limit_cents").map(|v| !v.is_null()).unwrap_or(false)
                })
                .unwrap_or(false);
            if !has_usage_spending {
                if let Some(patch) = normalize_extra_usage(Some(&overage)) {
                    merge_into_extra_usage(&mut data, &patch);
                }
            }
        }
        Err(e) => debug_log!("Overage fetch skipped or failed: {e}"),
    }

    // Merge prepaid balance.
    match prepaid_result {
        Ok(prepaid) => {
            debug_log_to_renderer(&app, "Raw prepaid API response:", &prepaid);
            if let Some(amount) = prepaid.get("amount").and_then(|v| v.as_f64()) {
                merge_into_extra_usage(&mut data, &json!({ "balance_cents": amount }));
            }
        }
        Err(e) => debug_log!("Prepaid fetch skipped or failed: {e}"),
    }

    settings::set(&app, "cachedUsageData", data.clone());
    settings::set(&app, "cachedUsageTimestamp", json!(settings::now_ms()));
    Ok(data)
}

#[tauri::command]
pub fn get_cached_usage(app: AppHandle) -> Option<Value> {
    let data = settings::get(&app, "cachedUsageData")?;
    let timestamp = settings::get(&app, "cachedUsageTimestamp")?;
    Some(json!({ "data": data, "timestamp": timestamp }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_org_infos_from_api_response() {
        let response = json!([
            { "uuid": "org-1", "name": "Enterprise Org", "raven_type": "enterprise" },
            { "id": "org-2", "name": "Team Org", "raven_type": "team" },
            { "name": "no-id-entry" }
        ]);
        let orgs = extract_org_infos(&response);
        assert_eq!(orgs.len(), 2);
        assert_eq!(orgs[0].id, "org-1");
        assert_eq!(orgs[0].name.as_deref(), Some("Enterprise Org"));
        assert_eq!(orgs[0].raven_type.as_deref(), Some("enterprise"));
        assert_eq!(orgs[1].id, "org-2");
        assert_eq!(orgs[1].raven_type.as_deref(), Some("team"));

        assert!(extract_org_infos(&json!({ "error": "nope" })).is_empty());
        assert!(extract_org_infos(&json!([])).is_empty());
    }

    #[test]
    fn builds_the_session_cookie_string() {
        let cookie = session_cookie_string("sk-ant-123");
        assert!(cookie.starts_with("sessionKey=sk-ant-123;"));
        assert!(cookie.contains("domain=.claude.ai"));
        assert!(cookie.contains("secure"));
    }

    #[test]
    fn to_number_accepts_numbers_and_numeric_strings() {
        assert_eq!(to_number(Some(&json!(5))), Some(5.0));
        assert_eq!(to_number(Some(&json!("12.5"))), Some(12.5));
        assert_eq!(to_number(Some(&json!("abc"))), None);
        assert_eq!(to_number(Some(&json!(true))), None);
        assert_eq!(to_number(Some(&json!(null))), None);
        assert_eq!(to_number(None), None);
    }

    #[test]
    fn first_field_skips_nulls_like_js_nullish_coalescing() {
        let obj = json!({ "a": null, "b": 2, "c": 3 });
        let map = obj.as_object().unwrap();
        assert_eq!(first_field(map, &["a", "b", "c"]), Some(&json!(2)));
        assert_eq!(first_field(map, &["a"]), None);
        assert_eq!(first_field(map, &["missing"]), None);
    }

    #[test]
    fn normalizes_extra_usage_with_explicit_utilization() {
        let source = json!({
            "is_enabled": true,
            "monthly_limit": 5000,
            "used_credits": 500,
            "utilization": 10
        });
        let result = normalize_extra_usage(Some(&source)).unwrap();
        assert_eq!(result["utilization"], json!(10.0));
        assert_eq!(result["used_cents"], json!(500.0));
        assert_eq!(result["limit_cents"], json!(5000.0));
        assert_eq!(result["resets_at"], Value::Null);
    }

    #[test]
    fn derives_utilization_when_absent_and_infers_enabled_from_limit() {
        let source = json!({ "spend_limit_amount_cents": 2000, "used_cents": 500 });
        let result = normalize_extra_usage(Some(&source)).unwrap();
        assert_eq!(result["utilization"], json!(25.0));
    }

    #[test]
    fn accepts_numeric_is_enabled_and_string_amounts() {
        // Some API variants report is_enabled as 1/0 and amounts as strings
        let source = json!({ "is_enabled": 1, "monthly_limit": "4000", "used_credits": "1000" });
        let result = normalize_extra_usage(Some(&source)).unwrap();
        assert_eq!(result["utilization"], json!(25.0));
        assert_eq!(result["limit_cents"], json!(4000.0));

        assert!(normalize_extra_usage(Some(&json!({
            "is_enabled": 0, "monthly_limit": 100, "used_credits": 5
        })))
        .is_none());
    }

    #[test]
    fn rejects_disabled_zero_limit_or_negative_usage() {
        assert!(normalize_extra_usage(Some(&json!({
            "is_enabled": false, "monthly_limit": 100, "used_credits": 5
        })))
        .is_none());
        assert!(normalize_extra_usage(Some(&json!({
            "monthly_limit": 0, "used_credits": 5
        })))
        .is_none());
        assert!(normalize_extra_usage(Some(&json!({
            "monthly_limit": 100, "used_credits": -1
        })))
        .is_none());
        assert!(normalize_extra_usage(Some(&json!("not-an-object"))).is_none());
        assert!(normalize_extra_usage(None).is_none());
    }

    #[test]
    fn merges_patches_into_extra_usage_without_dropping_existing_fields() {
        let mut data = json!({ "five_hour": { "utilization": 1 } });
        merge_into_extra_usage(&mut data, &json!({ "used_cents": 100 }));
        merge_into_extra_usage(&mut data, &json!({ "balance_cents": 50 }));
        assert_eq!(data["extra_usage"]["used_cents"], json!(100));
        assert_eq!(data["extra_usage"]["balance_cents"], json!(50));
        assert_eq!(data["five_hour"]["utilization"], json!(1));

        // A non-object extra_usage is replaced rather than crashing
        let mut odd = json!({ "extra_usage": "bogus" });
        merge_into_extra_usage(&mut odd, &json!({ "used_cents": 1 }));
        assert_eq!(odd["extra_usage"]["used_cents"], json!(1));
    }
}
