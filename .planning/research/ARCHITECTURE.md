# Architecture Research

**Domain:** Electron desktop widget enhancements (offline mode, auto-updates, launch-at-startup)
**Researched:** 2026-02-20
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ UI/State │  │ Offline  │  │ Update   │  │ Settings │    │
│  │ Display  │  │ Indicator│  │ Prompt   │  │ Panel    │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │              │             │              │          │
├───────┴──────────────┴─────────────┴──────────────┴──────────┤
│                     Preload Bridge (IPC)                      │
├──────────────────────────────────────────────────────────────┤
│                     Main Process                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ API Fetch│  │ Cache    │  │ Auto-    │  │ Startup  │    │
│  │ + Online │  │ Manager  │  │ Updater  │  │ Manager  │    │
│  │ Detection│  │          │  │          │  │          │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │              │             │              │          │
├───────┴──────────────┴─────────────┴──────────────┴──────────┤
│                     Persistence Layer                         │
│  ┌──────────────────────┐  ┌────────────────────────────┐    │
│  │   electron-store     │  │   OS Login Items / GitHub  │    │
│  │  (cache + settings)  │  │   Releases (external)      │    │
│  └──────────────────────┘  └────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Cache Manager | Store/retrieve latest API response; track freshness timestamp | New keys in electron-store: `cachedUsageData`, `lastFetchTimestamp` |
| Network Monitor | Detect online/offline state; emit events on change | `navigator.onLine` in renderer + Electron `online`/`offline` events |
| Auto-Updater | Check for updates, download, prompt user, install | electron-updater `autoUpdater` instance in main process |
| Startup Manager | Register/unregister app as login item; persist preference | `app.setLoginItemSettings()` + electron-store for preference |
| Offline Indicator | Show cached data state in UI; display freshness | Renderer UI element showing "Last updated X ago" or "Offline" |
| Update Prompt | Notify user of available update; offer install/dismiss | Renderer UI or native notification via IPC from main |

## Recommended Project Structure

New code integrates into existing structure with minimal new files:

```
src/
├── main/
│   ├── main.ts              # Add: cache write on fetch, online/offline listeners,
│   │                        #       auto-updater setup, startup settings IPC handlers
│   ├── preload.ts           # Add: new IPC methods (getUpdateInfo, setLaunchAtStartup,
│   │                        #       getCachedData, getNetworkStatus)
│   └── fetch-via-window.ts  # No changes needed
├── renderer/
│   ├── app.ts               # Add: offline indicator UI, update prompt UI,
│   │                        #       startup toggle in settings, freshness display
│   ├── index.html           # Add: offline indicator element, update prompt markup,
│   │                        #       startup toggle in settings section
│   └── styles.css           # Add: offline/stale states, update prompt styles
└── shared/
    ├── ipc-channels.ts      # Add: new channel constants for cache, update, startup
    └── ipc-types.ts         # Add: CachedUsageData, UpdateInfo, AppSettings interfaces
```

### Structure Rationale

- **No new files needed:** All features fit naturally into existing files; keeps architecture simple
- **Main process owns all new logic:** Cache, updater, and startup are main-process concerns
- **Renderer only adds UI:** Offline indicator, update prompt, startup toggle — all display concerns
- **Shared types extended:** New interfaces and channels follow existing patterns

## Architectural Patterns

### Pattern 1: Cache-Through on Fetch

**What:** On successful API fetch, write response + timestamp to electron-store before returning to renderer. On fetch failure (offline), return cached data with staleness flag.

**When to use:** Every `fetchUsageData` call.

**Trade-offs:** +Simple, +No new data flow, +Automatic cache invalidation on success. -Cache only as fresh as last successful fetch.

**Example:**
```typescript
// In main.ts fetchUsageData handler
try {
  const data = await fetchFromAPI()
  store.set('cachedUsageData', data)
  store.set('lastFetchTimestamp', Date.now())
  return { data, cached: false, fetchedAt: Date.now() }
} catch (error) {
  const cached = store.get('cachedUsageData')
  const fetchedAt = store.get('lastFetchTimestamp')
  if (cached) {
    return { data: cached, cached: true, fetchedAt }
  }
  throw error // No cache available
}
```

### Pattern 2: Event-Driven Update Flow

**What:** Auto-updater emits events (checking, available, downloaded, error); main process forwards relevant events to renderer via IPC; renderer shows appropriate UI.

**When to use:** Auto-update lifecycle.

**Trade-offs:** +Decoupled, +Renderer stays reactive, +Easy to add update progress. -More IPC channels to manage.

**Example:**
```typescript
// In main.ts
autoUpdater.on('update-available', (info) => {
  mainWindow.webContents.send('update-available', {
    version: info.version,
    releaseNotes: info.releaseNotes
  })
})
// Renderer listens and shows prompt
```

