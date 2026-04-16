import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  session,
  shell,
  nativeImage,
  MenuItemConstructorOptions,
} from 'electron'
import path from 'path'
import Store from 'electron-store'
import { fetchViaWindow } from './fetch-via-window'
import { IpcChannels } from '../shared/ipc-channels'
import { DEFAULT_REFRESH_MINUTES, MAX_REFRESH_MINUTES, MIN_REFRESH_MINUTES } from '../shared/refresh-interval'
import fs from 'fs'
import os from 'os'
import type {
  Credentials,
  SaveCredentialsPayload,
  TrayUsageStats,
  UsageHistoryEntry,
  UsageData,
  UsageTimePeriod,
  ExtraUsage,
  WindowPosition,
  CachedUsageData,
  CodexUsageData,
  CachedCodexUsageData,
  CopilotCredentials,
  SaveCopilotCredentialsPayload,
  CopilotUsageData,
  CachedCopilotUsageData,
} from '../shared/ipc-types'

// Resolve project root from compiled output location (dist-main/main/main.js)
const APP_ROOT = path.resolve(__dirname, '..', '..')
const isDev = process.env.NODE_ENV === 'development'

interface StoreSchema {
  sessionKey: string
  organizationId: string
  windowPosition: { x: number; y: number }
  usageHistory: UsageHistoryEntry[]
  refreshIntervalMinutes: number
  theme: string
  backgroundHue: string
  cachedUsageData: UsageData          // latest successful fetch result
  cachedUsageTimestamp: number        // Unix ms timestamp of that fetch
  codexAccessToken: string            // Codex session cookie value
  codexCookieName: string             // Name of the captured auth cookie
  cachedCodexUsageData: CodexUsageData
  cachedCodexUsageTimestamp: number
  copilotAccessToken: string          // GitHub PAT with copilot + Plan:Read-only scopes
  cachedCopilotUsageData: CopilotUsageData
  cachedCopilotUsageTimestamp: number
  autoStartEnabled: boolean           // Whether app should start with system
}

const store = new Store<StoreSchema>({
  encryptionKey: 'claude-widget-secure-key-2024',
})

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

// Debug mode: set DEBUG_LOG=1 env var or pass --debug flag to see verbose logs.
// Regular users will only see critical errors in the console.
const DEBUG = process.env.DEBUG_LOG === '1' || process.argv.includes('--debug')
function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log('[Debug]', ...args)
}
function debugLogToRenderer(label: string, data: unknown): void {
  if (!DEBUG) return
  console.log('[Debug]', label, JSON.stringify(data, null, 2))
  mainWindow?.webContents.send(IpcChannels.DEBUG_LOG, label, data)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const WIDGET_WIDTH = 480
const STATUS_BAR_HEIGHT = 34
const WIDGET_HEIGHT = 140 + STATUS_BAR_HEIGHT

// Platform-specific User-Agent
const USER_AGENT = isMac
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Set session-level User-Agent to avoid Electron detection
app.on('ready', () => {
  session.defaultSession.setUserAgent(USER_AGENT)
})

// Platform-specific icon
function getAppIcon(): string {
  if (isWindows) {
    return path.join(APP_ROOT, 'assets/icon.ico')
  }
  if (isMac) {
    return path.join(APP_ROOT, 'assets/icon.icns')
  }
  return path.join(APP_ROOT, 'assets/icon.png')
}

// Set sessionKey as a cookie in Electron's session
async function setSessionCookie(sessionKey: string): Promise<void> {
  await session.defaultSession.cookies.set({
    url: 'https://claude.ai',
    name: 'sessionKey',
    value: sessionKey,
    domain: '.claude.ai',
    path: '/',
    secure: true,
    httpOnly: true,
  })
  debugLog('sessionKey cookie set in Electron session')
}

async function setCodexCookie(cookieName: string, token: string): Promise<void> {
  await session.defaultSession.cookies.set({
    url: 'https://chatgpt.com',
    name: cookieName,
    value: normalizeBearerToken(token),
    domain: '.chatgpt.com',
    path: '/',
    secure: true,
    httpOnly: true,
  })
  debugLog(`Codex cookie set in Electron session (${cookieName})`)
}

// Get tray icon (macOS uses template images for proper dark/light menu bar support)
function getTrayIcon(): Electron.NativeImage | string {
  if (isMac) {
    // On macOS, create a properly sized template image for the menu bar
    // Template images automatically adapt to dark/light menu bar
    const icon = nativeImage.createFromPath(path.join(APP_ROOT, 'assets/tray-icon.png'))
    const resized = icon.resize({ width: 18, height: 18 })
    resized.setTemplateImage(true)
    return resized
  }
  return path.join(APP_ROOT, 'assets/tray-icon.png')
}

function clampRefreshMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REFRESH_MINUTES
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, Math.round(value)))
}

