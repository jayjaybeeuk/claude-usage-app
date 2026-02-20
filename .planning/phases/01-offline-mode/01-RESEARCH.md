# Phase 1: Offline Mode - Research

**Researched:** 2026-02-20
**Domain:** Electron offline data caching, network detection, electron-store persistence
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Status bar — offline state**
- When offline and showing cached data: status bar reads "Offline · Last updated X minutes ago"
- Existing status bar UI is reused — offline mode only changes the text content
- When connectivity returns and live data is fetched: status bar reverts to existing "Refreshed just now" / "Refreshed X minutes ago" behavior (no changes needed there)

**Network recovery**
- Silent transition — no animation, no "Connected" flash
- Widget fetches live data in the background when network returns; status bar updates naturally as part of the normal refresh cycle

**Cold start with no cache**
- If the widget launches with no network AND no cached data: show the existing login/error screen unchanged
- Offline mode only activates when there IS cached data to display — don't show empty progress bars at 0%

**Cache staleness**
- No age limit — show whatever is cached regardless of how old it is
- The "Last updated X ago" timestamp is sufficient for the user to judge freshness themselves

### Claude's Discretion
- Cache persistence mechanism (electron-store is already in use, natural fit)
- Network detection approach (fetch failure vs. OS network events)
- Retry interval for resuming live fetching when network returns
- Exact data structure persisted to cache
- Whether to differentiate "no network" vs "API error" in offline detection

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OFFL-01 | Widget caches latest usage data locally on every successful API fetch | electron-store `set` on successful fetch; `CachedUsageData` shape defined below |
| OFFL-02 | Widget displays cached data when network is unavailable instead of showing an error | Catch-in-fetchUsageData pattern: on fetch failure with cache present, call `updateUI` with cached data |
| OFFL-03 | Widget shows "Last updated X ago" freshness indicator when displaying cached data | `updateStatusText` refactor: add `isOffline` flag; format as "Offline · Last updated X minutes ago" |
| OFFL-04 | Widget automatically resumes fetching live data when network connectivity returns | Polling retry loop in `fetchUsageData` catch block (5-minute interval); clears on success |
</phase_requirements>

---

## Summary

The offline mode implementation is a targeted, low-risk extension of the existing codebase. The widget already uses `electron-store` (v8.2.0) for persistent storage of credentials, window position, usage history, and refresh interval. Adding a cache for the latest `UsageData` snapshot (plus the timestamp of that snapshot) follows the exact same pattern already used throughout `main.ts`.

Network detection should be inference-from-failure rather than active polling or OS-level events. The existing `fetchUsageData` IPC handler already throws typed errors — the renderer catches these errors. When a fetch fails and a cache entry exists, the renderer should display cached data and enter "offline mode." This approach correctly handles both "no network" and "API temporarily down" cases identically, which aligns with the user decision to not differentiate between them.

Auto-resume on network recovery should be a simple polling retry in the renderer: when in offline mode, retry `fetchUsageData` every 5 minutes (the same as the normal refresh interval). When the fetch succeeds, offline mode clears and the status bar reverts naturally. No additional dependencies are needed — this is a pure code change across `main.ts`, `app.ts`, `ipc-channels.ts`, and `ipc-types.ts`.

**Primary recommendation:** Add `cachedUsageData` + `cachedUsageTimestamp` keys to the `StoreSchema` in `main.ts`; persist on every successful fetch; return cached data from the `FETCH_USAGE_DATA` handler when main fetch fails (by adding a new IPC channel `GET_CACHED_USAGE`); in the renderer, handle fetch failure with cached fallback and a 5-minute retry interval.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron-store | 8.2.0 (installed) | Persistent key-value store in Electron main process | Already in use; AJV-validated; encrypts sensitive data; survives app restarts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | All needed tools already exist in the project | Offline mode requires zero new dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-store for cache | SQLite / better-sqlite3 | Overkill — a single JSON blob is sufficient; no query needs |
| electron-store for cache | localStorage in renderer | Wrong process — data must persist across renderer reloads; must live in main |
| Fetch-failure detection | `net.isOnline()` / `navigator.onLine` | OS network APIs return false positives (connected to LAN but no internet); fetch failure is ground truth for THIS app |
| Fetch-failure detection | Renderer `window` online/offline events | Same false-positive problem; also doesn't detect API-specific failures |
| 5-minute poll retry | Exponential backoff | Deferred to v2 (OFFL-07); simpler interval matches normal refresh cycle |

