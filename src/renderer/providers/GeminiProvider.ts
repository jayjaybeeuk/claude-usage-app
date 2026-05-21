import { BaseProvider } from './BaseProvider'
import { elements } from '../ui/elements'
import { updateProgressBar, updateTimer, updateUsageRing } from '../ui/utils'
import type { GeminiUsageData } from '../../shared/ipc-types'

export interface GeminiProviderOptions {
  onResize: () => void
  onDataChange: () => void
}

export class GeminiProvider extends BaseProvider {
  id = 'gemini'
  latestGeminiData: GeminiUsageData | null = null

  constructor(private options: GeminiProviderOptions) {
    super()
    this.setupEventListeners()
  }

  async init(): Promise<void> {
    const creds = await window.electronAPI.getGeminiCredentials()
    if (creds.apiKey) {
      this.showContent()
      this.updateUI()
      elements.geminiStatusText.textContent = 'Refreshing...'
      this.options.onResize()
    } else {
      this.showLogin()
      this.options.onResize()
    }
  }

  async fetchData(): Promise<void> {
    const creds = await window.electronAPI.getGeminiCredentials()
    if (!creds.apiKey) {
      this.showLogin()
      return
    }

    try {
      const data = await window.electronAPI.fetchGeminiUsageData()
      this.latestGeminiData = data
      this.hasData = true
      this.lastRefreshTime = Date.now()

      this.showContent()
      this.updateUI()
      this.startTimers()
      this.updateStatusText()
      this.options.onResize()
    } catch (error) {
      const err = error as Error
      const cached = await window.electronAPI.getCachedGeminiUsage()
      if (cached) {
        this.latestGeminiData = cached.data
        this.hasData = true
        this.lastRefreshTime = cached.timestamp

        this.showContent()
        this.updateUI()
        this.startTimers()
        this.updateStatusText()
        this.options.onResize()
      } else {
        this.hasData = false
        this.showLogin()
        elements.geminiLoginError.textContent = err.message || 'Failed to fetch. Try reconnecting.'
      }
    }
  }

  updateUI(): void {
    const data = this.latestGeminiData ?? {}
    const dailyUtil = data.daily?.utilization ?? 0

    updateProgressBar(elements.geminiDailyProgress, elements.geminiDailyPercentage, dailyUtil)
    updateUsageRing(elements.geminiDailyUsageRing, dailyUtil)
    updateTimer(elements.geminiDailyTimer, elements.geminiDailyTimeText, data.daily?.resets_at ?? null, 24 * 60)
  }

  renderCharts(): void {}

  startTimers(): void {
    this.stopTimers()
    const countdown = setInterval(() => {
      if (this.latestGeminiData) this.updateUI()
    }, 1000)
    this.registerInterval(countdown)

    const status = setInterval(() => this.updateStatusText(), 30_000)
    this.registerInterval(status)
  }

  showLogin(): void {
    this.hasData = false
    elements.geminiLoginContainer.style.display = 'block'
    elements.geminiContent.style.display = 'none'
    elements.geminiLoginError.textContent = ''
    this.stopTimers()
    elements.geminiStatusText.textContent = 'Connect Gemini API to load usage'
  }

  destroy(): void {
    super.destroy()
    this.latestGeminiData = null
  }

  private showContent(): void {
    elements.geminiLoginContainer.style.display = 'none'
    elements.geminiContent.style.display = 'block'
  }

  private updateStatusText(): void {
    if (!this.lastRefreshTime) return
    const ago = Math.floor((Date.now() - this.lastRefreshTime) / 1000)
    if (ago < 60) {
      elements.geminiStatusText.textContent = 'Refreshed just now'
    } else if (ago < 3600) {
      const mins = Math.floor(ago / 60)
      elements.geminiStatusText.textContent = `Refreshed ${mins}m ago`
    } else {
      const hrs = Math.floor(ago / 3600)
      elements.geminiStatusText.textContent = `Refreshed ${hrs}h ago`
    }
  }

  private async handleSaveApiKey(): Promise<void> {
    const apiKey = elements.geminiApiKeyInput.value.trim()
    if (!apiKey) {
      elements.geminiLoginError.textContent = 'Please enter your Gemini API Key'
      return
    }
    elements.geminiSaveBtn.disabled = true
    elements.geminiSaveBtn.textContent = '...'
    elements.geminiLoginError.textContent = ''
    try {
      await window.electronAPI.saveGeminiCredentials({ apiKey })
      elements.geminiApiKeyInput.value = ''
      await this.fetchData()
      if (!this.hasData) {
        elements.geminiLoginError.textContent = 'API Key saved but fetch failed. Verify the key.'
      } else {
        this.options.onDataChange()
      }
    } catch (err) {
      elements.geminiLoginError.textContent = (err as Error).message || 'Failed to save API Key'
    } finally {
      elements.geminiSaveBtn.disabled = false
      elements.geminiSaveBtn.textContent = 'Save'
    }
  }

  private setupEventListeners(): void {
    elements.geminiSaveBtn.addEventListener('click', () => { void this.handleSaveApiKey() })
    elements.geminiApiKeyInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') void this.handleSaveApiKey()
    })
  }
}