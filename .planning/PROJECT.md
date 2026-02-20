# Claude Usage Widget

## What This Is

A cross-platform Electron desktop widget that monitors Claude.ai usage statistics in real-time. Displays session (5-hour) and weekly usage limits with progress bars, countdown timers, model breakdowns, and a 7-day usage history graph. Lives in the system tray as an always-on-top frameless window.

## Core Value

Users can glance at their Claude usage limits at any time without opening a browser or interrupting their workflow.

## Requirements

### Validated

- ✓ Real-time session (5h) and weekly usage display with progress bars — existing
- ✓ Per-model usage breakdown (Sonnet, Opus, Cowork, OAuth) — existing
- ✓ Countdown timers for session and weekly reset — existing
- ✓ 7-day usage history line chart (Canvas 2D) — existing
- ✓ Model breakdown donut chart — existing
- ✓ Browser-based login with automatic session key capture — existing
- ✓ Manual session key entry as fallback — existing
- ✓ System tray integration with dynamic usage stats — existing
- ✓ Encrypted credential storage via electron-store — existing
- ✓ Cloudflare bypass via hidden BrowserWindow — existing
- ✓ Cross-platform support (macOS, Windows, Linux) — existing
- ✓ Single-instance enforcement — existing
- ✓ Configurable refresh interval (1-20 minutes) — existing
- ✓ Window position persistence — existing
- ✓ Overage spend limit and prepaid credits display — existing

### Active

- [ ] Offline mode with cached data and "Last updated X ago" indicator
- [ ] Auto-updates via electron-updater with GitHub Releases (prompt before install)
- [ ] Launch at system startup (opt-in, off by default)

### Out of Scope

- Multi-organization support — adds significant complexity, single-org sufficient for now
- Real-time notifications/alerts — widget is passive display, not an alerting system
- Mobile app — desktop-only tool
- Usage analytics/export — widget is for quick glances, not reporting

## Context

- App distributed via GitHub Releases (macOS DMG+ZIP, Windows NSIS+portable, Linux AppImage)
- Built with Electron 40.4.1, TypeScript 5.9.3, Vite 7.3.1, no frontend framework
- Renderer is a single-file monolith (~1200 lines) — no refactoring planned this milestone
- No test suite exists — not in scope for this milestone
- Codebase analysis available in `.planning/codebase/`

## Constraints

- **Tech stack**: Electron + TypeScript + Vite — no framework changes
- **No native deps**: Pure Electron with no native Node modules for portability
- **Cloudflare**: Must continue using hidden BrowserWindow approach for API calls
- **Packaging**: electron-builder for all platforms (macOS, Windows, Linux)
- **Minimal footprint**: Widget should remain lightweight and unobtrusive

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Show last known data when offline | Simpler than timer-only fallback, more useful to user | — Pending |
| Prompt before auto-update install | User controls when app restarts, less disruptive | — Pending |
| Launch-at-startup opt-in by default | Respect user preference, avoid unwanted startup items | — Pending |
| Use electron-updater with GitHub provider | Already distributing via GitHub Releases, natural fit | — Pending |

---
*Last updated: 2026-02-20 after initialization*
