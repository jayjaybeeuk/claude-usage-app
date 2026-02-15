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

  // API
  fetchUsageData: () => ipcRenderer.invoke('fetch-usage-data'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  updateTrayUsage: (stats: { session: number; weekly: number; sonnet: number }) =>
    ipcRenderer.send('update-tray-usage', stats),

  // Usage history
  getUsageHistory: () => ipcRenderer.invoke('get-usage-history'),
  saveUsageHistoryEntry: (entry: { timestamp: number; session: number; weekly: number; sonnet: number }) =>
    ipcRenderer.invoke('save-usage-history-entry', entry),
  clearUsageHistory: () => ipcRenderer.invoke('clear-usage-history'),

  // Platform info
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  platform: process.platform,
}

contextBridge.exposeInMainWorld('electronAPI', api)
