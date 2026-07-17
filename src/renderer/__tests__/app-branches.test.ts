/**
 * Targeted tests for conditional paths not exercised by the main flow suites:
 * platform classes, fallback values, expired timers, chart edge cases, and
 * error-message fallbacks.
 */
import { describe, expect, it, vi } from 'vitest'
import { backend, bootApp, flush, futureIso, sampleCodexUsage, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

function setUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

describe('branch coverage details', () => {
  it('applies platform-darwin and platform-win32 body classes from the UA', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')
    await bootApp()
    expect(document.body.classList.contains('platform-darwin')).toBe(true)

    vi.resetModules()
    document.body.className = ''
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    await bootApp()
    expect(document.body.classList.contains('platform-win32')).toBe(true)
  })

  it('shows login when a refresh happens without credentials', async () => {
    const b = await bootApp()
    b.emit('refresh-usage')
    await flush(20)
    expect(el('loginContainer').style.display).toBe('flex')
  })

  it('defaults missing utilization fields to 0 and greys out absent timers', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    // Some weekly usage so the widget shows main content (all-zero data
    // with no resets renders the dedicated no-usage screen instead)
    b.state.usageData = { five_hour: {}, seven_day: { utilization: 1 } }
    await bootApp()
    await flush(50)
    expect(el('sessionPercentage').textContent).toBe('0%')
    expect(el('weeklyPercentage').textContent).toBe('1%')
    expect(el('sessionTimeText').textContent).toBe('--:--')
    expect(el('sessionTimeText').style.opacity).toBe('0.5')
  })

  it('shows Resetting... for already-expired reset timestamps', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = {
      five_hour: { utilization: 99, resets_at: new Date(Date.now() - 60_000).toISOString() },
      seven_day: { utilization: 50, resets_at: futureIso(0.05) }, // ~3 minutes → "Xm" + danger arc
    }
    await bootApp()
    await flush(50)
    expect(el('sessionTimeText').textContent).toBe('Resetting...')
    expect(el('sessionProgress').classList.contains('danger')).toBe(true)
    expect(el('weeklyTimeText').textContent).toMatch(/^\d+m$/)
    expect(el('weeklyTimer').classList.contains('danger')).toBe(true)
  })

  it('renders long countdowns in days and hours', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = {
      five_hour: { utilization: 1, resets_at: futureIso(2) },
      seven_day: { utilization: 1, resets_at: futureIso(50) },
    }
    await bootApp()
    await flush(50)
    expect(el('weeklyTimeText').textContent).toMatch(/^\dd \d+h$/)
    expect(el('sessionTimeText').textContent).toMatch(/^\dh \d+m$/)
  })

  it('renders a balance-only extra usage row and danger extras', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = {
      five_hour: { utilization: 10, resets_at: futureIso(1) },
      seven_day: { utilization: 10, resets_at: futureIso(24) },
      seven_day_opus: { utilization: 95, resets_at: futureIso(24) },
      extra_usage: { balance_cents: 1234 },
    }
    await bootApp()
    await flush(50)
    const rows = el('extraRows')
    expect(rows.textContent).toContain('Bal £12.34')
    expect(rows.textContent).toContain('0%') // no utilization → 0% fallback
    expect(rows.querySelector('.progress-fill.opus')?.classList.contains('danger')).toBe(true)
  })

  it('collapses the extras section when a refetch returns no extras', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(50)
    el('extraUsageToggleBtn').click()
    expect(el('expandSection').style.display).toBe('block')

    b.state.usageData = {
      five_hour: { utilization: 1, resets_at: futureIso(1) },
      seven_day: { utilization: 1, resets_at: futureIso(24) },
    }
    b.emit('refresh-usage')
    await flush(40)
    expect(el('expandSection').style.display).toBe('none')
    expect(el('extraUsageToggleBtn').style.display).toBe('none')
  })

  it('re-renders open charts when data refreshes and clears history live', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    b.state.history = [{ timestamp: Date.now(), session: 1, weekly: 2, sonnet: 3 }]
    await bootApp()
    await flush(40)

    el('graphToggleBtn').click()
    el('pieToggleBtn').click()
    await flush(40)
    const historyReads = b.callsFor('get_usage_history').length

    b.emit('refresh-usage')
    await flush(50)
    expect(b.callsFor('get_usage_history').length).toBeGreaterThan(historyReads)

    // Clear history while the graph is open → chart re-renders empty
    el('clearHistoryBtn').click()
    await flush(30)
    expect(b.state.history).toHaveLength(0)
    expect(el('graphSection').style.display).toBe('block')
  })

  it('renders the graph with an empty history without errors', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(40)
    el('graphToggleBtn').click()
    await flush(40)
    expect(el('graphSection').style.display).toBe('block')
  })

  it('skips window resizes while the settings overlay is open', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(40)

    el('settingsBtn').click()
    await flush(30)
    const resizesWhileOpen = b.callsFor('resize_window').length
    b.emit('refresh-usage')
    await flush(40)
    // updateUI ran but resize_window was suppressed by the open settings overlay
    expect(b.callsFor('resize_window').length).toBe(resizesWhileOpen)
  })

  it('reports "1 minute ago" for minute-old cached data', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageError = 'Request timeout'
    b.state.cachedUsage = {
      data: { five_hour: { utilization: 5, resets_at: futureIso(1) }, seven_day: { utilization: 5, resets_at: futureIso(24) } },
      timestamp: Date.now() - 61_000,
    }
    await bootApp()
    await flush(50)
    expect(el('statusText').textContent).toBe('Offline · Last updated 1 minute ago')
  })

  it('uses error-message fallbacks in the login flows', async () => {
    const b = await bootApp()

    // detect succeeds but validation result carries no error text
    b.state.detectResult = { success: false }
    el('autoDetectBtn').click()
    await flush(30)
    expect(el('autoDetectError').textContent).toBe('Login failed')

    // manual connect: failure result without error text
    ;(el('sessionKeyInput') as HTMLInputElement).value = 'sk-x'
    b.state.validateResult = { success: false }
    el('connectBtn').click()
    await flush(30)
    expect(el('sessionKeyError').textContent).toBe('Invalid session key')

    // connect via Enter key with success but no organizationId
    ;(el('sessionKeyInput') as HTMLInputElement).value = 'sk-y'
    b.state.validateResult = { success: true }
    b.state.usageData = sampleUsage()
    el('sessionKeyInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush(50)
    expect(b.state.credentials).toEqual({ sessionKey: 'sk-y', organizationId: null })
  })

  it('handles codex manual-token fetch failure and detect rejection', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(40)

    // Manual token saves but fetch fails with no cache → inline warning
    el('codexManualBtn').click()
    ;(el('codexTokenInput') as HTMLInputElement).value = 'tok-bad'
    b.state.codexUsageError = 'CodexUsageFetchFailed:500'
    el('codexTokenInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush(50)
    expect(el('codexTokenError').textContent).toBe('Token saved but fetch failed. Check the token is valid.')

    // Auto-detect rejecting entirely surfaces the error message
    b.state.errors.detect_codex_token = 'Failed to open login window: boom'
    el('codexBackBtn').click()
    el('codexAutoDetectBtn').click()
    await flush(30)
    expect(el('codexLoginError').textContent).toContain('Failed to open login window')
  })

  it('re-renders open codex charts from cached data on fetch errors', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageData = sampleCodexUsage()
    b.state.history = [{ timestamp: Date.now(), session: 1, weekly: 2, sonnet: 0, codexSession: 33, codexWeekly: 55 }]
    await bootApp()
    await flush(60)

    el('codexGraphToggleBtn').click()
    el('codexPieToggleBtn').click()
    await flush(40)

    b.state.codexUsageData = null
    b.state.codexUsageError = 'CodexUsageFetchFailed:503'
    b.state.cachedCodexUsage = { data: sampleCodexUsage(), timestamp: Date.now() - 120_000 }
    b.emit('refresh-usage')
    await flush(60)

    expect(el('codexContent').style.display).toBe('block')
    expect(el('codexStatusText').textContent).toBe('Refreshed 2 minutes ago')
  })
})
