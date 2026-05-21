import './styles.css'
import { DEFAULT_REFRESH_MINUTES, MAX_REFRESH_MINUTES, MIN_REFRESH_MINUTES } from '../shared/refresh-interval'
import type { UsageHistoryEntry } from '../shared/ipc-types'
import { elements } from './ui/elements'
import { loadTheme, loadBackgroundHue, setTheme, setBackgroundHue, onThemeChange } from './ui/theme'
import { resizeWidget, resizeForSettings, restoreNonSettingsHeight, WIDGET_HEIGHT_COLLAPSED } from './ui/widget'
import { debugLog } from './ui/utils'
import { ClaudeProvider } from './providers/ClaudeProvider'
import { CodexProvider } from './providers/CodexProvider'
// Copilot frontend is disabled until its auth/usage integration is reliable.
// import { CopilotProvider } from './providers/CopilotProvider'
import { GeminiProvider } from './providers/GeminiProvider'

// Application state
let updateInterval: ReturnType<typeof setInterval> | null = null
let refreshIntervalMinutes = DEFAULT_REFRESH_MINUTES
let isSettingsOpen = false

function handleResize(): void {
  resizeWidget({
    isSettingsOpen,
    isGraphVisible: claudeProvider.isGraphVisible,
    isPieVisible: claudeProvider.isPieVisible,
    isExpanded: claudeProvider.isExpanded,
    codexHasData: codexProvider.hasData,
    isCodexGraphVisible: codexProvider.isCodexGraphVisible,
    isCodexPieVisible: codexProvider.isCodexPieVisible,
    copilotHasData: false,
    geminiHasData: geminiProvider.hasData,
  })
}

function clampRefreshMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REFRESH_MINUTES
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, Math.round(value)))
}

