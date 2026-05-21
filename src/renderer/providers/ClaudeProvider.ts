import { BaseProvider } from './BaseProvider'
import { elements } from '../ui/elements'
import { getThemeColors, hexToRgba } from '../ui/theme'
import { updateProgressBar, updateTimer, updateUsageRing, debugLog } from '../ui/utils'
import type { UsageData, UsageTimePeriod, ExtraUsage, Credentials, UsageHistoryEntry } from '../../shared/ipc-types'

export interface ClaudeProviderOptions {
  onResize: () => void
  onLoginStateChange: (isLoggedIn: boolean) => void
  onDataRefresh: () => void
  getRefreshInterval: () => number
}

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

export class ClaudeProvider extends BaseProvider {
  id = 'claude'
  latestUsageData: UsageData | null = null
  isOffline = false
  isExpanded = false
  isGraphVisible = false
  isPieVisible = false

  private credentials: Credentials | null = null
  private offlineRetryInterval: ReturnType<typeof setInterval> | null = null
  private sessionResetTriggered = false
  private weeklyResetTriggered = false

  constructor(private options: ClaudeProviderOptions) {
    super()
    this.setupEventListeners()
  }

  async init(): Promise<void> {
    this.credentials = await window.electronAPI.getCredentials()
    if (this.credentials.sessionKey && this.credentials.organizationId) {
      this.options.onLoginStateChange(true)
    } else {
      this.options.onLoginStateChange(false)
    }
  }

  async fetchData(): Promise<void> {
    if (!this.credentials?.sessionKey || !this.credentials?.organizationId) {
      this.options.onLoginStateChange(false)
      return
    }

    try {
      const data = await window.electronAPI.fetchUsageData()
      this.isOffline = false
      this.stopOfflineRetry()
      
      this.latestUsageData = data
      this.hasData = true
      this.lastRefreshTime = Date.now()
      this.updateUI()
      this.updateStatusText()
      this.startTimers()
    } catch (error) {
      console.error('Error fetching usage data:', error)
      const err = error as Error
      if (err.message.includes('SessionExpired') || err.message.includes('Unauthorized')) {
        this.credentials = { sessionKey: null, organizationId: null }
        this.options.onLoginStateChange(false)
      } else {
        const cached = await window.electronAPI.getCachedUsage()
        if (cached) {
          this.isOffline = true
          this.latestUsageData = cached.data
          this.hasData = true
          this.lastRefreshTime = cached.timestamp
          this.updateUI()
          this.updateStatusText()
          this.startTimers()
          this.startOfflineRetry()
        }
      }
    }
  }

  updateUI(): void {
    if (!this.latestUsageData) return

    const sonnetData = this.latestUsageData.seven_day_sonnet
    if (sonnetData && sonnetData.utilization !== undefined) {
      elements.sonnetRow.style.display = ''
      updateProgressBar(elements.sonnetProgress, elements.sonnetPercentage, sonnetData.utilization)
      updateTimer(elements.sonnetTimer, elements.sonnetTimeText, sonnetData.resets_at ?? null, 7 * 24 * 60)
    } else {
      elements.sonnetRow.style.display = 'none'
    }

    this.buildExtraRows(this.latestUsageData)
    this.refreshTimers()
    if (this.isExpanded) this.refreshExtraTimers()
    this.options.onResize()
  }

  renderCharts(): void {
    if (this.isGraphVisible) void this.renderUsageChart()
    if (this.isPieVisible) this.renderPieChart()
  }

  startTimers(): void {
    this.stopTimers()
    
    const countdown = setInterval(() => {
      this.refreshTimers()
      this.refreshSonnetTimer()
      if (this.isExpanded) this.refreshExtraTimers()
    }, 1000)
    this.registerInterval(countdown)

    const status = setInterval(() => this.updateStatusText(), 30000)
    this.registerInterval(status)
  }

  showLogin(): void {
    elements.loginStep1.style.display = 'flex'
    elements.loginStep2.style.display = 'none'
    elements.sessionKeyError.textContent = ''
    elements.sessionKeyInput.value = ''
    this.stopTimers()
    this.stopOfflineRetry()
  }

