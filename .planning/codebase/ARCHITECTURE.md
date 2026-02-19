# Architecture

**Analysis Date:** 2025-02-19

## Pattern Overview

**Overall:** Electron Multi-Process Desktop Application with Context Isolation

**Key Characteristics:**
- Three distinct layers: Electron main process (Node.js), preload bridge (sandboxed), and renderer (frontend)
- Context isolation enforced (`nodeIntegration: false`, `contextIsolation: true`)
- IPC-based communication between processes with typed channels and interfaces
- Hidden BrowserWindow for API requests (Cloudflare bypass via browser session)
- Persistent state via encrypted electron-store
- Platform-aware UI (macOS vibrancy, Windows NSIS, Linux AppImage)

## Layers

**Main Process (Node.js/Electron):**
- Purpose: Window lifecycle, OS integration (tray, menu), API coordination, credential storage
- Location: `src/main/main.ts`
- Contains: Window creation, IPC handlers, tray menu, session management, credential encryption
- Depends on: Electron, electron-store, fetch-via-window helper
- Used by: Renderer process (via IPC), fetch-via-window, system tray

**Preload Bridge (Sandboxed):**
- Purpose: Secure IPC interface exposing main process functionality to renderer
- Location: `src/main/preload.ts`
- Contains: Context-bridged API wrapping ipcRenderer.invoke/send calls
- Depends on: Electron IPC, shared type interfaces
- Used by: Renderer process (via window.electronAPI)

**Renderer Process (Frontend):**
- Purpose: UI display, user interaction, state management, data visualization
- Location: `src/renderer/app.ts`, `src/renderer/index.html`, `src/renderer/styles.css`
- Contains: UI state, login flow, progress bars, Canvas 2D charts (usage history, pie), event handlers
- Depends on: window.electronAPI bridge, no external frameworks
- Used by: User interaction only

**Shared Layer (Type Definitions):**
- Purpose: TypeScript interfaces and IPC channel constants shared between main and renderer
- Location: `src/shared/ipc-types.ts`, `src/shared/ipc-channels.ts`, `src/shared/refresh-interval.ts`
- Contains: Credentials, UsageData, TrayUsageStats, WindowPosition types; IPC channel name constants
- Depends on: Nothing (pure types/constants)
- Used by: Main process, renderer, preload

**API Layer (Hidden Window Fetch):**
- Purpose: Fetch JSON from Claude.ai API while bypassing Cloudflare bot detection
- Location: `src/main/fetch-via-window.ts`
- Contains: Hidden BrowserWindow loader, response parsing, Cloudflare block detection
- Depends on: Electron BrowserWindow
- Used by: Main process IPC handler FETCH_USAGE_DATA

## Data Flow

**Login Flow:**

1. **Auto-Detect (Browser Login)**
   - Renderer calls `window.electronAPI.detectSessionKey()`
   - Main process handler creates visible BrowserWindow → loads https://claude.ai/login
   - User authenticates normally (avoids Cloudflare block)
   - Main process listens for `sessionKey` cookie being set after login
   - Returns sessionKey to renderer; renderer validates and saves

2. **Manual (Paste Session Key)**
   - Renderer calls `window.electronAPI.validateSessionKey(sessionKey)`
   - Main process handler calls `fetchViaWindow()` → hidden BrowserWindow → /api/organizations
   - Extracts org ID from response
   - Saves sessionKey + organizationId to encrypted electron-store
   - Updates Electron session cookies for API requests

**Usage Data Fetch:**

1. Renderer calls `window.electronAPI.fetchUsageData()`
2. Main process handler retrieves stored credentials from electron-store
3. Sets sessionKey cookie in Electron session (ensures BrowserWindow includes it)
4. Calls `fetchViaWindow()` 3 times in parallel via `Promise.allSettled()`:
   - `https://claude.ai/api/organizations/{orgId}/usage` (required)
   - `https://claude.ai/api/organizations/{orgId}/overage_spend_limit` (optional)
   - `https://claude.ai/api/organizations/{orgId}/prepaid/credits` (optional)
5. Each `fetchViaWindow()` creates a hidden BrowserWindow, loads URL, executes JS to extract `document.body.innerText`, parses JSON
6. Merges overage + prepaid data into response UsageData object
7. Returns to renderer; renderer updates UI and records history entry

**State Management:**

- **Credentials:** Stored in electron-store (encrypted), retrieved on app boot, set as session cookie
- **Usage Data:** Held in renderer memory (`latestUsageData`), fetched every 5 minutes (configurable)
- **Tray Stats:** Latest session/weekly/sonnet percentages cached in main process (`latestTrayStats`), updated by renderer via IPC
- **Usage History:** 30-day rolling window stored in electron-store, accessed by renderer for charts
- **Window Position:** Saved to electron-store on every window move, restored on app boot
- **Refresh Interval:** 1-20 minute range, default 5 min, stored in electron-store

## Key Abstractions

