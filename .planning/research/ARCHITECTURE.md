# Architecture Research: Electron Desktop Widget Enhancements

**Domain:** Electron desktop application (offline caching, auto-updates, launch-at-startup)
**Researched:** 2026-02-20
**Confidence:** MEDIUM (based on training data and existing codebase analysis; web verification blocked)

## Executive Summary

Integrating offline caching, auto-updates, and launch-at-startup into the existing Electron app requires three distinct architectural subsystems that interact with different parts of the current architecture. Each feature has well-established patterns in the Electron ecosystem:

1. **Offline caching**: Cache layer in main process + storage via electron-store + IPC for cache invalidation
2. **Auto-updates**: electron-updater module in main process + IPC for UI notifications + electron-builder publish config
3. **Launch-at-startup**: auto-launch module in main process + IPC for settings toggle

These features integrate cleanly with the existing architecture without major refactoring. The main process handles all three features, communicating state to the renderer via IPC.

## Standard Electron Architecture Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                     ELECTRON RUNTIME                         │
├──────────────────────────┬──────────────────────────────────┤
│    MAIN PROCESS          │      RENDERER PROCESS            │
│  (Node.js environment)   │   (Chromium environment)         │
│                          │                                  │
│  ┌──────────────────┐   │   ┌────────────────────┐        │
│  │ Window Manager   │   │   │   UI Layer         │        │
│  │ Tray Manager     │   │   │   (app.ts)         │        │
│  │ IPC Handlers     │◄──┼───┤   IPC Calls        │        │
│  │ Storage Layer    │   │   │   Event Listeners  │        │
│  │ API Coordinator  │   │   └────────────────────┘        │
│  └──────────────────┘   │                                  │
│           │              │              ▲                   │
│           ▼              │              │                   │
│  ┌──────────────────┐   │   ┌────────────────────┐        │
│  │  electron-store  │   │   │   Context Bridge   │        │
│  │  (encrypted)     │   │   │   (preload.ts)     │        │
│  └──────────────────┘   │   └────────────────────┘        │
│                          │                                  │
│  ┌──────────────────┐   │                                  │
│  │ Hidden Window    │   │                                  │
│  │ (Cloudflare fix) │   │                                  │
│  └──────────────────┘   │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

## Current Architecture Analysis

### Existing Components

| Component | Location | Responsibility | Communication |
|-----------|----------|---------------|---------------|
| **Window Manager** | `main.ts` (lines 119-185) | Create/manage BrowserWindow, window positioning, lifecycle | IPC handlers |
| **Tray Manager** | `main.ts` (lines 290-309) | System tray icon, menu, usage stats display | IPC listeners |
| **IPC Hub** | `main.ts` (lines 312-599) | Handle all renderer ↔ main communication | ipcMain handlers |
| **Storage Layer** | `main.ts` (lines 39-41) | Encrypted credentials, usage history, settings | electron-store |
| **API Coordinator** | `main.ts` (lines 521-599) | Parallel API fetching, Cloudflare bypass | fetch-via-window |
| **Context Bridge** | `preload.ts` | Secure IPC exposure to renderer | contextBridge |
| **UI State Manager** | `renderer/app.ts` | Login flow, data display, auto-refresh | window.electronAPI |
| **Type System** | `shared/` | Shared interfaces, IPC channel constants | Imported by both processes |

### Existing Patterns

**Pattern 1: IPC Request/Response**
- Renderer invokes via `window.electronAPI.[method]` → preload → ipcMain handler → returns Promise
- Used for: credentials, data fetching, settings, window controls

**Pattern 2: IPC Fire-and-Forget**
- Renderer sends via `window.electronAPI.[method]` → preload → ipcMain listener
- Used for: window resize, tray updates, external links

**Pattern 3: Main → Renderer Events**
- Main sends via `mainWindow.webContents.send()` → preload listener → renderer callback
- Used for: refresh triggers, session expiry, debug logs

**Pattern 4: Encrypted Storage**
- electron-store with encryption key for sensitive data (credentials)
- Schema-typed store for type safety

**Pattern 5: Platform Branching**
- Check `process.platform` for macOS/Windows/Linux differences
- Used for: tray icons, window options, menu behavior

## Recommended Project Structure for New Features

