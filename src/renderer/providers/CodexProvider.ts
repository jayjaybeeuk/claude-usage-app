import { BaseProvider } from './BaseProvider'
import { elements } from '../ui/elements'
import { getThemeColors, hexToRgba } from '../ui/theme'
import { updateProgressBar, updateTimer, updateUsageRing, debugLog } from '../ui/utils'
import type { CodexUsageData, UsageHistoryEntry } from '../../shared/ipc-types'

export interface CodexProviderOptions {
  onResize: () => void
  onDataChange: () => void
}

export class CodexProvider extends BaseProvider {
  id = 'codex'
  latestCodexData: CodexUsageData | null = null
  isCodexGraphVisible = false
  isCodexPieVisible = false

  constructor(private options: CodexProviderOptions) {
    super()
    this.setupEventListeners()
  }

  async init(): Promise<void> {
    const creds = await window.electronAPI.getCodexCredentials()
    if (creds.accessToken) {
      // Reserve space immediately to avoid visible layout jump while data loads
      this.showContent()
      this.updateUI()
      elements.codexStatusText.textContent = 'Refreshing...'
      this.options.onResize()
    } else {
      this.showLogin()
      this.options.onResize()
    }
  }

  async fetchData(): Promise<void> {
    const creds = await window.electronAPI.getCodexCredentials()
    if (!creds.accessToken) {
      this.showLogin()
      return
    }

    try {
      const data = await window.electronAPI.fetchCodexUsageData()
      this.latestCodexData = data
      this.hasData = true
      this.lastRefreshTime = Date.now()

      this.showContent()
      this.updateUI()
      this.startTimers()
      this.updateStatusText()

      this.renderCharts()
      this.options.onResize()
    } catch (error) {
      const err = error as Error
      if (err.message.includes('CodexSessionExpired') || err.message.includes('Missing Codex')) {
        this.hasData = false
        this.showLogin()
      } else {
        // Try cached data
        const cached = await window.electronAPI.getCachedCodexUsage()
        if (cached) {
          this.latestCodexData = cached.data
          this.hasData = true
          this.lastRefreshTime = cached.timestamp

          this.showContent()
          this.updateUI()
          this.startTimers()
          this.updateStatusText()

          this.renderCharts()
          this.options.onResize()
        } else {
          this.hasData = false
          this.showLogin()
          elements.codexLoginError.textContent = 'Failed to fetch. Try reconnecting.'
        }
      }
    }
  }

  updateUI(): void {
    const data = this.latestCodexData ?? {}
    const sessionUtil = data.five_hour?.utilization ?? 0
    const weeklyUtil = data.seven_day?.utilization ?? 0

    updateProgressBar(elements.codexSessionProgress, elements.codexSessionPercentage, sessionUtil)
    updateUsageRing(elements.codexSessionUsageRing, sessionUtil)
    updateTimer(elements.codexSessionTimer, elements.codexSessionTimeText, data.five_hour?.resets_at ?? null, 5 * 60)

    updateProgressBar(elements.codexWeeklyProgress, elements.codexWeeklyPercentage, weeklyUtil)
    updateUsageRing(elements.codexWeeklyUsageRing, weeklyUtil)
    updateTimer(elements.codexWeeklyTimer, elements.codexWeeklyTimeText, data.seven_day?.resets_at ?? null, 7 * 24 * 60)
  }

  renderCharts(): void {
    if (this.isCodexGraphVisible) void this.renderUsageChart()
    if (this.isCodexPieVisible) this.renderPieChart()
  }

  startTimers(): void {
    this.stopTimers()
    
    const countdown = setInterval(() => {
      if (this.latestCodexData) this.updateUI()
    }, 1000)
    this.registerInterval(countdown)

    const status = setInterval(() => this.updateStatusText(), 30000)
    this.registerInterval(status)
  }

  showLogin(): void {
    this.hasData = false
    elements.codexLoginContainer.style.display = 'block'
    elements.codexContent.style.display = 'none'
    elements.codexManualInput.style.display = 'none'
    elements.codexAutoDetectBtn.style.display = ''
    elements.codexManualBtn.style.display = ''
    elements.codexLoginError.textContent = ''
    
    this.isCodexGraphVisible = false
    this.isCodexPieVisible = false
    elements.codexGraphSection.style.display = 'none'
    elements.codexPieSection.style.display = 'none'
    elements.codexGraphToggleBtn.classList.remove('active')
    elements.codexPieToggleBtn.classList.remove('active')
    
    this.stopTimers()
    elements.codexStatusText.textContent = 'Connect Codex to load usage'
  }