**Credentials (SessionKey + OrganizationId):**
- Purpose: Authentication for Claude.ai API
- Examples: `src/shared/ipc-types.ts` (Credentials interface), `src/main/main.ts` lines 312-347 (credential handlers)
- Pattern: Save to electron-store, set as cookie, validate before API calls

**UsageData (Multi-Period Breakdown):**
- Purpose: Container for session (5h) and weekly (7d) utilization, per-model breakdowns (Sonnet, Opus, Cowork, OAuth)
- Examples: `src/shared/ipc-types.ts` (UsageData interface), `src/renderer/app.ts` lines 597-622 (updateUI)
- Pattern: Merges data from 3 API endpoints; fields are optional (not all users have all models)

**FetchViaWindow (Cloudflare Bypass):**
- Purpose: HTTP request via hidden browser window with session cookies
- Examples: `src/main/fetch-via-window.ts`, called from `src/main/main.ts` lines 538-541
- Pattern: Creates BrowserWindow, loads URL, executes JS to extract body text, parses JSON, detects block signatures

**IPC Channels (Typed Communication):**
- Purpose: Main/renderer bridge with named channels and type-safe payloads
- Examples: `src/shared/ipc-channels.ts` (constants), `src/main/preload.ts` (wrapping), `src/renderer/app.ts` (calling)
- Pattern: invoke/send from renderer → handle/on in main; callback listeners for main → renderer

**Canvas 2D Charts (No Dependencies):**
- Purpose: Render usage history (line chart) and model breakdown (donut chart) without charting library
- Examples: `src/renderer/app.ts` lines 854-1003 (renderUsageChart), lines 1010-1182 (renderPieChart)
- Pattern: Canvas context drawing with pixel-perfect positioning, scaling for device pixel ratio

## Entry Points

**Electron Main Process:**
- Location: `src/main/main.ts` (compiled to `dist-main/main/main.js`)
- Triggers: Electron app ready event
- Responsibilities: Create frameless always-on-top window, system tray setup, credential restoration, IPC handler registration, single-instance lock

**Renderer HTML:**
- Location: `src/renderer/index.html`
- Triggers: Window loads HTML in dev (via Vite dev server) or prod (from `dist-renderer/index.html`)
- Responsibilities: Layout markup, inline SVG icons, placeholder for app state

**Renderer TypeScript:**
- Location: `src/renderer/app.ts`
- Triggers: Script runs after HTML loads
- Responsibilities: DOM initialization, event listener setup, credential fetch, login flow, usage data fetching/display, chart rendering

**Preload Script:**
- Location: `src/main/preload.ts` (compiled to `dist-main/main/preload.js`)
- Triggers: Electron preload script specified in BrowserWindow constructor
- Responsibilities: Context bridge registration (expose electronAPI on window), IPC wrapper methods

## Error Handling

**Strategy:** Try-catch with specific error types for recovery

**Patterns:**

- **API Errors:** `fetchViaWindow()` detects known Cloudflare block signatures ("Just a moment", "Enable JavaScript and cookies", HTML content) and throws named errors (CloudflareBlocked, CloudflareChallenge, UnexpectedHTML)

- **Session Expiration:** Main process catches 403/session errors from usage fetch, clears stored credentials, sends SESSION_EXPIRED IPC to renderer; renderer shows login screen

- **Network Timeout:** `fetchViaWindow()` has 30-second timeout; rejects with "Request timeout" error

- **Validation Failures:** `validateSessionKey()` calls /api/organizations; if empty array or error response, returns `{ success: false, error: string }` to renderer

- **Credential Missing:** `fetchUsageData()` checks for sessionKey/organizationId; throws "Missing credentials" if not found

- **UI Errors:** Renderer catches `fetchUsageData()` errors, logs to console, checks error message for SessionExpired/Unauthorized and re-prompts login

## Cross-Cutting Concerns

**Logging:**
- Debug mode: `DEBUG_LOG=1` env var enables verbose console logging in main and renderer
- Main process: `debugLog()` function checks DEBUG flag before logging
- Renderer: Similar pattern with `URLSearchParams` debug query param
- Forwarding: Main sends debug logs to renderer via IPC (DEBUG_LOG channel)

**Validation:**
- Session key: Validated against /api/organizations endpoint before saving
- Refresh interval: Clamped to 1-20 min range on both main and renderer
- Usage data: Optional fields checked with `?.utilization`, `??` nullish coalescing for defaults

**Authentication:**
- Sessionkey stored encrypted in electron-store (encryption key hardcoded as "claude-widget-secure-key-2024")
- Cookie set in Electron session for API requests via hidden window
- Logout clears store entries, removes cookies, clears session storage (prevents lingering on shared machines)

**Platform Detection:**
- Main: `process.platform` checks for darwin/win32/linux → applies CSS classes, adjusts tray behavior, icon paths
- Renderer: Platform class added to body element (platform-darwin, platform-win32, platform-linux)
- macOS: Uses vibrancy, hides dock icon, template tray images, menu keyboard shortcuts
- Windows: NSIS installer + portable .exe, ICO icon, taskbar visibility
- Linux: AppImage, standard X11 window decorations

---

*Architecture analysis: 2025-02-19*