function createMainWindow(): void {
  const savedPosition = store.get('windowPosition') as { x: number; y: number } | undefined
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    icon: getAppIcon(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  }

  // macOS-specific window options
  if (isMac) {
    windowOptions.vibrancy = 'under-window'
    windowOptions.visualEffectState = 'active'
    windowOptions.roundedCorners = true
    // Hide from Cmd+Tab app switcher while keeping tray/dock presence
    windowOptions.skipTaskbar = true
  }

  // Apply saved position if it exists
  if (savedPosition) {
    windowOptions.x = savedPosition.x
    windowOptions.y = savedPosition.y
  }

  mainWindow = new BrowserWindow(windowOptions)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(APP_ROOT, 'dist-renderer/index.html'))
  }

  // Make window draggable and always on top
  mainWindow.setAlwaysOnTop(true, 'floating')
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  mainWindow.on('move', () => {
    if (!mainWindow) return
    const position = mainWindow.getBounds()
    store.set('windowPosition', { x: position.x, y: position.y })
  })

  // On close button, hide to tray instead of quitting (unless app is exiting)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// Cached usage stats for tray display
let latestTrayStats: TrayUsageStats | null = null

function buildTrayMenu(): Electron.Menu {
  const items: MenuItemConstructorOptions[] = []

  // Agent Usage stats
  if (latestTrayStats) {
    items.push({ label: 'Claude', enabled: false })
    items.push({
      label: `  Session:  ${Math.round(latestTrayStats.session)}%`,
      enabled: false,
    })
    items.push({
      label: `  Weekly:   ${Math.round(latestTrayStats.weekly)}%`,
      enabled: false,
    })
    if (latestTrayStats.sonnet > 0) {
      items.push({
        label: `  Sonnet:   ${Math.round(latestTrayStats.sonnet)}%`,
        enabled: false,
      })
    }
    // Codex stats
    if (latestTrayStats.codexSession !== undefined || latestTrayStats.codexWeekly !== undefined) {
      items.push({ type: 'separator' })
      items.push({ label: 'Codex', enabled: false })
      if (latestTrayStats.codexSession !== undefined) {
        items.push({
          label: `  Session:  ${Math.round(latestTrayStats.codexSession)}%`,
          enabled: false,
        })
      }
      if (latestTrayStats.codexWeekly !== undefined) {
        items.push({
          label: `  Weekly:   ${Math.round(latestTrayStats.codexWeekly)}%`,
          enabled: false,
        })
      }
    }
    items.push({ type: 'separator' })
  }

  items.push(
    {
      label: 'Show Widget',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          if (isMac) mainWindow.focus()
        } else {
          createMainWindow()
        }
      },
    },
    {
      label: 'Refresh',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send(IpcChannels.REFRESH_USAGE)
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Log Out',
      click: async () => {
        store.delete('sessionKey' as keyof StoreSchema)
        store.delete('organizationId' as keyof StoreSchema)
        const cookies = await session.defaultSession.cookies.get({ url: 'https://claude.ai' })
        for (const cookie of cookies) {
          await session.defaultSession.cookies.remove('https://claude.ai', cookie.name)
        }
        await session.defaultSession.clearStorageData({
          storages: ['localstorage', 'cachestorage'],
          origin: 'https://claude.ai',
        })
        if (mainWindow) {
          mainWindow.webContents.send(IpcChannels.SESSION_EXPIRED)
        }
        latestTrayStats = null
        updateTrayDisplay()
      },
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true
        if (tray) {
          tray.destroy()
          tray = null
        }
        app.quit()
      },
    },
  )

  return Menu.buildFromTemplate(items)
}

function updateTrayDisplay(): void {
  if (!tray) return

  if (isMac && latestTrayStats) {
    const claudePct = `${Math.round(latestTrayStats.weekly)}%`
    const hasCodex =
      latestTrayStats.codexSession !== undefined || latestTrayStats.codexWeekly !== undefined
    const codexPct =
      latestTrayStats.codexSession !== undefined
        ? ` ✦${Math.round(latestTrayStats.codexSession)}%`
        : ''
    tray.setTitle(hasCodex ? `${claudePct}${codexPct}` : claudePct, { fontType: 'monospacedDigit' })
  } else if (isMac) {
    tray.setTitle('')
  }

  tray.setContextMenu(buildTrayMenu())

  if (latestTrayStats) {
    const codexInfo =
      latestTrayStats.codexSession !== undefined
        ? ` | Codex Session: ${Math.round(latestTrayStats.codexSession)}%`
        : ''
    tray.setToolTip(
      `Agent Usage — Claude Session: ${Math.round(latestTrayStats.session)}% | Weekly: ${Math.round(latestTrayStats.weekly)}%${codexInfo}`,
    )
  } else {
    tray.setToolTip('Agent Usage')
  }
}

function createTray(): void {
  try {
    tray = new Tray(getTrayIcon())
    updateTrayDisplay()

    if (!isMac) {
      tray.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide()
          } else {
            mainWindow.show()
          }
        }
      })
    }
  } catch (error) {
    console.error('Failed to create tray:', error)
  }
}

// IPC Handlers
ipcMain.handle(IpcChannels.GET_CREDENTIALS, (): Credentials => {
  return {
    sessionKey: store.get('sessionKey') ?? null,
    organizationId: store.get('organizationId') ?? null,
  }
})

ipcMain.handle(
  IpcChannels.SAVE_CREDENTIALS,
  async (_event: Electron.IpcMainInvokeEvent, { sessionKey, organizationId }: SaveCredentialsPayload) => {
    store.set('sessionKey', sessionKey)
    if (organizationId) {
      store.set('organizationId', organizationId)
    }
    // Also set cookie in Electron session for window-based fetching
    await setSessionCookie(sessionKey)
    return true
  },
)