**Installation:**
```bash
# No new packages needed
```

---

## Architecture Patterns

### Recommended Project Structure

No new files or folders are required. Changes are confined to:

```
src/
├── main/
│   └── main.ts              # Add cachedUsageData to StoreSchema; persist on fetch; new GET_CACHED_USAGE handler
├── renderer/
│   └── app.ts               # Offline state flag; fallback display; status text update; retry loop
└── shared/
    ├── ipc-channels.ts      # Add GET_CACHED_USAGE channel
    └── ipc-types.ts         # Add CachedUsageData interface
```

### Pattern 1: Cache-on-Success in Main Process IPC Handler

**What:** After each successful `FETCH_USAGE_DATA`, write the resolved `UsageData` + current timestamp to electron-store.
**When to use:** Inside the existing `ipcMain.handle(IpcChannels.FETCH_USAGE_DATA, ...)` block, after `return data`.

```typescript
// Source: electron-store v8 README + existing main.ts pattern
// In StoreSchema (main.ts):
interface StoreSchema {
  sessionKey: string
  organizationId: string
  windowPosition: { x: number; y: number }
  usageHistory: UsageHistoryEntry[]
  refreshIntervalMinutes: number
  cachedUsageData: UsageData          // NEW
  cachedUsageTimestamp: number        // NEW — Unix ms timestamp
}

// At the end of FETCH_USAGE_DATA handler, before return:
store.set('cachedUsageData', data)
store.set('cachedUsageTimestamp', Date.now())
return data
```

### Pattern 2: New GET_CACHED_USAGE IPC Channel

**What:** Renderer requests cached data at startup or after fetch failure. Main process returns `CachedUsageData | null`.
**When to use:** Called by renderer in two scenarios: (a) startup when first fetch fails, (b) any subsequent fetch failure.

```typescript
// Source: existing ipcMain.handle patterns in main.ts
// In ipc-channels.ts:
GET_CACHED_USAGE: 'get-cached-usage',

// In ipc-types.ts:
export interface CachedUsageData {
  data: UsageData
  timestamp: number   // Unix ms — when data was last fetched live
}

// In main.ts:
ipcMain.handle(IpcChannels.GET_CACHED_USAGE, (): CachedUsageData | null => {
  const data = store.get('cachedUsageData') as UsageData | undefined
  const timestamp = store.get('cachedUsageTimestamp') as number | undefined
  if (!data || !timestamp) return null
  return { data, timestamp }
})
```

### Pattern 3: Renderer Offline State and Fallback Display

**What:** In `fetchUsageData()`, on catch, request cached data and display it if present. Set an `isOffline` flag that modifies `updateStatusText()`.
**When to use:** In the existing error handler inside `fetchUsageData()`.

```typescript
// Source: existing app.ts error handling pattern (lines 430-439)

// New module-level state variable:
let isOffline = false
let offlineRetryInterval: ReturnType<typeof setInterval> | null = null

// In fetchUsageData() catch block — replace the current empty handler:
} catch (error) {
  const err = error as Error
  if (err.message.includes('SessionExpired') || err.message.includes('Unauthorized')) {
    credentials = { sessionKey: null, organizationId: null }
    showLoginRequired()
  } else {
    // Network or API error — try to show cached data
    const cached = await window.electronAPI.getCachedUsage()
    if (cached) {
      isOffline = true
      updateUI(cached.data)
      lastRefreshTime = cached.timestamp   // use original fetch time, NOT now
      updateStatusText()
      startStatusTimer()
      startOfflineRetry()
    }
    // If no cache: remain on whatever screen was already shown (login or loading)
  }
}
```

### Pattern 4: Status Bar Text for Offline Mode

**What:** `updateStatusText()` already formats "Refreshed X minutes ago" using `lastRefreshTime`. Extend it to prepend "Offline · " when `isOffline` is true.
**When to use:** Modify the existing `updateStatusText()` function.

