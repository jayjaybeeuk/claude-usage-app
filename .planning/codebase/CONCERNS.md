# Codebase Concerns

**Analysis Date:** 2026-02-19

## Tech Debt

**Hardcoded Encryption Key:**
- Issue: Encryption key is hardcoded in source at `src/main/main.ts:40`
- Files: `src/main/main.ts`
- Impact: electron-store encryption is cryptographically weak; credentials stored in plaintext-equivalent security. Any attacker with the source code or compiled binary can decrypt stored sessionKey/organizationId.
- Fix approach: Move encryption key to environment variable (`CLAUDE_WIDGET_KEY`) loaded at runtime. Fall back to secure default if not set. Rotate key in major version bump and request users re-authenticate.

**No Test Suite:**
- Issue: Codebase has 0 test files in `src/`; no unit, integration, or E2E tests
- Files: All files lack test coverage
- Impact: Changes risk breaking login flow, API fetching, timer logic, and UI state management without detection. No regression safety net.
- Fix approach: Add Jest/Vitest configuration. Start with critical path: `fetchViaWindow()` Cloudflare detection, `updateTimer()` countdown logic, `buildExtraRows()` UI rendering, and credential validation flow.

**Single-File Monolith (Renderer):**
- Issue: `src/renderer/app.ts` is 1206 lines with mixed concerns (UI, state, API, charting, timer logic)
- Files: `src/renderer/app.ts`
- Impact: Hard to test, maintain, or modify single concerns. High cognitive load. UI state mutations scattered throughout. Difficult to locate bug sources.
- Fix approach: Refactor into modules: `state.ts` (app state + mutations), `ui.ts` (DOM updates), `api.ts` (IPC calls), `timers.ts` (countdown/refresh logic), `charts.ts` (Canvas rendering).

**Global State Without Clear Ownership:**
- Issue: App state is scattered across global variables: `credentials`, `latestUsageData`, `isExpanded`, `isGraphVisible`, `isPieVisible`, `isSettingsOpen`, `lastRefreshTime`, `sessionResetTriggered`, `weeklyResetTriggered`
- Files: `src/renderer/app.ts:6-16`, `src/renderer/app.ts:625-626`
- Impact: State mutations are implicit. Race conditions possible between auto-update and manual refresh. Timer flags can become stale if refresh fails. Difficult to debug state corruption.
- Fix approach: Create centralized `AppState` object with mutation methods. Use event emitter or observable pattern for state changes. Clear reset() method between login/logout.

## Known Bugs

**Timer Reset Flag Race Condition:**
- Symptoms: If `fetchUsageData()` fails silently between countdown firing and actual refresh, `sessionResetTriggered` flag stays true and won't auto-refresh when server updates
- Files: `src/renderer/app.ts:625-670`
- Trigger: Session timer expires, refresh initiated, network fails, timer fires again
- Workaround: Manual refresh via button will reset flag and fetch new data

**Canvas Chart Not Responsive to Resize:**
- Symptoms: When widget expands/collapses, canvas dimensions stay same; chart becomes distorted or clipped
- Files: `src/renderer/app.ts:854-1003` (renderUsageChart)
- Trigger: Toggle graph visibility while data is displayed
- Workaround: Refresh data (Refresh button) to re-render chart at correct size

**Login Window Listener Leak on Abort:**
- Symptoms: If user force-closes login window without logging in, `onCookieChanged` listener may not fully clean up in rare race conditions
- Files: `src/main/main.ts:494-518`
- Trigger: Close login window during cookie change event propagation
- Workaround: Manual logout from tray menu clears all cookies properly

## Security Considerations

**Session Key Exposure via Cloudflare Bypass:**
- Risk: `fetch-via-window.ts` creates visible (if windowed) BrowserWindow that loads https://claude.ai. If user is monitoring network traffic or code is compromised, sessionKey is sent in plaintext over HTTPS but visible in browser state.
- Files: `src/main/fetch-via-window.ts:39-91`, `src/main/main.ts:521-599`
- Current mitigation: Window is created with `show: false` so not visible to user. Electron sandbox prevents main process from accessing page content directly. sessionKey is secured with encryptionKey in electron-store (though key is hardcoded).
- Recommendations: (1) Use secure environment variable for encryption key (see hardcoded key concern above). (2) Add log message when fetching to alert user. (3) Consider HTTPS certificate pinning to prevent MITM in future. (4) Clear sessionKey from memory immediately after validation.