ipcMain.handle(IpcChannels.DELETE_CREDENTIALS, async () => {
  store.delete('sessionKey' as keyof StoreSchema)
  store.delete('organizationId' as keyof StoreSchema)
  // Remove all Claude.ai cookies
  const cookies = await session.defaultSession.cookies.get({ url: 'https://claude.ai' })
  for (const cookie of cookies) {
    await session.defaultSession.cookies.remove('https://claude.ai', cookie.name)
  }
  // Clear any cached data from the Electron session (storage, cache)
  // so nothing lingers on shared machines
  await session.defaultSession.clearStorageData({
    storages: ['localstorage', 'cachestorage'],
    origin: 'https://claude.ai',
  })
  return true
})

// Validate a sessionKey by fetching org ID via hidden BrowserWindow
ipcMain.handle(
  IpcChannels.VALIDATE_SESSION_KEY,
  async (_event: Electron.IpcMainInvokeEvent, sessionKey: string) => {
    debugLog('Validating session key:', sessionKey.substring(0, 20) + '...')
    try {
      // Set the cookie in Electron's session first
      await setSessionCookie(sessionKey)

      // Fetch organizations using hidden BrowserWindow (bypasses Cloudflare)
      const data = (await fetchViaWindow('https://claude.ai/api/organizations')) as
        | Array<{ uuid?: string; id?: string }>
        | { error?: { message?: string } | string }

      if (Array.isArray(data) && data.length > 0) {
        const orgId = data[0].uuid || data[0].id
        debugLog('Session key validated, org ID:', orgId)
        return { success: true, organizationId: orgId }
      }

      // Check if it's an error response
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        const errorMsg = typeof data.error === 'string' ? data.error : data.error.message || String(data.error)
        return { success: false, error: errorMsg }
      }

      return { success: false, error: 'No organization found' }
    } catch (error) {
      const err = error as Error
      console.error('Session key validation failed:', err.message)
      // Clean up the invalid cookie
      await session.defaultSession.cookies.remove('https://claude.ai', 'sessionKey')
      return { success: false, error: err.message }
    }
  },
)

ipcMain.on(IpcChannels.MINIMIZE_WINDOW, () => {
  if (mainWindow) mainWindow.hide()
})

ipcMain.on(IpcChannels.CLOSE_WINDOW, () => {
  // Hide to tray on all platforms (X button = minimize to tray)
  if (mainWindow) mainWindow.hide()
})

ipcMain.handle(IpcChannels.GET_PLATFORM, () => {
  return process.platform
})

ipcMain.on(IpcChannels.RESIZE_WINDOW, (_event: Electron.IpcMainEvent, height: number) => {
  if (mainWindow) {
    mainWindow.setContentSize(WIDGET_WIDTH, height)
  }
})

ipcMain.handle(IpcChannels.GET_WINDOW_POSITION, () => {
  if (mainWindow) {
    return mainWindow.getBounds()
  }
  return null
})

ipcMain.handle(IpcChannels.SET_WINDOW_POSITION, (_event: Electron.IpcMainInvokeEvent, { x, y }: WindowPosition) => {
  if (mainWindow) {
    mainWindow.setPosition(x, y)
    return true
  }
  return false
})

ipcMain.on(IpcChannels.OPEN_EXTERNAL, (_event: Electron.IpcMainEvent, url: string) => {
  shell.openExternal(url)
})

// Update tray with latest usage stats from renderer
ipcMain.on(IpcChannels.UPDATE_TRAY_USAGE, (_event: Electron.IpcMainEvent, stats: TrayUsageStats) => {
  latestTrayStats = stats
  updateTrayDisplay()
})

// Usage history storage (30-day retention)
ipcMain.handle(IpcChannels.GET_USAGE_HISTORY, () => {
  return store.get('usageHistory', [])
})

ipcMain.handle(IpcChannels.CLEAR_USAGE_HISTORY, () => {
  store.set('usageHistory', [])
  return true
})

ipcMain.handle(IpcChannels.GET_REFRESH_INTERVAL, () => {
  const saved = store.get('refreshIntervalMinutes', DEFAULT_REFRESH_MINUTES)
  return clampRefreshMinutes(saved)
})

ipcMain.handle(IpcChannels.SET_REFRESH_INTERVAL, (_event: Electron.IpcMainInvokeEvent, minutes: number) => {
  const clamped = clampRefreshMinutes(minutes)
  store.set('refreshIntervalMinutes', clamped)
  return clamped
})

// Theme functionality
ipcMain.handle(IpcChannels.GET_THEME, () => {
  return store.get('theme', 'purple')
})

ipcMain.handle(IpcChannels.SET_THEME, (_event: Electron.IpcMainInvokeEvent, theme: string) => {
  const validThemes = ['purple', 'lilac', 'orange', 'green', 'metallic']
  const validTheme = validThemes.includes(theme) ? theme : 'purple'
  store.set('theme', validTheme)
  return validTheme
})

ipcMain.handle(IpcChannels.GET_BACKGROUND_HUE, () => {
  return store.get('backgroundHue', 'match')
})

ipcMain.handle(IpcChannels.SET_BACKGROUND_HUE, (_event: Electron.IpcMainInvokeEvent, backgroundHue: string) => {
  const validBackgroundHues = ['match', 'purple', 'lilac', 'orange', 'green', 'metallic']
  const validBackgroundHue = validBackgroundHues.includes(backgroundHue) ? backgroundHue : 'match'
  store.set('backgroundHue', validBackgroundHue)
  return validBackgroundHue
})

