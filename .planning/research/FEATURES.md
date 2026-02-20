# Feature Research

**Domain:** Electron desktop widget enhancements
**Researched:** 2026-02-20
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cached data when offline | Desktop apps should work without network; showing "Login Required" on network drop is jarring | LOW | Cache latest API response in electron-store; show with "Last updated X ago" |
| Network status indicator | Users need to know if data is live or stale | LOW | Show subtle indicator when offline or data is stale |
| Auto-reconnect on network restore | App should resume fetching without user action when network returns | LOW | Listen for Electron `online` event, trigger refresh |
| Update available notification | Users expect desktop apps to self-update; manual downloads feel broken | MEDIUM | Notification in tray or widget; link to download or one-click install |
| Download + install update | Users shouldn't have to visit GitHub manually | MEDIUM | electron-updater handles download, checksum verification, and install |
| Launch at system startup toggle | Common desktop widget feature; users expect it in settings | LOW | app.setLoginItemSettings() with toggle in settings UI |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Graceful degradation with countdown | Continue countdown timers offline using cached reset times | LOW | Timers already calculate from resets_at; just need cached values |
| Stale data age indicator | Color-coded freshness (green < 10min, yellow < 30min, red > 30min) | LOW | Visual cue beyond plain text timestamp |
| Update changelog display | Show what's new before installing; builds trust in updates | LOW | Fetch release notes from GitHub API |
| Background update download | Download update without interrupting widget usage | LOW | electron-updater does this by default |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Silent auto-install updates | "Just keep it updated" | App restarts without warning; user loses widget view mid-work; version changes may break session | Prompt before install; install on next manual restart |
| Offline data sync/conflict resolution | "Keep data consistent" | Usage data is read-only from API; no writes to sync; adds complexity for no benefit | Simple cache replacement on successful fetch |
| Persistent offline queue | "Queue refreshes for when online" | Refreshes are idempotent GET requests; queuing adds complexity without value | Just retry on network restore |
| Force update mechanism | "Ensure users are on latest" | Aggressive update prompts annoy users; breaks trust | Show update badge; let user choose when |

## Feature Dependencies

```
[Offline data caching]
    └──requires──> [Network status detection]
                       └──enables──> [Auto-reconnect on restore]

[Auto-update notification]
    └──requires──> [electron-updater setup]
                       └──requires──> [electron-builder publish config]
                       └──enables──> [Download + install update]
                                         └──enables──> [Update changelog display]

[Launch at startup] ──independent── (no dependencies)
```

### Dependency Notes

- **Offline caching requires network detection:** Must know when offline to show cached data vs. live data
- **Auto-update requires electron-builder publish config:** GitHub Releases provider must be configured in package.json build section
- **Launch at startup is fully independent:** Can be built in any order; no dependencies on other features

## MVP Definition

### Launch With (v1.4)

- [x] Cached latest usage data for offline viewing — core offline experience
- [x] "Last updated X ago" indicator — users must know data freshness
- [x] Auto-reconnect when network returns — seamless recovery
- [x] Update available notification with prompt — basic auto-update flow
- [x] Download and install on user approval — complete update cycle
- [x] Launch at startup toggle in settings — simple on/off preference

### Add After Validation (v1.x)

- [ ] Stale data color coding — enhance offline UX based on user feedback
- [ ] Update changelog display — show release notes before install
- [ ] Update check frequency setting — let users control how often to check

### Future Consideration (v2+)

- [ ] Delta updates — reduce download size for minor updates
- [ ] Multi-channel updates (stable/beta) — if user base grows enough
- [ ] Startup delay setting — delay widget launch by N seconds after login

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Offline data caching | HIGH | LOW | P1 |
| Network status detection | HIGH | LOW | P1 |
| Auto-reconnect | HIGH | LOW | P1 |
| Auto-update notification | HIGH | MEDIUM | P1 |
| Update download + install | HIGH | MEDIUM | P1 |
| Launch at startup toggle | MEDIUM | LOW | P1 |
| Stale data indicator | MEDIUM | LOW | P2 |
| Update changelog | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Sources

- Electron documentation: autoUpdater, app.setLoginItemSettings(), online/offline events
- electron-builder documentation: publish providers, auto-update configuration
- Desktop widget UX patterns: system tray apps, always-on-top widgets

---
*Feature research for: Electron desktop widget enhancements*
*Researched: 2026-02-20*