```typescript
// Source: existing app.ts updateStatusText (lines 844-858)
function updateStatusText(): void {
  if (!lastRefreshTime) {
    elements.statusText.textContent = isOffline ? 'Offline · No data' : 'Refreshed just now'
    return
  }
  const elapsed = Date.now() - lastRefreshTime
  const minutes = Math.floor(elapsed / 60000)
  let timeStr: string
  if (minutes < 1) {
    timeStr = 'just now'
  } else if (minutes === 1) {
    timeStr = '1 minute ago'
  } else {
    timeStr = `${minutes} minutes ago`
  }

  if (isOffline) {
    elements.statusText.textContent = `Offline · Last updated ${timeStr}`
  } else {
    elements.statusText.textContent = minutes < 1 ? 'Refreshed just now' : `Refreshed ${timeStr}`
  }
}
```

### Pattern 5: Offline Retry Polling

**What:** When offline, start a retry interval at the same cadence as the normal auto-refresh. On success, clear `isOffline`, clear the retry interval, restart normal auto-update.
**When to use:** Called from offline branch of fetchUsageData catch block.

```typescript
// Source: existing startAutoUpdate() pattern in app.ts
function startOfflineRetry(): void {
  stopOfflineRetry()
  offlineRetryInterval = setInterval(async () => {
    try {
      const data = await window.electronAPI.fetchUsageData()
      // Success — back online
      isOffline = false
      stopOfflineRetry()
      updateUI(data)
      // Persist new cache
      lastRefreshTime = Date.now()
      updateStatusText()
      startStatusTimer()
      startAutoUpdate()
    } catch {
      // Still offline — updateStatusText already ticking via statusInterval
    }
  }, refreshIntervalMinutes * 60 * 1000)
}

function stopOfflineRetry(): void {
  if (offlineRetryInterval) {
    clearInterval(offlineRetryInterval)
    offlineRetryInterval = null
  }
}
```

### Pattern 6: Clear Offline State on Successful Normal Fetch

**What:** When `fetchUsageData()` succeeds normally (online path), ensure `isOffline` is cleared and offline retry is stopped.
**When to use:** In the success path of `fetchUsageData()`, alongside `lastRefreshTime = Date.now()`.

```typescript
// Add to success block in fetchUsageData(), after updateUI(data):
isOffline = false
stopOfflineRetry()
```

### Anti-Patterns to Avoid

- **Storing cache in renderer memory only:** Renderer memory does not survive app restarts; the cache MUST live in electron-store (main process) to satisfy OFFL-01's "persisted across restarts" requirement.
- **Using `net.isOnline()` as the offline trigger:** This API reports OS-level network adapter status, not actual internet reachability. The widget uses `fetch-via-window.ts` which makes real HTTP requests — a thrown error from that is the reliable signal.
- **Showing empty progress bars at 0% when cache is absent:** The locked decision is to show the existing login/error screen when there is no cache. Do not initialize `updateUI` with zeroed-out data.
- **Updating `lastRefreshTime = Date.now()` in offline mode:** When displaying cached data, `lastRefreshTime` should be set to `cached.timestamp` (when the data was actually fetched), not the current time. This ensures "Last updated X minutes ago" accurately reflects data age.
- **Not clearing `isOffline` on normal fetch success:** If the retry loop succeeds but the flag is not cleared, subsequent manual refreshes will incorrectly show "Offline · Last updated just now".

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persisting data across restarts | Custom file I/O, JSON read/write | electron-store (already installed) | Handles atomic writes, encryption, schema validation, file path resolution per platform |
| Time formatting "X minutes ago" | Custom date-diff library | Extend existing `updateStatusText()` | The logic already exists in app.ts lines 843–858 |
| Network change events | OS-level watchers, `net` module event listeners | Infer from fetch failure + retry polling | Ground truth for this app is whether the API is reachable, not whether a NIC is up |

**Key insight:** This phase requires zero new libraries. All needed infrastructure (persistent store, refresh intervals, status text, IPC pattern) already exists in the codebase.

---

## Common Pitfalls

### Pitfall 1: Caching the Merged Data Object in Main vs. Raw API Response