**Cookie Scope Too Broad:**
- Risk: sessionKey cookie set to domain `.claude.ai` with `httpOnly: true` but also visible to hidden BrowserWindows; if compromised, affects all Claude.ai properties
- Files: `src/main/main.ts:88-99`
- Current mitigation: Scope is intentional (must work across claude.ai subdomains). httpOnly flag prevents JavaScript access. Domain restriction to claude.ai only.
- Recommendations: (1) Add session timeout (e.g., logout after 24h of inactivity). (2) Validate sessionKey freshness on each API call. (3) Store rotation schedule in documentation.

**No Input Validation on Manual Session Key:**
- Risk: `handleConnect()` trusts user-pasted sessionKey without length/format checks; could be exploited to inject API endpoint calls
- Files: `src/renderer/app.ts:309-338`
- Current mitigation: Validation happens server-side in `validateSessionKey()` IPC handler
- Recommendations: Add client-side format check (e.g., length >= 32, alphanumeric). Reject obviously malformed input before sending to validation endpoint.

**Tray Menu Clears Sensitive Data Without Confirmation:**
- Risk: "Log Out" menu item deletes sessionKey/organizationId and clears cookies without user confirmation
- Files: `src/main/main.ts:235-251`
- Current mitigation: None (intentional design for shared machines)
- Recommendations: Add optional confirmation dialog on logout if credential age > 2 weeks (reducing friction for frequent logouts).

## Performance Bottlenecks

**Canvas Chart Recalculates on Every Data Point:**
- Problem: `renderUsageChart()` groups history entries by hour every render call; with 30-day history this is O(n) on every visibility toggle or refresh
- Files: `src/renderer/app.ts:862-870`
- Cause: No caching of hourly aggregation; re-runs full loop on each toggle
- Improvement path: Cache sorted hourly data in `AppState`. Invalidate only when new entry saved. Memoize canvas rendering parameters.

**Memory Leak: Hidden BrowserWindow in fetchViaWindow:**
- Problem: If `fetchViaWindow()` timeout fires, window may not be fully destroyed immediately; subsequent rapid API calls create multiple orphaned windows
- Files: `src/main/fetch-via-window.ts:49-52`, `src/main/fetch-via-window.ts:84-88`
- Cause: No await on window destruction; event listeners may not fully detach
- Improvement path: Ensure `win.destroy()` is synchronous or add explicit cleanup. Consider BrowserWindow pooling for repeated API calls.

**Parallel API Fetches Create 3 Hidden Windows Simultaneously:**
- Problem: `Promise.allSettled()` at `src/main/main.ts:537-541` creates usage, overage, and prepaid windows in parallel; with default 30s timeout this is OK but on slow networks creates memory spike
- Files: `src/main/main.ts:536-599`
- Cause: No request throttling or sequential fallback
- Improvement path: Add configurable concurrency limit (e.g., max 2 parallel windows). Implement backoff/retry on failure before creating new window.

**DOM Queries on Every Timer Tick:**
- Problem: `refreshTimers()` runs every 1000ms and queries DOM for `.timer-text`, `.timer-progress` elements; no caching of element references
- Files: `src/renderer/app.ts:553-564`, `src/renderer/app.ts:628-689`
- Cause: Elements are generated dynamically in `buildExtraRows()`, so stable references difficult
- Improvement path: Cache DOM element references in state after generation. Update by reference rather than query.

## Fragile Areas

**Cloudflare Detection Logic:**
- Files: `src/main/fetch-via-window.ts:27-31`, `src/main/main.ts:547-558`
- Why fragile: Hardcoded string patterns ("Just a moment", "Enable JavaScript", "<html") used to detect blocks. If Cloudflare or Claude.ai changes page structure, detection breaks silently and user gets "InvalidJSON" error instead of clear "session expired" message.
- Safe modification: (1) Add feature flag to enable/disable detection per signature. (2) Log all unmatched error responses with first 500 chars for debugging. (3) Monitor error rates in production via debug endpoint.
- Test coverage: No unit tests for detection logic; only manual testing possible currently.

