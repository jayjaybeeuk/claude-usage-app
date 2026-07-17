/**
 * Failure-path and timer-path coverage: settings backends that reject,
 * offline retry recovery, expired weekly windows, expanded-extras refresh,
 * resizes while logged out, and unload cleanup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backend, bootApp, flush, futureIso, sampleUsage } from './backend'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

afterEach(() => {
  vi.useRealTimers()
})

describe('settings failure fallbacks', () => {
  it('falls back to defaults when theme and auto-start reads fail', async () => {
    const b = backend()
    b.state.errors.get_theme = 'store unavailable'
    b.state.errors.get_background_hue = 'store unavailable'
    b.state.errors.is_auto_start_supported = 'nope'
    await bootApp()

    expect(document.documentElement.getAttribute('data-theme')).toBe('purple')
    expect(document.documentElement.hasAttribute('data-background-hue')).toBe(false)
    expect(el('autoStartSection').style.display).toBe('none')
  })

  it('defaults the auto-start toggle off when reading the setting fails', async () => {
    const b = backend()
    b.state.errors.get_auto_start = 'store unavailable'
    await bootApp()

    expect(el('autoStartSection').style.display).toBe('block')
    expect((el('autoStartToggle') as HTMLInputElement).checked).toBe(false)
  })

  it('keeps the UI consistent when saving theme or hue fails', async () => {
    const b = await bootApp()
    b.state.errors.set_theme = 'disk full'
    b.state.errors.set_background_hue = 'disk full'

    const themeDropdown = el('themeDropdown') as HTMLSelectElement
    themeDropdown.value = 'green'
    themeDropdown.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    // Save failed → applyTheme never ran with the new value
    expect(document.documentElement.getAttribute('data-theme')).toBe('purple')

    const hueDropdown = el('backgroundHueDropdown') as HTMLSelectElement
    hueDropdown.value = 'orange'
    hueDropdown.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    expect(document.documentElement.hasAttribute('data-background-hue')).toBe(false)
  })

  it('reverts the auto-start toggle when the backend rejects the change', async () => {
    const b = await bootApp()
    await flush(20)
    b.state.errors.set_auto_start = 'launch agent error'

    const toggle = el('autoStartToggle') as HTMLInputElement
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(20)
    expect(toggle.checked).toBe(false)
  })
})

describe('login failure paths', () => {
  it('surfaces detect_session_key rejections in the auto-detect error', async () => {
    const b = await bootApp()
    b.state.errors.detect_session_key = 'Failed to open login window: boom'
    el('autoDetectBtn').click()
    await flush(30)
    expect(el('autoDetectError').textContent).toContain('Failed to open login window')
    expect((el('autoDetectBtn') as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a connect error when saving the codex token rejects', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(40)

    el('codexManualBtn').click()
    ;(el('codexTokenInput') as HTMLInputElement).value = 'tok-x'
    b.state.errors.save_codex_credentials = 'store unavailable'
    el('codexSaveBtn').click()
    await flush(30)
    expect(el('codexTokenError').textContent).toBe('Failed to connect. Check your token.')
  })
})

describe('timers and refresh windows', () => {
  it('marks an expired weekly window as Resetting...', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = {
      five_hour: { utilization: 10, resets_at: futureIso(1) },
      seven_day: { utilization: 95, resets_at: new Date(Date.now() - 60_000).toISOString() },
    }
    await bootApp()
    await flush(50)
    expect(el('weeklyTimeText').textContent).toBe('Resetting...')
  })

  it('updates expanded extra-row timers on refresh', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(50)

    el('extraUsageToggleBtn').click()
    await flush(20)
    b.emit('refresh-usage')
    await flush(40)

    const opusTimer = el('extraRows').querySelector<HTMLDivElement>('.timer-text')
    expect(opusTimer?.textContent).toMatch(/\d/) // countdown text, not '--:--'
  })

  it('recovers from offline mode via the retry interval and resumes auto-refresh', async () => {
    // The retry/auto-update intervals must be created under fake timers so
    // they can be advanced, so boot the app inside the fake clock.
    vi.useFakeTimers()
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await import('../app')
    await vi.advanceTimersByTimeAsync(100)

    // Go offline with cached data available.
    b.state.usageError = 'Request timeout'
    b.state.cachedUsage = { data: sampleUsage(), timestamp: Date.now() - 120_000 }
    b.emit('refresh-usage')
    await vi.advanceTimersByTimeAsync(100)
    expect(el('statusText').textContent).toContain('Offline')

    // Come back online; the retry interval (refreshIntervalMinutes) fires.
    b.state.usageError = null
    const fetchesBefore = b.callsFor('fetch_usage_data').length
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000)
    expect(b.callsFor('fetch_usage_data').length).toBeGreaterThan(fetchesBefore)
    expect(el('statusText').textContent).toContain('Refreshed')

    // One more auto-update tick after recovery exercises startAutoUpdate's callback.
    const afterRecovery = b.callsFor('fetch_usage_data').length
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000)
    expect(b.callsFor('fetch_usage_data').length).toBeGreaterThan(afterRecovery)
  })

  it('reports codex data refreshed 1 minute ago from cache timestamps', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    b.state.codexCredentials = { accessToken: 'tok' }
    b.state.codexUsageError = 'CodexUsageFetchFailed:503'
    b.state.cachedCodexUsage = {
      data: { five_hour: { utilization: 3 }, seven_day: { utilization: 4 } },
      timestamp: Date.now() - 61_000,
    }
    await bootApp()
    await flush(60)
    expect(el('codexStatusText').textContent).toBe('Refreshed 1 minute ago')
  })
})

describe('window lifecycle', () => {
  it('collapses to the base height when toggling charts while logged out', async () => {
    const b = await bootApp()
    el('graphToggleBtn').click()
    await flush(20)
    const heights = b.callsFor('resize_window').map((a) => (a as { height: number }).height)
    expect(heights[heights.length - 1]).toBe(164)
  })

  it('forwards backend debug logs to the console', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const b = await bootApp()
    b.emit('debug-log', { label: 'Raw usage API response:', data: { ok: true } })
    expect(spy).toHaveBeenCalledWith('[Debug]', 'Raw usage API response:', { ok: true })
    spy.mockRestore()
  })

  it('clears all intervals on beforeunload', async () => {
    const b = backend()
    b.state.credentials = { sessionKey: 'sk', organizationId: 'org' }
    b.state.usageData = sampleUsage()
    await bootApp()
    await flush(50)

    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    window.dispatchEvent(new Event('beforeunload'))
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
