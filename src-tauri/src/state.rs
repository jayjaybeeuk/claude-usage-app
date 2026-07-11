use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

use serde::Deserialize;
use tokio::sync::oneshot;

/// Usage stats pushed from the renderer for tray display.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayStats {
    pub session: f64,
    pub weekly: f64,
    #[serde(default)]
    pub sonnet: f64,
    #[serde(default)]
    pub codex_session: Option<f64>,
    #[serde(default)]
    pub codex_weekly: Option<f64>,
}

#[derive(Default)]
pub struct AppState {
    pub tray_stats: Mutex<Option<TrayStats>>,
    /// Pending hidden-window fetches, keyed by window label. The init script
    /// running inside the hidden window resolves these via `report_fetch_result`.
    pub fetch_pending: Mutex<HashMap<String, oneshot::Sender<String>>>,
    pub fetch_counter: AtomicU64,
}
