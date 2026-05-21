import { BaseProvider } from './BaseProvider'
import { elements } from '../ui/elements'
import { updateProgressBar, debugLog } from '../ui/utils'
import type { CopilotUsageData } from '../../shared/ipc-types'

export interface CopilotProviderOptions {
  onResize: () => void
  onDataChange: () => void
}

export class CopilotProvider extends BaseProvider {
  id = 'copilot'
  latestCopilotData: CopilotUsageData | null = null

  constructor(private options: CopilotProviderOptions) {
    super()
    this.setupEventListeners()
  }

  async init(): Promise<void> {
    const creds = await window.electronAPI.getCopilotCredentials()
    if (creds.accessToken) {
      this.showContent()
      this.updateUI()
      elements.copilotStatusText.textContent = 'Refreshing...'
      this.options.onResize()
    } else {
      this.showLogin()
      this.options.onResize()
    }
  }

  async fetchData(): Promise<void> {
    const creds = await window.electronAPI.getCopilotCredentials()
    if (!creds.accessToken) {
      this.showLogin()
      this.options.onResize()
      return
    }

    try {
      const data = await window.electronAPI.fetchCopilotUsageData()
      this.latestCopilotData = data
      this.hasData = true
      this.lastRefreshTime = Date.now()

      this.showContent()
      this.updateUI()
      this.updateStatusText()
      this.startTimers()
      this.options.onResize()
    } catch (error) {
      const err = error as Error
      if (
        err.message.includes('CopilotSessionExpired') ||
        err.message.includes('Missing Copilot') ||
        err.message.includes('CopilotCredentialDecryptFailed')
      ) {
        this.hasData = false
        this.showLogin()
      } else {
        const cached = await window.electronAPI.getCachedCopilotUsage()
        if (cached) {
          this.latestCopilotData = cached.data
          this.hasData = true
          this.lastRefreshTime = cached.timestamp
          
          this.showContent()
          this.updateUI()
          this.updateStatusText()
          this.startTimers()
          this.options.onResize()
        } else {
          this.hasData = false
          this.showLogin()
          elements.copilotLoginError.textContent = err.message || 'Failed to fetch. Try reconnecting.'
        }
      }
    }
  }

  updateUI(): void {
    const data = this.latestCopilotData
    if (!data) return

    const consumed = data.totalConsumed ?? 0
    const entitlement = data.entitlement ?? 0
    const percentUsed = entitlement > 0 ? Math.min(100, (consumed / entitlement) * 100) : 0

    updateProgressBar(elements.copilotPremiumProgress, elements.copilotPremiumPercentage, percentUsed)

    if (entitlement > 0) {
      elements.copilotCountText.textContent = `${consumed} / ${entitlement}`
    } else if (consumed > 0) {
      elements.copilotCountText.textContent = `${consumed} requests`
    } else {
      elements.copilotCountText.textContent = '--'
    }

    elements.copilotPlanSubtitle.textContent = data.copilot_plan
      ? this.formatCopilotPlan(data.copilot_plan)
      : 'GitHub Premium Requests'

    const period = this.formatBillingMonth(data.billingYear, data.billingMonth)
    elements.copilotResetText.textContent = period ? `${period}` : ''
  }

  renderCharts(): void {
    // No charts for Copilot currently
  }

  startTimers(): void {
    this.stopTimers()
    const status = setInterval(() => this.updateStatusText(), 30_000)
    this.registerInterval(status)
  }

  showLogin(): void {
    this.hasData = false
    elements.copilotLoginContainer.style.display = 'block'
    elements.copilotContent.style.display = 'none'
    elements.copilotDeviceFlow.style.display = 'none'
    elements.copilotClientIdSetup.style.display = 'none'
    elements.copilotLoginPrompt.style.display = ''
    elements.copilotLoginError.textContent = ''
    this.stopTimers()
    elements.copilotStatusText.textContent = 'Connect Copilot to load usage'
  }

  destroy(): void {
    super.destroy()
    this.latestCopilotData = null
  }

  // --- Private Helpers ---

  private showContent(): void {
    elements.copilotLoginContainer.style.display = 'none'
    elements.copilotContent.style.display = 'block'
    this.hasData = true
  }