```
src/
├── main/
│   ├── main.ts                    # Existing: window, tray, IPC hub
│   ├── preload.ts                 # Existing: context bridge
│   ├── fetch-via-window.ts        # Existing: Cloudflare bypass
│   │
│   ├── cache-manager.ts           # NEW: Offline caching logic
│   ├── update-manager.ts          # NEW: Auto-update orchestration
│   └── startup-manager.ts         # NEW: Launch-at-startup control
│
├── renderer/
│   ├── app.ts                     # Modified: add offline/update UI
│   ├── index.html                 # Modified: add update notification UI
│   └── styles.css                 # Modified: style new UI elements
│
└── shared/
    ├── ipc-channels.ts            # Modified: add new IPC channels
    ├── ipc-types.ts               # Modified: add new types
    └── cache-types.ts             # NEW: Cache-specific types
```

## Feature 1: Offline Caching

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                  MAIN PROCESS                         │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │         cache-manager.ts                 │        │
│  │  ┌────────────────────────────────────┐ │        │
│  │  │ CacheManager class                 │ │        │
│  │  │  - get(key): Promise<T | null>     │ │        │
│  │  │  - set(key, value, ttl): Promise   │ │        │
│  │  │  - clear(): Promise                │ │        │
│  │  │  - isStale(key): boolean           │ │        │
│  │  └────────────────────────────────────┘ │        │
│  └─────────────────┬────────────────────────┘        │
│                    │                                  │
│  ┌─────────────────▼────────────────────────┐        │
│  │       electron-store (cache.json)        │        │
│  │  {                                        │        │
│  │    "usage_data": {                        │        │
│  │      data: UsageData,                     │        │
│  │      timestamp: number,                   │        │
│  │      ttl: number                          │        │
│  │    },                                     │        │
│  │    "overage_data": {...},                 │        │
│  │    "prepaid_data": {...}                  │        │
│  │  }                                        │        │
│  └───────────────────────────────────────────┘        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  IPC Handler: fetch-usage-data           │        │
│  │  1. Check cache.get("usage_data")        │        │
│  │  2. If fresh, return cached               │        │
│  │  3. If stale/missing, fetch from API      │        │
│  │  4. Update cache, return fresh data       │        │
│  └─────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│               RENDERER PROCESS                        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  app.ts                                  │        │
│  │  - Show "Offline Mode" badge if cached   │        │
│  │  - Display cache age ("Updated 5m ago")  │        │
│  │  - Manual refresh bypasses cache         │        │
│  └─────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **CacheManager** | Abstract cache layer, TTL management, staleness checks |
| **electron-store** | Persist cache to disk (non-encrypted, separate store) |
| **IPC Handler** | Modified `fetch-usage-data` handler with cache-first logic |
| **Renderer UI** | Display offline indicators, cache age, manual refresh button |

### Data Flow

1. **App Launch (offline)**
   - Renderer calls `fetchUsageData()`
   - Main checks `CacheManager.get("usage_data")`
   - Cache hit → return cached data + `{ cached: true, age: timestamp }`
   - Renderer displays data with "Offline Mode" badge

2. **App Launch (online)**
   - Renderer calls `fetchUsageData()`
   - Main checks cache, finds stale/missing entry
   - Fetch from API via `fetchViaWindow()`
   - Update cache via `CacheManager.set("usage_data", data, 30 * 60 * 1000)` (30min TTL)
   - Return fresh data + `{ cached: false }`

3. **Manual Refresh**
   - Renderer calls `fetchUsageData({ bypassCache: true })`
   - Main skips cache, fetches from API
   - Update cache with fresh data
   - Return to renderer

4. **Auto-Refresh (5min timer)**
   - Same as manual refresh, but respects cache if still fresh
   - Only fetches if cache is stale

### Storage Schema

```typescript
// cache-types.ts
export interface CacheEntry<T> {
  data: T
  timestamp: number  // Date.now() when cached
  ttl: number        // milliseconds until stale
}

export interface CacheMetadata {
  cached: boolean    // Whether data came from cache
  age?: number       // Milliseconds since cached (if cached)
}

// New electron-store instance
const cacheStore = new Store<{
  usage_data?: CacheEntry<UsageData>
  overage_data?: CacheEntry<unknown>
  prepaid_data?: CacheEntry<unknown>
}>({
  name: 'cache',
  // No encryption needed for cache data
})
```

### Integration Points

