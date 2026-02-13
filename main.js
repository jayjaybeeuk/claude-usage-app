const { app, BrowserWindow, ipcMain, Tray, Menu, session, shell, nativeImage, } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { fetchViaWindow } = require('./src/fetch-via-window');

const store = new Store({
  encryptionKey: 'claude-widget-secure-key-2024'
});

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// Debug mode: set DEBUG_LOG=1 env var or pass --debug flag to see verbose logs.
// Regular users will only see critical errors in the console.
const DEBUG = process.env.DEBUG_LOG === '1' || process.argv.includes('--debug');
function debugLog(...args) {
  if (DEBUG) console.log('[Debug]', ...args);
}

let mainWindow = null;
let tray = null;

const WIDGET_WIDTH = 480;
const STATUS_BAR_HEIGHT = 34;
const WIDGET_HEIGHT = 140 + STATUS_BAR_HEIGHT;

// Platform-specific User-Agent
const USER_AGENT = isMac
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Set session-level User-Agent to avoid Electron detection
app.on('ready', () => {
  session.defaultSession.setUserAgent(USER_AGENT);
});

// Platform-specific icon
function getAppIcon() {
  if (isWindows) {
    return path.join(__dirname, 'assets/icon.ico');
  }
  return path.join(__dirname, 'assets/icon.icns');
}

// Set sessionKey as a cookie in Electron's session
async function setSessionCookie(sessionKey) {
  await session.defaultSession.cookies.set({
    url: 'https://claude.ai',
    name: 'sessionKey',
    value: sessionKey,
    domain: '.claude.ai',
    path: '/',
    secure: true,
    httpOnly: true
  });
  debugLog('sessionKey cookie set in Electron session');
}

// Get tray icon (macOS uses template images for proper dark/light menu bar support)
function getTrayIcon() {
  if (isMac) {
    // On macOS, create a properly sized template image for the menu bar
    // Template images automatically adapt to dark/light menu bar
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/tray-icon.png'));
    const resized = icon.resize({ width: 18, height: 18 });
    resized.setTemplateImage(true);
    return resized;
  }
  return path.join(__dirname, 'assets/tray-icon.png');
}

function createMainWindow() {
  const savedPosition = store.get('windowPosition');
  const windowOptions = {
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
      preload: path.join(__dirname, 'preload.js')
    }
  };

  // macOS-specific window options
  if (isMac) {
    windowOptions.vibrancy = 'under-window';
    windowOptions.visualEffectState = 'active';
    windowOptions.roundedCorners = true;
    // Hide from Cmd+Tab app switcher while keeping tray/dock presence
    windowOptions.skipTaskbar = true;
  }

  // Apply saved position if it exists
  if (savedPosition) {
    windowOptions.x = savedPosition.x;
    windowOptions.y = savedPosition.y;
  }

  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.loadFile('src/renderer/index.html');

  // Make window draggable and always on top
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.on('move', () => {
    const position = mainWindow.getBounds();
    store.set('windowPosition', { x: position.x, y: position.y });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Cached usage stats for tray display
let latestTrayStats = null;

function buildTrayMenu() {
  const items = [];

  // Usage stats at the top of the dropdown
  if (latestTrayStats) {
    items.push({
      label: `Session:  ${Math.round(latestTrayStats.session)}%`,
      enabled: false
    });
    items.push({
      label: `Weekly:   ${Math.round(latestTrayStats.weekly)}%`,
      enabled: false
    });
    if (latestTrayStats.sonnet > 0) {
      items.push({
        label: `Sonnet:   ${Math.round(latestTrayStats.sonnet)}%`,
        enabled: false
      });
    }
    items.push({ type: 'separator' });
  }

  items.push(
    {
      label: 'Show Widget',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          if (isMac) mainWindow.focus();
        } else {
          createMainWindow();
        }
      }
    },
    {
      label: 'Refresh',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('refresh-usage');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Log Out',
      click: async () => {
        store.delete('sessionKey');
        store.delete('organizationId');
        const cookies = await session.defaultSession.cookies.get({ url: 'https://claude.ai' });
        for (const cookie of cookies) {
          await session.defaultSession.cookies.remove('https://claude.ai', cookie.name);
        }
        await session.defaultSession.clearStorageData({
          storages: ['localstorage', 'sessionstorage', 'cachestorage'],
          origin: 'https://claude.ai'
        });
        if (mainWindow) {
          mainWindow.webContents.send('session-expired');
        }
        latestTrayStats = null;
        updateTrayDisplay();
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        app.quit();
      }
    }
  );

  return Menu.buildFromTemplate(items);
}

