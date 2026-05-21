// Electron's sandboxed preload only allows require('electron').
// All other imports are blocked, so channel names must be inlined here.
// Keep these in sync with src/shared/ipc-channels.ts.
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Credentials management
  getCredentials: () => ipcRenderer.invoke('get-credentials'),
  saveCredentials: (credentials: { sessionKey: string; organizationId?: string }) =>
    ipcRenderer.invoke('save-credentials', credentials),
  deleteCredentials: () => ipcRenderer.invoke('delete-credentials'),
  validateSessionKey: (sessionKey: string) => ipcRenderer.invoke('validate-session-key', sessionKey),
  detectSessionKey: () => ipcRenderer.invoke('detect-session-key'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  resizeWindow: (height: number) => ipcRenderer.send('resize-window', height),

  // Window position
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (position: { x: number; y: number }) => ipcRenderer.invoke('set-window-position', position),

  // Event listeners
  onRefreshUsage: (callback: () => void) => {
    ipcRenderer.on('refresh-usage', () => callback())
  },
  onSessionExpired: (callback: () => void) => {
    ipcRenderer.on('session-expired', () => callback())
  },
  onDebugLog: (callback: (label: string, data: unknown) => void) => {
    ipcRenderer.on('debug-log', (_event, label, data) => callback(label, data))
  },

  // API
  fetchUsageData: () => ipcRenderer.invoke('fetch-usage-data'),
  getCachedUsage: () => ipcRenderer.invoke('get-cached-usage'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  updateTrayUsage: (stats: { session: number; weekly: number; sonnet: number }) =>
    ipcRenderer.send('update-tray-usage', stats),

  // Usage history
  getUsageHistory: () => ipcRenderer.invoke('get-usage-history'),
  saveUsageHistoryEntry: (entry: {
    timestamp: number
    session: number
    weekly: number
    sonnet: number
    opus?: number
    cowork?: number
    oauthApps?: number
    codexSession?: number
    codexWeekly?: number
  }) =>
    ipcRenderer.invoke('save-usage-history-entry', entry),
  clearUsageHistory: () => ipcRenderer.invoke('clear-usage-history'),

  // Settings
  getRefreshIntervalMinutes: () => ipcRenderer.invoke('get-refresh-interval'),
  setRefreshIntervalMinutes: (minutes: number) => ipcRenderer.invoke('set-refresh-interval', minutes),

  // Auto-start settings
  isAutoStartSupported: () => ipcRenderer.invoke('is-auto-start-supported'),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('set-auto-start', enabled),

  // Theme settings
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme: string) => ipcRenderer.invoke('set-theme', theme),
  getBackgroundHue: () => ipcRenderer.invoke('get-background-hue'),
  setBackgroundHue: (backgroundHue: string) => ipcRenderer.invoke('set-background-hue', backgroundHue),

  // Platform info
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  platform: process.platform,

  // Codex
  getCodexCredentials: () => ipcRenderer.invoke('get-codex-credentials'),
  saveCodexCredentials: (credentials: { accessToken: string; cookieName?: string }) =>
    ipcRenderer.invoke('save-codex-credentials', credentials),
  deleteCodexCredentials: () => ipcRenderer.invoke('delete-codex-credentials'),
  detectCodexToken: () => ipcRenderer.invoke('detect-codex-token'),
  fetchCodexUsageData: () => ipcRenderer.invoke('fetch-codex-usage'),
  getCachedCodexUsage: () => ipcRenderer.invoke('get-cached-codex-usage'),
  onCodexSessionExpired: (callback: () => void) => {
    ipcRenderer.on('codex-session-expired', () => callback())
  },
  // Copilot
  getCopilotCredentials: () => ipcRenderer.invoke('get-copilot-credentials'),
  deleteCopilotCredentials: () => ipcRenderer.invoke('delete-copilot-credentials'),
  copilotGetClientId: () => ipcRenderer.invoke('copilot-get-client-id'),
  copilotSetClientId: (clientId: string) => ipcRenderer.invoke('copilot-set-client-id', clientId),
  copilotStartDeviceFlow: () => ipcRenderer.invoke('copilot-start-device-flow'),
  fetchCopilotUsageData: () => ipcRenderer.invoke('fetch-copilot-usage'),
  getCachedCopilotUsage: () => ipcRenderer.invoke('get-cached-copilot-usage'),
  onCopilotSessionExpired: (callback: () => void) => {
    ipcRenderer.on('copilot-session-expired', () => callback())
  },
  onCopilotAuthSuccess: (callback: () => void) => {
    ipcRenderer.on('copilot-auth-success', () => callback())
  },
  onCopilotAuthFailed: (callback: (error: string) => void) => {
    ipcRenderer.on('copilot-auth-failed', (_event, error: string) => callback(error))
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