**With existing code:**
- Modify `FETCH_USAGE_DATA` handler in `main.ts` (line 521)
- Add `CacheManager` import at top of `main.ts`
- Modify `fetchUsageData()` return type to include `CacheMetadata`
- Update renderer `app.ts` to display cache status

**New IPC channels:**
- `CLEAR_CACHE` — manual cache clearing from settings
- `GET_CACHE_STATUS` — check cache age/staleness

### Anti-Patterns to Avoid

**Anti-Pattern 1: Cache in Renderer**
- **Why bad**: Renderer process can be destroyed/reloaded, losing cache
- **Instead**: Always cache in main process with electron-store persistence

**Anti-Pattern 2: Unlimited Cache Growth**
- **Why bad**: Disk space fills up, stale data accumulates
- **Instead**: Implement TTL, max entries limit, automatic pruning

**Anti-Pattern 3: Caching Credentials**
- **Why bad**: Security risk if cache store is unencrypted
- **Instead**: Keep credentials in separate encrypted store (already done)

**Anti-Pattern 4: Silent Cache Failures**
- **Why bad**: Users don't know why data is outdated
- **Instead**: Show cache age, offline indicator, manual refresh option

## Feature 2: Auto-Updates

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                  MAIN PROCESS                         │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │       update-manager.ts                  │        │
│  │  ┌────────────────────────────────────┐ │        │
│  │  │ UpdateManager class                │ │        │
│  │  │  - checkForUpdates()               │ │        │
│  │  │  - downloadUpdate()                │ │        │
│  │  │  - installUpdate()                 │ │        │
│  │  │  - Events: available, downloaded   │ │        │
│  │  └────────────────────────────────────┘ │        │
│  └─────────────────┬────────────────────────┘        │
│                    │                                  │
│  ┌─────────────────▼────────────────────────┐        │
│  │       electron-updater                    │        │
│  │  (autoUpdater from electron-updater)      │        │
│  │  - Fetches latest.yml from GitHub         │        │
│  │  - Downloads .dmg/.exe/.AppImage          │        │
│  │  - Verifies signatures                    │        │
│  └───────────────────────────────────────────┘        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  app.whenReady() lifecycle                │        │
│  │  1. Initialize UpdateManager              │        │
│  │  2. Check for updates (15min after start) │        │
│  │  3. Periodic checks (every 4 hours)       │        │
│  └─────────────────────────────────────────┘        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  IPC Handlers                             │        │
│  │  - check-for-updates (manual)             │        │
│  │  - download-update                        │        │
│  │  - install-update (quit and install)      │        │
│  └─────────────────────────────────────────┘        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  IPC Events (Main → Renderer)             │        │
│  │  - update-available (version, notes)      │        │
│  │  - update-downloaded (ready to install)   │        │
│  │  - update-progress (percent)              │        │
│  │  - update-not-available                   │        │
│  │  - update-error (error message)           │        │
│  └─────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│               RENDERER PROCESS                        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  app.ts                                  │        │
│  │  - Listen for update-available            │        │
│  │  - Show notification banner              │        │
│  │  - "Update Available: v1.4.0"            │        │
│  │  - [Download] [Dismiss] buttons          │        │
│  │                                           │        │
│  │  - Listen for update-downloaded           │        │
│  │  - Show install prompt                    │        │
│  │  - "Update ready. Restart to install?"   │        │
│  │  - [Restart Now] [Later] buttons         │        │
│  └─────────────────────────────────────────┘        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  index.html                              │        │
│  │  <div id="update-banner">...</div>       │        │
│  └─────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│            GITHUB RELEASES (CDN)                      │
│                                                       │
│  releases/latest/                                     │
│    ├── latest.yml          (update metadata)         │
│    ├── latest-mac.yml      (macOS specific)          │
│    ├── latest-linux.yml    (Linux specific)          │
│    ├── Claude-Usage-App-1.4.0.dmg                    │
│    ├── Claude-Usage-App-1.4.0.exe                    │
│    └── Claude-Usage-App-1.4.0.AppImage               │
└──────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **UpdateManager** | Orchestrate update checks, wrap electron-updater, emit events |
| **electron-updater** | Handle download, signature verification, delta updates |
| **IPC Handlers** | Expose manual update controls to renderer |
| **IPC Events** | Notify renderer of update lifecycle events |
| **Renderer UI** | Display update notifications, download progress, install prompts |
| **electron-builder** | Generate update artifacts, publish to GitHub Releases |