**What goes wrong:** The `FETCH_USAGE_DATA` handler in `main.ts` mutates `data` by merging `overageResult` and `prepaidResult` into `data.extra_usage` (lines 566–598). If the cache is persisted before this merge, the cached object will be missing extra usage data on cold-start display.
**Why it happens:** The merge happens after the parallel `Promise.allSettled` calls. A naive `store.set('cachedUsageData', usageResult.value)` at the wrong line misses the merge.
**How to avoid:** Place the `store.set('cachedUsageData', data)` call at the very end of the handler, after all merge logic is complete (the same position as `return data`).
**Warning signs:** Extra usage row (overage/prepaid) appears when online but disappears after restart — data was cached too early.

### Pitfall 2: `lastRefreshTime` Semantics Drift

**What goes wrong:** `lastRefreshTime` currently tracks when the UI last received live data. In offline mode it's tempting to update it to `Date.now()` when displaying cached data, which would make "Last updated X ago" read "just now" even for day-old cached data.
**Why it happens:** The existing `fetchUsageData` success path sets `lastRefreshTime = Date.now()` — the natural instinct is to keep that pattern.
**How to avoid:** In the offline branch, set `lastRefreshTime = cached.timestamp` (the timestamp saved when live data was fetched).
**Warning signs:** "Offline · Last updated just now" appears even when the cache is hours old.

### Pitfall 3: Offline Retry Interval Stacking

**What goes wrong:** Multiple concurrent retry intervals run simultaneously, causing redundant fetches and potential race conditions on recovery.
**Why it happens:** `fetchUsageData` is called from multiple sources (auto-update interval, manual refresh button, tray menu, timer expiry). If each failure starts a new `offlineRetryInterval`, they stack.
**How to avoid:** `startOfflineRetry()` must call `stopOfflineRetry()` first (already in the pattern above). Also, clear the main `updateInterval` when entering offline mode — `startOfflineRetry()` replaces it.
**Warning signs:** Multiple "back online" transitions happen in rapid succession.

### Pitfall 4: Offline Retry Not Cleared on Manual Refresh

**What goes wrong:** User clicks manual refresh button while in offline mode. Fetch succeeds. But `offlineRetryInterval` continues running in the background.
**Why it happens:** The manual refresh path calls `fetchUsageData` directly, which has the success branch that calls `stopOfflineRetry()` — but only if it's wired in.
**How to avoid:** The success path in `fetchUsageData` MUST call `stopOfflineRetry()` (covered in Pattern 6 above).
**Warning signs:** Background retry fires after user has already recovered manually, causing a duplicate refresh.

### Pitfall 5: Preload Bridge Missing `getCachedUsage`

**What goes wrong:** TypeScript compiles, but at runtime `window.electronAPI.getCachedUsage` is undefined because `preload.ts` was not updated.
**Why it happens:** The preload script must explicitly expose every IPC call via `contextBridge`. It's a separate file from the type definitions.
**How to avoid:** After adding `GET_CACHED_USAGE` to `ipc-channels.ts` and the handler in `main.ts`, also add `getCachedUsage: () => ipcRenderer.invoke('get-cached-usage')` to `preload.ts` AND add `getCachedUsage: () => Promise<CachedUsageData | null>` to the `ElectronAPI` interface in `ipc-types.ts`.
**Warning signs:** `TypeError: window.electronAPI.getCachedUsage is not a function` in renderer console.

---

## Code Examples

### electron-store Schema Extension (main.ts)
```typescript
// Source: electron-store v8.2.0 README + existing StoreSchema pattern
interface StoreSchema {
  sessionKey: string
  organizationId: string
  windowPosition: { x: number; y: number }
  usageHistory: UsageHistoryEntry[]
  refreshIntervalMinutes: number
  cachedUsageData: UsageData          // NEW
  cachedUsageTimestamp: number        // NEW
}

// Access pattern (already used throughout main.ts):
store.set('cachedUsageData', data)
store.set('cachedUsageTimestamp', Date.now())
const cached = store.get('cachedUsageData') as UsageData | undefined
const ts = store.get('cachedUsageTimestamp') as number | undefined
```

