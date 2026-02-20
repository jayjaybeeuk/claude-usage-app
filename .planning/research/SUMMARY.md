# Research Summary: Electron Desktop Widget Enhancements

**Domain:** Electron desktop widget enhancements (offline mode, auto-updates, launch-at-startup)
**Researched:** 2026-02-20
**Overall Confidence:** MEDIUM (based on Electron ecosystem patterns; web research tools unavailable)

## Executive Summary

This research covers three enhancement areas for the Claude Usage Widget: **offline mode** (cached data when network unavailable), **auto-updates** (background update checking via electron-updater), and **launch-at-startup** (OS-level autostart). All three are table stakes for modern desktop widgets and can be implemented with minimal new dependencies.

**Key takeaway:** All features use existing Electron APIs or extend the current electron-store setup. The main complexity is in auto-update code signing requirements (macOS requires Apple Developer account, Windows recommended for avoiding SmartScreen warnings). Implementation order should be: offline mode (extends existing API fetching) → launch at startup (independent, simple) → auto-updates (most infrastructure, benefits from offline handling).

**Critical requirement:** Code signing setup must happen before v1.4.0 ships, or auto-updates won't work on macOS and will trigger warnings on Windows.

## Key Findings

### Stack Recommendations

**New Dependencies (Auto-Update Only):**
- **electron-updater** v6.x — Auto-update framework (bundled with electron-builder 26.7.0+)
- **electron-log** v5.x (optional) — Structured logging for debugging update flows

**Existing Dependencies (Extend):**
- **electron-store** v10.0.0 (already installed) — Add offline cache fields
- **Electron** v33.x (already installed) — Built-in APIs: `app.setLoginItemSettings()`, `navigator.onLine` events

**No Dependencies Needed:**
- Launch at startup: Built-in `app.setLoginItemSettings()` API
- Network detection: Built-in `navigator.onLine` + online/offline events

**Confidence:** HIGH (Electron APIs are stable; electron-updater is industry standard)

### Architecture Integration

**All new logic lives in main process:**
- **Cache manager** — Writes latest API response to electron-store on success, reads on network failure
- **Auto-updater** — Sets up electron-updater with GitHub Releases provider, emits IPC events to renderer
- **Startup manager** — Wraps `app.setLoginItemSettings()`, persists user preference in electron-store

**Renderer adds UI only:**
- Offline indicator ("Last updated X ago, offline")
- Update notification modal/tray ("Update ready, restart to apply" with "Restart now"/"Later")
- Startup toggle in settings (checkbox in tray menu)

**Cache-through pattern:**
```
Fetch API → Success? → Update UI + Write Cache
         → Failure? → Read Cache + Show Offline Indicator
```

**Event-driven updates:**
```
autoUpdater.on('update-available') → IPC → Renderer shows "Downloading..."
autoUpdater.on('update-downloaded') → IPC → Renderer shows "Restart to apply"
```

**No new files needed:** All features integrate into existing `src/main/main.ts`, `src/renderer/app.ts`, and `src/shared/` types.

**Confidence:** HIGH (patterns match existing architecture)

### Table Stakes Features (Must-Have for v1.4.0)

| Feature | Why Table Stakes | Complexity | Implementation Time |
|---------|------------------|------------|---------------------|
| **Cached data when offline** | Desktop apps should work without network; showing error on network drop is poor UX | LOW | 1 day |
| **Network status indicator** | Users need to know if data is live or stale | LOW | < 1 day |
| **Auto-reconnect on restore** | App should resume fetching when network returns | LOW | < 1 day |
| **Update notification** | Users expect desktop apps to self-update | MEDIUM | 2-3 days |
| **Download + install update** | Users shouldn't visit GitHub manually | MEDIUM | Included with above |
| **Launch at startup toggle** | Common widget feature, users expect it | LOW | 1 day |

**Total MVP effort:** ~5-7 days for all table stakes features.

### Differentiator Features (Add in v1.5+ After Validation)

| Feature | Value Proposition | When to Add |
|---------|-------------------|-------------|
| **Graceful countdown continuation** | Timers keep running offline using cached reset times | v1.5 if offline mode sees active use |
| **Stale data color coding** | Green/yellow/red freshness indicators | v1.5 for UX polish |
| **Update changelog display** | Show release notes before install | v1.5 if update adoption slow |
| **Smart update timing** | Defer restart during active usage | v1.5+ if users complain about interruptions |
| **Offline usage projection** | Estimate time until limit based on 7-day history | v2.0+ (niche feature) |

**Recommendation:** Ship v1.4.0 with table stakes only. Add differentiators based on user feedback and metrics.

### Anti-Features (Do NOT Build)