**Timer Reset Logic with Multiple Flags:**
- Files: `src/renderer/app.ts:625-626`, `src/renderer/app.ts:635-670`
- Why fragile: Two separate boolean flags (`sessionResetTriggered`, `weeklyResetTriggered`) track expired state; if one is reset but the other isn't, or if `fetchUsageData()` is called before timers update, flags become out-of-sync.
- Safe modification: (1) Combine into single map `const resetTriggered: Record<string, boolean> = {}` indexed by timer name. (2) Reset ALL flags on successful fetch. (3) Add assertion in `refreshTimers()` that confirms timer state matches stored flag.
- Test coverage: Manual testing only; no unit tests for flag state machine.

**Extra Rows UI Generation:**
- Files: `src/renderer/app.ts:465-550`
- Why fragile: `buildExtraRows()` clears and regenerates entire `innerHTML` of `extraRows` element; if DOM mutation timing is off during async fetches, user may see flickering or missing rows.
- Safe modification: (1) Generate row elements as DocumentFragment first, then append atomically. (2) Add transition animations to avoid jarring changes. (3) Only update changed rows (diff-based approach).
- Test coverage: No tests; only CSS visual regression possible.

**Pie Chart Geometry Calculations:**
- Files: `src/renderer/app.ts:1010-1182`
- Why fragile: Complex Canvas geometry with hardcoded circumference (63), ring gaps, and legend positioning. If canvas size changes (e.g., widget resized), layout may shift unpredictably.
- Safe modification: (1) Parameterize all magic numbers (63, 0.28, 0.07, etc.) as constants with comments. (2) Test at multiple canvas sizes (480px, 800px, 1200px). (3) Add visual regression tests with screenshot comparison.
- Test coverage: No tests; visual appearance relies on manual testing.

## Scaling Limits

**Usage History 30-Day Retention:**
- Current capacity: ~432 data points (one per 5-10 min refresh × 720 hours)
- Limit: electron-store serialization of 432+ entries slows down at ~1-2MB JSON. Load time becomes noticeable on older machines.
- Scaling path: (1) Implement hourly aggregation (compress 6-12 entries to 1 per hour). (2) Archive old entries to separate file. (3) Consider SQLite backend if >365 days retention needed.

**Single Tray Instance:**
- Current capacity: 1 widget instance per machine (enforced by `requestSingleInstanceLock()`)
- Limit: If user wants multiple Claude accounts monitored, architecture doesn't support it. Second instance fails silently.
- Scaling path: (1) Change lock key to include `organizationId` to allow multiple orgs. (2) Create separate tray entry per account. (3) De-duplicate API endpoints if >2 accounts share same org.

**API Fetch Concurrency:**
- Current capacity: 3 parallel windows (usage, overage, prepaid) with 30s timeout
- Limit: On slow networks (< 1Mbps), 3 windows × 30s = 90s worst case; widget appears frozen
- Scaling path: Implement exponential backoff, max 2 windows in parallel, optional sequential fallback for prepaid/overage if not critical.

## Dependencies at Risk

**electron-store Security Model:**
- Risk: Relies on OS-level encryption APIs (Keychain on macOS, CredentialManager on Windows). If OS key storage is compromised, all stored credentials are exposed.
- Impact: sessionKey/organizationId theft if machine is compromised
- Migration plan: (1) Evaluate Electron SafeStorage API (newer Electron versions). (2) Implement optional app-level encryption with user-provided password. (3) Add credential rotation warnings after 30 days.

**Electron 40.4.1 End-of-Life:**
- Risk: Electron versions are supported for ~18 months. Version 40 will likely EOL in late 2026.
- Impact: Security patches will stop; users running old version become vulnerable
- Migration plan: Set up automated Electron updates via electron-updater. Test major version upgrades in CI before shipping. Plan for major version bump every 12 months.

**Hardcoded Claude.ai API URLs:**
- Risk: API endpoints hardcoded in `src/main/main.ts:532-534`. If Claude.ai changes domain or API structure, widget breaks without app update.
- Impact: Users can't use widget if Anthropic migrates infrastructure
- Migration plan: (1) Move API endpoints to config file. (2) Add fallback/migration URLs in app. (3) Implement optional endpoint override via environment variable for advanced users.