// Auto-start functionality
function isAutoStartSupported(): boolean {
  // Electron's setLoginItemSettings is supported on Windows, macOS, and some Linux distributions
  return process.platform === 'win32' || process.platform === 'darwin'
}

function getAutoStartEnabled(): boolean {
  if (!isAutoStartSupported()) return false
  return store.get('autoStartEnabled', false)
}

function setAutoStartEnabled(enabled: boolean): boolean {
  if (!isAutoStartSupported()) return false
  
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: false
    })
    store.set('autoStartEnabled', enabled)
    return enabled
  } catch (error) {
    debugLog('Failed to set auto-start:', error)
    return false
  }
}

ipcMain.handle(IpcChannels.IS_AUTO_START_SUPPORTED, () => {
  return isAutoStartSupported()
})

ipcMain.handle(IpcChannels.GET_AUTO_START, () => {
  return getAutoStartEnabled()
})

ipcMain.handle(IpcChannels.SET_AUTO_START, (_event: Electron.IpcMainInvokeEvent, enabled: boolean) => {
  return setAutoStartEnabled(enabled)
})

ipcMain.handle(
  IpcChannels.SAVE_USAGE_HISTORY_ENTRY,
  (_event: Electron.IpcMainInvokeEvent, entry: UsageHistoryEntry) => {
    const history = store.get('usageHistory', []) as UsageHistoryEntry[]
    history.push(entry)
    // Prune entries older than 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const pruned = history.filter((e) => e.timestamp >= cutoff)
    store.set('usageHistory', pruned)
    return true
  },
)

// Open a visible BrowserWindow for the user to log in to Claude.ai.
//
// Why we don't embed login directly in the app:
// Claude.ai (via Cloudflare) detects and blocks Electron-embedded logins.
// Instead, we open a standalone browser window, let the user authenticate
// normally, then capture the sessionKey cookie once login completes.
// Do NOT attempt to "fix" this back to an embedded login without verifying
// that Claude.ai/Cloudflare no longer blocks it.
ipcMain.handle(IpcChannels.DETECT_SESSION_KEY, async () => {
  // Clear any leftover sessionKey cookie
  try {
    await session.defaultSession.cookies.remove('https://claude.ai', 'sessionKey')
  } catch {
    /* ignore */
  }

  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: 'Log in to Claude',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    let resolved = false

    // Listen for sessionKey cookie being set after login
    const onCookieChanged = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ): void => {
      if (cookie.name === 'sessionKey' && cookie.domain?.includes('claude.ai') && !removed && cookie.value) {
        resolved = true
        session.defaultSession.cookies.removeListener('changed', onCookieChanged)
        loginWin.close()
        resolve({ success: true, sessionKey: cookie.value })
      }
    }

    session.defaultSession.cookies.on('changed', onCookieChanged)

    loginWin.on('closed', () => {
      session.defaultSession.cookies.removeListener('changed', onCookieChanged)
      if (!resolved) {
        resolve({ success: false, error: 'Login window closed' })
      }
    })

    loginWin.loadURL('https://claude.ai/login')
  })
})

