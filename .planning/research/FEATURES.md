# Feature Research

**Domain:** Electron desktop widget enhancements
**Researched:** 2026-02-20
**Confidence:** MEDIUM (based on Electron ecosystem patterns; web research tools unavailable)

## Research Methodology Note

Web research tools (WebSearch, WebFetch, Brave API) were unavailable for this research. Findings are based on:
- Training data knowledge of Electron ecosystem (current to January 2025)
- Industry standards for desktop widget applications
- Common patterns in production Electron apps (VS Code, Slack, Discord, etc.)

**Recommendation:** Verify specific implementation details against current Electron documentation (electronjs.org) before implementation.

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Cached data when offline** | Desktop apps should work without network; showing "Login Required" on network drop is jarring | LOW | Cache latest API response in electron-store; show with "Last updated X ago" |
| **Network status indicator** | Users need to know if data is live or stale | LOW | Show subtle indicator when offline or data is stale |
| **Auto-reconnect on network restore** | App should resume fetching without user action when network returns | LOW | Listen for Electron `online` event, trigger refresh |
| **Update available notification** | Users expect desktop apps to self-update; manual downloads feel broken | MEDIUM | Notification in tray or widget; link to download or one-click install |
| **Download + install update** | Users shouldn't have to visit GitHub manually | MEDIUM | electron-updater handles download, checksum verification, and install |
| **Launch at system startup toggle** | Common desktop widget feature; users expect it in settings | LOW | app.setLoginItemSettings() with toggle in settings UI |
| **Offline graceful degradation** | Widget should show something useful, not error/blank screen | LOW | Show last-known data with clear staleness indicator |
| **Update restart prompt** | Users need clear action to complete update ("Restart now" vs "Later") | LOW | Modal or tray notification with explicit choices |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Graceful countdown continuation** | Continue countdown timers offline using cached reset times; widget remains useful even offline | LOW | Timers already calculate from resets_at; just need cached values |
| **Stale data age indicator** | Color-coded freshness (green < 10min, yellow < 30min, red > 30min) | LOW | Visual cue beyond plain text timestamp |
| **Update changelog display** | Show what's new before installing; builds trust in updates | LOW | Fetch release notes from GitHub API or parse from releases |
| **Background update download** | Download update without interrupting widget usage | LOW | electron-updater does this by default |
| **Smart update timing** | Defer update restart during active usage periods; only prompt when widget idle | MEDIUM | Check window focus, last interaction time; VS Code pattern |
| **Offline usage projection** | Show "estimated time until limit" based on cached 7-day history, even offline | MEDIUM | Calculate rate from history; clearly labeled as estimate |
| **Exponential backoff retry** | Intelligent retry on network failure (5min, 10min, 30min) vs hammering API | LOW | Prevents API overload, better UX than constant retries |
| **Bandwidth-aware updates** | Skip auto-download on metered connections (mobile hotspots) | LOW | Check network type; offer manual download option |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Silent auto-install updates** | "Just keep it updated" | App restarts without warning; user loses widget view mid-work; version changes may break session | Prompt before install; install on next manual restart; smart timing |
| **Offline data sync/conflict resolution** | "Keep data consistent" | Usage data is read-only from API; no writes to sync; adds complexity for no benefit | Simple cache replacement on successful fetch |
| **Persistent offline queue** | "Queue refreshes for when online" | Refreshes are idempotent GET requests; queuing adds complexity without value | Just retry on network restore with backoff |
| **Force update mechanism** | "Ensure users are on latest" | Aggressive update prompts annoy users; breaks trust; support burden if users resist | Show persistent badge; make updates compelling via changelog |
| **Fully offline mode** | "Work without internet" | Widget's entire purpose is live API data; offline = no new data; creates false expectations | Show cached data + clear timestamp; explain API dependency |
| **Manual update checks** | "Let me control updates" | Creates version fragmentation; users delay critical security updates | Auto-check with smart timing + manual "Update now" option for impatient users |
| **Update opt-out** | "I don't want updates" | Security risk; support burden (old versions with known bugs) | Make updates mandatory but respectful of timing |
| **Startup delay configuration** | "Wait N seconds after login" | Unnecessary complexity; OS handles startup timing; users don't actually need this | Focus on fast launch (< 1s) instead |

## Feature Dependencies