  destroy(): void {
    super.destroy()
    this.latestCodexData = null
    this.isCodexGraphVisible = false
    this.isCodexPieVisible = false
  }

  // --- Private Helpers ---

  private showContent(): void {
    elements.codexLoginContainer.style.display = 'none'
    elements.codexContent.style.display = 'block'
  }

  private updateStatusText(): void {
    if (!this.lastRefreshTime) {
      elements.codexStatusText.textContent = 'Refreshed just now'
      return
    }
    const elapsed = Date.now() - this.lastRefreshTime
    const minutes = Math.floor(elapsed / 60000)
    if (minutes < 1) {
      elements.codexStatusText.textContent = 'Refreshed just now'
    } else if (minutes === 1) {
      elements.codexStatusText.textContent = 'Refreshed 1 minute ago'
    } else {
      elements.codexStatusText.textContent = `Refreshed ${minutes} minutes ago`
    }
  }

  private async handleAutoDetect(): Promise<void> {
    elements.codexAutoDetectBtn.disabled = true
    elements.codexAutoDetectBtn.textContent = 'Detecting...'
    elements.codexLoginError.textContent = ''

    try {
      const result = await window.electronAPI.detectCodexToken()
      if (result.success && result.accessToken) {
        await window.electronAPI.saveCodexCredentials({
          accessToken: result.accessToken,
          cookieName: result.cookieName,
        })
        await this.fetchData()
        this.options.onDataChange()
      } else {
        elements.codexLoginError.textContent = result.error || 'Detection failed'
      }
    } catch (err) {
      elements.codexLoginError.textContent = (err as Error).message || 'Detection failed'
    } finally {
      elements.codexAutoDetectBtn.disabled = false
      elements.codexAutoDetectBtn.textContent = 'Connect'
    }
  }

  private async handleManualToken(): Promise<void> {
    const token = elements.codexTokenInput.value.trim()
    if (!token) {
      elements.codexTokenError.textContent = 'Please paste your Codex token'
      return
    }

    elements.codexSaveBtn.disabled = true
    elements.codexSaveBtn.textContent = '...'
    elements.codexTokenError.textContent = ''

    try {
      await window.electronAPI.saveCodexCredentials({ accessToken: token })
      elements.codexTokenInput.value = ''
      await this.fetchData()
      if (!this.hasData) {
        elements.codexTokenError.textContent = 'Token saved but fetch failed. Check the token is valid.'
      } else {
        this.options.onDataChange()
      }
    } catch {
      elements.codexTokenError.textContent = 'Failed to connect. Check your token.'
    } finally {
      elements.codexSaveBtn.disabled = false
      elements.codexSaveBtn.textContent = 'Save'
    }
  }

