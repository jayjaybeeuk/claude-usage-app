/**
 * tauri-api.ts
 *
 * Implements the ElectronAPI surface (see @shared/ipc-types) on top of
 * Tauri commands and events, and installs it as window.electronAPI so the
 * rest of the renderer is unchanged from the Electron version.
 *
 * This module must be imported before any code that touches
 * window.electronAPI (it is the first import in app.ts).
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type {
  CachedCodexUsageData,
  CachedUsageData,
  CodexCredentials,
  CodexUsageData,
  Credentials,
  DetectCodexResult,
  DetectSessionResult,
  ElectronAPI,
  OrganizationInfo,
  SaveCodexCredentialsPayload,
  SaveCredentialsPayload,
  TrayUsageStats,
  UsageData,
  UsageHistoryEntry,
  ValidationResult,
  WindowBounds,
  WindowPosition,
} from '../shared/ipc-types'

// Tauri command errors arrive as plain strings; the renderer expects
// Error objects with a .message (e.g. err.message === 'SessionExpired').
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

function detectPlatform(): string {
  const ua = navigator.userAgent
  if (ua.includes('Macintosh') || ua.includes('Mac OS')) return 'darwin'
  if (ua.includes('Windows')) return 'win32'
  return 'linux'
}

const api: ElectronAPI = {
  // Credentials management
  getCredentials: () => call<Credentials>('get_credentials'),
  saveCredentials: (credentials: SaveCredentialsPayload) =>
    call<boolean>('save_credentials', {
      sessionKey: credentials.sessionKey,
      organizationId: credentials.organizationId ?? null,
    }),
  deleteCredentials: () => call<boolean>('delete_credentials'),
  validateSessionKey: (sessionKey: string) =>
    call<ValidationResult>('validate_session_key', { sessionKey }),
  detectSessionKey: () => call<DetectSessionResult>('detect_session_key'),

  // Window controls
  minimizeWindow: () => void call('minimize_window'),
  closeWindow: () => void call('close_window'),
  resizeWindow: (height: number) => void call('resize_window', { height }),

  // Window position
  getWindowPosition: () => call<WindowBounds | null>('get_window_position'),
  setWindowPosition: (position: WindowPosition) =>
    call<boolean>('set_window_position', { x: position.x, y: position.y }),

  // Event listeners (main -> renderer)
  onRefreshUsage: (callback: () => void) => {
    void listen('refresh-usage', () => callback())
  },
  onSessionExpired: (callback: () => void) => {
    void listen('session-expired', () => callback())
  },
  onDebugLog: (callback: (label: string, data: unknown) => void) => {
    void listen<{ label: string; data: unknown }>('debug-log', (event) =>
      callback(event.payload.label, event.payload.data),
    )
  },

  // API
  fetchUsageData: () => call<UsageData>('fetch_usage_data'),
  getCachedUsage: () => call<CachedUsageData | null>('get_cached_usage'),
  getOrganizations: () => call<OrganizationInfo[]>('get_organizations'),
  fetchUsageDataForOrg: (organizationId: string) =>
    call<UsageData>('fetch_usage_for_org', { organizationId }),
  openExternal: (url: string) => void call('open_external', { url }),
  updateTrayUsage: (stats: TrayUsageStats) => void call('update_tray_usage', { stats }),

  // Usage history
  getUsageHistory: () => call<UsageHistoryEntry[]>('get_usage_history'),
  saveUsageHistoryEntry: (entry: UsageHistoryEntry) =>
    call<boolean>('save_usage_history_entry', { entry }),
  clearUsageHistory: () => call<boolean>('clear_usage_history'),

  // Settings
  getRefreshIntervalMinutes: () => call<number>('get_refresh_interval'),
  setRefreshIntervalMinutes: (minutes: number) =>
    call<number>('set_refresh_interval', { minutes }),

  // Auto-start settings
  isAutoStartSupported: () => call<boolean>('is_auto_start_supported'),
  getAutoStart: () => call<boolean>('get_auto_start'),
  setAutoStart: (enabled: boolean) => call<boolean>('set_auto_start', { enabled }),

  // Theme settings
  getTheme: () => call<string>('get_theme'),
  setTheme: (theme: string) => call<string>('set_theme', { theme }),
  getBackgroundHue: () => call<string>('get_background_hue'),
  setBackgroundHue: (backgroundHue: string) =>
    call<string>('set_background_hue', { backgroundHue }),

  // Platform info
  getPlatform: () => call<string>('get_platform'),
  platform: detectPlatform(),

  // Codex
  getCodexCredentials: () => call<CodexCredentials>('get_codex_credentials'),
  saveCodexCredentials: (credentials: SaveCodexCredentialsPayload) =>
    call<boolean>('save_codex_credentials', {
      accessToken: credentials.accessToken,
      cookieName: credentials.cookieName ?? null,
    }),
  deleteCodexCredentials: () => call<boolean>('delete_codex_credentials'),
  detectCodexToken: () => call<DetectCodexResult>('detect_codex_token'),
  fetchCodexUsageData: () => call<CodexUsageData>('fetch_codex_usage'),
  getCachedCodexUsage: () => call<CachedCodexUsageData | null>('get_cached_codex_usage'),
  onCodexSessionExpired: (callback: () => void) => {
    void listen('codex-session-expired', () => callback())
  },
}

window.electronAPI = api

// Dev-only: forward errors to the Vite terminal (see clientLogSink in
// vite.config.ts) since the embedded webview console is not visible.
if (import.meta.env.DEV && !import.meta.env.TEST) {
  const forward = (msg: string) => {
    void fetch('/__client-log', { method: 'POST', body: msg }).catch(() => {})
  }
  window.addEventListener('error', (e) => forward(`error: ${e.message} @ ${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => forward(`unhandledrejection: ${String(e.reason)}`))
  forward('tauri-api shim installed')
}

// Title-bar dragging. Electron used CSS -webkit-app-region; in Tauri the
// window drag is started explicitly on mousedown (excluding the controls).
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (!target.closest('.title-bar')) return
  if (target.closest('.controls, button, input, select, a')) return
  void getCurrentWindow().startDragging()
})
