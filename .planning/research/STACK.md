# Stack Research

**Domain:** Electron desktop widget enhancements (offline mode, auto-updates, launch-at-startup)
**Researched:** 2026-02-20
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| electron-updater | 6.x (bundled with electron-builder 26.7.0) | Auto-update mechanism | Standard Electron auto-update solution; works with GitHub Releases out of the box; handles download, verification, and install across platforms |
| Electron app.setLoginItemSettings() | Built-in (Electron 40.4.1) | Launch at startup | Native Electron API; cross-platform (macOS, Windows, Linux); no external dependency needed |
| electron-store | 8.1.0 (already installed) | Offline data caching | Already used for credentials/history; extend to cache latest usage data for offline mode |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| electron-log | 5.x | Structured logging for auto-updater events | Recommended for debugging update failures in production; electron-updater integrates natively with it |
| semver | 7.x | Version comparison | Only if custom update logic needed (e.g., skip certain versions); electron-updater handles basic comparison internally |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| electron-builder (already installed) | Packaging + publish config | Add `publish` config to package.json for GitHub Releases provider; electron-updater is bundled |

## Installation

```bash
# Core (electron-updater comes with electron-builder, already installed)
npm install electron-log

# No other new dependencies needed — offline caching uses electron-store (existing)
# Launch at startup uses built-in Electron API
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| electron-updater (via electron-builder) | Electron autoUpdater (built-in) | Only for macOS with Squirrel server; electron-updater is more flexible |
| electron-store for offline cache | SQLite (better-sqlite3) | Only if storing >10MB of structured data; overkill for caching API responses |
| app.setLoginItemSettings() | auto-launch npm package | Only if needing advanced features like hidden launch or arguments; built-in API covers our needs |
| electron-log | winston | Only for complex logging pipelines; electron-log is lighter and Electron-native |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| auto-launch npm package | Adds unnecessary dependency for what Electron provides natively; last updated infrequently | app.setLoginItemSettings() |
| Electron built-in autoUpdater | Only supports Squirrel (macOS) and requires custom server for Windows/Linux | electron-updater via electron-builder |
| Service Worker for offline | Not applicable in Electron main process; adds complexity without benefit for IPC-based data flow | electron-store caching in main process |
| IndexedDB for caching | Overkill for simple JSON caching; harder to access from main process | electron-store (already in use) |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| electron-updater 6.x | electron-builder 26.7.0 | Bundled together; version pinned by electron-builder |
| electron-updater 6.x | Electron 40.4.1 | Full compatibility; uses native autoUpdater under the hood |
| electron-log 5.x | Electron 40.4.1 | Compatible; uses Electron's console and file transports |
| app.setLoginItemSettings() | Electron 40.4.1 | Available since Electron 9; stable API |

## Sources

- Electron documentation — autoUpdater API, app.setLoginItemSettings()
- electron-builder documentation — publish configuration, electron-updater integration
- electron-store documentation — encryption, schema validation

---
*Stack research for: Electron desktop widget enhancements*
*Researched: 2026-02-20*
