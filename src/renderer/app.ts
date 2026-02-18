import './styles.css'
import { DEFAULT_REFRESH_MINUTES, MAX_REFRESH_MINUTES, MIN_REFRESH_MINUTES } from '../shared/refresh-interval'
import type { Credentials, UsageData, UsageTimePeriod, ExtraUsage, UsageHistoryEntry } from '../shared/ipc-types'

// Application state
let credentials: Credentials | null = null
let updateInterval: ReturnType<typeof setInterval> | null = null
let countdownInterval: ReturnType<typeof setInterval> | null = null
let latestUsageData: UsageData | null = null
let isExpanded = false
let isGraphVisible = false
let isPieVisible = false
let lastRefreshTime: number | null = null
let statusInterval: ReturnType<typeof setInterval> | null = null
let refreshIntervalMinutes = DEFAULT_REFRESH_MINUTES
let isSettingsOpen = false
const WIDGET_HEIGHT_COLLAPSED = 164 // 140 base + 24 status bar
const WIDGET_ROW_HEIGHT = 30
const GRAPH_HEIGHT = 170 // graph section height including padding
const PIE_HEIGHT = 162 // pie section height including padding — must match .pie-section CSS height
const SONNET_ROW_HEIGHT = 30 // sonnet row height
let lastNonSettingsHeight = WIDGET_HEIGHT_COLLAPSED

// Debug logging — only shows in DevTools (development mode).
// Regular users won't see verbose logs in production.
const DEBUG = new URLSearchParams(window.location.search).has('debug')
function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log('[Debug]', ...args)
}

// Helper to safely get DOM elements with type assertion
function getElement<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Element #${id} not found`)
  return el as unknown as T
}