ipcMain.handle(IpcChannels.FETCH_USAGE_DATA, async () => {
  const sessionKey = store.get('sessionKey') as string | undefined
  const organizationId = store.get('organizationId') as string | undefined

  if (!sessionKey || !organizationId) {
    throw new Error('Missing credentials')
  }

  // Ensure cookie is set
  await setSessionCookie(sessionKey)

  const usageUrl = `https://claude.ai/api/organizations/${organizationId}/usage`
  const overageUrl = `https://claude.ai/api/organizations/${organizationId}/overage_spend_limit`
  const prepaidUrl = `https://claude.ai/api/organizations/${organizationId}/prepaid/credits`

  // Fetch all endpoints in parallel. Usage is required; overage and prepaid are optional.
  const [usageResult, overageResult, prepaidResult] = await Promise.allSettled([
    fetchViaWindow(usageUrl),
    fetchViaWindow(overageUrl),
    fetchViaWindow(prepaidUrl),
  ])

  // Usage endpoint is mandatory
  if (usageResult.status === 'rejected') {
    const error = usageResult.reason as Error
    debugLog('API request failed:', error.message)
    const isBlocked =
      error.message.startsWith('CloudflareBlocked') ||
      error.message.startsWith('CloudflareChallenge') ||
      error.message.startsWith('UnexpectedHTML')
    if (isBlocked) {
      store.delete('sessionKey' as keyof StoreSchema)
      store.delete('organizationId' as keyof StoreSchema)
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.SESSION_EXPIRED)
      }
      throw new Error('SessionExpired')
    }
    throw error
  }

  const data = usageResult.value as UsageData
  debugLogToRenderer('Raw usage API response:', data)

  const toNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }

  const normalizeExtraUsage = (source: Record<string, unknown> | undefined): ExtraUsage | undefined => {
    if (!source) return undefined
    const limit = toNumber(source.monthly_limit ?? source.monthly_credit_limit ?? source.spend_limit_amount_cents ?? source.limit_cents)
    const used = toNumber(source.used_credits ?? source.used_credit ?? source.used_cents ?? source.balance_cents)
    const utilization = toNumber(source.utilization)
    const enabled = source.is_enabled !== undefined ? Boolean(source.is_enabled) : limit != null

    if (!enabled || typeof limit !== 'number' || limit <= 0 || typeof used !== 'number' || used < 0) {
      return undefined
    }

    return {
      utilization: utilization ?? (used / limit) * 100,
      resets_at: null,
      used_cents: used,
      limit_cents: limit,
    } satisfies ExtraUsage
  }

  // Prefer spending values already present in the primary usage response.
  const usageExtraSource =
    data.extra_usage && typeof data.extra_usage === 'object' ? (data.extra_usage as unknown as Record<string, unknown>) : undefined
  const normalizedFromUsage = normalizeExtraUsage(usageExtraSource)
  if (normalizedFromUsage) {
    data.extra_usage = {
      ...(data.extra_usage ?? {}),
      ...normalizedFromUsage,
    }
  }

  // Merge overage spending data into data.extra_usage
  if (overageResult.status === 'fulfilled' && overageResult.value) {
    const overage = overageResult.value as Record<string, unknown>
    debugLogToRenderer('Raw overage API response:', overage)
    const normalizedFromOverage = normalizeExtraUsage(overage)
    const hasUsageSpending = data.extra_usage?.used_cents != null && data.extra_usage?.limit_cents != null
    // Only fall back to overage API if usage response did not include spending fields.
    if (!hasUsageSpending && normalizedFromOverage) {
      data.extra_usage = {
        ...(data.extra_usage ?? {}),
        ...normalizedFromOverage,
      }
    }
  } else if (overageResult.status === 'rejected') {
    debugLog('Overage fetch skipped or failed:', (overageResult.reason as Error)?.message || 'no data')
  }

  // Merge prepaid balance into data.extra_usage
  if (prepaidResult.status === 'fulfilled' && prepaidResult.value) {
    const prepaid = prepaidResult.value as Record<string, unknown>
    debugLogToRenderer('Raw prepaid API response:', prepaid)
    if (typeof prepaid.amount === 'number') {
      if (!data.extra_usage) data.extra_usage = {}
      data.extra_usage.balance_cents = prepaid.amount
    }
  } else if (prepaidResult.status === 'rejected') {
    debugLog('Prepaid fetch skipped or failed:', (prepaidResult.reason as Error)?.message || 'no data')
  }

  store.set('cachedUsageData', data)
  store.set('cachedUsageTimestamp', Date.now())
  return data
})

ipcMain.handle(IpcChannels.GET_CACHED_USAGE, (): CachedUsageData | null => {
  const data = store.get('cachedUsageData') as UsageData | undefined
  const timestamp = store.get('cachedUsageTimestamp') as number | undefined
  if (!data || !timestamp) return null
  return { data, timestamp }
})

// ─── Codex IPC Handlers ───────────────────────────────────────────────────────

// Parse raw wham/usage response into CodexUsageData
function parseCodexUsageResponse(raw: Record<string, unknown>): CodexUsageData {
  const result: CodexUsageData = {}

  // Preferred shape:
  // {
  //   primary_window: { used_percent, reset_at|reset_after_seconds, ... },
  //   secondary_window: { used_percent, reset_at|reset_after_seconds, ... }
  // }
  // Fallback shape:
  // { usage_windows: [{ window_type: 'primary'|'secondary', utilization, resets_at }] }

  const clampPercent = (value: unknown): number | undefined => {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (!Number.isFinite(numeric)) return undefined
    return Math.max(0, Math.min(100, numeric))
  }

  const normalizeResetsAt = (resetAt: unknown, resetAfterSeconds: unknown): string | null => {
    if (typeof resetAt === 'string' && resetAt) return resetAt
    if (typeof resetAt === 'number' && Number.isFinite(resetAt)) {
      // API usually returns Unix seconds.
      const ms = resetAt > 1e12 ? resetAt : resetAt * 1000
      return new Date(ms).toISOString()
    }
    if (typeof resetAfterSeconds === 'number' && Number.isFinite(resetAfterSeconds)) {
      return new Date(Date.now() + resetAfterSeconds * 1000).toISOString()
    }
    return null
  }

  const extractUsedWindow = (window: unknown): UsageTimePeriod | undefined => {
    if (!window || typeof window !== 'object') return undefined
    const record = window as Record<string, unknown>
    const usedPercent = clampPercent(record.used_percent ?? record.user_percent)
    if (usedPercent === undefined) return undefined
    return {
      utilization: usedPercent,
      resets_at: normalizeResetsAt(record.reset_at, record.reset_after_seconds),
    }
  }

  // Legacy fallback where utilization appears to represent remaining capacity.
  const toUsedPercent = (value: unknown): number | undefined => {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (!Number.isFinite(numeric)) return undefined
    const pct = numeric <= 1 ? numeric * 100 : numeric
    return Math.max(0, Math.min(100, 100 - pct))
  }

  const findWindowRoot = (input: unknown): Record<string, unknown> | null => {
    if (!input || typeof input !== 'object') return null
    const seen = new Set<unknown>()
    const queue: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      const { value, depth } = current
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 3) continue
      seen.add(value)
      const record = value as Record<string, unknown>
      if (record.primary_window || record.secondary_window || record.usage_windows) {
        return record
      }
      for (const child of Object.values(record)) {
        if (child && typeof child === 'object') {
          queue.push({ value: child, depth: depth + 1 })
        }
      }
    }
    return null
  }

  const root = findWindowRoot(raw) ?? raw

  const primary = extractUsedWindow(root.primary_window)
  const secondary = extractUsedWindow(root.secondary_window)
  if (primary) result.five_hour = primary
  if (secondary) result.seven_day = secondary
  if (primary || secondary) return result

  // Also handle flat fields as fallback
  const windows = root.usage_windows as Array<Record<string, unknown>> | undefined

  if (Array.isArray(windows)) {
    for (const w of windows) {
      const utilization = clampPercent(w.used_percent ?? w.user_percent) ?? toUsedPercent(w.utilization)
      const resets_at = normalizeResetsAt(w.resets_at ?? w.reset_at, w.reset_after_seconds)
      if (w.window_type === 'primary' || w.window_type === '5h') {
        result.five_hour = { utilization, resets_at }
      } else if (w.window_type === 'secondary' || w.window_type === 'weekly' || w.window_type === '7d') {
        result.seven_day = { utilization, resets_at }
      }
    }
  } else {
    // Flat fallback — try common field names
    const sessionUtil = root.session_utilization ?? root.five_hour_utilization
    const weeklyUtil = root.weekly_utilization ?? root.seven_day_utilization
    const normalizedSession = toUsedPercent(sessionUtil)
    const normalizedWeekly = toUsedPercent(weeklyUtil)
    if (normalizedSession !== undefined) {
      result.five_hour = {
        utilization: normalizedSession,
        resets_at: (root.session_resets_at as string | null) ?? null,
      }
    }
    if (normalizedWeekly !== undefined) {
      result.seven_day = {
        utilization: normalizedWeekly,
        resets_at: (root.weekly_resets_at as string | null) ?? null,
      }
    }
  }

  return result
}

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_LOGIN_URL = 'https://chatgpt.com/login'
const CODEX_TOKEN_COOKIES = [
  '__Secure-next-auth.session-token',
  'next-auth.session-token',
  '__Secure-authjs.session-token',
  'authjs.session-token',
]
const CODEX_COOKIE_SCAN_URLS = [
  'https://chatgpt.com',
  'https://auth.openai.com',
  'https://openai.com',
]