  private updateStatusText(): void {
    if (!this.lastRefreshTime) return
    const ago = Math.floor((Date.now() - this.lastRefreshTime) / 1000)
    if (ago < 60) {
      elements.copilotStatusText.textContent = 'Refreshed just now'
    } else if (ago < 3600) {
      const mins = Math.floor(ago / 60)
      elements.copilotStatusText.textContent = `Refreshed ${mins}m ago`
    } else {
      const hrs = Math.floor(ago / 3600)
      elements.copilotStatusText.textContent = `Refreshed ${hrs}h ago`
    }
  }

  private formatCopilotPlan(plan: string): string {
    const labels: Record<string, string> = {
      free: 'Free',
      pro: 'Pro',
      pro_plus: 'Pro+',
      business: 'Business',
      enterprise: 'Enterprise',
    }
    return `GitHub Copilot ${labels[plan] ?? plan}`
  }

  private formatBillingMonth(year?: number, month?: number): string {
    if (!year || !month) return ''
    try {
      return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    } catch {
      return `${year}-${String(month).padStart(2, '0')}`
    }
  }

  private async handleCopilotConnect(): Promise<void> {
    elements.copilotLoginError.textContent = ''
    const clientId = await window.electronAPI.copilotGetClientId()
    if (!clientId) {
      elements.copilotLoginPrompt.style.display = 'none'
      elements.copilotClientIdSetup.style.display = 'block'
      elements.copilotClientIdInput.focus()
      return
    }
    await this.startCopilotDeviceFlow()
  }

  private async handleCopilotClientIdSave(): Promise<void> {
    const clientId = elements.copilotClientIdInput.value.trim()
    if (!clientId) {
      elements.copilotClientIdError.textContent = 'Please enter your GitHub OAuth Client ID'
      return
    }
    elements.copilotClientIdSaveBtn.disabled = true
    elements.copilotClientIdSaveBtn.textContent = '...'
    elements.copilotClientIdError.textContent = ''
    try {
      await window.electronAPI.copilotSetClientId(clientId)
      elements.copilotClientIdInput.value = ''
      elements.copilotClientIdSetup.style.display = 'none'
      elements.copilotLoginPrompt.style.display = ''
      await this.startCopilotDeviceFlow()
    } catch (err) {
      elements.copilotClientIdError.textContent = (err as Error).message || 'Failed to save Client ID'
    } finally {
      elements.copilotClientIdSaveBtn.disabled = false
      elements.copilotClientIdSaveBtn.textContent = 'Save'
    }
  }

  private async startCopilotDeviceFlow(): Promise<void> {
    elements.copilotLoginError.textContent = ''
    try {
      const result = await window.electronAPI.copilotStartDeviceFlow()
      elements.copilotLoginPrompt.style.display = 'none'
      elements.copilotUserCode.textContent = result.user_code
      elements.copilotOpenGithubBtn.onclick = () => {
        window.electronAPI.openExternal(result.verification_uri)
      }
      elements.copilotDeviceFlow.style.display = 'block'
    } catch (err) {
      elements.copilotLoginError.textContent = (err as Error).message || 'Failed to start authorization'
    }
  }

  private setupEventListeners(): void {
    elements.copilotConnectBtn.addEventListener('click', () => { void this.handleCopilotConnect() })

    elements.copilotClientIdBackBtn.addEventListener('click', () => {
      elements.copilotClientIdSetup.style.display = 'none'
      elements.copilotLoginPrompt.style.display = ''
      elements.copilotClientIdError.textContent = ''
    })

    elements.copilotClientIdSaveBtn.addEventListener('click', () => { void this.handleCopilotClientIdSave() })
    elements.copilotClientIdInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') void this.handleCopilotClientIdSave()
    })

    elements.copilotCancelFlowBtn.addEventListener('click', () => {
      elements.copilotDeviceFlow.style.display = 'none'
      elements.copilotLoginPrompt.style.display = ''
    })

    window.electronAPI.onCopilotAuthSuccess(() => {
      elements.copilotDeviceFlow.style.display = 'none'
      elements.copilotLoginPrompt.style.display = ''
      void this.fetchData()
      this.options.onDataChange()
      this.options.onResize()
    })

    window.electronAPI.onCopilotAuthFailed((error: string) => {
      elements.copilotDeviceFlow.style.display = 'none'
      elements.copilotLoginPrompt.style.display = ''
      elements.copilotLoginError.textContent = error || 'Authorization failed — please try again'
    })

    window.electronAPI.onCopilotSessionExpired(() => {
      debugLog('Copilot session expired')
      this.latestCopilotData = null
      this.hasData = false
      this.showLogin()
      this.options.onResize()
    })
  }
}
