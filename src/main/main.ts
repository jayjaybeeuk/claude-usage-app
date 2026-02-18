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
import type {
  Credentials,
  SaveCredentialsPayload,
  TrayUsageStats,
  UsageHistoryEntry,
  UsageData,
  ExtraUsage,
  WindowPosition,
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

  // Usage stats at the top of the dropdown
  if (latestTrayStats) {
    items.push({
      label: `Session:  ${Math.round(latestTrayStats.session)}%`,
      enabled: false,
    })
    items.push({
      label: `Weekly:   ${Math.round(latestTrayStats.weekly)}%`,
      enabled: false,
    })
    if (latestTrayStats.sonnet > 0) {
      items.push({
        label: `Sonnet:   ${Math.round(latestTrayStats.sonnet)}%`,
        enabled: false,
      })
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
    tray.setTitle(`${Math.round(latestTrayStats.weekly)}%`, { fontType: 'monospacedDigit' })
  } else if (isMac) {
    tray.setTitle('')
  }

  tray.setContextMenu(buildTrayMenu())

  if (latestTrayStats) {
    tray.setToolTip(
      `Claude — Session: ${Math.round(latestTrayStats.session)}% | Weekly: ${Math.round(latestTrayStats.weekly)}%`,
    )
  } else {
    tray.setToolTip('Claude Usage Widget')
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

  // Merge overage spending data into data.extra_usage
  if (overageResult.status === 'fulfilled' && overageResult.value) {
    const overage = overageResult.value as Record<string, unknown>
    debugLogToRenderer('Raw overage API response:', overage)
    const limit = (overage.monthly_credit_limit ?? overage.spend_limit_amount_cents) as number | undefined
    const used = (overage.used_credits ?? overage.balance_cents) as number | undefined
    const enabled =
      overage.is_enabled !== undefined ? (overage.is_enabled as boolean) : limit != null

    if (enabled && typeof limit === 'number' && limit > 0 && typeof used === 'number') {
      data.extra_usage = {
        utilization: (used / limit) * 100,
        resets_at: null,
        used_cents: used,
        limit_cents: limit,
      } satisfies ExtraUsage
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

  return data
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