function updateTrayDisplay() {
  if (!tray) return;

  if (isMac && latestTrayStats) {
    tray.setTitle(`${Math.round(latestTrayStats.weekly)}%`, { fontType: 'monospacedDigit' });
  } else if (isMac) {
    tray.setTitle('');
  }

  tray.setContextMenu(buildTrayMenu());

  if (latestTrayStats) {
    tray.setToolTip(`Claude — Session: ${Math.round(latestTrayStats.session)}% | Weekly: ${Math.round(latestTrayStats.weekly)}%`);
  } else {
    tray.setToolTip('Claude Usage Widget');
  }
}

function createTray() {
  try {
    tray = new Tray(getTrayIcon());
    updateTrayDisplay();

    if (!isMac) {
      tray.on('click', () => {
        if (mainWindow) {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
      });
    }
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

// IPC Handlers
ipcMain.handle('get-credentials', () => {
  return {
    sessionKey: store.get('sessionKey'),
    organizationId: store.get('organizationId')
  };
});

ipcMain.handle('save-credentials', async (event, { sessionKey, organizationId }) => {
  store.set('sessionKey', sessionKey);
  if (organizationId) {
    store.set('organizationId', organizationId);
  }
  // Also set cookie in Electron session for window-based fetching
  await setSessionCookie(sessionKey);
  return true;
});

ipcMain.handle('delete-credentials', async () => {
  store.delete('sessionKey');
  store.delete('organizationId');
  // Remove all Claude.ai cookies
  const cookies = await session.defaultSession.cookies.get({ url: 'https://claude.ai' });
  for (const cookie of cookies) {
    await session.defaultSession.cookies.remove('https://claude.ai', cookie.name);
  }
  // Clear any cached data from the Electron session (storage, cache)
  // so nothing lingers on shared machines
  await session.defaultSession.clearStorageData({
    storages: ['localstorage', 'sessionstorage', 'cachestorage'],
    origin: 'https://claude.ai'
  });
  return true;
});

// Validate a sessionKey by fetching org ID via hidden BrowserWindow
ipcMain.handle('validate-session-key', async (event, sessionKey) => {
  debugLog('Validating session key:', sessionKey.substring(0, 20) + '...');
  try {
    // Set the cookie in Electron's session first
    await setSessionCookie(sessionKey);

    // Fetch organizations using hidden BrowserWindow (bypasses Cloudflare)
    const data = await fetchViaWindow('https://claude.ai/api/organizations');

    if (data && Array.isArray(data) && data.length > 0) {
      const orgId = data[0].uuid || data[0].id;
      debugLog('Session key validated, org ID:', orgId);
      return { success: true, organizationId: orgId };
    }

    // Check if it's an error response
    if (data && data.error) {
      return { success: false, error: data.error.message || data.error };
    }

    return { success: false, error: 'No organization found' };
  } catch (error) {
    console.error('Session key validation failed:', error.message);
    // Clean up the invalid cookie
    await session.defaultSession.cookies.remove('https://claude.ai', 'sessionKey');
    return { success: false, error: error.message };
  }
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('close-window', () => {
  if (isMac) {
    // On macOS, closing the widget hides it (app stays in menu bar)
    if (mainWindow) mainWindow.hide();
  } else {
    app.quit();
  }
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

ipcMain.on('resize-window', (event, height) => {
  if (mainWindow) {
    mainWindow.setContentSize(WIDGET_WIDTH, height);
  }
});

ipcMain.handle('get-window-position', () => {
  if (mainWindow) {
    return mainWindow.getBounds();
  }
  return null;
});

ipcMain.handle('set-window-position', (event, { x, y }) => {
  if (mainWindow) {
    mainWindow.setPosition(x, y);
    return true;
  }
  return false;
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// Update tray with latest usage stats from renderer
ipcMain.on('update-tray-usage', (event, stats) => {
  latestTrayStats = stats;
  updateTrayDisplay();
});

// Usage history storage (30-day retention)
ipcMain.handle('get-usage-history', () => {
  return store.get('usageHistory', []);
});

ipcMain.handle('clear-usage-history', () => {
  store.set('usageHistory', []);
  return true;
});

ipcMain.handle('save-usage-history-entry', (event, entry) => {
  const history = store.get('usageHistory', []);
  history.push(entry);
  // Prune entries older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const pruned = history.filter(e => e.timestamp >= cutoff);
  store.set('usageHistory', pruned);
  return true;
});

// Open a visible BrowserWindow for the user to log in to Claude.ai.
//
// Why we don't embed login directly in the app:
// Claude.ai (via Cloudflare) detects and blocks Electron-embedded logins.
// Instead, we open a standalone browser window, let the user authenticate
// normally, then capture the sessionKey cookie once login completes.
// Do NOT attempt to "fix" this back to an embedded login without verifying
// that Claude.ai/Cloudflare no longer blocks it.
ipcMain.handle('detect-session-key', async () => {
  // Clear any leftover sessionKey cookie
  try {
    await session.defaultSession.cookies.remove('https://claude.ai', 'sessionKey');
  } catch (e) { /* ignore */ }

  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 1000,
      height: 700,
      title: 'Log in to Claude',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    let resolved = false;

    // Listen for sessionKey cookie being set after login
    const onCookieChanged = (event, cookie, cause, removed) => {
      if (
        cookie.name === 'sessionKey' &&
        cookie.domain.includes('claude.ai') &&
        !removed &&
        cookie.value
      ) {
        resolved = true;
        session.defaultSession.cookies.removeListener('changed', onCookieChanged);
        loginWin.close();
        resolve({ success: true, sessionKey: cookie.value });
      }
    };

    session.defaultSession.cookies.on('changed', onCookieChanged);

    loginWin.on('closed', () => {
      session.defaultSession.cookies.removeListener('changed', onCookieChanged);
      if (!resolved) {
        resolve({ success: false, error: 'Login window closed' });
      }
    });

    loginWin.loadURL('https://claude.ai/login');
  });
});

ipcMain.handle('fetch-usage-data', async () => {
  const sessionKey = store.get('sessionKey');
  const organizationId = store.get('organizationId');

  if (!sessionKey || !organizationId) {
    throw new Error('Missing credentials');
  }

  // Ensure cookie is set
  await setSessionCookie(sessionKey);

  const usageUrl = `https://claude.ai/api/organizations/${organizationId}/usage`;
  const overageUrl = `https://claude.ai/api/organizations/${organizationId}/overage_spend_limit`;
  const prepaidUrl = `https://claude.ai/api/organizations/${organizationId}/prepaid/credits`;

  // Fetch all endpoints in parallel. Usage is required; overage and prepaid are optional.
  const [usageResult, overageResult, prepaidResult] = await Promise.allSettled([
    fetchViaWindow(usageUrl),
    fetchViaWindow(overageUrl),
    fetchViaWindow(prepaidUrl)
  ]);

  // Usage endpoint is mandatory
  if (usageResult.status === 'rejected') {
    const error = usageResult.reason;
    debugLog('API request failed:', error.message);
    const isBlocked = error.message.startsWith('CloudflareBlocked')
      || error.message.startsWith('CloudflareChallenge')
      || error.message.startsWith('UnexpectedHTML');
    if (isBlocked) {
      store.delete('sessionKey');
      store.delete('organizationId');
      if (mainWindow) {
        mainWindow.webContents.send('session-expired');
      }
      throw new Error('SessionExpired');
    }
    throw error;
  }

  const data = usageResult.value;

  // Merge overage spending data into data.extra_usage
  if (overageResult.status === 'fulfilled' && overageResult.value) {
    const overage = overageResult.value;
    const limit = overage.monthly_credit_limit ?? overage.spend_limit_amount_cents;
    const used = overage.used_credits ?? overage.balance_cents;
    const enabled = overage.is_enabled !== undefined ? overage.is_enabled : (limit != null);

    if (enabled && typeof limit === 'number' && limit > 0 && typeof used === 'number') {
      data.extra_usage = {
        utilization: (used / limit) * 100,
        resets_at: null,
        used_cents: used,
        limit_cents: limit,
      };
    }
  } else {
    debugLog('Overage fetch skipped or failed:', overageResult.reason?.message || 'no data');
  }

  // Merge prepaid balance into data.extra_usage
  if (prepaidResult.status === 'fulfilled' && prepaidResult.value) {
    const prepaid = prepaidResult.value;
    if (typeof prepaid.amount === 'number') {
      if (!data.extra_usage) data.extra_usage = {};
      data.extra_usage.balance_cents = prepaid.amount;
    }
  } else {
    debugLog('Prepaid fetch skipped or failed:', prepaidResult.reason?.message || 'no data');
  }

  return data;
});

// macOS: Set up application menu (required for keyboard shortcuts like Cmd+Q, Cmd+C, Cmd+V)
function createAppMenu() {
  if (!isMac) return;

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
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
        { role: 'selectAll' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// App lifecycle
app.whenReady().then(async () => {
  createAppMenu();
  // Restore session cookie if we have stored credentials
  const sessionKey = store.get('sessionKey');
  if (sessionKey) {
    await setSessionCookie(sessionKey);
  }

  createMainWindow();
  createTray();

  // On macOS, hide the dock icon since this is a menu bar widget
  if (isMac) {
    app.dock.hide();
  }
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay running even with no windows
  // On all platforms, keep running in tray
  if (!isMac) {
    // Keep running in tray on Windows/Linux too
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked (if dock is visible)
  if (mainWindow === null) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
