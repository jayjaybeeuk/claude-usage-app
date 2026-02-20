# Pitfalls Research

**Domain:** Electron desktop widget enhancements (offline mode, auto-updates, launch-at-startup)
**Researched:** 2026-02-20
**Confidence:** MEDIUM (based on training data through January 2025, no current web verification available)

---

## Critical Pitfalls

### Pitfall 1: Unsigned Auto-Updates Breaking Security on macOS/Windows
**What goes wrong:** App downloads updates but fails to install with cryptic errors. Users on macOS get "damaged app" warnings. Windows SmartScreen blocks updates entirely.

**Why it happens:** Auto-update mechanisms (electron-updater, autoUpdater) verify code signatures before installing. Without proper signing infrastructure:
- macOS: Gatekeeper rejects unsigned updates even if base app was signed
- Windows: SmartScreen blocks, requires certificate matching original installer
- Mixed scenarios: Signing dev builds differently from production creates "signature mismatch" errors

**How to avoid:**
- Implement code signing BEFORE auto-update feature (not after)
- Use same certificate for all builds (dev can skip updates, prod must be signed)
- Test update flow with signed artifacts in CI/CD before releasing
- Budget for certificate costs: macOS Developer ID ($99/year), Windows Code Signing ($200-400/year)

**Warning signs:**
- "App is damaged" errors on macOS after update
- Windows Defender/SmartScreen blocking updated app
- Update downloads but fails silently during installation
- Different signature fingerprints between versions

**Phase to address:** Phase 1 (Infrastructure) — set up signing before implementing auto-update logic

---

### Pitfall 2: Update Download Exhausting Disk Space (No Cleanup)
**What goes wrong:** Widget checks for updates every 5 minutes. Each check downloads full update (e.g., 80MB DMG). After a week, app has consumed gigabytes in temp directory. System runs out of disk space or user notices suspicious disk usage.

**Why it happens:**
- electron-updater caches downloads in OS temp directory
- Failed update attempts don't clean up partial downloads
- Multiple update checks create duplicate cached files
- Temp directory cleanup happens at OS discretion, not immediately

**How to avoid:**
- Check for updates at app launch + once every 24 hours (not every 5 minutes)
- Use `autoUpdater.checkForUpdatesAndNotify()` which handles caching intelligently
- Implement cleanup on update failure: `autoUpdater.on('error')` should remove downloaded artifacts
- Set `autoDownload: false` to check availability without downloading immediately

**Warning signs:**
- App temp directory (`~Library/Application Support/{app}/updates` on macOS) growing continuously
- Update checks triggering network traffic every refresh cycle
- User complaints about disk space usage

**Phase to address:** Phase 2 (Auto-Update Implementation) — design download strategy before coding

---

### Pitfall 3: Breaking Stored Data on Auto-Update
**What goes wrong:** User updates from v1.3.1 to v2.0.0. App launches but crashes, or credentials are lost, or usage history disappears. Rollback to previous version doesn't help because data format was corrupted.

**Why it happens:**
- electron-store schema changes between versions without migration
- Hardcoded encryption key changes (current app has hardcoded key — this is HIGH RISK)
- App ID or app name changes, creating new storage location
- Renderer code expects new data shape but main process loads old format

**How to avoid:**
- **NEVER change hardcoded encryption key** (current app has this risk)
- Implement schema versioning in electron-store: `{ version: 1 }` in stored data
- Write migration logic BEFORE making breaking schema changes
- Test update path: v1.3.1 → v2.0.0 in CI with real v1.3.1 data fixtures
- Consider splitting encryption key into "rotate-able" and "permanent" parts

**Warning signs:**
- electron-store file format changes in PR without migration code
- Changing `encryptionKey` constant
- Changing `name` field in package.json (changes app data directory)
- Adding required fields to stored interfaces without defaults

**Phase to address:** Phase 1 (Infrastructure) — add schema versioning and migration framework before any other changes

---

### Pitfall 4: Offline Mode Serving Stale Data Forever
**What goes wrong:** Network fails. Widget shows cached data with "Last updated: 2 hours ago." User checks widget days later — still shows 2-hour-old data with no indication it's critically stale. User makes decisions based on outdated usage stats.

**Why it happens:**
- Cache expiry logic missing (just "show cache if network fails")
- No visual distinction between "5 minutes old" and "5 days old"
- Background sync doesn't retry aggressively enough
- User doesn't notice "offline mode" indicator in UI

**How to avoid:**
- Implement maximum cache age (e.g., 24 hours)
- After max age, show "Data too old to display" instead of stale data
- Visual urgency levels:
  - < 10 min: green indicator
  - 10-60 min: yellow indicator
  - 1-24 hours: orange indicator
  - > 24 hours: red "Data unavailable"