type CodexAuthAttempt = { kind: 'bearer' } | { kind: 'cookie'; cookieName: string }

function normalizeBearerToken(token: string): string {
  return token.replace(/^Bearer\s+/i, '').trim()
}

function isCodexCookieDomain(domain?: string): boolean {
  if (!domain) return false
  const normalized = domain.replace(/^\./, '').toLowerCase()
  return normalized === 'chatgpt.com' || normalized.endsWith('.chatgpt.com') ||
    normalized === 'openai.com' || normalized.endsWith('.openai.com')
}

function isCodexSessionCookie(cookie: Pick<Electron.Cookie, 'name' | 'domain' | 'value'>): boolean {
  return Boolean(cookie.value && CODEX_TOKEN_COOKIES.includes(cookie.name) && isCodexCookieDomain(cookie.domain))
}

async function findCodexSessionCookie(): Promise<Electron.Cookie | null> {
  for (const url of CODEX_COOKIE_SCAN_URLS) {
    const cookies = await session.defaultSession.cookies.get({ url })
    const match = cookies.find(isCodexSessionCookie)
    if (match) {
      return match
    }
  }
  return null
}

function extractCodexAccessTokenFromAuthJson(parsed: Record<string, unknown>): string | null {
  const direct = parsed.access_token ?? parsed.accessToken
  if (typeof direct === 'string' && direct.trim()) return direct

  const tokens = parsed.tokens
  if (tokens && typeof tokens === 'object') {
    const tokenRecord = tokens as Record<string, unknown>
    const nested = tokenRecord.access_token ?? tokenRecord.accessToken
    if (typeof nested === 'string' && nested.trim()) return nested
  }

  return null
}

function buildCodexAuthAttempts(preferredCookieName?: string): CodexAuthAttempt[] {
  const attempts: CodexAuthAttempt[] = []
  if (preferredCookieName) {
    attempts.push({ kind: 'cookie', cookieName: preferredCookieName })
  }
  attempts.push({ kind: 'bearer' })
  for (const cookieName of CODEX_TOKEN_COOKIES) {
    if (cookieName !== preferredCookieName) {
      attempts.push({ kind: 'cookie', cookieName })
    }
  }
  return attempts
}

async function fetchCodexUsageResponse(
  accessToken: string,
  preferredCookieName?: string,
): Promise<{ response: Response; auth: CodexAuthAttempt }> {
  const normalizedToken = normalizeBearerToken(accessToken)

  for (const attempt of buildCodexAuthAttempts(preferredCookieName)) {
    let response: Response
    if (attempt.kind === 'bearer') {
      response = await session.defaultSession.fetch(CODEX_USAGE_URL, {
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${normalizedToken}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })
      debugLog(`Codex usage fetch attempt bearer => ${response.status}`)
    } else {
      await setCodexCookie(attempt.cookieName, normalizedToken)
      response = await session.defaultSession.fetch(CODEX_USAGE_URL, {
        credentials: 'include',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })
      debugLog(`Codex usage fetch attempt cookie:${attempt.cookieName} => ${response.status}`)
    }

    if (response.status === 401 || response.status === 403) {
      continue
    }

    return { response, auth: attempt }
  }

  throw new Error('CodexSessionExpired')
}

