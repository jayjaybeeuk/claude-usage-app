/**
 * In-memory fake of the Rust command backend (src-tauri/src). The Tauri
 * `invoke` mock in setup.ts dispatches here, so tests drive the real
 * renderer (tauri-api.ts + app.ts) against controllable command behavior.
 *
 * Rejections are thrown as plain strings, exactly like Tauri command errors,
 * so the Error-wrapping in tauri-api.ts is exercised.
 */
import { vi } from 'vitest'

export interface BackendState {
  credentials: { sessionKey: string | null; organizationId: string | null }
  usageData: unknown
  usageError: string | null
  cachedUsage: unknown
  codexCredentials: { accessToken: string | null }
  codexUsageData: unknown
  codexUsageError: string | null
  cachedCodexUsage: unknown
  history: unknown[]
  refreshInterval: number
  theme: string
  backgroundHue: string
  autoStartSupported: boolean
  autoStart: boolean
  validateResult: unknown
  detectResult: unknown
  detectCodexResult: unknown
  /** Commands listed here reject with the given string (Tauri-style). */
  errors: Record<string, string>
}

export interface Backend {
  state: BackendState
  calls: Record<string, unknown[]>
  listeners: Record<string, (event: { payload: unknown }) => void>
  appWindow: { startDragging: ReturnType<typeof vi.fn> }
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  emit: (event: string, payload?: unknown) => void
  callsFor: (cmd: string) => unknown[]
}

export function createBackend(overrides: Partial<BackendState> = {}): Backend {
  const state: BackendState = {
    credentials: { sessionKey: null, organizationId: null },
    usageData: null,
    usageError: null,
    cachedUsage: null,
    codexCredentials: { accessToken: null },
    codexUsageData: null,
    codexUsageError: null,
    cachedCodexUsage: null,
    history: [],
    refreshInterval: 5,
    theme: 'purple',
    backgroundHue: 'match',
    autoStartSupported: true,
    autoStart: false,
    validateResult: { success: false, error: 'Invalid session key' },
    detectResult: { success: false, error: 'Login window closed' },
    detectCodexResult: { success: false, error: 'Login window closed' },
    errors: {},
    ...overrides,
  }

  const calls: Record<string, unknown[]> = {}
  const listeners: Backend['listeners'] = {}
  const appWindow = { startDragging: vi.fn(() => Promise.resolve()) }

  const clamp = (v: number): number => {
    if (!Number.isFinite(v)) return 5
    return Math.min(20, Math.max(1, Math.round(v)))
  }

  async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    ;(calls[cmd] ??= []).push(args)
    if (state.errors[cmd]) throw state.errors[cmd]
    switch (cmd) {
      // Claude credentials + usage
      case 'get_credentials':
        return state.credentials
      case 'save_credentials':
        state.credentials = {
          sessionKey: args.sessionKey as string,
          organizationId: (args.organizationId as string | null) ?? null,
        }
        return true
      case 'delete_credentials':
        state.credentials = { sessionKey: null, organizationId: null }
        return true
      case 'validate_session_key':
        return state.validateResult
      case 'detect_session_key':
        return state.detectResult
      case 'fetch_usage_data':
        if (state.usageError) throw state.usageError
        if (!state.usageData) throw 'Missing credentials'
        return state.usageData
      case 'get_cached_usage':
        return state.cachedUsage

      // Window controls
      case 'minimize_window':
      case 'close_window':
      case 'resize_window':
      case 'open_external':
      case 'update_tray_usage':
        return undefined
      case 'get_window_position':
        return { x: 10, y: 20, width: 480, height: 174 }
      case 'set_window_position':
        return true
      case 'get_platform':
        return 'darwin'

      // Usage history + settings
      case 'get_usage_history':
        return state.history
      case 'save_usage_history_entry':
        state.history.push(args.entry)
        return true
      case 'clear_usage_history':
        state.history = []
        return true
      case 'get_refresh_interval':
        return state.refreshInterval
      case 'set_refresh_interval':
        state.refreshInterval = clamp(args.minutes as number)
        return state.refreshInterval
      case 'get_theme':
        return state.theme
      case 'set_theme':
        state.theme = args.theme as string
        return state.theme
      case 'get_background_hue':
        return state.backgroundHue
      case 'set_background_hue':
        state.backgroundHue = args.backgroundHue as string
        return state.backgroundHue

      // Auto-start
      case 'is_auto_start_supported':
        return state.autoStartSupported
      case 'get_auto_start':
        return state.autoStart
      case 'set_auto_start':
        state.autoStart = args.enabled as boolean
        return state.autoStart

      // Codex
      case 'get_codex_credentials':
        return state.codexCredentials
      case 'save_codex_credentials':
        state.codexCredentials = { accessToken: args.accessToken as string }
        return true
      case 'delete_codex_credentials':
        state.codexCredentials = { accessToken: null }
        return true
      case 'detect_codex_token':
        return state.detectCodexResult
      case 'fetch_codex_usage':
        if (state.codexUsageError) throw state.codexUsageError
        if (!state.codexUsageData) throw 'Missing Codex credentials'
        return state.codexUsageData
      case 'get_cached_codex_usage':
        return state.cachedCodexUsage

      default:
        throw `${cmd} not allowed. Command not found`
    }
  }

  return {
    state,
    calls,
    listeners,
    appWindow,
    invoke,
    emit: (event, payload = null) => listeners[event]?.({ payload }),
    callsFor: (cmd) => calls[cmd] ?? [],
  }
}

export function backend(): Backend {
  return (globalThis as Record<string, unknown>).__backend as Backend
}

export const flush = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Import the app module fresh (module registry is reset in setup.ts). */
export async function bootApp(): Promise<Backend> {
  await import('../app')
  await flush()
  return backend()
}

export const futureIso = (hours: number): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString()

export function sampleUsage(): Record<string, unknown> {
  return {
    five_hour: { utilization: 42, resets_at: futureIso(2) },
    seven_day: { utilization: 80, resets_at: futureIso(72) },
    seven_day_sonnet: { utilization: 91, resets_at: futureIso(72) },
    seven_day_opus: { utilization: 12, resets_at: futureIso(72) },
    extra_usage: { utilization: 10, used_cents: 500, limit_cents: 5000, balance_cents: 250 },
  }
}

export function sampleCodexUsage(): Record<string, unknown> {
  return {
    five_hour: { utilization: 33, resets_at: futureIso(3) },
    seven_day: { utilization: 55, resets_at: futureIso(100) },
  }
}