### IPC Channel Addition (ipc-channels.ts)
```typescript
// Source: existing ipc-channels.ts pattern
export const IpcChannels = {
  // ... existing channels ...
  GET_CACHED_USAGE: 'get-cached-usage',   // NEW
} as const
```

### Type Addition (ipc-types.ts)
```typescript
// Source: existing ipc-types.ts pattern
export interface CachedUsageData {
  data: UsageData
  timestamp: number  // Unix ms — when live data was last fetched
}

// Add to ElectronAPI interface:
getCachedUsage: () => Promise<CachedUsageData | null>
```

### Preload Bridge Addition (preload.ts)
```typescript
// Source: existing preload.ts pattern
getCachedUsage: () => ipcRenderer.invoke('get-cached-usage'),
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `net.isOnline()` for connectivity detection | Infer from fetch failure (app-specific) | Best practice evolved ~2020 | More reliable for apps that need actual API reachability, not just NIC status |
| Custom file persistence | electron-store | Mature since v6 (2019) | Atomic, encrypted, validated; no hand-rolled JSON I/O needed |

**Deprecated/outdated:**
- `electron-online` npm package: no longer needed; this app correctly uses fetch-failure inference instead.
- `navigator.onLine` event listeners for offline detection: suitable for web apps, unreliable for Electron apps that need to verify actual remote API reachability.

---

## Open Questions

1. **Should the tray tooltip/stats reflect cached data when offline?**
   - What we know: `latestTrayStats` in `main.ts` is only updated via `UPDATE_TRAY_USAGE` IPC (sent from renderer after a successful fetch). It persists in memory between refreshes already.
   - What's unclear: The locked decisions don't address whether tray should show "Offline" badge or just stale stats.
   - Recommendation: Keep current behavior — `latestTrayStats` retains the last value already. No tray changes needed for v1 offline mode. The CONTEXT.md decisions only address the status bar UI.

2. **What happens to the countdown timers (session/weekly reset timers) when offline?**
   - What we know: The timers read from `latestUsageData.five_hour.resets_at` / `seven_day.resets_at` which are timestamps. The countdown runs off `Date.now()` against those timestamps.
   - What's unclear: If the app is offline and the cached `resets_at` timestamp passes (session resets), the timer will hit zero and trigger `fetchUsageData()` (lines 639-648 in app.ts). This fetch will fail, re-entering the offline handler.
   - Recommendation: The offline retry handler catches this naturally — the fetch attempt after timer expiry will fail, call the offline branch, update the cache display (which now shows 0% / "Resetting..."), and continue retrying. No special case needed for OFFL-01–04. (v2 enhancement OFFL-06 explicitly addresses this.)

---

## Sources

### Primary (HIGH confidence)
- electron-store v8.2.0 — installed package at `node_modules/electron-store` — `get`, `set`, `delete`, `has` methods verified
- `src/main/main.ts` — existing `StoreSchema`, `store.get/set` call sites, `ipcMain.handle` patterns
- `src/renderer/app.ts` — `updateStatusText()` lines 844–858, `fetchUsageData()` error handler lines 430–439, `startAutoUpdate()` lines 829–833, `lastRefreshTime` usage
- `src/shared/ipc-channels.ts`, `src/shared/ipc-types.ts` — existing channel and type patterns
- `src/main/preload.ts` — contextBridge API surface

### Secondary (MEDIUM confidence)
- [Electron Online/Offline Events docs](https://www.electronjs.org/docs/latest/tutorial/online-offline-events) — confirmed `net.isOnline()` false-positive problem; verified fetch-failure is correct approach for this use case
- [electron-store README on GitHub](https://github.com/sindresorhus/electron-store/blob/main/readme.md) — confirmed v8 API: `get`, `set`, `delete`, `has`, `onDidChange`, `.store`, `.path`, `.size`

### Tertiary (LOW confidence)
- None — all claims verified against installed code or official docs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — electron-store already installed and in active use; zero new dependencies
- Architecture: HIGH — patterns are direct extensions of existing main.ts and app.ts code
- Pitfalls: HIGH — identified from close reading of the actual codebase, not generic advice

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (electron-store v8 is stable; Electron API stable)
