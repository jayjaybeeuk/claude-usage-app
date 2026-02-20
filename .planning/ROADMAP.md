# Roadmap: Claude Usage Widget v1.4

## Overview

This roadmap delivers three table-stakes desktop widget enhancements: offline resilience with cached data, launch-at-startup support, and automated updates via GitHub Releases. The journey extends existing API fetching infrastructure with caching, adds OS-level autostart capabilities, and integrates electron-updater for seamless version updates. Cross-platform testing ensures reliability across macOS, Windows, and Linux.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Offline Mode** - Widget shows cached data when network unavailable
- [ ] **Phase 2: Launch at Startup** - User can toggle autostart via tray menu
- [ ] **Phase 3: Auto-Updates** - Widget checks for and installs updates from GitHub Releases
- [ ] **Phase 4: Polish & Integration Testing** - Cross-platform testing and edge case handling

## Phase Details

### Phase 1: Offline Mode
**Goal**: Widget gracefully handles network unavailability by displaying cached usage data with freshness indicator
**Depends on**: Nothing (first phase)
**Requirements**: OFFL-01, OFFL-02, OFFL-03, OFFL-04
**Success Criteria** (what must be TRUE):
  1. User sees cached usage data (progress bars, timers, charts) when network is unavailable instead of error screen
  2. User sees "Last updated X ago" freshness indicator when viewing cached data
  3. Widget automatically resumes live data fetching within 5 minutes when network connectivity returns
  4. Latest usage data is preserved across app restarts (persisted cache)
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 2: Launch at Startup
**Goal**: User can configure widget to launch automatically at system login
**Depends on**: Phase 1
**Requirements**: STRT-01, STRT-02, STRT-03, STRT-04
**Success Criteria** (what must be TRUE):
  1. User can toggle "Launch at startup" checkbox in tray menu or settings
  2. Launch at startup is OFF by default when user first installs widget (opt-in)
  3. Startup preference persists across app restarts and widget updates
  4. Widget launches at system login when enabled on macOS, Windows, and Linux
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 3: Auto-Updates
**Goal**: Widget automatically checks for new versions and prompts user to install updates
**Depends on**: Phase 2
**Requirements**: UPDT-01, UPDT-02, UPDT-03, UPDT-04
**Success Criteria** (what must be TRUE):
  1. Widget checks GitHub Releases for new versions every 12 hours without user intervention
  2. User sees update notification (tray tooltip or in-widget banner) when new version is available
  3. User can dismiss update notification without being nagged again for the same version
  4. Update notification displays version number and includes actionable "Download" or "View Release" link
  5. Widget restarts with new version after user approves update installation
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 4: Polish & Integration Testing
**Goal**: All v1.4 features work reliably across platforms with proper error handling
**Depends on**: Phase 3
**Requirements**: None (quality assurance phase)
**Success Criteria** (what must be TRUE):
  1. All features work correctly on macOS, Windows, and Linux (packaged builds tested)
  2. Offline mode + auto-update interaction is handled gracefully (no conflicts during update download)
  3. Launch at startup + update check interaction works (no double-launch or race conditions)
  4. Edge cases handled: stale cache past session reset, network flapping, failed update download
  5. No regressions in existing features (usage display, timers, charts, login flow)
**Plans**: TBD

Plans:
- [ ] TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Offline Mode | 0/0 | Not started | - |
| 2. Launch at Startup | 0/0 | Not started | - |
| 3. Auto-Updates | 0/0 | Not started | - |
| 4. Polish & Integration Testing | 0/0 | Not started | - |

---
*Roadmap created: 2026-02-20*
