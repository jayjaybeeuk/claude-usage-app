# External Integrations

**Analysis Date:** 2026-02-19

## APIs & External Services

**Claude.ai API:**
- Service: Claude usage monitoring
- What it's used for: Fetch real-time session/weekly usage stats, overage limits, prepaid credits
- SDK/Client: None (custom fetch via hidden Electron BrowserWindow in `src/main/fetch-via-window.ts`)
- Auth: sessionKey cookie (captured from Claude.ai login, stored in electron-store)
- Base URL: `https://claude.ai/api/`

## Data Storage

**Local Storage Only:**
- No external databases
- electron-store (encrypted) stores:
  - `sessionKey` - User authentication token for Claude.ai API
  - `organizationId` - Claude organization UUID
  - `windowPosition` - Widget window x/y coordinates
  - `usageHistory` - Array of historical usage entries (30-day rolling retention)
  - `refreshIntervalMinutes` - Auto-refresh interval setting

**File Storage:**
- Local filesystem only (Electron app directory)
- No cloud sync or remote storage

**Caching:**
- None configured (each refresh fetches fresh from Claude.ai API)

## Authentication & Identity

**Auth Provider:**
- Custom implementation via Claude.ai login cookie capture
- Flow:
  1. User clicks "Auto-Detect" → opens login browser window (`src/main/main.ts` line 481)
  2. User logs in at `https://claude.ai/login`
  3. Widget monitors `sessionKey` cookie creation via Electron session cookies API
  4. Once `sessionKey` detected, captures value and closes login window
  5. Stored encrypted in electron-store
- Implementation: `src/main/main.ts` lines 472-519 (`DETECT_SESSION_KEY` IPC handler)

**Cookie Management:**
- sessionKey set in Electron session: `session.defaultSession.cookies.set()` (line 89-98)
- Used by hidden BrowserWindow to authenticate API requests
- Cookie persists across app restarts
- Cleared on logout via tray menu or settings

## API Endpoints

**Required Endpoint:**
- `GET /api/organizations/{organizationId}/usage`
  - Returns: Session and weekly usage utilization percentages
  - Format: `{ five_hour: {utilization, resets_at}, seven_day: {utilization, resets_at}, ... }`
  - Required: Yes (widget shows error if missing)

**Optional Endpoints:**
- `GET /api/organizations/{organizationId}/overage_spend_limit`
  - Returns: Monthly/spend limit info (varies by account type)
  - Keys inspected: `monthly_credit_limit`, `spend_limit_amount_cents`, `is_enabled`, `used_credits`, `balance_cents`
  - Required: No (gracefully skipped if unavailable)
  - Usage: Populates "Overage" section in expand menu

- `GET /api/organizations/{organizationId}/prepaid/credits`
  - Returns: Prepaid credits balance (if account has prepaid plan)
  - Key inspected: `amount` (cents)
  - Required: No (gracefully skipped if unavailable)
  - Usage: Populates "Prepaid Balance" section

**Fetch Strategy:**
- All endpoints fetched in parallel via `Promise.allSettled()`
- Only usage is mandatory (failure halts refresh)
- Overage/prepaid failures logged but don't block main flow
- 30-second timeout per request (configurable in `src/main/fetch-via-window.ts` line 37)

## Error Handling for API Integration

**Cloudflare Detection:**
- Monitors response body for patterns:
  - "Just a moment" → CloudflareBlocked error
  - "Enable JavaScript and cookies to continue" → CloudflareChallenge error
  - HTML response (starts with `<html`) → UnexpectedHTML error
- Pattern matching in `src/main/fetch-via-window.ts` lines 27-31

**Session Expiration:**
- If usage fetch receives CloudflareBlocked/challenge, sessionKey is deleted
- Sends `SESSION_EXPIRED` IPC event to renderer
- Renderer clears credentials and returns to login flow
- Implementation: `src/main/main.ts` lines 544-558

**Retry Logic:**
- No automatic retry on API failure
- Manual refresh available via "Refresh" button or tray menu

## Monitoring & Observability

**Error Tracking:**
- None (no external error service)
- Console errors in dev mode (DevTools)
- Production: Errors logged to console only

**Logs:**
- Debug mode: `DEBUG_LOG=1` environment variable enables verbose logging
- Output: Renderer DevTools console (dev) or electron console
- Debug events sent to renderer via `debug-log` IPC channel
- Implementation: `src/main/main.ts` lines 46-56

## CI/CD & Deployment

**Hosting:**
- Distributable apps packaged via electron-builder
- No server hosting (desktop app)
- Releases: GitHub releases (manual, not CI-automated)
- Latest: v1.2.5 (from git history)

**CI Pipeline:**
- None configured (.github directory exists but no workflows set up)
- Build/package done manually: `npm run package` or `npm run package:mac|win|linux`

## Environment Configuration

**Required Environment Variables:**
- None (widget functions standalone after login)

**Optional Environment Variables:**
- `NODE_ENV=development` - Enables dev server loading (Vite on localhost:5173), dev tools
- `DEBUG_LOG=1` - Enables verbose debug logging
- `process.argv` checked for `--debug` flag (alternative to `DEBUG_LOG`)

**Secrets Location:**
- electron-store (encrypted file-based storage)
- Encryption key hardcoded: `'claude-widget-secure-key-2024'`
- File location: Electron app data directory (platform-specific)
  - macOS: `~/Library/Application Support/Claude Usage App/`
  - Windows: `%APPDATA%\Claude Usage App\`
  - Linux: `~/.config/Claude Usage App/`

## Webhooks & Callbacks

**Incoming:**
- None (widget is purely pull-based)

**Outgoing:**
- None (no external callbacks or webhooks triggered)

## User-Agent Spoofing

**Strategy:** Bypass Cloudflare bot detection
- Mac User-Agent: `'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'`
- Windows User-Agent: `'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'`
- Set at session level: `session.defaultSession.setUserAgent()` (line 73)
- Used by hidden BrowserWindow to simulate browser environment

---

*Integration audit: 2026-02-19*
