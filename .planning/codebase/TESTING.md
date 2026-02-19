# Testing Patterns

**Analysis Date:** 2026-02-19

## Test Framework

**Status:** Not detected

**Current State:**
- No test files (`.test.ts`, `.spec.ts`) exist in `src/` directory
- No testing framework configured in `package.json` (Jest, Vitest, etc.)
- No test runner scripts in build pipeline
- No test configuration files (jest.config.js, vitest.config.ts, etc.)

**Code is manually tested via:**
- Development mode with `npm run dev` (hot reload + DevTools)
- Debug logging via `DEBUG_LOG=1` environment variable
- Manual widget testing in production builds

## Manual Testing Approach

**Development Testing:**
- Run `npm run dev` for concurrent TypeScript watch + Vite dev server + Electron window
- Open DevTools in development with `mainWindow.webContents.openDevTools()` when `isDev` is true
- Enable debug mode with `DEBUG_LOG=1` for verbose logging
- Test against real Claude.ai API in development

**Debug Logging:**
- Main process: `debugLog()` and `debugLogToRenderer()` only log when `DEBUG_LOG=1`
- Renderer: `debugLog()` only logs with `?debug` URL param or `DEBUG` flag
- Logs appear in console/DevTools, not in production builds

**Manual Test Flows:**
1. Login flow: Test auto-detect (browser login) and manual session key entry
2. API integration: Verify usage endpoints fetch correctly
3. UI state: Test expand/collapse, graph visibility, pie chart visibility
4. Platform-specific: Test macOS vibrancy, Windows NSIS installer, Linux AppImage
5. Error handling: Test session expiration (403 errors), invalid keys, network failures

## Testing Gaps

**No automated tests for:**
- API error handling (Cloudflare detection in `fetch-via-window.ts`)
- IPC channel message serialization
- Electron main process lifecycle (window creation, tray behavior)
- Credential storage and encryption
- Usage data transformation logic
- UI state transitions and re-renders
- Platform-specific behavior (macOS vibrancy, template images, etc.)
- Cookie management and session persistence

**Missing test coverage for critical paths:**
- `src/main/main.ts`: 685 lines, ~60% estimated coverage (untested: tray menu, window lifecycle edge cases)
- `src/renderer/app.ts`: 800+ lines, ~40% estimated coverage (untested: canvas chart rendering, UI transitions)
- `src/main/fetch-via-window.ts`: 93 lines, ~30% estimated coverage (untested: Cloudflare detection accuracy)

## Suggested Testing Strategy (Future Implementation)

**Recommended Framework:**
- Vitest for unit tests (TypeScript-native, fast)
- Playwright for E2E tests (cross-platform, Electron-aware)

**Test File Structure:**
```
src/
├── main/
│   ├── main.ts
│   ├── __tests__/
│   │   ├── main.test.ts
│   │   └── fetch-via-window.test.ts
│   ├── fetch-via-window.ts
│   └── preload.ts
├── renderer/
│   ├── app.ts
│   └── __tests__/
│       └── app.test.ts
└── shared/
    ├── ipc-types.ts
    ├── ipc-channels.ts
    └── __tests__/
        └── ipc-channels.test.ts
```

**Priority Test Areas:**
1. **fetch-via-window.ts** (High): Cloudflare detection logic, JSON parsing, error handling
2. **API error handling in main.ts** (High): Session expiration detection, overage/prepaid data merging
3. **Credential validation** (Medium): sessionKey validation, organization ID extraction
4. **IPC channels** (Medium): Type safety of messages, handler invocations
5. **UI state transitions** (Medium): Login flow, expand/collapse, visibility toggles
6. **Usage history** (Low): Data persistence, pruning logic (30-day cutoff)

## Code Review Notes (Testing-Relevant)

**Currently Unmocked Dependencies:**
- Electron APIs: `BrowserWindow`, `session`, `ipcMain`, `ipcRenderer`
- `electron-store` for credential storage
- Real network requests to Claude.ai API
- Real file I/O for icons and assets

**Testing Concerns:**
- Cloudflare detection relies on HTML pattern matching (fragile to API changes)
- Session cookie handling is platform-specific (Windows/macOS/Linux variations)
- Canvas chart rendering (2D context) not testable without DOM/canvas mock
- Electron IPC is inherently tied to native process boundaries

---

*Testing analysis: 2026-02-19*