  private async renderUsageChart(): Promise<void> {
    try {
      const { codexPrimary, codexSecondary } = getThemeColors()
      const history = await window.electronAPI.getUsageHistory()
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      const recent = history.filter((e) => e.timestamp >= sevenDaysAgo && (e.codexSession != null || e.codexWeekly != null))

      const hourlyData: Record<string, UsageHistoryEntry> = {}
      for (const entry of recent) {
        const date = new Date(entry.timestamp)
        const hourKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`
        if (!hourlyData[hourKey] || entry.timestamp > hourlyData[hourKey].timestamp) {
          hourlyData[hourKey] = entry
        }
      }

      const sortedKeys = Object.keys(hourlyData).sort()
      const sessionData = sortedKeys.map((k) => hourlyData[k].codexSession ?? 0)
      const weeklyData = sortedKeys.map((k) => hourlyData[k].codexWeekly ?? 0)
      const labels = sortedKeys.map((k) => {
        const parts = k.split(' ')
        const dateParts = parts[0].split('-')
        return `${dateParts[1]}/${dateParts[2]} ${parts[1]}`
      })

      const canvas = elements.codexUsageChart
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
        ctx.fillText('Codex history will appear after a few refreshes', w / 2, h / 2)
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
        ctx!.lineTo(padLeft + chartW, padTop + chartH)
        ctx!.lineTo(padLeft, padTop + chartH)
        ctx!.closePath()
        ctx!.fillStyle = fillColor
        ctx!.fill()
      }

      drawLine(sessionData, codexPrimary, hexToRgba(codexPrimary, 0.12))
      drawLine(weeklyData, codexSecondary, hexToRgba(codexSecondary, 0.09))

      const legendY = 6
      ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = codexPrimary
      ctx.fillRect(padLeft, legendY - 3, 10, 6)
      ctx.fillStyle = '#a0a0a0'
      ctx.fillText('Session', padLeft + 14, legendY)
      ctx.fillStyle = codexSecondary
      ctx.fillRect(padLeft + 72, legendY - 3, 10, 6)
      ctx.fillStyle = '#a0a0a0'
      ctx.fillText('Weekly', padLeft + 86, legendY)
    } catch (error) {
      debugLog('Codex chart rendering failed:', error)
    }
  }

  private renderPieChart(): void {
    if (!this.latestCodexData) return
    const { codexPrimary, codexSecondary } = getThemeColors()

    const sessionPct = this.latestCodexData.five_hour?.utilization ?? 0
    const weeklyPct = this.latestCodexData.seven_day?.utilization ?? 0

    const canvas = elements.codexPieChart
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

    const cx = w * 0.36
    const cy = h / 2
    const outerRadius = Math.min(w, h) * 0.32
    const outerWidth = outerRadius * 0.3
    const innerRadius = outerRadius * 0.6
    const innerWidth = outerRadius * 0.3
    const start = -Math.PI / 2
    const tau = 2 * Math.PI

    function drawRing(radius: number, width: number, value: number, usedColor: string, remainColor: string): void {
      const pct = Math.max(0, Math.min(100, value))
      ctx!.beginPath()
      ctx!.arc(cx, cy, radius, start, start + tau, false)
      ctx!.lineWidth = width
      ctx!.strokeStyle = remainColor
      ctx!.stroke()
      ctx!.beginPath()
      ctx!.arc(cx, cy, radius, start, start + (pct / 100) * tau, false)
      ctx!.lineWidth = width
      ctx!.strokeStyle = usedColor
      ctx!.stroke()
    }

    drawRing(outerRadius, outerWidth, weeklyPct, codexSecondary, hexToRgba(codexSecondary, 0.16))
    drawRing(innerRadius, innerWidth, sessionPct, codexPrimary, hexToRgba(codexPrimary, 0.16))

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillStyle = '#c0c0c0'
    ctx.fillText(`${Math.round(sessionPct)}%`, cx, cy)
    ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillStyle = '#707070'
    ctx.fillText('session used', cx, cy + 14)

    const legendX = w * 0.68
    const baseY = cy - 20
    ctx.textAlign = 'left'
    ctx.fillStyle = codexSecondary
    ctx.fillRect(legendX, baseY, 8, 8)
    ctx.fillStyle = '#c0c0c0'
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillText(`Weekly: ${Math.round(weeklyPct)}% used`, legendX + 12, baseY + 4)
    ctx.fillStyle = codexPrimary
    ctx.fillRect(legendX, baseY + 18, 8, 8)
    ctx.fillStyle = '#c0c0c0'
    ctx.fillText(`Session: ${Math.round(sessionPct)}% used`, legendX + 12, baseY + 22)
  }

  private setupEventListeners(): void {
    elements.codexAutoDetectBtn.addEventListener('click', () => { void this.handleAutoDetect() })
    
    elements.codexManualBtn.addEventListener('click', () => {
      elements.codexManualInput.style.display = 'block'
      elements.codexAutoDetectBtn.style.display = 'none'
      elements.codexManualBtn.style.display = 'none'
      elements.codexTokenInput.focus()
    })
    
    elements.codexBackBtn.addEventListener('click', () => {
      elements.codexManualInput.style.display = 'none'
      elements.codexAutoDetectBtn.style.display = ''
      elements.codexManualBtn.style.display = ''
      elements.codexTokenError.textContent = ''
    })
    
    elements.codexSaveBtn.addEventListener('click', () => { void this.handleManualToken() })
    
    elements.codexTokenInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') void this.handleManualToken()
      elements.codexTokenError.textContent = ''
    })

    elements.codexGraphToggleBtn.addEventListener('click', () => {
      this.isCodexGraphVisible = !this.isCodexGraphVisible
      elements.codexGraphSection.style.display = this.isCodexGraphVisible ? 'block' : 'none'
      elements.codexGraphToggleBtn.classList.toggle('active', this.isCodexGraphVisible)
      if (this.isCodexGraphVisible) void this.renderUsageChart()
      this.options.onResize()
    })

    elements.codexPieToggleBtn.addEventListener('click', () => {
      this.isCodexPieVisible = !this.isCodexPieVisible
      elements.codexPieSection.style.display = this.isCodexPieVisible ? 'block' : 'none'
      elements.codexPieToggleBtn.classList.toggle('active', this.isCodexPieVisible)
      if (this.isCodexPieVisible) this.renderPieChart()
      this.options.onResize()
    })

    window.electronAPI.onCodexSessionExpired(() => {
      debugLog('Codex session expired')
      this.latestCodexData = null
      this.hasData = false
      this.showLogin()
      this.options.onResize()
    })
  }
}