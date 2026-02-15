# Claude Usage Widget

## Overview

Electron desktop widget that monitors Claude.ai usage statistics in real-time. Displays session (5-hour) and weekly usage limits with progress bars, countdown timers, and a 7-day usage history graph. Communicates with Claude.ai API using a hidden BrowserWindow to bypass Cloudflare bot detection.

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── main.ts              # Window management, tray, IPC handlers, API coordination
│   ├── preload.ts           # Context-isolated IPC bridge (electronAPI)
│   └── fetch-via-window.ts  # Hidden BrowserWindow HTTP fetcher (Cloudflare bypass)
├── renderer/                # Frontend UI (no framework, pure TypeScript)
│   ├── app.ts               # UI state, login flow, data display, canvas chart
│   ├── index.html           # Widget markup + inline SVGs
│   ├── styles.css           # Styling
│   └── env.d.ts             # Global type declarations
└── shared/                  # Shared between main and renderer
    ├── ipc-channels.ts      # IPC channel name constants
    └── ipc-types.ts         # TypeScript interfaces (Credentials, UsageData, ElectronAPI)
```

**Main process** (`main.ts`): Creates frameless always-on-top window (480x174px base), system tray with dynamic usage stats, handles login via browser window cookie capture, fetches 3 API endpoints in parallel via `fetch-via-window.ts`.

**Renderer** (`app.ts`): Single-page UI with login flow, progress bars, SVG circular countdown timers, lightweight Canvas 2D usage history chart. Auto-refreshes every 5 minutes. Dynamic widget height based on expanded sections.

**Preload** (`preload.ts`): Secure bridge exposing `window.electronAPI` with credentials, window controls, position, data fetching, and usage history methods.

## Key Commands

```bash
npm run dev              # Development: TypeScript watch + Vite + Electron (concurrent)
npm run dev:debug        # Development with DEBUG_LOG=1
npm run build            # Production: compile TS + bundle renderer
npm run typecheck        # Type-check both main and renderer tsconfigs
npm run package          # Build distributable for current platform
npm run package:mac      # Build macOS DMG + ZIP
npm run package:win      # Build Windows NSIS + portable
npm run package:linux    # Build Linux AppImage
```

## Build System

- **Main process**: TypeScript compiled via `tsc` to `dist-main/`
- **Renderer**: Bundled via Vite to `dist-renderer/` (target: chrome120)
- **Packaging**: electron-builder (config in package.json `build` field)
- **Path alias**: `@shared` maps to `src/shared/` (Vite resolve)
- **Node.js**: Requires >=22.12.0

## Key Patterns

- **Cloudflare bypass**: `fetch-via-window.ts` creates hidden BrowserWindow to load URLs with browser session cookies instead of Node.js fetch. Detects blocked responses ("Just a moment", HTML content).
- **Context isolation**: `nodeIntegration: false`, `contextIsolation: true`. All main/renderer communication through typed IPC channels.
- **Credential storage**: `electron-store` with encryption for sessionKey + organizationId. Cookie also set in Electron session for API auth.
- **Parallel API fetching**: `Promise.allSettled()` for usage, overage limit, and prepaid credits endpoints.
- **Single instance**: `app.requestSingleInstanceLock()` prevents multiple widget instances.
- **Platform-aware**: macOS uses vibrancy, hides dock icon, template tray images. Windows uses ICO icons, NSIS installer.

## IPC Channels

Defined in `src/shared/ipc-channels.ts`. All channel names are string constants shared between main and preload. Key channels: `get-credentials`, `save-credentials`, `fetch-usage-data`, `resize-window`, `update-tray-usage`.

## API Endpoints

All requests go to `claude.ai/api/organizations/{orgId}/`:
- `usage` — session and weekly utilization (required)
- `overage_spend_limit` — spending limits (optional)
- `prepaid/credits` — prepaid balance (optional)