| Anti-Feature | Why NOT to Build | Alternative |
|--------------|------------------|-------------|
| **Silent auto-install** | Restarts app without warning; breaks user trust | "Restart now"/"Later" prompt with smart timing |
| **Offline data sync** | Usage data is read-only; no writes to sync | Simple cache replacement |
| **Force update** | Aggressive prompts annoy users | Persistent badge + compelling changelog |
| **Manual update checks** | Creates version fragmentation | Auto-check with manual "Update now" option |

### Critical Pitfalls and Mitigations

**1. Code Signing (CRITICAL)**
- **Pitfall:** macOS blocks unsigned auto-updates; Windows shows SmartScreen warnings
- **Impact:** Auto-updates don't work on macOS; users see scary warnings on Windows
- **Mitigation:** Set up code signing BEFORE v1.4.0 ships
  - macOS: Apple Developer account ($99/year), notarization process
  - Windows: Code signing certificate (~$200-500/year), signtool

**2. Stale Cache Past Session Reset**
- **Pitfall:** Cached data may show pre-reset utilization after 5-hour session reset
- **Impact:** Users see incorrect usage percentages when offline across reset boundary
- **Mitigation:** Cache `resets_at` timestamps; show staleness warning > 30 minutes; countdown timers stay accurate

**3. setLoginItemSettings() Dev Mode**
- **Pitfall:** Launch at startup only works in packaged builds, not `npm run dev`
- **Impact:** Can't test startup behavior during development
- **Mitigation:** Test in packaged builds (`npm run package`); document limitation

**4. GitHub Releases Publishing**
- **Pitfall:** electron-updater only finds published releases, not drafts
- **Impact:** Users won't see update notification for draft releases
- **Mitigation:** Always publish releases (use pre-releases for beta testing)

**5. Update Download Network Conflicts**
- **Pitfall:** Large update downloads may interfere with 5-minute API fetches
- **Impact:** Widget may appear offline during update download
- **Mitigation:** Defer API fetches during active download, or use `autoDownload: false` and trigger manually

**6. electron-store Schema Changes**
- **Pitfall:** Adding cache fields may break existing data structure
- **Impact:** Widget crashes on startup if electron-store schema validation fails
- **Mitigation:** Add cache fields to separate key (`cachedUsageData`); implement migration if needed

**Confidence:** HIGH (these are well-known Electron pitfalls from training data and production experience)

## Implications for Roadmap

### Recommended Phase Structure

**Phase 1: Offline Mode (v1.4.0-alpha1) — 2-3 days**
- Extend electron-store with cache fields
- Cache latest API response on successful fetch
- Read cache on network failure
- Show "Last updated X ago, offline" indicator
- Auto-reconnect on network restore (5-minute retry)

**Why first:** Extends existing API fetching logic; immediate user value; no external dependencies.

**Phase 2: Launch at Startup (v1.4.0-alpha2) — 1 day**
- Add startup toggle to tray menu
- Implement `app.setLoginItemSettings()` wrapper
- Persist preference in electron-store
- Test on all platforms (macOS, Windows, Linux)

**Why second:** Independent feature; simple implementation; builds confidence before complex auto-update.

**Phase 3: Auto-Updates (v1.4.0-beta1) — 3-5 days**
- Configure electron-updater with GitHub Releases provider
- Set up code signing (macOS + Windows)
- Implement update notification UI
- Add "Restart now"/"Later" flow
- Test update cycle (mock releases)

**Why third:** Most complex; benefits from offline mode already handling network issues; code signing is time-consuming.

**Phase 4: Polish & Testing (v1.4.0-rc1) — 2-3 days**
- Cross-platform testing (macOS, Windows, Linux)
- Integration testing (offline + auto-update, startup + update check)
- Error handling edge cases
- Documentation (user-facing + developer-facing)

**Total estimated time:** 8-12 days from start to v1.4.0 release.

### Phase Ordering Rationale

1. **Offline mode first** because it:
   - Extends existing API fetching (minimal new infrastructure)
   - Provides immediate user value (resilience to network issues)
   - Creates foundation for auto-update network handling

2. **Launch at startup second** because it:
   - Is completely independent (no dependencies on other features)
   - Is simple (builds team confidence)
   - Provides user value even if auto-updates delayed

3. **Auto-updates last** because it:
   - Is most complex (electron-updater setup, code signing, testing)
   - Benefits from offline mode already handling network failures
   - Requires external setup (Apple Developer account, code signing cert)

### Research Flags for Phases

**Phase 1 (Offline Mode):** LOW research risk
- Electron online/offline events are well-documented
- electron-store extension is straightforward
- Cache-through pattern is standard

**Phase 2 (Launch at Startup):** LOW research risk
- `app.setLoginItemSettings()` is built-in and stable
- Cross-platform behavior is well-documented
- Implementation is trivial

