# Requirements: Claude Usage Widget v1.4

**Defined:** 2026-02-20
**Core Value:** Users can glance at their Claude usage limits at any time without opening a browser or interrupting their workflow.

## v1 Requirements

### Offline Mode

- [ ] **OFFL-01**: Widget caches latest usage data locally on every successful API fetch
- [ ] **OFFL-02**: Widget displays cached data when network is unavailable instead of showing an error
- [ ] **OFFL-03**: Widget shows "Last updated X ago" freshness indicator when displaying cached data
- [ ] **OFFL-04**: Widget automatically resumes fetching live data when network connectivity returns

### Auto-Updates

- [ ] **UPDT-01**: Widget checks for new versions on GitHub Releases periodically (every 12 hours)
- [ ] **UPDT-02**: Widget notifies user via tray or in-widget prompt when a new version is available
- [ ] **UPDT-03**: User can dismiss the update notification without being nagged again for the same version
- [ ] **UPDT-04**: Update notification includes version number and link to download

### Launch at Startup

- [ ] **STRT-01**: User can toggle "Launch at startup" in widget settings or tray menu
- [ ] **STRT-02**: Launch at startup is off by default (opt-in)
- [ ] **STRT-03**: Startup preference persists across app restarts
- [ ] **STRT-04**: Widget launches at system login when enabled (macOS, Windows, Linux)

## v2 Requirements

### Offline Mode Enhancements

- **OFFL-05**: Color-coded staleness indicator (green/yellow/red based on data age)
- **OFFL-06**: Countdown timers continue running offline using cached reset times
- **OFFL-07**: Exponential backoff retry when offline (5min, 10min, 30min)

### Auto-Update Enhancements

- **UPDT-05**: Auto-download update in background and install on user approval
- **UPDT-06**: Show changelog/release notes before installing
- **UPDT-07**: Code signing for macOS and Windows builds

## Out of Scope

| Feature | Reason |
|---------|--------|
| Silent auto-install updates | User should control when app restarts |
| Offline data sync | Usage data is read-only from API; nothing to sync |
| Force update mechanism | Breaks user trust; badge notification is sufficient |
| Multi-channel updates (beta/stable) | Overkill for current user base |
| Offline usage projection | Niche feature, adds complexity |
| Startup delay configuration | Unnecessary; OS handles timing |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OFFL-01 | Phase 1 | Pending |
| OFFL-02 | Phase 1 | Pending |
| OFFL-03 | Phase 1 | Pending |
| OFFL-04 | Phase 1 | Pending |
| STRT-01 | Phase 2 | Pending |
| STRT-02 | Phase 2 | Pending |
| STRT-03 | Phase 2 | Pending |
| STRT-04 | Phase 2 | Pending |
| UPDT-01 | Phase 3 | Pending |
| UPDT-02 | Phase 3 | Pending |
| UPDT-03 | Phase 3 | Pending |
| UPDT-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-02-20 after roadmap creation*