### Pattern 3: Settings Persistence

**What:** All user preferences (startup, refresh interval, etc.) stored in electron-store; main process reads on boot; renderer reads/writes via IPC.

**When to use:** Launch-at-startup toggle and any future settings.

**Trade-offs:** +Single source of truth, +Survives restarts, +Simple IPC pattern. -electron-store is synchronous (but acceptable for small data).

## Data Flow

### Offline Caching Flow

```
[Auto-refresh timer fires]
    ↓
[fetchUsageData IPC call]
    ↓
[Main process] → [fetchViaWindow()] → [API Success?]
    ↓ YES                                   ↓ NO
[Cache to store] → [Return fresh data]     [Read from store]
    ↓                                        ↓
[Renderer: show live data]              [Renderer: show cached + "Last updated X ago"]
```

### Auto-Update Flow

```
[App starts OR periodic check]
    ↓
[autoUpdater.checkForUpdates()]
    ↓
[Update available?]
    ↓ YES                    ↓ NO
[Send IPC to renderer]     [Done, check again later]
    ↓
[Renderer: show update prompt]
    ↓
[User clicks "Install"]
    ↓
[autoUpdater.quitAndInstall()]
```

### Launch at Startup Flow

```
[User toggles startup setting]
    ↓
[IPC to main: setLaunchAtStartup(enabled)]
    ↓
[Main: app.setLoginItemSettings({ openAtLogin: enabled })]
    ↓
[Main: store.set('launchAtStartup', enabled)]
    ↓
[Return confirmation to renderer]
```

### Key Data Flows

1. **Cache write:** fetchUsageData success → electron-store `cachedUsageData` + `lastFetchTimestamp`
2. **Cache read:** fetchUsageData failure → electron-store read → return with `cached: true` flag
3. **Update events:** autoUpdater events → IPC send to renderer → UI prompt
4. **Startup preference:** Renderer toggle → IPC → main process → OS login items + electron-store

## Anti-Patterns

### Anti-Pattern 1: Caching in Renderer

**What people do:** Store cached data in renderer memory or localStorage
**Why it's wrong:** Renderer reloads clear memory; localStorage isn't available in Electron renderer by default with context isolation; main process is the source of truth for data fetching
**Do this instead:** Cache in main process via electron-store; renderer always requests via IPC

### Anti-Pattern 2: Blocking on Update Check

**What people do:** Check for updates synchronously at app startup, blocking window display
**Why it's wrong:** Delays widget appearing; feels sluggish; update server could be slow
**Do this instead:** Check after app is fully loaded; use setTimeout to delay first check by 10-30 seconds

### Anti-Pattern 3: Using navigator.onLine Exclusively

**What people do:** Rely only on `navigator.onLine` for network detection
**Why it's wrong:** `navigator.onLine` can return true even when behind a captive portal or when DNS fails; doesn't detect API-specific failures
**Do this instead:** Combine `navigator.onLine` with actual fetch failure detection; if fetch fails, treat as offline regardless of browser flag

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| GitHub Releases | electron-updater polls for new releases | Configure `publish` in package.json build config; needs repo owner/name |
| Claude.ai API | Existing fetch-via-window | Add cache-through wrapper; no API changes needed |
| OS Login Items | Electron app.setLoginItemSettings() | macOS: LSSharedFileList; Windows: Registry; Linux: .desktop autostart |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Main ↔ Renderer (cache) | IPC: fetchUsageData now returns `{ data, cached, fetchedAt }` | Extends existing IPC response shape |
| Main ↔ Renderer (update) | IPC: new channels for update-available, update-install, update-error | New IPC channels in shared constants |
| Main ↔ Renderer (startup) | IPC: get/set launch-at-startup preference | Simple boolean preference via IPC |
| Main ↔ OS (startup) | app.setLoginItemSettings() | Platform-specific behavior handled by Electron |
| Main ↔ GitHub (updates) | electron-updater HTTP requests | Separate from fetch-via-window; uses Node.js HTTP directly |

## Suggested Build Order

1. **Offline mode first** — Extends existing fetchUsageData; least new infrastructure; immediate user value
2. **Launch at startup second** — Independent feature; simplest implementation; no new dependencies
3. **Auto-updates third** — Most infrastructure (electron-builder config, IPC channels, UI); benefits from offline mode already working (update download can handle network issues gracefully)

## Sources

- Electron docs: autoUpdater, app.setLoginItemSettings(), online/offline events
- electron-builder docs: publish providers, auto-update configuration
- electron-updater docs: event lifecycle, GitHub provider setup

---
*Architecture research for: Electron desktop widget enhancements*
*Researched: 2026-02-20*