ipcMain.handle(IpcChannels.GET_CODEX_CREDENTIALS, () => {
  return {
    accessToken: store.get('codexAccessToken') ?? null,
  }
})

ipcMain.handle(
  IpcChannels.SAVE_CODEX_CREDENTIALS,
  (
    _event: Electron.IpcMainInvokeEvent,
    payload: string | { accessToken: string; cookieName?: string },
  ) => {
    const rawToken = typeof payload === 'string' ? payload : payload.accessToken
    const cookieName = typeof payload === 'string' ? undefined : payload.cookieName
    const accessToken = rawToken?.trim()
    if (!accessToken) {
      throw new Error('Missing Codex credentials')
    }
    store.set('codexAccessToken', accessToken)
    if (cookieName) {
      store.set('codexCookieName', cookieName)
      void setCodexCookie(cookieName, accessToken).catch((err) =>
        debugLog('Failed to pre-set Codex cookie during save:', (err as Error).message),
      )
    } else {
      store.delete('codexCookieName' as keyof StoreSchema)
    }
    return true
  },
)

ipcMain.handle(IpcChannels.DELETE_CODEX_CREDENTIALS, () => {
  store.delete('codexAccessToken' as keyof StoreSchema)
  store.delete('codexCookieName' as keyof StoreSchema)
  store.delete('cachedCodexUsageData' as keyof StoreSchema)
  store.delete('cachedCodexUsageTimestamp' as keyof StoreSchema)
  return true
})

// Auto-detect Codex token: try ~/.codex/auth.json first, then open chatgpt.com
ipcMain.handle(IpcChannels.DETECT_CODEX_TOKEN, async () => {
  // 1. Try reading from ~/.codex/auth.json
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json')
    if (fs.existsSync(authPath)) {
      const raw = fs.readFileSync(authPath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const token = extractCodexAccessTokenFromAuthJson(parsed)
      if (typeof token === 'string' && token.length > 10) {
        try {
          await fetchCodexUsageResponse(token)
          debugLog('Codex bearer token from ~/.codex/auth.json is valid')
          return { success: true, accessToken: token }
        } catch (err) {
          debugLog('Codex token in ~/.codex/auth.json is invalid/expired, falling back to login window:', (err as Error).message)
        }
      }
    }
  } catch (err) {
    debugLog('Could not read ~/.codex/auth.json:', (err as Error).message)
  }

  // 2. Fallback: open chatgpt.com and capture the web session cookie.
  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: 'Log in to ChatGPT (Codex)',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    let resolved = false
    let cookiePoll: ReturnType<typeof setInterval> | null = null

    const cleanup = (): void => {
      session.defaultSession.cookies.removeListener('changed', onCookieChanged)
      loginWin.webContents.removeListener('did-finish-load', onNavigationCheck)
      loginWin.webContents.removeListener('did-navigate', onNavigationCheck)
      loginWin.webContents.removeListener('did-redirect-navigation', onNavigationCheck)
      if (cookiePoll) {
        clearInterval(cookiePoll)
        cookiePoll = null
      }
    }

    const resolveFromCookie = (cookie: Electron.Cookie, source: string): void => {
      if (resolved) return
      resolved = true
      debugLog(`Captured Codex session cookie via ${source}:`, cookie.name, cookie.domain)
      store.set('codexCookieName', cookie.name)
      cleanup()
      loginWin.close()
      resolve({ success: true, accessToken: cookie.value, cookieName: cookie.name })
    }

    const tryResolveFromExistingCookies = async (source: string): Promise<void> => {
      if (resolved) return
      try {
        const cookie = await findCodexSessionCookie()
        if (cookie) {
          resolveFromCookie(cookie, source)
        }
      } catch (err) {
        debugLog(`Failed scanning Codex cookies via ${source}:`, (err as Error).message)
      }
    }

    const onCookieChanged = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ): void => {
      if (!removed && isCodexSessionCookie(cookie)) {
        resolveFromCookie(cookie, 'cookie-change')
      }
    }

    const onNavigationCheck = (): void => {
      void tryResolveFromExistingCookies('navigation')
    }

    session.defaultSession.cookies.on('changed', onCookieChanged)
    loginWin.webContents.on('did-finish-load', onNavigationCheck)
    loginWin.webContents.on('did-navigate', onNavigationCheck)
    loginWin.webContents.on('did-redirect-navigation', onNavigationCheck)
    cookiePoll = setInterval(() => {
      void tryResolveFromExistingCookies('poll')
    }, 1000)

    loginWin.on('closed', () => {
      cleanup()
      if (!resolved) {
        resolve({ success: false, error: 'Login window closed' })
      }
    })

    void tryResolveFromExistingCookies('initial')
    loginWin.loadURL(CODEX_LOGIN_URL)
  })
})

