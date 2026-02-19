# Coding Conventions

**Analysis Date:** 2026-02-19

## Naming Patterns

**Files:**
- Main process files: kebab-case (e.g., `main.ts`, `fetch-via-window.ts`, `preload.ts`)
- Renderer files: kebab-case (e.g., `app.ts`, `env.d.ts`, `styles.css`)
- Shared modules: kebab-case with descriptive names (e.g., `ipc-types.ts`, `ipc-channels.ts`, `refresh-interval.ts`)
- CSS files: kebab-case (e.g., `styles.css`)

**Functions:**
- camelCase (e.g., `handleConnect()`, `updateUI()`, `fetchUsageData()`, `createMainWindow()`)
- Event handlers use `handle` prefix (e.g., `handleAutoDetect()`, `handleConnect()`)
- Helper functions use descriptive verbs (e.g., `clampRefreshMinutes()`, `buildTrayMenu()`, `updateTrayDisplay()`)
- Setup/creation functions use `setup` or `create` prefix (e.g., `setupEventListeners()`, `createMainWindow()`, `createTray()`)
- Getter/checker functions use `get`, `is`, or `has` prefix (e.g., `getElement()`, `hasNoUsage()`, `getTrayIcon()`)

**Variables:**
- camelCase for local variables and parameters (e.g., `credentials`, `mainWindow`, `isExpanded`, `refreshIntervalMinutes`)
- UPPER_SNAKE_CASE for constants (e.g., `WIDGET_WIDTH`, `STATUS_BAR_HEIGHT`, `DEBUG`, `DEFAULT_REFRESH_MINUTES`)
- Prefix boolean variables with `is` (e.g., `isQuitting`, `isDev`, `isExpanded`, `isPieVisible`)
- Use `_` prefix to intentionally ignore values in destructuring (e.g., `(_event: Event, ...)`)

**Types & Interfaces:**
- PascalCase for types and interfaces (e.g., `Credentials`, `UsageData`, `TrayUsageStats`, `StoreSchema`)
- Use `Result` suffix for operation result types (e.g., `ValidationResult`, `DetectSessionResult`)
- Use `Payload` suffix for IPC message payloads (e.g., `SaveCredentialsPayload`)
- Use `Config` suffix for configuration objects (e.g., `ExtraRowConfig`)

## Code Style

**Formatting:**
- No explicit linter (ESLint/Prettier) configured
- Target: TypeScript with strict type checking enabled (all TypeScript configs use `"strict": true`)
- Line length: No hard limit observed, but code tends to stay under 100 characters
- Indentation: 2 spaces
- Semicolons: Always present
- Trailing commas: Used in multiline objects/arrays

**TypeScript Configuration:**
- Main process (`tsconfig.main.json`):
  - Target: ES2022
  - Module: CommonJS
  - Strict mode: enabled
  - Source maps and declarations enabled for debugging

- Renderer process (`tsconfig.renderer.json`):
  - Target: ES2022
  - Module: ESNext (for Vite bundling)
  - Module resolution: bundler (Vite-aware)
  - Strict mode: enabled

## Import Organization

**Order:**
1. Electron and Node.js built-ins (e.g., `import { app, BrowserWindow } from 'electron'`, `import path from 'path'`)
2. Third-party packages (e.g., `import Store from 'electron-store'`)
3. Local relative imports from same module (e.g., `import { fetchViaWindow } from './fetch-via-window'`)
4. Local shared imports (e.g., `import { IpcChannels } from '../shared/ipc-channels'`)
5. Type imports separated with `import type` (e.g., `import type { Credentials, UsageData } from '../shared/ipc-types'`)

**Path Aliases:**
- `@shared` maps to `src/shared/` (defined in `vite.config.ts`)
- Used selectively in renderer code for clarity

## Error Handling

**Patterns:**
- Use try-catch blocks with typed error variables (e.g., `const err = error as Error`)
- Catch errors with `catch (error)` and check message content (e.g., `err.message.includes('SessionExpired')`)
- Throw descriptive Error instances with user-friendly messages
- Silent failures for optional operations with comments (e.g., `catch { /* ignore */ }`)
- Error detection by signature matching (e.g., in `fetch-via-window.ts`, detect Cloudflare blocks via HTML patterns)

**Error Propagation:**
- IPC handlers throw errors that propagate to renderer as rejected promises
- Main process catches API errors and sends session-expired signals via IPC
- Renderer catches IPC errors and shows user-friendly messages in UI

