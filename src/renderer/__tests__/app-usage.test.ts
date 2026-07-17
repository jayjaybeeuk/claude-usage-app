import { describe, expect, it } from 'vitest'
import { backend, bootApp, flush, futureIso, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

function bootWithUsage(usage: unknown = sampleUsage()) {
  const b = backend()
  b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
  b.state.usageData = usage
  return bootApp()
}

describe('usage data handling', () => {
  it('builds extra rows including extra-usage spending and prepaid balance', async () => {
    await bootWithUsage()
    await flush(50)
    const rows = el('extraRows')
    // opus + extra_usage rows (sonnet has its own dedicated row)
    expect(rows.children.length).toBe(2)
    expect(rows.textContent).toContain('Opus (7d)')
    expect(rows.textContent).toContain('Extra Usage')
    expect(rows.textContent).toContain('£5/£50')
    expect(rows.textContent).toContain('Bal £2.5')
    expect(el('extraUsageToggleBtn').style.display).toBe('flex')

    // Expanding shows the section and resizes the window taller
    const b = backend()
    const resizesBefore = b.callsFor('resize_window').length
    el('extraUsageToggleBtn').click()
    await flush(10)
    expect(el('expandSection').style.display).toBe('block')
    expect(b.callsFor('resize_window').length).toBeGreaterThan(resizesBefore)
  })

  it('hides the extras toggle when no extra data is present', async () => {
    await bootWithUsage({
      five_hour: { utilization: 5, resets_at: futureIso(1) },
      seven_day: { utilization: 10, resets_at: futureIso(48) },
    })
    await flush(50)
    expect(el('extraRows').children.length).toBe(0)
    expect(el('extraUsageToggleBtn').style.display).toBe('none')
    expect(el('sonnetRow').style.display).toBe('none')
  })

  it('shows the no-usage screen for zero utilization with no reset windows', async () => {
    const b = await bootWithUsage({ five_hour: { utilization: 0 }, seven_day: { utilization: 0 } })
    await flush(50)
    expect(el('noUsageContainer').style.display).toBe('flex')
    expect(el('mainContent').style.display).toBe('none')

    // Once usage appears, a refresh returns to the main content
    b.state.usageData = sampleUsage()
    b.emit('refresh-usage')
    await flush(50)
    expect(el('noUsageContainer').style.display).toBe('none')
    expect(el('mainContent').style.display).toBe('block')
  })

  it('renders countdown timers for future resets', async () => {
    await bootWithUsage()
    await flush(50)
    // ~2h to session reset → "2h 0m" style text (never --:--)
    expect(el('sessionTimeText').textContent).not.toBe('--:--')
    expect(el('weeklyTimeText').textContent).not.toBe('--:--')
  })

  it('clears credentials and shows login when the fetch reports SessionExpired', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageError = 'SessionExpired'
    await bootApp()
    await flush(50)
    expect(el('loginContainer').style.display).toBe('flex')
    expect(el('mainContent').style.display).toBe('none')
  })

  it('falls back to cached data and shows offline status on network errors', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageError = 'Request timeout'
    b.state.cachedUsage = {
      data: {
        five_hour: { utilization: 61, resets_at: futureIso(1) },
        seven_day: { utilization: 22, resets_at: futureIso(24) },
      },
      timestamp: Date.now() - 10 * 60_000,
    }
    await bootApp()
    await flush(50)

    expect(el('mainContent').style.display).toBe('block')
    expect(el('sessionPercentage').textContent).toBe('61%')
    expect(el('statusText').textContent).toContain('Offline · Last updated 10 minutes ago')
  })

  it('keeps the current screen when a network error occurs with no cache', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageError = 'Request timeout'
    await bootApp()
    await flush(50)
    // init() shows main content before fetching; a cacheless failure leaves it as-is
    expect(el('mainContent').style.display).toBe('block')
    expect(el('sessionPercentage').textContent).toBe('0%')
  })

  it('refreshes when the tray sends a refresh-usage event', async () => {
    const b = await bootWithUsage()
    await flush(30)
    const before = b.callsFor('fetch_usage_data').length
    b.emit('refresh-usage')
    await flush(40)
    expect(b.callsFor('fetch_usage_data').length).toBe(before + 1)
  })

  it('returns to login when the backend emits session-expired', async () => {
    const b = await bootWithUsage()
    await flush(30)
    expect(el('mainContent').style.display).toBe('block')
    b.emit('session-expired')
    await flush(10)
    expect(el('loginContainer').style.display).toBe('flex')
  })

  it('refresh button refetches and clears its spinner', async () => {
    const b = await bootWithUsage()
    await flush(30)
    const before = b.callsFor('fetch_usage_data').length
    el('refreshBtn').click()
    await flush(40)
    expect(b.callsFor('fetch_usage_data').length).toBe(before + 1)
    expect(el('refreshBtn').classList.contains('spinning')).toBe(false)
  })

  it('minimize and close buttons hide the window via commands', async () => {
    const b = await bootApp()
    el('minimizeBtn').click()
    el('closeBtn').click()
    await flush(10)
    expect(b.callsFor('minimize_window')).toHaveLength(1)
    expect(b.callsFor('close_window')).toHaveLength(1)
  })
})