// DOM elements
const elements = {
  loadingContainer: getElement<HTMLDivElement>('loadingContainer'),
  loginContainer: getElement<HTMLDivElement>('loginContainer'),
  noUsageContainer: getElement<HTMLDivElement>('noUsageContainer'),
  mainContent: getElement<HTMLDivElement>('mainContent'),
  loginStep1: getElement<HTMLDivElement>('loginStep1'),
  loginStep2: getElement<HTMLDivElement>('loginStep2'),
  autoDetectBtn: getElement<HTMLButtonElement>('autoDetectBtn'),
  autoDetectError: getElement<HTMLParagraphElement>('autoDetectError'),
  openBrowserLink: getElement<HTMLAnchorElement>('openBrowserLink'),
  nextStepBtn: getElement<HTMLButtonElement>('nextStepBtn'),
  backStepBtn: getElement<HTMLButtonElement>('backStepBtn'),
  sessionKeyInput: getElement<HTMLInputElement>('sessionKeyInput'),
  connectBtn: getElement<HTMLButtonElement>('connectBtn'),
  sessionKeyError: getElement<HTMLParagraphElement>('sessionKeyError'),
  refreshBtn: getElement<HTMLButtonElement>('refreshBtn'),
  minimizeBtn: getElement<HTMLButtonElement>('minimizeBtn'),
  closeBtn: getElement<HTMLButtonElement>('closeBtn'),

  sessionPercentage: getElement<HTMLSpanElement>('sessionPercentage'),
  sessionProgress: getElement<HTMLDivElement>('sessionProgress'),
  sessionTimer: getElement<SVGCircleElement>('sessionTimer'),
  sessionTimeText: getElement<HTMLDivElement>('sessionTimeText'),

  weeklyPercentage: getElement<HTMLSpanElement>('weeklyPercentage'),
  weeklyProgress: getElement<HTMLDivElement>('weeklyProgress'),
  weeklyTimer: getElement<SVGCircleElement>('weeklyTimer'),
  weeklyTimeText: getElement<HTMLDivElement>('weeklyTimeText'),

  sonnetRow: getElement<HTMLDivElement>('sonnetRow'),
  sonnetPercentage: getElement<HTMLSpanElement>('sonnetPercentage'),
  sonnetProgress: getElement<HTMLDivElement>('sonnetProgress'),
  sonnetTimer: getElement<SVGCircleElement>('sonnetTimer'),
  sonnetTimeText: getElement<HTMLDivElement>('sonnetTimeText'),

  statusBar: getElement<HTMLDivElement>('statusBar'),
  statusText: getElement<HTMLSpanElement>('statusText'),
  graphToggleBtn: getElement<HTMLButtonElement>('graphToggleBtn'),
  graphSection: getElement<HTMLDivElement>('graphSection'),
  usageChart: getElement<HTMLCanvasElement>('usageChart'),

  pieToggleBtn: getElement<HTMLButtonElement>('pieToggleBtn'),
  pieSection: getElement<HTMLDivElement>('pieSection'),
  pieChart: getElement<HTMLCanvasElement>('pieChart'),

  expandToggle: getElement<HTMLDivElement>('expandToggle'),
  expandArrow: getElement<SVGElement>('expandArrow'),
  expandSection: getElement<HTMLDivElement>('expandSection'),
  extraRows: getElement<HTMLDivElement>('extraRows'),

  settingsBtn: getElement<HTMLButtonElement>('settingsBtn'),
  settingsOverlay: getElement<HTMLDivElement>('settingsOverlay'),
  settingsContent: getElement<HTMLDivElement>('settingsContent'),
  closeSettingsBtn: getElement<HTMLButtonElement>('closeSettingsBtn'),
  logoutBtn: getElement<HTMLButtonElement>('logoutBtn'),
  clearHistoryBtn: getElement<HTMLButtonElement>('clearHistoryBtn'),
  coffeeBtn: getElement<HTMLButtonElement>('coffeeBtn'),
  coffeeBtnAlt: getElement<HTMLButtonElement>('coffeeBtnAlt'),
  refreshIntervalSlider: getElement<HTMLInputElement>('refreshIntervalSlider'),
  refreshIntervalValue: getElement<HTMLSpanElement>('refreshIntervalValue'),
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

function resizeForSettings(): void {
  const contentHeight = Math.ceil(elements.settingsContent.getBoundingClientRect().height)
  const height = Math.max(WIDGET_HEIGHT_COLLAPSED, contentHeight + 140)
  window.electronAPI.resizeWindow(height)
}

async function loadRefreshInterval(): Promise<void> {
  const saved = await window.electronAPI.getRefreshIntervalMinutes()
  refreshIntervalMinutes = clampRefreshMinutes(saved)
  updateRefreshIntervalUI(refreshIntervalMinutes)
}

async function setRefreshIntervalMinutes(minutes: number): Promise<void> {
  const clamped = clampRefreshMinutes(minutes)
  const stored = await window.electronAPI.setRefreshIntervalMinutes(clamped)
  refreshIntervalMinutes = clampRefreshMinutes(stored)
  updateRefreshIntervalUI(refreshIntervalMinutes)
  if (credentials?.sessionKey && credentials.organizationId) {
    startAutoUpdate()
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

  setupEventListeners()
  await loadRefreshInterval()
  credentials = await window.electronAPI.getCredentials()

  if (credentials.sessionKey && credentials.organizationId) {
    showMainContent()
    await fetchUsageData()
    startAutoUpdate()
  } else {
    showLoginRequired()
  }
}

// Event Listeners
function setupEventListeners(): void {
  // Step 1: Login via BrowserWindow
  elements.autoDetectBtn.addEventListener('click', handleAutoDetect)

  // Step navigation
  elements.nextStepBtn.addEventListener('click', () => {
    elements.loginStep1.style.display = 'none'
    elements.loginStep2.style.display = 'block'
    elements.sessionKeyInput.focus()
  })

  elements.backStepBtn.addEventListener('click', () => {
    elements.loginStep2.style.display = 'none'
    elements.loginStep1.style.display = 'flex'
    elements.sessionKeyError.textContent = ''
  })

  // Open browser link in step 2
  elements.openBrowserLink.addEventListener('click', (e: Event) => {
    e.preventDefault()
    window.electronAPI.openExternal('https://claude.ai')
  })

  // Step 2: Manual sessionKey connect
  elements.connectBtn.addEventListener('click', handleConnect)
  elements.sessionKeyInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleConnect()
    elements.sessionKeyError.textContent = ''
  })

  elements.refreshBtn.addEventListener('click', async () => {
    debugLog('Refresh button clicked')
    elements.refreshBtn.classList.add('spinning')
    await fetchUsageData()
    elements.refreshBtn.classList.remove('spinning')
  })

  elements.minimizeBtn.addEventListener('click', () => {
    window.electronAPI.minimizeWindow()
  })

  elements.closeBtn.addEventListener('click', () => {
    window.electronAPI.closeWindow()
  })

  // Graph toggle
  elements.graphToggleBtn.addEventListener('click', () => {
    isGraphVisible = !isGraphVisible
    elements.graphSection.style.display = isGraphVisible ? 'block' : 'none'
    elements.graphToggleBtn.classList.toggle('active', isGraphVisible)
    if (isGraphVisible) {
      renderUsageChart()
    }
    resizeWidget()
  })

  // Pie chart toggle
  elements.pieToggleBtn.addEventListener('click', () => {
    isPieVisible = !isPieVisible
    elements.pieSection.style.display = isPieVisible ? 'block' : 'none'
    elements.pieToggleBtn.classList.toggle('active', isPieVisible)
    if (isPieVisible) {
      renderPieChart()
    }
    resizeWidget()
  })

  // Expand/collapse toggle
  elements.expandToggle.addEventListener('click', () => {
    isExpanded = !isExpanded
    elements.expandArrow.classList.toggle('expanded', isExpanded)
    elements.expandSection.style.display = isExpanded ? 'block' : 'none'
    resizeWidget()
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
    window.electronAPI.resizeWindow(lastNonSettingsHeight)
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

  elements.logoutBtn.addEventListener('click', async () => {
    await window.electronAPI.deleteCredentials()
    credentials = { sessionKey: null, organizationId: null }
    elements.settingsOverlay.style.display = 'none'
    isSettingsOpen = false
    showLoginRequired()
    window.electronAPI.resizeWindow(WIDGET_HEIGHT_COLLAPSED)
  })

  elements.clearHistoryBtn.addEventListener('click', async () => {
    await window.electronAPI.clearUsageHistory()
    elements.clearHistoryBtn.textContent = 'Cleared!'
    setTimeout(() => {
      elements.clearHistoryBtn.textContent = 'Clear History'
    }, 1500)
    if (isGraphVisible) {
      renderUsageChart()
    }
  })

  elements.coffeeBtn.addEventListener('click', () => {
    window.electronAPI.openExternal('https://paypal.me/SlavomirDurej?country.x=GB&locale.x=en_GB')
  })

  elements.coffeeBtnAlt.addEventListener('click', () => {
    window.electronAPI.openExternal('https://paypal.me/JamesBolton?country.x=GB&locale.x=en_GB')
  })

  // Listen for refresh requests from tray
  window.electronAPI.onRefreshUsage(async () => {
    await fetchUsageData()
  })

  // Listen for session expiration events (403 errors)
  window.electronAPI.onSessionExpired(() => {
    debugLog('Session expired event received')
    credentials = { sessionKey: null, organizationId: null }
    showLoginRequired()
  })
}

// Handle manual sessionKey connect
async function handleConnect(): Promise<void> {
  const sessionKey = elements.sessionKeyInput.value.trim()
  if (!sessionKey) {
    elements.sessionKeyError.textContent = 'Please paste your session key'
    return
  }

  elements.connectBtn.disabled = true
  elements.connectBtn.textContent = '...'
  elements.sessionKeyError.textContent = ''

  try {
    const result = await window.electronAPI.validateSessionKey(sessionKey)
    if (result.success) {
      credentials = { sessionKey, organizationId: result.organizationId ?? null }
      await window.electronAPI.saveCredentials({ sessionKey, organizationId: result.organizationId })
      elements.sessionKeyInput.value = ''
      showMainContent()
      await fetchUsageData()
      startAutoUpdate()
    } else {
      elements.sessionKeyError.textContent = result.error || 'Invalid session key'
    }
  } catch {
    elements.sessionKeyError.textContent = 'Connection failed. Check your key.'
  } finally {
    elements.connectBtn.disabled = false
    elements.connectBtn.textContent = 'Connect'
  }
}

// Handle auto-detect from browser cookies
async function handleAutoDetect(): Promise<void> {
  elements.autoDetectBtn.disabled = true
  elements.autoDetectBtn.textContent = 'Waiting...'
  elements.autoDetectError.textContent = ''

  try {
    const result = await window.electronAPI.detectSessionKey()
    if (!result.success) {
      elements.autoDetectError.textContent = result.error || 'Login failed'
      return
    }

    // Got sessionKey from login, now validate it
    elements.autoDetectBtn.textContent = 'Validating...'
    const validation = await window.electronAPI.validateSessionKey(result.sessionKey!)

    if (validation.success) {
      credentials = {
        sessionKey: result.sessionKey!,
        organizationId: validation.organizationId ?? null,
      }
      await window.electronAPI.saveCredentials({
        sessionKey: result.sessionKey!,
        organizationId: validation.organizationId,
      })
      showMainContent()
      await fetchUsageData()
      startAutoUpdate()
    } else {
      elements.autoDetectError.textContent = 'Session invalid. Try again or use Manual →'
    }
  } catch (error) {
    elements.autoDetectError.textContent = (error as Error).message || 'Login failed'
  } finally {
    elements.autoDetectBtn.disabled = false
    elements.autoDetectBtn.textContent = 'Log in'
  }
}

// Fetch usage data from Claude API
async function fetchUsageData(): Promise<void> {
  debugLog('fetchUsageData called')

  if (!credentials?.sessionKey || !credentials?.organizationId) {
    debugLog('Missing credentials, showing login')
    showLoginRequired()
    return
  }

  try {
    debugLog('Calling electronAPI.fetchUsageData...')
    const data = await window.electronAPI.fetchUsageData()
    debugLog('Received usage data:', data)
    updateUI(data)

    // Record usage history entry
    lastRefreshTime = Date.now()
    updateStatusText()
    startStatusTimer()

    const historyEntry: UsageHistoryEntry = {
      timestamp: lastRefreshTime,
      session: data.five_hour?.utilization || 0,
      weekly: data.seven_day?.utilization || 0,
      sonnet: data.seven_day_sonnet?.utilization || 0,
      opus: data.seven_day_opus?.utilization,
      cowork: data.seven_day_cowork?.utilization,
      oauthApps: data.seven_day_oauth_apps?.utilization,
    }
    await window.electronAPI.saveUsageHistoryEntry(historyEntry)

    // Update tray with latest stats
    window.electronAPI.updateTrayUsage({
      session: historyEntry.session,
      weekly: historyEntry.weekly,
      sonnet: historyEntry.sonnet,
    })

    // Refresh graph if visible
    if (isGraphVisible) {
      renderUsageChart()
    }

    // Refresh pie chart if visible
    if (isPieVisible) {
      renderPieChart()
    }
  } catch (error) {
    console.error('Error fetching usage data:', error)
    const err = error as Error
    if (err.message.includes('SessionExpired') || err.message.includes('Unauthorized')) {
      credentials = { sessionKey: null, organizationId: null }
      showLoginRequired()
    } else {
      debugLog('Failed to fetch usage data')
    }
  }
}

// Check if there's no usage data
function hasNoUsage(data: UsageData): boolean {
  const sessionUtilization = data.five_hour?.utilization || 0
  const sessionResetsAt = data.five_hour?.resets_at
  const weeklyUtilization = data.seven_day?.utilization || 0
  const weeklyResetsAt = data.seven_day?.resets_at

  return sessionUtilization === 0 && !sessionResetsAt && weeklyUtilization === 0 && !weeklyResetsAt
}

// Update UI with usage data
// Extra row label mapping for API fields
interface ExtraRowConfig {
  label: string
  color: string
}

const EXTRA_ROW_CONFIG: Record<string, ExtraRowConfig> = {
  // seven_day_sonnet is shown as a dedicated row above, not in extras
  seven_day_opus: { label: 'Opus (7d)', color: 'opus' },
  seven_day_cowork: { label: 'Cowork (7d)', color: 'weekly' },
  seven_day_oauth_apps: { label: 'OAuth Apps (7d)', color: 'weekly' },
  extra_usage: { label: 'Extra Usage', color: 'extra' },
}

function buildExtraRows(data: UsageData): number {
  elements.extraRows.innerHTML = ''
  let count = 0

  for (const [key, config] of Object.entries(EXTRA_ROW_CONFIG)) {
    const value = data[key] as (UsageTimePeriod & ExtraUsage) | undefined
    // extra_usage is valid with utilization OR balance_cents (prepaid only)
    const hasUtilization = value && value.utilization !== undefined
    const hasBalance = key === 'extra_usage' && value && value.balance_cents != null
    if (!hasUtilization && !hasBalance) continue

    const utilization = value!.utilization || 0
    const resetsAt = value!.resets_at
    const colorClass = config.color

    let percentageHTML: string
    let timerHTML: string

    if (key === 'extra_usage') {
      const extraValue = value as ExtraUsage
      // Percentage area → spending amounts
      if (extraValue.used_cents != null && extraValue.limit_cents != null) {
        const usedDollars = (extraValue.used_cents / 100).toFixed(0)
        const limitDollars = (extraValue.limit_cents / 100).toFixed(0)
        percentageHTML = `<span class="usage-percentage extra-spending">$${usedDollars}/$${limitDollars}</span>`
      } else {
        percentageHTML = `<span class="usage-percentage">${Math.round(utilization)}%</span>`
      }
      // Timer area → prepaid balance
      if (extraValue.balance_cents != null) {
        const balanceDollars = (extraValue.balance_cents / 100).toFixed(0)
        timerHTML = `
                    <div class="timer-container">
                        <span class="timer-text extra-balance">Bal $${balanceDollars}</span>
                    </div>
                `
      } else {
        timerHTML = `<div class="timer-container"></div>`
      }
    } else {
      percentageHTML = `<span class="usage-percentage">${Math.round(utilization)}%</span>`
      const totalMinutes = key.includes('seven_day') ? 7 * 24 * 60 : 5 * 60
      timerHTML = `
                <div class="timer-container">
                    <div class="timer-text" data-resets="${resetsAt || ''}" data-total="${totalMinutes}">--:--</div>
                    <svg class="mini-timer" width="24" height="24" viewBox="0 0 24 24">
                        <circle class="timer-bg" cx="12" cy="12" r="10" />
                        <circle class="timer-progress ${colorClass}" cx="12" cy="12" r="10"
                            style="stroke-dasharray: 63; stroke-dashoffset: 63" />
                    </svg>
                </div>
            `
    }

    const row = document.createElement('div')
    row.className = 'usage-section'
    row.innerHTML = `
            <span class="usage-label">${config.label}</span>
            <div class="progress-bar">
                <div class="progress-fill ${colorClass}" style="width: ${Math.min(utilization, 100)}%"></div>
            </div>
            ${percentageHTML}
            ${timerHTML}
        `

    // Apply warning/danger classes
    const progressEl = row.querySelector('.progress-fill')
    if (progressEl) {
      if (utilization >= 90) progressEl.classList.add('danger')
      else if (utilization >= 75) progressEl.classList.add('warning')
    }

    elements.extraRows.appendChild(row)
    count++
  }

  // Hide toggle if no extra rows
  elements.expandToggle.style.display = count > 0 ? 'flex' : 'none'
  if (count === 0 && isExpanded) {
    isExpanded = false
    elements.expandArrow.classList.remove('expanded')
    elements.expandSection.style.display = 'none'
  }

  return count
}

function refreshExtraTimers(): void {
  const timerTexts = elements.extraRows.querySelectorAll<HTMLDivElement>('.timer-text')
  const timerCircles = elements.extraRows.querySelectorAll<SVGCircleElement>('.timer-progress')

  timerTexts.forEach((textEl, i) => {
    const resetsAt = textEl.dataset.resets
    const totalMinutes = parseInt(textEl.dataset.total || '0')
    const circleEl = timerCircles[i]
    if (resetsAt && circleEl) {
      updateTimer(circleEl, textEl, resetsAt, totalMinutes)
    }
  })
}

function resizeWidget(): void {
  let height = WIDGET_HEIGHT_COLLAPSED

  // Add Sonnet row if visible
  const sonnetVisible = elements.sonnetRow.style.display !== 'none'
  if (sonnetVisible) {
    height += SONNET_ROW_HEIGHT
  }

  // Add graph if visible
  if (isGraphVisible) {
    height += GRAPH_HEIGHT
  }

  // Add pie chart if visible
  if (isPieVisible) {
    height += PIE_HEIGHT
  }

  // Add expanded extra rows
  const extraCount = elements.extraRows.children.length
  if (isExpanded && extraCount > 0) {
    height += 12 + extraCount * WIDGET_ROW_HEIGHT
  }

  lastNonSettingsHeight = height
  if (!isSettingsOpen) {
    window.electronAPI.resizeWindow(height)
  }
}

function updateUI(data: UsageData): void {
  latestUsageData = data

  if (hasNoUsage(data)) {
    showNoUsage()
    return
  }

  showMainContent()

  // Show/hide Weekly Sonnet row
  const sonnetData = data.seven_day_sonnet
  if (sonnetData && sonnetData.utilization !== undefined) {
    elements.sonnetRow.style.display = ''
    updateProgressBar(elements.sonnetProgress, elements.sonnetPercentage, sonnetData.utilization)
    updateTimer(elements.sonnetTimer, elements.sonnetTimeText, sonnetData.resets_at ?? null, 7 * 24 * 60)
  } else {
    elements.sonnetRow.style.display = 'none'
  }

  buildExtraRows(data)
  refreshTimers()
  if (isExpanded) refreshExtraTimers()
  resizeWidget()
  startCountdown()
}

// Track if we've already triggered a refresh for expired timers
let sessionResetTriggered = false
let weeklyResetTriggered = false

function refreshTimers(): void {
  if (!latestUsageData) return

  // Session data
  const sessionUtilization = latestUsageData.five_hour?.utilization || 0
  const sessionResetsAt = latestUsageData.five_hour?.resets_at

  // Check if session timer has expired and we need to refresh
  if (sessionResetsAt) {
    const sessionDiff = new Date(sessionResetsAt).getTime() - Date.now()
    if (sessionDiff <= 0 && !sessionResetTriggered) {
      sessionResetTriggered = true
      debugLog('Session timer expired, triggering refresh...')
      // Wait a few seconds for the server to update, then refresh
      setTimeout(() => {
        fetchUsageData()
      }, 3000)
    } else if (sessionDiff > 0) {
      sessionResetTriggered = false // Reset flag when timer is active again
    }
  }

  updateProgressBar(elements.sessionProgress, elements.sessionPercentage, sessionUtilization)

  updateTimer(elements.sessionTimer, elements.sessionTimeText, sessionResetsAt ?? null, 5 * 60) // 5 hours in minutes

  // Weekly data
  const weeklyUtilization = latestUsageData.seven_day?.utilization || 0
  const weeklyResetsAt = latestUsageData.seven_day?.resets_at

  // Check if weekly timer has expired and we need to refresh
  if (weeklyResetsAt) {
    const weeklyDiff = new Date(weeklyResetsAt).getTime() - Date.now()
    if (weeklyDiff <= 0 && !weeklyResetTriggered) {
      weeklyResetTriggered = true
      debugLog('Weekly timer expired, triggering refresh...')
      setTimeout(() => {
        fetchUsageData()
      }, 3000)
    } else if (weeklyDiff > 0) {
      weeklyResetTriggered = false
    }
  }

  updateProgressBar(elements.weeklyProgress, elements.weeklyPercentage, weeklyUtilization)

  updateTimer(
    elements.weeklyTimer,
    elements.weeklyTimeText,
    weeklyResetsAt ?? null,
    7 * 24 * 60, // 7 days in minutes
  )
}

function startCountdown(): void {
  if (countdownInterval) clearInterval(countdownInterval)
  countdownInterval = setInterval(() => {
    refreshTimers()
    refreshSonnetTimer()
    if (isExpanded) refreshExtraTimers()
  }, 1000)
}

function refreshSonnetTimer(): void {
  if (!latestUsageData) return
  const sonnetData = latestUsageData.seven_day_sonnet
  if (!sonnetData || sonnetData.utilization === undefined) return
  if (elements.sonnetRow.style.display === 'none') return

  updateProgressBar(elements.sonnetProgress, elements.sonnetPercentage, sonnetData.utilization)
  updateTimer(elements.sonnetTimer, elements.sonnetTimeText, sonnetData.resets_at ?? null, 7 * 24 * 60)
}

// Update progress bar
function updateProgressBar(
  progressElement: HTMLDivElement,
  percentageElement: HTMLSpanElement,
  value: number,
): void {
  const percentage = Math.min(Math.max(value, 0), 100)

  progressElement.style.width = `${percentage}%`
  percentageElement.textContent = `${Math.round(percentage)}%`

  // Update color based on usage level
  progressElement.classList.remove('warning', 'danger')
  if (percentage >= 90) {
    progressElement.classList.add('danger')
  } else if (percentage >= 75) {
    progressElement.classList.add('warning')
  }
}

// Update circular timer
function updateTimer(
  timerElement: SVGCircleElement,
  textElement: HTMLElement,
  resetsAt: string | null | undefined,
  totalMinutes: number,
): void {
  if (!resetsAt) {
    textElement.textContent = '--:--'
    textElement.style.opacity = '0.5'
    textElement.title = 'Starts when a message is sent'
    timerElement.style.strokeDashoffset = '63'
    return
  }

  // Clear the greyed out styling and tooltip when timer is active
  textElement.style.opacity = '1'
  textElement.title = ''

  const resetDate = new Date(resetsAt)
  const now = new Date()
  const diff = resetDate.getTime() - now.getTime()

  if (diff <= 0) {
    textElement.textContent = 'Resetting...'
    timerElement.style.strokeDashoffset = '0'
    return
  }

  // Calculate remaining time
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  // Format time display
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    textElement.textContent = `${days}d ${remainingHours}h`
  } else if (hours > 0) {
    textElement.textContent = `${hours}h ${minutes}m`
  } else {
    textElement.textContent = `${minutes}m`
  }

  // Calculate progress (elapsed percentage)
  const totalMs = totalMinutes * 60 * 1000
  const elapsedMs = totalMs - diff
  const elapsedPercentage = (elapsedMs / totalMs) * 100

  // Update circle (63 is ~2*pi*10)
  const circumference = 63
  const offset = circumference - (elapsedPercentage / 100) * circumference
  timerElement.style.strokeDashoffset = String(offset)

  // Update color based on remaining time
  timerElement.classList.remove('warning', 'danger')
  if (elapsedPercentage >= 90) {
    timerElement.classList.add('danger')
  } else if (elapsedPercentage >= 75) {
    timerElement.classList.add('warning')
  }
}

// UI State Management
function showLoginRequired(): void {
  elements.loadingContainer.style.display = 'none'
  elements.loginContainer.style.display = 'flex'
  elements.noUsageContainer.style.display = 'none'
  elements.mainContent.style.display = 'none'
  // Reset to step 1
  elements.loginStep1.style.display = 'flex'
  elements.loginStep2.style.display = 'none'
  elements.sessionKeyError.textContent = ''
  elements.sessionKeyInput.value = ''
  stopAutoUpdate()
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
}

function showNoUsage(): void {
  elements.loadingContainer.style.display = 'none'
  elements.loginContainer.style.display = 'none'
  elements.noUsageContainer.style.display = 'flex'
  elements.mainContent.style.display = 'none'
}

function showMainContent(): void {
  elements.loadingContainer.style.display = 'none'
  elements.loginContainer.style.display = 'none'
  elements.noUsageContainer.style.display = 'none'
  elements.mainContent.style.display = 'block'
}

// Auto-update management
function startAutoUpdate(): void {
  stopAutoUpdate()
  updateInterval = setInterval(() => {
    fetchUsageData()
  }, refreshIntervalMinutes * 60 * 1000)
}

function stopAutoUpdate(): void {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
}

// Status bar "Refreshed X minutes ago" logic
function updateStatusText(): void {
  if (!lastRefreshTime) {
    elements.statusText.textContent = 'Refreshed just now'
    return
  }
  const elapsed = Date.now() - lastRefreshTime
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) {
    elements.statusText.textContent = 'Refreshed just now'
  } else if (minutes === 1) {
    elements.statusText.textContent = 'Refreshed 1 minute ago'
  } else {
    elements.statusText.textContent = `Refreshed ${minutes} minutes ago`
  }
}