```
[Offline Mode Foundation]
    └──> Network status detection (navigator.onLine + events)
            ├──> Offline data caching (electron-store)
            │       ├──> Stale data indicator
            │       ├──> Graceful countdown continuation
            │       └──> Offline usage projection
            │
            └──> Auto-reconnect logic
                    └──> Exponential backoff retry

[Auto-Update Foundation]
    └──> electron-updater setup
            ├──> electron-builder publish config (GitHub Releases)
            │
            ├──> Update notification
            │       ├──> Update changelog display
            │       └──> Restart prompt
            │
            ├──> Background download
            │       └──> Bandwidth-aware checks
            │
            └──> Smart update timing
                    └──> Activity detection

[Launch at Startup] ── independent ── (no dependencies)
```

### Dependency Notes

- **Offline caching requires network detection:** Must know when offline to show cached data vs live data
- **Auto-update requires electron-builder publish config:** GitHub Releases provider must be configured in package.json build section
- **Smart timing depends on auto-update framework:** Can't optimize update timing without having updates first
- **Offline projection depends on cached history:** Already have 7-day history; need to extend caching to survive offline periods
- **Launch at startup is fully independent:** Can be built in any order; no dependencies on other features

## MVP Definition

### Launch With (v1.4.0 - First Enhanced Release)

**Priority 1 - Launch at Startup:**
- app.setLoginItemSettings() integration
- Settings toggle in tray menu ("Launch at startup")
- Cross-platform testing (macOS, Windows, Linux)
- Persist setting in electron-store

