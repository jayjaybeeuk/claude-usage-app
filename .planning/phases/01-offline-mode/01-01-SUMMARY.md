---
phase: 01-offline-mode
plan: 01
subsystem: ipc
tags: [electron, ipc, typescript, shared-types]

# Dependency graph
requires: []
provides:
  - IpcChannels.GET_CACHED_USAGE channel constant ('get-cached-usage')
  - CachedUsageData interface (data: UsageData, timestamp: number)
  - ElectronAPI.getCachedUsage method signature (Promise<CachedUsageData | null>)
affects:
  - 01-offline-mode/01-02 (main process cache implementation uses IpcChannels.GET_CACHED_USAGE)
  - 01-offline-mode/01-03 (renderer offline fallback uses CachedUsageData type and getCachedUsage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared IPC contract: channel constant in ipc-channels.ts, types in ipc-types.ts, method in ElectronAPI interface"

key-files:
  created: []
  modified:
    - src/shared/ipc-channels.ts
    - src/shared/ipc-types.ts

key-decisions:
  - "CachedUsageData placed after UsageData in ipc-types.ts to maintain logical grouping of related types"
  - "getCachedUsage placed after fetchUsageData in ElectronAPI to keep data-fetching methods together"
  - "timestamp field type is number (Unix ms) to allow age calculation in renderer without Date parsing overhead"

patterns-established:
  - "IPC contract pattern: new channels always added to both ipc-channels.ts (constant) and ipc-types.ts (ElectronAPI method) before implementation"

requirements-completed: [OFFL-01, OFFL-02, OFFL-03, OFFL-04]

# Metrics
duration: 1min
completed: 2026-02-20
---

# Phase 1 Plan 1: IPC Contract for Offline Cache Summary

**GET_CACHED_USAGE channel constant and CachedUsageData interface establishing the shared IPC contract for offline cache across main, preload, and renderer**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-20T16:19:35Z
- **Completed:** 2026-02-20T16:20:31Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `IpcChannels.GET_CACHED_USAGE = 'get-cached-usage'` to the invoke section of ipc-channels.ts
- Added `CachedUsageData` interface with `data: UsageData` and `timestamp: number` fields to ipc-types.ts
- Added `getCachedUsage: () => Promise<CachedUsageData | null>` to the ElectronAPI interface in ipc-types.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Add GET_CACHED_USAGE channel to ipc-channels.ts** - `834b67b` (feat)
2. **Task 2: Add CachedUsageData interface and getCachedUsage to ipc-types.ts** - `3bd8e5d` (feat)

**Plan metadata:** `ec42eea` (docs: complete plan)

## Files Created/Modified
- `src/shared/ipc-channels.ts` - Added GET_CACHED_USAGE channel constant in the invoke section after SET_REFRESH_INTERVAL
- `src/shared/ipc-types.ts` - Added CachedUsageData interface after UsageData; added getCachedUsage method to ElectronAPI after fetchUsageData

## Decisions Made
- Placed `GET_CACHED_USAGE` after `SET_REFRESH_INTERVAL` in the invoke section to keep all invoke channels grouped together
- Placed `CachedUsageData` immediately after `UsageData` since it wraps UsageData; natural colocation
- Placed `getCachedUsage` immediately after `fetchUsageData` in ElectronAPI since both are data-retrieval methods
- Used `number` (Unix ms) for the timestamp field so callers can compute cache age with simple arithmetic

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Shared IPC contract complete; Plans 02 and 03 can proceed in parallel
- Plan 02 (main process): implement `ipcMain.handle(IpcChannels.GET_CACHED_USAGE, ...)` and cache persistence
- Plan 03 (renderer): call `window.electronAPI.getCachedUsage()` for offline fallback display

## Self-Check: PASSED

- FOUND: src/shared/ipc-channels.ts
- FOUND: src/shared/ipc-types.ts
- FOUND: .planning/phases/01-offline-mode/01-01-SUMMARY.md
- FOUND commit: 834b67b (feat: GET_CACHED_USAGE channel)
- FOUND commit: 3bd8e5d (feat: CachedUsageData interface)
- FOUND commit: ec42eea (docs: plan metadata)

---
*Phase: 01-offline-mode*
*Completed: 2026-02-20*