function formatRefreshInterval(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

function updateRefreshIntervalUI(minutes: number): void {
  elements.refreshIntervalSlider.value = String(minutes)
  elements.refreshIntervalValue.textContent = formatRefreshInterval(minutes)
}

async function loadRefreshInterval(): Promise<void> {
  const saved = await window.electronAPI.getRefreshIntervalMinutes()
  refreshIntervalMinutes = clampRefreshMinutes(saved)
  updateRefreshIntervalUI(refreshIntervalMinutes)
}

const claudeProvider = new ClaudeProvider({
  onResize: handleResize,
  onDataRefresh: refreshAllUsageData,
  getRefreshInterval: () => refreshIntervalMinutes,
  onLoginStateChange: (isLoggedIn: boolean) => {
    if (isLoggedIn) {
      showMainContent()
      void codexProvider.init()
      // void copilotProvider.init()
      void geminiProvider.init()
      void refreshAllUsageData()
      startAutoUpdate()
    } else {
      showLoginState()
    }
  }
})

const codexProvider = new CodexProvider({
  onResize: handleResize,
  onDataChange: refreshAllUsageData,
})

// const copilotProvider = new CopilotProvider({
//   onResize: handleResize,
//   onDataChange: refreshAllUsageData,
// })

const geminiProvider = new GeminiProvider({
  onResize: handleResize,
  onDataChange: refreshAllUsageData,
})

async function refreshAllUsageData(): Promise<void> {
  await claudeProvider.fetchData()
  await codexProvider.fetchData()
  // await copilotProvider.fetchData()
  await geminiProvider.fetchData()

  const claudeData = claudeProvider.latestUsageData
  if (!claudeData) return

  const codexData = codexProvider.latestCodexData
  const geminiData = geminiProvider.latestGeminiData
  const historyEntry: UsageHistoryEntry = {
    timestamp: claudeProvider.lastRefreshTime || Date.now(),
    session: claudeData?.five_hour?.utilization || 0,
    weekly: claudeData?.seven_day?.utilization || 0,
    sonnet: claudeData?.seven_day_sonnet?.utilization || 0,
    opus: claudeData?.seven_day_opus?.utilization,
    cowork: claudeData?.seven_day_cowork?.utilization,
    oauthApps: claudeData?.seven_day_oauth_apps?.utilization,
    codexSession: codexData?.five_hour?.utilization,
    codexWeekly: codexData?.seven_day?.utilization,
    geminiDaily: geminiData?.daily?.utilization,
  }
  await window.electronAPI.saveUsageHistoryEntry(historyEntry)

  window.electronAPI.updateTrayUsage({
    session: historyEntry.session,
    weekly: historyEntry.weekly,
    sonnet: historyEntry.sonnet,
    codexSession: historyEntry.codexSession,
    codexWeekly: historyEntry.codexWeekly,
    geminiDaily: historyEntry.geminiDaily,
  })
}

async function setRefreshIntervalMinutes(minutes: number): Promise<void> {
  const clamped = clampRefreshMinutes(minutes)
  const stored = await window.electronAPI.setRefreshIntervalMinutes(clamped)
  refreshIntervalMinutes = clampRefreshMinutes(stored)
  updateRefreshIntervalUI(refreshIntervalMinutes)
  startAutoUpdate()
}

// Auto-start functionality
async function checkAutoStartSupport(): Promise<void> {
  try {
    const isSupported = await window.electronAPI.isAutoStartSupported()
    if (isSupported) {
      elements.autoStartSection.style.display = 'block'
      await loadAutoStartSetting()
    } else {
      elements.autoStartSection.style.display = 'none'
    }
  } catch (error) {
    debugLog('Failed to check auto-start support:', error)
    elements.autoStartSection.style.display = 'none'
  }
}

async function loadAutoStartSetting(): Promise<void> {
  try {
    const enabled = await window.electronAPI.getAutoStart()
    elements.autoStartToggle.checked = enabled
  } catch (error) {
    debugLog('Failed to load auto-start setting:', error)
    elements.autoStartToggle.checked = false
  }
}

async function setAutoStartEnabled(enabled: boolean): Promise<void> {
  try {
    const result = await window.electronAPI.setAutoStart(enabled)
    elements.autoStartToggle.checked = result
  } catch (error) {
    debugLog('Failed to set auto-start:', error)
    // Revert toggle state on error
    elements.autoStartToggle.checked = !enabled
  }
}

// Initialize
async function init(): Promise<void> {
  // Apply platform-specific CSS class to body
  const platform = window.electronAPI.platform
  if (platform === 'darwin') {
    document.body.classList.add('platform-darwin')
  } else if (platform === 'win32') {
    document.body.classList.add('platform-win32')
  } else {
    document.body.classList.add('platform-linux')
  }

  onThemeChange(() => {
    if (claudeProvider.hasData) claudeProvider.renderCharts()

    if (codexProvider.hasData) codexProvider.renderCharts()
  })

  setupEventListeners()
  await loadRefreshInterval()
  await loadTheme()
  await loadBackgroundHue()
  await checkAutoStartSupport()
  await claudeProvider.init()
}

// Event Listeners
function setupEventListeners(): void {
  elements.refreshBtn.addEventListener('click', async () => {
    debugLog('Refresh button clicked')
    elements.refreshBtn.classList.add('spinning')
    try {
      await refreshAllUsageData()
    } finally {
      elements.refreshBtn.classList.remove('spinning')
    }
  })

  elements.minimizeBtn.addEventListener('click', () => {
    window.electronAPI.minimizeWindow()
  })

  elements.closeBtn.addEventListener('click', () => {
    window.electronAPI.closeWindow()
  })

  // Settings calls
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsOverlay.style.display = 'flex'
    isSettingsOpen = true
    requestAnimationFrame(() => resizeForSettings())
  })

  elements.closeSettingsBtn.addEventListener('click', () => {
    elements.settingsOverlay.style.display = 'none'
    isSettingsOpen = false
    restoreNonSettingsHeight()
  })

  elements.refreshIntervalSlider.addEventListener('input', (event: Event) => {
    const value = Number((event.target as HTMLInputElement).value)
    const clamped = clampRefreshMinutes(value)
    updateRefreshIntervalUI(clamped)
  })

  elements.refreshIntervalSlider.addEventListener('change', async (event: Event) => {
    const value = Number((event.target as HTMLInputElement).value)
    await setRefreshIntervalMinutes(value)
  })

  // Auto-start toggle
  elements.autoStartToggle.addEventListener('change', async (event: Event) => {
    const enabled = (event.target as HTMLInputElement).checked
    await setAutoStartEnabled(enabled)
  })

  // Theme dropdown
  elements.themeDropdown.addEventListener('change', async (event: Event) => {
    const theme = (event.target as HTMLSelectElement).value
    await setTheme(theme)
  })

  elements.backgroundHueDropdown.addEventListener('change', async (event: Event) => {
    const backgroundHue = (event.target as HTMLSelectElement).value
    await setBackgroundHue(backgroundHue)
  })

  elements.logoutBtn.addEventListener('click', async () => {
    await window.electronAPI.deleteCredentials()
    elements.settingsOverlay.style.display = 'none'
    isSettingsOpen = false
    showLoginState()
    window.electronAPI.resizeWindow(WIDGET_HEIGHT_COLLAPSED)
  })

  elements.clearHistoryBtn.addEventListener('click', async () => {
    await window.electronAPI.clearUsageHistory()
    elements.clearHistoryBtn.textContent = 'Cleared!'
    setTimeout(() => {
      elements.clearHistoryBtn.textContent = 'Clear History'
    }, 1500)
    claudeProvider.renderCharts()
    if (codexProvider.hasData) codexProvider.renderCharts()
  })

  elements.coffeeBtn.addEventListener('click', () => {
    window.electronAPI.openExternal('https://paypal.me/SlavomirDurej?country.x=GB&locale.x=en_GB')
  })

  elements.coffeeBtnAlt.addEventListener('click', () => {
    window.electronAPI.openExternal('https://paypal.me/JamesBolton?country.x=GB&locale.x=en_GB')
  })

  // Listen for refresh requests from tray
  window.electronAPI.onRefreshUsage(async () => {
    await refreshAllUsageData()
  })

  // Forward debug logs from main process to renderer DevTools console
  window.electronAPI.onDebugLog((label: string, data: unknown) => {
    console.log('[Debug]', label, data)
  })

}

// UI State Management
export function showLoginState(): void {
  elements.loadingContainer.style.display = 'none'
  elements.loginContainer.style.display = 'flex'
  elements.noUsageContainer.style.display = 'none'
  elements.mainContent.style.display = 'none'
  claudeProvider.showLogin()
  stopAutoUpdate()
}

export function showMainContent(): void {
  elements.loadingContainer.style.display = 'none'
  elements.loginContainer.style.display = 'none'
  elements.noUsageContainer.style.display = 'none'
  elements.mainContent.style.display = 'block'
}

// Auto-update management
function startAutoUpdate(): void {
  stopAutoUpdate()
  updateInterval = setInterval(() => {
    refreshAllUsageData()
  }, refreshIntervalMinutes * 60 * 1000)
}

function stopAutoUpdate(): void {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
}

// Add spinning animation for refresh button
const style = document.createElement('style')
style.textContent = `
    @keyframes spin-refresh {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .refresh-btn.spinning svg {
        animation: spin-refresh 1s linear;
    }
`
document.head.appendChild(style)

// Start the application
init()

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  claudeProvider.destroy()
  stopAutoUpdate()
  codexProvider.destroy()
  // copilotProvider.destroy()
  geminiProvider.destroy()
})