**Phase 3 (Auto-Updates):** MEDIUM research risk
- electron-updater configuration may have changed since training data (January 2025)
- Code signing processes evolve (Apple notarization requirements, Windows SmartScreen behavior)
- GitHub Releases publishing workflow may need updates
- **Recommendation:** Verify current electron-updater docs and code signing requirements before implementation

**Phase 4 (Testing):** LOW research risk
- Standard Electron testing practices apply
- Cross-platform testing is well-understood

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| **Stack** | HIGH | Electron APIs stable; electron-updater is industry standard; no experimental dependencies |
| **Features** | MEDIUM | Table stakes are clear from ecosystem patterns; differentiators need validation with users |
| **Architecture** | HIGH | Patterns match existing codebase; minimal new files; extends main/renderer separation |
| **Pitfalls** | HIGH | Well-known Electron pitfalls from production experience; mitigation strategies proven |
| **Implementation Details** | MEDIUM | Electron APIs stable, but electron-updater config may have changed; code signing processes evolve |

**Overall Confidence:** MEDIUM (high confidence in patterns and architecture; medium confidence in current library versions and platform requirements)

## Gaps to Address

### Before Implementation
1. **Verify current electron-updater configuration** (electronjs.org/docs/latest/api/auto-updater)
2. **Check Apple notarization requirements** (developer.apple.com) — may have changed since January 2025
3. **Verify Windows SmartScreen behavior** for unsigned vs signed apps
4. **Check current code signing certificate providers** and costs

### During Implementation
1. **Test navigator.onLine reliability** across platforms (known to have false positives)
2. **Measure update download impact** on API fetching (may need coordination)
3. **Profile startup time** with launch-at-startup enabled (ensure < 1s)

### After v1.4.0 Launch
1. **Monitor update adoption rate** (if slow, add smart timing or changelog display)
2. **Track offline mode usage** (if frequent, add stale data color coding and usage projection)
3. **Measure startup enablement rate** (if low, consider making it opt-out instead of opt-in)

## User Experience Priorities

**Most Important:**
- Offline mode shows cached data seamlessly (no jarring "Login Required" error)
- Updates never restart app without user consent
- Launch at startup is opt-in (doesn't surprise users)

**Nice to Have:**
- Stale data has visual freshness indicators
- Update notifications show changelog preview
- Smart timing defers updates during active usage

**Don't Need:**
- Offline data sync (no writes to sync)
- Force updates (breaks trust)
- Complex update channels (stable/beta/nightly)

## Success Criteria for v1.4.0

**Offline Mode:**
- [ ] Widget shows cached data when network unavailable
- [ ] "Last updated X ago, offline" indicator appears
- [ ] Auto-reconnect works within 5 minutes of network restore
- [ ] No crashes on network failure

**Launch at Startup:**
- [ ] Toggle appears in tray menu
- [ ] Setting persists across restarts
- [ ] Works on all platforms (macOS, Windows, Linux)
- [ ] No boot time regression (< 1s startup time)

**Auto-Updates:**
- [ ] Background check runs every 12 hours
- [ ] Update notification appears when new version available
- [ ] "Restart now"/"Later" flow works
- [ ] Widget restarts with new version on user approval
- [ ] Code signing works (no macOS block, no Windows warning)

**Quality:**
- [ ] All features tested cross-platform
- [ ] No regression in existing features
- [ ] Documentation complete (user + developer)
- [ ] Error handling covers edge cases

## Research Files

| File | Purpose | Key Findings |
|------|---------|--------------|
| [STACK.md](STACK.md) | Technology recommendations | electron-updater for auto-updates; built-in APIs for startup; extend electron-store for cache |
| [FEATURES.md](FEATURES.md) | Feature landscape, priorities, dependencies | 6 table stakes features, 5 differentiators, 4 anti-features; detailed user scenarios |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component design, integration points | Cache-through pattern; event-driven updates; all logic in main process |
| [PITFALLS.md](PITFALLS.md) | Critical mistakes, prevention | Code signing required; stale cache handling; dev mode limitations |

## Next Steps

1. **Verify research gaps** (electron-updater docs, code signing requirements)
2. **Set up code signing** (Apple Developer account, Windows cert) — longest lead time
3. **Start Phase 1: Offline Mode** (extends existing API fetching)
4. **Implement Phase 2: Launch at Startup** (quick win)
5. **Tackle Phase 3: Auto-Updates** (most complex, requires code signing)
6. **Run Phase 4: Cross-platform testing** (validate all platforms)

**Critical path:** Code signing setup (Apple Developer account approval can take days/weeks). Start immediately.

---

*Research summary for: Claude Usage Widget enhancements*
*Researched: 2026-02-20*
*Methodology: Training data analysis (web research tools unavailable)*
*Confidence: MEDIUM (verify implementation details against current official documentation)*
