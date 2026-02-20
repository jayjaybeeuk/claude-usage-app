# Research Summary

**Domain:** Electron desktop widget enhancements (offline mode, auto-updates, launch-at-startup)
**Synthesized:** 2026-02-20

## Key Findings

### Stack
- **electron-updater** (bundled with electron-builder 26.7.0) for auto-updates — works with GitHub Releases out of the box
- **app.setLoginItemSettings()** — built-in Electron API for launch at startup, no new dependency
- **electron-store** (already installed) — extend for offline data caching, no new dependency needed
- **electron-log** (optional) — structured logging for auto-updater debugging
- **Minimal new dependencies** — most features use existing Electron APIs and electron-store

### Table Stakes Features
- Cached usage data when offline with "Last updated X ago"
- Network status detection + auto-reconnect
- Update available notification with user-controlled install
- Launch at startup toggle (opt-in)

### Architecture Integration
- **All new logic in main process** — cache manager, auto-updater, startup manager
- **Renderer adds UI only** — offline indicator, update prompt, startup toggle
- **Cache-through pattern** — write cache on successful fetch, read cache on failure
- **Event-driven updates** — autoUpdater emits events, main forwards to renderer via IPC
- **No new files needed** — all features fit into existing file structure

### Critical Watch-Outs
1. **Code signing required** for auto-updates on macOS/Windows — must set up before shipping
2. **Stale cache past session reset** — cached data may show pre-reset utilization; need staleness detection
3. **setLoginItemSettings doesn't work in dev mode** — only functional in packaged builds
4. **GitHub Releases must be published** (not drafts) for electron-updater to find them
5. **Update downloads can interfere with API fetching** — need coordination or `autoDownload: false`
6. **electron-store schema changes** need migration strategy before adding cache fields

### Recommended Build Order
1. **Offline mode** — extends existing fetchUsageData; least new infrastructure; immediate user value
2. **Launch at startup** — independent feature; simplest implementation; no new dependencies
3. **Auto-updates** — most infrastructure; benefits from offline mode already working

### What NOT to Build
- Silent auto-install (user should control restarts)
- Offline data sync/conflict resolution (data is read-only from API)
- Force update mechanism (breaks user trust)
- Service Workers for offline (not applicable in Electron)

## Research Files

| File | Contents |
|------|----------|
| [STACK.md](STACK.md) | Recommended technologies, versions, alternatives |
| [FEATURES.md](FEATURES.md) | Feature landscape, priorities, dependencies |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component design, data flows, integration points |
| [PITFALLS.md](PITFALLS.md) | Critical mistakes, prevention strategies, phase mapping |

---
*Research summary for: Claude Usage Widget enhancements*
*Synthesized: 2026-02-20*