  destroy(): void {
    super.destroy()
    this.credentials = null
    this.latestUsageData = null
    this.isExpanded = false
    this.isGraphVisible = false
    this.isPieVisible = false
    this.stopOfflineRetry()
  }

  // --- Private Helpers ---

  private buildExtraRows(data: UsageData): number {
    elements.extraRows.innerHTML = ''
    let count = 0
    const formatGBP = (cents: number): string =>
      new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(cents / 100)

    for (const [key, config] of Object.entries(EXTRA_ROW_CONFIG)) {
      const value = data[key] as (UsageTimePeriod & ExtraUsage) | undefined
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
        if (extraValue.used_cents != null && extraValue.limit_cents != null) {
          const usedAmount = formatGBP(extraValue.used_cents)
          const limitAmount = formatGBP(extraValue.limit_cents)
          percentageHTML = `<span class="usage-percentage extra-spending">${usedAmount}/${limitAmount}</span>`
        } else {
          percentageHTML = `<span class="usage-percentage">${Math.round(utilization)}%</span>`
        }
        if (extraValue.balance_cents != null) {
          const balanceAmount = formatGBP(extraValue.balance_cents)
          timerHTML = `<div class="timer-container"><span class="timer-text extra-balance">Bal ${balanceAmount}</span></div>`
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

      const progressEl = row.querySelector('.progress-fill')
      if (progressEl) {
        if (utilization >= 90) progressEl.classList.add('danger')
        else if (utilization >= 75) progressEl.classList.add('warning')
      }

      elements.extraRows.appendChild(row)
      count++
    }

    elements.extraUsageToggleBtn.style.display = count > 0 ? 'flex' : 'none'
    if (count === 0 && this.isExpanded) {
      this.isExpanded = false
      elements.extraUsageToggleBtn.classList.remove('active')
      elements.expandSection.style.display = 'none'
    }

    return count
  }

  private refreshExtraTimers(): void {
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

  private refreshTimers(): void {
    if (!this.latestUsageData) return

    const sessionUtilization = this.latestUsageData.five_hour?.utilization || 0
    const sessionResetsAt = this.latestUsageData.five_hour?.resets_at

    if (sessionResetsAt) {
      const sessionDiff = new Date(sessionResetsAt).getTime() - Date.now()
      if (sessionDiff <= 0 && !this.sessionResetTriggered) {
        this.sessionResetTriggered = true
        debugLog('Session timer expired, triggering refresh...')
        setTimeout(() => this.options.onDataRefresh(), 3000)
      } else if (sessionDiff > 0) {
        this.sessionResetTriggered = false
      }
    }

    updateProgressBar(elements.sessionProgress, elements.sessionPercentage, sessionUtilization)
    updateUsageRing(elements.sessionUsageRing, sessionUtilization)
    updateTimer(elements.sessionTimer, elements.sessionTimeText, sessionResetsAt ?? null, 5 * 60)

    const weeklyUtilization = this.latestUsageData.seven_day?.utilization || 0
    const weeklyResetsAt = this.latestUsageData.seven_day?.resets_at

    if (weeklyResetsAt) {
      const weeklyDiff = new Date(weeklyResetsAt).getTime() - Date.now()
      if (weeklyDiff <= 0 && !this.weeklyResetTriggered) {
        this.weeklyResetTriggered = true
        debugLog('Weekly timer expired, triggering refresh...')
        setTimeout(() => this.options.onDataRefresh(), 3000)
      } else if (weeklyDiff > 0) {
        this.weeklyResetTriggered = false
      }
    }

    updateProgressBar(elements.weeklyProgress, elements.weeklyPercentage, weeklyUtilization)
    updateUsageRing(elements.weeklyUsageRing, weeklyUtilization)
    updateTimer(elements.weeklyTimer, elements.weeklyTimeText, weeklyResetsAt ?? null, 7 * 24 * 60)
  }

  private refreshSonnetTimer(): void {
    if (!this.latestUsageData) return
    const sonnetData = this.latestUsageData.seven_day_sonnet
    if (!sonnetData || sonnetData.utilization === undefined) return
    if (elements.sonnetRow.style.display === 'none') return

    updateProgressBar(elements.sonnetProgress, elements.sonnetPercentage, sonnetData.utilization)
    updateTimer(elements.sonnetTimer, elements.sonnetTimeText, sonnetData.resets_at ?? null, 7 * 24 * 60)
  }

  private updateStatusText(): void {
    if (!this.lastRefreshTime) {
      elements.statusText.textContent = this.isOffline ? 'Offline · No data' : 'Refreshed just now'
      return
    }
    const elapsed = Date.now() - this.lastRefreshTime
    const minutes = Math.floor(elapsed / 60000)
    let timeStr: string
    if (minutes < 1) timeStr = 'just now'
    else if (minutes === 1) timeStr = '1 minute ago'
    else timeStr = `${minutes} minutes ago`

    if (this.isOffline) {
      elements.statusText.textContent = `Offline · Last updated ${timeStr}`
    } else {
      elements.statusText.textContent = minutes < 1 ? 'Refreshed just now' : `Refreshed ${timeStr}`
    }
  }

  private startOfflineRetry(): void {
    this.stopOfflineRetry()
    this.offlineRetryInterval = setInterval(async () => {
      try {
        const data = await window.electronAPI.fetchUsageData()
        this.isOffline = false
        this.stopOfflineRetry()
        this.latestUsageData = data
        this.hasData = true
        this.lastRefreshTime = Date.now()
        this.updateUI()
        this.updateStatusText()
        this.startTimers()
        // Alert orchestrator so it updates history/tray
        this.options.onDataRefresh()
      } catch {
        // Still offline
      }
    }, this.options.getRefreshInterval() * 60 * 1000)
  }

  private stopOfflineRetry(): void {
    if (this.offlineRetryInterval) {
      clearInterval(this.offlineRetryInterval)
      this.offlineRetryInterval = null
    }
  }

  private async renderUsageChart(): Promise<void> {
    try {
      const { claudePrimary, claudeSecondary, claudeSecondaryLight } = getThemeColors()
      const history = await window.electronAPI.getUsageHistory()

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      const recent = history.filter((e) => e.timestamp >= sevenDaysAgo)

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
      const chartHeight = rect.height - 28
      canvas.width = rect.width * dpr
      canvas.height = chartHeight * dpr
      canvas.style.width = rect.width + 'px'
      canvas.style.height = chartHeight + 'px'

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)

      const w = rect.width
      const h = chartHeight
      const padLeft = 30
      const padRight = 10
      const padTop = 20
      const padBottom = 20
      const chartW = w - padLeft - padRight
      const chartH = h - padTop - padBottom

      ctx.clearRect(0, 0, w, h)

      if (sortedKeys.length < 2) {
        ctx.fillStyle = '#505050'
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Usage history will appear after a few refreshes', w / 2, h / 2)
        return
      }

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

      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const labelStep = Math.max(1, Math.floor(sortedKeys.length / 6))
      for (let i = 0; i < sortedKeys.length; i += labelStep) {
        const x = padLeft + (i / (sortedKeys.length - 1)) * chartW
        ctx.fillStyle = '#505050'
        ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif'
        ctx.fillText(labels[i], x, padTop + chartH + 4)
      }

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
        const lastX = padLeft + ((data.length - 1) / (data.length - 1)) * chartW
        ctx!.lineTo(lastX, padTop + chartH)
        ctx!.lineTo(padLeft, padTop + chartH)
        ctx!.closePath()
        ctx!.fillStyle = fillColor
        ctx!.fill()
      }

      drawLine(sessionData, claudePrimary, hexToRgba(claudePrimary, 0.1))
      drawLine(weeklyData, claudeSecondary, hexToRgba(claudeSecondary, 0.08))
      drawLine(sonnetData, claudePrimary, hexToRgba(claudePrimary, 0.06))
      if (hasOpus) drawLine(opusData, '#f59e0b', 'rgba(245, 158, 11, 0.06)')
      if (hasCowork) drawLine(coworkData, '#10b981', 'rgba(16, 185, 129, 0.06)')

      interface LegendItem { label: string; color: string }
      const legendItems: LegendItem[] = [
        { label: 'Session', color: claudePrimary },
        { label: 'Weekly', color: claudeSecondaryLight || claudeSecondary },
        { label: 'Sonnet', color: claudePrimary },
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

  private renderPieChart(): void {
    if (!this.latestUsageData) return
    const { claudePrimary } = getThemeColors()

    const canvas = elements.pieChart
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.parentElement!.getBoundingClientRect()
    const chartHeight = rect.height - 28
    canvas.width = rect.width * dpr
    canvas.height = chartHeight * dpr
    canvas.style.width = rect.width + 'px'
    canvas.style.height = chartHeight + 'px'

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = chartHeight
    ctx.clearRect(0, 0, w, h)

    interface PieSlice { label: string; value: number; color: string }

    const MODEL_COLORS: Record<string, string> = {
      seven_day_sonnet: claudePrimary,
      seven_day_opus: '#f59e0b',
      seven_day_cowork: '#10b981',
      seven_day_oauth_apps: '#06b6d4',
    }
    const MODEL_LABELS: Record<string, string> = {
      seven_day_sonnet: 'Sonnet',
      seven_day_opus: 'Opus',
      seven_day_cowork: 'Cowork',
      seven_day_oauth_apps: 'OAuth',
    }

    const outerSlices: PieSlice[] = Object.entries(this.latestUsageData)
      .filter(([key, val]) => key.startsWith('seven_day_') && (val as UsageTimePeriod)?.utilization != null)
      .map(([key, val]) => ({
        label: MODEL_LABELS[key] ?? key.replace('seven_day_', '').replace(/_/g, ' '),
        value: (val as UsageTimePeriod).utilization!,
        color: MODEL_COLORS[key] ?? '#a0a0a0',
      }))
      .filter((s) => s.value > 0)

    const sessionPct = this.latestUsageData.five_hour?.utilization || 0
    const weeklyPct = this.latestUsageData.seven_day?.utilization || 0
    const hasModels = outerSlices.length > 0
    const hasData = hasModels || sessionPct > 0 || weeklyPct > 0

    if (!hasData) {
      ctx.fillStyle = '#505050'
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No data available', w / 2, h / 2)
      return
    }

    const legendColW = 96
    const maxR = Math.min((w - legendColW) / 2, h / 2) * 0.88
    const ringW = maxR * 0.28
    const ringGap = maxR * 0.07
    const outerOuter = maxR
    const outerInner = maxR - ringW
    const innerOuter = outerInner - ringGap
    const innerInner = innerOuter - ringW
    const cx = (w - legendColW) / 2
    const cy = h / 2
    const TAU = 2 * Math.PI
    const START = -Math.PI / 2
    const OUTER_GAP = hasModels && outerSlices.length > 1 ? 0.025 : 0

    function drawArc(ro: number, ri: number, a0: number, a1: number, color: string): void {
      ctx!.beginPath()
      ctx!.arc(cx, cy, ro, a0, a1)
      ctx!.arc(cx, cy, ri, a1, a0, true)
      ctx!.closePath()
      ctx!.fillStyle = color
      ctx!.fill()
    }

    if (hasModels) {
      const total = outerSlices.reduce((sum, s) => sum + s.value, 0)
      let angle = START
      for (const slice of outerSlices) {
        const sweep = (slice.value / total) * TAU - OUTER_GAP
        drawArc(outerOuter, outerInner, angle + OUTER_GAP / 2, angle + sweep + OUTER_GAP / 2, slice.color)
        angle += (slice.value / total) * TAU
      }
    } else {
      drawArc(outerOuter, outerInner, START, START + TAU, 'rgba(255,255,255,0.06)')
    }

    const usedAngle = (Math.min(sessionPct, 100) / 100) * TAU
    if (usedAngle > 0.01) {
      drawArc(innerOuter, innerInner, START, START + usedAngle, claudePrimary)
    }
    if (usedAngle < TAU - 0.01) {
      drawArc(innerOuter, innerInner, START + usedAngle, START + TAU, hexToRgba(claudePrimary, 0.14))
    }

    const labelSize = Math.max(8, Math.round(innerInner * 0.42))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${labelSize}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.fillStyle = '#c0c0c0'
    ctx.fillText(`${Math.round(sessionPct)}%`, cx, cy)

    const legendX = cx + outerOuter + 14
    const itemH = 16
    const headerH = 12
    const modelRows = hasModels ? outerSlices.length : 1
    const totalH = headerH + modelRows * itemH + 8 + headerH + itemH
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

    ly += 8
    legendHeader('SESSION')
    legendRow(claudePrimary, `${Math.round(sessionPct)}% used`, `of 5h window`)
  }

  private async handleConnect(): Promise<void> {
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
        this.credentials = { sessionKey, organizationId: result.organizationId ?? null }
        await window.electronAPI.saveCredentials({ sessionKey, organizationId: result.organizationId })
        elements.sessionKeyInput.value = ''
        this.options.onLoginStateChange(true)
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

  private async handleAutoDetect(): Promise<void> {
    elements.autoDetectBtn.disabled = true
    elements.autoDetectBtn.textContent = 'Waiting...'
    elements.autoDetectError.textContent = ''

    try {
      const result = await window.electronAPI.detectSessionKey()
      if (!result.success) {
        elements.autoDetectError.textContent = result.error || 'Login failed'
        return
      }

      elements.autoDetectBtn.textContent = 'Validating...'
      const validation = await window.electronAPI.validateSessionKey(result.sessionKey!)

      if (validation.success) {
        this.credentials = {
          sessionKey: result.sessionKey!,
          organizationId: validation.organizationId ?? null,
        }
        await window.electronAPI.saveCredentials({
          sessionKey: result.sessionKey!,
          organizationId: validation.organizationId,
        })
        this.options.onLoginStateChange(true)
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

  private setupEventListeners(): void {
    elements.autoDetectBtn.addEventListener('click', () => { void this.handleAutoDetect() })

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

    elements.openBrowserLink.addEventListener('click', (e: Event) => {
      e.preventDefault()
      window.electronAPI.openExternal('https://claude.ai')
    })

    elements.connectBtn.addEventListener('click', () => { void this.handleConnect() })
    elements.sessionKeyInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') void this.handleConnect()
      elements.sessionKeyError.textContent = ''
    })

    elements.graphToggleBtn.addEventListener('click', () => {
      this.isGraphVisible = !this.isGraphVisible
      elements.graphSection.style.display = this.isGraphVisible ? 'block' : 'none'
      elements.graphToggleBtn.classList.toggle('active', this.isGraphVisible)
      if (this.isGraphVisible) void this.renderUsageChart()
      this.options.onResize()
    })

    elements.pieToggleBtn.addEventListener('click', () => {
      this.isPieVisible = !this.isPieVisible
      elements.pieSection.style.display = this.isPieVisible ? 'block' : 'none'
      elements.pieToggleBtn.classList.toggle('active', this.isPieVisible)
      if (this.isPieVisible) this.renderPieChart()
      this.options.onResize()
    })

    elements.extraUsageToggleBtn.addEventListener('click', () => {
      this.isExpanded = !this.isExpanded
      elements.extraUsageToggleBtn.classList.toggle('active', this.isExpanded)
      elements.expandSection.style.display = this.isExpanded ? 'block' : 'none'
      this.options.onResize()
    })

    window.electronAPI.onSessionExpired(() => {
      debugLog('Session expired event received')
      this.credentials = { sessionKey: null, organizationId: null }
      this.options.onLoginStateChange(false)
    })
  }
}