### Data Flow

1. **Automatic Update Check (periodic)**
   - Main process timer triggers `UpdateManager.checkForUpdates()`
   - electron-updater fetches `latest.yml` from GitHub Releases
   - Compare current version (package.json) with remote version
   - If newer version exists:
     - Emit `update-available` event
     - Send IPC to renderer: `update-available` with `{ version, releaseNotes }`
     - Renderer shows notification banner

2. **Manual Update Check**
   - User clicks "Check for Updates" in settings
   - Renderer calls `electronAPI.checkForUpdates()`
   - Main process calls `UpdateManager.checkForUpdates()`
   - Same flow as automatic check

3. **Download Update**
   - User clicks "Download" in notification banner
   - Renderer calls `electronAPI.downloadUpdate()`
   - Main process calls `UpdateManager.downloadUpdate()`
   - electron-updater downloads .dmg/.exe/.AppImage in background
   - Progress events sent to renderer via `update-progress` IPC
   - When complete, emit `update-downloaded` event
   - Send IPC to renderer: `update-downloaded`
   - Renderer shows "Restart to install" prompt

4. **Install Update**
   - User clicks "Restart Now"
   - Renderer calls `electronAPI.installUpdate()`
   - Main process calls `UpdateManager.installUpdate()`
   - electron-updater quits app and runs installer
   - On macOS: replaces .app bundle
   - On Windows: runs NSIS installer
   - On Linux: replaces AppImage

### Storage Schema

```typescript
// ipc-types.ts additions
export interface UpdateInfo {
  version: string
  releaseNotes?: string
  releaseDate: string
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateError {
  message: string
  code?: string
}
```

### Integration Points

**With existing code:**
- Import `UpdateManager` in `main.ts`
- Initialize in `app.whenReady()` (after line 636)
- Add IPC handlers for update controls (after line 462)
- Register IPC event listeners in renderer `app.ts`

**New IPC channels:**
```typescript
// ipc-channels.ts additions
CHECK_FOR_UPDATES: 'check-for-updates'
DOWNLOAD_UPDATE: 'download-update'
INSTALL_UPDATE: 'install-update'
ON_UPDATE_AVAILABLE: 'update-available'
ON_UPDATE_DOWNLOADED: 'update-downloaded'
ON_UPDATE_PROGRESS: 'update-progress'
ON_UPDATE_NOT_AVAILABLE: 'update-not-available'
ON_UPDATE_ERROR: 'update-error'
```

**electron-builder config additions (package.json):**
```json
"build": {
  "publish": [
    {
      "provider": "github",
      "owner": "jayjaybeeuk",
      "repo": "claude-usage-app"
    }
  ]
}
```

**Environment variables needed:**
- `GH_TOKEN` — GitHub Personal Access Token for publishing releases

### Anti-Patterns to Avoid

**Anti-Pattern 1: Auto-Install Without Consent**
- **Why bad**: Disrupts user workflow, loses unsaved state
- **Instead**: Download automatically, prompt user to install

**Anti-Pattern 2: Using Electron's Built-in autoUpdater**
- **Why bad**: Doesn't work on Windows without code signing certificate
- **Instead**: Use electron-updater (works with unsigned Windows apps)

**Anti-Pattern 3: Checking for Updates on Every Launch**
- **Why bad**: Network overhead, GitHub rate limits, slow startup
- **Instead**: Delay first check 15 minutes, then check every 4-6 hours

**Anti-Pattern 4: No Fallback for Failed Updates**
- **Why bad**: User stuck with broken app if update corrupts
- **Instead**: electron-updater handles rollback automatically via delta updates

**Anti-Pattern 5: Silent Update Failures**
- **Why bad**: User never knows updates exist if network/GitHub fails
- **Instead**: Show "Check for Updates" in settings, log errors to console