**Priority 2 - Auto-Update Foundation:**
- electron-updater integration (not built-in autoUpdater)
- GitHub Releases as publish target (already used for distribution)
- Silent background update checks (every 12 hours)
- "Update downloaded, restart to apply" tray notification
- "Restart now" vs "Later" options
- Graceful handling of update failures (log, don't crash)
- Code signing setup (macOS required, Windows recommended)

**Priority 3 - Basic Offline Mode:**
- Online/offline event detection (navigator.onLine + events)
- Cache latest API response in electron-store
- Show cached data when offline with "Last updated X minutes ago, offline" indicator
- Offline indicator in UI (subtle icon or status text)
- Tray icon shows "Offline" state
- Auto-retry on reconnect with 5-minute initial retry

**What to exclude from v1.4.0:**
- Smart update timing (ship with simple background checks first)
- Offline usage projection (validate offline mode usage first)
- Bandwidth-aware updates (edge case, add if requested)
- Release notes display (nice-to-have, not critical)
- Exponential backoff retry (start with fixed 5-minute retry)
- Stale data color coding (start with simple timestamp)

### Add After Validation (v1.5.x)

**If users actively use offline mode:**
- Stale data color coding (green/yellow/red freshness)
- Offline usage projection based on 7-day history
- Enhanced offline error messaging (differentiate network vs API vs auth)
- Exponential backoff retry logic (5min → 10min → 30min)
- Graceful countdown timer continuation offline

**If update adoption is slow:**
- Smart update timing (defer during active usage)
- Release notes display in notification before restart
- "Update now" manual trigger option in tray
- Update progress indicator (for slow connections)

**If user feedback indicates need:**
- Bandwidth-aware update downloads (skip on metered)
- Startup performance profiling and optimization
- Update check frequency setting (user-configurable interval)

### Future Consideration (v2.0+)

**High complexity, validate need first:**
- Update rollback mechanism (requires crash detection, version management)
- Delta updates (requires custom infrastructure or advanced electron-builder config)
- Update channel selection (requires separate release pipeline - stable/beta/nightly)
- Offline-first architecture refactor
- Multi-account offline caching
- Platform-specific enhancements (Notification Center, Action Center)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Rationale |
|---------|------------|---------------------|----------|-----------|
| Launch at Startup | High (set-and-forget) | Low (single API) | **P0** | Table stakes, trivial implementation |
| Auto-Update (Basic) | High (security, bugs) | Medium (electron-updater) | **P0** | Table stakes, medium effort but critical |
| Offline Cached Data | High (reliability) | Low (extend electron-store) | **P0** | Table stakes, mostly done |
| Offline Indicator UI | High (clarity) | Low (UI only) | **P0** | Table stakes, simple addition |
| Update Notification | High (transparency) | Low (tray API) | **P0** | Table stakes, simple |
| Auto-Reconnect | High (UX) | Low (event handler) | **P0** | Table stakes, seamless recovery |
| Network Error Messaging | Medium (UX polish) | Low (error handling) | **P1** | Quality-of-life |
| Basic Retry Logic | Medium (resilience) | Low (setTimeout) | **P1** | Quality-of-life |
| Stale Data Indicator | Medium (UX) | Low (timestamp + UI) | **P2** | Polish, defer to v1.5 |
| Smart Update Timing | Medium (respectful UX) | Medium (activity detection) | **P2** | Differentiator, can wait |
| Offline Usage Projection | Low (edge case) | Medium (calculation) | **P2** | Differentiator, niche |
| Release Notes Display | Low (nice-to-have) | Low (parsing) | **P3** | Polish |
| Bandwidth-Aware Updates | Low (edge case) | Low (network API) | **P3** | Edge case |
| Exponential Backoff | Low (optimization) | Low (backoff logic) | **P3** | Start with fixed retry |
| Startup Performance | Low (already fast) | Medium (profiling) | **P3** | Premature optimization |
| Update Rollback | Low (rare crashes) | High (complex) | **P4** | Over-engineering |
| Delta Updates | Low (app is small) | High (infrastructure) | **P4** | Over-engineering |

**Priority key:**
- P0: Must have for v1.4.0 (MVP)
- P1: Should have for v1.4.0 (quality)
- P2: Add in v1.5.x after validation
- P3: Nice to have, future consideration
- P4: Likely over-engineering, only if clear demand

## Implementation Complexity Breakdown

### Low Complexity (< 1 day each)
- Launch at startup toggle
- Offline indicator UI
- Update notification (tray)
- Basic network error messaging
- Fixed-interval retry logic
- Offline data caching (extend existing)
- Auto-reconnect on network restore
- Release notes display
- Bandwidth-aware checks

### Medium Complexity (2-4 days each)
- Auto-update integration (electron-updater + testing)
- Code signing setup (macOS + Windows)
- Offline graceful degradation (UI states)
- Smart update timing (activity detection)
- Offline usage projection (calculation + UI)
- Exponential backoff retry
- Startup performance optimization

### High Complexity (1+ weeks)
- Update rollback mechanism
- Delta updates
- Offline-first architecture refactor
- Custom update server
- Multi-channel update system

## User Experience Scenarios

### Scenario 1: First-Time User Setup
1. User downloads and launches widget (v1.4.0)
2. Logs in, sees usage data
3. Opens tray menu, sees "Launch at startup" toggle (unchecked)
4. User enables → setting saved to electron-store
5. Next boot → widget starts automatically with OS
6. 12 hours later → background update check runs
7. Update downloaded silently in background
8. Tray notification: "Update ready, restart to apply" with "Restart now" / "Later" buttons
9. User clicks "Restart now" → widget restarts with new version
10. Widget opens to same position, credentials retained

**Expected:** Zero friction, transparent, user in control.

### Scenario 2: Network Outage During Active Use
1. User viewing widget (usage stats visible)
2. Network drops (Wi-Fi disconnect)
3. Widget detects offline via `navigator.onLine` event
4. UI shows: "Offline - Last updated 2 minutes ago"
5. Last-known data still visible (progress bars, percentages, 7-day chart)
6. Countdown timers continue (client-side calculation from cached resets_at)
7. Tray icon updates to "Offline - Last updated 2 minutes ago"
8. After 5 minutes → automatic retry (fails, still offline)
9. Network reconnects
10. Widget detects online event, retries immediately
11. API fetch succeeds, UI updates with fresh data
12. Offline indicator disappears

**Expected:** No crash, no error modal, graceful degradation, seamless recovery.

### Scenario 3: Update During Active Monitoring
1. User actively monitoring usage during Claude work session
2. Background check (12-hour interval) finds v1.4.1 available
3. Update downloads silently (no interruption to UI)
4. Download completes → tray notification appears: "Update ready, restart to apply"
5. User busy, clicks "Later"
6. Notification dismissed, badge remains on tray icon
7. User finishes work 2 hours later
8. Clicks tray icon, sees "Update pending - Click to restart"
9. User clicks → quick restart
10. Widget reopens with v1.4.1, shows usage data immediately

**Expected:** Respectful timing, user controls when to restart, no data loss.

### Scenario 4: Offline Mode with Stale Data (v1.5+)
1. User goes offline for extended period (hours)
2. Widget shows cached data with increasing staleness
3. "Last updated 45 minutes ago" → timestamp turns yellow (30+ min)
4. Countdown timers continue accurately (calculated from cached resets_at)
5. 7-day history chart shows last-known data with "(offline)" label
6. Tray shows "Offline - Data from 45 minutes ago"
7. User hovers over usage percentage → tooltip: "Offline estimate based on 45 minutes ago"
8. Network returns → data refreshes → colors return to normal

**Expected:** Always useful, clear about limitations, no false confidence.

## Cross-Platform Considerations

| Feature | macOS | Windows | Linux | Notes |
|---------|-------|---------|-------|-------|
| Launch at Startup | Native (Login Items) | Native (Registry) | XDG autostart | `app.setLoginItemSettings()` handles all platforms |
| Auto-Update | Supported | Supported | AppImage only | electron-updater supports GitHub Releases; Linux varies by package format |
| Update Signing | Required (notarization) | Recommended (SmartScreen) | N/A | macOS blocks unsigned updates; Windows warns |
| Offline Detection | Reliable | Reliable | Reliable | `navigator.onLine` works everywhere |
| Tray Icons | Template .png | .ico format | .png | Already handled in project architecture |
| Notification Style | Notification Center | Action Center | Desktop notifications | OS-specific appearance |

## Security Considerations

| Feature | Security Implication | Mitigation |
|---------|---------------------|------------|
| Auto-Update | Attack vector if not signed | Code signing (macOS required, Windows recommended); HTTPS + signature verification |
| Launch at Startup | Persistence mechanism | User-controlled toggle, clear permission in settings |
| Offline Caching | Stale credentials persisted | Already encrypted via electron-store; add expiry checks |
| Update Downloads | MITM attacks | HTTPS + signature verification via electron-updater; GitHub CDN trusted |
| Network Detection | False sense of security | Don't assume online = API reachable; still handle API errors independently |
| Cached Session Keys | Exposure risk | Encrypt with electron-store (already done); add 30-day expiry check |

## Performance Considerations

| Feature | Performance Impact | Optimization |
|---------|-------------------|--------------|
| Launch at Startup | +0.5-1s OS boot time | Acceptable for widgets; optimize main process init time |
| Auto-Update Check | ~500KB download check | Run on background thread; 12-hour interval (low frequency) |
| Offline Detection | Negligible (event-based) | Use built-in events, don't poll |
| Cached Data | Negligible (already exists) | electron-store is fast; no additional overhead |
| Update Download | 50-80MB (full app) | Show progress on slow connections; allow cancel |
| Network Retry | Minimal (single setTimeout) | Fixed 5-minute interval initially; exponential backoff in v1.5 |

## Accessibility Considerations

| Feature | Accessibility Need | Implementation |
|---------|-------------------|----------------|
| Offline Indicator | Screen reader announcement | ARIA live region for status changes: "Now offline, showing cached data" |
| Update Notification | Keyboard navigation | Focus management in notification modal; Enter/Escape shortcuts |
| Launch Settings | Clear labeling | Descriptive checkbox: "Launch widget automatically when I log in" |
| Network Errors | Non-visual indication | Status text, not just icon color changes; clear error messages |
| Stale Data Warning | Color-blind safe | Use icons + text, not color alone (red/yellow/green with symbols) |

## Testing Requirements

### Launch at Startup
- [ ] macOS: Verify Login Items entry in System Preferences
- [ ] Windows: Verify Registry entry at `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- [ ] Linux: Verify XDG autostart desktop file at `~/.config/autostart/`
- [ ] Toggle on/off multiple times, verify persistence
- [ ] Test setting survives app restart
- [ ] Test with clean install (default off)
- [ ] Test with upgrade from v1.3.x (preserve user choice if setting exists)

### Auto-Update
- [ ] Mock GitHub Releases with test versions (v1.4.0-beta1, v1.4.0-beta2)
- [ ] Verify update check runs on schedule (12-hour interval)
- [ ] Test update download + notification flow
- [ ] Test "Restart now" vs "Later" options
- [ ] Test restart and version verification (app.getVersion())
- [ ] Test failed update scenarios:
  - Network error during download
  - Invalid signature (if signed)
  - Corrupted download (checksum mismatch)
  - GitHub API rate limit
- [ ] Test "no update available" path (already on latest)
- [ ] Code signing verification:
  - macOS: Verify notarization with `spctl -a -vvv -t install`
  - Windows: Verify signature with `signtool verify /pa /v`
- [ ] Test with firewall/proxy (corporate environments)
- [ ] Test manual update check trigger (if implemented)

### Offline Mode
- [ ] Simulate network disconnect (disable Wi-Fi at OS level)
- [ ] Verify cached data displays correctly
- [ ] Verify offline indicator appears in UI and tray
- [ ] Test reconnect and auto-retry flow
- [ ] Test different error types:
  - Network completely down (no internet)
  - API down (internet works, Claude API unreachable)
  - Auth error (expired session key)
- [ ] Test partial failures (1 of 3 endpoints fails)
- [ ] Test countdown timer continuation during offline
- [ ] Test 7-day chart display with offline label
- [ ] Test data staleness indicators at different ages:
  - < 10 minutes (fresh)
  - 10-30 minutes (aging)
  - 30+ minutes (stale)
- [ ] Test reconnect after long offline period (hours)
- [ ] Test rapid offline/online toggling (flaky connection)

### Cross-Feature Integration
- [ ] Launch at startup + auto-update (update check on startup)
- [ ] Offline mode + auto-update (defer update check until online)
- [ ] Offline mode + launch at startup (widget starts offline, reconnects gracefully)

## Feature Flags and Configuration

Recommended config structure for gradual rollout:

```typescript
// Store in electron-store
interface FeatureConfig {
  autoUpdate: {
    enabled: boolean;              // Master switch (default: true)
    checkIntervalHours: number;    // Default: 12
    allowMeteredDownloads: boolean; // Default: false
  };
  offline: {
    enabled: boolean;              // Master switch (default: true)
    retryIntervalMinutes: number;  // Default: 5
    staleWarningMinutes: number;   // Default: 30
  };
  startup: {
    launchOnLogin: boolean;        // User preference (default: false)
  };
}
```

Benefits:
- Disable auto-update remotely if server issues (via config file in releases)
- A/B test different retry intervals
- Emergency kill switch for problematic features
- User preferences persist across updates

## Documentation Requirements

### User-Facing (in app or help docs)
- **Update notification explanation:** "Why do I need to restart?"
  - "Updates are applied during restart to ensure data integrity and prevent crashes."
- **Launch at startup permission:** "What does this setting do?"
  - "Widget starts automatically when you log in, so usage data is always available."
- **Offline mode behavior:** "What happens when I'm offline?"
  - "Widget shows your last-known usage data with a timestamp. Countdown timers continue based on cached reset times. Data refreshes automatically when connection returns."
- **Troubleshooting: "Updates not working"**
  - Check internet connection
  - Check firewall/proxy settings
  - Manual download from GitHub Releases as fallback

### Developer-Facing (CONTRIBUTING.md or wiki)
- electron-updater configuration in package.json
- GitHub Releases publishing workflow (CI/CD)
- Code signing setup:
  - macOS: Apple Developer account, notarization process
  - Windows: Code signing certificate providers, signtool usage
- Testing update flow locally (mock releases server)
- Rollback procedure if update breaks production:
  - Remove broken release from GitHub Releases
  - Publish hotfix with incremented version
- Testing offline mode (network simulation)

## Metrics to Track (Post-Launch)

**Auto-Update Metrics:**
- Update adoption rate (% users on latest version after 7/14/30 days)
- Time to 90% adoption
- Update failure rate (by failure type: network, signature, corruption)
- "Restart later" dismissal rate (users deferring updates)
- Average time between update notification and restart

**Offline Mode Metrics:**
- Offline session frequency (% of sessions that go offline)
- Offline session duration (average time spent offline)
- Cached data staleness at reconnect (how old was data when went online)
- Retry success rate (% of retries that succeeded)

**Launch at Startup Metrics:**
- Enablement rate (% users who enable startup launch)
- Startup time (P50, P95, P99 latency from login to widget ready)
- Startup failures (crashes during early init)

**User Engagement:**
- Active users (DAU/WAU/MAU)
- Widget interaction frequency (how often users open/focus widget)
- Tray menu usage (which options are clicked most)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Auto-update breaks app | Medium | High | Thorough testing; code signing; GitHub Releases rollback capability; phased rollout |
| Update server overload | Low | Medium | GitHub Releases CDN handles scale; no custom server needed |
| Launch at startup annoys users | Low | Low | Make it opt-in (default off); clear toggle in settings with descriptive text |
| Offline mode confuses users | Medium | Low | Clear messaging: "Last updated X ago, offline"; visual indicators; documentation |
| Update notification spam | Low | Medium | Check once per 12 hours max; single notification per update; dismiss option |
| Code signing cost | N/A | Medium | macOS requires paid Apple Developer ($99/year); Windows code signing cert ~$200-500/year |
| False offline detection | Low | Medium | Test `navigator.onLine` reliability; add timeout-based fallback detection |
| Update download failures | Medium | Low | Retry logic; clear error messages; manual download fallback |
| Startup launch slows boot | Low | Low | Optimize init time; defer non-critical operations; measure performance |

## Open Questions for Implementation Phase

1. **Update check interval:** 6 hours vs 12 hours vs 24 hours?
   - **Recommendation:** 12 hours (balance between freshness and API load)

2. **Startup launch default:** Enabled by default or opt-in?
   - **Recommendation:** Opt-in (default off) - less intrusive, user explicitly chooses

3. **Offline retry frequency:** Fixed 5 min vs exponential backoff from start?
   - **Recommendation:** Start with fixed 5-minute retry in v1.4; add exponential backoff in v1.5 if needed

4. **Update notification persistence:** Auto-dismiss or stay until clicked?
   - **Recommendation:** Stay until clicked (important for security updates); show badge on tray icon

5. **Cached data expiry warning:** How old before showing "stale" warning?
   - **Recommendation:** 30 minutes (2x the max refresh interval of 20 min)

6. **Code signing:** Ship unsigned initially or require from v1.4.0?
   - **Recommendation:** Require from v1.4.0 (macOS blocks unsigned updates; Windows triggers SmartScreen warnings)

7. **Update restart timing:** Immediate or deferred until next manual launch?
   - **Recommendation:** User choice ("Restart now" vs "Later"); smart timing in v1.5+

8. **Offline indicator placement:** Inline in widget or separate status bar?
   - **Recommendation:** Both - inline timestamp text + tray icon status update

## Competitive Analysis Reference

**Common patterns in production desktop widgets:**

**Launch at Startup:**
- Nearly universal in widgets (Bartender, iStat Menus, MenuBar Stats)
- Always user-configurable via settings toggle
- Default varies: system monitors often default ON, others default OFF

**Auto-Updates:**
- 90%+ of modern Electron apps use auto-update
- Silent background checks are standard (Slack, Discord, VS Code)
- Manual-only updates are rare (legacy apps, corporate environments)
- "Download automatically, install on restart" is dominant pattern

**Offline Mode:**
- API monitoring widgets: Show cached data + offline indicator (standard)
- Productivity tools: Full offline mode with sync (complex, not applicable here)
- Weather/stock widgets: Similar pattern to this project (cached + timestamp)

**Update UX Patterns:**
- "Update downloaded, restart to apply" with choice (VS Code, Slack)
- Forced immediate restart (rare, unpopular - Microsoft Teams)
- Auto-restart after download (very rare, very intrusive)
- Smart timing (VS Code: defer during active editing)

## Sources

**Source Type:** Training data (Electron ecosystem knowledge current to January 2025)

**Confidence:** MEDIUM
- High confidence in Electron API patterns (stable, well-documented)
- Medium confidence in current best practices (may have evolved since January 2025)
- Low confidence in specific library versions or recent updates

**Verification Recommended Before Implementation:**
- Official Electron documentation (electronjs.org/docs/latest/)
- electron-updater documentation (github.com/electron-userland/electron-builder)
- Platform-specific auto-update requirements:
  - Apple notarization process (developer.apple.com)
  - Windows SmartScreen behavior (docs.microsoft.com)
- Current GitHub Releases best practices for electron-builder

**Key Knowledge Gaps Due to Unavailable Research Tools:**
- Specific electron-updater configuration changes in 2026
- New Electron API changes post-January 2025
- Community best practices evolved since training data cutoff
- Competitive analysis of similar widgets launched in 2025-2026
- Current code signing certificate costs and providers

---

*Feature research for: Electron desktop widget enhancements (offline mode, auto-updates, launch-at-startup)*
*Researched: 2026-02-20*
*Methodology: Training data analysis (web research tools unavailable)*
*Confidence: MEDIUM (verify implementation details against current official documentation)*
