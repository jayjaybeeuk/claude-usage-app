# Technology Stack

**Analysis Date:** 2026-02-19

## Languages

**Primary:**
- TypeScript 5.9.3 - Main development language for both main and renderer processes
- JavaScript/HTML - Runtime and UI markup in Electron

**Secondary:**
- Bash - Build scripts (e.g., `scripts/generate-icons.sh`)

## Runtime

**Environment:**
- Node.js 22.12.0 (minimum version specified in package.json engines)
- Electron 40.4.1 - Desktop runtime for cross-platform widget

**Package Manager:**
- npm (minimum 10.0.0)
- Lockfile: `package-lock.json` present

## Frameworks

**Core Desktop:**
- Electron 40.4.1 - Desktop application framework
  - Main process: `src/main/main.ts` manages window, tray, and IPC
  - Renderer process: `src/renderer/app.ts` handles UI
  - Preload: `src/main/preload.ts` provides context-isolated IPC bridge

**Frontend (No Framework):**
- Pure TypeScript/vanilla JavaScript for UI
- DOM-based UI without React/Vue/Angular
- Canvas 2D API for chart rendering (usage history graph, pie chart)

**Build/Dev:**
- Vite 7.3.1 - Frontend bundler and dev server (serves on localhost:5173)
- TypeScript 5.9.3 - Compiler for both main (`tsc -p tsconfig.main.json`) and renderer
- electron-builder 26.7.0 - Packaging and distribution for macOS/Windows/Linux
- concurrently 9.2.1 - Run dev tasks in parallel (tsc watch, Vite, Electron)
- cross-env 7.0.3 - Cross-platform environment variable handling
- wait-on 9.0.4 - Ensure Vite and compiled main are ready before starting Electron

## Key Dependencies

**Production:**
- electron-store 8.1.0 - Encrypted persistent storage for credentials and app state
  - Stores: `sessionKey`, `organizationId`, `windowPosition`, `usageHistory`, `refreshIntervalMinutes`
  - Encryption key: `'claude-widget-secure-key-2024'` (hardcoded in `src/main/main.ts` line 40)

**Build/Platform-Specific:**
- @rollup/rollup-darwin-arm64, darwin-x64, linux-x64-gnu, win32-x64-msvc (optional) - Native modules for build optimization

## Configuration

**TypeScript:**
- Main process: `tsconfig.main.json`
  - Target: ES2022
  - Module: CommonJS
  - Output: `dist-main/`
  - Strict mode enabled

- Renderer process: `tsconfig.renderer.json`
  - Target: ES2022
  - Module: ESNext
  - Module resolution: bundler
  - Output: `dist-renderer/`
  - DOM library types included

**Vite:**
- Config: `vite.config.ts`
- Root: `src/renderer/`
- Dev server: localhost:5173 (strict port)
- Build target: chrome120
- Path alias: `@shared` → `src/shared/`
- Base path: `./` (relative for packaged app)

**Electron Builder:**
- Config embedded in `package.json` under `"build"` key
- App ID: `com.claudeusage.widget`
- Product name: Claude Usage App
- Compression: maximum
- ASAR archive: enabled
- Targets:
  - macOS: DMG + ZIP (icon: `assets/icon.icns`, min OS: 12.0)
  - Windows: NSIS installer + portable (icon: `assets/icon.ico`)
  - Linux: AppImage (icon: `assets/icon.png`)

**Environment:**
- Node version: `.nvmrc` specifies 22.12
- Development mode detection: `process.env.NODE_ENV === 'development'`
- Debug logging: Enabled via `DEBUG_LOG=1` environment variable

## Platform Requirements

**Development:**
- macOS, Windows, or Linux
- Node.js 22.12.0+
- npm 10.0.0+
- For packaging: Python (required by electron-builder), platform-specific tools:
  - macOS: Xcode Command Line Tools
  - Windows: Visual C++ Build Tools
  - Linux: build-essential

**Production:**
- macOS 12.0+
- Windows 10+
- Linux (AppImage)
- No external dependencies or system services required for runtime

## Architecture Decisions

**No Native Dependencies:**
- Pure Electron with no native Node modules for max portability
- electron-builder handles cross-platform packaging

**Cloudflare Bypass Strategy:**
- Uses hidden BrowserWindow (`src/main/fetch-via-window.ts`) to fetch Claude.ai API
- Spoofs Chrome User-Agent to bypass Cloudflare bot detection
- Standard Node.js fetch is blocked by Cloudflare; browser-based fetch uses session cookies

**Context Isolation:**
- Main process: `nodeIntegration: false`, `contextIsolation: true`
- Communication: IPC channels via contextBridge (secure sandbox model)

**Single Instance Lock:**
- `app.requestSingleInstanceLock()` ensures only one widget instance runs

---

*Stack analysis: 2026-02-19*