## Feature 3: Launch-at-Startup

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                  MAIN PROCESS                         │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │       startup-manager.ts                 │        │
│  │  ┌────────────────────────────────────┐ │        │
│  │  │ StartupManager class               │ │        │
│  │  │  - enable()                        │ │        │
│  │  │  - disable()                       │ │        │
│  │  │  - isEnabled(): boolean            │ │        │
│  │  └────────────────────────────────────┘ │        │
│  └─────────────────┬────────────────────────┘        │
│                    │                                  │
│  ┌─────────────────▼────────────────────────┐        │
│  │       auto-launch (npm package)           │        │
│  │  - macOS: ~/Library/LaunchAgents/plist    │        │
│  │  - Windows: Registry (Run key)            │        │
│  │  - Linux: ~/.config/autostart/*.desktop   │        │
│  └───────────────────────────────────────────┘        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  electron-store (settings)                │        │
│  │  { launchAtStartup: boolean }             │        │
│  └───────────────────────────────────────────┘        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  IPC Handlers                             │        │
│  │  - get-launch-at-startup                  │        │
│  │  - set-launch-at-startup (enable/disable) │        │
│  └─────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│               RENDERER PROCESS                        │
│                                                       │
│  ┌─────────────────────────────────────────┐        │
│  │  app.ts (Settings UI)                    │        │
│  │  ┌────────────────────────────────────┐ │        │
│  │  │ Settings Panel                     │ │        │
│  │  │  ☑ Launch at startup               │ │        │
│  │  │  [Toggle changes saved instantly]  │ │        │
│  │  └────────────────────────────────────┘ │        │
│  └─────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│           OPERATING SYSTEM                            │
│                                                       │
│  macOS: ~/Library/LaunchAgents/                      │
│    com.claudeusage.widget.plist                      │
│                                                       │
│  Windows: Registry                                    │
│    HKEY_CURRENT_USER\Software\Microsoft\             │
│      Windows\CurrentVersion\Run                      │
│                                                       │
│  Linux: ~/.config/autostart/                         │
│    claude-usage-app.desktop                          │
└──────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **StartupManager** | Abstract platform-specific startup logic, provide unified API |
| **auto-launch** | Handle OS-specific launch registration (plist/registry/desktop) |
| **electron-store** | Persist user preference for launch-at-startup |
| **IPC Handlers** | Expose toggle to renderer |
| **Renderer UI** | Settings toggle for launch-at-startup |

### Data Flow

1. **Enable Launch at Startup**
   - User toggles "Launch at startup" checkbox in settings
   - Renderer calls `electronAPI.setLaunchAtStartup(true)`
   - Main process:
     1. Call `StartupManager.enable()`
     2. auto-launch creates OS-specific startup entry
     3. Update electron-store: `{ launchAtStartup: true }`
     4. Return success to renderer
   - Renderer updates checkbox state

2. **Disable Launch at Startup**
   - User unchecks "Launch at startup"
   - Renderer calls `electronAPI.setLaunchAtStartup(false)`
   - Main process:
     1. Call `StartupManager.disable()`
     2. auto-launch removes OS-specific startup entry
     3. Update electron-store: `{ launchAtStartup: false }`
     4. Return success to renderer
   - Renderer updates checkbox state

3. **Check Startup Status**
   - Settings panel loads
   - Renderer calls `electronAPI.getLaunchAtStartup()`
   - Main process:
     1. Call `StartupManager.isEnabled()`
     2. auto-launch checks OS-specific entry existence
     3. Compare with electron-store preference
     4. Return current state to renderer
   - Renderer sets checkbox initial state

### Storage Schema

```typescript
// StoreSchema addition in main.ts
interface StoreSchema {
  sessionKey: string
  organizationId: string
  windowPosition: { x: number; y: number }
  usageHistory: UsageHistoryEntry[]
  refreshIntervalMinutes: number
  launchAtStartup: boolean  // NEW
}
```

### Integration Points

**With existing code:**
- Import `StartupManager` in `main.ts`
- Initialize in `app.whenReady()` (after line 636)
- Add IPC handlers for startup controls (after line 449)
- Add settings toggle in renderer `app.ts` (settings panel)

**New IPC channels:**
```typescript
// ipc-channels.ts additions
GET_LAUNCH_AT_STARTUP: 'get-launch-at-startup'
SET_LAUNCH_AT_STARTUP: 'set-launch-at-startup'
```

**New preload API:**
```typescript
// preload.ts additions
getLaunchAtStartup: () => ipcRenderer.invoke('get-launch-at-startup')
setLaunchAtStartup: (enabled: boolean) => ipcRenderer.invoke('set-launch-at-startup', enabled)
```

### Anti-Patterns to Avoid

**Anti-Pattern 1: Enabling by Default Without Asking**
- **Why bad**: Intrusive, user didn't consent
- **Instead**: Default to disabled, show setting in UI, let user opt-in

**Anti-Pattern 2: Manual Registry/Plist Manipulation**
- **Why bad**: Platform-specific code, error-prone, maintenance burden
- **Instead**: Use auto-launch package (abstracts platform differences)

**Anti-Pattern 3: No Persistence of User Preference**
- **Why bad**: If auto-launch fails silently, state becomes inconsistent
- **Instead**: Store preference in electron-store, reconcile on app start

**Anti-Pattern 4: Starting Hidden Without Tray Icon**
- **Why bad**: App appears to not launch, user thinks it failed
- **Instead**: Always show tray icon (already implemented), optionally hide window

**Anti-Pattern 5: No Feedback on Toggle**
- **Why bad**: User doesn't know if setting was applied
- **Instead**: Update checkbox immediately, show toast notification if toggle fails

## Cross-Feature Architecture Patterns

### Pattern 1: Manager Classes

All three features use manager classes to encapsulate logic:

```typescript
// Common pattern for all managers
export class FeatureManager {
  private initialized: boolean = false

  constructor(private store: Store) {}

  async initialize(): Promise<void> {
    if (this.initialized) return
    // Setup logic
    this.initialized = true
  }

  // Public API methods
  // Event emitters
  // Error handling
}
```

**Why**: Separation of concerns, testability, lifecycle management

### Pattern 2: IPC Request/Response for Settings

```typescript
// Main process
ipcMain.handle('get-setting', async () => {
  return manager.getSetting()
})

ipcMain.handle('set-setting', async (_event, value) => {
  await manager.setSetting(value)
  return { success: true }
})

// Renderer
const current = await window.electronAPI.getSetting()
await window.electronAPI.setSetting(newValue)
```

**Why**: Type-safe, promise-based, error propagation

### Pattern 3: IPC Events for Push Notifications

```typescript
// Main process
updateManager.on('update-available', (info) => {
  mainWindow?.webContents.send('update-available', info)
})

// Preload
onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
  ipcRenderer.on('update-available', (_event, info) => callback(info))
}

// Renderer
window.electronAPI.onUpdateAvailable((info) => {
  showUpdateBanner(info)
})
```

**Why**: Real-time updates, decoupled architecture, no polling

### Pattern 4: Graceful Degradation

```typescript
// Each feature checks if it's supported/available
try {
  await feature.initialize()
} catch (error) {
  console.error('Feature unavailable:', error)
  // Continue without feature
}
```

**Why**: Resilience, cross-platform compatibility, progressive enhancement

## Build Order and Dependencies

### Phase 1: Offline Caching (No external dependencies)

**Implementation order:**
1. Create `cache-types.ts` (shared types)
2. Create `cache-manager.ts` (core logic)
3. Add IPC channels to `ipc-channels.ts`
4. Modify `FETCH_USAGE_DATA` handler in `main.ts`
5. Update `preload.ts` with cache methods
6. Modify renderer `app.ts` to show cache status
7. Add UI for cache indicators and manual refresh

**Why first**: No external package dependencies, builds on existing patterns, provides value immediately

### Phase 2: Launch-at-Startup (Requires auto-launch)

**Implementation order:**
1. Install `auto-launch` package
2. Create `startup-manager.ts` (wrapper around auto-launch)
3. Add `launchAtStartup` to store schema
4. Add IPC channels to `ipc-channels.ts`
5. Add IPC handlers to `main.ts`
6. Update `preload.ts` with startup methods
7. Add settings toggle in renderer

**Why second**: Simpler than auto-updates, self-contained, no build/publish changes

### Phase 3: Auto-Updates (Requires electron-updater + build changes)

**Implementation order:**
1. Install `electron-updater` package
2. Create `update-manager.ts` (wrapper around autoUpdater)
3. Add update types to `ipc-types.ts`
4. Add IPC channels to `ipc-channels.ts`
5. Add IPC handlers to `main.ts`
6. Update `preload.ts` with update methods
7. Add update notification UI in renderer
8. Modify `package.json` build config (add publish provider)
9. Configure GitHub Personal Access Token
10. Test update flow with beta release

**Why last**: Most complex, requires CI/CD changes, needs testing infrastructure, depends on GitHub Releases setup

## Recommended Technology Stack

### NPM Packages

| Package | Version | Purpose | Confidence |
|---------|---------|---------|------------|
| `electron-updater` | ^7.0.0 | Auto-update framework | HIGH (standard in ecosystem) |
| `auto-launch` | ^6.0.0 | Cross-platform startup registration | MEDIUM (popular, but verify current version) |

**Note**: No additional packages needed for offline caching (use existing electron-store)

### Build Configuration Changes

**package.json additions:**
```json
{
  "dependencies": {
    "electron-store": "^8.1.0",  // existing
    "auto-launch": "^6.0.0"      // NEW
  },
  "devDependencies": {
    "electron-updater": "^7.0.0"  // NEW
  },
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "jayjaybeeuk",
        "repo": "claude-usage-app"
      }
    ]
  }
}
```

## Platform-Specific Considerations

### macOS

**Auto-Updates:**
- Code signing required for notarization
- Use `dmg` target for updates
- electron-updater supports delta updates

**Launch-at-Startup:**
- Creates `~/Library/LaunchAgents/*.plist`
- Requires app to be in `/Applications` for best UX
- Dock icon already hidden (line 649)

**Offline Caching:**
- Cache stored in `~/Library/Application Support/claude-usage-app/`
- No platform-specific considerations

### Windows

**Auto-Updates:**
- NSIS installer target (already configured, line 88)
- No code signing required for electron-updater
- Delta updates supported

**Launch-at-Startup:**
- Modifies registry `HKEY_CURRENT_USER\...\Run`
- Requires elevation only if installing to `Program Files`
- Portable builds work with startup (already configured, line 123)

**Offline Caching:**
- Cache stored in `%APPDATA%\claude-usage-app\`
- No platform-specific considerations

### Linux

**Auto-Updates:**
- AppImage target (already configured, line 118)
- No code signing
- Full updates only (no delta)

**Launch-at-Startup:**
- Creates `~/.config/autostart/*.desktop` file
- Different desktop environments may vary
- Test on Ubuntu, Fedora, Arch

**Offline Caching:**
- Cache stored in `~/.config/claude-usage-app/`
- Ensure file permissions are correct

## Security Considerations

### Offline Caching

**Threat**: Cache poisoning if attacker gains file access
- **Mitigation**: Cache non-sensitive data only (usage stats, not credentials)
- **Mitigation**: Use separate unencrypted store for cache
- **Mitigation**: Validate cached data structure before use

### Auto-Updates

**Threat**: Man-in-the-middle update hijacking
- **Mitigation**: electron-updater verifies code signatures
- **Mitigation**: HTTPS for GitHub Releases (enforced)
- **Mitigation**: Don't implement custom update server

**Threat**: Malicious update packages
- **Mitigation**: Only publish updates from trusted CI/CD (GitHub Actions)
- **Mitigation**: Protect `GH_TOKEN` environment variable
- **Mitigation**: Use branch protection on main branch

### Launch-at-Startup

**Threat**: Persistence mechanism exploited by malware
- **Mitigation**: User must explicitly enable (opt-in)
- **Mitigation**: Show clear setting in UI
- **Mitigation**: Validate app path before registering startup

## Performance Implications

### Offline Caching

- **Benefit**: Faster startup (no API fetch on launch)
- **Cost**: 10-50KB disk space per cache entry
- **Cost**: ~5ms to read/write cache (negligible)

### Auto-Updates

- **Benefit**: Background downloads don't block UI
- **Cost**: First update check adds ~200ms to startup (delayed by 15min)
- **Cost**: Periodic checks use ~50KB network every 4 hours
- **Cost**: Update downloads: 50-100MB depending on platform

### Launch-at-Startup

- **Benefit**: No user action needed to start widget
- **Cost**: Adds ~500ms to OS boot time (app startup time)
- **Cost**: Minimal memory usage (tray icon only if window hidden)

## Error Handling Strategies

### Offline Caching Errors

```typescript
// Graceful degradation
try {
  const cached = await cacheManager.get('usage_data')
  if (cached) return cached
} catch (error) {
  console.error('Cache read failed, falling back to API:', error)
  // Continue to API fetch
}
```

### Auto-Update Errors

```typescript
// Don't block app if updates fail
updateManager.on('error', (error) => {
  console.error('Update check failed:', error)
  // Log to analytics, don't show to user unless manual check
})
```

### Launch-at-Startup Errors

```typescript
// Fail gracefully if OS denies permission
try {
  await startupManager.enable()
} catch (error) {
  console.error('Failed to enable launch at startup:', error)
  // Show toast: "Could not enable launch at startup. Check permissions."
  return { success: false, error: error.message }
}
```

## Testing Strategies

### Offline Caching

1. **Unit tests**: CacheManager methods (get, set, clear, isStale)
2. **Integration tests**: IPC handlers with cache mock
3. **Manual tests**:
   - Disconnect network, launch app (should show cached data)
   - Wait for TTL expiry, refresh (should show stale indicator)
   - Clear cache, refresh (should fetch from API)

### Auto-Updates

1. **Unit tests**: UpdateManager event handling
2. **Integration tests**: Mock electron-updater responses
3. **Manual tests**:
   - Publish beta release with higher version
   - Launch app, wait 15 minutes
   - Verify update notification appears
   - Download update, verify install prompt
   - Install update, verify new version launches

### Launch-at-Startup

1. **Unit tests**: StartupManager enable/disable logic
2. **Integration tests**: IPC handlers with auto-launch mock
3. **Manual tests**:
   - Enable setting, restart OS
   - Verify app launches automatically
   - Disable setting, restart OS
   - Verify app does not launch

## Migration Strategy

All three features are additive (no breaking changes to existing code):

1. **No database migrations needed** (electron-store handles schema changes)
2. **Backward compatibility**: Old versions without these features continue working
3. **Forward compatibility**: New versions gracefully handle missing cache/settings
4. **Rollback safe**: Disabling features via settings works immediately

## Deployment Checklist

### Offline Caching

- [ ] Add cache-manager.ts
- [ ] Add cache-types.ts
- [ ] Modify FETCH_USAGE_DATA handler
- [ ] Update preload API
- [ ] Add cache indicators to UI
- [ ] Test offline mode
- [ ] Test cache expiration
- [ ] Test manual cache clear

### Launch-at-Startup

- [ ] Install auto-launch package
- [ ] Add startup-manager.ts
- [ ] Update store schema
- [ ] Add IPC handlers
- [ ] Update preload API
- [ ] Add settings toggle UI
- [ ] Test on macOS, Windows, Linux
- [ ] Verify uninstall removes startup entry

### Auto-Updates

- [ ] Install electron-updater package
- [ ] Add update-manager.ts
- [ ] Add update types
- [ ] Add IPC handlers
- [ ] Update preload API
- [ ] Add update notification UI
- [ ] Configure electron-builder publish
- [ ] Set up GH_TOKEN in CI/CD
- [ ] Publish test release
- [ ] Verify update flow end-to-end
- [ ] Document release process

## Confidence Assessment

| Area | Confidence | Reasoning |
|------|------------|-----------|
| **Offline Caching Architecture** | HIGH | Standard pattern, builds on existing electron-store |
| **Auto-Update Architecture** | MEDIUM | electron-updater is standard, but web verification blocked |
| **Launch-at-Startup Architecture** | MEDIUM | auto-launch package version unverified |
| **Integration Points** | HIGH | Analyzed existing codebase in detail |
| **Platform Differences** | MEDIUM | Based on training data, not current docs |
| **Package Versions** | LOW | Cannot verify latest versions without web access |

## Sources

**Training data sources (unverified):**
- Electron documentation patterns (v30-31 era, January 2025 cutoff)
- electron-updater architecture (common patterns)
- auto-launch package patterns (GitHub examples)
- Existing codebase analysis (high confidence)

**Recommended verification before implementation:**
1. Check current electron-updater version and API (may have changed)
2. Verify auto-launch package compatibility with Electron 40.4.1
3. Review electron-builder publish configuration for GitHub provider
4. Check for breaking changes in electron-store 8.1.0+

## Open Questions for Phase-Specific Research

1. **Offline Caching**: What is optimal TTL for usage data? (5min, 30min, 1hr?)
2. **Auto-Updates**: Should we implement differential/delta updates on all platforms?
3. **Launch-at-Startup**: Should hidden window launch be default behavior on startup?
4. **All Features**: How to gracefully handle feature flags/rollout strategy?

---

*Architecture research for: Electron desktop widget enhancements*
*Researched: 2026-02-20*
*Confidence: MEDIUM (web verification blocked, based on training data + codebase analysis)*