**Example Error Handling Pattern** (`src/main/main.ts` lines 521-599):
```typescript
try {
  const data = usageResult.value as UsageData
  // Handle data
} catch (error) {
  const err = error as Error
  console.error('Operation failed:', err.message)
  if (err.message.startsWith('SessionExpired')) {
    // Handle specific error case
  }
  throw error // Re-throw for caller to handle
}
```

## Logging

**Framework:** Native `console` object only (no external logging library)

**Patterns:**
- Debug logging controlled via `DEBUG` environment variable (`DEBUG_LOG=1`) or URL search params (`?debug`)
- Development logs prefixed with `[Debug]` label
- Production: Only critical errors logged (via `console.error()`)
- Debug functions check flag before executing: `if (DEBUG) console.log(...)`
- Renderer debug logs only show in DevTools when debug mode active
- Main process can forward debug logs to renderer via IPC

**Example Debug Pattern** (`src/main/main.ts` lines 49-56):
```typescript
const DEBUG = process.env.DEBUG_LOG === '1' || process.argv.includes('--debug')
function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log('[Debug]', ...args)
}
function debugLogToRenderer(label: string, data: unknown): void {
  if (!DEBUG) return
  console.log('[Debug]', label, JSON.stringify(data, null, 2))
  mainWindow?.webContents.send(IpcChannels.DEBUG_LOG, label, data)
}
```

## Comments

**When to Comment:**
- Complex algorithms or non-obvious code paths (e.g., Cloudflare detection logic in `fetch-via-window.ts`)
- Platform-specific behavior (e.g., macOS vibrancy, template image handling)
- Important architectural decisions (e.g., why embedded login is not used)
- TODO/FIXME notes for future work (not currently present in codebase)
- Inline comments for state management (e.g., "Cached usage stats for tray display")

**JSDoc/TSDoc:**
- Minimal usage, but function-level comments used for complex logic
- Example: `fetch-via-window.ts` has multiline docstring explaining purpose
- Type definitions in `ipc-types.ts` and `ipc-channels.ts` lack individual JSDoc, but are self-documenting

## Functions Design

**Size:** Functions typically 10-50 lines; complex handlers may reach 60-80 lines

**Parameters:**
- Destructuring used for object parameters (e.g., `{ sessionKey, organizationId }`)
- Event handlers follow Electron convention with unused parameters prefixed with `_` (e.g., `(_event: Electron.IpcMainEvent, ...)`)
- Optional parameters use `?` (e.g., `organizationId?: string`)

**Return Values:**
- Async functions return `Promise<T>` or `Promise<void>`
- Event listeners return `void`
- Handlers return promises for IPC invoke calls
- Helper functions return typed values or void

**Function Organization in Files:**
- `src/main/main.ts`: Constants and types at top, helper functions in logical groups, IPC handlers in middle, app lifecycle at bottom
- `src/renderer/app.ts`: State declarations at top, helper functions, event setup, then logical feature handlers
- `src/shared/*`: Pure data types and constants with no functions

## Module Design

**Exports:**
- Named exports for functions and types (no default exports)
- Constants exported as `const` (e.g., `export const IpcChannels = { ... }`)
- Type definitions use `export interface` and `export type`

**Barrel Files:**
- No barrel files (index.ts) used in this project
- Each module imports directly from source files

**Dependencies:**
- Shared code in `src/shared/` for types and constants used across main/renderer
- One-way dependency: renderer depends on main via IPC, main does not depend on renderer
- Preload bridge in `src/main/preload.ts` maps all IPC channels for type safety

## Immutability

**Patterns:**
- Store updates via spread operator (not direct mutation)
- Example: `const history = store.get('usageHistory', []) as UsageHistoryEntry[]` followed by `history.push()` then `store.set()`
- DOM element replacements use `innerHTML = ''` to clear, then append
- State variables reassigned, never mutated in place

## Input Validation

**Pattern:**
- Explicit validation before IPC calls (e.g., trim and check empty in `handleConnect()`)
- Type-level validation via TypeScript strict mode
- Range validation with clamp functions (e.g., `clampRefreshMinutes()`)
- No external validation library (Zod) used; validation is inline

**Example** (`src/renderer/app.ts` lines 309-314):
```typescript
async function handleConnect(): Promise<void> {
  const sessionKey = elements.sessionKeyInput.value.trim()
  if (!sessionKey) {
    elements.sessionKeyError.textContent = 'Please paste your session key'
    return
  }
  // ... proceed with validation
}
```

---

*Convention analysis: 2026-02-19*
