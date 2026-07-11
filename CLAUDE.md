# Agent Usage Widget

## Overview

Tauri v2 desktop widget that monitors Claude.ai usage statistics in real-time. Displays session (5-hour) and weekly usage limits with progress bars, countdown timers, and a 7-day usage history graph. Communicates with Claude.ai API using hidden webview windows to bypass Cloudflare bot detection.

## Architecture

```
src-tauri/               # Rust backend (Tauri main process)
├── tauri.conf.json      # Window config (frameless, transparent, vibrancy), bundling
├── capabilities/        # ACL: default.json (main window), remote-fetch.json (claude.ai IPC)
└── src/
    ├── main.rs          # Builder setup, plugins, window lifecycle, position persistence
    ├── commands.rs      # Window controls, settings, usage history, auto-start commands
    ├── claude.rs        # Claude credentials, login capture, usage fetch + normalization
    ├── codex.rs         # Codex (ChatGPT) token detection + reqwest usage fetch
    ├── fetch_via_window.rs  # Hidden webview HTTP fetcher (Cloudflare bypass)
    ├── tray.rs          # System tray with dynamic usage stats + menu
    ├── settings.rs      # tauri-plugin-store helpers (settings.json in app data dir)
    └── state.rs         # Shared state (tray stats, pending hidden-window fetches)
src/
├── renderer/            # Frontend UI (no framework, pure TypeScript)
│   ├── tauri-api.ts     # Implements ElectronAPI over Tauri invoke/events → window.electronAPI
│   ├── app.ts           # UI state, login flow, data display, canvas chart
│   ├── index.html       # Widget markup + inline SVGs
│   └── styles.css       # Styling
└── shared/              # Types/constants used across renderer modules
    ├── ipc-types.ts     # TypeScript interfaces (Credentials, UsageData, ElectronAPI)
    └── refresh-interval.ts  # Clamp constants — mirrored in src-tauri/src/commands.rs
```

**Why `src/` still exists after the Electron→Tauri migration:** the app was ported by
replacing only the backend. `src/renderer/` is the entire UI and carried over unchanged;
`src/main/` (the Electron main process) was deleted and its logic rewritten in Rust under
`src-tauri/src/`. `src/shared/` no longer spans two processes — it survives as the
renderer's type/constant definitions, and `ipc-types.ts` remains the single source of
truth for the `window.electronAPI` contract that `tauri-api.ts` implements and the Rust
commands must serialize to (camelCase field names via serde). The `electronAPI` name is
kept deliberately so `app.ts` didn't need to change.

**Rust backend**: Frameless always-on-top window (480x174 base) configured in `tauri.conf.json`; tray with dynamic usage stats; login via visible webview window + cookie polling (`cookies_for_url`); fetches 3 API endpoints in parallel via `fetch_via_window.rs`.

**Renderer** (`app.ts`): Single-page UI with login flow, progress bars, SVG circular countdown timers, lightweight Canvas 2D usage history chart. Auto-refreshes every 5 minutes. Dynamic widget height based on expanded sections. Talks to Rust exclusively through `window.electronAPI` (installed by `tauri-api.ts` — the name is kept from the Electron era so `app.ts` stays unchanged).

## Key Commands

```bash
npm run dev              # Development: tauri dev (starts Vite via beforeDevCommand)
npm run dev:debug        # Development with DEBUG_LOG=1 (verbose Rust-side logging)
npm run build            # Bundle renderer only (vite build)
npm run typecheck        # Type-check the renderer tsconfig
npm test                 # Vitest renderer suite (happy-dom + mocked Tauri backend)
npm run test:coverage    # Same suite with 70% coverage thresholds enforced
npm run test:rust        # cargo test — Rust unit tests (parsing/normalization logic)
npm run package          # tauri build — release bundle for current platform
npm run package:debug    # tauri build --debug — debug bundle (faster compile)
npm run generate-icons   # Regenerate src-tauri/icons from assets/icon.png
```

Rust-only iteration: `cd src-tauri && cargo check`.

## Build System

- **Backend**: Rust / Cargo (`src-tauri/`), Tauri v2 with plugins: store, single-instance, autostart, opener
- **Renderer**: Bundled via Vite to `dist-renderer/` (target: chrome120)
- **Packaging**: Tauri bundler (DMG/app on macOS, NSIS on Windows, AppImage/deb on Linux)
- **Path alias**: `@shared` maps to `src/shared/` (Vite resolve; use relative imports in files that must also typecheck standalone)
- **Node.js**: Requires >=22.12.0; Rust stable toolchain required

## Key Patterns

- **Cloudflare bypass**: `fetch_via_window.rs` creates a hidden webview window per request. An initialization script reads `document.body` and reports it back through the `report_fetch_result` command; `capabilities/remote-fetch.json` allows this IPC from `https://claude.ai` pages in `api-fetch-*` windows. Detects blocked responses ("Just a moment", HTML content). Do NOT replace with plain HTTP requests — Cloudflare blocks non-browser TLS fingerprints.
- **Cookie planting**: There is no cross-platform set-cookie API in Tauri, so `claude.rs::ensure_session_cookie` loads a claude.ai-origin page hidden and sets `document.cookie` (not HttpOnly, which the server doesn't require inbound). Login-window cookies persist naturally in the shared webview data store.
- **Login capture**: `detect_session_key` opens a visible webview window at claude.ai/login and polls `cookies_for_url` for the `sessionKey` cookie. Embedded in-app login is blocked by Cloudflare — keep the separate-window flow.
- **Credential storage**: `tauri-plugin-store` JSON file (`settings.json` in app data dir), same key names as the old electron-store schema.
- **Parallel API fetching**: `tokio::join!` for usage, overage limit, and prepaid credits endpoints (usage required, others optional).
- **Single instance**: `tauri-plugin-single-instance` (registered first) focuses the existing widget.
- **Platform-aware**: macOS uses `windowEffects` vibrancy, `ActivationPolicy::Accessory` (no dock icon), template tray images, tray title text. `macOSPrivateApi` is required for the transparent window.
- **Window dragging**: handled in `tauri-api.ts` via `startDragging()` on title-bar mousedown (Electron's `-webkit-app-region` CSS does not work in Tauri).
- **Testing**: `src/renderer/__tests__/` drives the real UI (index.html + app.ts + tauri-api.ts) under happy-dom against an in-memory fake of the Rust backend (`backend.ts`); coverage thresholds (70%) are enforced in `vitest.config.ts`. Rust pure logic (Codex response parsing, extra-usage normalization, clamps) has `#[cfg(test)]` unit tests; command glue requires a live webview and is exercised via the TEST_FETCH=1 self-test instead.

## IPC Commands

Defined across `src-tauri/src/*.rs` (`#[tauri::command]`), registered in `main.rs`, and wrapped 1:1 by `src/renderer/tauri-api.ts` behind the `ElectronAPI` interface (`src/shared/ipc-types.ts`). Key commands: `get_credentials`, `save_credentials`, `fetch_usage_data`, `resize_window`, `update_tray_usage`, `detect_session_key`. Rust→renderer events: `refresh-usage`, `session-expired`, `codex-session-expired`, `debug-log`.

## API Endpoints

All requests go to `claude.ai/api/organizations/{orgId}/`:

- `usage` — session and weekly utilization (required)
- `overage_spend_limit` — spending limits (optional)
- `prepaid/credits` — prepaid balance (optional)

Codex usage comes from `chatgpt.com/backend-api/wham/usage` via reqwest (bearer token or session cookie).