- Aggressive retry with exponential backoff: 1min, 5min, 15min, 30min, 1hr

**Warning signs:**
- No timestamp on cached data
- No cache expiry checks in offline mode code
- UI shows identical appearance for fresh vs. stale data

**Phase to address:** Phase 2 (Offline Mode) — design cache expiry strategy before implementing offline mode

---

### Pitfall 5: Launch-at-Startup Breaking After macOS/Windows Updates
**What goes wrong:** User enables "Launch at startup." Works perfectly. After macOS update (e.g., macOS 15 → macOS 16) or Windows update, app stops launching at startup. No error shown to user.

**Why it happens:**
- macOS Login Items moved from LaunchAgents (old) to Service Management (new) in macOS 13+
- Using deprecated `app.setLoginItemSettings()` with `openAtLogin` only works on older systems
- Windows registry keys change location between Windows versions
- App path contains spaces/special chars that break startup command on some systems
- Sandboxed builds have different requirements than non-sandboxed

**How to avoid:**
- macOS: Use `SMAppService` API for macOS 13+ (requires helper app in bundle)
- Fallback chain: try modern API, fall back to legacy if unavailable
- Test on minimum supported OS version (e.g., macOS 12, Windows 10)
- Handle app path escaping properly (spaces, unicode, special characters)
- Add "Test startup" button in settings that verifies current configuration

**Warning signs:**
- Using only `app.setLoginItemSettings({ openAtLogin: true })` without platform checks
- No testing on older OS versions in CI
- App path in code without proper escaping/quoting
- Not checking `app.getLoginItemSettings()` to verify setting took effect

**Phase to address:** Phase 3 (Launch at Startup) — research platform-specific APIs before implementing

---

### Pitfall 6: Hidden BrowserWindow Breaking Auto-Update Downloads
**What goes wrong:** Auto-update tries to download update. Request hangs indefinitely or fails with "net::ERR_BLOCKED_BY_CLIENT". Update never completes.