## Missing Critical Features

**No Offline Mode:**
- Problem: Widget requires live API calls every 5 minutes. On airplane mode or disconnected, widget shows "Login Required" and clears session.
- Blocks: Users can't view historical usage offline; session state lost if network drops briefly
- Recommendation: Cache latest usage data locally with timestamp. Show "Last refresh: X ago" and allow offline viewing. Reconnect automatically when network returns.

**No Authentication Expiry Handling:**
- Problem: If sessionKey expires on Claude.ai backend, widget doesn't detect until next API call. User sees vague error or no feedback.
- Blocks: Users confused about why widget stopped working; no clear remediation path
- Recommendation: Implement session validation timer (e.g., every 24h). Proactively prompt re-login before expiry. Log session age to help debug stale keys.

**No Update Mechanism:**
- Problem: Widget has no built-in update check. Users must manually download new releases.
- Blocks: Users stay on old versions with bugs/security issues; no telemetry on upgrade adoption
- Recommendation: Add electron-updater for auto-updates. Implement checksum validation and staged rollouts for major versions.

**No Error Reporting:**
- Problem: If API call fails or chart rendering breaks, user sees generic error with no diagnostics sent to developer.
- Blocks: Hard to debug user issues; duplicate bug reports possible
- Recommendation: Implement optional error reporting (opt-in) that sends sanitized error logs to backend. Include device OS, app version, error stack trace.

**No Multi-Organization Support:**
- Problem: App supports only 1 organization ID at a time.
- Blocks: Users with multiple Claude accounts can't monitor all accounts simultaneously; must log out and back in
- Recommendation: Allow multiple credentials to be saved (keyed by org). Create separate tray menu items or tabs per account. De-duplicate API calls for shared endpoints.

## Test Coverage Gaps

**fetchViaWindow() Cloudflare Bypass:**
- What's not tested: Detection of "Just a moment" page, "Enable JavaScript" challenge, unexpected HTML responses. Success path with JSON parsing. Timeout behavior.
- Files: `src/main/fetch-via-window.ts`
- Risk: Silent failures; user gets "InvalidJSON" instead of actionable "Cloudflare Blocked" error. Timeout behavior untested could lead to orphaned windows.
- Priority: High (affects critical API flow)

**Timer Countdown Logic:**
- What's not tested: Elapsed percentage calculation, color warning/danger thresholds (75%, 90%), edge cases (timer expires, resets_at is null, time is negative)
- Files: `src/renderer/app.ts:721-782`
- Risk: Timers display incorrect time or wrong warning colors; confuses users about remaining quota
- Priority: Medium (visual but not functional impact)

**Credential Validation:**
- What's not tested: Invalid sessionKey rejection, organizationId extraction from API response, cookie setting before validation, cleanup on failure
- Files: `src/main/main.ts:350-384`
- Risk: Invalid credentials accepted, cookie persists after failed login, orphaned state
- Priority: High (security and core flow)

**UI State Mutations During Async Fetches:**
- What's not tested: Concurrent manual refresh + auto-update race condition, state consistency if fetch fails midway, UI not updating if state updated but event not fired
- Files: `src/renderer/app.ts` (global state)
- Risk: Stale UI, duplicate fetches, race conditions with concurrent operations
- Priority: Medium (data consistency)

**Canvas Chart Rendering Edge Cases:**
- What's not tested: Empty history, single data point, all-zero utilization, extreme values (>100%), missing optional fields (opus, cowork)
- Files: `src/renderer/app.ts:854-1003`, `src/renderer/app.ts:1010-1182`
- Risk: Chart doesn't render, crashes with JS error, displays incorrectly
- Priority: Low (visual, non-blocking)

**Login Flow:**
- What's not tested: Browser login window keyboard shortcuts, cookie capture timing, session key format validation, validation failure scenarios
- Files: `src/main/main.ts:472-519`, `src/renderer/app.ts:341-378`
- Risk: Login hangs, wrong session key accepted, user confused
- Priority: Medium (core user journey)

---

*Concerns audit: 2026-02-19*