function startStatusTimer(): void {
  if (statusInterval) clearInterval(statusInterval)
  statusInterval = setInterval(updateStatusText, 30000) // update every 30s
}

// Lightweight Canvas 2D usage history chart (no external dependencies)
async function renderUsageChart(): Promise<void> {
  try {
    const history = await window.electronAPI.getUsageHistory()

    // Filter to last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = history.filter((e) => e.timestamp >= sevenDaysAgo)

    // Group by hour for cleaner display
    const hourlyData: Record<string, UsageHistoryEntry> = {}
    for (const entry of recent) {
      const date = new Date(entry.timestamp)
      const hourKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`
      if (!hourlyData[hourKey] || entry.timestamp > hourlyData[hourKey].timestamp) {
        hourlyData[hourKey] = entry
      }
    }

    const sortedKeys = Object.keys(hourlyData).sort()
    const labels = sortedKeys.map((k) => {
      const parts = k.split(' ')
      const dateParts = parts[0].split('-')
      return `${dateParts[1]}/${dateParts[2]} ${parts[1]}`
    })
    const sessionData = sortedKeys.map((k) => hourlyData[k].session)
    const weeklyData = sortedKeys.map((k) => hourlyData[k].weekly)
    const sonnetData = sortedKeys.map((k) => hourlyData[k].sonnet || 0)
    const opusData = sortedKeys.map((k) => hourlyData[k].opus || 0)
    const coworkData = sortedKeys.map((k) => hourlyData[k].cowork || 0)
    const hasOpus = opusData.some((v) => v > 0)
    const hasCowork = coworkData.some((v) => v > 0)

    const canvas = elements.usageChart
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.parentElement!.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = (rect.height - 16) * dpr // account for padding
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height - 16 + 'px'

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height - 16
    const padLeft = 30
    const padRight = 10
    const padTop = 20
    const padBottom = 20
    const chartW = w - padLeft - padRight
    const chartH = h - padTop - padBottom

    // Clear
    ctx.clearRect(0, 0, w, h)

    // No data message
    if (sortedKeys.length < 2) {
      ctx.fillStyle = '#505050'
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Usage history will appear after a few refreshes', w / 2, h / 2)
      return
    }

    // Y-axis labels and grid
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif'
    for (let pct = 0; pct <= 100; pct += 25) {
      const y = padTop + chartH - (pct / 100) * chartH
      ctx.fillStyle = '#505050'
      ctx.fillText(pct + '%', padLeft - 4, y)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padLeft, y)
      ctx.lineTo(padLeft + chartW, y)
      ctx.stroke()
    }

    // X-axis labels (show ~6 labels)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const labelStep = Math.max(1, Math.floor(sortedKeys.length / 6))
    for (let i = 0; i < sortedKeys.length; i += labelStep) {
      const x = padLeft + (i / (sortedKeys.length - 1)) * chartW
      ctx.fillStyle = '#505050'
      ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillText(labels[i], x, padTop + chartH + 4)
    }

    // Draw line helper
    function drawLine(data: number[], color: string, fillColor: string): void {
      if (data.length < 2) return
      ctx!.beginPath()
      for (let i = 0; i < data.length; i++) {
        const x = padLeft + (i / (data.length - 1)) * chartW
        const y = padTop + chartH - (data[i] / 100) * chartH
        if (i === 0) ctx!.moveTo(x, y)
        else ctx!.lineTo(x, y)
      }
      ctx!.strokeStyle = color
      ctx!.lineWidth = 1.5
      ctx!.stroke()

      // Fill area
      const lastX = padLeft + ((data.length - 1) / (data.length - 1)) * chartW
      ctx!.lineTo(lastX, padTop + chartH)
      ctx!.lineTo(padLeft, padTop + chartH)
      ctx!.closePath()
      ctx!.fillStyle = fillColor
      ctx!.fill()
    }

    drawLine(sessionData, '#8b5cf6', 'rgba(139, 92, 246, 0.1)')
    drawLine(weeklyData, '#3b82f6', 'rgba(59, 130, 246, 0.08)')
    drawLine(sonnetData, '#8b5cf6', 'rgba(139, 92, 246, 0.06)')
    if (hasOpus) drawLine(opusData, '#f59e0b', 'rgba(245, 158, 11, 0.06)')
    if (hasCowork) drawLine(coworkData, '#10b981', 'rgba(16, 185, 129, 0.06)')

    // Legend — dynamic based on available series
    interface LegendItem {
      label: string
      color: string
    }
    const legendItems: LegendItem[] = [
      { label: 'Session', color: '#8b5cf6' },
      { label: 'Weekly', color: '#3b82f6' },
      { label: 'Sonnet', color: '#8b5cf6' },
    ]
    if (hasOpus) legendItems.push({ label: 'Opus', color: '#f59e0b' })
    if (hasCowork) legendItems.push({ label: 'Cowork', color: '#10b981' })

    const legendY = 6
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    let legendX = padLeft
    for (const item of legendItems) {
      ctx.fillStyle = item.color
      ctx.fillRect(legendX, legendY - 3, 10, 6)
      ctx.fillStyle = '#a0a0a0'
      ctx.fillText(item.label, legendX + 14, legendY)
      legendX += 54
    }
  } catch (error) {
    debugLog('Chart rendering failed:', error)
  }
}

// Two-ring donut chart:
//   Outer ring = weekly model proportional split (Sonnet, Opus, etc.)
//              = dim placeholder when no per-model data available
//   Inner ring = session utilisation arc (used vs remaining)
//   Centre     = session % label
function renderPieChart(): void {
  if (!latestUsageData) return

  const canvas = elements.pieChart
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.parentElement!.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = (rect.height - 16) * dpr
  canvas.style.width = rect.width + 'px'
  canvas.style.height = rect.height - 16 + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)

  const w = rect.width
  const h = rect.height - 16

  ctx.clearRect(0, 0, w, h)

  interface PieSlice {
    label: string
    value: number // 0-100 utilization %
    color: string
  }

  // Outer ring: per-model weekly slices, sized by proportional share.
  // Future model keys (e.g. seven_day_haiku) surface automatically via the index signature.
  const MODEL_COLORS: Record<string, string> = {
    seven_day_sonnet:     '#8b5cf6',
    seven_day_opus:       '#f59e0b',
    seven_day_cowork:     '#10b981',
    seven_day_oauth_apps: '#06b6d4',
  }
  const MODEL_LABELS: Record<string, string> = {
    seven_day_sonnet:     'Sonnet',
    seven_day_opus:       'Opus',
    seven_day_cowork:     'Cowork',
    seven_day_oauth_apps: 'OAuth',
  }

  const outerSlices: PieSlice[] = Object.entries(latestUsageData)
    .filter(([key, val]) => key.startsWith('seven_day_') && (val as UsageTimePeriod)?.utilization != null)
    .map(([key, val]) => ({
      label: MODEL_LABELS[key] ?? key.replace('seven_day_', '').replace(/_/g, ' '),
      value: (val as UsageTimePeriod).utilization!,
      color: MODEL_COLORS[key] ?? '#a0a0a0',
    }))
    .filter((s) => s.value > 0)

  const sessionPct = latestUsageData.five_hour?.utilization || 0
  const weeklyPct  = latestUsageData.seven_day?.utilization  || 0
  const hasModels  = outerSlices.length > 0
  const hasData    = hasModels || sessionPct > 0 || weeklyPct > 0

  if (!hasData) {
    ctx.fillStyle = '#505050'
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No data available', w / 2, h / 2)
    return
  }

  // Geometry — donut center shifted left to leave room for right-side legend
  const legendColW  = 96
  const maxR        = Math.min((w - legendColW) / 2, h / 2) * 0.88
  const ringW       = maxR * 0.28          // thickness of each ring
  const ringGap     = maxR * 0.07          // gap between outer and inner rings
  const outerOuter  = maxR
  const outerInner  = maxR - ringW
  const innerOuter  = outerInner - ringGap
  const innerInner  = innerOuter - ringW
  const cx  = (w - legendColW) / 2
  const cy  = h / 2
  const TAU = 2 * Math.PI
  const START     = -Math.PI / 2          // 12 o'clock
  const OUTER_GAP = hasModels && outerSlices.length > 1 ? 0.025 : 0

  // Helper: filled donut arc segment
  function drawArc(ro: number, ri: number, a0: number, a1: number, color: string): void {
    ctx!.beginPath()
    ctx!.arc(cx, cy, ro, a0, a1)
    ctx!.arc(cx, cy, ri, a1, a0, true)
    ctx!.closePath()
    ctx!.fillStyle = color
    ctx!.fill()
  }

  // --- Outer ring: weekly model breakdown ---
  if (hasModels) {
    const total = outerSlices.reduce((sum, s) => sum + s.value, 0)
    let angle = START
    for (const slice of outerSlices) {
      const sweep = (slice.value / total) * TAU - OUTER_GAP
      drawArc(outerOuter, outerInner, angle + OUTER_GAP / 2, angle + sweep + OUTER_GAP / 2, slice.color)
      angle += (slice.value / total) * TAU
    }
  } else {
    // No per-model data yet — dim placeholder full ring
    drawArc(outerOuter, outerInner, START, START + TAU, 'rgba(255,255,255,0.06)')
  }

  // --- Inner ring: session utilisation arc ---
  const usedAngle = (Math.min(sessionPct, 100) / 100) * TAU
  // Used portion (purple)
  if (usedAngle > 0.01) {
    drawArc(innerOuter, innerInner, START, START + usedAngle, '#8b5cf6')
  }
  // Remaining portion (dim)
  if (usedAngle < TAU - 0.01) {
    drawArc(innerOuter, innerInner, START + usedAngle, START + TAU, 'rgba(139,92,246,0.14)')
  }

  // --- Centre label: session % ---
  const labelSize = Math.max(8, Math.round(innerInner * 0.42))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${labelSize}px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.fillStyle = '#c0c0c0'
  ctx.fillText(`${Math.round(sessionPct)}%`, cx, cy)

  // --- Right-side legend ---
  const legendX    = cx + outerOuter + 14
  const itemH      = 16
  const headerH    = 12

  // Calculate total legend height to vertically centre it
  const modelRows  = hasModels ? outerSlices.length : 1   // 1 for "No model data" placeholder
  const totalH     = headerH + modelRows * itemH + 8 + headerH + itemH
  let ly = cy - totalH / 2

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  function legendHeader(text: string): void {
    ctx!.font = '8px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx!.fillStyle = '#808080'
    ctx!.fillText(text, legendX, ly + headerH / 2)
    ly += headerH
  }

  function legendRow(color: string, label: string, sub: string): void {
    ctx!.fillStyle = color
    ctx!.fillRect(legendX, ly + itemH / 2 - 3, 8, 6)
    ctx!.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx!.fillStyle = '#c0c0c0'
    ctx!.fillText(label, legendX + 12, ly + itemH / 2 - 3)
    ctx!.font = '8px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx!.fillStyle = '#606060'
    ctx!.fillText(sub, legendX + 12, ly + itemH / 2 + 5)
    ly += itemH
  }

  // Weekly models section
  legendHeader('WEEKLY MODELS')
  if (hasModels) {
    const total = outerSlices.reduce((sum, s) => sum + s.value, 0)
    for (const s of outerSlices) {
      legendRow(s.color, s.label, `${Math.round(s.value)}% · ${Math.round((s.value / total) * 100)}% share`)
    }
  } else {
    ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillStyle = '#404040'
    ctx.fillText('No model data from API', legendX, ly + itemH / 2)
    ly += itemH
  }

  // Session section
  ly += 8
  legendHeader('SESSION')
  legendRow('#8b5cf6', `${Math.round(sessionPct)}% used`, `of 5h window`)
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
  stopAutoUpdate()
  if (countdownInterval) clearInterval(countdownInterval)
  if (statusInterval) clearInterval(statusInterval)
})