**Why it happens:**
- Current app uses hidden BrowserWindow for API calls (Cloudflare bypass)
- Auto-updater uses Node.js net module (electron's HTTP stack)
- If BrowserWindow is destroyed during update download, network stack breaks
- Session isolation: BrowserWindow session has cookies, auto-updater session doesn't
- Cloudflare protection on update server (CDN) blocks Node.js HTTP requests

**How to avoid:**
- Use separate network stack for updates (don't route through BrowserWindow)
- electron-updater uses native HTTP — don't intercept its requests
- Host updates on CDN without bot protection (GitHub Releases, S3, standard CDN)
- If using custom update server, whitelist electron user-agent
- Don't destroy hidden BrowserWindow during update download

**Warning signs:**
- Update downloads never complete
- Network errors in auto-update logs
- Update requests showing in BrowserWindow network inspector
- Mixing session cookies between update requests and app API requests

**Phase to address:** Phase 2 (Auto-Update) — verify update hosting infrastructure separate from API calls

---

### Pitfall 7: Race Condition: Update Downloads While App Is Fetching Usage Data
**What goes wrong:** Widget is fetching usage data (via hidden BrowserWindow with 30s timeout). Auto-update starts downloading 80MB update in background. BrowserWindow fetch times out because network is saturated. User sees "Failed to load data" error during update.

**Why it happens:**
- No coordination between update downloads and app network activity
- electron-updater downloads at full speed by default
- Widget's 30s timeout is aggressive for slow networks
- Parallel fetch-via-window + update download saturates user's connection

**How to avoid:**
- Pause auto-update downloads during active user sessions
- Download updates only when app is idle (no API calls in last 5 minutes)
- Increase timeout for fetch-via-window during update downloads
- Show "Downloading update..." status that explains slower performance
- Use `autoDownload: false`, prompt user before downloading large update

**Warning signs:**
- Network timeout errors increase after enabling auto-update
- Users report "app stops working" when update is available
- No coordination between update download state and app network activity

**Phase to address:** Phase 2 (Auto-Update) — implement network request coordination

---

### Pitfall 8: Offline Mode Caching Credentials Insecurely
**What goes wrong:** Implementing offline mode caches full API responses including sensitive data. Cache is stored unencrypted. User's sessionKey/organizationId leak if laptop is stolen or disk forensics performed.

**Why it happens:**
- Rushing offline mode by just "save response JSON to disk"
- Forgetting to encrypt cache like credentials are encrypted
- Storing full responses including headers with auth tokens
- Cache directory has permissive file permissions

**How to avoid:**
- Use same encryption as electron-store credentials (but watch Pitfall 3 about key changes)
- Cache only non-sensitive response fields (usage stats, not auth headers)
- Set restrictive file permissions on cache directory (0600 on Unix)
- Clear cache on logout
- Use OS keychain for sensitive data instead of encrypted files

**Warning signs:**
- Cache implementation doesn't use encryption
- Storing full API responses verbatim
- No cache clearing on logout flow
- Cache files readable by all users

**Phase to address:** Phase 2 (Offline Mode) — design cache security before implementation

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip code signing | Ship auto-update faster | Users can't install updates, security warnings | Never (blocks core functionality) |
| Hardcode update URL | Avoid infrastructure setup | Can't change CDN without app update | Early prototyping only, must remove before release |
| No migration framework | Faster v1 development | Breaking changes orphan user data | Never (high user impact) |
| Synchronous storage I/O | Simpler code | UI freezes during large cache operations | Never (Electron best practice violation) |
| Cache without expiry | Simpler offline mode | Stale data shown forever | Never (misleading users) |
| Auto-download updates | Better UX (seamless) | Wastes bandwidth, disk space on metered connections | Only if update is small (<10MB) |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| electron-updater + electron-builder | Forgetting `publish` config in package.json | Add `"publish": { "provider": "github" }` to `build` section |
| electron-store + auto-update | Changing encryptionKey between versions | Never change key, or implement key migration |
| Login items + sandboxed app | Using openAtLogin without helper app | Use SMAppService (macOS 13+) or bundle helper app |
| Hidden BrowserWindow + updates | Sharing session/cookies between app and updater | Keep update network stack separate |
| Offline cache + IPC | Caching in renderer, losing on reload | Cache in main process (electron-store) |
| setLoginItemSettings + app path changes | Path becomes invalid after update | Use `app.getPath('exe')` dynamically, never hardcode |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Checking for updates every 5 minutes | Constant network traffic, battery drain | Check at launch + every 24 hours | User on metered/slow connection |
| Synchronous cache reads in renderer | UI freezes when loading offline data | Use IPC to read cache in main process asynchronously | Cache file > 100KB |
| Downloading full update on every check | Gigabytes of disk usage, bandwidth waste | Use `autoDownload: false`, check version only | User on metered connection, limited disk |
| No update download progress | User thinks app froze during download | Show progress bar with percentage | Update > 20MB |
| Keeping hidden BrowserWindow alive forever | Memory leak, background HTTP connections | Destroy window after API call, recreate on demand | Long-running app (days/weeks) |
| Re-encrypting entire cache on every write | CPU spike, UI stutter | Update only changed records, use incremental encryption | Cache > 1MB |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Hardcoded encryption key in source | Key visible in public repo, all data decryptable | Use environment variable or build-time injection, NEVER commit key |
| Unsigned auto-updates | Man-in-the-middle attack installs malware | Always code-sign releases, verify signatures before installing |
| HTTP update server (not HTTPS) | Update payload intercepted, malicious code injected | Use HTTPS for all update endpoints, verify certificate |
| Caching auth tokens unencrypted | Token theft from disk | Encrypt cache with same protection as credentials |
| No certificate pinning on update server | DNS hijacking redirects to fake update server | Pin GitHub certificate, or use electron-updater's built-in verification |
| Auto-installing updates without user consent | Malicious update forces installation | Prompt user before downloading/installing (except critical security patches) |
| Storing updater private key in repo | Anyone can sign malicious updates | Store signing keys in CI secrets only, never in repo |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent auto-updates with no notification | User confused by new features/changes appearing | Show "Update available" notification, changelog on restart |
| No offline indicator | User thinks data is current when it's stale | Prominent "Offline" badge + timestamp |
| Update downloads in foreground blocking UI | App unusable during update | Download in background, apply on next launch |
| "Launch at startup" enabled by default | User annoyed by unwanted auto-launch | Make it opt-in, ask during onboarding |
| Update failure with no user-facing error | User never knows app is outdated | Show persistent "Update failed" message with retry button |
| Stale cache looks identical to fresh data | User makes bad decisions based on old data | Color-code freshness: green (<10min), yellow (10-60min), red (>1hr) |
| No way to disable auto-update | Power users frustrated, enterprise blocked | Add "Check manually" preference option |
| Losing window position after update | User re-positions widget every update | Persist and restore window position across updates |

---

## "Looks Done But Isn't" Checklist

### Auto-Update
- [ ] **Code signing infrastructure:** Often missing certificate setup, CI integration — verify signed artifacts in GitHub Releases before merging
- [ ] **Update rollback:** Often missing failed update recovery — verify app reverts to previous version if new version crashes
- [ ] **Cross-platform testing:** Often missing Windows/Linux testing when developing on macOS — verify update works on all platforms
- [ ] **Update server monitoring:** Often missing 404 handling when GitHub release missing — verify graceful failure when update unavailable
- [ ] **Version comparison logic:** Often missing pre-release handling (1.3.1-beta vs 1.3.1) — verify semver parsing edge cases

### Offline Mode
- [ ] **Cache expiry:** Often missing max age checks — verify cache not served after 24 hours
- [ ] **Partial data handling:** Often missing logic for incomplete cache — verify app handles missing fields gracefully
- [ ] **Cache size limits:** Often missing disk usage caps — verify old cache purged when exceeding limit (e.g., 50MB)
- [ ] **Time zone handling:** Often missing UTC conversion in timestamps — verify "Last updated" correct across time zones
- [ ] **Offline → online transition:** Often missing cache refresh on reconnect — verify fresh fetch after coming online

### Launch at Startup
- [ ] **Platform-specific APIs:** Often missing macOS 13+ SMAppService migration — verify works on latest OS versions
- [ ] **Startup delay:** Often missing app launch throttling — verify app doesn't overwhelm system when 20 apps start at boot
- [ ] **Hidden launch:** Often missing background launch flag — verify app doesn't steal focus when auto-launching
- [ ] **Uninstall cleanup:** Often missing login item removal — verify startup disabled when app uninstalled
- [ ] **Settings persistence:** Often missing sync between app setting and OS — verify UI reflects actual OS login item state

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Unsigned updates shipped | HIGH (emergency release) | 1. Revoke unsigned release, 2. Sign with certificate, 3. Re-release with higher version, 4. Post manual download instructions |
| Breaking data migration | HIGH (user support flood) | 1. Release hotfix with migration, 2. Provide manual data recovery tool, 3. Document manual fix in FAQ |
| Hardcoded encryption key leaked | CRITICAL (all users) | 1. Generate new key, 2. Migrate all users (decrypt with old, encrypt with new), 3. Rotate API credentials |
| Update infinite loop | HIGH (app unusable) | 1. GitHub release contains rollback instructions, 2. Provide manual "skip update" override flag, 3. Hotfix with corrected version |
| Cache poisoning | MEDIUM (clear and retry) | 1. Add "Clear cache" button in settings, 2. Auto-detect corrupted cache and wipe, 3. Version cache format to force refresh |
| Launch-at-startup permission denied | LOW (user re-enables) | 1. Detect permission failure, 2. Show instructions for granting permission, 3. Add "Test" button to verify |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Unsigned updates | Phase 1: Infrastructure | CI produces signed artifacts, test installation |
| Breaking stored data | Phase 1: Infrastructure | Schema versioning tests pass, migration framework exists |
| Stale cache forever | Phase 2: Offline Mode | Cache expires after 24hrs in test |
| Update download saturation | Phase 2: Auto-Update | Concurrent API calls + update download tested |
| Platform-specific startup issues | Phase 3: Launch at Startup | Tested on macOS 12-15, Windows 10-11, Ubuntu 22.04+ |
| No update rollback | Phase 2: Auto-Update | Failed update reverts to previous version |
| Cache security | Phase 2: Offline Mode | Cache encrypted, file permissions verified |
| Hidden window conflicts | Phase 2: Auto-Update | Update completes while API calls active |

---

## Project-Specific Risks

### HIGH RISK (Address Immediately)
1. **Hardcoded encryption key** (current codebase): Any key change breaks all user data. Must implement key migration framework BEFORE any other changes.
2. **No test suite**: Auto-update bugs only caught in production. Must add integration tests for update scenarios.
3. **electron-store migration**: Current app has no schema versioning. Adding offline cache will change data structure — needs migration.

### MEDIUM RISK (Address During Implementation)
4. **30s timeout with updates**: Current fetch timeout too aggressive if update downloading. Needs coordination.
5. **Single-instance lock + updates**: Install/update may fail if old instance won't quit. Needs graceful quit logic.
6. **Hidden BrowserWindow lifecycle**: Update during active window usage may break. Needs state coordination.

### LOW RISK (Design Consideration)
7. **Tray menu during update**: Should show update progress, not hide it.
8. **Window position restore**: Update shouldn't reset saved position.
9. **Cross-platform paths**: electron-store paths differ per platform, cache paths must too.

---

## Sources

**Confidence note:** This research is based on Electron ecosystem knowledge through January 2025. No current web verification was available due to tool access restrictions. All pitfalls listed are well-established patterns in Electron development (Electron versions 20-31 timeframe) and unlikely to have fundamentally changed. However, specific API recommendations should be verified against Electron 40.4.1 (current project version) documentation before implementation.

**Recommended verification before implementation:**
- Electron official documentation for autoUpdater, app.setLoginItemSettings, session APIs
- electron-updater library documentation (if using third-party updater)
- electron-builder code signing documentation for current certificate requirements
- Platform-specific documentation (Apple SMAppService, Windows Task Scheduler APIs)

---

*Pitfalls research for: Electron desktop widget enhancements*
*Researched: 2026-02-20*
*Confidence: MEDIUM (training data-based, no web verification)*