ipcMain.handle(IpcChannels.FETCH_CODEX_USAGE, async () => {
  const accessToken = store.get('codexAccessToken') as string | undefined
  if (!accessToken) {
    throw new Error('Missing Codex credentials')
  }

  try {
    const preferredCookieName = store.get('codexCookieName') as string | undefined
    const { response, auth } = await fetchCodexUsageResponse(accessToken, preferredCookieName)

    if (!response.ok) {
      throw new Error(`CodexUsageFetchFailed:${response.status}`)
    }

    if (auth.kind === 'cookie') {
      store.set('codexCookieName', auth.cookieName)
    }

    const raw = (await response.json()) as Record<string, unknown>
    debugLogToRenderer('Raw Codex usage API response:', raw)

    const data = parseCodexUsageResponse(raw)
    store.set('cachedCodexUsageData', data)
    store.set('cachedCodexUsageTimestamp', Date.now())
    return data
  } catch (error) {
    const err = error as Error
    if (err.message === 'CodexSessionExpired') {
      store.delete('codexAccessToken' as keyof StoreSchema)
      store.delete('codexCookieName' as keyof StoreSchema)
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.CODEX_SESSION_EXPIRED)
      }
      throw err
    }
    console.error('Codex usage fetch failed:', err.message)
    throw err
  }
})

ipcMain.handle(IpcChannels.GET_CACHED_CODEX_USAGE, (): CachedCodexUsageData | null => {
  const data = store.get('cachedCodexUsageData') as CodexUsageData | undefined
  const timestamp = store.get('cachedCodexUsageTimestamp') as number | undefined
  if (!data || !timestamp) return null
  return { data, timestamp }
})

// ─── Copilot IPC Handlers ─────────────────────────────────────────────────────

ipcMain.handle(IpcChannels.GET_COPILOT_CREDENTIALS, (): CopilotCredentials => {
  return {
    accessToken: store.get('copilotAccessToken') ?? null,
  }
})

ipcMain.handle(
  IpcChannels.SAVE_COPILOT_CREDENTIALS,
  (_event: Electron.IpcMainInvokeEvent, { accessToken }: SaveCopilotCredentialsPayload) => {
    const trimmed = accessToken?.trim()
    if (!trimmed) {
      throw new Error('Missing Copilot credentials')
    }
    store.set('copilotAccessToken', trimmed)
    return true
  },
)

ipcMain.handle(IpcChannels.DELETE_COPILOT_CREDENTIALS, () => {
  store.delete('copilotAccessToken' as keyof StoreSchema)
  store.delete('cachedCopilotUsageData' as keyof StoreSchema)
  store.delete('cachedCopilotUsageTimestamp' as keyof StoreSchema)
  return true
})

ipcMain.handle(IpcChannels.DETECT_COPILOT_TOKEN, async () => {
  // TODO (JAY-5): Cookie-based detection is unlikely to work for the GitHub billing endpoint.
  // This stub always returns not-found, prompting the user to enter a PAT manually.
  return { success: false, error: 'Auto-detect not supported for Copilot — please enter a PAT manually.' }
})

ipcMain.handle(IpcChannels.FETCH_COPILOT_USAGE, async (): Promise<CopilotUsageData> => {
  // TODO (JAY-5): Implement actual GitHub Copilot billing API fetch.
  // Requires PAT with `copilot` scope (GET /user/copilot) and Plan:Read-only
  // scope (GET /users/{username}/settings/billing/premium_request/usage).
  throw new Error('Copilot usage fetch not yet implemented')
})

ipcMain.handle(IpcChannels.GET_CACHED_COPILOT_USAGE, (): CachedCopilotUsageData | null => {
  const data = store.get('cachedCopilotUsageData') as CopilotUsageData | undefined
  const timestamp = store.get('cachedCopilotUsageTimestamp') as number | undefined
  if (!data || !timestamp) return null
  return { data, timestamp }
})

// macOS: Set up application menu (required for keyboard shortcuts like Cmd+Q, Cmd+C, Cmd+V)
function createAppMenu(): void {
  if (!isMac) return

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// App lifecycle
app.whenReady().then(async () => {
  createAppMenu()
  // Restore session cookie if we have stored credentials
  const sessionKey = store.get('sessionKey') as string | undefined
  if (sessionKey) {
    await setSessionCookie(sessionKey)
  }
  const codexAccessToken = store.get('codexAccessToken') as string | undefined
  const codexCookieName = store.get('codexCookieName') as string | undefined
  if (codexAccessToken && codexCookieName) {
    await setCodexCookie(codexCookieName, codexAccessToken)
  }
  
  // Sync auto-start setting with system state
  if (isAutoStartSupported()) {
    try {
      const storedSetting = store.get('autoStartEnabled', false)
      const loginItemSettings = app.getLoginItemSettings()
      if (storedSetting !== loginItemSettings.openAtLogin) {
        // Sync stored setting with actual system state on startup
        debugLog('Syncing auto-start setting:', storedSetting, 'vs system:', loginItemSettings.openAtLogin)
        app.setLoginItemSettings({
          openAtLogin: storedSetting,
          openAsHidden: false
        })
      }
    } catch (error) {
      debugLog('Failed to sync auto-start setting on startup:', error)
    }
  }

  createMainWindow()
  createTray()

  // On macOS, hide the dock icon since this is a menu bar widget
  if (isMac && app.dock) {
    app.dock.hide()
  }
})

// Set isQuitting so the mainWindow 'close' handler allows destruction
app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // On macOS, keep running (menu bar widget stays alive)
  // On Windows/Linux, this fires after quit destroys windows — no action needed
})

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked (if dock is visible)
  if (mainWindow === null) {
    createMainWindow()
  } else {
    mainWindow.show()
  }
})

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
